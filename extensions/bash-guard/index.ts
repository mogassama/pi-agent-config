/**
 * bash-guard — Confirmation layer for dangerous bash commands.
 *
 * Hooks the native `bash` tool and intercepts commands matching known
 * dangerous patterns. Three levels:
 *   TOKEN  — single-use authorisation. `git commit` / `gh pr merge|create` pass
 *            only if ~/.pi/.allow-commit exists; the file is consumed (unlinked)
 *            on the spot. Interactive sessions may authorise one commit via a
 *            dialog instead. Never an always-allow.
 *   HIGH   — mandatory confirmation, no always-allow option
 *   MEDIUM — confirmation + "Always allow for this session"
 *
 * Configuration: ~/.pi/agent/settings.json under key "bashGuard"
 * Log file:      ~/.pi/agent/bash-guard.log  (TSV, append-only)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, isToolCallEventType, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { type PatternEntry, TOKEN_FILE_PATTERN, compilePatterns, findMatch } from "./patterns";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface BashGuardSettings {
  enabled?: boolean;
  additionalPatternsHigh?: string[];
  additionalPatternsMedium?: string[];
  whitelistPatterns?: string[];
  logFilePath?: string;
  /** Single-use commit token. Default: ~/.pi/.allow-commit */
  commitTokenPath?: string;
  /**
   * When true, a commit is authorised ONLY by the token file — the interactive
   * dialog is not offered. Default: false.
   */
  commitTokenOnly?: boolean;
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

type Decision = "confirmed" | "declined" | "auto-allowed" | "escalated" | "token-consumed" | "token-missing";

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
// Commit token
// ---------------------------------------------------------------------------

/**
 * Test-and-consume the single-use commit token.
 *
 * `unlinkSync` is the test: it throws ENOENT when the file is absent, and
 * removes it atomically when present. There is no window in which two
 * concurrent commits both see the token.
 */
function consumeCommitToken(tokenPath: string): boolean {
  try {
    unlinkSync(tokenPath);
    return true;
  } catch {
    return false;
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
  const commitTokenPath = expandHome(settings.commitTokenPath ?? "~/.pi/.allow-commit");
  const extraHigh: PatternEntry[] = compilePatterns(settings.additionalPatternsHigh ?? [], "high");
  const extraMedium: PatternEntry[] = compilePatterns(settings.additionalPatternsMedium ?? [], "medium");
  const whitelist: RegExp[] = (settings.whitelistPatterns ?? []).map((s) => new RegExp(s, "is"));

  // In-memory session state: pattern sources that the user has always-allowed
  const alwaysAllowed = new Set<string>();

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const command = event.input.command;

    // Before the whitelist, before TOKEN, before everything: the authorisation
    // file is the operator's, and nothing an agent runs may create, copy or
    // restore it. No dialog — an interactive operator who wants to authorise a
    // commit already has the TOKEN dialog for that, and does not need the agent
    // to mint the file on their behalf.
    if (TOKEN_FILE_PATTERN.test(command)) {
      await appendLog(logPath, "token", "declined", "allow-commit token file", command);
      return {
        block: true,
        reason:
          "blocked by bash-guard: the commit token is the operator's authorisation and " +
          "cannot be created, copied or restored by an agent. If a commit is blocked for " +
          "want of a token, report it and stop — do not work around it.",
      };
    }

    const match = findMatch(command, extraHigh, extraMedium, whitelist);
    if (!match) return undefined;

    const { level, source: patternSource } = match;

    // TOKEN: single-use authorisation. Checked before everything else — the
    // token works headless (subagents run with hasUI === false), and no
    // always-allow path exists at this level.
    if (level === "token") {
      if (consumeCommitToken(commitTokenPath)) {
        await appendLog(logPath, level, "token-consumed", patternSource, command);
        return undefined;
      }

      const noToken =
        `blocked by bash-guard: commits require a single-use token.\n` +
        `Pattern matched: ${patternSource}\n\n` +
        `The operator authorises one commit with:\n  touch ${commitTokenPath}\n` +
        `The token is consumed by the first matching command. Do not create it yourself.`;

      if (!ctx.hasUI || settings.commitTokenOnly === true) {
        await appendLog(logPath, level, "token-missing", patternSource, command);
        return { block: true, reason: noToken };
      }

      const cmdShort = command.length > 500 ? `${command.slice(0, 500)}…` : command;
      const tokenChoice = await ctx.ui.select(
        `\u26d4  Commit requires authorisation (TOKEN)\n\nPattern matched: ${patternSource}\n\n${cmdShort}`,
        // No "always allow" — by design, and not to be added back.
        ["Authorise this commit (once)", "Cancel"],
      );

      if (tokenChoice === "Authorise this commit (once)") {
        await appendLog(logPath, level, "token-consumed", patternSource, command);
        return undefined;
      }

      await appendLog(logPath, level, "token-missing", patternSource, command);
      return { block: true, reason: noToken };
    }

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

    // No escalation option. It used to offer "Consult oracle-deep first", and
    // `oracle-deep` was removed with the planner/oracle roles: the dialog named
    // an agent the `task` tool would refuse, and the block message instructed
    // the model to invoke it. A HIGH command confirms or cancels. The advisor
    // is not a substitute — it takes a durable-boundary fork in the free
    // regime, not a destructive shell command.
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
