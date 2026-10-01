/**
 * l0-correctif-rc-harness.test.ts — LOT-REPRISES-CORRECTIF, RC, dans le vrai `submit`, le vrai
 * `dispatch` et le vrai runtime (PLAN-LOT-REPRISES-CORRECTIF gelé, § 2 et § 5).
 *
 *   submit         le vrai `submit` du reviewer, alimenté par de vrais événements `tool_result` :
 *                  verdict bloquant refusé sans terminer tant qu'un kept n'est pas lu par `read`,
 *                  accepté ensuite ; `grep` et `read` en erreur ne comptent pas ; `approved` et les
 *                  autres rôles ne sont pas concernés — RC-submit
 *   dispatch       un `submit` refusé par RC n'est jamais l'enveloppe — RC-dispatch
 *   transmission   le runtime porte au reviewer d'une unité les kept_consumers du plan validé, par
 *                  la tâche et l'environnement ; au worker, rien — RC-transmission
 *
 * Les propriétés de la règle sont dans `l0-correctif-rc.test.ts`. Montages : `l0-b2-harness.ts`,
 * `stubs/fake-pi.mjs`.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, git, monter, precondition, propriete, revue, tache } from "./l0-b2-harness.ts";
import { REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS } from "../subagent-only/envelope/inspection.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";
import { buildSpawnPlan, NOTE_GARDES } from "../subagent-only/spawn-args.ts";
import { Type } from "typebox";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
const locaux: string[] = [];
test.after(() => {
  for (const d of [...aJeter(), ...locaux]) rmSync(d, { recursive: true, force: true });
});

// Comme dans l0-reprises-r2-harness.test.ts : `envelope.ts` construit son schéma avec `Type.Null`,
// absent du stub partagé de typebox, que la porte TypeScript compile. Ajouté pour ce seul fichier.
(Type as unknown as Record<string, unknown>).Null ??= (options?: Record<string, unknown>) => ({ kind: "null", ...options });

type Resultat = { content: Array<{ text?: string }>; details: Record<string, unknown>; terminate?: boolean };
type Outil = { execute: (id: string, p: Record<string, unknown>) => Promise<Resultat> };
type Gestionnaire = (e: unknown) => Promise<unknown>;

/** Le vrai `submit` et le vrai gestionnaire `tool_result`, chargés comme pi les charge dans l'enfant, dans `cwd`. */
async function enfant(role: string, cwd: string, gardes?: unknown): Promise<{ outil: Outil; resultat?: Gestionnaire }> {
  const avant = { env: { ...process.env }, cwd: process.cwd() };
  process.env.PI_SUBAGENT_ROLE = role;
  delete process.env.PI_SUBAGENT_OPEN_RISKS;
  if (gardes === undefined) delete process.env.PI_SUBAGENT_KEPT_CONSUMERS;
  else process.env.PI_SUBAGENT_KEPT_CONSUMERS = typeof gardes === "string" ? gardes : JSON.stringify(gardes);
  let outil: Outil | undefined;
  let resultat: Gestionnaire | undefined;
  process.chdir(cwd);
  try {
    const m = await import(`../subagent-only/envelope/envelope.ts?rc=${Math.random()}`);
    m.default({
      registerTool: (t: Outil) => { outil = t; },
      on: (nom: string, h: Gestionnaire) => { if (nom === "tool_result") resultat = h; },
    });
  } finally {
    process.chdir(avant.cwd);
    process.env = avant.env;
  }
  precondition(outil !== undefined, "l'extension doit enregistrer submit");
  return { outil: outil!, resultat };
}
const evt = (toolName: string, path: string, isError = false) =>
  ({ type: "tool_result", toolName, toolCallId: `c-${toolName}-${path}`, input: { path }, isError, content: [{ type: "text", text: "…" }] });
const revueSoumise = (verdict: string) => ({
  status: "ok", summary: "jugé", findings: [], verdict, files_reviewed: ["src/pkg/io.py"], open_risks: [],
  top_priority: null, tooling: [],
});
function lane(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-rc-lane-")));
  locaux.push(d);
  mkdirSync(join(d, "tests"), { recursive: true });
  mkdirSync(join(d, "src", "pkg"), { recursive: true });
  writeFileSync(join(d, "tests", "test_config.py"), "import pkg.io as io_mod\n");
  writeFileSync(join(d, "src", "pkg", "run.py"), "from .io import lire\n");
  return d;
}
const GARDES = { unit: "W01", kept: ["tests/test_config.py", "src/pkg/run.py"] };

regressionCorrigee("RC-submit", "le vrai submit refuse un verdict bloquant tant que chaque kept n'a pas été lu par read, sans terminer", async () => {
  const d = lane();
  const { outil, resultat } = await enfant("reviewer", d, GARDES);
  propriete(resultat !== undefined, "le reviewer avec kept_consumers écoute tool_result");
  const r0 = await outil.execute("s0", revueSoumise("needs_rework"));
  const refus0 = r0.details.refus as { code?: string; missing_kept_consumers?: string[] } | undefined;
  propriete(r0.terminate !== true && refus0?.code === REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS &&
    refus0.missing_kept_consumers?.length === 2, `rien lu : refusé sans terminer (${JSON.stringify(r0.details)})`);
  propriete(r0.details.role === undefined, "un refus ne porte aucune enveloppe");
  // grep et read en erreur ne comptent pas ; le gestionnaire ne modifie jamais le résultat.
  propriete(await resultat!(evt("grep", "tests/test_config.py")) === undefined, "le gestionnaire ne modifie pas un résultat");
  await resultat!(evt("read", "tests/test_config.py", true));
  const r1 = await outil.execute("s1", revueSoumise("blocked"));
  propriete(r1.terminate !== true && (r1.details.refus as { missing_kept_consumers?: string[] })?.missing_kept_consumers?.length === 2,
    "grep et read en erreur : toujours refusé");
  await resultat!(evt("read", "tests/test_config.py"));
  const r2 = await outil.execute("s2", revueSoumise("needs_rework"));
  propriete(r2.terminate !== true && JSON.stringify((r2.details.refus as { missing_kept_consumers?: string[] })?.missing_kept_consumers) === JSON.stringify(["src/pkg/run.py"]),
    `un seul lu : refusé, l'autre nommé (${JSON.stringify(r2.details)})`);
  await resultat!(evt("read", join(d, "src", "pkg", "run.py")));
  const r3 = await outil.execute("s3", revueSoumise("needs_rework"));
  propriete(r3.terminate === true && r3.details.role === "reviewer" && r3.details.verdict === "needs_rework", "tous lus : accepté, l'enfant termine");

  const neuf = await enfant("reviewer", d, GARDES);
  const ok = await neuf.outil.execute("s4", revueSoumise("approved"));
  propriete(ok.terminate === true, "approved sans lecture : non concerné");
  const sans = await enfant("reviewer", d);
  propriete(sans.resultat === undefined && (await sans.outil.execute("s5", revueSoumise("needs_rework"))).terminate === true,
    "reviewer sans kept_consumers : aucune écoute, aucune obligation");
  const illisible = await enfant("reviewer", d, "{illisible");
  const ri = await illisible.outil.execute("s6", revueSoumise("blocked"));
  propriete(ri.terminate !== true && typeof (ri.details.refus as { kept_inconnu?: string })?.kept_inconnu === "string",
    "liste illisible : verdict bloquant refusé");
  const worker = await enfant("worker", d, GARDES);
  const w = await worker.outil.execute("s7", { status: "ok", summary: "fait", changed_files: [], validation: "", deviations: [] });
  propriete(worker.resultat === undefined && w.terminate === true, "un autre rôle n'est pas concerné");
});

// ------------------------------------------------------------------ le vrai dispatch

const ICI = dirname(fileURLToPath(import.meta.url));
const AGENT = {
  name: "reviewer", description: "", model: "anthropic/claude-sonnet-5", fallbackModels: [],
  tools: ["read", "ls", "submit"], extensions: [], skills: [], mechanism: [], sliceMode: "none",
  keepTranscript: true, prompt: "", body: "", path: "/dev/null", contextFiles: false, projectBrief: false,
  session: "ephemeral", maxTurns: 10, timeoutMs: 60_000,
} as unknown as AgentDefinition;

regressionCorrigee("RC-dispatch", "un submit refusé par RC n'est jamais l'enveloppe", async () => {
  const { dispatch } = await import("../subagent-only/dispatch.ts");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-rc-")));
  locaux.push(root);
  const g = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  g("add", "-A"); g("commit", "-qm", "base");
  const refuse = {
    type: "tool_execution_end", toolName: "submit",
    result: { details: { refus: { code: REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS, unit: "W01", missing_kept_consumers: ["tests/test_config.py"] } } },
  };
  const avant = { env: process.env.PI_FAKE_ENVELOPE, extra: process.env.PI_FAKE_EXTRA };
  delete process.env.PI_FAKE_ENVELOPE;
  process.env.PI_FAKE_EXTRA = JSON.stringify([refuse]);
  try {
    const r = await dispatch(AGENT, "juger", {
      ctx: { agentDir: root, selfDir: join(ICI, "..", "subagent-only"), runId: "essai", cwd: root } as never,
      seq: 1, artifactDir: join(root, "artefacts"), piPath: join(ICI, "stubs", "fake-pi.mjs"),
    });
    propriete(r.failure === "no_submit" && r.verdict === undefined, `refusé puis rien : aucune enveloppe ni verdict (${String(r.failure)}, ${String(r.verdict)})`);
  } finally {
    if (avant.env === undefined) delete process.env.PI_FAKE_ENVELOPE; else process.env.PI_FAKE_ENVELOPE = avant.env;
    if (avant.extra === undefined) delete process.env.PI_FAKE_EXTRA; else process.env.PI_FAKE_EXTRA = avant.extra;
  }
  assert.ok(true);
});

// ------------------------------------------------------------------ le vrai runtime

regressionCorrigee("RC-transmission", "le runtime porte au reviewer d'une unité les kept_consumers du plan validé, au worker rien", async () => {
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
  await h.outil.execute("rc-1", tache("W03"));
  PILOTE.pendant = undefined;
  await h.outil.execute("rc-2", revue("W03"));
  PILOTE.resultat = undefined;
  const w = APPELS.filter((a) => a.agent === "worker");
  const r = APPELS.filter((a) => a.agent === "reviewer");
  precondition(w.length === 1 && r.length === 1, `un worker puis un reviewer doivent être partis (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(JSON.stringify(r[0].gardes) === JSON.stringify({ unit: "W03", kept: ["src/pkg/run.py"] }),
    `le reviewer reçoit les kept_consumers du plan gelé (${JSON.stringify(r[0].gardes)})`);
  propriete(!w[0].gardes, `le worker n'en reçoit pas (${JSON.stringify(w[0].gardes)})`);

  // Et `buildSpawnPlan` les porte au reviewer, par la tâche et l'environnement, jamais à un autre rôle.
  const ctx = { agentDir: process.cwd(), selfDir: join(ICI, "..", "subagent-only"), runId: "0123456789abcdef", cwd: h.root };
  const gardes = { unit: "W03", kept: ["src/pkg/run.py"] };
  const role = (nom: string, tools: string[]) => ({ ...AGENT, name: nom, tools, sliceMode: "authoring", envelopeRole: undefined }) as unknown as AgentDefinition;
  const derniere = (p: { args: string[] }) => p.args[p.args.length - 1];
  const rev = buildSpawnPlan(role("reviewer", ["read", "ls", "submit"]), "juger", { ...ctx, gardes });
  propriete(rev.env.PI_SUBAGENT_KEPT_CONSUMERS === JSON.stringify(gardes), "le reviewer reçoit la liste par l'environnement");
  propriete(derniere(rev).includes(`${NOTE_GARDES}W03 : src/pkg/run.py.`) && derniere(rev).trimEnd().endsWith("padding it."),
    "et par la tâche, avant la consigne de clôture qui reste la dernière");
  for (const [nom, outils] of [["worker", ["read", "edit", "write", "submit"]], ["scout", ["read", "grep", "submit"]]] as const) {
    const p = buildSpawnPlan(role(nom, [...outils]), "faire", { ...ctx, gardes });
    propriete(p.env.PI_SUBAGENT_KEPT_CONSUMERS === undefined && !derniere(p).includes(NOTE_GARDES), `${nom} : ni variable ni note`);
  }
  const vide = buildSpawnPlan(role("reviewer", ["read", "ls", "submit"]), "juger", { ...ctx, gardes: { unit: "W03", kept: [] } });
  propriete(vide.env.PI_SUBAGENT_KEPT_CONSUMERS === undefined && !derniere(vide).includes(NOTE_GARDES), "liste vide : ni variable ni note");
  assert.ok(true);
});
