/**
 * pi-session-journal — Automatic session naming and markdown journal.
 *
 * session_start:
 *   Reads the git branch in cwd and records the start time.
 *   Skipped when reason === "resume".
 *
 * before_agent_start:
 *   On the first prompt only, builds "{branch} — {first_msg_40}" and calls
 *   pi.setSessionName() + ctx.ui.setStatus(). There is no timer: an earlier
 *   version described a 3 s wait that the code never implemented.
 *
 * session_shutdown:
 *   Extracts files touched, commands run, and decision snippets from
 *   the session entries, then appends a markdown entry to
 *   ~/.pi/agent/journal.md (created on first write).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Où le journal s'écrit. `PI_JOURNAL_PATH` le déplace — c'est un réglage réel,
 * pas une porte de test : le journal n'a aucune raison d'être cloué à un seul
 * chemin.
 */
const JOURNAL_PATH =
  process.env["PI_JOURNAL_PATH"] ?? join(homedir(), ".pi", "agent", "journal.md");

/** Tool names that write or mutate files. */
const MUTATING_TOOLS = new Set(["write", "edit"]);

/** Keywords that signal a decision in assistant text. */
const DECISION_KEYWORDS = [
  "decided",
  "chosen",
  "will use",
  "approach",
  "going with",
  "opted for",
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace and truncate, appending … when cut. */
function truncate(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

// ---------------------------------------------------------------------------
// Session info extraction
// ---------------------------------------------------------------------------

interface SessionInfo {
  firstUserMessage: string;
  filesTouched: string[];
  commandsRun: string[];
  decisionSnippets: string[];
  summaryLines: string[];
}

/**
 * Walk session entries and extract human-readable facts.
 *
 * Entries are typed as SessionEntry[] by the API but their message
 * subtypes come from @earendil-works/pi-ai, which we don't import
 * directly (spec: no pi internal imports). We use runtime shape checks
 * via Record<string, unknown> casts instead.
 */
export function extractSessionInfo(entries: unknown[]): SessionInfo {
  const filesTouched = new Set<string>();
  const commandsRun: string[] = [];
  const decisionSnippets: string[] = [];
  const summaryLines: string[] = [];
  let firstUserMessage = "";

  for (const raw of entries) {
    const entry = raw as Record<string, unknown>;
    if (entry["type"] !== "message") continue;

    const msg = entry["message"] as Record<string, unknown> | undefined;
    if (!msg) continue;

    const role = msg["role"] as string | undefined;
    const content = msg["content"];

    // ------------------------------------------------------------------
    // User messages — grab the first non-skill-injection text
    // ------------------------------------------------------------------
    if (role === "user") {
      if (firstUserMessage) continue;

      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block["type"] !== "text") continue;
          const text = (block["text"] as string | undefined)?.trim() ?? "";
          // Skip skill / context injection preambles injected by pi
          if (text.startsWith("<skill") || text.startsWith("<context")) continue;
          if (text) {
            firstUserMessage = text;
            break;
          }
        }
      } else if (typeof content === "string") {
        const text = content.trim();
        if (text && !text.startsWith("<skill") && !text.startsWith("<context")) {
          firstUserMessage = text;
        }
      }
      continue;
    }

    // ------------------------------------------------------------------
    // Assistant messages — tool calls + text blocks
    // ------------------------------------------------------------------
    if (role === "assistant" && Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        const btype = block["type"] as string | undefined;

        // Tool calls: ToolCall.type === "toolCall" (pi-ai types)
        if (btype === "toolCall") {
          const name = block["name"] as string | undefined;
          const args = block["arguments"] as Record<string, unknown> | undefined;

          // Files written or edited
          if (name && MUTATING_TOOLS.has(name)) {
            const path = args?.["path"];
            if (typeof path === "string") filesTouched.add(path);
          }

          // Bash commands (capped at 10 to keep the journal readable)
          if (name === "bash" && commandsRun.length < 10) {
            const cmd = args?.["command"];
            if (typeof cmd === "string") {
              commandsRun.push(truncate(cmd, 80));
            }
          }
        }

        // Text blocks: summary + decision detection
        if (btype === "text") {
          const text = (block["text"] as string | undefined)?.trim() ?? "";
          if (!text) continue;

          // Summary: first line of the first three distinct assistant turns
          if (summaryLines.length < 3) {
            const firstLine = text.split("\n")[0]?.trim() ?? "";
            if (firstLine.length > 20) {
              summaryLines.push(truncate(firstLine, 120));
            }
          }

          // Decisions: sentences that contain a decision keyword
          if (decisionSnippets.length < 5) {
            const lower = text.toLowerCase();
            if (DECISION_KEYWORDS.some((kw) => lower.includes(kw))) {
              for (const sentence of text.split(/[.!?\n]+/)) {
                const sl = sentence.toLowerCase();
                if (DECISION_KEYWORDS.some((kw) => sl.includes(kw))) {
                  const snippet = truncate(sentence, 100);
                  if (snippet && !decisionSnippets.includes(snippet)) {
                    decisionSnippets.push(snippet);
                    if (decisionSnippets.length >= 5) break;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    firstUserMessage,
    filesTouched: [...filesTouched],
    commandsRun,
    decisionSnippets,
    summaryLines,
  };
}

// ---------------------------------------------------------------------------
// Journal entry builder
// ---------------------------------------------------------------------------

function buildJournalEntry(
  startedAt: Date,
  name: string,
  branch: string,
  durationMs: number,
  info: SessionInfo,
): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`## ${formatTimestamp(startedAt)} — ${name}`);
  lines.push(`**Branch:** ${branch || "(none)"}`);
  lines.push(`**Duration:** ${formatDuration(durationMs)}`);
  lines.push("");

  lines.push("### What happened");
  if (info.summaryLines.length > 0) {
    lines.push(...info.summaryLines);
  } else {
    lines.push("_(no assistant messages recorded)_");
  }
  lines.push("");

  lines.push("### Files touched");
  if (info.filesTouched.length > 0) {
    lines.push(...info.filesTouched.map((f) => `- ${f}`));
  } else {
    lines.push("_(none)_");
  }
  lines.push("");

  lines.push("### Decisions");
  if (info.decisionSnippets.length > 0) {
    lines.push(...info.decisionSnippets.map((s) => `- ${s}`));
  } else {
    lines.push("_(none recorded)_");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Écrire, et rendre la raison quand ça n'a pas marché.
 *
 * Le `catch` vide d'origine ne bloquait rien — c'était l'intention, et elle est
 * bonne : un journal ne doit jamais faire tomber une session. Mais il rendait
 * l'indisponibilité **invisible**, si bien qu'un journal muet et un journal
 * absent se ressemblaient. Une trace dont on ne sait pas si elle a été écrite ne
 * sert pas de trace.
 *
 * La raison est résumée au message d'erreur. Jamais l'entrée elle-même : elle
 * porte des chemins de fichiers et des extraits de conversation.
 */
async function appendJournal(entry: string): Promise<string | undefined> {
  try {
    await mkdir(dirname(JOURNAL_PATH), { recursive: true });
    await appendFile(JOURNAL_PATH, entry, "utf-8");
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  // Session-scoped state — reset at each session_start
  let sessionStartTime = 0;
  let sessionBranch = "";
  let sessionName = "";
  let sessionCwd = "";
  let journalIndisponible = false;
  let hasNamed = false;

  /**
   * Prévenir une fois, sans jamais bloquer.
   *
   * « Une fois » veut dire une fois par **session**, pas une fois par instance
   * d'extension : `session_start` remet le drapeau à zéro. Sans ça, une seconde
   * session dans le même processus héritait du silence de la première.
   */
  const avertirUneFois = (ctx: { hasUI: boolean; ui: { notify: (t: string, k?: string) => void } }, motif: string) => {
    if (journalIndisponible || !ctx.hasUI) return;
    journalIndisponible = true;
    ctx.ui.notify(`journal indisponible : ${motif}`, "warning");
  };

  // -------------------------------------------------------------------------
  // session_start
  // -------------------------------------------------------------------------
  pi.on("session_start", async (event, ctx) => {
    /*
     * L'état de session repart de zéro ici — sans quoi « une fois par session »
     * ne serait qu'« une fois par instance », et une seconde session hériterait
     * du silence de la première.
     *
     * `hasNamed` est la seule exception, et elle est délibérée. Sur une reprise,
     * il ne revient pas à `false` mais à `true` : la session existante **possède
     * déjà son nom**, et c'est un fait durable, pas un compteur de passage. Le
     * remettre à zéro rendait la session reprise renommable au premier prompt
     * suivant, ce que le README interdit — et le test de reprise ne le voyait
     * pas, parce qu'il ne vérifiait que la fermeture.
     */
    sessionStartTime = 0;
    sessionBranch = "";
    sessionName = "";
    sessionCwd = "";
    journalIndisponible = false;
    hasNamed = false;

    if (event.reason === "resume") {
      hasNamed = true;
      return;
    }

    sessionStartTime = Date.now();
    sessionCwd = ctx.cwd;
    sessionBranch = "";
    sessionName = "";

    try {
      // git-launch: outside-recovery
      // Nommage de session, asynchrone, hors de toute fenêtre de reconstruction.
      const result = await pi.exec("git", ["branch", "--show-current"], {
        cwd: sessionCwd,
        timeout: 5_000,
      });
      const branch = result.stdout.trim();
      if (result.code === 0 && branch) {
        sessionBranch = branch;
      }
    } catch {
      // Not a git repo, git not installed, or timeout — silently skip
    }
  });

  // -------------------------------------------------------------------------
  // before_agent_start — name the session on the first user message
  // -------------------------------------------------------------------------
  pi.on("before_agent_start", (event, ctx) => {
    if (hasNamed) return;
    hasNamed = true;

    try {
      const prompt = (event as Record<string, unknown>)["prompt"] as string | undefined;
      const msgPart = prompt ? truncate(prompt, 40) : "(new session)";
      sessionName = sessionBranch ? `${sessionBranch} — ${msgPart}` : msgPart;

      pi.setSessionName(sessionName);

      if (ctx.hasUI) {
        ctx.ui.setStatus("journal", `📓 ${sessionName}`);
      }
    } catch {
      // Never surface naming errors
    }
  });

  // -------------------------------------------------------------------------
  // session_shutdown
  // -------------------------------------------------------------------------
  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      // If session_start never ran (e.g., "resume" reason), nothing to log
      if (sessionStartTime === 0) return;

      const durationMs = Date.now() - sessionStartTime;
      const entries = ctx.sessionManager.getEntries() as unknown[];
      const info = extractSessionInfo(entries);

      const rawName = sessionName || info.firstUserMessage || "(unnamed session)";
      const name = truncate(rawName, 60);

      const entry = buildJournalEntry(
        new Date(sessionStartTime),
        name,
        sessionBranch,
        durationMs,
        info,
      );

      const echec = await appendJournal(entry);

      if (!echec) {
        if (ctx.hasUI) ctx.ui.notify("Session logged to journal.md", "info");
      } else {
        avertirUneFois(ctx, echec);
      }
    } catch (e) {
      /*
       * Tout ce qui empêche la journalisation se dit, pas seulement l'écriture.
       *
       * Ce `catch` était vide : une erreur dans `getEntries()`, dans
       * `extractSessionInfo` ou dans la construction de l'entrée supprimait la
       * trace entière sans un mot. L'écriture, elle, était déjà visible — d'où
       * l'illusion que le point était clos.
       *
       * Le silence reste acceptable là où il n'empêche rien : la détection de
       * branche est une métadonnée facultative, et le nommage a son repli. Ici,
       * rien n'est écrit du tout.
       */
      avertirUneFois(ctx, e instanceof Error ? e.message : String(e));
    } finally {
      // Une fermeture consomme la session : une seconde ne rejournalise pas.
      sessionStartTime = 0;
    }
  });
}
