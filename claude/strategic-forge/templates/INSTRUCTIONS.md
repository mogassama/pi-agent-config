# [NOM DU PROJET] — Instructions

> Lire avant toute action : `ARCHITECTURE.md`, `DESIGN.md`, `CONVENTIONS.md`.
> Ces trois fichiers sont figés. Ils ne sont ni rediscutés, ni reformulés, ni résumés.

## Objectif
[Ce que le projet produit, en 2 phrases concrètes et vérifiables.]

## Livrables de session
[Artefacts attendus à la fin : fichiers, endpoints, tables, jobs, scripts.]

## Hors scope
[Ce que pi ne doit PAS faire dans cette session. Liste explicite — un hors-scope
implicite n'existe pas.]

## Backlog Sprint

> **Granularité : un item = une invocation du planner.** Chaque ligne est un livrable
> testable, pas une étape d'implémentation. Le découpage en passes de worker, la liste
> des fichiers à toucher et l'ordre interne des opérations appartiennent au planner —
> ils n'apparaissent pas ici.

| # | Livrable | Critère de validation |
|---|---|---|
| 1 | Scaffolding : structure de répertoires conforme à `ARCHITECTURE.md`, dépendances installées, outillage de `CONVENTIONS.md` opérationnel | Arborescence complète, commandes de lint/test/format s'exécutent sans erreur |
| 2 | [livrable] | [condition observable, pas « ça marche »] |

Un critère de validation est observable : une commande qui passe, un fichier qui existe,
une assertion qui tient. « Implémenté correctement » n'est pas un critère.

## Done
Session terminée quand :
- [ ] [Critère 1]
- [ ] [Critère 2]

## Périmètre de décision de pi

pi exécute dans une architecture déjà tranchée. Il ne choisit ni la stack, ni les
services, ni la structure de répertoires, ni les conventions.

Si le repo contredit `ARCHITECTURE.md`, ou si un item du backlog est infaisable dans
l'architecture décrite : **s'arrêter**, formuler la divergence (constat + options, pas
de décision), escalader. Ne jamais réviser l'architecture en cours de route.

## Commande de lancement
```
pi "Lis INSTRUCTIONS.md et exécute le backlog en commençant par le livrable #1"
```

## Gestion du contexte pi
- Lancer `/compact` à ~50% du contexte ou après chaque item du backlog. Ne pas attendre
  l'auto-compact.
- Après `/compact`, relire uniquement `INSTRUCTIONS.md` pour retrouver l'état du
  backlog — pas les trois autres fichiers, déjà en cache.
- Ordre d'injection pour préserver le cache :
  `CONVENTIONS.md → ARCHITECTURE.md → DESIGN.md → INSTRUCTIONS.md`
