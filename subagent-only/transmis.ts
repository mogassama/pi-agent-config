/**
 * transmis.ts — LOT-EFFICACITÉ : ce que le runtime remet à une délégation, conservé à côté de son
 * artefact, `<runId>-<NN>-transmis.json` (plan des leviers v2c, § 3.4 et § 6 ; écart 1 accepté et
 * correction 2 de l'adjudication de la livraison, 02-10).
 *
 *   { run, seq, agent, unit, injection?, test_contract? }
 *
 * Publié AVANT le spawn, avec les métadonnées du contexte effectivement remis à dispatch. Une trace
 * absente se crée ; une trace existante valide de la même délégation se complète d'un champ qu'elle ne
 * porte pas encore, ou le porte déjà à l'identique. Une trace existante illisible, invalide, privée de
 * agent ou de unit (correction 1 de l'adjudication de la révision 2), ou contradictoire n'est jamais
 * remplacée par un objet vide, ni complétée, ni réécrite : `TransmisError`, et l'appelant
 * arrête avant le spawn. La publication est atomique et durable : temporaire, `fsync`, `rename`,
 * `fsync` du répertoire.
 *
 * Sans import de pi : testable sans montage.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export const TRANSMIS_INEXPLOITABLE = "TRANSMIS_INEXPLOITABLE";

export class TransmisError extends Error {
  readonly code = TRANSMIS_INEXPLOITABLE;
  readonly chemin: string;
  readonly raison: string;
  constructor(chemin: string, raison: string) {
    super(`${TRANSMIS_INEXPLOITABLE} : ${raison} (${chemin})`);
    this.chemin = chemin;
    this.raison = raison;
  }
}

/** Les champs qu'une délégation reçoit ; `agent` et `unit` l'identifient avec `run` et `seq`. */
export interface ChampsTransmis {
  agent: string;
  unit: string;
  injection?: unknown;
  test_contract?: unknown;
}

const IDENTITE = ["agent", "unit"] as const;
const CHARGES = ["injection", "test_contract"] as const;

export function transmisPath(dir: string, runId: string, seq: number): string {
  return join(dir, `${runId}-${String(seq).padStart(2, "0")}-transmis.json`);
}

const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * La trace d'une délégation, lue et vérifiée. `null` : absente. Illisible, de forme invalide, d'une
 * autre délégation, ou sans agent ou unit non vides : `TransmisError`.
 */
export function lireTransmis(dir: string, runId: string, seq: number): Record<string, unknown> | null {
  const chemin = transmisPath(dir, runId, seq);
  if (!existsSync(chemin)) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(chemin, "utf-8"));
  } catch (err) {
    throw new TransmisError(chemin, `trace existante illisible (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new TransmisError(chemin, "trace existante de forme invalide");
  const d = doc as Record<string, unknown>;
  if (d.run !== runId || d.seq !== seq) {
    throw new TransmisError(chemin, `trace existante d'une autre délégation (run ${String(d.run)}, séquence ${String(d.seq)})`);
  }
  for (const k of IDENTITE) {
    if (!(k in d) || typeof d[k] !== "string" || d[k] === "") {
      throw new TransmisError(chemin, `trace existante : ${k} absent ou invalide`);
    }
  }
  return d;
}

function publierAtomique(chemin: string, contenu: string): void {
  const tmp = `${chemin}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, contenu);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, chemin);
    const rep = openSync(join(chemin, ".."), "r");
    try {
      fsyncSync(rep);
    } finally {
      closeSync(rep);
    }
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new TransmisError(chemin, `publication impossible (${err instanceof Error ? err.message : String(err)})`);
  }
}

/**
 * Publie ce qui est remis à la délégation `seq`, avant son spawn. Rien n'est jamais écrasé : un champ
 * déjà présent doit être identique ; une identité (agent, unité) déjà présente aussi.
 */
export function publierTransmis(dir: string, runId: string, seq: number, champs: ChampsTransmis): void {
  const chemin = transmisPath(dir, runId, seq);
  const actuel = lireTransmis(dir, runId, seq);
  if (actuel) {
    for (const k of [...IDENTITE, ...CHARGES]) {
      if (k in actuel && k in champs && !egal(actuel[k], (champs as unknown as Record<string, unknown>)[k])) {
        throw new TransmisError(chemin, `trace existante contradictoire sur ${k}`);
      }
    }
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new TransmisError(chemin, `répertoire inaccessible (${err instanceof Error ? err.message : String(err)})`);
  }
  publierAtomique(chemin, `${JSON.stringify({ ...(actuel ?? {}), run: runId, seq, ...champs }, null, 2)}\n`);
}
