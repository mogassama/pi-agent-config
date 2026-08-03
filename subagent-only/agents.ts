/**
 * Agent definitions — extended schema.
 *
 * The official example (examples/extensions/subagent/agents.ts) parses four
 * fields: name, description, tools, model. Everything the design needs beyond
 * that is added here: per-role extension whitelist, skill slices, session
 * regime, turn ceiling, wall timeout, fallback models.
 *
 * Read from subagent-only/agents/, NOT ~/.pi/agent/agents/. That directory is
 * pi-subagents' convention and still holds live definitions; the two must not
 * collide while both primitives run. It moves at the switchover, not before.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { SliceMode } from "./slicer.js";

export interface AgentDefinition {
  name: string;
  description: string;

  /** Provider-qualified, e.g. "claude-bridge/claude-sonnet-5". */
  model: string;
  /** Tried in order when the primary model errors. Empty means fail immediately. */
  fallbackModels: string[];
  /** off | minimal | low | medium | high | max. Passed as --thinking. */
  thinking?: string;

  /**
   * Strict allowlist, passed as --tools. Filters built-in AND extension tool
   * definitions (core/agent-session.js:1943-1960), so the token cost of tools
   * the role does not use disappears with it.
   *
   * Must contain "submit": without it the role has no way to return an
   * envelope, and pi suppresses the skills section entirely when "read" is
   * absent (core/system-prompt.js:27-31).
   */
  tools: string[];

  /**
   * Hook whitelist, passed as -e. Discovery is always off (-ne), so a hook
   * reaches a child only if it is listed here. This is what makes
   * "does pi-bq-cost-sentinel cover subagents?" a fact rather than a guess.
   */
  extensions: string[];

  /**
   * Domain skills, resolved against skills/<name>/SKILL.md and sliced per
   * sliceMode: the worker gets authoring, the reviewer authoring + delta.
   */
  skills: string[];
  sliceMode: SliceMode;

  /**
   * Mechanism skills, injected whole and never sliced.
   *
   * `code-review` is the only one today. It carries no "## Review delta" and
   * never will — it is what the deltas are weighed against. Keeping it in a
   * separate field means the slicer can still throw on a domain skill whose
   * marker went missing, instead of being loosened into silence.
   */
  mechanism: string[];

  /** false passes --no-context-files: no AGENTS.md, no CLAUDE.md. */
  contextFiles: boolean;

  /**
   * ephemeral  -> --no-session --session-id <runId>-<role>
   *               cache affinity without history accumulation
   * persistent -> --session-id <runId>-<role>
   *               continuity across steps of one task
   * Both need pi >= 0.80.3 (changelog: deterministic session IDs for
   * provider cache affinity).
   */
  session: "ephemeral" | "persistent";

  /** Enforced by the dispatch loop. pi has no native turn cap — no flag, no option. */
  maxTurns: number;
  timeoutMs: number;

  /** The role prompt. Passed as --append-system-prompt, ahead of any skill slice. */
  prompt: string;
}

const DEFAULTS = {
  fallbackModels: [] as string[],
  extensions: ["envelope"],
  skills: [] as string[],
  mechanism: [] as string[],
  sliceMode: "none" as SliceMode,
  contextFiles: false,
  session: "ephemeral" as const,
  maxTurns: 12,
  timeoutMs: 300_000,
};

/**
 * Minimal frontmatter reader.
 *
 * Handles `key: value`, `key: [a, b]`, and block lists. Deliberately not a
 * general YAML parser: the accepted shapes are the ones documented above, and
 * anything else must fail rather than be guessed at. Silent tolerance of a
 * near-miss syntax is how the /check-config backtick trap happened.
 */
function parseFrontmatter(raw: string): { fields: Record<string, string | string[]>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("no YAML frontmatter");

  const fields: Record<string, string | string[]> = {};
  const lines = m[1].split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentKey) {
      (fields[currentKey] as string[]).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) {
      if (line.trim()) throw new Error(`unparseable frontmatter line: ${line}`);
      continue;
    }
    const [, key, rest] = kv;
    if (rest === "") {
      fields[key] = [];
      currentKey = key;
    } else if (rest.startsWith("[")) {
      fields[key] = rest
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      currentKey = null;
    } else {
      fields[key] = rest.trim();
      currentKey = null;
    }
  }
  return { fields, body: m[2].trim() };
}

function str(f: Record<string, string | string[]>, k: string): string | undefined {
  const v = f[k];
  return typeof v === "string" ? v : undefined;
}
function list(f: Record<string, string | string[]>, k: string): string[] | undefined {
  const v = f[k];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return undefined;
}

/** Every failure here is a configuration error, surfaced at load time rather than mid-task. */
export function parseAgent(raw: string, filePath: string): AgentDefinition {
  const label = basename(filePath);
  const { fields, body } = parseFrontmatter(raw);

  const name = str(fields, "name");
  const model = str(fields, "model");
  const tools = list(fields, "tools") ?? [];
  const skills = list(fields, "skills") ?? DEFAULTS.skills;
  const mechanism = list(fields, "mechanism") ?? DEFAULTS.mechanism;
  const sliceMode = (str(fields, "sliceMode") ?? DEFAULTS.sliceMode) as SliceMode;

  if (!name) throw new Error(`${label}: missing "name"`);
  if (name !== basename(filePath, ".md")) {
    throw new Error(`${label}: name "${name}" does not match the filename`);
  }
  if (!model) throw new Error(`${label}: missing "model"`);
  if (!body) throw new Error(`${label}: empty body — the role prompt is mandatory`);

  if (!tools.includes("submit")) {
    throw new Error(
      `${label}: "submit" absent from tools. The role would have no way to return ` +
        `an envelope, and would fall back to free-form prose — the failure this ` +
        `whole mechanism exists to remove.`,
    );
  }
  if (!["authoring", "full", "none"].includes(sliceMode)) {
    throw new Error(`${label}: sliceMode must be authoring, full or none — got "${sliceMode}"`);
  }
  if (skills.length > 0 && sliceMode === "none") {
    throw new Error(`${label}: ${skills.length} skill(s) listed but sliceMode is "none"`);
  }
  if (mechanism.length > 0 && !tools.includes("read")) {
    throw new Error(`${label}: mechanism skills listed without the "read" tool`);
  }
  if (sliceMode !== "none" && !tools.includes("read")) {
    // Not fatal for injection — the body arrives as text either way — but a
    // role given conventions and no way to open the files they refer to is
    // almost certainly a mistake in the definition.
    throw new Error(`${label}: sliceMode "${sliceMode}" without the "read" tool`);
  }

  const maxTurns = Number(str(fields, "maxTurns") ?? DEFAULTS.maxTurns);
  const timeoutMs = Number(str(fields, "timeoutMs") ?? DEFAULTS.timeoutMs);
  if (!Number.isFinite(maxTurns) || maxTurns < 1) throw new Error(`${label}: maxTurns must be >= 1`);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error(`${label}: timeoutMs must be >= 1000`);

  const session = (str(fields, "session") ?? DEFAULTS.session) as AgentDefinition["session"];
  if (session !== "ephemeral" && session !== "persistent") {
    throw new Error(`${label}: session must be ephemeral or persistent`);
  }

  return {
    name,
    description: str(fields, "description") ?? "",
    model,
    fallbackModels: list(fields, "fallbackModels") ?? DEFAULTS.fallbackModels,
    thinking: str(fields, "thinking"),
    tools,
    extensions: list(fields, "extensions") ?? DEFAULTS.extensions,
    skills,
    mechanism,
    sliceMode,
    contextFiles: (str(fields, "contextFiles") ?? "false") === "true",
    session,
    maxTurns,
    timeoutMs,
    prompt: body,
  };
}

export function loadAgents(dir: string): Map<string, AgentDefinition> {
  const agents = new Map<string, AgentDefinition>();
  if (!existsSync(dir)) return agents;

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const path = join(dir, file);
    const agent = parseAgent(readFileSync(path, "utf-8"), path);
    if (agents.has(agent.name)) throw new Error(`duplicate agent name: ${agent.name}`);
    agents.set(agent.name, agent);
  }
  return agents;
}
