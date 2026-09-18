/**
 * tree.test.ts — les cas unitaires de `treeState` et `changedBetween`.
 *
 * Ce fichier naît au LOT 3, étape 1. `treeState` était éprouvé en creux par
 * `tests/dispatch.test.ts`, qui s'en sert pour constater ce qu'un agent a écrit ; aucune
 * preuve ne portait sur le module lui-même, et en particulier aucune ne distinguait
 * « l'arbre est propre » de « je n'ai pas pu lire l'arbre ». C'est précisément ce que
 * `L0 REG C-P1-F08` reprochait, et ce que l'étape 1 corrige.
 *
 * Chaque cas monte un vrai dépôt et le détruit : l'observation git est exactement la
 * propriété qu'on ne peut pas éprouver en simulant.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changedBetween, GONE, treeState } from "../subagent-only/tree.ts";

const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/** Un dépôt d'un commit, propre. */
function depot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-tree-"));
  jetables.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return root;
}

/** Un répertoire qui n'est pas un dépôt : git y échoue, il n'y est pas vide. */
function pasUnDepot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-tree-nongit-"));
  jetables.push(root);
  writeFileSync(join(root, "b.py"), "b = 1\n");
  return root;
}

test("un arbre propre s'observe, et ne rend aucun chemin", () => {
  assert.deepEqual([...treeState(depot()).keys()], []);
});

test("un arbre sale rend ses chemins, suivis comme non suivis", () => {
  const root = depot();
  writeFileSync(join(root, "src", "a.py"), "a = 2\n");
  writeFileSync(join(root, "src", "neuf.py"), "n = 1\n");
  assert.deepEqual([...treeState(root).keys()].sort(), ["src/a.py", "src/neuf.py"]);
});

/**
 * Le cœur de `C-P1-F08`, en unitaire.
 *
 * Avant l'étape 1, les deux cas rendaient une Map vide et rien ne les distinguait. Ce
 * que la preuve exige n'est pas un message particulier : c'est que les deux issues
 * diffèrent.
 */
test("un arbre inobservable lève, là où un arbre propre rend une Map vide", () => {
  const propre = treeState(depot());
  assert.equal(propre.size, 0, "l'arbre propre s'observe et ne rend rien");
  assert.throws(() => treeState(pasUnDepot()), /arbre inobservable/);
});

test("un répertoire absent lève aussi : node n'a même pas de processus à lancer", () => {
  assert.throws(
    () => treeState(join(tmpdir(), "pi-tree-absent-0123456789")),
    /arbre inobservable/,
  );
});

/**
 * Le chemin cité est un chemin qui ne nomme aucun fichier.
 *
 * `--porcelain` sans `-z` cite et échappe tout chemin non-ASCII ; le hash revient alors
 * vide et la comparaison ment en silence. `-z` est la raison d'être de ce lecteur.
 */
test("un chemin accentué ou espacé se lit tel quel, et porte un vrai hash", () => {
  const root = depot();
  writeFileSync(join(root, "src", "fichier accentué.py"), "x = 1\n");
  const vu = treeState(root);
  assert.deepEqual([...vu.keys()], ["src/fichier accentué.py"]);
  assert.equal(vu.get("src/fichier accentué.py")?.length, 40, "un sha1, pas une chaîne vide");
});

test("changedBetween voit une modification, dans les deux sens", () => {
  const root = depot();
  const avant = treeState(root);
  writeFileSync(join(root, "src", "a.py"), "a = 2\n");
  const apres = treeState(root);
  assert.deepEqual(changedBetween(avant, apres), ["src/a.py"]);
  assert.deepEqual(changedBetween(apres, avant), ["src/a.py"], "l'union, pas les clés du second");
});

test("changedBetween ne voit rien quand rien ne bouge", () => {
  const root = depot();
  assert.deepEqual(changedBetween(treeState(root), treeState(root)), []);
});

/**
 * `GONE` existe parce que la chaîne vide échouait.
 *
 * Un fichier supprimé d'un arbre propre est absent du premier instantané et vaudrait
 * chaîne vide dans le second : les deux comparaient égal, et la suppression était
 * invisible.
 */
test("un fichier supprimé se voit, et ne vaut pas la chaîne vide", () => {
  const root = depot();
  const avant = treeState(root);
  rmSync(join(root, "src", "a.py"));
  const apres = treeState(root);
  assert.equal(apres.get("src/a.py"), GONE);
  assert.notEqual(GONE, "", "GONE ne peut pas être ce que vaut une entrée absente");
  assert.deepEqual(changedBetween(avant, apres), ["src/a.py"]);
});
