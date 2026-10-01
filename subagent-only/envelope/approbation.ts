/**
 * approbation.ts — LOT-REPRISES, R2 : `approved` est incompatible avec tout risque restant ouvert.
 *
 * Le constat (QD-P1a R#4, QD-P1b R#10) : une revue rend `approved` avec des `open_risks`. Le
 * risque s'écrit au registre, la porte `open-risks` refuse l'intégration, et l'orchestrateur,
 * lisant une revue approuvée, envoie un worker complet. La revue semblait finie ; elle ne
 * l'était pas.
 *
 * L'invariant (PLAN-LOT-REPRISES v2 gelé, § 3, Q3 et Q4) : au `submit` du reviewer, si
 * `verdict == "approved"`, aucun risque de l'unité ne reste ouvert après application des
 * transitions que cette soumission propose. Cela couvre les nouveaux `open_risks`, les risques
 * de continuation remis au reviewer, et les risques `routed` non `resolved` — tous dans la
 * projection autoritaire que le parent lit au registre et passe à l'enfant
 * (`PI_SUBAGENT_OPEN_RISKS`). Sinon le `submit` est refusé sans terminer l'enfant ; le reviewer
 * résout, rend `needs_rework` ou `blocked`, ou convertit une remarque non bloquante en finding.
 * Le parent ne réécrit jamais un verdict ; la porte `open-risks` reste l'autorité.
 *
 * Sans import de pi : testable sans montage.
 */

export const REVIEW_APPROVED_WITH_OPEN_RISKS = "REVIEW_APPROVED_WITH_OPEN_RISKS";

/**
 * Ce que le parent a lu au registre autoritaire au départ de la revue : les ids encore ouverts de
 * l'unité (`open` et `routed`), et ceux qui sont remis à ce reviewer (`for_risks`) — les seuls
 * qu'il peut fermer, puisque le registre ignore un id qu'on ne lui a pas remis.
 */
export type Projection = { ids: string[]; remis: string[] } | { inconnu: string };

export interface RefusApprobation {
  code: typeof REVIEW_APPROVED_WITH_OPEN_RISKS;
  /** Nombre de nouveaux `open_risks` de cette soumission. */
  new_open_risks: number;
  /** Ids de la projection qui restent ouverts après cette soumission. */
  open_risk_ids: string[];
  /** Présent quand la projection n'a pas pu être établie par le parent. */
  projection_inconnue?: string;
}

/**
 * La projection transmise par l'environnement. Absente : `null` — seuls les nouveaux `open_risks`
 * se jugent. Présente mais illisible : inconnue, donc `approved` refusé.
 */
export function lireProjection(brut: string | undefined): Projection | null {
  if (brut === undefined || brut === "") return null;
  try {
    const v = JSON.parse(brut) as { ids?: unknown; remis?: unknown; inconnu?: unknown };
    if (typeof v.inconnu === "string") return { inconnu: v.inconnu };
    const liste = (x: unknown) => Array.isArray(x) && x.every((e) => typeof e === "string") ? (x as string[]) : null;
    const ids = liste(v.ids);
    const remis = liste(v.remis);
    if (ids !== null && remis !== null) return { ids, remis };
  } catch {
    // illisible : traité plus bas
  }
  return { inconnu: "projection des risques illisible" };
}

/** `null` quand la soumission est acceptable ; le refus structuré sinon. */
export function refusApprobation(
  soumission: { verdict?: unknown; open_risks?: unknown; resolved_risks?: unknown },
  projection: Projection | null,
): RefusApprobation | null {
  if (soumission.verdict !== "approved") return null;
  const nouveaux = Array.isArray(soumission.open_risks) ? soumission.open_risks.length : 0;
  const resolus = Array.isArray(soumission.resolved_risks)
    ? soumission.resolved_risks.filter((x): x is string => typeof x === "string")
    : [];
  if (projection && "inconnu" in projection) {
    return { code: REVIEW_APPROVED_WITH_OPEN_RISKS, new_open_risks: nouveaux, open_risk_ids: [], projection_inconnue: projection.inconnu };
  }
  // Fermé seulement s'il est remis ET réclamé : c'est la règle du registre (`continuationReturned`).
  const restants = projection
    ? projection.ids.filter((id) => !(projection.remis.includes(id) && resolus.includes(id)))
    : [];
  if (nouveaux === 0 && restants.length === 0) return null;
  return { code: REVIEW_APPROVED_WITH_OPEN_RISKS, new_open_risks: nouveaux, open_risk_ids: restants };
}

/** Ce que le reviewer lit : le refus, ce qui reste ouvert, et ses quatre issues. */
export function texteDuRefus(r: RefusApprobation): string {
  const ouverts = [
    ...(r.new_open_risks > 0 ? [`${r.new_open_risks} new open_risks in this submission`] : []),
    ...(r.open_risk_ids.length > 0 ? [`still open for this unit: ${r.open_risk_ids.join(", ")}`] : []),
    ...(r.projection_inconnue ? [`the open risks of this unit could not be established (${r.projection_inconnue})`] : []),
  ].join("; ");
  return (
    `Refused: ${REVIEW_APPROVED_WITH_OPEN_RISKS} — approved means nothing is left open after this ` +
    `submission, and ${ouverts}. Nothing was recorded. Either resolve them (copy the ids you settled ` +
    "into resolved_risks), or return needs_rework or blocked, or turn a genuinely non-blocking remark " +
    "into a finding instead of an open risk. Then call submit again."
  );
}
