/**
 * Skill slicer — turns a SKILL.md file into the slice a given role receives.
 *
 * Injected with `--append-system-prompt <text>`, never `--skill <path>`:
 * `--skill` injects name + description + location only, and the child would
 * spend a `read` turn to load the body. `--append-system-prompt` accepts
 * literal text (resource-loader.js:16-28 reads it as a file only when the
 * string is an existing path), so a slice passes through as text.
 *
 * Measured on the 11 reviewer-facing skills:
 *   worker slice   ~1375 tokens on average, 2305 at worst (gcp-engineering)
 *   reviewer slice ~1946 tokens on average, 3004 at worst
 * The delta costs the reviewer ~570 tokens and the worker nothing.
 */

import { readFileSync } from "node:fs";

/** The one marker a domain skill must carry. Everything above it is authoring. */
export const DELTA_MARKER = "## Review delta";

export type SliceMode =
  | "authoring" // worker: conventions only
  | "full" // reviewer: conventions + how to weigh a breach of them
  | "none"; // scout, advisor: no skill body at all

export interface SkillSlice {
  /** Text to pass to --append-system-prompt. Empty string when mode is "none". */
  text: string;
  /** False when the file carries no Review delta — not an error by itself. */
  hasDelta: boolean;
  /** Rough token estimate, chars/4 scaled by the 0.82 factor measured on AGENTS.md. */
  estimatedTokens: number;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * Strip the YAML frontmatter.
 *
 * It exists for the orchestrator's auto-load and is dead weight in a child,
 * which receives the skill by force. It also carries routing instructions
 * ("when it shows {{ ref() }}, load dbt-engineering") that a child running
 * with -ns cannot act on: no skill discovery, no way to load one by name.
 * Removing the frontmatter removes that trap by construction.
 */
function stripFrontmatter(raw: string): string {
  const m = raw.match(FRONTMATTER);
  return m ? raw.slice(m[0].length) : raw;
}

function estimateTokens(text: string): number {
  return Math.round((text.length / 4) * 0.82);
}

/**
 * The marker search is anchored to the start of a line, and must stay that way.
 *
 * `code-review` mentions "## Review delta" mid-sentence when it points at the
 * domain skills. An unanchored search would cut there and hand the reviewer a
 * truncated mechanism file, silently. A skill that opened a line with the
 * marker text in prose would still break it — which is why pi-check-config
 * must assert exactly one occurrence per file, not merely one or more.
 */

/**
 * Slice a skill body for a role.
 *
 * Never throws on a missing marker: see the note in the "full" branch. The
 * static guard lives in pi-check-config, where failing is free.
 */
export function sliceSkill(source: string, mode: SliceMode, label = "skill"): SkillSlice {
  if (mode === "none") {
    return { text: "", hasDelta: false, estimatedTokens: 0 };
  }

  const body = stripFrontmatter(source).trim();
  const at = body.indexOf(`\n${DELTA_MARKER}`);
  const hasDelta = at !== -1;

  if (mode === "authoring") {
    const text = (hasDelta ? body.slice(0, at) : body).trim();
    return { text, hasDelta, estimatedTokens: estimateTokens(text) };
  }

  // mode === "full": the whole body, delta included when there is one.
  //
  // A missing marker is not an error here. Eight of the twenty skills are not
  // reviewer-facing and will never carry a delta — `tdd`, `git-collaboration`,
  // the architecture pair. Refusing them would abort the delegation over a
  // skill the orchestrator was right to pass, and an aborted review is a worse
  // outcome than a review without one severity table.
  //
  // The case this used to catch — a domain skill whose heading was renamed,
  // silently losing its severity table — belongs to pi-check-config, which can
  // assert exactly one marker per reviewer-facing skill without a delegation
  // riding on it. `hasDelta` is returned so the caller can report the
  // difference rather than swallow it.
  return { text: body, hasDelta, estimatedTokens: estimateTokens(body) };
}

export function sliceSkillFile(path: string, mode: SliceMode): SkillSlice {
  return sliceSkill(readFileSync(path, "utf-8"), mode, path);
}

/** Which slice each role gets. Advisor has no `read` tool, so a skill body is unreachable anyway. */
export const MODE_BY_ROLE: Record<string, SliceMode> = {
  worker: "authoring",
  reviewer: "full",
  scout: "none",
  advisor: "none",
};
