/**
 * pi-bq-cost-sentinel — BigQuery dry-run cost gate.
 *
 * Two entry points:
 *
 *   A. Automatic (tool_call hook) — every `bq query` issued through the `bash`
 *      tool is dry-run first. Nobody has to ask for it, and it fires inside
 *      subagents too (they run headless, hasUI === false).
 *   B. Manual (/bq-cost) — unchanged, for reviewing a .sql file on demand.
 *
 * Registers /bq-cost to:
 *   1. Locate a .sql file in cwd (or prompt user to paste a query).
 *   2. Run `bq query --dry_run` and capture estimated bytes scanned.
 *   3. Apply three-tier thresholds (green / yellow / red).
 *   4. Forward the dry-run result to the agent with the bigquery-engineering skill.
 *
 * Thresholds (from bigquery-engineering skill):
 *   <1 GB    → green  — proceed
 *   1 GB–1 TB → yellow — warn
 *   >1 TB    → red    — mandatory review if expected rows <10K (skill condition; row count unverifiable at dry-run)
 *
 * Requirements: `bq` CLI in PATH, ADC configured (`gcloud auth application-default login`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

// ---------------------------------------------------------------------------
// Byte thresholds
// ---------------------------------------------------------------------------

const ONE_GB = 1_073_741_824;    // 1024^3
const ONE_TB = 1_099_511_627_776; // 1024^4

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the estimated byte count from `bq query --dry_run` output.
 *
 * bq writes to stderr. Formats observed:
 *   "running this query will process 0 B of data."
 *   "running this query will process 1.34 GB of data."
 *   "running this query will process 2.1 TB of data."
 */
function parseBytes(output: string): number | null {
  const match = output.match(/process\s+([\d.]+)\s+(B|KB|MB|GB|TB)\s+of\s+data/i);
  if (!match) return null;

  const value = parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1_024,
    MB: 1_048_576,
    GB: 1_073_741_824,
    TB: 1_099_511_627_776,
  };

  return value * (multipliers[unit] ?? 1);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(2)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes < 1_099_511_627_776) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  return `${(bytes / 1_099_511_627_776).toFixed(2)} TB`;
}

/** On-demand pricing: $6.25 per TB. */
function estimateCostUsd(bytes: number): string {
  const tb = bytes / 1_099_511_627_776;
  const cost = tb * 6.25;
  if (cost < 0.0001) return "<$0.0001";
  return `$${cost.toFixed(4)}`;
}

/** True when the dry-run output suggests an authentication/ADC failure. */
function isAuthError(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("not authenticated") ||
    lower.includes("invalid credentials") ||
    lower.includes("application default credentials") ||
    lower.includes("could not be determined") ||
    lower.includes("login required") ||
    lower.includes("unauthenticated")
  );
}

/** Build the agent message following the spec. */
function buildAgentMessage(
  query: string,
  source: string,
  dryRunOutput: string,
  bytes: number | null,
  costUsd: string | null,
): string {
  const bytesSummary =
    bytes !== null
      ? `Estimated bytes: ${formatBytes(bytes)}. Estimated cost: ${costUsd} USD.`
      : "Estimated bytes: unknown (dry-run returned no byte estimate — possible SQL error).";

  return [
    "Analyze this BigQuery dry-run result using the bigquery-engineering skill.",
    bytesSummary,
    bytes !== null && bytes >= 1_099_511_627_776
      ? "This query scans >1 TB. Per the bigquery-engineering skill, mandatory review is required when >1 TB AND expected rows <10K. The dry-run cannot determine row count — assess whether the expected result set is small (<10K rows) to decide if a blocking review is needed."
      : "Flag any anti-patterns in the query and suggest optimizations if cost is high.",
    `Source: ${source}`,
    "",
    `<query>${query}</query>`,
    `<dry_run_output>${dryRunOutput}</dry_run_output>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Automatic gate — settings
// ---------------------------------------------------------------------------

interface BqCostSentinelSettings {
  /** Set false to disable the automatic tool_call gate. Default: true. */
  autoGate?: boolean;
  /** Dry-run timeout in ms. Default: 60000. */
  autoGateTimeoutMs?: number;
}

function loadSettings(): BqCostSentinelSettings {
  try {
    const raw = readFileSync(join(getAgentDir(), "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (parsed["bqCostSentinel"] as BqCostSentinelSettings) ?? {};
  } catch {
    return {};
  }
}

/**
 * Matches `bq query`, including global flags between the two words
 * (`bq --project_id=x query`, `bq --location=EU query`).
 */
const BQ_QUERY_RE = /\bbq\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*query\b/i;

/** Already a dry-run, or explicitly opted out — nothing to gate. */
const ALREADY_DRY_RE = /--dry[_-]run/i;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  const settings = loadSettings();

  // -----------------------------------------------------------------------
  // A. Automatic gate
  // -----------------------------------------------------------------------

  if (settings.autoGate !== false) {
    pi.on("tool_call", async (event, ctx) => {
      if (!isToolCallEventType("bash", event)) return undefined;

      const command = event.input.command;
      if (!BQ_QUERY_RE.test(command) || ALREADY_DRY_RE.test(command)) return undefined;

      // Rewrite rather than parse: reusing the caller's own flags and quoting
      // is far more reliable than trying to extract the SQL out of a shell line.
      //
      // Caveat: if the query is piped in from a generator (`python gen.py | bq
      // query`), that generator runs twice — once here, once for real.
      const dryRunCommand = command.replace(BQ_QUERY_RE, (m) => `${m} --dry_run`);

      let output: string;
      try {
        const result = await pi.exec("bash", ["-lc", dryRunCommand], {
          timeout: settings.autoGateTimeoutMs ?? 60_000,
          signal: ctx.signal,
        });
        output = ((result.stderr || "") + (result.stdout || "")).trim();
      } catch {
        // The gate is not the job. If the dry-run itself cannot run, say so and
        // let the real command proceed — failing closed here would break every
        // bq call on a machine without ADC.
        if (ctx.hasUI) ctx.ui.notify("bq dry-run unavailable — query not gated", "warning");
        return undefined;
      }

      if (isAuthError(output)) {
        if (ctx.hasUI) ctx.ui.notify("bq dry-run unavailable (ADC/PATH) — query not gated", "warning");
        return undefined;
      }

      const bytes = parseBytes(output);
      if (bytes === null) {
        // No byte estimate: usually a SQL error. The real command will surface it.
        return undefined;
      }

      const size = `${formatBytes(bytes)} / ${estimateCostUsd(bytes)}`;

      if (bytes < ONE_GB) {
        if (ctx.hasUI) ctx.ui.notify(`\u{1F7E2} bq query — ${size}`, "info");
        return undefined;
      }

      if (bytes < ONE_TB) {
        if (ctx.hasUI) ctx.ui.notify(`\u{1F7E1} bq query — ${size} (>1 GB)`, "warning");
        return undefined;
      }

      // >1 TB — the only blocking tier.
      const reason =
        `blocked by bq-cost-sentinel: this query scans ${size}, above the 1 TB threshold.\n` +
        `Report the estimate to the operator and justify the scan, or add a partition ` +
        `filter and retry. Do not re-issue the same query to bypass this gate.`;

      if (!ctx.hasUI) return { block: true, reason };

      const choice = await ctx.ui.select(
        `\u{1F534} bq query scans ${size} (>1 TB)\n\n${command.slice(0, 500)}`,
        ["Run anyway", "Cancel"],
      );
      if (choice === "Run anyway") return undefined;
      return { block: true, reason };
    });
  }

  // -----------------------------------------------------------------------
  // B. Manual command — unchanged
  // -----------------------------------------------------------------------

  pi.registerCommand("bq-cost", {
    description:
      "BigQuery dry-run cost estimate — uses the .sql file in cwd or prompts to paste a query",

    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        // Non-interactive mode: nothing useful to do without a UI
        return;
      }

      // ------------------------------------------------------------------
      // 1. Resolve query source
      // ------------------------------------------------------------------

      let queryContent: string;
      let querySource: string;

      // Discover .sql files in cwd
      let sqlFiles: string[] = [];
      try {
        const entries = readdirSync(ctx.cwd);
        sqlFiles = entries
          .filter((f) => f.endsWith(".sql"))
          .map((f) => join(ctx.cwd, f))
          .filter((f) => {
            try {
              return statSync(f).isFile();
            } catch {
              return false;
            }
          });
      } catch {
        // cwd unreadable — fall through to prompt
      }

      if (sqlFiles.length === 1) {
        // Exactly one .sql file — use it without asking
        const filePath = sqlFiles[0]!;
        try {
          queryContent = readFileSync(filePath, "utf-8").trim();
          querySource = filePath;
          ctx.ui.notify(`Using: ${basename(filePath)}`, "info");
        } catch {
          ctx.ui.notify(`Cannot read ${basename(filePath)}`, "error");
          return;
        }
      } else if (sqlFiles.length > 1) {
        // Multiple .sql files — let user choose
        const choice = await ctx.ui.select(
          "Multiple .sql files found — choose one:",
          sqlFiles.map((f) => basename(f)),
        );
        if (!choice) return; // user cancelled

        const fullPath = join(ctx.cwd, choice);
        try {
          queryContent = readFileSync(fullPath, "utf-8").trim();
          querySource = fullPath;
        } catch {
          ctx.ui.notify(`Cannot read ${choice}`, "error");
          return;
        }
      } else {
        // No .sql files in cwd — prompt user to paste the query
        const pasted = await ctx.ui.input(
          "No .sql file in cwd. Paste BigQuery SQL to dry-run:",
          "SELECT ...",
        );
        if (!pasted?.trim()) {
          ctx.ui.notify("No query provided — aborted", "warning");
          return;
        }
        queryContent = pasted.trim();
        querySource = "(pasted inline)";
      }

      if (!queryContent) {
        ctx.ui.notify("Query is empty — aborted", "warning");
        return;
      }

      // ------------------------------------------------------------------
      // 2. Run bq dry-run
      // ------------------------------------------------------------------

      ctx.ui.notify("Running bq dry-run…", "info");

      let dryRunOutput: string;
      let exitCode: number;

      try {
        const result = await pi.exec(
          "bq",
          ["query", "--dry_run", "--use_legacy_sql=false", queryContent],
          { timeout: 30_000 },
        );

        // bq writes the dry-run result to stderr; stdout is typically empty
        dryRunOutput = ((result.stderr || "") + (result.stdout || "")).trim();
        exitCode = result.code ?? 1;
      } catch (err: unknown) {
        // ENOENT → bq not in PATH; other errors propagated as-is
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT") || message.includes("not found")) {
          ctx.ui.notify("bq CLI not available — check ADC and PATH", "error");
        } else {
          ctx.ui.notify(`bq exec failed: ${message}`, "error");
        }
        return;
      }

      // ADC / auth failures are in the stderr text even when exit code = 1
      if (isAuthError(dryRunOutput)) {
        ctx.ui.notify("bq CLI not available — check ADC and PATH", "error");
        return;
      }

      // Unexpected empty output with non-zero exit: likely bq not configured
      if (!dryRunOutput && exitCode !== 0) {
        ctx.ui.notify("bq CLI not available — check ADC and PATH", "error");
        return;
      }

      // ------------------------------------------------------------------
      // 3. Parse bytes
      // ------------------------------------------------------------------

      const bytes = parseBytes(dryRunOutput);

      // ------------------------------------------------------------------
      // 4. Apply thresholds — UI notification before forwarding to agent
      // ------------------------------------------------------------------

      if (bytes === null) {
        // Dry-run returned no byte count — likely a syntax/validation error
        ctx.ui.notify(
          "Could not parse bytes from dry-run output — forwarding to agent for analysis",
          "warning",
        );
      } else if (bytes >= ONE_TB) {
        ctx.ui.notify(
          `🔴 >1 TB scanned (${formatBytes(bytes)}, ${estimateCostUsd(bytes)}) — mandatory review if expected rows <10K (dry-run cannot verify row count)`,
          "error",
        );
      } else if (bytes >= ONE_GB) {
        ctx.ui.notify(
          `🟡 WARNING — ${formatBytes(bytes)} scanned (${estimateCostUsd(bytes)}) — between 1 GB and 1 TB`,
          "warning",
        );
      } else {
        ctx.ui.notify(
          `🟢 OK — ${formatBytes(bytes)} scanned (${estimateCostUsd(bytes)}) — below 1 GB`,
          "info",
        );
      }

      // ------------------------------------------------------------------
      // 5. Forward to agent
      // ------------------------------------------------------------------

      const costUsd = bytes !== null ? estimateCostUsd(bytes) : null;
      pi.sendUserMessage(
        buildAgentMessage(queryContent, querySource, dryRunOutput, bytes, costUsd),
      );
    },
  });
}
