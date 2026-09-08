/**
 * Combien d'invocations git le chemin de reconstruction a lancées.
 *
 * **Le contrat, dans sa forme exacte.** `git_probe_count` compte les invocations
 * git **synchrones** effectuées par le chemin de reconstruction entre
 * l'ouverture et la fermeture de sa fenêtre. Il ne prétend **pas** inventorier
 * toutes les invocations git de la configuration.
 *
 * La version précédente de ce commentaire disait « tout lanceur git de
 * production incrémente ce compteur ». C'était faux : `pi-session-journal` lance
 * `pi.exec("git", …)` et `pi-project-brief` lance git à travers
 * `pi.exec("bash", ["-lc", …])`. Aucun des deux n'incrémente, et aucun n'était
 * même détecté. La mesure, elle, restait exacte — ces appels sont asynchrones et
 * ne peuvent pas s'intercaler dans une fenêtre synchrone — mais la portée
 * revendiquée ne l'était pas, et un contrat qui surpromet vaut moins qu'un
 * contrat étroit.
 *
 * **Ce qui garantit l'exactitude** n'est donc pas l'exhaustivité de
 * l'instrumentation, c'est la **synchronie** : la reconstruction et ses appels
 * git s'exécutent d'un bloc dans le même processus, et rien d'asynchrone ne
 * s'intercale entre les deux lectures. Le bail protège l'exclusivité du run, ce
 * qui est une autre chose : il empêche une autre session d'agir sur le même run,
 * pas un second appelant du même processus de lancer git entre les deux lectures.
 *
 * **L'unité est l'invocation tentée, pas l'appel d'un helper.** Un `git` qui
 * sort en non-zéro a coûté son processus comme un autre. Un helper qui en
 * enveloppe un autre — `tryGit` autour de `git` — n'incrémente pas : seule la
 * feuille qui lance compte, sans quoi une même invocation vaudrait deux selon le
 * chemin d'appel.
 *
 * **Ni `reset`, ni setter de test, ni notion de fenêtre active.** Une fenêtre se
 * mesure par différence entre deux lectures, et cette forme-là a une propriété
 * que la remise à zéro n'a pas : deux mesures qui se suivent ne s'abîment pas
 * l'une l'autre. Un `reset` exposé serait un moyen de fausser la mesure depuis
 * n'importe où, y compris depuis un test qui croirait s'isoler.
 *
 * Quels sites incrémentent, et lesquels ne doivent pas : voir
 * `tests/git-probe-counter.test.ts`, qui classe chaque lanceur reconnaissable et
 * échoue sur toute occurrence non classée.
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
