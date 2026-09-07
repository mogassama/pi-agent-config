/**
 * guards.test.ts — the rules that decide whether something reaches disk.
 *
 * Every case below is a claim the configuration makes in prose somewhere:
 * AGENTS.md says a read-only role cannot write through a shell, `bash-guard`'s
 * header says a commit needs the token, hard limit 1 says a secret is never
 * written to source. A claim with no test is a claim that was true once.
 *
 * The bypass cases are not hypothetical. Each was demonstrated against a
 * previous version of this repository by an external audit, and each one
 * passed. They are here so that the next rewrite of the shell parser has to
 * beat them again.
 *
 * Run: bin/test-guards
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  refuseMutation, refuseGitMutation, gitSubcommand, parseGit, decideRoleGuard,
  bundleRoot, isBundleFile, BUNDLE_FILES,
} from "../subagent-only/role-rules.ts";
import { scan, EXEMPT_PATH } from "../extensions/pi-secret-gate/rules.ts";
import { TOKEN_PATTERNS, TOKEN_FILE_PATTERN, MEDIUM_PATTERNS, findMatch } from "../extensions/bash-guard/patterns.ts";

// ---------------------------------------------------------------------------
// role-rules — a role without edit and write must not write through a shell
// ---------------------------------------------------------------------------

/** Demonstrated bypasses. Each one passed a first-word allowlist. */
const DEMONSTRATED_BYPASSES = [
  "echo $(touch /tmp/probe)",
  "echo `touch /tmp/probe`",
  "env touch /tmp/probe",
  "find . -exec touch /tmp/probe \\;",
  "find . -delete",
  `awk 'BEGIN { system("touch /tmp/probe") }'`,
];

const MUST_REFUSE = [
  ...DEMONSTRATED_BYPASSES,
  "rm -rf build",
  "mv a.py b.py",
  "cp a.py b.py",
  "echo x > out.txt",
  "cat a >> b",
  "sed -i 's/a/b/' f.py",
  "perl -i -pe 's/a/b/' f.py",
  "git add .",
  "git commit -m x",
  "git checkout -- src/",
  "git config --global --unset some.key",
  "git config user.name mo",
  "pip install requests",
  `python -c "open('f','w').write('x')"`,
  "rg foo | tee out.txt",
  "git ls-files -z | xargs -0 rg pattern",
  `awk '{print > "out.txt"}' f.txt`,
  "curl -o f.tar https://example.com",
  "sudo rm /etc/hosts",
];

const MUST_ALLOW = [
  "rg -n --no-heading 'EnvelopeSchema' -g '!node_modules'",
  "find . -name '*.ts' -not -path '*/node_modules/*' | head -40",
  "git log --oneline -5",
  "git diff HEAD -- src/main.py",
  "git status --porcelain",
  "git config user.name",
  "cat src/schema.py 2>/dev/null",
  "rg -l submit -g '*.ts' | sort | uniq",
  "ls -la subagent-only",
  "grep -r x . --include=*.py",
  `awk '{print $1}' f.txt`,
  "wc -l src/*.py",
];

for (const command of MUST_REFUSE) {
  test(`refuses: ${command}`, () => {
    assert.notEqual(refuseMutation(command), null, "should have been refused");
  });
}

for (const command of MUST_ALLOW) {
  test(`allows: ${command}`, () => {
    assert.equal(refuseMutation(command), null, "should have been allowed");
  });
}

// ---------------------------------------------------------------------------
// role-rules — the frozen bundle, and where it is detected from
// ---------------------------------------------------------------------------

function makeBundle(): string {
  const root = mkdtempSync(join(tmpdir(), "bundle-"));
  for (const f of BUNDLE_FILES) writeFileSync(join(root, f), "# fixture\n");
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  return root;
}

test("bundle regime is detected at the root", () => {
  const root = makeBundle();
  try {
    assert.equal(bundleRoot(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundle regime is detected from a subdirectory", () => {
  // A session opened with `cd dags && pi` used to find nothing and disable the
  // protection in silence — the worst shape for that failure, since nothing
  // distinguished "no bundle" from "not looked for far enough up".
  const root = makeBundle();
  try {
    assert.equal(bundleRoot(join(root, "src", "deep")), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a nested repository does not inherit a parent's bundle", () => {
  const root = makeBundle();
  try {
    const nested = join(root, "vendor", "lib");
    mkdirSync(join(nested, ".git"), { recursive: true });
    assert.equal(bundleRoot(nested), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("three of four files is the free regime", () => {
  const root = mkdtempSync(join(tmpdir(), "partial-"));
  try {
    for (const f of BUNDLE_FILES.slice(0, 3)) writeFileSync(join(root, f), "x");
    assert.equal(bundleRoot(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only the four files at the root are frozen", () => {
  const root = "/repo";
  assert.equal(isBundleFile("/repo/DESIGN.md", root), true);
  assert.equal(isBundleFile("DESIGN.md", root), true);
  // A project's own docs/DESIGN.md is an ordinary file.
  assert.equal(isBundleFile("/repo/docs/DESIGN.md", root), false);
  assert.equal(isBundleFile("/repo/src/loader.py", root), false);
});

// ---------------------------------------------------------------------------
// bash-guard — the commit token covers direct commands and aliases
// ---------------------------------------------------------------------------

const token = (c: string) => TOKEN_PATTERNS.some((p) => p.pattern.test(c));

const MUST_NEED_TOKEN = [
  "git commit -m x",
  "git -C /tmp commit -m x",
  "git -c user.name=x commit -m y",
  "git --no-pager commit",
  // Aliases. Demonstrated: neither of these matched, while the token was
  // covered here: direct commands and aliases. A `git commit` inside a script
  // run as `bash script.sh` is not seen by bash-guard and is not claimed to be.
  "git -c alias.ci=commit ci -m x",
  "git ci -m x",
  "gh pr create",
  "gh pr merge",
];

const MUST_NOT_NEED_TOKEN = [
  "git log --grep=commit",
  "git status -s",
  "git add file.py",
  "git diff HEAD",
  "git rev-parse --show-toplevel",
  "git ls-files",
  "git show HEAD",
];

for (const command of MUST_NEED_TOKEN) {
  test(`needs a commit token: ${command}`, () => {
    assert.equal(token(command), true);
  });
}

for (const command of MUST_NOT_NEED_TOKEN) {
  test(`runs without a token: ${command}`, () => {
    assert.equal(token(command), false);
  });
}

test("the token file itself cannot be created by an agent", () => {
  for (const command of [
    "touch ~/.pi/.allow-commit",
    "echo > ~/.pi/.allow-commit",
    ": > /Users/x/.pi/.allow-commit",
    "cp /tmp/t ~/.pi/.allow-commit",
    "install -D /dev/null ~/.pi/.allow-commit",
  ]) {
    assert.equal(TOKEN_FILE_PATTERN.test(command), true, command);
  }
  assert.equal(TOKEN_FILE_PATTERN.test("git commit -m x"), false);
});

test("blanket staging asks for confirmation", () => {
  const medium = (c: string) => MEDIUM_PATTERNS.some((p) => p.pattern.test(c));
  for (const c of ["git add -A", "git add --all", "git add .", "git add . "]) {
    assert.equal(medium(c), true, c);
  }
  for (const c of ["git add src/main.py", "git add .gitignore"]) {
    assert.equal(medium(c), false, c);
  }
});

test("a whitelist entry cannot open the commit gate", () => {
  // TOKEN is matched before the whitelist, by design and not by accident.
  const match = findMatch("git commit -m x", [], [], [/.*/]);
  assert.equal(match?.level, "token");
});

// ---------------------------------------------------------------------------
// pi-secret-gate — hard limit 1
// ---------------------------------------------------------------------------

const SECRETS = [
  `API_KEY = "AIzaSyB1234567890abcdefghijklmnopqrstuv"`,
  `password = "hunter2is8chars"`,
  `token: "ghp_abcdefghijklmnopqrstuvwxyz012345"`,
  `aws = "AKIAIOSFODNN7EXAMPLE"`,
  `slack = "xoxb-1234567890-abcdefghij"`,
  `openai = "sk-abcdefghijklmnopqrstuvwxyz"`,
  "-----BEGIN RSA PRIVATE KEY-----",
];

const NOT_SECRETS = [
  `API_KEY = os.environ["API_KEY"]`,
  `password = ""`,
  `api_key = "your-key-here"`,
  `token = "\${TOKEN}"`,
  "PASSWORD_MIN_LENGTH = 12",
  "api_key: str | None = None",
  `secret = "xxxxxxxxxxxx"`,
  `password = "<redacted>"`,
];

for (const line of SECRETS) {
  test(`refuses a write carrying: ${line.slice(0, 32)}…`, () => {
    assert.ok(scan(line).length > 0);
  });
}

for (const line of NOT_SECRETS) {
  test(`allows: ${line.slice(0, 32)}`, () => {
    assert.equal(scan(line).length, 0);
  });
}

test("a reported hit does not echo the secret in full", () => {
  const secret = "AIzaSyB1234567890abcdefghijklmnopqrstuv";
  const [hit] = scan(`API_KEY = "${secret}"`);
  assert.ok(hit);
  assert.equal(hit.excerpt.includes(secret), false, "the excerpt reproduced the secret");
});

test("example files are exempt", () => {
  assert.equal(EXEMPT_PATH.test(".env.example"), true);
  assert.equal(EXEMPT_PATH.test("config/.env.sample"), true);
  assert.equal(EXEMPT_PATH.test("src/client.py"), false);
});

// --------------------------------------------- git belongs to the runtime

/*
 * `refuseGitMutation` applies to every child, including the ones that may
 * write files. "No agent commits" is too narrow a statement of it: a worker
 * that runs `git reset --hard` or `git worktree remove` in its lane destroys
 * work without creating a commit, and leaves `previousHead` exactly as
 * ambiguous.
 */

const refusedForEveryone = [
  "git commit -m 'wip'",
  "git -C /srv/repo commit -m x",
  "git -c user.name=x commit -m y",
  "git -c alias.ci=commit ci -m y",
  "git commit-tree abc -m x",
  "git merge feature",
  "git rebase -i HEAD~3",
  "git cherry-pick abc",
  "git revert abc",
  "git reset --hard HEAD~1",
  "git checkout -b other",
  "git switch -c other",
  "git branch tmp",
  "git tag v1",
  "git stash",
  "git update-ref refs/heads/main abc",
  "git push origin main",
  "git worktree remove ../lane",
  "git add -A",
  "git config user.email a@b",
  "npm test && git commit -am done",
  "echo $(git commit -m sneaky)",
  "echo `git reset --hard`",
];

for (const command of refusedForEveryone) {
  test(`refused for every role: ${command}`, () => {
    assert.notEqual(refuseGitMutation(command), null, "should have been refused");
  });
}

const allowedForWriters = [
  "git status --porcelain",
  "git diff --stat",
  "git log --oneline -5",
  "git rev-parse HEAD",
  "git show HEAD:src/a.py",
  "git -C /srv/repo log --oneline",
  "git config user.email",
  "pytest -q",
  "rm -rf build && npm run build",
  "echo $(git rev-parse HEAD)",
];

for (const command of allowedForWriters) {
  test(`allowed for a role that may write: ${command}`, () => {
    assert.equal(refuseGitMutation(command), null, "should have been allowed");
  });
}

test("the token on disk opens nothing", () => {
  /*
   * `bash-guard` lets a commit through when `~/.pi/.allow-commit` exists. That
   * token authorises the operator's own commit; a child that finds it lying
   * around must not inherit the capability.
   *
   * The guarantee is structural — `refuseGitMutation` reads a string and
   * consults nothing — so this test cannot fail today. It exists so that the
   * day someone adds a consultation, it does.
   */
  const home = mkdtempSync(join(tmpdir(), "pi-token-"));
  const previous = process.env.HOME;
  try {
    writeFileSync(join(home, ".allow-commit"), "");
    process.env.HOME = home;
    assert.notEqual(refuseGitMutation("git commit -m x"), null);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});

test("a git option that takes a value is not read as the subcommand", () => {
  // `git -C /srv/repo log` was refused as a `git /srv/repo`: fail-closed, and
  // therefore invisible — a legal command cost a turn and the message named
  // the wrong thing.
  assert.equal(gitSubcommand(["-C", "/srv/repo", "log"]), "log");
  assert.equal(gitSubcommand(["-c", "user.name=x", "commit"]), "commit");
  assert.equal(gitSubcommand(["--git-dir=/x/.git", "status"]), "status");
  assert.equal(gitSubcommand(["--no-pager", "diff"]), "diff");
  assert.equal(gitSubcommand([]), undefined);
});

// ------------------------------------------------ role-guard's whole decision

/*
 * The wiring, which nothing checked.
 *
 * `refuseGitMutation` had a hundred cases against it and none of them proved
 * role-guard ever called it. The harness found five defects in `execute` that
 * were all instruction order; this file had the same blind spot, one layer
 * down.
 */

const bundle = () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bundle-"));
  for (const f of BUNDLE_FILES) writeFileSync(join(root, f), "");
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
};

const worker = (root: string | null = null) => ({ root, readOnly: false, role: "worker" });
const scout = (root: string | null = null) => ({ root, readOnly: true, role: "scout" });

test("a role that may write still cannot write to git", () => {
  // The point of the whole rule: `readOnly` is false here.
  const reason = decideRoleGuard("bash", { command: "git commit -m x" }, worker());
  assert.match(reason ?? "", /Git belongs to the runtime/);
});

test("a role that may write keeps its shell", () => {
  assert.equal(decideRoleGuard("bash", { command: "rm -rf build" }, worker()), null);
  assert.equal(decideRoleGuard("bash", { command: "pytest -q" }, worker()), null);
  assert.equal(decideRoleGuard("bash", { command: "git diff --stat" }, worker()), null);
});

test("a read-only role is refused as a read-only role", () => {
  // Order: the read-only rule comes first, so its message — the one that
  // explains the role has no `edit` by design — is the one the scout sees.
  const reason = decideRoleGuard("bash", { command: "git commit -m x" }, scout());
  assert.match(reason ?? "", /is read-only/);
  assert.match(decideRoleGuard("bash", { command: "rm -rf build" }, scout()) ?? "", /is read-only/);
});

test("the frozen bundle is refused for reading and for writing", () => {
  const { root, done } = bundle();
  try {
    const path = join(root, "DESIGN.md");
    assert.match(decideRoleGuard("write", { path }, worker(root)) ?? "", /frozen bundle file/);
    assert.match(decideRoleGuard("read", { path }, worker(root)) ?? "", /quoted into your task/);
    assert.equal(decideRoleGuard("read", { path: join(root, "src.py") }, worker(root)), null);
    // Free regime: no bundle, no rule.
    assert.equal(decideRoleGuard("write", { path }, worker(null)), null);
  } finally {
    done();
  }
});

test("a tool that is neither a path nor a command is left alone", () => {
  assert.equal(decideRoleGuard("other", {}, worker()), null);
  assert.equal(decideRoleGuard("other", { command: "git commit -m x" }, worker()), null);
});

test("the config rule counts what follows the subcommand, not the whole line", () => {
  // `git -C <path> config <key>` counted three words and was refused as a
  // write. Fail-closed and invisible: exactly what `parseGit` exists to remove.
  assert.equal(refuseGitMutation("git config user.email"), null);
  assert.equal(refuseGitMutation("git -C /srv/repo config user.email"), null);
  assert.equal(refuseGitMutation("git --no-pager config user.email"), null);
  assert.notEqual(refuseGitMutation("git -C /srv/repo config user.email a@b"), null);
  assert.notEqual(refuseGitMutation("git config --global --unset user.email"), null);
  assert.notEqual(refuseGitMutation("git -C /srv/repo config --unset user.email"), null);
});

test("the parser returns what follows the subcommand", () => {
  assert.deepEqual(parseGit(["-C", "/srv/repo", "config", "user.email"]),
    { sub: "config", args: ["user.email"] });
  assert.deepEqual(parseGit(["log", "--oneline", "-5"]),
    { sub: "log", args: ["--oneline", "-5"] });
  assert.deepEqual(parseGit(["-c", "user.name=x"]), { args: [] });
});
