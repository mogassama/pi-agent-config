# [NOM DU PROJET] — Instructions

> **Ce fichier s'adresse à l'orchestrateur.** Lire avant toute action :
> `ARCHITECTURE.md`, `DESIGN.md`, `CONVENTIONS.md`. Ces trois fichiers sont figés. Ils
> ne sont ni rediscutés, ni reformulés, ni résumés.
>
> **Aucun sous-agent ne lit ce bundle.** Chaque délégation lance un processus neuf qui
> ne reçoit que son prompt de rôle, éventuellement une skill de domaine, et le texte de
> tâche. Ce qui doit atteindre un enfant est **cité verbatim** dans ce texte.
> `.pi/BRIEF.md` fait exception : il est injecté au `worker`, et à lui seul.
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

> **Granularité : un item = un livrable testable**, pas une étape d'implémentation. Le
> découpage en passes d'écriture et l'ordre interne des opérations n'apparaissent pas ici.
>
> **Chaque item se lit seul.** L'orchestrateur en compose un texte de tâche autonome
> pour un processus qui ne connaît ni ce fichier ni ce projet. Un item formulé comme un
> titre — « brancher l'ingestion » — l'oblige à reconstituer le contexte, et il le fera
> mal. Ce n'est pas la granularité qui descend, c'est la description qui se suffit.

### 1 — Scaffolding

**Territoire :** [répertoires concernés, tels que nommés dans `ARCHITECTURE.md`]
**Résultat attendu :** structure de répertoires conforme à `ARCHITECTURE.md`,
dépendances installées, outillage propre au projet opérationnel.
**Critère de fin :** arborescence complète, les commandes de test et d'outillage
déclarées s'exécutent sans erreur.

### 2 — [Titre du livrable]

**Territoire :** [fichiers ou répertoires nommés — c'est ce qui détermine la skill injectée]
**Résultat attendu :** [ce qui existe et fonctionne après, formulé sans référence
à un autre item ni à une autre section]
**Critère de fin :** [condition observable, pas « ça marche »]

Un critère de fin est observable : une commande qui passe, un fichier qui existe,
une assertion qui tient. « Implémenté correctement » n'est pas un critère.

Un critère qui **ne peut pas être évalué** — jeu de données absent, credential manquant,
outil non installé — est noté `unavailable: <raison>` dans la sortie, et l'item continue.
Une absence de prérequis n'est jamais une condition d'arrêt.

**La session est terminée quand tous les items ont passé leur critère de fin.**
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

## Gestion du contexte — session orchestrateur

> Ne concerne que la session qui lit ce fichier. Un sous-agent démarre sur un contexte
> vide à chaque délégation et n'a rien à compacter.

- Lancer `/compact` à ~50% du contexte ou après chaque item du backlog. Ne pas attendre
  l'auto-compact.
- Après `/compact`, relire uniquement `INSTRUCTIONS.md` pour retrouver l'état du
  backlog — pas les trois autres fichiers, déjà en cache.
- Ordre d'injection pour préserver le cache :
  `CONVENTIONS.md → ARCHITECTURE.md → DESIGN.md → INSTRUCTIONS.md`
