/**
 * Les règles d'admission d'un appel, éprouvées plutôt que grepées.
 *
 * Elles vivaient dans `execute()`, où seule une vérification d'installation
 * pouvait constater qu'un symbole était présent. Un `grep` ne démontre pas
 * qu'un scout global passe pendant qu'un worker sans lane est refusé : ce sont
 * des propriétés, et les critères de ce lot les nomment une par une.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTaskCall, type CallShape } from "../subagent-only/task-policy.ts";

const call = (over: Partial<CallShape>): CallShape => ({
  agent: "worker",
  plannedMode: true,
  hasTask: true,
  hasBatch: false,
  ...over,
});
const refus = (c: CallShape) => {
  const r = validateTaskCall(c);
  assert.equal(r.ok, false, `attendu un refus pour ${JSON.stringify(c)}`);
  return r.ok === false ? r.reason : "";
};
const passe = (c: CallShape) => assert.equal(validateTaskCall(c).ok, true, JSON.stringify(c));

// ------------------------------------------------------------- la forme

test("`task` et `batch` ensemble sont refusés", () => {
  assert.match(refus(call({ hasTask: true, hasBatch: true })), /exclusifs/);
});

test("ni l'un ni l'autre est refusé", () => {
  assert.match(refus(call({ hasTask: false, hasBatch: false })), /il faut/);
});

test("`task` seul passe", () => {
  passe(call({ hasTask: true, hasBatch: false, resolvedWorkUnit: "W01" }));
});

test("`batch` seul passe pour un worker", () => {
  passe(call({ agent: "worker", hasTask: false, hasBatch: true }));
});

// Les reviews restent unitaires en 3a : c'est ce qui garde les intégrations
// naturellement ordonnées, sans file de merge.
for (const role of ["reviewer", "scout", "advisor"]) {
  test(`\`batch\` est refusé à ${role}`, () => {
    assert.match(refus(call({ agent: role, hasTask: false, hasBatch: true })), /qu'au worker/);
  });
}

test("`batch` avec un `work_unit` en trop est refusé", () => {
  assert.match(
    refus(call({ hasTask: false, hasBatch: true, declaredWorkUnit: "W01" })),
    /en trop/,
  );
});

// --------------------------------------------------------- mode planifié

test("un worker qui nomme son unité passe", () => {
  passe(call({ agent: "worker", resolvedWorkUnit: "W01", declaredWorkUnit: "W01" }));
});

test("un worker sans unité est refusé quand un plan existe", () => {
  assert.match(refus(call({ agent: "worker" })), /doit nommer son `work_unit`/);
});

test("un reviewer qui nomme son unité passe", () => {
  passe(call({ agent: "reviewer", resolvedWorkUnit: "W01", declaredWorkUnit: "W01" }));
});

test("un reviewer sans unité est refusé quand un plan existe", () => {
  assert.match(refus(call({ agent: "reviewer" })), /doit nommer son `work_unit`/);
});

/*
 * L'unité résolue suffit : elle peut venir de la provenance des risques plutôt
 * que d'une déclaration.
 *
 * Sans ce cas, on réintroduirait par la porte de derrière l'obligation de
 * déclarer que tout le lot 1 a construite pour la supprimer — un reviewer de
 * continuation n'a aucune raison de répéter une unité que ses risques portent
 * déjà.
 */
test("une unité dérivée vaut une unité déclarée", () => {
  passe(call({ agent: "reviewer", resolvedWorkUnit: "W06", declaredWorkUnit: undefined }));
  passe(call({ agent: "worker", resolvedWorkUnit: "W06", declaredWorkUnit: undefined }));
});

// Ils ne possèdent rien et ne modifient rien : c'est une capacité qu'on garde.
test("un scout global reste possible malgré le plan", () => {
  passe(call({ agent: "scout" }));
});

test("un advisor global reste possible malgré le plan", () => {
  passe(call({ agent: "advisor" }));
});

// Un lot porte ses unités dans ses entrées ; le scheduler les admet une par une.
test("un lot n'a pas à nommer d'unité au niveau de l'appel", () => {
  passe(call({ agent: "worker", hasTask: false, hasBatch: true }));
});

// ------------------------------------------------------------ mode libre

/*
 * Sans plan exploitable, tout reste possible. C'est l'invariant du chantier :
 * pi doit fonctionner à l'identique sans bundle et sans plan, et les lanes ne
 * doivent pas devenir la condition de son fonctionnement.
 */
test("sans plan, un worker sans unité passe", () => {
  passe(call({ agent: "worker", plannedMode: false }));
});

test("sans plan, un reviewer sans unité passe", () => {
  passe(call({ agent: "reviewer", plannedMode: false }));
});

// La forme, elle, est jugée dans les deux régimes : un appel sans instruction
// n'a pas de sens, plan ou pas.
test("sans plan, la forme reste jugée", () => {
  assert.match(refus(call({ plannedMode: false, hasTask: true, hasBatch: true })), /exclusifs/);
  assert.match(refus(call({ plannedMode: false, hasTask: false, hasBatch: false })), /il faut/);
  assert.match(
    refus(call({ plannedMode: false, agent: "reviewer", hasTask: false, hasBatch: true })),
    /qu'au worker/,
  );
});
