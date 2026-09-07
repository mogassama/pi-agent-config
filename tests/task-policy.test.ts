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

// ------------------------------------------------ le rôle d'intégration

const integ = (extra: Partial<CallShape> = {}): CallShape => ({
  agent: "integration-worker",
  plannedMode: true,
  hasTask: true,
  hasBatch: false,
  resolvedWorkUnit: "W03",
  declaredWorkUnit: "W03",
  integrationPhase: "resolving",
  ...extra,
});

test("integration-worker passe quand une tentative est ouverte", () => {
  assert.equal(validateTaskCall(integ()).ok, true);
});

test("integration-worker sans tentative est refusé", () => {
  const r = validateTaskCall(integ({ integrationPhase: undefined }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /aucune tentative d'intégration/);
});

test("integration-worker sans unité est refusé", () => {
  const r = validateTaskCall(integ({ resolvedWorkUnit: undefined, declaredWorkUnit: undefined }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /doit déclarer son/);
});

test("integration-worker sur une unité seulement dérivée est refusé", () => {
  /*
   * `resolvedWorkUnit` peut venir de la provenance des risques : un appel qui
   * porte `for_risks` rattachés à W03 en hérite sans l'avoir nommée. La
   * dérivation existe pour le reviewer de continuation ; une résolution de
   * conflit n'est jamais une continuation, et laisser deviner l'unité ferait
   * résoudre le conflit de quelqu'un d'autre.
   */
  const r = validateTaskCall(integ({ declaredWorkUnit: undefined }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /doit déclarer son/);
});

test("integration-worker est refusé dès que le commit existe", () => {
  for (const phase of ["ready-to-land", "recovery-required"] as const) {
    const r = validateTaskCall(integ({ integrationPhase: phase }));
    assert.equal(r.ok, false, phase);
    if (!r.ok) assert.match(r.reason, /il n'y a plus de conflit à résoudre/);
  }
});

test("aucune délégation sur une unité dont la tentative a déjà commité", () => {
  for (const agent of ["worker", "reviewer", "scout"]) {
    const r = validateTaskCall({
      agent, plannedMode: true, hasTask: true, hasBatch: false,
      resolvedWorkUnit: "W03", declaredWorkUnit: "W03",
      integrationPhase: "recovery-required",
    });
    assert.equal(r.ok, false, agent);
    if (!r.ok) assert.match(r.reason, /tant qu'elle n'est pas reprise/);
  }
});

test("integration-worker en lot est refusé", () => {
  const r = validateTaskCall(integ({ hasTask: false, hasBatch: true, resolvedWorkUnit: undefined, declaredWorkUnit: undefined }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /une tentative à la fois|batch/);
});

test("integration-worker n'existe pas en régime libre", () => {
  /*
   * Contrairement à tous les autres rôles. Ils gardent un sens sans plan — pi
   * fonctionne à l'identique sans bundle — mais celui-ci n'en a aucun : sans
   * lane, sans gel et sans contexte, il n'y a pas de rencontre à résoudre.
   */
  const r = validateTaskCall(integ({ plannedMode: false, integrationPhase: undefined }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /aucune tentative d'intégration/);
});

test("le worker est refusé pendant qu'une tentative vit", () => {
  const r = validateTaskCall({
    agent: "worker", plannedMode: true, hasTask: true, hasBatch: false,
    resolvedWorkUnit: "W03", integrationPhase: "resolving",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /tentative d'intégration est ouverte/);
});

test("le reviewer passe pendant une tentative : c'est lui qui la revoit", () => {
  /*
   * Une première version le refusait aussi, au motif qu'il est lié à la lane.
   * Elle rendait le flux impossible : la résolution doit être revue, et le
   * runtime donne alors au reviewer le contexte d'intégration au lieu de la
   * lane. Il change d'objet, pas de droit.
   */
  assert.equal(
    validateTaskCall({
      agent: "reviewer", plannedMode: true, hasTask: true, hasBatch: false,
      resolvedWorkUnit: "W03", integrationPhase: "resolving",
    }).ok,
    true,
  );
});

test("un scout reste global même pendant une tentative", () => {
  // Il ne possède rien et ne modifie rien : la tentative ne le concerne pas.
  assert.equal(
    validateTaskCall({
      agent: "scout", plannedMode: true, hasTask: true, hasBatch: false,
      resolvedWorkUnit: "W03", integrationPhase: "resolving",
    }).ok,
    true,
  );
});
