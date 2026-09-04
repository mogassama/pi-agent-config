/**
 * Les lanes sur de vrais dépôts git.
 *
 * Ce fichier est le premier de la suite à faire du git réel, donc il est lent
 * là où le reste tourne en vingt millisecondes. C'est assumé : l'isolation est
 * exactement la propriété qu'on ne peut pas éprouver en simulant, et la confier
 * au premier run parallèle sans l'avoir testée serait la reprendre au moment où
 * elle devient dangereuse.
 *
 * Chaque cas monte son dépôt, un seul commit, et le détruit à la fin.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changedBetween, treeState } from "../subagent-only/tree.ts";
import {
  commitLane,
  ensureLane,
  laneBranch,
  laneChanges,
  lanesDir,
  mergeLane,
  openLanes,
  removeLane,
} from "../subagent-only/worktree.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/** Un dépôt à un seul commit, comme le dépôt de test des runs. */
function repo(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "pi-lane-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

// ------------------------------------------------------------- isolation

test("une lane obtient son worktree et sa branche", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    assert.equal(lane.created, true);
    assert.equal(lane.branch, "pi-lane/9a6766-W01");
    assert.equal(readFileSync(join(lane.cwd, "src", "a.py"), "utf-8"), "a = 1\n");
  } finally {
    done();
  }
});

// Les worktrees vivent sous le répertoire git : `treeState` s'appuie sur
// `git status --porcelain`, et un worktree posé dans l'arbre de travail
// apparaîtrait dans chaque observation, de chaque lane.
test("un worktree n'apparaît pas dans le statut du dépôt", () => {
  const { root, done } = repo();
  try {
    ensureLane(root, "9a6766-W01");
    assert.ok(lanesDir(root).includes(".git"));
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=all").trim(), "");
  } finally {
    done();
  }
});

test("deux lanes ne se voient pas", () => {
  const { root, done } = repo();
  try {
    const one = ensureLane(root, "9a6766-W01");
    const two = ensureLane(root, "9a6766-W02");
    writeFileSync(join(one.cwd, "src", "a.py"), "a = 2\n");
    assert.equal(readFileSync(join(two.cwd, "src", "a.py"), "utf-8"), "a = 1\n");
    assert.equal(git(root, "status", "--porcelain").trim(), "");
  } finally {
    done();
  }
});

// Un rework appartient à la même unité que la tentative qu'il reprend : même
// worktree, même branche, même état. Le worker de reprise retrouve ce que le
// premier a laissé, et le reviewer voit le changement complet.
test("une lane rouverte retrouve son état", () => {
  const { root, done } = repo();
  try {
    const first = ensureLane(root, "9a6766-W01");
    writeFileSync(join(first.cwd, "src", "a.py"), "a = 2\n");
    const again = ensureLane(root, "9a6766-W01");
    assert.equal(again.created, false);
    assert.equal(again.cwd, first.cwd);
    assert.equal(readFileSync(join(again.cwd, "src", "a.py"), "utf-8"), "a = 2\n");
  } finally {
    done();
  }
});

test("les lanes ouvertes se listent", () => {
  const { root, done } = repo();
  try {
    ensureLane(root, "9a6766-W01");
    ensureLane(root, "9a6766-W02");
    assert.deepEqual(openLanes(root).sort(), ["9a6766-W01", "9a6766-W02"]);
    removeLane(root, "9a6766-W01");
    assert.deepEqual(openLanes(root), ["9a6766-W02"]);
  } finally {
    done();
  }
});

// La branche survit au retrait du worktree : elle porte le travail.
test("retirer un worktree ne perd pas la branche", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    git(lane.cwd, "add", "-A");
    git(lane.cwd, "commit", "-qm", "W01");
    removeLane(root, "9a6766-W01");
    assert.ok(git(root, "rev-parse", "--verify", laneBranch("9a6766-W01")).trim());
    const back = ensureLane(root, "9a6766-W01");
    assert.equal(readFileSync(join(back.cwd, "src", "a.py"), "utf-8"), "a = 2\n");
  } finally {
    done();
  }
});

// ------------------------------------------------------- ce que la lane écrit

test("les changements d'une lane sont ceux de sa branche", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    writeFileSync(join(lane.cwd, "src", "neuf.py"), "n = 1\n");
    assert.deepEqual(laneChanges(root, "9a6766-W01"), ["src/a.py", "src/neuf.py"]);
  } finally {
    done();
  }
});

// Le diff de la lane est contre sa base, pas contre l'intégration : une lane
// intégrée entre-temps ne doit pas grossir la review de la suivante.
test("l'intégration d'une autre lane ne grossit pas la review", () => {
  const { root, done } = repo();
  try {
    const one = ensureLane(root, "9a6766-W01");
    writeFileSync(join(one.cwd, "src", "a.py"), "a = 2\n");
    git(one.cwd, "add", "-A");
    git(one.cwd, "commit", "-qm", "W01");

    const two = ensureLane(root, "9a6766-W02");
    writeFileSync(join(two.cwd, "src", "b.py"), "b = 2\n");

    assert.equal(mergeLane(root, "9a6766-W01", []).ok, true);
    assert.deepEqual(laneChanges(root, "9a6766-W02"), ["src/b.py"]);
  } finally {
    done();
  }
});

// -------------------------------------------------------------- intégration

test("une lane approuvée s'intègre", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    git(lane.cwd, "add", "-A");
    git(lane.cwd, "commit", "-qm", "W01");
    assert.equal(mergeLane(root, "9a6766-W01", []).ok, true);
    assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "a = 2\n");
  } finally {
    done();
  }
});

/*
 * Un worker écrit dans le worktree et ne commite pas. Sans le commit,
 * l'intégration réussirait en n'apportant rien — le merge d'une branche
 * identique à sa base — et le travail disparaîtrait avec le worktree.
 */
test("le travail non commité d'une lane est figé puis intégré", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    writeFileSync(join(lane.cwd, "src", "neuf.py"), "n = 1\n");
    assert.equal(mergeLane(root, "9a6766-W01", []).ok, true);
    assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "a = 2\n");
    assert.equal(readFileSync(join(root, "src", "neuf.py"), "utf-8"), "n = 1\n");
  } finally {
    done();
  }
});

test("une lane sans changement s'intègre sans rien apporter", () => {
  const { root, done } = repo();
  try {
    ensureLane(root, "9a6766-W01");
    assert.deepEqual(commitLane(root, "9a6766-W01", "rien"), { status: "clean", reason: "" });
    assert.equal(mergeLane(root, "9a6766-W01", []).ok, true);
    assert.equal(git(root, "status", "--porcelain").trim(), "");
  } finally {
    done();
  }
});

/*
 * Ignorer l'échec du gel rouvrait le trou que le commit devait fermer : la
 * branche reste à sa base, le merge réussit en n'apportant rien, le worktree est
 * retiré, et le travail disparaît. Le dépôt en lecture seule reproduit la
 * panne — `git commit` échoue là où `git add` peut encore passer.
 */
test("un gel impossible refuse l'intégration et garde le worktree", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    // Un hook `pre-commit` qui refuse : la panne est déterministe et elle se
    // produit là où elle compte — `git add` passe, `git commit` échoue.
    const hooks = join(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").trim(), "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    const m = mergeLane(root, "9a6766-W01", []);
    assert.equal(m.ok, false);
    assert.match(m.reason, /gel impossible/);
    assert.equal(readFileSync(join(lane.cwd, "src", "a.py"), "utf-8"), "a = 2\n");
    assert.deepEqual(openLanes(root), ["9a6766-W01"]);

    // Et la lane est revenue à l'état d'avant la tentative, index compris : le
    // `git add` a réussi là où le commit a échoué, et une intégration ratée ne
    // doit rien laisser derrière elle.
    assert.equal(git(lane.cwd, "diff", "--cached", "--name-only").trim(), "");
    assert.deepEqual(laneChanges(root, "9a6766-W01"), ["src/a.py"]);
  } finally {
    done();
  }
});

// Le blocage est vérifié avant le commit comme avant le merge : rien n'est figé
// sur la branche d'une lane qu'on refuse d'intégrer.
test("une lane bloquée ne fige rien", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    assert.equal(mergeLane(root, "9a6766-W01", ["scope-breach"]).ok, false);
    assert.match(git(lane.cwd, "status", "--porcelain"), /src\/a\.py/);
  } finally {
    done();
  }
});

/*
 * Les blocages sont vérifiés avant git, et ce n'est pas une commodité.
 *
 * Une lane qui a écrit sur un chemin réservé ou débordé de son scope peut
 * merger proprement — c'est précisément le danger. Le merge propre laisserait
 * passer une hypothèse devenue fausse, et git ne sait rien de l'ownership.
 */
test("une violation de chemin réservé interdit l'intégration", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    git(lane.cwd, "add", "-A");
    git(lane.cwd, "commit", "-qm", "W01");
    const m = mergeLane(root, "9a6766-W01", ["reserved-violation"]);
    assert.equal(m.ok, false);
    assert.match(m.reason, /reserved-violation/);
    assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "a = 1\n");
  } finally {
    done();
  }
});

test("un dépassement de scope interdit l'intégration", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    git(lane.cwd, "add", "-A");
    git(lane.cwd, "commit", "-qm", "W01");
    assert.equal(mergeLane(root, "9a6766-W01", ["scope-breach"]).ok, false);
  } finally {
    done();
  }
});

// `approved` + `open_risks` n'est pas une review terminée : intégrer là-dessus
// retirerait le worktree et la continuation repartirait d'une base contenant
// déjà le changement, avec un diff vide.
test("des risques ouverts interdisent l'intégration", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");
    const m = mergeLane(root, "9a6766-W01", ["open-risks"]);
    assert.equal(m.ok, false);
    assert.match(m.reason, /open-risks/);
    assert.deepEqual(openLanes(root), ["9a6766-W01"]);
  } finally {
    done();
  }
});

test("une lane non approuvée ne s'intègre pas", () => {
  const { root, done } = repo();
  try {
    ensureLane(root, "9a6766-W01");
    assert.equal(mergeLane(root, "9a6766-W01", ["not-approved"]).ok, false);
  } finally {
    done();
  }
});

// Git reste le dernier filet, jamais la preuve d'indépendance — mais quand il
// refuse, il ne doit pas laisser le dépôt en plein merge pour la lane suivante.
test("un conflit git est rapporté et ne laisse rien en cours", () => {
  const { root, done } = repo();
  try {
    const one = ensureLane(root, "9a6766-W01");
    writeFileSync(join(one.cwd, "src", "a.py"), "a = depuis W01\n");
    git(one.cwd, "add", "-A");
    git(one.cwd, "commit", "-qm", "W01");

    const two = ensureLane(root, "9a6766-W02");
    writeFileSync(join(two.cwd, "src", "a.py"), "a = depuis W02\n");
    git(two.cwd, "add", "-A");
    git(two.cwd, "commit", "-qm", "W02");

    assert.equal(mergeLane(root, "9a6766-W01", []).ok, true);
    const m = mergeLane(root, "9a6766-W02", []);
    assert.equal(m.ok, false);
    assert.deepEqual(m.conflicts, ["src/a.py"]);
    assert.equal(git(root, "status", "--porcelain").trim(), "");
    assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "a = depuis W01\n");
  } finally {
    done();
  }
});

/*
 * Le chemin réel : un worker écrit sans commiter, le runtime gèle, le merge
 * échoue.
 *
 * Le test de conflit ci-dessus commite lui-même les deux lanes, donc il
 * n'éprouve pas ce chemin — et c'est là que le gel introduit par la passe
 * précédente pouvait rendre la lane survivante invisible : HEAD avancé, arbre
 * propre, `laneChanges` vide.
 */
test("après un conflit, la lane retrouve son changement non gelé", () => {
  const { root, done } = repo();
  try {
    const one = ensureLane(root, "9a6766-W01");
    writeFileSync(join(one.cwd, "src", "a.py"), "a = depuis W01\n");
    const two = ensureLane(root, "9a6766-W02");
    writeFileSync(join(two.cwd, "src", "a.py"), "a = depuis W02\n");

    assert.equal(mergeLane(root, "9a6766-W01", []).ok, true);
    const m = mergeLane(root, "9a6766-W02", []);
    assert.equal(m.ok, false);
    assert.deepEqual(m.conflicts, ["src/a.py"]);

    // La lane survit, et le runtime voit toujours ce qu'elle contient.
    assert.ok(openLanes(root).includes("9a6766-W02"));
    assert.deepEqual(laneChanges(root, "9a6766-W02"), ["src/a.py"]);
    assert.equal(readFileSync(join(two.cwd, "src", "a.py"), "utf-8"), "a = depuis W02\n");
    assert.match(git(two.cwd, "status", "--porcelain"), /src\/a\.py/);
  } finally {
    done();
  }
});

// Une seconde tentative après correction doit pouvoir aboutir : la lane n'est
// pas restée dans un état intermédiaire.
test("une lane reprise après conflit peut être intégrée", () => {
  const { root, done } = repo();
  try {
    const one = ensureLane(root, "9a6766-W01");
    writeFileSync(join(one.cwd, "src", "a.py"), "a = depuis W01\n");
    const two = ensureLane(root, "9a6766-W02");
    writeFileSync(join(two.cwd, "src", "a.py"), "a = depuis W02\n");
    mergeLane(root, "9a6766-W01", []);
    mergeLane(root, "9a6766-W02", []);

    // Le rework abandonne le fichier en conflit et travaille ailleurs.
    git(two.cwd, "checkout", "--", "src/a.py");
    writeFileSync(join(two.cwd, "src", "b.py"), "b = depuis W02\n");
    assert.equal(mergeLane(root, "9a6766-W02", []).ok, true);
    assert.equal(readFileSync(join(root, "src", "b.py"), "utf-8"), "b = depuis W02\n");
    assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "a = depuis W01\n");
  } finally {
    done();
  }
});

// ------------------------------------------- l'observation dans un worktree

/*
 * Demandé explicitement avant de confier à `treeState` le dépassement de scope
 * et la frontière de review.
 *
 * Un statut git reste `M` avant et après : si `treeState` ne retenait que le
 * statut, une seconde modification d'un fichier déjà sale serait invisible.
 * Elle retient un hachage du contenu, donc elle la voit — mais l'affirmer sans
 * l'éprouver serait exactement le genre de propriété qu'on découvre fausse au
 * mauvais moment.
 */
test("une nouvelle modification d'un fichier déjà sale est observée", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 2\n");

    const before = treeState(lane.cwd);
    writeFileSync(join(lane.cwd, "src", "a.py"), "a = 3\n");
    const after = treeState(lane.cwd);

    assert.deepEqual(changedBetween(before, after), ["src/a.py"]);
  } finally {
    done();
  }
});

test("une observation dans une lane ignore ce que fait l'autre", () => {
  const { root, done } = repo();
  try {
    const one = ensureLane(root, "9a6766-W01");
    const two = ensureLane(root, "9a6766-W02");
    const before = treeState(one.cwd);
    writeFileSync(join(two.cwd, "src", "b.py"), "b = 2\n");
    assert.deepEqual(changedBetween(before, treeState(one.cwd)), []);
  } finally {
    done();
  }
});

test("un fichier supprimé dans une lane est observé", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "9a6766-W01");
    const before = treeState(lane.cwd);
    rmSync(join(lane.cwd, "src", "b.py"));
    assert.deepEqual(changedBetween(before, treeState(lane.cwd)), ["src/b.py"]);
  } finally {
    done();
  }
});
