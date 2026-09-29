/**
 * l0-ite-p1a-harness.test.ts — lot ITE, P1-A : la note, et son transport d'un writer au suivant.
 *
 *   note        `buildSpawnPlan` la porte aux seuls rôles qui écrivent, après la tâche et avant la
 *               consigne de clôture ; sans commande, rien — ITE-P1A-note
 *   transport   la commande observée dans la transcription d'un worker est inscrite à SA ligne du
 *               journal des délégations, puis relue au journal pour le writer suivant du même run ;
 *               un rôle en lecture n'en reçoit jamais, un autre run jamais — ITE-P1A-transport
 *
 * Les propriétés de l'extraction elle-même sont dans `l0-ite-p1a.test.ts`. Montage : `l0-b2-harness.ts`.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, monter, precondition, propriete, tache } from "./l0-b2-harness.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";
import { buildSpawnPlan } from "../subagent-only/spawn-args.ts";
import { NOTE_COMMANDE_DE_TEST } from "../subagent-only/test-command.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
const locaux: string[] = [];
test.after(() => {
  for (const d of [...aJeter(), ...locaux]) rmSync(d, { recursive: true, force: true });
});

const COMPLETE = 'PYTHON="$(uv run --extra dev python -c \'import sys; print(sys.executable)\')" && PYSPARK_PYTHON="$PYTHON" uv run --extra dev pytest';
const SUCCES = "======================= 120 passed, 1 warning in 49.84s ========================\n";

/** Une transcription d'enfant où la commande a tourné et réussi, et l'artefact qui la désigne. */
function transcription(dir: string, nom: string, commande = COMPLETE): string {
  const artefact = join(dir, `${nom}.json`);
  writeFileSync(artefact, "{}\n");
  writeFileSync(join(dir, `${nom}.jsonl`), [
    JSON.stringify({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: commande } }),
    JSON.stringify({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", isError: false, result: { content: [{ type: "text", text: SUCCES }] } }),
  ].join("\n") + "\n");
  return artefact;
}

function role(nom: string, tools: string[]): AgentDefinition {
  return {
    name: nom, description: "", model: "openai-codex/gpt-5.6-terra", tools, extensions: [], skills: [],
    mechanism: [], sliceMode: "authoring", contextFiles: false, projectBrief: false, session: "ephemeral",
    prompt: "rôle",
  } as unknown as AgentDefinition;
}
const tacheDe = (args: string[]) => args[args.length - 1];

regressionCorrigee("ITE-P1A-note", "la note est portée aux seuls rôles qui écrivent, et absente sans commande", () => {
  const d = mkdtempSync(join(tmpdir(), "pi-l0-p1a-note-"));
  locaux.push(d);
  const ctx = { agentDir: process.cwd(), selfDir: join(process.cwd(), "subagent-only"), runId: "0123456789abcdef", cwd: d };
  const worker = role("worker", ["read", "bash", "edit", "write", "submit"]);
  const reviewer = role("reviewer", ["read", "ls", "submit"]);
  const avec = tacheDe(buildSpawnPlan(worker, "faire W01", { ...ctx, testCommand: COMPLETE }).args);
  propriete(avec.includes(`${NOTE_COMMANDE_DE_TEST}\`${COMPLETE}\``), "le worker reçoit la commande établie");
  propriete(avec.indexOf(NOTE_COMMANDE_DE_TEST) > avec.indexOf("faire W01") && avec.trimEnd().endsWith("padding it."),
    "la note suit la tâche et précède la consigne de clôture, qui reste la dernière");
  const lecteur = tacheDe(buildSpawnPlan(reviewer, "juger W01", { ...ctx, testCommand: COMPLETE }).args);
  propriete(!lecteur.includes(NOTE_COMMANDE_DE_TEST), "un rôle en lecture ne la reçoit jamais");
  for (const vide of [undefined, null, ""]) {
    const sans = tacheDe(buildSpawnPlan(worker, "faire W01", { ...ctx, testCommand: vide }).args);
    propriete(!sans.includes(NOTE_COMMANDE_DE_TEST), `sans commande (${String(vide)}), aucune note`);
  }
});

regressionCorrigee("ITE-P1A-transport", "la commande observée chez un worker est inscrite au journal et portée au writer suivant du même run, jamais à un lecteur", async () => {
  const h = await monter();
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  const d = mkdtempSync(join(tmpdir(), "pi-l0-p1a-art-"));
  locaux.push(d);

  // Premier worker : aucune commande établie, rien n'est porté ; la sienne est observée.
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  PILOTE.resultat = { artifact: transcription(d, `${h.runId}-01-worker`) } as never;
  await h.outil.execute("p1a-1", tache("W03"));
  PILOTE.pendant = undefined;
  PILOTE.resultat = undefined;
  const premier = APPELS.filter((a) => a.agent === "worker");
  precondition(premier.length === 1, `un worker doit être parti (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(!premier[0].testCommand, `le premier worker ne reçoit rien (${String(premier[0].testCommand)})`);
  const lignes = h.journal().filter((l) => l.role === "worker");
  propriete(lignes.length === 1 && lignes[0].test_command === COMPLETE,
    `la ligne du worker porte la commande observée (${JSON.stringify(lignes.map((l) => l.test_command))})`);

  // Un scout, en lecture : jamais de commande.
  await h.outil.execute("p1a-2", { agent: "scout", work_unit: "W03", task: "localiser", find: "où est a.py", scope: ["src"] });
  const scout = APPELS.filter((a) => a.agent === "scout");
  precondition(scout.length === 1, `un scout doit être parti (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(!scout[0].testCommand, "un rôle en lecture ne reçoit jamais la commande");

  // Worker suivant, autre unité du même run : la commande est portée.
  PILOTE.pendant = ecrire("src/b.py", "b = 2\n");
  await h.outil.execute("p1a-3", tache("W09"));
  PILOTE.pendant = undefined;
  const second = APPELS.filter((a) => a.agent === "worker");
  precondition(second.length === 2, `un second worker doit être parti (${APPELS.map((a) => a.agent).join(",")})`);
  propriete(second[1].testCommand === COMPLETE, `le writer suivant reçoit la commande du run (${String(second[1].testCommand)})`);

  // Un autre run sur un autre dépôt : rien de ce journal ne traverse.
  const autre = await monter();
  precondition(autre.runId !== h.runId, "les deux runs doivent différer");
  PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
  await autre.outil.execute("p1a-4", tache("W03"));
  PILOTE.pendant = undefined;
  const dernier = APPELS.filter((a) => a.agent === "worker");
  propriete(!dernier[dernier.length - 1].testCommand, "un autre run ne reçoit pas la commande de celui-ci");
  assert.ok(true);
});
