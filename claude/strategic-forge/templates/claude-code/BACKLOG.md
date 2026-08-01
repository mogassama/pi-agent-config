# Backlog — [NOM DU PROJET]

> **Pourquoi ce fichier est séparé de `CLAUDE.md`.** Son contenu change à chaque
> session. `CLAUDE.md` est chargé au démarrage de toutes les sessions : y placer un
> contenu variable invalide le cache de prompt à chaque appel. Ce fichier est lu à la
> demande, au démarrage d'un item.
>
> **Aucun timestamp, aucune date, aucun identifiant de session** en tête de ce fichier.

## Granularité

**Un item = un livrable testable.** Pas une étape d'implémentation. Le découpage en
passes d'écriture, la liste des fichiers à toucher et l'ordre interne des opérations
appartiennent à la session d'exécution — ils n'apparaissent pas ici.

## Items

| # | État | Livrable | Critère d'acceptation |
|---|---|---|---|
| 1 | `à faire` | Scaffolding : structure conforme à `ARCHITECTURE.md`, dépendances installées, outillage opérationnel | Arborescence complète, commandes de lint et de test s'exécutent sans erreur |
| 2 | `à faire` | [livrable] | [condition observable] |

États : `à faire` · `en cours` · `fait` · `bloqué`.

## Règles d'acceptation

Un critère d'acceptation est **observable** : une commande qui passe, un fichier qui
existe, une assertion qui tient, une valeur qui correspond. « Implémenté correctement »,
« ça marche » et « conforme aux conventions » ne sont pas des critères.

Cette exigence est ferme sur ce projet : aucune relecture par un autre agent
n'intervient en aval. Un item sans critère vérifiable sera déclaré terminé par l'agent
qui l'a écrit.

Un critère qui **ne peut pas être évalué** — jeu de données absent, credential manquant,
outil non installé — est noté `unavailable: <raison>` dans la sortie, et l'item continue.
Une absence de prérequis n'est jamais une condition d'arrêt.

## Done

Le backlog est terminé quand :
- [ ] [Critère 1]
- [ ] [Critère 2]
