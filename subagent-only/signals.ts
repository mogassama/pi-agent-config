/**
 * Réunir deux raisons d'arrêter en un seul signal.
 *
 * Une délégation peut être interrompue pour deux motifs sans rapport :
 * l'opérateur annule, ou la session perd la propriété du run. Les deux doivent
 * arrêter l'enfant, et la raison doit rester lisible — un run interrompu dont
 * on ne sait pas s'il a été arrêté ou repris par une autre session est
 * illisible au moment où il faudra le réconcilier.
 *
 * `AbortSignal.any` existe depuis Node 18.17, mais un repli qui n'annulerait
 * que sur l'un des deux signaux serait pire que pas de repli du tout : la perte
 * de propriété cesserait silencieusement d'interrompre les enfants dès qu'un
 * signal externe est présent, et seule la barrière post-enfant protégerait — or
 * elle empêche d'intégrer, pas d'écrire. Le contrat doit être le même partout,
 * pas « selon la version de node ».
 */

export function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const natif = (AbortSignal as unknown as {
    any?: (s: readonly AbortSignal[]) => AbortSignal;
  }).any;
  if (natif) return natif.call(AbortSignal, signals);

  const controller = new AbortController();
  const abandonne = (raison: unknown) => {
    if (!controller.signal.aborted) controller.abort(raison);
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abandonne(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => abandonne(signal.reason), { once: true });
  }
  return controller.signal;
}
