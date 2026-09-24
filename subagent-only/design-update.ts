/**
 * design-update.ts — C6.1 : la désignation d'une ligne Statut, validée au gel du plan.
 *
 * Module pur : il ne lit ni le disque ni git. L'appelant lui donne le plan tel qu'il a été
 * écrit, le régime (bundle complet ou non) et le texte de `DESIGN.md` ; il rend « valide »
 * ou la raison nommée du refus. Aucune décision n'est prise ailleurs sur `design_update` au
 * gel : `validatePlan` et son ombre Python restent une validation syntaxique du plan, pas
 * une autorité C6.1 (PLAN-LOT8 Q11).
 *
 * La grammaire est celle de C0 v1.9, et rien d'autre :
 *
 *   début de décision   `### <decision_id> — <titre>`
 *   decision_id         le segment non vide, sans espace en bord, entre `### ` et le premier
 *                       séparateur exact ` — ` ; comparé exactement, jamais par numéro de ligne
 *   bloc                jusqu'à la prochaine ligne commençant par `### `, ou la fin du fichier
 *   statut              exactement une ligne `Statut : <valeur>` dans le bloc
 *   vocabulaire         proposé | en cours | terminé
 *   transitions         proposé → en cours, en cours → terminé
 *
 * Un `DESIGN.md` qui ne suit pas cette grammaire n'a aucune décision identifiable : tout
 * `design_update` qui le vise est refusé. C'est fail-closed, et c'est voulu (C0 v1.9).
 */

export const STATUTS_DESIGN: readonly string[] = ["proposé", "en cours", "terminé"];
export const TRANSITIONS_DESIGN: ReadonlyArray<readonly [string, string]> = [
  ["proposé", "en cours"],
  ["en cours", "terminé"],
];

const SEPARATEUR = " — ";

/** Un bloc de décision tel que la grammaire le découpe. */
export interface BlocDeDecision {
  id: string;
  /** Les valeurs de toutes les lignes `Statut : …` du bloc, dans l'ordre. */
  statuts: string[];
}

/** Les blocs de décision d'un `DESIGN.md`, dans l'ordre du fichier, doublons compris. */
export function decisionsDe(design: string): BlocDeDecision[] {
  const blocs: BlocDeDecision[] = [];
  let courant: BlocDeDecision | undefined;
  for (const ligne of design.split(/\r?\n/)) {
    if (ligne.startsWith("### ")) {
      // Toute ligne `### ` clôt le bloc précédent ; elle n'en ouvre un que si elle porte
      // un identifiant conforme.
      const reste = ligne.slice(4);
      const i = reste.indexOf(SEPARATEUR);
      const id = i > 0 ? reste.slice(0, i) : "";
      courant = id !== "" && id === id.trim() ? { id, statuts: [] } : undefined;
      if (courant) blocs.push(courant);
      continue;
    }
    const statut = /^Statut : (.*)$/.exec(ligne);
    if (statut && courant) courant.statuts.push(statut[1]);
  }
  return blocs;
}

export interface ContexteDesign {
  /** Le régime bundle : les quatre fichiers du bundle à la racine (C3.6). */
  bundle: boolean;
  /** Le texte de `DESIGN.md`, ou `undefined` s'il n'a pas pu être lu. */
  design: string | undefined;
}

export type VerdictDesign = { ok: true } | { ok: false; reason: string };

/**
 * Chaque `design_update` du plan, contre C0 v1.9 (C6.1). Le premier défaut suffit à refuser,
 * et il est nommé avec l'unité qui le porte.
 *
 * Un plan qui ne porte aucun `design_update` est valide quel que soit le régime : l'absence
 * n'est pas une désignation. La présence de la clé, elle, en est une — même vide, même mal
 * formée — et se juge.
 */
export function validerDesignUpdates(doc: unknown, contexte: ContexteDesign): VerdictDesign {
  const unites = (doc as { work_units?: unknown } | null | undefined)?.work_units;
  if (!Array.isArray(unites)) return { ok: true };
  const porteurs: Array<{ unite: string; du: unknown }> = [];
  for (const u of unites) {
    if (typeof u !== "object" || u === null || Array.isArray(u) || !("design_update" in u)) continue;
    const id = (u as { id?: unknown }).id;
    porteurs.push({ unite: typeof id === "string" ? id.trim() : String(id), du: (u as { design_update: unknown }).design_update });
  }
  if (porteurs.length === 0) return { ok: true };

  if (!contexte.bundle) {
    return {
      ok: false,
      reason: `${porteurs[0].unite} porte un design_update hors régime bundle : C6.1 l'interdit, il n'est pas ignoré`,
    };
  }
  if (contexte.design === undefined) {
    return { ok: false, reason: "DESIGN.md illisible : aucun design_update ne s'y établit" };
  }
  const blocs = decisionsDe(contexte.design);
  const proprietaires = new Map<string, string>();

  for (const { unite, du } of porteurs) {
    if (typeof du !== "object" || du === null || Array.isArray(du)) {
      return { ok: false, reason: `${unite} : design_update n'est pas un objet { decision_id, from_status, to_status }` };
    }
    const cles = Object.keys(du).sort().join(",");
    const { decision_id: decision, from_status: de, to_status: vers } = du as Record<string, unknown>;
    if (cles !== "decision_id,from_status,to_status" ||
        typeof decision !== "string" || typeof de !== "string" || typeof vers !== "string") {
      return { ok: false, reason: `${unite} : design_update mal formé (clés ${cles || "aucune"})` };
    }
    if (!STATUTS_DESIGN.includes(de)) {
      return { ok: false, reason: `${unite} : from_status « ${de} » hors du vocabulaire ${STATUTS_DESIGN.join(" | ")}` };
    }
    if (!STATUTS_DESIGN.includes(vers)) {
      return { ok: false, reason: `${unite} : to_status « ${vers} » hors du vocabulaire ${STATUTS_DESIGN.join(" | ")}` };
    }
    if (!TRANSITIONS_DESIGN.some(([a, b]) => a === de && b === vers)) {
      return { ok: false, reason: `${unite} : transition ${de} → ${vers} non autorisée` };
    }
    const trouves = blocs.filter((b) => b.id === decision);
    if (trouves.length === 0) {
      return { ok: false, reason: `${unite} : la décision ${decision} est absente de DESIGN.md` };
    }
    if (trouves.length > 1) {
      return { ok: false, reason: `${unite} : la décision ${decision} est dupliquée dans DESIGN.md (${trouves.length} blocs)` };
    }
    const [bloc] = trouves;
    if (bloc.statuts.length !== 1) {
      return {
        ok: false,
        reason: `${unite} : la décision ${decision} porte ${bloc.statuts.length} ligne(s) « Statut : », il en faut exactement une`,
      };
    }
    if (!STATUTS_DESIGN.includes(bloc.statuts[0])) {
      return { ok: false, reason: `${unite} : le statut courant « ${bloc.statuts[0]} » de ${decision} est hors du vocabulaire` };
    }
    const deja = proprietaires.get(decision);
    if (deja !== undefined) {
      return { ok: false, reason: `la décision ${decision} a deux unités propriétaires, ${deja} et ${unite}` };
    }
    proprietaires.set(decision, unite);
  }
  return { ok: true };
}
