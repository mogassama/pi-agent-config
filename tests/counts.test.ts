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

import {
  actionLines,
  countsLine,
  envelopeCounts,
  reviewAction,
  riskLines,
} from "../subagent-only/counts.ts";

const P = "9a6766-04";

test("open_risks reaches the result as a count", () => {
  assert.equal(envelopeCounts({ open_risks: ["A", "B"] }, P).openRisks, 2);
});

test("an envelope without the field counts nothing rather than zero", () => {
  const c = envelopeCounts({ summary: "done" }, P);
  assert.equal(c.openRisks, undefined);
  assert.equal(c.findings, undefined);
  assert.equal(c.outOfScope, undefined);
});

test("an empty array carries nothing, and the line omits it either way", () => {
  assert.equal(envelopeCounts({ open_risks: [] }, P).openRisks, undefined);
  assert.equal(countsLine({ openRisks: 0 }), "");
  assert.equal(countsLine({ openRisks: undefined }), "");
});

test("a field that is not an array is not counted", () => {
  assert.equal(envelopeCounts({ open_risks: "three" }, P).openRisks, undefined);
});

test("the three counts read their own envelope keys", () => {
  const c = envelopeCounts({ findings: [1], out_of_scope: [1, 2], open_risks: [1, 2, 3] }, P);
  // Non-string entries cannot pass the envelope schema and cannot be carried, so
  // they are not announced either.
  assert.deepEqual(c, { findings: 1, outOfScope: 2, openRisks: undefined, openRiskItems: undefined });
});

// The incident, end to end: a review that approves and still leaves work.
test("an approval carrying open risks says so in the head line", () => {
  assert.equal(countsLine(envelopeCounts({ findings: [1, 2], open_risks: ["A", "B", "C"] }, P)), "2 findings, 3 open-risks");
});

test("one of each is singular", () => {
  assert.equal(countsLine({ findings: 1, openRisks: 1 }), "1 finding, 1 open-risk");
});

test("out-of-scope does not take a plural", () => {
  assert.equal(countsLine({ outOfScope: 2 }), "2 out-of-scope");
});

test("a clean review reports nothing", () => {
  assert.equal(countsLine(envelopeCounts({ summary: "approved" }, P)), "");
});

test("the order is findings, out-of-scope, open-risks", () => {
  assert.equal(
    countsLine({ findings: 1, outOfScope: 1, openRisks: 1 }),
    "1 finding, 1 out-of-scope, 1 open-risk",
  );
});

// ------------------------------------------------------- transport and identity

/*
 * Run 14: the count was right and the strings were dropped, so the orchestrator
 * opened the artefact fourteen times to read two sentences this process had
 * already parsed. These cases fix the identity and the rendering, because the id
 * is what `for_risks` and `resolved_risks` refer to for the rest of the run.
 */
test("each risk is identified by run, artefact and position", () => {
  const c = envelopeCounts({ open_risks: ["first", "second"] }, "9a6766-04");
  assert.deepEqual(c.openRiskItems, [
    { id: "9a6766-04-1", text: "first" },
    { id: "9a6766-04-2", text: "second" },
  ]);
});

// The whole reason the runId is in there rather than a bare counter.
test("two runs at the same artefact number do not collide", () => {
  const a = envelopeCounts({ open_risks: ["x"] }, "9a6766-04").openRiskItems![0].id;
  const b = envelopeCounts({ open_risks: ["x"] }, "3f10bd-04").openRiskItems![0].id;
  assert.notEqual(a, b);
});

test("an envelope with no risks carries no items rather than an empty array", () => {
  assert.equal(envelopeCounts({ open_risks: [] }, P).openRiskItems, undefined);
  assert.equal(envelopeCounts({ summary: "ok" }, P).openRiskItems, undefined);
});

// The count is the length of what was submitted; the items are what can be
// carried. A blank entry is dropped and the ones after it keep their index, so
// an id always points at the same line of the artefact it came from.
// The id keeps its source position so it still points at the right line of the
// artefact. The count reports what is actionable — announcing two above one line
// would send the orchestrator to the artefact looking for the other one, which is
// the cost the transport exists to remove.
test("a blank entry is not carried, does not shift the ids after it, and is not counted", () => {
  const c = envelopeCounts({ open_risks: ["  ", "real"] }, P);
  assert.equal(c.openRisks, 1);
  assert.deepEqual(c.openRiskItems, [{ id: "9a6766-04-2", text: "real" }]);
});

test("the head line never announces more risks than the block beneath it carries", () => {
  const c = envelopeCounts({ open_risks: ["", "a", "  ", "b"] }, P);
  assert.equal(countsLine(c), "2 open-risks");
  assert.equal(riskLines(c.openRiskItems).split("\n").length, 2);
});

test("the text is trimmed and not otherwise altered", () => {
  const long = "x".repeat(600);
  const c = envelopeCounts({ open_risks: [`  ${long}  `] }, P);
  assert.equal(c.openRiskItems![0].text, long);
});

/*
 * No truncation. A 300-character limit was proposed and refused: the clause a
 * reviewer uses to say what it could not establish comes last, and it is
 * exactly the clause that decides whether the concern is a bounded lookup or an
 * inventory. Run 14's longest risk was 340 characters, so the limit would have
 * bitten on real data in its first run.
 */
test("a long risk reaches the head line whole", () => {
  const long = "y".repeat(1000);
  assert.equal(riskLines([{ id: "9a6766-04-1", text: long }]), `  9a6766-04-1  ${long}`);
});

test("the head block is one indented line per risk", () => {
  assert.equal(
    riskLines([
      { id: "9a6766-04-1", text: "first" },
      { id: "9a6766-04-2", text: "second" },
    ]),
    "  9a6766-04-1  first\n  9a6766-04-2  second",
  );
});

test("nothing to report renders nothing", () => {
  assert.equal(riskLines(undefined), "");
  assert.equal(riskLines([]), "");
});

// Not truncation: a newline inside a risk would produce a second line
// indistinguishable from the next risk's.
test("a newline inside a risk is collapsed so one risk stays one line", () => {
  const out = riskLines([{ id: "9a6766-04-1", text: "a\n  b\tc" }]);
  assert.equal(out, "  9a6766-04-1  a b c");
  assert.equal(out.split("\n").length, 1);
});

// ------------------------------------------------- l'action d'une review

/*
 * La frontière est un verdict, pas un volume.
 *
 * Run 15 : `top_priority` sur 3 des 3 `needs_rework` et sur 0 des 17
 * `approved`. Le champ est déjà une instruction de reprise en tout sauf le nom.
 * Les findings voyagent avec lui parce qu'une reprise écrite depuis la seule
 * priorité laisse le second défaut pour un second aller-retour — l'artefact 29
 * a été rouvert trois fois et il portait deux findings.
 */
const FINDING = {
  severity: "HIGH",
  confidence: "certain",
  location: "checkpoint_io.py:112",
  issue: "write_parquet_guarded drops the partition_strategy switch",
  fix: "restore the coalesce/repartition branch",
};

test("une review approuvée ne porte aucune action", () => {
  assert.equal(
    reviewAction({ top_priority: "corriger la docstring", findings: [FINDING] }, "approved"),
    undefined,
  );
});

test("needs_rework porte la priorité et les findings", () => {
  const a = reviewAction({ top_priority: "restaurer le switch", findings: [FINDING] }, "needs_rework");
  assert.equal(a?.topPriority, "restaurer le switch");
  assert.equal(a?.findings?.length, 1);
  assert.equal(a?.findings?.[0].location, "checkpoint_io.py:112");
});

// Keyée sur `!== approved` et non sur la liste des verdicts qui demandent du
// travail : c'est ainsi qu'un quatrième verdict se ferait oublier plus tard.
test("blocked porte l'action comme needs_rework", () => {
  assert.ok(reviewAction({ top_priority: "arrêter", findings: [FINDING] }, "blocked"));
});

test("un verdict absent ne porte rien", () => {
  assert.equal(reviewAction({ top_priority: "x", findings: [FINDING] }, undefined), undefined);
});

test("une review sans priorité ni finding ne porte rien", () => {
  assert.equal(reviewAction({ findings: [] }, "needs_rework"), undefined);
  assert.equal(reviewAction({ top_priority: "   " }, "needs_rework"), undefined);
});

test("un finding sans texte exploitable est écarté", () => {
  const a = reviewAction(
    { findings: [{ severity: "LOW", confidence: "possible", location: "a.py:1" }] },
    "needs_rework",
  );
  assert.equal(a, undefined);
});

test("l'instruction vient avant le diagnostic qui la fonde", () => {
  const out = actionLines(reviewAction(
    { top_priority: "restaurer le switch", findings: [FINDING] }, "needs_rework"));
  const lines = out.split("\n");
  assert.ok(lines[0].startsWith("  → restaurer le switch"));
  assert.ok(lines[1].includes("HIGH certain"));
  assert.ok(lines[1].includes("checkpoint_io.py:112"));
  assert.ok(lines[1].includes(" — restore the coalesce/repartition branch"));
});

test("rien à porter rend une chaîne vide", () => {
  assert.equal(actionLines(undefined), "");
});

// Même raison que pour les risques : un saut de ligne dans une issue produirait
// une seconde ligne indistinguable du finding suivant.
test("un finding reste sur une ligne quoi qu'il contienne", () => {
  const out = actionLines(reviewAction(
    { findings: [{ ...FINDING, issue: "a\n  b\tc" }] }, "needs_rework"));
  assert.equal(out.split("\n").length, 1);
  assert.ok(out.includes("a b c"));
});

// Les findings ne sont référencés par rien — ni `for_findings`, ni un second
// registre. Une identité serait un contrat sans consommateur.
test("un finding ne porte aucun identifiant", () => {
  const a = reviewAction({ findings: [FINDING] }, "needs_rework");
  assert.deepEqual(Object.keys(a!.findings![0]).sort(),
    ["confidence", "fix", "issue", "location", "severity"]);
});

test("rien n'est tronqué, quelle que soit la longueur", () => {
  const long = "z".repeat(1200);
  const out = actionLines(reviewAction({ findings: [{ ...FINDING, issue: long }] }, "needs_rework"));
  assert.ok(out.includes(long));
});
