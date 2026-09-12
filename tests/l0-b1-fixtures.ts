/**
 * l0-b1-fixtures.ts — les fixtures de B1, écrites une fois.
 *
 * Pas un test : le nom ne finit pas par `.test.ts`, la suite ne le lance pas.
 *
 * Tout ce que les preuves de B1 font relire est **sérialisé sur le disque** au
 * format que le § F de C0 v1.3 décrit, puis lu par la surface publique. Aucun
 * état réduit n'est injecté : « toutes les unités sont intégrées » se prouve en
 * écrivant l'histoire qui le rend vrai, y compris ses merges dans git.
 *
 * Deux pièges déjà payés et évités ici :
 *   - les renvois `reviewed_event_seq` et `frozen_event_seq` doivent pointer sur
 *     l'événement qu'ils nomment. Les calculer par `seq - 1` les faisait pointer
 *     un cran trop tôt, sur OPENED et sur REVIEWED. Les séquences attribuées sont
 *     donc mémorisées et relues, jamais recalculées.
 *   - `from_tree` est le tree réel de la base de la lane, pas le tree vide.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureLane } from "../subagent-only/worktree.ts";

export const RUNS = ".pi-subagent-runs";
export const RUN = "0123456789abcdef";
export const AT = "2026-09-12T10:00:00.000Z";
/** Le seuil au-delà duquel un verrou de transition est un vestige (run-manifest.ts). */
export const GUARD_STALE_MS = 5_000;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

export interface Depot {
  root: string;
  dir: string;
  base: string;
  baseTree: string;
}

const jetables: string[] = [];
export const aJeter = (): readonly string[] => jetables;

/** Un dépôt git avec un commit, sa racine propre, et son espace de runs vide. */
export function depot(prefixe: string): Depot {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefixe)));
  jetables.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const dir = join(root, RUNS);
  mkdirSync(dir, { recursive: true });
  return { root, dir, base: git(root, "rev-parse", "HEAD").trim(), baseTree: git(root, "rev-parse", "HEAD^{tree}").trim() };
}

/** Un écrivain de registre qui se souvient des séquences qu'il a attribuées. */
export class Registre {
  private readonly lignes: string[];
  private seq = 0;
  private readonly version: number;
  constructor(version = 2) {
    this.version = version;
    this.lignes = [JSON.stringify({ ledger: version })];
  }
  /** Écrit un événement et rend le `event_seq` qui lui a été donné. */
  ajouter(unite: string, generation: number, reste: Record<string, unknown>): number {
    this.seq += 1;
    this.lignes.push(JSON.stringify({
      event_seq: this.seq,
      work_unit: unite,
      lane: this.version === 2 ? `${RUN}-${unite}-g${generation}` : `${RUN}-${unite}`,
      at: AT,
      ...reste,
    }));
    return this.seq;
  }
  /**
   * Un événement au vocabulaire v1 : ni `event_seq`, ni `lane`, ni génération.
   *
   * Une fixture v1 doit être authentiquement v1. Y laisser l'enveloppe v2 en ferait un
   * hybride qui n'a jamais existé, et la préservation garderait un comportement que le
   * lecteur d'aujourd'hui n'a jamais eu à tenir.
   */
  ajouterV1(unite: string, reste: Record<string, unknown>): void {
    this.lignes.push(JSON.stringify({ work_unit: unite, at: AT, ...reste }));
  }
  brut(): string {
    return `${this.lignes.join("\n")}\n`;
  }
  ecrire(dir: string): string {
    const chemin = cheminLanes(dir);
    writeFileSync(chemin, this.brut());
    return chemin;
  }
}

export const cheminLanes = (dir: string): string => join(dir, `${RUN}-lanes.jsonl`);
export const cheminIntegrations = (dir: string): string => join(dir, `${RUN}-integrations.jsonl`);

/**
 * Le manifeste, au format que § F décrit.
 *
 * `version` est un paramètre parce que la distinction v1/v2 est elle-même un sujet
 * de preuve : un manifeste v1 sans témoin est RUN-SANS-TÉMOIN (C4.7), un manifeste
 * v2 porte sa table `ledgers`, partielle tant que le registre des intégrations n'a
 * pas d'en-tête (C4.1).
 */
export function manifeste(dir: string, options: {
  version?: number;
  status?: string;
  ledgers?: Record<string, number>;
  plan?: string;
  base?: string;
  nextSeq?: number;
  ended?: Record<string, unknown>;
} = {}): void {
  const m: Record<string, unknown> = {
    version: options.version ?? 2,
    runId: RUN,
    status: options.status ?? "active",
    nextSeq: options.nextSeq ?? 12,
  };
  if (options.base) m.baseCommit = options.base;
  if (options.plan) m.plan = options.plan;
  if (options.ledgers) m.ledgers = options.ledgers;
  if (options.ended) m.ended = options.ended;
  writeFileSync(join(dir, "active-run.json"), `${JSON.stringify(m, null, 2)}\n`);
}

export function plan(dir: string, unites: string[]): void {
  const contenu = {
    version: 1,
    work_units: unites.map((id) => ({
      id, goal: `faire ${id}`, depends_on: [], expected_write_scope: [`src/${id}.py`],
    })),
  };
  writeFileSync(join(dir, `${RUN}-plan.json`), `${JSON.stringify(contenu, null, 2)}\n`);
}

export interface Unite {
  unite: string;
  /** Intégrée : la lane est gelée, mergée dans la racine, et son worktree retiré. */
  integree?: boolean;
  /** Ouverte : le worktree reste, et le registre ne porte qu'un OPENED. */
  ouverte?: boolean;
  risqueOuvert?: boolean;
  violation?: boolean;
  abandonnee?: boolean;
  generation?: number;
}

/**
 * Un run dont l'histoire est vraie des deux côtés : le registre la raconte, et git
 * la porte. Une unité intégrée a son merge dans la racine et n'a plus de worktree —
 * c'est l'état qu'une fin de run doit trouver.
 */
export function runEcrit(
  prefixe: string,
  unites: Unite[],
  options: { manifesteV1?: boolean; ledger?: 1 | 2 } = {},
): Depot & { registre: Registre } {
  const d = depot(prefixe);
  /*
   * La version du registre est un paramètre, et ce n'est pas une commodité.
   *
   * Les régressions du vocabulaire v2 écrivent du v2 : c'est leur sujet. Les
   * préservations, elles, portent sur ce que le lecteur d'aujourd'hui fait déjà
   * bien — et il refuse tout registre v2. Les monter en v2 les rendrait rouges
   * pour la version, jamais pour la propriété qu'elles gardent.
   */
  const version = options.ledger ?? 2;
  const registre = new Registre(version);
  const noms: string[] = [];

  for (const u of unites) {
    const g = u.generation ?? 1;
    noms.push(u.unite);
    // En v1, l'identité d'une lane n'a pas de génération : la fixture écrit le nom que
    // l'objet écrit, sinon la réconciliation verrait une branche sans provenance là où
    // il n'y en a pas.
    const laneId = version === 2 ? `${RUN}-${u.unite}-g${g}` : `${RUN}-${u.unite}`;
    const lane = ensureLane(d.root, laneId);
    const ecrire = (reste: Record<string, unknown>): number =>
      version === 2 ? registre.ajouter(u.unite, g, reste) : (registre.ajouterV1(u.unite, reste), 0);
    ecrire({ event: "OPENED", base: d.base, ...(version === 2 ? { generation: g } : {}) });

    if (version === 2 && u.violation) {
      registre.ajouter(u.unite, g, {
        event: "VIOLATION",
        kind: "reserved-violation",
        paths: ["DESIGN.md"],
        source: { delegation_seq: 3, agent: "worker" },
        observed_tree: d.baseTree,
      });
    }
    if (version === 2 && u.risqueOuvert) {
      registre.ajouter(u.unite, g, { event: "RISK", id: `${u.unite}-r1`, transition: "opened", by: "reviewer" });
      registre.ajouter(u.unite, g, { event: "RISK", id: `${u.unite}-r1`, transition: "routed", to: "scout" });
    }
    if (u.abandonnee) {
      ecrire({ event: "ABANDONED", by: "operator", reason: "essai", ...(version === 2 ? { generation: g } : {}) });
      git(d.root, "worktree", "remove", "--force", lane.cwd);
      continue;
    }
    if (!u.integree) continue;

    writeFileSync(join(lane.cwd, "src", `${u.unite}.py`), `${u.unite} = 1\n`);
    git(lane.cwd, "add", "-A");
    git(lane.cwd, "commit", "-qm", `freeze ${u.unite}`);
    const gel = git(lane.cwd, "rev-parse", "HEAD").trim();
    const treeGel = git(lane.cwd, "rev-parse", "HEAD^{tree}").trim();
    if (version === 1) {
      git(d.root, "merge", "--no-ff", "-q", "-m", `integrate ${u.unite}`, lane.branch);
      ecrire({ event: "INTEGRATED", integration_commit: git(d.root, "rev-parse", "HEAD").trim() });
      git(d.root, "worktree", "remove", "--force", lane.cwd);
      continue;
    }
    const revue = registre.ajouter(u.unite, g, {
      event: "REVIEWED",
      from_tree: d.baseTree,
      tree: treeGel,
      verdict: "approved",
      reviewer: { delegation_seq: 2, agent: "reviewer", role: "reviewer" },
      proof: { mode: "diff" },
    });
    git(d.root, "merge", "--no-ff", "-q", "-m", `integrate ${u.unite}`, lane.branch);
    const integration = git(d.root, "rev-parse", "HEAD").trim();
    const gele = registre.ajouter(u.unite, g, {
      event: "FROZEN", commit: gel, parent: d.base, tree: treeGel, reviewed_event_seq: revue,
    });
    registre.ajouter(u.unite, g, {
      event: "MERGED", integration_commit: integration, frozen_event_seq: gele,
    });
    registre.ajouter(u.unite, g, {
      event: "INTEGRATED", integration_commit: integration, status: { outcome: "not-applicable" },
    });
    // Une unité intégrée n'a plus de lane ouverte : c'est ce que la fin d'un run trouve.
    git(d.root, "worktree", "remove", "--force", lane.cwd);
  }

  registre.ecrire(d.dir);
  plan(d.dir, noms);
  /*
   * Un registre v1 va avec un manifeste v1.
   *
   * « Manifeste v2 portant `ledgers: { lanes: 1 }` » n'est un état conforme à aucune
   * version : ce serait une fixture de migration, et B1 n'en éprouve aucune. Une fixture
   * v1 est donc v1 de bout en bout, sauf demande explicite.
   */
  const manifesteV1 = options.manifesteV1 ?? version === 1;
  manifeste(d.dir, {
    version: manifesteV1 ? 1 : 2,
    base: d.base,
    plan: `${RUN}-plan.json`,
    ...(manifesteV1 ? {} : { ledgers: { lanes: 2 } }),
  });
  return { ...d, registre };
}
