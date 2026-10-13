/**
 * Dérive l'identité d'une version de pi depuis ses distributions épinglées.
 *
 *   node tests/pi-contrats/generer-identite.ts <version> <sortie.json>
 *
 * Les empreintes ne viennent jamais d'une installation : chaque archive est
 * obtenue par `npm pack`, vérifiée par son `integrity` (shrinkwrap) ou par une
 * empreinte SHA-256 épinglée ci-dessous, puis extraite et hachée fichier par
 * fichier. Une archive absente, une empreinte différente ou une extraction
 * échouée arrête la génération : rien n'est écrit.
 *
 * Ce générateur a besoin du réseau (registre npm). L'instrument, lui, ne le
 * lance pas : il lit le JSON produit, versionné à côté.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, lstatSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/** Empreintes SHA-256 des archives sans `integrity` au shrinkwrap, et de l'archive racine. */
export const ARCHIVES_EPINGLEES: Record<string, Record<string, string>> = {
  "0.86.0": {
    "@earendil-works/pi-coding-agent@0.86.0": "3f0f502f497c44888ddbd68a11897651b739eaabdf4b235e3a7ed9735353b0cd",
    "@earendil-works/pi-ai@0.86.0": "d52448c827a72c8fdcf9f0c96c9966704a8525a6a0ae181f4bd886c584d727e3",
    "@earendil-works/pi-tui@0.86.0": "2fe13cc1f7ff546e828bba78beb779239073598c86500511b30472aa91a5b550",
    "@earendil-works/pi-agent-core@0.86.0": "af8e80b8e754f20d87a790c76f6a0b5debea6b11839f98ce7f0130ebf75fbf33",
    "@earendil-works/chord@0.86.0": "ead8443f9711f5d15f5fa0f29203808f08be27c2a4a0dc1cbbde8dffa6551cb8",
    "@earendil-works/pi-telemetry@0.86.0": "a6a87d63e5eadd6a8f0b754e6e3edcc1cc155cb6742426adafac2792283cb8cf",
  },
  // Contre-épreuve seulement (NON QUALIFIANT).
  "0.99.0": {
    "@earendil-works/pi-coding-agent@0.99.0": "19a8dbd8d697a599ea972a8ba307c109a814bb9122604b2553c62006b9617724",
    "@earendil-works/pi-ai@0.99.0": "80566a06c66d3b2ab7f0cf2ffde7fb62657b4f08ca7b06e69833426a375f9746",
    "@earendil-works/pi-tui@0.99.0": "c543f947e2073632b9f54de70045526177e6420062aa5ccc6f5339531e2647ec",
    "@earendil-works/pi-agent-core@0.99.0": "5a04569a4b892726069e4b9355fac5da37806785277c75677e816bd7b8e05088",
    "@earendil-works/chord@0.99.0": "1555c83fd621286ec78e70a0ce6b022c589cd5112d7b21f5e84c18df22ad15f2",
    "@earendil-works/pi-telemetry@0.99.0": "2da353e2e0d0665b5d3731a38afbeda958c1c498bdc1c1081f92f303feb1562e",
    "@earendil-works/pi-codemode@0.99.0": "57299d0260465b98cbeafb1870fd05a0d2c40a8965023aa8a1435658d47341d2",
    "@earendil-works/pi-mcp@0.99.0": "b7245f8425f9dbe1872c45acfb268c9fcb159fcc72fa9c7fed6a5719e3a5cdb3",
  },
};

export type Fichiers = Record<string, string>;
export type Paquet = {
  nom: string;
  version: string;
  archive: { integrity?: string; sha256: string };
  fichiers: Fichiers;
  optionnel_plateforme?: { os?: string[]; cpu?: string[] };
};
export type Identite = {
  schema: 1;
  paquet: string;
  version: string;
  entree: string;
  engines: string;
  generateur: { chemin: string; sha256: string };
  paquets: Record<string, Paquet>;
};

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const sri = (b: Buffer, algo: string) => `${algo}-${createHash(algo).update(b).digest("base64")}`;

function fichiersDe(racine: string): Fichiers {
  const sortie: Fichiers = {};
  const marcher = (d: string) => {
    for (const nom of readdirSync(d).sort()) {
      const p = join(d, nom);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) throw new Error(`lien symbolique dans une archive : ${relative(racine, p)}`);
      if (st.isDirectory()) marcher(p);
      else if (st.isFile()) sortie[relative(racine, p)] = sha256(readFileSync(p));
      else throw new Error(`entrée ni fichier ni dossier : ${relative(racine, p)}`);
    }
  };
  marcher(racine);
  return sortie;
}

function archive(spec: string, travail: string): Buffer {
  const d = mkdtempSync(join(travail, "pack-"));
  const sortie = execFileSync("npm", ["pack", spec, "--silent", "--pack-destination", d], { encoding: "utf8" }).trim().split("\n").pop()!;
  const f = join(d, sortie);
  if (!existsSync(f)) throw new Error(`archive absente pour ${spec}`);
  return readFileSync(f);
}

function extraire(tgz: Buffer, travail: string): string {
  const d = mkdtempSync(join(travail, "x-"));
  const f = join(d, "a.tgz");
  writeFileSync(f, tgz);
  mkdirSync(join(d, "x"));
  execFileSync("tar", ["-xzf", f, "-C", join(d, "x")], { stdio: ["ignore", "ignore", "ignore"] });
  // Les archives npm ont une racine unique (souvent `package/`).
  const racines = readdirSync(join(d, "x"));
  if (racines.length !== 1) throw new Error(`archive à racines multiples : ${racines.join(", ")}`);
  return join(d, "x", racines[0]);
}

export function generer(version: string, cheminGenerateur: string): Identite {
  const epinglees = ARCHIVES_EPINGLEES[version];
  if (!epinglees) throw new Error(`aucune empreinte épinglée pour ${version}`);
  const travail = mkdtempSync(join(tmpdir(), "generer-identite-"));
  try {
    const racineSpec = `@earendil-works/pi-coding-agent@${version}`;
    const tgzRacine = archive(racineSpec, travail);
    const shaRacine = sha256(tgzRacine);
    if (shaRacine !== epinglees[racineSpec]) throw new Error(`${racineSpec} : empreinte ${shaRacine} ≠ ${epinglees[racineSpec]}`);
    const racine = extraire(tgzRacine, travail);
    const pj = JSON.parse(readFileSync(join(racine, "package.json"), "utf8"));
    const sw = JSON.parse(readFileSync(join(racine, "npm-shrinkwrap.json"), "utf8"));
    const paquets: Record<string, Paquet> = {
      "": { nom: pj.name, version: pj.version, archive: { sha256: shaRacine }, fichiers: fichiersDe(racine) },
    };
    for (const [cle, e] of Object.entries<any>(sw.packages)) {
      if (cle === "") continue;
      const nom = e.name ?? cle.slice(cle.lastIndexOf("node_modules/") + "node_modules/".length);
      const spec = `${nom}@${e.version}`;
      const tgz = archive(spec, travail);
      const s = sha256(tgz);
      if (e.integrity) {
        const algo = String(e.integrity).split("-")[0];
        if (sri(tgz, algo) !== e.integrity) throw new Error(`${spec} : integrity différente`);
      } else {
        const attendu = epinglees[spec];
        if (!attendu) throw new Error(`${spec} : ni integrity ni empreinte épinglée`);
        if (s !== attendu) throw new Error(`${spec} : empreinte ${s} ≠ ${attendu}`);
      }
      const p: Paquet = { nom, version: e.version, archive: { ...(e.integrity ? { integrity: e.integrity } : {}), sha256: s }, fichiers: fichiersDe(extraire(tgz, travail)) };
      if (e.optional && (e.os || e.cpu)) p.optionnel_plateforme = { ...(e.os ? { os: e.os } : {}), ...(e.cpu ? { cpu: e.cpu } : {}) };
      paquets[cle] = p;
    }
    return {
      schema: 1,
      paquet: pj.name,
      version: pj.version,
      entree: pj.bin?.pi,
      engines: pj.engines?.node,
      generateur: { chemin: "tests/pi-contrats/generer-identite.ts", sha256: sha256(readFileSync(cheminGenerateur)) },
      paquets,
    };
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
  const [version, sortie] = process.argv.slice(2);
  if (!version || !sortie) {
    console.error("usage : generer-identite.ts <version> <sortie.json>");
    process.exit(2);
  }
  const id = generer(version, new URL(import.meta.url).pathname);
  writeFileSync(sortie, JSON.stringify(id, null, 0) + "\n");
  const n = Object.values(id.paquets).reduce((a, p) => a + Object.keys(p.fichiers).length, 0);
  console.log(`${id.paquet}@${id.version} : ${Object.keys(id.paquets).length} paquets, ${n} fichiers`);
}
