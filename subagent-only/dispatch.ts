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

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition } from "./agents.js";
import { buildSpawnPlan, type BuildContext } from "./spawn-args.js";
import { markStart, markProgress, markEnd, type RoleName } from "./run-state.js";

export interface RunResult {
  role: string;
  status: "ok" | "blocked" | "failed";
  summary: string;
  next: string;
  /**
   * The role's own outcome, when it has one, and the two counts that decide
   * whether the artefact is worth opening.
   *
   * `status` answers "did the delegation complete", and it is `ok` on every run
   * that reached submit — including a review that rejects the change. Measured
   * on run 3ed33e: four of seven reviews returned `needs_rework` and all four
   * reached the orchestrator as `[reviewer: ok, next=done]`. The verdict was
   * computed one line above, for the footer, and never left this file.
   */
  verdict?: string;
  findings?: number;
  outOfScope?: number;
  /**
   * Paths the delegation says it wrote.
   *
   * Two consumers: the diff handed to the next review, and the loop guard's
   * notion of a material change. A worker that returns an empty list has run
   * without altering the tree, which resets the read-only streak today and lets
   * a review of unchanged code through.
   */
  changedFiles?: string[];
  /**
   * True when `changedFiles` was read from the working tree because no envelope
   * came back. The paths are real; nothing about them has been validated.
   */
  fromTree?: boolean;
  /** Where the full envelope was written. The orchestrator reads it only if it needs to. */
  artifact: string;
  turns: number;
  usage: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number };
  /** Reviewer-mode skills that carried no severity table. */
  withoutDelta: string[];
  /** Set when the run ended on something other than a submit call. */
  failure?: "max_turns" | "timeout" | "no_submit" | "spawn_error" | "aborted" | "provider_error";
  /** Which model actually answered. Differs from agent.model when a fallback took over. */
  modelUsed: string;
}

interface StreamState {
  turns: number;
  submit: Record<string, unknown> | null;
  usage: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number };
  stderr: string[];
  /**
   * Provider errors arrive in-band, not on stderr and not as a non-zero exit.
   * A rate-limited claude-bridge answers "Credit balance is too low" as
   * assistant text with stopReason "error", the turn closes normally and the
   * process exits 0. Read without this, the run looks like a model that simply
   * declined to call submit.
   */
  providerError: string | null;
  /**
   * The last thing the child said, kept so a ceiling does not return nothing.
   *
   * Measured on run `ac451a`: a scout hit its turn ceiling after 112,683 tokens
   * and the orchestrator received one failure line and `envelope: null`. The
   * prompts now ask each role to converge early, but a prompt is a request; a
   * child that ignores it should still leave the orchestrator something to act
   * on rather than a bill.
   */
  lastText: string;
}

/**
 * Every billed field, including the two that were missing.
 *
 * `reasoning` is billed at the output rate and reported separately by pi;
 * `cacheWrite` is billed at 1.25x the input rate. Omitting them understated a
 * measured delegation by a factor of 4 against the provider's own statement.
 *
 * These figures remain an estimate. The bill is what the provider console says
 * — never what the agent reports.
 */
function emptyUsage() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
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
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      const said = m.content
        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
        .map((b: any) => String(b.text).trim())
        .filter(Boolean)
        .join("\n");
      if (said) state.lastText = said;
    }

    if (m?.role === "assistant" && m.usage) {
      state.usage.input += m.usage.input ?? 0;
      state.usage.output += m.usage.output ?? 0;
      state.usage.reasoning += m.usage.reasoning ?? 0;
      state.usage.cacheRead += m.usage.cacheRead ?? 0;
      state.usage.cacheWrite += m.usage.cacheWrite ?? 0;
      state.usage.total += m.usage.totalTokens ?? 0;
    }
  }

  if (e.type === "message_end" || e.type === "turn_end") {
    const m = e.message ?? e;
    if (m?.stopReason === "error" && m.errorMessage) state.providerError = String(m.errorMessage);
  }

  if (e.type === "tool_execution_end" && e.toolName === "submit") {
    const details = e.result?.details;
    if (details) state.submit = details as Record<string, unknown>;
  }
}

export interface DispatchOptions {
  ctx: BuildContext;
  /**
   * Distinguishes artefacts of successive calls to the same role.
   *
   * The runId stays per session, not per call: the child's `--session-id`
   * derives from it, and a worker called twice in one task keeps its provider
   * cache affinity across both. But an artefact filename built from the runId
   * alone made each call overwrite the previous one — measured on a real run,
   * thirteen delegations left two files on disk, and the other eleven were only
   * recoverable from the orchestrator's own session log.
   */
  seq?: number;
  /** Directory for full envelopes, relative to the project. */
  artifactDir?: string;
  /** Path to the pi executable. */
  piPath?: string;
  signal?: AbortSignal;
  onProgress?: (turns: number) => void;
}

/**
 * Run once with a given model. `dispatch` wraps this with the fallback chain.
 */
async function runOnce(
  agent: AgentDefinition,
  model: string,
  task: string,
  opts: DispatchOptions,
): Promise<RunResult> {
  const plan = buildSpawnPlan({ ...agent, model }, task, opts.ctx);
  const artifactDir = opts.artifactDir ?? join(process.cwd(), ".pi-subagent-runs");
  const seq = String(opts.seq ?? 0).padStart(2, "0");
  const artifact = join(artifactDir, `${opts.ctx.runId}-${seq}-${agent.name}.json`);

  // Only for a role that can mutate: a read-only delegation cannot have changed
  // anything, and a git call per scout is a cost for nothing.
  const mutates = agent.tools.includes("edit") || agent.tools.includes("write");
  const before = mutates ? treeState(process.cwd()) : new Set<string>();

  const state: StreamState = {
    turns: 0,
    submit: null,
    usage: emptyUsage(),
    stderr: [],
    providerError: null,
    lastText: "",
  };

  // The child's raw stream, kept beside the artefact.
  //
  // Without it only the totals come back, and a run that costs 499k tokens is
  // indistinguishable from one that costs 20k ten times over — which is
  // exactly the question that decides a role's tool set and model. Local file,
  // gitignored, cheap.
  const transcript: string[] = [];
  markStart(agent.name as RoleName, model, agent.maxTurns);
  let failure: RunResult["failure"];

  const child = spawn(opts.piPath ?? "pi", plan.args, {
    cwd: opts.ctx.agentDir === "" ? process.cwd() : process.cwd(),
    env: { ...process.env, ...plan.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stop = (why: NonNullable<RunResult["failure"]>) => {
    if (failure) return;
    // An envelope already in hand means the run succeeded, whatever the clock
    // says. Measured: a reviewer called submit and the 300s timer fired during
    // the child's own shutdown, turning a valid result into a reported failure.
    if (state.submit && why === "timeout") return;
    failure = why;
    child.kill("SIGTERM");
    // A child that ignores SIGTERM must not hold the orchestrator hostage.
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
  };

  // Wall clock, not idle time: a role that is still producing tokens at the
  // deadline is stopped. maxTurns is the cheaper ceiling; this one is the
  // backstop against a child that never returns at all.
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

      transcript.push(line);
      consume(line, state);
      markProgress(agent.name as RoleName, state.turns);
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
  // A validated envelope outranks every other signal. Whatever went wrong on
  // the way, the role produced the artifact it was asked for.
  if (envelope) failure = undefined;
  else if (!failure) {
    failure = state.providerError ? "provider_error" : code === 0 ? "no_submit" : "spawn_error";
  }

  // No envelope from a role that writes: ask the tree what it did.
  const salvaged =
    !envelope && mutates
      ? [...treeState(process.cwd())].filter((p) => !before.has(p)).sort()
      : [];

  mkdirSync(artifactDir, { recursive: true });
  if (agent.keepTranscript !== false) {
    writeFileSync(artifact.replace(/\.json$/, ".jsonl"), transcript.join("\n") + "\n", "utf-8");
  }
  writeFileSync(
    artifact,
    JSON.stringify(
      {
        runId: opts.ctx.runId,
        role: agent.name,
        model,
        task,
        turns: state.turns,
        usage: state.usage,
        injectedTokens: plan.estimatedInputTokens,
        exitCode: code,
        failure: failure ?? null,
        providerError: state.providerError,
        // Rebuilt here rather than demanded of the model: the split is useful
        // to read on disk and was a liability to ask for at the tool boundary.
        // `next` is derived, not submitted, and is written in so the artefact
        // shape does not change when the field leaves the schema.
        envelope: envelope ? splitEnvelope({ ...envelope, next: deriveNext(envelope) }) : null,
        stderr: failure ? state.stderr.join("").slice(-4000) : undefined,
      },
      null,
      2,
    ),
    "utf-8",
  );

  // Flat envelope now: verdict sits beside status, not under a payload key.
  const outcome = envelope
    ? String(envelope.verdict ?? envelope.status ?? "ok")
    : (failure ?? "failed");
  markEnd(
    agent.name as RoleName,
    model,
    state.usage.total,
    state.usage.cacheRead,
    estimateCost(model, state.usage),
    outcome,
  );

  if (!envelope) {
    return {
      modelUsed: model,
      withoutDelta: plan.withoutDelta,
      role: agent.name,
      status: "failed",
      summary:
        failureSummary(agent, failure!, state) +
        (salvaged.length
          ? ` Read from the working tree, not from the child, and not validated by anything: ${salvaged.join(", ")}.`
          : ""),
      next: "orchestrator",
      artifact,
      turns: state.turns,
      usage: state.usage,
      changedFiles: salvaged.length ? salvaged : undefined,
      fromTree: salvaged.length > 0 || undefined,
      failure,
    };
  }

  return {
    modelUsed: model,
    withoutDelta: plan.withoutDelta,
    role: agent.name,
    status: (envelope.status as RunResult["status"]) ?? "ok",
    summary: String(envelope.summary ?? "").trim() || "(empty summary)",
    next: deriveNext(envelope),
    verdict: typeof envelope.verdict === "string" ? envelope.verdict : undefined,
    findings: Array.isArray(envelope.findings) ? envelope.findings.length : undefined,
    outOfScope: Array.isArray(envelope.out_of_scope) ? envelope.out_of_scope.length : undefined,
    changedFiles: Array.isArray(envelope.changed_files)
      ? envelope.changed_files.filter((f: unknown): f is string => typeof f === "string")
      : undefined,
    artifact,
    turns: state.turns,
    usage: state.usage,
    failure,
  };
}

/**
 * What the tree says changed, when the child could not say it itself.
 *
 * Measured on the Balance Agee run: `32-worker` hit its twenty-turn ceiling
 * after 946,918 tokens on the deliverable that split `io.py` into three
 * modules. The three modules were on disk at the end of the run. The
 * orchestrator never learnt it: no envelope, so `changed_files` came back empty,
 * so the next review was handed no diff at all. Nothing was lost on disk and
 * everything was lost as information.
 *
 * Snapshotted before and after rather than read once, because nothing is
 * committed during a run: a single `git status` would return every change since
 * the bundle, not this delegation's. The list is reported as coming from the
 * tree, never mixed with what an envelope claims — a child that did not submit
 * did not validate anything, and the difference has to stay visible.
 */
function treeState(cwd: string): Set<string> {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return new Set(
      out
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/**
 * What runs next, decided here rather than asked of the child.
 *
 * Measured on run 3ed33e: three of the four reviews that returned
 * `needs_rework` also returned `next: "done"`. The field asked a role that has
 * just been told it holds no orchestration authority — "A subagent has no
 * channel to the operator", AGENTS.md — to decide what runs next, and it was
 * wrong three times out of four. Every role returned `done` otherwise, so the
 * field carried no information it did not already get wrong. The verdict
 * carries the answer; a `blocked` status carries the rest.
 */
function deriveNext(envelope: Record<string, unknown>): string {
  if (envelope.status !== "ok") return "orchestrator";
  if (typeof envelope.verdict === "string") {
    return envelope.verdict === "approved" ? "done" : "orchestrator";
  }
  return "done";
}

/** A failure the orchestrator can act on, not a stack trace it has to parse. */
function failureSummary(
  agent: AgentDefinition,
  failure: NonNullable<RunResult["failure"]>,
  state: StreamState,
): string {
  // Whatever the child last said, when it said anything. Unvalidated and
  // unstructured, and still the difference between a failure the orchestrator
  // can act on and 112k tokens that returned a single line.
  const salvage = state.lastText ? ` Last thing it said: ${state.lastText.slice(-600).trim()}` : "";

  switch (failure) {
    case "max_turns":
      return `${agent.name} hit its ${agent.maxTurns}-turn ceiling without calling submit. The task is likely too broad for one delegation, or the scope was ambiguous.${salvage}`;
    case "timeout":
      return `${agent.name} exceeded ${Math.round(agent.timeoutMs / 1000)}s after ${state.turns} turn(s).${salvage}`;
    case "no_submit":
      return `${agent.name} exited cleanly after ${state.turns} turn(s) without calling submit. Its answer, if any, is in the artifact and was not validated.${salvage}`;
    case "aborted":
      return `${agent.name} was aborted after ${state.turns} turn(s).`;
    case "provider_error":
      return `${agent.name}: the provider refused. ${state.providerError}`;
    case "spawn_error":
      return `${agent.name} failed to run. Last stderr: ${state.stderr.join("").slice(-300).trim()}`;
  }
}

/**
 * Failures worth retrying on another model.
 *
 * Not `no_submit` or `max_turns`: those are the model doing its job badly, and
 * paying twice for the same bad answer is worse than reporting it once. Only a
 * refusal to answer at all — an exhausted subscription, an unavailable model —
 * justifies the next one in the chain.
 */
const RETRYABLE = new Set<RunResult["failure"]>(["provider_error", "spawn_error"]);

export async function dispatch(
  agent: AgentDefinition,
  task: string,
  opts: DispatchOptions,
): Promise<RunResult> {
  const chain = [agent.model, ...agent.fallbackModels];
  let last: RunResult | null = null;

  // A read-only role may write nothing, so running it twice cannot corrupt
  // anything — and one class of failure is worth exactly one retry.
  const mutates = agent.tools.includes("edit") || agent.tools.includes("write");

  for (const model of chain) {
    let result = await runOnce(agent, model, task, opts);

    /*
     * One retry on `no_submit`, for a read-only role only.
     *
     * Measured on `b9baad-18-scout`: nine turns of twelve, 90,240 tokens, and
     * the last message carried a `thinking` block and nothing else — no text,
     * no tool call. Then `agent_end`, a normal termination. It did not hit a
     * ceiling, did not time out, and the provider did not refuse: the model
     * produced a turn of pure reasoning and stopped. No guard covers that, and
     * the whole delegation was lost.
     *
     * It is stochastic, so a fresh process on the same input is worth trying,
     * and it is bounded at one so a role that cannot answer does not answer
     * twice as expensively. Never for a writer: re-running one that stopped
     * mid-edit would redo edits against a tree it already changed.
     */
    if (result.failure === "no_submit" && !mutates && !opts.signal?.aborted) {
      const retry = await runOnce(agent, model, task, opts);
      if (!retry.failure) {
        return { ...retry, summary: `${retry.summary} (retried after an empty first attempt)` };
      }
      result = retry;
    }

    if (!result.failure || !RETRYABLE.has(result.failure)) return result;
    last = result;
    if (opts.signal?.aborted) break;
  }

  // Every model in the chain refused. Say so, with the last reason, rather
  // than reporting the last attempt as if it were the only one.
  return {
    ...last!,
    summary:
      chain.length > 1
        ? `${agent.name}: all ${chain.length} models refused. Last — ${last!.summary}`
        : last!.summary,
  };
}

/**
 * Rough USD estimate, for the footer only.
 *
 * Deliberately approximate and displayed with a tilde. The bill is what the
 * provider console says: a measured delegation came out 4x above what pi's
 * reported usage implied, and the gap was never fully reconciled. This figure
 * is here to show cost accruing per role, not to be trusted to the cent.
 */
/**
 * Per model, not per provider: Flash and Pro differ by an order of magnitude,
 * and a provider-level rate reported a Flash scout as costing more than a
 * Sonnet review. Matched longest-prefix first.
 */
/**
 * Per-model rates, longest prefix wins.
 *
 * `cacheWrite` and `cacheRead` are multipliers of the input rate and default to
 * Anthropic's 1.25 and 0.1. They are not universal: DeepSeek writes its prefix
 * cache for free and reads it at ~1/30 of input, so charging it the Anthropic
 * multipliers overstates a scout run several-fold — the same class of mistake
 * as the per-provider table that once reported a Flash scout as cheaper than a
 * Sonnet review.
 */
const RATES: Array<[string, { in: number; out: number; cacheWrite?: number; cacheRead?: number }]> = [
  ["anthropic/claude-opus", { in: 5, out: 25 }],
  ["anthropic/claude-haiku", { in: 0.8, out: 4 }],
  ["anthropic/claude-sonnet", { in: 2, out: 10 }],
  // "Flash" is a family name, not a price band: 3.5 Flash lists at 1.50/9.00,
  // within a quarter of 3.1 Pro. The cheap tier is Flash-Lite. Getting this
  // wrong reported a scout run as costing a third of a Sonnet review when it
  // cost several times more.
  ["google/gemini-2.5-flash-lite", { in: 0.1, out: 0.4 }],
  ["google/gemini-3.1-flash-lite", { in: 0.25, out: 1.5 }],
  ["google/gemini-3.5-flash-lite", { in: 0.3, out: 2.5 }],
  ["google/gemini-3.6-flash", { in: 1.5, out: 7.5 }],
  ["google/gemini-3.5-flash", { in: 1.5, out: 9 }],
  ["google/gemini-3.1-pro", { in: 2, out: 12 }],
  ["google/gemini", { in: 2, out: 12 }],
  // Peak rate, deliberately. The published tariff is peak/off-peak since
  // 2026-08-16, and the peak window (01:00-04:00 and 06:00-10:00 UTC) covers
  // most of a Paris working morning. A cost table that reports less than the
  // bill is worse than one that reports more, so this encodes the ceiling:
  // 0.44/1.32 peak, against 0.22/0.66 off-peak. Cache write is free and cache
  // read is 0.007/M, i.e. 0.016 of the peak input rate.
  ["deepseek/deepseek-v4-flash", { in: 0.44, out: 1.32, cacheWrite: 0, cacheRead: 0.016 }],
  ["deepseek/deepseek-v4-pro", { in: 0.88, out: 2.64, cacheWrite: 0, cacheRead: 0.016 }],
  ["anthropic/", { in: 2, out: 10 }],
];

function estimateCost(
  model: string,
  u: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number },
): number {
  const r = RATES.filter(([prefix]) => model.startsWith(prefix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0]?.[1];
  if (!r) return 0;
  const M = 1_000_000;
  return (
    (u.input * r.in) / M +
    (u.cacheWrite * r.in * (r.cacheWrite ?? 1.25)) / M +
    (u.cacheRead * r.in * (r.cacheRead ?? 0.1)) / M +
    // `reasoning` is a subset of `output`, not a line of its own: the provider
    // counts thinking tokens inside output_tokens. Adding them charged the same
    // tokens twice. Measured on run 8c88c5, four reviews: output 18,219 of which
    // reasoning 13,986, leaving 4,233 tokens of text — 1,058 per review, which
    // matches envelopes of roughly 750. Were the two disjoint, each review would
    // have emitted 4,555 tokens of text, which no envelope in the run comes near.
    // The sum estimated 0.582 $ against a real bill of 0.40 $; output alone gives
    // 0.442 $. It stays in the artefact and in subagent-trace — how much of the
    // output was thinking is worth knowing — but it never enters the cost.
    (u.output * r.out) / M
  );
}

/** Envelope fields every role shares; everything else is that role's payload. */
const ENVELOPE_KEYS = new Set(["role", "status", "summary", "next"]);

function splitEnvelope(flat: Record<string, unknown>): Record<string, unknown> {
  const envelope: Record<string, unknown> = {};
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    (ENVELOPE_KEYS.has(k) ? envelope : payload)[k] = v;
  }
  return { ...envelope, payload };
}
