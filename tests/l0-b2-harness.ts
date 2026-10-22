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
import { releaseRunOwnership, type Lease } from "../subagent-only/run-manifest.ts";
import { openLanes } from "../subagent-only/worktree.ts";
import { cheminNatif, SOURCE_NATIVE } from "../subagent-only/pi-adapt.ts";

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
  /**
   * Une session neuve sur le même dépôt : rien de la mémoire précédente ne traverse.
   *
   * `refusAdmis` (phase 2, Q-P2-5, `142cb15d…` et `e1901916…`) : une montée refusée laisse l'outil
   * réel en place et rend son refus dans `montee`, pour les seules reprises qui l'éprouvent. Sans
   * l'option, le comportement est celui d'avant : l'outil est retiré et `chargement` le dit.
   */
  recharger: (options?: { refusAdmis?: boolean }) => Promise<Harnais>;
  /** La montée explicite de cette instance : admise, ou refusée avec son texte et son genre. */
  montee: { ok: true } | { ok: false; erreur: string; erreurs: number };
  /** Une commande enregistrée par l'extension (`/subagents` pour lire le profil). */
  commande: (nom: string) => Commande | undefined;
  /**
   * Émettre un événement pi vers le callback que l'extension a enregistré.
   *
   * C6.4 a deux niveaux — refus avant l'appel, vérification après. Les éprouver demande
   * d'appeler les callbacks `tool_call` et `tool_result` comme pi le ferait, et non
   * d'écrire un fichier en espérant que quelqu'un le remarque.
   */
  emettre: (nom: string, ...args: unknown[]) => Promise<unknown>;
  /** Les noms d'événements auxquels l'extension s'est abonnée. */
  abonnements: () => string[];
  /**
   * Ce que le chargement de la session a donné.
   *
   * Un manifeste v2 conforme rend l'extension inchargeable aujourd'hui : `openRun`
   * s'exécute à l'import et `readManifest` refuse toute version autre que 1. Si le
   * montage en faisait une précondition, la preuve rougirait à l'import et non sur sa
   * propriété. Le chargement est donc rendu observable, et les preuves canoniques
   * l'affirment elles-mêmes.
   */
  chargement: { ok: true } | { ok: false; erreur: string };
  evenements: () => Array<Record<string, unknown>>;
  journal: () => Array<Record<string, unknown>>;
  fin: () => void;
}

/**
 * Les outils de la session, tels que pi 0.86 les expose (`getAllTools`, `getActiveTools`,
 * `setActiveTools`) — lot ITE, P0-C. Les natifs portent la provenance `<builtin:NOM>`, lue dans la couche (C3) ; `task`
 * est celui de l'extension. Une preuve peut redéfinir un outil (provenance locale) ou rétablir
 * la liste active ; `monter` remet l'état par défaut, `recharger` le garde.
 */
export interface OutilPi { name: string; sourceInfo: { source: string; path: string } }
const natif = (name: string): OutilPi => ({ name, sourceInfo: { source: SOURCE_NATIVE, path: cheminNatif(name) } });
export const OUTILS_PI: { tous: OutilPi[]; actifs: string[]; appelsSetActive: string[][] } = {
  tous: [],
  actifs: [],
  appelsSetActive: [],
};
export function outilsPiParDefaut(): void {
  OUTILS_PI.tous = [
    ...["read", "grep", "find", "ls", "bash", "write", "edit"].map(natif),
    { name: "task", sourceInfo: { source: "local", path: join(REPO, "extensions", "subagent") } },
  ];
  OUTILS_PI.actifs = OUTILS_PI.tous.map((o) => o.name);
  OUTILS_PI.appelsSetActive = [];
}
outilsPiParDefaut();

// ------------------------------------------------------------------ la montée explicite (phase 2)

/**
 * Le profil simple est le défaut : l'extension n'ouvre plus de run à l'import. Les preuves
 * écrites contre la base portent sur le profil sous-agents ; elles s'exécutent donc après une
 * **montée explicite** (plan de la phase 2, H12) : `session_start`, `/subagents on`, puis
 * `before_agent_start`, comme pi les émet. Aucune assertion n'en est retirée.
 */
export type Rappel = (...a: unknown[]) => unknown;
export type Commande = (args: string, ctx: unknown) => unknown;

/** Les notifications rendues par l'extension au contexte d'épreuve. */
export interface Notification { texte: string; genre?: string }

/** Le contexte qu'un handler de pi reçoit, réduit à ce que l'extension lit. */
export function contexteDEpreuve(options: {
  notifications?: Notification[];
  hasUI?: boolean;
  idle?: boolean;
  session?: string;
} = {}): Record<string, unknown> {
  const notifications = options.notifications ?? [];
  return {
    hasUI: options.hasUI ?? true,
    cwd: process.cwd(),
    isIdle: () => options.idle ?? true,
    sessionManager: { getSessionId: () => options.session ?? "session-epreuve", getSessionFile: () => undefined },
    ui: {
      setStatus: () => {},
      setFooter: () => {},
      notify: (texte: string, genre?: string) => { notifications.push({ texte, genre }); },
    },
  };
}

/** Les options du prompt structuré de pi 0.86.0, réduites à ce que l'extension lit et pose. */
export interface OptionsDEpreuve {
  /** Q-P2-22 : le prompt personnalisé (`.pi/SYSTEM.md`, `SYSTEM.md` global, `--system-prompt`). */
  customPrompt?: string;
  forceSystemPrompt?: string;
  selectedTools: string[];
  toolGuidelines: Record<string, string[]>;
  sections: Record<string, string | undefined>;
}

/**
 * Le prompt rendu comme pi 0.86.0 le rend (`system-prompt.js`) : un prompt forcé est opaque ;
 * sous un prompt personnalisé non vide (`if (customPrompt)`), il tient lieu de préambule, sans
 * outils, règles ni documentation (Q-P2-22) ; sinon le préambule et les règles — une puce par
 * guideline des outils sélectionnés, normalisée par `trim`, sans doublon. Puis chaque section
 * nommée, `<nom>\ncontenu\n</nom>`, jointes par une ligne vide.
 */
export function rendrePrompt(o: OptionsDEpreuve): string {
  if (o.forceSystemPrompt !== undefined) return o.forceSystemPrompt;
  if (o.customPrompt) {
    const blocs = [o.customPrompt];
    for (const [nom, contenu] of Object.entries(o.sections)) if (contenu) blocs.push(`<${nom}>\n${contenu}\n</${nom}>`);
    return blocs.join("\n\n");
  }
  const vues = new Set<string>();
  const regles: string[] = [];
  for (const nom of o.selectedTools) {
    for (const r of o.toolGuidelines[nom] ?? []) {
      const n = r.trim();
      if (!n || vues.has(n)) continue;
      vues.add(n);
      regles.push(`- ${n}`);
    }
  }
  const blocs = ["You are an expert coding assistant operating inside pi."];
  blocs.push(`<rules>\n${regles.join("\n")}\n</rules>`);
  for (const [nom, contenu] of Object.entries(o.sections)) if (contenu) blocs.push(`<${nom}>\n${contenu}\n</${nom}>`);
  return blocs.join("\n\n");
}

/** Un `before_agent_start`, tel que le runner de pi 0.86.0 le construit : options mutables, prompt rendu à la lecture. */
export function evenementAvantAgent(options: OptionsDEpreuve): Record<string, unknown> {
  return {
    type: "before_agent_start",
    prompt: "",
    systemPromptOptions: options,
    get systemPrompt() { return rendrePrompt(options); },
  };
}

export function optionsDEpreuve(actifs: readonly string[]): OptionsDEpreuve {
  return { selectedTools: [...actifs], toolGuidelines: {}, sections: {} };
}

/**
 * La montée explicite : `session_start`, `/subagents on`, puis une invite.
 *
 * Rend l'échec de la montée comme le chargement le rendait : une erreur nommée, que la preuve
 * peut lire, au lieu d'une précondition qui rougirait avant sa propriété.
 */
export async function monteeExplicite(api: {
  evenement: (nom: string) => Rappel | undefined;
  commande: (nom: string) => Commande | undefined;
  actifs: () => readonly string[];
  ctx?: Record<string, unknown>;
}): Promise<{ ok: true; options: OptionsDEpreuve } | { ok: false; erreur: string; erreurs?: number }> {
  const notifications: Notification[] = [];
  const ctx = api.ctx ?? contexteDEpreuve({ notifications });
  await api.evenement("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
  const sub = api.commande("subagents");
  if (sub === undefined) return { ok: false, erreur: "commande /subagents absente" };
  const avant = notifications.length;
  await sub("on", ctx);
  const erreurs = notifications.slice(avant).filter((n) => n.genre === "error");
  if (erreurs.length > 0) return { ok: false, erreur: erreurs[0].texte, erreurs: erreurs.length };
  const options = optionsDEpreuve(api.actifs());
  await api.evenement("before_agent_start")?.(evenementAvantAgent(options), ctx);
  return { ok: true, options };
}

let generation = 0;
const jetables: string[] = [];
export const aJeter = (): readonly string[] => jetables;

async function instancier(root: string, options: { refusAdmis?: boolean } = {}): Promise<Harnais> {
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  reinitialiser();
  generation += 1;
  let outil: Harnais["outil"] | undefined;
  const callbacks = new Map<string, (...a: unknown[]) => unknown>();
  const commandes = new Map<string, Commande>();
  let chargement: Harnais["chargement"] = { ok: true };
  let montee: Harnais["montee"] = { ok: true };
  try {
    const module = await import(`../extensions/subagent/index.ts?l0b2=${generation}`);
    module.default({
      on: (nom: string, cb: (...a: unknown[]) => unknown) => { callbacks.set(nom, cb); },
      registerTool: (t: unknown) => { outil = t as Harnais["outil"]; },
      registerCommand: (nom: string, c: { handler: Commande }) => { commandes.set(nom, c.handler); },
      ui: { setStatus: () => {}, setFooter: () => {} },
      getAllTools: () => OUTILS_PI.tous.map((o) => ({ ...o, sourceInfo: { ...o.sourceInfo } })),
      getActiveTools: () => [...OUTILS_PI.actifs],
      setActiveTools: (noms: string[]) => {
        OUTILS_PI.appelsSetActive.push([...noms]);
        OUTILS_PI.actifs = noms.filter((n) => OUTILS_PI.tous.some((o) => o.name === n));
      },
    });
    if (outil === undefined) chargement = { ok: false, erreur: "aucun outil enregistré" };
    else {
      const vue = await monteeExplicite({
        evenement: (nom) => callbacks.get(nom),
        commande: (nom) => commandes.get(nom),
        actifs: () => OUTILS_PI.actifs,
      });
      if (!vue.ok) {
        montee = { ok: false, erreur: vue.erreur, erreurs: vue.erreurs ?? 0 };
        chargement = { ok: false, erreur: vue.erreur };
        if (!options.refusAdmis) outil = undefined;
      }
    }
  } catch (e) {
    chargement = { ok: false, erreur: `${(e as Error).constructor.name}: ${(e as Error).message}` };
  }
  const runDir = join(root, RUNS);
  /*
   * Le runId se lit dans le fichier, pas par `readManifest` : ce lecteur refuse les
   * manifestes v2, et le montage n'a pas à dépendre de ce qu'il éprouve.
   */
  const brut = existsSync(join(runDir, "active-run.json"))
    ? (JSON.parse(readFileSync(join(runDir, "active-run.json"), "utf-8")) as { runId?: string })
    : {};
  const runId = brut.runId ?? "";
  precondition(runId !== "", "le manifeste publié doit porter un runId");
  const refuser = async (): Promise<never> => {
    throw new Error(`session non ouverte — ${(chargement as { erreur?: string }).erreur}`);
  };
  const lignes = (nom: string): Array<Record<string, unknown>> => {
    const p = join(runDir, `${runId}-${nom}.jsonl`);
    return existsSync(p)
      ? readFileSync(p, "utf-8").split("\n").filter(Boolean).flatMap((l) => {
          try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; }
        })
      : [];
  };
  return {
    root, runDir, runId, chargement, montee,
    commande: (nom: string) => commandes.get(nom),
    outil: outil ?? { execute: refuser },
    /*
     * Une session neuve suit la mort de la précédente, qui rend son bail.
     *
     * Ici les deux instances vivent dans le même processus : sans cette libération, la
     * seconde se charge EN LECTURE SEULE — « aucune séquence réservée, aucun artefact,
     * aucune lane » — et toute preuve « après rechargement » mesurerait ce refus-là au
     * lieu de ce qui survit.
     */
    emettre: async (nom: string, ...args: unknown[]) => {
      const cb = callbacks.get(nom);
      precondition(cb !== undefined, `l'extension doit s'abonner à ${nom}`);
      const rendu = await cb!(...args);
      /*
       * Une session qui commence repart du profil simple (phase 2, T1). Les preuves qui
       * émettent `session_start` portent sur une session du profil sous-agents : la montée
       * explicite suit, comme après l'import, avec le contexte d'épreuve.
       */
      if (nom === "session_start") {
        const notifications: Notification[] = [];
        const ctx = contexteDEpreuve({ notifications });
        await commandes.get("subagents")?.("on", ctx);
        const erreur = notifications.find((n) => n.genre === "error");
        precondition(erreur === undefined, `la montée qui suit session_start doit réussir : ${erreur?.texte ?? ""}`);
        await callbacks.get("before_agent_start")?.(evenementAvantAgent(optionsDEpreuve(OUTILS_PI.actifs)), ctx);
      }
      return rendu;
    },
    abonnements: () => [...callbacks.keys()],
    recharger: async (opts?: { refusAdmis?: boolean }) => {
      const owner = join(runDir, `${runId}.lease`, "owner.json");
      if (existsSync(owner)) {
        releaseRunOwnership(runDir, JSON.parse(readFileSync(owner, "utf-8")) as Lease);
      }
      return instancier(root, opts);
    },
    evenements: () => lignes("lanes"),
    journal: () => lignes("delegations"),
    fin: () => { process.chdir(REPO); rmSync(root, { recursive: true, force: true }); },
  };
}

/**
 * Un dépôt, son plan gelé, et une première session.
 *
 * `bundle` pose les quatre fichiers gelés ; `design` remplace le DESIGN.md par défaut, et
 * `plan` le plan — B3 en a besoin pour porter `design_update` (C6.1).
 */
export async function monter(options: {
  bundle?: boolean;
  design?: string;
  plan?: unknown;
} = {}): Promise<Harnais> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0b2-")));
  jetables.push(root);
  outilsPiParDefaut();
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
    if (options.design !== undefined) writeFileSync(join(root, "DESIGN.md"), options.design);
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const h = await instancier(root);
  writeFileSync(join(h.runDir, `${h.runId}-plan.json`), JSON.stringify(options.plan ?? PLAN_B2));
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
