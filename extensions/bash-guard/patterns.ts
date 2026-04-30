/**
 * patterns.ts — Compiled regex patterns for bash-guard.
 * All patterns are compiled once at module load time (not per tool call).
 * Flags: case-insensitive (i) + dotAll (s) for multi-line shell commands.
 */

export type PatternLevel = "high" | "medium";

export interface PatternEntry {
  /** Human-readable label, also used as key for the always-allow session set. */
  source: string;
  level: PatternLevel;
  pattern: RegExp;
}

// ---------------------------------------------------------------------------
// Source strings — edit here to add/remove built-in patterns
// ---------------------------------------------------------------------------

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
export const HIGH_PATTERNS: PatternEntry[] = compilePatterns(HIGH_SOURCES, "high");
export const MEDIUM_PATTERNS: PatternEntry[] = compilePatterns(MEDIUM_SOURCES, "medium");

// ---------------------------------------------------------------------------
// Match function
// ---------------------------------------------------------------------------

/**
 * Returns the first matching PatternEntry for `command`, or undefined if none.
 *
 * Evaluation order:
 *   1. Whitelist — if any whitelist pattern matches, return undefined (no block).
 *   2. HIGH patterns (built-in + extra) — checked before MEDIUM so that a
 *      more-specific HIGH pattern (e.g. git push -f main) wins over the
 *      less-specific MEDIUM variant (git push -f).
 *   3. MEDIUM patterns (built-in + extra).
 */
export function findMatch(
  command: string,
  extraHigh: PatternEntry[],
  extraMedium: PatternEntry[],
  whitelist: RegExp[],
): PatternEntry | undefined {
  if (whitelist.some((w) => w.test(command))) return undefined;

  for (const entry of [...HIGH_PATTERNS, ...extraHigh]) {
    if (entry.pattern.test(command)) return entry;
  }

  for (const entry of [...MEDIUM_PATTERNS, ...extraMedium]) {
    if (entry.pattern.test(command)) return entry;
  }

  return undefined;
}
