/**
 * kept-durable.ts — LOT-EFFICACITÉ, E1-bis : le kept final d'un plan gelé, rendu durable.
 *
 * Le kept est DÉRIVÉ au gel (`consommateurs.ts`) : il dépend de l'arbre analysé à ce moment. Le
 * relire en refaisant l'analyse à une reprise l'aurait recalculé sur un arbre qui a changé depuis
 * — une intégration ajoute des importeurs — et le kept d'un plan gelé aurait changé sous lui.
 * Il est donc écrit une fois, avant le `planHash` du manifeste, sous la même garde du run
 * (`attachPlanAvecKept`), puis seulement relu (plan des leviers v2 complétée, § 2.2, blocs
 * « Durabilité » et « Protocole adjugé »).
 *
 *   <runId>-kept.json = { schema, planHash, units: { <unité>: { kept, derived, declared, dropped } } }
 *
 * Toutes les unités du plan y figurent, celles dont le kept est vide comprises : une unité absente
 * n'est pas une unité sans kept. Le fichier est vérifié à chaque lecture — schéma, `planHash`,
 * présence de chaque unité — et toute anomalie rend un kept INCONNU, jamais une liste vide. Rien
 * ici ne le recalcule ni ne le répare.
 *
 * Sans import de pi : testable sans montage.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import type { KeptUnite } from "./consommateurs.ts";

export const KEPT_SCHEMA = "pi-kept/1";

export interface KeptDurable {
  schema: typeof KEPT_SCHEMA;
  planHash: string;
  units: Record<string, KeptUnite>;
}

export type KeptLu =
  | { etat: "connu"; units: Record<string, KeptUnite> }
  | { etat: "inconnu"; raison: string };

export function keptPath(dir: string, runId: string): string {
  return join(dir, `${runId}-kept.json`);
}

export function keptExiste(dir: string, runId: string): boolean {
  return existsSync(keptPath(dir, runId));
}

function synchroniser(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Publication atomique et durable : fichier temporaire, `fsync`, `rename`, `fsync` du répertoire.
 * Une erreur remonte telle quelle ; le temporaire est retiré, jamais le fichier final.
 */
export function ecrireKeptDurable(dir: string, runId: string, doc: KeptDurable): void {
  const final = keptPath(dir, runId);
  mkdirSync(dirname(final), { recursive: true });
  const tmp = `${final}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, `${JSON.stringify(doc, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  synchroniser(dirname(final));
}

const chaines = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");

function uniteValide(v: unknown): v is KeptUnite {
  const u = v as Partial<KeptUnite> | null;
  if (!u || typeof u !== "object" || Array.isArray(u)) return false;
  if (!chaines(u.kept) || !chaines(u.derived) || !chaines(u.declared)) return false;
  if (!Array.isArray(u.dropped)) return false;
  if (!u.dropped.every((d) => d && typeof d === "object" && typeof d.path === "string" && d.path !== "" &&
    typeof d.reason === "string" && d.reason !== "")) return false;
  // Le kept final est l'union, sans doublon, de ce qui est déclaré gardé et de ce qui est dérivé.
  const union = [...new Set([...u.declared, ...u.derived])].sort();
  return JSON.stringify(union) === JSON.stringify(u.kept);
}

/**
 * Le kept durable d'un plan gelé, vérifié. `unites` : les unités du plan gelé, toutes attendues.
 * Absent, illisible, de schéma invalide, unité manquante ou `planHash` différent : inconnu.
 */
export function lireKeptDurable(dir: string, runId: string, planHash: string, unites: readonly string[]): KeptLu {
  const path = keptPath(dir, runId);
  let brut: string;
  try {
    brut = readFileSync(path, "utf-8");
  } catch {
    return { etat: "inconnu", raison: `${runId}-kept.json absent alors que le plan est gelé (${planHash})` };
  }
  let doc: Partial<KeptDurable>;
  try {
    doc = JSON.parse(brut) as Partial<KeptDurable>;
  } catch {
    return { etat: "inconnu", raison: `${runId}-kept.json illisible` };
  }
  if (!doc || typeof doc !== "object" || doc.schema !== KEPT_SCHEMA) {
    return { etat: "inconnu", raison: `${runId}-kept.json : schéma ${JSON.stringify(doc?.schema)} ≠ ${KEPT_SCHEMA}` };
  }
  if (doc.planHash !== planHash) {
    return { etat: "inconnu", raison: `${runId}-kept.json porte le planHash ${String(doc.planHash)}, le plan gelé ${planHash}` };
  }
  const units = doc.units;
  if (!units || typeof units !== "object" || Array.isArray(units)) {
    return { etat: "inconnu", raison: `${runId}-kept.json : units invalide` };
  }
  for (const u of unites) {
    if (!Object.prototype.hasOwnProperty.call(units, u)) {
      return { etat: "inconnu", raison: `${runId}-kept.json : unité ${u} manquante` };
    }
    if (!uniteValide(units[u])) {
      return { etat: "inconnu", raison: `${runId}-kept.json : unité ${u} de forme invalide` };
    }
  }
  return { etat: "connu", units: units as Record<string, KeptUnite> };
}
