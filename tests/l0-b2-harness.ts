/**
 * l0-b2-harness.ts — le montage partagé des preuves de B2.
 *
 * Pas un test : le nom ne finit pas par `.test.ts`, la suite ne le lance pas.
 *
 * B2 porte sur ce qui doit survivre à une nouvelle session : violations, approbations,
 * risques. Le **rechargement** est donc la pièce centrale — `recharger()` construit une
 * instance neuve de l'extension sur le même dépôt, ce qu'une nouvelle session de pi fait.
 * Rien de la mémoire de la session précédente ne traverse.
 *
 * Deux règles de fixture, adjugées avec le plan de B2 :
 *
 *   PRODUCTION   au moins une preuve par nature durable — VIOLATION, REVIEWED, RISK —
 *                provoque l'événement par `task`, vérifie sa sérialisation, puis le relit
 *                après rechargement. Que le runtime ne l'écrive pas encore est ce que la
 *                régression expose : corriger les seuls lecteurs ne suffirait pas.
 *   VERSION      décidée par la propriété, jamais par l'espèce. Les décisions fondées sur
 *                le registre autoritaire lisent du v2 ; une préservation part de l'état que
 *                le runtime courant produit ; le v1 n'est monté que lorsque la
 *                compatibilité v1 est elle-même la propriété.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE, reinitialiser } from "./stubs/dispatch.ts";
import { readManifest, releaseRunOwnership, type Lease } from "../subagent-only/run-manifest.ts";
import { openLanes } from "../subagent-only/worktree.ts";

export const RUNS = ".pi-subagent-runs";
const REPO = join(import.meta.dirname, "..");

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

export function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
export function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

export type Issue =
  | { kind: "returned"; value: unknown; error?: undefined }
  | { kind: "threw"; value?: undefined; error: string };
export async function issue(fn: () => Promise<unknown> | unknown): Promise<Issue> {
  try {
    return { kind: "returned", value: await fn() };
  } catch (e) {
    return { kind: "threw", error: `${(e as Error).constructor.name}: ${(e as Error).message}` };
  }
}
export const montrer = (i: Issue): string => (JSON.stringify(i) ?? "(indicible)").slice(0, 250);

// ------------------------------------------------------------------ le plan monté

export const PLAN_B2 = {
  version: 1,
  work_units: [
    { id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py"] },
    { id: "W09", goal: "faire W09", depends_on: [], expected_write_scope: ["src/b.py"] },
  ],
};

export const tache = (unite: string) => ({ agent: "worker", work_unit: unite, task: `écrire pour ${unite}` });
export const revue = (unite: string, extra: Record<string, unknown> = {}) => {
  PILOTE.resultat = { verdict: "approved", changedFiles: [], ...extra } as never;
  return { agent: "reviewer", work_unit: unite, task: "juger" };
};
export const ecrire = (rel: string, contenu: string) => (a: { cwd?: string }) => {
  if (a.cwd) {
    mkdirSync(join(a.cwd, rel, "..").replace(/\/\.\.$/, "") || a.cwd, { recursive: true });
    writeFileSync(join(a.cwd, rel), contenu);
  }
};

export interface Harnais {
  root: string;
  runDir: string;
  runId: string;
  outil: { execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown> };
  /** Une session neuve sur le même dépôt : rien de la mémoire précédente ne traverse. */
  recharger: () => Promise<Harnais>;
  evenements: () => Array<Record<string, unknown>>;
  journal: () => Array<Record<string, unknown>>;
  fin: () => void;
}

let generation = 0;
const jetables: string[] = [];
export const aJeter = (): readonly string[] => jetables;

async function instancier(root: string): Promise<Harnais> {
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  reinitialiser();
  generation += 1;
  const module = await import(`../extensions/subagent/index.ts?l0b2=${generation}`);
  let outil: Harnais["outil"] | undefined;
  module.default({
    on: () => {},
    registerTool: (t: unknown) => { outil = t as Harnais["outil"]; },
    registerCommand: () => {},
    ui: { setStatus: () => {}, setFooter: () => {} },
  });
  const manifeste = readManifest(join(root, RUNS));
  precondition(manifeste !== undefined && outil !== undefined, "le run et l'outil doivent exister");
  const runDir = join(root, RUNS);
  const runId = manifeste!.runId;
  const lignes = (nom: string): Array<Record<string, unknown>> => {
    const p = join(runDir, `${runId}-${nom}.jsonl`);
    return existsSync(p)
      ? readFileSync(p, "utf-8").split("\n").filter(Boolean).flatMap((l) => {
          try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; }
        })
      : [];
  };
  return {
    root, runDir, runId, outil: outil!,
    /*
     * Une session neuve suit la mort de la précédente, qui rend son bail.
     *
     * Ici les deux instances vivent dans le même processus : sans cette libération, la
     * seconde se charge EN LECTURE SEULE — « aucune séquence réservée, aucun artefact,
     * aucune lane » — et toute preuve « après rechargement » mesurerait ce refus-là au
     * lieu de ce qui survit.
     */
    recharger: async () => {
      const owner = join(runDir, `${runId}.lease`, "owner.json");
      if (existsSync(owner)) {
        releaseRunOwnership(runDir, JSON.parse(readFileSync(owner, "utf-8")) as Lease);
      }
      return instancier(root);
    },
    evenements: () => lignes("lanes"),
    journal: () => lignes("delegations"),
    fin: () => { process.chdir(REPO); rmSync(root, { recursive: true, force: true }); },
  };
}

/** Un dépôt, son plan gelé, et une première session. `bundle` pose les quatre fichiers gelés. */
export async function monter(options: { bundle?: boolean } = {}): Promise<Harnais> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0b2-")));
  jetables.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  if (options.bundle) {
    for (const f of ["INSTRUCTIONS.md", "ARCHITECTURE.md", "DESIGN.md", "CONVENTIONS.md"]) {
      writeFileSync(join(root, f), `# ${f}\n`);
    }
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const h = await instancier(root);
  writeFileSync(join(h.runDir, `${h.runId}-plan.json`), JSON.stringify(PLAN_B2));
  return h;
}

/**
 * L'abandon durable d'une lane, écrit dans la version que le registre porte réellement.
 *
 * Il n'existe aucune surface pour abandonner une lane saine — le constat est au
 * SUIVI, Sol l'a écarté du périmètre. L'état d'abandon se pose donc comme les autres
 * fixtures : un événement sérialisé, relu par la surface publique. Écrire toujours du v1
 * rendrait la fixture hybride le jour où le runtime écrira du v2.
 */
export function abandonVersionne(h: Harnais, unite: string): void {
  const chemin = join(h.runDir, `${h.runId}-lanes.jsonl`);
  const lignes = readFileSync(chemin, "utf-8").split("\n").filter(Boolean);
  const entete = JSON.parse(lignes[0]) as { ledger?: number };
  const corps = lignes.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
  const dernier = (
    liste: Array<Record<string, unknown>>,
    porte: (e: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined => {
    for (let i = liste.length - 1; i >= 0; i--) if (porte(liste[i])) return liste[i];
    return undefined;
  };
  let ligne: string;
  if (entete.ledger === 2) {
    const seqs = corps.map((e) => e.event_seq).filter((v): v is number => Number.isInteger(v));
    const deLUnite = corps.filter((e) => e.work_unit === unite);
    const avecLane = dernier(deLUnite, (e) => typeof e.lane === "string");
    const avecGeneration = dernier(deLUnite, (e) => Number.isInteger(e.generation));
    if (!avecLane || !avecGeneration) throw new Error(`fixture : ABANDONED v2 incomplet pour ${unite}`);
    ligne = JSON.stringify({
      event_seq: Math.max(0, ...seqs) + 1,
      work_unit: unite,
      lane: avecLane.lane,
      at: new Date().toISOString(),
      event: "ABANDONED",
      by: "operator",
      reason: "fixture",
      generation: avecGeneration.generation,
    });
  } else {
    ligne = JSON.stringify({
      event: "ABANDONED", work_unit: unite, at: new Date().toISOString(), by: "operator", reason: "fixture",
    });
  }
  writeFileSync(chemin, `${readFileSync(chemin, "utf-8")}${ligne}\n`);
  // Le worktree part, la branche survit : c'est ce que l'abandon laisse derrière lui.
  for (const lane of openLanes(h.root).filter((l) => l.includes(unite))) {
    git(h.root, "worktree", "remove", "--force", join(h.root, ".git", "pi-lanes", lane));
  }
}

/**
 * L'enveloppe commune d'un événement de lane, telle que § F la décrit.
 *
 * `lane` est comparée à la lane attendue, et non seulement à « une chaîne non vide » :
 * une écriture croisée entre deux lanes passerait autrement inaperçue.
 */
export function enveloppeComplete(
  e: Record<string, unknown> | undefined,
  unite: string,
  lane: string,
): string[] {
  if (!e) return ["événement absent"];
  const manques: string[] = [];
  if (!Number.isInteger(e.event_seq)) manques.push("event_seq");
  if (e.work_unit !== unite) manques.push(`work_unit ${String(e.work_unit)}`);
  if (e.lane !== lane) manques.push(`lane ${JSON.stringify(e.lane)} au lieu de ${JSON.stringify(lane)}`);
  if (typeof e.at !== "string" || Number.isNaN(Date.parse(e.at as string))) manques.push("at");
  return manques;
}

/** La lane ouverte d'une unité, lue sur le disque : son nom changera avec les générations. */
export function laneActive(h: Harnais, unite: string): string {
  const lanes = openLanes(h.root).filter((l) => l.includes(unite));
  precondition(lanes.length === 1, `une seule lane doit être ouverte pour ${unite} ; ${JSON.stringify(lanes)}`);
  return lanes[0];
}

/**
 * Le tree de l'arbre de travail d'une lane — suivis et non suivis non ignorés.
 *
 * `HEAD^{tree}` rendrait le tree du commit de base, pas ce que la lane contient : une
 * implémentation qui enregistrerait réellement T_L échouerait contre lui.
 *
 * L'observation se fait dans un index jetable, désigné par `GIT_INDEX_FILE`. `reset
 * --mixed HEAD` ne rendrait l'index d'origine que s'il valait déjà HEAD : sur une lane
 * où quelque chose est indexé, l'observation aurait modifié ce qu'elle prétend regarder.
 */
export function treeDeTravail(h: Harnais, lane: string): string {
  const cwd = join(h.root, ".git", "pi-lanes", lane);
  const temporaire = mkdtempSync(join(tmpdir(), "pi-l0b2-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(temporaire, "index") };
  try {
    execFileSync("git", ["read-tree", "HEAD"], { cwd, env, stdio: ["ignore", "ignore", "ignore"] });
    execFileSync("git", ["add", "-A"], { cwd, env, stdio: ["ignore", "ignore", "ignore"] });
    return execFileSync("git", ["write-tree"], {
      cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } finally {
    rmSync(temporaire, { recursive: true, force: true });
  }
}

/** La forme complète d'une transition de risque, provenance comprise. */
export function formeRisque(
  e: Record<string, unknown> | undefined,
  attendu: { unite: string; lane: string; id: string; transition: string; champ: "by" | "to"; valeur?: string },
): string[] {
  if (!e) return [`${attendu.transition} absent`];
  const manques = enveloppeComplete(e, attendu.unite, attendu.lane);
  if (e.id !== attendu.id) manques.push(`id ${JSON.stringify(e.id)}`);
  if (e.transition !== attendu.transition) manques.push(`transition ${JSON.stringify(e.transition)}`);
  const provenance = e[attendu.champ];
  if (typeof provenance !== "string" || !provenance) manques.push(`${attendu.champ} vide`);
  else if (attendu.valeur !== undefined && !provenance.includes(attendu.valeur)) {
    manques.push(`${attendu.champ} ${JSON.stringify(provenance)} ne nomme pas ${attendu.valeur}`);
  }
  return manques.map((m) => `${attendu.transition}: ${m}`);
}
export const trieSansDoublon = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => typeof x === "string") &&
  JSON.stringify(v) === JSON.stringify([...new Set(v as string[])].sort());

// ------------------------------------------------------------------ lire la porte

/**
 * Les blocages de politique rendus par la porte, tels que C3.7 les décrit.
 *
 * Aujourd'hui la porte ne rend qu'une phrase — « NON INTÉGRABLE W03 : scope-breach,
 * open-risks » — et aucune décision ne peut s'y lire. `null` dit que le champ structuré
 * n'existe pas, ce qui n'est pas la même chose qu'un tableau vide.
 */
export function blocages(resultat: unknown): string[] | null {
  const porte = (resultat as { details?: { integration_gate?: { policy_blockers?: unknown } } })
    ?.details?.integration_gate;
  if (!porte || !Array.isArray(porte.policy_blockers)) return null;
  return porte.policy_blockers as string[];
}
export const texte = (r: unknown): string =>
  ((r as { content?: Array<{ text?: string }> })?.content ?? []).map((c) => c.text ?? "").join("");

/** Une unité est-elle entrée dans la racine ? C'est le seul effet observable d'une intégration. */
export const integree = (root: string, rel: string, attendu: string): boolean =>
  existsSync(join(root, rel)) && readFileSync(join(root, rel), "utf-8").trim() === attendu;
export const lanesDe = (root: string, unite: string): string[] =>
  openLanes(root).filter((l) => l.includes(unite));
export const compter = (role: string): number => APPELS.filter((a) => a.agent === role).length;
