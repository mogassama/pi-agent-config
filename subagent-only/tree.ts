/**
 * What the working tree looks like, and what changed between two looks.
 *
 * A leaf module with no pi import, for the same reason as `attempts.ts` and
 * `fanout.ts`: `tests/dispatch.test.ts` reimplemented both of these with a
 * comment asking that the copies be kept identical. That is a convention, not a
 * mechanism — it stays green while production drifts, which is the arrangement
 * that let four fan-out defects through unseen.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordGitInvocation } from "./git-probe-counter.ts";

/**
 * A path git reports but that cannot be read is gone — deleted, or renamed away.
 *
 * It needs a value that no hash can equal *and* that no absent entry can equal.
 * The empty string fails the second test: a path missing from a snapshot also
 * defaults to empty, so a file deleted from a clean tree was absent from the
 * first snapshot and empty in the second, the two compared equal, and the
 * deletion was invisible.
 */
export const GONE = "\u0000gone";

/**
 * Every path git considers dirty, with a hash of its content.
 *
 * `-z`, because the default porcelain format quotes and escapes any path that is
 * not plain ASCII and writes a rename as `old -> new`. Either produces a string
 * that names no file on disk, so the hash comes back empty and the comparison
 * silently lies. With `-z` each record is NUL-terminated and a rename emits its
 * two paths as two records.
 */
export function treeState(cwd: string): Map<string, string> {
  const files = new Map<string, string>();
  let names: string[];
  try {
    recordGitInvocation();
    const out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const records = out.split("\0").filter(Boolean);
    names = records.map((r) => (/^[ MADRCU?!]{2} /.test(r) ? r.slice(3) : r)).filter(Boolean);
  } catch (err) {
    /*
     * Ne pas avoir pu regarder n'est pas avoir vu qu'il n'y a rien.
     *
     * Une Map vide rendue ici était indiscernable d'un arbre propre. Les deux appelants
     * la comparent à un second instantané pour en déduire ce qu'un agent a écrit : un
     * `git status` en échec rendait donc « rien n'a changé » sur un arbre que personne
     * n'avait pu lire, et l'écriture d'un worker devenait invisible.
     *
     * L'appelant qui veut vraiment traiter l'inobservable comme du vide doit le dire, en
     * attrapant. Aucun ne le fait aujourd'hui, et c'est la bonne valeur par défaut :
     * l'échec remonte plutôt que de se déguiser en constat.
     */
    throw new Error(
      `arbre inobservable dans ${cwd} : ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const name of names) {
    let hash = GONE;
    try {
      hash = createHash("sha1").update(readFileSync(join(cwd, name))).digest("hex");
    } catch {
      /* gone from disk */
    }
    files.set(name, hash);
  }
  return files;
}

/**
 * Paths whose content differs between two snapshots, in either direction.
 *
 * The union matters, not the second snapshot's keys. A file the operator had
 * modified, and that a worker put back to its committed state, leaves
 * `git status` entirely: it is a key of `before` and of neither `after` nor the
 * difference. Iterating over `after` alone reported nothing changed — and
 * "nothing changed" is exactly the condition that lets a writer be relaunched,
 * on a tree where it has just erased somebody else's work.
 */
export function changedBetween(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => (before.get(p) ?? "") !== (after.get(p) ?? "")).sort();
}

/**
 * T_L (C2) : le tree git de l'arbre de travail — suivis, et non suivis non ignorés.
 *
 * Observé dans un index jetable désigné par `GIT_INDEX_FILE`, jamais dans l'index de la
 * lane : l'observation ne modifie pas ce qu'elle regarde. `read-tree HEAD` pose le point
 * de départ, `add -A` y porte l'état exact de l'arbre de travail, suppressions comprises,
 * et `write-tree` le nomme.
 *
 * Une erreur git est un inconnu, jamais un tree vide : elle remonte.
 */
export function workingTree(cwd: string): string {
  const temporaire = mkdtempSync(join(tmpdir(), "pi-tl-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(temporaire, "index") };
  try {
    for (const args of [["read-tree", "HEAD"], ["add", "-A"]]) {
      recordGitInvocation();
      execFileSync("git", args, { cwd, env, stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 });
    }
    recordGitInvocation();
    const tree = execFileSync("git", ["write-tree"], {
      cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
    }).trim();
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`write-tree a rendu ${JSON.stringify(tree)}`);
    return tree;
  } catch (err) {
    throw new Error(`T_L inobservable dans ${cwd} : ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(temporaire, { recursive: true, force: true });
  }
}

/** Le tree d'un commit. Une erreur git est un inconnu : elle remonte. */
export function treeOfCommit(cwd: string, commit: string): string {
  try {
    recordGitInvocation();
    const tree = execFileSync("git", ["rev-parse", "--verify", `${commit}^{tree}`], {
      cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
    }).trim();
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`rev-parse a rendu ${JSON.stringify(tree)}`);
    return tree;
  } catch (err) {
    throw new Error(`tree de ${commit} inobservable : ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Un chemin est-il identique entre deux trees ? Existence, mode, nature et contenu : c'est
 * l'entrée de tree entière que git compare. `0` identique, `1` différent ; toute autre
 * issue est un inconnu et remonte — jamais « identique » déduit d'une panne.
 */
export function pathIdenticalBetweenTrees(cwd: string, from: string, to: string, path: string): boolean {
  let status: number | null;
  try {
    recordGitInvocation();
    execFileSync("git", ["diff-tree", "-r", "--quiet", "--no-renames", from, to, "--", path], {
      cwd, stdio: ["ignore", "ignore", "pipe"], timeout: 30_000,
    });
    return true;
  } catch (err) {
    status = (err as { status?: number | null }).status ?? null;
    if (status === 1) return false;
    throw new Error(
      `comparaison de ${path} inobservable (${from.slice(0, 12)} → ${to.slice(0, 12)}) : ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Le delta réel entre deux trees, restreint à des chemins : un patch, peut-être vide.
 * Une erreur git remonte : un delta illisible n'est pas un delta vide.
 */
export function deltaBetweenTrees(cwd: string, from: string, to: string, paths: readonly string[]): string {
  try {
    recordGitInvocation();
    return execFileSync(
      "git",
      ["diff-tree", "-r", "-p", "--no-color", "--no-renames", "--no-ext-diff", from, to, "--", ...paths],
      { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    throw new Error(
      `delta ${from.slice(0, 12)} → ${to.slice(0, 12)} inobservable : ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Tous les chemins qui diffèrent entre deux trees, récursivement : ajoutés, modifiés,
 * supprimés, changés de mode, de type ou de cible de lien. Triés. `-z` pour qu'un nom
 * exotique ne soit ni cité ni échappé. Une erreur git remonte : une liste illisible n'est
 * pas une liste vide.
 */
export function pathsBetweenTrees(cwd: string, from: string, to: string): string[] {
  let out: string;
  try {
    recordGitInvocation();
    out = execFileSync("git", ["diff-tree", "-r", "-z", "--name-only", "--no-renames", from, to], {
      cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      `chemins ${from.slice(0, 12)} → ${to.slice(0, 12)} inobservables : ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return [...new Set(out.split("\0").filter(Boolean))].sort();
}
