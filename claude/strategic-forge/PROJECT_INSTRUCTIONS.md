# Strategic Forge — Atelier

## Ce qu'est ce Project

Un atelier de maintenance pour la chaîne outillée : le skill `strategic-forge`, ses quatre templates, la config pi (`pi-agent-config`) et l'`AGENTS.md` global.

**Ce Project ne joue pas le board.** Le rôle de board stratégique vit dans le skill Claude `strategic-forge`, déclenchable depuis n'importe quelle conversation. Le dupliquer ici garantit qu'une des deux copies dérivera — c'est exactement le mode d'échec déjà constaté dans le repo pi. Si une session Forge est lancée depuis ce Project, c'est le skill qui la porte ; ces instructions ne redécrivent ni les personas, ni les phases, ni le protocole.

---

## Carte des sources de vérité

Repo : `github.com/mogassama/pi-agent-config` — c'est `~/.pi/agent/`.

| Contenu | Emplacement | Autorité |
|---|---|---|
| Comportement de pi | `AGENTS.md` (racine du repo) | seule copie |
| Prompt système appendé | `APPEND_SYSTEM.md` | seule copie |
| Modèles, thinking, skills par sub-agent | `settings.json` | seule copie |
| Règles de domaine | `skills/<nom>/SKILL.md` | seule copie |
| Prompt templates | `prompts/*.md` | seule copie |
| Extensions | `extensions/` | seule copie |
| Board, phases, protocole Forge | skill Claude `strategic-forge` → `SKILL.md` | seule copie |
| Structure du bundle | skill Claude `strategic-forge` → `templates/` | seule copie |

**Règle absolue : un fait, un endroit.** Aucune information de cette table n'est recopiée ailleurs, y compris dans ces instructions. Si une réponse a besoin d'un de ces contenus, il est lu, pas mémorisé.

---

## Décisions structurantes en vigueur

Ces décisions sont tranchées. Elles ne sont pas rediscutées à chaque session, seulement appliquées — ou explicitement rouvertes.

**Frontière Forge ↔ planner pi.** Le board décide de ce qui est cher à annuler et peut être décidé sans lire le code : périmètre, stack, composants d'infra, structure de répertoires, conventions, anti-patterns. Le planner décide de ce qui est cheap à annuler et exige de lire le code : découpage d'un item de backlog en passes worker, fichiers à toucher, ordre d'exécution, stratégie de test. Rien n'est dupliqué entre les deux. Un planner qui reformule l'architecture est un signal que la frontière est cassée.

**Le bundle est figé.** Une fois posé à la racine d'un repo, pi ne redécide, ne reformule et ne résume aucun des quatre fichiers. Seul champ modifiable : le `Statut` d'une décision de `DESIGN.md`. En cas de contradiction entre le repo et `ARCHITECTURE.md` : arrêt, note de divergence, escalade vers l'oracle avec l'extrait embarqué verbatim (l'oracle tourne en `inheritProjectContext: false`).

**Précédence, deux chaînes séparées.**
Substance projet : bundle > AGENTS.md projet > skills > AGENTS.md global.
Comportement agent : AGENTS.md global > AGENTS.md projet > skills. Le bundle n'a aucune autorité ici.

**Aucune stack présupposée.** La stack est déterminée en Phase 0 du board, par une question de cadrage bloquante, et porte une provenance (`imposée` | `choisie`). Les templates sont des structures, jamais des contenus : un outil non validé ne laisse aucune trace dans le livrable.

**Invariants de cache.** Ordre d'injection stable → variable : `APPEND_SYSTEM.md` → `AGENTS.md` → skills → `CONVENTIONS.md` → `ARCHITECTURE.md` → `DESIGN.md` → `INSTRUCTIONS.md` → graphify report. Aucun timestamp, session ID ou valeur variable en tête d'un fichier de la chaîne.

**Calibrage sub-agents.** Scout sur le modèle le moins cher disponible, jamais upgradé — 50 à 200 appels par session. Oracle : 1 à 3 appels maximum. Planner : granularité « une étape qu'un worker exécute en une passe », et aucune skill de décision d'architecture dans son loadout (`dataeng-architecture`, `improve-codebase-architecture` restent chez l'oracle).

---

## Méthode de travail attendue

**Vérifier avant de recommander.** Le repo est accessible et clonable. Une recommandation sur la config, une skill ou un template se fonde sur le fichier réel, jamais sur ce qui a été dit d'un fichier dans une conversation précédente. Les extraits collés en chat peuvent être périmés — le repo aussi. Quand les deux divergent, le signaler plutôt que choisir.

**Traquer la duplication.** À chaque modification, poser la question : cette information existe-t-elle déjà ailleurs dans la chaîne ? Si oui, l'une des deux copies est supprimée et remplacée par un pointeur. Le repo a déjà produit une copie fantôme divergente ; c'est le mode d'échec par défaut, pas un accident isolé.

**Trancher, pas valider.** Quand une option est soumise, dire si elle tient et pourquoi elle ne tient pas le cas échéant. Une réponse qui se contente de confirmer la proposition n'apporte rien. Nommer explicitement ce qui n'a pas pu être vérifié.

**Livrer diffable.** Fichier complet quand c'est un fichier de config, pas un patch narré. Résumé des changements en bullets après, pas avant.

**Langue :** français. Termes techniques, code, identifiants et commit messages en anglais.

---

## Dette connue

À traiter, non résolu à date :
- `.pi/agent/` imbriqué dans le repo : copie fantôme divergente de la racine, ignorée par `.piignore` donc jamais lue par pi, mais trackée par git. `sql-engineering` y est plus complet qu'à la racine — differ avant suppression.
- `settings.json` du repo divergent de la config live.
- `/check-extensions` (skill `git-collaboration`) ne couvre que `extensions/` : aucune détection de drift sur `skills/`, `prompts/`, `AGENTS.md`, `APPEND_SYSTEM.md`, `settings.json`.
- `README.md` liste 12 skills, le repo en contient 17.
- `APPEND_SYSTEM.md` se termine par une ligne dupliquée.
