/**
 * pi-lint-gate — ruff on every Python edit, mypy once per turn.
 *
 * There is no post-edit event in the pi extension API. There is `tool_result`,
 * which fires after a tool has run and can rewrite what the agent sees. Filtered
 * on the built-in `edit` / `write` tools, that is the same hook under a different
 * name: the edit has landed on disk, and the linter output can be appended to
 * the tool result the model reads next.
 *
 *   ruff  — per edit. Fast enough (single file, milliseconds) that latency is
 *           not a concern, and the feedback lands where the model is looking.
 *   mypy  — once per turn, on `turn_end`, over the union of files touched during
 *           that turn. Per-edit mypy would re-analyse the import graph on every
 *           write and make the session unusable.
 *
 * Neither is a gate in the blocking sense: `tool_result` cannot un-write a file.
 * The edit stands; the agent is told it is broken and is expected to fix it
 * before moving on. Blocking would have to happen in `tool_call`, before the
 * content exists — nothing to lint at that point.
 *
 * Configuration: ~/.pi/agent/settings.json under key "lintGate"
 *   { "enabled": true, "ruff": true, "mypy": true, "mypyTimeoutMs": 60000 }
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface LintGateSettings {
  enabled?: boolean;
  ruff?: boolean;
  mypy?: boolean;
  mypyTimeoutMs?: number;
  ruffTimeoutMs?: number;
}

function loadSettings(): LintGateSettings {
  try {
    const raw = readFileSync(join(getAgentDir(), "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (parsed["lintGate"] as LintGateSettings) ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPythonPath(value: unknown): value is string {
  return typeof value === "string" && value.endsWith(".py");
}

/** Absolute path, resolved against cwd when the tool reported a relative one. */
function absolutise(path: string, cwd: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

/** Keep output short — the model needs the errors, not a wall of context. */
function clip(text: string, maxLines: number): string {
  const lines = text.trim().split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more line(s)`].join("\n");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  const settings = loadSettings();
  if (settings.enabled === false) return;

  const ruffEnabled = settings.ruff !== false;
  const mypyEnabled = settings.mypy !== false;

  /** Files written during the current turn, cleared at turn_end. */
  const touchedThisTurn = new Set<string>();

  /** Tool availability, probed once per session. undefined = not probed yet. */
  const available = new Map<string, boolean>();

  async function hasTool(name: string): Promise<boolean> {
    const cached = available.get(name);
    if (cached !== undefined) return cached;
    let ok = false;
    try {
      const result = await pi.exec("sh", ["-c", `command -v ${name}`], { timeout: 5_000 });
      ok = (result.code ?? 1) === 0;
    } catch {
      ok = false;
    }
    available.set(name, ok);
    return ok;
  }

  // -----------------------------------------------------------------------
  // ruff — after every edit / write of a .py file
  // -----------------------------------------------------------------------

  if (ruffEnabled) {
    pi.on("tool_result", async (event, ctx) => {
      if (!isEditToolResult(event) && !isWriteToolResult(event)) return undefined;
      if (event.isError) return undefined;

      const rawPath = (event.input as { path?: unknown }).path;
      if (!isPythonPath(rawPath)) return undefined;

      const path = absolutise(rawPath, ctx.cwd);
      touchedThisTurn.add(path);

      if (!(await hasTool("ruff"))) return undefined;

      let output: string;
      try {
        const result = await pi.exec(
          "ruff",
          ["check", "--output-format", "concise", "--no-fix", path],
          { timeout: settings.ruffTimeoutMs ?? 20_000, signal: ctx.signal },
        );
        if ((result.code ?? 1) === 0) return undefined; // clean
        output = ((result.stdout || "") + (result.stderr || "")).trim();
      } catch {
        return undefined; // never let the linter break the edit
      }

      if (!output) return undefined;

      const note =
        `\n\n--- ruff (${relative(ctx.cwd, path) || path}) ---\n` +
        `${clip(output, 30)}\n` +
        `Fix these before continuing. Do not proceed to the next edit with ruff failing.`;

      return {
        content: [...event.content, { type: "text" as const, text: note }],
      };
    });
  }

  // -----------------------------------------------------------------------
  // mypy — once per turn, over the files touched during that turn
  // -----------------------------------------------------------------------

  if (mypyEnabled) {
    pi.on("turn_end", async (_event, ctx) => {
      const paths = [...touchedThisTurn];
      touchedThisTurn.clear(); // clear first: the follow-up message below starts a new turn

      if (paths.length === 0) return undefined;
      if (!(await hasTool("mypy"))) return undefined;

      let output: string;
      try {
        const result = await pi.exec("mypy", ["--no-error-summary", ...paths], {
          timeout: settings.mypyTimeoutMs ?? 60_000,
          signal: ctx.signal,
        });
        if ((result.code ?? 1) === 0) return undefined; // clean
        output = ((result.stdout || "") + (result.stderr || "")).trim();
      } catch {
        return undefined;
      }

      if (!output) return undefined;

      pi.sendUserMessage(
        `mypy failed on files edited this turn:\n\n${clip(output, 40)}\n\n` +
          `Fix the type errors before doing anything else. If a report is a false ` +
          `positive, say which one and why — do not silence it with a blanket ignore.`,
      );
      return undefined;
    });
  }
}
