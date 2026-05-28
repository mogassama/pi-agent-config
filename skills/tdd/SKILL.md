---
name: tdd
description: >-
  Test-driven development avec loop red-green-refactor. Utiliser quand
  l'utilisateur veut construire une feature ou corriger un bug en TDD,
  mentionne "red-green-refactor", veut des tests d'intégration, ou demande
  un développement test-first.
---

# TDD

## Philosophie

Les tests vérifient le comportement via les interfaces publiques, pas les
détails d'implémentation. Le code peut changer entièrement — les tests ne
doivent pas bouger.

**Bon test** : intégration-style, passe par l'API publique, décrit *ce que*
le système fait. Survit à un refactor interne complet.

**Mauvais test** : couplé à l'implémentation. Mocke des collaborateurs
internes, teste des méthodes privées, casse quand on renomme une fonction
interne sans changer le comportement.

---

## Anti-pattern : slices horizontales

**Ne pas** écrire tous les tests d'abord, puis toute l'implémentation.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED → GREEN : test1 → impl1
  RED → GREEN : test2 → impl2
  RED → GREEN : test3 → impl3
```

Les tests écrits en bulk testent un comportement *imaginé*, pas *réel*. Ils
deviennent insensibles aux vraies régressions.

---

## Workflow

### 1. Planification

Avant d'explorer ou d'écrire quoi que ce soit :

- Confirmer avec l'utilisateur quelles interfaces changent
- Confirmer quels comportements tester (prioriser — on ne peut pas tout tester)
- Lister les comportements à tester (pas les étapes d'implémentation)
- Obtenir l'approbation sur le plan

Question à poser : *"À quoi doit ressembler l'interface publique ? Quels
comportements sont les plus critiques à couvrir ?"*

Explorer le codebase avec `bash` et `read` pour comprendre les interfaces
existantes avant de proposer quoi que ce soit.

### 2. Tracer bullet

Écrire UN test qui confirme UNE chose sur le système :

```bash
# Écrire le test
# Vérifier qu'il échoue (RED)
uv run pytest tests/path/test_feature.py::test_name -xvs

# Écrire le minimum de code pour le faire passer (GREEN)
uv run pytest tests/path/test_feature.py::test_name -xvs
```

C'est le tracer bullet — prouve que le chemin fonctionne bout en bout.

### 3. Loop incrémental

Pour chaque comportement restant :

```
RED   : écrire le test → vérifier qu'il échoue
GREEN : code minimal pour le faire passer → vérifier
```

Règles strictes :
- Un test à la fois
- Seulement le code suffisant pour passer le test courant
- Ne pas anticiper les tests futurs
- Rester sur le comportement observable, pas l'implémentation

### 4. Refactor

Une fois tous les tests au vert :

- Extraire les duplications
- Simplifier les interfaces (interface petite, implémentation profonde)
- Appliquer les conventions du projet (voir `python-engineering` skill)
- Lancer les tests après chaque étape de refactor

**Ne jamais refactorer en état RED.** Passer au GREEN d'abord.

---

## Checklist par cycle

```
[ ] Le test décrit un comportement, pas une implémentation
[ ] Le test passe uniquement par l'interface publique
[ ] Le test survivrait à un refactor interne complet
[ ] Le code est minimal pour ce test
[ ] Aucune feature spéculative ajoutée
```

---

## Contexte data engineering

Patterns spécifiques au stack :

**Python pipelines / transformations**
- Tester les fonctions de transformation avec des fixtures de données réelles
  (échantillons BQ exportés), pas des données fabriquées
- Éviter de mocker `bigquery.Client` — utiliser un dataset de test dédié ou
  `pytest-bq` si disponible
- Les fonctions pures (transformations, validations) sont prioritaires à couvrir

**dbt**
- Tests de comportement via `dbt test` et les tests génériques (`unique`,
  `not_null`, `accepted_values`, `relationships`)
- Pour la logique complexe : tester les modèles avec des seeds de fixtures

**Airflow / DAGs**
- Tester les callables des tasks en isolation, pas le DAG entier
- `dag.test()` pour les smoke tests de bout en bout
- Les sensors et hooks GCP : mocker au niveau de l'opérateur, pas au niveau
  du client GCP sous-jacent
