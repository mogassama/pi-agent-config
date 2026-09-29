/**
 * l0-ite-p1d-harness.test.ts — lot ITE, P1-D : le résultat `task` d'un worker porte ce que
 * l'orchestrateur allait relire (plan P1 v2 gelé, `fbf65045`).
 *
 * Le constat (QD-P0, `ec276ba9`) : après chaque worker, un tour entier de l'orchestrateur a servi à
 * relire l'artefact `.json` avant de lancer la revue. Ce qu'il y cherchait :
 *
 *   ligne        fichiers observés, tests déclarés, et la phrase qui dit que le diff part au
 *                reviewer ; rien pour un autre rôle ni pour un échec — ITE-P1D-ligne
 *   résultat     la ligne atteint réellement le texte rendu à l'orchestrateur — ITE-P1D-resultat
 *   validation   le champ `validation` de l'enveloppe traverse `dispatch` jusqu'au runtime — le vrai
 *                `dispatch`, avec un faux `pi` au bout du spawn — ITE-P1D-validation
 *
 * Montage : `l0-b2-harness.ts` ; `stubs/fake-pi.mjs` pour la traversée de `dispatch`.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, monter, precondition, propriete, revue, tache, texte } from "./l0-b2-harness.ts";
import { ligneWorker, NOTE_DIFF_AU_REVIEWER } from "../subagent-only/counts.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
const locaux: string[] = [];
test.after(() => {
  for (const d of [...aJeter(), ...locaux]) rmSync(d, { recursive: true, force: true });
});

regressionCorrigee("ITE-P1D-ligne", "la ligne d'un worker porte les fichiers observés, les tests déclarés et le diff transmis ; rien pour un autre rôle ni pour un échec", () => {
  const l = ligneWorker({ role: "worker", changedFiles: ["src/a.py", "tests/test_a.py"], validation: "uv run pytest\n(120 passed)" });
  propriete(l.includes("fichiers modifiés : src/a.py, tests/test_a.py"), `fichiers (${l})`);
  propriete(l.includes("tests déclarés : uv run pytest (120 passed)"), `tests, sur une ligne (${l})`);
  propriete(l.includes(NOTE_DIFF_AU_REVIEWER), "la phrase qui dit que le diff part au reviewer");
  propriete(ligneWorker({ role: "worker", changedFiles: [] }).includes("tests déclarés : non déclarés"), "sans validation : dit comme tel");
  propriete(ligneWorker({ role: "worker", changedFiles: [], validation: "x".repeat(1000) }).length < 600, "une validation longue est tronquée");
  propriete(ligneWorker({ role: "reviewer", changedFiles: ["a"], validation: "v" }) === "", "un autre rôle : rien");
  propriete(ligneWorker({ role: "worker", failure: "max_turns", changedFiles: ["a"] }) === "", "un échec : rien");
});

regressionCorrigee("ITE-P1D-resultat", "le texte rendu à l'orchestrateur pour un worker porte la ligne, et pas celui d'une revue", async () => {
  const h = await monter();
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  PILOTE.resultat = { validation: "uv run pytest (3 passed)" } as never;
  const r = await h.outil.execute("p1d-1", tache("W03"));
  PILOTE.pendant = undefined;
  PILOTE.resultat = undefined;
  const t = texte(r);
  precondition(t.startsWith("[worker: ok"), `le worker doit revenir ok (${t.slice(0, 120)})`);
  propriete(t.includes("fichiers modifiés : src/a.py"), `les fichiers observés sont dans le résultat (${t.slice(0, 300)})`);
  propriete(t.includes("tests déclarés : uv run pytest (3 passed)"), "les tests déclarés sont dans le résultat");
  propriete(t.includes(NOTE_DIFF_AU_REVIEWER), "la phrase sur le diff est dans le résultat");
  const rv = texte(await h.outil.execute("p1d-2", revue("W03")));
  propriete(!rv.includes(NOTE_DIFF_AU_REVIEWER), `une revue ne porte pas la ligne du worker (${rv.slice(0, 200)})`);
});

// ------------------------------------------------------------------ le vrai dispatch

const ICI = dirname(fileURLToPath(import.meta.url));
const FAUX_PI = join(ICI, "stubs", "fake-pi.mjs");
const SELF = join(ICI, "..", "subagent-only");
const AGENT = {
  name: "worker", description: "", model: "anthropic/claude-sonnet-5", fallbackModels: [],
  tools: ["read", "edit", "write", "submit"], extensions: [], skills: [], mechanism: [], sliceMode: "none",
  keepTranscript: true, prompt: "", body: "", path: "/dev/null", contextFiles: false, projectBrief: false,
  session: "ephemeral", maxTurns: 10, timeoutMs: 60_000,
} as unknown as AgentDefinition;

async function courir(envelope: Record<string, unknown>) {
  const { dispatch } = await import("../subagent-only/dispatch.ts");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-p1d-")));
  locaux.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const avant = { env: process.env.PI_FAKE_ENVELOPE, extra: process.env.PI_FAKE_EXTRA };
  process.env.PI_FAKE_ENVELOPE = JSON.stringify(envelope);
  process.env.PI_FAKE_EXTRA = "[]";
  try {
    return await dispatch(AGENT, "faire la chose", {
      ctx: { agentDir: root, selfDir: SELF, runId: "essai", cwd: root } as never,
      seq: 1, artifactDir: join(root, "artefacts"), piPath: FAUX_PI,
    });
  } finally {
    if (avant.env === undefined) delete process.env.PI_FAKE_ENVELOPE; else process.env.PI_FAKE_ENVELOPE = avant.env;
    if (avant.extra === undefined) delete process.env.PI_FAKE_EXTRA; else process.env.PI_FAKE_EXTRA = avant.extra;
  }
}

regressionCorrigee("ITE-P1D-validation", "le champ validation de l'enveloppe traverse dispatch jusqu'au runtime", async () => {
  const r = await courir({ status: "ok", summary: "fait", changed_files: [], validation: "uv run pytest (3 passed)", deviations: [] });
  precondition(!r.failure, `l'enfant doit avoir soumis (${String(r.failure)})`);
  propriete(r.validation === "uv run pytest (3 passed)", `validation traversée (${String(r.validation)})`);
  const mauvais = await courir({ status: "ok", summary: "fait", changed_files: [], validation: 7, deviations: [] });
  propriete(mauvais.validation === undefined, "un champ du mauvais type ne devient pas une validation");
  assert.ok(true);
});
