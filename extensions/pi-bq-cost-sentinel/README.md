# pi-bq-cost-sentinel

Extension pi qui ajoute `/bq-cost` : dry-run BigQuery + analyse par l'agent.

## Installation

L'extension est dans `~/.pi/agent/extensions/pi-bq-cost-sentinel/` — chargée automatiquement
à chaque démarrage de pi. Après ajout, relancer pi ou utiliser `/reload`.

**Prérequis :**
- `bq` CLI dans le PATH (`gcloud components install bq` si absent)
- ADC configuré : `gcloud auth application-default login`

## Utilisation

```
/bq-cost
```

| Situation au lancement | Comportement |
|---|---|
| Un seul `.sql` dans le cwd | Utilisé automatiquement, notification info |
| Plusieurs `.sql` dans le cwd | Sélecteur pour choisir le fichier |
| Aucun `.sql` dans le cwd | Prompt `ctx.ui.input` pour coller la requête |

## Comportement

### Étape 1 — Résolution de la requête

Le cwd de pi est scanné pour les fichiers `*.sql`. Si aucun n'est trouvé, l'utilisateur
est invité à coller la requête directement dans le prompt.

### Étape 2 — Dry-run bq

```bash
bq query --dry_run --use_legacy_sql=false "<query>"
```

Timeout : 30 secondes. Le résultat est lu sur stderr (comportement standard de `bq`).

### Étape 3 — Seuils de coût

Tarif on-demand de référence : **$6.25 / TB**.

| Bytes scannés | Niveau | Notification |
|---|---|---|
| < 1 GB | 🟢 OK | info — procéder |
| 1 GB – 1 TB | 🟡 WARNING | warning — à surveiller |
| > 1 TB | 🔴 MANDATORY REVIEW | error — révision obligatoire avant production |

### Étape 4 — Envoi à l'agent

L'agent reçoit un message user avec :

```
Analyze this BigQuery dry-run result using the bigquery-engineering skill.
Estimated bytes: X. Estimated cost: $Y USD.
Flag any anti-patterns in the query and suggest optimizations if cost is high.
Source: <path_or_pasted>

<query>...</query>
<dry_run_output>...</dry_run_output>
```

Le skill `bigquery-engineering` est chargé automatiquement pour l'analyse.

## Erreurs gérées

| Cas | Notification |
|---|---|
| `bq` absent du PATH | `"bq CLI not available — check ADC and PATH"` (error) |
| ADC non configuré / credentials invalides | `"bq CLI not available — check ADC and PATH"` (error) |
| Dry-run sans bytes parsables (erreur SQL) | warning + forwarding à l'agent pour analyse |
| Requête vide / annulation utilisateur | warning + arrêt silencieux |
| Mode non-interactif | arrêt immédiat (aucune UI disponible) |

## Limites connues

- **Pas de projet explicite.** `bq` utilise le projet configuré dans `gcloud config`
  (`gcloud config get-value project`). Si aucun projet n'est configuré, le dry-run échoue.
- **Pas de `--project` flag.** Pour cibler un projet spécifique, configurer le projet par
  défaut : `gcloud config set project PROJECT_ID`.
- **Requêtes multi-statements.** `bq query --dry_run` ne supporte pas les scripts SQL
  multi-statements. Utiliser un seul statement par fichier.
- **Estimation on-demand uniquement.** Le coût estimé assume le tarif on-demand ($6.25/TB).
  Les projets sur réservations slot ne paient pas à la donnée scannée — l'estimation est
  alors indicative uniquement.
- **Timeout 30s.** Les dry-runs complexes sur de nombreuses tables peuvent dépasser le timeout.
  Augmentable en modifiant la constante dans `index.ts`.
