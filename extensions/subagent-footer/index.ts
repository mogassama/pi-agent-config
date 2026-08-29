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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
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
  // A root with branches: the orchestrator decides who speaks and when, and
  // line 1 was the only one opening on bare text.
  orchestrator: "\uf0e8", //  fa-sitemap
  // The brain belongs next to the reasoning level, not next to the role name.
  // Font Awesome rather than Material: same range as the microchip beside it,
  // and a BMP codepoint, so no surrogate pair. This replaces md-spa — a plant —
  // which sat here labelled "brain". Codepoints verified against glyphnames.json
  // in the Nerd Fonts repository, which is what a cheat-sheet label is worth.
  think: "\uee9c", //  fa-brain
  folder: "\uf07b", //  folder
  branch: "\ue725", //  git branch
  context: "\uf1c0", //  database
  turn: "\uf021", //  refresh
  cost: "\uf155", //  dollar
  cache: "\uf0e7", //  bolt
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

/**
 * Two levels of separation, so the eye can tell them apart.
 * A dot joins fields inside one cell; a bar divides one agent from the next.
 */
const SEP = " \u00b7 ";
const CELL_SEP = "   \u2502   ";

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

/**
 * Working-tree status.
 *
 * `getGitBranch()` gives the branch and nothing else, so this shells out. A
 * render happens far too often to spawn a process each time: the result is
 * cached for two seconds, which is well under the time it takes to notice a
 * file changed and long enough that scrolling costs nothing.
 */
interface GitStatus {
  staged: number;
  modified: number;
  untracked: number;
  conflicts: number;
  ahead: number;
  behind: number;
}

function makeGitCache() {
  let cached: GitStatus | undefined;
  let at = 0;
  return (): GitStatus | undefined => {
    if (Date.now() - at < 2000) return cached;
    at = Date.now();
    try {
      // --untracked-files=all, or git collapses an untracked directory into a
      // single entry and the count disagrees with every other tool on screen.
      const out = execFileSync("git", ["status", "--porcelain=v1", "--branch", "--untracked-files=all"], {
        encoding: "utf-8",
        timeout: 1500,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const st: GitStatus = { staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 };
      for (const line of out.split("\n")) {
        if (line.startsWith("##")) {
          st.ahead = Number(/ahead (\d+)/.exec(line)?.[1] ?? 0);
          st.behind = Number(/behind (\d+)/.exec(line)?.[1] ?? 0);
          continue;
        }
        if (!line) continue;
        const xy = line.slice(0, 2);
        if (xy === "??") st.untracked++;
        // Both sides marked, or D/A on either: an unresolved merge.
        else if (/^(DD|AU|UD|UA|DU|AA|UU)$/.test(xy)) st.conflicts++;
        else {
          if (xy[0] !== " ") st.staged++;
          if (xy[1] !== " ") st.modified++;
        }
      }
      cached = st;
    } catch {
      cached = undefined; // not a repo, or git unavailable
    }
    return cached;
  };
}

/**
 * Context fill, coloured on the thinking ramp.
 *
 * The thinking tokens are the only ramp the theme schema defines, and their
 * documented purpose is "visual hierarchy from subtle to prominent" — which is
 * what a gauge needs. Reusing them couples this to the ramp being an actual
 * ramp in whatever theme is active; a theme that assigns them arbitrarily will
 * make this look arbitrary too.
 */
const CONTEXT_RAMP: Array<[number, string]> = [
  // Green first, deliberately: it means "nothing to worry about" everywhere
  // else in the interface, and there is no reason to spend it elsewhere here.
  [0.2, "success"],
  [0.4, "thinkingLow"],
  [0.6, "thinkingMedium"],
  [0.75, "thinkingHigh"],
  [ALERT, "thinkingXhigh"],
  [1, "thinkingMax"],
];

function contextRole(ratio: number): string {
  for (const [max, role] of CONTEXT_RAMP) if (ratio < max) return role;
  return "thinkingMax";
}

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
  const readGit = makeGitCache();
  let installed = false;

  /**
   * Installed at session_start, not behind a command.
   *
   * `setFooter` replaces the built-in footer outright, so installing here also
   * removes the need to disable anything: whatever pi would have drawn never
   * appears. The command below only exists to get back to the built-in one.
   */
  pi.on("session_start", async (_event, ctx) => {
    install(ctx);
  });

  pi.registerCommand("footer", {
    description: "Toggle between the subagent footer and pi's built-in one",
    handler: async (_args, ctx) => {
      if (installed) {
        ctx.ui.setFooter(undefined);
        installed = false;
        ctx.ui.notify("Built-in footer restored", "info");
      } else {
        install(ctx);
        ctx.ui.notify("Subagent footer enabled", "info");
      }
    },
  });

  function install(ctx: any) {
    installed = true;
    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
        const unsub = footerData.onBranchChange(() => tui.requestRender());
        // Repaint on a timer only while something is running: the spinner and
        // the elapsed counter are the only things that move on their own.
        const tick = setInterval(() => {
          const st = parse(footerData.getExtensionStatuses?.().get(STATUS_KEY));
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
            //
            // getContextUsage() rather than a hand-rolled sum over entries:
            // pi already takes the last assistant usage and estimates the
            // trailing messages. Summing every turn's input would count each
            // re-read of the same prompt and report a context that never existed.
            const usage = ctx.getContextUsage?.();
            const context = usage?.tokens ?? 0;
            const windowSize = usage?.contextWindow ?? 0;
            const ratio = usage?.percent != null ? usage.percent / 100 : 0;
            const stats = ctx.getSessionStats?.();
            const turns = stats?.assistantMessages ?? 0;

            // Hit rate over what was read: cacheRead / (input + cacheRead).
            // cacheWrite stays out of the denominator — writing to the cache is
            // an investment, not a missed read, and counting it would make the
            // first turn of every session look like a failure.
            const cacheRead = stats?.tokens?.cacheRead ?? 0;
            const cacheWrite = stats?.tokens?.cacheWrite ?? 0;
            const readTotal = cacheRead + (stats?.tokens?.input ?? 0);
            const hit = readTotal > 0 ? cacheRead / readTotal : 0;

            const model = ctx.model;
            const ctxRole = contextRole(ratio);
            // tokens is null right after compaction, before the next response.
            const ctxText =
              usage?.tokens == null
                ? "—"
                : `${fmtTokens(context)}/${fmtTokens(windowSize)} (${(ratio * 100).toFixed(1)}%)`;

            const think = THINK_SHORT[ctx.thinkingLevel ?? ""] ?? ctx.thinkingLevel ?? "";
            const left = [
              // Icon then name, the same shape every subagent line uses.
              accent(ICON.orchestrator) + " " + accent("orchestrator"),
              dim(ICON.model) + " " + muted(shortModel(model?.id)),
              dim(ICON.think) + " " + muted(think),
              dim(ICON.context) + " " + theme.fg(ctxRole, ctxText),
              dim(ICON.turn) + " " + dim(String(turns)),
              cacheRead || cacheWrite
                ? dim(ICON.cache) +
                  " " +
                  muted(fmtTokens(cacheRead)) +
                  dim(` ${(hit * 100).toFixed(0)}%`)
                : "",
            ]
              .filter(Boolean)
              .join(dim(SEP));

            // Basename only: the full path belongs in the shell prompt, and it
            // is the one segment that would push everything else off a narrow
            // terminal.
            const cwd = basename(process.cwd());
            const branch = footerData.getGitBranch();
            const git = readGit();

            // Colour by the worst state present, so the branch itself carries
            // the signal — a count nobody reads is a count nobody acts on.
            // Five states, most severe first. Untracked files share the
            // "uncommitted" state rather than getting one of their own — but
            // they still count: a ✓ next to "?2" would be a lie.
            let gitRole = "success";
            let marks = "";
            if (git) {
              if (git.conflicts) gitRole = "error";
              else if (git.behind) gitRole = "thinkingXhigh";
              else if (git.modified || git.untracked) gitRole = "warning";
              else if (git.staged) gitRole = "accent";

              marks = [
                git.conflicts ? `!!${git.conflicts}` : "",
                git.staged ? `+${git.staged}` : "",
                git.modified ? `!${git.modified}` : "",
                git.untracked ? `?${git.untracked}` : "",
                git.ahead ? `\u2191${git.ahead}` : "",
                git.behind ? `\u2193${git.behind}` : "",
              ]
                .filter(Boolean)
                .join(" ");
            }

            const right = [
              dim(ICON.folder) + " " + accent(cwd),
              branch
                ? theme.fg(gitRole, ICON.branch + " " + branch) +
                  (marks ? " " + theme.fg(gitRole, marks) : "") +
                  (git && !marks ? " " + theme.fg("success", "\u2713") : "")
                : "",
            ]
              .filter(Boolean)
              .join(dim(SEP));
            const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
            const lines = [truncateToWidth(left + pad + right, width)];

            // ---- lines 2 and 3: the subagents, hidden until one has run
            // A ReadonlyMap, not a plain record — indexing it silently yields
            // undefined, and lines 2 and 3 never appear.
            const state = parse(footerData.getExtensionStatuses?.().get(STATUS_KEY));
            const anything = Object.values(state).some((r) => r && (r.runs > 0 || r.running));
            if (!anything) return lines;

            const agents = readAgents();
            const frame = SPINNER[Math.floor(Date.now() / 120) % SPINNER.length];

            for (const row of ROWS) {
              const cells = row.map((role) =>
                renderRole(role, state[role], agents.get(role), { theme, dim, muted, accent, frame }),
              );
              lines.push(truncateToWidth(cells.join(dim(CELL_SEP)), width));
            }
            return lines;
          },
        };
    });
  }
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
      p.dim(ICON.model) + " " + p.muted(shortModel(r.model)) + think,
      p.dim(ICON.turn) + " " + p.theme.fg("accent", `${r.turns}/${r.maxTurns}`),
      p.dim(fmtElapsed(r.startedAt)),
    ].join(p.dim(SEP));
    return `${BOLD}${body}${RESET}`;
  }

  if (!st || st.runs === 0) {
    return [
      p.dim(icon) + " " + p.dim(role),
      p.dim(ICON.model) + " " + p.dim(declared),
    ].join(p.dim(SEP));
  }

  const usedModel = shortModel(st.lastModel);
  // Name the model only when a fallback replaced the declared one — silence
  // means the definition is what ran.
  const modelCell =
    p.dim(ICON.model) +
    " " +
    (usedModel === declared
      ? p.muted(declared) + think
      : p.theme.fg("warning", `\u2192${usedModel}`));

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
      p.dim(ICON.context) + " " + p.dim(fmtTokens(st.tokens)),
      // Only when the provider reports caching at all — a flat 0 next to a
      // bolt says "no cache", when it means "no figure".
      st.cacheRead ? p.dim(ICON.cache) + " " + p.muted(fmtTokens(st.cacheRead)) : "",
      cost,
    ]
      .filter(Boolean)
      .join(p.dim(SEP)) + outcome
  );
}

function outcomeRole(outcome: string): string {
  if (outcome === "approved" || outcome === "ok") return "success";
  if (outcome === "blocked" || outcome === "failed") return "error";
  return "warning";
}
