/**
 * config.test.ts — the invariants a clone of this repository must satisfy.
 *
 * A deliberate second implementation of what `/check-config` does, and for the
 * same reason it gives: importing the parser under test makes the test pass
 * whenever the parser is wrong in the same way. Everything here reads files
 * from disk and asserts against them.
 *
 * The case that produced this file: `pi-secret-gate` was declared in
 * `worker.md` and never committed. It existed on one machine, so every local
 * run worked and every clone would have failed at `resolveExtension` before a
 * child was spawned. Nothing in the repository could notice.
 *
 * Run: bin/test-guards
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_DIR = join(ROOT, "subagent-only", "agents");

interface Frontmatter {
  name: string;
  file: string;
  model: string;
  fallbacks: string[];
  tools: string[];
  extensions: string[];
  skills: string[];
  mechanism: string[];
  maxTurns: number;
  body: string;
}

/** Enough of a YAML reader for the fields these definitions actually use. */
function readAgent(file: string): Frontmatter {
  const text = readFileSync(join(AGENTS_DIR, file), "utf-8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, `${file}: no frontmatter`);
  const [, fm, body] = m!;
  const scalar = (k: string): string => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
  const list = (k: string): string[] => {
    const raw = scalar(k);
    if (!raw.startsWith("[")) return raw ? [raw] : [];
    return raw
      .slice(1, raw.lastIndexOf("]"))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };
  return {
    name: scalar("name"),
    file,
    model: scalar("model"),
    fallbacks: list("fallbackModels"),
    tools: list("tools"),
    extensions: list("extensions"),
    skills: list("skills"),
    mechanism: list("mechanism"),
    maxTurns: Number(scalar("maxTurns")),
    body,
  };
}

const AGENTS = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map(readAgent);

test("there is at least one agent definition", () => {
  assert.ok(AGENTS.length > 0);
});

// ---------------------------------------------------------------------------
// Every declared dependency exists on disk
// ---------------------------------------------------------------------------

for (const a of AGENTS) {
  test(`${a.file}: every extension resolves`, () => {
    for (const e of a.extensions) {
      const candidates =
        e === "envelope"
          ? [join(ROOT, "subagent-only", "envelope", "envelope.ts"), join(ROOT, "subagent-only", "envelope.ts")]
          : e === "role-guard"
            ? [join(ROOT, "subagent-only", "role-guard.ts")]
            : [
                join(ROOT, "extensions", e, "index.ts"),
                join(ROOT, "npm", "node_modules", e, "index.ts"),
                join(ROOT, "npm", "node_modules", e, "src", "index.ts"),
              ];
      assert.ok(
        candidates.some(existsSync),
        `extension '${e}' is declared and absent from the repository — every delegation to ` +
          `${a.name} fails at spawn on a fresh clone`,
      );
    }
  });

  test(`${a.file}: every skill resolves`, () => {
    for (const s of [...a.skills, ...a.mechanism]) {
      assert.ok(existsSync(join(ROOT, "skills", s, "SKILL.md")), `skill '${s}' not on disk`);
    }
  });

  test(`${a.file}: frontmatter is complete`, () => {
    assert.equal(a.name, a.file.replace(/\.md$/, ""), "name must match the filename");
    assert.ok(a.model, "no model");
    assert.ok(a.tools.includes("submit"), "no submit tool — the role has no way to return");
    assert.ok(Number.isFinite(a.maxTurns) && a.maxTurns >= 1, "maxTurns must be >= 1");
  });

  test(`${a.file}: the prompt states that the context is complete`, () => {
    // A child runs with --no-context-files. A prompt that does not say so sends
    // it looking for AGENTS.md, and that is one wasted turn on the first call.
    assert.match(
      a.body,
      /already in this prompt|inherits nothing|do not search for|everything you need is in this prompt|quoted into (?:your|the) task/i,
    );
  });
}

// ---------------------------------------------------------------------------
// A role that cannot write must not hold a shell
// ---------------------------------------------------------------------------

for (const a of AGENTS) {
  test(`${a.file}: read-only implies no shell`, () => {
    const writes = a.tools.includes("edit") || a.tools.includes("write");
    if (writes) return;
    assert.equal(
      a.tools.includes("bash"),
      false,
      `${a.name} has no edit and no write but holds bash. An allowlist over shell command ` +
        `names is walkable — echo $(…), find -exec, env — so the tool is removed, not policed.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Every role has an envelope schema, and no role judges its own work
// ---------------------------------------------------------------------------

test("every agent has a payload schema, and every schema has an agent", () => {
  const envelope = readFileSync(join(ROOT, "subagent-only", "envelope", "envelope.ts"), "utf-8");
  const block = envelope.slice(envelope.indexOf("const payloads = {"));
  const declared = [...block.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*Type\.Object\(/gm)].map((m) => m[1]);
  assert.ok(declared.length > 0, "no role schema found in envelope.ts");

  const defined = AGENTS.map((a) => a.name).sort();
  assert.deepEqual([...declared].sort(), defined);
});

test("no model both produces and judges", () => {
  // Cognitive diversity is the reason this configuration has four families.
  // Primaries must differ; a shared fallback is a known trade-off, asserted
  // here so that changing it is a decision rather than a drift.
  const chain = (n: string) => {
    const a = AGENTS.find((x) => x.name === n);
    return a ? [a.model, ...a.fallbacks] : [];
  };
  const worker = chain("worker");
  const reviewer = chain("reviewer");
  if (worker.length === 0 || reviewer.length === 0) return;

  assert.notEqual(worker[0], reviewer[0], "worker and reviewer share a primary model");
  assert.equal(
    worker.some((m) => reviewer.includes(m)),
    false,
    "worker and reviewer can end up on the same model through a fallback",
  );
});

// ---------------------------------------------------------------------------
// role-guard is injected by the code, not by a frontmatter anyone can forget
// ---------------------------------------------------------------------------

test("spawn-args injects role-guard into every child", () => {
  const src = readFileSync(join(ROOT, "subagent-only", "spawn-args.ts"), "utf-8");
  assert.match(src, /includes\("role-guard"\)/, "role-guard is no longer added by buildSpawnPlan");
  assert.match(src, /PI_SUBAGENT_READONLY/, "the read-only flag is no longer published to the child");
});

test("the read-only flag is derived from the tool list", () => {
  // Two places deciding what read-only means is one place that drifts.
  const src = readFileSync(join(ROOT, "subagent-only", "spawn-args.ts"), "utf-8");
  assert.match(src, /!agent\.tools\.includes\("edit"\) && !agent\.tools\.includes\("write"\)/);
});
