/**
 * l0-profil-harness.test.ts — phase 2, application du profil sur l'extension (H).
 *
 * Plan v3.1 § 12.2. Chaque preuve est une couverture : verte sur le candidat, rouge sur son
 * mutant (tests/l0-mutants.json, M-H). L'extension `subagent` est chargée sous le chargeur de
 * substitution, avec une API de pi qui retient ce qu'on lui donne : outils enregistrés, liste
 * active, commandes et handlers. Les événements sont émis comme pi 0.86.0 les émet ; le prompt
 * est rendu comme `system-prompt.js` le rend (`rendrePrompt`, l0-b2-harness.ts).
 *
 * Périmètre des inventaires (§ 5.4) : l'espace des runs et le répertoire du dépôt — chemins,
 * octets, modes, inodes aux points de relevé. Le journal de session de pi, le répertoire de
 * l'agent et les fichiers des autres extensions en sont exclus : ils ne sont pas dans le
 * dépôt d'épreuve.
 *
 * Sondes git (H04) : comptées par le compteur de la base et identifiées par une cale `git`
 * placée en tête de PATH, qui consigne chaque invocation puis lance le vrai git.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync,
  rmSync, utimesSync, writeFileSync,
} from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { APPELS, PILOTE, reinitialiser } from "./stubs/dispatch.ts";
import {
  contexteDEpreuve, evenementAvantAgent, optionsDEpreuve, rendrePrompt,
  type Commande, type Harnais, type Notification, type OptionsDEpreuve, type Rappel,
} from "./l0-b2-harness.ts";
import { designMd, etatCanonique, planAvecDesign } from "./l0-b3-fixtures.ts";
import { readGitInvocationCount } from "../subagent-only/git-probe-counter.ts";
import { observeIntegrations } from "../subagent-only/integration-observe.ts";
import { observeLanes } from "../subagent-only/lane-observe.ts";
import { instrumentationIgnored } from "../subagent-only/repo-preflight.ts";
import { cheminNatif, SOURCE_NATIVE } from "../subagent-only/pi-adapt.ts";
import { acquireRunOwnership, openRun, planHash, readLaneEvents, releaseRunOwnership, type Lease } from "../subagent-only/run-manifest.ts";
import {
  blocDeDelegation, lignesDeGuidelines, REFUS_DELEGATION_NON_COMPOSEE, REFUS_PROFIL_SIMPLE,
} from "../subagent-only/profil.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function couverture(id: string, titre: string, fn: Preuve): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

const REPO = join(import.meta.dirname, "..");
const RUNS = ".pi-subagent-runs";
const DELEGATION = readFileSync(join(REPO, "subagent-only", "DELEGATION.md"), "utf-8");
const BLOC = blocDeDelegation(DELEGATION);
const LECTURE = ["read", "grep", "find", "ls"];
const PLAN = {
  version: 1,
  work_units: [
    { id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py"] },
    { id: "W09", goal: "faire W09", depends_on: [], expected_write_scope: ["src/b.py"] },
  ],
};
const tache = (unite: string) => ({ agent: "worker", work_unit: unite, task: `écrire pour ${unite}` });
const revue = (unite: string) => {
  PILOTE.resultat = { verdict: "approved", changedFiles: [] } as never;
  return { agent: "reviewer", work_unit: unite, task: "juger" };
};
const texte = (r: unknown): string =>
  ((r as { content?: Array<{ text?: string }> })?.content ?? []).map((c) => c.text ?? "").join("");
const enErreur = (r: unknown): boolean => (r as { isError?: boolean })?.isError === true;

const jetables: string[] = [];
test.after(() => {
  process.chdir(REPO);
  for (const d of jetables) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

// ------------------------------------------------------------------ le dépôt d'épreuve

function depot(options: { ignorer?: boolean } = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-p2h-")));
  jetables.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  if (options.ignorer ?? true) writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return root;
}

/** Chemins, type, mode, inode, taille et empreinte : tout ce qu'une écriture changerait. */
function inventaire(root: string): string[] {
  const lignes: string[] = [];
  const parcourir = (rel: string) => {
    const chemin = join(root, rel);
    const st = lstatSync(chemin);
    const type = st.isDirectory() ? "d" : st.isFile() ? "f" : st.isSymbolicLink() ? "l" : "o";
    const sha = st.isFile() ? createHash("sha256").update(readFileSync(chemin)).digest("hex") : "";
    lignes.push(`${rel}\t${type}\t${st.mode}\t${st.ino}\t${st.isFile() ? st.size : 0}\t${sha}`);
    if (st.isDirectory()) for (const n of readdirSync(chemin).sort()) parcourir(rel ? join(rel, n) : n);
  };
  parcourir("");
  return lignes;
}
const ecartsDInventaire = (a: string[], b: string[]): string[] => [
  ...a.filter((l) => !b.includes(l)).map((l) => `- ${l.split("\t")[0]}`),
  ...b.filter((l) => !a.includes(l)).map((l) => `+ ${l.split("\t")[0]}`),
];

// ------------------------------------------------------------------ l'exception des index de lanes (Q-P2-6)
//
// `git status`, sonde existante de `laneChanges` (`worktree.ts` l. 251), peut rafraîchir le cache de
// l'index administratif d'une lane observée. Seul ce fichier ordinaire préexistant est excepté, pour
// les seules lanes du run : la comparaison projetée retire de ses lignes l'inode, la taille et
// l'empreinte, et garde le chemin, le type et le mode. Tout le reste est comparé en entier.

/** Les lectures de la preuve elle-même : elles ne prennent aucun verrou optionnel. */
function gitLecture(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

interface IndexDeLane { lane: string; worktree: string; index: string; rel: string }

/** Les index administratifs des lanes du run, résolus par git et contrôlés avant tout inventaire. */
function indexDesLanes(root: string, runId: string): IndexDeLane[] {
  const lanes: IndexDeLane[] = [];
  for (const bloc of gitLecture(root, "worktree", "list", "--porcelain").split("\n\n")) {
    const worktree = /^worktree (.+)$/m.exec(bloc)?.[1];
    if (!worktree || realpathSync(worktree) === root) continue;
    const lane = worktree.split("/").pop() ?? "";
    if (!lane.startsWith(`${runId}-`)) continue;
    const index = gitLecture(worktree, "rev-parse", "--path-format=absolute", "--git-path", "index").trim();
    const attendu = join(root, ".git", "worktrees", lane, "index");
    precondition(index === attendu, `index de ${lane} : ${index} au lieu de ${attendu}`);
    const st = lstatSync(index);
    precondition(st.isFile() && !st.isSymbolicLink(), `index de ${lane} : fichier ordinaire préexistant attendu`);
    lanes.push({ lane, worktree, index, rel: join(".git", "worktrees", lane, "index") });
  }
  return lanes;
}

/** L'état indexé de chaque lane : entrées suivies, modes indexés, identités d'objets, étages. */
const etatsIndexes = (lanes: IndexDeLane[]): string[] => lanes.map((l) => `${l.lane}\0${gitLecture(l.worktree, "ls-files", "-s", "-z")}`);

/** Inventaire complet et état indexé, pris de façon que la lecture de l'état indexé n'écrive rien. */
function releve(root: string, lanes: IndexDeLane[]): { inventaire: string[]; indexes: string[] } {
  const avant = inventaire(root);
  const indexes = etatsIndexes(lanes);
  const apres = inventaire(root);
  precondition(JSON.stringify(avant) === JSON.stringify(apres), `ls-files a écrit : ${JSON.stringify(ecartsDInventaire(avant, apres))}`);
  return { inventaire: apres, indexes };
}

/** Les écarts entre deux relevés, l'exception projetée ; le relevé des index exceptés en regard. */
function ecartsHorsIndexDeLanes(
  root: string, lanes: IndexDeLane[], a: { inventaire: string[]; indexes: string[] }, b: { inventaire: string[]; indexes: string[] },
): { ecarts: string[]; rafraichis: string[] } {
  const exclus = new Set(lanes.map((l) => l.rel));
  const projeter = (lignes: string[]) => lignes.map((l) => {
    const [chemin, type, mode] = l.split("\t");
    return exclus.has(chemin) ? `${chemin}\t${type}\t${mode}\t—\t—\t—` : l;
  });
  const ecarts = ecartsDInventaire(projeter(a.inventaire), projeter(b.inventaire));
  if (JSON.stringify(a.indexes) !== JSON.stringify(b.indexes)) ecarts.push("état indexé d'une lane changé");
  for (const l of lanes) {
    const st = lstatSync(l.index);
    if (!st.isFile() || st.isSymbolicLink()) ecarts.push(`${l.rel} n'est plus un fichier ordinaire`);
  }
  const rafraichis = lanes.flatMap((l) => {
    const de = (lignes: string[]) => lignes.find((x) => x.split("\t")[0] === l.rel) ?? "";
    return de(a.inventaire) === de(b.inventaire) ? [] :
      [`${l.rel} : ${de(a.inventaire)} → ${de(b.inventaire)} (rafraîchissement du cache par git status, laneChanges, worktree.ts l. 251)`];
  });
  void root;
  return { ecarts, rafraichis };
}

const manifesteDe = (root: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, RUNS, "active-run.json"), "utf-8")) as Record<string, unknown>;
function ecrireManifeste(root: string, m: Record<string, unknown>): void {
  writeFileSync(join(root, RUNS, "active-run.json"), `${JSON.stringify(m, null, 2)}\n`);
}

/** Un run vide, ouvert par le module de la base hors de toute session : `planning`, `nextSeq` 1. */
function runVide(root: string, modifier?: (m: Record<string, unknown>) => void): string {
  const ouvert = openRun(join(root, RUNS), git(root, "rev-parse", "HEAD").trim());
  if (modifier) {
    const m = manifesteDe(root);
    modifier(m);
    ecrireManifeste(root, m);
  }
  return ouvert.manifest.runId;
}

/** Un manifeste terminal publié, sa fin portée, l'espace pas encore libéré. */
const terminer = (outcome: "completed" | "abandoned") => (m: Record<string, unknown>) => {
  m.status = outcome;
  m.ended = { at: new Date().toISOString(), by: "operator", outcome, ...(outcome === "abandoned" ? { reason: "fixture" } : {}) };
};

/** Un run qui finit par l'outil opérateur, comme `bin/subagent-recover` le fait. */
function recover(root: string, ...args: string[]): { status: number | null; sortie: string } {
  const majeur = Number(process.versions.node.split(".")[0]);
  const p = spawnSync(
    process.execPath,
    [...(majeur < 23 ? ["--experimental-strip-types"] : []), join(REPO, "bin", "subagent-recover"), ...args],
    { cwd: root, encoding: "utf-8" },
  );
  return { status: p.status, sortie: `${p.stdout}${p.stderr}` };
}

// ------------------------------------------------------------------ les outils de pi

interface OutilPi { name: string; sourceInfo: { source: string; path: string } }
const natif = (name: string): OutilPi => ({ name, sourceInfo: { source: SOURCE_NATIVE, path: cheminNatif(name) } });
const outilsParDefaut = (): OutilPi[] => [
  ...["read", "grep", "find", "ls", "bash", "write", "edit"].map(natif),
  { name: "task", sourceInfo: { source: "local", path: join(REPO, "extensions", "subagent") } },
];

// ------------------------------------------------------------------ une session

let generation = 0;

interface Session {
  root: string;
  runDir: string;
  outils: { tous: OutilPi[]; actifs: string[]; appels: string[][] };
  notifications: Notification[];
  outil: { execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown>; promptGuidelines?: string[]; parameters?: unknown };
  commandes: Map<string, Commande>;
  evenements: Map<string, Rappel>;
  ctx: (c?: Parameters<typeof contexteDEpreuve>[0]) => Record<string, unknown>;
  statuts: Array<[string, string]>;
  demarrer: (reason?: string, c?: Parameters<typeof contexteDEpreuve>[0]) => Promise<void>;
  sub: (arg: string, c?: Parameters<typeof contexteDEpreuve>[0]) => Promise<Notification[]>;
  rapport: () => Promise<Notification[]>;
  invite: (preparer?: (o: OptionsDEpreuve) => void, c?: Parameters<typeof contexteDEpreuve>[0]) =>
    Promise<{ options: OptionsDEpreuve; retour: unknown; prompt: string }>;
  appel: (toolName: unknown, input?: Record<string, unknown>, toolCallId?: string) => Promise<{ block?: boolean; reason?: string } | undefined>;
  resultat: (toolCallId: string) => Promise<unknown>;
  arbre: () => Promise<void>;
  fermer: () => Promise<void>;
}

async function charger(
  root: string,
  options: { tous?: OutilPi[]; actifs?: string[]; reinitialiser?: boolean; agentDir?: string; session?: string } = {},
): Promise<Session> {
  process.env.PI_AGENT_DIR = options.agentDir ?? REPO;
  process.chdir(root);
  if (options.reinitialiser ?? true) reinitialiser();
  generation += 1;
  const tous = options.tous ?? outilsParDefaut();
  const outils = { tous, actifs: options.actifs ?? tous.map((t) => t.name), appels: [] as string[][] };
  const evenements = new Map<string, Rappel>();
  const commandes = new Map<string, Commande>();
  let outil: Session["outil"] | undefined;
  const module = await import(`../extensions/subagent/index.ts?l0p2h=${generation}`);
  module.default({
    on: (nom: string, cb: Rappel) => { evenements.set(nom, cb); },
    registerTool: (t: unknown) => { outil = t as Session["outil"]; },
    registerCommand: (nom: string, c: { handler: Commande }) => { commandes.set(nom, c.handler); },
    ui: { setStatus: () => {}, setFooter: () => {} },
    getAllTools: () => outils.tous.map((o) => ({ ...o, sourceInfo: { ...o.sourceInfo } })),
    getActiveTools: () => [...outils.actifs],
    setActiveTools: (noms: string[]) => {
      outils.appels.push([...noms]);
      outils.actifs = noms.filter((n) => outils.tous.some((o) => o.name === n));
      // Dans une fenêtre de `sondes`, l'appel prend sa place dans la chronologie des invocations git.
      const journal = process.env.PI_P2H_JOURNAL_GIT;
      if (journal) appendFileSync(journal, `SETACTIVE ${noms.join(",")}\n`);
    },
  });
  precondition(outil !== undefined, "task doit être enregistré");
  const notifications: Notification[] = [];
  const statuts: Array<[string, string]> = [];
  const s: Session = {
    root,
    runDir: join(root, RUNS),
    outils,
    notifications,
    outil: outil!,
    commandes,
    evenements,
    ctx: (c = {}) => {
      const ctx = contexteDEpreuve({ notifications, session: options.session, ...c });
      (ctx.ui as Record<string, unknown>).setStatus = (cle: string, valeur: string) => { statuts.push([cle, valeur]); };
      return ctx;
    },
    statuts,
    demarrer: async (reason = "startup", c = {}) => {
      await evenements.get("session_start")!({ type: "session_start", reason }, s.ctx(c));
    },
    sub: async (arg, c = {}) => {
      const avant = notifications.length;
      await commandes.get("subagents")!(arg, s.ctx(c));
      return notifications.slice(avant);
    },
    rapport: async () => {
      const avant = notifications.length;
      await commandes.get("subagent-report")!("", s.ctx());
      return notifications.slice(avant);
    },
    invite: async (preparer, c = {}) => {
      const opts = optionsDEpreuve(outils.actifs);
      preparer?.(opts);
      const retour = await evenements.get("before_agent_start")!(evenementAvantAgent(opts), s.ctx(c));
      return { options: opts, retour, prompt: rendrePrompt(opts) };
    },
    appel: async (toolName, input = {}, toolCallId = "c1") =>
      (await evenements.get("tool_call")!({ type: "tool_call", toolName, toolCallId, input }, s.ctx())) as
        { block?: boolean; reason?: string } | undefined,
    resultat: async (toolCallId) =>
      evenements.get("tool_result")!({ type: "tool_result", toolCallId, content: [], isError: false }, s.ctx()),
    arbre: async () => {
      await evenements.get("session_tree")!({ type: "session_tree", newLeafId: null, oldLeafId: null }, s.ctx());
    },
    fermer: async () => {
      await evenements.get("session_shutdown")!({ type: "session_shutdown" }, s.ctx());
    },
  };
  return s;
}

/** Une session montée : démarrage, `/subagents on`, puis une invite. */
async function montee(root: string, options: Parameters<typeof charger>[1] = {}): Promise<Session> {
  const s = await charger(root, options);
  await s.demarrer();
  const dit = await s.sub("on");
  precondition(!dit.some((n) => n.genre === "error"), `la montée doit réussir : ${JSON.stringify(dit)}`);
  await s.invite();
  return s;
}

/** Un run non terminé produit par le runtime lui-même : une délégation sur W03, puis la sortie propre. */
async function runActif(root: string): Promise<string> {
  const s = await montee(root);
  const runId = String(manifesteDe(root).runId);
  writeFileSync(join(root, RUNS, `${runId}-plan.json`), JSON.stringify(PLAN));
  PILOTE.pendant = (a: { cwd?: string }) => { if (a.cwd) writeFileSync(join(a.cwd, "src", "a.py"), "a = 2\n"); };
  const r = await s.outil.execute("x1", tache("W03"));
  PILOTE.pendant = undefined;
  precondition(!enErreur(r), `la délégation de fixture doit passer : ${texte(r)}`);
  await s.fermer();
  return runId;
}

/** Un plan terminal : W03 et W09 écrites, revues, intégrées par le runtime. */
async function runTerminal(root: string): Promise<{ s: Session; runId: string }> {
  const s = await montee(root);
  const runId = String(manifesteDe(root).runId);
  writeFileSync(join(root, RUNS, `${runId}-plan.json`), JSON.stringify(PLAN));
  for (const [unite, fichier, valeur, n] of [["W03", "src/a.py", "a = 2", "1"], ["W09", "src/b.py", "b = 2", "2"]]) {
    PILOTE.pendant = (a: { cwd?: string }) => { if (a.cwd) writeFileSync(join(a.cwd, fichier), `${valeur}\n`); };
    await s.outil.execute(`${n}a`, tache(unite));
    PILOTE.pendant = undefined;
    await s.invite();
    await s.outil.execute(`${n}b`, revue(unite));
    PILOTE.resultat = undefined;
    await s.invite();
  }
  const lignes = readFileSync(join(root, RUNS, `${runId}-lanes.jsonl`), "utf-8");
  precondition((lignes.match(/"INTEGRATED"/g) ?? []).length === 2, "les deux unités doivent être intégrées");
  return { s, runId };
}

// ------------------------------------------------------------------ la cale git

const VRAI_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).trim();
const CALE = realpathSync(mkdtempSync(join(tmpdir(), "pi-p2h-git-")));
jetables.push(CALE);
writeFileSync(join(CALE, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$PI_P2H_JOURNAL_GIT"\nexec "${VRAI_GIT}" "$@"\n`);
chmodSync(join(CALE, "git"), 0o755);

/** Les invocations git d'une fenêtre : par la cale (identité) et par le compteur de la base (compte). */
async function sondes(fn: () => Promise<unknown> | unknown): Promise<{ argv: string[]; compte: number; chronologie: string[] }> {
  const journal = join(CALE, `journal-${Math.random().toString(16).slice(2)}`);
  writeFileSync(journal, "");
  const path = process.env.PATH;
  const avant = readGitInvocationCount();
  process.env.PATH = `${CALE}:${path}`;
  process.env.PI_P2H_JOURNAL_GIT = journal;
  try {
    await fn();
  } finally {
    process.env.PATH = path;
    delete process.env.PI_P2H_JOURNAL_GIT;
  }
  const chronologie = readFileSync(journal, "utf-8").split("\n").filter(Boolean);
  const argv = chronologie.filter((l) => !l.startsWith("SETACTIVE "));
  return { argv, compte: readGitInvocationCount() - avant, chronologie };
}

/** Les sondes des observateurs communs eux-mêmes, appelés directement sur le même disque. */
async function sondesDesObservateurs(root: string, runId: string): Promise<string[]> {
  const runDir = join(root, RUNS);
  return (await sondes(() => {
    const laneRead = readLaneEvents(runDir, runId);
    const vu = observeLanes({ root, runId, laneRead: { ...laneRead, version: laneRead.version } as never });
    if (vu.usable) observeIntegrations({ root, runDir, runId, laneRead: { ...laneRead, version: laneRead.version } as never });
  })).argv;
}
const memes = (a: string[], b: string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ================================================================== H01 — rien d'écrit en simple

couverture("P2-H01", "chargement et session_start en simple n'écrivent rien, dépôt vierge puis run vide", async () => {
  const ecarts: string[] = [];
  {
    const root = depot();
    const avant = inventaire(root);
    const s = await charger(root);
    await s.demarrer();
    await s.sub("");
    await s.invite();
    const apres = inventaire(root);
    if (existsSync(join(root, RUNS))) ecarts.push("dépôt vierge : l'espace des runs a été créé");
    ecarts.push(...ecartsDInventaire(avant, apres).map((e) => `dépôt vierge : ${e}`));
  }
  {
    const root = depot();
    runVide(root);
    const avant = inventaire(root);
    const s = await charger(root);
    await s.demarrer();
    await s.sub("");
    await s.invite();
    ecarts.push(...ecartsDInventaire(avant, inventaire(root)).map((e) => `run vide : ${e}`));
  }
  propriete(ecarts.length === 0, `aucune écriture dans le périmètre de § 5.4 ; écarts ${JSON.stringify(ecarts)}`);
});

// ================================================================== H02 — task enregistré, inactif

couverture("P2-H02", "task enregistré mais absent des outils actifs ; /subagents et /subagent-report disponibles", async () => {
  const root = depot();
  const s = await charger(root);
  await s.demarrer();
  propriete(
    s.outils.tous.some((o) => o.name === "task") && !s.outils.actifs.includes("task") &&
      s.commandes.has("subagents") && s.commandes.has("subagent-report") &&
      JSON.stringify(s.outils.actifs) === JSON.stringify(["read", "grep", "find", "ls", "bash", "write", "edit"]),
    `outils actifs ${JSON.stringify(s.outils.actifs)}, commandes ${JSON.stringify([...s.commandes.keys()])}`,
  );
});

// ================================================================== H03 — aucune section en simple

couverture("P2-H03", "en simple, before_agent_start ne pose aucune section et ne retourne aucun systemPrompt", async () => {
  const root = depot();
  const s = await charger(root);
  await s.demarrer();
  const vierge = optionsDEpreuve(s.outils.actifs);
  const a = await s.invite();
  // Après une montée puis une descente : la délégation déjà lue ne revient pas.
  await s.sub("on");
  await s.invite();
  await s.sub("off");
  const b = await s.invite((o) => { o.forceSystemPrompt = "PROMPT FORCÉ PRÉEXISTANT"; });
  propriete(
    a.retour === undefined && JSON.stringify(a.options) === JSON.stringify(vierge) &&
      b.retour === undefined && b.options.sections.delegation === undefined &&
      b.options.toolGuidelines.task === undefined && b.options.forceSystemPrompt === "PROMPT FORCÉ PRÉEXISTANT",
    `simple : retour ${JSON.stringify(a.retour)}, options ${JSON.stringify(a.options)} ; ` +
      `après descente : retour ${JSON.stringify(b.retour)}, sections ${JSON.stringify(Object.keys(b.options.sections))}, ` +
      `prompt forcé ${JSON.stringify(b.options.forceSystemPrompt)}`,
  );
});

// ================================================================== H04 — sondes git

couverture("P2-H04", "sondes git comptées et identifiées : préflight au chargement, observateurs aux relectures, rien de plus", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const runId = await runActif(root);

  // Chargement : le préflight seul.
  let s: Session | undefined;
  const preflight = (await sondes(() => instrumentationIgnored(root, RUNS))).argv;
  const chargement = await sondes(async () => { s = await charger(root); });
  if (!memes(chargement.argv, preflight)) ecarts.push(`chargement ${JSON.stringify(chargement.argv)} ≠ préflight ${JSON.stringify(preflight)}`);

  // Chaque relecture sur un run identifié : les observateurs communs, et eux seuls.
  const attendu = await sondesDesObservateurs(root, runId);
  if (attendu.length === 0) ecarts.push("les observateurs communs n'ont lancé aucune sonde : le témoin ne prouve rien");
  const points: Array<[string, () => Promise<unknown>]> = [
    ["T1 session_start", () => s!.demarrer()],
    ["T2 /subagents", () => s!.sub("")],
    ["T6 /subagents off en simple", () => s!.sub("off")],
    ["T13 session_tree", () => s!.arbre()],
  ];
  for (const [quoi, fn] of points) {
    const v = await sondes(fn);
    if (!memes(v.argv, attendu)) ecarts.push(`${quoi} : ${JSON.stringify(v.argv)} ≠ ${JSON.stringify(attendu)}`);
    if (v.compte !== attendu.length) ecarts.push(`${quoi} : compteur ${v.compte} ≠ ${attendu.length}`);
    if (v.argv.includes("rev-parse HEAD")) ecarts.push(`${quoi} : baseCommit() avant la montée`);
  }
  const t14 = await sondes(() => s!.rapport());
  if (!memes(t14.argv, attendu)) ecarts.push(`T14 /subagent-report : ${JSON.stringify(t14.argv)} ≠ ${JSON.stringify(attendu)}`);

  // T3 admis : observation, baseCommit(), openRun (sans git), puis reconstruire().
  const t3 = await sondes(() => s!.sub("on"));
  const apres = await sondesDesObservateurs(root, runId);
  const t3Attendu = [...attendu, "rev-parse HEAD", ...apres];
  if (JSON.stringify(t3.argv) !== JSON.stringify(t3Attendu)) {
    ecarts.push(`T3 : ${JSON.stringify(t3.argv)} ≠ ${JSON.stringify(t3Attendu)} (dans l'ordre)`);
  }
  // T5 refusé sur run non terminé : l'observation qui précède la décision, rien d'autre.
  const t5 = await sondes(() => s!.sub("off"));
  if (!memes(t5.argv, apres)) ecarts.push(`T5 : ${JSON.stringify(t5.argv)} ≠ ${JSON.stringify(apres)}`);
  propriete(ecarts.length === 0, `sondes identifiées : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H05 — avertissement

couverture("P2-H05", "avertissement pour chaque run non terminé ou illisible ; rien pour absent, vide, terminé", async () => {
  const sansAvertissement: string[] = [];
  const avertissementsEnTrop: string[] = [];
  const cas: Array<[string, (root: string) => void | Promise<unknown>, boolean]> = [
    ["absent", () => {}, false],
    ["absent avec archives", (r) => { runVide(r); recover(r, "run", "abandoned", "--reason", "fixture"); }, false],
    ["vide", (r) => { runVide(r); }, false],
    ["terminé completed", (r) => { runVide(r, terminer("completed")); }, false],
    ["terminé abandoned", (r) => { runVide(r, terminer("abandoned")); }, false],
    ["plan attaché (K06)", (r) => {
      const id = runVide(r);
      const t = JSON.stringify(PLAN);
      writeFileSync(join(r, RUNS, `${id}-plan.json`), t);
      const m = manifesteDe(r); m.planHash = planHash(t); m.plan = `${id}-plan.json`; ecrireManifeste(r, m);
    }, true],
    ["nextSeq > 1 (K07)", (r) => { runVide(r, (m) => { m.nextSeq = 2; }); }, true],
    ["continuation_block (K08)", (r) => { runVide(r, (m) => { m.continuation_block = { at: new Date().toISOString(), code: "RUN_CONTINUATION_BLOCKED" }; }); }, true],
    ["refus journalisés (K09)", (r) => { const id = runVide(r); writeFileSync(join(r, RUNS, `${id}-refusals.jsonl`), "{}\n"); }, true],
    ["active (K10)", (r) => runActif(r), true],
    ["manifeste illisible (K12)", (r) => { runVide(r); writeFileSync(join(r, RUNS, "active-run.json"), "{pas du json"); }, true],
    ["marqueur invalide (K13)", (r) => { runVide(r); writeFileSync(join(r, RUNS, ".git", "HEAD"), "n'importe quoi\n"); }, true],
    ["registre des lanes malformé (K15)", async (r) => {
      const id = await runActif(r);
      appendFileSync(join(r, RUNS, `${id}-lanes.jsonl`), "{ pas du json\n");
    }, true],
    ["plan attaché incohérent (K16)", (r) => {
      const id = runVide(r);
      const t = JSON.stringify(PLAN);
      writeFileSync(join(r, RUNS, `${id}-plan.json`), `${t} `);
      const m = manifesteDe(r); m.planHash = planHash(t); m.plan = `${id}-plan.json`; ecrireManifeste(r, m);
    }, true],
    ["intégrations inexploitables, planning (K17)", (r) => { runVide(r, (m) => { m.ledgers = { integrations: 1 }; }); }, true],
    ["intégrations inexploitables, completed (K17b)", (r) => {
      runVide(r, (m) => { terminer("completed")(m); m.ledgers = { integrations: 1 }; });
    }, true],
    ["marqueur invalide sans manifeste (K27)", (r) => { mkdirSync(join(r, RUNS)); writeFileSync(join(r, RUNS, ".git"), "pas un répertoire\n"); }, true],
    ["pièce non identifiable sans manifeste (K28)", (r) => {
      runVide(r); rmSync(join(r, RUNS, "active-run.json")); writeFileSync(join(r, RUNS, "inconnu.txt"), "x\n");
    }, true],
  ];
  for (const [quoi, preparer, attendu] of cas) {
    const root = depot();
    await preparer(root);
    const s = await charger(root);
    await s.demarrer();
    const avert = s.notifications.filter((n) => n.genre === "warning");
    const ok = avert.length === 1 && avert[0].texte.includes("lecture seule") && avert[0].texte.includes("`/subagents on`") &&
      avert[0].texte.includes("`/subagent-report`") && avert[0].texte.includes("bin/subagent-recover");
    if (attendu && !ok) sansAvertissement.push(`${quoi} : ${JSON.stringify(avert)}`);
    if (!attendu && avert.length > 0) avertissementsEnTrop.push(`${quoi} : ${JSON.stringify(avert)}`);
  }
  propriete(
    sansAvertissement.length === 0 && avertissementsEnTrop.length === 0,
    `sans avertissement ${JSON.stringify(sansAvertissement)} ; en trop ${JSON.stringify(avertissementsEnTrop)}`,
  );
});

// ================================================================== H06 — la montée, dans l'ordre

couverture("P2-H06", "montée : observation, baseCommit, openRun, reconstruction, P0-C, puis task ; l'identité est celle d'openRun", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const runId = await runActif(root);
  const s = await charger(root);
  await s.demarrer();
  const avant = await sondesDesObservateurs(root, runId);
  const t3 = await sondes(() => s.sub("on"));
  const apres = await sondesDesObservateurs(root, runId);
  const attendu = [...avant, "rev-parse HEAD", ...apres];
  const activation = t3.chronologie.findIndex((l) => l.startsWith("SETACTIVE ") && l.split(" ")[1].split(",").includes("task"));
  const derniereSonde = t3.chronologie.map((l) => !l.startsWith("SETACTIVE ")).lastIndexOf(true);
  if (JSON.stringify(t3.argv) !== JSON.stringify(attendu)) ecarts.push(`sondes ${JSON.stringify(t3.argv)} ≠ ${JSON.stringify(attendu)}`);
  if (activation < 0) ecarts.push(`task jamais activé : ${JSON.stringify(t3.chronologie)}`);
  else if (activation < derniereSonde) ecarts.push(`task activé avant la fin de la reconstruction : ${JSON.stringify(t3.chronologie)}`);
  // « Marqueur puis garde d'espace », à travers la montée, sur un dépôt vierge.
  const vierge = depot();
  const sv = await charger(vierge);
  await sv.demarrer();
  await sv.sub("on");
  const marqueur = existsSync(join(vierge, RUNS, ".git", "HEAD"));
  const nouvelId = String(manifesteDe(vierge).runId);
  const { options } = await sv.invite();
  const guide = (options.toolGuidelines.task ?? []).join("\n");
  if (!marqueur) ecarts.push("aucun marqueur posé par la montée");
  if (existsSync(join(vierge, RUNS, ".espace.guard"))) ecarts.push("la garde d'espace est restée posée");
  if (!guide.includes(`${RUNS}/${nouvelId}-plan.json`)) ecarts.push(`guidelines sans l'identité rendue par openRun : ${guide.slice(0, 120)}`);
  const statut = sv.statuts.filter(([k]) => k === "subagent-run").at(-1)?.[1] ?? "";
  if (!statut.includes(nouvelId)) ecarts.push(`statut publié ${statut}`);
  // Un run terminé : openRun l'archive et rend un successeur ; seule cette identité fait autorité.
  const fini = depot();
  const ancien = runVide(fini, terminer("completed"));
  const sf = await charger(fini);
  await sf.demarrer();
  await sf.sub("on");
  const successeur = String(manifesteDe(fini).runId);
  const guideF = ((await sf.invite()).options.toolGuidelines.task ?? []).join("\n");
  if (successeur === ancien) ecarts.push("aucun successeur");
  if (!guideF.includes(`${successeur}-plan.json`) || guideF.includes(ancien)) ecarts.push(`identité relue au lieu de rendue : ${ancien} / ${successeur}`);
  propriete(ecarts.length === 0, `montée dans l'ordre de T3 : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H07 — deux invites consécutives

couverture("P2-H07", "section delegation et guidelines du run courant présentes à deux invites consécutives", async () => {
  const root = depot();
  const s = await charger(root);
  await s.demarrer();
  await s.sub("on");
  const runId = String(manifesteDe(root).runId);
  const ligne = lignesDeGuidelines((s.outil.promptGuidelines ?? []).map((g) => g.replace(`${RUNS}/<runId>-plan.json`, `${RUNS}/${runId}-plan.json`)));
  const ecarts: string[] = [];
  for (const n of [1, 2]) {
    const { options, prompt, retour } = await s.invite();
    if (options.sections.delegation !== DELEGATION) ecarts.push(`invite ${n} : section absente ou différente`);
    if (!prompt.includes(BLOC)) ecarts.push(`invite ${n} : bloc de délégation non rendu`);
    const manquantes = ligne.filter((l) => !prompt.split("\n").includes(l));
    if (manquantes.length > 0) ecarts.push(`invite ${n} : guidelines manquantes ${JSON.stringify(manquantes.map((l) => l.slice(0, 60)))}`);
    if (!prompt.includes(`${RUNS}/${runId}-plan.json`)) ecarts.push(`invite ${n} : chemin du run courant absent`);
    if (prompt.includes(`${RUNS}/<runId>-plan.json`)) ecarts.push(`invite ${n} : forme générique rendue`);
    if (retour !== undefined || options.forceSystemPrompt !== undefined) ecarts.push(`invite ${n} : prompt forcé introduit`);
  }
  propriete(ecarts.length === 0, `deux invites montées : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H08 — montée idempotente, refus sans effet

couverture("P2-H08", "montée idempotente ; refusée sur illisible, DELEGATION.md illisible et hors repos, sans aucun effet", async () => {
  const ecarts: string[] = [];
  {
    const root = depot();
    const s = await charger(root);
    await s.demarrer();
    await s.sub("on");
    const etat = { inventaire: inventaire(root), appels: s.outils.appels.length, actifs: [...s.outils.actifs] };
    const dit = await s.sub("on");
    const ok = dit.length === 1 && dit[0].genre === "info" && /Profil : sous-agents/.test(dit[0].texte);
    if (!ok || JSON.stringify(etat.inventaire) !== JSON.stringify(inventaire(root)) || s.outils.appels.length !== etat.appels ||
        JSON.stringify(s.outils.actifs) !== JSON.stringify(etat.actifs)) {
      ecarts.push(`seconde montée non idempotente : ${JSON.stringify(dit)}`);
    }
  }
  const agentSansDelegation = realpathSync(mkdtempSync(join(tmpdir(), "pi-p2h-agent-")));
  jetables.push(agentSansDelegation);
  mkdirSync(join(agentSansDelegation, "subagent-only"), { recursive: true });
  execFileSync("cp", ["-R", join(REPO, "subagent-only", "agents"), join(agentSansDelegation, "subagent-only", "agents")]);
  const refus: Array<[string, (r: string) => void | string | Promise<unknown>, Parameters<typeof charger>[1], Parameters<typeof contexteDEpreuve>[0]]> = [
    ["marqueur invalide sans manifeste", (r) => { mkdirSync(join(r, RUNS)); writeFileSync(join(r, RUNS, ".git"), "x\n"); }, {}, {}],
    ["intégrations inexploitables", (r) => { runVide(r, (m) => { m.ledgers = { integrations: 1 }; }); }, {}, {}],
    ["registre des lanes malformé", async (r) => {
      const id = await runActif(r);
      appendFileSync(join(r, RUNS, `${id}-lanes.jsonl`), "{ pas du json\n");
      return id;
    }, {}, {}],
    ["DELEGATION.md illisible", () => {}, { agentDir: agentSansDelegation }, {}],
    ["hors repos", () => {}, {}, { idle: false }],
  ];
  for (const [quoi, preparer, options, contexte] of refus) {
    const root = depot();
    const id = await preparer(root);
    // Exception Q-P2-6 : seule la fixture à lane l'exerce ; les autres comparent sans exception.
    const lanes = typeof id === "string" ? indexDesLanes(root, id) : [];
    const s = await charger(root, options);
    await s.demarrer();
    // RA-P2-10 : les caches de session, observés par leurs projections publiques — le relevé de
    // `/subagents` et le statut publié —, sont les mêmes avant et après le refus.
    const renduAvant = await s.sub("");
    const statut = () => s.statuts.filter(([k]) => k === "subagent-run").at(-1)?.[1];
    const statutAvant = statut();
    const avant = { ...releve(root, lanes), appels: s.outils.appels.length, actifs: [...s.outils.actifs] };
    const dit = await s.sub("on", contexte);
    const apres = { ...releve(root, lanes), appels: s.outils.appels.length, actifs: [...s.outils.actifs] };
    const statutApres = statut();
    const rendu = await s.sub("");
    if (rendu[0]?.texte !== renduAvant[0]?.texte || statutApres !== statutAvant) {
      ecarts.push(`${quoi} : projection changée par le refus : ${JSON.stringify([renduAvant, rendu, statutAvant, statutApres])}`);
    }
    const refuse = dit.length === 1 && dit[0].genre === "error" && /^Montée refusée/.test(dit[0].texte);
    if (!refuse) ecarts.push(`${quoi} : pas de refus ${JSON.stringify(dit)}`);
    const effet = ecartsHorsIndexDeLanes(root, lanes, avant, apres);
    if (effet.ecarts.length > 0 || avant.appels !== apres.appels || JSON.stringify(avant.actifs) !== JSON.stringify(apres.actifs)) {
      ecarts.push(`${quoi} : effet ${JSON.stringify(effet.ecarts)}, outils ${JSON.stringify(apres.actifs)}`);
    }
    if (effet.rafraichis.length > 0) console.log(`# P2-H08 ${quoi} · index rafraîchis (exception Q-P2-6) : ${JSON.stringify(effet.rafraichis)}`);
    if (!/Profil : simple/.test(rendu[0]?.texte ?? "")) ecarts.push(`${quoi} : profil ${JSON.stringify(rendu)}`);
  }
  propriete(ecarts.length === 0, `montées : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H09 — plan terminal

couverture("P2-H09", "montée sur un plan terminal : lecture native seule, task jamais activé", async () => {
  const root = depot();
  const { s: premiere } = await runTerminal(root);
  await premiere.fermer();
  const s = await charger(root);
  await s.demarrer();
  await s.sub("on");
  propriete(
    JSON.stringify([...s.outils.actifs].sort()) === JSON.stringify([...LECTURE].sort()) &&
      !s.outils.appels.some((l) => l.includes("task")),
    `outils ${JSON.stringify(s.outils.actifs)}, appels ${JSON.stringify(s.outils.appels)}`,
  );
});

// ================================================================== H10 — descente admise

couverture("P2-H10", "descente admise : task inactif, section absente, gardes de run inertes, registres intacts, run conservé", async () => {
  const root = depot();
  const s = await charger(root);
  await s.demarrer();
  await s.sub("on");
  await s.invite();
  const espaceAvant = inventaire(join(root, RUNS));
  const dit = await s.sub("off");
  const { options } = await s.invite();
  const r = await s.outil.execute("d1", tache("W03"));
  const ecriture = await s.appel("write", { path: "DESIGN.md", content: "x" });
  propriete(
    dit.length === 1 && dit[0].genre === "info" && !s.outils.actifs.includes("task") &&
      options.sections.delegation === undefined && options.toolGuidelines.task === undefined &&
      JSON.stringify(espaceAvant) === JSON.stringify(inventaire(join(root, RUNS))) &&
      existsSync(join(root, RUNS, "active-run.json")) &&
      !readdirSync(join(root, RUNS)).some((n) => n.endsWith(".lease")) &&
      texte(r) === REFUS_PROFIL_SIMPLE && ecriture === undefined,
    `descente ${JSON.stringify(dit)}, outils ${JSON.stringify(s.outils.actifs)}, sections ${JSON.stringify(Object.keys(options.sections))}, ` +
      `espace ${JSON.stringify(ecartsDInventaire(espaceAvant, inventaire(join(root, RUNS))))}, task ${texte(r)}, write ${JSON.stringify(ecriture)}`,
  );
});

// Le témoin de la base (Q-P2-6) : l'effet vient de la sonde. `observeLanes` (`lane-observe.ts`,
// inchangé depuis 0237b74e), appelé deux fois sur une lane fraîche, fait varier l'index au premier
// passage et pas à la relecture ; la commande brute de `laneChanges` fait de même sur une fixture
// jumelle. Si l'effet n'est pas rattaché ainsi, l'exception n'a pas de cause et la preuve s'arrête.
/** Attend que l'horloge ait franchi la seconde de la plus récente des dates données. */
function attendreLaSecondeSuivante(chemins: string[]): void {
  const derniere = Math.max(...chemins.map((c) => lstatSync(c).mtimeMs));
  const cible = (Math.floor(derniere / 1000) + 1) * 1000 + 20;
  const verrou = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < cible) Atomics.wait(verrou, 0, 0, Math.max(1, cible - Date.now()));
}

async function temoinDeLaBase(): Promise<void> {
  const constats: string[] = [];
  const passages = async (root: string, id: string, sonder: (l: IndexDeLane) => void) => {
    const lanes = indexDesLanes(root, id);
    precondition(lanes.length === 1, "une lane fraîche doit être observable");
    // git compare les dates à la seconde (2.43, sans USE_NSEC). Une entrée propre dont le fichier date
    // de la seconde de l'index est « racy » : `git status` la revérifie, la rafraîchit et réécrit
    // l'index. Une entrée modifiée reste sale et ne fait rien réécrire. Selon la seconde où la fixture
    // a été écrite, l'index est racy ou non. Le témoin pose donc cette condition lui-même : il date
    // l'index de la seconde du fichier suivi propre le plus récent de la lane, puis laisse passer cette
    // seconde. La sonde, ses commandes et son environnement sont ceux de la base ; les preuves H08,
    // H11 et H13 ne posent rien et n'attendent rien.
    const sales = new Set(gitLecture(lanes[0].worktree, "status", "--porcelain", "-z").split("\0").filter(Boolean).map((l) => l.slice(3)));
    const propres = gitLecture(lanes[0].worktree, "ls-files", "-z").split("\0").filter((n) => n && !sales.has(n)).map((n) => join(lanes[0].worktree, n));
    precondition(propres.length > 0, "la lane doit porter un fichier suivi propre");
    const recent = Math.max(...propres.map((c) => lstatSync(c).mtimeMs)) / 1000;
    utimesSync(lanes[0].index, recent, recent);
    attendreLaSecondeSuivante([lanes[0].index, ...propres]);
    const r0 = releve(root, lanes);
    sonder(lanes[0]);
    const r1 = releve(root, lanes);
    sonder(lanes[0]);
    const r2 = releve(root, lanes);
    const premier = ecartsDInventaire(r0.inventaire, r1.inventaire);
    const second = ecartsDInventaire(r1.inventaire, r2.inventaire);
    const hors = ecartsHorsIndexDeLanes(root, lanes, r0, r2).ecarts;
    return { premier, second, hors, rel: lanes[0].rel };
  };
  const observer = (root: string, id: string) => () => {
    const runDir = join(root, RUNS);
    const laneRead = readLaneEvents(runDir, id);
    observeLanes({ root, runId: id, laneRead: { ...laneRead, version: laneRead.version } as never });
  };
  for (const [quoi, sonde] of [
    ["observeLanes", (root: string, id: string) => observer(root, id)],
    ["git status brut", (_root: string) => (l: IndexDeLane) => { execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: l.worktree, stdio: "ignore" }); }],
  ] as Array<[string, (root: string, id: string) => (l: IndexDeLane) => void]>) {
    const root = depot();
    const id = await runActif(root);
    const p = await passages(root, id, sonde(root, id));
    const attendu = JSON.stringify([`- ${p.rel}`, `+ ${p.rel}`]);
    if (JSON.stringify(p.premier) !== attendu) constats.push(`${quoi} : premier passage ${JSON.stringify(p.premier)}`);
    if (p.second.length > 0) constats.push(`${quoi} : relecture ${JSON.stringify(p.second)}`);
    if (p.hors.length > 0) constats.push(`${quoi} : hors exception ${JSON.stringify(p.hors)}`);
  }
  precondition(constats.length === 0, `témoin de l'exception : ${JSON.stringify(constats)}`);
}

// ================================================================== H11 — descente refusée

couverture("P2-H11", "descente refusée sur run non terminé, illisible et hors repos : aucun effet, aucun journal de refus", async () => {
  const ecarts: string[] = [];
  await temoinDeLaBase();
  const cas: Array<[string, (root: string) => void, Parameters<typeof contexteDEpreuve>[0]]> = [
    ["non terminé", () => {}, {}],
    ["illisible", (root) => {
      const id = String(manifesteDe(root).runId);
      appendFileSync(join(root, RUNS, `${id}-lanes.jsonl`), "{ pas du json\n");
    }, {}],
    ["hors repos", () => {}, { idle: false }],
  ];
  const rafraichis: string[] = [];
  for (const [quoi, alterer, contexte] of cas) {
    const root = depot();
    const id = await runActif(root);
    const s = await montee(root);
    alterer(root);
    const lanes = indexDesLanes(root, id);
    precondition(lanes.length === 1, `${quoi} : la lane de W03 doit être observable`);
    const avant = { ...releve(root, lanes), actifs: [...s.outils.actifs] };
    const dit = await s.sub("off", contexte);
    const apres = { ...releve(root, lanes), actifs: [...s.outils.actifs] };
    const { options } = await s.invite();
    const refuse = dit.length === 1 && dit[0].genre === "error" && /^Descente refusée/.test(dit[0].texte) &&
      (quoi === "hors repos" || (dit[0].texte.includes(id) && dit[0].texte.includes("bin/subagent-recover")));
    if (!refuse) ecarts.push(`${quoi} : ${JSON.stringify(dit)}`);
    const effet = ecartsHorsIndexDeLanes(root, lanes, avant, apres);
    if (effet.ecarts.length > 0 || JSON.stringify(avant.actifs) !== JSON.stringify(apres.actifs)) {
      ecarts.push(`${quoi} : effet ${JSON.stringify(effet.ecarts)}, outils ${JSON.stringify(apres.actifs)}`);
    }
    rafraichis.push(...effet.rafraichis.map((r) => `${quoi} · ${r}`));
    if (options.sections.delegation !== DELEGATION) ecarts.push(`${quoi} : le profil a changé`);
    if (existsSync(join(root, RUNS, `${id}-refusals.jsonl`))) ecarts.push(`${quoi} : journal de refus écrit`);
  }
  // Relevé des index exceptés, par scénario : la preuve le garde, il n'est pas une propriété.
  console.log(`# P2-H11 index rafraîchis (exception Q-P2-6) : ${JSON.stringify(rafraichis)}`);
  propriete(ecarts.length === 0, `descentes refusées : ${JSON.stringify(ecarts)}`);
});


// ================================================================== H13 — lecture seule en simple

couverture("P2-H13", "lecture seule en simple : write, edit, bash, read non natif, outil inconnu refusés ; lecture native admise", async () => {
  const ecarts: string[] = [];
  for (const etat of ["non terminé", "illisible"]) {
    const root = depot();
    const id = await runActif(root);
    if (etat === "illisible") writeFileSync(join(root, RUNS, "active-run.json"), "{pas du json");
    const lanes = indexDesLanes(root, id);
    precondition(lanes.length === 1, `${etat} : la lane de W03 doit être observable`);
    const tous = outilsParDefaut();
    const s = await charger(root, { tous });
    await s.demarrer();
    const avant = releve(root, lanes);
    for (const [nom, input] of [["write", { path: "src/a.py", content: "x" }], ["edit", { path: "src/a.py" }], ["bash", { command: "ls" }],
      ["inconnu", {}], [undefined, {}]] as Array<[unknown, Record<string, unknown>]>) {
      const v = await s.appel(nom, input, `c-${String(nom)}`);
      if (v?.block !== true || !/lecture seule/.test(v.reason ?? "")) ecarts.push(`${etat} · ${String(nom)} admis : ${JSON.stringify(v)}`);
    }
    for (const nom of LECTURE) {
      const v = await s.appel(nom, { path: "src/a.py" }, `c-${nom}`);
      if (v !== undefined) ecarts.push(`${etat} · lecture native ${nom} refusée : ${JSON.stringify(v)}`);
    }
    // Un `read` qu'une extension a remplacé n'est pas la lecture native.
    tous[0] = { name: "read", sourceInfo: { source: "local", path: "/ailleurs/read.ts" } };
    const remplace = await s.appel("read", { path: "src/a.py" }, "c-read-local");
    if (remplace?.block !== true) ecarts.push(`${etat} · read non natif admis`);
    const effet = ecartsHorsIndexDeLanes(root, lanes, avant, releve(root, lanes));
    ecarts.push(...effet.ecarts.map((e) => `${etat} · écriture ${e}`));
    if (effet.rafraichis.length > 0) console.log(`# P2-H13 ${etat} · index rafraîchis (exception Q-P2-6) : ${JSON.stringify(effet.rafraichis)}`);
  }
  propriete(ecarts.length === 0, `lecture seule : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H14 — chaque session repart du simple

couverture("P2-H14", "session_start new, resume et fork : profil simple réaffirmé, état relu", async () => {
  const ecarts: string[] = [];
  for (const raison of ["new", "resume", "fork"]) {
    const root = depot();
    const s = await montee(root);
    await s.fermer();
    await s.demarrer(raison);
    const { options } = await s.invite();
    const r = await s.outil.execute(`e-${raison}`, tache("W03"));
    const rendu = await s.sub("");
    if (s.outils.actifs.includes("task") || options.sections.delegation !== undefined || texte(r) !== REFUS_PROFIL_SIMPLE ||
        !/Profil : simple/.test(rendu[0]?.texte ?? "") || !/classe vide/.test(rendu[0]?.texte ?? "")) {
      ecarts.push(`${raison} : outils ${JSON.stringify(s.outils.actifs)}, task ${texte(r)}, rendu ${JSON.stringify(rendu)}`);
    }
  }
  propriete(ecarts.length === 0, `sessions suivantes : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H15, H16 — cycles, minuteries, signaux

/** Les contrôleurs d'abandon et les minuteries créés pendant `fn`, et ce qu'il en est advenu. */
async function suivre<T>(fn: (controleurs: AbortController[]) => Promise<T>): Promise<{
  resultat: T;
  controleurs: AbortController[];
  minuteries: Array<{ id: unknown; arretee: boolean }>;
}> {
  const Origine = globalThis.AbortController;
  const setI = globalThis.setInterval;
  const clearI = globalThis.clearInterval;
  const controleurs: AbortController[] = [];
  const minuteries: Array<{ id: unknown; arretee: boolean }> = [];
  class Suivi extends Origine {
    constructor() { super(); controleurs.push(this); }
  }
  globalThis.AbortController = Suivi as typeof AbortController;
  globalThis.setInterval = ((h: () => void, ms?: number, ...a: unknown[]) => {
    const id = setI(h, ms, ...a);
    minuteries.push({ id, arretee: false });
    return id;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id: Parameters<typeof clearInterval>[0]) => {
    for (const m of minuteries) if (m.id === id) m.arretee = true;
    clearI(id);
  }) as typeof clearInterval;
  try {
    return { resultat: await fn(controleurs), controleurs, minuteries };
  } finally {
    globalThis.AbortController = Origine;
    globalThis.setInterval = setI;
    globalThis.clearInterval = clearI;
  }
}

// ------------------------------------------------------------------ Q-P2-9 : historique, blocages, observation
//
// L'historique de session n'a pas de lecteur public direct. Deux lecteurs existants le rendent
// observable sans rien ajouter à l'extension : le journal des refus (`logRefusal`, qui recopie
// `HISTORY` résumé) et l'indice `out_of_scope` d'une revue, rendu tant que `SCOUT_CALLS` vaut 0.
// La garde « une revue a déjà eu lieu et aucun worker depuis » lit aussi `HISTORY`.

const SCOUT = { agent: "scout", task: "chercher", find: "où est a", scope: ["src/"] };
const INDICE_SCOUT = /out_of_scope is a where-question answered inside a review/;

/** L'écriture inline de l'orchestrateur, hors du dépôt : une entrée d'historique, sans séquence ni effet sur le run. */
async function ecrireHorsDepot(s: Session, id: string): Promise<void> {
  const hors = realpathSync(mkdtempSync(join(tmpdir(), "pi-p2h-hors-")));
  jetables.push(hors);
  const v = await s.appel("write", { path: join(hors, "note.txt"), content: "x" }, id);
  precondition(v === undefined, `l'écriture hors dépôt doit passer : ${JSON.stringify(v)}`);
  writeFileSync(join(hors, "note.txt"), "x\n");
  await s.resultat(id);
}

/**
 * La sonde de l'historique : un appel de scout incomplet, refusé avant tout effet sur le run et
 * journalisé avec l'historique résumé. Elle écrit le journal des refus, et le run n'est plus
 * *vide* ensuite : elle vient donc en dernier.
 */
async function sonderHistoire(s: Session, root: string, runId: string): Promise<string> {
  const r = await s.outil.execute("sonde", { agent: "scout", task: "où ?" });
  precondition(enErreur(r) && /a scout call needs/.test(texte(r)), `la sonde doit être refusée : ${texte(r)}`);
  const lignes = readFileSync(join(root, RUNS, `${runId}-refusals.jsonl`), "utf-8").trim().split("\n");
  return JSON.stringify((JSON.parse(lignes.at(-1)!) as { history: unknown }).history);
}
const ORCHESTRATEUR_SEUL = JSON.stringify([{ agent: "orchestrator", changed: 1 }]);

/**
 * Un blocage réel par P0-B, dont l'écriture durable échoue : le bail du run est tenu par une autre
 * identité, `ensureOwnership` refuse. Le bail étranger est relâché aussitôt : il serait lui-même une
 * pièce du run, et seul le blocage local doit alors distinguer un run *vide* d'un run non terminé.
 */
async function bloquerSansEcrire(s: Session, root: string, runId: string, id: string): Promise<void> {
  const autre = acquireRunOwnership(join(root, RUNS), runId, `autre-${id}`) as { ok: boolean; lease?: Lease };
  precondition(autre.ok && autre.lease !== undefined, "le bail étranger doit être pris");
  const v = await s.appel("bash", { command: "python3 -c 'x'" }, id);
  precondition(v === undefined, `l'appel observé doit passer : ${JSON.stringify(v)}`);
  writeFileSync(join(root, "src", "b.py"), `b = '${id}'\n`);
  await s.resultat(id);
  precondition(manifesteDe(root).continuation_block === undefined, "le blocage ne doit pas être écrit");
  precondition(releaseRunOwnership(join(root, RUNS), autre.lease!), "le bail étranger doit être relâché");
  precondition(!readdirSync(join(root, RUNS)).some((n) => n.startsWith(`${runId}`)), "aucune pièce du run ne doit rester");
}

// ------------------------------------------------------------------ Q-P2-14, Q-P2-15 : preuves conservées, attente C6.4
//
// L'attente C6.4 n'a pas de lecteur public. Elle se prouve par sa seule conséquence : une entrée
// en attente, rejugée sous son run quand elle n'est plus explicable, pose le blocage durable. La
// transition est PRÉPARÉE (fixture canonique des B3, de vrais objets Git, arrêtée à MERGED sans
// INTEGRATED : fenêtre de la phase Statut) ; seul l'appel observé est public. HEAD bouge pendant
// cet appel : P0-B bloque donc aussi le run et conserve sa preuve sous `ite-p0b/` (Q-P2-14).

const DESIGN_Q15 = designMd([{ id: "D-001", titre: "orchestration", statut: "proposé" }]);
const PLAN_Q15 = planAvecDesign([
  { id: "W03", design_update: { decision_id: "D-001", from_status: "proposé", to_status: "en cours" } },
  { id: "W09" },
]);
/** Le contournement de la garde de B3-statut-inline : une écriture de DESIGN.md que l'avant-appel ne reconnaît pas. */
const CONTOURNEMENT = "python3 -c \"open('DESIGN'+'.md','a').write('x')\"";

/** Le dépôt d'épreuve, avec le bundle (DESIGN.md compris) commité. */
function depotBundle(): string {
  const root = depot();
  for (const f of ["INSTRUCTIONS.md", "ARCHITECTURE.md", "CONVENTIONS.md"]) writeFileSync(join(root, f), `# ${f}\n`);
  writeFileSync(join(root, "DESIGN.md"), DESIGN_Q15);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "bundle");
  return root;
}

/**
 * Préparation, non publique : le plan du run écrit dans son fichier (comme les autres volets), puis,
 * si `fenetre`, la fixture canonique des B3 arrêtée à MERGED sans INTEGRATED. `etatCanonique` ne
 * lit du harnais que `root`, `runId` et `runDir`.
 */
function preparerPhaseStatut(root: string, runId: string, fenetre: boolean): void {
  writeFileSync(join(root, RUNS, `${runId}-plan.json`), JSON.stringify(PLAN_Q15));
  if (fenetre) etatCanonique({ root, runId, runDir: join(root, RUNS) } as unknown as Harnais, { jusqua: "MERGED" });
}

/** Le bail du run tenu par une autre identité : l'écriture durable d'un blocage échoue (stimulus déclaré de H16). */
function bailEtranger(root: string, runId: string, id: string): Lease {
  const autre = acquireRunOwnership(join(root, RUNS), runId, `autre-${id}`) as { ok: boolean; lease?: Lease };
  precondition(autre.ok && autre.lease !== undefined, "le bail étranger doit être pris");
  return autre.lease!;
}

/** Les preuves P0-B conservées, nom → empreinte. */
function preuvesP0B(root: string): Record<string, string> {
  const d = join(root, RUNS, "ite-p0b");
  if (!existsSync(d)) return {};
  return Object.fromEntries(readdirSync(d).sort().map((n) => [n, createHash("sha256").update(readFileSync(join(d, n))).digest("hex")]));
}

/**
 * L'appel observé, public : un `bash` admis par les deux avant-appels, pendant lequel le commit de
 * Statut exact est posé (D-001 « proposé » → « en cours », parent HEAD). Rend la preuve P0-B écrite.
 */
async function appelStatutObserve(s: Session, root: string, runId: string, id: string): Promise<string> {
  const avant = Object.keys(preuvesP0B(root));
  const v = await s.appel("bash", { command: "statut D-001" }, id);
  precondition(v === undefined, `l'appel observé doit passer : ${JSON.stringify(v)}`);
  const design = readFileSync(join(root, "DESIGN.md"), "utf-8");
  writeFileSync(join(root, "DESIGN.md"), design.replace("Statut : proposé", "Statut : en cours"));
  git(root, "add", "DESIGN.md");
  git(root, "commit", "-qm", "statut D-001");
  await s.resultat(id);
  const nouvelles = Object.keys(preuvesP0B(root)).filter((n) => !avant.includes(n));
  precondition(nouvelles.length === 1 && nouvelles[0].startsWith(`${runId}-`), `une preuve P0-B de ${runId} : ${JSON.stringify(nouvelles)}`);
  precondition(manifesteDe(root).continuation_block === undefined, "le blocage ne doit pas être écrit (bail tenu ailleurs)");
  return nouvelles[0];
}

/**
 * Q-P2-21, E2 (`b5cf332a…` § 2) : le run courant B, de classe pure *vide* et sans blocage propre, ne
 * devient pas *non terminé* par le blocage local d'un autre run. La descente de B est admise, et le
 * profil simple obtenu n'est pas en lecture seule. Puis la remontée reprend B, sans autre effet.
 */
async function descenteAdmiseSurVide(s: Session, root: string, B: string, nom: string, ecarts: string[]): Promise<void> {
  const m = manifesteDe(root);
  precondition(
    m.runId === B && m.status === "planning" && m.nextSeq === 1 && m.continuation_block === undefined &&
      !readdirSync(join(root, RUNS)).some((n) => n.startsWith(`${B}-`) || n.startsWith(`${B}.`)),
    `${nom} E2 : ${B} doit être courant et de classe pure vide`,
  );
  const off = await s.sub("off");
  if (off.length !== 1 || off[0].genre !== "info") ecarts.push(`${nom} E2 : descente de ${B} vide refusée : ${JSON.stringify(off)}`);
  const ecriture = await s.appel("write", { path: "src/a.py", content: "x" }, `e2-${nom}`);
  if (ecriture !== undefined) ecarts.push(`${nom} E2 : lecture seule en simple sur ${B} vide : ${JSON.stringify(ecriture)}`);
  const on = await s.sub("on");
  precondition(!on.some((n) => n.genre === "error") && String(manifesteDe(root).runId) === B, `${nom} E2 : la remontée doit reprendre ${B}`);
}

couverture("P2-H15", "cycle on/off/on dans une session : contrôleur neuf, identité relue sur le run courant", async () => {
  const ecarts: string[] = [];

  // (a) Cycle admis sur un même run *vide* : la seule entrée d'historique que le parcours public
  // permet sans rendre le run non terminé est l'écriture inline de l'orchestrateur hors du dépôt
  // (aucune séquence, aucune pièce de run). Elle survit à T5 puis au T3 sur le même run.
  {
    const root = depot();
    const s = await charger(root);
    await s.demarrer();
    await s.sub("on");
    const A = String(manifesteDe(root).runId);
    await s.invite();
    await ecrireHorsDepot(s, "a1");
    const off = await suivre(() => s.sub("off"));
    precondition(off.resultat.length === 1 && off.resultat[0].genre === "info", `(a) la descente doit être admise : ${JSON.stringify(off.resultat)}`);
    if (off.controleurs.length !== 1 || off.controleurs[0].signal.aborted) ecarts.push(`(a) descente : ${off.controleurs.length} contrôleur(s) neuf(s)`);
    await s.sub("on");
    precondition(String(manifesteDe(root).runId) === A, "(a) la remontée doit porter sur le même run");
    await s.invite();
    const h = await sonderHistoire(s, root, A);
    if (h !== ORCHESTRATEUR_SEUL) ecarts.push(`(a) historique du même run non conservé : ${h}`);
  }

  // (b) Run bloqué par un blocage non écrit : la descente est refusée sans effet, et la
  // protection reste. Sur un run *vide*, c'est le blocage local qui le fait classer non terminé.
  {
    const root = depot();
    const s = await montee(root);
    const A = String(manifesteDe(root).runId);
    await bloquerSansEcrire(s, root, A, "b1");
    const avant = { inventaire: inventaire(root), actifs: [...s.outils.actifs] };
    const off = await s.sub("off");
    const apres = { inventaire: inventaire(root), actifs: [...s.outils.actifs] };
    if (off.length !== 1 || off[0].genre !== "error" || !/^Descente refusée/.test(off[0].texte) || !off[0].texte.includes("non terminé")) {
      ecarts.push(`(b) descente non refusée : ${JSON.stringify(off)}`);
    }
    if (JSON.stringify(avant) !== JSON.stringify(apres)) {
      ecarts.push(`(b) effet du refus : ${JSON.stringify(ecartsDInventaire(avant.inventaire, apres.inventaire))}, outils ${JSON.stringify(apres.actifs)}`);
    }
    writeFileSync(join(root, RUNS, `${A}-plan.json`), JSON.stringify(PLAN));
    const t = await s.outil.execute("b2", tache("W03"));
    if (!enErreur(t) || !texte(t).startsWith("[run: continuation bloquée]")) ecarts.push(`(b) task sous blocage : ${texte(t).slice(0, 160)}`);
  }

  // (c) Passage à un nouveau run après une fin par l'outil opérateur : au T3, l'historique du run
  // terminé est vidé ; l'identité, les guidelines et le statut sont ceux du run neuf. Q-P2-14 et
  // Q-P2-15 : le premier run est bloqué par P0-B sur l'appel observé de la phase Statut préparée,
  // avec une attente C6.4 ; le blocage n'est pas écrit (bail tenu ailleurs : un blocage écrit
  // laisserait le bail à la session, et la fin du run serait refusée). Sa preuve est conservée et
  // traversée par la montée du successeur, sans nettoyage.
  {
    const root = depotBundle();
    const s = await charger(root);
    await s.demarrer();
    await s.sub("on");
    const premier = String(manifesteDe(root).runId);
    await s.invite();
    await ecrireHorsDepot(s, "c1");
    preparerPhaseStatut(root, premier, true);
    const etranger = bailEtranger(root, premier, "c2");
    const preuve = await appelStatutObserve(s, root, premier, "c2");
    precondition(releaseRunOwnership(join(root, RUNS), etranger), "le bail étranger doit être relâché");
    // Le run courant change : terminé et archivé par l'opérateur, puis descente et montée.
    const fin = recover(root, "run", "abandoned", "--reason", "fixture");
    precondition(fin.status === 0, `fin du premier run : ${fin.sortie}`);
    const conservees = preuvesP0B(root);
    const off = await suivre(() => s.sub("off"));
    if (off.resultat.length !== 1 || off.resultat[0].genre !== "info") ecarts.push(`(c) descente après la fin : ${JSON.stringify(off.resultat)}`);
    // Le contrôleur neuf de la descente : un seul, non abandonné.
    if (off.controleurs.length !== 1 || off.controleurs[0].signal.aborted) ecarts.push(`(c) descente : ${off.controleurs.length} contrôleur(s) neuf(s)`);
    const on = await s.sub("on");
    if (on.some((n) => n.genre === "error")) ecarts.push(`(c) montée du successeur refusée : ${JSON.stringify(on)}`);
    const second = String(manifesteDe(root).runId);
    if (second !== premier) await descenteAdmiseSurVide(s, root, second, "(c)", ecarts);
    const { options } = await s.invite();
    const guide = (options.toolGuidelines.task ?? []).join("\n");
    const statut = s.statuts.filter(([k]) => k === "subagent-run").at(-1)?.[1] ?? "";
    if (second === premier) ecarts.push("(c) aucun nouveau run");
    if (!guide.includes(`${second}-plan.json`) || guide.includes(premier)) ecarts.push(`(c) guidelines sur ${guide.includes(premier) ? premier : "?"}`);
    if (!statut.includes(second)) ecarts.push(`(c) statut ${statut}`);
    if (!(preuve in conservees) || JSON.stringify(preuvesP0B(root)) !== JSON.stringify(conservees)) {
      ecarts.push(`(c) preuves P0-B non conservées à l'identique : ${JSON.stringify(Object.keys(preuvesP0B(root)))}`);
    }
    // La sonde est le premier appel de `task` sous le nouveau run : elle traverse la réévaluation des
    // attributions avant d'être refusée pour sa forme. Un blocage à ce point vient de l'ancien run.
    const sonde = await s.outil.execute("sonde-c", { agent: "scout", task: "où ?" });
    if (texte(sonde).startsWith("[run: continuation bloquée]")) {
      ecarts.push(`(c) nouveau run bloqué à sa première réévaluation : ${texte(sonde).slice(0, 160)}`);
    } else {
      const h = await sonderHistoire(s, root, second);
      if (h !== "[]") ecarts.push(`(c) historique de ${premier} conservé sous ${second} : ${h}`);
    }
    writeFileSync(join(root, RUNS, `${second}-plan.json`), JSON.stringify(PLAN));
    // La délégation passe par la réévaluation des attributions (avant la garde de run) : elle y est
    // déclenchée sous le nouveau run, sans juger l'entrée de l'ancien ni lui imputer son blocage local.
    const appels = APPELS.length;
    const r = await s.outil.execute("h15", tache("W03"));
    if (enErreur(r) || APPELS.length !== appels + 1) ecarts.push(`(c) délégation après le cycle : ${texte(r).slice(0, 200)}`);
    if (manifesteDe(root).continuation_block !== undefined) ecarts.push("(c) blocage durable posé sur le nouveau run");
  }

  // (f) RA-P2-8 (`b5cf332a…` § 6) : le propriétaire de l'historique est l'identité de run courante à
  // l'accumulation, jamais la proposition de la découverte. Parcours public, deux sessions du même
  // dépôt : A est terminé par l'outil opérateur ; une autre session monte et ouvre Z ; cette session,
  // encore sur A, relit la découverte (`/subagents`, qui rend Z), écrit hors du dépôt sous A, descend
  // puis monte sur Z : l'historique de A est vidé au T3.
  {
    const root = depot();
    const s = await montee(root);
    const A = String(manifesteDe(root).runId);
    const fin = recover(root, "run", "abandoned", "--reason", "fixture");
    precondition(fin.status === 0, `(f) fin de A : ${fin.sortie}`);
    const autre = await charger(root, { reinitialiser: false });
    await autre.demarrer();
    await autre.sub("on");
    const Z = String(manifesteDe(root).runId);
    precondition(Z !== A, "(f) l'autre session doit ouvrir un nouveau run");
    const rendu = await s.sub("");
    precondition((rendu[0]?.texte ?? "").includes(Z), `(f) la découverte doit proposer ${Z} : ${JSON.stringify(rendu)}`);
    await ecrireHorsDepot(s, "f1");
    const off = await s.sub("off");
    precondition(off.length === 1 && off[0].genre === "info", `(f) la descente doit être admise : ${JSON.stringify(off)}`);
    await s.sub("on");
    precondition(String(manifesteDe(root).runId) === Z, `(f) la montée doit reprendre ${Z}`);
    await s.invite();
    const h = await sonderHistoire(s, root, Z);
    if (h !== "[]") ecarts.push(`(f) historique de ${A} conservé sous ${Z} : ${h}`);
  }

  // (d) Q-P2-21, E5 — priorité de *terminé* sur le blocage local. PRÉPARATION DÉCLARÉE, non publique :
  // le manifeste de A, bloqué localement, est rendu terminal sans archivage, état d'une interruption
  // entre statut et archivage. Ce n'est pas une fin opérateur. Terminé reste terminé : la descente
  // est admise, le simple obtenu n'est pas en lecture seule, et rien n'est écrit.
  {
    const root = depot();
    const s = await montee(root);
    const A = String(manifesteDe(root).runId);
    await bloquerSansEcrire(s, root, A, "d1");
    const m = manifesteDe(root);
    terminer("completed")(m);
    ecrireManifeste(root, m);
    const avant = inventaire(root);
    const rendu = await s.sub("");
    const off = await s.sub("off");
    const ecriture = await s.appel("write", { path: "src/a.py", content: "x" }, "d2");
    if (!/classe terminé/.test(rendu[0]?.texte ?? "")) ecarts.push(`(d) terminé non rendu : ${JSON.stringify(rendu)}`);
    if (off.length !== 1 || off[0].genre !== "info") ecarts.push(`(d) descente refusée sur un run terminé : ${JSON.stringify(off)}`);
    if (ecriture !== undefined) ecarts.push(`(d) lecture seule sur un run terminé : ${JSON.stringify(ecriture)}`);
    const apres = inventaire(root);
    if (JSON.stringify(avant) !== JSON.stringify(apres)) ecarts.push(`(d) effets : ${JSON.stringify(ecartsDInventaire(avant, apres))}`);
  }

  // (e) Q-P2-21, E6 — priorité d'*illisible* sur le blocage local. PRÉPARATION DÉCLARÉE, non publique :
  // le manifeste de A, bloqué localement, atteste un registre des intégrations qui n'existe pas (K17).
  // Ce n'est pas une corruption produite par pi. Après T1, illisible reste illisible : avertissement et
  // relevé le disent, la montée est refusée sans effet et la lecture seule s'applique.
  {
    const root = depot();
    const s = await montee(root);
    const A = String(manifesteDe(root).runId);
    await bloquerSansEcrire(s, root, A, "e1");
    const m = manifesteDe(root);
    m.ledgers = { integrations: 1 };
    ecrireManifeste(root, m);
    await s.fermer();
    const notes = s.notifications.length;
    await s.demarrer("new");
    const avert = s.notifications.slice(notes).filter((n) => n.genre === "warning");
    const rendu = await s.sub("");
    const avant = inventaire(root);
    const on = await s.sub("on");
    const ecriture = await s.appel("write", { path: "src/a.py", content: "x" }, "e2");
    const apres = inventaire(root);
    if (avert.length !== 1 || !avert[0].texte.includes("état durable illisible")) ecarts.push(`(e) avertissement : ${JSON.stringify(avert)}`);
    if (!/classe illisible/.test(rendu[0]?.texte ?? "")) ecarts.push(`(e) illisible non rendu : ${JSON.stringify(rendu)}`);
    if (on.length !== 1 || on[0].genre !== "error" || !/^Montée refusée/.test(on[0].texte)) ecarts.push(`(e) montée non refusée : ${JSON.stringify(on)}`);
    if (ecriture?.block !== true || !/lecture seule/.test(ecriture.reason ?? "")) ecarts.push(`(e) lecture seule absente : ${JSON.stringify(ecriture)}`);
    if (JSON.stringify(avant) !== JSON.stringify(apres)) ecarts.push(`(e) effets du refus : ${JSON.stringify(ecartsDInventaire(avant, apres))}`);
  }
  propriete(ecarts.length === 0, `cycle on/off/on : ${JSON.stringify(ecarts)}`);
});

couverture("P2-H16", "new, resume, fork après une montée : ni minuterie, ni signal, ni identité de la session précédente", async () => {
  const ecarts: string[] = [];
  for (const raison of ["new", "resume", "fork"]) {
    const root = depot();
    const vu = await suivre(async (controleurs) => {
      const s = await montee(root);
      const runId = String(manifesteDe(root).runId);
      writeFileSync(join(root, RUNS, `${runId}-plan.json`), JSON.stringify(PLAN));
      const r = await s.outil.execute("h16", tache("W03"));
      precondition(!enErreur(r), `délégation : ${texte(r)}`);
      const leaseAvant = readdirSync(join(root, RUNS)).filter((n) => n.endsWith(".lease"));
      // Le contrôleur du bail de cette session : le dernier créé avant la fin de session.
      const duBail = controleurs.at(-1);
      await s.fermer();
      const n = controleurs.length;
      await s.demarrer(raison);
      return { s, runId, leaseAvant, duBail, neufs: controleurs.slice(n) };
    });
    const { s, runId, leaseAvant, duBail, neufs } = vu.resultat;
    const actives = vu.minuteries.filter((m) => !m.arretee);
    if (leaseAvant.length !== 1) ecarts.push(`${raison} : bail non pris pendant la session (${JSON.stringify(leaseAvant)})`);
    if (actives.length > 0) ecarts.push(`${raison} : ${actives.length} minuterie(s) encore active(s)`);
    if (!duBail?.signal.aborted) ecarts.push(`${raison} : le signal de la session précédente n'est pas abandonné`);
    if (neufs.length !== 1 || neufs[0].signal.aborted) ecarts.push(`${raison} : ${neufs.length} contrôleur(s) neuf(s) au session_start`);
    const rendu = await s.sub("");
    if (!/Profil : simple/.test(rendu[0]?.texte ?? "") || !(rendu[0]?.texte ?? "").includes(runId)) ecarts.push(`${raison} : rendu ${JSON.stringify(rendu)}`);
    // La protection durable reste : le run est non terminé, la session suivante est en lecture seule.
    const v = await s.appel("write", { path: "src/a.py", content: "x" });
    if (v?.block !== true) ecarts.push(`${raison} : la lecture seule ne s'applique pas`);
    if (readdirSync(join(root, RUNS)).some((n) => n.endsWith(".lease"))) ecarts.push(`${raison} : bail resté posé`);
  }

  // Q-P2-9 : l'historique, le compteur de scouts et leur propriétaire sont remis à neuf à T1 ; le
  // blocage non écrit d'un run reste attaché à ce run au-delà de T1.
  for (const raison of ["new", "resume", "fork"]) {
    {
      const root = depot();
      const s = await montee(root);
      const A = String(manifesteDe(root).runId);
      precondition(!enErreur(await s.outil.execute("s1", SCOUT)), `${raison} : scout de la session précédente`);
      precondition(!enErreur(await s.outil.execute("r1", { agent: "reviewer", task: "juger" })), `${raison} : revue de la session précédente`);
      await s.fermer();
      await s.demarrer(raison);
      await s.sub("on");
      precondition(String(manifesteDe(root).runId) === A, `${raison} : la montée doit porter sur le même run`);
      await s.invite();
      const h = await sonderHistoire(s, root, A);
      if (h !== "[]") ecarts.push(`${raison} : historique de la session précédente : ${h}`);
      PILOTE.resultat = { outOfScope: 1 } as never;
      const rv = await s.outil.execute("r2", { agent: "reviewer", task: "juger" });
      PILOTE.resultat = undefined;
      if (enErreur(rv) || !INDICE_SCOUT.test(texte(rv))) ecarts.push(`${raison} : revue de la session suivante : ${texte(rv).slice(0, 160)}`);
    }
    {
      const root = depot();
      const s = await montee(root);
      const A = String(manifesteDe(root).runId);
      await bloquerSansEcrire(s, root, A, `bl-${raison}`);
      await s.fermer();
      await s.demarrer(raison);
      // En simple : la restriction de lecture seule, posée par la classe non terminée.
      const ecriture = await s.appel("write", { path: "src/a.py", content: "x" }, `w-${raison}`);
      if (ecriture?.block !== true || !/lecture seule/.test(ecriture.reason ?? "")) ecarts.push(`${raison} : lecture seule absente en simple : ${JSON.stringify(ecriture)}`);
      // Après la montée : le refus du runtime, sur le blocage local du même run.
      await s.sub("on");
      await s.invite();
      writeFileSync(join(root, RUNS, `${A}-plan.json`), JSON.stringify(PLAN));
      const t = await s.outil.execute(`t-${raison}`, tache("W03"));
      if (!enErreur(t) || !texte(t).startsWith("[run: continuation bloquée]")) ecarts.push(`${raison} : blocage local perdu : ${texte(t).slice(0, 160)}`);
    }
  }

  // Un rappel de l'ancienne session, terminé après T1, ne repeuple ni l'historique ni le compteur.
  {
    const root = depot();
    const s = await montee(root);
    const ARappel = String(manifesteDe(root).runId);
    let liberer: () => void = () => {};
    const enCours = new Promise<void>((ok) => { liberer = ok; });
    PILOTE.pendant = async () => { await enCours; };
    const vol = s.outil.execute("sv", SCOUT);
    await new Promise((ok) => setTimeout(ok, 100));
    await s.fermer();
    await s.demarrer("new");
    PILOTE.pendant = undefined;
    liberer();
    const r = await vol;
    if (!enErreur(r) || !texte(r).startsWith("[run: propriété perdue]")) ecarts.push(`rappel en vol admis : ${texte(r).slice(0, 160)}`);
    // RA-P2-6 : le rappel nomme le run de sa capacité, jamais une identité vide.
    if (!texte(r).includes(`mais ${ARappel} ne nous`)) ecarts.push(`rappel en vol : run non nommé : ${texte(r).slice(0, 160)}`);
    if (readdirSync(join(root, RUNS)).some((n) => n.startsWith("-") || n.startsWith(".lease"))) ecarts.push("rappel en vol : chemin construit sur une identité vide");
    await s.sub("on");
    await s.invite();
    const A = String(manifesteDe(root).runId);
    const h = await sonderHistoire(s, root, A);
    if (h !== "[]") ecarts.push(`rappel en vol : historique repeuplé : ${h}`);
    PILOTE.resultat = { outOfScope: 1 } as never;
    const rv = await s.outil.execute("rv", { agent: "reviewer", task: "juger" });
    PILOTE.resultat = undefined;
    if (!INDICE_SCOUT.test(texte(rv))) ecarts.push(`rappel en vol : compteur de scouts repeuplé : ${texte(rv).slice(0, 160)}`);
  }
  // RA-P2-6 (`b5cf332a…` § 6) : une exécution qui attend son tour dans la file d'unités au moment d'un T1
  // ne fait rien ensuite — ni réservation, ni séquence, ni enfant, ni chemin sur une identité vide —, que
  // la session suivante reste en simple ou remonte sur le même run.
  for (const remontee of [false, true]) {
    const nom = remontee ? "file, remontée sur le même run" : "file, sans remontée";
    const root = depot();
    const s = await montee(root);
    const A = String(manifesteDe(root).runId);
    writeFileSync(join(root, RUNS, `${A}-plan.json`), JSON.stringify(PLAN));
    let liberer: () => void = () => {};
    const enCours = new Promise<void>((ok) => { liberer = ok; });
    PILOTE.pendant = async () => { await enCours; };
    const premier = s.outil.execute(`f1-${remontee}`, tache("W03"));
    await new Promise((ok) => setTimeout(ok, 100));
    PILOTE.pendant = undefined;
    const second = s.outil.execute(`f2-${remontee}`, tache("W03"));
    await new Promise((ok) => setTimeout(ok, 50));
    const appels = APPELS.length;
    await s.fermer();
    await s.demarrer("new");
    if (remontee) {
      await s.sub("on");
      await s.invite();
      precondition(String(manifesteDe(root).runId) === A, `${nom} : la remontée doit porter sur ${A}`);
    }
    liberer();
    await premier;
    const r2 = await second;
    if (!enErreur(r2) || !texte(r2).startsWith("[run: identité changée]")) ecarts.push(`${nom} : l'attente a agi : ${texte(r2).slice(0, 160)}`);
    if (APPELS.length !== appels) ecarts.push(`${nom} : ${APPELS.length - appels} enfant(s) lancé(s) après le T1`);
    if (readdirSync(join(root, RUNS)).some((n) => n.startsWith("-") || n.startsWith(".lease"))) ecarts.push(`${nom} : chemin construit sur une identité vide`);
  }

  // Q-P2-9, Q-P2-14, Q-P2-15 — contre-épreuve A/B, par T1 : A porte un blocage non écrit et une
  // attente C6.4 ; fin de A par l'opérateur, montée de B en traversant la preuve de A ; puis B porte
  // son propre blocage non écrit. Ni perte, ni imputation croisée, ni jugement de A sous B.
  let RACINE_AB: string | undefined;
  let SESSION_AB: Session | undefined;
  {
    const root = depotBundle();
    const s = await montee(root);
    RACINE_AB = root;
    SESSION_AB = s;
    const A = String(manifesteDe(root).runId);
    preparerPhaseStatut(root, A, true);
    const eA = bailEtranger(root, A, "ab1");
    const preuveA = await appelStatutObserve(s, root, A, "ab1");
    precondition(releaseRunOwnership(join(root, RUNS), eA), "le bail étranger de A doit être relâché");
    await s.fermer();
    await s.demarrer("new");
    const fin = recover(root, "run", "abandoned", "--reason", "fixture A/B");
    precondition(fin.status === 0, `fin de A : ${fin.sortie}`);
    const conservees = preuvesP0B(root);
    const on = await s.sub("on");
    if (on.some((n) => n.genre === "error")) ecarts.push(`A/B : montée de B refusée : ${JSON.stringify(on)}`);
    const B = String(manifesteDe(root).runId);
    if (B === A) ecarts.push("A/B : aucun nouveau run");
    else await descenteAdmiseSurVide(s, root, B, "A/B", ecarts);
    await s.invite();
    if (!(preuveA in conservees) || JSON.stringify(preuvesP0B(root)) !== JSON.stringify(conservees)) {
      ecarts.push(`A/B : preuve de A non conservée : ${JSON.stringify(Object.keys(preuvesP0B(root)))}`);
    }
    writeFileSync(join(root, RUNS, `${B}-plan.json`), JSON.stringify(PLAN));
    const appels = APPELS.length;
    const r = await s.outil.execute("ab-b1", tache("W03"));
    if (enErreur(r) || APPELS.length !== appels + 1) ecarts.push(`A/B : sous B, délégation refusée : ${texte(r).slice(0, 200)}`);
    if (manifesteDe(root).continuation_block !== undefined) ecarts.push("A/B : blocage durable posé sur B par l'entrée de A");
  }
  // Le blocage propre de B : T1 rend le bail de la session, remontée sur B, appel observé bloqué. Il
  // n'a de sens que si B n'est pas déjà bloqué par l'entrée de A (écart constaté ci-dessus).
  if (!ecarts.some((e) => e.startsWith("A/B"))) {
    const root = RACINE_AB!;
    const s = SESSION_AB!;
    const B = String(manifesteDe(root).runId);
    await s.fermer();
    await s.demarrer("new");
    await s.sub("on");
    await s.invite();
    precondition(String(manifesteDe(root).runId) === B, "la remontée doit porter sur B");
    const eB = bailEtranger(root, B, "ab2");
    const v = await s.appel("bash", { command: "python3 -c 'x'" }, "ab2");
    precondition(v === undefined, `l'appel observé de B doit passer : ${JSON.stringify(v)}`);
    writeFileSync(join(root, "src", "b.py"), "b = 'ab2'\n");
    await s.resultat("ab2");
    precondition(manifesteDe(root).continuation_block === undefined, "le blocage de B ne doit pas être écrit");
    precondition(releaseRunOwnership(join(root, RUNS), eB), "le bail étranger de B doit être relâché");
    const t = await s.outil.execute("ab-b2", tache("W09"));
    if (!enErreur(t) || !texte(t).startsWith("[run: continuation bloquée]") || !texte(t).includes(`ite-p0b/${B}-`)) {
      ecarts.push(`A/B : blocage local de B absent ou imputé : ${texte(t).slice(0, 220)}`);
    }
    if (manifesteDe(root).continuation_block !== undefined) ecarts.push("A/B : blocage durable posé sur B à la seconde réévaluation");
  }

  // Q-P2-15 — volet A courant, après T1 : l'entrée en attente de A est rejugée sous A. Un second appel
  // observé public (le contournement de B3-statut-inline) rend la variation de DESIGN.md
  // inexplicable ; il est jugé à son propre résultat, sans entrée en attente, et son blocage
  // échoue à s'écrire (bail tenu ailleurs). Le blocage DURABLE de A ne peut donc venir que de la
  // réévaluation de l'entrée en attente : absent avant `task`, posé par lui. Le témoin, sans
  // fenêtre préparée, n'a aucune entrée : aucun blocage durable. Le refus de `task` seul ne prouve
  // rien ici, le blocage local de P0-B le pose déjà dans tous les cas.
  for (const raison of ["new", "resume", "fork"]) {
    for (const fenetre of [true, false]) {
      const nom = `${raison}, ${fenetre ? "fenêtre préparée" : "témoin sans fenêtre"}`;
      const root = depotBundle();
      const s = await montee(root);
      const A = String(manifesteDe(root).runId);
      preparerPhaseStatut(root, A, fenetre);
      const e = bailEtranger(root, A, `ac-${raison}`);
      await appelStatutObserve(s, root, A, `ac1-${raison}`);
      const v = await s.appel("bash", { command: CONTOURNEMENT }, `ac2-${raison}`);
      precondition(v === undefined, `${nom} : le contournement doit passer l'avant-appel : ${JSON.stringify(v)}`);
      appendFileSync(join(root, "DESIGN.md"), "x");
      await s.resultat(`ac2-${raison}`);
      precondition(manifesteDe(root).continuation_block === undefined, `${nom} : aucun blocage écrit avant la reprise`);
      precondition(releaseRunOwnership(join(root, RUNS), e), `${nom} : le bail étranger doit être relâché`);
      await s.fermer();
      await s.demarrer(raison);
      await s.sub("on");
      await s.invite();
      precondition(String(manifesteDe(root).runId) === A, `${nom} : la remontée doit porter sur A`);
      precondition(manifesteDe(root).continuation_block === undefined, `${nom} : aucun blocage durable avant task`);
      const preuves = JSON.stringify(preuvesP0B(root));
      const t0 = new Date().toISOString();
      const t = await s.outil.execute(`ac-t-${raison}`, tache("W09"));
      const bloc = manifesteDe(root).continuation_block as { at?: string; code?: string } | undefined;
      if (!enErreur(t) || !texte(t).startsWith("[run: continuation bloquée]")) ecarts.push(`${nom} : task non refusé : ${texte(t).slice(0, 160)}`);
      if (JSON.stringify(preuvesP0B(root)) !== preuves) ecarts.push(`${nom} : une preuve P0-B nouvelle est apparue pendant task`);
      if (fenetre && (bloc?.code !== "RUN_CONTINUATION_BLOCKED" || String(bloc.at) < t0)) {
        ecarts.push(`${nom} : l'entrée en attente de A n'a pas été rejugée sous A (blocage durable ${JSON.stringify(bloc)})`);
      }
      if (!fenetre && bloc !== undefined) ecarts.push(`${nom} : blocage durable sans entrée en attente : ${JSON.stringify(bloc)}`);
    }
  }
  propriete(ecarts.length === 0, `changements de session : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H17 — restauration après la fin du run

couverture("P2-H17", "fin de run par l'outil opérateur : B rendue sans task, à la relecture et à la session suivante ; jamais tous les outils", async () => {
  const root = depot();
  await runActif(root);
  // L'opérateur a exclu `edit` (`--tools`) : B ne le porte pas, et la levée ne l'invente pas.
  const B = ["read", "grep", "find", "ls", "bash", "write", "task"];
  const s = await charger(root, { actifs: B });
  await s.demarrer();
  const restreinte = [...s.outils.actifs];
  const fin = recover(root, "run", "abandoned", "--reason", "fixture");
  precondition(fin.status === 0, `fin du run : ${fin.sortie}`);
  await s.sub("");
  const apresCommande = [...s.outils.actifs];
  s.outils.actifs = [...LECTURE];
  await s.fermer();
  s.outils.actifs = [...B];
  await s.demarrer("new");
  const sessionSuivante = [...s.outils.actifs];
  const attendue = ["read", "grep", "find", "ls", "bash", "write"];
  propriete(
    JSON.stringify([...restreinte].sort()) === JSON.stringify([...LECTURE].sort()) &&
      JSON.stringify(apresCommande) === JSON.stringify(attendue) &&
      JSON.stringify(sessionSuivante) === JSON.stringify(attendue),
    `restreinte ${JSON.stringify(restreinte)}, après la commande ${JSON.stringify(apresCommande)}, ` +
      `session suivante ${JSON.stringify(sessionSuivante)} ; attendue ${JSON.stringify(attendue)}`,
  );
});

// ================================================================== H18, H19 — task refusé hors profil

async function refusHorsProfil(viaToolCall: boolean): Promise<string[]> {
  const ecarts: string[] = [];
  const root = depot();
  const s = await charger(root);
  await s.demarrer();
  // Une autre extension réactive `task` dans la liste du modèle.
  s.outils.actifs = [...s.outils.actifs, "task"];
  const avant = { inventaire: inventaire(root), appels: APPELS.length };
  if (viaToolCall) {
    const v = await s.appel("task", tache("W03"), "t-etranger");
    if (v !== undefined) ecarts.push(`tool_call en simple, run absent : ${JSON.stringify(v)}`);
  }
  const r = await s.outil.execute("t-etranger", tache("W03"));
  const apres = { inventaire: inventaire(root), appels: APPELS.length };
  const details = (r as { details?: { profil?: { code?: string } } })?.details?.profil?.code;
  if (texte(r) !== REFUS_PROFIL_SIMPLE || !enErreur(r) || details !== "PROFIL_SIMPLE") ecarts.push(`refus ${JSON.stringify(r)}`);
  if (apres.appels !== avant.appels) ecarts.push("un enfant a été lancé");
  ecarts.push(...ecartsDInventaire(avant.inventaire, apres.inventaire));
  return ecarts;
}

couverture("P2-H18", "task.execute en simple après une réactivation étrangère : refus avant tout effet", async () => {
  const ecarts = await refusHorsProfil(true);
  propriete(ecarts.length === 0, `réactivation étrangère : ${JSON.stringify(ecarts)}`);
});

couverture("P2-H19", "task.execute appelé directement, hors tool_call : même refus, sans effet", async () => {
  const ecarts = await refusHorsProfil(false);
  propriete(ecarts.length === 0, `appel direct : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H20 — décisions sur l'état relu

couverture("P2-H20", "le run courant change entre deux commandes et deux sessions : la décision porte sur l'état relu", async () => {
  const ecarts: string[] = [];
  // Entre deux commandes, en simple : run vide, puis terminé et remplacé par un run non terminé.
  {
    const root = depot();
    const premier = runVide(root);
    const s = await charger(root);
    await s.demarrer();
    if (s.outils.actifs.length !== 7) ecarts.push(`run vide : outils ${JSON.stringify(s.outils.actifs)}`);
    precondition(recover(root, "run", "abandoned", "--reason", "fixture").status === 0, "fin du premier run");
    const second = runVide(root);
    writeFileSync(join(root, RUNS, `${second}-refusals.jsonl`), "{}\n");
    const dit = await s.sub("off");
    if (!(dit[0]?.texte ?? "").includes(second) || (dit[0]?.texte ?? "").includes(premier)) ecarts.push(`rendu ${JSON.stringify(dit)}`);
    if (JSON.stringify([...s.outils.actifs].sort()) !== JSON.stringify([...LECTURE].sort())) {
      ecarts.push(`run devenu non terminé : la lecture seule ne s'applique pas (${JSON.stringify(s.outils.actifs)})`);
    }
    // Entre deux sessions : le run devient illisible ; la montée est refusée.
    await s.fermer();
    writeFileSync(join(root, RUNS, "active-run.json"), "{pas du json");
    await s.demarrer("new");
    const on = await s.sub("on");
    if (on[0]?.genre !== "error" || !/illisible/.test(on[0]?.texte ?? "")) ecarts.push(`montée sur illisible : ${JSON.stringify(on)}`);
  }
  // En sous-agents : le run devient non terminé derrière la session ; la descente est refusée.
  {
    const root = depot();
    const s = await montee(root);
    const id = String(manifesteDe(root).runId);
    writeFileSync(join(root, RUNS, `${id}-refusals.jsonl`), "{}\n");
    const off = await s.sub("off");
    if (off[0]?.genre !== "error" || !/^Descente refusée/.test(off[0]?.texte ?? "")) ecarts.push(`descente sur un état périmé : ${JSON.stringify(off)}`);
  }
  propriete(ecarts.length === 0, `état relu : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H21 — erreur après le début des effets

couverture("P2-H21", "montée interrompue après le début de ses effets : rapportée telle, simple, lecture seule, sans retour automatique", async () => {
  const root = depot();
  const id = runVide(root, terminer("completed"));
  // Une garde de run restée posée : `openRun` échoue sous la garde d'espace, après le marqueur.
  const garde = join(root, RUNS, `${id}.guard`);
  mkdirSync(garde);
  const vieux = new Date(Date.now() - 3_600_000);
  utimesSync(garde, vieux, vieux);
  const s = await charger(root);
  await s.demarrer();
  const dit = await s.sub("on");
  const { options } = await s.invite();
  const r = await s.outil.execute("h21", tache("W03"));
  const lecture = [...s.outils.actifs];
  const rendu = await s.sub("off");
  const encore = await s.sub("on");
  const t = dit[0]?.texte ?? "";
  propriete(
    dit.length === 1 && dit[0].genre === "error" && /^Montée interrompue après le début de ses effets/.test(t) &&
      /ont pu être écrits/.test(t) && !/Rien n'a été/.test(t) &&
      existsSync(garde) && existsSync(join(root, RUNS, "active-run.json")) &&
      options.sections.delegation === undefined && texte(r) === REFUS_PROFIL_SIMPLE &&
      JSON.stringify([...lecture].sort()) === JSON.stringify([...LECTURE].sort()) &&
      JSON.stringify([...s.outils.actifs].sort()) === JSON.stringify([...LECTURE].sort()) &&
      /illisible/.test(rendu[0]?.texte ?? "") && encore[0]?.genre === "error",
    `montée ${JSON.stringify(dit)}, outils ${JSON.stringify(lecture)} puis ${JSON.stringify(s.outils.actifs)}, ` +
      `rendu ${JSON.stringify(rendu)}, nouvelle montée ${JSON.stringify(encore)}`,
  );
});

// ================================================================== H22 — navigation dans l'arbre

// ================================================================== H21b — descente interrompue (RA-P2-5)

couverture("P2-H21b", "descente interrompue après le début de ses effets : simple, lecture seule, effets et bail restant nommés", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const s = await montee(root);
  const A = String(manifesteDe(root).runId);
  writeFileSync(join(root, RUNS, `${A}-plan.json`), JSON.stringify(PLAN));
  const r = await s.outil.execute("h21b", tache("W03"));
  precondition(!enErreur(r) && existsSync(join(root, RUNS, `${A}.lease`)), `la délégation doit prendre le bail : ${texte(r).slice(0, 120)}`);
  // PRÉPARATION DÉCLARÉE, non publique : le manifeste rendu terminal sans archivage (T5 admis), et un
  // vestige de transition `<id>.guard` périmé, qui fait lever la libération du bail
  // (`TransitionLockedError`). Rien de cela n'est produit par pi.
  const m = manifesteDe(root);
  terminer("completed")(m);
  ecrireManifeste(root, m);
  const garde = join(root, RUNS, `${A}.guard`);
  mkdirSync(garde);
  const vieux = new Date(Date.now() - 60_000);
  utimesSync(garde, vieux, vieux);
  // L'espace des runs, comme H10 : bail, vestige, manifeste et registres.
  const avant = inventaire(join(root, RUNS));
  let dit: Notification[] = [];
  try {
    dit = await s.sub("off");
  } catch (err) {
    ecarts.push(`exception sortie de /subagents off : ${err instanceof Error ? err.message : String(err)}`);
  }
  const apres = inventaire(join(root, RUNS));
  const t = dit[0]?.texte ?? "";
  if (dit.length !== 1 || dit[0].genre !== "error" || !t.startsWith("Descente interrompue après le début de ses effets")) {
    ecarts.push(`descente non rapportée comme interrompue : ${JSON.stringify(dit)}`);
  }
  if (!t.includes(`${A}.lease`) || !/battement arrêté/.test(t) || !/lecture seule/.test(t)) ecarts.push(`effets ou bail restant non nommés : ${t.slice(0, 300)}`);
  if (s.outils.actifs.includes("task")) ecarts.push(`task encore actif : ${JSON.stringify(s.outils.actifs)}`);
  const ecriture = await s.appel("write", { path: "src/a.py", content: "x" }, "h21b-w");
  if (ecriture?.block !== true || !/lecture seule/.test(ecriture.reason ?? "")) ecarts.push(`lecture seule absente : ${JSON.stringify(ecriture)}`);
  const rendu = await s.sub("");
  if (!/Profil : simple/.test(rendu[0]?.texte ?? "")) ecarts.push(`profil : ${JSON.stringify(rendu)}`);
  // Aucun nettoyage ni relâchement forcé : le bail et le vestige restent, rien d'autre ne change.
  if (JSON.stringify(avant) !== JSON.stringify(apres)) ecarts.push(`effets de la descente : ${JSON.stringify(ecartsDInventaire(avant, apres))}`);
  if (!existsSync(join(root, RUNS, `${A}.lease`)) || !existsSync(garde)) ecarts.push("bail ou vestige retiré");
  // RAR2-10 : le bail resté est annoncé comme relevé présent, pas supposé.
  if (!t.includes(`Reste posé : le bail de ${A} (${RUNS}/${A}.lease), relevé présent après l'erreur`) ||
      t.includes("Bail relevé absent") || t.includes("indéterminé après l'erreur")) {
    ecarts.push(`état du bail non annoncé comme relevé présent : ${t.slice(0, 400)}`);
  }
  propriete(ecarts.length === 0, `descente interrompue : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H21c — état du bail relevé (RAR2-10)

type FonctionFs = "rmSync" | "lstatSync";

/**
 * PRÉPARATION DÉCLARÉE, non publique (`e9a5c3a5…` § 4.2) : une fonction de `node:fs` substituée dans le
 * processus d'épreuve, le temps d'une commande, puis restaurée. Le runtime n'est pas modifié ; seule la
 * réponse du système de fichiers à un chemin nommé l'est. Rend la fonction de restauration.
 */
function substituerFs<K extends FonctionFs>(nom: K, faux: (chemin: string, vrai: (...a: unknown[]) => unknown, args: unknown[]) => unknown): () => void {
  const fs = createRequire(import.meta.url)("node:fs") as Record<FonctionFs, (...a: unknown[]) => unknown>;
  const vrai = fs[nom];
  fs[nom] = (...args: unknown[]) => faux(String(args[0]), (...a: unknown[]) => vrai(...(a.length ? a : args)), args);
  syncBuiltinESMExports();
  return () => {
    fs[nom] = vrai;
    syncBuiltinESMExports();
  };
}

type VoletH21c = "absent" | "sans propriétaire" | "autre propriétaire" | "non-répertoire" | "lstat en erreur";

couverture("P2-H21c", "descente interrompue après la disparition du bail, ou au milieu de sa suppression : l'état relevé est annoncé, jamais supposé", async () => {
  const ecarts: string[] = [];
  const volets: VoletH21c[] = ["absent", "sans propriétaire", "autre propriétaire", "non-répertoire", "lstat en erreur"];
  for (const volet of volets) {
    const root = depot();
    const s = await montee(root);
    const A = String(manifesteDe(root).runId);
    writeFileSync(join(root, RUNS, `${A}-plan.json`), JSON.stringify(PLAN));
    const r = await s.outil.execute(`h21c-${volet}`, tache("W03"));
    const bail = join(root, RUNS, `${A}.lease`);
    const owner = join(bail, "owner.json");
    precondition(!enErreur(r) && existsSync(owner), `${volet} : la délégation doit prendre le bail : ${texte(r).slice(0, 120)}`);
    // Comme H21b : le manifeste rendu terminal sans archivage, pour que T5 soit admis.
    const m = manifesteDe(root);
    terminer("completed")(m);
    ecrireManifeste(root, m);
    const garde = join(root, RUNS, `${A}.guard`);
    const avant = inventaire(join(root, RUNS));
    let injectee = 0;
    // absent, lstat en erreur : la suppression du bail réussit, puis la sortie de la garde de run lève.
    // sans propriétaire : la suppression retire le propriétaire, puis lève. autre propriétaire : le
    // propriétaire est remplacé par un autre bail, puis elle lève. non-répertoire : le répertoire est
    // retiré et un fichier prend son chemin, puis elle lève.
    const restaurerRm = substituerFs("rmSync", (chemin, vrai) => {
      if ((volet === "absent" || volet === "lstat en erreur") && chemin === garde) {
        injectee += 1;
        throw Object.assign(new Error("EBUSY: injectée par H21c"), { code: "EBUSY" });
      }
      if (chemin === bail && volet !== "absent" && volet !== "lstat en erreur") {
        injectee += 1;
        if (volet === "sans propriétaire") vrai(owner, { force: true });
        if (volet === "autre propriétaire") {
          const doc = JSON.parse(readFileSync(owner, "utf-8")) as Record<string, unknown>;
          writeFileSync(owner, JSON.stringify({ ...doc, sessionId: "autre-h21c", leaseId: "autre0000000" }));
        }
        if (volet === "non-répertoire") {
          vrai(bail, { recursive: true, force: true });
          writeFileSync(bail, "pas un répertoire\n");
        }
        throw Object.assign(new Error("EIO: injectée par H21c"), { code: "EIO" });
      }
      return vrai();
    });
    const restaurerLstat = volet === "lstat en erreur"
      ? substituerFs("lstatSync", (chemin, vrai) => {
        if (chemin === bail && injectee > 0) throw Object.assign(new Error("EACCES: injectée par H21c"), { code: "EACCES" });
        return vrai();
      })
      : () => {};
    let dit: Notification[] = [];
    try {
      dit = await s.sub("off");
    } catch (err) {
      ecarts.push(`${volet} : exception sortie de /subagents off : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      restaurerLstat();
      restaurerRm();
    }
    precondition(injectee === 1, `${volet} : une seule erreur injectée attendue (${injectee})`);
    const apres = inventaire(join(root, RUNS));
    const t = dit[0]?.texte ?? "";
    if (dit.length !== 1 || dit[0].genre !== "error" || !t.startsWith("Descente interrompue après le début de ses effets")) {
      ecarts.push(`${volet} : descente non rapportée comme interrompue : ${JSON.stringify(dit)}`);
    }
    if (!t.includes(`${A}.lease`) || !/battement arrêté/.test(t) || !/lecture seule/.test(t)) ecarts.push(`${volet} : effets ou bail non nommés : ${t.slice(0, 300)}`);
    if (t.includes("Reste posé") || /deviendra périmé/.test(t)) ecarts.push(`${volet} : bail restant affirmé sans être relevé : ${t.slice(0, 400)}`);
    const annonce: Record<VoletH21c, string> = {
      "absent": `Bail relevé absent après l'erreur : ${RUNS}/${A}.lease n'existe plus`,
      "sans propriétaire": `État du bail de ${A} (${RUNS}/${A}.lease) indéterminé après l'erreur : le répertoire reste, sans propriétaire lisible`,
      "autre propriétaire": `État du bail de ${A} (${RUNS}/${A}.lease) indéterminé après l'erreur : le répertoire reste, sous un autre propriétaire`,
      "non-répertoire": `État du bail de ${A} (${RUNS}/${A}.lease) indéterminé après l'erreur : ce n'est pas un répertoire (lien ou fichier)`,
      "lstat en erreur": `État du bail de ${A} (${RUNS}/${A}.lease) indéterminé après l'erreur : illisible : EACCES: injectée par H21c`,
    };
    if (!t.includes(annonce[volet])) ecarts.push(`${volet} : état non annoncé tel que relevé : ${t.slice(0, 400)}`);
    if (s.outils.actifs.includes("task")) ecarts.push(`${volet} : task encore actif : ${JSON.stringify(s.outils.actifs)}`);
    const ecriture = await s.appel("write", { path: "src/a.py", content: "x" }, `h21c-w-${volet}`);
    if (ecriture?.block !== true || !/lecture seule/.test(ecriture.reason ?? "")) ecarts.push(`${volet} : lecture seule absente : ${JSON.stringify(ecriture)}`);
    const rendu = await s.sub("");
    if (!/Profil : simple/.test(rendu[0]?.texte ?? "")) ecarts.push(`${volet} : profil : ${JSON.stringify(rendu)}`);
    // Effets comparés : seuls ceux de la libération tentée et de la préparation ; aucune réparation.
    const sousBail = avant.filter((l) => l.split("\t")[0].startsWith(`${A}.lease`)).map((l) => `- ${l.split("\t")[0]}`);
    const attendus: Record<VoletH21c, string[]> = {
      "absent": [...sousBail, `+ ${A}.guard`],
      "lstat en erreur": [...sousBail, `+ ${A}.guard`],
      "sans propriétaire": [`- ${join(`${A}.lease`, "owner.json")}`],
      "autre propriétaire": [`- ${join(`${A}.lease`, "owner.json")}`, `+ ${join(`${A}.lease`, "owner.json")}`],
      "non-répertoire": [...sousBail, `+ ${A}.lease`],
    };
    const vus = ecartsDInventaire(avant, apres);
    if (JSON.stringify([...vus].sort()) !== JSON.stringify([...attendus[volet]].sort())) ecarts.push(`${volet} : effets ${JSON.stringify(vus)} au lieu de ${JSON.stringify(attendus[volet])}`);
  }
  propriete(ecarts.length === 0, `état du bail relevé : ${JSON.stringify(ecarts)}`);
});

couverture("P2-H22", "session_tree : la liste du profil est réimposée sur l'état relu, en simple et en sous-agents", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const s = await charger(root);
  await s.demarrer();
  // pi restaure les outils d'une branche où `task` était actif.
  s.outils.actifs = [...s.outils.actifs, "task"];
  await s.arbre();
  if (s.outils.actifs.includes("task")) ecarts.push(`simple : task restauré par la transcription (${JSON.stringify(s.outils.actifs)})`);
  await s.sub("on");
  await s.invite();
  // pi restaure les outils d'une branche antérieure à la montée.
  s.outils.actifs = s.outils.actifs.filter((n) => n !== "task");
  await s.arbre();
  if (!s.outils.actifs.includes("task")) ecarts.push(`sous-agents : task non réimposé (${JSON.stringify(s.outils.actifs)})`);
  const r = await s.outil.execute("h22", tache("W03"));
  if (!texte(r).startsWith(REFUS_DELEGATION_NON_COMPOSEE)) ecarts.push(`la composition survit à la navigation : ${texte(r).slice(0, 120)}`);
  // L'état est relu : un run devenu non terminé derrière la session pose la lecture seule en simple.
  await s.sub("off");
  const id = String(manifesteDe(root).runId);
  writeFileSync(join(root, RUNS, `${id}-refusals.jsonl`), "{}\n");
  await s.arbre();
  if (JSON.stringify([...s.outils.actifs].sort()) !== JSON.stringify([...LECTURE].sort())) ecarts.push(`état non relu : ${JSON.stringify(s.outils.actifs)}`);
  propriete(ecarts.length === 0, `session_tree : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H23 — /reload et la base gardée

couverture("P2-H23", "/reload : la base gardée de cette session est rendue sans task ; jamais la liste restreinte ni tous les outils", async () => {
  const ecarts: string[] = [];
  const B = ["read", "grep", "find", "ls", "bash", "write", "task"];
  const sansTask = B.filter((n) => n !== "task");
  const root = depot();
  await runActif(root);
  const s1 = await charger(root, { actifs: B, session: "session-h23" });
  await s1.demarrer("startup");
  await s1.fermer();
  // `/reload` : module réévalué ; pi donne la liste courante, restreinte, plus les outils d'extension.
  const pi = [...LECTURE, "task"];
  const s2 = await charger(root, { actifs: pi, session: "session-h23" });
  await s2.demarrer("reload");
  if (JSON.stringify([...s2.outils.actifs].sort()) !== JSON.stringify([...LECTURE].sort())) ecarts.push(`reload, run non terminé : ${JSON.stringify(s2.outils.actifs)}`);
  precondition(recover(root, "run", "abandoned", "--reason", "fixture").status === 0, "fin du run");
  await s2.sub("");
  if (JSON.stringify(s2.outils.actifs) !== JSON.stringify(sansTask)) ecarts.push(`après la fin : ${JSON.stringify(s2.outils.actifs)} au lieu de B sans task`);
  const rendu = await s2.sub("");
  if (!/Profil : simple/.test(rendu[0]?.texte ?? "")) ecarts.push("profil hérité par le reload");
  // Contre-épreuves : une autre session, puis un autre répertoire, ne réemploient pas la base gardée.
  for (const [quoi, rootX, session] of [["autre session", root, "session-autre"], ["autre répertoire", depot(), "session-h23"]] as const) {
    if (quoi === "autre répertoire") await runActif(rootX);
    else runVide(rootX, (m) => { m.nextSeq = 2; });
    const sx = await charger(rootX, { actifs: pi, session });
    await sx.demarrer("reload");
    precondition(recover(rootX, "run", "abandoned", "--reason", "fixture").status === 0, "fin du run");
    await sx.sub("");
    if (JSON.stringify(sx.outils.actifs) !== JSON.stringify(LECTURE)) ecarts.push(`${quoi} : ${JSON.stringify(sx.outils.actifs)} — capacité inventée`);
  }
  propriete(ecarts.length === 0, `reload : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H24 — le relevé en simple

couverture("P2-H24", "/subagent-report en simple : relevé sur l'identité lue, sans mutation, sans bail, sans écriture", async () => {
  const root = depot();
  const runId = await runActif(root);
  const s = await charger(root);
  await s.demarrer();
  const avant = inventaire(join(root, RUNS));
  const dit = await s.rapport();
  const apres = inventaire(join(root, RUNS));
  const rendu = await s.sub("");
  propriete(
    dit.length === 1 && dit[0].genre === "info" && dit[0].texte.includes(`run ${runId}`) && /W03/.test(dit[0].texte) &&
      JSON.stringify(avant) === JSON.stringify(apres) && !readdirSync(join(root, RUNS)).some((n) => n.endsWith(".lease")) &&
      /Profil : simple/.test(rendu[0]?.texte ?? ""),
    `relevé ${JSON.stringify(dit).slice(0, 300)}, écarts ${JSON.stringify(ecartsDInventaire(avant, apres))}`,
  );
});

// ================================================================== H25 — C1 : refus avant openRun

couverture("P2-H25", "montée refusée avant openRun, sans effet, sur intégrations inexploitables et marqueur invalide ; admise sur archives seules", async () => {
  const ecarts: string[] = [];
  const cas: Array<[string, (r: string) => void]> = [
    ["intégrations inexploitables, planning", (r) => { runVide(r, (m) => { m.ledgers = { integrations: 1 }; }); }],
    ["intégrations inexploitables, active", (r) => { runVide(r, (m) => { m.status = "active"; m.ledgers = { integrations: 1 }; }); }],
    ["intégrations inexploitables, completed", (r) => { runVide(r, (m) => { terminer("completed")(m); m.ledgers = { integrations: 1 }; }); }],
    ["intégrations inexploitables, abandoned", (r) => { runVide(r, (m) => { terminer("abandoned")(m); m.ledgers = { integrations: 1 }; }); }],
    ["marqueur invalide sans manifeste", (r) => { mkdirSync(join(r, RUNS)); writeFileSync(join(r, RUNS, ".git"), "x\n"); }],
  ];
  for (const [quoi, preparer] of cas) {
    const root = depot();
    preparer(root);
    const s = await charger(root);
    await s.demarrer();
    const avant = inventaire(root);
    const dit = await s.sub("on");
    if (dit[0]?.genre !== "error" || !/^Montée refusée/.test(dit[0]?.texte ?? "")) ecarts.push(`${quoi} : ${JSON.stringify(dit)}`);
    ecarts.push(...ecartsDInventaire(avant, inventaire(root)).map((e) => `${quoi} : ${e}`));
  }
  // Contre-épreuve : seules des archives historiques ; la montée est admise et ouvre un run neuf.
  const root = depot();
  const ancien = runVide(root);
  precondition(recover(root, "run", "abandoned", "--reason", "fixture").status === 0, "archivage");
  const s = await charger(root);
  await s.demarrer();
  const dit = await s.sub("on");
  const nouveau = existsSync(join(root, RUNS, "active-run.json")) ? String(manifesteDe(root).runId) : "";
  if (dit[0]?.genre !== "info" || !nouveau || nouveau === ancien || !existsSync(join(root, RUNS, `${ancien}-run.json`))) {
    ecarts.push(`archives seules : ${JSON.stringify(dit)}, run ${nouveau}`);
  }
  propriete(ecarts.length === 0, `C1 : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H26 — voie (a)

const BRIEF = "Préfixe forcé par un handler antérieur.\n\n<brief>\nUn brief factice.\n</brief>\n";

couverture("P2-H26", "voie (a) : préfixe gardé à l'octet, délégation et guidelines ajoutées une fois, à la fin ; rien créé, rien en simple", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const s = await montee(root);
  const runId = String(manifesteDe(root).runId);
  const dues = lignesDeGuidelines((s.outil.promptGuidelines ?? []).map((g) => g.replace(`${RUNS}/<runId>-plan.json`, `${RUNS}/${runId}-plan.json`)));
  // 1. Un handler antérieur a forcé le prompt.
  const a = await s.invite((o) => { o.forceSystemPrompt = BRIEF; });
  const forcé = a.options.forceSystemPrompt ?? "";
  const suite = forcé.slice(BRIEF.length);
  if (!forcé.startsWith(BRIEF)) ecarts.push("préfixe préexistant modifié");
  if (forcé.split(BLOC).length !== 2 || !suite.startsWith(`\n\n${BLOC}`)) ecarts.push("bloc de délégation absent, dupliqué ou pas à la fin");
  const manquantes = dues.filter((l) => !suite.split("\n").includes(l));
  if (manquantes.length > 0) ecarts.push(`guidelines manquantes : ${manquantes.length}`);
  if (a.retour !== undefined) ecarts.push("systemPrompt retourné");
  // 2. Le prompt préexistant porte déjà tout : rien n'est ajouté.
  const b = await s.invite((o) => { o.forceSystemPrompt = forcé; });
  if (b.options.forceSystemPrompt !== forcé) ecarts.push("complément dupliqué");
  // 3. `subagent` d'abord, puis un handler d'épreuve qui force le prompt comme le brief : il reçoit le
  // rendu structuré, déjà complet, et `subagent` n'y ajoute rien (RA-P2-10).
  const c = await s.invite();
  {
    const opts = optionsDEpreuve(s.outils.actifs);
    const ev = evenementAvantAgent(opts) as { systemPrompt: string };
    await s.evenements.get("before_agent_start")!(ev, s.ctx());
    const recu = ev.systemPrompt;
    opts.forceSystemPrompt = `${recu}\n\n${BRIEF}`;
    const final = rendrePrompt(opts);
    if (!final.startsWith(recu) || !final.endsWith(BRIEF)) ecarts.push("ordre inverse : rendu reçu par le handler d'épreuve altéré");
    if (final.split(BLOC).length !== 2) ecarts.push(`ordre inverse : ${final.split(BLOC).length - 1} bloc(s) de délégation`);
    const v3 = await s.appel("task", tache("W03"), "h26-3");
    if (v3 !== undefined) ecarts.push(`ordre inverse : task refusé : ${JSON.stringify(v3)}`);
    await s.resultat("h26-3");
  }
  // 4. Aucun handler ne force : la propriété n'est pas créée.
  if (c.options.forceSystemPrompt !== undefined || "forceSystemPrompt" in c.options) ecarts.push("prompt forcé créé");
  // 5. En simple : le prompt forcé reste intact.
  await s.sub("off");
  const d = await s.invite((o) => { o.forceSystemPrompt = BRIEF; });
  if (d.options.forceSystemPrompt !== BRIEF) ecarts.push("simple : prompt forcé modifié");
  // 6. P0-C : plan terminal, task retiré ; aucune guideline de task n'est ajoutée, task n'est pas réactivé.
  const rootT = depot();
  const { s: t } = await runTerminal(rootT);
  const e = await t.invite((o) => { o.forceSystemPrompt = BRIEF; });
  const ajoutT = (e.options.forceSystemPrompt ?? "").slice(BRIEF.length);
  if (!ajoutT.includes(BLOC)) ecarts.push("P0-C : délégation absente");
  if (/<rules>/.test(ajoutT) || ajoutT.includes("plan.json")) ecarts.push("P0-C : guidelines de task ajoutées");
  if (t.outils.actifs.includes("task")) ecarts.push("P0-C : task réactivé");
  propriete(ecarts.length === 0, `voie (a) : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H27 — garde de composition (Q-P2-4)

/** Une exécution dont la composition échoue : les options refusent l'écriture de la section. */
const echecDeComposition = (o: OptionsDEpreuve) => { Object.freeze(o.sections); };
/** Une exécution dont le rendu, relu, porte le bloc mais des guidelines périmées. */
async function invitePartielle(s: Session): Promise<void> {
  const options = optionsDEpreuve(s.outils.actifs);
  const evenement = evenementAvantAgent(options);
  Object.defineProperty(evenement, "systemPrompt", {
    get: () => rendrePrompt({ ...options, toolGuidelines: { task: ["Une guideline périmée."] } }),
  });
  await s.evenements.get("before_agent_start")!(evenement, s.ctx());
}

couverture("P2-H27", "garde de composition : refus de task tant que la composition de l'exécution n'est pas établie", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const s = await montee(root);
  const runId = String(manifesteDe(root).runId);
  writeFileSync(join(root, RUNS, `${runId}-plan.json`), JSON.stringify(PLAN));
  const etat = () => ({
    appels: APPELS.length,
    seq: Number(manifesteDe(root).nextSeq),
    espace: readdirSync(join(root, RUNS)).sort().join(","),
    lanes: existsSync(join(root, ".git", "pi-lanes")) ? readdirSync(join(root, ".git", "pi-lanes")).sort().join(",") : "",
  });
  // Une exécution composée : la délégation part.
  const r0 = await s.outil.execute("k0", tache("W03"));
  if (enErreur(r0)) ecarts.push(`exécution composée refusée : ${texte(r0).slice(0, 160)}`);
  // 1. Succès antérieur, puis échec de la composition nouvelle : refus, sans UI, sans effet.
  const notes = s.notifications.length;
  await s.invite(echecDeComposition, { hasUI: false });
  if (s.notifications.length !== notes) ecarts.push("notification revendiquée sans UI");
  const avant = etat();
  const r1 = await s.outil.execute("k1", tache("W09"));
  if (!texte(r1).startsWith(REFUS_DELEGATION_NON_COMPOSEE) || !enErreur(r1)) ecarts.push(`échec après succès : ${texte(r1).slice(0, 160)}`);
  // 2. Refus par tool_call, avant tout enregistrement en vol de P0-B.
  const v = await s.appel("task", tache("W09"), "k2");
  if (v?.block !== true || !(v.reason ?? "").startsWith(REFUS_DELEGATION_NON_COMPOSEE)) ecarts.push(`tool_call : ${JSON.stringify(v)}`);
  // RA-P2-3 : AVANT le résultat de l'appel refusé, sans rien nettoyer, un appel observé de
  // l'orchestrateur n'est pas refusé par P0-B pour un appel en cours : rien n'a été enregistré en vol.
  const observe = await s.appel("bash", { command: "true" }, "k2b");
  if (observe !== undefined) ecarts.push(`appel en vol enregistré par le refus : ${JSON.stringify(observe)}`);
  await s.resultat("k2b");
  // Rien n'est resté en vol : la session est au repos et le relevé de l'appel ne rend aucun constat.
  const constat = await s.resultat("k2");
  if (constat !== undefined) ecarts.push(`constat après un appel refusé : ${JSON.stringify(constat)}`);
  if (JSON.stringify(etat()) !== JSON.stringify(avant)) ecarts.push(`effets : ${JSON.stringify(avant)} → ${JSON.stringify(etat())}`);
  if (existsSync(join(root, RUNS, `${runId}-refusals.jsonl`))) ecarts.push("journal de refus écrit");
  // 3. Composition partielle : le bloc est là, les guidelines dues sont périmées.
  await invitePartielle(s);
  const r3 = await s.outil.execute("k3", tache("W09"));
  if (!texte(r3).startsWith(REFUS_DELEGATION_NON_COMPOSEE)) ecarts.push(`composition partielle admise : ${texte(r3).slice(0, 160)}`);
  // 4. Un succès suivant ne vaut que pour son exécution.
  await s.invite();
  const r4 = await s.outil.execute("k4", tache("W09"));
  if (enErreur(r4)) ecarts.push(`succès suivant refusé : ${texte(r4).slice(0, 160)}`);
  await s.invite(echecDeComposition);
  const r5 = await s.outil.execute("k5", tache("W03"));
  if (!texte(r5).startsWith(REFUS_DELEGATION_NON_COMPOSEE)) ecarts.push("le succès précédent a levé la garde d'une autre exécution");
  if (!s.notifications.some((n) => n.genre === "error" && n.texte.startsWith(REFUS_DELEGATION_NON_COMPOSEE))) ecarts.push("aucune notification avec UI");
  // 5. Appel direct en simple : le profil est contrôlé d'abord.
  const simple = await charger(depot());
  await simple.demarrer();
  const r6 = await simple.outil.execute("k6", tache("W03"));
  if (texte(r6) !== REFUS_PROFIL_SIMPLE) ecarts.push(`ordre des contrôles : ${texte(r6).slice(0, 120)}`);
  propriete(ecarts.length === 0, `garde de composition : ${JSON.stringify(ecarts)}`);
});

couverture("P2-H27b", "garde de composition : aucun prompt forcé par repli, P0-C intact", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const s = await montee(root);
  const { options } = await s.invite(echecDeComposition);
  if (options.forceSystemPrompt !== undefined) ecarts.push("prompt forcé créé par repli");
  // P0-C : sur un plan terminal, la composition est établie et c'est P0-C qui refuse.
  const { s: t } = await runTerminal(depot());
  await t.invite();
  const r = await t.outil.execute("p0c", { agent: "scout", task: "localiser", find: "où est b.py", scope: ["src"] });
  const code = (r as { details?: { run_guard?: { code?: string } } })?.details?.run_guard?.code;
  if (code !== "ITE_PLAN_TERMINAL") ecarts.push(`P0-C : ${String(code)} ${texte(r).slice(0, 120)}`);
  propriete(ecarts.length === 0, `repli et P0-C : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H28 — changement de liste au cours d'une exécution

couverture("P2-H28", "plan rendu terminal au cours d'une exécution forcée et complétée : task retiré, appel préparé refusé, rien repris", async () => {
  const ecarts: string[] = [];
  const root = depot();
  const s = await montee(root);
  const runId = String(manifesteDe(root).runId);
  writeFileSync(join(root, RUNS, `${runId}-plan.json`), JSON.stringify(PLAN));
  for (const [unite, fichier, valeur, n] of [["W03", "src/a.py", "a = 2", "1"]]) {
    PILOTE.pendant = (a: { cwd?: string }) => { if (a.cwd) writeFileSync(join(a.cwd, fichier), `${valeur}\n`); };
    await s.outil.execute(`${n}a`, tache(unite));
    PILOTE.pendant = undefined;
    await s.outil.execute(`${n}b`, revue(unite));
    PILOTE.resultat = undefined;
  }
  // Une seule exécution, au prompt forcé et complété, pendant laquelle le plan devient terminal.
  const { options } = await s.invite((o) => { o.forceSystemPrompt = BRIEF; });
  const complete = options.forceSystemPrompt;
  if (!complete?.includes(`${runId}-plan.json`)) ecarts.push("le complément ne porte pas les guidelines dues");
  PILOTE.pendant = (a: { cwd?: string }) => { if (a.cwd) writeFileSync(join(a.cwd, "src", "b.py"), "b = 2\n"); };
  await s.outil.execute("2a", tache("W09"));
  PILOTE.pendant = undefined;
  const appelsAvant = s.outils.appels.length;
  await s.outil.execute("2b", revue("W09"));
  PILOTE.resultat = undefined;
  precondition((readFileSync(join(root, RUNS, `${runId}-lanes.jsonl`), "utf-8").match(/"INTEGRATED"/g) ?? []).length === 2, "plan terminal");
  if (s.outils.actifs.includes("task")) ecarts.push(`task encore exécutable : ${JSON.stringify(s.outils.actifs)}`);
  // L'appel préparé avant le changement : refusé par P0-C, dans la même exécution.
  const v = await s.appel("task", tache("W09"), "prepare");
  if (v?.block !== true || !/PLAN TERMINAL/.test(v.reason ?? "")) ecarts.push(`appel préparé : ${JSON.stringify(v)}`);
  if (options.forceSystemPrompt !== complete) ecarts.push("le complément a été repris");
  if (s.outils.appels.slice(appelsAvant).some((l) => l.includes("task"))) ecarts.push("task réactivé");
  if (!s.outils.appels.slice(appelsAvant).some((l) => !l.includes("task"))) ecarts.push("la liste n'a pas changé au cours de l'exécution");
  propriete(ecarts.length === 0, `changement de liste : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H29 — prompt personnalisé (Q-P2-22)

const CUSTOM = "Prompt personnalisé du dépôt.";

couverture("P2-H29", "prompt personnalisé non vide : aucune guideline due, délégation exigée ; chaîne vide et prompt forcé sans exemption", async () => {
  const ecarts: string[] = [];
  /** Une session montée, son plan, et l'état des effets d'une délégation. */
  const preparer = async () => {
    const root = depot();
    const s = await montee(root);
    const runId = String(manifesteDe(root).runId);
    writeFileSync(join(root, RUNS, `${runId}-plan.json`), JSON.stringify(PLAN));
    const etat = () => ({
      appels: APPELS.length,
      seq: Number(manifesteDe(root).nextSeq),
      espace: readdirSync(join(root, RUNS)).sort().join(","),
    });
    return { root, s, runId, etat };
  };
  /** La délégation de l'exécution courante : admise (un enfant de plus) ou refusée « non composée », sans effet. */
  const juger = async (nom: string, s: Session, etat: () => unknown, admise: boolean) => {
    const avant = etat();
    const appels = APPELS.length;
    const r = await s.outil.execute(`h29-${nom}`, tache("W03"));
    if (admise && (enErreur(r) || APPELS.length !== appels + 1)) ecarts.push(`${nom} : délégation non admise : ${texte(r).slice(0, 160)}`);
    if (!admise) {
      if (!enErreur(r) || !texte(r).startsWith(REFUS_DELEGATION_NON_COMPOSEE)) ecarts.push(`${nom} : refus causal absent : ${texte(r).slice(0, 160)}`);
      if (JSON.stringify(etat()) !== JSON.stringify(avant)) ecarts.push(`${nom} : effets d'un refus : ${JSON.stringify([avant, etat()])}`);
    }
  };
  // Témoin : sans prompt personnalisé, les règles sont rendues et les guidelines dues.
  {
    const { s, etat } = await preparer();
    const i = await s.invite();
    if (!/<rules>/.test(i.prompt) || !i.prompt.includes(BLOC)) ecarts.push("témoin : règles ou délégation non rendues");
    await juger("temoin", s, etat, true);
  }
  // Prompt personnalisé non vide : pi ne rend pas les règles ; aucune guideline n'est due, la délégation l'est.
  for (const [nom, custom] of [["personnalise", CUSTOM], ["blanc", " "]] as const) {
    const { s, etat, runId } = await preparer();
    const i = await s.invite((o) => { o.customPrompt = custom; });
    if (/<rules>/.test(i.prompt) || i.prompt.includes(`${runId}-plan.json`)) ecarts.push(`${nom} : règles rendues sous un prompt personnalisé`);
    if (i.prompt.split(BLOC).length !== 2) ecarts.push(`${nom} : délégation non rendue une fois`);
    if (i.options.forceSystemPrompt !== undefined) ecarts.push(`${nom} : prompt forcé créé`);
    await juger(nom, s, etat, true);
  }
  // Chaîne vide : pi n'emprunte pas la branche ; les guidelines restent dues — ici absentes du rendu.
  {
    const { s, etat } = await preparer();
    await s.invite((o) => { o.customPrompt = ""; });
    await juger("vide", s, etat, true);
    const options = optionsDEpreuve(s.outils.actifs);
    options.customPrompt = "";
    const evenement = evenementAvantAgent(options);
    Object.defineProperty(evenement, "systemPrompt", {
      get: () => rendrePrompt({ ...options, toolGuidelines: { task: ["Une guideline périmée."] } }),
    });
    await s.evenements.get("before_agent_start")!(evenement, s.ctx());
    await juger("vide-perimees", s, etat, false);
  }
  // Prompt personnalisé non vide, délégation non composée : refus.
  {
    const { s, etat } = await preparer();
    await s.invite((o) => { o.customPrompt = CUSTOM; echecDeComposition(o); });
    await juger("personnalise-sans-delegation", s, etat, false);
  }
  // Prompt personnalisé et prompt déjà forcé : complété de la seule délégation, préfixe intact, sans règles.
  {
    const { s, etat, runId } = await preparer();
    const i = await s.invite((o) => { o.customPrompt = CUSTOM; o.forceSystemPrompt = BRIEF; });
    const f = i.options.forceSystemPrompt ?? "";
    const ajout = f.slice(BRIEF.length);
    if (!f.startsWith(BRIEF) || ajout !== `\n\n${BLOC}`) ecarts.push(`personnalise-force : complément ${JSON.stringify(ajout.slice(0, 120))}`);
    if (ajout.includes(`${runId}-plan.json`)) ecarts.push("personnalise-force : guidelines ajoutées");
    await juger("personnalise-force", s, etat, true);
  }
  // Prompt forcé sans prompt personnalisé : aucune exemption ; les guidelines dues sont ajoutées.
  {
    const { s, etat, runId } = await preparer();
    const i = await s.invite((o) => { o.forceSystemPrompt = BRIEF; });
    const ajout = (i.options.forceSystemPrompt ?? "").slice(BRIEF.length);
    if (!ajout.includes(BLOC) || !ajout.includes(`${runId}-plan.json`)) ecarts.push("force-sans-personnalise : guidelines non ajoutées");
    await juger("force-sans-personnalise", s, etat, true);
  }
  propriete(ecarts.length === 0, `prompt personnalisé : ${JSON.stringify(ecarts)}`);
});

// ================================================================== H30, H31 — retours d'enfants survivants (RAR2-9)
//
// `e9a5c3a5…` § 4.1 : un enfant en vol pendant T8 revient à une session qui n'est plus la sienne.
// PRÉPARATION DÉCLARÉE, non publique : un vestige `<id>.guard` périmé, posé juste avant T8, fait lever la
// libération du bail (`TransitionLockedError`), puis il est retiré. Le propriétaire du bail reste sur le
// disque, à l'octet : la capacité capturée par l'enfant est encore reconnue. Un worker écrit `DESIGN.md`,
// chemin réservé, dans sa lane : un retour qui agirait journaliserait sa délégation et rendrait durable sa
// violation. Aucune archive n'est réactivée ; aucun runtime n'est modifié.
//
// Deux suites de session après T8, publiques l'une et l'autre :
//  - T1 dans la même instance : l'identité de la session est vidée. La remontée sur le même run n'est
//    admise qu'au repos ; tant que l'exécution précédente est en vol, `/subagents on` est refusé
//    (`auRepos`, constaté) : le même run est repris, sous le même bail, juste après le retour ;
//  - `/reload` : une instance neuve du module, de raison `reload` ; l'ancienne ne reçoit jamais de T1 et
//    garde son identité de run. Seule la génération, changée à T8, ferme alors son retour : c'est le
//    volet qui discrimine la génération et où un retour qui agirait laisserait des effets durables sous A.
//    L'historique de l'ancienne instance y est sondé (il n'est pas vidé avant la sonde).
//
// Effets comparés : l'inventaire complet de l'espace des runs, du dernier point avant le retour à la fin
// du retour. Limite déclarée : le vrai `dispatch` écrit l'artefact et la transcription de l'enfant à sa
// sortie, avant les barrières de l'extension ; le substitut n'en écrit pas.

/** T8 qui ne relâche pas le bail : rend le propriétaire, relevé à l'octet après T8. */
async function fermerSansRelacher(s: Session, root: string, A: string, nom: string): Promise<string> {
  const garde = join(root, RUNS, `${A}.guard`);
  mkdirSync(garde);
  const vieux = new Date(Date.now() - 60_000);
  utimesSync(garde, vieux, vieux);
  let leve = false;
  try {
    await s.fermer();
  } catch {
    leve = true;
  }
  rmSync(garde, { recursive: true });
  precondition(leve, `${nom} : T8 doit lever, faute de relâcher le bail`);
  return readFileSync(join(root, RUNS, `${A}.lease`, "owner.json"), "utf-8");
}

/** Les entrées construites sur une identité vide : `-…` ou `.lease`. */
const surIdentiteVide = (root: string): string[] => readdirSync(join(root, RUNS)).filter((n) => n.startsWith("-") || n.startsWith(".lease"));

type Suite = "T1" | "reload" | "T8 relâché" | "témoin";
interface OptionsRetour { suite: Suite; raison?: string; parallele?: number; mixte?: boolean }
interface Retour { root: string; s: Session; A: string; r: unknown; appelsAvant: number; appelsApres: number; changes: string[]; proprietaire?: string }

const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Un enfant en vol ; puis selon `suite` : T8 sans relâchement et T1 (remontée tentée pendant le vol) ;
 * T8 sans relâchement et `/reload` ; T8 ordinaire et T1 ; rien (témoin). `mixte` : dans un lot, W03
 * revient avant T8, W09 après.
 */
async function retourSurvivant(nom: string, params: unknown, o: OptionsRetour): Promise<Retour> {
  const root = depot();
  if (o.parallele !== undefined) process.env.PI_SUBAGENT_MAX_PARALLEL_LANES = String(o.parallele);
  let s: Session;
  try {
    s = await montee(root);
  } finally {
    delete process.env.PI_SUBAGENT_MAX_PARALLEL_LANES;
  }
  const A = String(manifesteDe(root).runId);
  writeFileSync(join(root, RUNS, `${A}-plan.json`), JSON.stringify(PLAN));
  let liberer: () => void = () => {};
  let libererW09: () => void = () => {};
  const enCours = new Promise<void>((ok) => { liberer = ok; });
  const enCoursW09 = new Promise<void>((ok) => { libererW09 = ok; });
  PILOTE.pendant = async (a: { cwd?: string; task?: string; agent?: string }) => {
    if (a.cwd && a.agent === "worker") writeFileSync(join(a.cwd, "DESIGN.md"), "réservé\n");
    await (o.mixte && a.task?.includes("W09") ? enCoursW09 : enCours);
  };
  const vol = s.outil.execute(`vol-${nom}`, params);
  // Les enfants attendus en vol : un par délégation, un par lane partie dans un lot (5 s au plus).
  const enVol = (params as { batch?: unknown[] }).batch ? Math.min(o.parallele ?? 2, 2) : 1;
  for (let i = 0; i < 50 && APPELS.length < enVol; i++) await attendre(100);
  precondition(APPELS.length === enVol, `${nom} : ${enVol} enfant(s) en vol attendu(s) (${APPELS.length})`);
  if (o.mixte) {
    // W03 revient avant T8 : sa délégation agit sous la session qui l'a lancée, jusqu'à rendre sa
    // violation durable ; on l'attend (5 s au plus) avant T8.
    liberer();
    const registre = join(root, RUNS, `${A}-lanes.jsonl`);
    const violationW03 = () => existsSync(registre) &&
      readFileSync(registre, "utf-8").split("\n").some((l) => l.includes("VIOLATION") && l.includes("W03"));
    for (let i = 0; i < 50 && !violationW03(); i++) await attendre(100);
    precondition(violationW03(), `${nom} : W03 doit avoir rendu sa violation durable avant T8`);
  }
  let proprietaire: string | undefined;
  if (o.suite === "T1" || o.suite === "reload") {
    proprietaire = await fermerSansRelacher(s, root, A, nom);
    if (o.suite === "T1") {
      await s.demarrer(o.raison ?? "new");
      const on = await s.sub("on");
      precondition(on.length === 1 && on[0].genre === "error" && /pas au repos/.test(on[0].texte),
        `${nom} : la remontée pendant le vol doit être refusée hors repos : ${JSON.stringify(on)}`);
    } else {
      const neuve = await charger(root, { reinitialiser: false });
      await neuve.demarrer("reload");
    }
    precondition(readFileSync(join(root, RUNS, `${A}.lease`, "owner.json"), "utf-8") === proprietaire,
      `${nom} : le bail antérieur doit rester reconnaissable (même propriétaire, même leaseId)`);
  } else if (o.suite === "T8 relâché") {
    await s.fermer();
    await s.demarrer(o.raison ?? "new");
    precondition(!existsSync(join(root, RUNS, `${A}.lease`)), `${nom} : T8 doit avoir relâché le bail`);
  }
  PILOTE.pendant = undefined;
  const appelsAvant = APPELS.length;
  const avant = inventaire(join(root, RUNS));
  if (o.mixte) libererW09();
  else liberer();
  const r = await vol;
  const appelsApres = APPELS.length;
  const changes = ecartsDInventaire(avant, inventaire(join(root, RUNS)));
  return { root, s: s!, A, r, appelsAvant, appelsApres, changes, proprietaire };
}

/** Le retour n'a pas agi : refus nommé, aucun enfant, aucun effet sur l'espace des runs, rien sur une identité vide. */
function nAPasAgi(x: Retour, nom: string, prefixe: string, ecarts: string[]): void {
  if (!enErreur(x.r) || !texte(x.r).startsWith(`${prefixe} sous le run ${x.A} ;`)) ecarts.push(`${nom} : le retour a agi : ${texte(x.r).slice(0, 220)}`);
  if (x.appelsApres !== x.appelsAvant) ecarts.push(`${nom} : ${x.appelsApres - x.appelsAvant} enfant(s) lancé(s) après la fin de la session`);
  if (x.changes.length > 0) ecarts.push(`${nom} : effets sur l'espace des runs : ${JSON.stringify(x.changes)}`);
  if (surIdentiteVide(x.root).length > 0) ecarts.push(`${nom} : chemin construit sur une identité vide : ${JSON.stringify(surIdentiteVide(x.root))}`);
}

/** Après un retour sous T1 : reprise du même run, sous le même bail. */
async function reprise(x: Retour, nom: string): Promise<void> {
  const on = await x.s.sub("on");
  precondition(!on.some((n) => n.genre === "error"), `${nom} : la reprise après le retour doit réussir : ${JSON.stringify(on)}`);
  precondition(String(manifesteDe(x.root).runId) === x.A, `${nom} : la reprise doit porter sur ${x.A}`);
  precondition(readFileSync(join(x.root, RUNS, `${x.A}.lease`, "owner.json"), "utf-8") === x.proprietaire,
    `${nom} : la reprise doit garder le bail antérieur (même propriétaire, même leaseId)`);
}

const REFUS_DELEGATION = "[run: identité changée] la délégation est revenue";
const REFUS_LOT = "[run: identité changée] le lot est revenu";

couverture("P2-H30", "délégation en vol pendant T8 sans relâchement : au retour, rien n'agit, après T1 comme sous une instance rechargée qui garde le run", async () => {
  const ecarts: string[] = [];
  for (const raison of ["new", "resume", "fork"]) {
    const nom = `délégation, T1 ${raison}`;
    const x = await retourSurvivant(nom, tache("W03"), { suite: "T1", raison });
    nAPasAgi(x, nom, REFUS_DELEGATION, ecarts);
    await reprise(x, nom);
  }
  // Rôle global, sans lane : un retour qui agirait compterait le scout et journaliserait sur l'identité vide.
  {
    const nom = "scout, T1 new";
    const x = await retourSurvivant(nom, SCOUT, { suite: "T1" });
    nAPasAgi(x, nom, REFUS_DELEGATION, ecarts);
  }
  // `/reload` : l'ancienne instance garde A ; seule la génération ferme le retour.
  {
    const nom = "délégation, reload";
    const x = await retourSurvivant(nom, tache("W03"), { suite: "reload" });
    nAPasAgi(x, nom, REFUS_DELEGATION, ecarts);
    const h = await sonderHistoire(x.s, x.root, x.A);
    if (h !== "[]") ecarts.push(`${nom} : historique de l'ancienne instance repeuplé : ${h}`);
  }
  // Témoin : la même délégation en vol, sans fin de session, revient à sa session : journal et violation durable.
  {
    const x = await retourSurvivant("délégation, témoin", tache("W03"), { suite: "témoin" });
    if (enErreur(x.r) || !x.changes.includes(`+ ${x.A}-delegations.jsonl`) || !x.changes.includes(`+ ${x.A}-lanes.jsonl`)) {
      ecarts.push(`témoin : le retour n'a pas agi : ${texte(x.r).slice(0, 160)} · ${JSON.stringify(x.changes)}`);
    }
  }
  propriete(ecarts.length === 0, `retours de délégation survivants : ${JSON.stringify(ecarts)}`);
});

couverture("P2-H31", "lot en vol pendant T8 sans relâchement : au retour, ni journal, ni violation, ni lane en file lancée ; bail relâché d'abord", async () => {
  const ecarts: string[] = [];
  const lot = { agent: "worker", batch: [{ work_unit: "W03", task: "écrire pour W03" }, { work_unit: "W09", task: "écrire pour W09" }] };
  for (const raison of ["new", "resume", "fork"]) {
    const nom = `lot, T1 ${raison}`;
    const x = await retourSurvivant(nom, lot, { suite: "T1", raison });
    precondition(x.appelsAvant === 2, `${nom} : deux workers en vol attendus (${x.appelsAvant})`);
    nAPasAgi(x, nom, REFUS_LOT, ecarts);
    await reprise(x, nom);
  }
  // Une lane en file au moment de la fin de session (une seule lane à la fois) : elle ne part pas, aucune séquence.
  for (const suite of ["T1", "reload"] as const) {
    const nom = `lot, lane en file, ${suite}`;
    const x = await retourSurvivant(nom, lot, { suite, parallele: 1 });
    precondition(x.appelsAvant === 1, `${nom} : un seul worker en vol attendu (${x.appelsAvant})`);
    nAPasAgi(x, nom, REFUS_LOT, ecarts);
  }
  // `/reload` : l'ancienne instance garde A ; un rappel qui agirait rendrait la violation durable sous A.
  {
    const nom = "lot, reload";
    const x = await retourSurvivant(nom, lot, { suite: "reload" });
    precondition(x.appelsAvant === 2, `${nom} : deux workers en vol attendus (${x.appelsAvant})`);
    nAPasAgi(x, nom, REFUS_LOT, ecarts);
    const h = await sonderHistoire(x.s, x.root, x.A);
    if (h !== "[]") ecarts.push(`${nom} : historique de l'ancienne instance repeuplé : ${h}`);
  }
  // Lot mixte sous `/reload` : W03 revient avant T8 et agit (violation durable) ; W09 revient après :
  // rien de plus, et le journal des délégations de ce lot n'est pas écrit.
  {
    const nom = "lot mixte, reload";
    const x = await retourSurvivant(nom, lot, { suite: "reload", mixte: true });
    precondition(x.appelsAvant === 2, `${nom} : deux workers lancés attendus (${x.appelsAvant})`);
    nAPasAgi(x, nom, REFUS_LOT, ecarts);
  }
  // Ordre des contrôles : bail relâché par T8, puis T1 ; le refus du lot est celui de la capacité perdue.
  {
    const nom = "lot, T8 relâché";
    const x = await retourSurvivant(nom, lot, { suite: "T8 relâché" });
    if (!enErreur(x.r) || !texte(x.r).startsWith(`[run: propriété perdue] le lot est revenu, mais ${x.A} ne nous appartient`)) {
      ecarts.push(`${nom} : refus attendu sur la capacité perdue : ${texte(x.r).slice(0, 200)}`);
    }
  }
  // Témoin : le même lot en vol, sans fin de session, journalise ses deux workers.
  {
    const x = await retourSurvivant("lot, témoin", lot, { suite: "témoin" });
    const journal = join(x.root, RUNS, `${x.A}-delegations.jsonl`);
    const lignes = existsSync(journal) ? readFileSync(journal, "utf-8").trim().split("\n").filter(Boolean) : [];
    if (enErreur(x.r) || lignes.length !== 2 || !x.changes.includes(`+ ${x.A}-lanes.jsonl`)) {
      ecarts.push(`témoin : lot non journalisé : ${texte(x.r).slice(0, 160)} · ${lignes.length} ligne(s) · ${JSON.stringify(x.changes)}`);
    }
  }
  propriete(ecarts.length === 0, `retours de lot survivants : ${JSON.stringify(ecarts)}`);
});
