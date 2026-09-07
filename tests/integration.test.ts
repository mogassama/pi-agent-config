/**
 * integration.test.ts — construire, reviewer et intégrer un merge conflictuel.
 *
 * Du git réel, comme `worktree.test.ts` : l'isolation et l'exactitude d'un merge
 * sont exactement ce qu'on ne peut pas éprouver en simulant. Chaque cas monte un
 * dépôt, l'utilise, et le détruit.
 *
 * La propriété que ce fichier démontre, et la seule : une intégration
 * conflictuelle se construit dans un contexte isolé, se revoit sur le bon objet,
 * et s'intègre exactement — sans que l'agent possède git, et sans que la racine
 * bouge avant la décision finale.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeAttempt,
  commitIntegration,
  integrationMessage,
  integrationReview,
  integrationTree,
  integrationsDir,
  landIntegration,
  mergeShapeError,
  openIntegration,
  openIntegrations,
  removeIntegration,
  supersedeAttempt,
} from "../subagent-only/integration.ts";
import { attemptId } from "../subagent-only/integration-ledger.ts";
import { commitLane, ensureLane, laneTip } from "../subagent-only/worktree.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

function repo(): { root: string; done: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-integ-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "ligne = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Une lane qui touche `src/a.py`, gelée par le runtime, et la racine qui touche
 * la même ligne. Le merge conflictuel que 3c.1c existe pour traiter.
 */
function laneEnConflit(root: string, laneId = "run1-W03"): string {
  const lane = ensureLane(root, laneId);
  writeFileSync(join(lane.cwd, "src", "a.py"), "ligne = 'lane'\n");
  commitLane(root, laneId, "wip: lane");
  writeFileSync(join(root, "src", "a.py"), "ligne = 'racine'\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "racine avance");
  return laneTip(root, laneId)!;
}

const ID = attemptId("run1", "W03", 1);

// ------------------------------------------------------------ le contexte

test("le contexte est un worktree détaché, hors de la racine et des lanes", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.ok(r.attempt.dir.startsWith(integrationsDir(root)));
    assert.ok(r.attempt.dir.includes(".git"));
    // Détaché : `HEAD` ne nomme aucune branche, et aucune n'a été créée pour ce
    // contexte. Une branche serait une identité durable parallèle aux lanes,
    // avec sa provenance à tenir et son entrée dans les observations.
    assert.equal(git(r.attempt.dir, "rev-parse", "--abbrev-ref", "HEAD").trim(), "HEAD");
    const branches = git(root, "branch", "--list", "--format=%(refname:short)")
      .split("\n").map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(branches.filter((b) => b.includes("integration")), []);
    assert.deepEqual(openIntegrations(root), [ID]);
    // Et la racine n'a pas bougé.
    assert.equal(git(root, "rev-parse", "HEAD").trim(), r.attempt.p1);
    assert.equal(git(root, "status", "--porcelain").trim(), "");
  } finally {
    done();
  }
});

test("le conflit est relevé à l'ouverture, avec ses deux bornes", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const p1 = git(root, "rev-parse", "HEAD").trim();
    const r = openIntegration(root, ID, tip);
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(r.attempt.clean, false);
    assert.deepEqual(r.attempt.conflicts, ["src/a.py"]);
    assert.equal(r.attempt.p1, p1);
    assert.equal(r.attempt.p2, tip);
    // Le conflit est bien dans le contexte, pas ailleurs.
    assert.match(readFileSync(join(r.attempt.dir, "src", "a.py"), "utf-8"), /<<<<<<</);
  } finally {
    done();
  }
});

test("un merge sans conflit s'ouvre proprement et se traite pareil", () => {
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "run1-W09");
    writeFileSync(join(lane.cwd, "src", "b.py"), "b = 2\n");
    commitLane(root, "run1-W09", "wip: lane");
    const tip = laneTip(root, "run1-W09")!;

    const r = openIntegration(root, attemptId("run1", "W09", 1), tip);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.attempt.clean, true);
    assert.deepEqual(r.attempt.conflicts, []);
  } finally {
    done();
  }
});

// ------------------------------------------------------------------- le tree

test("une résolution donne un tree ; des marqueurs oubliés n'en donnent pas", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);

    // Le fichier tel que git l'a laissé : marqueurs compris.
    const rate = integrationTree(r.attempt.dir);
    assert.equal(rate.ok, false);
    if (!rate.ok) assert.match(rate.reason, /marqueurs de conflit/);

    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    assert.equal(t.ok, true);
    if (t.ok) assert.match(t.tree, /^[0-9a-f]{40}$/);
  } finally {
    done();
  }
});

test("un espace en fin de ligne n'est pas un conflit non résolu", () => {
  // `git diff --check` signale aussi les espaces parasites. Refuser une
  // intégration pour un espace serait un refus que personne ne comprendrait.
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'   \n");
    assert.equal(integrationTree(r.attempt.dir).ok, true);
  } finally {
    done();
  }
});

// ----------------------------------------------------------------- la review

test("la review reçoit les deux vues, et rien de ce qui a été intégré avant", () => {
  /*
   * Le cas que `laneChanges` ne saurait pas rendre.
   *
   * Une autre unité a été intégrée dans la base avant cette tentative. Elle est
   * dans `P1`, donc dans les deux côtés du diff, donc dans aucun des deux.
   * Comparer la lane à HEAD la ferait entrer dans la review d'une unité dont
   * l'auteur n'est pas devant le reviewer.
   */
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "run1-W03");
    writeFileSync(join(lane.cwd, "src", "a.py"), "ligne = 'lane'\n");
    commitLane(root, "run1-W03", "wip: lane");

    // Une autre unité entre dans la base, sur un autre fichier.
    writeFileSync(join(root, "src", "b.py"), "b = 'déjà intégré'\n");
    // Et la base touche aussi la ligne que la lane a changée.
    writeFileSync(join(root, "src", "a.py"), "ligne = 'racine'\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "W07 intégrée, et la base avance");

    const tip = laneTip(root, "run1-W03")!;
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    const rv = integrationReview(r.attempt.dir, r.attempt, t.tree);
    assert.equal(rv.ok, true);
    if (!rv.ok) return;
    const revue = rv.review;

    // Ce que l'intégration ajoute à la base : la ligne résolue, rien d'autre.
    assert.match(revue.fromBase, /src\/a\.py/);
    assert.match(revue.fromBase, /résolu/);
    assert.doesNotMatch(revue.fromBase, /src\/b\.py/,
      "le travail déjà intégré dans P1 n'a pas à être dans cette review");
    assert.doesNotMatch(revue.fromBase, /déjà intégré/);

    /*
     * Et la seconde vue non plus, ce qui est la correction de ce lot.
     *
     * `P2 → T` non filtré porte tout ce que la base a acquis depuis le départ de
     * la lane : `b.py` est absent de `P2`, présent dans `T`, donc il y
     * apparaissait sans que personne l'ait touché. Restreinte aux fichiers en
     * conflit, la vue tient ce qu'elle promet.
     */
    assert.match(revue.fromLaneOnConflicts, /src\/a\.py/);
    assert.match(revue.fromLaneOnConflicts, /résolu/);
    assert.doesNotMatch(revue.fromLaneOnConflicts, /src\/b\.py/,
      "une unité intégrée avant cette tentative n'est pas de la résolution");
    assert.doesNotMatch(revue.fromLaneOnConflicts, /déjà intégré/);
    assert.deepEqual(revue.conflicts, ["src/a.py"]);
  } finally {
    done();
  }
});

// -------------------------------------------------------------------- M et le ff

test("M porte exactement le tree revu et les deux parents attendus", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    const m = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(m.ok, true);
    if (!m.ok) return;

    assert.equal(git(root, "rev-parse", `${m.integration.commit}^{tree}`).trim(), t.tree);
    assert.equal(git(root, "rev-parse", `${m.integration.commit}^1`).trim(), r.attempt.p1);
    assert.equal(git(root, "rev-parse", `${m.integration.commit}^2`).trim(), r.attempt.p2);
    // Créer M ne touche aucune branche : la racine est où elle était, et M est
    // le HEAD détaché du contexte, donc observable là où il a été fait.
    assert.equal(git(root, "rev-parse", "HEAD").trim(), r.attempt.p1);
    assert.equal(git(r.attempt.dir, "rev-parse", "HEAD").trim(), m.integration.commit);
  } finally {
    done();
  }
});

test("un tree qui a changé depuis la review ne devient pas un commit", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    // Quelque chose bouge après l'approbation.
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'autre chose'\n");
    const m = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(m.ok, false);
    if (!m.ok) assert.match(m.reason, /le contexte a changé depuis la review/);
  } finally {
    done();
  }
});

test("l'intégration avance la racine et enregistre après, pas avant", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);
    const m = commitIntegration(r.attempt, t.tree, "W03");
    if (!m.ok) return assert.fail(m.reason);

    const traces: string[] = [];
    const atterri = landIntegration(root, m.integration, (commit) => {
      // Au moment où la preuve s'écrit, l'effet est déjà là.
      traces.push(git(root, "rev-parse", "HEAD").trim() === commit ? "racine sur M" : "racine ailleurs");
    });
    assert.equal(atterri.ok, true);
    assert.deepEqual(traces, ["racine sur M"]);
    assert.equal(git(root, "rev-parse", "HEAD").trim(), m.integration.commit);
    assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "ligne = 'résolu'\n");
  } finally {
    done();
  }
});

test("une base qui a bougé rend la tentative périmée, sans réconciliation", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);
    const m = commitIntegration(r.attempt, t.tree, "W03");
    if (!m.ok) return assert.fail(m.reason);

    // La racine avance entre la review et l'intégration.
    writeFileSync(join(root, "src", "b.py"), "b = 3\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "une autre intégration passe devant");
    const apres = git(root, "rev-parse", "HEAD").trim();

    let enregistre = false;
    const atterri = landIntegration(root, m.integration, () => {
      enregistre = true;
    });
    assert.equal(atterri.ok, false);
    if (!atterri.ok) {
      assert.equal(atterri.stale, true);
      assert.match(atterri.reason, /la base d'intégration a bougé/);
    }
    assert.equal(enregistre, false, "rien n'est enregistré sur une tentative périmée");
    assert.equal(git(root, "rev-parse", "HEAD").trim(), apres, "la racine n'a pas été touchée");
  } finally {
    done();
  }
});

test("un enregistrement qui échoue laisse une intégration à diagnostiquer", () => {
  /*
   * L'effet d'abord, l'événement ensuite. `M` est dans la racine et le registre
   * ne le sait pas : une intégration non enregistrée, qui se voit à la reprise.
   * L'ordre inverse produirait un fait durable affirmant une intégration qui
   * n'a pas eu lieu.
   */
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);
    const m = commitIntegration(r.attempt, t.tree, "W03");
    if (!m.ok) return assert.fail(m.reason);

    assert.throws(
      () => landIntegration(root, m.integration, () => {
        throw new Error("bail perdu");
      }),
      /bail perdu/,
    );
    assert.equal(git(root, "rev-parse", "HEAD").trim(), m.integration.commit);
    // Et le contexte reste observable : le nettoyage n'est pas de ce lot.
    assert.deepEqual(openIntegrations(root), [ID]);
  } finally {
    done();
  }
});

// ------------------------------------------------------------------- reprise

test("une tentative se retire et une seconde s'ouvre depuis la nouvelle base", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const premiere = openIntegration(root, ID, tip);
    if (!premiere.ok) return assert.fail(premiere.reason);

    // Deux fois la même tentative, c'est un refus : un contexte n'est pas
    // réutilisé, il est refait.
    const doublon = openIntegration(root, ID, tip);
    assert.equal(doublon.ok, false);
    if (!doublon.ok) assert.match(doublon.reason, /existe déjà/);

    // La base bouge, la première tentative est périmée.
    writeFileSync(join(root, "src", "b.py"), "b = 3\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "la base avance");
    const nouvelleBase = git(root, "rev-parse", "HEAD").trim();

    assert.equal(removeIntegration(root, ID), true);
    assert.equal(existsSync(premiere.attempt.dir), false);

    const seconde = openIntegration(root, attemptId("run1", "W03", 2), tip);
    if (!seconde.ok) return assert.fail(seconde.reason);
    assert.equal(seconde.attempt.p1, nouvelleBase, "la seconde part de la réalité courante");
    assert.equal(seconde.attempt.p2, tip, "et du même travail de lane");
  } finally {
    done();
  }
});

test("un commit inconnu du dépôt n'ouvre aucun contexte", () => {
  const { root, done } = repo();
  try {
    const r = openIntegration(root, ID, "0".repeat(40));
    assert.equal(r.ok, false);
    assert.deepEqual(openIntegrations(root), [], "aucun worktree laissé derrière");
  } finally {
    done();
  }
});

// ------------------------------------------ la forme de M, éprouvée seule

/*
 * Dans le trajet nominal, `commit-tree` reçoit le tree et les parents qu'on lui
 * donne : la vérification ne peut pas échouer, et la retirer ne casse rien. Une
 * garde qu'on croit avoir. Elle se teste donc sur des commits délibérément mal
 * formés, fabriqués ici.
 */
test("un merge mal formé est reconnu comme tel", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);
    const { p1, p2, dir } = r.attempt;

    const bon = git(dir, "commit-tree", t.tree, "-p", p1, "-p", p2, "-m", "ok").trim();
    assert.equal(mergeShapeError(dir, bon, t.tree, p1, p2), null);

    // Parents inversés : le merge existe, il n'est pas celui qu'on voulait.
    const inverse = git(dir, "commit-tree", t.tree, "-p", p2, "-p", p1, "-m", "inversé").trim();
    assert.match(mergeShapeError(dir, inverse, t.tree, p1, p2) ?? "", /deux parents attendus/);

    // Un seul parent : ce n'est plus un merge, et `P2` n'est plus prouvable.
    const simple = git(dir, "commit-tree", t.tree, "-p", p1, "-m", "simple").trim();
    assert.match(mergeShapeError(dir, simple, t.tree, p1, p2) ?? "", /deux parents attendus/);

    // Trois parents : un octopus intégrerait un travail que personne n'a revu.
    const troisieme = git(root, "rev-parse", `${p1}^`).trim();
    const octopus = git(dir, "commit-tree", t.tree,
      "-p", p1, "-p", p2, "-p", troisieme, "-m", "octopus").trim();
    assert.match(mergeShapeError(dir, octopus, t.tree, p1, p2) ?? "", /deux parents attendus/);

    // Le tree d'autre chose, avec les bons parents : la forme est bonne, le
    // contenu n'est pas celui qui a été revu.
    const autreTree = git(dir, "rev-parse", `${p1}^{tree}`).trim();
    const mauvaisTree = git(dir, "commit-tree", autreTree, "-p", p1, "-p", p2, "-m", "autre").trim();
    assert.match(mergeShapeError(dir, mauvaisTree, t.tree, p1, p2) ?? "", /ne porte pas le tree revu/);
  } finally {
    done();
  }
});

test("un même tree obtenu sans le merge ne donne pas un commit", () => {
  /*
   * Le recalcul de `T` seul ne suffirait pas.
   *
   * Le merge est défait, puis les fichiers sont réécrits pour retrouver
   * exactement le même contenu. `T` recalculé est identique, `HEAD` est toujours
   * `P1` — et pourtant `P2` n'est plus fusionné. Un commit créé là aurait la
   * bonne forme et prétendrait intégrer un travail qu'il ne contient pas.
   */
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    const resolu = "ligne = 'résolu'\n";
    writeFileSync(join(r.attempt.dir, "src", "a.py"), resolu);
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    git(r.attempt.dir, "merge", "--abort");
    writeFileSync(join(r.attempt.dir, "src", "a.py"), resolu);
    const recalcule = integrationTree(r.attempt.dir);
    assert.equal(recalcule.ok && recalcule.tree, t.tree, "le tree est bien le même");
    assert.equal(git(r.attempt.dir, "rev-parse", "HEAD").trim(), r.attempt.p1);

    const m = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(m.ok, false);
    if (!m.ok) assert.match(m.reason, /ne fusionne plus le commit de la lane/);
  } finally {
    done();
  }
});

test("un merge refusé sans conflit ne laisse pas de contexte derrière", () => {
  /*
   * Histoire non liée : git refuse avant d'avoir quoi que ce soit à fusionner,
   * donc aucun fichier n'est en conflit. Le worktree a pourtant déjà été créé,
   * et le laisser serait un résidu qu'aucun relevé n'attend.
   */
  const { root, done } = repo();
  try {
    const arbre = git(root, "rev-parse", "HEAD^{tree}").trim();
    const orphelin = git(root, "commit-tree", arbre, "-m", "sans ancêtre").trim();

    const r = openIntegration(root, ID, orphelin);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /merge refusé sans conflit nommé/);
    assert.deepEqual(openIntegrations(root), []);
    assert.equal(existsSync(join(integrationsDir(root), ID)), false);
  } finally {
    done();
  }
});

// ------------------------------------- les hooks du dépôt s'appliquent à M

/*
 * `commit-tree` ne déclenche aucun hook. `git commit` si.
 *
 * Un dépôt peut avoir une politique de commit ; pi ne doit pas la respecter
 * partout sauf au moment des conflits. Ces deux tests sont la seule preuve que
 * le chemin choisi la respecte — le premier tombe si on revient à
 * `commit-tree`, qui passerait outre sans rien dire.
 */
function hooks(root: string, contenu: string): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-hooks-"));
  writeFileSync(join(dir, "commit-msg"), contenu, { mode: 0o755 });
  git(root, "config", "core.hooksPath", dir);
}

test("un hook qui refuse le message empêche la création de M", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    hooks(root, "#!/bin/sh\necho 'refusé par la politique du dépôt' >&2\nexit 1\n");
    const m = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(m.ok, false);
    if (!m.ok) assert.match(m.reason, /commit refusé/);
    // Et le contexte n'a pas avancé : rien n'a été créé.
    assert.equal(git(r.attempt.dir, "rev-parse", "HEAD").trim(), r.attempt.p1);
  } finally {
    done();
  }
});

test("le message d'intégration vient du runtime, pas de l'appelant", () => {
  const { root, done } = repo();
  try {
    assert.equal(integrationMessage("W03"), "chore(subagent): integrate W03");

    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    // Un hook qui n'accepte que le message que le runtime fabrique.
    hooks(root, `#!/bin/sh\ngrep -qx 'chore(subagent): integrate W03' "$1" || exit 1\n`);
    const m = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(m.ok, true, m.ok ? "" : m.reason);
    if (m.ok) {
      assert.equal(
        git(root, "log", "-1", "--format=%s", m.integration.commit).trim(),
        "chore(subagent): integrate W03",
      );
    }
  } finally {
    done();
  }
});

// --------------------------------- la racine est un point d'intégration

test("une racine sale n'ouvre pas de contexte", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    writeFileSync(join(root, "brouillon.txt"), "travail non suivi\n");
    const r = openIntegration(root, ID, tip);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /qu'aucun commit ne représente/);
    assert.deepEqual(openIntegrations(root), []);
  } finally {
    done();
  }
});

test("une racine salie pendant la review n'est pas avancée", () => {
  /*
   * `merge --ff-only` réussit par-dessus un fichier sale sans chevauchement, et
   * le laisse là : la racine porterait alors un état qu'aucun commit ne
   * représente, après une intégration réussie. L'échec de git ne suffit donc pas
   * à tenir l'invariant, il faut le vérifier.
   */
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);
    const m = commitIntegration(r.attempt, t.tree, "W03");
    if (!m.ok) return assert.fail(m.reason);

    writeFileSync(join(root, "brouillon.txt"), "sans rapport, et non suivi\n");
    let enregistre = false;
    const atterri = landIntegration(root, m.integration, () => { enregistre = true; });
    assert.equal(atterri.ok, false);
    if (!atterri.ok) {
      assert.equal(atterri.stale, false, "sale n'est pas périmé : la base n'a pas bougé");
      assert.match(atterri.reason, /qu'aucun commit ne représente/);
    }
    assert.equal(enregistre, false);
    assert.equal(git(root, "rev-parse", "HEAD").trim(), r.attempt.p1);
  } finally {
    done();
  }
});

// ------------------------- la primitive d'effet ne fait confiance à personne

test("un commit qui n'est pas le merge revu n'atterrit pas, même s'il est ff-able", () => {
  /*
   * Le trou que la revalidation ferme.
   *
   * Un commit simple descendant de `P1` passe un `merge --ff-only` sans rien
   * dire. Une erreur de câblage — le bon `M` calculé, un autre SHA passé —
   * avançait donc la racine sur un commit qui n'est ni le tree revu ni le merge
   * attendu. Ce qui touche la racine ne dépend plus d'un rapprochement correct
   * fait ailleurs.
   */
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);
    const m = commitIntegration(r.attempt, t.tree, "W03");
    if (!m.ok) return assert.fail(m.reason);

    // Un descendant direct de P1, à un seul parent, parfaitement ff-able.
    const intrus = git(r.attempt.dir, "commit-tree", t.tree,
      "-p", r.attempt.p1, "-m", "intrus").trim();
    assert.equal(git(root, "rev-parse", `${intrus}^`).trim(), r.attempt.p1);

    let enregistre = false;
    const atterri = landIntegration(
      root,
      { ...m.integration, commit: intrus },
      () => { enregistre = true; },
    );
    assert.equal(atterri.ok, false);
    if (!atterri.ok) assert.match(atterri.reason, /deux parents attendus/);
    assert.equal(enregistre, false);
    assert.equal(git(root, "rev-parse", "HEAD").trim(), r.attempt.p1, "la racine n'a pas bougé");
  } finally {
    done();
  }
});

test("une review dont un diff échoue ne produit pas de paquet vide", () => {
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    // Une borne que le dépôt ne connaît pas : le diff ne peut pas être calculé.
    const rv = integrationReview(r.attempt.dir, { ...r.attempt, p1: "0".repeat(40) }, t.tree);
    assert.equal(rv.ok, false);
    if (!rv.ok) assert.match(rv.reason, /refusé/);
  } finally {
    done();
  }
});

test("un merge propre n'a pas de vue de résolution", () => {
  // Sans conflit, la seconde vue n'a pas d'objet — et surtout, passer une liste
  // de chemins vide à `git diff` rendrait le diff entier.
  const { root, done } = repo();
  try {
    const lane = ensureLane(root, "run1-W09");
    writeFileSync(join(lane.cwd, "src", "b.py"), "b = 2\n");
    commitLane(root, "run1-W09", "wip: lane");
    const tip = laneTip(root, "run1-W09")!;
    const r = openIntegration(root, attemptId("run1", "W09", 7), tip);
    if (!r.ok) return assert.fail(r.reason);
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    const rv = integrationReview(r.attempt.dir, r.attempt, t.tree);
    assert.equal(rv.ok, true);
    if (!rv.ok) return;
    assert.equal(rv.review.fromLaneOnConflicts, "");
    assert.match(rv.review.fromBase, /src\/b\.py/);
  } finally {
    done();
  }
});

test("un contexte dont la base a été déplacée ne produit pas de commit", () => {
  /*
   * La garde `HEAD == P1` du contexte, mise en défaut pour de vrai.
   *
   * Un `reset` effacerait `MERGE_HEAD` et l'autre garde attraperait ; c'est
   * `update-ref` qui déplace `HEAD` en laissant le merge en cours et l'index
   * intact. Le tree recalculé est alors identique, `MERGE_HEAD` est toujours
   * `P2` — et un commit créé là aurait `P1` d'origine remplacé par autre chose
   * comme premier parent.
   */
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    const ailleurs = git(root, "rev-parse", `${r.attempt.p1}^`).trim();
    git(r.attempt.dir, "update-ref", "HEAD", ailleurs);
    assert.equal(git(r.attempt.dir, "rev-parse", "MERGE_HEAD").trim(), r.attempt.p2,
      "le merge est toujours en cours");

    const m = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(m.ok, false);
    if (!m.ok) assert.match(m.reason, /n'est plus sur sa base d'intégration/);
  } finally {
    done();
  }
});

test("un échec de postcondition après le commit se distingue d'un échec avant", () => {
  /*
   * Depuis que `M` passe par `git commit`, un échec de forme arrive après que le
   * contexte a avancé : plus de `MERGE_HEAD`, `HEAD` déplacé. L'appelant doit
   * pouvoir le distinguer d'un refus antérieur, sans quoi il renverrait un agent
   * résoudre un conflit dans un contexte qui n'en a plus.
   */
  const { root, done } = repo();
  try {
    const tip = laneEnConflit(root);
    const r = openIntegration(root, ID, tip);
    if (!r.ok) return assert.fail(r.reason);
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    const t = integrationTree(r.attempt.dir);
    if (!t.ok) return assert.fail(t.reason);

    // Avant : un tree qui a bougé, rien n'a été créé.
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'autre'\n");
    const avant = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(avant.ok, false);
    if (!avant.ok) assert.equal(avant.committed, false);
    assert.equal(git(r.attempt.dir, "rev-parse", "HEAD").trim(), r.attempt.p1);

    // Un hook qui refuse : rien n'a été créé non plus.
    writeFileSync(join(r.attempt.dir, "src", "a.py"), "ligne = 'résolu'\n");
    hooks(root, "#!/bin/sh\nexit 1\n");
    const refuse = commitIntegration(r.attempt, t.tree, "W03");
    assert.equal(refuse.ok, false);
    if (!refuse.ok) assert.equal(refuse.committed, false);
    assert.equal(git(r.attempt.dir, "rev-parse", "HEAD").trim(), r.attempt.p1);
  } finally {
    done();
  }
});

test("un remplacement enregistre les deux faits avant de nettoyer", () => {
  /*
   * La fenêtre de crash qui compte, rendue vérifiable.
   *
   * Dans l'ordre retenu, un crash au nettoyage laisse `I1` remplacée avec son
   * contexte encore là : un résidu nommé. Dans l'ordre inverse, il laisserait
   * deux tentatives vivantes dont l'une sans contexte — deux contradictions au
   * lieu d'un résidu.
   */
  const etapes: string[] = [];
  assert.throws(
    () =>
      supersedeAttempt(
        "I1",
        (etape) => etapes.push(etape),
        (id) => {
          etapes.push(`nettoyage ${id}`);
          throw new Error("worktree verrouillé");
        },
      ),
    /worktree verrouillé/,
  );
  assert.deepEqual(etapes, ["opened", "superseded", "nettoyage I1"]);
});

test("un remplacement sans incident nettoie en dernier", () => {
  const etapes: string[] = [];
  supersedeAttempt("I1", (e) => etapes.push(e), (id) => etapes.push(`nettoyage ${id}`));
  assert.deepEqual(etapes, ["opened", "superseded", "nettoyage I1"]);
});

test("une clôture enregistre avant de nettoyer", () => {
  /*
   * Un crash après l'enregistrement laisse un contexte que le registre dit
   * terminé : un résidu nommé. Dans l'autre ordre, il laisserait un contexte
   * absent sous une tentative que le registre croit vivante — une contradiction
   * qui ferme le run, pour une décision qui s'était pourtant bien passée.
   */
  const etapes: string[] = [];
  assert.throws(
    () => closeAttempt("I1", () => etapes.push("closed"), (id) => {
      etapes.push(`nettoyage ${id}`);
      throw new Error("worktree verrouillé");
    }),
    /worktree verrouillé/,
  );
  assert.deepEqual(etapes, ["closed", "nettoyage I1"]);
});
