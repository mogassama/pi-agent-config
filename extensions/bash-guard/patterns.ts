/**
 * patterns.ts — Compiled regex patterns for bash-guard.
 * All patterns are compiled once at module load time (not per tool call).
 * Flags: case-insensitive (i) + dotAll (s) for multi-line shell commands.
 */

export type PatternLevel = "high" | "medium" | "token";

export interface PatternEntry {
  /** Human-readable label, also used as key for the always-allow session set. */
  source: string;
  level: PatternLevel;
  pattern: RegExp;
}

// ---------------------------------------------------------------------------
// Source strings — edit here to add/remove built-in patterns
// ---------------------------------------------------------------------------

// TOKEN level — single-use authorisation, no always-allow, no whitelist bypass.
// Matched before HIGH/MEDIUM and before the whitelist: committing is the one
// hard guarantee, so nothing in settings.json can open it accidentally.
const TOKEN_SOURCES: string[] = [
  // Covers `git commit`, `git -C <path> commit`, `git -c k=v commit`,
  // `git --no-pager commit`. Does not match `git log --grep=commit`.
  String.raw`\bgit\s+(?:(?:-c|-C|--[\w-]+)(?:[= ]\S+)?\s+)*commit\b`,
  String.raw`\bgh\s+pr\s+(?:merge|create)\b`,
  // An alias is a commit the pattern above cannot see. Demonstrated: neither
  // `git -c alias.ci=commit ci -m x` nor `git ci -m x` — with `ci` configured
  // in any gitconfig — matched, and the token was presented as a guarantee
  // without a bypass. Two rules, because the two cases are different: defining
  // an alias on the command line is always suspicious, and invoking an unknown
  // subcommand may or may not be one. Both go through the operator.
  String.raw`\bgit\s+(?:-c|--config-env)[= ]\s*alias\.`,
  // A git invocation whose first non-flag word is not a known subcommand. The
  // list is porcelain that cannot commit; anything outside it — an alias, a
  // custom `git-foo` on PATH — is unknown, and unknown is not safe when the
  // thing being guaranteed is that no commit happens without a token.
  String.raw`\bgit\s+(?:(?:-c|-C|--[\w-]+)(?:[= ]\S+)?\s+)*(?!(?:add|am|apply|archive|bisect|blame|branch|cat-file|check-ignore|checkout|cherry-pick|clean|clone|config|describe|diff|fetch|for-each-ref|fsck|gc|grep|help|init|log|ls-files|ls-remote|ls-tree|merge|merge-base|mv|notes|pull|push|range-diff|rebase|reflog|remote|reset|restore|rev-list|rev-parse|revert|rm|shortlog|show|show-ref|stash|status|submodule|switch|symbolic-ref|tag|version|whatchanged|worktree)\b)[a-z][\w-]*`,
];

/**
 * The token file itself — refused outright, never authorised.
 *
 * `git-collaboration` forbade creating it in prose: "an agent that issues its
 * own removes the only hard guarantee in this config". Every role holding
 * `bash` could `touch` it, so the only hard guarantee in this config was
 * guarded by a sentence.
 *
 * Deliberately not a TOKEN pattern. TOKEN means "one authorisation, consumed
 * here", and a token cannot authorise the creation of a token — the guard
 * would spend the operator's authorisation to let the agent mint a fresh one.
 * This level has no dialog, no always-allow and no token path: it blocks, and
 * says why. Matched on the path rather than on `touch`, since `: >`, `echo >`,
 * `install -D`, `cp` and `python -c` all create a file just as well.
 */
export const TOKEN_FILE_PATTERN = new RegExp(String.raw`\.allow-commit\b`, "is");

/**
 * The push authorisation — refused outright, like the commit token above.
 *
 * `git-hooks/pre-push` accepts a push only on `~/.pi/.allow-push`, written by the
 * operator for exactly one update and consumed as
 * `~/.pi/.allow-push.consomme.<UTC>.<pid>.<random>/allow-push`. An agent that could
 * create, copy, read or restore it would hold the very authorisation the hook exists
 * to keep from it. The word `allow-push` is matched wherever it stands, so both the
 * available name and a consumed one are covered. A glob that never spells the word
 * (`.allow-p*`) is not: declared limit.
 */
export const PUSH_AUTH_FILE_PATTERN = new RegExp(String.raw`\ballow-push\b`, "s");

/**
 * Bypassing this repository's hooks — refused outright, never authorised.
 *
 * The commit is gated by TOKEN, and the hooks (`commit-msg`, `pre-commit`,
 * `reference-transaction`, `pre-push`) are the machine's half of the protocol:
 * `--no-verify` switches them off. Two forms, matched within one segment of a
 * compound command (`;`, `&`, `|` and a newline end it), case-sensitively as git
 * reads its options:
 *
 *   1. `--no-verify` on any git subcommand, and its abbreviations `--no-veri` and
 *      `--no-verif` (`--no-ver` is refused by git as ambiguous for commit, push,
 *      merge and rebase; `git am` would take it, and has no hook here), global
 *      options before the subcommand included, quoted or not;
 *   2. `-n` on `git commit`: alone, or in a cluster of commit's boolean short
 *      options (`a p s e i o v q z`) that contains it, optionally ended by one
 *      letter that takes an argument (`-nm "msg"`, `-anm "msg"`). A cluster where
 *      that letter comes first (`-mn`: the message "n") is not a `-n`, nor is
 *      `git push -n`, a dry run.
 *
 * This is pattern matching, not a shell parser: a redirection such as `2>&1`
 * before the option ends the segment, a line continuation is read as a newline, a
 * quoted value with a space in a global option is not followed, and a `-n` inside
 * a double-quoted message can be refused wrongly, as can `git grep --no-verify`.
 * Declared limits. The global-option group has no overlapping alternatives, so a
 * long run of `-c` options cannot make the match backtrack exponentially.
 */
export const HOOK_BYPASS_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\bgit\s[^;&|\n]*?(?<=[\s"'])--no-veri(?:f|fy)?(?=[\s;&|)="'\x60]|$)`, "s"),
  new RegExp(String.raw`\bgit\s+(?:(?:-[cC]|-[pP]|--[\w-]+)(?:[= ]\S+)?\s+)*commit(?![\w-])[^;&|\n]*?(?<=\s)-[apseiovqz]*n[apseiovqz]*(?:[mcCFtuS]\S*)?(?=[\s;&|)"'\x60]|$)`, "s"),
];

const HIGH_SOURCES: string[] = [
  String.raw`\bterraform\s+destroy\b`,
  // One or more subcommand words (e.g. "functions", "composer environments", "run services")
  String.raw`\bgcloud\s+(?:[\w-]+\s+)+delete\b`,
  String.raw`\bDROP\s+(DATABASE|SCHEMA)\b`,
  String.raw`\bdropdb\b`,
  // Force-push targeting main/master/prod — more specific than the medium variant
  String.raw`\bgit\s+push\s+(-f|--force).*\b(main|master|prod|production)\b`,
];

const MEDIUM_SOURCES: string[] = [
  String.raw`\brm\s+(-[rRf]+|--recursive|--force)`,
  String.raw`\brm\s+.*\*`,
  String.raw`\bbq\s+rm\b`,
  String.raw`\bbq\s+(update|cp\s+-f)\b`,
  String.raw`\bgsutil\s+(-m\s+)?rm\b`,
  String.raw`\bDROP\s+TABLE\b`,
  String.raw`\bTRUNCATE\b`,
  // Generic force-push (no branch target) — less specific than the HIGH variant above
  String.raw`\bgit\s+push\s+(-f|--force)\b`,
  String.raw`\bgit\s+reset\s+--hard\b`,
  // AGENTS.md forbids blanket staging outright; git-collaboration Phase 0
  // prescribed `git add -A` for an initial commit. Two prompts, one
  // contradiction, and no pattern — which is how `auth.json` at a repo root
  // gets staged. MEDIUM rather than HIGH: staging is reversible with
  // `git reset`, and the commit itself is already gated at TOKEN level. The
  // confirmation is the point — it puts the file list in front of the operator
  // at the one moment it can still be changed for free.
  String.raw`\bgit\s+add\s+(?:-A\b|--all\b|\.(?:\s|$))`,
  String.raw`\bterraform\s+apply\s+-auto-approve\b`,
];

// ---------------------------------------------------------------------------
// Compilation helpers
// ---------------------------------------------------------------------------

export function compilePatterns(sources: string[], level: PatternLevel): PatternEntry[] {
  return sources.map((source) => ({
    source,
    level,
    // `i` = case-insensitive, `s` = dotAll (. matches \n for multi-line commands)
    pattern: new RegExp(source, "is"),
  }));
}

// Compiled at module load — never recompiled per call
export const TOKEN_PATTERNS: PatternEntry[] = compilePatterns(TOKEN_SOURCES, "token");
export const HIGH_PATTERNS: PatternEntry[] = compilePatterns(HIGH_SOURCES, "high");
export const MEDIUM_PATTERNS: PatternEntry[] = compilePatterns(MEDIUM_SOURCES, "medium");

// ---------------------------------------------------------------------------
// Match function
// ---------------------------------------------------------------------------

/**
 * Returns the first matching PatternEntry for `command`, or undefined if none.
 *
 * Evaluation order:
 *   1. TOKEN patterns — checked FIRST, before the whitelist. A whitelist entry
 *      must never be able to open a commit path.
 *   2. Whitelist — if any whitelist pattern matches, return undefined (no block).
 *   3. HIGH patterns (built-in + extra) — checked before MEDIUM so that a
 *      more-specific HIGH pattern (e.g. git push -f main) wins over the
 *      less-specific MEDIUM variant (git push -f).
 *   4. MEDIUM patterns (built-in + extra).
 */
export function findMatch(
  command: string,
  extraHigh: PatternEntry[],
  extraMedium: PatternEntry[],
  whitelist: RegExp[],
): PatternEntry | undefined {
  for (const entry of TOKEN_PATTERNS) {
    if (entry.pattern.test(command)) return entry;
  }

  if (whitelist.some((w) => w.test(command))) return undefined;

  for (const entry of [...HIGH_PATTERNS, ...extraHigh]) {
    if (entry.pattern.test(command)) return entry;
  }

  for (const entry of [...MEDIUM_PATTERNS, ...extraMedium]) {
    if (entry.pattern.test(command)) return entry;
  }

  return undefined;
}
