/**
 * Command line construction — turns an AgentDefinition plus a task into argv.
 *
 * Every flag here was read in the source of @earendil-works/pi-coding-agent
 * 0.83.0 rather than taken from the help text:
 *
 *   --tools               strict allowlist over built-in AND extension tool
 *                         definitions       core/agent-session.js:1943-1960
 *   --no-skills, -ns      kills discovery; explicit paths survive
 *                                           core/resource-loader.js:329-331
 *   --no-extensions, -ne  kills discovery; explicit -e survives
 *   --append-system-prompt  text OR file contents — existsSync decides
 *                                           core/resource-loader.js:16-28
 *   --session-id          combinable with --no-session since 0.80.3
 *
 * One consequence worth naming: passing --append-system-prompt at all
 * suppresses APPEND_SYSTEM.md discovery (resource-loader.js:385-389). Every
 * role passes at least its own prompt, so APPEND_SYSTEM.md never reaches a
 * child. That is intended — the role prompt is the child's whole instruction.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition } from "./agents.js";
import { sliceSkillFile } from "./slicer.js";

export interface BuildContext {
  /** ~/.pi/agent */
  agentDir: string;
  /** Where this extension lives, e.g. <agentDir>/subagent-only */
  selfDir: string;
  /** Born when the orchestrator opens a task, dies with it. */
  runId: string;
}

export interface SpawnPlan {
  args: string[];
  env: Record<string, string>;
  /** Sum of the injected prompt slices, for logging and for the cost gate. */
  injectedChars: number;
  estimatedInputTokens: number;
  /** Reviewer-mode skills injected without a `## Review delta`, if any. */
  withoutDelta: string[];
}

/**
 * Resolve an extension name to a loadable path.
 *
 * "envelope" is ours and lives beside this file. Everything else is a local
 * extension directory under <agentDir>/extensions/<name>/index.ts.
 *
 * npm-sourced extensions cannot be reached this way: they are declared in
 * settings.json `packages` and arrive through discovery, which -ne turns off.
 * That is not a limitation to work around — a child has no business loading
 * pi-subagents or the powerline footer.
 */
export function resolveExtension(name: string, ctx: BuildContext): string {
  const npmRoot = join(ctx.agentDir, "npm", "node_modules", name);
  const candidates =
    name === "envelope"
      ? [join(ctx.selfDir, "envelope", "envelope.ts"), join(ctx.selfDir, "envelope.ts")]
      : [
          join(ctx.agentDir, "extensions", name, "index.ts"),
          // npm-installed packages live on disk under <agentDir>/npm/node_modules
          // (core/package-manager.js:1677), so -e reaches them even though
          // discovery — which -ne disables — is how they normally load.
          join(npmRoot, "index.ts"),
          join(npmRoot, "src", "index.ts"),
          join(npmRoot, "dist", "index.js"),
        ];

  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`extension "${name}" not found. Looked in: ${candidates.join(", ")}`);
}

/**
 * A model's provider is an extension too.
 *
 * `claude-bridge/claude-sonnet-5` needs pi-claude-bridge loaded, or the child
 * reports the model as not found — measured on the first real delegation. The
 * provider is a dependency of the model, not a behavioural hook, so it is
 * derived from the model string rather than listed by hand: listing it is
 * something one forgets on every new role, and the failure only surfaces at
 * run time.
 *
 * Providers built into pi need nothing.
 */
const BUILTIN_PROVIDERS = new Set(["anthropic", "google", "openai", "openai-codex", "kimi-coding", "xai", "groq", "openrouter"]);

/**
 * Providers that need an extension loaded before their models exist.
 *
 * Empty as of 3 August 2026: claude-bridge was removed. It routed through
 * Claude Code, which passes the claude_code preset unconditionally
 * (pi-claude-bridge/src/index.ts:1249) — ~26k tokens of another agent's
 * behavioural instructions, in a child whose whole point is to receive only
 * what we hand it. The native anthropic provider costs ~0.11 $ per review and
 * gives the system prompt back.
 *
 * Kept as a mechanism: the next non-builtin provider will need it, and
 * deriving it from the model string is what stops it being forgotten.
 */
const PROVIDER_PACKAGE: Record<string, string> = {};

export function providerExtensionFor(model: string): string | null {
  const provider = model.includes("/") ? model.split("/")[0] : "";
  if (!provider || BUILTIN_PROVIDERS.has(provider)) return null;
  const pkg = PROVIDER_PACKAGE[provider];
  if (!pkg) {
    throw new Error(
      `model "${model}" uses provider "${provider}", which is neither built in nor ` +
        `a known extension package. Add it to PROVIDER_PACKAGE, or the child will ` +
        `report the model as not found.`,
    );
  }
  return pkg;
}

function resolveSkill(name: string, ctx: BuildContext): string {
  const p = join(ctx.agentDir, "skills", name, "SKILL.md");
  if (existsSync(p)) return p;
  // The orchestrator now chooses skills per call, so a wrong name is a runtime
  // possibility rather than a config error. Name the valid ones.
  let available = "";
  try {
    available = readdirSync(join(ctx.agentDir, "skills")).sort().join(", ");
  } catch {
    /* ignore */
  }
  throw new Error(`skill "${name}" not found.${available ? ` Available: ${available}` : ""}`);
}

/**
 * Appended to every task text, verbatim.
 *
 * A rule stated once in a role prompt and contradicted by the last line the
 * model reads is not a rule. This is the last line the model reads.
 */
const CLOSING_INSTRUCTION =
  "Return your result by calling the submit tool, exactly once, as your final action. " +
  "Do not answer in prose: an answer that is not a submit call is discarded, " +
  "whatever its quality. Every array field has a legal empty form — return [] " +
  "rather than omitting the field or inventing an entry.";

export function buildSpawnPlan(agent: AgentDefinition, task: string, ctx: BuildContext): SpawnPlan {
  const args: string[] = ["--mode", "json", "-p"];

  // Session regime. `ephemeral` keeps provider cache affinity without letting
  // history accumulate; `persistent` keeps continuity across steps of one task.
  args.push("--session-id", `${ctx.runId}-${agent.name}`);
  if (agent.session === "ephemeral") args.push("--no-session");

  args.push("--model", agent.model);
  if (agent.thinking) args.push("--thinking", agent.thinking);
  args.push("--tools", agent.tools.join(","));

  // Discovery off across the board. Anything the child gets, it gets by name.
  if (!agent.contextFiles) args.push("--no-context-files");
  args.push("--no-skills", "--no-extensions");

  // Provider first: without it the model does not exist and nothing else matters.
  const providerExt = providerExtensionFor(agent.model);
  const extensions = providerExt && !agent.extensions.includes(providerExt)
    ? [providerExt, ...agent.extensions]
    : agent.extensions;

  for (const ext of extensions) args.push("-e", resolveExtension(ext, ctx));

  // Role prompt first: it frames everything that follows, including the
  // instruction not to go hunting for configuration files that -nc removed.
  let injectedChars = agent.prompt.length;
  args.push("--append-system-prompt", agent.prompt);

  // Mechanism before domain: the reviewer must hold the severity definitions
  // before it meets a table that assigns against them.
  for (const skill of agent.mechanism) {
    const slice = sliceSkillFile(resolveSkill(skill, ctx), "authoring");
    if (!slice.text) continue;
    injectedChars += slice.text.length;
    args.push("--append-system-prompt", slice.text);
  }

  const withoutDelta: string[] = [];
  for (const skill of agent.skills) {
    const slice = sliceSkillFile(resolveSkill(skill, ctx), agent.sliceMode);
    if (!slice.text) continue;
    if (agent.sliceMode === "full" && !slice.hasDelta) withoutDelta.push(skill);
    injectedChars += slice.text.length;
    args.push("--append-system-prompt", slice.text);
  }

  // The closing instruction is appended here, not left to whoever composed the
  // task. Measured on the anime-etl corpus: the envelope appears in 5/5 runs
  // whose task text names it and 0/3 that only describe the deliverable. The
  // orchestrator writes "return findings, severity, verdict…" — a description
  // of the envelope's contents, never of the tool that carries it — and the
  // model answers in prose. One run cost 5102 output tokens that way.
  args.push(`Task: ${task}\n\n${CLOSING_INSTRUCTION}`);

  return {
    args,
    env: { PI_SUBAGENT_ROLE: agent.name },
    injectedChars,
    estimatedInputTokens: Math.round((injectedChars / 4) * 0.82),
    withoutDelta,
  };
}

/**
 * Human-readable form, for logs and for eyeballing a plan before it runs.
 * Long injected slices are elided: a 3000-character skill body in a log line
 * hides everything else.
 */
export function describePlan(plan: SpawnPlan): string {
  const out: string[] = [];
  for (let i = 0; i < plan.args.length; i++) {
    const a = plan.args[i];
    if (a === "--append-system-prompt") {
      const v = plan.args[++i];
      out.push(`${a} <${v.length} chars: ${v.slice(0, 48).replace(/\n/g, " ")}…>`);
    } else {
      out.push(a.length > 80 ? `<${a.length} chars>` : a);
    }
  }
  return out.join(" ");
}
