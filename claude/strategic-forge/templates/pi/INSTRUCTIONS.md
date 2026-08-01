# [NOM DU PROJET] — Instructions

> Lire avant toute action : `ARCHITECTURE.md`, `DESIGN.md`, `CONVENTIONS.md`.
> Ces trois fichiers sont figés. Ils ne sont ni rediscutés, ni reformulés, ni résumés.
>
> **Ce fichier décrit ce qui doit être.** Il ne décrit jamais l'état courant du repo :
> c'est le rôle de `.pi/BRIEF.md`, qui est local, non versionné et rafraîchi contre le
> code réel. Un écart entre les deux est un cas 3, pas une mise à jour à faire ici.

## Objectif
[Ce que le projet produit, en 2 phrases concrètes et vérifiables.]

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

Un critère qui **ne peut pas être évalué** — jeu de données absent, credential manquant,
outil non installé — est noté `unavailable: <raison>` dans la sortie, et l'item continue.
Une absence de prérequis n'est jamais une condition d'arrêt.

**La session est terminée quand tous les items ont passé leur critère de validation.**
Pas de liste de complétion séparée : elle divergerait du backlog.

## Périmètre de décision de pi

Ce bundle donne une **direction**, pas une spécification exhaustive. Il est muet sur
l'écrasante majorité des détails, et c'est son fonctionnement nominal.

**Trois cas. Un seul s'arrête.**

1. **Le bundle tranche** — stack, service, structure de répertoires, convention,
   anti-pattern, décision de `DESIGN.md`. Appliquer. Ne pas rediscuter, ne pas
   reformuler, ne pas résumer.
2. **Le bundle est muet** — cas par défaut. La skill compétente tranche, sous les
   contraintes posées par le bundle. Continuer, consigner la décision dans le corps du
   commit (le *pourquoi*, pas le *quoi*), ne rien demander.
3. **Le repo contredit le bundle** — seul cas d'arrêt. Émettre une note de divergence
   (état observé, état attendu, options, aucune décision) et la porter **à l'opérateur**.
   Ne pas patcher l'architecture en cours de route, ne pas adopter silencieusement la
   version du repo.

Aucun quatrième cas. Les `Hard limits` globales de pi restent la seule autre liste
d'arrêt ; elle est complète. Un blanc dans le bundle, une fixture absente, une étape non
testable, un nommage ambigu : rien de tout cela n'arrête l'exécution.

Le seul champ de ce bundle que pi peut écrire est la ligne `Statut` d'une décision de
`DESIGN.md`.

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
