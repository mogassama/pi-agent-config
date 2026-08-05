/**
 * pi-footer — three lines: the orchestrator, then its subagents.
 *
 * Colours go through theme roles (`theme.fg("accent", …)`), never hex: the
 * palette belongs to the theme, so a tokyonight theme colours this footer and
 * everything else at once, and the footer stays correct if the theme changes.
 * Bold is an ANSI sequence, independent of the theme, applied on top.
 *
 * Lines 2 and 3 stay hidden until the session's first delegation — four dashes
 * are two terminal lines spent saying nothing happened.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { loadAgents, type AgentDefinition } from "../../subagent-only/agents.js";
import { parse, STATUS_KEY, type RoleName, type RoleState } from "../../subagent-only/run-state.js";

const AGENT_DIR = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const AGENTS_DIR = join(AGENT_DIR, "subagent-only", "agents");

/** Fixed order. Line 2 writes and judges, line 3 only reads — the grouping is the point. */
const ROWS: RoleName[][] = [
  ["worker", "reviewer"],
  ["scout", "advisor"],
];

const BOLD = "\x1b[1m";
const RESET = "\x1b[22m";

/**
 * Nerd Font glyphs. Kept to the Font Awesome and Material ranges, which are
 * present in every Nerd Font build — an icon that renders as a box is worse
 * than no icon.
 */
const ICON = {
  model: "\uf2db", //  microchip
  think: "\udb83\udcd1", // 󰧑 brain
  folder: "\uf07b", //  folder
  branch: "\ue725", //  git branch
  context: "\uf1c0", //  database
  turn: "\uf021", //  refresh
  cost: "\uf155", //  dollar
  worker: "\uf0ad", //  wrench
  reviewer: "\uf06e", //  eye
  scout: "\uf002", //  magnifier
  advisor: "\uf0eb", //  lightbulb
} as const;

const ROLE_ICON: Record<RoleName, string> = {
  worker: ICON.worker,
  reviewer: ICON.reviewer,
  scout: ICON.scout,
  advisor: ICON.advisor,
};

/** One separator everywhere: a mid-height dot, dimmed. */
const SEP = " \u00b7 ";

/** Context fill above which the reading stops being reassuring. */
const ALERT = 0.85;

// ------------------------------------------------------------------ helpers

/**
 * `claude-sonnet-5` -> `sonnet-5`, `gemini-3.1-pro-preview` -> `gemini-3.1-pro`.
 * Mechanical: drop the provider prefix, the vendor prefix and a `-preview`
 * suffix. A lookup table would be one more thing to keep in step with reality.
 */
function shortModel(id: string | undefined): string {
  if (!id) return "?";
  let s = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  s = s.replace(/^claude-/, "").replace(/-preview$/, "");
  return s;
}

const THINK_SHORT: Record<string, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhi",
  max: "max",
};

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtElapsed(sinceMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - sinceMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

/** Agent definitions, re-read when a file changes: editing reviewer.md is visible without a restart. */
function makeAgentCache() {
  let agents = new Map<string, AgentDefinition>();
  let stamp = 0;
  return () => {
    try {
      if (!existsSync(AGENTS_DIR)) return agents;
      const m = statSync(AGENTS_DIR).mtimeMs;
      if (m !== stamp) {
        agents = loadAgents(AGENTS_DIR);
        stamp = m;
      }
    } catch {
      // A malformed definition must not take the footer down with it.
    }
    return agents;
  };
}

// -------------------------------------------------------------------- entry

export default function (pi: ExtensionAPI) {
  const readAgents = makeAgentCache();

  pi.registerCommand("footer", {
    description: "Toggle the subagent footer",
    handler: async (_args, ctx) => {
      ctx.ui.setFooter((tui, theme, footerData) => {
        const unsub = footerData.onBranchChange(() => tui.requestRender());
        // Repaint on a timer only while something is running: the spinner and
        // the elapsed counter are the only things that move on their own.
        const tick = setInterval(() => {
          const st = parse(footerData.getExtensionStatuses?.()?.[STATUS_KEY]);
          if (Object.values(st).some((r) => r?.running)) tui.requestRender();
        }, 1000);

        const dim = (s: string) => theme.fg("dim", s);
        const muted = (s: string) => theme.fg("muted", s);
        const accent = (s: string) => theme.fg("accent", s);

        return {
          dispose() {
            clearInterval(tick);
            unsub();
          },
          invalidate() {},

          render(width: number): string[] {
            // ---- line 1: the orchestrator
            let context = 0;
            for (const e of ctx.sessionManager.getBranch()) {
              if (e.type === "message" && e.message.role === "assistant") {
                const m = e.message as AssistantMessage;
                // The last assistant turn's input is the live context, not the
                // sum: summing counts every turn's re-read of the same prompt.
                context = (m.usage.input ?? 0) + (m.usage.cacheRead ?? 0);
              }
            }
            const turns = ctx.sessionManager
              .getBranch()
              .filter((e) => e.type === "message" && e.message.role === "assistant").length;

            const model = ctx.model;
            const windowSize = (model as { contextWindow?: number } | undefined)?.contextWindow ?? 0;
            const ratio = windowSize ? context / windowSize : 0;
            const ctxRole = ratio >= 0.94 ? "error" : ratio >= ALERT ? "warning" : "success";
            const ctxText = windowSize
              ? `${fmtTokens(context)}/${fmtTokens(windowSize)} (${(ratio * 100).toFixed(1)}%)`
              : fmtTokens(context);

            const think = THINK_SHORT[ctx.thinkingLevel ?? ""] ?? ctx.thinkingLevel ?? "";
            const left = [
              accent("orchestrator"),
              dim(ICON.model) + " " + muted(shortModel(model?.id)),
              dim(ICON.think) + " " + muted(think),
              dim(ICON.context) + " " + theme.fg(ctxRole, ctxText),
              dim(ICON.turn) + " " + dim(String(turns)),
            ].join(dim(SEP));

            // Basename only: the full path belongs in the shell prompt, and it
            // is the one segment that would push everything else off a narrow
            // terminal.
            const cwd = basename(process.cwd());
            const branch = footerData.getGitBranch();
            const right = [
              dim(ICON.folder) + " " + accent(cwd),
              branch ? dim(ICON.branch) + " " + accent(branch) : "",
            ]
              .filter(Boolean)
              .join(dim(SEP));
            const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
            const lines = [truncateToWidth(left + pad + right, width)];

            // ---- lines 2 and 3: the subagents, hidden until one has run
            const state = parse(footerData.getExtensionStatuses?.()?.[STATUS_KEY]);
            const anything = Object.values(state).some((r) => r && (r.runs > 0 || r.running));
            if (!anything) return lines;

            const agents = readAgents();
            const frame = SPINNER[Math.floor(Date.now() / 120) % SPINNER.length];

            for (const row of ROWS) {
              const cells = row.map((role) =>
                renderRole(role, state[role], agents.get(role), { theme, dim, muted, accent, frame }),
              );
              lines.push(truncateToWidth(cells.join(dim(SEP + "  ")), width));
            }
            return lines;
          },
        };
      });
      ctx.ui.notify("Subagent footer enabled", "info");
    },
  });
}

// ------------------------------------------------------------------ a cell

interface Paint {
  theme: { fg(role: string, s: string): string };
  dim(s: string): string;
  muted(s: string): string;
  accent(s: string): string;
  frame: string;
}

/**
 * One role.
 *
 * Running: spinner, turns against the ceiling, elapsed, bold. Idle with
 * history: run count, tokens, cost or ∅, and the last outcome coloured by what
 * it was. Never run: the declared model, dimmed — so the line still tells you
 * which model is wired to which role before anything has happened.
 */
function renderRole(
  role: RoleName,
  st: RoleState | undefined,
  agent: AgentDefinition | undefined,
  p: Paint,
): string {
  const declared = shortModel(agent?.model);
  const think = agent?.thinking ? p.dim(`:${THINK_SHORT[agent.thinking] ?? agent.thinking}`) : "";

  const icon = ROLE_ICON[role];

  if (st?.running) {
    const r = st.running;
    const body = [
      `${p.accent(p.frame)} ${p.accent(role)}`,
      p.muted(shortModel(r.model)) + think,
      p.theme.fg("accent", `${r.turns}/${r.maxTurns}`),
      p.dim(fmtElapsed(r.startedAt)),
    ].join(p.dim(SEP));
    return `${BOLD}${body}${RESET}`;
  }

  if (!st || st.runs === 0) {
    return [p.dim(icon) + " " + p.dim(role), p.dim(declared)].join(p.dim(SEP));
  }

  const usedModel = shortModel(st.lastModel);
  // Name the model only when a fallback replaced the declared one — silence
  // means the definition is what ran.
  const modelCell =
    usedModel === declared ? p.muted(declared) + think : p.theme.fg("warning", `\u2192${usedModel}`);

  const cost = st.billed
    ? p.dim(ICON.cost) + p.theme.fg("warning", `~${st.cost.toFixed(2)}`)
    : p.dim(ICON.cost) + p.dim("\u2205");
  const outcome = st.lastOutcome
    ? p.dim(SEP) + p.theme.fg(outcomeRole(st.lastOutcome), st.lastOutcome)
    : "";

  return (
    [
      p.accent(icon) + " " + p.accent(role) + p.dim(`\u00d7${st.runs}`),
      modelCell,
      p.dim(fmtTokens(st.tokens)),
      cost,
    ].join(p.dim(SEP)) + outcome
  );
}

function outcomeRole(outcome: string): string {
  if (outcome === "approved" || outcome === "ok") return "success";
  if (outcome === "blocked" || outcome === "failed") return "error";
  return "warning";
}
