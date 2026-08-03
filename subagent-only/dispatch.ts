/**
 * Dispatch loop — spawn a child `pi`, read its JSON stream, return one envelope.
 *
 * Design constraints this implements, all of them measured:
 *
 *  - The child is a fresh process. The 17041-token fork disappears by
 *    construction: it receives only what buildSpawnPlan passes.
 *  - The turn ceiling is enforced here because pi has none. No --max-turns, no
 *    session option, nothing: grep for maxTurns|turnBudget|turnLimit across
 *    dist/ and docs/ returns empty. A ceiling stated in a prompt is a wish.
 *  - Only `summary` returns to the orchestrator. The full envelope goes to
 *    disk. Handing back the whole payload would rebuild, one delegation at a
 *    time, the context bloat this exists to remove.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition } from "./agents.js";
import { buildSpawnPlan, type BuildContext } from "./spawn-args.js";

export interface RunResult {
  role: string;
  status: "ok" | "blocked" | "failed";
  summary: string;
  next: string;
  /** Where the full envelope was written. The orchestrator reads it only if it needs to. */
  artifact: string;
  turns: number;
  usage: { input: number; output: number; cacheRead: number; total: number };
  /** Set when the run ended on something other than a submit call. */
  failure?: "max_turns" | "timeout" | "no_submit" | "spawn_error" | "aborted";
}

interface StreamState {
  turns: number;
  submit: Record<string, unknown> | null;
  usage: { input: number; output: number; cacheRead: number; total: number };
  stderr: string[];
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, total: 0 };
}

/**
 * Accumulate one JSON event.
 *
 * Event shapes were read off a real run rather than assumed: usage lives on
 * `message` events whose message.role is "assistant", turns close on
 * `turn_end`, and a terminating tool surfaces as `tool_execution_end` with
 * toolName "submit". An earlier version of this parser looked for
 * `message_end` and silently found nothing.
 */
function consume(line: string, state: StreamState): void {
  let e: Record<string, any>;
  try {
    e = JSON.parse(line);
  } catch {
    return; // non-JSON lines on stdout are not our business
  }

  if (e.type === "turn_end") state.turns++;

  if (e.type === "message" || e.type === "message_end") {
    const m = e.message ?? e;
    if (m?.role === "assistant" && m.usage) {
      state.usage.input += m.usage.input ?? 0;
      state.usage.output += m.usage.output ?? 0;
      state.usage.cacheRead += m.usage.cacheRead ?? 0;
      state.usage.total += m.usage.totalTokens ?? 0;
    }
  }

  if (e.type === "tool_execution_end" && e.toolName === "submit") {
    const details = e.result?.details;
    if (details) state.submit = details as Record<string, unknown>;
  }
}

export interface DispatchOptions {
  ctx: BuildContext;
  /** Directory for full envelopes, relative to the project. */
  artifactDir?: string;
  /** Path to the pi executable. */
  piPath?: string;
  signal?: AbortSignal;
  onProgress?: (turns: number) => void;
}

export async function dispatch(
  agent: AgentDefinition,
  task: string,
  opts: DispatchOptions,
): Promise<RunResult> {
  const plan = buildSpawnPlan(agent, task, opts.ctx);
  const artifactDir = opts.artifactDir ?? join(process.cwd(), ".pi-subagent-runs");
  const artifact = join(artifactDir, `${opts.ctx.runId}-${agent.name}.json`);

  const state: StreamState = { turns: 0, submit: null, usage: emptyUsage(), stderr: [] };
  let failure: RunResult["failure"];

  const child = spawn(opts.piPath ?? "pi", plan.args, {
    cwd: opts.ctx.agentDir === "" ? process.cwd() : process.cwd(),
    env: { ...process.env, ...plan.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stop = (why: NonNullable<RunResult["failure"]>) => {
    if (failure) return;
    failure = why;
    child.kill("SIGTERM");
    // A child that ignores SIGTERM must not hold the orchestrator hostage.
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
  };

  const timer = setTimeout(() => stop("timeout"), agent.timeoutMs);
  const onAbort = () => stop("aborted");
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let buffer = "";
  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;

      consume(line, state);
      opts.onProgress?.(state.turns);

      // Checked after every event, not at the end: the point of a ceiling is
      // to stop the spend, and a turn already taken cannot be refunded.
      if (state.turns >= agent.maxTurns && !state.submit) stop("max_turns");
    }
  });

  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (c: string) => {
    state.stderr.push(c);
    if (state.stderr.length > 200) state.stderr.shift();
  });

  const code = await new Promise<number | null>((resolve) => {
    child.on("error", () => {
      failure ??= "spawn_error";
      resolve(null);
    });
    child.on("close", (c) => resolve(c));
  });

  clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onAbort);
  if (buffer.trim()) consume(buffer, state);

  const envelope = state.submit;
  if (!envelope && !failure) failure = code === 0 ? "no_submit" : "spawn_error";

  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    artifact,
    JSON.stringify(
      {
        runId: opts.ctx.runId,
        role: agent.name,
        model: agent.model,
        task,
        turns: state.turns,
        usage: state.usage,
        injectedTokens: plan.estimatedInputTokens,
        exitCode: code,
        failure: failure ?? null,
        envelope,
        stderr: failure ? state.stderr.join("").slice(-4000) : undefined,
      },
      null,
      2,
    ),
    "utf-8",
  );

  if (!envelope) {
    return {
      role: agent.name,
      status: "failed",
      summary: failureSummary(agent, failure!, state),
      next: "orchestrator",
      artifact,
      turns: state.turns,
      usage: state.usage,
      failure,
    };
  }

  return {
    role: agent.name,
    status: (envelope.status as RunResult["status"]) ?? "ok",
    summary: String(envelope.summary ?? "").trim() || "(empty summary)",
    next: String(envelope.next ?? "orchestrator"),
    artifact,
    turns: state.turns,
    usage: state.usage,
    failure,
  };
}

/** A failure the orchestrator can act on, not a stack trace it has to parse. */
function failureSummary(
  agent: AgentDefinition,
  failure: NonNullable<RunResult["failure"]>,
  state: StreamState,
): string {
  switch (failure) {
    case "max_turns":
      return `${agent.name} hit its ${agent.maxTurns}-turn ceiling without calling submit. The task is likely too broad for one delegation, or the scope was ambiguous.`;
    case "timeout":
      return `${agent.name} exceeded ${Math.round(agent.timeoutMs / 1000)}s after ${state.turns} turn(s).`;
    case "no_submit":
      return `${agent.name} exited cleanly after ${state.turns} turn(s) without calling submit. Its answer, if any, is in the artifact and was not validated.`;
    case "aborted":
      return `${agent.name} was aborted after ${state.turns} turn(s).`;
    case "spawn_error":
      return `${agent.name} failed to run. Last stderr: ${state.stderr.join("").slice(-300).trim()}`;
  }
}
