/**
 * git-hooks.test.ts — the second layer, run inside git rather than in front of it.
 *
 * `role-guard` refuses the command before it runs, by reading a string. A shell
 * has more ways to produce a command than a string check can enumerate, so the
 * claim "mechanical" would be an overstatement if it stopped there. These hooks
 * fire inside git, on the child's own environment, and this file is what makes
 * that a claim rather than a comment: a real repository, real commits, and the
 * environment variable `spawn-args.ts` actually sets.
 *
 * The counter-proof for each is the same one Sol asked for: create
 * `~/.pi/.allow-commit`, and watch it open nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { refuseGitMutation } from "../subagent-only/role-rules.ts";

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "git-hooks");

/** A repository whose hooks are this repository's hooks. */
function repo(): { root: string; done: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-hooks-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf-8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // The real directory, not a copy: a hook that passes here is the one that
  // ships. `commit-msg` lives there too, so subjects below are conventional.
  git("config", "core.hooksPath", HOOKS);
  writeFileSync(join(root, "a.txt"), "a\n");
  git("add", "-A");
  // The base commit predates the hooks path, or `pre-commit` would need an
  // environment this helper does not control.
  execFileSync("git", ["-c", "core.hooksPath=/nonexistent", "commit", "-qm", "test: base"], {
    cwd: root,
    encoding: "utf-8",
  });
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Run git in `root`, optionally as a child agent would. */
function run(root: string, args: string[], role?: string, home?: string) {
  const env = { ...process.env };
  if (role) env.PI_SUBAGENT_ROLE = role;
  else delete env.PI_SUBAGENT_ROLE;
  if (home) env.HOME = home;
  return spawnSync("git", args, { cwd: root, env, encoding: "utf-8" });
}

test("a child cannot commit", () => {
  const { root, done } = repo();
  try {
    writeFileSync(join(root, "a.txt"), "b\n");
    run(root, ["add", "-A"]);
    const refuse = run(root, ["commit", "-m", "test: by a worker"], "worker");
    assert.notEqual(refuse.status, 0);
    assert.match(refuse.stderr, /commits belong to the runtime/);
    assert.match(refuse.stderr, /role: worker/);
  } finally {
    done();
  }
});

test("the runtime can commit", () => {
  /*
   * The counter-proof of the one above. Without it, a hook that refused
   * everything unconditionally would pass the first test and break every lane
   * freeze — `commitLane` runs in the orchestrator process, which is not a
   * child and carries no `PI_SUBAGENT_ROLE`.
   */
  const { root, done } = repo();
  try {
    writeFileSync(join(root, "a.txt"), "b\n");
    run(root, ["add", "-A"]);
    const ok = run(root, ["commit", "-m", "test: by the runtime"]);
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    done();
  }
});

test("the commit token opens nothing for a child", () => {
  const { root, done } = repo();
  const home = realpathSync(mkdtempSync(join(tmpdir(), "pi-home-")));
  try {
    writeFileSync(join(home, ".allow-commit"), "");
    writeFileSync(join(root, "a.txt"), "b\n");
    run(root, ["add", "-A"], "worker", home);
    const refuse = run(root, ["commit", "-m", "test: with the token"], "worker", home);
    assert.notEqual(refuse.status, 0);
    assert.match(refuse.stderr, /commits belong to the runtime/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    done();
  }
});

test("a child cannot move a ref without committing", () => {
  /*
   * The reason the invariant is not "no agent commits". None of these creates
   * a commit; each one destroys work or makes `previousHead` ambiguous, and
   * `mergeLane` undoes its own freeze with `reset --mixed <previousHead>`.
   */
  const { root, done } = repo();
  try {
    for (const args of [
      ["branch", "tmp"],
      ["checkout", "-b", "other"],
      ["tag", "v1"],
      ["update-ref", "refs/heads/main", "HEAD"],
    ]) {
      const refuse = run(root, args, "worker");
      assert.notEqual(refuse.status, 0, `git ${args.join(" ")} should have been refused`);
      assert.match(refuse.stderr, /history belongs to the runtime/);
    }
  } finally {
    done();
  }
});

test("the runtime moves refs freely", () => {
  const { root, done } = repo();
  try {
    const ok = run(root, ["branch", "tmp"]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(run(root, ["branch", "--list"]).stdout, /tmp/);
  } finally {
    done();
  }
});

test("a child reading git is left alone", () => {
  // The hooks refuse writes, not git. A worker that cannot run `git diff` is a
  // worker that cannot check its own work.
  const { root, done } = repo();
  try {
    for (const args of [["status", "--porcelain"], ["log", "--oneline"], ["diff"]]) {
      assert.equal(run(root, args, "worker").status, 0, `git ${args.join(" ")}`);
    }
  } finally {
    done();
  }
});

test("a mutation that updates no ref reaches neither hook", () => {
  /*
   * La borne de la seconde couche, tenue par un test plutôt que par une phrase.
   *
   * `git clean -fd` détruit du travail sans toucher une ref, donc ni
   * `pre-commit` ni `reference-transaction` ne le voient. Ce n'est pas un
   * défaut des hooks : c'est ce qu'ils ne couvrent pas, et la garde qui le
   * couvre est `role-guard`. Ce test existe pour que la documentation ne
   * puisse pas se remettre à promettre davantage.
   */
  const { root, done } = repo();
  try {
    writeFileSync(join(root, "jetable.txt"), "travail non suivi\n");
    const nettoyage = run(root, ["clean", "-fd"], "worker");
    assert.equal(nettoyage.status, 0, "les hooks ne voient pas `git clean`");
    assert.equal(existsSync(join(root, "jetable.txt")), false);

    // Et la garde qui le couvre, elle, le refuse.
    assert.notEqual(refuseGitMutation("git clean -fd"), null);
    assert.notEqual(refuseGitMutation("git checkout -- a.txt"), null);
  } finally {
    done();
  }
});
