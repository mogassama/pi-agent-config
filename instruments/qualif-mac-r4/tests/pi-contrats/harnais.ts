/**
 * Orchestration d'une exécution de pi sous l'instrument, et lecture des captures.
 *
 * Une tentative suit toujours le même ordre :
 *   1. capture du chemin du `.pi` réel et de son inventaire (N6, avant) ;
 *   2. identité : identité déclarée, `pi`, `node`, installation fichier par fichier ;
 *   3. isolement : temporaire, environnement depuis vide, contrôle des chemins ;
 *   4. contrôles de lancement : `--import` unique, modules optionnels (M2.13) ;
 *   5. lancement de pi, stdin fermé ;
 *   6. inventaire N6 après, que la tentative ait réussi, échoué ou été refusée ;
 *   7. lecture des captures : voie Node, voie jiti, voies aveugles, flux.
 *
 * Les refus (1-4) ont lieu avant lancement. Les constats d'exécution (7)
 * invalident l'exécution ou la rendent indéterminée ; aucun n'est converti en
 * vert. Chaque constat porte l'identifiant de sa ligne aux matrices (§ B).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { accessSync, constants, statSync } from "node:fs";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Indetermine, Refus, candidats, ignorer, paquetDe, refuser, resoudreNode, resoudrePi, sha256, verifierIdentiteDeclaree, verifierInstallation, type CibleNode, type CiblePi, type RapportIdentite } from "./identite.ts";
import { capturerPiReel, construire, differences, inventaire, verifierIsolement, type Inventaire, type Isolement } from "./isolement.ts";
import { PIEGE_C6_2, C2_11 as C2_11_S, C2_12 as C2_12_S, CONTRE_EPREUVES_A, CONTRE_EPREUVES_REELLES, EXECUTIONS_NOMINALES, EXCLUSIONS_C2, POINTS_C2, SCOPE_C2_11, type ContreEpreuveA, type EntreeCwd, type Execution, type Simulateur } from "./scenarios.ts";
import { CHUNK_RESUME, ERREUR_FOURNISSEUR, IMAGE, KEEP_RECENT_TOKENS_K9, MESURES_PREALABLES, NOMINAL, REDEFINITION_READ, SUBMIT, SUMMARIZATION_SYSTEM_PROMPT, SUMMARIZATION_SYSTEM_PROMPT_SHA256, TEMOINS, VIRTUELS, verifierC2_7, verifierC2_8, verifierC3, verifierC3_2, verifierC7, verifierC8_2, type ObservationsMesure, type Scenario, type Verdict } from "./scenarios.ts";
import type { Identite } from "./generer-identite.ts";

export const VERSION_QUALIFIEE = "0.86.0";
const ICI = dirname(fileURLToPath(import.meta.url));
export const ICI_CONTRATS = ICI;
/**
 * N5 (option B) : racine de l'instrument (bin/pi-contrats, tests/pi-contrats). Ce n'est jamais le dépôt
 * à qualifier : celui-ci est choisi explicitement par `choisirDepot`, une seule fois.
 */
export const RACINE_INSTRUMENT = resolve(ICI, "..", "..");
let depotChoisi: string | null = null;

/** Choisit le dépôt à qualifier : chemin absolu, canonique, répertoire. Un second choix est refusé. */
export function choisirDepot(chemin: string): string {
  if (depotChoisi !== null) throw new Error(`dépôt déjà choisi (${depotChoisi}) : second choix refusé (${chemin})`);
  if (typeof chemin !== "string" || !isAbsolute(chemin)) throw new Error(`dépôt non absolu : ${String(chemin)}`);
  let reel: string;
  try {
    reel = realpathSync(chemin);
  } catch (e) {
    throw new Error(`dépôt illisible : ${chemin} (${(e as Error).message.split("\n")[0]})`);
  }
  if (reel !== chemin) throw new Error(`dépôt non canonique : ${chemin} (chemin réel ${reel})`);
  if (!statSync(chemin).isDirectory()) throw new Error(`dépôt non répertoire : ${chemin}`);
  depotChoisi = chemin;
  return chemin;
}

/** Le dépôt choisi. Toute lecture effective du dépôt passe par cet accesseur, qui refuse avant le choix. */
export function depotExplicite(): string {
  if (depotChoisi === null) throw new Error("dépôt non choisi : --depot exigé avant toute lecture du dépôt");
  return depotChoisi;
}
const TRACEUR = join(ICI, "trace-resolution.mjs");
const OPTIONNELS = ["supports-color", "bufferutil", "utf-8-validate", "kerberos"];

export type Constat = { id: string; etat: "INVALIDE" | "INDETERMINE" | "NON CONFORME"; detail: string };

// `ignorer` n'est appelé que par les copies mutées de `falsifier.sh`.
void ignorer;

/**
 * Constats d'exécution d'une tentative. Chaque site appelle `releve("<id>", état, détail)` ;
 * `falsifier.sh` désarme une garde d'exécution en remplaçant `releve("<id>",` par `ignorer("<id>",`.
 */
function releveur(constats: Constat[]) {
  return (id: string, etat: Constat["etat"], detail: string): void => {
    constats.push({ id, etat, detail });
  };
}

export type Options = {
  version?: string;
  contreEpreuve?: boolean;
  identite?: string;
  pathOperateur: string;
  scenario: Scenario;
  extensionsEnPlus?: string[];
  /** Altérations d'un stimulus de refus, appliquées après construction et avant les contrôles. */
  alterer?: (x: { iso: Isolement; env: Record<string, string>; argv: string[]; cwd: string }) => { env: Record<string, string>; argv: string[]; cwd: string };
  virtuels?: string[];
  delaiMs?: number;
  /** G-I1-base vérifiée sur ce dépôt avant tout lancement (épreuves de la garde de base). */
  verifierBaseDe?: string;
  /** G-N5 vérifiée dans ce contexte d'épreuve avant tout lancement (épreuves d'intégration N5). */
  verifierCandidatDe?: ContexteN5;
};

export type Tentative = {
  lancee: boolean;
  refus: Refus | Indetermine | null;
  erreur: Error | null;
  pi?: CiblePi;
  node?: CibleNode;
  identite?: RapportIdentite;
  iso?: Isolement;
  argv?: string[];
  rc?: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  /** N6 : `etablie` seulement si les deux inventaires ont été faits complètement. */
  n6: { racine: string; avant: Inventaire | null; apres: Inventaire | null; differences: string[]; etablie: boolean };
  /** Vrai si l'erreur est survenue après le lancement de pi. */
  erreurApresLancement?: boolean;
  captures?: Captures;
  brutes?: Brutes;
  contexte?: Contexte;
  constats: Constat[];
  /** Simulateurs posés dans le bin/ temporaire, avec leurs octets déclarés (K7). */
  simulateurs?: SimulateurPose[];
  /** Item 1 : scénario matérialisé (marqueurs remplacés), relevés avant et après lancement. */
  scenario?: Scenario;
  releves?: {
    inventaireAvant: EntreeCwd[];
    inventaireApres?: EntreeCwd[];
    git?: { avant: number | null; apres: number | null };
    journal?: string | null;
    fichiers?: Record<string, string | null>;
    fichiersAvant: Record<string, string | null>;
    journalChemin: string;
    journalFixture?: { chemin: string; dossier: string; mode: string; inscriptible: boolean; presentAvant: boolean };
    extensionsSha: Record<string, string>;
    sortiesFils?: any[];
  };
};

/** Un simulateur déclaré, tel que posé : chemin, cible réelle, empreinte attendue, interprète. */
export type SimulateurPose = { nom: string; chemin: string; reel: string; sha256: string; interprete: { chemin: string; sha256: string } };

const IDENTITES_JSON_EPINGLEES = new Map<string, string>([
  ["0.86.0", "13ab33ab7f8eef55d7d51b78dcbce229c33302051d097013f8364f667c6e4f5f"],
  ["0.99.0", "848d9a75ba96845943dd6a950514c92ceb5eaf4747695ff9606615b2fd50a079"],
]);

export function lireIdentite(
  chemin: string,
  version: string = VERSION_QUALIFIEE,
): Identite {
  const attendu = IDENTITES_JSON_EPINGLEES.get(version);
  if (!attendu) {
    refuser("M2.5", `identité non épinglée pour la version ${version}`);
  }
  const octets = readFileSync(chemin);
  const obtenu = sha256(octets);
  if (obtenu !== attendu) {
    refuser(
      "M2.9",
      `identité ${version} : empreinte ${obtenu} ≠ ${attendu}`,
    );
  }
  return JSON.parse(octets.toString("utf8"));
}

/** Une tentative complète. Ne lève jamais : refus, erreurs et constats sont dans le résultat. */
export function tenter(o: Options): Tentative {
  compteurs.tentatives++;
  const piReel = capturerPiReel();
  const t: Tentative = { lancee: false, refus: null, erreur: null, n6: { racine: piReel, avant: null, apres: null, differences: [], etablie: false }, constats: [] };
  try {
    t.n6.avant = inventaire(piReel);
  } catch (e) {
    t.refus = e as Refus;
    return t;
  }
  try {
    if (o.verifierBaseDe) verifierBase(o.verifierBaseDe);
    if (o.verifierCandidatDe) verifierCandidat(o.verifierCandidatDe);
    const version = o.version ?? VERSION_QUALIFIEE;
    if (version !== VERSION_QUALIFIEE && !o.contreEpreuve) refuser("M2.5", `version ${version} refusée hors du mode de contre-épreuve`);
    const identite = lireIdentite(
      o.identite ?? join(ICI, `identite-${version}.json`),
      version,
    );
    verifierIdentiteDeclaree(identite, join(ICI, "generer-identite.ts"));
    t.pi = resoudrePi(o.pathOperateur, identite);
    t.node = resoudreNode(o.pathOperateur, identite);
    t.identite = verifierInstallation(t.pi.racine, identite);

    const outil = (n: string) => {
      const c = candidats(n, o.pathOperateur)[0];
      if (!c) throw new Error(`outil ${n} introuvable dans le PATH de l'opérateur`);
      return c.reel;
    };
    const iso = construire(piReel, { candidatSource: depotExplicite(), outils: { git: outil("git"), bash: outil("bash"), sh: outil("sh") } });
    t.iso = iso;
    const s = materialiser(o.scenario, iso);
    t.scenario = s;
    for (const [nom, b64] of Object.entries(s.fichiers ?? {})) writeFileSync(join(iso.chemins.cwd, nom), Buffer.from(b64, "base64"));
    preparerItem1(s, iso);
    // Fixtures déclarées sous PI_CODING_AGENT_DIR (K6, K9).
    for (const [rel, contenu] of Object.entries(s.agentDir ?? {})) {
      const f = join(iso.chemins.agentDir, rel);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, contenu);
    }
    // K9 : un scénario qui attend un résumé porte le prompt système exact de pi 0.86.0 identifié.
    if (s.resume) verifierPromptResume(t.pi.racine, s.resume.systemPrompt);
    if (s.resume && KEEP_RECENT_TOKENS_K9 === null) throw new Error("réglage keepRecentTokens de K9 non adjugé (I1) : scénario non exécutable");
    t.simulateurs = poserSimulateurs(s, iso.chemins.bin, t.node);
    writeFileSync(iso.env.PI_CONTRATS_SCENARIO, JSON.stringify(s));
    const depot = [...(s.extensionsDepot ?? []).flatMap((e) => ["-e", join(iso.chemins.candidat, e)]), ...(o.extensionsEnPlus ?? []).flatMap((e) => ["-e", e])];
    const epreuve = ["-e", join(ICI, "extensions-epreuve.ts")];
    let argv = [
      "--import",
      TRACEUR,
      t.pi.reel,
      "--mode",
      "json",
      "-p",
      ...(s.sansNe ? [] : ["-ne"]),
      "-e",
      join(ICI, "fournisseur-scripte.ts"),
      "-e",
      join(ICI, "sonde.ts"),
      ...(s.depotAvantEpreuve ? [...depot, ...epreuve] : [...epreuve, ...depot]),
      "--tools",
      s.outils,
      "--model",
      "scripte/m",
      ...(s.session === "dossier" ? ["--session-dir", iso.chemins.sessions] : ["--no-session"]),
      ...(s.argvEnPlus ?? []),
      s.prompt,
      ...(s.prompts ?? []),
    ];
    // K1 : les variables complémentaires viennent de la seule déclaration du scénario.
    let env: Record<string, string> = { ...iso.env, ...(s.envDeclare ?? {}) };
    const fixture = s.journalLectureSeule ? journalLectureSeule(iso) : undefined;
    if (fixture) env.PI_JOURNAL_PATH = fixture.chemin;
    let cwd = iso.chemins.cwd;
    if (o.alterer) ({ env, argv, cwd } = o.alterer({ iso, env, argv, cwd }));
    t.argv = argv;

    verifierLancement(argv, t.pi);
    verifierIsolement(iso, env, cwd, argv, s.envDeclare ?? {});
    verifierOptionnels(t.node, t.pi, env, cwd, identite);

    const lireRel = (f: string) => (existsSync(join(iso.chemins.cwd, f)) ? readFileSync(join(iso.chemins.cwd, f), "utf8") : null);
    t.releves = {
      inventaireAvant: inventaireCwd(iso.chemins.cwd),
      journalChemin: env.PI_JOURNAL_PATH,
      fichiersAvant: Object.fromEntries((s.releverAvant ?? []).map((f) => [f, lireRel(f)])),
      ...(fixture ? { journalFixture: fixture } : {}),
      extensionsSha: Object.fromEntries(argv.filter((_, i) => argv[i - 1] === "-e").map((f) => [f, existsSync(f) ? sha256(readFileSync(f)) : "absent"])),
      ...(s.gitIdentite ? { git: { avant: compteGit(iso), apres: null } } : {}),
    };
    t.lancee = true;
    const r = spawnSync(t.node.reel, argv, { cwd, env, input: "", encoding: "utf8", timeout: o.delaiMs ?? 120000, maxBuffer: 64 * 1024 * 1024 });
    t.releves.inventaireApres = inventaireCwd(iso.chemins.cwd);
    if (t.releves.git) t.releves.git.apres = compteGit(iso);
    t.releves.journal = existsSync(env.PI_JOURNAL_PATH) ? readFileSync(env.PI_JOURNAL_PATH, "utf8") : null;
    t.releves.fichiers = Object.fromEntries((s.releverFichiers ?? []).map((f) => [f, lireRel(f)]));
    if (s.sortiesFils) {
      const f = `${env.PI_CONTRATS_TRACE}.sorties.jsonl`;
      t.releves.sortiesFils = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    }
    t.rc = r.status;
    t.signal = r.signal;
    t.stdout = r.stdout;
    t.stderr = r.stderr;
    // Captures conservées à côté des canaux, pour relecture et pour les contre-épreuves.
    writeFileSync(join(iso.chemins.obs, "stdout.jsonl"), r.stdout ?? "");
    writeFileSync(join(iso.chemins.obs, "stderr.txt"), r.stderr ?? "");
    t.brutes = lireBrutes(t);
    t.contexte = { pi: t.pi, identite, chemins: iso.chemins, argv, virtuels: o.virtuels ?? VIRTUELS, simulateurs: t.simulateurs };
    const r2 = analyserCaptures(t.brutes, t.contexte);
    t.captures = r2.captures;
    t.constats.push(...r2.constats);
  } catch (e) {
    if (e instanceof Refus || e instanceof Indetermine) t.refus = e;
    else {
      t.erreur = e as Error;
      t.erreurApresLancement = t.lancee;
    }
  } finally {
    try {
      t.n6.apres = inventaire(piReel);
      t.n6.differences = differences(t.n6.avant!, t.n6.apres);
      t.n6.etablie = true;
      const releve = releveur(t.constats);
      if (t.n6.differences.length) releve("M6.13", "NON CONFORME", `.pi réel modifié : ${t.n6.differences.join(" ; ")}`);
    } catch (e) {
      t.n6.etablie = false;
      if (t.lancee) t.constats.push({ id: "n6-apres", etat: "INDETERMINE", detail: `inventaire N6 après exécution impossible : ${(e as Error).message}` });
      else t.refus = t.refus ?? (e as Refus);
    }
  }
  return t;
}

/** M2.12 : un seul `--import`, le traceur du dépôt, et aucun autre chargeur. */
function verifierLancement(argv: string[], pi: CiblePi): void {
  const entree = argv.indexOf(pi.reel);
  const avant = argv.slice(0, entree);
  const imports = avant.filter((_, i) => avant[i - 1] === "--import");
  const autres = avant.filter((a, i) => a.startsWith("-") && !(a === "--import" && avant[i + 1] === TRACEUR));
  if (entree < 0) refuser("M2.4", "l'entrée du CLI n'est pas dans les arguments");
  if (imports.length !== 1 || imports[0] !== TRACEUR || autres.length) {
    refuser("M2.12", `chargeurs avant l'entrée du CLI : ${avant.join(" ")}`);
  }
}

// ── Préparation de l'item 1 (scénario matérialisé dans le temporaire) ─────────

/** Échappement POSIX d'un chemin entre quotes simples. */
const quoteSh = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;

/** Remplace les marqueurs de chemins du scénario par ceux du temporaire, dans toutes ses chaînes. */
export function materialiser(s: Scenario, iso: Isolement): Scenario {
  const table: Array<[string, string]> = [
    ["<BIN-QUOTE>", quoteSh(iso.chemins.bin)],
    ["<BIN>", iso.chemins.bin],
    ["<TMP>", iso.chemins.tmp],
    ["<CWD>", iso.chemins.cwd],
    ["<AGENTDIR>", iso.chemins.agentDir],
  ];
  const parcourir = (x: any): any => {
    if (typeof x === "string") return table.reduce((a, [k, v]) => a.split(k).join(v), x);
    if (Array.isArray(x)) return x.map(parcourir);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, parcourir(v)]));
    return x;
  };
  return parcourir(JSON.parse(JSON.stringify(s)));
}

/** Fichiers posés, identité Git K8, retraits et cassure de la copie du candidat, avant lancement. */
function preparerItem1(s: Scenario, iso: Isolement): void {
  const poser = (racine: string, fichiers: Record<string, string> | undefined) => {
    for (const [rel, contenu] of Object.entries(fichiers ?? {})) {
      const f = join(racine, rel);
      if (!f.startsWith(racine + sep)) throw new Error(`fichier déclaré hors de sa racine : ${rel}`);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, contenu);
    }
  };
  poser(iso.chemins.cwd, s.fichiersCwd);
  poser(iso.chemins.tmp, s.fichiersTmp);
  if (s.gitIdentite) {
    // K8 : git config --local uniquement, aucune variable GIT_*, aucune configuration réelle.
    const git = join(iso.chemins.bin, "git");
    const env = { HOME: iso.chemins.home, PATH: iso.chemins.bin };
    execFileSync(git, ["config", "--local", "user.name", "PI Contrats"], { cwd: iso.chemins.cwd, env });
    execFileSync(git, ["config", "--local", "user.email", "pi-contrats@example.invalid"], { cwd: iso.chemins.cwd, env });
  }
  for (const rel of s.retirerDuCandidat ?? []) rmSync(join(iso.chemins.candidat, rel), { recursive: true });
  if (s.casser) writeFileSync(join(iso.chemins.candidat, s.casser), "export default function (pi: any) { pi.on( ;\n");
}

/** C2.6 (b), B5 : PI_JOURNAL_PATH dans un dossier du temporaire rendu non inscriptible, fixture relevée. */
function journalLectureSeule(iso: Isolement): { chemin: string; dossier: string; mode: string; inscriptible: boolean; presentAvant: boolean } {
  const d = join(iso.racine, "journal-lecture-seule");
  mkdirSync(d);
  chmodSync(d, 0o555);
  const chemin = join(d, "journal.md");
  let inscriptible = true;
  try {
    accessSync(d, constants.W_OK);
  } catch {
    inscriptible = false;
  }
  return { chemin, dossier: d, mode: (statSync(d).mode & 0o777).toString(8), inscriptible, presentAvant: existsSync(chemin) };
}

/** K8 : `git rev-list --count --all` dans le dépôt temporaire ; null si le compte n'est pas établi. */
function compteGit(iso: Isolement): number | null {
  try {
    const sortie = execFileSync(join(iso.chemins.bin, "git"), ["rev-list", "--count", "--all"], { cwd: iso.chemins.cwd, env: { HOME: iso.chemins.home, PATH: iso.chemins.bin }, encoding: "utf8" }).trim();
    return /^\d+$/.test(sortie) ? Number(sortie) : null;
  } catch {
    return null;
  }
}

/** Inventaire du cwd temporaire hors `.git` : chemins, types, SHA-256 des fichiers. */
export function inventaireCwd(racine: string): EntreeCwd[] {
  const out: EntreeCwd[] = [];
  const visiter = (rel: string) => {
    for (const e of readdirSync(join(racine, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === ".git") continue;
      if (e.isDirectory()) {
        out.push({ chemin: r, type: "dossier" });
        visiter(r);
      } else if (e.isFile()) out.push({ chemin: r, type: "fichier", sha256: sha256(readFileSync(join(racine, r))) });
      else out.push({ chemin: r, type: e.isSymbolicLink() ? "lien" : "autre" });
    }
  };
  visiter("");
  return out;
}

/** M2.13 : les modules optionnels, résolus depuis les chunks avec l'environnement de l'enfant, ne sortent pas de l'ensemble contrôlé. */
function verifierOptionnels(node: CibleNode, pi: CiblePi, env: Record<string, string>, cwd: string, identite: Identite): void {
  const chunk = join(pi.racine, "dist", "bundle", "chunks", "x.js");
  const code = `const r=require("node:module").createRequire(${JSON.stringify(chunk)});for(const n of ${JSON.stringify(OPTIONNELS)}){let v;try{v=r.resolve(n)}catch(e){v="ECHEC "+e.code}console.log(n+"\\t"+v)}`;
  let sortie = "";
  try {
    sortie = execFileSync(node.reel, ["-e", code], { encoding: "utf8", env, cwd });
  } catch (e) {
    // Node introuvable : atteint seulement quand M2.3 est désarmé par un mutant de falsifier.sh.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const ligne of sortie.trim().split("\n")) {
    const [nom, v] = ligne.split("\t");
    if (v.startsWith("ECHEC")) continue;
    if (!paquetDe(pi.racine, v, identite)) refuser("M2.13", `${nom} se résout hors de l'ensemble contrôlé : ${v}`);
  }
}

// ── Captures ──────────────────────────────────────────────────────────────────

export type EvenementJiti = { forme: string; ids: string[]; texte: string };
export type Captures = {
  node: { evenements: number; fils: number[]; chargements: number; resolutions: number; deleguees: string[]; echecs: Array<{ spec: string; code: string }>; horsInstallation: string[]; verifies: number; enveloppes: any };
  jiti: { evenements: EvenementJiti[]; transpiles: string[]; virtuels: string[]; natifs: string[]; application: number; stderrJiti: number };
  aveugles: { lectures: any[]; dlopen: any[]; workers: any[]; fils: any[]; data: string[] };
  flux: any[];
  sonde: any[];
  fournisseur: any[];
  simulateurs: Record<string, any[]>;
  sessions: Array<{ fichier: string; entrees: any[] }>;
  /** Lancements de simulateurs déclarés admis par M6.15. */
  admis: any[];
};

/** Les quatre canaux lus après une exécution, tels quels, et stdout/stderr de l'enfant. */
export type Brutes = { stdout: string; stderr: string; trace: string; sonde: string; fournisseur: string; simulateurs?: Record<string, string>; sessions?: Record<string, string> };
/** Ce que l'analyse doit savoir de la tentative. */
export type Contexte = { pi: CiblePi; identite: Identite; chemins: Isolement["chemins"]; argv: string[]; virtuels: string[]; simulateurs?: SimulateurPose[] };

/** Grammaire du journal de jiti 2.7.0 (`debug()` de `dist/jiti.cjs`). Une forme inconnue est indéterminée. */
const GRAMMAIRE: Array<[string, RegExp]> = [
  ["init", /^\[init\] version: \S+ module-cache: (true|false) fs-cache: (\S+) rebuild-fs-cache: (true|false) interop-defaults: (true|false)$/],
  ["transpile", /^\[transpile\] \[(esm|cjs)\] (.+) \(\d+(?:\.\d+)?ms\)$/],
  ["virtual", /^\[virtual\] (.+)$/],
  ["native-data", /^\[native\] \[data\] \[import\] (.+)$/],
  ["native-unknown", /^\[native\] \[unknown\] \[(?:import|require)\] (.+)$/],
  ["native", /^\[native\] \[(?:import|require)\] (.+)$/],
  ["try-native", /^\[try-native\] \[(?:import|require)\] (.+)$/],
  ["json", /^\[json\] (.+)$/],
  ["cache-hit", /^\[cache\] \[hit\] (.+) ~> (.+)$/],
  ["cache-miss", /^\[cache\] \[miss\] (.+)$/],
  ["cache-store", /^\[cache\] \[store\] (.+) ~> (.+)$/],
  ["esm-fallback", /^\[esm\] \[import\] \[fallback\] (.+)$/],
  ["esm-tempfile", /^\[esm\] \[tempfile\] (.+)$/],
  ["fallback", /^\[fallback\] (.+)$/],
  ["diag-require", /^Native require error: (.*)$/s],
  ["diag-import", /^Native import error: (.*)$/s],
  ["diag-cache", /^Error creating cache directory at (.*)$/s],
];

export function analyserJiti(texte: string): EvenementJiti | null {
  if (!texte.startsWith("[jiti] ")) return null;
  const corps = texte.slice("[jiti] ".length);

  if (corps.startsWith("{")) {
    let d: any;
    try {
      d = JSON.parse(corps);
    } catch {
      return null;
    }
    if (
      d === null ||
      Array.isArray(d) ||
      typeof d !== "object" ||
      d.code !== "BABEL_PARSE_ERROR" ||
      typeof d.reasonCode !== "string" ||
      d.reasonCode.length === 0 ||
      d.loc === null ||
      typeof d.loc !== "object" ||
      Array.isArray(d.loc) ||
      !Number.isInteger(d.loc.line) ||
      d.loc.line < 1 ||
      !Number.isInteger(d.loc.column) ||
      d.loc.column < 0 ||
      !Number.isInteger(d.loc.index) ||
      d.loc.index < 0 ||
      !Number.isInteger(d.pos) ||
      d.pos !== d.loc.index
    ) return null;
    return { forme: "diag-transform", ids: [], texte };
  }

  for (const [forme, re] of GRAMMAIRE) {
    const m = corps.match(re);
    if (m) return { forme, ids: m.slice(1).filter((x) => x !== undefined), texte };
  }
  return null;
}

function cheminFichier(url: string): string | null {
  return url.startsWith("file://") ? fileURLToPath(url) : null;
}

/** Lit les captures d'une exécution. */
function lireBrutes(t: Tentative): Brutes {
  const lire = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const env = t.iso!.env;
  const simulateurs: Record<string, string> = {};
  for (const sim of t.simulateurs ?? []) simulateurs[sim.nom] = lire(join(t.iso!.chemins.obs, `simulateur-${sim.nom}.jsonl`));
  // Fichiers de session sous --session-dir, s'il y en a, lus récursivement.
  const sessions: Record<string, string> = {};
  const parcourir = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) parcourir(f);
      else if (e.name.endsWith(".jsonl")) sessions[relative(t.iso!.chemins.sessions, f)] = readFileSync(f, "utf8");
    }
  };
  parcourir(t.iso!.chemins.sessions);
  return { stdout: t.stdout ?? "", stderr: t.stderr ?? "", trace: lire(env.PI_CONTRATS_TRACE), sonde: lire(env.PI_CONTRATS_SONDE), fournisseur: lire(env.PI_CONTRATS_FOURNISSEUR), simulateurs, sessions };
}

/** K9 : le prompt système de résumé déclaré est celui du bundle identifié (empreinte et présence dans le chunk vérifié). */
function verifierPromptResume(racine: string, texte: string): void {
  if (texte !== SUMMARIZATION_SYSTEM_PROMPT || sha256(texte) !== SUMMARIZATION_SYSTEM_PROMPT_SHA256) {
    throw new Error("prompt système de résumé déclaré différent du texte épinglé");
  }
  const chunk = readFileSync(join(racine, CHUNK_RESUME), "utf8");
  if (!chunk.includes(texte)) throw new Error(`prompt système de résumé absent de ${CHUNK_RESUME}`);
}

/**
 * K7 : pose chaque simulateur déclaré comme fichier exécutable ordinaire du bin/ temporaire.
 * Octets : `#!<node contrôlé>` puis la source déclarée ; l'empreinte attendue est calculée sur
 * ces octets déclarés, et celle de l'interprète relevée avant lancement.
 */
function poserSimulateurs(s: Scenario, bin: string, node: CibleNode): SimulateurPose[] {
  const poses: SimulateurPose[] = [];
  for (const sim of s.simulateurs ?? []) {
    if (["git", "bash", "sh"].includes(sim.nom) || sim.nom.includes("/")) throw new Error(`nom de simulateur non admissible : ${sim.nom}`);
    const octets = Buffer.from(`#!${node.reel}\n${sim.source}`, "utf8");
    const chemin = join(bin, sim.nom);
    if (existsSync(chemin)) throw new Error(`simulateur ${sim.nom} : ${chemin} existe déjà`);
    writeFileSync(chemin, octets, { mode: 0o755 });
    chmodSync(chemin, 0o755);
    const reel = realpathSync(chemin);
    const attendu = sha256(octets);
    if (reel !== chemin || sha256(readFileSync(reel)) !== attendu) throw new Error(`simulateur ${sim.nom} : fichier posé différent des octets déclarés`);
    poses.push({ nom: sim.nom, chemin, reel, sha256: attendu, interprete: { chemin: node.reel, sha256: sha256(readFileSync(node.reel)) } });
  }
  return poses;
}

/** D1′ : relation observée, indépendante de l'ordre et compatible avec le cache jiti. */
export function resolutionDelegueeJiti(
  a: { f: string; parent: string | null; th: number; seq: number },
  evaluations: ReadonlyArray<{ f: string; th: number; seq: number }>,
): boolean {
  return a.parent !== null
    && evaluations.some((e) => e.f === a.f && e.th === a.th)
    && evaluations.some((e) => e.f === a.parent && e.th === a.th);
}

/**
 * Analyse des captures. Pure sur ses entrées, sauf la relecture des fichiers chargés
 * pour les comparer au manifeste ; les contre-épreuves l'appellent sur des captures altérées.
 */
export function analyserCaptures(b: Brutes, ctx: Contexte): { captures: Captures; constats: Constat[] } {
  const constats: Constat[] = [];
  const releve = releveur(constats);
  const invalider = (id: string, d: string) => releve(id, "INVALIDE", d);
  const indeterminer = (id: string, d: string) => releve(id, "INDETERMINE", d);
  const { pi, identite, chemins } = ctx;

  // Toute ligne non vide illisible, dans l'un des quatre canaux, rend la mesure indéterminée.
  const parser = (texte: string, canal: string): any[] => {
    const lignes: any[] = [];
    texte.split("\n").forEach((l, i) => {
      if (!l.trim()) return;
      try {
        lignes.push(JSON.parse(l));
      } catch {
        indeterminer("capture-illisible", `${canal}, ligne ${i + 1} illisible : ${l.slice(0, 80)}`);
      }
    });
    return lignes;
  };
  const flux = parser(b.stdout, "stdout");
  const ev = parser(b.trace, "trace");
  const sonde = parser(b.sonde, "sonde");
  const fournisseur = parser(b.fournisseur, "fournisseur");
  const simulateurs: Record<string, any[]> = {};
  for (const [nom, texte] of Object.entries(b.simulateurs ?? {})) simulateurs[nom] = parser(texte, `simulateur ${nom}`);
  const sessions = Object.entries(b.sessions ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)).map(([fichier, texte]) => ({ fichier, entrees: parser(texte, `session ${fichier}`) }));

  // ── Voie Node : chaque fil a un unique début, une unique attestation, une unique fin propre, en dernier ──
  if (!ev.length) indeterminer("trace-fil", "aucune trace de la voie Node");
  const fils = [...new Set(ev.map((e) => e.th))].sort((x, y) => x - y);
  if (ev.length && !fils.includes(0)) indeterminer("trace-fil", "aucun événement du fil principal");
  for (const th of fils) {
    const du = ev.filter((e) => e.th === th);
    du.forEach((e, i) => {
      if (e.seq !== i + 1) indeterminer("trace-fil", `fil ${th} : numérotation interrompue à ${i + 1} (lu ${e.seq})`);
    });
    const n = (t: string) => du.filter((e) => e.t === t).length;
    if (n("debut") !== 1) indeterminer("trace-fil", `fil ${th} : ${n("debut")} début(s)`);
    if (n("enveloppes") !== 1) indeterminer("trace-fil", `fil ${th} : ${n("enveloppes")} attestation(s) des enveloppes`);
    const env = du.find((e) => e.t === "enveloppes");
    if (env && !(env.fils && env.lecture && env.worker && env.dlopen && env.console)) indeterminer("trace-fil", `fil ${th} : enveloppes non attestées`);
    if (n("fin") !== 1) indeterminer("trace-fil", `fil ${th} : ${n("fin")} fin(s) propre(s)`);
    else if (du[du.length - 1].t !== "fin") indeterminer("trace-fil", `fil ${th} : événement après la fin propre (${du[du.length - 1].t})`);
  }
  for (const e of ev.filter((x) => x.t === "fin-sans-accuse")) indeterminer("trace-fil", `worker ${e.worker} arrêté sans accusé de fin`);
  for (const w of ev.filter((e) => e.t === "worker-cree").map((e) => e.worker)) {
    if (!fils.includes(w)) indeterminer("aveugle-worker", `worker ${w} créé sans trace propre : son fil n'est pas couvert`);
  }

  // ── Voie Node : chaque résolution vers un fichier reste dans l'installation contrôlée ──
  // Exception D1′ (ARRÊTS M6 Mac C6.2 et C2.9) : une résolution vers un fichier de la copie du candidat
  // ou de tests/pi-contrats, sans chargement par Node du même fichier, est mise en attente ; elle
  // n'est admise que si le fichier et son parent ont chacun une évaluation jiti observée dans le même fil. L'ordre est libre.
  const chargesNode = new Set(ev.filter((e) => e.t === "load").map((e) => cheminFichier(e.url)).filter((f): f is string => f !== null));
  const resolutionsEnAttente: { url: string; f: string; parent: string | null; th: number; seq: number }[] = [];
  const resolutionsDeleguees: string[] = [];
  for (const r of ev.filter((e) => e.t === "resolve")) {
    const f = cheminFichier(r.url);
    if (!f || paquetDe(pi.racine, f, identite)) continue;
    if ([chemins.candidat, ICI].some((x) => f.startsWith(x + sep)) && !chargesNode.has(f)) resolutionsEnAttente.push({ url: r.url, f, parent: typeof r.parent === "string" ? cheminFichier(r.parent) : null, th: r.th, seq: r.seq });
    else invalider("trace-node-hors", `résolution par Node hors de l'installation contrôlée : ${r.url}`);
  }

  // ── Voie Node : chaque chargement dans l'ensemble contrôlé ──
  const resolus = new Set(ev.filter((e) => e.t === "resolve").map((e) => e.url));
  const chargements = ev.filter((e) => e.t === "load");
  const horsInstallation: string[] = [];
  let verifies = 0;
  const data: string[] = [];
  for (const c of chargements) {
    if (!resolus.has(c.url) && c.url !== `file://${pi.reel}`) indeterminer("trace-node", `chargement sans résolution observée : ${c.url}`);
    if (c.url.startsWith("node:")) continue;
    if (c.url.startsWith("data:")) {
      data.push(c.url.slice(0, 60));
      continue;
    }
    const f = cheminFichier(c.url);
    const p = f ? paquetDe(pi.racine, f, identite) : null;
    if (!f || !p) {
      horsInstallation.push(c.url);
      invalider("trace-node-hors", `chargement par Node hors de l'installation contrôlée : ${c.url}`);
      continue;
    }
    if (["node_modules/@earendil-works/pi-ai", "node_modules/@earendil-works/pi-agent-core", "node_modules/@earendil-works/pi-tui"].includes(p.cle) && /\.(m|c)?js$/.test(p.rel)) {
      releve("M2.16", "INVALIDE", `Node charge ${p.cle}/${p.rel}, servi par le bundle`);
    }
    const attendu = identite.paquets[p.cle]?.fichiers[p.rel];
    if (!attendu || sha256(readFileSync(f)) !== attendu) invalider("trace-node-hors", `fichier chargé hors manifeste ou différent : ${p.cle}/${p.rel}`);
    else verifies++;
  }

  // ── Voie jiti : attribution et grammaire ──
  const jitiControle = join(pi.racine, "node_modules", "jiti", "dist", "jiti.cjs");
  const consoles = ev.filter((e) => e.t === "console");
  const evenements: EvenementJiti[] = [];
  const provenancesJiti = new Map<EvenementJiti, { th: number; seq: number }>();
  let application = 0;
  for (const c of consoles) {
    if (c.origine === null) {
      indeterminer("jiti-attribution", `console.log sans appelant lisible : ${String(c.texte).slice(0, 80)}`);
      continue;
    }
    if (c.origine !== jitiControle) {
      application++;
      continue;
    }
    const e = analyserJiti(String(c.texte));
    if (!e) indeterminer("jiti-grammaire", `séquence jiti inconnue ou tronquée : ${String(c.texte).slice(0, 120)}`);
    else {
      evenements.push(e);
      provenancesJiti.set(e, { th: c.th, seq: c.seq });
    }
  }
  const stderrJiti = b.stderr.split("\n").filter((l) => l.startsWith("[jiti]")).length;
  const consolesJiti = consoles.filter((c) => String(c.texte).startsWith("[jiti]")).length;
  if (stderrJiti !== consolesJiti) indeterminer("jiti-completude", `${stderrJiti} ligne(s) [jiti] sur stderr, ${consolesJiti} appel(s) console.log capturé(s)`);
  if (evenements.length === 0) releve("M2.15", "INDETERMINE", "journal de jiti non obtenu");
  for (const e of evenements.filter((x) => x.forme === "init")) {
    if (!/module-cache: false fs-cache: false /.test(e.texte)) invalider("jiti-cache", `jiti initialisé avec un cache : ${e.texte}`);
  }

  const racinesAdmises = [chemins.candidat, ICI];
  const transpiles: string[] = [];
  const evaluationsJiti: Array<{ f: string; th: number; seq: number }> = [];
  const virtuels: string[] = [];
  const natifs: string[] = [];
  const specsResolues = new Set(ev.filter((x) => x.t === "resolve" || x.t === "resolve-echec").map((x) => x.spec));
  for (const e of evenements) {
    const chemin = (x: string) => (x === "." ? chemins.cwd : x.startsWith("./") ? join(chemins.cwd, x.slice(2)) : x);
    if (e.forme === "transpile" || e.forme === "json" || e.forme === "fallback" || e.forme === "esm-fallback") {
      const f = chemin(e.ids[e.ids.length - 1]);
      transpiles.push(f);
      evaluationsJiti.push({ f, ...provenancesJiti.get(e)! });
      if (!racinesAdmises.some((r) => f.startsWith(r + sep))) releve("M2.11", "INVALIDE", `jiti évalue ${f}, hors de la copie du candidat et de tests/pi-contrats`);
    } else if (e.forme === "virtual") {
      virtuels.push(e.ids[0]);
      if (!ctx.virtuels.includes(e.ids[0])) releve("M2.14", "INVALIDE", `module virtuel hors de la liste déclarée : ${e.ids[0]}`);
    } else if (e.forme.startsWith("native") || e.forme === "try-native") {
      const id = e.ids[e.ids.length - 1];
      natifs.push(id);
      const nu = id.replace(/^node:/, "");
      if (!(id.startsWith("node:") || builtinModules.includes(nu)) && !specsResolues.has(id)) {
        indeterminer("complementarite", `jiti délègue ${id} à Node, sans résolution observée sur la voie Node`);
      }
    } else if (e.forme.startsWith("cache")) {
      invalider("jiti-cache", `cache de jiti employé : ${e.texte}`);
    } else if (e.forme === "esm-tempfile") {
      indeterminer("aveugle-esm", `repli ESM de jiti par fichier temporaire : ${e.texte}`);
    }
    // "diag-transform" et les diagnostics "diag-*" ne sont pas des chargements.
  }
  // Complétude : chaque extension passée en -e a été transpilée par jiti. Un journal absent relève de M2.15.
  const argv = ctx.argv;
  if (evenements.length > 0) {
    argv.forEach((a, i) => {
      if (a === "-e" && !transpiles.includes(argv[i + 1])) indeterminer("jiti-completude", `extension ${argv[i + 1]} sans évaluation observée par jiti`);
    });
  }

  // Résolutions mises en attente : fichier et parent évalués par jiti, même fil, avant ou après.
  for (const a of resolutionsEnAttente) {
    if (resolutionDelegueeJiti(a, evaluationsJiti)) resolutionsDeleguees.push(a.url);
    else invalider("trace-node-hors", `résolution par Node hors de l'installation contrôlée, sans évaluation du fichier et de son parent par jiti dans le même fil : ${a.url}`);
  }

  // ── Voies aveugles ──
  const lectures = ev.filter((e) => e.t === "lecture");
  const dlopen = ev.filter((e) => e.t === "dlopen");
  const workers = ev.filter((e) => e.t === "worker");
  const filsProc = ev.filter((e) => e.t === "fils");
  for (const l of lectures) {
    const p = paquetDe(pi.racine, l.chemin, identite);
    if (!p || identite.paquets[p.cle]?.fichiers[p.rel] !== sha256(readFileSync(l.chemin))) invalider("aveugle-lecture", `lecture hors manifeste : ${l.chemin}`);
  }
  for (const d of dlopen) {
    const p = paquetDe(pi.racine, d.chemin, identite);
    if (!p) invalider("aveugle-dlopen", `addon natif hors de l'installation : ${d.chemin}`);
  }
  // Processus fils (K7). git, bash et sh gardent l'admission d'etape0-r3, sans extension par nom.
  // Un lancement par nom, ou par un chemin du bin/ temporaire, n'est admis que si sa résolution
  // consignée désigne exactement un simulateur déclaré, aux octets déclarés (M6.15). Tout autre
  // lancement reste une voie aveugle non déclarée.
  const admis: any[] = [];
  const poses = ctx.simulateurs ?? [];
  for (const f of filsProc) {
    const nom = f.commande.split("/").pop();
    if (["git", "bash", "sh"].includes(nom)) continue;
    if (f.commande.includes("/") && !f.commande.startsWith(chemins.bin + sep)) {
      indeterminer("aveugle-fils", `processus fils non déclaré : ${f.commande}`);
      continue;
    }
    const r = f.resolution;
    const d = poses.find((x) => x.nom === nom);
    // M6.15 porte un identifiant par motif, pour que chaque garde ait son mutant propre.
    if (!r) releve("M6.15/non-consignee", "INDETERMINE", `lancement de ${f.commande} : résolution non consignée`);
    else if (r.etat !== "resolue") releve("M6.15/non-etablie", "INDETERMINE", `lancement de ${f.commande} : résolution non établie (${r.etat}${r.motif ? ` : ${r.motif}` : ""})`);
    else if (!d) releve("M6.15/non-declare", "INVALIDE", `lancement de ${f.commande} résolu vers ${r.reel} : aucun simulateur déclaré de ce nom`);
    else if (r.reel !== d.reel) releve("M6.15/hors-cible", "INVALIDE", `lancement de ${f.commande} résolu vers ${r.reel} (${r.sha256}) : cible non admise, simulateur déclaré ${d.reel} (${d.sha256})`);
    else if (r.sha256 !== d.sha256) releve("M6.15/octets", "INVALIDE", `lancement de ${f.commande} résolu vers ${r.reel} aux octets ${r.sha256} : octets différents du simulateur déclaré (${d.sha256})`);
    else admis.push({ nom, cwd: f.cwd, path: f.path, args: f.args, reel: r.reel, sha256: r.sha256, pid: f.pid ?? null });
  }
  // L'interprète déclaré d'un simulateur est inchangé depuis la pose.
  for (const d of poses) {
    let actuel = "";
    try {
      actuel = sha256(readFileSync(d.interprete.chemin));
    } catch {
      actuel = "illisible";
    }
    if (actuel !== d.interprete.sha256) releve("M6.15/interprete", "INVALIDE", `interprète de ${d.nom} (${d.interprete.chemin}) modifié depuis la pose`);
  }
  for (const d of data) indeterminer("aveugle-esm", `import data: observé : ${d}`);

  return {
    constats,
    captures: {
      node: {
        evenements: ev.length,
        fils,
        chargements: chargements.length,
        resolutions: ev.filter((e) => e.t === "resolve").length,
        echecs: ev.filter((e) => e.t === "resolve-echec").map((e) => ({ spec: e.spec, code: e.code })),
        deleguees: resolutionsDeleguees,
        horsInstallation,
        verifies,
        enveloppes: ev.find((e) => e.th === 0 && e.t === "enveloppes") ?? null,
      },
      jiti: { evenements, transpiles, virtuels, natifs, application, stderrJiti },
      aveugles: { lectures, dlopen, workers, fils: filsProc, data },
      flux,
      sonde,
      fournisseur,
      simulateurs,
      sessions,
      admis,
    },
  };
}

/**
 * Témoin de terminate() (matrices, § B) : le Worker lancé depuis worker-vivant.mjs, rattaché par son
 * worker-cree, porte une unique fin de raison terminate, dernier événement de son fil, suivie dans le
 * parent du worker-fin correspondant ; aucun fin-sans-accuse ne le vise. L'ordre « suivie de » est celui
 * des lignes de la trace, écrites de façon synchrone par tous les fils dans le même fichier.
 */
export function temoinTerminate(trace: string): { ok: boolean; detail: string } {
  const ev = trace.split("\n").filter(Boolean).map((l, i) => ({ ...JSON.parse(l), _ligne: i }));
  const crees = ev.filter((e) => e.t === "worker-cree" && String(e.url ?? "").endsWith("worker-vivant.mjs"));
  if (crees.length !== 1) return { ok: false, detail: `${crees.length} worker-cree pour worker-vivant.mjs` };
  const id = crees[0].worker;
  const fil = ev.filter((e) => e.th === id);
  if (!fil.length) return { ok: false, detail: `fil ${id} sans trace` };
  if (fil.some((e, i) => e.seq !== i + 1)) return { ok: false, detail: `fil ${id} : numérotation discontinue` };
  const fins = fil.filter((e) => e.t === "fin");
  if (fins.length !== 1) return { ok: false, detail: `fil ${id} : ${fins.length} fin(s)` };
  if (fil[fil.length - 1].t !== "fin") return { ok: false, detail: `fil ${id} : la fin n'est pas le dernier événement` };
  if (fins[0].raison !== "terminate") return { ok: false, detail: `fil ${id} : fin de raison ${fins[0].raison}` };
  const wf = ev.filter((e) => e.th !== id && e.t === "worker-fin" && e.worker === id);
  if (wf.length !== 1) return { ok: false, detail: `${wf.length} worker-fin du parent pour le fil ${id}` };
  if (wf[0]._ligne < fins[0]._ligne) return { ok: false, detail: `worker-fin du parent avant la fin du fil ${id}` };
  if (ev.some((e) => e.t === "fin-sans-accuse" && e.worker === id)) return { ok: false, detail: `fin-sans-accuse visant le fil ${id}` };
  return { ok: true, detail: `fil ${id} (worker-vivant.mjs) : fin unique « terminate » en dernier, puis worker-fin du parent` };
}

/** Mutant du témoin : l'ancien comptage global d'une seule fin « terminate », sans rattachement au Worker. */
export function temoinTerminateComptageGlobal(trace: string): { ok: boolean; detail: string } {
  const n = trace.split("\n").filter((l) => l.includes('"t":"fin"') && l.includes('"raison":"terminate"')).length;
  return { ok: n === 1, detail: `${n} fin(s) « terminate » dans toute la trace` };
}

/** Une extension qui ne se charge pas : diagnostic `Failed to load extension "<chemin>"` sur stderr. */
export function diagnosticChargement(stderr: string, chemin: string): boolean {
  return stderr.includes(`Failed to load extension "${chemin}"`) || stderr.includes(`Extension path does not exist: ${chemin}`);
}


// ── Stimuli des refus (matrices, § B) ─────────────────────────────────────────

export type Stimulus = {
  id: string;
  regle: string;
  /** « lecteur » : épreuve du seul lecteur d'identité, sans lancement de pi. */
  moment: "avant" | "apres" | "lecteur";
  preparer?: (path: string, tmp: string) => Options;
  lecteur?: (tmp: string) => { chemin: string; version: string };
};

function cheminsSans(path: string, dossiers: string[]): string {
  return path.split(delimiter).filter((d) => d && !dossiers.includes(d)).join(delimiter);
}

/** L'installation contrôlée trouvée par le PATH de l'opérateur, sans refus. */
function installation(path: string): { pi: CiblePi; prefixe: string; dossiersPi: string[] } {
  const identite = lireIdentite(join(ICI, `identite-${VERSION_QUALIFIEE}.json`));
  const pi = resoudrePi(path, identite);
  const dossiersPi = candidats("pi", path).map((c) => dirname(c.chemin));
  return { pi, prefixe: dirname(dirname(pi.chemin)), dossiersPi };
}

/** Copie de l'installation (liens conservés) ; rend le PATH qui la désigne. */
function copierInstallation(path: string, dest: string, alterer: (racine: string) => void): string {
  const { pi, prefixe, dossiersPi } = installation(path);
  cpSync(prefixe, dest, { recursive: true, verbatimSymlinks: true });
  const racine = join(dest, relative(prefixe, pi.racine));
  alterer(racine);
  return [join(dest, relative(prefixe, dirname(pi.chemin))), cheminsSans(path, dossiersPi)].join(delimiter);
}

function executable(chemin: string, contenu: string): void {
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, contenu);
  chmodSync(chemin, 0o755);
}

function fauxHome(tmp: string, contenu: Record<string, string> = { "agent/settings.json": "{}\n" }): string {
  const h = join(tmp, "faux-home");
  for (const [rel, c] of Object.entries(contenu)) {
    mkdirSync(dirname(join(h, ".pi", rel)), { recursive: true });
    writeFileSync(join(h, ".pi", rel), c);
  }
  process.env.HOME = h;
  return h;
}

const sansVariable = (v: string) => (x: { env: Record<string, string>; argv: string[]; cwd: string }) => {
  const env = { ...x.env };
  delete env[v];
  return { ...x, env };
};

export function stimuli(): Stimulus[] {
  const base = (path: string, extra: Partial<Options> = {}): Options => ({ pathOperateur: path, scenario: NOMINAL, ...extra });
  const s: Stimulus[] = [
    {
      id: "M2.1", regle: "M2.1", moment: "avant",
      preparer: (path, tmp) => {
        const { pi } = installation(path);
        mkdirSync(join(tmp, "a"));
        symlinkSync(pi.reel, join(tmp, "a", "pi"));
        executable(join(tmp, "b", "pi"), readFileSync(pi.reel, "utf8"));
        return base([join(tmp, "a"), join(tmp, "b"), path].join(delimiter));
      },
    },
    {
      id: "M2.2", regle: "M2.2", moment: "avant",
      // Copie de l'installation dont `bin/pi` est un script tiers, hors du paquet.
      preparer: (path, tmp) =>
        base(copierInstallation(path, join(tmp, "inst"), (r) => {
          const bin = join(r, "..", "..", "..", "..", "bin", "pi");
          rmSync(bin);
          executable(bin, "#!/bin/sh\nexit 0\n");
        })),
    },
    {
      id: "M2.3/absent", regle: "M2.3", moment: "avant",
      preparer: (path, tmp) => {
        const { pi } = installation(path);
        mkdirSync(join(tmp, "seul"));
        symlinkSync(pi.reel, join(tmp, "seul", "pi"));
        const sansNode = path.split(delimiter).filter((d) => d && !candidats("node", d).length && !candidats("pi", d).length);
        return base([join(tmp, "seul"), ...sansNode].join(delimiter));
      },
    },
    {
      id: "M2.3/v20", regle: "M2.3", moment: "avant",
      // Node simulé de version 20 : il répond v20 à la sonde de version et délègue tout le reste au vrai Node.
      preparer: (path, tmp) => {
        const vrai = candidats("node", path)[0].reel;
        executable(join(tmp, "node20", "node"), `#!/bin/sh\ncase "$2" in *registerHooks*) echo 'v20.0.0 function'; exit 0;; esac\nexec '${vrai}' "$@"\n`);
        return base([join(tmp, "node20"), path].join(delimiter));
      },
    },
    {
      id: "M2.4", regle: "M2.4", moment: "avant",
      preparer: (path, tmp) => {
        const { pi, dossiersPi } = installation(path);
        mkdirSync(join(tmp, "autre"));
        symlinkSync(join(pi.racine, "dist", "cli.js"), join(tmp, "autre", "pi"));
        return base([join(tmp, "autre"), cheminsSans(path, dossiersPi)].join(delimiter));
      },
    },
    {
      // Une installation 0.99.0 réelle (dossier `bin` dans PI_CONTRATS_PATH_0990), sans le mode de contre-épreuve.
      id: "M2.5", regle: "M2.5", moment: "avant",
      preparer: (path) => {
        const d = process.env.PI_CONTRATS_PATH_0990;
        if (!d) throw new Error("PI_CONTRATS_PATH_0990 absent : installation 0.99.0 de l'épreuve M2.5 inconnue");
        return base([d, cheminsSans(path, installation(path).dossiersPi)].join(delimiter), { version: "0.99.0" });
      },
    },
    {
      id: "M2.6", regle: "M2.6", moment: "avant",
      preparer: (path, tmp) => base(copierInstallation(path, join(tmp, "inst"), (r) => rmSync(join(r, "dist", "bundle", "chunks", "virtual-modules-XW5APVUE.js")))),
    },
    {
      // Fichier ordinaire rendu illisible (droits retirés). Pour root, la lecture reste possible :
      // le stimulus n'est alors pas constituable, et l'épreuve échoue sans verdict.
      id: "M2.7", regle: "M2.7", moment: "avant",
      preparer: (path, tmp) =>
        base(copierInstallation(path, join(tmp, "inst"), (r) => {
          const f = join(r, "dist", "bundle", "chunks", "virtual-modules-XW5APVUE.js");
          chmodSync(f, 0o000);
          try {
            readFileSync(f);
          } catch {
            return;
          }
          throw new Error("stimulus M2.7 non constituable : le fichier reste lisible (exécution en root)");
        })),
    },
    {
      // Racine de paquet remplacée par un lien vers une copie extérieure aux mêmes octets.
      // chord : paquet chargé à chaque démarrage, sans lien npm .bin (la règle .bin reste hors de l'épreuve).
      id: "M2.17", regle: "M2.17", moment: "avant",
      preparer: (path, tmp) =>
        base(copierInstallation(path, join(tmp, "inst"), (r) => {
          const d = join(r, "node_modules", "@earendil-works", "chord");
          cpSync(d, join(tmp, "chord-exterieur"), { recursive: true });
          rmSync(d, { recursive: true });
          symlinkSync(join(tmp, "chord-exterieur"), d);
        })),
    },
    {
      // Fichier requis remplacé par un lien vers une copie extérieure aux mêmes octets.
      id: "M2.18/fichier", regle: "M2.18", moment: "avant",
      preparer: (path, tmp) =>
        base(copierInstallation(path, join(tmp, "inst"), (r) => {
          const f = join(r, "dist", "bundle", "chunks", "virtual-modules-XW5APVUE.js");
          cpSync(f, join(tmp, "virtual-modules-exterieur.js"));
          rmSync(f);
          symlinkSync(join(tmp, "virtual-modules-exterieur.js"), f);
        })),
    },
    {
      // esbuild/bin/esbuild lié vers une copie extérieure des octets du binaire de la plateforme.
      // Le lien npm .bin/esbuild, qui viserait la même cible et relève de sa propre règle, est retiré du stimulus.
      id: "M2.18/esbuild", regle: "M2.18", moment: "avant",
      preparer: (path, tmp) =>
        base(copierInstallation(path, join(tmp, "inst"), (r) => {
          const plat = readdirSync(join(r, "node_modules", "@esbuild"))[0];
          cpSync(join(r, "node_modules", "@esbuild", plat, "bin", "esbuild"), join(tmp, "esbuild-exterieur"));
          const f = join(r, "node_modules", "esbuild", "bin", "esbuild");
          rmSync(f);
          symlinkSync(join(tmp, "esbuild-exterieur"), f);
          rmSync(join(r, "node_modules", ".bin", "esbuild"));
        })),
    },
    {
      id: "M2.8", regle: "M2.8", moment: "avant",
      preparer: (path, tmp) =>
        base(copierInstallation(path, join(tmp, "inst"), (r) => {
          const f = join(r, "dist", "bundle", "chunks", "virtual-modules-XW5APVUE.js");
          const b = readFileSync(f);
          b[b.length - 2] ^= 1;
          writeFileSync(f, b);
        })),
    },
    {
      id: "M2.9", regle: "M2.9", moment: "avant",
      preparer: (path, tmp) => {
        const id = lireIdentite(join(ICI, `identite-${VERSION_QUALIFIEE}.json`));
        id.paquets["node_modules/@earendil-works/pi-tui"].archive.sha256 = "0".repeat(64);
        writeFileSync(join(tmp, "identite-alteree.json"), JSON.stringify(id));
        return base(path, { identite: join(tmp, "identite-alteree.json") });
      },
    },
    {
      // Lecteur d'identité : une empreinte de fichier modifiée, métadonnées d'archives intactes.
      id: "M2.9/fichier", regle: "M2.9", moment: "lecteur",
      lecteur: (tmp) => {
        const id = JSON.parse(readFileSync(join(ICI, `identite-${VERSION_QUALIFIEE}.json`), "utf8"));
        const f = Object.keys(id.paquets[""].fichiers)[0];
        id.paquets[""].fichiers[f] = "0".repeat(64);
        writeFileSync(join(tmp, "identite-fichier.json"), JSON.stringify(id));
        return { chemin: join(tmp, "identite-fichier.json"), version: VERSION_QUALIFIEE };
      },
    },
    {
      // Lecteur d'identité : optionnel_plateforme modifié, métadonnées d'archives intactes.
      id: "M2.9/optionnel", regle: "M2.9", moment: "lecteur",
      lecteur: (tmp) => {
        const id = JSON.parse(readFileSync(join(ICI, `identite-${VERSION_QUALIFIEE}.json`), "utf8"));
        id.paquets["node_modules/@esbuild/aix-ppc64"].optionnel_plateforme = { os: [process.platform], cpu: [process.arch] };
        writeFileSync(join(tmp, "identite-optionnel.json"), JSON.stringify(id));
        return { chemin: join(tmp, "identite-optionnel.json"), version: VERSION_QUALIFIEE };
      },
    },
    {
      // Identité épinglée intacte. Dans une copie de l'installation, le paquet optionnel admis pour la
      // plateforme courante (@esbuild/<plateforme>) est retiré ; esbuild/bin/esbuild est d'abord rétabli
      // aux octets originaux de son archive vérifiée (intégrité du shrinkwrap, puis manifeste du fichier).
      // L'archive vient du cache npm de l'opérateur (`npm pack --offline`) : sans elle, le stimulus
      // n'est pas constituable et l'épreuve échoue.
      id: "M2.10", regle: "M2.10", moment: "avant",
      preparer: (path, tmp) => {
        const identite = lireIdentite(join(ICI, `identite-${VERSION_QUALIFIEE}.json`));
        const e = identite.paquets["node_modules/esbuild"];
        const npm = candidats("npm", path)[0];
        if (!npm) throw new Error("stimulus M2.10 non constituable : npm introuvable dans le PATH");
        mkdirSync(join(tmp, "archive"));
        execFileSync(npm.reel, ["pack", `esbuild@${e.version}`, "--offline", "--silent", "--pack-destination", join(tmp, "archive")], { stdio: ["ignore", "ignore", "pipe"], env: { PATH: path, HOME: process.env.HOME ?? "" } });
        const tgz = join(tmp, "archive", readdirSync(join(tmp, "archive")).find((f) => f.endsWith(".tgz"))!);
        const octets = readFileSync(tgz);
        const [algo] = String(e.archive.integrity).split("-");
        if (`${algo}-${createHash(algo).update(octets).digest("base64")}` !== e.archive.integrity) throw new Error("stimulus M2.10 non constituable : archive esbuild d'intégrité différente");
        mkdirSync(join(tmp, "x"));
        execFileSync("tar", ["-xzf", tgz, "-C", join(tmp, "x")], { stdio: "ignore", env: { PATH: path } });
        const original = readFileSync(join(tmp, "x", "package", "bin", "esbuild"));
        if (sha256(original) !== e.fichiers["bin/esbuild"]) throw new Error("stimulus M2.10 non constituable : bin/esbuild de l'archive différent du manifeste");
        return base(
          copierInstallation(path, join(tmp, "inst"), (r) => {
            const d = join(r, "node_modules", "@esbuild");
            const plat = readdirSync(d)[0];
            const f = join(r, "node_modules", "esbuild", "bin", "esbuild");
            rmSync(f);
            writeFileSync(f, original, { mode: 0o755 });
            rmSync(join(d, plat), { recursive: true });
          }),
        );
      },
    },
    {
      id: "M2.11", regle: "M2.11", moment: "apres",
      preparer: (path, tmp) => {
        writeFileSync(join(tmp, "hors.ts"), "export default 7;\n");
        return base(path, { scenario: { ...NOMINAL, epreuves: ["import-hors-racine"], horsRacine: join(tmp, "hors.ts") } });
      },
    },
    {
      id: "M2.12", regle: "M2.12", moment: "avant",
      preparer: (path) =>
        base(path, { alterer: (x) => ({ ...x, argv: ["--import", join(depotExplicite(), "tests", "stubs", "loader.mjs"), ...x.argv] }) }),
    },
    {
      id: "M2.13", regle: "M2.13", moment: "avant",
      preparer: (path, tmp) => {
        const p = copierInstallation(path, join(tmp, "x", "inst"), () => {});
        mkdirSync(join(tmp, "x", "node_modules", "supports-color"), { recursive: true });
        writeFileSync(join(tmp, "x", "node_modules", "supports-color", "package.json"), '{"name":"supports-color","version":"0.0.0","main":"index.js"}\n');
        writeFileSync(join(tmp, "x", "node_modules", "supports-color", "index.js"), "module.exports = {};\n");
        return base(p);
      },
    },
    { id: "M2.14", regle: "M2.14", moment: "apres", preparer: (path) => base(path, { virtuels: VIRTUELS.filter((v) => v !== "@earendil-works/pi-tui") }) },
    { id: "M2.15", regle: "M2.15", moment: "apres", preparer: (path) => base(path, { alterer: sansVariable("JITI_DEBUG") }) },
    {
      id: "M2.16", regle: "M2.16", moment: "apres",
      preparer: (path) => {
        const { pi } = installation(path);
        return base(path, { scenario: { ...NOMINAL, epreuves: ["require-pi-ai"], piAi: join(pi.racine, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js") } });
      },
    },
    { id: "M6.1", regle: "M6.1", moment: "avant", preparer: (path) => base(path, { alterer: sansVariable("HOME") }) },
    { id: "M6.2", regle: "M6.2", moment: "avant", preparer: (path) => base(path, { alterer: sansVariable("PI_CODING_AGENT_DIR") }) },
    { id: "M6.3", regle: "M6.3", moment: "avant", preparer: (path) => base(path, { alterer: sansVariable("PI_AGENT_DIR") }) },
    { id: "M6.4", regle: "M6.4", moment: "avant", preparer: (path) => base(path, { alterer: sansVariable("PI_JOURNAL_PATH") }) },
    { id: "M6.5", regle: "M6.5", moment: "avant", preparer: (path) => base(path, { alterer: sansVariable("PI_OFFLINE") }) },
    { id: "M6.6", regle: "M6.6", moment: "avant", preparer: (path) => base(path, { alterer: sansVariable("TMPDIR") }) },
    { id: "M6.7", regle: "M6.7", moment: "avant", preparer: (path) => base(path, { alterer: sansVariable("JITI_FS_CACHE") }) },
    { id: "M6.8", regle: "M6.8", moment: "avant", preparer: (path) => base(path, { alterer: (x) => ({ ...x, cwd: dirname(x.cwd) }) }) },
    { id: "M6.9", regle: "M6.9", moment: "avant", preparer: (path) => base(path, { alterer: (x) => ({ ...x, argv: x.argv.filter((a) => a !== "--no-session") }) }) },
    ...["NODE_OPTIONS", "NODE_PATH", "PI_PACKAGE_DIR", "JITI_EXTENSIONS"].map((v): Stimulus => ({
      id: `M6.10/${v}`, regle: "M6.10", moment: "avant",
      preparer: (path, tmp) => base(path, { alterer: (x) => ({ ...x, env: { ...x.env, [v]: v === "JITI_EXTENSIONS" ? '[".js"]' : tmp } }) }),
    })),
    {
      id: "M6.11", regle: "M6.11", moment: "avant",
      preparer: (path, tmp) => {
        const h = fauxHome(tmp);
        return base(path, {
          alterer: (x) => {
            const lien = join(x.iso.racine, "agent-lien");
            symlinkSync(join(h, ".pi", "agent"), lien);
            return { ...x, env: { ...x.env, PI_CODING_AGENT_DIR: lien } };
          },
        });
      },
    },
    {
      id: "M6.12", regle: "M6.12", moment: "avant",
      preparer: (path, tmp) => {
        const h = fauxHome(tmp);
        // Chemin plus long que PATH_MAX : l'inventaire ne peut pas le lire, quel que soit l'utilisateur.
        const ici = process.cwd();
        process.chdir(join(h, ".pi"));
        for (let i = 0; i < 30; i++) {
          const n = "d".repeat(200);
          mkdirSync(n);
          process.chdir(n);
        }
        writeFileSync("f", "x");
        process.chdir(ici);
        return base(path);
      },
    },
    {
      id: "M6.13", regle: "M6.13", moment: "apres",
      preparer: (path, tmp) => {
        const h = fauxHome(tmp, { "agent/settings.json": "{}\n", "f": "avant\n" });
        return base(path, { scenario: { ...NOMINAL, epreuves: ["ecrire-pi-reel"], cible: join(h, ".pi", "f") } });
      },
    },
    ...stimuliItem1(base),
    ...stimuliN5(base),
  ];
  return s;
}

/** Les 38 épreuves historiques d'etape0-r3 (falsifier.sh sans argument), sans les épreuves de l'item 1. */
export const ITEM1_REFUS = (id: string) => /^(M6\.14\/|M6\.15\/|G-I1-base\/)/.test(id);

/** Épreuves d'intégration de G-N5 (plan N5 corrigé, § 5.2), hors du 38/38 historique et hors de l'item 1. */
export const ITEM_N5_REFUS = (id: string) => /^G-N5\//.test(id);

/**
 * Épreuves de l'item 1 : M6.14 par classe (K1), M6.15 par motif (K7), G-I1-base. Elles ne sont pas
 * comptées dans le 38/38 historique.
 */
function stimuliItem1(base: (path: string, extra?: Partial<Options>) => Options): Stimulus[] {
  const env = (ajout: Record<string, string>, retrait: string[] = []) => (x: { env: Record<string, string>; argv: string[]; cwd: string }) => {
    const e = { ...x.env, ...ajout };
    for (const v of retrait) delete e[v];
    return { ...x, env: e };
  };
  const factice = (chemin: string, node: string) => executable(chemin, `#!${node}\nprocess.exit(0);\n`);
  const nodeDe = (path: string) => candidats("node", path)[0].reel;
  const OUTIL_C: Simulateur = { nom: "outil-c", source: "process.exit(0);\n" };
  const lancer = (lancement: Scenario["lancement"], simulateurs: Simulateur[] = [OUTIL_C]): Scenario => ({ ...NOMINAL, nom: "lancer", epreuves: ["lancer"], lancement, simulateurs });
  /** Clone du dépôt (avec ses fichiers non suivis du périmètre) où la garde de base est éprouvée. */
  const clone = (tmp: string, alterer: (d: string) => void): string => {
    // N5 : la source est le dépôt explicitement choisi ; aucune variable d'environnement ne la remplace.
    const source = depotExplicite();
    const d = join(tmp, "depot");
    execFileSync("git", ["clone", "-q", source, d], { stdio: "ignore", env: { PATH: process.env.PATH ?? "", HOME: tmp } });
    for (const f of ["bin/pi-contrats", ...readdirSync(ICI).map((x) => `tests/pi-contrats/${x}`)]) cpSync(join(RACINE_INSTRUMENT, f), join(d, f));
    alterer(d);
    return d;
  };
  return [
    // Déclaration d'une variable hors des complémentaires admissibles, portant la valeur de base
    // (PI_OFFLINE=1) : seule la garde de déclaration non admissible la refuse.
    { id: "M6.14/non-admissible", regle: "M6.14/non-admissible", moment: "avant", preparer: (path) => base(path, { scenario: { ...NOMINAL, envDeclare: { PI_OFFLINE: "1" } } }) },
    { id: "M6.14/non-declaree/role", regle: "M6.14/non-declaree", moment: "avant", preparer: (path) => base(path, { alterer: env({ PI_SUBAGENT_ROLE: "scout" }) }) },
    { id: "M6.14/absente/role", regle: "M6.14/absente", moment: "avant", preparer: (path) => base(path, { scenario: C2_12_S, alterer: env({}, ["PI_SUBAGENT_ROLE"]) }) },
    { id: "M6.14/valeur/role", regle: "M6.14/valeur", moment: "avant", preparer: (path) => base(path, { scenario: C2_12_S, alterer: env({ PI_SUBAGENT_ROLE: "worker" }) }) },
    { id: "M6.14/non-declaree/scope", regle: "M6.14/non-declaree", moment: "avant", preparer: (path) => base(path, { scenario: C2_12_S, alterer: env({ PI_SUBAGENT_WRITE_SCOPE: SCOPE_C2_11 }) }) },
    { id: "M6.14/absente/scope", regle: "M6.14/absente", moment: "avant", preparer: (path) => base(path, { scenario: C2_11_S, alterer: env({}, ["PI_SUBAGENT_WRITE_SCOPE"]) }) },
    // Chaîne JSON sémantiquement équivalente, aux octets différents.
    { id: "M6.14/valeur/scope", regle: "M6.14/valeur", moment: "avant", preparer: (path) => base(path, { scenario: C2_11_S, alterer: env({ PI_SUBAGENT_WRITE_SCOPE: JSON.stringify(JSON.parse(SCOPE_C2_11), null, 1) }) }) },
    {
      id: "M6.15/non-declare", regle: "M6.15/non-declare", moment: "apres",
      preparer: (path) => base(path, { scenario: lancer({ commande: "outil-non-declare" }), alterer: (x) => { factice(join(x.iso.chemins.bin, "outil-non-declare"), nodeDe(path)); return x; } }),
    },
    {
      id: "M6.15/hors-cible", regle: "M6.15/hors-cible", moment: "apres",
      preparer: (path) => base(path, { scenario: lancer({ commande: "outil-c", prefixePath: "<TMP>/ailleurs" }), alterer: (x) => { factice(join(x.iso.chemins.tmp, "ailleurs", "outil-c"), nodeDe(path)); return x; } }),
    },
    { id: "M6.15/octets", regle: "M6.15/octets", moment: "apres", preparer: (path) => base(path, { scenario: lancer({ commande: "outil-c", modifier: "<BIN>/outil-c" }) }) },
    // B6 : simulateur factice désigné par chemin absolu dans le bin temporaire, lancé par un shell.
    { id: "M6.15/non-etablie", regle: "M6.15/non-etablie", moment: "apres", preparer: (path) => base(path, { scenario: lancer({ commande: "<BIN>/outil-c", shell: true }) }) },
    // B6 : capture variante déclarée, qui omet uniquement le champ resolution d'un lancement autrement conforme.
    { id: "M6.15/non-consignee", regle: "M6.15/non-consignee", moment: "apres", preparer: (path) => base(path, { scenario: { ...lancer({ commande: "outil-c" }), omettreResolution: "outil-c" } }) },
    { id: "G-I1-base/perimetre", regle: "G-I1-base/perimetre", moment: "avant", preparer: (path, tmp) => base(path, { verifierBaseDe: clone(tmp, (d) => writeFileSync(join(d, "hors-perimetre.txt"), "x\n")) }) },
    { id: "G-I1-base/suivis", regle: "G-I1-base/suivis", moment: "avant", preparer: (path, tmp) => base(path, { verifierBaseDe: clone(tmp, (d) => writeFileSync(join(d, "README.md"), readFileSync(join(d, "README.md"), "utf8") + "\nmodifié\n")) }) },
    {
      id: "G-I1-base/base", regle: "G-I1-base/base", moment: "avant",
      preparer: (path, tmp) => base(path, { verifierBaseDe: clone(tmp, (d) => execFileSync("git", ["-c", "user.name=PI Contrats", "-c", "user.email=pi-contrats@example.invalid", "commit", "-q", "--allow-empty", "-m", "autre base"], { cwd: d, stdio: "ignore", env: { PATH: process.env.PATH ?? "", HOME: tmp } })) }),
    },
    { id: "G-I1-base/releve", regle: "G-I1-base/releve", moment: "avant", preparer: (path, tmp) => base(path, { verifierBaseDe: clone(tmp, (d) => rmSync(join(d, ".git"), { recursive: true })) }) },
  ];
}

/** Présentation de N6 : « comparaison non établie » dès qu'un inventaire manque. */
export function texteN6(n6: Tentative["n6"]): string {
  if (!n6.etablie) {
    return `N6 : ${n6.racine} — comparaison non établie (inventaire ${n6.avant ? "après" : "avant"} impossible ou incomplet)`;
  }
  return `N6 : ${n6.racine} ${n6.avant!.etat} → ${n6.apres!.etat} ; différences : ${n6.differences.length ? n6.differences.join(" ; ") : "aucune"}`;
}

/** Résultat structuré d'une épreuve de refus : `falsifier.sh` ne décide que sur lui. */
export type ResultatRefus = {
  id: string;
  regle: string;
  moment: "avant" | "apres" | "lecteur";
  lancementTente: boolean;
  refus: { id: string; classe: string; message: string } | null;
  erreur: { message: string; apresLancement: boolean } | null;
  rc: number | null;
  constats: Constat[];
  n6: { etablie: boolean; differences: string[] };
};

/** Une épreuve de refus : la garde visée refuse, au moment prévu. */
export function eprouverRefus(st: Stimulus, path: string): { conforme: boolean; lignes: string[]; resultat: ResultatRefus } {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pi-contrats-stimulus-")));
  const homeAvant = process.env.HOME;
  const lignes: string[] = [];
  let t: Tentative;
  try {
    if (st.moment === "lecteur") {
      // Épreuve du seul lecteur d'identité : aucun lancement ; N6 est tout de même inventorié avant et après.
      const piReel = capturerPiReel();
      t = { lancee: false, refus: null, erreur: null, n6: { racine: piReel, avant: null, apres: null, differences: [], etablie: false }, constats: [] };
      t.n6.avant = inventaire(piReel);
      const { chemin, version } = st.lecteur!(tmp);
      try {
        lireIdentite(chemin, version);
      } catch (e) {
        if (e instanceof Refus || e instanceof Indetermine) t.refus = e;
        else t.erreur = e as Error;
      }
      t.n6.apres = inventaire(piReel);
      t.n6.differences = differences(t.n6.avant, t.n6.apres);
      t.n6.etablie = true;
    } else t = tenter(st.preparer!(path, tmp));
  } catch (e) {
    // Stimulus non constituable : aucune tentative.
    t = { lancee: false, refus: null, erreur: e as Error, n6: { racine: "", avant: null, apres: null, differences: [], etablie: false }, constats: [] };
  } finally {
    process.env.HOME = homeAvant;
  }
  const resultat: ResultatRefus = {
    id: st.id,
    regle: st.regle,
    moment: st.moment,
    lancementTente: t.lancee,
    refus: t.refus ? { id: t.refus.id, classe: t.refus.constructor.name, message: t.refus.message } : null,
    erreur: t.erreur ? { message: t.erreur.message, apresLancement: !!t.erreurApresLancement } : null,
    rc: t.rc ?? null,
    constats: t.constats,
    n6: { etablie: t.n6.etablie, differences: t.n6.differences },
  };
  const conforme =
    st.moment === "avant" || st.moment === "lecteur"
      ? !t.lancee && resultat.refus?.id === st.regle
      : t.lancee && !resultat.refus && t.constats.some((c) => c.id === st.regle);
  lignes.push(`refus avant lancement : ${resultat.refus ? `${resultat.refus.classe} ${resultat.refus.message}` : "aucun"}`);
  if (resultat.erreur) lignes.push(`erreur${resultat.erreur.apresLancement ? " après lancement" : ""} : ${resultat.erreur.message}`);
  lignes.push(`lancement tenté : ${t.lancee}${t.lancee ? ` ; sortie ${t.rc}` : ""}`);
  lignes.push(`constats d'exécution : ${t.constats.map((x) => `${x.etat} ${x.id}`).join(", ") || "aucun"}`);
  for (const x of t.constats.filter((c) => c.id === st.regle || c.id === "M6.13")) lignes.push(`  ${x.etat} ${x.id} : ${x.detail.slice(0, 200)}`);
  lignes.push(texteN6(t.n6));
  return { conforme, lignes, resultat };
}

// ── Étape 0 ───────────────────────────────────────────────────────────────────

function compterFormes(evs: EvenementJiti[]): string {
  const c: Record<string, number> = {};
  for (const e of evs) c[e.forme] = (c[e.forme] ?? 0) + 1;
  return Object.entries(c).map(([k, n]) => `${k}=${n}`).join(" ") || "aucun";
}

function resumeTentative(nom: string, t: Tentative, lignes: string[]): void {
  lignes.push(`── ${nom}`);
  if (t.refus || t.erreur) lignes.push(`  ARRÊT : ${t.refus ? t.refus.message : t.erreur!.stack}`);
  if (t.lancee) lignes.push(`  sortie ${t.rc}${t.signal ? `, signal ${t.signal}` : ""} ; stdout ${t.stdout?.split("\n").filter(Boolean).length ?? 0} ligne(s) ; stderr ${t.stderr?.split("\n").filter(Boolean).length ?? 0} ligne(s)`);
  lignes.push(`  ${texteN6(t.n6)}`);
  if (t.iso) lignes.push(`  captures : ${t.iso.chemins.obs}`);
  const c = t.captures;
  if (c) {
    const rel = (f: string) => (t.iso && f.startsWith(t.iso.chemins.candidat) ? `<candidat>${f.slice(t.iso.chemins.candidat.length)}` : f.startsWith(ICI) ? `tests/pi-contrats${f.slice(ICI.length)}` : f);
    lignes.push(`  voie Node : ${c.node.evenements} événements, fils ${c.node.fils.join(",")}, ${c.node.resolutions} résolutions, ${c.node.chargements} chargements dont ${c.node.verifies} fichiers de l'installation vérifiés au manifeste ; hors installation : ${c.node.horsInstallation.length}`);
    lignes.push(`  voie Node, résolutions en échec : ${c.node.echecs.map((e) => `${e.spec} (${e.code})`).join(", ") || "aucune"}`);
    lignes.push(`  voie Node, résolutions rattachées aux évaluations du fichier et de son parent par jiti (sans chargement par Node) : ${c.node.deleguees.length} ${c.node.deleguees.length ? `(${c.node.deleguees.map((u) => rel(cheminFichier(u) ?? u)).join(", ")})` : ""}`.trimEnd());
    lignes.push(`  voie jiti : ${c.jiti.evenements.length} événements attribués au jiti contrôlé (${compterFormes(c.jiti.evenements)}) ; ${c.jiti.stderrJiti} ligne(s) [jiti] sur stderr ; console.log applicatifs : ${c.jiti.application}`);
    lignes.push(`  voie jiti, évalués : ${c.jiti.transpiles.map(rel).join(", ") || "aucun"}`);
    lignes.push(`  voie jiti, virtuels : ${c.jiti.virtuels.join(", ") || "aucun"} ; natifs délégués à Node : ${c.jiti.natifs.join(", ") || "aucun"}`);
    lignes.push(`  voies aveugles : lectures .wasm/.node ${c.aveugles.lectures.length}, dlopen ${c.aveugles.dlopen.length}, workers ${c.aveugles.workers.length}, processus fils ${c.aveugles.fils.length}, imports data: ${c.aveugles.data.length}`);
    for (const l of c.aveugles.lectures) lignes.push(`    lecture ${l.chemin.startsWith(t.pi!.racine) ? `<pi>${l.chemin.slice(t.pi!.racine.length)}` : l.chemin} (fil ${l.th})`);
    for (const w of c.aveugles.workers) lignes.push(`    worker ${w.url.replace(`file://${t.pi!.racine}`, "<pi>")}`);
    for (const f of c.aveugles.fils) lignes.push(`    fils ${f.api} ${f.commande} ${JSON.stringify(f.args)}`);
  }
  lignes.push(`  constats : ${t.constats.length ? "" : "aucun"}`);
  for (const x of t.constats) lignes.push(`    ${x.etat} ${x.id} : ${x.detail.slice(0, 220)}`);
}

export function etape0(path: string): { conforme: boolean; lignes: string[] } {
  const L: string[] = [];
  const ecarts: string[] = [];
  const exiger = (ok: boolean, quoi: string) => {
    if (!ok) ecarts.push(quoi);
  };
  L.push(`ÉTAPE 0 — LOT-PI-ADAPT · ${new Date().toISOString()}`);
  L.push(`dépôt ${depotExplicite()} ; instrument ${RACINE_INSTRUMENT}`);
  const idChemin = join(ICI, `identite-${VERSION_QUALIFIEE}.json`);
  L.push(`identité ${relative(RACINE_INSTRUMENT, idChemin)} sha256 ${sha256(readFileSync(idChemin))} ; générateur sha256 ${sha256(readFileSync(join(ICI, "generer-identite.ts")))}`);

  // 1. Nominal ; l'erreur du fournisseur est exécutée d'emblée pour servir aux contre-épreuves (a).
  const nominal = tenter({ pathOperateur: path, scenario: NOMINAL });
  const erreur = tenter({ pathOperateur: path, scenario: ERREUR_FOURNISSEUR });
  const erreurFlux = erreur.captures?.flux ?? null;
  if (nominal.pi && nominal.node && nominal.identite) {
    L.push("", "IDENTITÉ");
    L.push(`  pi : ${nominal.pi.chemin} → ${nominal.pi.reel}`);
    L.push(`  racine du paquet : ${nominal.pi.racine}`);
    L.push(`  node : ${nominal.node.chemin} → ${nominal.node.reel} ; ${nominal.node.version} ; module.registerHooks ${nominal.node.registerHooks ? "présent" : "absent"}`);
    const r = nominal.identite;
    const n = (e: string) => Object.values(r.etats).filter((x) => x === e).length;
    L.push(`  installation : ${r.paquets} paquets vérifiés (${n("conforme")} conformes, ${n("transforme-installation")} transformé par script d'installation) ; ${r.exclus.length} optionnels absents, exclus par plateforme ; ${r.fichiers} fichiers examinés`);
    for (const x of r.transformations) L.push(`  transformation déclarée : ${x}`);
  }
  if (nominal.iso) {
    L.push("", "ISOLEMENT");
    L.push(`  temporaire : ${nominal.iso.racine}`);
    L.push(`  environnement de l'enfant (depuis vide) : ${Object.keys(nominal.iso.env).join(" ")}`);
    L.push(`  argv : ${(nominal.argv ?? []).map((a) => a.replace(depotExplicite(), "<dépôt>").replace(nominal.pi!.racine, "<pi>")).join(" ")}`);
  }
  L.push("", "EXÉCUTIONS");
  resumeTentative("nominal (ls puis texte)", nominal, L);
  const v3 = nominal.captures ? verifierC3(nominal.captures.sonde) : null;
  const v7 = nominal.captures && nominal.iso ? verifierC7(nominal.captures.flux, NOMINAL, nominal.iso.chemins.cwd, nominal.rc ?? null) : [];
  for (const v of [v3, ...v7].filter(Boolean) as Verdict[]) L.push(`  ${v.clause} ${v.etat} (compte ${v.compte}) : ${v.detail}`);
  exiger(!!v3 && v3.etat === "satisfait", "C3.1 nominal");
  exiger(v7.length === 7 && v7.every((v) => v.etat === "satisfait"), "C7 nominal");
  exiger(nominal.rc === 0 && nominal.constats.length === 0 && !nominal.refus && !nominal.erreur, "nominal sans constat, sortie 0");

  // Contre-épreuves (a) des vérificateurs : l'observation réelle, altérée précisément, doit donner « violé ».
  if (nominal.captures && nominal.iso) {
    const cwd = nominal.iso.chemins.cwd;
    const flux = nominal.captures.flux;
    const clone = (x: any) => JSON.parse(JSON.stringify(x));
    const viole = (clause: string, v: Verdict | undefined) => {
      const ok = v?.etat === "violé";
      L.push(`  contre-épreuve (a) ${clause} : ${ok ? "violé, comme attendu" : `ÉCHEC (${v?.etat ?? "aucun verdict"})`}`);
      exiger(ok, `contre-épreuve ${clause}`);
    };
    const c7 = (f: any[], clause: string, sc: Scenario = NOMINAL, rc: number | null = 0) => verifierC7(f, sc, cwd, rc).find((v) => v.clause === clause);
    {
      const so = clone(nominal.captures.sonde);
      so.find((o: any) => o.t === "session_start").outils.find((o: any) => o.nom === "read").chemin = "builtin:read";
      viole("C3.1 (chemin builtin:read)", verifierC3(so));
    }
    { const f = clone(flux); f[0].cwd = "/ailleurs"; viole("C7.1 (cwd)", c7(f, "C7.1")); }
    { const f = clone(flux); f.find((e: any) => e.type === "message_end" && e.message?.role === "assistant").message.usage.input = 99; viole("C7.2 (usage.input)", c7(f, "C7.2")); }
    { const f = clone(flux); f.find((e: any) => e.type === "message_end" && e.message?.role === "assistant").message.usage.reasoning = 3; viole("C7.2 (usage.reasoning présent et différent)", c7(f, "C7.2")); }
    { const f = clone(flux); f.push({ type: "message" }); viole("C7.3 (un événement message)", c7(f, "C7.3")); }
    { const f = clone(flux); f.find((e: any) => e.type === "tool_execution_start").args = { path: ".." }; viole("C7.4 (args)", c7(f, "C7.4")); }
    { const f = clone(flux); f.find((e: any) => e.type === "tool_execution_end").isError = true; viole("C7.5 (isError)", c7(f, "C7.5")); }
    { const f = clone(flux).filter((e: any, i: number, a: any[]) => !(e.type === "turn_end" && a.findIndex((x: any) => x.type === "turn_end") === i)); viole("C7.6 (un turn_end retiré)", c7(f, "C7.6")); }
    { const f = clone(flux); f.push({ type: "agent_end" }); viole("C7.8 (un agent_end en plus)", c7(f, "C7.8")); }
    { const f = clone(flux); f.push({ type: "type_inconnu" }); viole("C7.8 (un type non attendu)", c7(f, "C7.8")); }
    {
      const so = clone(nominal.captures.sonde);
      const ss = so.find((o: any) => o.t === "session_start");
      ss.outils.push({ ...ss.outils.find((o: any) => o.nom === "read") });
      viole("C3.1 (entrée read dupliquée)", verifierC3(so));
    }
    if (erreurFlux) {
      const f = clone(erreurFlux);
      f.find((e: any) => e.type === "message_end" && e.message?.role === "assistant").message.errorMessage = "autre";
      viole("C7.7 (errorMessage)", c7(f, "C7.7", ERREUR_FOURNISSEUR, 0));
      viole("C7.7 (sortie 1)", c7(clone(erreurFlux), "C7.7", ERREUR_FOURNISSEUR, 1));
    }
  }

  // 2. Erreur du fournisseur.
  resumeTentative("erreur du fournisseur", erreur, L);
  if (erreur.captures) {
    const obs: Record<string, number> = {};
    for (const e of erreur.captures.flux) obs[e.type] = (obs[e.type] ?? 0) + 1;
    L.push(`  comptes observés dans la capture : ${Object.entries(obs).map(([k, n]) => `${k}=${n}`).join(" ")}`);
    L.push(`  table déclarée (scenarios.ts)    : ${Object.entries(ERREUR_FOURNISSEUR.comptes!).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  }
  const ve = erreur.captures && erreur.iso ? verifierC7(erreur.captures.flux, ERREUR_FOURNISSEUR, erreur.iso.chemins.cwd, erreur.rc ?? null) : [];
  for (const v of ve) L.push(`  ${v.clause} ${v.etat} (compte ${v.compte}) : ${v.detail}`);
  exiger(ve.length === 8 && ve.every((v) => v.etat === "satisfait"), "C7 erreur du fournisseur");
  exiger(erreur.constats.length === 0, "erreur du fournisseur sans constat");

  // 3. Image : témoin réel du worker et du WASM de photon.
  const image = tenter({ pathOperateur: path, scenario: IMAGE });
  resumeTentative("image (read d'un PNG : worker de redimensionnement, WASM de photon)", image, L);
  const vi = image.captures && image.iso ? verifierC7(image.captures.flux, IMAGE, image.iso.chemins.cwd, image.rc ?? null) : [];
  for (const v of vi) L.push(`  ${v.clause} ${v.etat} (compte ${v.compte}) : ${v.detail}`);
  const ia = image.captures?.aveugles;
  exiger(!!ia && ia.workers.length > 0, "image : worker observé");
  exiger(!!ia && ia.lectures.some((l) => l.chemin.endsWith("photon_rs_bg.wasm")), "image : lecture du WASM de photon observée");
  exiger(image.constats.length === 0, "image sans constat");
  if (image.captures) {
    const fils = image.captures.node.fils;
    L.push(`  fils tracés : ${fils.join(", ")} ; chacun avec un début, une attestation et une fin propre en dernier (aucun constat trace-fil)`);
  }

  // Contre-épreuves des captures (sur la capture réelle de l'exécution image, qui a des Workers).
  if (image.brutes && image.contexte) {
    const reanalyser = (alterer: (b: Brutes) => Brutes) => analyserCaptures(alterer({ ...image.brutes! }), image.contexte!).constats;
    const attendre = (quoi: string, id: string, cs: Constat[]) => {
      const ok = cs.some((c) => c.id === id && c.etat === "INDETERMINE");
      L.push(`  contre-épreuve ${quoi} : ${ok ? `indéterminé (${id}), comme attendu` : `ÉCHEC (${cs.map((c) => c.id).join(", ") || "aucun constat"})`}`);
      exiger(ok, `contre-épreuve ${quoi}`);
    };
    const illisible = "{ligne tronquée";
    attendre("ligne illisible dans stdout", "capture-illisible", reanalyser((b) => ({ ...b, stdout: b.stdout + illisible + "\n" })));
    attendre("ligne illisible dans la trace", "capture-illisible", reanalyser((b) => ({ ...b, trace: b.trace + illisible + "\n" })));
    attendre("ligne illisible dans la sonde", "capture-illisible", reanalyser((b) => ({ ...b, sonde: b.sonde + illisible + "\n" })));
    attendre("ligne illisible dans le journal du fournisseur", "capture-illisible", reanalyser((b) => ({ ...b, fournisseur: b.fournisseur + illisible + "\n" })));
    const lignes = image.brutes.trace.split("\n").filter(Boolean);
    const finWorker = lignes.findIndex((l) => {
      const e = JSON.parse(l);
      return e.th !== 0 && e.t === "fin";
    });
    if (finWorker < 0) {
      L.push("  contre-épreuve fin propre d'un Worker retirée : ÉCHEC (aucune fin de Worker dans la capture)");
      exiger(false, "contre-épreuve fin de Worker");
    } else {
      const th = JSON.parse(lignes[finWorker]).th;
      const garde = lignes.some((l) => {
        const e = JSON.parse(l);
        return e.t === "worker-fin" && e.worker === th;
      });
      L.push(`  (fil ${th} : worker-fin du parent ${garde ? "conservé" : "absent"} dans la capture altérée)`);
      attendre("fin propre d'un Worker retirée, worker-fin du parent conservé", "trace-fil", reanalyser((b) => ({ ...b, trace: lignes.filter((_, i) => i !== finWorker).join("\n") + "\n" })));
    }
    const dernier = lignes.map((l) => JSON.parse(l)).filter((e) => e.th === 0).pop();
    attendre(
      "événement ajouté après la fin du fil principal",
      "trace-fil",
      reanalyser((b) => ({ ...b, trace: b.trace + JSON.stringify({ th: 0, seq: dernier.seq + 1, t: "resolve", spec: "node:fs", parent: null, url: "node:fs" }) + "\n" })),
    );
  }

  // 3 bis. Redéfinition réelle de read (C3.2).
  const redef = tenter({ pathOperateur: path, scenario: REDEFINITION_READ });
  resumeTentative("redéfinition de read par une extension (C3.2)", redef, L);
  const v32 = redef.captures ? verifierC3_2(redef.captures.sonde) : null;
  if (v32) L.push(`  ${v32.clause} ${v32.etat} (compte ${v32.compte}) : ${v32.detail}`);
  exiger(!!v32 && v32.etat === "satisfait", "C3.2");
  exiger(redef.constats.length === 0 && redef.rc === 0, "redéfinition de read sans constat, sortie 0");
  if (redef.captures) {
    const so = JSON.parse(JSON.stringify(redef.captures.sonde));
    const r = so.find((o: any) => o.t === "session_start").outils.find((o: any) => o.nom === "read");
    r.source = "builtin";
    r.chemin = "<builtin:read>";
    const v = verifierC3_2(so);
    L.push(`  contre-épreuve (a) C3.2 (provenance remplacée par builtin) : ${v.etat === "violé" ? "violé, comme attendu" : `ÉCHEC (${v.etat})`}`);
    exiger(v.etat === "violé", "contre-épreuve C3.2");
  }

  // 3 ter. Résultat réel d'un outil submit de test aux details explicites (C7.5).
  const submit = tenter({ pathOperateur: path, scenario: SUBMIT });
  resumeTentative("submit de test aux details explicites (C7.5)", submit, L);
  const vs = submit.captures && submit.iso ? verifierC7(submit.captures.flux, SUBMIT, submit.iso.chemins.cwd, submit.rc ?? null) : [];
  for (const v of vs) L.push(`  ${v.clause} ${v.etat} (compte ${v.compte}) : ${v.detail}`);
  exiger(vs.length === 7 && vs.every((v) => v.etat === "satisfait"), "C7 submit");
  exiger(submit.constats.length === 0 && submit.rc === 0, "submit sans constat, sortie 0");
  if (submit.captures && submit.iso) {
    const cwd = submit.iso.chemins.cwd;
    const base = submit.captures.flux;
    const clone = (x: any) => JSON.parse(JSON.stringify(x));
    const fin = (f: any[]) => f.find((e: any) => e.type === "tool_execution_end");
    const c75 = (quoi: string, f: any[]) => {
      const v = verifierC7(f, SUBMIT, cwd, 0).find((x) => x.clause === "C7.5");
      L.push(`  contre-épreuve (a) C7.5 (${quoi}) : ${v?.etat === "violé" ? "violé, comme attendu" : `ÉCHEC (${v?.etat})`}`);
      exiger(v?.etat === "violé", `contre-épreuve C7.5 ${quoi}`);
    };
    c75("résultat manquant", clone(base).filter((e: any) => e.type !== "tool_execution_end"));
    { const f = clone(base); f.push({ ...clone(fin(base)), toolCallId: "autre" }); c75("résultat supplémentaire", f); }
    { const f = clone(base); f.push(clone(fin(base))); c75("résultat dupliqué", f); }
    { const f = clone(base); fin(f).toolCallId = "autre"; c75("autre identifiant", f); }
    { const f = clone(base); fin(f).result.content[0].text = 42; c75("text non string", f); }
    { const f = clone(base); delete fin(f).result.details; c75("details absents", f); }
    { const f = clone(base); fin(f).result.details = "inexploitable"; c75("details inexploitables", f); }
    { const f = clone(base); fin(f).result.details.valeur = 43; c75("details modifiés", f); }
  }

  // 4. Témoins : chaque instrument des voies aveugles voit son stimulus.
  const temoins = tenter({
    pathOperateur: path,
    scenario: TEMOINS,
    alterer: (x) => {
      const faux = join(x.iso.chemins.tmp, "faux.node");
      const wasm = join(x.iso.chemins.tmp, "faux.wasm");
      const fichierWorker = join(x.iso.chemins.tmp, "worker.mjs");
      writeFileSync(fichierWorker, "export {};\n");
      const fichierWorkerVivant = join(x.iso.chemins.tmp, "worker-vivant.mjs");
      writeFileSync(fichierWorkerVivant, "setInterval(() => {}, 1000);\n");
      writeFileSync(faux, "pas un addon\n");
      writeFileSync(wasm, "pas du wasm\n");
      writeFileSync(x.iso.env.PI_CONTRATS_SCENARIO, JSON.stringify({ ...TEMOINS, fauxNode: faux, fauxWasm: wasm, outilFils: "git", fichierWorker, fichierWorkerVivant }));
      return x;
    },
  });
  resumeTentative("témoins des voies aveugles (épreuve « temoins »)", temoins, L);
  const ta = temoins.captures?.aveugles;
  const temoin = (ok: boolean, quoi: string) => {
    L.push(`  témoin ${quoi} : ${ok ? "observé" : "NON OBSERVÉ"}`);
    exiger(ok, `témoin ${quoi}`);
  };
  temoin(!!ta && ta.dlopen.some((d) => d.chemin.endsWith("faux.node")), "process.dlopen d'un .node");
  temoin(!!ta && ta.lectures.some((l) => l.chemin.endsWith("faux.wasm")), "fs.readFileSync d'un .wasm");
  const crees = (temoins.captures?.aveugles.workers ?? []).length;
  const tracesWorkers = (temoins.captures?.node.fils ?? []).filter((f) => f !== 0).length;
  temoin(crees === 3 && tracesWorkers === 2, "Workers de fichier, avec trace propre de leur fil");
  const traceTemoins = temoins.brutes?.trace ?? "";
  const tt = traceTemoins ? temoinTerminate(traceTemoins) : { ok: false, detail: "aucune trace" };
  L.push(`  témoin de terminate() : ${tt.detail}`);
  temoin(tt.ok && !temoins.constats.some((c) => c.id === "trace-fil"), "Worker vivant arrêté par terminate(), fin propre écrite sur demande");
  if (traceTemoins) {
    const lignes = traceTemoins.split("\n").filter(Boolean);
    const evs = lignes.map((l) => JSON.parse(l));
    const idDe = (suffixe: string) => evs.find((e) => e.t === "worker-cree" && String(e.url ?? "").endsWith(suffixe))?.worker;
    const vivant = idDe("worker-vivant.mjs");
    const naturel = idDe("/worker.mjs");
    // Échange des seules raisons de fin entre les deux Workers tracés.
    const echange = lignes
      .map((l) => {
        const e = JSON.parse(l);
        if (e.t === "fin" && e.th === vivant) e.raison = evs.find((x) => x.t === "fin" && x.th === naturel)?.raison;
        else if (e.t === "fin" && e.th === naturel) e.raison = evs.find((x) => x.t === "fin" && x.th === vivant)?.raison;
        return JSON.stringify(e);
      })
      .join("\n") + "\n";
    // Retrait du worker-fin correspondant dans le parent.
    const sansWorkerFin = lignes.filter((l) => { const e = JSON.parse(l); return !(e.t === "worker-fin" && e.worker === vivant); }).join("\n") + "\n";
    const refuse = (quoi: string, r: { ok: boolean; detail: string }, attendu: boolean) => {
      const ok = r.ok === attendu;
      L.push(`  contre-épreuve témoin terminate (${quoi}) : ${r.ok ? "accepté" : "refusé"} — ${r.detail} ; ${ok ? "comme attendu" : "ÉCHEC"}`);
      exiger(ok, `contre-épreuve témoin terminate ${quoi}`);
    };
    L.push(`  (Workers tracés : naturel fil ${naturel}, vivant fil ${vivant})`);
    refuse("échange des raisons de fin", temoinTerminate(echange), false);
    refuse("worker-fin correspondant retiré", temoinTerminate(sansWorkerFin), false);
    // Mutant : le comptage global accepte l'échange ; l'épreuve d'échange doit alors rougir.
    const mutant = temoinTerminateComptageGlobal(echange);
    const rougit = mutant.ok === true;
    L.push(`  mutant du témoin (comptage global) sur l'échange : ${mutant.ok ? "accepté" : "refusé"} — ${mutant.detail} ; l'épreuve d'échange ${rougit ? "rougit, comme attendu" : "NE ROUGIT PAS"}`);
    exiger(rougit, "mutant du témoin terminate : l'épreuve d'échange rougit");
  }
  temoin(temoins.constats.some((c) => c.id === "aveugle-worker" && /sans trace propre/.test(c.detail)), "Worker eval, signalé comme fil non couvert");
  temoin(!!ta && ta.fils.some((f) => f.commande === "git"), "processus fils");
  temoin(!!ta && ta.data.length > 0, "import data: (repli ESM de jiti)");
  // Les constats du témoin sont exactement ceux que ses stimuli provoquent.
  const attendus = new Set(["aveugle-worker", "trace-node-hors", "aveugle-lecture", "aveugle-dlopen", "aveugle-esm"]);
  const inattendus = temoins.constats.filter((c) => !attendus.has(c.id));
  L.push(`  constats du témoin hors de ceux attendus : ${inattendus.map((c) => c.id).join(", ") || "aucun"}`);
  exiger(inattendus.length === 0 && [...attendus].every((id) => temoins.constats.some((c) => c.id === id)), "témoins : constats exactement attendus");

  // 5. Extension cassée.
  let cassee = "";
  const casse = tenter({
    pathOperateur: path,
    scenario: NOMINAL,
    alterer: (x) => {
      cassee = join(x.iso.chemins.candidat, "extension-cassee.ts");
      writeFileSync(cassee, "export default function (pi: any) { pi.on( ;\n");
      const i = x.argv.indexOf("--tools");
      return { ...x, argv: [...x.argv.slice(0, i), "-e", cassee, ...x.argv.slice(i)] };
    },
  });
  resumeTentative("extension cassée (erreur de syntaxe)", casse, L);
  exiger(casse.constats.length === 0, "extension cassée : mesure sans constat (voie jiti comprise)");
  const diag = casse.stderr ? diagnosticChargement(casse.stderr, cassee) : false;
  L.push(`  diagnostic « Failed to load extension » pour ce chemin sur stderr : ${diag ? "présent" : "ABSENT"} ; sortie ${casse.rc}`);
  for (const l of (casse.stderr ?? "").split("\n").filter((x) => !x.startsWith("[jiti]") && x.trim())) L.push(`    stderr : ${l.slice(0, 200)}`);
  exiger(diag && casse.rc === 1, "extension cassée : diagnostic et sortie 1");
  const diagTransform = (casse.captures?.jiti.evenements ?? []).filter((e) => e.forme === "diag-transform");
  L.push(`  diagnostic de transformation jiti reconnu : ${diagTransform.length ? diagTransform.map((e) => e.texte).join(" | ") : "ABSENT"}`);
  exiger(diagTransform.length > 0, "extension cassée : diagnostic de transformation jiti présent");
  if (casse.brutes && casse.contexte) {
    const lignes = casse.brutes.trace.split("\n").filter(Boolean);
    const i = lignes.findIndex((l) => String(JSON.parse(l).texte ?? "").startsWith("[jiti] {"));
    const alterer = (quoi: string, texte: (t: string) => string) => {
      if (i < 0) {
        L.push(`  contre-épreuve diagnostic jiti (${quoi}) : ÉCHEC (aucun diagnostic dans la capture)`);
        exiger(false, `contre-épreuve diagnostic jiti ${quoi}`);
        return;
      }
      const e = JSON.parse(lignes[i]);
      e.texte = texte(e.texte);
      const trace = lignes.map((l, j) => (j === i ? JSON.stringify(e) : l)).join("\n") + "\n";
      const cs = analyserCaptures({ ...casse.brutes!, trace }, casse.contexte!).constats;
      const ok = cs.some((c) => c.id === "jiti-grammaire" && c.etat === "INDETERMINE");
      L.push(`  contre-épreuve diagnostic jiti (${quoi}) : ${ok ? "indéterminé, comme attendu" : `ÉCHEC (${cs.map((c) => c.id).join(", ") || "aucun constat"})`}`);
      exiger(ok, `contre-épreuve diagnostic jiti ${quoi}`);
    };
    alterer("code différent", (t) => t.replace('"BABEL_PARSE_ERROR"', '"AUTRE_ERREUR"'));
    alterer("objet inexploitable", () => '[jiti] {"code":"BABEL_PARSE_ERROR"}');
    alterer("JSON tronqué", (t) => t.slice(0, Math.floor(t.length / 2)));
  }

  // N6 sur toutes les tentatives.
  for (const [nom, t] of [["nominal", nominal], ["erreur", erreur], ["image", image], ["redéfinition", redef], ["submit", submit], ["témoins", temoins], ["cassée", casse]] as Array<[string, Tentative]>) {
    exiger(t.n6.etablie && t.n6.differences.length === 0, `N6 ${nom}`);
  }
  L.push("", ecarts.length ? `ÉTAPE 0 : NON CONFORME — ${ecarts.join(" ; ")}` : "ÉTAPE 0 : critères de l'instrument satisfaits (refus : voir falsifier.sh)");
  return { conforme: ecarts.length === 0, lignes: L };
}

// ── Mesures préalables (adjudication K1-K9 du 08-10-2026, § 6) ────────────────

/**
 * Une mesure préalable, exécutée une seule fois : non qualifiante, elle ne compte ni comme porte,
 * ni comme N5, ni comme campagne de mutants. Le relevé imprime le stimulus exact, les empreintes,
 * les lancements et leur résolution, les journaux du fournisseur, de la sonde et des simulateurs,
 * les sessions, N6 et le verdict de la clause. Les pièces de l'exécution sont copiées dans
 * `conserver` (hors copie du candidat, dont le manifeste est écrit à la place).
 */
export function mesurePrealable(id: string, path: string, conserver: string | null): { conforme: boolean; lignes: string[]; verdict: Verdict | null } {
  const s = MESURES_PREALABLES[id];
  const L: string[] = [];
  if (!s) return { conforme: false, lignes: [`mesure préalable inconnue : ${id}`], verdict: null };
  L.push(`MESURE PRÉALABLE ${id} — LOT-PI-ADAPT · ${new Date().toISOString()} · NON QUALIFIANTE`);
  L.push(`dépôt ${depotExplicite()} ; instrument ${RACINE_INSTRUMENT}`);
  try {
    const git = (a: string[]) => execFileSync("git", a, { cwd: depotExplicite(), encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }).trim();
    const base = git(["rev-parse", "HEAD"]);
    const arbre = git(["rev-parse", "HEAD^{tree}"]);
    const suivis = git(["status", "--porcelain", "--untracked-files=no"]);
    const nonSuivis = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
    const horsPerimetre = nonSuivis.filter((f) => f !== "bin/pi-contrats" && !f.startsWith("tests/pi-contrats/"));
    L.push(`base ${base} arbre ${arbre} ; suivis : ${suivis || "propres"} ; non suivis : ${nonSuivis.join(" | ") || "aucun"}`);
    if (base !== "b54532045e1305bd48ee93ea8fdebdcca534b847" || arbre !== "afaf99afeceff29f848e853249148095b4169ea7" || suivis || horsPerimetre.length) {
      L.push("ARRÊT — base, arbre ou périmètre de préparation non conforme ; aucun lancement de pi");
      return { conforme: false, lignes: L, verdict: null };
    }
  } catch (e) {
    L.push(`ARRÊT — base non relevée (${(e as Error).message.split("\n")[0]}) ; aucun lancement de pi`);
    return { conforme: false, lignes: L, verdict: null };
  }
  L.push(...lignesEmpreintesInstrument());
  const stimulus = JSON.stringify(s);
  L.push(`stimulus (scénario ${s.nom}) sha256 ${sha256(stimulus)} :`);
  L.push(`  ${stimulus}`);

  const t = tenter({ pathOperateur: path, scenario: s });
  if (t.pi && t.node && t.identite) {
    const r = t.identite;
    const n = (e: string) => Object.values(r.etats).filter((x) => x === e).length;
    L.push("", "IDENTITÉ");
    L.push(`  pi : ${t.pi.chemin} → ${t.pi.reel}`);
    L.push(`  node : ${t.node.chemin} → ${t.node.reel} ; ${t.node.version} ; module.registerHooks ${t.node.registerHooks ? "présent" : "absent"}`);
    L.push(`  installation : ${r.paquets} paquets vérifiés (${n("conforme")} conformes, ${n("transforme-installation")} transformé par script d'installation) ; ${r.exclus.length} optionnels absents, exclus par plateforme ; ${r.fichiers} fichiers examinés`);
  }
  if (t.iso) {
    L.push("", "ISOLEMENT");
    L.push(`  temporaire : ${t.iso.racine}`);
    L.push(`  environnement de l'enfant (depuis vide) : ${Object.keys(t.iso.env).join(" ")}${s.envDeclare ? ` ; complémentaires déclarées : ${JSON.stringify(s.envDeclare)}` : ""}`);
    L.push(`  argv : ${(t.argv ?? []).map((a) => a.replace(depotExplicite(), "<dépôt>").replace(t.iso!.chemins.candidat, "<candidat>").replace(t.pi?.racine ?? "\u0000", "<pi>")).join(" ")}`);
    L.push(`  fixtures sous PI_CODING_AGENT_DIR : ${Object.keys(s.agentDir ?? {}).map((f) => `${f} (sha256 ${sha256(s.agentDir![f])})`).join(", ") || "aucune"}`);
    for (const sim of t.simulateurs ?? []) L.push(`  simulateur ${sim.nom} : ${sim.chemin} → ${sim.reel} ; sha256 ${sim.sha256} ; interprète ${sim.interprete.chemin} (sha256 ${sim.interprete.sha256})`);
  }
  L.push("", "EXÉCUTION");
  resumeTentative(`${id} (${s.nom})`, t, L);
  const c = t.captures;
  if (c) {
    for (const f of c.aveugles.fils) L.push(`  lancement ${f.api} ${f.commande} args=${JSON.stringify(f.args)} cwd=${f.cwd} PATH=${f.path} shell=${f.shell} résolution=${JSON.stringify(f.resolution)}`);
    for (const a of c.admis) L.push(`  admis (M6.15) : ${a.nom} → ${a.reel} (${a.sha256})`);
    L.push("  fournisseur :");
    for (const a of c.fournisseur) {
      L.push(`    appel ${a.appel} forme=${a.forme ?? "—"}${a.ecart ? ` écart=${a.ecart}` : ""} systemPrompt sha256 ${a.systemPrompt === null ? "null" : sha256(a.systemPrompt)} outils=${JSON.stringify(a.outils)}`);
      for (const m of a.messages ?? []) L.push(`      ${m.role} (${String(m.texte).length} car.) ${JSON.stringify(String(m.texte).slice(0, 160))}`);
    }
    L.push("  sonde (barrières, témoins, usages) :");
    for (const o of c.sonde) {
      if (["barriere", "temoin-fournisseur", "message_end", "session_compact", "turn_end"].includes(o.t)) L.push(`    ${JSON.stringify(o)}`);
      if (o.t === "session_start") L.push(`    session_start commandes=${JSON.stringify(o.commandesDetail)}`);
    }
    for (const [nom, lignes] of Object.entries(c.simulateurs)) {
      L.push(`  journal du simulateur ${nom} : ${lignes.length} ligne(s)`);
      for (const l of lignes) L.push(`    ${JSON.stringify(l)}`);
    }
    L.push(`  sessions : ${c.sessions.length} fichier(s)`);
    for (const f of c.sessions) {
      L.push(`    ${f.fichier} : ${f.entrees.length} entrée(s)`);
      f.entrees.forEach((e, i) => {
        const quoi = e.type === "message" ? `message/${e.message?.role}${e.message?.customType ? `/${e.message.customType}` : ""}${e.message?.stopReason ? ` stop=${e.message.stopReason}` : ""}` : `${e.type}${e.customType ? `/${e.customType}` : ""}`;
        L.push(`      #${i} ${quoi} id=${e.id ?? "—"} parent=${e.parentId ?? "—"} timestamp=${e.timestamp ?? "—"}`);
        if (e.type === "compaction") L.push(`        ${JSON.stringify({ summary: e.summary, firstKeptEntryId: e.firstKeptEntryId, tokensBefore: e.tokensBefore, fromHook: e.fromHook })}`);
      });
    }
    const types: Record<string, number> = {};
    for (const e of c.flux) types[e.type] = (types[e.type] ?? 0) + 1;
    L.push(`  flux : ${Object.entries(types).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  }
  for (const l of (t.stderr ?? "").split("\n").filter((x) => !x.startsWith("[jiti]") && x.trim())) L.push(`  stderr : ${l.slice(0, 300)}`);

  let verdict: Verdict | null = null;
  if (c && t.iso) {
    const o: ObservationsMesure = {
      rc: t.rc ?? null,
      stderr: t.stderr ?? "",
      flux: c.flux,
      sonde: c.sonde,
      fournisseur: c.fournisseur,
      simulateurs: c.simulateurs,
      fils: c.aveugles.fils,
      sessions: c.sessions,
      agentDir: t.iso.chemins.agentDir,
      extension: s.extensionsDepot?.length ? join(t.iso.chemins.candidat, s.extensionsDepot[0]) : null,
    };
    verdict = id === "C2.7" ? verifierC2_7(o) : id === "C2.8" ? verifierC2_8(o) : verifierC8_2(o);
    L.push("", `VERDICT ${verdict.clause} : ${verdict.etat} (compte ${verdict.compte}) — ${verdict.detail}`);
  }

  if (conserver && t.iso) {
    mkdirSync(conserver, { recursive: true });
    writeFileSync(join(conserver, "n6.json"), JSON.stringify(t.n6, null, 2) + "\n");
    const racine = t.iso.racine;
    for (const e of readdirSync(racine)) {
      if (e === "candidat") continue;
      cpSync(join(racine, e), join(conserver, e), { recursive: true, verbatimSymlinks: true });
    }
    const manifeste: string[] = [];
    const parcourir = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
        const f = join(d, e.name);
        if (e.isDirectory()) parcourir(f);
        else if (e.isFile()) manifeste.push(`${sha256(readFileSync(f))}  ${relative(t.iso!.chemins.candidat, f)}`);
        else manifeste.push(`lien-ou-autre  ${relative(t.iso!.chemins.candidat, f)}`);
      }
    };
    parcourir(t.iso.chemins.candidat);
    writeFileSync(join(conserver, "candidat.sha256"), manifeste.sort().join("\n") + "\n");
    L.push(`pièces conservées : ${conserver} (temporaire ${racine}, copie du candidat remplacée par candidat.sha256)`);
  }

  const propre = !t.refus && !t.erreur && t.constats.length === 0 && t.n6.etablie && t.n6.differences.length === 0;
  const conforme = propre && verdict?.etat === "satisfait";
  const fin = conforme
    ? "résultat observé : satisfait"
    : `ARRÊT — mesure ${verdict ? verdict.etat : "sans verdict"}${propre ? "" : " ; tentative non propre (refus, erreur, constat ou N6)"}`;
  L.push("", `MESURE PRÉALABLE ${id} : ${fin} (non qualifiante ; soumise à Sol)`);
  return { conforme, lignes: L, verdict };
}

// ══ Item 1 : observations, campagne de qualification, contre-épreuves ═════════

/** Observations d'une tentative de l'item 1, lues une fois et conservables (observations.json). */
export function observer(t: Tentative): ObservationsMesure | null {
  const c = t.captures;
  if (!c || !t.iso) return null;
  const s = t.scenario ?? null;
  const argv = t.argv ?? [];
  return {
    rc: t.rc ?? null,
    stderr: t.stderr ?? "",
    flux: c.flux,
    sonde: c.sonde,
    fournisseur: c.fournisseur,
    simulateurs: c.simulateurs,
    fils: c.aveugles.fils,
    sessions: c.sessions,
    agentDir: t.iso.chemins.agentDir,
    extension: s?.extensionsDepot?.length ? join(t.iso.chemins.candidat, s.extensionsDepot[0]) : null,
    cwd: t.iso.chemins.cwd,
    tmp: t.iso.chemins.tmp,
    bin: t.iso.chemins.bin,
    candidat: t.iso.chemins.candidat,
    sessionsDir: t.iso.chemins.sessions,
    extensions: argv.filter((_, i) => argv[i - 1] === "-e"),
    transpiles: c.jiti.transpiles,
    constats: t.constats.map((x) => x.id),
    ...(t.releves ? { inventaireCwd: { avant: t.releves.inventaireAvant, apres: t.releves.inventaireApres ?? [] }, journal: t.releves.journal ?? null, fichiers: t.releves.fichiers ?? {} } : {}),
    ...(t.releves?.git ? { git: t.releves.git } : {}),
    poses: (t.simulateurs ?? []).map((x) => ({ nom: x.nom, chemin: x.chemin, sha256: x.sha256 })),
    constatsDetail: t.constats.map((x) => ({ id: x.id, etat: x.etat, detail: x.detail })),
    ...(t.releves ? { extensionsSha: t.releves.extensionsSha, fichiersAvant: t.releves.fichiersAvant } : {}),
    ...(t.releves?.sortiesFils ? { sortiesFils: t.releves.sortiesFils } : {}),
    ...(t.releves?.journalFixture ? { journalFixture: t.releves.journalFixture } : {}),
  };
}

/** Copie des pièces d'une tentative (hors copie du candidat, remplacée par son manifeste). */
function conserverTentative(t: Tentative, dossier: string, extra: Record<string, unknown>): void {
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, "n6.json"), JSON.stringify(t.n6, null, 2) + "\n");
  for (const [nom, v] of Object.entries(extra)) writeFileSync(join(dossier, nom), JSON.stringify(v, null, 2) + "\n");
  if (!t.iso) return;
  const racine = t.iso.racine;
  for (const e of readdirSync(racine)) {
    if (e === "candidat") continue;
    cpSync(join(racine, e), join(dossier, "pieces", e), { recursive: true, verbatimSymlinks: true });
  }
  const manifeste: string[] = [];
  const parcourir = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const f = join(d, e.name);
      if (e.isDirectory()) parcourir(f);
      else if (e.isFile()) manifeste.push(`${sha256(readFileSync(f))}  ${relative(t.iso!.chemins.candidat, f)}`);
      else manifeste.push(`lien-ou-autre  ${relative(t.iso!.chemins.candidat, f)}`);
    }
  };
  parcourir(t.iso.chemins.candidat);
  writeFileSync(join(dossier, "candidat.sha256"), manifeste.sort().join("\n") + "\n");
}

const nomDossier = (id: string) => id.replace(/[^A-Za-z0-9.-]+/g, "_");

/**
 * G-I1-base : base, arbre, suivis propres et non-suivis limités au périmètre de l'item 1, sur le
 * dépôt `depot`. Refus avant tout lancement.
 */
export function verifierBase(depot: string = depotExplicite()): string {
  appelsGardes.push("G-I1-base");
  let base: string, arbre: string, suivis: string, nonSuivis: string[];
  try {
    const git = (a: string[]) => execFileSync("git", a, { cwd: depot, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }).trim();
    base = git(["rev-parse", "HEAD"]);
    arbre = git(["rev-parse", "HEAD^{tree}"]);
    suivis = git(["status", "--porcelain", "--untracked-files=no"]);
    nonSuivis = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  } catch (e) {
    refuser("G-I1-base/releve", `base non relevée : ${(e as Error).message.split("\n")[0]}`);
    // Atteint seulement quand cette garde est désarmée par un mutant de falsifier.sh.
    return "base non relevée (garde désarmée)";
  }
  if (base! !== "b54532045e1305bd48ee93ea8fdebdcca534b847" || arbre! !== "afaf99afeceff29f848e853249148095b4169ea7") refuser("G-I1-base/base", `base ${base!} arbre ${arbre!} différents de b5453204/afaf99af`);
  if (suivis!) refuser("G-I1-base/suivis", `fichiers suivis modifiés : ${suivis!.split("\n").join(" | ")}`);
  const hors = nonSuivis!.filter((f) => f !== "bin/pi-contrats" && !f.startsWith("tests/pi-contrats/"));
  if (hors.length) refuser("G-I1-base/perimetre", `non-suivis hors du périmètre de l'item 1 : ${hors.join(" | ")}`);
  return `base ${base!} arbre ${arbre!} ; suivis : propres ; non suivis : ${nonSuivis!.join(" | ") || "aucun"}`;
}

// ── G-N5 : garde du candidat final (plan N5 corrigé par Sol, 09-10-2026 ; option B) ───────────────────
//
// G-N5′ (instrument R3, bloc B du plan correctif M3, adjudication 42e2000c) : mêmes clauses, même ordre et
// même refus sans repli ; seules les constantes, tables et annexes suivent le candidat b1a99caa et son
// chemin canonique.
//
// Lecture seule : ni rafraîchissement ni écriture de l'index ou des objets Git, aucune réparation. Les
// commandes Git sont lancées avec --no-optional-locks, sous un environnement réduit (PATH, sans
// configuration système ni globale). Chaque clause a un seul site `refuser("G-N5/<clause>", …)`, que
// falsifier.sh --n5 désarme seul dans une copie de l'instrument.

/** Chemin nominal du candidat : constante ; ni argument ni environnement ne la remplacent. */
export const N5_CHEMIN_NOMINAL = "/Users/MoG/audits/couche-pi/qualif-mac-correctif-r4/candidat";
export const N5_ARBRE = "b1a99caa0e31e96cbc5279dbca19781335ac764b";
const N5_BASE = "b54532045e1305bd48ee93ea8fdebdcca534b847";
const N5_ARBRE_BASE = "afaf99afeceff29f848e853249148095b4169ea7";

/** Ordre des clauses de la garde complète, fixé avant exécution. */
export const N5_CLAUSES = ["releve", "chemin", "base", "index", "travail", "octets", "non-suivis", "ignores"] as const;
export type ClauseN5 = (typeof N5_CLAUSES)[number];

/** Contexte de la garde : dépôt lu et chemin attendu. Route nominale : cheminAttendu = N5_CHEMIN_NOMINAL. */
export type ContexteN5 = { depot: string; cheminAttendu: string };

/** Appels de garde observés dans ce processus, dans l'ordre (r5 : sélection observée, pas un libellé). */
export const appelsGardes: string[] = [];
/** Tentatives de lancement (appels de `tenter`) dans ce processus (r2, r5). */
export const compteurs = { tentatives: 0 };

// Table complète des 256 fichiers suivis du candidat : mode, blob, taille, SHA-256, chemin ; triée par les
// octets du chemin. Établie à la construction par scripts/table-n5.py ; son arbre recalculé est N5_ARBRE.
// Delta exact contre la base : statut, ancien mode, nouveau mode, ancien blob, nouveau blob, chemin.
// Annexe A-octets-modes (identité A1′ du bloc A), recopiée : permissions, taille, SHA-256, chemin.
export const N5_TABLE: ReadonlyArray<readonly [string, string, number, string, string]> = [
  ["100644", "e22fb3640f8be21ffacad6889eb83547238dd87b", 746, "4d15f16f59d2bb040ae109b61e8631da4b21ce0461b4abcbfccc51ec9dc48258", ".gitignore"],
  ["100644", "2e12f44f2be13dc73e7ed41710f366c85f459d94", 62, "2fbed25d0c36b2d354d18d97a7d2cf076f3e700f408b62c58b940436336af57d", ".piignore"],
  ["100644", "2c3221cce34b0d966df68606399042ac8bdf77e0", 38965, "22c81748fea17daa65298856ee7ef2efbb45461c045eebfeb5e66e0dce46e7d5", "AGENTS.md"],
  ["100644", "26c09fb6e6467be9a6141bee428c0c7c093a005c", 2009, "48d9af430a0f0df449a0d48004be5c10ceb326ee263a6321cef79cddc4b08b55", "APPEND_SYSTEM.md"],
  ["100644", "8e8d274086167075956e30777cf4a04a07fe8058", 51184, "2f3f6500975fd9345e2e6822347f27991e04840320f51ae1471911efdb25f9dc", "CHANTIER.md"],
  ["100644", "3e57cd6b9c24bff560cfb0fe0c999531a90ac2de", 19341, "689e9baf5f6e926a1aae88f5b65c63658739d2876bf30eca450ad25bbea41e23", "PLAN-V2-POST-MESURE.md"],
  ["100644", "312cf425ade52148961872f4c0940a0348579431", 28448, "f5c59d8a9f139caad90f58d6192fb474bd51e2884fd99e4a2fa190c786af61e3", "README.md"],
  ["100644", "48dd632db1715a34517a2e921184451ed2996c71", 47401, "7fb9a4e57c9dd8e409949c30231f344db7ff5f1ff294f14dce3564eea8b70456", "SUBAGENTS-DESIGN.md"],
  ["100644", "b35e41176a6244c14cfb9ed1e84942fc2ab9c574", 106530, "f1f10359abac647d984e60c809133bb4e412e6af286c8bde4c7ad44409343c37", "SUIVI.md"],
  ["100755", "d82f21d4aaa329dfdf9fb5b76a895069941d81f1", 3515, "bae4c69e02c4587f98343175078bd7618decffccd86966192f89bae68194f722", "bin/pi-contrats"],
  ["100755", "17316dd974f5c8f9c0bb062f9040a3f9ea58f8b0", 72647, "f6581f37a8d140c3baa471384e133d1a5455894818c745785e94c5cf2cad8ea9", "bin/run-cost"],
  ["100755", "2c68e62cb4e266a0062f78663048594fbd406a62", 62884, "776124bfba193e08840c8495d724dc4e308b36e2be769483ef2dd57fd589edce", "bin/subagent-recover"],
  ["100755", "934be38e1dec4335b908ea1aa3c2497dce279ca0", 33088, "93facda6bf9311a535f16e17bf176ffefb08f6583de4694016fb0e8043ab8387", "bin/subagent-shadow"],
  ["100755", "5382dd27a9490dcfda06873a3dd67de663e0975e", 4435, "b2ebabe25524f1f84e2494084ba7b9782cb810da43657d13d8c44dabd3324e68", "bin/subagent-trace"],
  ["100755", "a4456093736ea4705c6ceda04cd45c80ff82ec4a", 3674, "e622db18869800a97cf7aef742edff1bcfb47ff247e965e601d72a7a4ee632ed", "bin/test-guards"],
  ["100644", "bee9ab9fc367fc2466441f0cc06c3e65bb6acd57", 33490, "b18b6d25f73a32511fc0a9750651192b87b77cc30a8459a7a7b8536952e69d6e", "claude/strategic-forge/SKILL.md"],
  ["100644", "ae8479c439f5dd41aab535e0fd52329cae44437c", 7075, "135bdc668fbc6b3fce7c51392a6fa4d7e4474d12ff7ff308f30004195bdd8451", "claude/strategic-forge/templates/claude-code/ARCHITECTURE.md"],
  ["100644", "a035de23e8dc5808f495f6888a1a7f572fc7c8cc", 1887, "c41730b35bbe56fa309e143b897db6ef936fb8ece9f0f340ff01cd4f5de66877", "claude/strategic-forge/templates/claude-code/BACKLOG.md"],
  ["100644", "2530cb361d71a28148d33e07f0df5ddd8c88e5e6", 3117, "c3a302615ba105c46d82561d53aa43bf6b1c07d425c9bafb883e79e9db2edc44", "claude/strategic-forge/templates/claude-code/CLAUDE.md"],
  ["100644", "ce46aee20300e55e26127db5a07fc910a4f9986f", 5159, "7f83f1a8bd2976cb20a6f8e8df5bee7d3afcd235ce3216999dba8f3f1705c0e3", "claude/strategic-forge/templates/claude-code/DESIGN.md"],
  ["100644", "b17ca11eade41d52c0d95a8fc140111e5e93a9cd", 2526, "e244a77b124675377c6b117a65a50e62ec9ed82d8e1d82a28cce2a978939f5a8", "claude/strategic-forge/templates/claude-code/_INSTALL.md"],
  ["100644", "50ba502caba9776bfd42c4df886d55f304c73fdb", 3767, "0ee828ca7ae4938a5691b1bfe79362c21b436e012f942a57ac75b2d18c5b9bce", "claude/strategic-forge/templates/claude-code/rules/_RULE-TEMPLATE.md"],
  ["100644", "989e86b93e9ae202b44894859555344eb095407c", 9998, "22a29af9fbc0600280f7ae1027479442f8fc76ee0cdf6dcf64533988124678b8", "claude/strategic-forge/templates/pi/ARCHITECTURE.md"],
  ["100644", "448d84b10f540333773341185ca3876024ef04e8", 6402, "1182ffb6656cf1e24469f2a9ec4ea501fc7acb9f1999f55ee06fd4612ddf9cf2", "claude/strategic-forge/templates/pi/CONVENTIONS.md"],
  ["100644", "897968b55277df7de26f36af5cafdd3eb3a49246", 6303, "517ed9d7efc2dafd0fe4d4c06f32888a784b6ed322950c19d55fcf76f0bc609f", "claude/strategic-forge/templates/pi/DESIGN.md"],
  ["100644", "a3f4127ea1286c306cab9959f7ed6c9751513635", 4998, "f111939d180938e61f6fb5155d5150454192a89f1ba58c4fd01552ccd2a6ce14", "claude/strategic-forge/templates/pi/INSTRUCTIONS.md"],
  ["100644", "08cb4f5ec33d7cc5507a8d86441243204cb72b60", 4455, "142cee77c63a19a3d9066522684bc613aab640e57d32dafa28f71ec351de7c0c", "extensions/bash-guard/README.md"],
  ["100644", "2354fee1b7d46209328e54c25ea638700d3ae427", 9611, "32f521770b9999487cc8606e2fefaa1bb85f4cde157294a6c5a7b3e48baff87a", "extensions/bash-guard/index.ts"],
  ["100644", "f4513361ea4f1f84987cd91ab743956283ff7908", 141, "d9bd6ddaa1cc99a4091493454bcf2b58c356a7d9f06da24b95b2266f63bd0ef2", "extensions/bash-guard/package.json"],
  ["100644", "86d239fec54ee12ff4d9764b93a58cfd7f3688c0", 7034, "81d6215dd69b4deb798cb4bb09133990756083e583364bb711f3301cb952ce99", "extensions/bash-guard/patterns.ts"],
  ["100644", "132164f158aa1b199713873a7d3439b469626276", 6037, "a1cee2a3485d0359c7576bf84d9b4da1dec2b396d73d78da9eaf209130bed0b9", "extensions/compaction-guard/garde.ts"],
  ["100644", "d368afbe69109a63ca1ae2ae75ae19e409fdae95", 4000, "e8f3fde075b94960226cf8b19df2d98bc60df99093fdef9fa6576fdb53a544dc", "extensions/compaction-guard/index.ts"],
  ["100644", "cd33caccc47d224215d153e00ddccbd8cef5a3e9", 230, "5da698872b758fdc31babbf46ed4cc596332ac2caa1c8170ff64dda88fdd45c8", "extensions/compaction-guard/package.json"],
  ["100644", "770eda806e8fb932779f714bebb4332e68cdd987", 3253, "17c97b91f5f66098e2fbd914fbeb29288c0147258eaeaff992104d5dc60edbbf", "extensions/pi-bq-cost-sentinel/README.md"],
  ["100644", "d265712792915d04d9ec44faa3c2152814f6f5d1", 14988, "41b713f32168f5c9a64fada9e06b8dde6a161a90081963bd6849101bee2141de", "extensions/pi-bq-cost-sentinel/index.ts"],
  ["100644", "d7d25127e073679f44619d32dffd86a102ed61b4", 156, "d834d7e35d8513d5ca6bb89f2c7eb22c8b6667970810b47570a12781b92790e7", "extensions/pi-bq-cost-sentinel/package.json"],
  ["100644", "8efde7103f5357442d55c960bd197e3a3171d85e", 22040, "a898a23504762bb449ea5a62102494d2eaf8dd8a1df13282e9fed8d2ff15f5a4", "extensions/pi-check-config/index.ts"],
  ["100644", "9a89aacca5fec68d6ce9f34556113d84dbccb327", 167, "5737da9d0ae3d30409274da0a85f6b42e585c471149b608456aec00f73d60179", "extensions/pi-check-config/package.json"],
  ["100644", "77b7aaa0c74ea4dd2a739b22cfd1a1e429a17db2", 6889, "9207186e45430f929a1b1ee61bce70ea1f8c3a57ccb2e3c565584d94b4d66c64", "extensions/pi-lint-gate/index.ts"],
  ["100644", "4d9e4c5afea9c107518de4eacef89235114d365d", 167, "fe0ae762de9cca0f1313af36ce4c6501238f16af03a12dfd1923ecdaeb1d342c", "extensions/pi-lint-gate/package.json"],
  ["100644", "f10f71ec98d842076bac2fca030e407a12aaae0c", 22531, "5779f2f45015a2fdbce178b9619c9473e2e0f29b42421210f1571e8c364a88a8", "extensions/pi-project-brief/index.ts"],
  ["100644", "3102b019f2aff1be9b2320963cb750ea2e052149", 161, "7d1b62cb6328f2021d34ad031958c9a87464630170ba412aa5a8e77f15d7ec01", "extensions/pi-project-brief/package.json"],
  ["100644", "32b354fc3e980a95d9182f750f2a076317b61fa9", 5135, "fd2fe6c01b8a20ca72ca6df88946b7f347ba8499f0c0f8869f43890a7f3d3097", "extensions/pi-secret-gate/index.ts"],
  ["100644", "010d133353240213514bcaff73467adec54fadee", 209, "beae8ac569d7bb11d11635e118b4ad93752547f8a0989508ee1bd4a2b5ab348b", "extensions/pi-secret-gate/package.json"],
  ["100644", "42490f8f7f2b50364fcf3a36ad232891881de847", 2416, "7a8386576fc0ee2f47e340e4bfd6e72f2187a1706324767af83b21715e5a83b4", "extensions/pi-secret-gate/rules.ts"],
  ["100644", "06f611167c9faaa0a3aac59d753aa515e7bc81db", 4961, "bf5dec6e5c2b88ee16f5607e0d8adeed484c6a434060aa45476f1ad1bf99820d", "extensions/pi-session-journal/README.md"],
  ["100644", "c60153cc00a82be02858476d9a85d3d4095dc81f", 16386, "2519a5636f83cba85a84d6aa53fe7c71547ce4a020977c6bff7b8b1794dace7e", "extensions/pi-session-journal/index.ts"],
  ["100644", "835bc44f8c1b24a0c512a3af93b978436b53a3be", 149, "70529c07b71ab9ce8704d4dee455e326ee84e1890e5c545f855f09eba8ab8cd4", "extensions/pi-session-journal/package.json"],
  ["100644", "1571c82d9d0d4fa1a13438f991a6ef62cff854a2", 18456, "d561fe67102b01503c36fd431afda5e013a33dd43de77579abdf0aba16e635a6", "extensions/subagent-footer/index.ts"],
  ["100644", "d5cc4210822da53007bb9c91619648eb6f4e96c9", 218, "1e4726d361e3e503f045006b2639234ce5c3f42de575b91ce742e6c655f9f5bd", "extensions/subagent-footer/package.json"],
  ["100644", "3963d51aeb40da749f8e292971dd406366eeb528", 309047, "9d97f0958ff62fe9a0004d6c98bfb692765fe2fd843ca84c88055c3abc5e9521", "extensions/subagent/index.ts"],
  ["100644", "c558d880b4840b6b185fc00d8445c2e342715e9a", 212, "51fe72f636c31d392d79edd716746c2f4529ffb42b4887cc7f17187357f67c4f", "extensions/subagent/package.json"],
  ["100755", "12fb5e73624bb777ed9c6a7ddbfedb136a4032d3", 1964, "dbe0403f75c1f8ff3d22fd23dc287cc55547ad696fb0aadf1431c9260a46b7e7", "git-hooks/commit-msg"],
  ["100755", "c204bca06921b2de1e8442844b2142a551939fcd", 1849, "3b99bb2a2bd13910c5f7d6a4a380bf789de65dea478eb2aa8da5d4af889b0d03", "git-hooks/pre-commit"],
  ["100755", "a8124a514547951b5ab44223b496833c2bf8e3f0", 1965, "d06aaa9f2a6f605d00fa4c2092e43b2c5d5b845a7b1223978ac50e0d66fba15f", "git-hooks/reference-transaction"],
  ["100644", "d6b7ef32c8478a48c3994dcadc86837f4371184d", 14, "240a3e0d37d2e86b614063f5347eb02d4f99ca6c254de6b82871ff8d95532a7d", "git/.gitignore"],
  ["100644", "d6b7ef32c8478a48c3994dcadc86837f4371184d", 14, "240a3e0d37d2e86b614063f5347eb02d4f99ca6c254de6b82871ff8d95532a7d", "npm/.gitignore"],
  ["100644", "8bf0a028be9a09237a178d159be1613fbc3c25ed", 1717, "af407ee36b23dbd09a844b1f13508a53f4dccb13a547b01f328a10c49d4c2289", "prompts/bq-triage.md"],
  ["100644", "edb9a174305516d92db895c1c4de2864493642c1", 822, "7246a357108ab56e6e42961f309ca50cab5d406a25ee8ccbcda869ffd6f9c8aa", "prompts/debug.md"],
  ["100644", "12c491226d2ab40f18d1b44ffcdbfe149d94a0b5", 2600, "23647d7f3690136ef22dc40618e179737755fb264c98eb87581b26f53fe61673", "prompts/docstrings.md"],
  ["100644", "579583ca7218d3d7b70b7daa5e14b8459ed4a3a9", 1163, "56891b5a4312c5bad224d5bcb0f426d8674bef4846ff026d0c9d8d176fc70ae7", "prompts/handoff.md"],
  ["100644", "4f19cf4a2962299fe52ffaa8ee062db475de3f21", 1733, "ad9c5ecda562dd3bfdeedcc544169a74158136ae1cd8be1bf88f91496418edd8", "prompts/new-dag.md"],
  ["100644", "19e6c925d31e0abceadd39d33c1bce4f0160c5ab", 356, "6cd2685a07eaf6b480d6e6e4d27c5172082111743e922495343e8b35914fbca8", "settings.json"],
  ["100644", "3b8d68113494fdd8692bf76d17442403faba45b5", 10722, "932091b7b9738e1a1ebc3637b6e6f040e752bfc894977fc679d644f205cb90c7", "skills/airflow-engineering/SKILL.md"],
  ["100644", "553c071fb5d2b32708533da07962704fb595322e", 8308, "ec5584dfc32131a36d9e2e95e504a8d822b3f5e051b6c7366a7c8638996056ab", "skills/bigquery-engineering/SKILL.md"],
  ["100644", "17a2dd150c0e164d8b51f409987504ded9171178", 12559, "e169f7a8605cfcdc5013cec152ae6c529662cdf62dda932198a68927c64a0974", "skills/bigquery-ops/SKILL.md"],
  ["100644", "f760aa53e3ef3d096b3bd66d93b386d2f967a009", 7396, "ff17743b127236d79a5f7840e4340ea6ced351c0b6b5f2cd33a6fcf9ff3b165d", "skills/code-review/SKILL.md"],
  ["100644", "1b6052e2b5cab5ec21cc5967294ef3543d1870d3", 5846, "300e210bc8f766332f88b1b0116c13b3033620e02c3bf88265354cefc4e34e34", "skills/data-quality/SKILL.md"],
  ["100644", "6aa8a9da765b7081e7155b62d68cbfb8ba47ac2d", 6859, "e793b5f92baed7264ab1d69078ca28225c610659bb75c5ec84d8ccabc9b27e1f", "skills/dataeng-architecture/SKILL.md"],
  ["100644", "2c112b2a71a7f1be11037eefe287b92b89399d61", 9316, "3b7a90d875996803ac282d9542fb2dbab8bb126ff9faceef36d4327fe7f8b0cc", "skills/dbt-engineering/SKILL.md"],
  ["100644", "1658d61baf38c06bbf3757192edcc1e5290b72ff", 6420, "d30d46980cfad53705afc93d5fa181f5c54dac62a540b7fbb37425b5a860ea8c", "skills/diagnose/SKILL.md"],
  ["100644", "21f6bd988367ae986e60c3fb258b532ead2331ee", 5512, "841c6c77c16574a9259f7cd560008295449abbafcc1ca936431fdbdc7e8da019", "skills/gcp-dataeng-architecture/SKILL.md"],
  ["100644", "759a02b88a1baa8e4091b1e4b6f97e3b3b2cf0a9", 15583, "baadaa3ad564de4495ffc8c89236900c1fd57cdc9c327efc6d1498580043de67", "skills/gcp-engineering/SKILL.md"],
  ["100644", "8d2e568204f9b7ea1cfd999e452f806832f44e8f", 9931, "9e4e4f5b7293712d81b75f1a435a0d9731f5bb4aa36d7e2f4c1f3d276e2afb4a", "skills/git-collaboration/SKILL.md"],
  ["100644", "f9ecbb98a689be65d4d2eb5b8a049affa32207b8", 871, "e157f84e3209edca0faf8fcb7baa06a3e53717b61147ae6377512c6a57409383", "skills/grill-me/SKILL.md"],
  ["100644", "80dd50a903ccd6dcc38ea56f3751cd9519428521", 10750, "c97feee812e3f31e521cd9d12050ac3e728c4d12fd4f0e6f54ca86726f3a3af8", "skills/iac-terraform/SKILL.md"],
  ["100644", "f151d5323518935cb367436ae2980c52ab52a9a4", 5802, "089a7df8ed9a556870433c5598f2a692b43f08e20357aa834651bfe30bb48de4", "skills/improve-codebase-architecture/SKILL.md"],
  ["100644", "740b97a5f361897073e08169270de2c39ab066b9", 13755, "f19539422b1fb567ea8e046f5e2b71243c9e94bb96492788c4349136969923d9", "skills/python-engineering/SKILL.md"],
  ["100644", "7056a52e239a2300597d1a537e026780fbb1e915", 13571, "eaf0e3394866e91c0c5ff63c7248d2bb0cc40dbc2af6db0e91f54ab45c9fc6a3", "skills/spark-engineering/SKILL.md"],
  ["100644", "09a56e1295e844485f75e88b4a141cb13355df89", 5925, "9f4925497e0e339fe1b6028435f2d7e3507c82083127c51f66ba22cf4728ce99", "skills/sql-engineering/SKILL.md"],
  ["100644", "fec4ec7e2c83a87edbe7f49b99dc34b0b3b53bde", 4309, "57b0169d3a463d149344a4a5f7a153e954909ab7726fa0404caa3e87a8c92222", "skills/tdd/SKILL.md"],
  ["100644", "f95b38cdfb97c7c46ca9f60e1e5ecf3742e1906b", 7526, "89e501a2665a26cfacf8ba4ad7a38ac0408e4029a22983a80705bd464e4e1930", "skills/technical-writing/SKILL.md"],
  ["100644", "2c40e05f874ea75f5d0f589a0b827d33c944753f", 11802, "f154e006551ca756061a56a4ea95ea0f0bc655ad26ee41d373bab161a3dee881", "subagent-only/agents.ts"],
  ["100644", "83711cc0d70dea7b500eb225f6c99e79067e027d", 6277, "bd6b4e7af5a06ea20fb4093935654b24be837ba3709224173602b787e108a8ac", "subagent-only/agents/advisor.md"],
  ["100644", "5569d02c95cbf00d4fa94b4883e98f9842f674dc", 4173, "d1f2012fa29a9d74a5df9db83a72ec3e807392c803cd9448500c1b6094fe90a9", "subagent-only/agents/integration-worker.md"],
  ["100644", "58379e39ac3563331628c2b325d5eb843b55c051", 8814, "a3e78243652336cc554d698366e0f25367900cf6b7e1b5de6a16a40573a5aaa2", "subagent-only/agents/reviewer.md"],
  ["100644", "3bf033a3bfe3a8a7fa043642d6832a0ea9bf6625", 7404, "31074ce1f781029f148958c3406c0ad0de749203e694ea68bad3a970678f5864", "subagent-only/agents/scout.md"],
  ["100644", "8ee004a3be4a23a461c633df4abd7a58d34858df", 3446, "8ca1f89fdfa0837bfc49f22efb5f38b5a7d13d9577b3936068e3024110ee52fc", "subagent-only/agents/worker.md"],
  ["100644", "b1854c0cecd706e830d640e573ae0a4c364bfc04", 3666, "22a9a520bd31447a5da49ceef74def6d83619cf76020d372fd51257a5cd52889", "subagent-only/attempts.ts"],
  ["100644", "fb32c27da14c45d4deb759acfa792dca26d75334", 7325, "d645bc92193dd2ddbe69499ddd80e5e1dd01521bd754ba1373ea5454a360a8eb", "subagent-only/cleanup.ts"],
  ["100644", "fec34cd713b5789d5637e45e5b1e669ed84224f7", 19127, "12921e7cabd4fcdbb62f6e617a12ac54220178dd05eeac5fa7306ea00212573f", "subagent-only/consommateurs.ts"],
  ["100644", "67bc4773d896e5eebcb65daa0bb6b6db1339d0cd", 13277, "d3bd34f495d888ecaf679099fdd3c69eb0b654f823a0caf90689253cb1ff7f72", "subagent-only/counts.ts"],
  ["100644", "3252757788b5f4a57054c07419df96b3a2379fe9", 10212, "77f01d6f8c228516781a5a4dfc91cf9f5dcb930e72acab4737ea65f82591b69f", "subagent-only/design-update.ts"],
  ["100644", "11fff714361e5c07a69a5fd5fdd9145db7bdde4b", 36210, "2e468764ab0692725c079d038c40ca1c6f804bde2832dab41c75c7a2342e36ce", "subagent-only/dispatch.ts"],
  ["100644", "c6e8793b0d43bb622dc90a94e1e50fc499c5edfb", 12032, "fc06dd90d24ceecb81b6f21c3a2d6036f6e1ad7fec50c8da790fa5453f178ee7", "subagent-only/empreinte.ts"],
  ["100644", "3f831dc293927238895a2c2511d9922181723dfc", 4944, "d7528c0865ea2fb542fa633b664f4205e25fccdc47e5230d507d9d64065e1f12", "subagent-only/envelope/approbation.ts"],
  ["100644", "66fd1b3254a1c35877c0587abed6d132b8579ffd", 17121, "9a3c5b02d7a1b2f7ecda9e7d5242a1fe001407f43a2a788022aae47f9c96d8cc", "subagent-only/envelope/envelope.ts"],
  ["100644", "88d6f2a8236579422cfafa62efa751b816d72a0a", 9215, "89f97b6faffbfbbffeb8f02600eb275ed5bb08def6510b77e0efaf4648a6a216", "subagent-only/envelope/inspection.ts"],
  ["100644", "1ee1dd3672d9981455d6e97a11f9111b3609cc29", 1174, "70f6d120c7b5ab7236776ace5f6434017225f15a3b76aea35fa0665190a6e0ac", "subagent-only/envelope/read.ts"],
  ["100644", "a77db3b243a1ba699159b04a4e9440494071854d", 5097, "e38fe21fc42547eed8d0c8b08e3fb584585f7661d5cd05136ede370db685051c", "subagent-only/fanout.ts"],
  ["100644", "6e07161b783ca8288a81e7ce53d79a4207369903", 2729, "8a9f5a12e6f7399f09993a5e406fcf53849a058574e8f86f92bd155436b372b0", "subagent-only/git-probe-counter.ts"],
  ["100644", "b4c23303ce5aa1821d2de26fa2835af9cb6e391f", 15807, "3d2bf5bfcf7fcc5402799afd4b085f26d608611847520b2bb56eac0e41f5eb1e", "subagent-only/injection.ts"],
  ["100644", "d24cc6cca9581b1d0ea6838965a1c7c4a8da47c0", 14988, "80ab762663d3d7c39e0fd360d81c32455ad7b9c1f3cbf1cc89c622d89abc4907", "subagent-only/integration-ledger.ts"],
  ["100644", "e8885647400aee1748773a33f354839dc3236f10", 6285, "db082df5626e187e0579bf4e1f2fd94d6da4eed36ac8964a16430d8557bbf4a4", "subagent-only/integration-observe.ts"],
  ["100644", "c85cf8bb27f0add5381a8d6631349b5d55e44ff3", 48884, "5ba264372206def1354dab96caa73fe450837f1ca761d9db2376d6f1c7a5dfb9", "subagent-only/integration.ts"],
  ["100644", "8f4d4a719c88660dc5d58cc66c7b8d0c264a2c89", 5253, "5d8ecfe3a6bcf9e4a582dab3a3b378a443bcd263ea20f79eab2d3d8c5dccf631", "subagent-only/kept-durable.ts"],
  ["100644", "cf9d16a95617f8c69a5258e6baeb1338c6bef15c", 8419, "31b4e3fd945f6d63b9b03cbfeb360a8a6f64dd6b2f1408c97848dcf36db783a7", "subagent-only/lane-context.ts"],
  ["100644", "e91f65f32f3257f5141d15570218b311c75ff657", 36200, "b04403659f1c886919e7d581e65f292020b4b0cbb79bbc1d6ad2b02488dd9e88", "subagent-only/lane-ledger.ts"],
  ["100644", "bba6968cc6e1db2c8ef8991352c9245c3cecbad6", 12667, "6fdb30ee86a39ef4ef39c570750d8ca4e6107a95cabef97bf8621f87ef186c38", "subagent-only/lane-observe.ts"],
  ["100644", "8ba2fcb02eb25b8dc96b56b5ad1de2b092076821", 8562, "5c6c1b9d7ac49834e39b6f4e7c1a25dca783e5e5528fae248bbb7b54ec258189", "subagent-only/pi-adapt.ts"],
  ["100644", "b0576c5ae8c781954536657e85ba09fd9098180b", 3893, "a2ca41030c20796bbdd0d6960a088e8bb84bafa4ba2fa7aec9128437877db671", "subagent-only/repo-preflight.ts"],
  ["100644", "645ac0d3743ce13825c853f474fecd4a668970f7", 3977, "4d5d1814c717c8b0edf80d5e23d50490a8a975ca43cd069eb8b73f68307107b4", "subagent-only/review-boundary.ts"],
  ["100644", "770d733a369268f1ac827f0f5dc3079e0da1647d", 10435, "78c56faec4bb54cde095ed96e5f65d2b804e075b5e578143e4cf83a9fb5a07bc", "subagent-only/risk-ledger.ts"],
  ["100644", "9ed9e61128b9db095bfe737fea542e8804c0b9ef", 5556, "67e26bc35f23eb9c549612c45bdfdb5ad6ae3fc0bc1b0e11b788221670c22593", "subagent-only/role-guard.ts"],
  ["100644", "fa00f4367c618d6b7dd9c2dd274617905335444d", 36398, "995c5314fab88f3d095ca99404a19f5ab1ef1dfa0416d039f8de2475db81db8a", "subagent-only/role-rules.ts"],
  ["100644", "f4fea386dc7082f57934e9ab2dd695d1259d4307", 6992, "2b24f6cc761f756372c76f4e5e3f56262974ff9065efcb912d66acc02ecb5b95", "subagent-only/run-end.ts"],
  ["100644", "f39c877b70cb59c5a45a30812b1fcf26e8a5836a", 162220, "15db73677ccbafb1cf09fea51342eb214b26511ffbc0e2dd2f50a1f1994b0014", "subagent-only/run-manifest.ts"],
  ["100644", "22310fb22da8e0e00de1ee5371dbba3fc0fb38b4", 12457, "00f50d99e37a366aa43ec582a2c12f8a89c7f93458c6da422dd711f98c6a39ed", "subagent-only/run-report.ts"],
  ["100644", "ba047043e5ecf1b4137fea5120a605a7b6c35324", 14553, "92375aeff4ca13e6836ccfe2334dbe77d312ed148dc8695fc798cc363e11572f", "subagent-only/run-state.ts"],
  ["100644", "3da4d184b86c78929eceb2fbacfa493d2ccdece8", 17125, "1d814f17b4aec117eb33a5209967a945727ebc11320c05e8ea3868a19416209c", "subagent-only/scheduler.ts"],
  ["100644", "0d9238e9575b592591042fa9b6dedcfaba3e6703", 1512, "b54b885e8ef66fb107b2f369bd617e40aa74ff60ea31088059a645dba05ca511", "subagent-only/signals.ts"],
  ["100644", "9fd52ecc64b94a4d267750656c0aa9d5fd798fec", 4517, "329e5f154ad81c218877903b3cd7996987fa1c7ecc6f988ecd51178c0a4c447d", "subagent-only/slicer.ts"],
  ["100644", "18e33403ebf87b0ef27e93c67a9595798ea1629b", 22857, "0820cdea0a52b2c50da54373d0e2de45fed5838fa24943a267e00b0e63a42cec", "subagent-only/spawn-args.ts"],
  ["100644", "b4591a7082e1cc8edb9ea68bec149a31264fda24", 10850, "92338ed866839f8af0f08653b44107858de18b4776b8f203bc4f1d13387f95e2", "subagent-only/task-policy.ts"],
  ["100644", "884738926d0c5657b4539735b4443162a5d159ba", 7179, "dd08b9f9c3b273838a9a61db2255f22db88cacd27198cb95afa6a6b78d55e7f6", "subagent-only/terminal.ts"],
  ["100644", "fa01354bdc65f333c538f8dce47a9010225f298e", 20191, "ec11f842f6b08986451805e6d6f3db87ee02750d0b6b0161abfcee2e2bec28b1", "subagent-only/test-command.ts"],
  ["100644", "439f795fca0ceceb0c77d9da118f5ba6c6f60635", 4886, "320b6b49f0ceb69f3a75aef8e2fbef165115730fa917149fcb5b84758686b25b", "subagent-only/transmis.ts"],
  ["100644", "f1ff19bda1ab8d62180f1b4e11be4ab1e0a86e16", 8635, "0375ce99f0fcb0f7ba7a2bf5d074fc6467642608c988a48d8bf4234624970c64", "subagent-only/tree.ts"],
  ["100644", "c8d1a28de6ebf1ebd2968e0b082ee19b5042d9d5", 14920, "d826135c61981d901f81d70aac2724b72b483bbd463cda5fc5e85606b63561bb", "subagent-only/work-units.ts"],
  ["100644", "ae618b3750916aa9e66e68e702724ca0b2cb6a96", 35179, "258213bf1aab0f087ebb0f519869df441c9933f89ab7922f35ed0a6a53c0c1e6", "subagent-only/worktree.ts"],
  ["100644", "e39fcd7c2d7134a2a63a4f15c91008acd4465f2d", 5997, "b90ed0bad390161f9525f3736e1aad62ccbf715df716c07ba8e9669f624bb01f", "tests/attempts.test.ts"],
  ["100644", "2e17ba64b9d01b427338855111f28eecde818f6b", 6816, "ac8bc23b4cdf46c166c5cf0406c40303bcfc43f7ba992f2e49ccf3b4dd598861", "tests/cleanup.test.ts"],
  ["100644", "720a69932884cfa8fbc7067656293b6aea9029f7", 14278, "356ac218762c6a645843b68107eccdda2b6cf8d30ee0afe72abcefed34aafd03", "tests/compaction-guard.test.ts"],
  ["100644", "54addb78d5160f7dd6fed03ff6ecf4a0ae451b5a", 7825, "ea245cf6113802e873a51c49098aa602bd8c3c1141c094ec63171b250b935aae", "tests/config.test.ts"],
  ["100644", "5c2110e562810e670bc3c7a88a79d69c3a286782", 12574, "2d0082d103c159fb4a144042776fd338dfdd0b480bee39ddef5e17225f146aad", "tests/counts.test.ts"],
  ["100644", "96115e439c51845157b574474efb7d2ccc2c8464", 8620, "96a3098d365f583ed357b1bf0cd515ec5ed03b49768a1267bf960a6c959bc0d2", "tests/dispatch-harness.test.ts"],
  ["100644", "1200624ef669d2a3b07c1ac8d69efbe082d72859", 6175, "d64778f1aa53849f42646ad2b785a56ebf8b97bc9512c3a38e4908f9795dcb29", "tests/dispatch.test.ts"],
  ["100644", "0a7d1baa3b4894172910a23441e3ad24151a1710", 147109, "fc9a1ad749884adb6982049e4c41632a5163ceaddf656a3ef2c8facdc4fab262", "tests/execute-harness.test.ts"],
  ["100644", "6d53133bdccda565e26691771844c51d3e535265", 3849, "e18bdce5b75ef8f950a251b455f7783f2d373d5ca88f1c835ed0d9a9a9742947", "tests/extensions-tracked.test.ts"],
  ["100644", "96eac28006091c9841dac6c2cd79f1897dd9eeb2", 19169, "7cd2e9077d3a675dfbdd7e55cab02f994a2dd14892af8a23cbe85d0c68e708ee", "tests/fanout.test.ts"],
  ["100644", "1671a269bb751751478ce530bead6cfcadf35f63", 21113, "a9cea47f68c4445244140c3da6f0bebad12f79e187945c9396596846f530e4fe", "tests/fixtures/pi-adapt/generer-references.ts"],
  ["100644", "03f55234b76ebae90e5feb6e14f55505d29ec6d2", 195995, "6b9df7357eb179d7d7fe530eeedf308b1e6d600b3dcf26b46f50de705b8e15fc", "tests/fixtures/pi-adapt/references-b5453204.json"],
  ["100644", "c1fbeeb820daf41562b8538909a6381f053f10f0", 30048, "8c03a83add1c27f344fef834281494dc192bba21e2b47531ed6394d14443bd15", "tests/fixtures/pi-adapt/transcriptions/commande-de-test.jsonl"],
  ["100644", "72a265b1fca49ad80525a977720eb66bd5f1df05", 20461, "79bf0b5e543e594a0557ee2adee1ea5dcb83137660877e54ac17a0b02282c16d", "tests/fixtures/pi-adapt/transcriptions/erreur-fournisseur.jsonl"],
  ["100644", "0a8c8ee44ec2e86d57ec3c8ca61db2329cef7cd6", 26537, "b2ec3f073e4e31284585f72ebb0fc1bc170305154c1fcc7b8ab06d515fa55da9", "tests/fixtures/pi-adapt/transcriptions/nominal.jsonl"],
  ["100644", "c72ded35dd5c04ada68674a25e154b0e941cd55c", 32282, "4feed42f8b659750a4b6a34d8820c445374dc79250fdfab9495618636a5694de", "tests/fixtures/pi-adapt/transcriptions/submit-refuse-puis-accepte.jsonl"],
  ["100644", "9e2d7654a47afc35599e2cb07f08be755e7b94f3", 1059, "4d9b92cffc451d51156a52a3d708ae22ed9f91590fe181600c961b2d5a436aaf", "tests/fixtures/pi-surface/acces-calcule.ts.txt"],
  ["100644", "da0b599d88e3eff3ec9e82319cfe853c9b3e63b6", 1832, "51261a1b5ac9aa5f291e9a4da50be24e49271f2ea8b2d482f45a07bc8e75b5ec", "tests/fixtures/pi-surface/alias.ts.txt"],
  ["100644", "795cbadb40a25c0da4fa29f07abb42b6a714105d", 919, "9c9ebe874dba0bb89720016d237cf81f27ed065572f467727cd5ae6fac37032f", "tests/fixtures/pi-surface/ctx.ts.txt"],
  ["100644", "406d358991de144a853ce66fe9ad8e6c0a97c9ab", 625, "334886baa5fc2cc17e0cd72d4c3edaa07a2b032711334dca30e1843ed4c09cb8", "tests/fixtures/pi-surface/destructuration.ts.txt"],
  ["100644", "f98ce2d4d7b0d6e206731708b88cfb7224d5eabf", 279, "eb2c90bb3b1e01c916e05d298089add9ec0af105dab9d493b6f2cb1faf205242", "tests/fixtures/pi-surface/drapeau.ts.txt"],
  ["100644", "d944858b14a95e25a08ccba62ae51ac3df67dcd1", 433, "72fb332f8f02f4a7a8afddcadc2d318c0b3c2ae0c8cbe6ff1dc4f1175fbada12", "tests/fixtures/pi-surface/evenement.ts.txt"],
  ["100644", "44b040fffd1b203d868bc389e7685b05b090e84b", 1268, "31535866c2e9ffadb4bd95005fae7a40d746240bdd9829f6ac9159b5b04b9f1a", "tests/fixtures/pi-surface/flux.ts.txt"],
  ["100644", "388d68ed3682a5608a62af0c799b9bcf5b577ab3", 1605, "d74c8500f931284b608645de163a581ede3ee3db9ab285c7f04e0cf93fd36383", "tests/fixtures/pi-surface/import.ts.txt"],
  ["100644", "8619baff196f18dc8803aa2e5c309bc00d3523fb", 668, "1517d3170cf9587ba0ec2a6d4e80c066107daeddb3427b172c06966be7daca68", "tests/fixtures/pi-surface/methode.ts.txt"],
  ["100644", "44fd2eaf5040d947d012924889ae7dbda3dafff9", 877, "332affb831f1f3c99e77477b59671c2670ed0606ee1fdd0451d2778129909c96", "tests/fixtures/pi-surface/python-cle.py"],
  ["100644", "beb9b7f11dde015d8bdb73079edfd692d6f8d108", 6621, "b6068f213127e9e87056faabbaa4c58316af6eb9b9eb1d5debec6f2d3f896d7d", "tests/git-hooks.test.ts"],
  ["100644", "da98eac6ba63e8959ce6fec42d043468473fbe95", 21549, "5caee001e0599298caa9e780b5209f29ebde8b7f8650e0a4e42b3fcada172e8b", "tests/git-probe-counter.test.ts"],
  ["100644", "7125b3ccc200723eca9b5dd933f823afb3cc7ea8", 16399, "d5cb3507795da432b9cc67146513fa6fdd40cca1e21d3035019f3411a736da50", "tests/guards.test.ts"],
  ["100644", "7ca6b7dc1a6db45d781db4138dc1dc157d383844", 10374, "88f5b71afea9b429e5ad7c7728774a9b408cc94c8feeae333a5269d0e3b786e0", "tests/integration-ledger.test.ts"],
  ["100644", "2e991e367f8a9b146b864dc1cc8cb4bf75d95491", 33307, "c446e6c7c64c0c4aafbd521bb81ce05490d9fd8be04704c5bdbbf104c96419e9", "tests/integration.test.ts"],
  ["100644", "a511518ddae81e0d1e3c2d434a6789cb43d6b657", 28472, "45856156026c665385822ddc5b12fc712c67a2f4d4406701d2b2d2437ddf4b8d", "tests/l0-a-harness.test.ts"],
  ["100644", "bc814c7c51a500235d9c6b9ea573d57906d1843f", 17938, "df4f179e03a2c2d6c49c1c5544d83bcd8cc1cf8893dff809b6d41d9238cec4ab", "tests/l0-a2-harness.test.ts"],
  ["100644", "e21e25894991032e1387f122c4c5f2924cf20b00", 17734, "ca64bee80f7694d2dfe140cc26958ee225468529214fb5f2698656904f49ab4c", "tests/l0-a2-units.test.ts"],
  ["100644", "85edde87871bf3a899d5283727b8e49e0d5fa284", 12260, "74c85b3ece520318da830ead70bde4561d9c2fdc5cf61919095454fd2491a3e8", "tests/l0-b1-fixtures.ts"],
  ["100644", "cd6a3ccf120b83ba92cf13847d97d8cdc8e3470c", 18470, "06de17eab523ac12bce7f5496d74cede86238a0c0bbc93cb118f465429020efb", "tests/l0-b1-generations-harness.test.ts"],
  ["100644", "2a97eb98baf1ca3276d204d7c65bb402d79597c0", 73209, "8fc2f702820463db0c3009fa258730f0852385534372157994e3ffc3cc7a1e70", "tests/l0-b1-lifecycle.test.ts"],
  ["100644", "14f82b05d69fad2717162b53926ce97b05c5c055", 36174, "e81ad8fa3336f7f09bbd4a02d06f9d9ad5ce5b02f07bd50864a1ab24eec52f16", "tests/l0-b1-registres.test.ts"],
  ["100644", "a200bd34c62d52dd30abb8e8bf09bfae54005e9d", 18339, "e2e01835e68b3bc4bb368eb87e76809c8013937f24be674236d5c89218473b31", "tests/l0-b2-harness.ts"],
  ["100644", "325db263d8c0683c6f77fc3ef034fef80e578bed", 7659, "8885ceb276a70fcc05180b28a23af516d80a1aff9fd4f00d9239440761e6f2f3", "tests/l0-b2-lecteurs.test.ts"],
  ["100644", "06c43134d8f74ef3adc4bbe5ee58ffc2af9389b8", 14714, "a42ad9df48daa052d81fd6bdf57fda10d38558d33ef67a44168656ac5fb6f1ee", "tests/l0-b2-revue-harness.test.ts"],
  ["100644", "c03c1eef9a7f91f3f453e2ee97aba3b3f7a160f3", 22801, "675b8441e32b09f43d16527c71177d76d3b48d79fefcc0cb8e665dc0bd22bda4", "tests/l0-b2-risques-harness.test.ts"],
  ["100644", "83c0597a0ba474125b28aaae8bdabaa2efb010fe", 12732, "af3f3e39870a1765b2728b042ac510f091d8a34f859ced7759454ad0b1da8460", "tests/l0-b2-violations-harness.test.ts"],
  ["100644", "0ccf6dbdb7b2d32235b80b3ffdba216e0cf84195", 15472, "cc252c512565779ccdf1d8e4ab2ebe4c38816afa8048dce32971936c52a871ad", "tests/l0-b3-fixtures.ts"],
  ["100644", "786ac6d387606f29b70e7dacd2b6619d02899c6e", 20831, "eff9b0ed08af93603aead32583b8070d2f887f1a40d53d7c61bafb6e769a5bc2", "tests/l0-b3-gel-harness.test.ts"],
  ["100644", "cd81be0ba44ce174197bb523e850fe5ff76537c5", 27903, "358f5275bcc6a6e6cd5fa1650dd5e86dee2e9f22c27ce4f32cf44b086fe637f7", "tests/l0-b3-integration-harness.test.ts"],
  ["100644", "fa613b94b579528019ab816ee86a61344e3c4f35", 7839, "978320011e38509eceb4428bf46ed3b8d0471ac5f6ceef2f954ef67b8269c55a", "tests/l0-b3-racine-harness.test.ts"],
  ["100644", "f240ce6112bebbafd0cd3a00b166f80521e28ff4", 27590, "0dc1da0632e45fb8e0f9eb96930347e6e51beefd23410edf6a4bc6bf9d71017d", "tests/l0-b3-statut-harness.test.ts"],
  ["100644", "f2f061b6b037fadbc5fb54a40e635cd2c46d418b", 13207, "4033bbce84507af744dc9e60908af2602c625bcb511f41aa277c670d66bc1cf8", "tests/l0-correctif-rc-harness.test.ts"],
  ["100644", "0f4e1073183ccb87923fc8392ed2a43f2adcd24a", 7989, "f8936ff3df5bfb9afd0ad35e43f5bc8dce2f208596dabc62c687b09670c873f7", "tests/l0-correctif-rc.test.ts"],
  ["100644", "88b26bdb88794f4be61cdc935e83e10dc3a50f81", 13135, "894e82b5a1da9d0d0d3b2bb8290b3c9ec70b54f49815770b6d179db858206f97", "tests/l0-efficacite-e1b-harness.test.ts"],
  ["100644", "4fd5de5df2c919342d18228f1d5edee115c3a267", 18308, "1eda0c80c5ff6542688bd4b49e587d10d4ad89dc6904f236fe901636dd91949d", "tests/l0-efficacite-e1b.test.ts"],
  ["100644", "d0620ce3c475080aaf813ccc4fa6d6d12f172cae", 20419, "665819132fae05b5f6a26332c3029beda8b338c5168986987ab5dbf03911def1", "tests/l0-efficacite-e2-harness.test.ts"],
  ["100644", "54c05b2c4caac232ebad475b560ff80a9974ec08", 20148, "915acc5ff56ef1e3791c357b0d336ada15edd8ab619436b3e5739e253f8e018d", "tests/l0-efficacite-e2.test.ts"],
  ["100644", "1760bea332f2e0b00a2d479b8b56676a034e9e2f", 6745, "e38e566185053f44d3fc79051516e7e54531af481b11e4e464d7e44e20910db2", "tests/l0-efficacite-e3-harness.test.ts"],
  ["100644", "d4311a899b8b8cf5c40798d75fadfb941cdd61af", 3279, "9bdf14dbe8a27bcbdb2d0bb93e6aac5d4542c0d4626ee1d01c22a5e66ef533d8", "tests/l0-efficacite-e3.test.ts"],
  ["100644", "5790aa83f8b73748d61668af4f1fe43e43dcb22c", 4202, "c725ecb497e971a9f1c42e03da6c6274d17d5d8bb39c699d3a8f34b5546f7d96", "tests/l0-efficacite-e4.test.ts"],
  ["100644", "80b3e66e46a93e5470087b419faeb481b5dd3284", 10418, "ae5fb95985da15d4dce5a37d85eae05e18760194a1954a8835a9f89772df0aa0", "tests/l0-ite-p0a-harness.test.ts"],
  ["100644", "4e9e10626ee1f0bd49fe3d5270daabca8c1350c8", 18830, "02ebfe894a7cef82b87c0b00a4cbb1593982ff76b6852ed6b7f63b2e7fd9f793", "tests/l0-ite-p0b-harness.test.ts"],
  ["100644", "7f54551a8c5b941bef702e6e2fc2aa39911051de", 19697, "1d6b4802b8366edb3f42052429068c9e06fe2c7ba67ed83da013372eb940356e", "tests/l0-ite-p0c-harness.test.ts"],
  ["100644", "a13bea9b374debc6e1024af5046021f4a289c8d9", 6952, "e9d461ce96e67f3d3bf0688ff61201a25f994abb5af75d21fffaa93b3149df76", "tests/l0-ite-p1a-harness.test.ts"],
  ["100644", "551530104aefed88ca9bc9379a86930be3cef2aa", 14174, "670406deeca7d0794261ace73ba391c0e0b4dd70e8f995c1001b3da6249220bb", "tests/l0-ite-p1a.test.ts"],
  ["100644", "c488bd5ae3d6bd30e1bf20bf2c6853a2dbab56c2", 3783, "856833a4dc212eb13b084d38d417271308a44c5159ebbf225cd39c5c550515bf", "tests/l0-ite-p1b.test.ts"],
  ["100644", "44a8db2a51fcd84d9fce3f3eb1b512dd9820b89a", 5274, "beb4307912a4698869fcc35beab4a7adbedb1226d7a0360c000fb3dee440c668", "tests/l0-ite-p1bc-harness.test.ts"],
  ["100644", "0174a0c8623185471a321112a1b04b8bc2499ec5", 3441, "69dd42177aadd670a54e7067f47735689d36971fc467b04ce52a92d576b5497c", "tests/l0-ite-p1c.test.ts"],
  ["100644", "874a40301a2ed0ee0bf115dc0d03c6e640e1cda8", 6700, "aee6b599a564403d554424ca9914e3928a982970aeb72df3014fb15064246b5a", "tests/l0-ite-p1d-harness.test.ts"],
  ["100644", "85c17f9d82905b2d4592090a8b11081b2ea07a23", 6590, "62476b1ac420b56ce6484e990baf23439cc16f1f702b7e69850c7688f34bd719", "tests/l0-lib.ts"],
  ["100644", "799271ce19e3cb52cce06a1a060add59abb18dc7", 12052, "253e17aa318bff06f7e73c07e5151c08bb3e8e58538f500a6e6ce5f7754f34d2", "tests/l0-mutants-instrument.test.ts"],
  ["100644", "1f76c73f1d98900e26f9e4487af836010154edba", 198905, "b661b25c40946c9472df1e3408cfcd659fab8eae203857746b9c18118d96d370", "tests/l0-mutants.json"],
  ["100644", "11b21ba21151fad6f4ee54ecfd8198304f64108c", 18002, "dc9d3169174db696a70685e47d2fa583d2f0bcf6c3dd7f2c9f466cdb364a6fb8", "tests/l0-pi-adapt.test.ts"],
  ["100644", "e7a7dbef835656de1705bdf5704bc2058846939e", 115572, "7a3820e049a3a7255b1459d5cc70076403f149fb70a144bb2f0b5dc10b7d5089", "tests/l0-pi-surface.test.ts"],
  ["100644", "9226dc0298ac3ee145f0ca1c0433c5004a78bee1", 9356, "784a06f6937f327826b1b01628af13c0bfe2323072e66e0f9728735fd9ccf727", "tests/l0-reprises-r1a.test.ts"],
  ["100644", "43c068e39f06ddf3dec3853cbde7b3845c50ea82", 7786, "2923275277ca66604af73f063d44de40d04f7c2c42de7ef87faba88c8342263a", "tests/l0-reprises-r1b-harness.test.ts"],
  ["100644", "318e2069bee193726e098822df6e045471720a0c", 4144, "6fdbd9baff1f6f84f33589af0b65f700f6cd66ebcc62530eaedf3213ab66ec93", "tests/l0-reprises-r1b.test.ts"],
  ["100644", "8f633ccb57a3c8672d3381512754b7c6903db295", 10981, "9e4aaae70c6e00eee3ac0c6ec634e3fd63a97b48fe7e9087e6170b7bfb76f9cc", "tests/l0-reprises-r2-harness.test.ts"],
  ["100644", "fbb00e551290f5bab3c061ecffe6af401e036a0b", 4492, "120085ef811dda57dc6a037ca0ac1a9484f617f419adaf2c20bfcf818717b2ab", "tests/l0-reprises-r2.test.ts"],
  ["100644", "d826a0bc08d861294b28f2949b2f28d82f5852eb", 6952, "41fbc7a2ada073989df7f9cce94c0f5bef0383c56cd54961de44c52dc1be72fc", "tests/lane-context.test.ts"],
  ["100644", "47218f239cbb15345399fb484b42e7d9ee48d75f", 19482, "a7424478eec406fa182fc0c2147bcf74864ae9b15e9352a532021721ff93d6ec", "tests/lane-ledger.test.ts"],
  ["100644", "27003fe18df229dca4bf3a6defec798a394b6c3a", 12536, "3f9b6b264634a1584a920bc3532f17baf63762d726739e84177c9817b04971f8", "tests/lanes-concurrency.test.ts"],
  ["100644", "445042c96dfd251a2681ddfde58d030ebedc087d", 2160, "071ed2504f7c4da9d2d36fc7062fb61ba9c23e57594c5a067d77c21d7d59241b", "tests/pi-contrats/contrats.test.ts"],
  ["100644", "c246fbd7f8faec5cf2fd43d4f3f5826a210a9ca1", 7963, "cfca3a7ca04782a6098eff12002c2dfb98c5a47a10d59216785d0d17440b28dd", "tests/pi-contrats/extensions-epreuve.ts"],
  ["100755", "e6e8061ce16e898f89675bfed93f10001fe18828", 20518, "8d3a0017461ef4fe8d9ccd88929fc2393a54d405cc0303f8582c7dad50eb4995", "tests/pi-contrats/falsifier.sh"],
  ["100644", "847a1df24ca70f84ee5a4dac4579083fd6f234c4", 12685, "95aacd5ce01d185238607b4e8ca248d12fd403815ae8e8c3b1f843718abc8bcd", "tests/pi-contrats/fournisseur-scripte.ts"],
  ["100644", "83f50119875e00b500b2c7d765406b0adfd08f6d", 7850, "a4450934dc44b072158465b8fafd23d745af346fe76c33a62921144c302dd7e7", "tests/pi-contrats/generer-identite.ts"],
  ["100644", "4172028c43730a865614eaa9e17d54a9cd97ba84", 119444, "5a014e851769616d8f3f7a53d7714cf8e7198d436d04eec91ec4296e4e577a54", "tests/pi-contrats/harnais.ts"],
  ["100644", "65811614c3c985224860d7e270c49d7670626e59", 1515669, "13ab33ab7f8eef55d7d51b78dcbce229c33302051d097013f8364f667c6e4f5f", "tests/pi-contrats/identite-0.86.0.json"],
  ["100644", "bead47a6eaa8c6749d0402bee7b02485afab395f", 1663288, "848d9a75ba96845943dd6a950514c92ceb5eaf4747695ff9606615b2fd50a079", "tests/pi-contrats/identite-0.99.0.json"],
  ["100644", "c9d90cf1e78f7d1b4613447fd346452064cf81bf", 16605, "777a0476c79bd473b67a28ce607eab5328f393e1a64d04587da1754fd26f293a", "tests/pi-contrats/identite.ts"],
  ["100644", "8b28a63f4264f73849e6c703444ee2ca2c66d2c1", 11366, "c38814bba6f3a4806fc947d1b335f98a8da9eb9634d9654b216dc4ceffb1b47d", "tests/pi-contrats/isolement.ts"],
  ["100644", "459470819572a14bb4a9cfa595e25eb3645e74cc", 5746, "90c649e02172a39463b33a32dfc281c903e1407ddde124f20ad0530b55465212", "tests/pi-contrats/lecteur-interprete.ts"],
  ["100644", "4009240bf813f154ca369636cab83999d92e6146", 7207, "86d485988d4cf57531f2f2e3923eeef98e3e5c3d8d5c012d6dbebeea1d464dc0", "tests/pi-contrats/modes.ts"],
  ["100644", "b2d95acfc4fb989a8ba573d48f8c964285335237", 173620, "9db32a427b6fa1b63ca01c28761e71d54232db30403e84fc50b3645fcccdcf52", "tests/pi-contrats/scenarios.ts"],
  ["100644", "243b9c50e8e942bfeb1ad261c73888037f8540a3", 18540, "2324bad7f16009d06c131116727cc35c2c54d6037eac5a5192f42f7db76b785e", "tests/pi-contrats/sonde.ts"],
  ["100644", "8e6e48bfb97c7fe9701d4064e975064673999d20", 1767, "061642196bfac4158ea57e1218d56242f3d2238afbfe6712f33b1156b371d6c5", "tests/pi-contrats/substituer-harnais.mjs"],
  ["100644", "720a6ea6dae683422aac5d64f9fb07f53350eb29", 13676, "fed2dd9716a6a3f042d736363451db0356aeef97ec985bdf1d5856bb255ce60e", "tests/pi-contrats/trace-resolution.mjs"],
  ["100644", "e74598509d97ba6c692b132cef6815f4df2268fe", 14515, "f27d3e5970a883a850d729af71d1d667205c7072fbab8e3605d95eb0241d3a53", "tests/pi-contrats/verificateurs.test.ts"],
  ["100644", "aaf7cadd2ec77cb7df8d44b41667dabbe31279bf", 59424, "b3060c092dd4294767c2d1946b0288f3e6e6227d33a2bb20ac08bc61c37d5a56", "tests/pi-surface.json"],
  ["100644", "4b59cbf4153fa23755af783bd851ef73b21b8897", 7655, "627a5ca980b785789ed63e77e8049139c4aa208d5c0dfcac8dea6eec6094f491", "tests/plan-corpus.json"],
  ["100644", "ab17dafa64a5b236e1385b84fe609f72e9194d16", 5867, "1d09a89b10fae77ae05c15d4e748e03f3f64d45223c3ff1e00ae9f1d3a45c999", "tests/repo-preflight.test.ts"],
  ["100644", "9c8e7fbcf946d7b3651c6cad9fc5af8df7758ce7", 5771, "5f2dc0f45735dfa1637e50d725a136499cc31711e3623119356f5adec3562d75", "tests/review-boundary.test.ts"],
  ["100644", "6a0b6aad32341b9576d97045d338b787d4a49a73", 12313, "67ca56a80f5b4f41bfaa966adcd4bbfd1706dea4a71ace5023087813d7e4c194", "tests/risk-ledger.test.ts"],
  ["100644", "a3e8cc4adb8eeec02482bb09b700f74bb093c261", 4299, "b7687345151bc41dec31a679fbee2f2e489509c380e2b7cfff827d5847360d06", "tests/role-guard-harness.test.ts"],
  ["100644", "17da7f39f515b3d1140afe47a768e3fa209cb9ac", 194166, "6233246ec0a559126e748859ee952393d302e6fbe2644419533cc6020eee605e", "tests/run-manifest.test.ts"],
  ["100644", "344990d10c9f77682015b75cc5d12cd077e86c00", 15526, "ec2be17b0672df38b6b9757b187c149ade47ff599cfdeb5f21aaf1ca10071dc8", "tests/run-report.test.ts"],
  ["100644", "0c77ede1a0830bd3ec3327b5cfe7d49f2490c953", 17440, "e128d22474d568197aaf649ae0a663266a89908d709426c2809b4a59c136c7f4", "tests/scheduler.test.ts"],
  ["100644", "935d8161b8e8192679767ddb814331fb30a575d8", 5987, "4ec6e21588202bdc3eb2c9b02a2d6d541826f299c1347a35160ed41379d99f71", "tests/scope-corpus.json"],
  ["100644", "368727a776f4224090d33cab2b280dee2643092b", 13979, "ed1c940c083d1292719081f948ab0ebb670b0365fe01ff6c9f46db0390d210bc", "tests/session-journal.test.ts"],
  ["100644", "05ef7dc2d01a97b414cd31c3061b0009ef328456", 3536, "e9439810e51b032e416ea0d4d993d8bd74191fdd72cdff089982a165c605cd19", "tests/signals.test.ts"],
  ["100644", "0c71544801a45d7ccf1782b91c117dce7cfdbe60", 492, "1c676a83c123c2428fd650cd717b6681a04f4ed8b926d5ccf7f28aeaac76b92c", "tests/stubs/data-epreuve.d.ts"],
  ["100644", "e91a334ee04e806e1737199478cd2fb5482c05e5", 5019, "3a63b8af87d0c7c60426565fe8bab1d7c6a2a7452414d30a8c50efe34f4a2453", "tests/stubs/dispatch.ts"],
  ["100755", "a5186011a04526b0dd891411400577d9e4c8d24d", 2152, "d58e1128da1976c6da564dbda6851e1856fc71e51df0968f6fcd840e22ba954c", "tests/stubs/fake-pi.mjs"],
  ["100644", "40ad1ac42222c4983286eb16ea58ac4dbc8ca742", 635, "4dbf22fef5b07ca41cb998b90c1f41ca9a386bddc6f13e8c69e5a0dc2c33af18", "tests/stubs/loader.mjs"],
  ["100644", "08ea9a1663781ee6184456b7f321758885e4ea33", 8259, "ee21bda9c9301215f71e26ce3d1a10a15c3c037ebee814d882e965df07d9f99d", "tests/stubs/pi-ai.d.ts"],
  ["100644", "92dd5f815cf98fe0af11e659f5e69ee640a1563a", 2278, "1c8db6a7b6de379b455618039050e18d751e406ce12290ce2c7794635ca7a4eb", "tests/stubs/pi-coding-agent.ts"],
  ["100644", "37ea7eff9bc8095af22b84d2b28ed5c3fb2c552b", 1479, "be1144dbe4b4f225a988caddf6e8e22663d7ccf4975a3021826520856eaa0e4c", "tests/stubs/pi-tui.d.ts"],
  ["100644", "86098ad9155528401c69fb273763f1f18be09935", 1374, "22440bc1014a2685676ea99e62b14ae1cc68d40f03677f08e3e6bfe75c4e5ef7", "tests/stubs/resolve-hooks.mjs"],
  ["100644", "8ba8d194b28abc073b3a7034039a65772074906b", 2307, "efaa913418fd283bc160d67329a4ea9cb8f90b6cb852454a2c4767d922e9c2cf", "tests/stubs/typebox.ts"],
  ["100644", "c28affeb51f54eedca9b2070c8a25ef365027439", 9413, "d752dbffd99bedfe3b6f48f6c8b188d3642499dbf97d8ef22a579fb5b0e663a9", "tests/task-policy.test.ts"],
  ["100644", "3118b0802190a3f1103072ba3b9a83e83de31c2b", 40825, "8442111b01a6e45013d6b56d99fd3965ba37d08171ca1e7e230b1709e0cf881a", "tests/test_run_cost.py"],
  ["100644", "d8ed337628e34ccba0163ee99703df305bd6633b", 29056, "dbb8906eb3279127eac92acd4a291b7c86f9f5ca8d4c2e4260ad002e20c3b93c", "tests/test_shadow.py"],
  ["100755", "b53a42e2257a8e449e8874fe61209f1b16ad0d7d", 3724, "719c25df85b483909cfe6c1ce7a4134640b047cb4d2a31ab0b4d85a010aea23f", "tests/tools/l0-check"],
  ["100755", "ea7e8942038c11913413710b568328ecf4353b2a", 13539, "93434e40e7549682b9be5d8dbd5415f5b3fc2a26f21b2494dfae06b13d40bdea", "tests/tools/l0-mutants"],
  ["100644", "aef6694dbca8d7e3c003a09e07f70a6d22e519a3", 4952, "ebbda0b341fd15e4e22852b2b9928ac87ed1b7186319f4bf1e8215bfdee792f6", "tests/tree.test.ts"],
  ["100644", "4f4130c9712ba5c964d5ab8377df41f174962284", 11394, "c992d92a179a0557029fc69d32f831333771d3021f2c545f098170b684517e51", "tests/work-units.test.ts"],
  ["100644", "29846e2f30c01fab9d0530d0c7a196c6d4475b70", 38235, "0ad68895db2489a931910b8f65eeeda0e6d7ab729f7a3a9364bdcdd077629fe6", "tests/worktree.test.ts"],
  ["100644", "28b68410fe3f05a40f10375e8969cfd7a343ba25", 2103, "4a274add22e23fcf50cb79bdb98c1fcd07705903cc881ce9ce3f08faf1ee211a", "themes/tokyonight.json"],
];
export const N5_DELTA: ReadonlyArray<readonly [string, string, string, string, string, string]> = [
  ["A", "000000", "100755", "0000000000000000000000000000000000000000", "d82f21d4aaa329dfdf9fb5b76a895069941d81f1", "bin/pi-contrats"],
  ["M", "100644", "100644", "1ad34f8fcd103ad072783f0af2902ed6b6e9ad72", "3963d51aeb40da749f8e292971dd406366eeb528", "extensions/subagent/index.ts"],
  ["M", "100644", "100644", "1ed7de83ec6e4295db9b45f8a22470c1cf75d177", "11fff714361e5c07a69a5fd5fdd9145db7bdde4b", "subagent-only/dispatch.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "8ba2fcb02eb25b8dc96b56b5ad1de2b092076821", "subagent-only/pi-adapt.ts"],
  ["M", "100644", "100644", "b26bf87b70a47c432faf25510dc580e78d949c7a", "18e33403ebf87b0ef27e93c67a9595798ea1629b", "subagent-only/spawn-args.ts"],
  ["M", "100644", "100644", "6682150dbb776499de9b9e5db9d37575e1f977e0", "fa01354bdc65f333c538f8dce47a9010225f298e", "subagent-only/test-command.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "1671a269bb751751478ce530bead6cfcadf35f63", "tests/fixtures/pi-adapt/generer-references.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "03f55234b76ebae90e5feb6e14f55505d29ec6d2", "tests/fixtures/pi-adapt/references-b5453204.json"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "c1fbeeb820daf41562b8538909a6381f053f10f0", "tests/fixtures/pi-adapt/transcriptions/commande-de-test.jsonl"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "72a265b1fca49ad80525a977720eb66bd5f1df05", "tests/fixtures/pi-adapt/transcriptions/erreur-fournisseur.jsonl"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "0a8c8ee44ec2e86d57ec3c8ca61db2329cef7cd6", "tests/fixtures/pi-adapt/transcriptions/nominal.jsonl"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "c72ded35dd5c04ada68674a25e154b0e941cd55c", "tests/fixtures/pi-adapt/transcriptions/submit-refuse-puis-accepte.jsonl"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "9e2d7654a47afc35599e2cb07f08be755e7b94f3", "tests/fixtures/pi-surface/acces-calcule.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "da0b599d88e3eff3ec9e82319cfe853c9b3e63b6", "tests/fixtures/pi-surface/alias.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "795cbadb40a25c0da4fa29f07abb42b6a714105d", "tests/fixtures/pi-surface/ctx.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "406d358991de144a853ce66fe9ad8e6c0a97c9ab", "tests/fixtures/pi-surface/destructuration.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "f98ce2d4d7b0d6e206731708b88cfb7224d5eabf", "tests/fixtures/pi-surface/drapeau.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "d944858b14a95e25a08ccba62ae51ac3df67dcd1", "tests/fixtures/pi-surface/evenement.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "44b040fffd1b203d868bc389e7685b05b090e84b", "tests/fixtures/pi-surface/flux.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "388d68ed3682a5608a62af0c799b9bcf5b577ab3", "tests/fixtures/pi-surface/import.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "8619baff196f18dc8803aa2e5c309bc00d3523fb", "tests/fixtures/pi-surface/methode.ts.txt"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "44fd2eaf5040d947d012924889ae7dbda3dafff9", "tests/fixtures/pi-surface/python-cle.py"],
  ["M", "100644", "100644", "0b3062e127d0aabf248999f25c7f14de6c7bda0c", "a200bd34c62d52dd30abb8e8bf09bfae54005e9d", "tests/l0-b2-harness.ts"],
  ["M", "100644", "100644", "8a3bd9aa8b5addbe45bb71e0766bd3c474b7f455", "1f76c73f1d98900e26f9e4487af836010154edba", "tests/l0-mutants.json"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "11b21ba21151fad6f4ee54ecfd8198304f64108c", "tests/l0-pi-adapt.test.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "e7a7dbef835656de1705bdf5704bc2058846939e", "tests/l0-pi-surface.test.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "445042c96dfd251a2681ddfde58d030ebedc087d", "tests/pi-contrats/contrats.test.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "c246fbd7f8faec5cf2fd43d4f3f5826a210a9ca1", "tests/pi-contrats/extensions-epreuve.ts"],
  ["A", "000000", "100755", "0000000000000000000000000000000000000000", "e6e8061ce16e898f89675bfed93f10001fe18828", "tests/pi-contrats/falsifier.sh"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "847a1df24ca70f84ee5a4dac4579083fd6f234c4", "tests/pi-contrats/fournisseur-scripte.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "83f50119875e00b500b2c7d765406b0adfd08f6d", "tests/pi-contrats/generer-identite.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "4172028c43730a865614eaa9e17d54a9cd97ba84", "tests/pi-contrats/harnais.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "65811614c3c985224860d7e270c49d7670626e59", "tests/pi-contrats/identite-0.86.0.json"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "bead47a6eaa8c6749d0402bee7b02485afab395f", "tests/pi-contrats/identite-0.99.0.json"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "c9d90cf1e78f7d1b4613447fd346452064cf81bf", "tests/pi-contrats/identite.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "8b28a63f4264f73849e6c703444ee2ca2c66d2c1", "tests/pi-contrats/isolement.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "459470819572a14bb4a9cfa595e25eb3645e74cc", "tests/pi-contrats/lecteur-interprete.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "4009240bf813f154ca369636cab83999d92e6146", "tests/pi-contrats/modes.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "b2d95acfc4fb989a8ba573d48f8c964285335237", "tests/pi-contrats/scenarios.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "243b9c50e8e942bfeb1ad261c73888037f8540a3", "tests/pi-contrats/sonde.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "8e6e48bfb97c7fe9701d4064e975064673999d20", "tests/pi-contrats/substituer-harnais.mjs"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "720a6ea6dae683422aac5d64f9fb07f53350eb29", "tests/pi-contrats/trace-resolution.mjs"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "e74598509d97ba6c692b132cef6815f4df2268fe", "tests/pi-contrats/verificateurs.test.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "aaf7cadd2ec77cb7df8d44b41667dabbe31279bf", "tests/pi-surface.json"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "0c71544801a45d7ccf1782b91c117dce7cfdbe60", "tests/stubs/data-epreuve.d.ts"],
  ["M", "100755", "100755", "e7683f4d3b5741a6a769cf2a153e8bb3b40e0dad", "a5186011a04526b0dd891411400577d9e4c8d24d", "tests/stubs/fake-pi.mjs"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "08ea9a1663781ee6184456b7f321758885e4ea33", "tests/stubs/pi-ai.d.ts"],
  ["A", "000000", "100644", "0000000000000000000000000000000000000000", "37ea7eff9bc8095af22b84d2b28ed5c3fb2c552b", "tests/stubs/pi-tui.d.ts"],
  ["M", "100644", "100644", "d01fa07cc7bbca73f7cb82703e5799cb5554b52b", "8ba8d194b28abc073b3a7034039a65772074906b", "tests/stubs/typebox.ts"],
];
export const N5_ANNEXE_OCTETS: ReadonlyArray<readonly [string, number, string, string]> = [
  ["755", 3515, "bae4c69e02c4587f98343175078bd7618decffccd86966192f89bae68194f722", "bin/pi-contrats"],
  ["644", 309047, "9d97f0958ff62fe9a0004d6c98bfb692765fe2fd843ca84c88055c3abc5e9521", "extensions/subagent/index.ts"],
  ["644", 36210, "2e468764ab0692725c079d038c40ca1c6f804bde2832dab41c75c7a2342e36ce", "subagent-only/dispatch.ts"],
  ["644", 8562, "5c6c1b9d7ac49834e39b6f4e7c1a25dca783e5e5528fae248bbb7b54ec258189", "subagent-only/pi-adapt.ts"],
  ["644", 22857, "0820cdea0a52b2c50da54373d0e2de45fed5838fa24943a267e00b0e63a42cec", "subagent-only/spawn-args.ts"],
  ["644", 20191, "ec11f842f6b08986451805e6d6f3db87ee02750d0b6b0161abfcee2e2bec28b1", "subagent-only/test-command.ts"],
  ["644", 21113, "a9cea47f68c4445244140c3da6f0bebad12f79e187945c9396596846f530e4fe", "tests/fixtures/pi-adapt/generer-references.ts"],
  ["644", 195995, "6b9df7357eb179d7d7fe530eeedf308b1e6d600b3dcf26b46f50de705b8e15fc", "tests/fixtures/pi-adapt/references-b5453204.json"],
  ["644", 30048, "8c03a83add1c27f344fef834281494dc192bba21e2b47531ed6394d14443bd15", "tests/fixtures/pi-adapt/transcriptions/commande-de-test.jsonl"],
  ["644", 20461, "79bf0b5e543e594a0557ee2adee1ea5dcb83137660877e54ac17a0b02282c16d", "tests/fixtures/pi-adapt/transcriptions/erreur-fournisseur.jsonl"],
  ["644", 26537, "b2ec3f073e4e31284585f72ebb0fc1bc170305154c1fcc7b8ab06d515fa55da9", "tests/fixtures/pi-adapt/transcriptions/nominal.jsonl"],
  ["644", 32282, "4feed42f8b659750a4b6a34d8820c445374dc79250fdfab9495618636a5694de", "tests/fixtures/pi-adapt/transcriptions/submit-refuse-puis-accepte.jsonl"],
  ["644", 1059, "4d9b92cffc451d51156a52a3d708ae22ed9f91590fe181600c961b2d5a436aaf", "tests/fixtures/pi-surface/acces-calcule.ts.txt"],
  ["644", 1832, "51261a1b5ac9aa5f291e9a4da50be24e49271f2ea8b2d482f45a07bc8e75b5ec", "tests/fixtures/pi-surface/alias.ts.txt"],
  ["644", 919, "9c9ebe874dba0bb89720016d237cf81f27ed065572f467727cd5ae6fac37032f", "tests/fixtures/pi-surface/ctx.ts.txt"],
  ["644", 625, "334886baa5fc2cc17e0cd72d4c3edaa07a2b032711334dca30e1843ed4c09cb8", "tests/fixtures/pi-surface/destructuration.ts.txt"],
  ["644", 279, "eb2c90bb3b1e01c916e05d298089add9ec0af105dab9d493b6f2cb1faf205242", "tests/fixtures/pi-surface/drapeau.ts.txt"],
  ["644", 433, "72fb332f8f02f4a7a8afddcadc2d318c0b3c2ae0c8cbe6ff1dc4f1175fbada12", "tests/fixtures/pi-surface/evenement.ts.txt"],
  ["644", 1268, "31535866c2e9ffadb4bd95005fae7a40d746240bdd9829f6ac9159b5b04b9f1a", "tests/fixtures/pi-surface/flux.ts.txt"],
  ["644", 1605, "d74c8500f931284b608645de163a581ede3ee3db9ab285c7f04e0cf93fd36383", "tests/fixtures/pi-surface/import.ts.txt"],
  ["644", 668, "1517d3170cf9587ba0ec2a6d4e80c066107daeddb3427b172c06966be7daca68", "tests/fixtures/pi-surface/methode.ts.txt"],
  ["644", 877, "332affb831f1f3c99e77477b59671c2670ed0606ee1fdd0451d2778129909c96", "tests/fixtures/pi-surface/python-cle.py"],
  ["644", 18339, "e2e01835e68b3bc4bb368eb87e76809c8013937f24be674236d5c89218473b31", "tests/l0-b2-harness.ts"],
  ["644", 198905, "b661b25c40946c9472df1e3408cfcd659fab8eae203857746b9c18118d96d370", "tests/l0-mutants.json"],
  ["644", 18002, "dc9d3169174db696a70685e47d2fa583d2f0bcf6c3dd7f2c9f466cdb364a6fb8", "tests/l0-pi-adapt.test.ts"],
  ["644", 115572, "7a3820e049a3a7255b1459d5cc70076403f149fb70a144bb2f0b5dc10b7d5089", "tests/l0-pi-surface.test.ts"],
  ["644", 2160, "071ed2504f7c4da9d2d36fc7062fb61ba9c23e57594c5a067d77c21d7d59241b", "tests/pi-contrats/contrats.test.ts"],
  ["644", 7963, "cfca3a7ca04782a6098eff12002c2dfb98c5a47a10d59216785d0d17440b28dd", "tests/pi-contrats/extensions-epreuve.ts"],
  ["755", 20518, "8d3a0017461ef4fe8d9ccd88929fc2393a54d405cc0303f8582c7dad50eb4995", "tests/pi-contrats/falsifier.sh"],
  ["644", 12685, "95aacd5ce01d185238607b4e8ca248d12fd403815ae8e8c3b1f843718abc8bcd", "tests/pi-contrats/fournisseur-scripte.ts"],
  ["644", 7850, "a4450934dc44b072158465b8fafd23d745af346fe76c33a62921144c302dd7e7", "tests/pi-contrats/generer-identite.ts"],
  ["644", 119444, "5a014e851769616d8f3f7a53d7714cf8e7198d436d04eec91ec4296e4e577a54", "tests/pi-contrats/harnais.ts"],
  ["644", 1515669, "13ab33ab7f8eef55d7d51b78dcbce229c33302051d097013f8364f667c6e4f5f", "tests/pi-contrats/identite-0.86.0.json"],
  ["644", 1663288, "848d9a75ba96845943dd6a950514c92ceb5eaf4747695ff9606615b2fd50a079", "tests/pi-contrats/identite-0.99.0.json"],
  ["644", 16605, "777a0476c79bd473b67a28ce607eab5328f393e1a64d04587da1754fd26f293a", "tests/pi-contrats/identite.ts"],
  ["644", 11366, "c38814bba6f3a4806fc947d1b335f98a8da9eb9634d9654b216dc4ceffb1b47d", "tests/pi-contrats/isolement.ts"],
  ["644", 5746, "90c649e02172a39463b33a32dfc281c903e1407ddde124f20ad0530b55465212", "tests/pi-contrats/lecteur-interprete.ts"],
  ["644", 7207, "86d485988d4cf57531f2f2e3923eeef98e3e5c3d8d5c012d6dbebeea1d464dc0", "tests/pi-contrats/modes.ts"],
  ["644", 173620, "9db32a427b6fa1b63ca01c28761e71d54232db30403e84fc50b3645fcccdcf52", "tests/pi-contrats/scenarios.ts"],
  ["644", 18540, "2324bad7f16009d06c131116727cc35c2c54d6037eac5a5192f42f7db76b785e", "tests/pi-contrats/sonde.ts"],
  ["644", 1767, "061642196bfac4158ea57e1218d56242f3d2238afbfe6712f33b1156b371d6c5", "tests/pi-contrats/substituer-harnais.mjs"],
  ["644", 13676, "fed2dd9716a6a3f042d736363451db0356aeef97ec985bdf1d5856bb255ce60e", "tests/pi-contrats/trace-resolution.mjs"],
  ["644", 14515, "f27d3e5970a883a850d729af71d1d667205c7072fbab8e3605d95eb0241d3a53", "tests/pi-contrats/verificateurs.test.ts"],
  ["644", 59424, "b3060c092dd4294767c2d1946b0288f3e6e6227d33a2bb20ac08bc61c37d5a56", "tests/pi-surface.json"],
  ["644", 492, "1c676a83c123c2428fd650cd717b6681a04f4ed8b926d5ccf7f28aeaac76b92c", "tests/stubs/data-epreuve.d.ts"],
  ["755", 2152, "d58e1128da1976c6da564dbda6851e1856fc71e51df0968f6fcd840e22ba954c", "tests/stubs/fake-pi.mjs"],
  ["644", 8259, "ee21bda9c9301215f71e26ce3d1a10a15c3c037ebee814d882e965df07d9f99d", "tests/stubs/pi-ai.d.ts"],
  ["644", 1479, "be1144dbe4b4f225a988caddf6e8e22663d7ccf4975a3021826520856eaa0e4c", "tests/stubs/pi-tui.d.ts"],
  ["644", 2307, "efaa913418fd283bc160d67329a4ea9cb8f90b6cb852454a2c4767d922e9c2cf", "tests/stubs/typebox.ts"],
];

const blobGit = (o: Buffer) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${o.length}\0`), o])).digest("hex");

/** Arbre Git recalculé en mémoire à partir d'entrées (mode, blob, chemin), au format des objets tree. */
export function arbreDeTable(entrees: ReadonlyArray<readonly [string, string, string]>): string {
  type Noeud = Map<string, Noeud | readonly [string, string]>;
  const racine: Noeud = new Map();
  for (const [mode, b, chemin] of entrees) {
    const parts = chemin.split("/");
    let n = racine;
    for (const d of parts.slice(0, -1)) {
      let s = n.get(d);
      if (s === undefined) {
        s = new Map();
        n.set(d, s);
      }
      if (!(s instanceof Map)) throw new Error(`chemin incohérent dans la table : ${chemin}`);
      n = s;
    }
    if (n.has(parts[parts.length - 1])) throw new Error(`chemin en double dans la table : ${chemin}`);
    n.set(parts[parts.length - 1], [mode, b]);
  }
  const ecrire = (n: Noeud): string => {
    const items: Array<[Buffer, Buffer]> = [];
    for (const [nom, v] of n) {
      if (v instanceof Map) items.push([Buffer.from(`${nom}/`), Buffer.concat([Buffer.from(`40000 ${nom}\0`), Buffer.from(ecrire(v), "hex")])]);
      else items.push([Buffer.from(nom), Buffer.concat([Buffer.from(`${v[0]} ${nom}\0`), Buffer.from(v[1], "hex")])]);
    }
    // Git trie les entrées d'un tree par les octets du nom, un sous-arbre comptant comme « nom/ ».
    items.sort((a, b) => Buffer.compare(a[0], b[0]));
    const corps = Buffer.concat(items.map((x) => x[1]));
    return createHash("sha1").update(Buffer.concat([Buffer.from(`tree ${corps.length}\0`), corps])).digest("hex");
  };
  return ecrire(racine);
}

type FichierN5 = { type: "fichier" | "repertoire" | "lien" | "autre"; mode?: string; taille?: number; sha256?: string; blob?: string };

/** Lectures établies sur un dépôt, sans jugement : entrée commune de la garde intégrée et des lecteurs locaux. */
export type EtatN5 = {
  contexte: ContexteN5;
  commandes: string[];
  chemin: { absolu: boolean; reel: string; liens: string[] };
  head: string;
  arbreHead: string;
  index: Array<{ stade: string; mode: string; blob: string; chemin: string }>;
  delta: string[][];
  travail: string[];
  physique: Record<string, FichierN5>;
  gitNonSuivis: string[];
  gitIgnores: string[];
  extras: { nonSuivis: string[]; ignores: string[] };
};

/** Champs d'une sortie Git à séparateurs NUL ; la dernière entrée doit être terminée. Aucun trim. */
function champsNul(b: Buffer, quoi: string): string[] {
  const s = b.toString("utf8");
  if (s === "") return [];
  if (!s.endsWith("\0")) throw new Error(`${quoi} : sortie non terminée par NUL`);
  return s.slice(0, -1).split("\0");
}

/**
 * Relevé brut d'un dépôt pour G-N5. Lève à la première lecture ou commande impossible ; ne fabrique aucune
 * valeur de substitution. N'écrit rien.
 */
export function releverN5(c: ContexteN5): EtatN5 {
  const commandes: string[] = [];
  const table = arbreDeTable(N5_TABLE.map(([m, b, , , p]) => [m, b, p] as const));
  if (table !== N5_ARBRE) throw new Error(`table embarquée incohérente : arbre ${table} ≠ ${N5_ARBRE}`);
  const depot = c.depot;
  const liens: string[] = [];
  const absolu = isAbsolute(depot);
  if (absolu) {
    let courant = "/";
    for (const comp of depot.split("/").filter(Boolean)) {
      courant = join(courant, comp);
      if (lstatSync(courant).isSymbolicLink()) liens.push(courant);
    }
  }
  const reel = realpathSync(depot);
  const g = lstatSync(join(depot, ".git"));
  if (g.isSymbolicLink() || !g.isDirectory()) throw new Error(`.git n'est pas un répertoire réel de ${depot}`);
  const env = { PATH: process.env.PATH ?? "", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (args: string[]): Buffer => {
    const r = spawnSync("git", ["--no-optional-locks", ...args], { cwd: depot, env, maxBuffer: 1 << 28 });
    commandes.push(`git ${args.join(" ")} → code ${r.status}`);
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} : code ${r.status} ; ${r.stderr.toString("utf8").split("\n")[0]}`);
    return r.stdout;
  };
  const ligne = (b: Buffer, quoi: string): string => {
    const s = b.toString("utf8");
    if (!/^[0-9a-f]{40}\n$/.test(s)) throw new Error(`${quoi} : sortie inattendue`);
    return s.slice(0, 40);
  };
  const head = ligne(git(["rev-parse", "--verify", "HEAD"]), "HEAD");
  const arbreHead = ligne(git(["rev-parse", "--verify", "HEAD^{tree}"]), "HEAD^{tree}");
  const index = champsNul(git(["ls-files", "-s", "-z"]), "ls-files -s").map((x) => {
    const m = /^([0-7]{6}) ([0-9a-f]{40}) ([0-3])\t(.+)$/s.exec(x);
    if (!m) throw new Error(`entrée d'index illisible : ${JSON.stringify(x)}`);
    return { mode: m[1], blob: m[2], stade: m[3], chemin: m[4] };
  });
  const brut = (args: string[], quoi: string): string[][] => {
    const f = champsNul(git(args), quoi);
    const out: string[][] = [];
    for (let i = 0; i < f.length; ) {
      const m = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z][0-9]*)$/.exec(f[i]);
      if (!m || i + 1 >= f.length) throw new Error(`${quoi} : entrée brute illisible ${JSON.stringify(f[i])}`);
      out.push([m[5], m[1], m[2], m[3], m[4], f[i + 1]]);
      i += 2;
    }
    return out;
  };
  const delta = brut(["diff", "--cached", "--raw", "--no-abbrev", "--no-renames", "-z", N5_BASE], "delta contre la base");
  const travail = brut(["diff", "--raw", "--no-abbrev", "--no-renames", "-z"], "index → arbre de travail").map((x) => x.join(" "));
  const gitNonSuivis = champsNul(git(["ls-files", "-z", "--others", "--exclude-standard", "--directory"]), "non-suivis");
  const gitIgnores = champsNul(git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"]), "ignorés");

  // Parcours physique de tout ce que l'isolement copierait, sans suivre de lien, hors .git racine.
  const physique: Record<string, FichierN5> = {};
  const parcourir = (rel: string): void => {
    const abs = rel ? join(depot, rel) : depot;
    for (const nom of readdirSync(abs).sort()) {
      if (!rel && nom === ".git") continue;
      const r = rel ? `${rel}/${nom}` : nom;
      const st = lstatSync(join(abs, nom));
      if (st.isSymbolicLink()) physique[r] = { type: "lien" };
      else if (st.isDirectory()) {
        physique[r] = { type: "repertoire" };
        parcourir(r);
      } else if (st.isFile()) {
        const o = readFileSync(join(abs, nom));
        if (o.length !== st.size) throw new Error(`lecture incomplète : ${r}`);
        physique[r] = { type: "fichier", mode: st.mode & 0o100 ? "100755" : "100644", taille: o.length, sha256: sha256(o), blob: blobGit(o) };
      } else physique[r] = { type: "autre" };
    }
  };
  parcourir("");

  // Chemins physiques supplémentaires : ni fichier de la table, ni parent d'un tel fichier, ni entrée
  // d'index (ou parent), celles-ci relevant de G-N5/index. Classement par les listes de Git.
  const admis = new Set<string>();
  const avecParents = (p: string) => {
    admis.add(p);
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) admis.add(parts.slice(0, i).join("/"));
  };
  for (const t of N5_TABLE) avecParents(t[4]);
  for (const e of index) avecParents(e.chemin);
  const couvre = (liste: string[], p: string, rep: boolean) => {
    const cle = rep ? `${p}/` : p;
    return liste.some((g) => cle === g || (g.endsWith("/") && cle.startsWith(g)));
  };
  const extras = { nonSuivis: [] as string[], ignores: [] as string[] };
  for (const p of Object.keys(physique).sort()) {
    if (admis.has(p)) continue;
    const rep = physique[p].type === "repertoire";
    const n = couvre(gitNonSuivis, p, rep);
    const i = couvre(gitIgnores, p, rep);
    if (n === i) throw new Error(`classement impossible du chemin supplémentaire ${p} (non-suivi ${n}, ignoré ${i})`);
    (n ? extras.nonSuivis : extras.ignores).push(p);
  }
  for (const g of [...gitNonSuivis, ...gitIgnores]) {
    const p = g.endsWith("/") ? g.slice(0, -1) : g;
    if (!physique[p]) throw new Error(`chemin listé par Git sans contrepartie physique : ${g}`);
  }
  return { contexte: c, commandes, chemin: { absolu, reel, liens }, head, arbreHead, index, delta, travail, physique, gitNonSuivis, gitIgnores, extras };
}

/** G-N5/releve : relevé de la garde. Désarmée par un mutant, rend null sans valeur de substitution. */
export function lireEtatN5(c: ContexteN5): EtatN5 | null {
  try {
    return releverN5(c);
  } catch (e) {
    refuser("G-N5/releve", `relevé impossible : ${(e as Error).message.split("\n")[0]}`);
    // Atteint seulement quand cette clause est désarmée par un mutant de falsifier.sh --n5.
    return null;
  }
}

const premiers = (l: string[], n = 6) => `${l.slice(0, n).join(" | ")}${l.length > n ? ` | … (${l.length})` : ""}`;

function ecartCheminN5(e: EtatN5): string | null {
  const { depot, cheminAttendu } = e.contexte;
  if (!e.chemin.absolu) return `chemin non absolu : ${depot}`;
  if (depot !== cheminAttendu) return `chemin ${depot} différent du chemin attendu ${cheminAttendu}`;
  if (e.chemin.reel !== depot) return `chemin non canonique : ${depot} (réel ${e.chemin.reel})`;
  if (e.chemin.liens.length) return `lien sur le parcours : ${e.chemin.liens.join(", ")}`;
  return null;
}

function ecartIndexN5(e: EtatN5): string | null {
  const stades = e.index.filter((x) => x.stade !== "0");
  if (stades.length) return `entrées d'index hors stade 0 : ${premiers(stades.map((x) => `${x.stade} ${x.chemin}`))}`;
  const obtenu = e.index.map((x) => `${x.mode} ${x.blob} ${x.chemin}`).sort();
  const attendu = N5_TABLE.map(([m, b, , , p]) => `${m} ${b} ${p}`).sort();
  if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) {
    const o = new Set(obtenu), a = new Set(attendu);
    return `index différent de la table ${N5_ARBRE} (${obtenu.length} entrées, ${attendu.length} attendues) : absentes ${premiers(attendu.filter((x) => !o.has(x)))} ; en plus ${premiers(obtenu.filter((x) => !a.has(x)))}`;
  }
  const d = e.delta.map((x) => x.join(" ")).sort();
  const da = N5_DELTA.map((x) => x.join(" ")).sort();
  if (JSON.stringify(d) !== JSON.stringify(da)) return `delta contre la base différent des ${da.length} entrées prévues (${d.length} obtenues)`;
  return null;
}

function ecartOctetsN5(e: EtatN5): string | null {
  const ecarts: string[] = [];
  const parChemin = new Map(N5_TABLE.map((t) => [t[4], t] as const));
  if (N5_ANNEXE_OCTETS.length !== 49) ecarts.push(`annexe : ${N5_ANNEXE_OCTETS.length} lignes, 49 attendues`);
  for (const [perm, taille, s, c] of N5_ANNEXE_OCTETS) {
    const t = parChemin.get(c);
    const mode = perm === "755" ? "100755" : perm === "644" ? "100644" : "?";
    if (!t || t[0] !== mode || t[2] !== taille || t[3] !== s) ecarts.push(`${c} : annexe différente de la table`);
    const f = e.physique[c];
    if (f?.type === "fichier" && f.sha256 !== s) ecarts.push(`${c} : SHA-256 lu différent de l'annexe`);
  }
  for (const [mode, blob, taille, s, c] of N5_TABLE) {
    const f = e.physique[c];
    if (!f) ecarts.push(`${c} : absent, ou atteint par un lien`);
    else if (f.type !== "fichier") ecarts.push(`${c} : ${f.type}, fichier ordinaire attendu`);
    else {
      if (f.mode !== mode) ecarts.push(`${c} : mode ${f.mode} ≠ ${mode}`);
      if (f.taille !== taille) ecarts.push(`${c} : taille ${f.taille} ≠ ${taille}`);
      if (f.sha256 !== s) ecarts.push(`${c} : SHA-256 ${f.sha256} ≠ ${s}`);
      if (f.blob !== blob) ecarts.push(`${c} : blob ${f.blob} ≠ ${blob}`);
    }
  }
  return ecarts.length ? `${ecarts.length} écart(s) d'octets : ${premiers(ecarts)}` : null;
}

/** Clauses de G-N5 (hors releve), dans l'ordre ; mêmes fonctions pour la garde intégrée et les lecteurs locaux. */
export function n5Chemin(e: EtatN5): void {
  const m = ecartCheminN5(e);
  if (m) refuser("G-N5/chemin", m);
}
export function n5Base(e: EtatN5): void {
  if (e.head !== N5_BASE || e.arbreHead !== N5_ARBRE_BASE) refuser("G-N5/base", `HEAD ${e.head} arbre ${e.arbreHead}, attendus ${N5_BASE}/${N5_ARBRE_BASE}`);
}
export function n5Index(e: EtatN5): void {
  const m = ecartIndexN5(e);
  if (m) refuser("G-N5/index", m);
}
export function n5Travail(e: EtatN5): void {
  if (e.travail.length) refuser("G-N5/travail", `index et arbre de travail diffèrent selon Git : ${premiers(e.travail)}`);
}
export function n5Octets(e: EtatN5): void {
  const m = ecartOctetsN5(e);
  if (m) refuser("G-N5/octets", m);
}
export function n5NonSuivis(e: EtatN5): void {
  if (e.extras.nonSuivis.length) refuser("G-N5/non-suivis", `chemins non suivis non ignorés : ${premiers(e.extras.nonSuivis)}`);
}
export function n5Ignores(e: EtatN5): void {
  if (e.extras.ignores.length) refuser("G-N5/ignores", `chemins ignorés présents : ${premiers(e.extras.ignores)}`);
}
export const CLAUSES_N5: Record<Exclude<ClauseN5, "releve">, (e: EtatN5) => void> = {
  chemin: n5Chemin,
  base: n5Base,
  index: n5Index,
  travail: n5Travail,
  octets: n5Octets,
  "non-suivis": n5NonSuivis,
  ignores: n5Ignores,
};

/** Relevé conservable d'un état (sans octets). */
export function rapportEtatN5(e: EtatN5): Record<string, unknown> {
  const types: Record<string, number> = {};
  for (const f of Object.values(e.physique)) types[f.type] = (types[f.type] ?? 0) + 1;
  return {
    contexte: e.contexte, commandes: e.commandes, chemin: e.chemin, head: e.head, arbreHead: e.arbreHead,
    index: { entrees: e.index.length, stades: [...new Set(e.index.map((x) => x.stade))] },
    delta: e.delta, travail: e.travail, physique: types, gitNonSuivis: e.gitNonSuivis, gitIgnores: e.gitIgnores, extras: e.extras,
  };
}

/** G-N5 complète, dans l'ordre N5_CLAUSES. Rend la ligne de relevé ; un refus lève. */
export function verifierCandidat(c: ContexteN5): string {
  appelsGardes.push("G-N5");
  const e = lireEtatN5(c);
  if (!e) return "relevé impossible (garde désarmée)";
  n5Chemin(e);
  n5Base(e);
  n5Index(e);
  n5Travail(e);
  n5Octets(e);
  n5NonSuivis(e);
  n5Ignores(e);
  const fichiers = Object.values(e.physique).filter((f) => f.type === "fichier").length;
  return `candidat ${e.contexte.depot} (attendu ${e.contexte.cheminAttendu} ; réel ${e.chemin.reel} ; aucun lien sur le parcours) ; HEAD ${e.head} arbre ${e.arbreHead} ; index ${e.index.length} entrées au stade 0, égal à la table ${N5_ARBRE} (arbre de table recalculé), delta ${e.delta.length} entrées conforme ; travail (Git) : aucun écart ; octets (lecture physique) : ${fichiers} fichiers, conformes en mode, taille, SHA-256 et blob ; non-suivis : aucun ; ignorés : aucun ; ${e.commandes.length} commandes Git`;
}

/**
 * Sélection de la garde d'une qualification nominale : "candidat" n'appelle que G-N5, "base" que G-I1-base.
 * Aucun repli : un refus est propagé tel quel, sans essai de l'autre garde ni autre dépôt.
 */
export function garderQualification(garde: "base" | "candidat", c: ContexteN5 | null): string {
  if (garde === "candidat" && !c) throw new Error("contexte G-N5 absent");
  return garde === "candidat" ? verifierCandidat(c!) : verifierBase(depotExplicite());
}

// ── Épreuves N5 (plan corrigé, § 5) : construites ; leur exécution relève d'une autorisation distincte ──

/** Une altération d'épreuve : premier refus d'intégration attendu et toutes les clauses affectées, déclarés. */
type CasN5 = {
  id: string;
  premier: ClauseN5;
  clauses: ClauseN5[];
  description: string;
  /** Altère la copie (ou son contexte) et rend le contexte de la contre-épreuve. */
  alterer: (copie: string, tmp: string) => ContexteN5;
};

const gitEpreuve = (copie: string, tmp: string, args: string[]): string =>
  execFileSync("git", ["-c", "user.name=PI Contrats", "-c", "user.email=pi-contrats@example.invalid", ...args], {
    cwd: copie, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
const ajouterA = (f: string, texte: string) => writeFileSync(f, readFileSync(f, "utf8") + texte);
const meme = (copie: string): ContexteN5 => ({ depot: copie, cheminAttendu: copie });

export const CAS_N5: CasN5[] = [
  { id: "G-N5/releve/git-absent", premier: "releve", clauses: ["releve"], description: ".git retiré de la copie",
    alterer: (c) => { rmSync(join(c, ".git"), { recursive: true }); return meme(c); } },
  { id: "G-N5/chemin/lien", premier: "chemin", clauses: ["chemin"], description: "copie valide atteinte par un lien symbolique",
    alterer: (c, tmp) => { symlinkSync(c, join(tmp, "lien")); return { depot: join(tmp, "lien"), cheminAttendu: join(tmp, "lien") }; } },
  { id: "G-N5/chemin/ailleurs", premier: "chemin", clauses: ["chemin"], description: "copie valide située ailleurs que le chemin attendu",
    alterer: (c, tmp) => { cpSync(c, join(tmp, "ailleurs"), { recursive: true, verbatimSymlinks: true, preserveTimestamps: true }); return { depot: realpathSync(join(tmp, "ailleurs")), cheminAttendu: c }; } },
  { id: "G-N5/base/head", premier: "base", clauses: ["base"], description: "HEAD détaché déplacé vers un objet de commit de test de même arbre de base ; index intact",
    alterer: (c, tmp) => {
      const o = gitEpreuve(c, tmp, ["commit-tree", N5_ARBRE_BASE, "-p", N5_BASE, "-m", "objet de test N5 (copie d'épreuve)"]);
      gitEpreuve(c, tmp, ["update-ref", "--no-deref", "HEAD", o]);
      return meme(c);
    } },
  { id: "G-N5/index/contenu", premier: "index", clauses: ["index", "octets"], description: "tests/pi-surface.json modifié puis indexé (travail = index)",
    alterer: (c, tmp) => { ajouterA(join(c, "tests", "pi-surface.json"), "\n"); gitEpreuve(c, tmp, ["add", "tests/pi-surface.json"]); return meme(c); } },
  { id: "G-N5/index/mode", premier: "index", clauses: ["index", "octets"], description: "tests/l0-pi-surface.test.ts rendu exécutable puis indexé",
    alterer: (c, tmp) => { chmodSync(join(c, "tests", "l0-pi-surface.test.ts"), 0o755); gitEpreuve(c, tmp, ["add", "tests/l0-pi-surface.test.ts"]); return meme(c); } },
  { id: "G-N5/index/ajout", premier: "index", clauses: ["index"], description: "nouveau fichier n5-ajout.txt indexé",
    alterer: (c, tmp) => { writeFileSync(join(c, "n5-ajout.txt"), "x\n"); gitEpreuve(c, tmp, ["add", "n5-ajout.txt"]); return meme(c); } },
  { id: "G-N5/index/retrait", premier: "index", clauses: ["index", "octets"], description: "tests/fixtures/pi-surface/flux.ts.txt retiré de l'index et de l'arbre de travail",
    alterer: (c, tmp) => { gitEpreuve(c, tmp, ["rm", "-q", "--cached", "tests/fixtures/pi-surface/flux.ts.txt"]); rmSync(join(c, "tests", "fixtures", "pi-surface", "flux.ts.txt")); return meme(c); } },
  { id: "G-N5/travail/contenu", premier: "travail", clauses: ["travail", "octets"], description: "subagent-only/dispatch.ts modifié sans indexation",
    alterer: (c) => { ajouterA(join(c, "subagent-only", "dispatch.ts"), "\n"); return meme(c); } },
  { id: "G-N5/octets/assume-unchanged", premier: "octets", clauses: ["octets"], description: "README.md, hérité de la base hors des 49 chemins, modifié et marqué assume-unchanged",
    alterer: (c, tmp) => { ajouterA(join(c, "README.md"), "\n"); gitEpreuve(c, tmp, ["update-index", "--assume-unchanged", "README.md"]); return meme(c); } },
  { id: "G-N5/octets/lien", premier: "travail", clauses: ["travail", "octets"], description: ".piignore, fichier suivi hérité de la base, remplacé par un lien vers .gitignore",
    alterer: (c) => { rmSync(join(c, ".piignore")); symlinkSync(".gitignore", join(c, ".piignore")); return meme(c); } },
  { id: "G-N5/non-suivis/fichier", premier: "non-suivis", clauses: ["non-suivis"], description: "fichier non suivi non ignoré hors-perimetre-n5.txt",
    alterer: (c) => { writeFileSync(join(c, "hors-perimetre-n5.txt"), "x\n"); return meme(c); } },
  { id: "G-N5/non-suivis/repertoire-vide", premier: "non-suivis", clauses: ["non-suivis"], description: "répertoire vide non ignoré vide-n5/",
    alterer: (c) => { mkdirSync(join(c, "vide-n5")); return meme(c); } },
  { id: "G-N5/ignores/fichier", premier: "ignores", clauses: ["ignores"], description: "fichier ignoré debug-n5.log (motif *.log)",
    alterer: (c) => { writeFileSync(join(c, "debug-n5.log"), "x\n"); return meme(c); } },
  { id: "G-N5/ignores/repertoire-vide", premier: "ignores", clauses: ["ignores"], description: "répertoire vide ignoré cache/ (motif cache/)",
    alterer: (c) => { mkdirSync(join(c, "cache")); return meme(c); } },
];

/**
 * Copie d'épreuve du candidat nominal (contenu et .git, index compris) sous une racine temporaire
 * contrôlée. La source est le dépôt explicitement choisi, exigé égal au chemin nominal.
 */
function copieN5(tmp: string): string {
  const source = depotExplicite();
  if (source !== N5_CHEMIN_NOMINAL) throw new Error(`épreuves N5 : dépôt choisi ${source} ≠ candidat nominal ${N5_CHEMIN_NOMINAL}`);
  const dest = join(tmp, "candidat");
  cpSync(source, dest, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  return realpathSync(dest);
}

function stimuliN5(base: (path: string, extra?: Partial<Options>) => Options): Stimulus[] {
  return CAS_N5.map((cas) => ({
    id: cas.id, regle: `G-N5/${cas.premier}`, moment: "avant" as const,
    preparer: (path: string, tmp: string) => base(path, { verifierCandidatDe: cas.alterer(copieN5(tmp), tmp) }),
  }));
}

export type ResultatLocalN5 = { id: string; clause: ClauseN5; temoin: string; altere: string; contexteTemoin: ContexteN5; contexteAltere: ContexteN5 | null };

/**
 * Lecteur local d'une clause : témoin nominal sur la copie, puis altération du cas, lus et jugés par la
 * seule clause visée (mêmes fonctions que la garde intégrée). Les autres clauses ne sont pas exécutées.
 * Aucun appel de `tenter`, aucune tentative de lancer pi.
 */
export function lecteurLocalN5(id: string, clause: ClauseN5, conserver: string | null): ResultatLocalN5 {
  const cas = CAS_N5.find((x) => x.id === id);
  if (!cas) throw new Error(`cas N5 inconnu : ${id}`);
  if (!cas.clauses.includes(clause)) throw new Error(`clause ${clause} non déclarée pour ${id}`);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pi-n5-local-")));
  const evaluer = (ctx: ContexteN5, quoi: string): string => {
    try {
      let e: EtatN5 | null;
      if (clause === "releve") {
        e = lireEtatN5(ctx);
        if (!e) return "admis (relevé désarmé)";
      } else {
        e = releverN5(ctx);
      }
      // Conserver les entrées établies avant le jugement, y compris lorsque la clause refuse.
      if (conserver) writeFileSync(join(conserver, `${quoi}.etat.json`), JSON.stringify(e, null, 1) + "\n");
      if (clause !== "releve") CLAUSES_N5[clause](e);
      return "satisfait";
    } catch (x) {
      return x instanceof Refus ? `refus ${x.id} : ${x.message}` : `erreur : ${(x as Error).message.split("\n")[0]}`;
    }
  };
  try {
    if (conserver) mkdirSync(conserver, { recursive: true });
    const copie = copieN5(tmp);
    const contexteTemoin = meme(copie);
    const temoin = evaluer(contexteTemoin, "temoin");
    if (temoin !== "satisfait") throw new Error(`ARRÊT — lecteur N5 ${id}/${clause} : témoin ${temoin} ; altération non exécutée`);
    let contexteAltere: ContexteN5 | null = null;
    let altere: string;
    try {
      contexteAltere = cas.alterer(copie, tmp);
      altere = evaluer(contexteAltere, "altere");
    } catch (x) {
      altere = `erreur de préparation : ${(x as Error).message.split("\n")[0]}`;
    }
    return { id, clause, temoin, altere, contexteTemoin, contexteAltere };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Sélection et absence de repli (§ 5.3), sans pi. r2 : qualification candidate sur une copie neuve dont
 * l'index est altéré ; r5-candidat : copie témoin ; r5-base : dépôt de base choisi. Rend les appels de
 * garde observés et le nombre de tentatives de lancement.
 */
export function selectionN5(cas: "r2" | "r5-candidat" | "r5-base"): { cas: string; garde: string; resultat: string; refus: string | null; appels: string[]; tentatives: number } {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "pi-n5-selection-")));
  try {
    let garde: "base" | "candidat" = "candidat";
    let ctx: ContexteN5 | null = null;
    if (cas === "r2") ctx = CAS_N5.find((x) => x.id === "G-N5/index/contenu")!.alterer(copieN5(tmp), tmp);
    else if (cas === "r5-candidat") ctx = meme(copieN5(tmp));
    else if (cas === "r5-base") garde = "base";
    else throw new Error(`cas de sélection inconnu : ${String(cas)}`);
    let resultat = "", refus: string | null = null;
    try {
      resultat = garderQualification(garde, ctx);
    } catch (x) {
      if (!(x instanceof Refus)) throw x;
      refus = x.id;
      resultat = x.message;
    }
    return { cas, garde, resultat, refus, appels: [...appelsGardes], tentatives: compteurs.tentatives };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Empreintes et modes séparés : l'instrument utilisé, puis l'instrument contenu dans le dépôt choisi. */
function lignesEmpreintesInstrument(): string[] {
  const liste = (r: string) => [join(r, "bin", "pi-contrats"), ...readdirSync(join(r, "tests", "pi-contrats")).sort().map((f) => join(r, "tests", "pi-contrats", f))];
  const ligne = (r: string, f: string) => `  ${sha256(readFileSync(f))}  ${(statSync(f).mode & 0o777).toString(8)}  ${relative(r, f)}`;
  const L = [`empreintes de l'instrument utilisé (${RACINE_INSTRUMENT}) :`, ...liste(RACINE_INSTRUMENT).map((f) => ligne(RACINE_INSTRUMENT, f))];
  const d = depotExplicite();
  L.push(`empreintes de l'instrument contenu dans le dépôt (${d}) :`);
  if (!existsSync(join(d, "bin", "pi-contrats")) || !existsSync(join(d, "tests", "pi-contrats"))) L.push("  absent");
  else L.push(...liste(d).map((f) => ligne(d, f)));
  return L;
}

/** Une exécution du plan : tentative, observations, verdicts comparés aux états attendus déclarés. */
export type ResultatExecution = {
  id: string;
  conforme: boolean;
  ecarts: string[];
  verdicts: Verdict[];
  tentative: Tentative;
  observations: ObservationsMesure | null;
};

export function executer(x: Execution, path: string, conserver: string | null): ResultatExecution {
  const ecarts: string[] = [];
  // Contre-épreuve de version : l'installation 0.99.0 (dossier bin dans PI_CONTRATS_PATH_0990) remplace celle de l'opérateur.
  let chemin = path;
  if (x.version) {
    const d = process.env.PI_CONTRATS_PATH_0990;
    if (!d) ecarts.push("PI_CONTRATS_PATH_0990 absent : installation 0.99.0 inconnue");
    else chemin = [d, cheminsSans(path, installation(path).dossiersPi)].join(delimiter);
  }
  const t = tenter({ pathOperateur: chemin, scenario: x.scenario, ...(x.version ? { version: x.version, contreEpreuve: true } : {}) });
  const o = observer(t);
  const verdicts = o ? x.verifier(o) : [];
  if (t.refus) ecarts.push(`refus avant lancement : ${t.refus.id} ${t.refus.message}`);
  if (t.erreur) ecarts.push(`erreur${t.erreurApresLancement ? " après lancement" : ""} : ${t.erreur.message}`);
  if (!o) ecarts.push("aucune observation");
  if (!t.n6.etablie || t.n6.differences.length) ecarts.push(`N6 : ${texteN6(t.n6)}`);
  // A3 : un constat attendu vise une cible exacte ; tout autre constat garde son effet.
  const attendusConstats = (x.constatsAttendus ?? []).map((c) => ({ id: c.id, contient: o ? c.contient.split("<AGENTDIR>").join(o.agentDir) : c.contient }));
  const vus = new Set<number>();
  for (const a of attendusConstats) {
    const i = t.constats.findIndex((c, j) => !vus.has(j) && c.id === a.id && c.detail.includes(a.contient));
    if (i < 0) ecarts.push(`constat attendu absent : ${a.id} visant ${a.contient}`);
    else vus.add(i);
  }
  t.constats.forEach((c, j) => {
    if (!vus.has(j)) ecarts.push(`constat non attendu : ${c.etat} ${c.id} — ${c.detail.slice(0, 160)}`);
  });
  const produits = new Map(verdicts.map((v) => [v.clause, v]));
  if (x.nature === "nominal") for (const v of verdicts) if (!(v.clause in x.attendus)) ecarts.push(`clause produite non déclarée : ${v.clause}`);
  for (const [clause, etat] of Object.entries(x.attendus)) {
    const v = produits.get(clause);
    if (!v) ecarts.push(`${clause} : aucun verdict`);
    else if (v.etat !== etat) ecarts.push(`${clause} : ${v.etat}, ${etat} attendu`);
  }
  if (conserver) {
    try {
      const d = join(conserver, nomDossier(x.id));
      if (existsSync(d)) throw new Error(`${d} existe déjà : la conservation exige un dossier neuf`);
      conserverTentative(t, d, { "observations.json": o, "verdicts.json": verdicts, "execution.json": { id: x.id, nature: x.nature, description: x.description, attendus: x.attendus, vise: x.vise ?? null, cibles: x.cibles ?? null, constatsAttendus: x.constatsAttendus ?? [], version: x.version ?? null }, "scenario-materialise.json": t.scenario ?? null });
    } catch (e) {
      ecarts.push(`impossibilité de conservation : ${(e as Error).message}`);
    }
  }
  return { id: x.id, conforme: ecarts.length === 0, ecarts, verdicts, tentative: t, observations: o };
}

function lignesExecution(r: ResultatExecution, x: Execution, L: string[]): void {
  resumeTentative(`${x.id} (${x.nature}${x.version ? `, version ${x.version}, NON QUALIFIANT` : ""}) — ${x.description}`, r.tentative, L);
  if (r.tentative.argv && r.tentative.iso) L.push(`  argv : ${r.tentative.argv.map((a) => a.replace(depotExplicite(), "<dépôt>").replace(r.tentative.iso!.chemins.candidat, "<candidat>").replace(r.tentative.pi?.racine ?? "\u0000", "<pi>").replace(r.tentative.iso!.racine, "<tmp>")).join(" ")}`);
  for (const v of r.verdicts) {
    const att = x.attendus[v.clause];
    L.push(`  ${v.clause} : ${v.etat}${att ? ` (attendu ${att})` : " (non jugé)"} — compte ${v.compte} — ${v.detail}`);
  }
  L.push(`  RÉSULTAT ${x.id} : ${r.conforme ? "conforme aux états attendus" : `DIVERGENCE — ${r.ecarts.join(" ; ")}`}`);
}

/** Plan déclaré avant exécution : identifiants, scénarios (empreinte) et états attendus. */
export function textePlan(liste: Execution[]): string[] {
  return liste.map((x) => `  ${x.id} [${x.nature}] scénario ${x.scenario.nom} sha256 ${sha256(JSON.stringify(x.scenario))} ; attendus ${Object.entries(x.attendus).map(([k, v]) => `${k}=${v}`).join(", ")}${x.vise ? ` ; visée ${x.vise} ; mutant : ${x.cibles?.length ? `garde ${x.cibles.join(", ")}` : "aucun (plusieurs gardes, décomposée en (a))"}` : ""}${x.constatsAttendus?.length ? ` ; constats attendus ${x.constatsAttendus.map((c) => `${c.id} visant ${c.contient}`).join(", ")}` : ""}${x.scenario.agentDir?.["extensions/piege.ts"] ? ` ; piège PI_CODING_AGENT_DIR/${PIEGE_C6_2.relatif} sha256 ${PIEGE_C6_2.sha256} ; points d'entrée ${pointsEntree(x.scenario).map(([f, h]) => `${f} ${h}`).join(", ")}` : ""}`);
}

/** B2 : points d'entrée fichiers explicites d'un scénario (test-only et dépôt), avec leur empreinte avant lancement. */
function pointsEntree(s: Scenario): Array<[string, string]> {
  const f = ["fournisseur-scripte.ts", "sonde.ts", "extensions-epreuve.ts"].map((n) => [`tests/pi-contrats/${n}`, join(ICI, n)] as [string, string]);
  const d = (s.extensionsDepot ?? []).map((e) => [`<candidat>/${e}`, join(depotExplicite(), e)] as [string, string]);
  return [...f, ...d].map(([nom, chemin]) => [nom, sha256(readFileSync(chemin))]);
}

/** Comptes séparés de C2 (MATRICES § A), sur les verdicts des exécutions nominales. */
function comptesC2(resultats: ResultatExecution[]): string[] {
  const v = resultats.flatMap((r) => r.verdicts);
  const etat = (c: string) => v.find((x) => x.clause === c)?.etat ?? "absent";
  const points = Object.keys(POINTS_C2);
  const charges = points.filter((p) => etat(`${p}/chargement`) === "satisfait").length;
  const enreg = v.filter((x) => /^C2\.\d+\/enregistrements?(?:-|$)/.test(x.clause));
  const exiges = enreg.reduce((a, x) => a + x.compte, 0);
  const observes = enreg.filter((x) => x.etat === "satisfait").reduce((a, x) => a + x.compte, 0);
  const comportements = ["C2.1", "C2.2", "C2.3", "C2.4", "C2.5", "C2.6", "C2.7", "C2.8", "C2.9", "C2.11", "C2.12"];
  const compSat = comportements.filter((p) => v.filter((x) => x.clause.startsWith(`${p}/comportement`)).length > 0 && v.filter((x) => x.clause.startsWith(`${p}/comportement`)).every((x) => x.etat === "satisfait")).length;
  const resumes = resultats.reduce((a, r) => a + (r.observations?.fournisseur ?? []).filter((x) => x.forme === "resume").length, 0);
  const tours = resultats.reduce((a, r) => a + (r.observations?.flux ?? []).filter((x) => x.type === "turn_end").length, 0);
  return [
    `C2 — chargements : ${charges}/12 points d'entrée`,
    `C2 — enregistrements exigés : ${exiges} ; observés : ${observes}`,
    `C2 — comportements non-TUI : ${compSat}/11 satisfaits`,
    `C2 — exclusions explicites, non qualifiées : ${Object.entries(EXCLUSIONS_C2).map(([k, l]) => `${k} : ${l.join(", ")}`).join(" ; ")}`,
    `appels de résumé du fournisseur : ${resumes} ; tours de l'agent (turn_end du flux) : ${tours} — comptés séparément`,
  ];
}

/**
 * Campagne nominale : garde explicitement sélectionnée, plan déclaré, puis chaque exécution une fois.
 * `garde` vaut "base" (G-I1-base, campagne de l'item 1, sur le dépôt choisi) ou "candidat" (G-N5, candidat
 * final au chemin nominal N5_CHEMIN_NOMINAL, que ni argument ni environnement ne remplacent). Un refus de
 * garde impose ARRÊT sans aucune tentative de lancer pi, sans essai de l'autre garde. Toute divergence
 * ultérieure impose ARRÊT immédiat : les exécutions restantes ne sont pas lancées.
 */
export function qualifier(path: string, conserver: string | null, garde: "base" | "candidat"): { conforme: boolean; lignes: string[] } {
  const L: string[] = [];
  if (garde !== "base" && garde !== "candidat") return { conforme: false, lignes: [`ARRÊT — garde non sélectionnée (${String(garde)}) ; aucun lancement de pi`] };
  const nom = garde === "candidat" ? "G-N5" : "G-I1-base";
  L.push(garde === "candidat"
    ? `QUALIFICATION N5 DU CANDIDAT FINAL ${N5_ARBRE} — LOT-PI-ADAPT · ${new Date().toISOString()} · campagne nominale C1 à C8`
    : `QUALIFICATION DE L'ITEM 1 — LOT-PI-ADAPT · ${new Date().toISOString()} · campagne nominale C1 à C8`);
  L.push(`dépôt ${depotExplicite()} ; instrument ${RACINE_INSTRUMENT} ; garde sélectionnée ${nom}`);
  const contexte: ContexteN5 | null = garde === "candidat" ? { depot: depotExplicite(), cheminAttendu: N5_CHEMIN_NOMINAL } : null;
  try {
    L.push(`${nom} : ${garderQualification(garde, contexte)}`);
  } catch (e) {
    L.push(`ARRÊT — ${nom} : ${(e as Error).message} ; aucun lancement de pi`);
    L.push(`gardes appelées : ${appelsGardes.join(", ") || "aucune"} ; tentatives : ${compteurs.tentatives}`);
    return { conforme: false, lignes: L };
  }
  L.push(`gardes appelées : ${appelsGardes.join(", ")}`);
  if (conserver && garde === "candidat") {
    mkdirSync(conserver, { recursive: true });
    writeFileSync(join(conserver, "garde-n5.txt"), [L[1], L[2], L[3]].join("\n") + "\n");
  }
  L.push(...lignesEmpreintesInstrument());
  L.push("", "PLAN DÉCLARÉ AVANT EXÉCUTION", ...textePlan(EXECUTIONS_NOMINALES), "", "EXÉCUTIONS");
  if (conserver) {
    mkdirSync(conserver, { recursive: true });
    writeFileSync(join(conserver, "plan.txt"), textePlan(EXECUTIONS_NOMINALES).join("\n") + "\n");
  }
  const resultats: ResultatExecution[] = [];
  let arret: string | null = null;
  for (const x of EXECUTIONS_NOMINALES) {
    const r = executer(x, path, conserver);
    resultats.push(r);
    lignesExecution(r, x, L);
    if (!r.conforme) {
      arret = x.id;
      break;
    }
  }
  if (resultats[0]?.tentative.identite && resultats[0].tentative.pi && resultats[0].tentative.node) {
    const t = resultats[0].tentative;
    const n = (e: string) => Object.values(t.identite!.etats).filter((x) => x === e).length;
    L.push("", "IDENTITÉ", `  pi : ${t.pi!.chemin} → ${t.pi!.reel}`, `  node : ${t.node!.chemin} → ${t.node!.reel} ; ${t.node!.version}`, `  installation : ${t.identite!.paquets} paquets vérifiés (${n("conforme")} conformes, ${n("transforme-installation")} transformé) ; ${t.identite!.fichiers} fichiers examinés`);
  }
  L.push("", "COMPTES", ...comptesC2(resultats).map((x) => `  ${x}`));
  const verts = resultats.flatMap((r) => r.verdicts).filter((v) => v.etat === "satisfait").length;
  L.push(`  verdicts : ${resultats.flatMap((r) => r.verdicts).length} ; satisfaits : ${verts} ; exécutions : ${resultats.length}/${EXECUTIONS_NOMINALES.length}`);
  L.push("", arret ? `QUALIFICATION NOMINALE : ARRÊT à ${arret} — exécutions restantes non lancées ; retour à Sol` : "QUALIFICATION NOMINALE : toutes les exécutions conformes aux états attendus déclarés");
  return { conforme: !arret && resultats.length === EXECUTIONS_NOMINALES.length, lignes: L };
}

/** Une contre-épreuve réelle (b), une fois. */
export function contreEpreuveReelle(id: string, path: string, conserver: string | null): { conforme: boolean; lignes: string[] } {
  const x = CONTRE_EPREUVES_REELLES.find((y) => y.id === id);
  if (!x) return { conforme: false, lignes: [`contre-épreuve réelle inconnue : ${id}`] };
  const L: string[] = [`CONTRE-ÉPREUVE RÉELLE ${id} — ${new Date().toISOString()}${x.version ? " · NON QUALIFIANT" : ""}`];
  L.push("plan déclaré :", ...textePlan([x]));
  const r = executer(x, path, conserver);
  lignesExecution(r, x, L);
  return { conforme: r.conforme, lignes: L };
}

/** Observations conservées d'une exécution, cherchées dans les dossiers donnés (campagne, contre-épreuves). */
function lireObservations(dossiers: string[], id: string): ObservationsMesure {
  for (const d of dossiers) {
    const f = join(d, nomDossier(id), "observations.json");
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  throw new Error(`observations de ${id} introuvables dans ${dossiers.join(", ")}`);
}

const etatClause = (vs: Verdict[], clause: string) => vs.find((v) => v.clause === clause) ?? null;

/**
 * Réévaluation d'une contre-épreuve sur les observations conservées, sans relancer pi (B8) :
 * état et motif de la clause visée sur l'observation de la contre-épreuve, et état de la même
 * clause sur l'observation nominale. Le mutant mord si, sous lui, la contre-épreuve donne
 * « satisfait » et le nominal reste « satisfait » ; falsifier.sh en décide.
 */
export function reevaluer(dossiers: string[], id: string): { id: string; clause: string; attendu: string; etat: string; motif: string; nominal: string } {
  const toutes = [...EXECUTIONS_NOMINALES, ...CONTRE_EPREUVES_REELLES];
  const a = CONTRE_EPREUVES_A.find((x) => x.id === id);
  if (a) {
    const x = toutes.find((y) => y.id === a.execution)!;
    const o = lireObservations(dossiers, a.execution);
    const altere = JSON.parse(JSON.stringify(o));
    a.alterer(altere);
    const v = etatClause(x.verifier(altere), a.clause);
    // Nominal : l'observation nominale de l'exécution (ou de la nominale associée à la contre-épreuve réelle).
    const idNominal = a.source === "b" ? x.nominal! : a.execution;
    const xn = EXECUTIONS_NOMINALES.find((y) => y.id === idNominal)!;
    const n = etatClause(xn.verifier(lireObservations(dossiers, idNominal)), a.clause);
    return { id, clause: a.clause, attendu: a.attendu, etat: v?.etat ?? "absent", motif: v?.detail ?? "", nominal: n?.etat ?? "absent" };
  }
  const b = CONTRE_EPREUVES_REELLES.find((x) => x.id === id);
  if (!b || !b.vise || !b.nominal) throw new Error(`contre-épreuve inconnue ou sans clause visée : ${id}`);
  const v = etatClause(b.verifier(lireObservations(dossiers, id)), b.vise);
  const xn = EXECUTIONS_NOMINALES.find((y) => y.id === b.nominal)!;
  const n = etatClause(xn.verifier(lireObservations(dossiers, b.nominal)), b.vise);
  return { id, clause: b.vise, attendu: b.attendus[b.vise], etat: v?.etat ?? "absent", motif: v?.detail ?? "", nominal: n?.etat ?? "absent" };
}

/** Contre-épreuves (a) des vérificateurs sur les observations nominales conservées. */
export function contreEpreuvesA(dossiers: string[], ids?: string[]): { conforme: boolean; lignes: string[] } {
  const L: string[] = [`CONTRE-ÉPREUVES (a) DES VÉRIFICATEURS — ${new Date().toISOString()} — observations ${dossiers.join(", ")}`];
  let n = 0, ok = 0;
  for (const a of CONTRE_EPREUVES_A.filter((x) => !ids || ids.includes(x.id))) {
    n++;
    let r;
    try {
      r = reevaluer(dossiers, a.id);
    } catch (e) {
      L.push(`  ${a.id} (${a.clause}) : ÉCHEC — ${(e as Error).message}`);
      continue;
    }
    const bon = r.nominal === "satisfait" && r.etat === a.attendu;
    if (bon) ok++;
    L.push(`  ${a.id} (${a.clause}${a.source === "b" ? `, observation de ${a.execution}` : ""}) : nominal ${r.nominal} ; altérée ${r.etat}, ${a.attendu} attendu — ${bon ? "conforme" : "ÉCHEC"} ; garde visée ${a.cibles.join(", ")} ; motif : ${r.motif.slice(0, 220)}`);
  }
  L.push(`CONTRE-ÉPREUVES (a) : ${ok}/${n} conformes`);
  return { conforme: n > 0 && ok === n, lignes: L };
}

/** Mutants des vérificateurs : identifiant de contre-épreuve et gardes qu'il désarme. */
export function mutantsVerificateurs(): Array<{ id: string; cibles: string[]; nature: "a" | "b" }> {
  return [
    ...CONTRE_EPREUVES_A.map((a) => ({ id: a.id, cibles: a.cibles, nature: "a" as const })),
    ...CONTRE_EPREUVES_REELLES.filter((b) => b.vise && b.cibles?.length).map((b) => ({ id: b.id, cibles: b.cibles!, nature: "b" as const })),
  ];
}
void ({} as ContreEpreuveA);
