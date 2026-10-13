/**
 * Identité de l'exécutable et des dépendances, vérifiée avant tout lancement.
 *
 * - `pi` et `node` sont résolus depuis le PATH de l'opérateur, liens suivis ;
 *   l'enfant est ensuite lancé par leurs cibles absolues.
 * - L'installation est comparée, fichier par fichier, à l'identité dérivée des
 *   distributions épinglées (`identite-<version>.json`, `generer-identite.ts`).
 *   Le SDK embarqué (modules virtuels) est couvert par les octets du bundle de
 *   pi-coding-agent ; les autres paquets du shrinkwrap forment un contrôle de
 *   cohérence de l'installation, qui ne prouve pas leur chargement.
 *
 * Chaque garde appelle `refuser("<id>", …)` avec l'identifiant de sa ligne
 * aux matrices (§ B). `falsifier.sh` désarme une garde en remplaçant ce seul
 * appel par `ignorer("<id>", …)` dans une copie.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { ARCHIVES_EPINGLEES, type Identite } from "./generer-identite.ts";

// ── Refus et mesures indéterminées ────────────────────────────────────────────

export class Refus extends Error {
  id: string;
  constructor(id: string, message: string) {
    super(`${id} : ${message}`);
    this.id = id;
  }
}

/** Mesure qui ne peut pas conclure. Jamais convertie en vert. */
export class Indetermine extends Error {
  id: string;
  constructor(id: string, message: string) {
    super(`${id} : ${message}`);
    this.id = id;
  }
}

export function refuser(id: string, message: string): never {
  throw new Refus(id, message);
}

/** Forme désarmée d'une garde : seuls les mutants de `falsifier.sh` l'emploient. */
export function ignorer(_id: string, ..._reste: unknown[]): void {}

export function indeterminer(id: string, message: string): never {
  throw new Indetermine(id, message);
}

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// ── Résolution des exécutables ────────────────────────────────────────────────

/** Candidats exécutables `nom` dans l'ordre du PATH : chemin tel que trouvé, cible réelle. */
export function candidats(nom: string, path: string): Array<{ chemin: string; reel: string }> {
  const sortie: Array<{ chemin: string; reel: string }> = [];
  for (const d of path.split(delimiter)) {
    if (!d) continue;
    const c = join(d, nom);
    try {
      accessSync(c, constants.X_OK);
      if (!statSync(c).isFile()) continue;
      sortie.push({ chemin: c, reel: realpathSync(c) });
    } catch {
      // absent ou non exécutable dans ce dossier : candidat suivant
    }
  }
  return sortie;
}

export type CibleNode = { chemin: string; reel: string; version: string; registerHooks: boolean };
export type CiblePi = { chemin: string; reel: string; racine: string };

/** Compare `version` à une plage `>=x.y.z`, seule forme admise ; toute autre forme est indéterminée. */
export function satisfaitEngines(version: string, plage: string): boolean {
  const m = plage.trim().match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  if (!m) indeterminer("M2.3", `plage engines non reconnue : ${plage}`);
  const v = version.replace(/^v/, "").split(".").map(Number);
  const b = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i] !== b[i]) return v[i] > b[i];
  }
  return true;
}

/** `pi` : une seule cible réelle dans le PATH, qui est l'entrée du paquet contrôlé. */
export function resoudrePi(path: string, identite: Identite): CiblePi {
  const cs = candidats("pi", path);
  const reels = [...new Set(cs.map((c) => c.reel))];
  if (reels.length === 0) refuser("M2.1", "aucun pi exécutable dans le PATH");
  if (reels.length > 1) refuser("M2.1", `plusieurs cibles réelles de pi dans le PATH : ${reels.join(", ")}`);
  const reel = reels[0];
  // Racine : le premier dossier ancêtre dont le package.json nomme le paquet contrôlé.
  let racine = dirname(reel);
  let pj: any = null;
  for (;;) {
    try {
      const x = JSON.parse(readFileSync(join(racine, "package.json"), "utf8"));
      if (x.name === identite.paquet) {
        pj = x;
        break;
      }
    } catch {
      // pas de package.json lisible ici : dossier parent
    }
    const parent = dirname(racine);
    if (parent === racine) break;
    racine = parent;
  }
  if (!pj) {
    refuser("M2.2", `la cible réelle de pi (${reel}) n'est pas dans le paquet ${identite.paquet}`);
    // Atteint seulement par un mutant de falsifier.sh : la garde désarmée laisse passer
    // la cible, et l'installation est cherchée selon la disposition npm du PATH.
    racine = join(dirname(cs[0].chemin), "..", "lib", "node_modules", identite.paquet);
    try {
      pj = JSON.parse(readFileSync(join(racine, "package.json"), "utf8"));
    } catch {
      pj = {};
    }
  }
  if (pj.version !== identite.version) refuser("M2.5", `version installée ${pj?.version} ≠ ${identite.version}`);
  // L'entrée n'est jugée que pour une cible dans le paquet ; une cible hors du paquet relève de M2.2.
  const dedans = reel.startsWith(racine + sep);
  if (dedans && (relative(racine, reel) !== identite.entree || pj.bin?.pi !== identite.entree)) {
    refuser("M2.4", `entrée ${relative(racine, reel)} (bin.pi ${pj?.bin?.pi}) ≠ ${identite.entree}`);
  }
  return { chemin: cs[0].chemin, reel, racine };
}

/** `node` : celui que lancerait `#!/usr/bin/env node`, c'est-à-dire le premier du PATH. */
export function resoudreNode(path: string, identite: Identite): CibleNode {
  const cs = candidats("node", path);
  if (cs.length === 0) refuser("M2.3", "aucun node exécutable dans le PATH");
  // `cs[0]` manque seulement pour un mutant de falsifier.sh : le nom nu est alors lancé tel quel.
  const { chemin, reel } = cs[0] ?? { chemin: "node", reel: "node" };
  let sortie = "";
  try {
    sortie = execFileSync(reel, ["-p", "process.version + ' ' + typeof require('node:module').registerHooks"], { encoding: "utf8", env: {} }).trim();
  } catch (e) {
    refuser("M2.3", `node (${reel}) ne s'exécute pas : ${(e as Error).message}`);
  }
  const [version = "", rh = ""] = sortie.split(" ");
  if (!satisfaitEngines(version, identite.engines)) refuser("M2.3", `node ${version} hors engines ${identite.engines}`);
  if (rh !== "function") refuser("M2.3", `node ${version} sans module.registerHooks`);
  return { chemin, reel, version, registerHooks: rh === "function" };
}

// ── Vérification de l'installation ────────────────────────────────────────────

export type EtatPaquet = "conforme" | "absent-exclu-plateforme" | "transforme-installation";
export type RapportIdentite = {
  paquets: number;
  fichiers: number;
  etats: Record<string, EtatPaquet>;
  transformations: string[];
  exclus: string[];
};

const PLATEFORME = { os: process.platform, cpu: process.arch };

function exclu(p: { os?: string[]; cpu?: string[] }): boolean {
  const refuse = (liste: string[] | undefined, v: string) => {
    if (!liste) return false;
    const neg = liste.filter((x) => x.startsWith("!")).map((x) => x.slice(1));
    const pos = liste.filter((x) => !x.startsWith("!"));
    if (neg.includes(v)) return true;
    return pos.length > 0 && !pos.includes(v);
  };
  return refuse(p.os, PLATEFORME.os) || refuse(p.cpu, PLATEFORME.cpu);
}

/**
 * Transformation d'installation déclarée : le script d'installation d'esbuild
 * remplace `bin/esbuild` par le binaire du paquet `@esbuild/<plateforme>`
 * présent. Elle est limitée à ce fichier et n'est admise que si :
 * - le binaire de la plateforme présente est lui-même un fichier ordinaire, sans
 *   lien, sous la racine réelle de son paquet, aux octets de son manifeste ;
 * - `esbuild/bin/esbuild` porte exactement ces octets.
 * Les conditions de fichier ordinaire d'`esbuild/bin/esbuild` (M2.18) sont
 * vérifiées avant, comme pour tout fichier manifesté.
 */
function transformationEsbuild(identite: Identite, racine: string, cle: string, fichier: string, empreinte: string): string | null {
  if (cle !== "node_modules/esbuild" || fichier !== "bin/esbuild") return null;
  const racineReelle = realpathSync(racine);
  for (const [k, p] of Object.entries(identite.paquets)) {
    if (!k.startsWith("node_modules/@esbuild/") || !p.optionnel_plateforme || exclu(p.optionnel_plateforme)) continue;
    const attendu = p.fichiers["bin/esbuild"];
    if (!attendu || attendu !== empreinte) continue;
    const dir = join(racine, k);
    const bin = join(dir, "bin", "esbuild");
    try {
      const sd = lstatSync(dir);
      const sb = lstatSync(bin);
      if (!sd.isDirectory() || sd.isSymbolicLink() || !sb.isFile() || sb.isSymbolicLink()) return null;
      const dirReel = realpathSync(dir);
      if (!dirReel.startsWith(racineReelle + sep) || !realpathSync(bin).startsWith(dirReel + sep)) return null;
      if (sha256(readFileSync(bin)) !== attendu) return null;
    } catch {
      return null;
    }
    return `${cle}/${fichier} = ${k}/bin/esbuild (script d'installation d'esbuild ; binaire de la plateforme vérifié)`;
  }
  return null;
}

/** Vérifie que l'identité elle-même est cohérente avec les empreintes épinglées du générateur. */
export function verifierIdentiteDeclaree(identite: Identite, cheminGenerateur: string): void {
  const epinglees = ARCHIVES_EPINGLEES[identite.version];
  if (!epinglees) refuser("M2.5", `aucune empreinte épinglée pour ${identite.version}`);
  if (identite.generateur.sha256 !== sha256(readFileSync(cheminGenerateur))) {
    refuser("M2.9", "identité dérivée par un autre générateur que celui du dépôt");
  }
  for (const [spec, attendu] of Object.entries(epinglees)) {
    const nom = spec.slice(0, spec.lastIndexOf("@"));
    const p = Object.values(identite.paquets).find((x) => `${x.nom}@${x.version}` === spec);
    if (!p) refuser("M2.9", `paquet épinglé ${spec} absent de l'identité`);
    if (p.archive.sha256 !== attendu) refuser("M2.9", `${nom} : empreinte d'archive ${p.archive.sha256} ≠ épinglée ${attendu}`);
  }
}

/** Paquets présents sous `racine` : clés de la forme `node_modules/…`, y compris imbriqués. */
function paquetsPresents(racine: string): { paquets: string[]; autres: string[] } {
  const paquets: string[] = [];
  const autres: string[] = [];
  const parcourir = (base: string) => {
    const nm = join(racine, base, "node_modules");
    if (!existsSync(nm)) return;
    for (const e of readdirSync(nm).sort()) {
      const rel = join(base, "node_modules", e);
      if (e === ".bin" || e === ".package-lock.json") {
        autres.push(rel);
        continue;
      }
      if (e.startsWith("@")) {
        for (const s of readdirSync(join(nm, e)).sort()) {
          paquets.push(join(rel, s));
          parcourir(join(rel, s));
        }
        continue;
      }
      paquets.push(rel);
      parcourir(rel);
    }
  };
  parcourir("");
  return { paquets: paquets.map((p) => p.split(sep).join("/")), autres };
}

/** Compare l'installation de `racine` à l'identité ; refuse au premier écart. */
export function verifierInstallation(racine: string, identite: Identite): RapportIdentite {
  const rapport: RapportIdentite = { paquets: 0, fichiers: 0, etats: {}, transformations: [], exclus: [] };
  const racineReelle = realpathSync(racine);
  const { paquets: presents, autres } = paquetsPresents(racine);
  for (const k of presents) {
    if (!(k in identite.paquets)) refuser("M2.6", `paquet installé hors identité : ${k}`);
  }
  for (const a of autres) {
    const p = join(racine, a);
    if (a.endsWith(".bin")) {
      for (const l of readdirSync(p)) {
        const lien = join(p, l);
        if (!lstatSync(lien).isSymbolicLink()) refuser("M2.6", `${a}/${l} n'est pas un lien`);
        const cible = realpathSync(lien);
        if (!cible.startsWith(racineReelle + sep)) refuser("M2.6", `${a}/${l} pointe hors de l'installation : ${cible}`);
      }
    }
  }
  for (const [cle, p] of Object.entries(identite.paquets)) {
    const dir = cle === "" ? racine : join(racine, cle);
    if (!existsSync(dir)) {
      if (p.optionnel_plateforme && exclu(p.optionnel_plateforme)) {
        rapport.etats[cle] = "absent-exclu-plateforme";
        rapport.exclus.push(cle);
        continue;
      }
      if (p.optionnel_plateforme) refuser("M2.10", `paquet optionnel ${cle} absent alors que ${PLATEFORME.os}/${PLATEFORME.cpu} n'est pas exclu`);
      else refuser("M2.6", `paquet requis absent : ${cle}`);
      continue;
    }
    // M2.17 : la racine du paquet est un répertoire ordinaire, sans lien, résolu sous la racine réelle de l'installation.
    const sDir = lstatSync(dir);
    let dirReel = dir;
    try {
      dirReel = realpathSync(dir);
    } catch {
      dirReel = dir;
    }
    if (cle !== "" && (sDir.isSymbolicLink() || !sDir.isDirectory() || !dirReel.startsWith(racineReelle + sep))) {
      refuser("M2.17", `racine de paquet liée ou hors de l'installation : ${cle} → ${dirReel}`);
    }
    let pj: any = {};
    try {
      pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      refuser("M2.7", `${cle}/package.json illisible`);
    }
    if (pj.version !== p.version) refuser("M2.5", `${cle} : version ${pj.version} ≠ ${p.version}`);
    let etat: EtatPaquet = "conforme";
    for (const [f, attendu] of Object.entries(p.fichiers)) {
      const chemin = join(dir, f);
      // Chaque garde passe au fichier suivant : désarmée par un mutant, elle laisse passer ce fichier
      // sans qu'une autre garde ne le rattrape.
      let sf;
      try {
        sf = lstatSync(chemin);
      } catch {
        sf = null;
      }
      if (!sf) {
        refuser("M2.6", `fichier requis absent : ${cle ? cle + "/" : ""}${f}`);
        continue;
      }
      // M2.18 : fichier ordinaire, sans lien, dont le chemin réel reste sous la racine réelle de son paquet ;
      // avant le contrôle des octets, transformation esbuild comprise.
      let fReel = chemin;
      try {
        fReel = realpathSync(chemin);
      } catch {
        fReel = chemin;
      }
      if (sf.isSymbolicLink() || !sf.isFile() || !fReel.startsWith(dirReel + sep)) {
        refuser("M2.18", `fichier requis lié ou hors de son paquet : ${cle ? cle + "/" : ""}${f} → ${fReel}`);
      }
      let octets: Buffer;
      try {
        octets = readFileSync(chemin);
      } catch {
        refuser("M2.7", `fichier requis illisible : ${cle ? cle + "/" : ""}${f}`);
        continue;
      }
      const h = sha256(octets);
      rapport.fichiers++;
      if (h === attendu) continue;
      const t = transformationEsbuild(identite, racine, cle, f, h);
      if (t) {
        rapport.transformations.push(t);
        etat = "transforme-installation";
        continue;
      }
      refuser("M2.8", `fichier différent du manifeste : ${cle ? cle + "/" : ""}${f}`);
    }
    // Aucun fichier en plus dans le paquet (hors node_modules imbriqués).
    const parcourir = (d: string) => {
      for (const e of readdirSync(d)) {
        const c = join(d, e);
        const rel = relative(dir, c).split(sep).join("/");
        if (rel === "node_modules" || rel.endsWith("/node_modules")) continue;
        const st = lstatSync(c);
        if (st.isDirectory()) parcourir(c);
        else if (!(rel in p.fichiers)) refuser("M2.8", `fichier hors manifeste : ${cle ? cle + "/" : ""}${rel}`);
      }
    };
    parcourir(dir);
    rapport.etats[cle] = etat;
    rapport.paquets++;
  }
  return rapport;
}

/** Paquet de l'installation qui contient `fichier` (clé de l'identité), ou null. */
export function paquetDe(racine: string, fichier: string, identite: Identite): { cle: string; rel: string } | null {
  if (!fichier.startsWith(racine + sep)) return null;
  const rel = relative(racine, fichier).split(sep).join("/");
  let meilleur: string | null = null;
  for (const cle of Object.keys(identite.paquets)) {
    if (cle === "" || rel.startsWith(cle + "/")) {
      if (meilleur === null || cle.length > meilleur.length) meilleur = cle;
    }
  }
  if (meilleur === null) return null;
  return { cle: meilleur, rel: meilleur === "" ? rel : rel.slice(meilleur.length + 1) };
}

