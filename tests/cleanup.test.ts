/**
 * cleanup.test.ts — le plan avant les effets.
 *
 * Le nettoyage ne prend aucune décision : ce qui est rangeable a été établi par
 * les réconciliations. Ces tests portent donc sur la traduction et sur l'ordre,
 * pas sur des règles — celles-ci sont testées là où elles vivent.
 *
 * L'invariant transversal vaut ici plus qu'ailleurs : rien ne se supprime qui
 * porte du contenu qu'aucune autre référence ne désigne.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCleanup, planCleanup, type CleanupPlan } from "../subagent-only/cleanup.ts";
import type { Reconciliation, Conflict } from "../subagent-only/lane-ledger.ts";
import type { IntegrationReconciliation } from "../subagent-only/integration-ledger.ts";

function lanes(over: Partial<Reconciliation> = {}): Reconciliation {
  return {
    states: new Map(),
    openUnits: new Set(),
    integrated: new Set(),
    cleanableBranches: new Set(),
    cleanableWorktrees: new Set(),
    conflicts: new Map<string, Conflict>(),
    reserved: new Set(),
    warnings: [],
    ...over,
  } as Reconciliation;
}

function integrations(over: Partial<IntegrationReconciliation> = {}): IntegrationReconciliation {
  return {
    phases: new Map(),
    integrated: new Set(),
    conflicts: [],
    warnings: [],
    residues: [],
    ...over,
  };
}

// --------------------------------------------------------------- le plan

test("une intégration prouvée rend son worktree et sa branche rangeables", () => {
  const plan = planCleanup(lanes({
    integrated: new Set(["W01"]),
    cleanableWorktrees: new Set(["W01"]),
    cleanableBranches: new Set(["W01"]),
    states: new Map([["W01", "integrated"]]),
  }));
  assert.deepEqual(plan.laneWorktrees, ["W01"]);
  assert.deepEqual(plan.laneBranches, ["W01"]);
  assert.deepEqual(plan.retained, []);
});

test("une intégration sans preuve durable conserve sa branche, et le dit", () => {
  // La branche *est* la preuve. Le worktree propre, lui, est du ménage.
  const plan = planCleanup(lanes({
    integrated: new Set(["W01"]),
    cleanableWorktrees: new Set(["W01"]),
    states: new Map([["W01", "integrated"]]),
  }));
  assert.deepEqual(plan.laneWorktrees, ["W01"]);
  assert.deepEqual(plan.laneBranches, []);
  assert.match(plan.retained[0].reason, /sa branche est la preuve/);
});

test("un abandon conserve sa branche, et le dit", () => {
  const plan = planCleanup(lanes({
    cleanableWorktrees: new Set(["W02"]),
    states: new Map([["W02", "abandoned"]]),
  }));
  assert.deepEqual(plan.laneWorktrees, ["W02"]);
  assert.deepEqual(plan.laneBranches, []);
  assert.match(plan.retained[0].reason, /seule référence vers son travail/);
});

test("une contradiction retient tout ce qui la porte", () => {
  const plan = planCleanup(lanes({
    cleanableBranches: new Set(["W03"]),
    conflicts: new Map([["W03", {
      kind: "residu-sale", workUnitId: "W03", detail: "worktree sale",
    } as Conflict]]),
  }));
  assert.deepEqual(plan.laneBranches, [], "on ne range pas autour d'une contradiction");
  assert.match(plan.retained[0].reason, /contradiction non tranchée/);
});

test("les contextes terminaux sont rangeables, les vivants jamais", () => {
  const plan = planCleanup(lanes(), integrations({
    residues: ["r-W01-3"],
    phases: new Map([["W05", { id: "r-W05-9", phase: "resolving" }]]),
  }));
  assert.deepEqual(plan.integrationContexts, ["r-W01-3"]);
  assert.ok(plan.retained.some((r) => r.object === "r-W05-9" && /tentative vivante/.test(r.reason)));
});

test("une contradiction de tentative retient son contexte", () => {
  const plan = planCleanup(lanes(), integrations({
    conflicts: [{
      kind: "contexte-sans-provenance", attemptId: "r-W07-2",
      detail: "aucun événement ne l'a ouvert",
    }],
  }));
  assert.deepEqual(plan.integrationContexts, []);
  assert.match(plan.retained[0].reason, /contradiction non tranchée/);
});

// ------------------------------------------------------------- les effets

/** Un faux git : on observe l'ordre et on choisit les échecs. */
function faux(echecs: string[] = []) {
  const appels: string[] = [];
  return {
    appels,
    removeLane: (_r: string, id: string) => {
      appels.push(`worktree ${id}`);
      return !echecs.includes(`worktree ${id}`);
    },
    removeLaneBranch: (_r: string, id: string) => {
      appels.push(`branche ${id}`);
      return !echecs.includes(`branche ${id}`);
    },
    removeIntegration: (_r: string, id: string) => {
      appels.push(`contexte ${id}`);
      return !echecs.includes(`contexte ${id}`);
    },
  };
}

const plan = (over: Partial<CleanupPlan> = {}): CleanupPlan => ({
  laneWorktrees: [], laneBranches: [], integrationContexts: [], retained: [], ...over,
});

test("le worktree part avant la branche, jamais l'inverse", () => {
  /*
   * Tant que le worktree est là, il peut porter quelque chose. Retirer la
   * branche d'abord échangerait une preuve contre un résidu — et git refuse de
   * toute façon une branche dont un worktree dépend.
   */
  const g = faux();
  applyCleanup("/r", "run1", plan({ laneWorktrees: ["W01"], laneBranches: ["W01"] }), g);
  assert.deepEqual(g.appels, ["worktree run1-W01", "branche run1-W01"]);
});

test("un worktree qu'on n'a pas pu retirer garde sa branche", () => {
  const g = faux(["worktree run1-W01"]);
  const out = applyCleanup("/r", "run1", plan({
    laneWorktrees: ["W01"], laneBranches: ["W01"],
  }), g);
  assert.deepEqual(g.appels, ["worktree run1-W01"], "la branche n'est même pas tentée");
  assert.deepEqual(out.removedBranches, []);
  assert.equal(out.failures.length, 2);
  assert.match(out.failures[1].reason, /la branche reste avec lui/);
});

test("un échec n'interrompt pas le reste du plan", () => {
  // Rien n'est perdu : pour une unité intégrée, M reste la preuve. L'objet est
  // rapporté comme conservé, ce qu'il est.
  const g = faux(["worktree run1-W01"]);
  const out = applyCleanup("/r", "run1", plan({
    laneWorktrees: ["W01", "W02"], integrationContexts: ["run1-W03-4"],
  }), g);
  assert.deepEqual(out.removedWorktrees, ["run1-W02"]);
  assert.deepEqual(out.removedContexts, ["run1-W03-4"]);
  assert.equal(out.failures.length, 1);
});

test("une branche sans worktree au plan se retire directement", () => {
  const g = faux();
  const out = applyCleanup("/r", "run1", plan({ laneBranches: ["W01"] }), g);
  assert.deepEqual(g.appels, ["branche run1-W01"]);
  assert.deepEqual(out.removedBranches, ["pi-lane/run1-W01"]);
});

test("un plan vide ne touche à rien", () => {
  const g = faux();
  const out = applyCleanup("/r", "run1", plan(), g);
  assert.deepEqual(g.appels, []);
  assert.deepEqual(out, {
    removedWorktrees: [], removedBranches: [], removedContexts: [], failures: [],
  });
});
