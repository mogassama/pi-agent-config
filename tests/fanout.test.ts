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

import { aggregateFanout, streakOf, type ChildResult } from "../subagent-only/fanout.ts";
import {
  batchLifecycle,
  formatModels,
  markEnd,
  markModel,
  markProgress,
  markStart,
  outcomeOf,
  recordAttempt,
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
  markEnd(r, FLASH, verdict("ok"));
  assert.ok(snapshot()[r]?.running, "le premier enfant a effacé le créneau");
  markEnd(r, FLASH, verdict("ok"));
  markEnd(r, FLASH, verdict("ok"));
  assert.ok(snapshot()[r]?.running, "trois terminés, un tourne encore");
  markEnd(r, FLASH, verdict("ok"));
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
  markEnd(r, FLASH, verdict("ok"));
  markEnd(r, FLASH, err("timeout"));
  markEnd(r, FLASH, verdict("ok"));
  markEnd(r, FLASH, verdict("ok")); // le dernier à finir réussit
  assert.equal(snapshot()[r]?.lastOutcome, "timeout");
});

test("a provider error recovered on a fallback does not survive the batch", () => {
  // The sequence dispatch now produces: one markStart per delegation, an
  // attempt that fails and pays its tokens, markModel on the fallback, the
  // fallback's attempt, and one markEnd. Four children, four delegations.
  const r = role();
  for (let i = 0; i < 4; i++) markStart(r, FLASH, 12);
  assert.equal(snapshot()[r]?.running?.active, 4);
  recordAttempt(r, FLASH, 600, 0, 0); // la tentative qui échoue
  markModel(r, FLASH, GEMINI);
  assert.deepEqual(
    snapshot()[r]?.running?.models,
    { [FLASH]: 3, [GEMINI]: 1 },
    "le repli a déplacé un frère au lieu de l'enfant qui bascule",
  );
  assert.equal(snapshot()[r]?.running?.active, 4, "le repli a ouvert un cinquième enfant");
  recordAttempt(r, GEMINI, 600, 0, 0);
  markEnd(r, GEMINI, verdict("ok"));
  for (let i = 0; i < 3; i++) markEnd(r, FLASH, verdict("ok"));
  assert.equal(snapshot()[r]?.runs, 4);
  assert.equal(snapshot()[r]?.lastOutcome, "ok", "l'échec de la tentative a survécu au lot");
});

test("the batch's finishing models are counted, whatever order children end in", () => {
  // `lastModel` was one name, so three children on Flash and one on a fallback
  // rendered differently depending on which the scheduler ended last.
  const a = role();
  for (let i = 0; i < 4; i++) markStart(a, FLASH, 12);
  markEnd(a, GEMINI, verdict("ok"));
  for (let i = 0; i < 3; i++) markEnd(a, FLASH, verdict("ok"));
  const b = role();
  for (let i = 0; i < 4; i++) markStart(b, FLASH, 12);
  for (let i = 0; i < 3; i++) markEnd(b, FLASH, verdict("ok"));
  markEnd(b, GEMINI, verdict("ok")); // le repli finit dernier
  assert.deepEqual(snapshot()[a]?.lastModels, snapshot()[b]?.lastModels);
  assert.deepEqual(snapshot()[a]?.lastModels, { [FLASH]: 3, [GEMINI]: 1 });
});

test("two failures of the same class render the same in either order", () => {
  const a = role();
  markStart(a, FLASH, 12); markStart(a, FLASH, 12);
  markEnd(a, FLASH, err("max_turns")); markEnd(a, FLASH, err("provider_error"));
  const b = role();
  markStart(b, FLASH, 12); markStart(b, FLASH, 12);
  markEnd(b, FLASH, err("provider_error")); markEnd(b, FLASH, err("max_turns"));
  assert.equal(snapshot()[a]?.lastOutcome, snapshot()[b]?.lastOutcome);
  assert.equal(snapshot()[a]?.lastOutcomeKind, "error");
});

test("the models in flight are counted, not the first one to start", () => {
  const r = role();
  markStart(r, FLASH, 12);
  markStart(r, FLASH, 12);
  markStart(r, GEMINI, 12);
  assert.deepEqual(snapshot()[r]?.running?.models, { [FLASH]: 2, [GEMINI]: 1 });
  markEnd(r, GEMINI, verdict("ok"));
  assert.deepEqual(snapshot()[r]?.running?.models, { [FLASH]: 2 });
});

test("tokens count attempts, runs count delegations", () => {
  // A child that fails on its primary and succeeds on a fallback is one
  // delegation and two attempts. Both consumed tokens; only one finished.
  const r = role();
  for (let i = 0; i < 4; i++) markStart(r, FLASH, 12);
  for (let i = 0; i < 4; i++) recordAttempt(r, FLASH, 600, 100, 0);
  recordAttempt(r, GEMINI, 600, 100, 0); // la tentative de repli
  for (let i = 0; i < 4; i++) markEnd(r, FLASH, verdict("ok"));
  assert.equal(snapshot()[r]?.runs, 4, "cinq tentatives ont compté pour cinq délégations");
  assert.equal(snapshot()[r]?.tokens, 3000, "la tentative ratée n'a pas payé ses tokens");
  assert.equal(snapshot()[r]?.cacheRead, 500);
});

test("a verdict is not mistaken for a failure", () => {
  const r = role();
  markStart(r, FLASH, 12);
  markEnd(r, FLASH, verdict("approved"));
  assert.equal(snapshot()[r]?.lastOutcome, "approved");
});

test("a lone run behaves exactly as before", () => {
  const r = role();
  markStart(r, FLASH, 12);
  markProgress(r, 3);
  assert.equal(snapshot()[r]?.running?.active, 1);
  assert.equal(snapshot()[r]?.running?.turns, 3);
  markEnd(r, FLASH, verdict("needs_rework"));
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

// ---------------------------------------------------------------------------
// outcomeOf — the classification `dispatch` applies, callable at last
// ---------------------------------------------------------------------------

test("a submitted status of failed is an error, not a verdict", () => {
  // The envelope schema allows ok | blocked | failed. Classing `failed` as a
  // verdict let `ok` win the tie and a batch holding one displayed as success.
  assert.equal(outcomeOf({ status: "failed" }).kind, "error");
  assert.equal(
    worseOutcome(outcomeOf({ status: "ok", verdict: "ok" }), outcomeOf({ status: "failed" })).kind,
    "error",
  );
  assert.equal(
    worseOutcome(outcomeOf({ status: "failed" }), outcomeOf({ status: "ok", verdict: "ok" })).kind,
    "error",
    "l'ordre de terminaison a changé le résultat",
  );
});

test("a harness failure outranks whatever the envelope said", () => {
  assert.deepEqual(outcomeOf({ failure: "timeout", status: "ok" }), { kind: "error", label: "timeout" });
});

test("blocked and a plain verdict keep their kinds", () => {
  assert.equal(outcomeOf({ status: "blocked", verdict: "blocked" }).kind, "blocked");
  assert.equal(outcomeOf({ status: "ok", verdict: "approved" }).label, "approved");
});

// ---------------------------------------------------------------------------
// batchLifecycle — the callbacks dispatch hands to the machine
// ---------------------------------------------------------------------------

test("finish closes the delegation and records its outcome", () => {
  // The machine's tests watch that a `finish` callback is invoked. Nothing
  // checked what dispatch's callback *did* — the same gap, one level down.
  const r = role();
  const life = batchLifecycle(r, FLASH, 12);
  assert.equal(snapshot()[r]?.running?.active, 1);
  life.finish({ modelUsed: FLASH, status: "ok", verdict: "approved" });
  assert.equal(snapshot()[r]?.running, undefined, "le créneau est resté ouvert");
  assert.equal(snapshot()[r]?.runs, 1);
  assert.equal(snapshot()[r]?.lastOutcome, "approved");
});

test("abandon closes a delegation that never returned", () => {
  const r = role();
  const life = batchLifecycle(r, FLASH, 12);
  life.abandon("internal_error");
  assert.equal(snapshot()[r]?.running, undefined, "une exception a laissé le rôle en cours");
  assert.equal(snapshot()[r]?.lastOutcome, "internal_error");
  assert.equal(snapshot()[r]?.lastOutcomeKind, "error");
});

test("abandon after finish does nothing, so a catch may call it blindly", () => {
  const r = role();
  const life = batchLifecycle(r, FLASH, 12);
  life.finish({ modelUsed: FLASH, status: "ok", verdict: "ok" });
  life.abandon("internal_error");
  assert.equal(snapshot()[r]?.runs, 1, "la délégation a été comptée deux fois");
  assert.equal(snapshot()[r]?.lastOutcome, "ok");
});

test("an exception after a fallback closes under the model in flight", () => {
  // `abandon` captured the model the delegation started on, so an exception on
  // the fallback removed a sibling's model from the batch and left the count
  // describing a child that was still running on something else.
  const r = role();
  const life = batchLifecycle(r, FLASH, 12);
  life.onFallback(FLASH, GEMINI);
  life.abandon("internal_error");
  assert.deepEqual(snapshot()[r]?.lastModels, { [GEMINI]: 1 }, "fermé au nom du modèle initial");
});

test("two abandons count one delegation", () => {
  // The comment promised `abandon` was a no-op once closed; only `finish` set
  // the flag.
  const r = role();
  const life = batchLifecycle(r, FLASH, 12);
  life.abandon("internal_error");
  life.abandon("internal_error");
  assert.equal(snapshot()[r]?.runs, 1, "une exception a compté deux délégations");
});

test("onFallback moves the model without opening a child", () => {
  const r = role();
  const life = batchLifecycle(r, FLASH, 12);
  life.onFallback(FLASH, GEMINI);
  assert.equal(snapshot()[r]?.running?.active, 1);
  assert.deepEqual(snapshot()[r]?.running?.models, { [GEMINI]: 1 });
});

test("the same models render identically whatever order they were inserted", () => {
  const short = (m: string) => m;
  const a = formatModels({ gemini: 1, flash: 3 }, short);
  const b = formatModels({ flash: 3, gemini: 1 }, short);
  assert.equal(a, b, "l'ordre d'insertion a changé le rendu");
  assert.equal(a, "flash×3 + gemini×1");
});

test("a single model renders as its name, an empty set as a question mark", () => {
  const short = (m: string) => m;
  assert.equal(formatModels({ flash: 4 }, short), "flash");
  assert.equal(formatModels({}, short), "?");
});
