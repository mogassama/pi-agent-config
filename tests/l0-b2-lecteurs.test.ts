/**
 * l0-b2-lecteurs.test.ts — L0, vague B2 : ce que le registre autoritaire doit rendre.
 *
 * Deux preuves de lecture pure, montées sur des registres v2 sérialisés — la forme que
 * le plan réserve aux lecteurs et aux réducteurs. Ce que `task` doit *produire* est
 * éprouvé ailleurs, dans `l0-b2-revue-harness.test.ts`.
 *
 * Les trees employés sont de vrais objets git : une chaîne `from_tree → tree` faite de
 * chaînes inventées se reconstruirait aussi bien, et ne prouverait rien.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { observeLanes } from "../subagent-only/lane-observe.ts";
import { readLaneEvents } from "../subagent-only/run-manifest.ts";
import { aJeter, depot, git, manifeste, Registre, RUN } from "./l0-b1-fixtures.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

const laneRead = (dir: string) => {
  const lu = readLaneEvents(dir, RUN);
  return { events: lu.events, malformedLines: lu.malformedLines, version: lu.version };
};
const lire = (root: string, dir: string) => {
  try {
    return observeLanes({ root, runId: RUN, laneRead: laneRead(dir) }) as {
      usable?: boolean; state?: string;
    };
  } catch (e) {
    return { usable: false, state: undefined, erreur: (e as Error).message };
  }
};
const evenements = (vu: unknown): Array<Record<string, unknown>> =>
  (vu as { snapshot?: { read?: { events?: Array<Record<string, unknown>> } } })?.snapshot?.read?.events ?? [];

/** Deux vrais trees, obtenus en commitant deux états successifs de la lane. */
function deuxTrees(root: string): { base: string; t1: string; t2: string } {
  const base = git(root, "rev-parse", "HEAD^{tree}").trim();
  writeFileSync(join(root, "src", "a.py"), "a = 2\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "revue 1");
  const t1 = git(root, "rev-parse", "HEAD^{tree}").trim();
  writeFileSync(join(root, "src", "a.py"), "a = 3\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "revue 2");
  const t2 = git(root, "rev-parse", "HEAD^{tree}").trim();
  return { base, t1, t2 };
}

// ================================================================== la chaîne des revues

regression("B2-reviewed-chaine", "la chaîne from_tree → tree se reconstruit, et sa rupture se voit", async () => {
  const saine = depot("l0-b2-chaine-a-");
  const trees = deuxTrees(saine.root);
  manifeste(saine.dir, { version: 2, ledgers: { lanes: 2 } });
  const r = new Registre(2);
  r.ajouter("W03", 1, { event: "OPENED", base: saine.base, generation: 1 });
  const revue = (from: string, tree: string) =>
    r.ajouter("W03", 1, {
      event: "REVIEWED", from_tree: from, tree, verdict: "approved",
      reviewer: { delegation_seq: 2, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" },
    });
  revue(trees.base, trees.t1);
  revue(trees.t1, trees.t2);
  r.ecrire(saine.dir);
  precondition(
    trees.base !== trees.t1 && trees.t1 !== trees.t2,
    "les trois trees de la fixture doivent être des objets git distincts",
  );

  const vue = lire(saine.root, saine.dir);
  const revues = evenements(vue).filter((e) => e.event === "REVIEWED");
  const ouverture = evenements(vue).find((e) => e.event === "OPENED");
  const chaine =
    revues.length === 2 &&
    revues[0].from_tree === trees.base &&
    revues[0].tree === trees.t1 &&
    revues[1].from_tree === revues[0].tree &&
    revues[1].tree === trees.t2 &&
    ouverture?.base === saine.base;

  // Une chaîne rompue : le second from_tree ne suit pas le premier tree.
  const rompue = depot("l0-b2-chaine-b-");
  const treesB = deuxTrees(rompue.root);
  manifeste(rompue.dir, { version: 2, ledgers: { lanes: 2 } });
  const r2 = new Registre(2);
  r2.ajouter("W03", 1, { event: "OPENED", base: rompue.base, generation: 1 });
  r2.ajouter("W03", 1, {
    event: "REVIEWED", from_tree: treesB.base, tree: treesB.t1, verdict: "approved",
    reviewer: { delegation_seq: 2, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" },
  });
  r2.ajouter("W03", 1, {
    event: "REVIEWED", from_tree: treesB.t2, tree: treesB.t2, verdict: "approved",
    reviewer: { delegation_seq: 4, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" },
  });
  r2.ecrire(rompue.dir);
  const vueRompue = lire(rompue.root, rompue.dir);

  /*
   * Les deux issues doivent se distinguer par leur jeton, pas seulement par `usable`.
   *
   * Sur l'objet, TOUT registre v2 est refusé : `usable === false` sur la fixture rompue
   * serait vrai sans qu'aucune rupture ait été détectée. C'est `state` qui sépare la
   * chaîne lisible de la chaîne inconnue (C0 v1.5, C4.2 et C4.8).
   */
  const saineLue = vue.usable === true && vue.state === "KNOWN" && chaine;
  const ruptureLue = vueRompue.usable === false && vueRompue.state === "UNKNOWN";

  propriete(
    saineLue && ruptureLue,
    `la chaîne saine se lit KNOWN et se reconstruit (${saineLue}, state ` +
      `${JSON.stringify(vue.state)}, revues ${JSON.stringify(revues.map((e) => [e.from_tree, e.tree]))}), ` +
      `la rompue se lit UNKNOWN (${ruptureLue}, state ${JSON.stringify(vueRompue.state)})`,
  );
});

regression("B2-reviewed-identite", "l'identité du reviewer se lit depuis le registre autoritaire seul", async () => {
  const d = depot("l0-b2-identite-");
  manifeste(d.dir, { version: 2, ledgers: { lanes: 2 } });
  const r = new Registre(2);
  r.ajouter("W03", 1, { event: "OPENED", base: d.base, generation: 1 });
  r.ajouter("W03", 1, {
    event: "REVIEWED",
    from_tree: d.baseTree,
    tree: d.baseTree,
    verdict: "approved",
    reviewer: { delegation_seq: 7, agent: "reviewer", role: "reviewer" },
    proof: { mode: "reading-list", paths: ["src/a.py"] },
  });
  r.ecrire(d.dir);
  // Aucun journal des délégations : ce qui fonde une approbation ne s'y lit pas (T4).
  precondition(
    !r.brut().includes("delegations"),
    "la fixture ne doit porter aucun renvoi vers le journal best-effort",
  );

  const vue = lire(d.root, d.dir);
  const revue = evenements(vue).find((e) => e.event === "REVIEWED");
  const reviewer = revue?.reviewer as Record<string, unknown> | undefined;
  const preuve = revue?.proof as Record<string, unknown> | undefined;
  propriete(
    JSON.stringify(reviewer) === JSON.stringify({ delegation_seq: 7, agent: "reviewer", role: "reviewer" }) &&
      JSON.stringify(preuve) === JSON.stringify({ mode: "reading-list", paths: ["src/a.py"] }),
    `le registre autoritaire doit porter qui a revu et sur quelle preuve, à l'identique ; ` +
      `reviewer ${JSON.stringify(reviewer)}, preuve ${JSON.stringify(preuve)}`,
  );
});
