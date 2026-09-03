/**
 * The ledger, on the production transitions.
 *
 * Run 14 finished eleven deliverables carrying fourteen open risks and said the
 * same thing as a run with none. These cases fix what the ledger records and,
 * more importantly, what it refuses to record: a review closes what it was
 * handed and nothing else, an id it never saw stays open however well it
 * matches, and a continuation that comes back without settling its risk returns
 * that risk to `open` rather than leaving it `routed` for the rest of the run.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  continuationReturned,
  openRisks,
  riskChannel,
  routeRisks,
  type RiskRecord,
} from "../subagent-only/risk-ledger.ts";

const item = (id: string, text = `text of ${id}`) => ({ id, text });
const opened = (...ids: string[]): RiskRecord[] =>
  openRisks([], ids.map((i) => item(i)), "9a6766-04-reviewer.json").ledger;
const byId = (l: readonly RiskRecord[], id: string) => l.find((r) => r.id === id);

// ------------------------------------------------------------------ channel

/*
 * Which roles may move the ledger with `for_risks`.
 *
 * The routing branch used to key on `forRisks.length > 0` alone, so a worker
 * that arrived holding the field marked its risks `routed`. The rule lived
 * inline in the extension where nothing could test it; these four cases are
 * what the fix is actually held by.
 */
test("a scout routes, a reviewer continues", () => {
  assert.equal(riskChannel("scout"), "route");
  assert.equal(riskChannel("reviewer"), "continuation");
});

test("a worker holding for_risks moves nothing", () => {
  assert.equal(riskChannel("worker"), "none");
});

test("an advisor holding for_risks moves nothing", () => {
  assert.equal(riskChannel("advisor"), "none");
});

test("a role nobody has thought of yet moves nothing", () => {
  assert.equal(riskChannel("integrator"), "none");
});

// ------------------------------------------------------------------ opening

test("a review opens its risks", () => {
  const { ledger, events } = openRisks(
    [],
    [item("9a6766-04-1"), item("9a6766-04-2")],
    "9a6766-04-reviewer.json",
  );
  assert.deepEqual(ledger.map((r) => r.status), ["open", "open"]);
  assert.equal(ledger[0].openedBy, "9a6766-04-reviewer.json");
  assert.deepEqual(events.map((e) => e.event), ["opened", "opened"]);
});

test("a review with nothing open leaves the ledger and the journal alone", () => {
  for (const items of [undefined, []]) {
    const { ledger, events } = openRisks(opened("a"), items, "9a6766-06-reviewer.json");
    assert.equal(ledger.length, 1);
    assert.deepEqual(events, []);
  }
});

// An id is a coordinate, so a repeat is the same risk seen twice.
test("an id already in the ledger is not opened twice", () => {
  const { ledger, events } = openRisks(opened("a"), [item("a")], "9a6766-06-reviewer.json");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].openedBy, "9a6766-04-reviewer.json");
  assert.deepEqual(events, []);
});

test("the opening event carries the risk length, which is what run 15 measures", () => {
  const { events } = openRisks([], [item("a", "twelve chars")], "9a6766-04-reviewer.json");
  assert.deepEqual(events, [
    { event: "opened", id: "a", by: "9a6766-04-reviewer.json", chars: 12 },
  ]);
});

// ------------------------------------------------------------------ routing

test("routing marks the call, not a child", () => {
  const { ledger } = routeRisks(opened("a"), ["a"], "call:9fbc");
  assert.equal(ledger[0].status, "routed");
  assert.equal(ledger[0].routedTo, "call:9fbc");
});

// A batched scout call carries several risks and spawns several children.
// Pairing them by position would be a guess: the orchestrator reformulates each
// question rather than copying the risk.
test("a batched call routes every risk it carries, to one call id", () => {
  const { ledger } = routeRisks(opened("a", "b", "c"), ["a", "b", "c"], "call:9fbc");
  assert.deepEqual(ledger.map((r) => r.routedTo), ["call:9fbc", "call:9fbc", "call:9fbc"]);
});

test("routing an unknown id is journalled, not thrown", () => {
  const { ledger, events } = routeRisks(opened("a"), ["a", "ghost"], "call:1");
  assert.equal(ledger.length, 1);
  assert.deepEqual(events[1], { event: "ignored", id: "ghost", reason: "unknown", by: "call:1" });
});

test("a resolved risk is not routed again", () => {
  const one = routeRisks(opened("a"), ["a"], "call:1").ledger;
  const two = continuationReturned(one, ["a"], ["a"], "9a6766-06-reviewer.json").ledger;
  const { events } = routeRisks(two, ["a"], "call:2");
  assert.deepEqual(events, [
    { event: "ignored", id: "a", reason: "already-resolved", by: "call:2" },
  ]);
});

// -------------------------------------------------------------- continuation

test("a review closes what it was handed", () => {
  const { ledger, events } = continuationReturned(
    opened("a"),
    ["a"],
    ["a"],
    "9a6766-06-reviewer.json",
  );
  assert.equal(ledger[0].status, "resolved");
  assert.equal(ledger[0].resolvedBy, "9a6766-06-reviewer.json");
  assert.deepEqual(events, [
    { event: "resolved", id: "a", by: "9a6766-06-reviewer.json" },
  ]);
});

// Provenance, not classification. Without it one review could clear a concern
// raised about another change on the strength of a matching id.
test("a review cannot close a risk it was never handed, even a real one", () => {
  const { ledger, events } = continuationReturned(
    opened("a", "b"),
    ["a"],
    ["a", "b"],
    "9a6766-06-reviewer.json",
  );
  assert.equal(byId(ledger, "a")?.status, "resolved");
  assert.equal(byId(ledger, "b")?.status, "open");
  assert.deepEqual(events.filter((e) => e.event === "ignored"), [
    { event: "ignored", id: "b", reason: "not-entrusted", by: "9a6766-06-reviewer.json" },
  ]);
});

test("an entrusted id that does not exist is journalled, not thrown", () => {
  const { events } = continuationReturned(opened("a"), ["ghost"], ["ghost"], "9a6766-06.json");
  assert.deepEqual(events, [
    { event: "ignored", id: "ghost", reason: "unknown", by: "9a6766-06.json" },
  ]);
});

/*
 * The correction an external review asked for.
 *
 * The first version left an unsettled continuation risk `routed` for the rest of
 * the run, which made the state mean "was sent somewhere once" — true of almost
 * everything by the end, and useless. Back to `open`, the three states carry
 * their own weight and a `routed` still standing at the end of a run is a real
 * observation: a continuation was engaged and never completed.
 */
test("a continuation that does not settle its risk returns it to open", () => {
  const routed = routeRisks(opened("a"), ["a"], "call:1").ledger;
  const { ledger, events } = continuationReturned(routed, ["a"], [], "9a6766-06-reviewer.json");
  assert.equal(ledger[0].status, "open");
  assert.deepEqual(events, [
    { event: "still-open", id: "a", by: "9a6766-06-reviewer.json" },
  ]);
});

test("the routing that was attempted stays legible after the return to open", () => {
  const routed = routeRisks(opened("a"), ["a"], "call:1").ledger;
  const { ledger } = continuationReturned(routed, ["a"], [], "9a6766-06.json");
  assert.equal(ledger[0].routedTo, "call:1");
});

test("a risk can be routed again after coming back open", () => {
  const one = routeRisks(opened("a"), ["a"], "call:1").ledger;
  const two = continuationReturned(one, ["a"], [], "9a6766-06.json").ledger;
  const { ledger, events } = routeRisks(two, ["a"], "call:2");
  assert.equal(ledger[0].status, "routed");
  assert.equal(ledger[0].routedTo, "call:2");
  assert.deepEqual(events, [{ event: "routed", id: "a", to: "call:2" }]);
});

// The §15 case: two entrusted, one of them claimed, plus a claim on a third.
test("one review can close one risk, leave another open and overreach on a third", () => {
  const { ledger, events } = continuationReturned(
    opened("R1", "R2", "R3"),
    ["R1", "R2"],
    ["R1", "R3"],
    "9a6766-07-reviewer.json",
  );
  assert.equal(byId(ledger, "R1")?.status, "resolved");
  assert.equal(byId(ledger, "R2")?.status, "open");
  assert.equal(byId(ledger, "R3")?.status, "open");
  assert.deepEqual(events.map((e) => e.event), ["resolved", "still-open", "ignored"]);
});

/*
 * A closed risk stays closed, whatever a later review does with the id.
 *
 * The first version tested `!claimed` before `already-resolved`, so an
 * orchestrator repeating an id in `for_risks` — a mistake in prose — reopened a
 * concern a review had explicitly settled. The contract says a new concern gets
 * a new id; these two cases are the code holding the other half of it.
 */
test("a resolved risk handed back and not claimed is not reopened", () => {
  const closed = continuationReturned(opened("a"), ["a"], ["a"], "9a6766-06.json").ledger;
  const { ledger, events } = continuationReturned(closed, ["a"], [], "9a6766-09.json");
  assert.equal(ledger[0].status, "resolved");
  assert.equal(ledger[0].resolvedBy, "9a6766-06.json");
  assert.deepEqual(events, [
    { event: "ignored", id: "a", reason: "already-resolved", by: "9a6766-09.json" },
  ]);
});

test("a resolved risk handed back and claimed again keeps its first closer", () => {
  const closed = continuationReturned(opened("a"), ["a"], ["a"], "9a6766-06.json").ledger;
  const { ledger, events } = continuationReturned(closed, ["a"], ["a"], "9a6766-09.json");
  assert.equal(ledger[0].resolvedBy, "9a6766-06.json");
  assert.deepEqual(events, [
    { event: "ignored", id: "a", reason: "already-resolved", by: "9a6766-09.json" },
  ]);
});

test("a resolved risk is never the subject of a still-open event", () => {
  const closed = continuationReturned(opened("a", "b"), ["a"], ["a"], "9a6766-06.json").ledger;
  const { events } = continuationReturned(closed, ["a", "b"], [], "9a6766-09.json");
  assert.deepEqual(events.map((e) => `${e.event}:${e.id}`), ["ignored:a", "still-open:b"]);
});

// A follow-up review sent without a scout in between: the risk was never
// `routed`, and closing it directly from `open` is a legal path.
test("a risk can be closed without ever having been routed", () => {
  const { ledger } = continuationReturned(opened("a"), ["a"], ["a"], "9a6766-06.json");
  assert.equal(ledger[0].status, "resolved");
});

test("a review both closes an old risk and opens a new one", () => {
  const closed = continuationReturned(opened("9a6766-04-1"), ["9a6766-04-1"], ["9a6766-04-1"], "9a6766-06-reviewer.json").ledger;
  const { ledger } = openRisks(closed, [item("9a6766-06-1")], "9a6766-06-reviewer.json");
  assert.equal(byId(ledger, "9a6766-04-1")?.status, "resolved");
  assert.equal(byId(ledger, "9a6766-06-1")?.status, "open");
});

// ------------------------------------------------------------------ purity

test("no transition mutates what it was given", () => {
  const before = opened("a");
  const snapshot = JSON.stringify(before);
  routeRisks(before, ["a"], "call:1");
  continuationReturned(before, ["a"], ["a"], "9a6766-06.json");
  openRisks(before, [item("b")], "9a6766-06.json");
  assert.equal(JSON.stringify(before), snapshot);
});

/*
 * There is no classification field, and this is the test that says so.
 *
 * `kind`, `where`, `exhaustive`, `scoutable`, `severity`: any of them would make
 * the ledger the authority on routing, which belongs to the orchestrator, and
 * the reviewer its source. Asserting on the record's shape is the only way that
 * decision survives someone adding "just a hint" later.
 */
test("a record holds provenance and status, never a classification", () => {
  const { ledger } = openRisks([], [item("a")], "9a6766-04-reviewer.json");
  assert.deepEqual(Object.keys(ledger[0]).sort(), ["id", "openedBy", "status", "text"]);
});
