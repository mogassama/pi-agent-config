# Architecture — [NOM DU PROJET]

> **Règle de production de ce fichier.** Aucune ligne ne survit si elle n'a pas été
> validée en session. Les blocs de l'annexe sont des références de forme : ils ne sont
> recopiés que si l'outil correspondant a été retenu **et** n'est pas déjà couvert par
> `~/.claude/rules/conventions.md`. L'annexe elle-même n'apparaît jamais dans le
> fichier produit.
>
> **Régime de lecture.** Ce fichier n'est pas chargé automatiquement. Il est lu à la
> demande, avant une décision de structure. Il peut donc être détaillé — c'est
> `CLAUDE.md` qui doit rester court, pas celui-ci.

## Stack technique

| Composant | Outil | Version | Provenance |
|---|---|---|---|
| [rôle] | [outil retenu] | [version épinglée] | `imposée` \| `choisie` |

Règles de remplissage :
- Une ligne = un problème résolu. Un outil sans problème identifié est retiré.
- Versions épinglées quand la reproductibilité compte, `latest` seulement si assumé.
- `Provenance = imposée` → la ligne n'est pas rediscutable.

## Composants d'infrastructure

> Section supprimée intégralement si le projet ne déploie rien.

| Composant | Rôle exact | Provenance |
|---|---|---|
| [service / runtime / stockage] | [ce qu'il fait, en une phrase] | `imposée` \| `choisie` |

## Flux de données

> Section supprimée si le projet ne déplace pas de données.

```
[Source]
  → [Étape d'extraction]
  → [Étape de transformation]
  → [Destination]
```

Pour chaque flèche : volume attendu, fréquence, et mode de déclenchement.

## Structure de répertoires

> À produire à partir des conventions natives de la stack retenue, pas d'un layout
> par défaut.

```
[nom_projet]/
├── CLAUDE.md
├── ARCHITECTURE.md
├── DESIGN.md
├── BACKLOG.md
├── .claude/
│   └── rules/
├── [fichier de manifeste du gestionnaire de paquets retenu]
├── README.md
└── [arborescence complète, sans « ... »]
```

Règles :
- Nommer explicitement les répertoires structurants et leur rôle. Éviter les `...` :
  ils laissent instancier une convention arbitraire. Un répertoire de détail non listé
  n'est pas un blocage — il se crée en cohérence avec ceux qui le sont.
- Séparation explicite entre logique métier (sans I/O) et adaptateurs (I/O, réseau,
  stockage).
- Les répertoires de test miroitent la structure du code.

## Conventions de nommage

> Ne pas reprendre les conventions de casse et de style déjà portées par
> `~/.claude/rules/conventions.md`. Cette table ne porte que le nommage des **entités
> propres au projet**.

| Élément | Convention | Exemple |
|---|---|---|
| [entité métier] | [pattern] | [exemple concret] |
| [entités de stockage] | [pattern] | [exemple concret] |

Règles transverses, si elles ne sont pas déjà couvertes :
- Pas d'abréviations cryptiques. Pas de noms vagues (`data`, `process`, `handle`, `utils`).
- Les identifiants portent leur entité : `<entity>_id`, jamais `id` seul.
- Les booléens portent leur prédicat : `is_<adj>` / `has_<noun>`.
- Les horodatages portent leur événement et leur fuseau : `<event>_at`, UTC par défaut.

## Principes architecturaux

> Ne conserver que ceux qui sont structurants **pour ce projet**. Les principes
> génériques déjà énoncés dans le socle global sont supprimés.

- **Boring is good** : à bénéfice comparable, l'option éprouvée et documentée gagne.
- **Séparation pure / impure** : les transformations sont testables sans mock ; les
  side-effects sont isolés dans une couche dédiée.
- **Configuration par injection** : les paramètres traversent les signatures de
  fonctions. Pas d'import d'un module de config global depuis la logique métier.
- **Idempotence obligatoire** : toute écriture peut être rejouée sans effet de bord.
  Le mécanisme exact (écrasement de partition, upsert par clé, transaction) est nommé
  explicitement dans la section stockage.
- **Fail-fast** : exception explicite au premier état inattendu. Pas de retour silencieux.
- **Composition > héritage** : au-delà de deux niveaux de hiérarchie, chercher autre chose.

## [Spécificités de la stack retenue]

> Une sous-section par outil ou service validé, tirée de l'annexe ou rédigée pendant
> la session. Section absente si rien à préciser.

---
---

# ANNEXE — blocs de référence conditionnels

> **Ne jamais recopier cette annexe dans le livrable.**
>
> **Double test avant d'utiliser un bloc :** l'outil a-t-il été validé en Phase 0, et
> le contenu du bloc est-il absent de `~/.claude/rules/conventions.md` ? Le socle
> global couvre déjà en profondeur BigQuery, dbt, Airflow, Terraform, PostgreSQL et
> Python. Ce qui reste utile ici, c'est la **structure et le nommage propres au
> projet**, pas les conventions d'écriture.

<details>
<summary>Projet Python packagé — arborescence</summary>

```
[nom_projet]/
├── pyproject.toml
├── README.md
├── .env.example
├── .gitignore
├── src/
│   └── [nom_projet]/
│       ├── __init__.py
│       ├── config.py        # lecture des variables d'environnement
│       ├── domain/          # logique métier pure, aucun I/O
│       ├── infrastructure/  # clients réseau, stockage, base
│       ├── pipelines/       # orchestration
│       └── cli.py
├── tests/
│   ├── unit/                # aucun réseau
│   ├── integration/
│   └── conftest.py
└── scripts/                 # one-shot, non packagés
```
</details>

<details>
<summary>Entrepôt colonne — nommage d'entités</summary>

Uniquement le nommage propre au projet. Le partitionnement, le clustering et les
règles d'écriture sont dans le socle global.

- Datasets : `<env>_<domain>`. Tables brutes : `raw_<source>__<entity>`.
- Montants : `<entity>_amount_<currency>`. Comptages : `<entity>_count`.
</details>

<details>
<summary>Transformation SQL type dbt — nommage de couches</summary>

- Staging : `stg_<source>__<entity>` — Intermediate : `int_<entity>__<verb>`
- Faits : `fct_<entity>` — Dimensions : `dim_<entity>`
- Matérialisations : staging en `view`, intermediate en `ephemeral` ou `view`,
  marts en `table` ou `incremental`.
</details>

<details>
<summary>Orchestrateur — nommage</summary>

- DAG IDs : `<domain>_<frequency>_<purpose>`. Task IDs : verbe + objet.
- Un DAG = un fichier.
</details>

<details>
<summary>Messagerie asynchrone</summary>

- Schémas de message déclarés explicitement et versionnés.
- Dead letter topic configuré sur toute subscription critique.
- Consommateurs idempotents : la livraison at-least-once est l'hypothèse par défaut.
</details>

<details>
<summary>Choix runtime serverless</summary>

- Fonction événementielle → déclencheur simple, trafic faible, exécution courte.
- Conteneur managé → image custom, API HTTP, jobs longs.
- Le critère de bascule est la durée d'exécution et le besoin de dépendances système,
  pas la préférence.
</details>
