/**
 * R3 (adjudication a0000800 du 08-10-2026) — contrôle de lecteur M6.15/interprete.
 *
 * Exerce la garde existante de l'analyse après exécution (analyserCaptures, comparaison de
 * l'empreinte mémorisée de l'interprète d'un simulateur à celle du fichier réel), sur les
 * Brutes conservées et le Contexte d'analyse d'une exécution à simulateur unique. Aucun appel à
 * pi, aucune altération du binaire Node : seule une copie du Contexte est altérée.
 *
 * Dossier d'entrées :
 *   contexte.json  { pi, identite: { fichier, sha256, version }, chemins, argv, virtuels, simulateurs }
 *   brutes/        stdout.jsonl, stderr.txt, trace.jsonl, sonde.jsonl, fournisseur.jsonl,
 *                  simulateur-<nom>.jsonl pour chaque simulateur, sessions/ (fichiers .jsonl)
 * L'identité est relue depuis son fichier, dont l'empreinte doit égaler celle déclarée.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { analyserCaptures, lireIdentite, type Brutes, type Constat, type Contexte } from "./harnais.ts";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Contexte tel qu'écrit dans contexte.json : l'identité y est désignée par fichier et empreinte. */
export type ContexteDeclare = Omit<Contexte, "identite"> & { identite: { fichier: string; sha256: string; version: string } };

export function lireContexteDeclare(dossier: string): ContexteDeclare {
  return JSON.parse(readFileSync(join(dossier, "contexte.json"), "utf8"));
}

export function lireBrutesConservees(dossier: string, ctx: ContexteDeclare): Brutes {
  const d = join(dossier, "brutes");
  const lire = (f: string) => readFileSync(join(d, f), "utf8");
  const simulateurs: Record<string, string> = {};
  for (const sim of ctx.simulateurs ?? []) simulateurs[sim.nom] = lire(`simulateur-${sim.nom}.jsonl`);
  const sessions: Record<string, string> = {};
  const parcourir = (x: string) => {
    if (!existsSync(x)) return;
    for (const e of readdirSync(x, { withFileTypes: true })) {
      const f = join(x, e.name);
      if (e.isDirectory()) parcourir(f);
      else if (e.name.endsWith(".jsonl")) sessions[relative(join(d, "sessions"), f)] = readFileSync(f, "utf8");
    }
  };
  parcourir(join(d, "sessions"));
  return { stdout: lire("stdout.jsonl"), stderr: lire("stderr.txt"), trace: lire("trace.jsonl"), sonde: lire("sonde.jsonl"), fournisseur: lire("fournisseur.jsonl"), simulateurs, sessions };
}

/**
 * Copie du Contexte déclaré dont seul le premier caractère hexadécimal de
 * simulateurs[0].interprete.sha256 change (0 devient 1, toute autre valeur devient 0).
 */
export function altererInterprete(ctx: ContexteDeclare): ContexteDeclare {
  const sims = ctx.simulateurs ?? [];
  if (sims.length !== 1) throw new Error(`contrôle de lecteur : ${sims.length} simulateur(s) déclaré(s), un seul attendu`);
  const avant = sims[0].interprete.sha256;
  if (!/^[0-9a-f]{64}$/.test(avant)) throw new Error(`empreinte de l'interprète non hexadécimale de 64 caractères : ${avant}`);
  const apres = (avant[0] === "0" ? "1" : "0") + avant.slice(1);
  const copie: ContexteDeclare = JSON.parse(JSON.stringify(ctx));
  copie.simulateurs![0].interprete.sha256 = apres;
  // Garde du contrôle lui-même : la copie ne diffère que par ce champ.
  const temoin: ContexteDeclare = JSON.parse(JSON.stringify(copie));
  temoin.simulateurs![0].interprete.sha256 = avant;
  if (JSON.stringify(temoin) !== JSON.stringify(ctx) || !/^[0-9a-f]{64}$/.test(apres) || apres === avant) throw new Error("altération du Contexte non conforme");
  return copie;
}

export type ResultatLecteur = {
  alteration: boolean;
  identite: { fichier: string; sha256: string };
  interprete: { simulateur: string; chemin: string; sha256Declare: string; sha256Reel: string };
  constats: Constat[];
  resume: { evenements: number; resolutions: number; chargements: number; verifies: number; jiti: number; fils: number; admis: string[] };
  contexteAnalyse: ContexteDeclare;
};

/** Analyse les entrées, Contexte inchangé ou altéré. Toute anomalie des entrées lève une exception. */
export function lecteurInterprete(dossier: string, alterer: boolean): ResultatLecteur {
  const declare = lireContexteDeclare(dossier);
  const octets = readFileSync(declare.identite.fichier);
  if (sha256(octets) !== declare.identite.sha256) throw new Error(`identité ${declare.identite.fichier} : empreinte ${sha256(octets)} ≠ ${declare.identite.sha256} déclarée`);
  const ctxDeclare = alterer ? altererInterprete(declare) : declare;
  const identite = lireIdentite(declare.identite.fichier, declare.identite.version);
  const ctx: Contexte = { ...ctxDeclare, identite };
  const brutes = lireBrutesConservees(dossier, declare);
  const sim = (ctxDeclare.simulateurs ?? [])[0];
  if (!sim) throw new Error("contrôle de lecteur : aucun simulateur déclaré");
  const reel = sha256(readFileSync(sim.interprete.chemin));
  const r = analyserCaptures(brutes, ctx);
  const c = r.captures;
  return {
    alteration: alterer,
    identite: { fichier: declare.identite.fichier, sha256: declare.identite.sha256 },
    interprete: { simulateur: sim.nom, chemin: sim.interprete.chemin, sha256Declare: sim.interprete.sha256, sha256Reel: reel },
    constats: r.constats,
    resume: {
      evenements: c.node.evenements,
      resolutions: c.node.resolutions,
      chargements: c.node.chargements,
      verifies: c.node.verifies,
      jiti: c.jiti.evenements.length,
      fils: c.aveugles.fils.length,
      admis: c.admis.map((a) => `${a.nom} → ${a.reel} (${a.sha256})`),
    },
    contexteAnalyse: ctxDeclare,
  };
}
