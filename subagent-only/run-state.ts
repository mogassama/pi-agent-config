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
  running?: { turns: number; maxTurns: number; startedAt: number; model: string; active: number };
  /**
   * Outcomes of the children that have finished in the current batch. Kept
   * until the last one ends, so `lastOutcome` can be the worst of them rather
   * than whichever finished last — a fan-out where one child hits its ceiling
   * and three succeed used to display as a success.
   */
  pending?: string[];
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
  } else {
    s.running = { turns: 0, maxTurns, startedAt: Date.now(), model, active: 1 };
    s.pending = [];
  }
  s.lastModel = model;
  s.billed = isBilled(model);
}

export function markProgress(role: RoleName, turns: number): void {
  const r = get(role).running;
  // The highest of the siblings, never the sum — see `running` above.
  if (r) r.turns = Math.max(r.turns, turns);
}

/** Failure-shaped outcomes, worst first. Anything else is a verdict or a status. */
const OUTCOME_RANK = ["failed", "provider_error", "spawn_error", "max_turns", "no_submit", "blocked"];

function worseOutcome(a: string | undefined, b: string): string {
  if (a === undefined) return b;
  const ra = OUTCOME_RANK.indexOf(a);
  const rb = OUTCOME_RANK.indexOf(b);
  if (ra === -1) return rb === -1 ? b : b;
  if (rb === -1) return a;
  return ra <= rb ? a : b;
}

export function markEnd(
  role: RoleName,
  model: string,
  tokens: number,
  cacheRead: number,
  cost: number,
  outcome: string,
): void {
  const s = get(role);
  s.runs += 1;
  s.tokens += tokens;
  s.cacheRead += cacheRead;
  s.cost += s.billed ? cost : 0;
  s.lastModel = model;

  // The totals were already right — they accumulate on every end. What was
  // wrong is everything about *this batch*: the slot cleared on the first
  // child, and the outcome was whichever finished last.
  (s.pending ??= []).push(outcome);
  if (s.running && s.running.active > 1) {
    s.running.active -= 1;
    return;
  }
  s.running = undefined;
  s.lastOutcome = s.pending.reduce<string | undefined>(worseOutcome, undefined) ?? outcome;
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
