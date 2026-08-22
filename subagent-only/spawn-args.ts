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

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
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
/**
 * Roots of a package installed from a git source.
 *
 * They do not land in `npm/node_modules`. A `packages` entry that is a URL is
 * cloned to `<agentDir>/git/<host>/<owner>/<repo>` — found by looking, after the
 * scout moved to a git-sourced provider and the resolver reported the extension
 * as missing while it sat on disk. Host and owner are discovered rather than
 * named: the next one will not be on github.com under the same account, and a
 * hardcoded path is something one only fixes twice.
 */
function gitPackageRoots(agentDir: string, name: string): string[] {
  const base = join(agentDir, "git");
  const roots: string[] = [];
  let hosts: string[];
  try {
    hosts = readdirSync(base);
  } catch {
    return roots;
  }
  for (const host of hosts) {
    let owners: string[];
    try {
      owners = readdirSync(join(base, host));
    } catch {
      continue;
    }
    for (const owner of owners) {
      const p = join(base, host, owner, name);
      if (existsSync(p)) roots.push(p);
    }
  }
  return roots;
}

export function resolveExtension(name: string, ctx: BuildContext): string {
  const npmRoot = join(ctx.agentDir, "npm", "node_modules", name);
  const entries = (root: string) => [
    join(root, "index.ts"),
    join(root, "src", "index.ts"),
    join(root, "dist", "index.js"),
  ];
  const candidates =
    name === "envelope"
      ? [join(ctx.selfDir, "envelope", "envelope.ts"), join(ctx.selfDir, "envelope.ts")]
      : [
          join(ctx.agentDir, "extensions", name, "index.ts"),
          // npm-installed packages live on disk under <agentDir>/npm/node_modules
          // (core/package-manager.js:1677), so -e reaches them even though
          // discovery — which -ne disables — is how they normally load.
          ...entries(npmRoot),
          ...gitPackageRoots(ctx.agentDir, name).flatMap(entries),
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
const BUILTIN_PROVIDERS = new Set([
  "anthropic",
  "google",
  "openai",
  "openai-codex",
  "kimi-coding",
  "xai",
  "groq",
  "openrouter",
  // Native to pi and configured by an API key, not by an extension: `pi` lists
  // it under the providers it can configure itself, with `models_json_key`. It
  // failed the check because this set was written from the providers in use at
  // the time and a provider absent from it is treated as needing a package —
  // which sends the fix in the wrong direction, since there is no package to
  // name. Two lists, two questions: does pi know this provider, and if not
  // which extension supplies it.
  "qwen-paygo",
  "qwen",
]);

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
 * The mechanism earned its place on 18 August 2026: moving the scout to
 * DeepSeek failed at load time with exactly the error it was written to give,
 * before a single delegation was spawned.
 */
const PROVIDER_PACKAGE: Record<string, string> = {
  // Declared in settings.json as a git source; pi installs it under
  // <agentDir>/npm/node_modules/ like any other package, so resolveExtension
  // finds it by its package.json name.
  deepseek: "pi-deepseek-provider",
};

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
  "rather than inventing an entry, and leave an optional field out rather than " +
  "padding it.";

/**
 * Data files that exist in the working tree and are not named in the task.
 *
 * "Name every file the work depends on" is stated in AGENTS.md, and again in
 * the `task` parameter's own description, with the incident that produced it.
 * It did not hold. Measured on run 3ed33e: `data/orders.csv` was named in 0 of
 * 15 tasks and read 0 times across 104 reads. The worker declared a
 * four-column schema against a five-column file, every test passed against the
 * invented schema, and seven reviews did not catch it — a reviewer reads what
 * it is named. `.gitignore` carried `data/`, so `pi-project-brief`, which
 * enumerates through `git ls-files`, could not surface it either. Every layer
 * that could have shown the file was blind to it.
 *
 * No judgment is made here about whether the task needs the data: only whether
 * the file exists and whether its path appears in the text. A rule that must
 * hold unconditionally does not live in prose.
 */
const DATA_EXTENSIONS = new Set([
  ".csv", ".tsv", ".psv", ".jsonl", ".ndjson", ".parquet", ".avro", ".orc",
]);

/** Line-oriented enough to have a readable first line. */
const HEADED_EXTENSIONS = /\.(csv|tsv|psv|jsonl|ndjson)$/i;

const SKIP_DIRS = new Set([
  "node_modules", ".venv", "venv", ".git", "dist", "build", "target",
  "__pycache__", ".pi", ".pi-subagent-runs", ".ruff_cache", ".pytest_cache",
  ".mypy_cache", "site-packages",
]);

/** Bounded on both axes: a scan that can dump a tree is the scout's mistake in another costume. */
const MAX_DATA_FILES = 10;
const MAX_DEPTH = 2;
const MAX_HEAD_CHARS = 300;

function describeDataFile(abs: string, rel: string): string {
  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    /* ignore */
  }
  const shown =
    size >= 1_048_576 ? `${(size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} kB`;

  // First line only, and only where there is one. A columnar file has no
  // readable head, and reading it to find out would cost more than the note.
  if (!HEADED_EXTENSIONS.test(rel)) return `${rel} (${shown})`;

  let head = "";
  try {
    const fd = openSync(abs, "r");
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    closeSync(fd);
    head = (buf.subarray(0, n).toString("utf-8").split(/\r?\n/)[0] ?? "").trim();
    if (head.length > MAX_HEAD_CHARS) head = `${head.slice(0, MAX_HEAD_CHARS)}…`;
  } catch {
    /* ignore */
  }
  return head ? `${rel} (${shown}, first line: ${head})` : `${rel} (${shown})`;
}

export function unnamedDataFiles(cwd: string, task: string): string[] {
  const found: string[] = [];

  const walk = (dir: string, rel: string, depth: number): void => {
    if (found.length >= MAX_DATA_FILES || depth > MAX_DEPTH) return;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as never;
    } catch {
      return;
    }
    for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean }>) {
      if (found.length >= MAX_DATA_FILES) return;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(join(dir, entry.name), relPath, depth + 1);
        }
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      if (dot === -1 || !DATA_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) continue;
      // Named already — by relative path or by basename. Either is enough:
      // the point is that the child has been pointed at it.
      if (task.includes(relPath) || task.includes(entry.name)) continue;
      found.push(describeDataFile(join(dir, entry.name), relPath));
    }
  };

  walk(cwd, "", 0);
  return found;
}

function dataNote(cwd: string, task: string): string {
  const unnamed = unnamedDataFiles(cwd, task);
  if (unnamed.length === 0) return "";
  return (
    "Data files present in the working tree and NOT named in this task:\n" +
    unnamed.map((d) => `  - ${d}`).join("\n") +
    "\n\nIf the work depends on the shape of external data — a schema, a header, " +
    "a column list, a parser, a validation — read the file rather than inferring " +
    "it. If it does not, ignore this list.\n\n"
  );
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

  // Project brief before any skill: what is true of this repository frames the
  // conventions, not the other way round. Silent when absent — a project with
  // no brief is the normal case, not an error.
  if (agent.projectBrief) {
    for (const p of [join(process.cwd(), ".pi", "BRIEF.md"), join(ctx.agentDir, ".pi", "BRIEF.md")]) {
      if (!existsSync(p)) continue;
      const brief = readFileSync(p, "utf-8").trim();
      if (!brief) break;
      injectedChars += brief.length;
      args.push("--append-system-prompt", brief);
      break;
    }
  }

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
  // The note sits between the task and the closing instruction: after the work
  // it qualifies, before the line that must stay last.
  args.push(`Task: ${task}\n\n${dataNote(process.cwd(), task)}${CLOSING_INSTRUCTION}`);

  return {
    args,
    env: { PI_SUBAGENT_ROLE: agent.envelopeRole ?? agent.name },
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
