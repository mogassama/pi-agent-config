/**
 * role-guard — the child-side half of two rules that were prompt-only.
 *
 * Loaded into every child by `buildSpawnPlan`, not listed in any frontmatter:
 * a guarantee one can forget to declare on a new role is not a guarantee. It
 * enforces exactly two things, both of them stated identically in three role
 * prompts and both of them measured as not holding.
 *
 *   1. The four bundle files are frozen and already quoted into the task.
 *      Prompt: "Do not open the project's instruction files." Measured on run
 *      `8c88c5` — a worker spent six turns reading before its first write, four
 *      of them on bundle files whose relevant content was already in its task.
 *      Writing them is worse: AGENTS.md reserves the whole bundle to the
 *      operator, with the `Statut` line of a DESIGN.md decision as the single
 *      exception, and that exception belongs to the orchestrator, not here.
 *
 *   2. A read-only role is read-only through `bash` too. The scout's tool list
 *      denies `edit` and `write`; `bash` hands them straight back. Its prompt
 *      says "`bash` is for reading. Never mutate" and lists `rm`, `mv`, `>`,
 *      git-that-writes and package installs — of which bash-guard patterns
 *      catch only `rm -rf`. The rest passed silently.
 *
 * Nothing here is a judgement call, which is why it can live in code. What is
 * a judgement call — whether a search is worth delegating, whether a fork is
 * durable — stays in the prompts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

/** The Forge bundle, exactly as AGENTS.md defines it. */
const BUNDLE_FILES = ["INSTRUCTIONS.md", "ARCHITECTURE.md", "DESIGN.md", "CONVENTIONS.md"];

/**
 * Bundle regime, detected the way AGENTS.md says to detect it: all four files
 * at the repository root, never a path convention or a project name.
 *
 * The check matters. A repository carrying its own `ARCHITECTURE.md` is
 * ordinary, and blocking reads of it would break a free-regime session for a
 * rule that only exists because the bundle is frozen and pre-quoted. Three of
 * four is the free regime, and this guard is silent there.
 */
function bundleRoot(cwd: string): string | null {
  return BUNDLE_FILES.every((f) => existsSync(resolve(cwd, f))) ? cwd : null;
}

/** True when `p` is one of the four, at the root — not a same-named file in a subdirectory. */
function isBundleFile(p: string, root: string): boolean {
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
const READ_ONLY_COMMANDS = new Set([
  "rg", "grep", "egrep", "fgrep", "find", "fd", "ls", "cat", "bat", "head", "tail",
  "wc", "awk", "cut", "tr", "sort", "uniq", "nl", "column", "jq", "yq", "diff",
  "basename", "dirname", "realpath", "readlink", "file", "stat", "du", "df",
  "echo", "printf", "pwd", "which", "type", "true", "false", "date", "env",
  "uname", "test", "[",
]);

/** `git` subcommands that only read. Anything else needs the index or the worktree. */
const GIT_READ_SUBCOMMANDS = new Set([
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
function segments(command: string): string[] {
  return command
    .split(/\|\||&&|\||;|\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `VAR=x cmd …` — strip the assignments and return the first real word. */
function headWord(segment: string): { cmd: string; rest: string[] } {
  const words = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  return { cmd: (words[i] ?? "").replace(/^.*\//, ""), rest: words.slice(i + 1) };
}

/** Null when the command may run; a reason when it may not. */
export function refuseMutation(command: string): string | null {
  // Redirection writes a file whatever the command in front of it is. /dev/null
  // is the one destination that changes nothing, and it is the one every
  // legitimate search uses to silence errors.
  const redirect = command.match(/>>?\s*(\S+)/);
  if (redirect && !/^\/dev\/(null|stderr|stdout)$/.test(redirect[1])) {
    return `redirection to ${redirect[1]} writes a file`;
  }
  if (/(^|[\s|])tee(\s|$)/.test(command)) return "`tee` writes a file";

  for (const segment of segments(command)) {
    const { cmd, rest } = headWord(segment);
    if (!cmd) continue;

    if (cmd === "git") {
      const sub = rest.find((w) => !w.startsWith("-"));
      if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) {
        return sub ? `\`git ${sub}\` is not a read-only git subcommand` : "`git` with no subcommand";
      }
      // `git config --global x y` writes. Reading takes one argument, setting takes two.
      if (sub === "config" && rest.filter((w) => !w.startsWith("-")).length > 2) {
        return "`git config` with a value writes configuration";
      }
      continue;
    }

    // sed and perl read by default and write with one flag.
    if ((cmd === "sed" || cmd === "perl") && rest.some((w) => /^-[a-z]*i/.test(w))) {
      return `\`${cmd} -i\` edits in place`;
    }

    // xargs and friends run a command this check has not seen.
    if (cmd === "xargs" || cmd === "eval" || cmd === "exec" || cmd === "sh" || cmd === "bash") {
      return `\`${cmd}\` runs a command that cannot be checked here`;
    }

    if (!READ_ONLY_COMMANDS.has(cmd) && !(cmd === "sed" || cmd === "perl")) {
      return `\`${cmd}\` is not on the read-only allowlist`;
    }
  }
  return null;
}

export default function (pi: ExtensionAPI): void {
  const role = process.env.PI_SUBAGENT_ROLE ?? "";
  const readOnly = process.env.PI_SUBAGENT_READONLY === "1";
  const root = bundleRoot(process.cwd());


  pi.on("tool_call", async (event) => {
    // --- The frozen bundle -------------------------------------------------
    if (root) {
      const path =
        isToolCallEventType("read", event) ||
        isToolCallEventType("write", event) ||
        isToolCallEventType("edit", event)
          ? (event.input as { path?: string })?.path
          : undefined;

      if (path && isBundleFile(path, root)) {
        const writing = !isToolCallEventType("read", event);
        const reason = writing
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
        return { block: true, reason };
      }
    }

    // --- Read-only means read-only through bash too ------------------------
    if (readOnly && isToolCallEventType("bash", event)) {
      const reason = refuseMutation(event.input.command);
      if (reason) {
        return {
          block: true,
          reason:
            `blocked by role-guard: ${reason}. \`${role || "this role"}\` is read-only — it ` +
            "has no `edit` and no `write` by design, and `bash` is not a way around that. " +
            "Use it to search and to read. If the answer requires changing something, that " +
            "is a different role and the orchestrator's call, not yours.",
        };
      }
    }

    return undefined;
  });
}
