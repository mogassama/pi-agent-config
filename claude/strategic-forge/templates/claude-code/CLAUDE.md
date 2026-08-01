# [NOM DU PROJET]

> **Contrainte de longueur.** Ce fichier est chargé intégralement à chaque session.
> Cible : 80 lignes produites, plafond 120. Tout ce qui dépasse descend dans
> `ARCHITECTURE.md`, `DESIGN.md`, `BACKLOG.md` ou une rule scopée. Un `CLAUDE.md`
> long est un `CLAUDE.md` moins suivi.
>
> **Ce fichier ne contient rien qui existe déjà dans `~/.claude/`.** Le socle global
> couvre déjà les principes d'exécution, les limites dures, l'hygiène des secrets, les
> commits, l'outillage, et les conventions Python / SQL / dbt / Airflow / Terraform.
> Redire une règle globale ici crée une contradiction silencieuse que rien n'arbitre.

## Objectif

[Ce que le projet produit, en 2 phrases concrètes et vérifiables.]

## Hors scope

[Liste explicite, énoncée en positif. « Le projet ne fait pas X » — pas un silence.
Un hors-scope implicite n'existe pas, et c'est ici la seule barrière contre le scope
creep : aucune relecture par un autre agent n'intervient en aval.]

## Stack — invariants

| Composant | Outil | Version | Provenance |
|---|---|---|---|
| [rôle] | [outil] | [version] | `imposée` \| `choisie` |

Détail complet dans `ARCHITECTURE.md`. Une ligne `imposée` ne se rediscute pas.

## Fichiers du projet

| Fichier | Quand le lire |
|---|---|
| `ARCHITECTURE.md` | Avant toute décision de structure, de service ou de flux |
| `DESIGN.md` | Avant de rouvrir une décision qui semble arbitraire |
| `BACKLOG.md` | Au démarrage d'un item, et pour connaître l'état d'avancement |
| `.claude/rules/*.md` | Chargées automatiquement selon le fichier ouvert |

Ces fichiers ne sont **ni rediscutés, ni reformulés, ni résumés**.

## Autorité et arbitrage

Sur la **substance de ce projet** — quoi construire, avec quoi, quelle allure — les
fichiers ci-dessus font autorité. Sur le **comportement de l'agent**, c'est
`~/.claude/CLAUDE.md` qui fait autorité, et ce projet n'en dit rien.

**Trois cas. Un seul s'arrête.**

1. **Le bundle tranche** — appliquer. Ne pas rediscuter, ne pas reformuler.
2. **Le bundle est muet** — cas par défaut et majoritaire. Trancher sous les
   contraintes posées, continuer, consigner le *pourquoi* dans le corps du commit.
   Ne rien demander.
3. **Le repo contredit le bundle** — seul cas d'arrêt. Émettre une note de divergence
   (état observé, état attendu, options, aucune décision) et la porter à l'opérateur.
   Ne pas patcher l'architecture en cours de route, ne pas adopter silencieusement la
   version du repo.

Aucun quatrième cas. Les limites dures de `~/.claude/CLAUDE.md` restent la seule autre
liste d'arrêt. Un blanc dans le bundle, une fixture absente, une étape non testable, un
nommage ambigu : rien de tout cela n'arrête l'exécution.

Le seul champ de ces fichiers modifiable en session est la ligne `Statut` d'une décision
de `DESIGN.md`, et la colonne `État` d'un item de `BACKLOG.md`.

## [Invariants propres au projet]

> Section présente uniquement s'il existe une contrainte que ni le socle global ni
> `ARCHITECTURE.md` ne portent. Trois lignes maximum. Supprimée sinon.
