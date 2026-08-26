/**
 * pi-check-config — /check-config as a registered command.
 *
 * The checks used to live in the body of the git-collaboration skill. That made
 * them a suggestion: pi has no `/check-config` command, so typing it fell
 * through to the model, which then had to decide to read the skill and run the
 * script. A consistency checker that depends on a model choosing to run it is
 * not a checker.
 *
 * Two tiers:
 *   Tier 1 (blocking)  — something is broken now. Report and stop.
 *   Tier 2 (report)    — untidy, not broken. Print and continue.
 *
 * Rewritten for the subagent extension. Gone: the `settings.json`
 * `subagents.agentOverrides` loadouts, which no longer exist — the domain
 * belongs to the task and the orchestrator passes it per call. Added: the
 * `## Review delta` marker guard, and validation of the agent definitions.
 *
 * The marker guard is the important one. The slicer used to throw at runtime on
 * a missing marker, which aborted a whole delegation over a skill that
 * legitimately had none. Relaxing it there moved the burden here — and here,
 * failing is free.
 *
 * Config: ~/.pi/agent/settings.json under key "checkConfig"
 *   {
 *     "orchestratorOnlySkills": ["git-collaboration", "grill-me"],
 *     "reviewerFacingSkills": ["python-engineering", "..."]
 *   }
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface CheckConfigSettings {
  /** Skills never injected into a child. Reported, never an error. */
  orchestratorOnlySkills?: string[];
  /** Skills expected to carry a `## Review delta`. A missing one is blocking. */
  reviewerFacingSkills?: string[];
  /** Skills injected whole through an agent's `mechanism` field, never sliced. */
  mechanismSkills?: string[];
}

const DEFAULT_ORCHESTRATOR_ONLY = [
  "git-collaboration",
  "grill-me",
  "diagnose",
  "improve-codebase-architecture",
  "dataeng-architecture",
  "gcp-dataeng-architecture",
  "tdd",
];

/** The eleven a reviewer can be handed. Override in settings when the set changes. */
const DEFAULT_REVIEWER_FACING = [
  "airflow-engineering",
  "bigquery-engineering",
  "bigquery-ops",
  "data-quality",
  "dbt-engineering",
  "gcp-engineering",
  "iac-terraform",
  "python-engineering",
  "spark-engineering",
  "sql-engineering",
  "technical-writing",
];

/**
 * Injected through `mechanism`, whole and unsliced.
 *
 * A third category, and its absence made `code-review` look unclassified: it is
 * neither reviewer-facing — it carries no delta and never will — nor
 * orchestrator-only, since every reviewer receives it. It is what the deltas
 * are weighed against.
 */
const DEFAULT_MECHANISM = ["code-review"];

const DELTA_MARKER = "## Review delta";

/**
 * Headings that only ever appear inside a Review delta.
 *
 * A skill carrying one of these without the marker above it has had its heading
 * renamed: the severity table is still there, and the reviewer will never see
 * it. That is the silent failure this whole check exists for.
 */
const DELTA_TELLS = ["### Severity assignment", "### Traps a diff does not show"];

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}

/** Directory names under skills/ that contain a SKILL.md. */
function skillsOnDisk(root: string): string[] {
  try {
    return readdirSync(join(root, "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => existsSync(join(root, "skills", name, "SKILL.md")))
      .sort();
  } catch {
    return [];
  }
}

/** Skill names declared as `- \`name\`` under the AGENTS.md skills heading. */
function skillsDeclaredInAgentsMd(root: string): Set<string> {
  const out = new Set<string>();
  const text = readText(join(root, "AGENTS.md"));
  if (!text) return out;
  const parts = text.split("## Skills available (global)");
  if (parts.length < 2) return out;
  const block = parts[1]!.split("\n## ")[0]!;
  for (const m of block.matchAll(/^-\s+`([^`]+)`/gm)) out.add(m[1]!);
  return out;
}

interface FrontmatterResult {
  ok: boolean;
  name?: string;
  hasDescription?: boolean;
  error?: string;
  degraded?: boolean;
}

/**
 * Parse every skill frontmatter in one python3 call.
 *
 * python3 + PyYAML rather than a hand-rolled TS parser: re-implementing YAML
 * badly is exactly the failure this check exists to catch. If PyYAML is absent
 * the result is marked degraded and the report says so, rather than quietly
 * falling back to checks that already missed a real break.
 */
async function parseFrontmatters(
  pi: ExtensionAPI,
  root: string,
  skills: string[],
): Promise<Record<string, FrontmatterResult>> {
  const script = `
import json, os, re, sys
root, names = sys.argv[1], sys.argv[2:]
try:
    import yaml
    have_yaml = True
except Exception:
    have_yaml = False
out = {}
for n in names:
    p = os.path.join(root, "skills", n, "SKILL.md")
    try:
        text = open(p, encoding="utf-8").read()
    except Exception as e:
        out[n] = {"ok": False, "error": f"unreadable: {e}"}
        continue
    m = re.match(r"^---\\r?\\n(.*?)\\r?\\n---\\r?\\n", text, re.S)
    if not m:
        out[n] = {"ok": False, "error": "no YAML frontmatter"}
        continue
    block = m.group(1)
    if have_yaml:
        try:
            data = yaml.safe_load(block) or {}
        except Exception as e:
            out[n] = {"ok": False, "error": f"invalid YAML: {e}"}
            continue
        if not isinstance(data, dict):
            out[n] = {"ok": False, "error": "frontmatter is not a mapping"}
            continue
        out[n] = {"ok": True, "name": data.get("name"),
                  "hasDescription": bool(data.get("description"))}
    else:
        nm = re.search(r"^name:\\s*(.+)$", block, re.M)
        out[n] = {"ok": True, "degraded": True,
                  "name": nm.group(1).strip() if nm else None,
                  "hasDescription": bool(re.search(r"^description:\\s*\\S", block, re.M))}
print(json.dumps(out))
`;
  try {
    const result = await pi.exec("python3", ["-c", script, root, ...skills], {
      timeout: 15000,
    });
    return JSON.parse(result.stdout) as Record<string, FrontmatterResult>;
  } catch {
    return {};
  }
}

// ------------------------------------------------------------- agent checks

interface AgentCheck {
  file: string;
  blocking: string[];
  report: string[];
  model?: string;
}

/**
 * Validate an agent definition without importing agents.ts.
 *
 * A deliberate second implementation: the point is to catch a definition that
 * `loadAgents` would reject at session start, and importing the very parser
 * under test would make the check pass whenever the parser is wrong in the same
 * way. Kept to the fields whose breakage is silent or expensive.
 */
function checkAgent(root: string, file: string, skillSet: Set<string>): AgentCheck {
  const out: AgentCheck = { file, blocking: [], report: [] };
  const path = join(root, "subagent-only", "agents", file);
  const text = readText(path);
  if (!text) {
    out.blocking.push(`agents/${file}: unreadable`);
    return out;
  }

  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) {
    out.blocking.push(`agents/${file}: no YAML frontmatter`);
    return out;
  }
  const [, fmBlock, body] = m;

  const field = (k: string): string | undefined =>
    new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fmBlock!)?.[1]?.trim();
  const list = (k: string): string[] =>
    (field(k) ?? "")
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const name = field("name");
  const expected = file.replace(/\.md$/, "");
  if (name !== expected) out.blocking.push(`agents/${file}: name '${name}' != filename`);
  if (!body?.trim()) out.blocking.push(`agents/${file}: empty body — the role prompt is mandatory`);

  const model = field("model");
  out.model = model;
  if (!model) out.blocking.push(`agents/${file}: no model`);

  const tools = list("tools");
  if (!tools.includes("submit")) {
    out.blocking.push(
      `agents/${file}: 'submit' absent from tools — the role could not return an envelope`,
    );
  }

  const sliceMode = field("sliceMode") ?? "none";
  if (!["authoring", "full", "none"].includes(sliceMode)) {
    out.blocking.push(`agents/${file}: sliceMode '${sliceMode}' is not authoring|full|none`);
  }
  if (sliceMode !== "none" && !tools.includes("read")) {
    out.blocking.push(`agents/${file}: sliceMode '${sliceMode}' without the 'read' tool`);
  }

  for (const s of [...list("skills"), ...list("mechanism")]) {
    if (!skillSet.has(s)) out.blocking.push(`agents/${file}: unknown skill '${s}'`);
  }

  for (const e of list("extensions")) {
    const candidates =
      e === "envelope"
        ? [join(root, "subagent-only", "envelope", "envelope.ts")]
        : [
            join(root, "extensions", e, "index.ts"),
            join(root, "npm", "node_modules", e, "index.ts"),
            join(root, "npm", "node_modules", e, "src", "index.ts"),
          ];
    if (!candidates.some(existsSync)) {
      out.blocking.push(`agents/${file}: extension '${e}' not found on disk`);
    }
  }

  const maxTurns = Number(field("maxTurns"));
  if (!Number.isFinite(maxTurns) || maxTurns < 1) {
    out.blocking.push(`agents/${file}: maxTurns must be a number >= 1`);
  }

  // A role prompt that does not tell the child its context is complete sends it
  // hunting for AGENTS.md, which -nc removed. Measured: one wasted turn, first
  // call, every time.
  //
  // The alternatives are what the prompts actually say, not what this check
  // once expected them to say. Every role opens on "Everything you need is in
  // this prompt", which none of the three earlier patterns matched — so the
  // check reported all four prompts as defective while all four were correct,
  // and the obvious repair was to reword four correct prompts to satisfy a
  // stale regex. A check that dictates wording rather than verifying a property
  // is worse than no check: it would have gone on shaping every role written
  // after it.
  if (
    !/already in this prompt|inherits nothing|do not search for|everything you need is in this prompt|quoted into (?:your|the) task/i.test(
      body ?? "",
    )
  ) {
    out.report.push(
      `agents/${file}: prompt does not state that the context is complete — a child ` +
        `running with --no-context-files will look for AGENTS.md`,
    );
  }
  return out;
}

// -------------------------------------------------------------------- entry

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("check-config", {
    description: "Config repo consistency — blocking and report tiers",

    handler: async (_args, ctx) => {
      const root = getAgentDir();
      const settings =
        readJson<Record<string, CheckConfigSettings>>(join(root, "settings.json"))?.[
          "checkConfig"
        ] ?? {};
      const orchestratorOnly = new Set(
        settings.orchestratorOnlySkills ?? DEFAULT_ORCHESTRATOR_ONLY,
      );
      const reviewerFacing = new Set(settings.reviewerFacingSkills ?? DEFAULT_REVIEWER_FACING);
      const mechanism = new Set(settings.mechanismSkills ?? DEFAULT_MECHANISM);

      const disk = skillsOnDisk(root);
      const diskSet = new Set(disk);
      if (disk.length === 0) {
        ctx.ui.notify(`check-config: no skills found under ${root}/skills`, "error");
        return;
      }

      const blocking: string[] = [];
      const report: string[] = [];

      // --- declared vs present ---------------------------------------------
      for (const name of [...skillsDeclaredInAgentsMd(root)].sort()) {
        if (!diskSet.has(name)) blocking.push(`AGENTS.md declares '${name}' — not in skills/`);
      }
      for (const name of [...reviewerFacing].sort()) {
        if (!diskSet.has(name)) blocking.push(`reviewerFacingSkills lists '${name}' — not in skills/`);
      }

      // --- the Review delta marker -----------------------------------------
      //
      // Exactly one, at the start of a line. `code-review` mentions the marker
      // mid-sentence when it points at the domain skills; an unanchored or
      // count-insensitive check would either miss a duplicate or trip on prose.
      for (const name of disk) {
        const text = readText(join(root, "skills", name, "SKILL.md")) ?? "";
        const count = text.split("\n").filter((l) => l.trimEnd() === DELTA_MARKER).length;
        const hasTell = DELTA_TELLS.some((t) => text.includes(`\n${t}`));

        if (count > 1) {
          blocking.push(`skills/${name}: ${count} '${DELTA_MARKER}' headings — the slicer cuts at the first`);
        } else if (reviewerFacing.has(name) && count === 0) {
          blocking.push(
            `skills/${name}: no '${DELTA_MARKER}' heading. Renamed? A reviewer would be ` +
              `handed the whole file with no severity table and would invent one.`,
          );
        } else if (count === 0 && hasTell) {
          blocking.push(
            `skills/${name}: carries a delta section but no '${DELTA_MARKER}' heading above it`,
          );
        } else if (count === 1 && !reviewerFacing.has(name)) {
          report.push(`skills/${name}: has a Review delta but is not in reviewerFacingSkills`);
        }
      }

      // --- skill frontmatter ------------------------------------------------
      const fm = await parseFrontmatters(pi, root, disk);
      let degraded = false;
      for (const name of disk) {
        const r = fm[name];
        if (!r) {
          blocking.push(`skills/${name}: frontmatter could not be checked`);
          continue;
        }
        if (r.degraded) degraded = true;
        if (!r.ok) {
          blocking.push(`skills/${name}: ${r.error}`);
          continue;
        }
        if (!r.name) blocking.push(`skills/${name}: frontmatter has no 'name'`);
        else if (r.name !== name)
          blocking.push(`skills/${name}: frontmatter name '${r.name}' != directory`);
        if (!r.hasDescription) blocking.push(`skills/${name}: frontmatter has no 'description'`);
      }
      if (degraded) {
        report.push(
          "frontmatter checked by regex only — PyYAML not importable by python3. " +
            "An invalid-YAML frontmatter would not be caught. Install with: pip install pyyaml",
        );
      }

      // --- agent definitions -------------------------------------------------
      let agentFiles: string[] = [];
      try {
        agentFiles = readdirSync(join(root, "subagent-only", "agents"))
          .filter((f) => f.endsWith(".md"))
          .sort();
      } catch {
        blocking.push("subagent-only/agents/ unreadable — no delegation is possible");
      }
      const models = new Set<string>();
      for (const f of agentFiles) {
        const r = checkAgent(root, f, diskSet);
        blocking.push(...r.blocking);
        report.push(...r.report);
        if (r.model) models.add(r.model);
      }

      // Cognitive diversity: a reviewer on the same family as the worker is a
      // judge-and-party arrangement, and the config exists partly to prevent it.
      const families = new Set([...models].map((m) => m.split("/")[0]));
      if (agentFiles.length > 1 && families.size < 2) {
        report.push(
          `all agents run on '${[...families][0]}' — reviewer and worker on one family ` +
            `is the structural risk this setup was built to avoid`,
        );
      }

      // --- roles declared vs defined ----------------------------------------
      //
      // Read from the keys of the `payloads` map, not from `Type.Literal("…")`.
      // The literals were how a role was named when the envelope carried a
      // discriminant field; that field is gone — envelope.ts says so in its own
      // header — and the schemas have been plain keys of `payloads` since. The
      // check went on grepping for the literals, found none, and reported all
      // four roles as undeclared at once. Four simultaneous failures are a
      // checker, never four regressions, and this one blocked the commit
      // workflow on a Tier 1 that did not exist.
      //
      // Keys rather than a hardcoded list of the four: a role added to the map
      // is declared by that act, which is the property this check is meant to
      // verify in the first place.
      const envelope = readText(join(root, "subagent-only", "envelope", "envelope.ts")) ?? "";
      const payloadBlock = envelope.slice(envelope.indexOf("const payloads = {"));
      const declaredRoles = [...payloadBlock.matchAll(/^\s{2}([a-z][a-z0-9_-]*):\s*Type\.Object\(/gm)]
        .map((m) => m[1]!)
        .filter((v, i, a) => a.indexOf(v) === i);

      if (declaredRoles.length === 0) {
        // Said once, and not four times over. If the map cannot be read at all,
        // the per-role comparison below would blame every agent on disk for a
        // parse failure that belongs here.
        blocking.push(
          "subagent-only/envelope/envelope.ts: no role schema found. Expected a `const payloads = {` " +
            "map whose keys are role names. Every per-role check below is suspended.",
        );
      } else {
        const defined = new Set(agentFiles.map((f) => f.replace(/\.md$/, "")));
        for (const role of declaredRoles) {
          if (!defined.has(role)) {
            report.push(
              `role '${role}' has an envelope schema but no definition — the schema is ready, ` +
                `the agent is not written. Not an error unless you meant to invoke it.`,
            );
          }
        }
        for (const role of defined) {
          if (!declaredRoles.includes(role)) {
            blocking.push(`agents/${role}.md exists but envelope.ts declares no '${role}' schema`);
          }
        }
      }

      // --- tier 2 ------------------------------------------------------------
      const readme = readText(join(root, "README.md"));
      if (!readme) report.push("README.md unreadable — documentation drift not checked");
      else for (const name of disk) {
        if (!readme.includes(name)) report.push(`skills/${name}: absent from README.md`);
      }
      for (const name of disk) {
        if (reviewerFacing.has(name) || orchestratorOnly.has(name) || mechanism.has(name)) continue;
        report.push(
          `skills/${name}: in none of reviewer-facing, mechanism, orchestrator-only — intentional?`,
        );
      }
      // A mechanism skill carrying a delta would be weighing itself.
      for (const name of mechanism) {
        if (!diskSet.has(name)) blocking.push(`mechanismSkills lists '${name}' — not in skills/`);
        else if (reviewerFacing.has(name))
          blocking.push(`skills/${name}: listed as both mechanism and reviewer-facing`);
      }

      // --- output -------------------------------------------------------------
      const lines = [
        `check-config — ${root}`,
        `${disk.length} skills — ${reviewerFacing.size} reviewer-facing, ${mechanism.size} mechanism, ` +
          `${orchestratorOnly.size} orchestrator-only. ` +
          `${agentFiles.length} agents on ${families.size} model famil${families.size === 1 ? "y" : "ies"}`,
        "",
      ];
      for (const l of blocking) lines.push(`BLOCKING  ${l}`);
      for (const l of report) lines.push(`report    ${l}`);
      if (blocking.length === 0 && report.length === 0) lines.push("config consistent");

      if (blocking.length > 0) {
        lines.push(
          "",
          "Tier 1 failures. Do not stage, do not draft a commit message. " +
            "Fix each blocking item, re-run /check-config, then resume.",
        );
      }

      pi.sendUserMessage(lines.join("\n"), { deliverAs: "followUp" });
    },
  });
}
