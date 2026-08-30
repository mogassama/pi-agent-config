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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    const out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const records = out.split("\0").filter(Boolean);
    names = records.map((r) => (/^[ MADRCU?!]{2} /.test(r) ? r.slice(3) : r)).filter(Boolean);
  } catch {
    return files;
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
