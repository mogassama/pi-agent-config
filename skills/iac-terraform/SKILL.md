---
name: iac-terraform
description: Expertise en Infrastructure as Code avec Terraform pour Google Cloud Platform. À utiliser pour toute création, modification ou revue de ressources GCP (Buckets, BigQuery, IAM, Cloud Functions).
---

# Skill : Terraform GCP Engineering (Béton)

## Principes Directeurs
- **State Management** : Ne jamais proposer de code sans un bloc `terraform { backend "gcs" { ... } }`.
- **Modularité** : Privilégier les modules réutilisables.
- **Sécurité (Moindre Privilège)** : Toujours préférer des rôles IAM spécifiques (`roles/bigquery.dataViewer`) aux rôles basiques (`roles/editor`).

## Protocole d'Exécution
1. **Validation des Variables** : Chaque variable doit avoir un `type` et une `description`. Utiliser des `validation` blocs pour les contraintes (ex: format de nommage).
2. **Naming Convention** : Respecter le format `provider-service-environnement-region-nom` (ex: `gcp-gcs-prod-euw1-data-lake`).
3. **Labels & Tags** : Ajouter systématiquement des labels `env`, `project`, et `managed_by: pi-agent`.
4. **Plan Preview** : Avant de valider, simuler mentalement le `terraform plan` pour détecter les destructions de ressources critiques.

## Sortie Attendue
- Code HCL propre et formaté.
- Bloc de variables clair.
- Explication des ressources créées et des permissions IAM associées.
