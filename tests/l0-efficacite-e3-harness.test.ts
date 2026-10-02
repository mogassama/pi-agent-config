/**
 * l0-efficacite-e3-harness.test.ts — LOT-EFFICACITÉ, E3, dans la vraie extension (plan des leviers v2
 * complétée, § 4.2 et § 4.4).
 *
 *   transmission   un test_command recevable part au premier writer de lane par une note distincte ;
 *                  ni le reviewer ni le scout ne le reçoivent ; une commande établie par P1-A le
 *                  remplace ; un test_command irrecevable ne refuse jamais le plan, sa décision et sa
 *                  raison sont publiées ; la décision est conservée avec la délégation — E3-transmission
 *
 * Montage : `l0-b2-harness.ts` (vraie extension, dispatch substitué) et le vrai `buildSpawnPlan`.
 */
import { test, type TestContext } from "node:test";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, monter, precondition, propriete, revue, tache } from "./l0-b2-harness.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";
import { buildSpawnPlan } from "../subagent-only/spawn-args.ts";
import { NOTE_COMMANDE_DE_TEST, NOTE_COMMANDE_DECLAREE } from "../subagent-only/test-command.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

type Resultat = { isError?: boolean; content?: Array<{ text?: string }>; details?: Record<string, unknown> };
const texte = (r: unknown) => ((r as Resultat).content ?? []).map((c) => c.text ?? "").join("\n");
const COMMANDE = "uv run --extra dev pytest";
const plan = (test_command?: unknown) => ({
  version: 1,
  work_units: [{ id: "W03", goal: "faire", depends_on: [], expected_write_scope: ["src/a.py"] }],
  ...(test_command !== undefined ? { test_command } : {}),
});

regressionCorrigee("E3-transmission", "un test_command recevable part au premier writer, jamais au lecteur, remplacé par la commande établie, et ne refuse jamais le plan", async () => {
  const h = await monter({ plan: plan(COMMANDE) });
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  const r1 = await h.outil.execute("e3-1", tache("W03")) as Resultat;
  PILOTE.pendant = undefined;
  const w1 = APPELS.find((a) => a.agent === "worker");
  propriete(w1?.testCommandDeclaree === COMMANDE && w1.testCommand == null, `le premier worker reçoit la commande déclarée (${JSON.stringify(w1)})`);
  propriete(texte(r1).includes(`test_command transmis au premier writer : ${COMMANDE}`) &&
    JSON.stringify(r1.details?.plan_test_command) === JSON.stringify({ etat: "transmis", commande: COMMANDE }), `décision publiée au gel (${texte(r1).slice(0, 300)})`);
  const trace = JSON.parse(readFileSync(join(h.runDir, `${h.runId}-01-transmis.json`), "utf-8")) as { test_contract?: { transmis?: string; commande?: string } };
  propriete(trace.test_contract?.transmis === "declaree" && trace.test_contract.commande === COMMANDE, `décision conservée avec la délégation (${JSON.stringify(trace)})`);
  await h.outil.execute("e3-2", revue("W03", { verdict: "needs_rework" }));
  PILOTE.resultat = undefined;
  const rv = APPELS.find((a) => a.agent === "reviewer");
  propriete(rv !== undefined && rv.testCommandDeclaree == null && rv.testCommand == null, "le reviewer ne reçoit rien");
  // Une commande établie par P1-A au journal des délégations remplace la commande déclarée.
  appendFileSync(join(h.runDir, `${h.runId}-delegations.jsonl`), `${JSON.stringify({ test_command: "uv run --extra dev pytest -q", test_command_portee: "complete" })}\n`);
  APPELS.length = 0;
  PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
  await h.outil.execute("e3-3", tache("W03"));
  PILOTE.pendant = undefined;
  const w2 = APPELS.find((a) => a.agent === "worker");
  propriete(w2?.testCommand === "uv run --extra dev pytest -q" && w2.testCommandDeclaree == null,
    `commande établie : elle remplace la déclarée (${JSON.stringify(w2)})`);

  // Le vrai buildSpawnPlan : note distincte au writer, rien au lecteur, l'établie l'emporte.
  const ICI = dirname(fileURLToPath(import.meta.url));
  const ctx = { agentDir: process.cwd(), selfDir: join(ICI, "..", "subagent-only"), runId: h.runId, cwd: h.root };
  const role = (nom: string, tools: string[]) => ({
    name: nom, description: "", model: "m", fallbackModels: [], tools, extensions: [], skills: [], mechanism: [], sliceMode: "none",
    keepTranscript: true, prompt: "", body: "", path: "/dev/null", contextFiles: false, projectBrief: false, session: "ephemeral",
    maxTurns: 10, timeoutMs: 60_000,
  }) as unknown as AgentDefinition;
  const derniere = (p: { args: string[] }) => p.args[p.args.length - 1];
  const worker = buildSpawnPlan(role("worker", ["read", "edit", "write", "submit"]), "faire", { ...ctx, testCommandDeclaree: COMMANDE } as never);
  propriete(derniere(worker).includes(`${NOTE_COMMANDE_DECLAREE}\`${COMMANDE}\``) && !derniere(worker).includes(NOTE_COMMANDE_DE_TEST), "le worker reçoit la note déclarée, distincte");
  const lecteur = buildSpawnPlan(role("reviewer", ["read", "ls", "submit"]), "juger", { ...ctx, testCommandDeclaree: COMMANDE } as never);
  propriete(!derniere(lecteur).includes(NOTE_COMMANDE_DECLAREE), "un rôle en lecture ne la reçoit pas");
  const les2 = buildSpawnPlan(role("worker", ["read", "edit", "write", "submit"]), "faire", { ...ctx, testCommand: "pytest -q", testCommandDeclaree: COMMANDE } as never);
  propriete(derniere(les2).includes(`${NOTE_COMMANDE_DE_TEST}\`pytest -q\``) && !derniere(les2).includes(NOTE_COMMANDE_DECLAREE), "l'établie l'emporte sur la déclarée");

  // Irrecevable : le plan n'est jamais refusé ; la décision et sa raison sont publiées ; rien n'est transmis.
  const h2 = await monter({ plan: plan("uv run pytest || true") });
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  const r2 = await h2.outil.execute("e3-4", tache("W03")) as Resultat;
  PILOTE.pendant = undefined;
  const w3 = APPELS.find((a) => a.agent === "worker" && a.cwd?.startsWith(h2.root));
  propriete(r2.isError !== true && w3 !== undefined && w3.testCommandDeclaree == null,
    `test_command irrecevable : plan accepté, rien de transmis (${texte(r2).slice(0, 200)})`);
  propriete((r2.details?.plan_test_command as { etat?: string } | undefined)?.etat === "ignore" && texte(r2).includes("test_command ignoré"),
    `décision « ignoré » et sa raison publiées (${JSON.stringify(r2.details?.plan_test_command)})`);
});
