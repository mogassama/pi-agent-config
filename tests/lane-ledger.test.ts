/**
 * Le registre enregistre des faits accomplis, et la réconciliation ne répare
 * rien.
 *
 * Les deux règles se tiennent : parce que l'effet précède l'événement, le
 * registre peut être en retard sur la réalité — jamais en avance. Un registre
 * en retard se diagnostique ; un registre qui affirme un merge jamais fait
 * falsifie la provenance de tout le run.
 *
 * Les fenêtres de crash ne sont donc pas supprimées, elles sont nommées. Un
 * WAL à deux phases les supprimerait, au prix d'une machine d'états bien plus
 * lourde que le problème.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeConflicts,
  foldLedger,
  integrationCommits,
  reconcile,
  type LaneEvent,
} from "../subagent-only/lane-ledger.ts";

const ev = (event: LaneEvent["event"], unit: string, reason?: string): LaneEvent =>
  event === "OPENED"
    ? { event, work_unit: unit, at: new Date().toISOString(), base: `base-${unit}` }
    : event === "ABANDONED"
      ? { event, work_unit: unit, at: new Date().toISOString(), ...(reason ? { reason } : {}) }
      : { event, work_unit: unit, at: new Date().toISOString() };
const rien = { openWorktrees: [], mergedUnits: [] };

// ---------------------------------------------------------------- le pli

test("aucun événement, aucune histoire", () => {
  assert.deepEqual([...foldLedger([])], []);
});

test("une ouverture rend la lane ouverte", () => {
  assert.equal(foldLedger([ev("OPENED", "W03")]).get("W03"), "open");
});

test("l'intégration et l'abandon closent l'histoire", () => {
  assert.equal(foldLedger([ev("OPENED", "W03"), ev("INTEGRATED", "W03")]).get("W03"), "integrated");
  assert.equal(foldLedger([ev("OPENED", "W07"), ev("ABANDONED", "W07")]).get("W07"), "abandoned");
});

// Le registre décrit la vie de la lane, pas chacune de ses utilisations : un
// rework rouvre le même worktree et n'écrit pas d'ouverture.
test("une seconde ouverture ne fait pas régresser un état plus avancé", () => {
  const etats = foldLedger([ev("OPENED", "W03"), ev("INTEGRATED", "W03"), ev("OPENED", "W03")]);
  assert.equal(etats.get("W03"), "integrated");
});

test("les unités sont indépendantes", () => {
  const etats = foldLedger([ev("OPENED", "W01"), ev("INTEGRATED", "W01"), ev("OPENED", "W03")]);
  assert.equal(etats.get("W01"), "integrated");
  assert.equal(etats.get("W03"), "open");
});

// ------------------------------------------------------- ce qui s'accorde

test("une lane ouverte avec son worktree possède son scope", () => {
  const r = reconcile([ev("OPENED", "W03")], { openWorktrees: ["W03"], mergedUnits: [] });
  assert.deepEqual([...r.openUnits], ["W03"]);
  assert.equal(r.conflicts.size, 0);
});

test("une lane intégrée satisfait les dépendances", () => {
  const r = reconcile([ev("OPENED", "W01"), ev("INTEGRATED", "W01")],
    { openWorktrees: [], mergedUnits: ["W01"] });
  assert.deepEqual([...r.integrated], ["W01"]);
  assert.equal(r.conflicts.size, 0);
});

test("une lane abandonnée et nettoyée ne laisse rien", () => {
  const r = reconcile([ev("OPENED", "W07"), ev("ABANDONED", "W07", "hors sujet")], rien);
  assert.deepEqual([...r.openUnits], []);
  assert.deepEqual([...r.integrated], []);
  assert.equal(r.conflicts.size, 0);
});

// ------------------------------------------------- ce qui ne s'accorde pas

/*
 * La contrepartie assumée de « l'effet d'abord, l'événement ensuite ».
 *
 * Un crash entre `git worktree add` et l'écriture de l'ouverture laisse un
 * worktree sans provenance. Il n'est pas perdu — `openLanes()` le voit — mais
 * il n'est pas non plus adopté en silence.
 */
test("un worktree sans provenance est un orphelin, pas une lane", () => {
  const r = reconcile([], { openWorktrees: ["W03"], mergedUnits: [] });
  assert.deepEqual([...r.openUnits], [], "un orphelin ne possède rien");
  assert.equal([...r.conflicts.values()][0].kind, "worktree-orphelin");
});

/*
 * L'inverse, et c'est celui qu'on accepte de voir plutôt que de fabriquer.
 *
 * Le merge a eu lieu, le processus est mort avant de l'enregistrer. Le registre
 * est en retard sur la réalité, ce qui est diagnosticable — alors que l'ordre
 * inverse aurait produit un `INTEGRATED` sur un merge jamais fait.
 */
test("une intégration non enregistrée est signalée, pas devinée", () => {
  const r = reconcile([ev("OPENED", "W01")], { openWorktrees: [], mergedUnits: ["W01"] });
  assert.equal([...r.conflicts.values()][0].kind, "integration-non-enregistree");
  assert.deepEqual([...r.integrated], [], "elle ne satisfait aucune dépendance tant qu'elle est en conflit");
  assert.deepEqual([...r.openUnits], [], "et elle ne possède rien non plus");
});

test("une lane ouverte sans worktree ni intégration est un conflit", () => {
  const r = reconcile([ev("OPENED", "W03")], rien);
  assert.equal([...r.conflicts.values()][0].kind, "lane-disparue");
  assert.deepEqual([...r.openUnits], []);
});

test("un worktree survivant à un abandon est signalé", () => {
  const r = reconcile([ev("OPENED", "W07"), ev("ABANDONED", "W07")],
    { openWorktrees: ["W07"], mergedUnits: [] });
  assert.equal([...r.conflicts.values()][0].kind, "residu-d-abandon");
});

// Une unité en conflit ne possède rien et ne satisfait rien : choisir une des
// deux versions serait la réparation silencieuse qu'on refuse.
test("un conflit retire l'unité des deux ensembles", () => {
  const r = reconcile(
    [ev("OPENED", "W01"), ev("OPENED", "W03")],
    { openWorktrees: ["W03"], mergedUnits: ["W01"] },
  );
  assert.deepEqual([...r.openUnits], ["W03"]);
  assert.deepEqual([...r.integrated], []);
  assert.equal(r.conflicts.size, 1);
});

// ------------------------------------------------------- ne rien réparer

test("réconcilier deux fois donne le même résultat", () => {
  const events = [ev("OPENED", "W01"), ev("INTEGRATED", "W01"), ev("OPENED", "W03")];
  const obs = { openWorktrees: ["W03", "W09"], mergedUnits: ["W01"] };
  const a = reconcile(events, obs);
  const b = reconcile(events, obs);
  assert.deepEqual([...a.openUnits], [...b.openUnits]);
  assert.deepEqual([...a.conflicts.keys()], [...b.conflicts.keys()]);
  // Et les entrées n'ont pas bougé.
  assert.deepEqual(obs.openWorktrees, ["W03", "W09"]);
  assert.equal(events.length, 3);
});

test("le relevé nomme chaque contradiction et dit qu'aucune n'est réparée", () => {
  const r = reconcile([ev("OPENED", "W03")], { openWorktrees: ["W09"], mergedUnits: [] });
  const texte = describeConflicts(r.conflicts);
  assert.match(texte, /W03/);
  assert.match(texte, /W09/);
  assert.match(texte, /aucune n'est réparée automatiquement/);
});

test("sans contradiction, le relevé ne dit rien", () => {
  assert.equal(describeConflicts(new Map()), "");
});

// ------------------------------------------ le scope d'une contradiction

/*
 * Une unité en contradiction réserve son scope sans le posséder.
 *
 * Dire qu'elle ne possède rien laisserait une unité chevauchante démarrer sur
 * un scope où du travail non résolu existe — un worktree aux modifications
 * inconnues, une intégration non enregistrée. Elle le réserve donc contre les
 * autres, et contre elle-même : reprendre une lane et trancher une
 * contradiction ne sont pas la même opération, et l'exception d'auto-collision
 * du lot 3a ne s'applique pas.
 */
test("un orphelin réserve son scope", () => {
  const r = reconcile([], { openWorktrees: ["W03"], mergedUnits: [] });
  assert.deepEqual([...r.reserved], ["W03"]);
  assert.deepEqual([...r.openUnits], []);
});

test("une lane disparue réserve son scope", () => {
  const r = reconcile([ev("OPENED", "W03")], rien);
  assert.deepEqual([...r.reserved], ["W03"]);
});

test("une intégration non enregistrée réserve son scope", () => {
  const r = reconcile([ev("OPENED", "W01")], { openWorktrees: [], mergedUnits: ["W01"] });
  assert.deepEqual([...r.reserved], ["W01"]);
});

// Le fait est enregistré et git le confirme : c'est le worktree qui est en
// trop, pas l'intégration qui est douteuse. Elle satisfait donc ses dépendantes.
/*
 * Deux résidus que rien ne distingue de l'extérieur, et qui n'ont pas la même
 * conséquence.
 *
 * Propre : le fait est enregistré, git le confirme, rien d'inconnu ne dort
 * dedans. Du ménage, qui ne ferme pas le run.
 *
 * Sale : le worktree porte du travail postérieur ou extérieur au fait
 * enregistré. Tenir l'unité pour terminée libérerait son scope et satisferait
 * ses dépendantes pendant qu'un changement dort dans sa lane.
 */
test("un résidu propre est du ménage, pas une contradiction", () => {
  const r = reconcile([ev("OPENED", "W01"), ev("INTEGRATED", "W01")],
    { openWorktrees: ["W01"], mergedUnits: ["W01"] });
  assert.equal(r.conflicts.size, 0);
  assert.deepEqual([...r.reserved], []);
  assert.deepEqual([...r.integrated], ["W01"]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].detail, /à retirer/);
});

test("un résidu sale ferme le run", () => {
  const r = reconcile([ev("OPENED", "W01"), ev("INTEGRATED", "W01")],
    { openWorktrees: ["W01"], mergedUnits: ["W01"], dirtyWorktrees: ["W01"] });
  assert.equal([...r.conflicts.values()][0].kind, "residu-sale");
  assert.deepEqual([...r.integrated], [], "elle ne satisfait plus ses dépendantes");
  assert.deepEqual([...r.reserved], ["W01"], "et son scope reste réservé");
});

test("une intégration sans résidu ne dit rien", () => {
  const r = reconcile([ev("OPENED", "W01"), ev("INTEGRATED", "W01")],
    { openWorktrees: [], mergedUnits: ["W01"] });
  assert.equal(r.conflicts.size, 0);
  assert.equal(r.warnings.length, 0);
});

test("un abandon dont le worktree traîne réserve son scope", () => {
  const r = reconcile([ev("OPENED", "W07"), ev("ABANDONED", "W07")],
    { openWorktrees: ["W07"], mergedUnits: [] });
  assert.deepEqual([...r.reserved], ["W07"]);
});

test("une lane cohérente ne réserve rien : elle possède", () => {
  const r = reconcile([ev("OPENED", "W03")], { openWorktrees: ["W03"], mergedUnits: [] });
  assert.deepEqual([...r.reserved], []);
  assert.deepEqual([...r.openUnits], ["W03"]);
});

test("le relevé dit comment trancher", () => {
  const r = reconcile([], { openWorktrees: ["W03"], mergedUnits: [] });
  assert.match(describeConflicts(r.conflicts), /subagent-recover/);
});

// ------------------------------- ce que le registre dit et ce que git montre

/*
 * L'événement ne suffit pas : git doit le confirmer.
 *
 * La première version ajoutait l'unité aux intégrées dès que le registre le
 * disait, avec un commentaire affirmant « git le confirme » — sans jamais
 * interroger git. Une ligne `INTEGRATED` fausse ou prématurée satisfaisait donc
 * les dépendances de toute une branche du plan.
 */
test("une intégration que git ne montre pas est une contradiction", () => {
  const r = reconcile([ev("OPENED", "W01"), ev("INTEGRATED", "W01")], rien);
  assert.equal([...r.conflicts.values()][0].kind, "integration-non-confirmee");
  assert.deepEqual([...r.integrated], [], "elle ne satisfait aucune dépendance");
  assert.deepEqual([...r.reserved], ["W01"]);
});

// L'autre sens : les deux sources se contredisent sur le sort du travail
// lui-même, ce qui est plus grave qu'un worktree en trop.
test("un abandon que git contredit est une contradiction", () => {
  const r = reconcile([ev("OPENED", "W01"), ev("ABANDONED", "W01")],
    { openWorktrees: [], mergedUnits: ["W01"] });
  assert.equal([...r.conflicts.values()][0].kind, "abandon-contredit-par-git");
});

test("un abandon que git ne contredit pas est propre", () => {
  const r = reconcile([ev("OPENED", "W01"), ev("ABANDONED", "W01")], rien);
  assert.equal(r.conflicts.size, 0);
});

/*
 * La recherche des unités sans provenance ne parcourait que les worktrees. Un
 * changement présent dans l'intégration sans aucun événement pour le raconter
 * passait inaperçu — alors que c'est la contradiction la plus gênante : le
 * dépôt porte du travail dont le run ne sait rien.
 */
/*
 * Une branche du run sans provenance.
 *
 * Le nom dit ce que git permet d'établir, et pas plus : sans la base de la
 * lane, on ne peut pas prouver qu'elle a produit quelque chose, encore moins
 * que ce quelque chose est intégré. Le détail mentionne l'intégration quand git
 * la montre, mais la contradiction reste l'absence de provenance.
 */
test("une branche du run sans provenance est signalée", () => {
  const r = reconcile([], { openWorktrees: [], mergedUnits: [], runBranches: ["W09"] });
  assert.equal([...r.conflicts.values()][0].kind, "branche-sans-provenance");
  assert.deepEqual([...r.integrated], []);
});

test("le détail dit si git montre l'intégration", () => {
  const r = reconcile([], { openWorktrees: [], mergedUnits: ["W09"], runBranches: ["W09"] });
  assert.match([...r.conflicts.values()][0].detail, /git montre son intégration/);
});

// Un worktree présent est déjà un orphelin : ne pas le nommer deux fois.
test("un orphelin n'est pas aussi une branche sans provenance", () => {
  const r = reconcile([], { openWorktrees: ["W03"], mergedUnits: [], runBranches: ["W03"] });
  assert.equal(r.conflicts.size, 1);
  assert.equal([...r.conflicts.values()][0].kind, "worktree-orphelin");
});

// Une branche dont le registre connaît l'unité n'est pas sans provenance.
test("une branche avec provenance ne déclenche rien de plus", () => {
  const r = reconcile([ev("OPENED", "W03")],
    { openWorktrees: ["W03"], mergedUnits: [], runBranches: ["W03"] });
  assert.equal(r.conflicts.size, 0);
});

test("les ensembles ne contiennent que ce sur quoi les deux sources s'accordent", () => {
  const r = reconcile(
    [ev("OPENED", "W01"), ev("INTEGRATED", "W01"), ev("OPENED", "W03"), ev("INTEGRATED", "W03")],
    { openWorktrees: [], mergedUnits: ["W01"] },
  );
  assert.deepEqual([...r.integrated], ["W01"]);
  assert.equal([...r.conflicts.keys()].join(","), "W03");
});

/*
 * La preuve durable d'intégration.
 *
 * `isMerged` interroge la branche de lane. Tant qu'elle est la seule preuve,
 * la supprimer transforme un fait juste en contradiction bloquante, et le
 * nettoyage des lanes intégrées est impossible sans casser la réconciliation.
 * Nommer le commit d'intégration détache la preuve de la branche.
 */

const integre = (unit: string, commit?: string): LaneEvent => ({
  event: "INTEGRATED",
  work_unit: unit,
  at: new Date().toISOString(),
  ...(commit ? { integration_commit: commit } : {}),
});

test("une intégration prouvée par son commit tient sans sa branche", () => {
  const bilan = reconcile([ev("OPENED", "W01"), integre("W01", "m1")], {
    openWorktrees: [],
    // La branche a été retirée : `isMerged` ne peut plus rien confirmer.
    mergedUnits: [],
    confirmedCommits: ["m1"],
  });
  assert.equal(bilan.conflicts.size, 0);
  assert.ok(bilan.integrated.has("W01"));
  assert.ok(bilan.cleanableBranches.has("W01"));
});

test("un commit d'intégration que le dépôt ne confirme pas est une contradiction", () => {
  const bilan = reconcile([ev("OPENED", "W01"), integre("W01", "m1")], {
    openWorktrees: [],
    mergedUnits: [],
    confirmedCommits: [],
  });
  assert.equal(bilan.conflicts.get("W01")?.kind, "integration-non-confirmee");
  assert.ok(!bilan.integrated.has("W01"));
});

test("une branche qui traîne ne rattrape pas un commit d'intégration introuvable", () => {
  /*
   * La contre-épreuve de la disjonction. Si la preuve était « le commit **ou**
   * la branche », cette unité passerait pour intégrée alors que le commit
   * qu'elle nomme est introuvable — exactement le mensonge que nommer le commit
   * devait supprimer.
   */
  const bilan = reconcile([ev("OPENED", "W01"), integre("W01", "m1")], {
    openWorktrees: [],
    mergedUnits: ["W01"],
    confirmedCommits: [],
  });
  assert.equal(bilan.conflicts.get("W01")?.kind, "integration-non-confirmee");
  assert.ok(!bilan.integrated.has("W01"));
});

test("un registre sans commit d'intégration se prouve encore par sa branche", () => {
  const bilan = reconcile([ev("OPENED", "W01"), integre("W01")], {
    openWorktrees: [],
    mergedUnits: ["W01"],
  });
  assert.equal(bilan.conflicts.size, 0);
  assert.ok(bilan.integrated.has("W01"));
  // Prouvée, mais par sa branche : la supprimer la ferait disparaître.
  assert.ok(!bilan.cleanableBranches.has("W01"));
});

test("un résidu sale n'ouvre pas le nettoyage de la branche", () => {
  const bilan = reconcile([ev("OPENED", "W01"), integre("W01", "m1")], {
    openWorktrees: ["W01"],
    mergedUnits: [],
    confirmedCommits: ["m1"],
    dirtyWorktrees: ["W01"],
  });
  assert.equal(bilan.conflicts.get("W01")?.kind, "residu-sale");
  assert.ok(!bilan.cleanableBranches.has("W01"));
});

test("un worktree propre survivant laisse la branche supprimable", () => {
  const bilan = reconcile([ev("OPENED", "W01"), integre("W01", "m1")], {
    openWorktrees: ["W01"],
    mergedUnits: [],
    confirmedCommits: ["m1"],
  });
  assert.equal(bilan.conflicts.size, 0);
  assert.equal(bilan.warnings.length, 1);
  assert.ok(bilan.cleanableBranches.has("W01"));
});

test("la dernière intégration fait foi, y compris quand elle n'a pas de preuve", () => {
  const commits = integrationCommits([integre("W01", "m1"), integre("W01")]);
  // Conserver `m1` ferait passer pour durable une réintégration qui ne l'est
  // pas, et le nettoyage supprimerait la branche qui prouve la seconde.
  assert.equal(commits.get("W01"), undefined);
  assert.equal(integrationCommits([integre("W01", "m1"), integre("W01", "m2")]).get("W01"), "m2");
});

test("les worktrees terminaux propres sont rangeables, les sales jamais", () => {
  /*
   * Le nettoyage ne doit réimplémenter aucune règle : la réconciliation dit ce
   * qui est rangeable, il matérialise. Une unité terminale dont le worktree est
   * propre a son contenu ailleurs — dans l'intégration, ou sur sa branche.
   */
  const integree = reconcile([ev("OPENED", "W01"), integre("W01", "m1")], {
    openWorktrees: ["W01"], mergedUnits: [], confirmedCommits: ["m1"],
  });
  assert.ok(integree.cleanableWorktrees.has("W01"));

  const sale = reconcile([ev("OPENED", "W01"), integre("W01", "m1")], {
    openWorktrees: ["W01"], mergedUnits: [], confirmedCommits: ["m1"], dirtyWorktrees: ["W01"],
  });
  assert.ok(!sale.cleanableWorktrees.has("W01"), "un worktree sale n'est jamais rangeable");
  assert.ok(!sale.cleanableBranches.has("W01"));
});

test("un abandon laisse un worktree rangeable mais jamais sa branche", () => {
  const propre = reconcile([ev("OPENED", "W01"), ev("ABANDONED", "W01")], {
    openWorktrees: ["W01"], mergedUnits: [],
  });
  assert.ok(propre.cleanableWorktrees.has("W01"));
  assert.ok(!propre.cleanableBranches.has("W01"), "la branche porte le travail abandonné");

  const sale = reconcile([ev("OPENED", "W01"), ev("ABANDONED", "W01")], {
    openWorktrees: ["W01"], mergedUnits: [], dirtyWorktrees: ["W01"],
  });
  assert.ok(!sale.cleanableWorktrees.has("W01"));
});

test("une intégration sans preuve durable ne rend rien rangeable de sa branche", () => {
  const r = reconcile([ev("OPENED", "W01"), integre("W01")], {
    openWorktrees: ["W01"], mergedUnits: ["W01"],
  });
  assert.ok(r.cleanableWorktrees.has("W01"), "le worktree propre, lui, est du ménage");
  assert.ok(!r.cleanableBranches.has("W01"), "la branche est la preuve de l'intégration");
});
