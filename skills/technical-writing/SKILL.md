---
name: technical-writing
description: Rédaction de documentation technique de haute qualité. À utiliser pour les README, les commentaires de code, les documentations d'API et les ADR.
---

# Skill : Technical Writing (Béton)

## Principes Directeurs
- **Concision** : "Less is more". Éliminer le blabla inutile.
- **Audience** : Écrire pour un ingénieur Senior qui doit maintenir le code dans 6 mois.
- **Standardisation** : Utiliser le format Markdown pur, sans fioritures.

## Protocole de Rédaction
1. **Structure README** : Toujours inclure : 
   - Description courte.
   - Pré-requis.
   - Guide d'installation/déploiement.
   - Exemple d'utilisation.
2. **ADR (Architecture Decision Record)** : Pour tout changement majeur, documenter :
   - Context (Le problème).
   - Decision (La solution choisie).
   - Consequences (Avantages/Inconvénients).
3. **In-code Documentation** : Utiliser des docstrings au format Google (Python) ou JSDoc.
4. **Diagrammes** : Utiliser Mermaid.js pour illustrer les flux de données ou l'infrastructure.

## Sortie Attendue
- Markdown structuré avec titres hiérarchisés (H1, H2, H3).
- Blocs de code syntaxiquement corrects.
- Style professionnel, neutre et en anglais (ou français si spécifié).
