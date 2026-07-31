/**
 * pi-check-config — /check-config as a registered command.
 *
 * The checks used to live in the body of the git-collaboration skill. That made
 * them a suggestion: pi has no `/check-config` command, so typing it fell
 * through to the model, which then had to decide to read the skill and run the
 * script. A consistency checker that depends on a model choosing to run it is
 * not a checker. Same reasoning as the commit hook and the bash-guard token.
 *
 * Two tiers, from the skill, unchanged:
 *   Tier 1 (blocking)  — something is broken now. Report and stop.
 *   Tier 2 (report)    — untidy, not broken. Print and continue.
 *
 * One check is stricter than the skill's version: frontmatter is parsed as real
 * YAML, not regex-matched. The regex version accepted a `description:` whose
 * value was an unquoted single-line scalar containing a colon — valid to a
 * regex, a syntax error to every YAML parser, and a skill that never registers.
 *
 * Config: ~/.pi/agent/settings.json under key "checkConfig"
 *   { "orchestratorOnlySkills": ["git-collaboration", "grill-me"] }
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface CheckConfigSettings {
  /** Skills expected to be in no sub-agent loadout. Reported, never an error. */
  orchestratorOnlySkills?: string[];
}

const DEFAULT_ORCHESTRATOR_ONLY = ["git-collaboration", "grill-me"];

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
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
      .filter((name) => {
        try {
          readFileSync(join(root, "skills", name, "SKILL.md"));
          return true;
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/** Skill names declared as `- \`name\`` under the AGENTS.md skills heading. */
function skillsDeclaredInAgentsMd(root: string): Set<string> {
  const out = new Set<string>();
  let text: string;
  try {
    text = readFileSync(join(root, "AGENTS.md"), "utf-8");
  } catch {
    return out;
  }
  const parts = text.split("## Skills available (global)");
  if (parts.length < 2) return out;
  const block = parts[1]!.split("\n## ")[0]!;
  for (const m of block.matchAll(/^-\s+`([^`]+)`/gm)) out.add(m[1]!);
  return out;
}

/** Union of every sub-agent `skills` array in settings.json. */
function skillsUsedBySubagents(root: string): Set<string> {
  const out = new Set<string>();
  const cfg = readJson<{
    subagents?: { agentOverrides?: Record<string, { skills?: string[] }> };
  }>(join(root, "settings.json"));
  for (const agent of Object.values(cfg?.subagents?.agentOverrides ?? {})) {
    for (const s of agent.skills ?? []) out.add(s);
  }
  return out;
}

interface FrontmatterResult {
  ok: boolean;
  name?: string;
  hasDescription?: boolean;
  error?: string;
  /** True when the YAML pass was skipped because PyYAML is unavailable. */
  degraded?: boolean;
}

/**
 * Parse every skill frontmatter in one python3 call.
 *
 * python3 + PyYAML rather than a hand-rolled TS parser: re-implementing YAML
 * badly is exactly the failure this check exists to catch. If PyYAML is absent
 * the result is marked degraded and the report says so out loud, rather than
 * quietly falling back to the checks that already missed a real break.
 */
async function parseFrontmatters(
  pi: ExtensionAPI,
  root: string,
  skills: string[],
): Promise<Record<string, FrontmatterResult>> {
  const script = `
import json, sys, os
root, names = sys.argv[1], sys.argv[2:]
try:
    import yaml
    have_yaml = True
except ImportError:
    have_yaml = False
out = {}
for n in names:
    p = os.path.join(root, "skills", n, "SKILL.md")
    try:
        raw = open(p, encoding="utf-8").read()
    except OSError as e:
        out[n] = {"ok": False, "error": "unreadable: %s" % e}; continue
    if not raw.startswith("---"):
        out[n] = {"ok": False, "error": "no frontmatter"}; continue
    parts = raw.split("---\\n", 2)
    if len(parts) < 3:
        out[n] = {"ok": False, "error": "unterminated frontmatter"}; continue
    block = parts[1]
    if not have_yaml:
        import re
        m = re.search(r"^name:\\s*(.+)$", block, re.M)
        out[n] = {"ok": True, "degraded": True,
                  "name": m.group(1).strip() if m else None,
                  "hasDescription": bool(re.search(r"^description:", block, re.M))}
        continue
    try:
        d = yaml.safe_load(block)
    except Exception as e:
        out[n] = {"ok": False, "error": "invalid YAML: %s" % str(e).split("\\n")[0]}; continue
    if not isinstance(d, dict):
        out[n] = {"ok": False, "error": "frontmatter is not a mapping"}; continue
    out[n] = {"ok": True, "name": d.get("name"), "hasDescription": bool(d.get("description"))}
print(json.dumps(out))
`;
  try {
    const result = await pi.exec("python3", ["-c", script, root, ...skills], {
      timeout: 30_000,
    });
    return JSON.parse(result.stdout) as Record<string, FrontmatterResult>;
  } catch {
    return {};
  }
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("check-config", {
    description: "Config repo consistency — blocking and report tiers",

    handler: async (_args, ctx) => {
      const settings =
        readJson<Record<string, CheckConfigSettings>>(join(getAgentDir(), "settings.json"))?.[
          "checkConfig"
        ] ?? {};
      const orchestratorOnly = new Set(
        settings.orchestratorOnlySkills ?? DEFAULT_ORCHESTRATOR_ONLY,
      );

      const root = getAgentDir();
      const disk = skillsOnDisk(root);
      const diskSet = new Set(disk);

      if (disk.length === 0) {
        ctx.ui.notify(`check-config: no skills found under ${root}/skills`, "error");
        return;
      }

      const blocking: string[] = [];
      const report: string[] = [];

      // --- declared vs present -------------------------------------------
      for (const name of [...skillsDeclaredInAgentsMd(root)].sort()) {
        if (!diskSet.has(name)) blocking.push(`AGENTS.md declares '${name}' — not in skills/`);
      }
      const used = skillsUsedBySubagents(root);
      for (const name of [...used].sort()) {
        if (!diskSet.has(name)) blocking.push(`settings.json loads '${name}' — not in skills/`);
      }

      // --- frontmatter -----------------------------------------------------
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

      // --- tier 2 -----------------------------------------------------------
      let readme = "";
      try {
        readme = readFileSync(join(root, "README.md"), "utf-8");
      } catch {
        report.push("README.md unreadable — documentation drift not checked");
      }
      if (readme) {
        for (const name of disk) {
          if (!readme.includes(name)) report.push(`skills/${name}: absent from README.md`);
        }
      }
      for (const name of disk) {
        if (used.has(name)) continue;
        report.push(
          orchestratorOnly.has(name)
            ? `skills/${name}: loaded by no sub-agent (orchestrator-only, expected)`
            : `skills/${name}: loaded by no sub-agent — intentional?`,
        );
      }

      // --- output -----------------------------------------------------------
      const lines = [
        `check-config — ${root}`,
        `${disk.length} skills on disk, ${used.size} referenced by sub-agents`,
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
