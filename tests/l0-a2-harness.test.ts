/**
 * l0-a2-harness.test.ts — L0, vague A2 : ce qui demande le vrai `execute()` ou
 * l'argv réellement construit.
 *
 * Même montage que `l0-a-harness.test.ts` : vrai git, vrais worktrees, vrai
 * manifeste ; pi, typebox et dispatch substitués. `spawn-args` importe ses modules
 * internes en `.js`, que pi résout vers les sources — c'est le chargeur de
 * substitution qui le reproduit, et c'est pourquoi la preuve d'argv vit ici plutôt
 * que dans le fichier d'unités.
 *
 * Espèces : voir l'en-tête de `l0-a2-units.test.ts`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE, reinitialiser } from "./stubs/dispatch.ts";
import { readManifest } from "../subagent-only/run-manifest.ts";
import { loadAgents } from "../subagent-only/agents.ts";
import { buildSpawnPlan } from "../subagent-only/spawn-args.ts";

const RUNS = ".pi-subagent-runs";
const REPO = join(import.meta.dirname, "..");

// ------------------------------------------------------------------ espèces

function regression(id: string, titre: string, fn: () => Promise<void> | void): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function couverture(id: string, titre: string, fn: () => Promise<void> | void): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: () => Promise<void> | void): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

// ------------------------------------------------------------------ montage

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}
const agents = (): string[] => APPELS.map((a) => a.agent);
const compter = (role: string): number => APPELS.filter((a) => a.agent === role).length;
const texte = (r: unknown): string =>
  ((r as { content?: Array<{ text?: string }> })?.content ?? []).map((c) => c.text ?? "").join("");
const enErreur = (r: unknown): boolean => (r as { isError?: boolean })?.isError === true;
const lanes = (root: string): string[] => {
  const dir = join(root, ".git", "pi-lanes");
  return existsSync(dir) ? execFileSync("ls", [dir], { encoding: "utf-8" }).split("\n").filter(Boolean) : [];
};
const evenements = (h: { runDir: string; runId: string }): Array<{ event?: string }> => {
  const p = join(h.runDir, `${h.runId}-lanes.jsonl`);
  return existsSync(p)
    ? readFileSync(p, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
};
const tache = (unite: string) => ({ agent: "worker", work_unit: unite, task: `écrire pour ${unite}` });
const revue = (unite: string, extra: Record<string, unknown> = {}) => {
  PILOTE.resultat = { verdict: "approved", changedFiles: [], ...extra } as never;
  return { agent: "reviewer", work_unit: unite, task: "juger" };
};
const ecrire = (rel: string, contenu: string) => (a: { cwd?: string }) => {
  if (a.cwd) writeFileSync(join(a.cwd, rel), contenu);
};

const PLAN = {
  version: 1,
  work_units: [
    { id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py"] },
    { id: "W09", goal: "faire W09", depends_on: [], expected_write_scope: ["src/b.py"] },
  ],
};

let generation = 0;
async function charger(root: string) {
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  reinitialiser();
  generation += 1;
  const module = await import(`../extensions/subagent/index.ts?l0a2=${generation}`);
  let outil: { execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown> } | undefined;
  module.default({
    on: () => {},
    registerTool: (t: unknown) => { outil = t as typeof outil; },
    registerCommand: () => {},
    ui: { setStatus: () => {}, setFooter: () => {} },
  });
  const manifeste = readManifest(join(root, RUNS));
  precondition(manifeste !== undefined && outil !== undefined, "le run et l'outil doivent exister au chargement");
  return {
    root,
    runDir: join(root, RUNS),
    runId: manifeste!.runId,
    outil: outil!,
    fin: () => { process.chdir(REPO); rmSync(root, { recursive: true, force: true }); },
  };
}
async function monter(plan: unknown = PLAN) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0a2-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const h = await charger(root);
  writeFileSync(join(h.runDir, `${h.runId}-plan.json`), JSON.stringify(plan));
  return h;
}

// ============================================================ C-P1-F10 — vestige de verrou

/**
 * L'identifiant du refus.
 *
 * `texte.length > 0` accepterait n'importe quel message, y compris celui d'un autre
 * refus : le diagnostic doit être reconnaissable par un opérateur et par un script.
 * Le jeton n'existe pas encore dans le code — c'est le contrat que les deux preuves
 * ci-dessous fixent, et il appelle une ligne dans C0 v1.3.
 */
const VESTIGE = "RUN_TRANSITION_LOCKED";

/**
 * Le vestige d'une transition inachevée.
 *
 * `avecLane` décide de la précondition. Sans lane, c'est la forme canonique adjugée —
 * vestige avant la première délégation, là où l'exception sort brute. Avec lane, il y a
 * quelque chose à nettoyer par mégarde, ce que la seconde preuve regarde.
 */
async function vestige(avecLane: boolean) {
  const h = await monter();
  if (avecLane) {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    precondition(lanes(h.root).includes(`${h.runId}-W03`), "la lane W03 doit être ouverte avant le vestige");
  }
  const verrou = join(h.runDir, `${h.runId}.guard`);
  mkdirSync(verrou, { recursive: true });
  const vieux = (Date.now() - 120_000) / 1000;
  utimesSync(verrou, vieux, vieux);
  return { ...h, verrou, seqAvant: readManifest(h.runDir)!.nextSeq, lanesAvant: lanes(h.root) };
}
/** Le registre des lanes, octet pour octet : un refus n'y écrit ni n'en retire rien. */
const registreBrut = (h: { runDir: string; runId: string }): string => {
  const p = join(h.runDir, `${h.runId}-lanes.jsonl`);
  return existsSync(p) ? readFileSync(p, "utf-8") : "(absent)";
};
const branches = (root: string): string[] =>
  git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean).sort();

regression("C-P1-F10", "un verrou de transition périmé produit un refus nommé, sans rien muter", async () => {
  const h = await vestige(false);
  try {
    const avant = APPELS.length;
    let jete: string | undefined;
    let resultat: unknown;
    try {
      resultat = await h.outil.execute("2", tache("W09"));
    } catch (e) {
      jete = `${(e as Error).constructor.name}: ${(e as Error).message}`;
    }
    const nomme = resultat !== undefined && enErreur(resultat) && texte(resultat).includes(VESTIGE);
    const intact =
      APPELS.length === avant &&
      lanes(h.root).join() === h.lanesAvant.join() &&
      evenements(h).length === 0 &&
      readManifest(h.runDir)!.nextSeq === h.seqAvant &&
      existsSync(h.verrou);
    propriete(
      jete === undefined && nomme && intact,
      `l'outil doit rendre un refus portant ${VESTIGE}, sans enfant, sans lane nouvelle, sans ` +
        `événement, sans séquence consommée, et sans lever le vestige ; jeté : ${jete}, ` +
        `refus nommé : ${nomme}, état intact : ${intact}`,
    );
  } finally { h.fin(); }
});

regression("C-P1-F10", "subagent-recover cleanup --apply refuse le même vestige sans rien nettoyer", async () => {
  const h = await vestige(true);
  try {
    const brancheAvant = branches(h.root);
    const registreAvant = registreBrut(h);
    precondition(registreAvant.includes("OPENED"), "le registre doit porter l'ouverture de W03");
    const [majeur] = process.versions.node.split(".").map(Number);
    const p = spawnSync(
      process.execPath,
      [...(majeur < 23 ? ["--experimental-strip-types"] : []), join(REPO, "bin", "subagent-recover"), "cleanup", "--apply"],
      { cwd: h.root, encoding: "utf-8" },
    );
    const sortie = `${p.stdout}${p.stderr}`;
    const brut = /^\s+at .*\(.*:\d+:\d+\)$/m.test(sortie) || /RecoveryError:/.test(sortie);
    const nomme = sortie.includes(VESTIGE);
    const intact =
      lanes(h.root).join() === h.lanesAvant.join() &&
      branches(h.root).join() === brancheAvant.join() &&
      readManifest(h.runDir)!.nextSeq === h.seqAvant &&
      registreBrut(h) === registreAvant &&
      existsSync(h.verrou);
    propriete(
      !brut && nomme && p.status !== 0 && intact,
      `le verbe de reprise doit nommer le vestige (${VESTIGE}) plutôt que de mourir sur une ` +
        `exception brute, échouer par son code de sortie, et ne rien nettoyer implicitement ; ` +
        `trace brute : ${brut}, refus nommé : ${nomme}, code ${p.status}, état intact : ${intact}`,
    );
  } finally { h.fin(); }
});

// ============================================================ C-P1-F02 — ce qui doit survivre

preservation("C-P1-F02", "un rework et sa revue rejoignent la lane déjà ouverte de leur unité", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const laneId = `${h.runId}-W03`;
    precondition(lanes(h.root).includes(laneId), "la lane W03 doit être ouverte");
    await h.outil.execute("2", revue("W03", { verdict: "needs_rework" }));
    PILOTE.resultat = undefined;
    precondition(compter("reviewer") === 1, "la première revue doit être partie");

    PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
    await h.outil.execute("3", tache("W03"));
    PILOTE.pendant = undefined;
    propriete(
      compter("worker") === 2,
      `le rework doit être admis dans la lane ouverte ; lancés : ${agents().join(", ")}`,
    );
    propriete(
      APPELS[APPELS.length - 1]?.cwd === join(h.root, ".git", "pi-lanes", laneId),
      "le rework doit travailler dans la lane de son unité, pas dans une seconde lane",
    );
    propriete(lanes(h.root).length === 1, `une seule lane pour W03 ; vues : ${JSON.stringify(lanes(h.root))}`);

    await h.outil.execute("4", revue("W03"));
    PILOTE.resultat = undefined;
    propriete(compter("reviewer") === 2, "la revue du rework doit être admise elle aussi");
  } finally { h.fin(); }
});

// ============================================================ A-P1-F07a — câblage de role-guard

/**
 * Les vraies définitions de rôle, pas une fixture.
 *
 * Une fixture écrite à la main fige la forme d'`AgentDefinition` telle qu'elle est
 * aujourd'hui : elle dériverait en silence, et la preuve porterait sur un rôle qui
 * n'existe pas. Le worker du dépôt est le sujet.
 */
const ROLES = loadAgents(join(REPO, "subagent-only", "agents"));
function argvDe(nom: string, extensions?: string[]): string[] {
  const agent = ROLES.get(nom);
  precondition(agent !== undefined, `le rôle ${nom} doit exister dans subagent-only/agents/`);
  const ctx = { agentDir: REPO, selfDir: join(REPO, "subagent-only"), runId: "R", cwd: REPO };
  return buildSpawnPlan(extensions ? { ...agent!, extensions } : agent!, "tâche", ctx).args;
}
const injections = (args: string[]): string[] =>
  args.filter((a, i) => args[i - 1] === "-e" && a.includes("role-guard"));

couverture("A-P1-F07a", "role-guard est injecté exactement une fois dans l'argv réel de l'enfant", () => {
  const attendu = join(REPO, "subagent-only", "role-guard.ts");
  const declare = ROLES.get("worker")?.extensions ?? [];
  precondition(!declare.includes("role-guard"), "le worker du dépôt ne déclare pas role-guard lui-même");
  const sans = injections(argvDe("worker"));
  const avec = injections(argvDe("worker", [...declare, "role-guard"]));
  propriete(
    sans.length === 1 && sans[0] === attendu,
    `un rôle qui ne déclare pas role-guard doit le recevoir une fois : ${JSON.stringify(sans)}`,
  );
  propriete(
    avec.length === 1 && avec[0] === attendu,
    `un rôle qui le déclare ne doit pas le recevoir deux fois : ${JSON.stringify(avec)}`,
  );
});
