/**
 * dispatch-harness.test.ts — ce que l'enveloppe rend au runtime, pour de vrai.
 *
 * `dispatch` transforme une enveloppe d'enfant en `RunResult`, et cinq de ses
 * champs se lisaient sans qu'aucun test ne les traverse : le seul harnais qui
 * allait jusque-là substitue `dispatch` entier. Retirer n'importe laquelle de
 * ces lectures ne cassait rien — un test vert sans objet, exactement le motif
 * que ce chantier a formalisé.
 *
 * Rien n'est substitué ici. `runOnce` lance `opts.piPath`, donc un faux `pi` qui
 * écrit le flux attendu suffit : vrai processus, vrai parseur, vraie
 * construction du résultat. Le seul artifice est le programme au bout du spawn.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dispatch } from "../subagent-only/dispatch.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";

const ICI = dirname(fileURLToPath(import.meta.url));
const FAUX_PI = join(ICI, "stubs", "fake-pi.mjs");
// `selfDir` réel : `spawn-args` y cherche `role-guard`, et injecter un faux
// répertoire ferait passer le harnais à côté de cette exigence.
const SELF = join(ICI, "..", "subagent-only");

const dossiers: string[] = [];
after(() => {
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-dispatch-")));
  dossiers.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  return dir;
}

const AGENT = {
  name: "worker",
  description: "",
  model: "anthropic/claude-sonnet-5",
  fallbackModels: [],
  tools: ["read", "edit", "write", "submit"],
  extensions: [],
  skills: [],
  mechanism: [],
  sliceMode: "none",
  keepTranscript: true,
  prompt: "",
  body: "",
  path: "/dev/null",
  contextFiles: false,
  projectBrief: false,
  session: "ephemeral",
  maxTurns: 10,
  timeoutMs: 60_000,
} as unknown as AgentDefinition;

/** Un enfant qui rend cette enveloppe, et rien d'autre. */
async function courir(envelope: Record<string, unknown>, extra: unknown[] = [], role = "worker") {
  const root = repo();
  // Absolu, et dans le dépôt jetable : `artifactDir` est pris tel quel, donc un
  // chemin relatif se résout depuis le cwd du processus de test — la première
  // version a écrit ses artefacts dans le dépôt qu'elle testait.
  const artefacts = join(root, "artefacts");
  const precedent = {
    env: process.env.PI_FAKE_ENVELOPE,
    extra: process.env.PI_FAKE_EXTRA,
  };
  process.env.PI_FAKE_ENVELOPE = JSON.stringify(envelope);
  process.env.PI_FAKE_EXTRA = JSON.stringify(extra);
  try {
    return await dispatch({ ...AGENT, name: role } as AgentDefinition, "faire la chose", {
      ctx: { agentDir: root, selfDir: SELF, runId: "essai", cwd: root } as never,
      seq: 1,
      artifactDir: artefacts,
      piPath: FAUX_PI,
    });
  } finally {
    if (precedent.env === undefined) delete process.env.PI_FAKE_ENVELOPE;
    else process.env.PI_FAKE_ENVELOPE = precedent.env;
    if (precedent.extra === undefined) delete process.env.PI_FAKE_EXTRA;
    else process.env.PI_FAKE_EXTRA = precedent.extra;
  }
}

test("les deviations traversent jusqu'au runtime", async () => {
  /*
   * Le champ qui a motivé ce harnais : depuis 3c.1d.2, une déviation non vide
   * termine une tentative d'intégration et renvoie l'unité dans sa lane. La
   * ligne qui la transporte n'était traversée par rien.
   */
  const r = await courir({
    status: "ok",
    summary: "résolu",
    deviations: ["src/b.py doit aussi changer"],
  });
  assert.deepEqual(r.deviations, ["src/b.py doit aussi changer"]);
});

test("une enveloppe sans deviations n'en invente pas", async () => {
  /*
   * `undefined` et `[]` ne disent pas la même chose : le rôle ne déclare pas ce
   * champ, ou il le déclare vide. Aucun des deux ne termine une tentative — le
   * runtime abandonne sur `deviations.length > 0`, donc seule une déviation
   * nommée le fait. La distinction reste un contrat de transport, et elle
   * compterait si quelqu'un voulait un jour distinguer « rien à signaler » de
   * « ce rôle ne signale pas ».
   */
  const r = await courir({ status: "ok", summary: "fait" });
  assert.equal(r.deviations, undefined);
  const vide = await courir({ status: "ok", summary: "fait", deviations: [] });
  assert.deepEqual(vide.deviations, []);
});

test("le verdict, les risques résolus et la recommandation traversent aussi", async () => {
  // Le même trou, depuis toujours, sur quatre autres champs.
  const r = await courir({
    status: "ok",
    summary: "revu",
    verdict: "needs_rework",
    resolved_risks: ["R1", "R2"],
    recommendation: "reprendre le nommage",
    top_priority: "corriger le nommage de la table",
    findings: [{ severity: "MEDIUM", confidence: "probable", location: "src/a.py:12",
      issue: "nom ambigu", fix: "renommer" }],
  }, [], "reviewer");
  assert.equal(r.verdict, "needs_rework");
  assert.deepEqual(r.resolvedRisks, ["R1", "R2"]);
  assert.equal(r.recommendation, "reprendre le nommage");
  // L'action est dérivée du verdict et des constats, pas recopiée : elle
  // n'existe que pour un verdict qui n'est pas `approved`.
  assert.equal(r.action?.topPriority, "corriger le nommage de la table");
  assert.equal(r.action?.findings?.length, 1);
});

test("un champ du mauvais type ne devient pas un champ vide", async () => {
  const r = await courir({
    status: "ok",
    summary: "fait",
    deviations: "une chaîne",
    verdict: 7,
    resolved_risks: { a: 1 },
  });
  assert.equal(r.deviations, undefined);
  assert.equal(r.verdict, undefined);
  assert.equal(r.resolvedRisks, undefined);
});

test("les entrées non textuelles d'un tableau sont écartées", async () => {
  const r = await courir({
    status: "ok",
    summary: "fait",
    deviations: ["a", 7, null, { x: 1 }, "b"],
  });
  assert.deepEqual(r.deviations, ["a", "b"]);
});

test("un enfant qui ne soumet rien est un échec, pas une enveloppe vide", async () => {
  const root = repo();
  const precedent = process.env.PI_FAKE_ENVELOPE;
  delete process.env.PI_FAKE_ENVELOPE;
  try {
    const r = await dispatch(AGENT, "faire la chose", {
      ctx: { agentDir: root, selfDir: SELF, runId: "essai", cwd: root } as never,
      seq: 1,
      // Sans `artifactDir`, `dispatch` retombe sur `cwd/.pi-subagent-runs` — et
      // le cwd d'un test est la racine du dépôt qu'il teste. Ce test-là y a
      // écrit ses deux artefacts jusqu'à ce lot ; le défaut était le même que
      // celui déjà corrigé dans `courir`, à un appel près.
      artifactDir: join(root, "artefacts"),
      piPath: FAUX_PI,
    });
    assert.equal(r.failure, "no_submit");
    assert.equal(r.deviations, undefined);
    assert.equal(r.verdict, undefined);
  } finally {
    if (precedent !== undefined) process.env.PI_FAKE_ENVELOPE = precedent;
  }
});

test("le résumé et le compte de tours viennent du flux, pas de l'enveloppe seule", async () => {
  const r = await courir({ status: "ok", summary: "  ce qui a été fait  " }, [
    { type: "turn_end" },
    { type: "turn_end" },
  ]);
  assert.equal(r.summary, "ce qui a été fait");
  // Deux tours du flux plus celui que le faux pi émet en dernier.
  assert.equal(r.turns, 3);
});

test("aucun artefact n'a été écrit dans le dépôt qui héberge le harnais", () => {
  /*
   * Le garde-fou, en dernier et visant la vraie racine — pas un dépôt jetable.
   * `.pi-subagent-runs/` étant ignoré par git, une fuite ne se voyait ni au
   * `status` ni à la revue : elle ne se voit qu'ici.
   *
   * Il porte sur les deux noms exacts que ce fichier produit. Une assertion sur
   * l'absence du répertoire entier serait plus large et plus fragile : une
   * session pi ouverte à la racine en crée un légitimement.
   */
  const racine = join(ICI, "..");
  for (const nom of ["essai-01-worker.json", "essai-01-worker.jsonl"]) {
    assert.equal(
      existsSync(join(racine, ".pi-subagent-runs", nom)),
      false,
      `${nom} a été écrit dans le dépôt lui-même`,
    );
  }
});
