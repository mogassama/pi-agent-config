# bash-guard

Extension pi qui ajoute une couche de confirmation sur les commandes bash dangereuses.
Conçue pour un usage data engineering GCP.

## Installation

L'extension est dans `~/.pi/agent/extensions/bash-guard/` — elle est chargée automatiquement
à chaque démarrage de pi.

## Comportement

### Niveau HIGH (confirmation obligatoire, sans option always-allow)

| Pattern | Commande type |
|---|---|
| `\bterraform\s+destroy\b` | `terraform destroy` |
| `\bgcloud\s+\w+\s+delete\b` | `gcloud functions delete ...` |
| `\bDROP\s+(DATABASE\|SCHEMA)\b` | `DROP DATABASE prod` |
| `\bdropdb\b` | `dropdb mydb` |
| `\bgit\s+push\s+(-f\|--force).*\b(main\|master\|prod\|production)\b` | `git push -f origin main` |

### Niveau MEDIUM (confirmation + option "Always allow for this session")

| Pattern | Commande type |
|---|---|
| `\brm\s+(-[rRf]+\|--recursive\|--force)` | `rm -rf /tmp/data` |
| `\brm\s+.*\*` | `rm *.parquet` |
| `\bbq\s+rm\b` | `bq rm dataset.table` |
| `\bbq\s+(update\|cp\s+-f)\b` | `bq cp -f src dst` |
| `\bgsutil\s+(-m\s+)?rm\b` | `gsutil -m rm -r gs://bucket/` |
| `\bDROP\s+TABLE\b` | `DROP TABLE staging.events` |
| `\bTRUNCATE\b` | `TRUNCATE TABLE ...` |
| `\bgit\s+push\s+(-f\|--force)\b` | `git push --force` (hors main/master) |
| `\bgit\s+reset\s+--hard\b` | `git reset --hard HEAD~1` |
| `\bterraform\s+apply\s+-auto-approve\b` | `terraform apply -auto-approve` |

## Always-allow

L'option "Always allow for this session" (niveau MEDIUM uniquement) stocke le pattern
en mémoire RAM. Elle est réinitialisée à chaque redémarrage de pi. Les exécutions
auto-allowed sont toujours tracées dans le log.

## Log

Chaque match est tracé dans `~/.pi/agent/bash-guard.log` (TSV) :

```
<ISO timestamp>  <LEVEL>  <DECISION>  <PATTERN_MATCHED>  <COMMAND>
```

`LEVEL` ∈ `{high, medium}` — `DECISION` ∈ `{confirmed, declined, auto-allowed}`

## Configuration

Dans `~/.pi/agent/settings.json`, sous la clé `bashGuard` :

```json
{
  "bashGuard": {
    "enabled": true,
    "logFilePath": "~/.pi/agent/bash-guard.log",
    "additionalPatternsHigh": [
      "\\bmy-critical-script\\.sh\\b"
    ],
    "additionalPatternsMedium": [
      "\\bkubectl\\s+delete\\b"
    ],
    "whitelistPatterns": [
      "\\brm\\s+-rf\\s+/tmp/known-safe"
    ]
  }
}
```

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Désactive l'extension sans la désinstaller |
| `logFilePath` | string | `~/.pi/agent/bash-guard.log` | Chemin du fichier de log |
| `additionalPatternsHigh` | string[] | `[]` | Patterns regex supplémentaires niveau HIGH |
| `additionalPatternsMedium` | string[] | `[]` | Patterns regex supplémentaires niveau MEDIUM |
| `whitelistPatterns` | string[] | `[]` | Patterns exemptés — priorité absolue sur tout |

Les patterns utilisent les flags `i` (insensible à la casse) et `s` (dotAll).

## Limites connues

- **False positives** : `TRUNCATE` et `DROP TABLE` matchent dans des commentaires SQL
  ou des chaînes de caractères si la commande bash les contient en clair (ex: `echo "DROP TABLE"`).
- **Commandes composées** : `cmd1 && rm -rf foo` est détecté. `eval "rm -rf foo"` aussi.
  Mais des obfuscations volontaires (`r''m -rf`) passeront au travers.
- **Scripts inline** : si le LLM écrit un script en plusieurs lignes avec `cat > script.sh`,
  puis `bash script.sh`, la commande dangereuse dans le script n'est PAS interceptée.
- **Pas de persistance** : l'always-allow est RAM-only, réinitialisé à chaque `/reload` ou
  redémarrage (comportement voulu).
- **Mode non-interactif** : tous les matches bloquent sans demander (comportement conservateur).
