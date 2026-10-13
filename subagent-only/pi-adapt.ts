/**
 * pi-adapt — what this configuration assumes of pi, in one place (LOT-PI-ADAPT, item 2).
 *
 * Constants and pure functions only: no I/O, no state, no import of the SDK. Each entry names the
 * contract of `bin/pi-contrats` that establishes it against the real pi 0.86.0 (PLAN § 3, item 1;
 * MATRICES § A). Moving a value here changes nothing on 0.86.0 — that is what N1 to N3
 * (`tests/l0-pi-adapt.test.ts`) and the QD-EFF replays prove against references taken on b5453204.
 *
 * A pi upgrade is judged contract by contract against this file, not by reading a changelog.
 *
 * Deliberately outside: the four agent-directory policies (Q3, kept as they are), the extensions
 * that are ours (`envelope`, `role-guard`) and our own tool `submit`.
 */
import { join } from "node:path";

/** The pi version these facts were established on. Refused otherwise by `bin/pi-contrats` (Q4). */
export const PI_VERSION_QUALIFIEE = "0.86.0";

// ── C3 — provenance of the native tools ────────────────────────────────────────

/** The only tools a terminal plan leaves to the orchestrator — provided they are pi's own. */
export const OUTILS_LECTURE_NATIFS: readonly string[] = ["read", "grep", "find", "ls"];

/** `sourceInfo.source` of a native tool on 0.86.0 (C3). */
export const SOURCE_NATIVE = "builtin";

/** `sourceInfo.path` of a native tool on 0.86.0: `<builtin:NAME>` (C3). 0.99.0 drops the brackets. */
export const cheminNatif = (nom: string): string => `<builtin:${nom}>`;

/** A tool as `getAllTools()` describes it, for what the predicate reads. */
export interface OutilConnu { name: string; sourceInfo?: { source?: string; path?: string } }

/**
 * Is `nom` a read tool whose loaded implementation is pi's native one? (C3, N3)
 *
 * The name alone proves nothing: an extension can register a `read` that writes. pi 0.86 gives
 * each native tool the synthetic provenance `<builtin:NAME>` with source `builtin`, and an
 * extension that redefines a name replaces that provenance with its own. No list, nothing
 * verifiable: no tool is exempted. Fetching the list — and refusing when that fails — is the
 * caller's business.
 */
export function provenanceNativeLecture(nom: string, tous: readonly OutilConnu[] | undefined): boolean {
  if (!OUTILS_LECTURE_NATIFS.includes(nom)) return false;
  const outil = tous?.find((o) => o.name === nom);
  return outil?.sourceInfo?.source === SOURCE_NATIVE && outil.sourceInfo.path === cheminNatif(nom);
}

// ── C7 — the `--mode json` stream ────────────────────────────────────────────────

/** Event types read from a child's stream (C7). */
export const FLUX = {
  finDeTour: "turn_end",
  message: "message",
  finDeMessage: "message_end",
  debutOutil: "tool_execution_start",
  finOutil: "tool_execution_end",
} as const;

/** `message.role` of the model's messages (C7). */
export const ROLE_ASSISTANT = "assistant";
/** `content[].type` of a text block (C7). */
export const BLOC_TEXTE = "text";
/** `message.stopReason` of a provider failure (C7.7). */
export const ARRET_ERREUR = "error";
/** pi's native shell tool, as `toolName` carries it (C7). */
export const OUTIL_BASH = "bash";

/** Field names read at the stream boundary by dispatch and test-command (C7).
 * The readers keep their order, guards and domain decisions; these keys are pi's.
 */
export const CHAMPS_FLUX = {
  type: "type",
  role: "role",
  content: "content",
  usage: "usage",
  text: "text",
  toolName: "toolName",
  toolCallId: "toolCallId",
  isError: "isError",
} as const;

/** The message an event carries: `message` when present, otherwise the event itself. */
export const messageDe = (e: Record<string, any>): any => e.message ?? e;

/** Usage of one assistant message, in our field names. pi writes the total as `totalTokens`. */
export function usageDe(u: Record<string, any>) {
  return {
    input: u.input ?? 0,
    output: u.output ?? 0,
    reasoning: u.reasoning ?? 0,
    cacheRead: u.cacheRead ?? 0,
    cacheWrite: u.cacheWrite ?? 0,
    total: u.totalTokens ?? 0,
  };
}

/** The provider's error text when the message stopped on error, otherwise undefined (C7.7). */
export function erreurFournisseurDe(m: any): string | undefined {
  return m?.stopReason === ARRET_ERREUR && m.errorMessage ? String(m.errorMessage) : undefined;
}

/** `result.details` of a `tool_execution_end`. */
export const detailsDeFinOutil = (e: Record<string, unknown>): unknown => (e.result as { details?: unknown } | undefined)?.details;

/** `result.content` of a `tool_execution_end`. */
export const contenuDeFinOutil = (e: Record<string, unknown>): unknown => (e.result as { content?: unknown } | undefined)?.content;

/** `args.command` of a `tool_execution_start`. */
export const commandeDeDebutOutil = (e: Record<string, unknown>): unknown => (e.args as { command?: unknown } | undefined)?.command;

// ── C6 — the children's command line ─────────────────────────────────────────────

/**
 * Flags of `buildSpawnPlan` and `describePlan` (C6). Read in the source of pi rather than taken
 * from the help text — see the header of `spawn-args.ts` for the lines each one rests on.
 */
export const DRAPEAUX = {
  mode: "--mode",
  modeJson: "json",
  impression: "-p",
  sessionId: "--session-id",
  sansSession: "--no-session",
  modele: "--model",
  reflexion: "--thinking",
  outils: "--tools",
  sansFichiersContexte: "--no-context-files",
  sansSkills: "--no-skills",
  sansExtensions: "--no-extensions",
  extension: "-e",
  ajoutPromptSysteme: "--append-system-prompt",
} as const;

/**
 * Providers built into pi need nothing (C6).
 */
export const BUILTIN_PROVIDERS = new Set([
  "anthropic",
  "google",
  "openai",
  "openai-codex",
  "kimi-coding",
  "xai",
  "groq",
  "openrouter",
  // Native to pi and configured by an API key, not by an extension: `pi` lists
  // it under the providers it can configure itself, with `models_json_key`. It
  // failed the check because this set was written from the providers in use at
  // the time and a provider absent from it is treated as needing a package —
  // which sends the fix in the wrong direction, since there is no package to
  // name. Two lists, two questions: does pi know this provider, and if not
  // which extension supplies it.
  "qwen-paygo",
  "qwen",
]);

/**
 * Providers that need an extension loaded before their models exist (C6).
 *
 * Empty as of 3 August 2026: claude-bridge was removed. It routed through
 * Claude Code, which passes the claude_code preset unconditionally
 * (pi-claude-bridge/src/index.ts:1249) — ~26k tokens of another agent's
 * behavioural instructions, in a child whose whole point is to receive only
 * what we hand it. The native anthropic provider costs ~0.11 $ per review and
 * gives the system prompt back.
 *
 * The mechanism earned its place on 18 August 2026: moving the scout to
 * DeepSeek failed at load time with exactly the error it was written to give,
 * before a single delegation was spawned.
 */
export const PROVIDER_PACKAGE: Record<string, string> = {
  // Declared in settings.json as a git source; pi installs it under
  // <agentDir>/npm/node_modules/ like any other package, so resolveExtension
  // finds it by its package.json name.
  deepseek: "pi-deepseek-provider",
};

// ── C6 — where pi puts packages ──────────────────────────────────────────────────

/** A local extension directory: `<agentDir>/extensions/<name>/index.ts`. */
export const extensionLocale = (agentDir: string, nom: string): string => join(agentDir, "extensions", nom, "index.ts");

/** npm-installed packages live under `<agentDir>/npm/node_modules` (core/package-manager.js:1677). */
export const racineNpm = (agentDir: string, nom: string): string => join(agentDir, "npm", "node_modules", nom);

/** A `packages` entry that is a URL is cloned under `<agentDir>/git/<host>/<owner>/<repo>`. */
export const racineGit = (agentDir: string): string => join(agentDir, "git");

/** The entry points looked for in a package root, in order. */
export const entreesPaquet = (racine: string): string[] => [
  join(racine, "index.ts"),
  join(racine, "src", "index.ts"),
  join(racine, "dist", "index.js"),
];
