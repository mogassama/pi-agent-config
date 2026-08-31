/**
 * The review boundary, on the production function.
 *
 * Each case is an incident or a sequence the run has to answer, not an
 * invention. The one that made this module exist is `W → R1 → S → R2`: the
 * second reviewer was handed an empty package because the backward scan read
 * the boundary as consumed by the first review. `reviewer.md` promises that a
 * where-question in `open_risks` comes back as named files in the next task,
 * and the streak guard refuses to block that sequence so the promise can be
 * kept — but the promise was unkeepable, because the next review had no change
 * in front of it.
 *
 * Two of these cases come from an external review of the first version, and
 * both broke it. A reviewer that returned no envelope was marking the boundary
 * as seen, and a writer that wrote nothing was closing it: the machine tested
 * the role rather than what happened on disk.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openReviewBoundary, type BoundaryEntry } from "../subagent-only/review-boundary.ts";

const w = (...changedFiles: string[]): BoundaryEntry => ({ agent: "worker", produced: true, changedFiles });
const r = (): BoundaryEntry => ({ agent: "reviewer", produced: true, changedFiles: [] });
const s = (): BoundaryEntry => ({ agent: "scout", produced: true, changedFiles: [] });
const o = (...changedFiles: string[]): BoundaryEntry => ({ agent: "orchestrator", produced: true, changedFiles });
/** A child that returned no envelope. Salvage may still have found files on disk. */
const failed = (agent: string, ...changedFiles: string[]): BoundaryEntry => ({ agent, produced: false, changedFiles });

test("empty history opens no boundary", () => {
  assert.deepEqual(openReviewBoundary([]), []);
});

test("a writer before any review opens the boundary", () => {
  assert.deepEqual(openReviewBoundary([w("a.py")]), ["a.py"]);
});

test("consecutive writers accumulate into one boundary", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), w("b.py")]), ["a.py", "b.py"]);
});

test("a scout between a writer and its review moves nothing", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), s()]), ["a.py"]);
});

// The incident. R2 must see exactly what R1 saw.
test("W R S R — the second review keeps the first one's boundary", () => {
  const history = [w("a.py", "b.py"), r(), s()];
  const atR1 = openReviewBoundary(history.slice(0, 1));
  const atR2 = openReviewBoundary(history);
  assert.deepEqual(atR2, atR1);
  assert.deepEqual(atR2, ["a.py", "b.py"]);
});

test("W R S S R — several scouts do not change the answer", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), s(), s()]), ["a.py"]);
});

// A fix keyed on "a scout follows the reviewer" would answer this one wrong.
test("W R R — a second review with nothing in between still sees the boundary", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), r()]), ["a.py"]);
});

test("W R W — a material change after a review opens a new boundary", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), w("b.py")]), ["b.py"]);
});

test("W R S R W R — the rework's review does not reopen the old diff", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), s(), r(), w("b.py"), r()]), ["b.py"]);
});

test("W R S W R — a material change closes the boundary even after a scout", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), s(), w("b.py")]), ["b.py"]);
});

test("an inline orchestrator write counts as a material change", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), o("DESIGN.md")]), ["DESIGN.md"]);
});

// The reviewer has no `edit` and no `write`, so it reports no changed file.
// Without the explicit test on the role, every review would be invisible here
// and the boundary would never be marked as seen.
test("a reviewer is distinguished from any other delegation reporting no change", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), w("b.py"), r()]), ["b.py"]);
});

// External review, defect 2. The event is what reached disk, not the role that
// could have written. This assertion was inverted in the first version, against
// its own comment.
test("W R W_empty — a writer that changed nothing leaves the boundary intact", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), w()]), ["a.py"]);
});

// External review, defect 1. A review that returned no envelope reviewed
// nothing, so the next writer must not discard what it never read.
test("W R_failed W — a review that produced nothing does not mark the boundary as seen", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), failed("reviewer"), w("b.py")]), ["a.py", "b.py"]);
});

// The other half of `produced`: a worker that failed but left files on disk via
// salvage has changed the tree, so it does open a new boundary.
test("a failed writer whose salvage found files still opens a new boundary", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), failed("worker", "b.py")]), ["b.py"]);
});

test("a failed writer that left nothing on disk changes nothing", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), r(), failed("worker"), s()]), ["a.py"]);
});

// The package is built by re-diffing the paths, so a repeat cannot double the
// diff — but the list handed over must not carry the duplicate either.
test("a path touched twice in one boundary is named once", () => {
  assert.deepEqual(openReviewBoundary([w("a.py"), w("a.py", "b.py"), s()]), ["a.py", "b.py"]);
});

test("historical behaviour is unchanged when no continuation happens", () => {
  const history = [w("a.py"), r(), w("b.py"), r(), w("c.py")];
  assert.deepEqual(openReviewBoundary(history), ["c.py"]);
});
