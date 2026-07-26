# Architecture — [NOM DU PROJET]

> **Règle de production de ce fichier.** Aucune ligne ne survit si elle n'a pas été
> validée en session. Les blocs de l'annexe en fin de template sont des références :
> ils ne sont recopiés dans le livrable que si l'outil correspondant a été retenu.
> L'annexe elle-même n'apparaît jamais dans le fichier produit.

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
- L'arborescence est **complète**. Un `...` dans ce bloc est un défaut de session Forge :
  le planner comblerait le trou avec une convention arbitraire.
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

> **Ne jamais recopier cette annexe dans le livrable.** Chaque bloc n'est utilisé que si
> l'outil correspondant a été explicitement validé en Phase 0. Les valeurs sont des
> exemples de forme, pas des recommandations.

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
<summary>Entrepôt colonne / BigQuery</summary>

- Partitionnement par date d'événement sur toute table dépassant quelques Go.
- Clustering sur les colonnes les plus filtrées (3-4 max, sélectivité décroissante).
- Schémas déclarés et versionnés dans le repo — pas d'auto-détection.
- Datasets : `<env>_<domain>`. Tables brutes : `raw_<source>__<entity>`.
- Montants : `<entity>_amount_<currency>`. Comptages : `<entity>_count`.
- Auth : credentials courts en dev, identité de service + impersonation en prod.
  Jamais de fichier de clé committé.
</details>

<details>
<summary>Orchestrateur type Airflow / Composer</summary>

- Un DAG = un fichier. Idempotence obligatoire par task.
- Zéro logique métier dans la définition du DAG : l'operator appelle une fonction externe.
- Configuration via Variables / Connections, jamais en dur.
- Retries explicites au niveau DAG, backoff exponentiel.
- DAG IDs : `<domain>_<frequency>_<purpose>`. Task IDs : verbe + objet.
</details>

<details>
<summary>Transformation SQL type dbt</summary>

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
