/**
 * The counts, on the production functions.
 *
 * This path had no test and it broke: `open_risks` decided an orchestrator
 * action, was written by sixteen reviews on run 12, and never appeared in the
 * head line. Three lines in `dispatch.ts`, three in `index.ts`, obvious in both
 * and wrong across the pair.
 *
 * The head line is a contract, not a rendering detail — `head = signal,
 * artifact = payload`, and an orchestrator opens the artefact on what the head
 * says. These cases fix the exact strings, so a fourth count added later cannot
 * quietly change what the existing three look like.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { countsLine, envelopeCounts } from "../subagent-only/counts.ts";

test("open_risks reaches the result as a count", () => {
  assert.equal(envelopeCounts({ open_risks: ["A", "B"] }).openRisks, 2);
});

test("an envelope without the field counts nothing rather than zero", () => {
  const c = envelopeCounts({ summary: "done" });
  assert.equal(c.openRisks, undefined);
  assert.equal(c.findings, undefined);
  assert.equal(c.outOfScope, undefined);
});

test("an empty array counts zero, which the line then omits", () => {
  assert.equal(envelopeCounts({ open_risks: [] }).openRisks, 0);
  assert.equal(countsLine({ openRisks: 0 }), "");
});

test("a field that is not an array is not counted", () => {
  assert.equal(envelopeCounts({ open_risks: "three" }).openRisks, undefined);
});

test("the three counts read their own envelope keys", () => {
  const c = envelopeCounts({ findings: [1], out_of_scope: [1, 2], open_risks: [1, 2, 3] });
  assert.deepEqual(c, { findings: 1, outOfScope: 2, openRisks: 3 });
});

// The incident, end to end: a review that approves and still leaves work.
test("an approval carrying open risks says so in the head line", () => {
  assert.equal(countsLine(envelopeCounts({ findings: [1, 2], open_risks: ["A", "B", "C"] })), "2 findings, 3 open-risks");
});

test("one of each is singular", () => {
  assert.equal(countsLine({ findings: 1, openRisks: 1 }), "1 finding, 1 open-risk");
});

test("out-of-scope does not take a plural", () => {
  assert.equal(countsLine({ outOfScope: 2 }), "2 out-of-scope");
});

test("a clean review reports nothing", () => {
  assert.equal(countsLine(envelopeCounts({ summary: "approved" })), "");
});

test("the order is findings, out-of-scope, open-risks", () => {
  assert.equal(
    countsLine({ findings: 1, outOfScope: 1, openRisks: 1 }),
    "1 finding, 1 out-of-scope, 1 open-risk",
  );
});
