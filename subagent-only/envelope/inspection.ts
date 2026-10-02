/**
 * inspection.ts — LOT-REPRISES-CORRECTIF, RC : une revue bloquante est fondée sur les kept_consumers.
 *
 * Le constat (QD-REPRISES-a, R#2) : le reviewer d'une unité dont `tests/test_config.py` était un
 * kept_consumer a rendu `needs_rework` en affirmant qu'aucun test n'affectait
 * `io.GY_COLUMNS_VERSION` — sans avoir lu ce fichier, que sa tâche nommait. Le worker a appliqué
 * le correctif, le test gardé est passé au rouge, l'unité n'a jamais été intégrée.
 *
 * L'invariant (PLAN-LOT-REPRISES-CORRECTIF gelé, § 2 et § 5, Q1 à Q5) : pour un verdict
 * `needs_rework` ou `blocked` sur une unité dotée de kept_consumers, chacun doit avoir été
 * INSPECTÉ dans cette délégation — au moins un `read` terminé sans erreur, observé par le vrai
 * événement `tool_result`, et qui résout après `realpath` exactement vers ce fichier dans le
 * worktree de l'enfant. `grep`, `ls` ou tout autre outil ne comptent pas ; aucune couverture en
 * lignes n'est exigée. Sinon le `submit` est refusé sans terminer l'enfant : aucune enveloppe,
 * aucune `REVIEWED`, aucun finding publié.
 *
 * C'est une preuve d'inspection, pas une preuve de jugement. Sans import de pi : testable sans
 * montage.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS = "REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS";

/** Les verdicts qui peuvent envoyer un worker : les seuls soumis à la preuve. */
const BLOQUANTS = new Set(["needs_rework", "blocked"]);

/**
 * Ce que le parent transmet au reviewer d'une unité (`PI_SUBAGENT_KEPT_CONSUMERS`) : l'unité et
 * ses kept_consumers, lus dans le plan validé par R1-a. Illisible : inconnu, jamais « aucun ».
 */
export type Gardes = { unit: string; kept: string[] } | { inconnu: string };

export interface RefusInspection {
  code: typeof REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS;
  unit: string | null;
  /** Les kept_consumers que cette revue n'a pas inspectés. */
  missing_kept_consumers: string[];
  /** Présent quand la liste transmise n'a pas pu être lue : le refus ne vaut jamais « aucun kept ». */
  kept_inconnu?: string;
}

/** Absente : `null`, aucune obligation. Présente mais illisible : inconnue, verdict bloquant refusé. */
export function lireGardes(brut: string | undefined): Gardes | null {
  if (brut === undefined || brut === "") return null;
  try {
    const v = JSON.parse(brut) as { unit?: unknown; kept?: unknown; inconnu?: unknown };
    // E1-bis : le parent dit explicitement qu'il ne sait pas — sa raison est gardée.
    if (typeof v.unit === "string" && v.unit && typeof v.inconnu === "string" && v.inconnu && v.kept === undefined) {
      return { inconnu: v.inconnu };
    }
    if (typeof v.unit === "string" && v.unit && Array.isArray(v.kept) && v.kept.length > 0 &&
        v.kept.every((k) => typeof k === "string" && k !== "")) {
      return { unit: v.unit, kept: v.kept as string[] };
    }
  } catch {
    // illisible : traité plus bas
  }
  return { inconnu: "liste des kept_consumers illisible" };
}

export type Resoudre = (chemin: string) => string;

/**
 * Le chemin réel qu'un `read` a ouvert, s'il tombe dans le worktree de l'enfant ; `null` sinon.
 * Résolu depuis `cwd` comme l'outil le résout, puis par `realpath` ; un chemin qui ne résout pas
 * n'est pas inspecté.
 */
export function cheminReelDansWorktree(chemin: unknown, cwd: string, resoudre: Resoudre = realpathSync): string | null {
  if (typeof chemin !== "string" || chemin === "") return null;
  let racine: string;
  let reel: string;
  try {
    racine = resoudre(cwd);
    reel = resoudre(resolve(cwd, chemin));
  } catch {
    return null;
  }
  const rel = relative(racine, reel);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return reel;
}

/**
 * Un événement `tool_result` de pi : le chemin réel inspecté, ou `null`. Seul un `read` terminé
 * sans erreur compte.
 */
export function inspecte(evenement: unknown, cwd: string, resoudre: Resoudre = realpathSync): string | null {
  const e = evenement as { toolName?: unknown; isError?: unknown; input?: { path?: unknown } } | null;
  if (!e || e.toolName !== "read" || e.isError !== false) return null;
  return cheminReelDansWorktree(e.input?.path, cwd, resoudre);
}

/** `null` quand la soumission est acceptable ; le refus structuré sinon. */
export function refusBloquant(
  soumission: { verdict?: unknown },
  gardes: Gardes | null,
  inspectes: ReadonlySet<string>,
  cwd: string,
  resoudre: Resoudre = realpathSync,
): RefusInspection | null {
  if (!BLOQUANTS.has(String(soumission.verdict))) return null;
  if (!gardes) return null;
  if ("inconnu" in gardes) {
    return { code: REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS, unit: null, missing_kept_consumers: [], kept_inconnu: gardes.inconnu };
  }
  const manquants = gardes.kept.filter((k) => {
    const reel = cheminReelDansWorktree(k, cwd, resoudre);
    return reel === null || !inspectes.has(reel);
  });
  if (manquants.length === 0) return null;
  return { code: REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS, unit: gardes.unit, missing_kept_consumers: manquants };
}

/** Ce que le reviewer lit : le refus, ce qui reste à lire, et ce qu'il doit faire ensuite. */
export function texteDuRefusInspection(r: RefusInspection): string {
  const quoi = r.kept_inconnu
    ? `the consumers this unit must keep intact could not be established (${r.kept_inconnu})`
    : `these consumers of ${r.unit}, which must stay intact, were not read in this review: ` +
      r.missing_kept_consumers.join(", ");
  return (
    `Refused: ${REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS} — a needs_rework or blocked verdict requires ` +
    `having read, with the read tool, every consumer the unit must keep intact; ${quoi}. Nothing was ` +
    "recorded. Read them, check that each finding and the fix it asks for stay compatible with them — " +
    "withdraw or change a finding they contradict — then call submit again."
  );
}
