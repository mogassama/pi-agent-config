/**
 * l0-reprises-r2-harness.test.ts — LOT-REPRISES, R2, dans le vrai `submit`, le vrai `dispatch` et le
 * vrai runtime (PLAN-LOT-REPRISES v2 gelé, `1a840043`, § 3, Q3 et Q4).
 *
 *   submit       l'outil `submit` du reviewer refuse `approved` avec un risque restant ouvert, sans
 *                terminer et avec un refus structuré ; il accepte `needs_rework` et un `approved`
 *                propre ; un autre rôle n'est pas concerné — R2-submit
 *   dispatch     un `submit` refusé n'est jamais pris pour l'enveloppe : seul vaut celui qui est
 *                accepté ; sans lui, l'enfant n'a rien soumis — R2-dispatch
 *   projection   le runtime porte au reviewer d'une unité les ids encore ouverts au registre et
 *                ceux qui lui sont remis ; au worker, rien — R2-transmission
 *
 * Les propriétés de la règle sont dans `l0-reprises-r2.test.ts`. Montages : `l0-b2-harness.ts`,
 * `stubs/fake-pi.mjs`.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, monter, precondition, propriete, revue, tache } from "./l0-b2-harness.ts";
import { REVIEW_APPROVED_WITH_OPEN_RISKS } from "../subagent-only/envelope/approbation.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";
import { buildSpawnPlan } from "../subagent-only/spawn-args.ts";
import { Type } from "typebox";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
const locaux: string[] = [];
test.after(() => {
  for (const d of [...aJeter(), ...locaux]) rmSync(d, { recursive: true, force: true });
});

type Outil = { execute: (id: string, p: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }>; details: Record<string, unknown>; terminate?: boolean }> };

/*
 * `envelope.ts` construit son schéma avec `Type.Null`, que le stub de typebox ne liste pas : le
 * harnais d'`execute` n'en a jamais eu besoin. Ajouté ici, pour ce seul fichier, plutôt qu'au stub
 * partagé : le stub reste celui que compile la porte TypeScript.
 */
(Type as unknown as Record<string, unknown>).Null ??= (options?: Record<string, unknown>) => ({ kind: "null", ...options });

/** Le vrai outil `submit`, chargé comme pi le charge dans l'enfant. */
async function submitDe(role: string, projection?: unknown): Promise<Outil> {
  const avant = { ...process.env };
  process.env.PI_SUBAGENT_ROLE = role;
  if (projection === undefined) delete process.env.PI_SUBAGENT_OPEN_RISKS;
  else process.env.PI_SUBAGENT_OPEN_RISKS = JSON.stringify(projection);
  let outil: Outil | undefined;
  try {
    const m = await import(`../subagent-only/envelope/envelope.ts?r2=${Math.random()}`);
    m.default({ registerTool: (t: Outil) => { outil = t; }, on() {} });
  } finally {
    process.env = avant;
  }
  precondition(outil !== undefined, "l'extension doit enregistrer submit");
  return outil!;
}
const revueSoumise = (verdict: string, extra: Record<string, unknown> = {}) => ({
  status: "ok", summary: "jugé", findings: [], verdict, files_reviewed: ["src/a.py"], open_risks: [],
  top_priority: null, tooling: [], ...extra,
});

regressionCorrigee("R2-submit", "le submit du reviewer refuse approved avec un risque restant, sans terminer, et accepte le reste", async () => {
  const outil = await submitDe("reviewer", { ids: ["r-1"], remis: ["r-1"] });
  const refuse = await outil.execute("s1", revueSoumise("approved", { open_risks: ["où vit X ?"], resolved_risks: ["r-1"] }));
  const refus = refuse.details.refus as { code?: string; new_open_risks?: number } | undefined;
  propriete(refuse.terminate !== true, "le refus ne termine pas l'enfant");
  propriete(refus?.code === REVIEW_APPROVED_WITH_OPEN_RISKS && refus.new_open_risks === 1, `refus structuré (${JSON.stringify(refuse.details)})`);
  propriete(refuse.details.role === undefined, "un refus ne porte aucune enveloppe");
  const nonFerme = await outil.execute("s2", revueSoumise("approved"));
  propriete(nonFerme.terminate !== true && (nonFerme.details.refus as { open_risk_ids?: string[] })?.open_risk_ids?.includes("r-1") === true,
    "un risque remis non fermé : refusé, et nommé");
  const ok = await outil.execute("s3", revueSoumise("approved", { resolved_risks: ["r-1"] }));
  propriete(ok.terminate === true && ok.details.role === "reviewer", "fermé : approved accepté, l'enfant termine");
  const rework = await outil.execute("s4", revueSoumise("needs_rework", { open_risks: ["où vit X ?"] }));
  propriete(rework.terminate === true && rework.details.verdict === "needs_rework", "needs_rework + open_risks : accepté");
  const worker = await submitDe("worker", { ids: ["r-1"], remis: [] });
  const w = await worker.execute("s5", { status: "ok", summary: "fait", changed_files: [], validation: "", deviations: [] });
  propriete(w.terminate === true, "un autre rôle n'est pas concerné");
});

// ------------------------------------------------------------------ le vrai dispatch

const ICI = dirname(fileURLToPath(import.meta.url));
const AGENT = {
  name: "reviewer", description: "", model: "anthropic/claude-sonnet-5", fallbackModels: [],
  tools: ["read", "ls", "submit"], extensions: [], skills: [], mechanism: [], sliceMode: "none",
  keepTranscript: true, prompt: "", body: "", path: "/dev/null", contextFiles: false, projectBrief: false,
  session: "ephemeral", maxTurns: 10, timeoutMs: 60_000,
} as unknown as AgentDefinition;

async function courir(extra: unknown[], envelope?: Record<string, unknown>) {
  const { dispatch } = await import("../subagent-only/dispatch.ts");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-r2-")));
  locaux.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const avant = { env: process.env.PI_FAKE_ENVELOPE, extra: process.env.PI_FAKE_EXTRA };
  if (envelope) process.env.PI_FAKE_ENVELOPE = JSON.stringify(envelope); else delete process.env.PI_FAKE_ENVELOPE;
  process.env.PI_FAKE_EXTRA = JSON.stringify(extra);
  try {
    return await dispatch(AGENT, "juger", {
      ctx: { agentDir: root, selfDir: join(ICI, "..", "subagent-only"), runId: "essai", cwd: root } as never,
      seq: 1, artifactDir: join(root, "artefacts"), piPath: join(ICI, "stubs", "fake-pi.mjs"),
    });
  } finally {
    if (avant.env === undefined) delete process.env.PI_FAKE_ENVELOPE; else process.env.PI_FAKE_ENVELOPE = avant.env;
    if (avant.extra === undefined) delete process.env.PI_FAKE_EXTRA; else process.env.PI_FAKE_EXTRA = avant.extra;
  }
}
const refuseEvt = {
  type: "tool_execution_end", toolName: "submit",
  result: { details: { refus: { code: REVIEW_APPROVED_WITH_OPEN_RISKS, new_open_risks: 1, open_risk_ids: [] } } },
};

regressionCorrigee("R2-dispatch", "un submit refusé n'est jamais l'enveloppe : seul compte celui qui est accepté", async () => {
  const seul = await courir([refuseEvt]);
  propriete(seul.failure === "no_submit", `refusé puis rien : l'enfant n'a rien soumis (${String(seul.failure)})`);
  propriete(seul.verdict === undefined, `aucun verdict publié (${String(seul.verdict)})`);
  const ensuite = await courir([refuseEvt], { status: "ok", summary: "jugé", verdict: "needs_rework", findings: [], open_risks: ["où vit X ?"] });
  propriete(!ensuite.failure && ensuite.verdict === "needs_rework", `la soumission acceptée fait foi (${String(ensuite.verdict)})`);
  assert.ok(true);
});

regressionCorrigee("R2-transmission", "le runtime porte au reviewer d'une unité ses risques ouverts et ceux qui lui sont remis, au worker rien", async () => {
  const h = await monter();
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("r2-1", tache("W03"));
  PILOTE.pendant = undefined;
  await h.outil.execute("r2-2", revue("W03", { openRiskItems: [{ id: "r-x", text: "où vit X ?" }] }));
  PILOTE.resultat = undefined;
  const revues = () => APPELS.filter((a) => a.agent === "reviewer");
  precondition(revues().length === 1, `une revue doit être partie (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(JSON.stringify(revues()[0].risquesOuverts) === JSON.stringify({ ids: [], remis: [] }),
    `la première revue part sans risque ouvert (${JSON.stringify(revues()[0].risquesOuverts)})`);
  const ouverts = h.evenements().filter((e) => e.event === "RISK" && e.transition === "opened" && e.work_unit === "W03");
  precondition(ouverts.length === 1, `le risque doit être ouvert au registre (${JSON.stringify(ouverts)})`);
  const id = String(ouverts[0].id);
  // Le pont existant : le scout porte le risque (`routed`, toujours ouvert), puis la revue de suite.
  await h.outil.execute("r2-s", { agent: "scout", work_unit: "W03", task: "porter", find: "où vit X", scope: ["src/"], for_risks: [id] });
  await h.outil.execute("r2-3", { ...revue("W03"), for_risks: [id] });
  PILOTE.resultat = undefined;
  precondition(revues().length === 2, `une revue de suite doit être partie (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(JSON.stringify(revues()[1].risquesOuverts) === JSON.stringify({ ids: [id], remis: [id] }),
    `la revue de suite reçoit le risque ouvert et remis (${JSON.stringify(revues()[1].risquesOuverts)})`);
  const w = APPELS.filter((a) => a.agent === "worker");
  propriete(w.length === 1 && !w[0].risquesOuverts, "le worker ne reçoit aucune projection");

  // Et `buildSpawnPlan` la passe à l'enfant reviewer par l'environnement, jamais à un autre rôle.
  const ctx = { agentDir: process.cwd(), selfDir: join(ICI, "..", "subagent-only"), runId: "0123456789abcdef", cwd: h.root };
  const projection = { ids: [id], remis: [id] };
  const role = (nom: string, tools: string[]) => ({ ...AGENT, name: nom, tools, sliceMode: "authoring", envelopeRole: undefined }) as unknown as AgentDefinition;
  const pourReviewer = buildSpawnPlan(role("reviewer", ["read", "ls", "submit"]), "juger", { ...ctx, risquesOuverts: projection });
  propriete(pourReviewer.env.PI_SUBAGENT_OPEN_RISKS === JSON.stringify(projection), "le reviewer reçoit la projection");
  const pourWorker = buildSpawnPlan(role("worker", ["read", "edit", "write", "submit"]), "faire", { ...ctx, risquesOuverts: projection });
  propriete(pourWorker.env.PI_SUBAGENT_OPEN_RISKS === undefined, "un autre rôle ne la reçoit pas");
  assert.ok(true);
});
