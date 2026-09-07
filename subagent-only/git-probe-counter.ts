/**
 * Nombre de tentatives de lancement d'un processus git par le code de
 * production, depuis le début du processus.
 *
 * Tous les lanceurs de production incrémentent ce compteur. La lecture par
 * différence autour d'une reconstruction détermine lesquelles deviennent des
 * probes de reconstruction — le compteur ne connaît pas les fenêtres, il compte.
 *
 * La règle est volontairement sans exception : instrumenter les seuls lanceurs
 * qu'une reconstruction emprunte aujourd'hui aurait fait dépendre l'exactitude
 * de la liste de ceux qu'on pense à couvrir, et cette liste aurait vieilli sans
 * bruit le jour où un chemin d'observation passe par un lanceur oublié. Une
 * invocation hors fenêtre monte le total global et ne change aucun
 * `git_probe_count`.
 *
 * Un seul compteur, partagé : pas de compteurs locaux à agréger, pour la même
 * raison.
 *
 * **L'unité est l'invocation tentée, pas l'appel d'un helper.** Ce que la
 * métrique doit dire est le coût payé au système, et un `git` qui sort en
 * non-zéro a coûté son processus exactement comme un autre. Un helper qui en
 * enveloppe un autre — `tryGit` autour de `git` — n'incrémente donc pas :
 * seule la feuille qui lance compte, sans quoi une même invocation vaudrait
 * deux selon le chemin d'appel.
 *
 * **Ni `reset`, ni setter de test, ni notion de fenêtre active.** Une fenêtre se
 * mesure par différence entre deux lectures, et cette forme-là a une propriété
 * que la remise à zéro n'a pas : deux mesures qui se chevauchent ou se suivent
 * ne s'abîment pas l'une l'autre. Un `reset` exposé serait un moyen de fausser
 * la mesure depuis n'importe où, y compris depuis un test qui croirait s'isoler.
 *
 * **L'hypothèse qui rend la différence exacte** — et elle doit être vraie là où
 * on mesure : la reconstruction et ses appels git sont séquentiels dans le même
 * processus, et aucun autre producteur git ne tourne pendant la fenêtre. Le bail
 * protège l'exclusivité du run, ce qui n'est pas la même chose : il empêche une
 * autre session d'agir sur le même run, pas un second appelant du même processus
 * de lancer git entre les deux lectures. C'est la synchronie qui protège l'unité
 * de mesure.
 */

let gitInvocationCount = 0;

/** Appelé immédiatement avant de lancer git, y compris si le lancement échoue. */
export function recordGitInvocation(): void {
  gitInvocationCount += 1;
}

/** Le total depuis le début du processus. Une fenêtre se lit par différence. */
export function readGitInvocationCount(): number {
  return gitInvocationCount;
}
