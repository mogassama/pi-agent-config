/**
 * bash-guard — Confirmation layer for dangerous bash commands.
 *
 * Hooks the native `bash` tool and intercepts commands matching known
 * dangerous patterns. Two levels:
 *   HIGH   — mandatory confirmation, no always-allow option
 *   MEDIUM — confirmation + "Always allow for this session"
 *
 * Configuration: ~/.pi/agent/settings.json under key "bashGuard"
 * Log file:      ~/.pi/agent/bash-guard.log  (TSV, append-only)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, isToolCallEventType, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { appendFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { type PatternEntry, compilePatterns, findMatch } from "./patterns";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface BashGuardSettings {
  enabled?: boolean;
  additionalPatternsHigh?: string[];
  additionalPatternsMedium?: string[];
  whitelistPatterns?: string[];
  logFilePath?: string;
}

function loadSettings(): BashGuardSettings {
  try {
    const raw = readFileSync(join(getAgentDir(), "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (parsed["bashGuard"] as BashGuardSettings) ?? {};
  } catch {
    return {};
  }
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

type Decision = "confirmed" | "declined" | "auto-allowed";

async function appendLog(
  logPath: string,
  level: string,
  decision: Decision,
  patternSource: string,
  command: string,
): Promise<void> {
  const ts = new Date().toISOString();
  const cmd = command.length > 500 ? `${command.slice(0, 500)}…` : command;
  // Replace tabs and newlines in the command field to keep TSV parseable
  const cmdSafe = cmd.replace(/[\t\n\r]/g, " ");
  const line = `${ts}\t${level}\t${decision}\t${patternSource}\t${cmdSafe}\n`;
  try {
    await mkdir(dirname(logPath), { recursive: true });
    await withFileMutationQueue(logPath, async () => {
      await appendFile(logPath, line, "utf-8");
    });
  } catch {
    // Never let a log failure block or crash the tool call
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  const settings = loadSettings();
  const defaultLogPath = join(getAgentDir(), "bash-guard.log");

  if (settings.enabled === false) {
    console.log("bash-guard: disabled via settings");
    return;
  }

  const logPath = expandHome(settings.logFilePath ?? defaultLogPath);
  const extraHigh: PatternEntry[] = compilePatterns(settings.additionalPatternsHigh ?? [], "high");
  const extraMedium: PatternEntry[] = compilePatterns(settings.additionalPatternsMedium ?? [], "medium");
  const whitelist: RegExp[] = (settings.whitelistPatterns ?? []).map((s) => new RegExp(s, "is"));

  // In-memory session state: pattern sources that the user has always-allowed
  const alwaysAllowed = new Set<string>();

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const command = event.input.command;
    const match = findMatch(command, extraHigh, extraMedium, whitelist);
    if (!match) return undefined;

    const { level, source: patternSource } = match;

    // MEDIUM: check session always-allow before prompting
    if (level === "medium" && alwaysAllowed.has(patternSource)) {
      await appendLog(logPath, level, "auto-allowed", patternSource, command);
      return undefined;
    }

    // Non-interactive mode (print / JSON): block rather than hang
    if (!ctx.hasUI) {
      await appendLog(logPath, level, "declined", patternSource, command);
      return {
        block: true,
        reason: `blocked by bash-guard: ${level} command requires confirmation (no UI available)`,
      };
    }

    const cmdDisplay = command.length > 500 ? `${command.slice(0, 500)}…` : command;
    const title =
      level === "high"
        ? "⚠️  Dangerous command (HIGH)"
        : "⚠️  Dangerous command (MEDIUM)";
    const prompt = `${title}\n\nPattern matched: ${patternSource}\n\n${cmdDisplay}`;

    const options =
      level === "high"
        ? (["Confirm", "Cancel"] as const)
        : (["Confirm", "Cancel", "Always allow for this session"] as const);

    const choice = await ctx.ui.select(prompt, [...options]);

    if (choice === "Confirm") {
      await appendLog(logPath, level, "confirmed", patternSource, command);
      return undefined;
    }

    if (choice === "Always allow for this session") {
      alwaysAllowed.add(patternSource);
      await appendLog(logPath, level, "auto-allowed", patternSource, command);
      return undefined;
    }

    // "Cancel" or Escape (undefined)
    await appendLog(logPath, level, "declined", patternSource, command);
    return { block: true, reason: "blocked by bash-guard: user declined" };
  });
}
