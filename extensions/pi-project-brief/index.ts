/**
 * pi-project-brief — a short, stable orientation note per project.
 *
 * Replaces graphify. The graph was never the point: what an agent needs when it
 * opens an unfamiliar repo is orientation, not an inventory. graphify produced
 * an inventory, cost a pipeline to build it, and shipped a report whose first
 * two lines were a commit hash and a date — which is why AGENTS.md had to pin it
 * last in the prompt stack.
 *
 * Design consequences, in order of importance:
 *
 *   1. Two files, one injected. BRIEF.md is prose with no variable value in it —
 *      no hash, no date, no counter. brief.meta.json holds everything volatile
 *      and is never injected. The brief can therefore sit high in the stable
 *      prefix and stay cached, instead of being relegated to last.
 *
 *   2. The expensive pass is rare and pre-digested. A deterministic pass (zero
 *      tokens) condenses the repo into a digest; the model turns that digest
 *      into ≤ maxLines of prose, once per project, and again only when the
 *      structure moves. Staleness is a git call, not a model call.
 *
 *   3. Injection follows inheritProjectContext. pi-subagents exports it as
 *      PI_SUBAGENT_INHERIT_PROJECT_CONTEXT, so the extension honours the choice
 *      already made per agent in settings.json rather than inventing its own.
 *      scout is denied on top of that: it ships with inheritProjectContext true
 *      and is called 50–200 times a session.
 *
 *   4. The deterministic guarantees stay in code. The model writes the prose;
 *      this extension enforces the line cap, writes the sidecar, and adds the
 *      git exclusion. A model that ignores the cap does not get to.
 *
 * Config: ~/.pi/agent/settings.json under key "projectBrief"
 *   {
 *     "enabled": true,
 *     "maxLines": 40,
 *     "staleAfterDays": 90,
 *     "denyAgents": ["scout"],
 *     "commitBrief": false
 *   }
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface ProjectBriefSettings {
  enabled?: boolean;
  maxLines?: number;
  staleAfterDays?: number;
  denyAgents?: string[];
  /** True = the brief is meant to be versioned; no git exclusion is written. */
  commitBrief?: boolean;
}

const DEFAULTS = {
  maxLines: 40,
  staleAfterDays: 90,
  denyAgents: ["scout"],
};

function loadSettings(): ProjectBriefSettings {
  try {
    const raw = readFileSync(join(getAgentDir(), "settings.json"), "utf-8");
    return (JSON.parse(raw) as Record<string, unknown>)["projectBrief"] as ProjectBriefSettings ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Paths and sidecar
// ---------------------------------------------------------------------------

const briefPath = (cwd: string) => join(cwd, ".pi", "BRIEF.md");
const metaPath = (cwd: string) => join(cwd, ".pi", "brief.meta.json");

interface BriefMeta {
  /** Commit the brief was generated from. */
  commit?: string;
  generatedAt?: string;
  /** "later" = ask again when structure moves. "never" = stop asking. */
  declined?: "later" | "never";
  declinedAt?: string;
}

function readMeta(cwd: string): BriefMeta {
  try {
    return JSON.parse(readFileSync(metaPath(cwd), "utf-8")) as BriefMeta;
  } catch {
    return {};
  }
}

function writeMeta(cwd: string, meta: BriefMeta): void {
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(metaPath(cwd), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  } catch {
    /* a failed sidecar must never break a session */
  }
}

// ---------------------------------------------------------------------------
// Who gets the brief
// ---------------------------------------------------------------------------

/**
 * Orchestrator → yes. Subagent → whatever its inheritProjectContext says,
 * minus the deny list. No new configuration surface: settings.json already
 * carries this decision per agent.
 */
function shouldInject(deny: string[]): boolean {
  const inherit = process.env["PI_SUBAGENT_INHERIT_PROJECT_CONTEXT"];
  if (inherit === "0") return false;
  const agent = process.env["PI_SUBAGENT_CHILD_AGENT"];
  if (agent && deny.includes(agent)) return false;
  return true;
}

/** Only a real interactive session may generate. Subagents read, never write. */
function isOrchestrator(): boolean {
  return process.env["PI_SUBAGENT_CHILD_AGENT"] === undefined;
}

// ---------------------------------------------------------------------------
// Freshness — one git call, no model
// ---------------------------------------------------------------------------

type Freshness = { state: "missing" | "fresh" | "stale"; reason?: string };

const STRUCTURAL = /^(pyproject\.toml|uv\.lock|package\.json|dbt_project\.yml|requirements.*\.txt|Dockerfile|.*\.tf)$/i;

async function freshness(pi: ExtensionAPI, cwd: string, staleAfterDays: number): Promise<Freshness> {
  if (!existsSync(briefPath(cwd))) return { state: "missing" };

  const meta = readMeta(cwd);

  if (meta.generatedAt) {
    const age = (Date.now() - Date.parse(meta.generatedAt)) / 86_400_000;
    if (Number.isFinite(age) && age > staleAfterDays) {
      return { state: "stale", reason: `${Math.round(age)} days old` };
    }
  }

  if (!meta.commit) return { state: "fresh" };

  // A file added or deleted moved the structure. A file merely edited did not.
  try {
    const res = await pi.exec("git", ["diff", "--name-status", meta.commit, "HEAD"], {
      timeout: 10_000,
    });
    if ((res.code ?? 1) !== 0) return { state: "fresh" }; // unknown commit — do not nag
    const lines = (res.stdout || "").trim().split("\n").filter(Boolean);
    const moved = lines.filter((l) => {
      const [status, path = ""] = l.split("\t");
      if (status?.startsWith("A") || status?.startsWith("D") || status?.startsWith("R")) return true;
      return STRUCTURAL.test(path.split("/").pop() ?? "");
    });
    if (moved.length > 0) {
      return { state: "stale", reason: `${moved.length} structural change(s) since generation` };
    }
  } catch {
    /* no git, or not a repo — treat as fresh */
  }
  return { state: "fresh" };
}

// ---------------------------------------------------------------------------
// Deterministic digest — zero tokens
// ---------------------------------------------------------------------------

const MANIFESTS = [
  "pyproject.toml",
  "dbt_project.yml",
  "package.json",
  "Makefile",
  "docker-compose.yml",
];

async function sh(pi: ExtensionAPI, cmd: string, cwd: string, timeout = 15_000): Promise<string> {
  try {
    const r = await pi.exec("bash", ["-lc", cmd], { timeout });
    return (r.stdout || "").trim();
  } catch {
    return "";
  }
}

function head(path: string, lines: number): string {
  try {
    return readFileSync(path, "utf-8").split("\n").slice(0, lines).join("\n");
  } catch {
    return "";
  }
}

/**
 * Condense the repo into something a model can read in one pass. Everything
 * here is cheap shell and file reads; nothing is sent anywhere yet.
 */
async function buildDigest(pi: ExtensionAPI, cwd: string): Promise<string> {
  const parts: string[] = [];
  const add = (title: string, body: string) => {
    if (body.trim()) parts.push(`### ${title}\n${body.trim()}`);
  };

  add("Tracked files by extension", await sh(pi,
    `git ls-files | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -15`, cwd));

  add("Directories (depth 2, with file counts)", await sh(pi,
    `git ls-files | awk -F/ 'NF>1{print $1"/"(NF>2?$2:"")}' | sort | uniq -c | sort -rn | head -30`, cwd));

  add("Root entries", await sh(pi, `git ls-files | grep -v / | head -30`, cwd));

  for (const m of MANIFESTS) {
    const p = join(cwd, m);
    if (existsSync(p)) add(`${m} (first 60 lines)`, head(p, 60));
  }

  for (const r of ["README.md", "readme.md", "README.rst"]) {
    const p = join(cwd, r);
    if (existsSync(p)) { add(`${r} (first 80 lines)`, head(p, 80)); break; }
  }

  add("Recent commit subjects", await sh(pi, `git log --format=%s -30`, cwd));

  add("Most-churned files", await sh(pi,
    `git log --format= --name-only -200 | grep -v '^$' | sort | uniq -c | sort -rn | head -15`, cwd));

  add("Entry-point candidates", await sh(pi,
    `git ls-files | grep -Ei '(^|/)(main|__main__|cli|app|dag_|conftest)\\.py$|(^|/)dags/|Dockerfile|\\.tf$' | head -25`, cwd));

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// The generation instruction
// ---------------------------------------------------------------------------

function instruction(cwd: string, digestPath: string, maxLines: number): string {
  return [
    `Write the project brief for this repository to \`.pi/BRIEF.md\` using the \`write\` tool.`,
    ``,
    `Source material: read \`${digestPath}\`. It is a pre-computed digest of the repo —`,
    `file inventory, manifests, README, recent commits, entry-point candidates. Read files`,
    `directly only where the digest leaves a real gap; do not re-explore the tree.`,
    ``,
    `**Hard limit: ${maxLines} lines.** Over that, it stops being read. Prefer cutting a`,
    `section to compressing every section into unreadable density.`,
    ``,
    `Include, in this order:`,
    `- What this project does, for whom, what it produces — 3 lines maximum.`,
    `- Stack with real versions, taken from the manifests, not guessed.`,
    `- Entry points: what gets run, and the exact command.`,
    `- One line per top-level directory: its role, not its contents.`,
    `- The data flow in one sentence: sources → transforms → sinks.`,
    `- Conventions that DIFFER from the global AGENTS.md. Only the deviations —`,
    `  everything else is already in context and repeating it wastes the budget.`,
    `- How tests are run.`,
    `- Two or three known traps a newcomer would hit.`,
    ``,
    `Exclude anything a single \`rg\` or \`ls\` would answer: no file listings, no function`,
    `inventories, no dependency graph. The brief answers "where do I start", not "what exists".`,
    ``,
    `**No variable values anywhere in the file** — no date, no commit hash, no counts of`,
    `files or lines. The brief must be byte-identical across two runs on the same code, or`,
    `it invalidates the prompt cache on every session. Volatile metadata is written`,
    `separately and automatically; do not add it.`,
    ``,
    `Open with exactly this line, then a blank line:`,
    `> Descriptive, not normative. Generated from the repo; AGENTS.md and the project bundle`,
    `> take precedence wherever they disagree.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  const settings = loadSettings();
  if (settings.enabled === false) return;

  const maxLines = settings.maxLines ?? DEFAULTS.maxLines;
  const staleAfterDays = settings.staleAfterDays ?? DEFAULTS.staleAfterDays;
  const denyAgents = settings.denyAgents ?? DEFAULTS.denyAgents;

  let brief: string | null = null;
  let injected = false;

  // -----------------------------------------------------------------------
  // Read once per session. Never re-read.
  // -----------------------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    brief = null;
    injected = false;

    if (!shouldInject(denyAgents)) return;

    try {
      brief = readFileSync(briefPath(ctx.cwd), "utf-8");
    } catch {
      brief = null;
    }

    if (!isOrchestrator() || !ctx.hasUI) return;

    const state = await freshness(pi, ctx.cwd, staleAfterDays);
    if (state.state === "fresh") return;

    const meta = readMeta(ctx.cwd);
    if (meta.declined === "never") return;
    // "later" holds until the structure moves again; a fresh stale reason clears it.
    if (meta.declined === "later" && state.state === "missing") return;

    const label = state.state === "missing"
      ? "No project brief for this repo."
      : `Project brief is stale — ${state.reason}.`;

    const choice = await ctx.ui.select(
      `${label}\n\nA brief is one short orientation note, injected once per session.`,
      ["Generate it now", "Not now", "Never for this repo"],
      // Auto-cancels rather than holding a session that was opened in a hurry.
      { timeout: 20_000 } as never,
    );

    if (choice === "Generate it now") {
      await generate(pi, ctx.cwd, maxLines);
    } else if (choice === "Never for this repo") {
      writeMeta(ctx.cwd, { ...meta, declined: "never", declinedAt: new Date().toISOString() });
    } else {
      writeMeta(ctx.cwd, { ...meta, declined: "later", declinedAt: new Date().toISOString() });
    }
  });

  // -----------------------------------------------------------------------
  // Inject once, on the first turn.
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", async (event) => {
    if (!brief || injected) return undefined;
    injected = true;
    return {
      systemPrompt: `${event.systemPrompt}\n\n## Project brief\n\n${brief}`,
    };
  });

  // -----------------------------------------------------------------------
  // Enforce the guarantees in code, not in the prompt.
  // -----------------------------------------------------------------------

  pi.on("tool_result", async (event, ctx) => {
    if (!isWriteToolResult(event) || event.isError) return undefined;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string") return undefined;
    if (!path.replace(/\\/g, "/").endsWith(".pi/BRIEF.md")) return undefined;

    const target = briefPath(ctx.cwd);
    let text: string;
    try {
      text = readFileSync(target, "utf-8");
    } catch {
      return undefined;
    }

    // Cap in code. A model that ignores the limit does not get to.
    const lines = text.split("\n");
    let note = "";
    if (lines.length > maxLines) {
      writeFileSync(target, `${lines.slice(0, maxLines).join("\n")}\n`, "utf-8");
      note = `\n\nTruncated to ${maxLines} lines by pi-project-brief (was ${lines.length}). ` +
        `Rewrite it shorter rather than leaving it cut mid-sentence.`;
    }

    const commit = (await sh(pi, "git rev-parse HEAD", ctx.cwd, 5_000)) || undefined;
    writeMeta(ctx.cwd, { commit, generatedAt: new Date().toISOString() });

    if (settings.commitBrief !== true) addGitExclusion(ctx.cwd);

    brief = readFileSync(target, "utf-8");

    return note
      ? { content: [...event.content, { type: "text" as const, text: note }] }
      : undefined;
  });

  // -----------------------------------------------------------------------
  // /brief
  // -----------------------------------------------------------------------

  pi.registerCommand("brief", {
    description: "Project brief — show, refresh, or forget it for this repo",

    handler: async (args, ctx) => {
      const arg = (args ?? "").trim();

      if (arg === "forget") {
        writeMeta(ctx.cwd, { ...readMeta(ctx.cwd), declined: "never" });
        ctx.ui.notify("brief: disabled for this repo", "info");
        return;
      }

      if (arg === "" && existsSync(briefPath(ctx.cwd))) {
        const state = await freshness(pi, ctx.cwd, staleAfterDays);
        pi.sendUserMessage(
          `Current project brief (${state.state}${state.reason ? ` — ${state.reason}` : ""}):\n\n` +
            readFileSync(briefPath(ctx.cwd), "utf-8"),
          { deliverAs: "followUp" },
        );
        return;
      }

      await generate(pi, ctx.cwd, maxLines);
    },
  });

  async function generate(api: ExtensionAPI, cwd: string, cap: number): Promise<void> {
    const digest = await buildDigest(api, cwd);
    if (!digest.trim()) return;
    const digestPath = join(cwd, ".pi", "brief.digest.md");
    try {
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      writeFileSync(digestPath, digest, "utf-8");
    } catch {
      return;
    }
    if (loadSettings().commitBrief !== true) addGitExclusion(cwd);
    api.sendUserMessage(instruction(cwd, relative(cwd, digestPath), cap), {
      deliverAs: "followUp",
    });
  }
}

// ---------------------------------------------------------------------------
// Git exclusion — local only, no diff in the repo
// ---------------------------------------------------------------------------

/**
 * .git/info/exclude rather than .gitignore: same effect on git, but the file is
 * never tracked, so nothing appears in `git status` and nothing can drift into
 * an unrelated commit or a client PR.
 */
function addGitExclusion(cwd: string): void {
  const excludePath = join(cwd, ".git", "info", "exclude");
  try {
    if (!existsSync(join(cwd, ".git"))) return; // not a repo, or a worktree file
    mkdirSync(join(cwd, ".git", "info"), { recursive: true });
    const current = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
    if (current.includes(".pi/")) return;
    appendFileSync(excludePath, `${current.endsWith("\n") || !current ? "" : "\n"}# pi-project-brief\n.pi/\n`, "utf-8");
  } catch {
    /* never break a session over an exclusion */
  }
}
