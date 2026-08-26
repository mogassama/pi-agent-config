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
      const sub = rest.find((w) => !w.startsWith("-"));
      if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) {
        return sub ? `\`git ${sub}\` is not a read-only git subcommand` : "`git` with no subcommand";
      }
      // `git config` reads with one argument and writes with two — or with any
      // of the flags that mutate, which take none.
      if (sub === "config") {
        const mutating = rest.some((w) => /^--(unset|unset-all|add|replace-all|rename-section|remove-section|edit)$/.test(w));
        if (mutating || rest.filter((w) => !w.startsWith("-")).length > 2) {
          return "`git config` in a form that writes configuration";
        }
      }
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
