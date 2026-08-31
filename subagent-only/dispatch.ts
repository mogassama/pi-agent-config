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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AgentDefinition } from "./agents.js";
import { runAttempts } from "./attempts.js";
import { envelopeCounts } from "./counts.js";
import { changedBetween, treeState } from "./tree.js";
import { buildSpawnPlan, type BuildContext } from "./spawn-args.js";
import {
  batchLifecycle,
  markProgress,
  recordAttempt,
  type RoleName,
} from "./run-state.js";

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
   * How many risks the review left open.
   *
   * The counts above exist so the artefact is opened when there is something in
   * it. `open_risks` was not among them, and run 12 measured the consequence:
   * sixteen reviews wrote twenty-seven of them, several naming a term the
   * reviewer could not search for — and the orchestrator, handed
   * `[reviewer: approved, 2 findings]`, had no signal that anything was
   * waiting. One of those questions reached a scout. A field that decides an
   * action has to be visible to whoever takes it.
   */
  openRisks?: number;
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
   * The advisor's recommendation, and only the advisor's.
   *
   * The contract everywhere else is that one field crosses — `summary` — and the
   * envelope waits on disk. For a reviewer that holds: `[reviewer: needs_rework,
   * 3 findings]` is enough to know the artefact is worth opening. For an advisor
   * the payload *is* the product, so hiding the one sentence behind a second
   * read is the wrong asymmetry: it makes the orchestrator pay a turn to learn
   * what it delegated for. `concerns` stays on disk; this is one short field on
   * a role invoked rarely.
   */
  recommendation?: string;
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
  const before = mutates ? treeState(process.cwd()) : new Map<string, string>();

  /*
   * When the delegation started, so the artefact can say how long it took.
   *
   * Eight runs went by without a single duration being recorded, and the one
   * time it was needed it had to be reconstructed by subtracting one
   * delegation's start from the next one's — a method that only works because
   * everything runs in sequence, and that would therefore stop being valid at
   * exactly the moment it mattered most. It also measured the wrong thing:
   * spawn-to-spawn contains the child, plus the orchestrator's own turn, plus
   * any pause. dispatch knows the real boundaries, so it writes them.
   *
   * What that reconstruction did show, once: the scout is 12% of wall time
   * across eighteen delegations, on a role that took three batches to tune.
   */
  const startedAt = Date.now();

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
  // The batch slot belongs to `dispatch`: it is the only place that knows
  // whether this attempt is the delegation's last. A fallback runs `runOnce`
  // again, and an attempt that opens and closes the slot made four scouts count
  // as five delegations and left a recovered provider error in the batch.
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
  const salvaged = !envelope && mutates ? changedBetween(before, treeState(process.cwd())) : [];

  // Before any persistence. The tokens are spent whatever happens next, and a
  // disk error writing the artefact used to erase a consumption that had
  // already occurred — the lifecycle closed by the catch above, the accounting
  // silently not.
  recordAttempt(
    agent.name as RoleName,
    model,
    state.usage.total,
    state.usage.cacheRead,
    estimateCost(model, state.usage),
  );

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
        durationMs: Date.now() - startedAt,
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
        /*
         * What is left of a run that never called `submit`.
         *
         * `envelope: null` is correct and stays correct — nothing here was
         * validated against a schema and nothing downstream may treat it as if
         * it were. But null was also all there was, so a delegation that cost
         * 112,683 tokens left an artefact with no content whatsoever, and
         * `subagent-trace` had nothing to read but a failure string.
         *
         * Deliberately a separate key with an unambiguous name. The salvage is
         * the child's last assistant text and, for a writer, the paths that
         * appeared in the tree while it ran — attributed to the tree, not to
         * the child, because nobody asked the child what it had done.
         *
         * Not a warning injected mid-run: the child is spawned with stdin
         * ignored, so there is no channel to tell it that its ceiling is near.
         * Converging early stays a request made in the role prompt. This is
         * what happens when the request is not honoured.
         */
        degraded: envelope
          ? null
          : {
              validated: false,
              reason: failure ?? null,
              turns: state.turns,
              lastText: state.lastText || null,
              changedFilesFromTree: salvaged,
            },
        stderr: failure ? state.stderr.join("").slice(-4000) : undefined,
      },
      null,
      2,
    ),
    "utf-8",
  );

  // Flat envelope now: verdict sits beside status, not under a payload key.
  // Tokens and cost of this attempt, whether or not it becomes the delegation.

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
    recommendation:
      typeof envelope.recommendation === "string" ? envelope.recommendation : undefined,
    ...envelopeCounts(envelope),
    changedFiles: Array.isArray(envelope.changed_files)
      ? envelope.changed_files.filter((f: unknown): f is string => typeof f === "string")
      : undefined,
    artifact,
    turns: state.turns,
    usage: state.usage,
    failure,
  };
}


/*
 * There is no rule downgrading a verdict here, and there was one.
 *
 * It turned a `needs_rework` into an `approved` when every finding was LOW, to
 * stop a loop converging on cosmetics. Measured on run 48acec it fired twice and
 * saved two rework cycles — and the same run showed why it was wrong. A review
 * returned `approved` while carrying a MEDIUM/certain finding: six sections of
 * DESIGN.md moved to Implemented and the one this deliverable implements did
 * not. Real, exactly located, and not worth sending the deliverable back. The
 * reviewer had the context to see that; the severity label, attached to one
 * finding in isolation, did not.
 *
 * Which settles it in both directions. A severity grades a finding; a verdict
 * grades the diff. Overriding the verdict with the severity took authority away
 * from the reviewer where it was cautious and left it where it was lax — the
 * worst of the two arrangements. The loop reads the verdict, and nothing else.
 */


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
  // An advice is never `done`. Its payload carries a `recommendation`, and a
  // recommendation is an input to a decision the operator takes — the advisor
  // exists precisely because no rule covers the fork, so nothing downstream can
  // close on its output alone. Recognised by the payload rather than by the
  // role name, so a model variant of the advisor derives the same way.
  if (Array.isArray(envelope.concerns) || typeof envelope.recommendation === "string") {
    return "orchestrator";
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
  //
  // Still truncated at 600 characters, and deliberately: this string lands in
  // the orchestrator's context on every failure, where its job is to say
  // whether the artefact is worth opening. The untruncated text is in the
  // artefact under `degraded.lastText`, which costs nothing until read.
  const salvage = state.lastText
    ? ` Last thing it said: ${state.lastText.slice(-600).trim()} (full text in the artefact under \`degraded\`)`
    : "";

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

  /*
   * One delegation, however many attempts it takes.
   *
   * `runOnce` used to open and close the batch slot itself, so a child that
   * failed on its primary model and succeeded on a fallback counted twice:
   * `runs` came out five for four scouts, and the failed attempt's outcome
   * stayed in the batch, so four delegations that all succeeded displayed as a
   * failure. The slot is opened here, once, and closed once with the result the
   * caller actually gets. Attempts still pay for their tokens through
   * `recordAttempt` — they consumed them.
   */
  // A read-only role may write nothing, so running it twice cannot corrupt
  // anything — and one class of failure is worth exactly one retry.
  const mutates = agent.tools.includes("edit") || agent.tools.includes("write");

  const life = batchLifecycle(agent.name as RoleName, agent.model, agent.maxTurns);

  try {
    return await runAttempts<RunResult>({
      chain,
      mutates,
      retryable: RETRYABLE as ReadonlySet<string>,
      aborted: () => Boolean(opts.signal?.aborted),
      attempt: (model) => runOnce(agent, model, task, opts),
      onFallback: life.onFallback,
      finish: life.finish,
      exhausted: (last) => ({
        ...last,
        summary:
          chain.length > 1
            ? `${agent.name}: all ${chain.length} models refused. Last — ${last.summary}`
            : last.summary,
      }),
    });
  } catch (err) {
    /*
     * The slot must close even when nothing returns.
     *
     * `runOnce` writes its artefact and its transcript, and a disk error there
     * throws rather than becoming a `RunResult`. Without this the batch would
     * keep an open child forever: the footer would show the role working with no
     * process behind it, and `active` would never come back down. The error
     * still propagates — this only says why the slot closed. `abandon` is a
     * no-op if the delegation already finished, so it is safe unconditionally.
     */
    life.abandon(opts.signal?.aborted ? "aborted" : "internal_error");
    throw err;
  }
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
  ["anthropic/claude-opus", { in: 15, out: 75 }],
  ["anthropic/claude-haiku", { in: 0.8, out: 4 }],
  ["anthropic/claude-sonnet", { in: 2, out: 10 }],
  // "Flash" is a family name, not a price band: 3.5 Flash lists at 1.50/9.00,
  // within a quarter of 3.1 Pro. The cheap tier is Flash-Lite. Getting this
  // wrong reported a scout run as costing a third of a Sonnet review when it
  // cost several times more.
  ["google/gemini-2.5-flash-lite", { in: 0.1, out: 0.4 }],
  ["google/gemini-3.1-flash-lite", { in: 0.25, out: 1.5 }],
  ["google/gemini-3.5-flash-lite", { in: 0.3, out: 2.5 }],
  // 3.7 Flash, introductory rate through 31 December 2026 — 0.75 in and 3.75
  // out, doubling to 1.50 and 7.50 on 1 January 2027, which is worth knowing
  // before a role's budget is built on it. Cached input is published at 0.075,
  // exactly a tenth of input, so the default read multiplier is right.
  // `cacheWrite` stays at 1.25 and overstates: Google bills the first pass as
  // ordinary input and charges cache *storage* by the hour instead, which a
  // per-token table cannot express — that line has to be read off the console
  // and will never appear in the footer. Flash pricing is flat whatever the
  // prompt length, so there is no cliff of the kind Grok has at 200K.
  ["google/gemini-3.7-flash", { in: 0.75, out: 3.75 }],
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
  // Qwen-Max on pay-as-you-go.
  //
  // 3.8-max reached general availability on 3 August 2026 at a flat 2.00 in and
  // 6.00 out across the whole 1M context, with cached input at 0.25 — an eighth
  // of the input price rather than the tenth Model Studio applies generally, so
  // it is written here rather than defaulted. It was briefly a Token Plan
  // exclusive during the July preview, and `qwen3.8-max-preview` still is; the
  // GA id is the one without the suffix.
  //
  // `cacheWrite` stays at the default 1.25. Whether it is charged at all depends
  // on the provider using explicit or implicit caching, and implicit caching has
  // no creation charge. The whole difference between these two rides on that:
  // measured against run 48acec's average review, an explicit cache puts Qwen
  // within two per cent of Sonnet, an implicit one puts it eighty-four per cent
  // below. Overstating is the safe direction until the console says which.
  ["qwen-paygo/qwen3.8-max", { in: 2, out: 6, cacheRead: 0.125 }],
  ["qwen-paygo/qwen3.7-max", { in: 2.5, out: 7.5 }],
  ["qwen-paygo/qwen3-max", { in: 1.2, out: 6 }],
  ["qwen-paygo/qwen-max", { in: 1.6, out: 6.4 }],
  ["qwen-paygo/", { in: 2, out: 6 }],
  // Grok 4.6, from pi's own catalogue: 2.00 in, 6.00 out, cache read 0.50 — a
  // quarter of input rather than the usual tenth — and **cache write free**,
  // which the default 1.25 would have overstated by the whole first pass.
  //
  // pi's pricing table shows a single tier for all requests. xAI's own docs
  // describe a doubling past 200k prompt tokens, applied to every token in the
  // request rather than the excess. The two disagree; this encodes the flat
  // rate pi uses, and the console is the arbiter if an advisor ever quotes a
  // whole bundle into one call.
  ["xai/grok-4.6", { in: 2, out: 6, cacheWrite: 0, cacheRead: 0.25 }],
  ["xai/", { in: 2, out: 6, cacheWrite: 0, cacheRead: 0.25 }],
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
