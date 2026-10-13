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
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Indetermine, Refus, candidats, ignorer, paquetDe, refuser, resoudreNode, resoudrePi, sha256, verifierIdentiteDeclaree, verifierInstallation, type CibleNode, type CiblePi, type RapportIdentite } from "./identite.ts";
import { capturerPiReel, construire, differences, inventaire, verifierIsolement, type Inventaire, type Isolement } from "./isolement.ts";
import { PIEGE_C6_2, C2_11 as C2_11_S, C2_12 as C2_12_S, CONTRE_EPREUVES_A, CONTRE_EPREUVES_REELLES, EXECUTIONS_NOMINALES, EXCLUSIONS_C2, POINTS_C2, SCOPE_C2_11, type ContreEpreuveA, type EntreeCwd, type Execution, type Simulateur } from "./scenarios.ts";
import { CHUNK_RESUME, ERREUR_FOURNISSEUR, IMAGE, KEEP_RECENT_TOKENS_K9, MESURES_PREALABLES, NOMINAL, REDEFINITION_READ, SUBMIT, SUMMARIZATION_SYSTEM_PROMPT, SUMMARIZATION_SYSTEM_PROMPT_SHA256, TEMOINS, VIRTUELS, verifierC2_7, verifierC2_8, verifierC3, verifierC3_2, verifierC7, verifierC8_2, type ObservationsMesure, type Scenario, type Verdict } from "./scenarios.ts";
import type { Identite } from "./generer-identite.ts";

export const VERSION_QUALIFIEE = "0.86.0";
const ICI = dirname(fileURLToPath(import.meta.url));
export const ICI_CONTRATS = ICI;
export const DEPOT = resolve(ICI, "..", "..");
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
    const iso = construire(piReel, { candidatSource: DEPOT, outils: { git: outil("git"), bash: outil("bash"), sh: outil("sh") } });
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
  node: { evenements: number; fils: number[]; chargements: number; resolutions: number; echecs: Array<{ spec: string; code: string }>; horsInstallation: string[]; verifies: number; enveloppes: any };
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
  for (const r of ev.filter((e) => e.t === "resolve")) {
    const f = cheminFichier(r.url);
    if (f && !paquetDe(pi.racine, f, identite)) invalider("trace-node-hors", `résolution par Node hors de l'installation contrôlée : ${r.url}`);
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
    else evenements.push(e);
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
  const virtuels: string[] = [];
  const natifs: string[] = [];
  const specsResolues = new Set(ev.filter((x) => x.t === "resolve" || x.t === "resolve-echec").map((x) => x.spec));
  for (const e of evenements) {
    const chemin = (x: string) => (x === "." ? chemins.cwd : x.startsWith("./") ? join(chemins.cwd, x.slice(2)) : x);
    if (e.forme === "transpile" || e.forme === "json" || e.forme === "fallback" || e.forme === "esm-fallback") {
      const f = chemin(e.ids[e.ids.length - 1]);
      transpiles.push(f);
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
        base(path, { alterer: (x) => ({ ...x, argv: ["--import", join(DEPOT, "tests", "stubs", "loader.mjs"), ...x.argv] }) }),
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
  ];
  return s;
}

/** Les 38 épreuves historiques d'etape0-r3 (falsifier.sh sans argument), sans les épreuves de l'item 1. */
export const ITEM1_REFUS = (id: string) => /^(M6\.14\/|M6\.15\/|G-I1-base\/)/.test(id);

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
    const source = process.env.PI_CONTRATS_DEPOT_GIT ?? DEPOT;
    const d = join(tmp, "depot");
    execFileSync("git", ["clone", "-q", source, d], { stdio: "ignore", env: { PATH: process.env.PATH ?? "", HOME: tmp } });
    for (const f of ["bin/pi-contrats", ...readdirSync(ICI).map((x) => `tests/pi-contrats/${x}`)]) cpSync(join(DEPOT, f), join(d, f));
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
  L.push(`dépôt ${DEPOT}`);
  const idChemin = join(ICI, `identite-${VERSION_QUALIFIEE}.json`);
  L.push(`identité ${relative(DEPOT, idChemin)} sha256 ${sha256(readFileSync(idChemin))} ; générateur sha256 ${sha256(readFileSync(join(ICI, "generer-identite.ts")))}`);

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
    L.push(`  argv : ${(nominal.argv ?? []).map((a) => a.replace(DEPOT, "<dépôt>").replace(nominal.pi!.racine, "<pi>")).join(" ")}`);
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
  L.push(`dépôt ${DEPOT}`);
  try {
    const git = (a: string[]) => execFileSync("git", a, { cwd: DEPOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }).trim();
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
  L.push("empreintes de l'instrument :");
  const fichiersInstrument = [join(DEPOT, "bin", "pi-contrats"), ...readdirSync(ICI).sort().map((f) => join(ICI, f))];
  for (const f of fichiersInstrument) L.push(`  ${sha256(readFileSync(f))}  ${relative(DEPOT, f)}`);
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
    L.push(`  argv : ${(t.argv ?? []).map((a) => a.replace(DEPOT, "<dépôt>").replace(t.iso!.chemins.candidat, "<candidat>").replace(t.pi?.racine ?? "\u0000", "<pi>")).join(" ")}`);
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
export function verifierBase(depot: string = DEPOT): string {
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
  if (r.tentative.argv && r.tentative.iso) L.push(`  argv : ${r.tentative.argv.map((a) => a.replace(DEPOT, "<dépôt>").replace(r.tentative.iso!.chemins.candidat, "<candidat>").replace(r.tentative.pi?.racine ?? "\u0000", "<pi>").replace(r.tentative.iso!.racine, "<tmp>")).join(" ")}`);
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
  const d = (s.extensionsDepot ?? []).map((e) => [`<candidat>/${e}`, join(DEPOT, e)] as [string, string]);
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
 * Campagne nominale de l'item 1 : G-I1-base, plan déclaré, puis chaque exécution une fois. Toute
 * divergence impose ARRÊT immédiat : les exécutions restantes ne sont pas lancées.
 */
export function qualifier(path: string, conserver: string | null): { conforme: boolean; lignes: string[] } {
  const L: string[] = [];
  L.push(`QUALIFICATION DE L'ITEM 1 — LOT-PI-ADAPT · ${new Date().toISOString()} · campagne nominale C1 à C8`);
  L.push(`dépôt ${DEPOT}`);
  try {
    L.push(`G-I1-base : ${verifierBase()}`);
  } catch (e) {
    L.push(`ARRÊT — G-I1-base : ${(e as Error).message} ; aucun lancement de pi`);
    return { conforme: false, lignes: L };
  }
  L.push("empreintes de l'instrument :");
  for (const f of [join(DEPOT, "bin", "pi-contrats"), ...readdirSync(ICI).sort().map((f) => join(ICI, f))]) L.push(`  ${sha256(readFileSync(f))}  ${relative(DEPOT, f)}`);
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
