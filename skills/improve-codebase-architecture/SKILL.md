---
name: improve-codebase-architecture
description: >-
  Trouve les opportunités de deepening dans un codebase — modules trop plats,
  couplages cachés, seams non exploités. Auto-load quand l'utilisateur veut
  améliorer l'architecture, mentionne "ball of mud", "refactor", "trop couplé",
  "improve architecture", ou demande à rendre un codebase plus testable.
---

# Improve Codebase Architecture

## Objectif

Surface les frictions architecturales et propose des opportunités de
deepening — des refactors qui transforment des modules plats en modules
profonds. La cible : testabilité et navigabilité.

---

## Vocabulaire partagé

Utiliser ces termes exactement. Ne pas dériver vers "component", "service",
"API", "boundary".

**Module** — tout ce qui a une interface et une implémentation. Scale-agnostic :
fonction, classe, package, ou slice transverse.

**Interface** — tout ce qu'un caller doit savoir pour utiliser le module :
types, invariants, ordering constraints, error modes, config requise.
Pas juste la signature.

**Implementation** — ce qui est à l'intérieur. Distinct de l'interface.

**Seam** — point de découplage potentiel ou réel.
- Un adapter = seam hypothétique
- Deux adapters = seam réel

**Adapter** — implémentation concrète derrière un seam (ex: client BQ réel
vs fake en mémoire pour les tests).

**Leverage** — ce que l'interface cache derrière elle. Un module à fort
leverage expose peu, cache beaucoup.

**Deletion test** — imaginer supprimer le module. Si la complexité disparaît,
c'était un pass-through. Si elle réapparaît chez N callers, le module
gagnait sa place.

---

## Workflow

### 1. Exploration

Explorer le codebase organiquement avec `bash` et `read`. Ne pas suivre
de heuristiques rigides — noter les frictions ressenties :

```bash
# Carte des dépendances
find . -name "*.py" | head -50
grep -r "import" src/ --include="*.py" | grep -v test | sort | uniq -c | sort -rn

# Modules les plus importés = candidats à fort leverage potentiel
# Fichiers les plus longs = candidats à découpage
# Dossiers avec > 10 fichiers = candidats à restructuration
```

Questions à se poser pendant l'exploration :
- Où comprendre un concept demande-t-il de naviguer entre 5 fichiers ?
- Où des modules exposent-ils plus qu'ils ne cachent ?
- Où les tests mockent-ils des détails internes au lieu d'interfaces publiques ?
- Où la même logique est-elle dupliquée chez plusieurs callers ?
- Où un changement de dépendance externe forcerait-il des modifications en cascade ?

Si un `AGENTS.md` ou `docs/adr/` existe dans le projet, le lire en premier
pour ne pas re-litiguer des décisions déjà prises.

### 2. Rapport de candidats

Présenter 3-5 candidats de deepening. Pour chaque candidat :

```markdown
### Candidat : {nom du module}

**Friction observée :** [ce qui rend ce module difficile à comprendre ou tester]

**Deletion test :** [ce qui se passerait si on le supprimait]

**Seam identifié :** [où le découplage est possible]

**Opportunité :** [interface proposée — ce qu'elle exposerait, ce qu'elle cacherait]

**Gain attendu :** [testabilité / navigabilité / isolation du changement]
```

Présenter les candidats, puis **griller l'utilisateur** sur ses priorités
avant de passer à l'étape 3. Quelle friction coûte le plus cher aujourd'hui ?

### 3. Design de l'interface

Pour le candidat retenu, explorer plusieurs designs d'interface :

- Contraintes que toute nouvelle interface doit respecter
- Dépendances derrière le seam (stables vs. volatiles)
- Sketch de code illustratif pour rendre les contraintes concrètes

Proposer 2-3 designs radicalement différents. Les contraster sur :
- **Depth** (leverage à l'interface)
- **Locality** (où le changement se concentre)
- **Placement du seam**

Donner une recommandation explicite avec justification. Si des éléments
de différents designs se combinent bien, proposer un hybride.

### 4. ADR

Une fois le design retenu, produire une ADR courte :

```markdown
## ADR — {titre}

**Date :** {date}
**Statut :** Accepted

**Contexte :** [friction qui a motivé le changement]

**Décision :** [interface choisie et pourquoi]

**Alternatives écartées :** [les autres designs et leur rejet]

**Conséquences :** [ce que ça change pour les callers, les tests, les extensions futures]
```

Sauvegarder dans `docs/adr/` si le dossier existe, sinon proposer de le créer.

---

## Contexte data engineering

Frictions courantes dans le stack GCP/Python/dbt/Airflow :

**Pipelines Python**
- `bigquery.Client` instancié partout → seam à extraire (adapter BQ injectée)
- Logique de transformation mélangée avec I/O → module de transformation pur testable sans BQ
- Config hardcodée dans les fonctions → module de config avec interface claire

**Airflow / DAGs**
- Logique métier dans les callables des tasks → extraire vers des modules Python testables indépendamment
- DAG monolithique de 500 lignes → découper par domaine fonctionnel
- Dépendances entre DAGs via des conventions de nommage implicites → interface explicite via XCom ou Datasets

**dbt**
- Modèles intermédiaires en `SELECT *` → interfaces explicites avec colonnes nommées
- Logique réutilisée copiée-collée entre modèles → macros ou packages
- Tests absents sur les modèles de transformation critiques → seam de test via `schema.yml`

**Terraform / IaC**
- Ressources GCP définies à plat sans modules → modules Terraform par domaine (BQ, Composer, Pub/Sub)
- Variables hardcodées → interface via `variables.tf` avec descriptions

---

## Post-session

Si le refactor révèle un bug sous-jacent → handoff vers `diagnose`.
Si le design retenu implique du TDD sur la nouvelle interface → handoff vers `tdd`.
