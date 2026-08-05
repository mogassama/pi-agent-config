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
  /** Set while a run is in flight. */
  running?: { turns: number; maxTurns: number; startedAt: number; model: string };
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
  s.running = { turns: 0, maxTurns, startedAt: Date.now(), model };
  s.lastModel = model;
  s.billed = isBilled(model);
}

export function markProgress(role: RoleName, turns: number): void {
  const r = get(role).running;
  if (r) r.turns = turns;
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
  s.running = undefined;
  s.runs += 1;
  s.tokens += tokens;
  s.cacheRead += cacheRead;
  s.cost += s.billed ? cost : 0;
  s.lastModel = model;
  s.lastOutcome = outcome;
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
