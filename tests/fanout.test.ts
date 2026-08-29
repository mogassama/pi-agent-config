/**
 * The fan-out, on the production functions rather than copies of them.
 *
 * `find` accepts up to four questions and starts that many children at once. The
 * path had never executed — zero multi-question calls since it shipped — so
 * everything downstream of `Promise.all` was written and left unexercised. Four
 * defects were found by review and simulation rather than by a run, and they are
 * all the same shape: code that assumes one child where there can be four, or
 * one attempt where there can be two.
 *
 *   `details`    was built from `results[0]`. A four-scout call reported six
 *                turns out of thirty-four and `isError: false` with one child
 *                dead at its ceiling. `next` was the subtlest: a batch could
 *                report `status: failed` and `next: done` together.
 *
 *   `run-state`  held one `running` slot per role, so four children of the same
 *                role overwrote each other and the first end cleared the slot.
 *
 *   the rank     held six failure names where `RunResult` declares eight, so a
 *                batch containing a `timeout` or an `aborted` displayed as a
 *                success — the exact symptom the batch accounting exists to
 *                prevent.
 *
 *   attempts     were counted as delegations. A provider error recovered on a
 *                fallback survived to the end of the batch, so four successful
 *                delegations displayed as a failure. The first defect inside
 *                out.
 *
 * The first version of this file reimplemented both functions with a comment
 * asking that the copies be kept identical. That is a convention, not a
 * mechanism: production could change and these would stay green, describing
 * their copy. They import the real ones now.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateFanout, type ChildResult } from "../subagent-only/fanout.ts";
import {
  markEnd,
  markModel,
  markProgress,
  markStart,
  snapshot,
  worseOutcome,
  type Outcome,
  type RoleName,
} from "../subagent-only/run-state.ts";

const FLASH = "deepseek/deepseek-v4-flash";
const GEMINI = "google/gemini-3.1-flash-lite";

function child(n: number, over: Partial<ChildResult> = {}): ChildResult {
  return {
    role: "scout",
    modelUsed: FLASH,
    status: "ok",
    turns: 5,
    artifact: `.pi-subagent-runs/x-0${n}-scout.json`,
    next: "done",
    usage: { input: 100, output: 200, cacheRead: 300, cacheWrite: 0, total: 600 },
    ...over,
  };
}

const dead = (n: number, failure: string): ChildResult =>
  child(n, { status: "failed", failure, next: "orchestrator", turns: 12 });

// ---------------------------------------------------------------------------
// aggregateFanout
// ---------------------------------------------------------------------------

test("four successes: turns and usage are summed, not the first child's", () => {
  const d = aggregateFanout([
    child(1),
    child(2, { turns: 7 }),
    child(3, { turns: 9 }),
    child(4, { turns: 12 }),
  ]);
  assert.equal(d.turns, 5 + 7 + 9 + 12);
  assert.equal(d.usage.total, 2400);
  assert.equal(d.usage.output, 800);
  assert.equal(d.status, "ok");
  assert.equal(d.next, "done");
});

test("one failure among four is not hidden by the first child's success", () => {
  const d = aggregateFanout([child(1), child(2), dead(3, "max_turns"), child(4)]);
  assert.equal(d.status, "failed");
  assert.deepEqual(d.failures, ["max_turns"]);
});

test("a batch with a dead child never reports next: done", () => {
  // The quiet one: `status: failed` beside `next: done` told the orchestrator a
  // batch containing a dead child needed nothing further.
  const d = aggregateFanout([child(1), dead(2, "timeout")]);
  assert.equal(d.status, "failed");
  assert.equal(d.next, "orchestrator");
});

test("a failure in first position does not hide the successes", () => {
  const d = aggregateFanout([dead(1, "spawn_error"), child(2), child(3)]);
  assert.equal(d.status, "failed");
  assert.equal(d.children.filter((c) => c.status === "ok").length, 2);
});

test("two failures of different kinds are both reported", () => {
  const d = aggregateFanout([child(1), dead(2, "max_turns"), dead(3, "provider_error"), child(4)]);
  assert.deepEqual(d.failures, ["max_turns", "provider_error"]);
  assert.equal(d.failure, "max_turns");
});

test("a fallback splits the models and both are named", () => {
  const d = aggregateFanout([child(1), child(2, { modelUsed: GEMINI }), child(3)]);
  assert.equal(d.model, `${FLASH}, ${GEMINI}`);
  assert.equal(d.children[1].model, GEMINI);
});

test("all four artefacts are reachable, not just the first", () => {
  const d = aggregateFanout([child(1), child(2), child(3), child(4)]);
  assert.equal(d.artifact.split(" ").length, 4);
});

test("blocked outranks ok and yields to failed", () => {
  assert.equal(aggregateFanout([child(1), child(2, { status: "blocked" })]).status, "blocked");
  assert.equal(aggregateFanout([child(1, { status: "blocked" }), dead(2, "timeout")]).status, "failed");
});

test("a single child keeps the shape it always had", () => {
  const d = aggregateFanout([child(1, { turns: 6 })]);
  assert.equal(d.turns, 6);
  assert.equal(d.model, FLASH);
  assert.equal(d.artifact, ".pi-subagent-runs/x-01-scout.json");
  assert.deepEqual(d.failures, []);
  assert.equal(d.next, "done");
});

// ---------------------------------------------------------------------------
// worseOutcome — a closed union, so a ninth failure name cannot slip through
// ---------------------------------------------------------------------------

const err = (label: string): Outcome => ({ kind: "error", label });
const verdict = (label: string): Outcome => ({ kind: "verdict", label });
const blocked = (label: string): Outcome => ({ kind: "blocked", label });

test("every failure name outranks a verdict, including timeout and aborted", () => {
  // These two were absent from the old rank list, which held six of the eight
  // names `RunResult` declares, so a batch containing one displayed as `ok`.
  for (const name of ["max_turns", "timeout", "no_submit", "spawn_error", "aborted", "provider_error"]) {
    assert.equal(worseOutcome(err(name), verdict("ok")).label, name, `${name} écrasé par ok`);
    assert.equal(worseOutcome(verdict("ok"), err(name)).label, name, `${name} perdu en second`);
  }
});

test("blocked sits between an error and a verdict", () => {
  assert.equal(worseOutcome(blocked("blocked"), verdict("approved")).kind, "blocked");
  assert.equal(worseOutcome(blocked("blocked"), err("timeout")).kind, "error");
});

test("ties keep the first, so the order in which children end does not matter", () => {
  assert.equal(worseOutcome(err("max_turns"), err("timeout")).label, "max_turns");
  assert.equal(worseOutcome(verdict("approved"), verdict("needs_rework")).label, "approved");
});

// ---------------------------------------------------------------------------
// run-state — the module's real exports, on a fresh role each time
// ---------------------------------------------------------------------------

let n = 0;
/** A distinct role per test: the module keeps one map for the whole process. */
const role = (): RoleName => `scout-${++n}` as RoleName;

test("the slot survives until the last child ends, not the first", () => {
  const r = role();
  for (let i = 0; i < 4; i++) markStart(r, FLASH, 12);
  assert.equal(snapshot()[r]?.running?.active, 4);
  markEnd(r, FLASH, 600, 0, 0, verdict("ok"));
  assert.ok(snapshot()[r]?.running, "le premier enfant a effacé le créneau");
  markEnd(r, FLASH, 600, 0, 0, verdict("ok"));
  markEnd(r, FLASH, 600, 0, 0, verdict("ok"));
  assert.ok(snapshot()[r]?.running, "trois terminés, un tourne encore");
  markEnd(r, FLASH, 600, 0, 0, verdict("ok"));
  assert.equal(snapshot()[r]?.running, undefined);
});

test("the displayed turn count is the highest child, never the sum", () => {
  const r = role();
  markStart(r, FLASH, 12);
  markStart(r, FLASH, 12);
  markProgress(r, 9);
  markProgress(r, 4);
  assert.equal(snapshot()[r]?.running?.turns, 9);
});

test("one dead child among four does not display as a success", () => {
  const r = role();
  for (let i = 0; i < 4; i++) markStart(r, FLASH, 12);
  markEnd(r, FLASH, 600, 0, 0, verdict("ok"));
  markEnd(r, FLASH, 600, 0, 0, err("timeout"));
  markEnd(r, FLASH, 600, 0, 0, verdict("ok"));
  markEnd(r, FLASH, 600, 0, 0, verdict("ok")); // le dernier à finir réussit
  assert.equal(snapshot()[r]?.lastOutcome, "timeout");
});

test("a provider error recovered on a fallback does not survive the batch", () => {
  // dispatch records one outcome per *delegation*, and a failed attempt is not
  // one. Four children, of which one moved to Gemini and succeeded there.
  const r = role();
  for (let i = 0; i < 4; i++) markStart(r, FLASH, 12);
  markModel(r, FLASH, GEMINI);
  assert.deepEqual(snapshot()[r]?.running?.models, { [FLASH]: 3, [GEMINI]: 1 });
  for (let i = 0; i < 4; i++) markEnd(r, i === 0 ? GEMINI : FLASH, 600, 0, 0, verdict("ok"));
  assert.equal(snapshot()[r]?.lastOutcome, "ok");
});

test("the models in flight are counted, not the first one to start", () => {
  const r = role();
  markStart(r, FLASH, 12);
  markStart(r, FLASH, 12);
  markStart(r, GEMINI, 12);
  assert.deepEqual(snapshot()[r]?.running?.models, { [FLASH]: 2, [GEMINI]: 1 });
  markEnd(r, GEMINI, 600, 0, 0, verdict("ok"));
  assert.deepEqual(snapshot()[r]?.running?.models, { [FLASH]: 2 });
});

test("totals accumulate across children, as they already did", () => {
  const r = role();
  for (let i = 0; i < 4; i++) markStart(r, FLASH, 12);
  for (let i = 0; i < 4; i++) markEnd(r, FLASH, 600, 100, 0.01, verdict("ok"));
  assert.equal(snapshot()[r]?.runs, 4);
  assert.equal(snapshot()[r]?.tokens, 2400);
  assert.equal(snapshot()[r]?.cacheRead, 400);
});

test("a verdict is not mistaken for a failure", () => {
  const r = role();
  markStart(r, FLASH, 12);
  markEnd(r, FLASH, 600, 0, 0, verdict("approved"));
  assert.equal(snapshot()[r]?.lastOutcome, "approved");
});

test("a lone run behaves exactly as before", () => {
  const r = role();
  markStart(r, FLASH, 12);
  markProgress(r, 3);
  assert.equal(snapshot()[r]?.running?.active, 1);
  assert.equal(snapshot()[r]?.running?.turns, 3);
  markEnd(r, FLASH, 600, 0, 0, verdict("needs_rework"));
  assert.equal(snapshot()[r]?.running, undefined);
  assert.equal(snapshot()[r]?.lastOutcome, "needs_rework");
  assert.equal(snapshot()[r]?.runs, 1);
});

// ---------------------------------------------------------------------------
// the streak guard counts calls, not children
// ---------------------------------------------------------------------------

interface Entry {
  agent: string;
  batch: string;
}

/** The guard's three lines, kept here because they live inside a pi extension. */
function streakOf(history: Entry[], agentName: string): number {
  const seen = new Set<string>();
  for (let i = history.length - 1; i >= 0 && history[i].agent === agentName; i--) {
    seen.add(history[i].batch);
  }
  return seen.size;
}

test("a fan-out of four counts as one call, not four", () => {
  const h: Entry[] = [
    { agent: "scout", batch: "a" },
    { agent: "scout", batch: "a" },
    { agent: "scout", batch: "a" },
    { agent: "scout", batch: "a" },
  ];
  assert.equal(streakOf(h, "scout"), 1, "le fan-out a été compté comme quatre appels");
});

test("two separate scout calls still count as two", () => {
  const h: Entry[] = [
    { agent: "scout", batch: "a" },
    { agent: "scout", batch: "b" },
  ];
  assert.equal(streakOf(h, "scout"), 2);
});

test("a different role between them breaks the streak", () => {
  const h: Entry[] = [
    { agent: "scout", batch: "a" },
    { agent: "worker", batch: "b" },
    { agent: "scout", batch: "c" },
  ];
  assert.equal(streakOf(h, "scout"), 1);
});
