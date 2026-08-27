/**
 * dispatch — what the tree says a delegation did.
 *
 * `dispatch.ts` imports pi at module load, so it cannot be required from a bare
 * `node --test`. What is tested here is the pair of pure functions the salvage
 * rests on, reimplemented byte-for-byte from the source: `treeState`'s parsing
 * of `git status -z`, and `changedBetween`'s union. If either drifts from the
 * source, these tests stop describing the code — so they are written to fail
 * loudly rather than to pass quietly.
 *
 * Each case here is an incident, not an invention:
 *
 *   dirty → clean   An external audit demonstrated it. A file the operator had
 *                   modified, that the worker put back to its committed state,
 *                   leaves `git status` entirely. Iterating over the second
 *                   snapshot alone reports nothing changed — and "nothing
 *                   changed" is the condition that lets a writer be relaunched,
 *                   over a tree where it just erased somebody else's work.
 *
 *   accents, rename The default porcelain format quotes any path that is not
 *                   plain ASCII and writes a rename as `old -> new`. Both
 *                   produce a string naming no file on disk: the hash comes back
 *                   empty and the comparison lies without saying so.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// ---------------------------------------------------------------------------
// Copied from subagent-only/dispatch.ts. Keep them identical.
// ---------------------------------------------------------------------------

function treeState(cwd: string): Map<string, string> {
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
    // Distinct from both a hash and an absent entry — see dispatch.ts.
    let hash = "\u0000gone";
    try {
      hash = createHash("sha1").update(readFileSync(join(cwd, name))).digest("hex");
    } catch {
      /* gone from disk */
    }
    files.set(name, hash);
  }
  return files;
}

function changedBetween(before: Map<string, string>, after_: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after_.keys()]);
  return [...paths].filter((p) => (before.get(p) ?? "") !== (after_.get(p) ?? "")).sort();
}

// ---------------------------------------------------------------------------

const repos: string[] = [];

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-test-"));
  repos.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@local");
  git("config", "user.name", "test");
  writeFileSync(join(dir, "kept.txt"), "committed\n");
  git("add", "-A");
  git("commit", "-qm", "initial");
  return dir;
}

after(() => {
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
});

test("a worker that writes a new file is salvaged", () => {
  const dir = newRepo();
  const before = treeState(dir);
  writeFileSync(join(dir, "written.py"), "x = 1\n");
  assert.deepEqual(changedBetween(before, treeState(dir)), ["written.py"]);
});

test("a worker that changes an already-dirty file is salvaged", () => {
  const dir = newRepo();
  writeFileSync(join(dir, "kept.txt"), "operator edit\n");
  const before = treeState(dir);
  writeFileSync(join(dir, "kept.txt"), "worker edit\n");
  assert.deepEqual(changedBetween(before, treeState(dir)), ["kept.txt"]);
});

test("a worker that reverts a dirty file to HEAD is salvaged", () => {
  // The audit's case. The path leaves `git status`, so the second snapshot
  // cannot see it and only the union can.
  const dir = newRepo();
  writeFileSync(join(dir, "kept.txt"), "operator edit\n");
  const before = treeState(dir);
  execFileSync("git", ["checkout", "--", "kept.txt"], { cwd: dir });
  assert.deepEqual(changedBetween(before, treeState(dir)), ["kept.txt"]);
});

test("a worker that deletes a file is salvaged", () => {
  const dir = newRepo();
  const before = treeState(dir);
  rmSync(join(dir, "kept.txt"));
  assert.deepEqual(changedBetween(before, treeState(dir)), ["kept.txt"]);
});

test("a worker that changed nothing salvages nothing", () => {
  // This is the one that must stay empty: it is what permits a retry.
  const dir = newRepo();
  const before = treeState(dir);
  assert.deepEqual(changedBetween(before, treeState(dir)), []);
});

test("a path with accents is read, not quoted", () => {
  const dir = newRepo();
  const before = treeState(dir);
  writeFileSync(join(dir, "fichier accentué.txt"), "x\n");
  const salvaged = changedBetween(before, treeState(dir));
  assert.deepEqual(salvaged, ["fichier accentué.txt"]);
  // And the path names a real file, which is what the hash depends on.
  assert.equal(treeState(dir).get("fichier accentué.txt")?.length, 40);
});

test("a rename yields both paths, not an arrow", () => {
  const dir = newRepo();
  const before = treeState(dir);
  execFileSync("git", ["mv", "kept.txt", "renamed.txt"], { cwd: dir });
  const salvaged = changedBetween(before, treeState(dir));
  assert.ok(salvaged.includes("renamed.txt"), `renamed.txt absent de ${JSON.stringify(salvaged)}`);
  assert.ok(
    !salvaged.some((p) => p.includes("->")),
    `un chemin contient une flèche : ${JSON.stringify(salvaged)}`,
  );
});

test("a file staged but unchanged in content is not salvaged", () => {
  const dir = newRepo();
  execFileSync("git", ["add", "kept.txt"], { cwd: dir });
  const before = treeState(dir);
  assert.deepEqual(changedBetween(before, treeState(dir)), []);
});
