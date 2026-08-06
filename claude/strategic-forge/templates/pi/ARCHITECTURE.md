# Architecture — [NOM DU PROJET]

> **Règle de production de ce fichier.** Aucune ligne ne survit si elle n'a pas été
> validée en session. Les blocs de l'annexe en fin de template sont des références :
> ils ne sont recopiés dans le livrable que si l'outil correspondant a été retenu
> **et** que le contenu n'est pas déjà porté par une skill. L'annexe elle-même
> n'apparaît jamais dans le fichier produit.
>
> **Ce que ce fichier porte, et que rien d'autre ne porte :** la structure et le
> nommage **propres à ce projet**. Les conventions d'écriture des outils sont dans
> les skills (`python-engineering`, `sql-engineering`, `bigquery-engineering`,
> `bigquery-ops`, `spark-engineering`, `airflow-engineering`, `dbt-engineering`,
> `data-quality`, `gcp-engineering`, `iac-terraform`) et n'ont pas à être recopiées ici.
>
> **Ce fichier décrit la cible, pas le dépôt.** L'état réel — ce qui existe, les points
> d'entrée, la structure effective — est porté par `.pi/BRIEF.md`, injecté au `worker`.
> Décrire ici l'état courant produit deux sources de vérité qui divergeront.
>
> **Chaque section se lit seule.** Aucun sous-agent ne lit ce fichier : l'orchestrateur
> en cite un extrait dans un texte de tâche, et l'enfant n'a rien d'autre. Pas de renvoi
> à une autre section, pas de pronom dont l'antécédent est ailleurs.

## Stack technique

| Composant | Outil | Version | Provenance |
|---|---|---|---|
| [rôle] | [outil retenu] | [version épinglée] | `imposée` \| `choisie` |

Règles de remplissage :
- Une ligne = un problème résolu. Un outil sans problème identifié est retiré.
- Versions épinglées quand la reproductibilité compte, `latest` seulement si assumé.
- `Provenance = imposée` → la ligne n'est pas rediscutable par pi.
- Si la stack est mono-outil, la table reste — elle sert de contrat à l'orchestrateur.

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

### Répertoires structurants

> La colonne `Skill` est le mécanisme de sélection : l'orchestrateur passe la skill de
> domaine par appel — `task({ agent: "reviewer", skills: ["<skill>"], task: "..." })` — et
> la choisit d'après le territoire que la tâche touche. Un répertoire sans skill
> correspondante est légitime : l'orchestrateur n'en passe aucune.
>
> **Cette colonne ne prend qu'une skill orientée relecture.** Onze skills portent un
> `## Review delta` et sont les seules qu'un reviewer puisse recevoir avec sa table de
> sévérité : `python-engineering`, `sql-engineering`, `bigquery-engineering`,
> `bigquery-ops`, `spark-engineering`, `airflow-engineering`, `dbt-engineering`,
> `data-quality`, `gcp-engineering`, `iac-terraform`, `technical-writing`.
>
> Les autres — `tdd`, `code-review`, `diagnose`, `grill-me`, `git-collaboration`,
> `dataeng-architecture`, `gcp-dataeng-architecture`, `improve-codebase-architecture` —
> ne s'écrivent jamais ici. Elles servent l'orchestrateur, ou constituent la mécanique de
> verdict. Injectée à un reviewer, une skill sans delta le fait juger sans barème et le
> résultat porte `(no severity table for: <skill>)`.
>
> **Le mapping suit le type de fichier, pas l'intention du répertoire.** `tests/` contient
> du Python : sa skill est `python-engineering`, quand bien même la stratégie de test
> relève de `tdd`. `sql/` contient du SQL BigQuery : `bigquery-engineering`, quand bien
> même l'administration relève de `bigquery-ops`. Un répertoire dont le type de fichier ne
> correspond à aucune des onze reçoit `—`.

| Répertoire | Rôle | Skill |
|---|---|---|
| `[répertoire]` | [ce qu'il contient, en une phrase] | `[skill]` \| — |

Valeurs admissibles, et aucune autre : `python-engineering`, `sql-engineering`,
`bigquery-engineering`, `bigquery-ops`, `spark-engineering`, `airflow-engineering`,
`dbt-engineering`, `data-quality`, `gcp-engineering`, `iac-terraform`,
`technical-writing`, ou `—`.

Règles :
- Nommer explicitement les répertoires structurants et leur rôle. Éviter les `...` :
  ils laissent le `worker` instancier une convention arbitraire. Un répertoire de détail
  non listé n'est pas un blocage — le `worker` le crée en cohérence avec ceux qui le sont.
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
  Chaque cible d'écriture nomme son mécanisme sur place — écrasement de partition,
  upsert par clé, transaction. Un principe d'idempotence énoncé sans mécanisme nommé
  n'est pas applicable par qui lit cet extrait seul.
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
