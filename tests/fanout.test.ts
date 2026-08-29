/**
 * The fan-out, on the two paths a real call would take.
 *
 * `find` accepts up to four questions and starts that many children at once.
 * The path had never executed: zero multi-question calls since it shipped, so
 * everything downstream of `Promise.all` was written and never exercised. Two
 * defects were found by simulation rather than by a run, and both are the same
 * shape — code that assumes one child where there can be four.
 *
 *   `details`     was built from `results[0]`. A four-scout call reported six
 *                 turns out of thirty-four, and `isError: false` with one child
 *                 dead at its ceiling. The text said `[scout: max_turns]` on
 *                 block four; the only structured field said it had succeeded.
 *
 *   `run-state`   held one `running` slot per role. Each `markStart` overwrote
 *                 the previous, so the footer named whichever child started
 *                 last, and the *first* `markEnd` cleared the slot while three
 *                 were still working. `lastOutcome` was whichever finished
 *                 last, so a fan-out with one dead child displayed as success.
 *
 * Both are reimplemented here from the source, in the same no-dependency style
 * as the rest of the suite. If either drifts, these stop describing the code.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// Copied from extensions/subagent/index.ts — the `details` assembly.
// ---------------------------------------------------------------------------

interface Child {
  role: string;
  modelUsed: string;
  status: "ok" | "blocked" | "failed";
  turns: number;
  artifact: string;
  usage: Record<string, number>;
  failure?: string;
}

function aggregate(results: Child[]) {
  const failures = results.flatMap((r) => (r.failure ? [r.failure] : []));
  const status = results.some((r) => r.status === "failed")
    ? "failed"
    : results.some((r) => r.status === "blocked")
      ? "blocked"
      : "ok";
  const usage = results.reduce<Record<string, number>>((acc, r) => {
    for (const [k, v] of Object.entries(r.usage ?? {})) {
      if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
    }
    return acc;
  }, {});
  return {
    model: [...new Set(results.map((r) => r.modelUsed))].join(", "),
    status,
    turns: results.reduce((n, r) => n + r.turns, 0),
    usage,
    artifact: results.map((r) => r.artifact).join(" "),
    failure: failures[0] ?? null,
    failures,
    children: results.map((r) => ({ model: r.modelUsed, status: r.status, turns: r.turns })),
    isError: status === "failed",
  };
}

const FLASH = "deepseek/deepseek-v4-flash";
const GEMINI = "google/gemini-3.1-flash-lite";

function child(n: number, over: Partial<Child> = {}): Child {
  return {
    role: "scout",
    modelUsed: FLASH,
    status: "ok",
    turns: 5,
    artifact: `.pi-subagent-runs/x-0${n}-scout.json`,
    usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 0, total: 600 },
    ...over,
  };
}

test("four successes: turns and usage are summed, not the first child's", () => {
  const d = aggregate([child(1), child(2, { turns: 7 }), child(3, { turns: 9 }), child(4, { turns: 12 })]);
  assert.equal(d.turns, 5 + 7 + 9 + 12);
  assert.equal(d.usage.total, 2400);
  assert.equal(d.usage.output, 800);
  assert.equal(d.status, "ok");
  assert.equal(d.isError, false);
});

test("one failure among four is not hidden by the first child's success", () => {
  const d = aggregate([
    child(1),
    child(2),
    child(3, { status: "failed", failure: "max_turns", turns: 12 }),
    child(4),
  ]);
  assert.equal(d.status, "failed");
  assert.equal(d.isError, true);
  assert.deepEqual(d.failures, ["max_turns"]);
});

test("a failure in first position does not hide the successes", () => {
  const d = aggregate([child(1, { status: "failed", failure: "spawn_error", turns: 0 }), child(2), child(3)]);
  assert.equal(d.status, "failed");
  assert.equal(d.turns, 10);
  assert.equal(d.children.filter((c) => c.status === "ok").length, 2);
});

test("two failures of different kinds are both reported", () => {
  const d = aggregate([
    child(1),
    child(2, { status: "failed", failure: "max_turns" }),
    child(3, { status: "failed", failure: "provider_error" }),
    child(4),
  ]);
  assert.deepEqual(d.failures, ["max_turns", "provider_error"]);
  // `failure` keeps one string for whoever reads a single value; `failures` is the truth.
  assert.equal(d.failure, "max_turns");
});

test("a fallback splits the models and both are named", () => {
  const d = aggregate([child(1), child(2, { modelUsed: GEMINI }), child(3)]);
  assert.equal(d.model, `${FLASH}, ${GEMINI}`);
  assert.equal(d.children[1].model, GEMINI);
});

test("all four artefacts are reachable, not just the first", () => {
  const d = aggregate([child(1), child(2), child(3), child(4)]);
  assert.equal(d.artifact.split(" ").length, 4);
});

test("blocked outranks ok and yields to failed", () => {
  assert.equal(aggregate([child(1), child(2, { status: "blocked" })]).status, "blocked");
  assert.equal(
    aggregate([child(1, { status: "blocked" }), child(2, { status: "failed", failure: "timeout" })]).status,
    "failed",
  );
});

test("a single child keeps the shape it always had", () => {
  const d = aggregate([child(1, { turns: 6 })]);
  assert.equal(d.turns, 6);
  assert.equal(d.model, FLASH);
  assert.equal(d.artifact, ".pi-subagent-runs/x-01-scout.json");
  assert.deepEqual(d.failures, []);
  assert.equal(d.isError, false);
});

// ---------------------------------------------------------------------------
// Copied from subagent-only/run-state.ts — the concurrent slot.
// ---------------------------------------------------------------------------

interface Role {
  runs: number;
  tokens: number;
  lastModel?: string;
  lastOutcome?: string;
  running?: { turns: number; maxTurns: number; startedAt: number; model: string; active: number };
  pending?: string[];
}

const OUTCOME_RANK = ["failed", "provider_error", "spawn_error", "max_turns", "no_submit", "blocked"];

function worseOutcome(a: string | undefined, b: string): string {
  if (a === undefined) return b;
  const ra = OUTCOME_RANK.indexOf(a);
  const rb = OUTCOME_RANK.indexOf(b);
  if (ra === -1) return b;
  if (rb === -1) return a;
  return ra <= rb ? a : b;
}

function newRole(): Role {
  return { runs: 0, tokens: 0 };
}

function markStart(s: Role, model: string, maxTurns: number): void {
  if (s.running) {
    s.running.active += 1;
    s.running.maxTurns = Math.max(s.running.maxTurns, maxTurns);
  } else {
    s.running = { turns: 0, maxTurns, startedAt: Date.now(), model, active: 1 };
    s.pending = [];
  }
  s.lastModel = model;
}

function markProgress(s: Role, turns: number): void {
  if (s.running) s.running.turns = Math.max(s.running.turns, turns);
}

function markEnd(s: Role, model: string, tokens: number, outcome: string): void {
  s.runs += 1;
  s.tokens += tokens;
  s.lastModel = model;
  (s.pending ??= []).push(outcome);
  if (s.running && s.running.active > 1) {
    s.running.active -= 1;
    return;
  }
  s.running = undefined;
  s.lastOutcome = s.pending.reduce<string | undefined>(worseOutcome, undefined) ?? outcome;
  s.pending = undefined;
}

test("the slot survives until the last child ends, not the first", () => {
  const s = newRole();
  for (let i = 0; i < 4; i++) markStart(s, FLASH, 12);
  assert.equal(s.running?.active, 4);
  markEnd(s, FLASH, 600, "ok");
  assert.ok(s.running, "le premier enfant a effacé le créneau");
  markEnd(s, FLASH, 600, "ok");
  markEnd(s, FLASH, 600, "ok");
  assert.ok(s.running, "trois enfants terminés, un tourne encore");
  markEnd(s, FLASH, 600, "ok");
  assert.equal(s.running, undefined);
});

test("the displayed turn count is the highest child, never the sum", () => {
  const s = newRole();
  markStart(s, FLASH, 12);
  markStart(s, FLASH, 12);
  markProgress(s, 9);
  markProgress(s, 4); // un enfant plus lent ne fait pas reculer l'affichage
  assert.equal(s.running?.turns, 9, "un maximum, pas une somme ni le dernier");
});

test("one dead child among four does not display as a success", () => {
  const s = newRole();
  for (let i = 0; i < 4; i++) markStart(s, FLASH, 12);
  markEnd(s, FLASH, 600, "ok");
  markEnd(s, FLASH, 600, "max_turns");
  markEnd(s, FLASH, 600, "ok");
  markEnd(s, FLASH, 600, "ok"); // le dernier à finir réussit
  assert.equal(s.lastOutcome, "max_turns");
});

test("the worst of several failures is the one displayed", () => {
  const s = newRole();
  for (let i = 0; i < 3; i++) markStart(s, FLASH, 12);
  markEnd(s, FLASH, 600, "max_turns");
  markEnd(s, FLASH, 600, "provider_error");
  markEnd(s, FLASH, 600, "ok");
  assert.equal(s.lastOutcome, "provider_error");
});

test("totals accumulate across children, as they already did", () => {
  const s = newRole();
  for (let i = 0; i < 4; i++) markStart(s, FLASH, 12);
  for (let i = 0; i < 4; i++) markEnd(s, FLASH, 600, "ok");
  assert.equal(s.runs, 4);
  assert.equal(s.tokens, 2400);
});

test("a verdict is not treated as a failure", () => {
  const s = newRole();
  markStart(s, FLASH, 12);
  markEnd(s, FLASH, 600, "approved");
  assert.equal(s.lastOutcome, "approved");
});

test("a lone run behaves exactly as before", () => {
  const s = newRole();
  markStart(s, FLASH, 12);
  markProgress(s, 3);
  assert.equal(s.running?.active, 1);
  assert.equal(s.running?.turns, 3);
  markEnd(s, FLASH, 600, "needs_rework");
  assert.equal(s.running, undefined);
  assert.equal(s.lastOutcome, "needs_rework");
  assert.equal(s.runs, 1);
});
