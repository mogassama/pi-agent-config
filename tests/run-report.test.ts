/**
 * run-report.test.ts — le relevé projette, il ne conclut pas.
 *
 * Trois propriétés, et elles se testent séparément parce qu'elles se cassent
 * séparément :
 *
 *   la projection    chaque champ vient d'une source nommée, et d'elle seule
 *   la pureté        construire un relevé ne sonde rien et ne compte rien
 *   le refus         ce qu'on n'a pas lu ne se publie pas comme vide
 *
 * Le troisième est le seul qui ait demandé une décision. `planCleanup` rend
 * `integrationContexts: []` quand il n'a pas reçu de réconciliation des
 * tentatives ; passer ce vide tel quel aurait fait dire au relevé qu'il n'y
 * avait aucun contexte, alors qu'on ne sait pas. Un relevé est précisément le
 * genre d'objet qu'on croit sur parole.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRunReport, formatRunReport } from "../subagent-only/run-report.ts";
import { planCleanup, type CleanupPlan } from "../subagent-only/cleanup.ts";
import { readGitInvocationCount } from "../subagent-only/git-probe-counter.ts";
import { LANE_LEDGER_VERSION } from "../subagent-only/run-manifest.ts";
import type { Conflict, Observations, Reconciliation } from "../subagent-only/lane-ledger.ts";
import type { LaneSnapshot } from "../subagent-only/lane-observe.ts";
import type { IntegrationSnapshot } from "../subagent-only/integration-observe.ts";
import type {
  IntegrationConflict,
  IntegrationReconciliation,
} from "../subagent-only/integration-ledger.ts";

const RUN = { runId: "r1", status: "active" as const };

function observations(over: Partial<Observations> = {}): Observations {
  return {
    openWorktrees: [],
    dirtyWorktrees: [],
    mergedUnits: [],
    runBranches: [],
    confirmedCommits: [],
    ...over,
  } as Observations;
}

function bilanLanes(over: Partial<Reconciliation> = {}): Reconciliation {
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

function lanes(over: Partial<LaneSnapshot> = {}): LaneSnapshot {
  return {
    read: { events: [], malformedLines: [], version: LANE_LEDGER_VERSION },
    bases: new Map(),
    observations: observations(),
    reconciliation: bilanLanes(),
    ...over,
  } as LaneSnapshot;
}

function bilanTentatives(over: Partial<IntegrationReconciliation> = {}): IntegrationReconciliation {
  return { phases: new Map(), integrated: new Set(), conflicts: [], warnings: [], residues: [], ...over };
}

function tentatives(over: Partial<IntegrationSnapshot> = {}): IntegrationSnapshot {
  return {
    read: { events: [], malformed: 0, malformedLines: [], version: 1 },
    facts: new Map(),
    contexts: [],
    observations: { contexts: [], head: {}, mergeHead: {}, mergeShapeOk: {}, landed: [], laneIntegrated: {} },
    reconciliation: bilanTentatives(),
    ...over,
  } as IntegrationSnapshot;
}

const planVide: CleanupPlan = {
  laneWorktrees: [],
  laneBranches: [],
  integrationContexts: [],
  retained: [],
};

const MESURE = { recovery_scan_ms: 12.5, git_probe_count: 7 };

// ------------------------------------------------------------- la projection

test("chaque champ du relevé vient de sa source, et d'elle seule", () => {
  const r = buildRunReport(
    RUN,
    lanes({
      observations: observations({
        openWorktrees: ["W09", "W03"],
        runBranches: ["W03"],
      }),
      reconciliation: bilanLanes({
        states: new Map([
          ["W03", "integrated"],
          ["W09", "open"],
          ["W12", "abandoned"],
        ]),
        openUnits: new Set(["W09"]),
        integrated: new Set(["W03"]),
      }),
    }),
    tentatives({ contexts: ["r1-W09-1"] }),
    planVide,
    MESURE,
  );

  assert.deepEqual(r.run, { run_id: "r1", status: "active" });
  assert.deepEqual(r.work_units.open, ["W09"]);
  assert.deepEqual(r.work_units.integrated, ["W03"]);
  assert.deepEqual(r.work_units.abandoned, ["W12"], "abandoned vient de states, pas d'un ensemble");
  assert.deepEqual(r.physical_state.lane_worktrees, ["W03", "W09"], "trié");
  assert.deepEqual(r.physical_state.integration_contexts, ["r1-W09-1"]);
  assert.equal(r.performance.recovery_scan_ms, 12.5);
  assert.equal(r.performance.git_probe_count, 7);
});

test("run_branch_count compte les branches observées, sans nouvelle sonde", () => {
  const avant = readGitInvocationCount();
  const r = buildRunReport(
    RUN,
    lanes({ observations: observations({ runBranches: ["W03", "W09"] }) }),
    tentatives(),
    planVide,
    MESURE,
  );
  assert.equal(r.performance.run_branch_count, 2);
  assert.equal(
    readGitInvocationCount(),
    avant,
    "construire un relevé n'a lancé aucun processus git",
  );
});

test("le statut du run n'est pas déduit : il vient tel quel du manifeste", () => {
  for (const status of ["planning", "active", "completed", "abandoned"] as const) {
    const r = buildRunReport({ runId: "r1", status }, lanes(), tentatives(), planVide, MESURE);
    assert.equal(r.run.status, status);
  }
});

test("les conflits restent séparés par provenance", () => {
  const r = buildRunReport(
    RUN,
    lanes({
      reconciliation: bilanLanes({
        conflicts: new Map([
          ["W03", { kind: "residu-sale", workUnitId: "W03", detail: "worktree sale" } as Conflict],
        ]),
      }),
    }),
    tentatives({
      reconciliation: bilanTentatives({
        conflicts: [
          { kind: "merge-perdu", attemptId: "r1-W09-1", workUnitId: "W09", detail: "M absent" },
        ] as IntegrationConflict[],
      }),
    }),
    planVide,
    MESURE,
  );

  assert.deepEqual(r.recovery.lane_conflicts, [
    { work_unit: "W03", kind: "residu-sale", detail: "worktree sale" },
  ]);
  assert.deepEqual(r.recovery.integration_conflicts, [
    { attempt: "r1-W09-1", work_unit: "W09", kind: "merge-perdu", detail: "M absent" },
  ]);
});

test("un avertissement dit d'où il vient", () => {
  const r = buildRunReport(
    RUN,
    lanes({ reconciliation: bilanLanes({ warnings: [{ workUnitId: "W03", detail: "résidu propre" }] }) }),
    tentatives({ reconciliation: bilanTentatives({ warnings: ["contexte clos sans retrait"] }) }),
    planVide,
    MESURE,
  );

  // Triés : la provenance est la première clé, donc `integrations` avant `lanes`.
  assert.deepEqual(r.recovery.warnings, [
    { source: "integrations", work_unit: null, detail: "contexte clos sans retrait" },
    { source: "lanes", work_unit: "W03", detail: "résidu propre" },
  ]);
});

// ------------------------------------------------------------------ le refus

test("registre des tentatives illisible : les champs qui en dépendent valent null", () => {
  /*
   * `planCleanup` sans réconciliation des tentatives rend `[]`. C'est ce vide-là
   * qu'il ne faut pas publier : il dit « je n'ai pas regardé », pas « il n'y a
   * rien ».
   */
  const plan = planCleanup(bilanLanes(), undefined);
  assert.deepEqual(plan.integrationContexts, [], "le plan, lui, rend bien un tableau vide");

  const r = buildRunReport(RUN, lanes(), undefined, plan, MESURE);
  assert.equal(r.physical_state.integration_contexts, null);
  assert.equal(r.cleanup.cleanable_contexts, null);
  assert.equal(r.recovery.integration_conflicts, null);
});

test("registre lisible et vraiment vide : des tableaux vides, pas null", () => {
  const r = buildRunReport(RUN, lanes(), tentatives(), planVide, MESURE);
  assert.deepEqual(r.physical_state.integration_contexts, []);
  assert.deepEqual(r.cleanup.cleanable_contexts, []);
  assert.deepEqual(r.recovery.integration_conflicts, []);
});

test("le texte dit l'inconnu comme inconnu, pas comme une absence", () => {
  const illisible = formatRunReport(
    buildRunReport(RUN, lanes(), undefined, planCleanup(bilanLanes(), undefined), MESURE),
  );
  assert.match(illisible, /contextes .*: inconnu/);
  assert.match(illisible, /registre illisible/);

  const vide = formatRunReport(buildRunReport(RUN, lanes(), tentatives(), planVide, MESURE));
  assert.doesNotMatch(vide, /inconnu/);
});

// ----------------------------------------------------------------- la pureté

test("mêmes entrées, même relevé — et rien n'a bougé entre les deux", () => {
  const l = lanes({ observations: observations({ openWorktrees: ["W09", "W03"] }) });
  const t = tentatives({ contexts: ["r1-W09-2", "r1-W09-1"] });

  const avant = readGitInvocationCount();
  const a = buildRunReport(RUN, l, t, planVide, MESURE);
  const b = buildRunReport(RUN, l, t, planVide, MESURE);

  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "l'ordre des clés aussi");
  assert.equal(readGitInvocationCount(), avant);
});

test("le tri ne dépend pas de l'ordre d'entrée", () => {
  const un = buildRunReport(
    RUN,
    lanes({ observations: observations({ openWorktrees: ["W09", "W03"] }) }),
    tentatives({ contexts: ["r1-W09-2", "r1-W09-1"] }),
    planVide,
    MESURE,
  );
  const deux = buildRunReport(
    RUN,
    lanes({ observations: observations({ openWorktrees: ["W03", "W09"] }) }),
    tentatives({ contexts: ["r1-W09-1", "r1-W09-2"] }),
    planVide,
    MESURE,
  );
  assert.equal(JSON.stringify(un), JSON.stringify(deux));
});

test("le relevé ne trie pas ce qu'il n'a pas trié : les entrées ne sont pas mutées", () => {
  const worktrees = ["W09", "W03"];
  const plan: CleanupPlan = {
    laneWorktrees: ["W09", "W03"],
    laneBranches: [],
    integrationContexts: [],
    retained: [],
  };
  buildRunReport(RUN, lanes({ observations: observations({ openWorktrees: worktrees }) }), tentatives(), plan, MESURE);
  assert.deepEqual(worktrees, ["W09", "W03"], "l'observation d'origine est intacte");
  assert.deepEqual(plan.laneWorktrees, ["W09", "W03"], "le plan d'origine est intact");
});

test("un même état logique, entré à l'envers, donne le même relevé octet pour octet", () => {
  /*
   * Le tri sur une seule clé passait ce test tant que deux entrées ne
   * partageaient pas leur première clé. Chacune des cinq collections a donc ici
   * deux entrées qui la partagent : c'est là, et seulement là, que l'ordre
   * d'entrée d'une `Map` ou d'un `readdir` traversait jusqu'au relevé.
   */
  const conflitsLanes: [string, Conflict][] = [
    ["W03", { kind: "residu-sale", workUnitId: "W03", detail: "b" } as Conflict],
    ["W03bis", { kind: "residu-sale", workUnitId: "W03", detail: "a" } as Conflict],
  ];
  const conflitsTentatives: IntegrationConflict[] = [
    { kind: "merge-perdu", attemptId: "A-1", workUnitId: "W09", detail: "second" },
    { kind: "merge-perdu", attemptId: "A-1", workUnitId: "W09", detail: "premier" },
  ];
  const avertissementsLanes = [
    { workUnitId: "W03", detail: "second" },
    { workUnitId: "W03", detail: "premier" },
  ];
  const avertissementsTentatives = ["second", "premier"];
  const retenus = [
    { object: "pi-lane/r1-W03", reason: "second" },
    { object: "pi-lane/r1-W03", reason: "premier" },
  ];

  const releve = (inverse: boolean) => {
    const ordre = <T,>(xs: T[]): T[] => (inverse ? [...xs].reverse() : [...xs]);
    return buildRunReport(
      RUN,
      lanes({
        reconciliation: bilanLanes({
          conflicts: new Map(ordre(conflitsLanes)),
          warnings: ordre(avertissementsLanes),
        }),
      }),
      tentatives({
        reconciliation: bilanTentatives({
          conflicts: ordre(conflitsTentatives),
          warnings: ordre(avertissementsTentatives),
        }),
      }),
      { ...planVide, retained: ordre(retenus) },
      MESURE,
    );
  };

  const premier = releve(false);
  const second = releve(true);
  assert.equal(
    JSON.stringify(premier),
    JSON.stringify(second),
    "un même état logique produit un relevé identique octet pour octet",
  );

  // Et les cinq entrées sont bien peuplées : un relevé vide passerait aussi.
  assert.equal(premier.recovery.lane_conflicts.length, 2);
  assert.equal(premier.recovery.integration_conflicts!.length, 2);
  assert.equal(premier.recovery.warnings.length, 4);
  assert.equal(premier.cleanup.retained.length, 2);
});

test("aucune entrée n'est triée en place, et aucun objet n'est partagé", () => {
  const conflitsTentatives: IntegrationConflict[] = [
    { kind: "merge-perdu", attemptId: "A-2", workUnitId: "W09", detail: "z" },
    { kind: "merge-perdu", attemptId: "A-1", workUnitId: "W09", detail: "a" },
  ];
  const avertissements = [
    { workUnitId: "W09", detail: "z" },
    { workUnitId: "W03", detail: "a" },
  ];
  const retenus = [
    { object: "b", reason: "seconde" },
    { object: "a", reason: "première" },
  ];
  const plan: CleanupPlan = {
    laneWorktrees: ["W09", "W03"],
    laneBranches: ["W09", "W03"],
    integrationContexts: ["r1-W09-2", "r1-W09-1"],
    retained: retenus,
  };

  const r = buildRunReport(
    RUN,
    lanes({ reconciliation: bilanLanes({ warnings: avertissements }) }),
    tentatives({ reconciliation: bilanTentatives({ conflicts: conflitsTentatives }) }),
    plan,
    MESURE,
  );

  assert.deepEqual(conflitsTentatives.map((c) => c.attemptId), ["A-2", "A-1"]);
  assert.deepEqual(avertissements.map((w) => w.workUnitId), ["W09", "W03"]);
  assert.deepEqual(plan.laneWorktrees, ["W09", "W03"]);
  assert.deepEqual(plan.laneBranches, ["W09", "W03"]);
  assert.deepEqual(plan.integrationContexts, ["r1-W09-2", "r1-W09-1"]);
  assert.deepEqual(retenus.map((g) => g.object), ["b", "a"]);

  // Les objets retenus sont clonés : muter le relevé ne remonte pas au plan.
  r.cleanup.retained[0].reason = "modifié après coup";
  assert.deepEqual(retenus.map((g) => g.reason), ["seconde", "première"]);
});

test("l'absence trie avant la chaîne vide, et le comparateur est strictement total", () => {
  /*
   * `null` et `""` se comparaient comme égaux : deux entrées différentes
   * ressortaient au même rang, donc dans l'ordre d'entrée — exactement ce que le
   * tri total devait supprimer. Deux conflits d'intégration ne diffèrent ici que
   * par `attempt`, absent chez l'un et vide chez l'autre.
   */
  const conflits: IntegrationConflict[] = [
    { kind: "merge-perdu", workUnitId: "W09", detail: "d" },
    { kind: "merge-perdu", attemptId: "", workUnitId: "W09", detail: "d" },
  ];
  const rangs = (inverse: boolean) =>
    buildRunReport(
      RUN,
      lanes(),
      tentatives({
        reconciliation: bilanTentatives({
          conflicts: inverse ? [...conflits].reverse() : [...conflits],
        }),
      }),
      planVide,
      MESURE,
    ).recovery.integration_conflicts!.map((c) => c.attempt);

  assert.deepEqual(rangs(false), [null, ""], "l'absence passe avant la chaîne vide");
  assert.deepEqual(rangs(true), [null, ""], "et l'ordre d'entrée n'y change rien");
});

test("la collation est ordinale, donc la même sur toute machine", () => {
  /*
   * `localeCompare` classe souvent « a » avant « B » ; l'ordre des points de code
   * met les majuscules d'abord. Le relevé doit être le même octet pour octet
   * d'un poste à l'autre, donc c'est l'ordinal qui gouverne — et ce test échoue
   * si quelqu'un remet une collation localisée.
   */
  const r = buildRunReport(
    RUN,
    lanes({ observations: observations({ openWorktrees: ["a", "B"] }) }),
    tentatives(),
    planVide,
    MESURE,
  );
  assert.deepEqual(r.physical_state.lane_worktrees, ["B", "a"]);
});
