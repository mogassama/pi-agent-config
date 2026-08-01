# Architecture — [NOM DU PROJET]

> **Règle de production de ce fichier.** Aucune ligne ne survit si elle n'a pas été
> validée en session. Les blocs de l'annexe en fin de template sont des références :
> ils ne sont recopiés dans le livrable que si l'outil correspondant a été retenu
> **et** que le contenu n'est pas déjà porté par une skill. L'annexe elle-même
> n'apparaît jamais dans le fichier produit.
>
> **Ce que ce fichier porte, et que rien d'autre ne porte :** la structure et le
> nommage **propres à ce projet**. Les conventions d'écriture des outils sont dans
> les skills (`bigquery-engineering`, `dbt-engineering`, `airflow-engineering`,
> `iac-terraform`, `spark-engineering`) et n'ont pas à être recopiées ici.

## Stack technique

| Composant | Outil | Version | Provenance |
|---|---|---|---|
| [rôle] | [outil retenu] | [version épinglée] | `imposée` \| `choisie` |

Règles de remplissage :
- Une ligne = un problème résolu. Un outil sans problème identifié est retiré.
- Versions épinglées quand la reproductibilité compte, `latest` seulement si assumé.
- `Provenance = imposée` → la ligne n'est pas rediscutable par pi.
- Si la stack est mono-outil, la table reste — elle sert de contrat au planner.

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

> À produire à partir des conventions natives de la stack retenue, pas d'un layout par défaut.

```
[nom_projet]/
├── [fichier de manifeste du gestionnaire de paquets retenu]
├── README.md
└── [arborescence complète, sans « ... »]
```

Règles :
- Nommer explicitement les répertoires structurants et leur rôle. Éviter les `...` :
  ils laissent le planner instancier une convention arbitraire. Un répertoire de détail
  non listé n'est pas un blocage — le planner le crée en cohérence avec ceux qui le sont.
- Séparation explicite entre logique métier (sans I/O) et adaptateurs (I/O, réseau, stockage).
- Les répertoires de test miroitent la structure du code.

## Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| [fichiers] | [casse] | [exemple concret] |
| [types / classes] | [casse] | [exemple concret] |
| [constantes / variables d'env] | [casse] | [exemple concret] |
| [entités de stockage] | [pattern] | [exemple concret] |

Règles transverses :
- Pas d'abréviations cryptiques. Pas de noms vagues (`data`, `process`, `handle`, `utils`).
- Les identifiants portent leur entité : `<entity>_id`, jamais `id` seul.
- Les booléens portent leur prédicat : `is_<adj>` / `has_<noun>`.
- Les horodatages portent leur événement et leur fuseau : `<event>_at`, UTC par défaut.

## Principes architecturaux

- **Boring is good** : à bénéfice comparable, l'option éprouvée et documentée gagne.
- **Séparation pure / impure** : les transformations sont testables sans mock ; les
  side-effects sont isolés dans une couche dédiée.
- **Configuration par injection** : les paramètres traversent les signatures de fonctions.
  Pas d'import d'un module de config global depuis la logique métier.
- **Idempotence obligatoire** : toute écriture peut être rejouée sans effet de bord.
  Le mécanisme exact (écrasement de partition, upsert par clé, transaction) est nommé
  explicitement dans la section stockage.
- **Fail-fast** : exception explicite au premier état inattendu. Pas de retour silencieux.
- **Composition > héritage** : au-delà de deux niveaux de hiérarchie, chercher autre chose.

## [Spécificités de la stack retenue]

> Une sous-section par outil ou service validé, tirée de l'annexe ci-dessous ou rédigée
> pendant la session. Section absente si rien à préciser.

---
---

# ANNEXE — blocs de référence conditionnels

> **Ne jamais recopier cette annexe dans le livrable.**
>
> **Double test avant d'utiliser un bloc :** l'outil a-t-il été validé en Phase 0, et
> le contenu est-il absent des skills pi ? Ces blocs ont été réduits au **nommage et à
> la structure** — ce qui relève des conventions d'écriture est déjà couvert ailleurs.
> Les valeurs sont des exemples de forme, pas des recommandations.

<details>
<summary>Projet Python packagé</summary>

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

Nommage : modules et fonctions en `snake_case`, classes en `PascalCase`,
constantes en `SCREAMING_SNAKE_CASE`, privé préfixé `_`.
</details>

<details>
<summary>Entrepôt colonne — nommage d'entités</summary>

Uniquement le nommage propre au projet. Partitionnement, clustering, règles d'écriture
et gestion des credentials sont portés par `bigquery-engineering` et `gcp-engineering`.

- Datasets : `<env>_<domain>`. Tables brutes : `raw_<source>__<entity>`.
- Montants : `<entity>_amount_<currency>`. Comptages : `<entity>_count`.
</details>

<details>
<summary>Orchestrateur — nommage</summary>

Structure et nommage seulement. Idempotence, retries, configuration et séparation
logique/définition sont portées par `airflow-engineering`.

- DAG IDs : `<domain>_<frequency>_<purpose>`. Task IDs : verbe + objet.
- Un DAG = un fichier.
</details>

<details>
<summary>Transformation SQL type dbt — nommage de couches</summary>

Nommage et matérialisations seulement. Le reste est porté par `dbt-engineering`.

- Staging : `stg_<source>__<entity>` — Intermediate : `int_<entity>__<verb>`
- Faits : `fct_<entity>` — Dimensions : `dim_<entity>`
- Matérialisations : staging en `view`, intermediate en `ephemeral` ou `view`,
  marts en `table` ou `incremental`.
</details>

<details>
<summary>Messagerie asynchrone type Pub/Sub</summary>

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
