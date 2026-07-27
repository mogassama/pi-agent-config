# Conventions — [NOM DU PROJET]

> **Périmètre de ce fichier.** Il ne contient que ce qui est propre à ce projet.
> Les règles transverses (typage, logging, hygiène des secrets, format de commits,
> staging git, comportement de l'agent) vivent dans l'`AGENTS.md` global de pi et dans
> les skills. Elles ne sont **jamais** redéclarées ici : une règle dupliquée est une
> règle qui divergera.
>
> **Règle de production.** Aucune section n'est conservée « au cas où ». Un outil non
> validé en session ne laisse aucune trace dans le fichier produit. Les blocs de
> l'annexe sont des références de forme et n'apparaissent jamais dans le livrable.

## Outillage du projet

| Fonction | Outil retenu | Commande |
|---|---|---|
| Lint | [outil] | `[commande]` |
| Format | [outil] | `[commande]` |
| Types | [outil] | `[commande]` |
| Tests | [outil] | `[commande]` |
| Hooks | [outil] | `[commande]` |

Toute ligne sans outil validé est supprimée, pas laissée vide.

## Configuration lint / format

> Bloc supprimé si aucun linter validé. Sinon : configuration réelle, épinglée,
> dans le format natif de l'outil retenu.

```
[configuration complète, prête à copier dans le fichier de config du projet]
```

## Hooks de pre-commit

> Bloc supprimé si aucun système de hooks validé. Un hook par outil de la table
> ci-dessus, plus les hooks d'hygiène de fichiers. Aucun hook pour un outil absent
> de la stack.

```
[configuration complète des hooks]
```

## Tests

### Couverture — règle qualitative, pas de pourcentage cible
- Toute logique métier non triviale : test unitaire.
- Toute fonction manipulant des données : test sur données réalistes, pas sur données jouets.
- Tout artefact déployable (job, DAG, modèle, endpoint) : test d'intégrité minimal.
- Tout contrat de données : test sur les clés et les valeurs autorisées.

### Nommage
Format : `test_<unité>_<comportement_attendu>`. Le nom du test décrit l'assertion,
pas la mise en place.

### Tests d'intégration
- Émulateurs locaux quand ils existent.
- Sinon : environnement dédié, ressources préfixées et isolées par branche.
- Cleanup obligatoire en fin de test, y compris en cas d'échec.

## Documentation

### README — contenu minimum
1. **Quoi** : ce que fait le projet, en 1-2 phrases.
2. **Pourquoi** : le contexte qui justifie son existence.
3. **Comment** : commandes d'installation, d'exécution et de test.
4. **Stack** : outils principaux et versions.
5. **Architecture** : lien vers `ARCHITECTURE.md`.

### Docstrings / commentaires
- Format imposé par la stack retenue — nommer lequel ici, ou supprimer la sous-section.
- Documenter les fonctions publiques : intention, paramètres, retour, erreurs levées.
- Un commentaire explique *pourquoi*, jamais *quoi*. Un commentaire qui paraphrase
  le code est supprimé.

## Conventions spécifiques aux outils validés

> Une sous-section par outil retenu, tirée de l'annexe ou rédigée en session.
> Section entière supprimée si la stack ne le justifie pas.

## Patterns interdits dans ce projet

[Liste issue du débat de Phase 2. Chaque entrée nomme le pattern et la raison en
une ligne. Un interdit sans raison n'est pas respecté.]

## Quand une convention peut être violée

Aucune convention n'est sacrée. Une violation est acceptable si :
1. Elle est annoncée explicitement dans le commit ou la PR.
2. Elle est justifiée par un cas concret — contrainte technique, performance, lisibilité.
3. Elle est localisée, pas une cascade.

Une convention violée silencieusement est un bug. Une convention violée et discutée
est un trade-off légitime.

---
---

# ANNEXE — blocs de référence conditionnels

> **Ne jamais recopier cette annexe dans le livrable.** Les versions indiquées sont
> illustratives : les épingler à la version courante au moment de la session.

<details>
<summary>Ruff — configuration Python</summary>

```toml
[tool.ruff]
line-length = 100
target-version = "[version cible]"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B", "C4", "SIM", "RUF"]
ignore = ["E501"]  # longueur gérée par le formatter

[tool.ruff.format]
quote-style = "double"
```
</details>

<details>
<summary>pre-commit — hooks courants</summary>

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: [version]
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/Yelp/detect-secrets
    rev: [version]
    hooks:
      - id: detect-secrets

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: [version]
    hooks:
      - id: end-of-file-fixer
      - id: trailing-whitespace
      - id: check-yaml
      - id: check-added-large-files
        args: [--maxkb=500]
```

Ajouter un hook de lint SQL uniquement si du SQL versionné existe dans le repo.
</details>

<details>
<summary>SQL analytique</summary>

- `SELECT *` interdit hors exploration — colonnes listées explicitement.
- Filtrer sur la colonne de partition, jamais sur une expression appliquée à un timestamp.
- Mots-clés en majuscules, identifiants en `snake_case`.
- CTEs préférées aux sous-requêtes imbriquées. Une clause par ligne au-delà du trivial.
- Signaler tout `CROSS JOIN`, jointure non-équi, ou fenêtre sans `PARTITION BY`.
- Le coût de scan est une contrainte de design : signaler tout scan disproportionné
  au volume du résultat.
</details>

<details>
<summary>dbt</summary>

- `unique_key` obligatoire sur tout modèle incrémental.
- Pas de `full_refresh` ad-hoc en production.
- Un modèle = un `.sql` + un `.yml` (description, colonnes, tests).
- Tests minimum sur les clés : `unique`, `not_null`, plus `accepted_values` si pertinent.
- `ref()` et `source()` systématiques — aucune référence en dur à un dataset.
</details>

<details>
<summary>Orchestrateur type Airflow</summary>

- DAG léger : aucune logique métier dans la définition.
- XComs réservés aux valeurs scalaires légères.
- Retries, délai et backoff explicites au niveau DAG.
</details>

<details>
<summary>Docstrings format Google</summary>

```python
def f(a: int, b: str = "x") -> dict[str, float]:
    """Résumé en une ligne à l'impératif.

    Args:
        a: Rôle du paramètre.
        b: Rôle et valeurs acceptées.

    Returns:
        Description de la structure retournée.

    Raises:
        ValueError: Condition exacte de levée.
    """
```
</details>
