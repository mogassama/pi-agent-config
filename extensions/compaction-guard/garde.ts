/**
 * garde.ts — la décision de compaction de `compaction-guard`, pure et sans pi.
 *
 * POURQUOI CE MODULE EXISTE. Le premier pilote Balance Âgée a porté le contexte de
 * l'orchestrateur à 213 000 tokens sans une seule compaction : la compaction native de
 * pi 0.86.0 ne part qu'au-delà de `contextWindow − reserveTokens` (≈ 255 600 pour
 * gpt-5.6-sol), et la règle du bundle « /compact vers 50 % » n'était exécutable que par
 * l'opérateur. Ce garde réalise automatiquement la première branche de cette règle.
 *
 * LA RÈGLE, ADJUGÉE (Sol, 27-09) : déclenchement sur FRONT, jamais sur niveau.
 *
 *   usage < 50 %                         aucune compaction ; le garde se (ré)arme
 *   franchissement vers ≥ 50 %, armé     exactement une compaction ; le garde se désarme
 *   ≥ 50 % et désarmé                    rien — ni au tour suivant, ni sur une mesure stale
 *   compaction en cours                  rien — une seule à la fois
 *   usage inconnu (tokens null)          rien, et SURTOUT pas de réarmement : juste après
 *                                        une compaction, pi rend `tokens: null` ; réarmer
 *                                        sur l'inconnu rouvrirait la double compaction
 *
 * Le seuil est relatif à la fenêtre du modèle COURANT, telle que le runtime la rend dans
 * `getContextUsage().contextWindow`. Aucun override par modèle : c'est tout l'intérêt de
 * le faire ici plutôt que dans `settings.json`.
 *
 * ÉTAT INITIAL : armé. Une session reprise déjà au-dessus du seuil (le cas du pilote,
 * repris à 213 000 tokens) compacte donc une fois au premier tour. C'est un
 * « franchissement » au sens du garde : la première mesure connue est au-dessus.
 *
 * Un échec de compaction libère le verrou sans réarmer : l'usage est resté au-dessus,
 * et réessayer à chaque tour ferait une boucle d'échecs. Le garde se réarme quand
 * l'usage redescend, par exemple après un /compact manuel de récupération.
 */

/** Le seuil adjugé : 50 % de la fenêtre du modèle courant. */
export const SEUIL_RELATIF = 0.5;

export interface EtatGarde {
  /** Un franchissement déclenchera une compaction. */
  arme: boolean;
  /** Une compaction lancée par le garde n'a pas encore rendu la main. */
  enCours: boolean;
}

/** Ce que `ctx.getContextUsage()` rend dans pi 0.86.0 (`ContextUsage`), ou `undefined`. */
export interface Usage {
  tokens: number | null;
  contextWindow: number;
}

export type Decision =
  | { action: "compacter"; etat: EtatGarde; tokens: number; seuil: number }
  | { action: "rien"; etat: EtatGarde; motif: string };

export function etatInitial(): EtatGarde {
  return { arme: true, enCours: false };
}

/** La décision d'un `turn_end`. Ne mute rien : rend l'état suivant. */
export function decider(usage: Usage | undefined, etat: EtatGarde): Decision {
  if (etat.enCours) return { action: "rien", etat, motif: "compaction en cours" };
  if (usage === undefined || usage.tokens === null || !Number.isFinite(usage.tokens)) {
    return { action: "rien", etat, motif: "usage inconnu : ni compaction, ni réarmement" };
  }
  if (!Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) {
    return { action: "rien", etat, motif: `fenêtre du modèle inexploitable (${usage.contextWindow})` };
  }
  const seuil = usage.contextWindow * SEUIL_RELATIF;
  if (usage.tokens < seuil) {
    return { action: "rien", etat: { arme: true, enCours: false }, motif: "sous le seuil : garde armé" };
  }
  if (!etat.arme) return { action: "rien", etat, motif: "au-dessus du seuil, garde désarmé" };
  return { action: "compacter", etat: { arme: false, enCours: true }, tokens: usage.tokens, seuil };
}

/** Fin de la compaction lancée par le garde, réussie ou non : le verrou tombe, l'arme reste baissée. */
export function terminer(etat: EtatGarde): EtatGarde {
  return { arme: etat.arme, enCours: false };
}
