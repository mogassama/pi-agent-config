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

import { existsSync } from "node:fs";
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
function resolveExtension(name: string, ctx: BuildContext): string {
  const candidates =
    name === "envelope"
      ? [join(ctx.selfDir, "envelope", "envelope.ts"), join(ctx.selfDir, "envelope.ts")]
      : [join(ctx.agentDir, "extensions", name, "index.ts")];

  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(
    `extension "${name}" not found. Looked in: ${candidates.join(", ")}. ` +
      `npm-sourced extensions are unreachable from a child: they come through ` +
      `discovery, which -ne disables.`,
  );
}

function resolveSkill(name: string, ctx: BuildContext): string {
  const p = join(ctx.agentDir, "skills", name, "SKILL.md");
  if (!existsSync(p)) throw new Error(`skill "${name}" not found at ${p}`);
  return p;
}

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

  for (const ext of agent.extensions) args.push("-e", resolveExtension(ext, ctx));

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

  for (const skill of agent.skills) {
    const slice = sliceSkillFile(resolveSkill(skill, ctx), agent.sliceMode);
    if (!slice.text) continue;
    injectedChars += slice.text.length;
    args.push("--append-system-prompt", slice.text);
  }

  args.push(`Task: ${task}`);

  return {
    args,
    env: { PI_SUBAGENT_ROLE: agent.name },
    injectedChars,
    estimatedInputTokens: Math.round((injectedChars / 4) * 0.82),
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
