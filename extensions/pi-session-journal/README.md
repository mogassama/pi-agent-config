# pi-session-journal

Extension pi qui nomme automatiquement chaque session et écrit une entrée
de journal dans `~/.pi/agent/journal.md` à la fermeture.

## Installation

Placée dans `~/.pi/agent/extensions/pi-session-journal/` — chargée automatiquement.
Après ajout, `/reload` dans pi ou redémarrer.

## Comportement

### session_start

Déclenché à chaque nouveau démarrage, sauf `resume` (session déjà nommée).

| Étape | Action |
|---|---|
| 1 | Capture `cwd` et `Date.now()` |
| 2 | Lit la branche git : `git branch --show-current` dans `cwd` |

### before_agent_start

Sur le **premier** prompt seulement.

| Étape | Action |
|---|---|
| 1 | Construit le nom : `{branch} — {first_msg_40}` (sans branche : `{first_msg_40}`) |
| 2 | Appelle `pi.setSessionName(name)` + `ctx.ui.setStatus("journal", "📓 …")` |

**Il n'y a aucun `setTimeout`.** Une version antérieure de ce document décrivait
une attente de 3 secondes que le code n'a jamais implémentée ; le nommage a
toujours eu lieu sur l'événement `before_agent_start`.

**Raisons ignorées :** `resume` uniquement.

**Raisons traitées :** `startup`, `new`, `fork`.

### session_shutdown

| Étape | Action |
|---|---|
| 1 | Vérifie que `session_start` a bien été traité (sinon : abort) |
| 2 | Parcourt `ctx.sessionManager.getEntries()` |
| 3 | Extrait : fichiers écrits/édités, commandes bash, snippets de décision, résumé |
| 4 | Appelle `appendFile(~/.pi/agent/journal.md, entry)` |
| 5 | `ctx.ui.notify("Session logged to journal.md", "info")` — ou, si la journalisation a échoué, une **tentative** de signalement avec le motif |

## Format du journal

```markdown
---
## 2026-05-12 10:30 — main — fix auth module
**Branch:** main
**Duration:** 12m 34s

### What happened
First line of first three distinct assistant turns (120 chars max each).

### Files touched
- src/auth.py
- tests/test_auth.py

### Decisions
- decided to use JWT over session tokens for stateless auth
```

## Extraction des données

| Donnée | Source dans les entries |
|---|---|
| Premier message utilisateur | Premier `role: "user"` sans préfixe `<skill` / `<context` |
| Fichiers touchés | Blocs `toolCall` avec `name: "write" \| "edit"` → `arguments.path` |
| Commandes bash | Blocs `toolCall` avec `name: "bash"` → `arguments.command` (max 10) |
| Résumé | Première ligne des 3 premiers blocs texte assistant (>20 chars) |
| Décisions | Phrases contenant : `decided`, `chosen`, `will use`, `approach`, `going with`, `opted for` (max 5) |

## Configuration

`PI_JOURNAL_PATH` déplace le fichier de journal. Par défaut
`~/.pi/agent/journal.md`, qui est ignoré par git : c'est une sortie, pas une
source.

## Signalement des échecs

> Une fermeture **tente** de signaler l'indisponibilité du journal. La fermeture
> consomme la session, donc une même session ne produit pas de seconde
> tentative. Si l'UI est elle-même indisponible, l'erreur reste non bloquante.

« Tente » et non « avertit » : la livraison n'est pas garantissable, puisque
`notify` peut jeter. Il n'y a pas de drapeau « une fois par session » — la
consommation de session suffit, et un drapeau en plus garantissait la même chose
sans qu'aucune contre-épreuve puisse le distinguer.

Restent silencieux, parce qu'ils n'empêchent rien : l'échec de détection de
branche (métadonnée facultative) et l'échec de nommage (qui a son repli).

## Limites connues

- **Prompt absent** : si `before_agent_start` ne porte pas de `prompt`, le nom sera `"{branch} — (new session)"`.
- **Pas de mutex sur `journal.md`** : les writes sont atomiques sur macOS (append single call) mais une ouverture simultanée de deux sessions pi sur le même fichier pourrait interleaver les entrées. Acceptable pour un usage mono-utilisateur.
- **Résumé heuristique** : la première ligne de chaque bloc texte assistant n'est pas toujours la phrase la plus représentative — les réponses courtes type "OK" ou "Done" sont incluses si elles dépassent 20 caractères.
- **Git timeout 5 s** : un dépôt sur NFS ou un disque lent peut dépasser ce délai ; la branche sera vide mais le naming ne plantera pas.
- **`resume` non journalisé** : les sessions resumées ne génèrent ni renommage ni entrée de journal (la session a déjà été journalisée à sa fermeture initiale).
- **Raison `startup` avec session préexistante** : si pi se relance sur une session non terminée (crash), `session_start` avec `reason: "startup"` ne la détecte pas comme `resume` et tentera de la renommer. Effet inoffensif (le nom sera écrasé par un nom identique ou similaire).

## Dette déclarée

Neuf erreurs `tsc --strict` dans `index.ts` au moment du versement, non
corrigées. Elles viennent des accès à des formes de messages que le stub de
`ExtensionAPI` ne type pas, et l'extension les traite déjà par vérification de
forme à l'exécution. Portées à `SUIVI.md`, hors du périmètre de ce lot.
