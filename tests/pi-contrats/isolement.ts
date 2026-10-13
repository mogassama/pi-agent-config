/**
 * Isolement de l'enfant et preuve N6.
 *
 * L'environnement de l'enfant part de vide : seules les variables de
 * `LISTE_BLANCHE` y figurent, chacune vers un chemin du temporaire contrôlé
 * après résolution. Le `.pi` réel est capturé avant la construction du
 * temporaire ; son inventaire (chemins, types, modes, cibles des liens,
 * SHA-256) est comparé avant et après chaque tentative.
 *
 * Gardes : `refuser("M6.x", …)`, identifiants des matrices (§ B).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { ignorer, refuser, sha256 } from "./identite.ts";

// `ignorer` n'est appelé que par les copies mutées de `falsifier.sh`.
void ignorer;

/** Variables admises dans l'environnement de l'enfant, et aucune autre. */
export const LISTE_BLANCHE = [
  "HOME",
  "PI_CODING_AGENT_DIR",
  "PI_AGENT_DIR",
  "PI_JOURNAL_PATH",
  "PI_OFFLINE",
  "TMPDIR",
  "JITI_FS_CACHE",
  "JITI_DEBUG",
  "NO_COLOR",
  "PATH",
  // Canaux de l'instrument (test-only) :
  "PI_CONTRATS_TRACE",
  "PI_CONTRATS_SONDE",
  "PI_CONTRATS_FOURNISSEUR",
  "PI_CONTRATS_SCENARIO",
] as const;

/**
 * K1 : seules variables complémentaires admissibles, et seulement pour un scénario qui les
 * déclare (scenarios.ts), à la valeur exacte déclarée. La déclaration ne se déduit jamais de
 * l'environnement contrôlé.
 */
export const COMPLEMENTAIRES = ["PI_SUBAGENT_ROLE", "PI_SUBAGENT_WRITE_SCOPE"] as const;

export type Chemins = {
  home: string;
  agentDir: string;
  candidat: string;
  journal: string;
  tmp: string;
  sessions: string;
  bin: string;
  obs: string;
  cwd: string;
};

export type Isolement = {
  racine: string;
  piReel: string;
  chemins: Chemins;
  env: Record<string, string>;
};

// ── N6 ────────────────────────────────────────────────────────────────────────

export type Entree = { chemin: string; type: "fichier" | "dossier" | "lien" | "autre"; mode: number; cible?: string; sha256?: string };
export type Inventaire = { racine: string; etat: "absent" } | { racine: string; etat: "present"; entrees: Entree[] };

/** Chemin absolu du `.pi` réel, capturé avant la construction de l'environnement de l'enfant. */
export function capturerPiReel(): string {
  return join(homedir(), ".pi");
}

/** Inventaire complet de `racine` ; une lecture impossible refuse (M6.12). */
export function inventaire(racine: string): Inventaire {
  let st;
  try {
    st = lstatSync(racine);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { racine, etat: "absent" };
    refuser("M6.12", `inventaire impossible de ${racine} : ${(e as Error).message}`);
  }
  const entrees: Entree[] = [];
  const visiter = (p: string, rel: string) => {
    let s;
    try {
      s = lstatSync(p);
    } catch (e) {
      refuser("M6.12", `inventaire incomplet, ${rel} : ${(e as Error).message}`);
      return;
    }
    if (s.isSymbolicLink()) {
      entrees.push({ chemin: rel, type: "lien", mode: s.mode, cible: readlinkSync(p) });
    } else if (s.isDirectory()) {
      entrees.push({ chemin: rel, type: "dossier", mode: s.mode });
      let noms: string[] = [];
      try {
        noms = readdirSync(p).sort();
      } catch (e) {
        refuser("M6.12", `inventaire incomplet, dossier ${rel} illisible : ${(e as Error).message}`);
        return;
      }
      for (const n of noms) visiter(join(p, n), rel === "." ? n : `${rel}/${n}`);
    } else if (s.isFile()) {
      let h = "";
      try {
        h = sha256(readFileSync(p));
      } catch (e) {
        refuser("M6.12", `inventaire incomplet, fichier ${rel} illisible : ${(e as Error).message}`);
      }
      entrees.push({ chemin: rel, type: "fichier", mode: s.mode, sha256: h });
    } else {
      entrees.push({ chemin: rel, type: "autre", mode: s.mode });
    }
  };
  if (!st) refuser("M6.12", `inventaire impossible de ${racine}`);
  visiter(racine, ".");
  return { racine, etat: "present", entrees };
}

/** Différences entre deux inventaires ; vide si identiques. */
export function differences(avant: Inventaire, apres: Inventaire): string[] {
  if (avant.etat !== apres.etat) return [`état ${avant.etat} → ${apres.etat}`];
  if (avant.etat === "absent" || apres.etat === "absent") return [];
  const a = new Map(avant.entrees.map((e) => [e.chemin, JSON.stringify(e)]));
  const b = new Map(apres.entrees.map((e) => [e.chemin, JSON.stringify(e)]));
  const d: string[] = [];
  for (const [k, v] of a) if (!b.has(k)) d.push(`retiré : ${k}`);
  else if (b.get(k) !== v) d.push(`modifié : ${k}`);
  for (const k of b.keys()) if (!a.has(k)) d.push(`ajouté : ${k}`);
  return d;
}

// ── Construction ──────────────────────────────────────────────────────────────

export type Options = {
  /** Copie de travail du candidat (le dépôt), copiée sans `.git`. */
  candidatSource: string;
  /** Outils posés dans le PATH de l'enfant : nom → cible absolue. */
  outils: Record<string, string>;
};

export function construire(piReel: string, o: Options): Isolement {
  const racine = realpathSync(mkdtempSync(join(tmpdir(), "pi-contrats-")));
  const cwd = join(racine, `cwd-${randomBytes(6).toString("hex")}`);
  const c: Chemins = {
    home: join(racine, "home"),
    agentDir: join(racine, "agent"),
    candidat: join(racine, "candidat"),
    journal: join(racine, "journal", "journal.md"),
    tmp: join(racine, "tmp"),
    sessions: join(racine, "sessions"),
    bin: join(racine, "bin"),
    obs: join(racine, "obs"),
    cwd,
  };
  for (const d of [c.home, c.agentDir, join(racine, "journal"), c.tmp, c.sessions, c.bin, c.obs, c.cwd]) mkdirSync(d, { recursive: true });
  cpSync(o.candidatSource, c.candidat, { recursive: true, filter: (s) => !s.split(sep).includes(".git") });
  for (const [nom, cible] of Object.entries(o.outils)) symlinkSync(cible, join(c.bin, nom));
  execFileSync(o.outils.git, ["init", "-q"], { cwd: c.cwd, env: { HOME: c.home, PATH: c.bin } });
  const env: Record<string, string> = {
    HOME: c.home,
    PI_CODING_AGENT_DIR: c.agentDir,
    PI_AGENT_DIR: c.candidat,
    PI_JOURNAL_PATH: c.journal,
    PI_OFFLINE: "1",
    TMPDIR: c.tmp,
    JITI_FS_CACHE: "false",
    JITI_DEBUG: "1",
    NO_COLOR: "1",
    PATH: c.bin,
    PI_CONTRATS_TRACE: join(c.obs, "trace.jsonl"),
    PI_CONTRATS_SONDE: join(c.obs, "sonde.jsonl"),
    PI_CONTRATS_FOURNISSEUR: join(c.obs, "fournisseur.jsonl"),
    PI_CONTRATS_SCENARIO: join(c.obs, "scenario.json"),
  };
  return { racine, piReel, chemins: c, env };
}

/** Le chemin résolu appartient-il au temporaire, sans lien qui en sorte ? */
function dansRacine(racine: string, p: string): boolean {
  let r: string;
  try {
    r = realpathSync(p);
  } catch {
    // Un fichier pas encore créé : son dossier parent doit être dans la racine.
    try {
      r = join(realpathSync(join(p, "..")), p.split(sep).pop()!);
    } catch {
      return false;
    }
  }
  return r === racine || r.startsWith(racine + sep);
}

/**
 * Contrôle de l'environnement et des arguments avant lancement.
 * `argv` est la liste complète passée à node.
 */
export function verifierIsolement(iso: Isolement, env: Record<string, string>, cwd: string, argv: string[], declarees: Readonly<Record<string, string>> = {}): void {
  const absente = (v: string) => `variable ${v} absente de l'environnement de l'enfant`;
  if (!("HOME" in env)) refuser("M6.1", absente("HOME"));
  if (!("PI_CODING_AGENT_DIR" in env)) refuser("M6.2", absente("PI_CODING_AGENT_DIR"));
  if (!("PI_AGENT_DIR" in env)) refuser("M6.3", absente("PI_AGENT_DIR"));
  if (!("PI_JOURNAL_PATH" in env)) refuser("M6.4", absente("PI_JOURNAL_PATH"));
  if (!("PI_OFFLINE" in env)) refuser("M6.5", absente("PI_OFFLINE"));
  if (!("TMPDIR" in env)) refuser("M6.6", absente("TMPDIR"));
  if (!("JITI_FS_CACHE" in env)) refuser("M6.7", absente("JITI_FS_CACHE"));
  if (env.PI_OFFLINE !== "1") refuser("M6.5", `PI_OFFLINE=${env.PI_OFFLINE}`);
  if (env.JITI_FS_CACHE !== "false") refuser("M6.7", `JITI_FS_CACHE=${env.JITI_FS_CACHE}`);
  // K1 : une déclaration hors des complémentaires admissibles est elle-même refusée.
  // M6.14 porte un identifiant par classe de refus, pour que chaque garde ait son mutant propre.
  for (const v of Object.keys(declarees)) {
    if (!(COMPLEMENTAIRES as readonly string[]).includes(v)) refuser("M6.14/non-admissible", `déclaration complémentaire non admissible : ${v}`);
    if (!(v in env)) refuser("M6.14/absente", `variable complémentaire déclarée absente de l'environnement de l'enfant : ${v}`);
  }
  for (const v of Object.keys(env)) {
    if ((LISTE_BLANCHE as readonly string[]).includes(v)) continue;
    if ((COMPLEMENTAIRES as readonly string[]).includes(v)) {
      // La valeur n'est comparée que pour une variable déclarée : chaque classe a sa garde propre.
      if (!(v in declarees)) refuser("M6.14/non-declaree", `variable complémentaire non déclarée par le scénario : ${v}`);
      else if (env[v] !== declarees[v]) refuser("M6.14/valeur", `variable complémentaire ${v} : valeur différente de la déclaration exacte`);
      continue;
    }
    refuser("M6.10", `variable hors liste blanche : ${v}`);
  }
  if (cwd !== iso.chemins.cwd || !existsSync(join(cwd, ".git"))) refuser("M6.8", `cwd ${cwd} n'est pas le dépôt temporaire`);
  const session = argv.includes("--no-session") || argv.includes("--session-dir");
  if (!session) refuser("M6.9", "ni --no-session ni --session-dir");
  const i = argv.indexOf("--session-dir");
  const chemins: Array<[string, string]> = [
    ["HOME", env.HOME],
    ["PI_CODING_AGENT_DIR", env.PI_CODING_AGENT_DIR],
    ["PI_AGENT_DIR", env.PI_AGENT_DIR],
    ["PI_JOURNAL_PATH", env.PI_JOURNAL_PATH],
    ["TMPDIR", env.TMPDIR],
    ["cwd", cwd],
    ...(i >= 0 ? ([["--session-dir", argv[i + 1]]] as Array<[string, string]>) : []),
  ];
  for (const k of ["PI_CONTRATS_TRACE", "PI_CONTRATS_SONDE", "PI_CONTRATS_FOURNISSEUR", "PI_CONTRATS_SCENARIO"]) {
    if (k in env) chemins.push([k, env[k]]);
  }
  // Une variable absente relève de M6.1 à M6.7 ; M6.11 juge les chemins présents.
  for (const [nom, p] of chemins) {
    if (p !== undefined && !dansRacine(iso.racine, p)) refuser("M6.11", `${nom} (${p}) sort du temporaire après résolution`);
  }
  let piReel = iso.piReel;
  try {
    piReel = realpathSync(iso.piReel);
  } catch {
    // absent : le chemin capturé tient lieu de racine
  }
  if (iso.racine.startsWith(piReel + sep) || piReel.startsWith(iso.racine + sep)) {
    refuser("M6.11", `le temporaire et le .pi réel s'emboîtent (${iso.racine}, ${piReel})`);
  }
  // Aucun chemin contrôlé ne partage le préfixe du cwd (debug() de jiti remplace le cwd par « . »).
  for (const [nom, p] of chemins) {
    if (nom !== "cwd" && p !== undefined && p.startsWith(cwd)) refuser("M6.8", `${nom} commence par le cwd de l'enfant`);
  }
}
