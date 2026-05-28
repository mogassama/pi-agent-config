---
name: diagnose
description: >-
  Disciplined diagnosis loop for hard bugs and performance regressions.
  Auto-load when the user reports a bug, says something is broken/failing/throwing,
  describes a performance regression, or says "diagnose this" / "debug this".
---

# Diagnose

## Principe

Un bug sans signal reproductible ne se résout pas — il se devine. Toute
l'énergie va d'abord à construire un signal pass/fail deterministe et
agent-runnable. Une fois ce signal en main, bisection, hypothèses et
instrumentation ne font que le consommer.

Ne saute aucune phase sans justification explicite.

---

## Loop

### 1. Reproduce

Obtenir un signal pass/fail fiable avant tout.

- Identifier le chemin d'exécution minimal qui déclenche le bug
- Vérifier que le bug est reproductible de façon deterministe
- Si non deterministe : identifier la condition de timing ou d'état qui le rend flaky

```bash
# Exemples selon le contexte
uv run pytest tests/path/to/test.py::test_name -xvs
bq query --use_legacy_sql=false "$(cat query.sql)"
python -c "from module import fn; fn(minimal_input)"
```

Si aucun test existant ne couvre le cas : **écrire un test qui échoue avant
d'aller plus loin.** C'est le signal.

### 2. Minimise

Réduire le cas reproductible au minimum absolu.

- Supprimer tout ce qui n'est pas nécessaire pour déclencher le bug
- Isoler : un seul fichier, une seule fonction, un seul appel si possible
- Pour les bugs SQL/BQ : réduire à la CTE ou la jointure fautive
- Pour les bugs Airflow : isoler le task, pas le DAG entier

Un cas minimal révèle la cause. Un cas complexe la cache.

### 3. Hypothesise

Générer des hypothèses ordonnées par probabilité.

- Lister 3-5 causes candidates
- Ordonner par probabilité décroissante
- Pour chaque hypothèse : définir le test qui la confirmerait ou l'infirmerait
- Privilégier les hypothèses testables en < 30 secondes

Ne pas commencer à modifier le code avant cette étape.

### 4. Instrument

Tester les hypothèses par ordre de probabilité.

```bash
# Ajouter des points de mesure temporaires
# Python : loguru temporaire, assertions, prints de debug
# SQL : CTEs intermédiaires, COUNT/DISTINCT checks
# Airflow : xcom_push sur les valeurs intermédiaires
# BQ : EXPLAIN ou dry-run pour les query plans
```

- Une hypothèse à la fois
- Confirmer ou infirmer avant de passer à la suivante
- Ne pas modifier le code de production pendant cette phase

### 5. Fix

Corriger uniquement la cause identifiée.

- Changement minimal ciblant la cause racine
- Ne pas profiter du fix pour refactorer — ce sera une PR séparée
- Vérifier que le signal reproductible passe au vert

### 6. Regression test

Garantir que le bug ne revient pas.

- Si un test a été écrit en step 1 : vérifier qu'il passe et le garder
- Si aucun test : en écrire un maintenant, centré sur le comportement corrigé
- Lancer la suite complète pour vérifier l'absence de régression

```bash
uv run pytest --tb=short
```

---

## Post-mortem

Une fois le fix validé, poser la question : qu'est-ce qui aurait empêché ce bug ?

- Si la réponse implique un changement architectural (pas de test seam,
  couplage caché, callers entrelacés) → handoff vers le skill
  `improve-codebase-architecture` avec les détails spécifiques
- Si la réponse implique un pattern récurrent dans le codebase → noter dans
  `AGENTS.md` comme règle de prévention

---

## Contexte data engineering

Signaux spécifiques à surveiller selon le domaine :

**BigQuery / SQL**
- Query plan régressif : comparer avec `INFORMATION_SCHEMA.JOBS` sur les runs précédents
- Full table scan inattendu : vérifier le filtre de partition
- Résultats non-deterministes : chercher un `ORDER BY` manquant ou un `DISTINCT` absent

**Airflow / Cloud Composer**
- Task qui échoue silencieusement : vérifier `on_failure_callback` et les XComs
- DAG qui ne se déclenche pas : vérifier le timezone du scheduler vs. le `schedule_interval`
- Dépendance cyclique : `airflow dags show {dag_id}` pour visualiser

**Dataflow**
- Job qui stagne : vérifier les hot keys et le back-pressure dans les métriques
- OOM : profiler la taille des bundles, chercher les `GroupByKey` non nécessaires

**Python pipelines**
- Memory leak : `tracemalloc` ou profiler sur le batch le plus large
- Performance régression : comparer avec `cProfile` avant/après
