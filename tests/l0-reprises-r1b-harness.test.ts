/**
 * l0-reprises-r1b-harness.test.ts — LOT-REPRISES, R1-b, de bout en bout
 * (PLAN-LOT-REPRISES v2 gelé, `1a840043`, § 2 et Q1).
 *
 *   note          `buildSpawnPlan` porte le périmètre aux seuls writers : dans la tâche, avant la
 *                 consigne de clôture, et dans l'environnement pour role-guard ; un rôle en
 *                 lecture n'en reçoit jamais — R1B-note
 *   transmission  le vrai runtime lit le périmètre dans le plan gelé et validé — scope et
 *                 kept_consumers acceptés par R1-a — pour le worker de la lane, jamais pour le
 *                 reviewer — R1B-transmission
 *   branchement   le vrai role-guard, chargé avec ce périmètre dans un vrai répertoire de lane,
 *                 refuse au `tool_call` un edit hors périmètre et laisse passer le reste ; le
 *                 fichier visé reste intact — R1B-branchement
 *
 * Les propriétés du prédicat sont dans `l0-reprises-r1b.test.ts`. Montage : `l0-b2-harness.ts`.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, git, monter, precondition, propriete, revue, tache } from "./l0-b2-harness.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";
import { buildSpawnPlan, NOTE_PERIMETRE } from "../subagent-only/spawn-args.ts";
import { WRITE_OUTSIDE_SCOPE } from "../subagent-only/role-rules.ts";
import roleGuard from "../subagent-only/role-guard.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
const locaux: string[] = [];
test.after(() => {
  for (const d of [...aJeter(), ...locaux]) rmSync(d, { recursive: true, force: true });
});

function role(nom: string, tools: string[]): AgentDefinition {
  return {
    name: nom, description: "", model: "openai-codex/gpt-5.6-terra", tools, extensions: [], skills: [],
    mechanism: [], sliceMode: "authoring", contextFiles: false, projectBrief: false, session: "ephemeral",
    prompt: "rôle",
  } as unknown as AgentDefinition;
}
const tacheDe = (args: string[]) => args[args.length - 1];
const PERIMETRE = { unit: "W01", scope: ["src/pkg/io.py", "tests/test_io.py"], kept: ["src/pkg/run.py"] };

regressionCorrigee("R1B-note", "le périmètre est porté aux seuls writers, dans la tâche et dans l'environnement", () => {
  const d = mkdtempSync(join(tmpdir(), "pi-l0-r1b-note-"));
  locaux.push(d);
  const ctx = { agentDir: process.cwd(), selfDir: join(process.cwd(), "subagent-only"), runId: "0123456789abcdef", cwd: d };
  const worker = role("worker", ["read", "bash", "edit", "write", "submit"]);
  const reviewer = role("reviewer", ["read", "ls", "submit"]);
  const plan = buildSpawnPlan(worker, "faire W01", { ...ctx, perimetre: PERIMETRE });
  const t = tacheDe(plan.args);
  propriete(t.includes(`${NOTE_PERIMETRE}W01 : src/pkg/io.py, tests/test_io.py.`), `la tâche porte le périmètre (${t.slice(0, 300)})`);
  propriete(t.includes("interface préservée : src/pkg/run.py"), "et les consommateurs à laisser intacts");
  propriete(t.indexOf(NOTE_PERIMETRE) > t.indexOf("faire W01") && t.trimEnd().endsWith("padding it."),
    "la note suit la tâche et précède la consigne de clôture, qui reste la dernière");
  propriete(plan.env.PI_SUBAGENT_WRITE_SCOPE === JSON.stringify(PERIMETRE), "role-guard reçoit le même périmètre par l'environnement");
  const lecteur = buildSpawnPlan(reviewer, "juger W01", { ...ctx, perimetre: PERIMETRE });
  propriete(!tacheDe(lecteur.args).includes(NOTE_PERIMETRE) && lecteur.env.PI_SUBAGENT_WRITE_SCOPE === undefined,
    "un rôle en lecture ne reçoit ni la note ni la variable");
  const sans = buildSpawnPlan(worker, "faire W01", { ...ctx, perimetre: null });
  propriete(!tacheDe(sans.args).includes(NOTE_PERIMETRE) && sans.env.PI_SUBAGENT_WRITE_SCOPE === undefined,
    "sans périmètre, ni note ni variable");
});

regressionCorrigee("R1B-transmission", "le runtime porte au worker de la lane le périmètre du plan validé, jamais au reviewer", async () => {
  const plan = {
    version: 1,
    work_units: [{
      id: "W03", goal: "extraire", depends_on: [], expected_write_scope: ["src/pkg/io.py", "src/a.py"],
      kept_consumers: ["src/pkg/run.py"],
    }],
  };
  const h = await monter({ plan });
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  mkdirSync(join(h.root, "src", "pkg"), { recursive: true });
  writeFileSync(join(h.root, "src", "pkg", "__init__.py"), "");
  writeFileSync(join(h.root, "src", "pkg", "io.py"), "def lire():\n    return 1\n");
  writeFileSync(join(h.root, "src", "pkg", "run.py"), "from .io import lire\n");
  git(h.root, "add", "-A");
  git(h.root, "commit", "-qm", "paquet");

  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("r1b-1", tache("W03"));
  PILOTE.pendant = undefined;
  const w = APPELS.filter((a) => a.agent === "worker");
  precondition(w.length === 1, `un worker doit être parti (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(JSON.stringify(w[0].perimetre) === JSON.stringify({ unit: "W03", scope: ["src/pkg/io.py", "src/a.py"], kept: ["src/pkg/run.py"] }),
    `le worker reçoit le périmètre du plan gelé (${JSON.stringify(w[0].perimetre)})`);
  await h.outil.execute("r1b-2", revue("W03"));
  const r = APPELS.filter((a) => a.agent === "reviewer");
  precondition(r.length === 1, `un reviewer doit être parti (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(!r[0].perimetre, `le reviewer ne reçoit aucun périmètre (${JSON.stringify(r[0].perimetre)})`);
  assert.ok(true);
});

regressionCorrigee("R1B-branchement", "le vrai role-guard refuse au tool_call un edit hors périmètre, et le fichier reste intact", async () => {
  const lane = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-r1b-lane-")));
  locaux.push(lane);
  mkdirSync(join(lane, "src", "pkg"), { recursive: true });
  writeFileSync(join(lane, "src", "pkg", "entries.py"), "x = 1\n");
  const avant = { cwd: process.cwd(), env: { ...process.env } };
  process.chdir(lane);
  process.env.PI_SUBAGENT_ROLE = "worker";
  process.env.PI_SUBAGENT_READONLY = "0";
  process.env.PI_SUBAGENT_WRITE_SCOPE = JSON.stringify(PERIMETRE);
  const handlers = new Map<string, (e: unknown) => Promise<unknown>>();
  try {
    roleGuard({ on: (n: string, h: (e: unknown) => Promise<unknown>) => handlers.set(n, h), registerTool() {} } as never);
  } finally {
    process.env = avant.env;
  }
  try {
    const appel = (toolName: string, path: string) =>
      handlers.get("tool_call")!({ toolName, toolCallId: `c-${path}`, input: { path, edits: [], content: "" } }) as Promise<{ block?: boolean; reason?: string } | undefined>;
    const hors = await appel("edit", "src/pkg/entries.py");
    propriete(hors?.block === true && (hors.reason ?? "").includes(WRITE_OUTSIDE_SCOPE), `edit hors périmètre bloqué (${JSON.stringify(hors)})`);
    const garde = await appel("write", "src/pkg/run.py");
    propriete(garde?.block === true, "write sur un consommateur à laisser intact bloqué");
    propriete(await appel("edit", "src/pkg/io.py") === undefined, "edit dans le périmètre : passe");
    propriete(await appel("read", "src/pkg/entries.py") === undefined, "lecture : passe");
    propriete(readFileSync(join(lane, "src", "pkg", "entries.py"), "utf-8") === "x = 1\n", "le fichier visé est intact");
  } finally {
    process.chdir(avant.cwd);
  }
  assert.ok(true);
});
