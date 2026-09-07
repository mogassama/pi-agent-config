/**
 * role-rules — the predicates role-guard enforces, with no pi import.
 *
 * Split out so they can be tested. `role-guard.ts` loads the pi extension API
 * and can only run inside a child process; everything decidable about a path or
 * a shell command is decidable here, from a string, in a unit test.
 *
 * The split is the point: these are the rules whose breakage was demonstrated
 * by an external audit — six shell constructs that walked past a first-word
 * allowlist — and a rule that cannot be tested is a rule that gets re-broken.
 */

import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** The Forge bundle, exactly as AGENTS.md defines it. */
export const BUNDLE_FILES = ["INSTRUCTIONS.md", "ARCHITECTURE.md", "DESIGN.md", "CONVENTIONS.md"];

/**
 * Bundle regime, detected the way AGENTS.md says to detect it: all four files
 * at the repository root, never a path convention or a project name.
 *
 * The check matters. A repository carrying its own `ARCHITECTURE.md` is
 * ordinary, and blocking reads of it would break a free-regime session for a
 * rule that only exists because the bundle is frozen and pre-quoted. Three of
 * four is the free regime, and this guard is silent there.
 */
export function bundleRoot(cwd: string): string | null {
  // Walk up. A session opened in a subdirectory — `cd dags && pi` — found no
  // bundle at `cwd`, concluded free regime and disabled the protection in
  // silence. Silence is the worst shape for that failure: nothing distinguishes
  // "no bundle here" from "bundle not looked for far enough up".
  //
  // Bounded by the filesystem root and by a repository boundary: a `.git`
  // directory ends the walk, so a bundle in a parent repository does not govern
  // a nested checkout that has none of its own.
  let dir = resolve(cwd);
  for (;;) {
    if (BUNDLE_FILES.every((f) => existsSync(join(dir, f)))) return dir;
    if (existsSync(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** True when `p` is one of the four, at the root — not a same-named file in a subdirectory. */
export function isBundleFile(p: string, root: string): boolean {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const rel = relative(root, abs);
  return !rel.includes("/") && !rel.startsWith("..") && BUNDLE_FILES.includes(basename(abs));
}

/**
 * Commands a role without `edit` and `write` may still run.
 *
 * Allowlist, not a denylist: the denylist version of this is what bash-guard
 * already is, and the measured hole was everything nobody thought to list.
 * `mv`, `cp`, `install`, `tee`, `truncate`, `chmod`, `pip`, `npm`, `python`
 * are absent because they are absent, not because they were each considered.
 */
export const READ_ONLY_COMMANDS = new Set([
  "rg", "grep", "egrep", "fgrep", "find", "fd", "ls", "cat", "bat", "head", "tail",
  "wc", "awk", "cut", "tr", "sort", "uniq", "nl", "column", "jq", "yq", "diff",
  "basename", "dirname", "realpath", "readlink", "file", "stat", "du", "df",
  "echo", "printf", "pwd", "which", "type", "true", "false", "date",
  "uname", "test", "[",
]);

/** `git` subcommands that only read. Anything else needs the index or the worktree. */
export const GIT_READ_SUBCOMMANDS = new Set([
  "log", "diff", "show", "status", "ls-files", "ls-tree", "rev-parse", "blame",
  "cat-file", "describe", "shortlog", "grep", "config",
]);

/**
 * Split a shell line into the segments that each start a command.
 *
 * Deliberately crude: pipes, sequencing and boolean operators, and that is all.
 * A crude split errs toward blocking a legal command, which costs the child one
 * turn and a clear message. The opposite error costs a mutated tree that
 * `changedSinceLastReview` will attribute to whoever wrote next.
 */
export function segments(command: string): string[] {
  return command
    .split(/\|\||&&|\||;|\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `VAR=x cmd …` — strip the assignments and return the first real word. */
export function headWord(segment: string): { cmd: string; rest: string[] } {
  const words = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  return { cmd: (words[i] ?? "").replace(/^.*\//, ""), rest: words.slice(i + 1) };
}

/**
 * Constructs that run a command this check cannot see.
 *
 * Checked before anything else and on the raw string, because each of them
 * hides an arbitrary command from a first-word allowlist. Every one below was
 * demonstrated against the earlier version of this file: `echo $(touch x)`
 * passed as an `echo`, `find . -exec touch x \\;` as a `find`, `awk 'BEGIN {
 * system("touch x") }'` as an `awk`.
 *
 * This narrowing is defence in depth, not the guarantee. The guarantee is that
 * a role which must not write does not hold `bash` at all — which is why the
 * scout no longer does. What remains here protects a role that legitimately
 * needs a shell and must still not reach past it.
 */
export const INDIRECTION: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\$\(/, why: "`$(…)` runs a command substitution" },
  { pattern: /`/, why: "backticks run a command substitution" },
  { pattern: /\$\{[^}]*\|/, why: "`${…|…}` can expand to a command" },
  { pattern: /(^|\s)-exec(dir)?(\s|$)/, why: "`-exec` runs an arbitrary command" },
  { pattern: /(^|\s)-delete(\s|$)/, why: "`-delete` removes files" },
  { pattern: /\bsystem\s*\(/, why: "`system(` runs a command from inside awk or perl" },
  { pattern: /\bprint\s*>/, why: "awk can redirect to a file" },
];

/**
 * Commands whose whole purpose is to run another one, or that write by design.
 *
 * Separate from the allowlist because absence is what protects there, and a
 * name absent by oversight is a hole. These are named so that adding a plausible
 * read-only command later cannot silently readmit them.
 */
export const NEVER = new Set([
  "xargs", "eval", "exec", "sh", "bash", "zsh", "env", "nohup", "time", "timeout",
  "watch", "nice", "sudo", "doas", "ssh", "python", "python3", "node", "ruby",
  "make", "pip", "pip3", "npm", "npx", "uv", "curl", "wget",
  "rm", "mv", "cp", "install", "tee", "truncate", "chmod", "chown", "ln", "mkdir", "touch",
]);

/**
 * `git` options that take a separate value, so the value is not mistaken for
 * the subcommand.
 *
 * `git -C /srv/repo log` was read as a `git /srv/repo`: not a read subcommand,
 * so refused. Fail-closed, and therefore invisible — the child lost a turn to a
 * legal command and the message named the wrong thing.
 */
export const GIT_VALUE_OPTIONS = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env",
]);

/**
 * `git … <sub> <args…>` split into the subcommand and what follows it.
 *
 * The arguments matter as much as the name. A first version returned only the
 * subcommand, and the `git config` rule went on counting words across the whole
 * invocation — so `git -C /srv/repo config user.email` counted three and was
 * refused as a write, when it reads. The same fail-closed-and-invisible defect
 * this parser exists to remove, one argument further along.
 *
 * Unknown options that take a separate value make their value look like the
 * subcommand, which lands on an unknown name and is refused. That direction is
 * the safe one and it stays: a refusal costs a turn, the opposite costs a
 * mutated tree.
 */
export function parseGit(rest: readonly string[]): { sub?: string; args: string[] } {
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word.startsWith("-")) return { sub: word, args: [...rest.slice(i + 1)] };
    if (GIT_VALUE_OPTIONS.has(word)) i += 1;
  }
  return { args: [] };
}

/** The subcommand alone, for callers that do not need its arguments. */
export function gitSubcommand(rest: readonly string[]): string | undefined {
  return parseGit(rest).sub;
}

/**
 * Null when this `git` invocation only reads; a reason when it can write.
 *
 * Allowlist, like everything else here. A denylist of the subcommands that
 * create commits or move refs would have to name `commit`, `commit-tree`,
 * `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `stash`, `tag`,
 * `update-ref`, `branch`, `checkout`, `switch`, `reset`, `push`, `worktree`,
 * `notes`, `replace`, `filter-branch` — and be wrong about the next one.
 */
export function refuseGitWrite(rest: readonly string[]): string | null {
  const { sub, args } = parseGit(rest);
  if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) {
    return sub ? `\`git ${sub}\` is not a read-only git subcommand` : "`git` with no subcommand";
  }
  // `git config` reads with one argument and writes with two — or with any of
  // the flags that mutate, which take none. Counted over what follows `config`,
  // never over the whole invocation: `git -C <path> config <key>` is a read.
  if (sub === "config") {
    const mutating = args.some((w) =>
      /^--(unset|unset-all|add|replace-all|rename-section|remove-section|edit)$/.test(w));
    if (mutating || args.filter((w) => !w.startsWith("-")).length > 1) {
      return "`git config` in a form that writes configuration";
    }
  }
  return null;
}

/** Null when the command may run; a reason when it may not. */
export function refuseMutation(command: string): string | null {
  for (const { pattern, why } of INDIRECTION) {
    if (pattern.test(command)) return why;
  }

  // Redirection writes a file whatever the command in front of it is. /dev/null
  // is the one destination that changes nothing, and it is the one every
  // legitimate search uses to silence errors.
  const redirect = command.match(/>>?\s*(\S+)/);
  if (redirect && !/^\/dev\/(null|stderr|stdout)$/.test(redirect[1])) {
    return `redirection to ${redirect[1]} writes a file`;
  }

  for (const segment of segments(command)) {
    const { cmd, rest } = headWord(segment);
    if (!cmd) continue;

    if (NEVER.has(cmd)) return `\`${cmd}\` is never read-only`;

    if (cmd === "git") {
      const reason = refuseGitWrite(rest);
      if (reason) return reason;
      continue;
    }

    // sed and perl read by default and write with one flag.
    if (cmd === "sed" || cmd === "perl") {
      if (rest.some((w) => /^-[a-z]*i/.test(w))) return `\`${cmd} -i\` edits in place`;
      continue;
    }

    if (!READ_ONLY_COMMANDS.has(cmd)) {
      return `\`${cmd}\` is not on the read-only allowlist`;
    }
  }
  return null;
}

/**
 * Command substitutions, unwrapped, so a `git` hidden inside one is still seen.
 *
 * `segments` splits on pipes and sequencing, which leaves `echo $(git commit)`
 * looking like an `echo`. That is fine for `refuseMutation`, whose caller has
 * already refused every substitution outright — a read-only role has no reason
 * to run one. It is not fine for a role that legitimately runs `$(…)` all day.
 *
 * One level, no nesting, no quoting analysis. This closes the obvious hole, not
 * every hole: see `refuseGitMutation` on what this rule is and is not.
 */
export function unwrapSubstitutions(command: string): string[] {
  const inner: string[] = [];
  for (const m of command.matchAll(/\$\(([^()]*)\)/g)) inner.push(m[1]);
  for (const m of command.matchAll(/`([^`]*)`/g)) inner.push(m[1]);
  return inner.flatMap((s) => segments(s));
}

/**
 * Null when this command leaves git alone; a reason when it would write to it.
 *
 * **Applies to every child, including the ones that may write files.** The
 * invariant is not "no agent commits" — that one is too narrow. A worker that
 * runs `git reset --hard`, `git checkout` or `git worktree remove` in its lane
 * destroys work without ever creating a commit, and leaves `previousHead`
 * exactly as ambiguous: `mergeLane` undoes its own freeze with
 * `reset --mixed <previousHead>`, which only unmakes the freeze if nothing else
 * moved the branch. Commits are the runtime's, and so is every other write.
 *
 * **What this rule is.** A guard against the ordinary failure: a model that was
 * told not to commit and commits anyway — measured at one refusal in three when
 * the rule lived in prose. It reads a string, consults nothing, and cannot be
 * opened by `~/.pi/.allow-commit` or by anything else on disk, because it never
 * looks.
 *
 * **What it is not.** A guarantee against a child that is trying to get around
 * it. This inspects a shell command, and a shell has more ways to produce one
 * than this can enumerate — a variable holding the word, a here-doc, a script
 * written and then run. `unwrapSubstitutions` closes the first level and no
 * more. Calling that "mechanical" would be the overstatement this project keeps
 * learning not to make: mechanical here means "does not depend on prose", not
 * "impossible to bypass". The second layer is the `pre-commit` and
 * `reference-transaction` hooks in `git-hooks/`, which run inside git rather
 * than in front of it — and which cover commits and ref updates, not every
 * mutation: `git clean -fd` reaches neither of them. This function is the
 * general guard; the hooks are depth on two operations. They are also optional,
 * installed by the operator, so nothing downstream may assume they are there.
 */
export function refuseGitMutation(command: string): string | null {
  for (const segment of [...segments(command), ...unwrapSubstitutions(command)]) {
    const { cmd, rest } = headWord(segment);
    if (cmd !== "git") continue;
    const reason = refuseGitWrite(rest);
    if (reason) return reason;
  }
  return null;
}

/** What role-guard knows about the child it is guarding. */
export interface RoleContext {
  /** The bundle root, or null in the free regime. */
  root: string | null;
  readOnly: boolean;
  role: string;
}

/**
 * The whole of role-guard's decision, with no pi import.
 *
 * Extracted for the reason every other unit here was: the rules were testable
 * and the wiring was not. `refuseGitMutation` had a hundred cases against it and
 * nothing checked that role-guard ever called it — the harness found five
 * defects in `execute` that were all instruction order, and this file had the
 * same shape of blind spot. What remains in `role-guard.ts` is the translation
 * from a pi event to a tool kind, which is the only part that needs pi.
 *
 * The order matters and is asserted: the bundle first, then the read-only rule
 * whose message is specific to a role that holds no `edit`, then git. A
 * read-only role hits the second and never reaches the third, so its refusals
 * keep saying what they always said.
 */
export function decideRoleGuard(
  kind: "read" | "write" | "edit" | "bash" | "other",
  input: { path?: string; command?: string },
  ctx: RoleContext,
): string | null {
  if (ctx.root && (kind === "read" || kind === "write" || kind === "edit")) {
    const path = input.path;
    if (path && isBundleFile(path, ctx.root)) {
      return kind !== "read"
        ? `blocked by role-guard: ${basename(path)} is a frozen bundle file. Only the ` +
            "operator changes it, and the one field pi may write — the `Statut` line of a " +
            "DESIGN.md decision — belongs to the orchestrator, not to a delegation. If the " +
            "task cannot be done without changing it, say so in `deviations` and implement " +
            "what can be."
        : `blocked by role-guard: ${basename(path)} is a frozen bundle file, and whatever ` +
            "you need from it has been quoted into your task verbatim. Reading it returns " +
            "what you were already given and costs turns you will need for the work. If " +
            "something decisive is genuinely missing from the task text, name it in your " +
            "envelope rather than going to look for it.";
    }
  }

  if (kind === "bash") {
    const command = input.command ?? "";

    if (ctx.readOnly) {
      const reason = refuseMutation(command);
      if (reason) {
        return (
          `blocked by role-guard: ${reason}. \`${ctx.role || "this role"}\` is read-only — it ` +
          "has no `edit` and no `write` by design, and `bash` is not a way around that. " +
          "Use it to search and to read. If the answer requires changing something, that " +
          "is a different role and the orchestrator's call, not yours."
        );
      }
    }

    /*
     * Git belongs to the runtime, for every role.
     *
     * Not conditioned on the lane regime, and not on `readOnly`. A rule that
     * only holds when some other feature is on is the shape this project keeps
     * having to undo: pi behaves the same whether or not a bundle is present,
     * and a guard behaves the same whether or not lanes are planned. No child
     * needs to write to git — `commitLane` and `mergeLane` run in the
     * orchestrator process, which is not a child and carries no
     * `PI_SUBAGENT_ROLE`.
     */
    const reason = refuseGitMutation(command);
    if (reason) {
      return (
        `blocked by role-guard: ${reason}. Git belongs to the runtime — commits, merges, ` +
        "resets, checkouts and worktrees are made for you once your work is approved, and " +
        "a child that makes its own destroys the one thing review depends on: a diff whose " +
        "provenance is known. Edit files and run tests. Leave the history alone; if the " +
        "task cannot be done without touching it, say so in `deviations` rather than doing it."
      );
    }
  }

  return null;
}
