/**
 * integration-ledger.test.ts — ce que le registre affirme, et ce que le dépôt
 * en dit.
 *
 * Le fold lit les faits ; la réconciliation croise quatre vérités — le registre,
 * les contextes présents, leur état git, et le registre des lanes. Aucun
 * événement n'est inventé pour décrire une contradiction : une contradiction
 * découverte ici produit un état effectif, jamais une ligne.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  foldIntegrations,
  isActive,
  reconcileIntegrations,
  type IntegrationEvent,
  type IntegrationObservations,
} from "../subagent-only/integration-ledger.ts";

const ID = "r1-W03-7";  // attemptId("r1", "W03", 7)
const P1 = "a".repeat(40);
const P2 = "b".repeat(40);
const M = "c".repeat(40);
const T = "d".repeat(40);

const ouverte = (id = ID, unit = "W03", p1 = P1, p2 = P2): IntegrationEvent => ({
  event: "ATTEMPT_OPENED", id, work_unit: unit, seq: 7, p1, p2,
  conflicts: ["src/a.py"], at: "t",
});
const commit = (id = ID, c = M, t = T): IntegrationEvent =>
  ({ event: "COMMITTED", id, commit: c, tree: t, at: "t" });

/** Le dépôt dans l'état où le runtime l'a laissé, sauf mention contraire. */
function obs(over: Partial<IntegrationObservations> = {}): IntegrationObservations {
  return {
    contexts: [ID],
    head: { [ID]: P1 },
    mergeHead: { [ID]: P2 },
    mergeShapeOk: { [M]: true },
    landed: [],
    laneIntegrated: {},
    ...over,
  };
}

// ---------------------------------------------------------------- le fold

test("le fold rattache chaque fait à sa tentative", () => {
  const { attempts, inconsistencies } = foldIntegrations([
    ouverte(),
    commit(),
    { event: "CLOSED", id: ID, outcome: "integrated", at: "t" },
  ]);
  assert.deepEqual(inconsistencies, []);
  const a = attempts.get(ID)!;
  assert.equal(a.workUnit, "W03");
  assert.equal(a.p1, P1);
  assert.deepEqual(a.committed, { commit: M, tree: T });
  assert.equal(a.closed, "integrated");
  assert.equal(isActive(a), false);
});

test("un fait sans ouverture est une incohérence, pas un silence", () => {
  /*
   * `COMMITTED I7` sans son ouverture ne veut pas dire « rien » : il veut dire
   * que le journal contient un fait qu'on ne sait pas rattacher. L'ignorer
   * faisait disparaître l'anomalie dès qu'aucun contexte `I7` n'existait sur le
   * disque, c'est-à-dire exactement quand elle était la seule trace.
   */
  const f = foldIntegrations([commit("jamais-ouverte")]);
  assert.equal(f.attempts.size, 0);
  assert.match(f.inconsistencies[0], /qu'aucune ouverture ne précède/);
});

test("une identité qui ne se calcule pas est une incohérence", () => {
  // `id == attemptId(runId, work_unit, seq)`. Sans ce contrôle, une ligne
  // pouvait annoncer `run-W03-4` pour `W09` au tour 82 et passer pour bien
  // formée : la provenance devenait déclarative.
  const menteuse: IntegrationEvent = { ...ouverte("r1-W03-7", "W09"), seq: 82 };
  const f = foldIntegrations([menteuse], "r1");
  assert.equal(f.attempts.size, 0);
  assert.match(f.inconsistencies[0], /l'identité d'une tentative est calculée/);
  // Sans `runId`, la règle ne s'applique pas : on ne vérifie que ce qu'on sait.
  assert.equal(foldIntegrations([menteuse]).inconsistencies.length, 0);
});

test("une tentative ouverte deux fois est une incohérence", () => {
  const f = foldIntegrations([ouverte(), ouverte()], "r1");
  assert.equal(f.attempts.size, 1);
  assert.match(f.inconsistencies[0], /ouverte deux fois/);
});

test("une incohérence du journal ferme la porte", () => {
  const r = reconcileIntegrations([ouverte(), ouverte()], obs(), "r1");
  assert.equal(r.conflicts[0]?.kind, "journal-incoherent");
});

test("une tentative en reprise dont le contexte a disparu est une contradiction", () => {
  /*
   * `recovery-required` était traité avant la vérification du contexte : un
   * contexte supprimé sous une tentative bloquée produisait une phase et un
   * avertissement, là où les quatre vérités disent « registre : vivante,
   * disque : absente ».
   */
  const r = reconcileIntegrations(
    [ouverte(), { event: "RECOVERY_REQUIRED", id: ID, reason: "forme fausse", at: "t" }],
    obs({ contexts: [], head: {}, mergeHead: {} }),
  );
  assert.equal(r.conflicts[0]?.kind, "tentative-sans-contexte");
  assert.equal(r.phases.size, 0);
});

test("une tentative en reprise garde sa phase quand son contexte a bougé", () => {
  // Sa position n'est pas exigée : le commit qui a causé la reprise a déplacé
  // `HEAD` et fait disparaître `MERGE_HEAD`, et c'est ce qu'on vient regarder.
  const r = reconcileIntegrations(
    [ouverte(), { event: "RECOVERY_REQUIRED", id: ID, reason: "forme fausse", at: "t" }],
    obs({ head: { [ID]: M }, mergeHead: {} }),
  );
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.phases.get("W03")?.phase, "recovery-required");
});

// -------------------------------------------------------- le cas nominal

test("une tentative ouverte dont le contexte est intact est en résolution", () => {
  const r = reconcileIntegrations([ouverte()], obs());
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.phases.get("W03"), { id: ID, phase: "resolving" });
});

test("un commit non encore atterri attend son atterrissage", () => {
  const r = reconcileIntegrations([ouverte(), commit()], obs({ head: { [ID]: M } }));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.phases.get("W03"), { id: ID, phase: "ready-to-land" });
});

test("une reprise enregistrée est une phase, pas une contradiction", () => {
  const r = reconcileIntegrations(
    [ouverte(), { event: "RECOVERY_REQUIRED", id: ID, reason: "forme fausse", at: "t" }],
    obs(),
  );
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.phases.get("W03")?.phase, "recovery-required");
  assert.equal(r.warnings.length, 1);
});

// ------------------------------------------------------ les contradictions

test("un contexte sans provenance ferme la porte", () => {
  const r = reconcileIntegrations([], obs({ contexts: ["r1-W09-3"] }));
  assert.equal(r.conflicts[0]?.kind, "contexte-sans-provenance");
});

test("une tentative dont le contexte a disparu ferme la porte", () => {
  const r = reconcileIntegrations([ouverte()], obs({ contexts: [], head: {}, mergeHead: {} }));
  assert.equal(r.conflicts[0]?.kind, "tentative-sans-contexte");
  assert.equal(r.phases.size, 0);
});

test("un contexte déplacé ferme la porte", () => {
  const r = reconcileIntegrations([ouverte()], obs({ head: { [ID]: "e".repeat(40) } }));
  assert.equal(r.conflicts[0]?.kind, "contexte-deplace");
});

test("un merge disparu ferme la porte, et ne devient pas un commit", () => {
  /*
   * C'est le crash entre `git commit` et `COMMITTED` : le contexte porterait
   * `M` et plus aucun `MERGE_HEAD`. Reconstituer un `COMMITTED` serait écrire
   * un fait qu'on n'a pas observé.
   */
  const r = reconcileIntegrations([ouverte()], obs({ head: { [ID]: M }, mergeHead: {} }));
  assert.equal(r.conflicts[0]?.kind, "contexte-deplace");
  const memeBase = reconcileIntegrations([ouverte()], obs({ mergeHead: {} }));
  assert.equal(memeBase.conflicts[0]?.kind, "merge-perdu");
  assert.equal(memeBase.phases.size, 0);
});

test("un commit de mauvaise forme ferme la porte", () => {
  const r = reconcileIntegrations([ouverte(), commit()],
    obs({ head: { [ID]: M }, mergeShapeOk: { [M]: false } }));
  assert.equal(r.conflicts[0]?.kind, "commit-de-mauvaise-forme");
});

test("un commit absent de son contexte ferme la porte", () => {
  const r = reconcileIntegrations([ouverte(), commit()], obs());
  assert.equal(r.conflicts[0]?.kind, "commit-absent-du-contexte");
});

test("un M atterri sans preuve au registre des lanes ferme la porte", () => {
  /*
   * Le crash entre le `ff-only` et l'écriture d'`INTEGRATED`. Le travail est
   * intégré et rien ne le prouve. Surtout pas une tentative périmée à rouvrir :
   * `P1` × `P2` serait refait par-dessus un merge déjà présent.
   */
  const r = reconcileIntegrations([ouverte(), commit()],
    obs({ head: { [ID]: M }, landed: [M] }));
  assert.equal(r.conflicts[0]?.kind, "integration-non-enregistree");
  assert.equal(r.phases.size, 0, "et surtout pas ready-to-land");
});

test("deux tentatives vivantes pour une unité ferment la porte", () => {
  // Le crash entre `ATTEMPT_OPENED(I2)` et `SUPERSEDED(I1)`. Choisir la plus
  // récente serait une heuristique là où il faut une décision.
  const autre = "r1-W03-9";
  const r = reconcileIntegrations([ouverte(), ouverte(autre)], obs({
    contexts: [ID, autre],
    head: { [ID]: P1, [autre]: P1 },
    mergeHead: { [ID]: P2, [autre]: P2 },
  }));
  assert.equal(r.conflicts[0]?.kind, "tentatives-concurrentes");
});

// ------------------------------------------------- ce qui n'est pas grave

test("une intégration prouvée sans CLOSED reste intégrée, avec un avertissement", () => {
  /*
   * La vérité métier est déjà prouvée par une source plus forte. Un bookkeeping
   * terminal absent ne doit pas rebloquer une unité dont l'intégration est
   * durablement démontrée.
   */
  const r = reconcileIntegrations([ouverte(), commit()], obs({
    head: { [ID]: M }, landed: [M], laneIntegrated: { W03: M },
  }));
  assert.deepEqual(r.conflicts, []);
  assert.ok(r.integrated.has("W03"));
  assert.equal(r.phases.size, 0);
  assert.match(r.warnings[0], /sans être close/);
});

test("un contexte de tentative close est un résidu, pas une tentative", () => {
  for (const fin of [
    { event: "CLOSED", id: ID, outcome: "returned-to-lane", at: "t" },
    { event: "SUPERSEDED", id: ID, by: "r1-W03-9", at: "t" },
  ] as IntegrationEvent[]) {
    const r = reconcileIntegrations([ouverte(), fin], obs());
    assert.deepEqual(r.conflicts, []);
    assert.deepEqual(r.residues, [ID]);
    assert.equal(r.phases.size, 0);
  }
});

test("une tentative remplacée laisse la place à celle qui la remplace", () => {
  const suivante = "r1-W03-9";
  const r = reconcileIntegrations([
    ouverte(),
    ouverte(suivante),
    { event: "SUPERSEDED", id: ID, by: suivante, at: "t" },
  ], obs({
    contexts: [suivante],
    head: { [suivante]: P1 },
    mergeHead: { [suivante]: P2 },
  }));
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.phases.get("W03"), { id: suivante, phase: "resolving" });
});
