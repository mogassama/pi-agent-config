/**
 * L'orchestrateur choisit l'unité, le runtime dérive le reste.
 *
 * Ces cas figent la distinction entre sélection et identité. Le run 15
 * annotait 14/14 sur les workers et 0 sur vingt reviewers et onze scouts — 38 %
 * du temps de délégation hors mesure — parce que la guideline ne demandait
 * l'annotation qu'aux workers. Une phrase de plus n'aurait fait qu'ajouter une
 * chose à oublier : la sonde S a mesuré ce que vaut une interdiction en prose,
 * une fois sur trois.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveLane, laneOfRisks, targetWorkUnit } from "../subagent-only/lane-context.ts";
import { openRisks } from "../subagent-only/risk-ledger.ts";
import type { RiskRecord } from "../subagent-only/risk-ledger.ts";

const ROOTS = { runId: "9a6766", root: "/repo" };
const ledgerWith = (...pairs: Array<[string, string | undefined]>): RiskRecord[] => {
  let l: RiskRecord[] = [];
  for (const [id, unit] of pairs) {
    l = openRisks(l, [{ id, text: `text ${id}` }], `${id}-reviewer.json`, unit).ledger;
  }
  return l;
};

// ------------------------------------------------------------ dérivation

test("la lane porte le run et l'unité", () => {
  const lane = deriveLane("W06", ROOTS);
  assert.equal(lane.laneId, "9a6766-W06");
  assert.equal(lane.workUnitId, "W06");
});

// Deux runs ne se marchent pas dessus, comme pour les identifiants de risque.
test("deux runs ne produisent pas la même lane pour la même unité", () => {
  assert.notEqual(
    deriveLane("W06", ROOTS).laneId,
    deriveLane("W06", { runId: "3f10bd", root: "/repo" }).laneId,
  );
});

// Au lot 1 il n'y a pas de worktree : la forme est complète, le lot 2 substitue.
test("sans worktree, la lane travaille à la racine et sur aucune branche", () => {
  const lane = deriveLane("W06", ROOTS);
  assert.equal(lane.cwd, "/repo");
  assert.equal(lane.branch, "");
});

// ------------------------------------------------- résolution par les risques

test("un risque ramène à l'unité de la review qui l'a ouvert", () => {
  const l = ledgerWith(["r1", "W06"]);
  assert.equal(laneOfRisks(["r1"], l), "W06");
});

test("plusieurs risques d'une même unité ramènent à cette unité", () => {
  const l = ledgerWith(["r1", "W06"], ["r2", "W06"]);
  assert.equal(laneOfRisks(["r1", "r2"], l), "W06");
});

// Deviner en prendrait une au hasard, et l'ordre des identifiants n'est pas une
// information. Pas de lane vaut mieux qu'une mauvaise lane.
test("des risques de deux unités ne donnent aucune lane", () => {
  const l = ledgerWith(["r1", "W06"], ["r2", "W08"]);
  assert.equal(laneOfRisks(["r1", "r2"], l), undefined);
});

test("un risque ouvert hors de toute unité ne rattache rien", () => {
  const l = ledgerWith(["r1", undefined]);
  assert.equal(laneOfRisks(["r1"], l), undefined);
});

test("un identifiant inconnu du registre ne rattache rien", () => {
  assert.equal(laneOfRisks(["fantôme"], ledgerWith(["r1", "W06"])), undefined);
});

test("un identifiant inconnu n'empêche pas les autres de conclure", () => {
  const l = ledgerWith(["r1", "W06"]);
  assert.equal(laneOfRisks(["r1", "fantôme"], l), "W06");
});

test("aucun risque ne donne aucune lane", () => {
  assert.equal(laneOfRisks([], ledgerWith(["r1", "W06"])), undefined);
});

// ------------------------------------------------------------- la cible

/*
 * `for_risks` ne dit pas « je pars de cette unité » mais « je poursuis une
 * review restée ouverte sur ce risque ». Le risque a une provenance factuelle,
 * et une déclaration qui la contredit enverrait la continuation dans le mauvais
 * worktree. La première version laissait la déclaration gagner.
 */
test("sans risque, la déclaration décide", () => {
  assert.deepEqual(targetWorkUnit("W08", [], []),
    { kind: "unit", workUnitId: "W08", from: "declared" });
});

test("sans déclaration, la provenance des risques décide", () => {
  const l = ledgerWith(["r1", "W06"]);
  assert.deepEqual(targetWorkUnit(undefined, ["r1"], l),
    { kind: "unit", workUnitId: "W06", from: "provenance" });
  assert.deepEqual(targetWorkUnit("   ", ["r1"], l),
    { kind: "unit", workUnitId: "W06", from: "provenance" });
});

test("une déclaration qui confirme la provenance passe", () => {
  const l = ledgerWith(["r1", "W06"]);
  assert.deepEqual(targetWorkUnit("W06", ["r1"], l),
    { kind: "unit", workUnitId: "W06", from: "declared" });
});

test("une déclaration qui contredit la provenance est refusée", () => {
  const l = ledgerWith(["r1", "W06"]);
  const t = targetWorkUnit("W08", ["r1"], l);
  assert.equal(t.kind, "conflict");
  assert.match(t.kind === "conflict" ? t.reason : "", /W08.*W06/);
});

test("des risques de deux unités sont refusés, pas arbitrés", () => {
  const l = ledgerWith(["r1", "W06"], ["r2", "W08"]);
  const t = targetWorkUnit(undefined, ["r1", "r2"], l);
  assert.equal(t.kind, "conflict");
});

// Même refus quand une déclaration est là : elle ne tranche pas entre deux
// provenances, elle en ajoute une troisième.
test("une déclaration ne tranche pas entre deux provenances", () => {
  const l = ledgerWith(["r1", "W06"], ["r2", "W08"]);
  assert.equal(targetWorkUnit("W06", ["r1", "r2"], l).kind, "conflict");
});

test("un risque hors unité laisse la déclaration décider", () => {
  const l = ledgerWith(["r1", undefined]);
  assert.deepEqual(targetWorkUnit("W08", ["r1"], l),
    { kind: "unit", workUnitId: "W08", from: "declared" });
});

test("ni déclaration ni risque ne donne aucune unité", () => {
  assert.deepEqual(targetWorkUnit(undefined, [], []), { kind: "none" });
});
