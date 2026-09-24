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

// ================================================================== C6.2 — l'application

/** Un `design_update` tel que C6.1 l'a validé au gel du plan. */
export interface DesignUpdate {
  decision_id: string;
  from_status: string;
  to_status: string;
}

/**
 * Ce que la phase Statut doit faire d'un `DESIGN.md` donné (C6.2, PLAN-LOT9 L9-Q7 et L9-Q9).
 *
 *   appliquer   statut courant = from_status : `contenu` est le fichier exact attendu, où
 *               seule la ligne `Statut : <from>` du bloc devient `Statut : <to>`
 *   inchange    statut courant = to_status : aucun commit
 *   refus       décision absente ou dupliquée, zéro ou plusieurs lignes de statut, statut
 *               courant ni from ni to
 *
 * Module pur : l'autorité est le `design_update` du plan gelé, jamais une seconde lecture de
 * la prose du plan. La grammaire de découpage est celle de `decisionsDe`.
 */
export type IssueStatut =
  | { issue: "appliquer"; contenu: string }
  | { issue: "inchange" }
  | { issue: "refus"; raison: string };

export function planifierStatut(design: string, du: DesignUpdate): IssueStatut {
  // Les séparateurs sont conservés tels quels : seule la ligne de statut change, octet pour
  // octet le reste du fichier, fins de ligne comprises.
  const morceaux = design.split(/(\r?\n)/);
  const blocs: Array<{ id: string; lignes: number[] }> = [];
  let courant: { id: string; lignes: number[] } | undefined;
  for (let i = 0; i < morceaux.length; i += 2) {
    const ligne = morceaux[i];
    if (ligne.startsWith("### ")) {
      const reste = ligne.slice(4);
      const j = reste.indexOf(SEPARATEUR);
      const id = j > 0 ? reste.slice(0, j) : "";
      courant = id !== "" && id === id.trim() ? { id, lignes: [] } : undefined;
      if (courant) blocs.push(courant);
      continue;
    }
    if (courant && /^Statut : (.*)$/.test(ligne)) courant.lignes.push(i);
  }
  const trouves = blocs.filter((b) => b.id === du.decision_id);
  if (trouves.length === 0) return { issue: "refus", raison: `la décision ${du.decision_id} est absente de DESIGN.md` };
  if (trouves.length > 1) {
    return { issue: "refus", raison: `la décision ${du.decision_id} est dupliquée dans DESIGN.md (${trouves.length} blocs)` };
  }
  const [bloc] = trouves;
  if (bloc.lignes.length !== 1) {
    return {
      issue: "refus",
      raison: `la décision ${du.decision_id} porte ${bloc.lignes.length} ligne(s) « Statut : », il en faut exactement une`,
    };
  }
  const index = bloc.lignes[0];
  const actuel = morceaux[index].slice("Statut : ".length);
  if (actuel === du.to_status) return { issue: "inchange" };
  if (actuel !== du.from_status) {
    return {
      issue: "refus",
      raison: `le statut courant « ${actuel} » de ${du.decision_id} n'est ni ${du.from_status} ni ${du.to_status}`,
    };
  }
  const apres = [...morceaux];
  apres[index] = `Statut : ${du.to_status}`;
  return { issue: "appliquer", contenu: apres.join("") };
}

/**
 * `apres` est-il EXACTEMENT la transformation de `avant` que C6.2 attend ?
 *
 * Sert à reconnaître un effet partiel du runtime (L9-Q7) et un commit de Statut à adopter
 * (L9-Q8) : vrai seulement si `avant` porte encore `from_status` et que `apres` en est la
 * transformation au octet près. Tout autre écart — un autre changement, une autre valeur —
 * rend faux.
 */
export function transformationExacte(avant: string, apres: string, du: DesignUpdate): boolean {
  const plan = planifierStatut(avant, du);
  return plan.issue === "appliquer" && plan.contenu === apres;
}
