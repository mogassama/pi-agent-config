---
name: data-quality
description: Garantir l'intégrité et la fiabilité des données dans BigQuery et dbt. À invoquer lors de la création de modèles SQL ou de pipelines d'ingestion.
---

# Skill : Data Quality & Testing (Béton)

## Principes Directeurs
- **Shift Left** : La qualité commence à la source. Tester les données dès l'ingestion (Staging).
- **Zéro Confiance** : Toute table de production doit avoir au minimum un test d'unicité et de non-nullité.

## Protocole d'Exécution
1. **Tests d'Intégrité dbt** : Pour chaque nouveau modèle, générer un fichier `.yml` incluant :
   - `unique` et `not_null` sur la clé primaire.
   - `relationships` pour les clés étrangères.
   - `accepted_values` pour les colonnes de statut/catégorie.
2. **Tests Métiers (Singular Tests)** : Créer des tests SQL personnalisés pour vérifier les règles business (ex: `amount > 0`).
3. **Freshness & Alerts** : Configurer systématiquement des tests de `source_freshness` pour détecter les pannes de pipeline.
4. **Audit de Schéma** : Vérifier que les types de colonnes (INT64 vs FLOAT64) sont optimisés pour BigQuery.

## Sortie Attendue
- Fichier de configuration de test (`schema.yml`).
- Scripts SQL de test si nécessaire.
- Documentation des colonnes testées.
