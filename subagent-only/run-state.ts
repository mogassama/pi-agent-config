/**
 * Subagent run state, published for the footer.
 *
 * The channel is `ctx.ui.setStatus("subagent", <json>)`, read back by the
 * footer through `footerData.getExtensionStatuses()`. That is the documented
 * path for one extension to surface state to another, and it survives however
 * pi chooses to isolate extension modules — a shared import would not.
 *
 * The payload is JSON because both ends are ours. Nothing else reads it.
 */

export type RoleName = "worker" | "reviewer" | "scout" | "advisor";

/**
 * What a delegation ended as, in the only three classes the display needs.
 *
 * `dispatch` knows which it is and says so, because inferring it from a string
 * was already wrong: the rank list held six failure names and `RunResult`
 * declares eight, so `timeout` and `aborted` fell through as ordinary verdicts
 * and a batch containing one displayed as a success — the exact symptom the
 * batch accounting exists to prevent. A closed union cannot silently gain a
 * ninth member the way a list of strings can.
 */
export type OutcomeKind = "error" | "blocked" | "verdict";

export interface Outcome {
  kind: OutcomeKind;
  /** What to show: a failure name, a verdict, or a status. */
  label: string;
}

const KIND_RANK: Record<OutcomeKind, number> = { error: 0, blocked: 1, verdict: 2 };

/** The worse of two outcomes; ties keep the first, so the order of ends does not matter. */
export function worseOutcome(a: Outcome | undefined, b: Outcome): Outcome {
  if (a === undefined) return b;
  return KIND_RANK[a.kind] <= KIND_RANK[b.kind] ? a : b;
}

export interface RoleState {
  /** Runs completed this session. */
  runs: number;
  /** Cumulative tokens across those runs, all kinds. */
  tokens: number;
  /** Cumulative cache reads. Zero on providers that do not report caching. */
  cacheRead: number;
  /** Estimated cumulative cost, USD. Zero for subscription providers. */
  cost: number;
  /** Whether the provider bills per token. Drives ∅ vs a figure. */
  billed: boolean;
  /** Model that actually answered last — may differ from the declared one after a fallback. */
  lastModel?: string;
  /** Verdict or status of the last completed run. */
  lastOutcome?: string;
  /**
   * Set while at least one run of this role is in flight.
   *
   * `active` counts the children, because a scout fan-out starts up to four at
   * once and the slot used to hold one. Each `markStart` overwrote the previous
   * one, so the footer named whichever child happened to start last, and the
   * *first* `markEnd` cleared the slot while three were still working. Measured
   * on a simulated fan-out before the path had ever run for real.
   *
   * `turns` is the highest any child has reached, not their sum: what the
   * number is watched for is proximity to `maxTurns`, and a sum would cross the
   * ceiling with every child still far from it.
   */
  running?: {
    turns: number;
    maxTurns: number;
    startedAt: number;
    /** Model → how many children are on it. Four scouts can straddle a fallback. */
    models: Record<string, number>;
    active: number;
  };
  /**
   * Outcomes of the delegations that have finished in the current batch. Kept
   * until the last one ends, so `lastOutcome` can be the worst of them rather
   * than whichever finished last — a fan-out where one child hits its ceiling
   * and three succeed used to display as a success.
   *
   * One entry per *delegation*, not per attempt. `dispatch` may run a child
   * twice — a fallback model after a provider error, one retry after an empty
   * turn — and only its final result belongs here. Recording attempts turned
   * the first defect inside out: a provider error recovered by a fallback
   * survived to the end of the batch and displayed as a failure although every
   * delegation had succeeded.
   */
  pending?: Outcome[];
}

export type SubagentSnapshot = Partial<Record<RoleName, RoleState>>;

export const STATUS_KEY = "subagent";

const state: SubagentSnapshot = {};

function get(role: RoleName): RoleState {
  return (state[role] ??= { runs: 0, tokens: 0, cacheRead: 0, cost: 0, billed: false });
}

/**
 * Providers that do not bill per token.
 *
 * Inverted deliberately: a provider absent from this list is assumed billed.
 * The opposite default is how a subscription figure of 5 $/M got quoted as
 * real for two days — an unknown provider should look expensive, not free.
 */
const SUBSCRIPTION_PROVIDERS = new Set(["openai-codex"]);

export function isBilled(model: string): boolean {
  const provider = model.includes("/") ? model.split("/")[0] : "";
  return !SUBSCRIPTION_PROVIDERS.has(provider);
}

export function markStart(role: RoleName, model: string, maxTurns: number): void {
  const s = get(role);
  if (s.running) {
    // A sibling is already running: join it rather than replace it. The
    // earliest start is kept, since that is what an elapsed-time display means.
    s.running.active += 1;
    s.running.maxTurns = Math.max(s.running.maxTurns, maxTurns);
    s.running.models[model] = (s.running.models[model] ?? 0) + 1;
  } else {
    s.running = { turns: 0, maxTurns, startedAt: Date.now(), models: { [model]: 1 }, active: 1 };
    s.pending = [];
  }
  s.lastModel = model;
}

/** The model a child moved to after a fallback, while its siblings keep theirs. */
export function markModel(role: RoleName, from: string, to: string): void {
  const r = get(role).running;
  if (!r) return;
  const left = (r.models[from] ?? 1) - 1;
  if (left > 0) r.models[from] = left;
  else delete r.models[from];
  r.models[to] = (r.models[to] ?? 0) + 1;
  get(role).lastModel = to;
}

export function markProgress(role: RoleName, turns: number): void {
  const r = get(role).running;
  // The highest of the siblings, never the sum — see `running` above.
  if (r) r.turns = Math.max(r.turns, turns);
}

/**
 * Tokens and cost of one *attempt*, whether or not it becomes the delegation.
 *
 * The lifecycle counts delegations and the accounting counts attempts, and the
 * two must not share a function: a child that fails on its primary model and
 * succeeds on a fallback is one delegation and two attempts. Both were charged
 * through `markEnd` until the split, which made `runs` five for four scouts and
 * left the failed attempt's outcome in the batch.
 *
 * Charged against the model that actually ran, not against a flag set by
 * whichever start happened to be last.
 */
export function recordAttempt(
  role: RoleName,
  model: string,
  tokens: number,
  cacheRead: number,
  cost: number,
): void {
  const s = get(role);
  s.tokens += tokens;
  s.cacheRead += cacheRead;
  s.cost += isBilled(model) ? cost : 0;
  s.billed = s.billed || isBilled(model);
  s.lastModel = model;
}

/**
 * What a finished delegation counts as, from the result the caller receives.
 *
 * Lives here rather than inside `dispatch` so a test can call it: the version
 * inlined in the dispatcher classed a submitted `status: "failed"` as a verdict,
 * so `ok` won the tie and a batch holding one displayed as a success. That is
 * the `timeout` defect again, narrower — and it was invisible because no test
 * could reach the expression.
 */
export function outcomeOf(r: {
  failure?: string;
  status: "ok" | "blocked" | "failed";
  verdict?: string;
}): Outcome {
  if (r.failure) return { kind: "error", label: r.failure };
  if (r.status === "failed") return { kind: "error", label: "failed" };
  if (r.status === "blocked") return { kind: "blocked", label: r.verdict ?? "blocked" };
  return { kind: "verdict", label: r.verdict ?? r.status };
}

/** One delegation has finished, whatever it took. Called by `dispatch`, never by an attempt. */
export function markEnd(role: RoleName, model: string, outcome: Outcome): void {
  const s = get(role);
  s.runs += 1;
  s.lastModel = model;

  // The totals were already right — they accumulate on every end. What was
  // wrong is everything about *this batch*: the slot cleared on the first
  // child, and the outcome was whichever finished last.
  (s.pending ??= []).push(outcome);
  if (s.running && s.running.active > 1) {
    s.running.active -= 1;
    const left = (s.running.models[model] ?? 1) - 1;
    if (left > 0) s.running.models[model] = left;
    else delete s.running.models[model];
    return;
  }
  s.running = undefined;
  s.lastOutcome = (s.pending.reduce<Outcome | undefined>(worseOutcome, undefined) ?? outcome).label;
  s.pending = undefined;
}

export function snapshot(): SubagentSnapshot {
  return state;
}

export function serialize(): string {
  return JSON.stringify(state);
}

export function parse(raw: string | undefined): SubagentSnapshot {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SubagentSnapshot;
  } catch {
    return {};
  }
}
