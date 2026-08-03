# mo-subagents — décisions de conception

Statut : **brouillon**. Chaque décision porte sa justification mesurée ou son statut `À TRANCHER`.

Révision du 3 août 2026 — vérification dans la source de `@earendil-works/pi-coding-agent` 0.83.0 et dans le dépôt `mogassama/pi-agent-config@main`. Ajout de D0. Corrections : mécanisme d'injection des skills, `-ne` chez le worker, deux régimes de `--session-id`, cible de contexte par rôle.

Révision, seconde passe — **invalidation du corpus de 196 sessions comme mesure de besoin**. Tous les arguments de fréquence sont retirés ; D2 est réécrit sans appui empirique et l'assume ; l'advisor est acté en Gemini par défaut avec escalade Opus ; l'advisor réactif est écarté avec une condition de réouverture instruite sur les fichiers de session.

Révision, troisième passe — amendement D4 : découpage des skills par en-tête, tranché à l'injection par l'extension. Contrat de sortie porté sur un outil `submit` terminal à schéma TypeBox. `-ne` partout avec liste blanche `-e` par rôle. Section « Extensions » structurée en garder / réécrire / candidats.

Révision, quatrième passe — **planchers de contexte mesurés** : 959 / 1 514 / 2 023 selon le jeu d'outils. La décomposition de la baseline est déclarée non additive. Le coût de 0,27 $ par délégation est notionnel. `thinking` est en `high` partout, pas `medium`.

Révision, cinquième passe — **AR2 récupéré** : huit revues réelles dans `anime-etl`, `code-review.md` dégelé, T7 instruisable. Le fork est mesuré à **17 041** tokens dont 2 frais — l'argument économique tombe, l'argument de correction reste. L'enveloppe était réclamée et jamais produite : fondement empirique de `submit`.

---

## Principe fondateur

Chaque sous-agent est un **processus `pi` neuf**, lancé par `spawn` :

```
pi --mode json -p --no-session --session-id <runId>-<rôle> \
   --model <modèle du rôle> \
   --tools <liste du rôle> \
   --no-context-files --no-skills --no-extensions \
   -e <extension d'enveloppe> [-e <hook autorisé pour ce rôle>...] \
   --append-system-prompt <prompt du rôle> \
   --append-system-prompt <tranche de SKILL.md, en texte> [...] \
   "Task: <paquet composé par l'orchestrateur>"
```

**Conséquence directe** : l'enfant ne reçoit *rien* qui ne soit passé explicitement. Le fork disparaît par construction — le contexte de l'enfant devient exactement ce que l'orchestrateur décide de transmettre.

**Le fork est mesuré à 17 041 tokens, pas 15 749**, et l'argument qui le condamne n'est pas celui qu'on croyait. Quatre sessions enfants de `anime-etl` donnent le même chiffre au token près : `in=2, cacheRead=17041`. Deux tokens frais. Le fork est donc presque intégralement en lecture de cache, environ dix fois moins cher par token — et les runs passent par abonnement. **L'argument économique contre le fork ne tient pas.**

Ce qui reste, et qui suffit : 17 041 tokens de contexte parent que l'enfant n'a pas demandés, qui diluent son attention et remplissent sa fenêtre. Plus le mode de défaillance mesuré au canari — le fork transmet le texte du parent mais pas ses appels d'outils, d'où le reviewer accusant l'orchestrateur d'avoir fabriqué ses délégations. **C'est un argument de correction, pas d'économie**, et il est plus solide que celui qu'il remplace.

### Sémantique vérifiée des flags — pi 0.83.0

Lue dans la source du paquet, pas dans l'aide.

| Flag | Effet exact | Emplacement |
|:--|:--|:--|
| `--tools` | allowlist **stricte**, appliquée aux définitions built-in **et** extension. Filtre `_toolDefinitions`, donc le coût en tokens des outils d'extension disparaît avec elle | `core/agent-session.js:1943-1960` |
| `--no-skills, -ns` | coupe la *découverte* ; les chemins explicites survivent | `core/resource-loader.js:329-331` |
| `--no-extensions, -ne` | coupe la découverte ; les `-e <path>` explicites survivent | idem |
| `--skill <path>` | injecte **nom + description + chemin uniquement**, jamais le corps. Émis seulement si `read` est dans la liste d'outils | `core/skills.js:257-277`, `core/system-prompt.js:27-31` |
| `--append-system-prompt` | « text or file contents », répétable | aide CLI |
| `--session-id` | session projet exacte, créée si absente ; combinable avec `--no-session` | 0.76.0, corrigé en 0.80.3 |

**Trois conséquences de conception.**

`--skill` ne transmet pas de corps. Il pose un pointeur et l'enfant dépense un tour de `read` pour le charger — exactement le coût que la baseline a désigné comme dominant. Le canal correct pour injecter un corps sans tour est `--append-system-prompt`, qui accepte aussi bien un chemin que du **texte** — d'où la possibilité d'injecter une tranche plutôt qu'un fichier entier (voir D4).

**`-ne` partout, et un `-e <chemin>` explicite par rôle.** Puisque `--tools` écarte déjà les définitions d'outils d'extension, `-ne` ne coupe plus que les *hooks*. Les laisser découvrir revient à dépendre de ce qui traîne dans le dossier ; une liste blanche par rôle est déterministe :

| Rôle | Hooks passés en `-e` |
|:--|:--|
| `worker` | extension d'enveloppe, `pi-lint-gate`, `bash-guard`, `pi-bq-cost-sentinel` |
| `reviewer` | extension d'enveloppe |
| `scout`, `advisor` | extension d'enveloppe |

Effet de bord utile : la question « `pi-bq-cost-sentinel` couvre-t-il vraiment les subagents ? » cesse d'être une hypothèse. Il les couvre si et seulement s'il est passé.

`--tools` sans `read` supprime la section skills entière. L'`advisor` tournant sans outils, `--skill` y est inopérant par construction : il ne reçoit que son prompt de rôle et les extraits verbatim du paquet.

**Les sous-agents ne se parlent jamais entre eux.** L'orchestrateur compose chaque paquet d'entrée et reçoit chaque JSON de sortie. C'est ce qui rend le coût prévisible et la boucle traçable.

---

## Les quatre rôles

Critère d'existence : un rôle ne se justifie que s'il apporte un **modèle différent**, un **contexte différent**, ou du **parallélisme**. Une simple différence de posture se met dans le texte de la tâche, gratuitement.

| Rôle | Modèle | Famille | Outils | Reçoit | Rend |
|:--|:--|:--|:--|:--|:--|
| `scout` | `google/gemini-3.5-flash` | Google | `read, grep, find, ls` | une question + un périmètre | chemins, lignes, pourquoi |
| `worker` | `openai-codex/gpt-5.6-sol` | OpenAI | `read, grep, find, ls, bash, edit, write` | tâche + fichiers + contraintes | fichiers modifiés, validation, écarts |
| `reviewer` | `claude-bridge/claude-sonnet-5` | Anthropic | `read, grep, find, ls, bash` | diff + tâche d'origine | findings classés + verdict |
| `advisor` | `google/gemini-3.1-pro` par défaut, `claude-bridge/claude-opus-5` en escalade | Google / Anthropic | aucun | la décision + les options + les extraits | notes, inquiétudes, blocages |

**Orchestrateur** : `openai-codex/gpt-5.6-sol`, inchangé.

**Pourquoi Gemini reste le défaut de l'advisor.** Avec Opus 5 en défaut, Google ne tiendrait plus que le `scout`, un rôle read-only, et **advisor et reviewer partageraient la famille Anthropic**. Le scénario qui mord : l'advisor recommande une direction, le worker l'implémente, le reviewer la relit — juge et partie à un cran de distance, ce que la diversité de familles existe précisément pour empêcher. Opus 5 reste disponible en `--model` sur les forks irréversibles. Conséquence opérationnelle : sur ces appels-là, reviewer et advisor tirent tous deux sur `claude-bridge`, donc sur les limites Max partagées avec l'usage interactif de Claude Code.

### Pourquoi ces quatre-là

**`scout`** — modèle dix fois moins cher pour du volume de lecture. C'est le seul rôle dont la justification est purement économique.

**`worker`** — isole un travail long du contexte de l'orchestrateur. Même modèle que lui, volontairement : il exécute une direction déjà décidée, pas besoin d'un autre jugement.

**`reviewer`** — **famille de modèle différente du worker**. C'est sa seule raison d'être : un modèle ne voit pas ses propres angles morts. Sonnet relit ce que gpt-5.6-sol a écrit.

**`advisor`** — troisième famille, **aucun outil**. Il ne lit pas le dépôt, il ne peut que raisonner sur ce qu'on lui donne. C'est délibéré : son rôle est de contester une décision, pas d'aller chercher des faits.

### Rôles supprimés

| Rôle | Motif |
|:--|:--|
| `planner` | Même modèle et même contexte que le worker. La décomposition est le travail de l'orchestrateur — c'est la définition d'un orchestrateur |
| `oracle-deep` | Un modèle, pas un rôle. Devient une option `--model` sur `advisor` |
| `oracle` | Renommé `advisor`, sans outils |

Ces trois suppressions tiennent sur le **critère d'existence** ci-dessus — modèle, contexte ou parallélisme — et sur rien d'autre.

> **Le corpus de 196 sessions ne mesure pas un besoin.** Entre 100 et 120 de ces sessions sont du debug de configuration avec un assistant externe ; le reste comprend des `hi` de mesure et des invocations manuelles du type « lance worker ». Les fréquences qu'on en tirait — `scout` 3 fois, `oracle-deep` 5 fois, `oracle` 11 fois, 28 délégations toutes commandées à la main — décrivent ce que l'opérateur a tapé en phase de test, pas ce qu'une charge réelle appelle. Elles sont retirées de toute justification. Le fait que les 28 délégations aient été commandées explicitement reste vrai ; l'inférence « donc le modèle ne délègue pas spontanément » est tautologique dans un corpus où la délégation était l'objet du test.
>
> Les mesures de **coût** ne sont pas touchées : elles ne dépendent d'aucune fréquence de session.

---

## Contrat de sortie

Validé **par l'extension**, pas demandé au modèle. Une sortie non conforme est rejetée, pas interprétée.

### Mécanisme : un outil terminal, pas un bloc de texte à parser

**Fondement mesuré, corpus `anime-etl`, dix runs reviewer.** L'enveloppe JSON apparaît dans **5 sorties sur 10**, et la corrélation est parfaite : **5/5 quand l'entrée de tâche la réclame nommément**, **0/3 quand elle se contente de décrire le travail**. La skill était chargée dans les huit cas.

Autrement dit, le contrat n'est honoré que si quelqu'un pense à le redemander dans le prompt, à chaque fois. Le schéma d'outil supprime ce choix.

Seul `mergeable` n'apparaît nulle part — le champ nommé dans T7 n'a jamais existé, alors que `verdict` était bien émis.

C'est le même constat que sur les quatre revues du **même fichier** : une seule a produit le format de la skill, celle dont l'entrée cite les étapes une à une. **Une skill chargée en contexte n'impose pas son format de sortie.** La forme doit venir du schéma de l'outil, pas du corps injecté.

**Validé en exécution.** Un run réel sur `src/config.py` : `submit` appelé, `stopReason: toolUse`, validation TypeBox passée du premier coup sans reprise, tour terminé sur l'appel. `tooling` et `out_of_scope` rendus à `[]` — le modèle, privé de `bash`, n'a pas inventé de commandes. La règle 5 tient en pratique sur le champ où elle était le plus à risque.

**Deux corrections tirées de ce run.** Le plancher du reviewer est à **1 981**, pas 1 514 : la définition de `submit` coûte ~467 tokens, et chaque champ descriptif se paie dans chaque enfant. Et le premier appel du modèle a été `read AGENTS.md`, absent du dépôt : privé de fichier de contexte par `-nc`, il part en chasse. **Le prompt de rôle doit déclarer que tout le contexte nécessaire est fourni** et interdire la recherche de fichiers de configuration.

**Vocabulaire aligné sur le corpus.** L'enveloppe émet `verdict` en `snake_case` minuscule (`blocked`, `needs_rework`), distinct du corps lisible qui écrit `Blocked`. Les findings portent `issue`/`fix`. `files_reviewed` et `open_risks` sont émis par les cinq enveloppes et entrent au schéma. Seul `tooling` s'en écarte délibérément : tableau d'entrées plutôt qu'objet à clés nommées (`ruff`, `mypy`, `bq_dry_run`), parce que des clés fixes ne savent pas dire « non pertinent » et n'ont pas de forme vide.

L'enfant charge donc une micro-extension d'enveloppe qui enregistre un outil `submit`, dont les `parameters` **sont** le schéma du rôle, avec `terminate: true`. Modèle : `examples/extensions/structured-output.ts` du paquet officiel.

Trois gains sur la version « le modèle émet du JSON dans sa réponse finale, le parent le parse » :

- **La validation est celle des arguments d'outil**, faite par pi contre un schéma TypeBox, à la source. Plus de regex sur des fences markdown, plus de bloc tronqué à rattraper.
- **L'enfant termine sur l'appel d'outil** — la documentation de l'exemple est explicite : *« so the agent can end on a tool call without paying for an extra follow-up LLM turn »*. Un tour économisé par délégation, sur le levier que la baseline a désigné comme dominant.
- Le parent lit l'appel dans le flux JSON par `tool_result_end`, que l'exemple officiel de subagent traite déjà.

Coût : une définition d'outil dans le contexte de l'enfant, et `submit` doit figurer dans son `--tools`. Chaque rôle ne voit **que son schéma**, jamais les quatre.

### Enveloppe commune

```json
{
  "role": "scout | worker | reviewer | advisor",
  "status": "ok | blocked | failed",
  "summary": "une ligne, lisible par un humain",
  "next": "scout | worker | reviewer | advisor | orchestrator | done",
  "payload": { }
}
```

`next` est ce qui fait tourner la boucle. `done` est la seule condition d'arrêt propre ; `orchestrator` signifie « je rends la main, décide ».

### Payload par rôle

```json
// scout
{ "hits": [ { "path": "", "lines": "12-40", "why": "" } ],
  "gaps": [ "ce que je n'ai pas trouvé" ] }

// worker
{ "changed_files": [ "" ],
  "validation": "ce qui a tourné, ou 'none — <raison>'",
  "deviations": [ "écart assumé par rapport à la consigne" ] }

// reviewer
{ "findings": [ { "severity": "HIGH|MEDIUM|LOW",
                  "confidence": "certain|probable|possible",
                  "location": "src/load.py:121-131, 151-153",
                  "what": "", "impact": "", "recommendation": "" } ],
  "verdict": "Approved | Needs Rework | Blocked",
  "top_priority": "" ou null,
  "tooling": [ { "command": "", "outcome": "pass|fail|unavailable", "detail": "" } ],
  "out_of_scope": [ "" ] }

// advisor
{ "concerns": [ { "level": "note|concern|blocker", "what": "", "why": "" } ],
  "recommendation": "une option, avec son critère" }
```

**`validation` accepte `none`.** C'est la correction du défaut mesuré : un champ obligatoire sans forme vide légale produit de la vérification décorative — `ruff` et `mypy` relancés à la main dans 8 runs sur 8.

**La matrice sévérité × confiance du reviewer** est reprise **verbatim** de `code-review/SKILL.md` et des huit sorties observées : `HIGH|MEDIUM|LOW` croisé avec `certain|probable|possible`. Un `HIGH` en confiance `possible` ne bloque pas — il rétrograde en `Needs Rework` et doit être nommé dans `top_priority`.

> **Correction.** Ce document inventait `P0|P1|P2|P3` et `ship | fix-first | blocked`, vocabulaire qui n'existe ni dans la skill ni dans aucune sortie réelle. C'était la règle 3 violée à l'intérieur du document qui l'énonce. Et `"line": 0` ne pouvait pas tenir : un finding réel du corpus couvre quatre plages disjointes. Le champ est une chaîne.

**`tooling` accepte `outcome: "unavailable"` avec sa raison.** Forme observée spontanément dans le corpus — un reviewer a déclaré `flake8` indisponible (absent du `.venv`) et `pytest` injoignable (Postgres refusé) plutôt que d'omettre le champ. C'est la règle 5 appliquée.

---

## Contrat d'entrée

L'orchestrateur compose, l'opérateur ne rédige rien.

| Rôle | Paquet |
|:--|:--|
| `scout` | la question, le périmètre (chemins ou globs), ce qu'on cherche à décider ensuite |
| `worker` | la tâche, la liste exacte des fichiers à toucher, les contraintes, le résultat attendu |
| `reviewer` | le diff, la tâche d'origine, le nom des skills de domaine à charger |
| `advisor` | la décision à prendre, les options envisagées, les extraits pertinents verbatim |

Le reviewer reçoit **la tâche d'origine en plus du diff** : sans elle il juge la qualité, pas la pertinence.

---

## Boucle de dispatch

1. L'orchestrateur décide d'un rôle et compose le paquet
2. L'extension lance le processus, valide le JSON de retour
3. **Le JSON complet est écrit sur disque** ; seuls `summary` et un identifiant remontent au contexte de l'orchestrateur
4. L'orchestrateur relit le détail à la demande
5. `next` détermine la suite ; `done` ou `orchestrator` arrête

**Plafond de tours dans l'extension** — pas dans le prompt. Un modèle ne s'arrête pas parce qu'on le lui demande.

Le point 3 est essentiel : sans lui, on remplace un fork coûteux par une accumulation de JSON, et le problème revient par la fenêtre.

---

## Options par agent

Déclarées dans le frontmatter de `~/.pi/agent/agents/<rôle>.md` — **une seule source de vérité par champ**, leçon de l'audit.

| Option | Rôle |
|:--|:--|
| `model` | modèle du sous-agent |
| `fallbackModels` | repli sur panne de fournisseur |
| `tools` | liste blanche stricte |
| `skills` | tranches de `SKILL.md` injectées en texte via `--append-system-prompt`, découpées par en-tête (D4). Sans objet pour `advisor`, qui n'a pas `read` |
| `extensions` | liste blanche de hooks passés en `-e`. `-ne` est toujours actif |
| `contextFiles` | `false` par défaut — pas d'AGENTS.md dans l'enfant |
| `maxTurns` | plafond, appliqué par l'extension. **pi n'a aucun plafond de tours natif** — ni flag, ni option de session |
| `timeoutMs` | délai mur |
| `outputSchema` | schéma TypeBox des `parameters` de l'outil `submit` du rôle |

**Le corps d'une skill s'injecte par `--append-system-prompt`, pas par `--skill`.** Plus de tableaux de loadout, plus de transmission par contexte hérité, et pas de tour de `read` dépensé à l'ouverture. L'orchestrateur passe exactement les tranches nécessaires, à la délégation.

`--skill` garde un usage étroit : rendre une skill *disponible sans la charger*, quand on veut que l'enfant décide lui-même de la lire. À réserver aux cas où le corps est gros et l'usage incertain.

---

## Décisions tranchées

### D0 — Extension TypeScript, et retrait de `pi-subagents` en second

Trois voies étaient envisageables. La troisième n'existe pas.

**« Le système natif de pi avec des agents en `.md` dans `agents/ `» — n'existe pas.** Vérifié dans le paquet 0.83.0 : les outils built-in sont exactement sept (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) ; le cœur ne connaît sous `~/.pi/agent/` que `bin`, `prompts`, `sessions`, `themes` et `tools` (`config.js:412-445`) — **`agents/` n'y figure pas** ; et le seul « subagent » de toute l'arborescence `docs/` est la ligne de l'extension d'exemple (`extensions.md:2945`). `~/.pi/agent/agents/*.md` est une convention créée par `pi-subagents` et par l'exemple officiel, chacun de son côté. Que les deux aient convergé sur le même chemin ne fait pas une primitive.

`getToolsDir()` existe mais n'est référencé nulle part ailleurs dans `dist/` — chemin mort. **Un outil appelable par le modèle ne peut être déclaré que depuis une extension TypeScript.**

**La voie sans code existe quand même** : l'orchestrateur a déjà `bash`, et `pi` est un exécutable. Rien n'interdit `pi --mode json -p … > /tmp/<runId>-<rôle>.json`, puis une lecture du seul `summary`. Ce qu'on perd est précis :

| Perdu | Compensation possible |
|:--|:--|
| Outil typé, schéma d'arguments imposé à l'orchestrateur | aucune — texte libre dans `bash` |
| Validation du schéma de sortie avant retour | `bin/check-envelope` hors bande |
| **Plafond de tours** | **aucune** — pi n'a ni `--max-turns` ni équivalent |
| Comptabilité d'usage, streaming, propagation d'abort | aucune |
| Interaction avec `bash-guard` | il faudrait une règle pour les invocations de `pi` |

Le plafond de tours est le point décisif. La boucle de dispatch le pose comme condition d'arrêt (« pas dans le prompt : un modèle ne s'arrête pas parce qu'on le lui demande »), et il n'existe aucun moyen de l'obtenir sans envelopper le processus.

→ **Extension TypeScript**, à partir de l'exemple officiel. Réutilisables tels quels : la lecture ligne à ligne du flux JSON, la comptabilité d'usage, le parallélisme borné, la propagation d'abort, le modèle de sécurité des agents projet. À écrire : `-nc -ns`, l'injection des corps, `--session-id`, `outputSchema` et sa validation, `maxTurns`, `timeoutMs`, `fallbackModels`, et l'écriture du JSON sur disque (point 3 de la boucle). `agents.ts` ne parse aujourd'hui que `name`, `description`, `tools`, `model`.

→ **`pi-subagents` part, mais en second.** Motifs : 5 468 tokens de définitions d'outils dans l'orchestrateur, soit 37 % des 14 528 ; six agents vendorés dans `node_modules` ; un frontmatter qui écrase `settings.json`, mesuré au canari. L'ordre importe — on ne retire pas la primitive existante avant que la remplaçante tourne. Dépendance à traiter : `bin/check-envelope` lit `.pi-subagents/artifacts/`.

Note d'état : `settings.json` sur `main` porte encore `npm:pi-subagents@latest`. L'épinglage `0.39.0` vit sur `fix/audit-remediation`, qui n'est pas poussée.

### D1 — Le worker écrit directement

Un patch doit transiter par le contexte de l'orchestrateur pour être appliqué : ~1 500 tokens pour cinquante lignes modifiées, à chaque délégation. C'est exactement l'accumulation qu'on cherche à éviter.

Il fabrique aussi une classe d'erreurs nouvelle — un patch écrit contre un état de fichier qui a changé entre-temps échoue à l'application, et on récupère un échec sans savoir quoi en faire.

Ce qui compte est de voir ce qui a été fait, et `git diff` le donne gratuitement, hors contexte. Le filet existe déjà : `pi-diff-review`, `bash-guard` (aucun commit sans jeton), `pi-lint-gate` (ruff après chaque édition).

→ **Écriture directe, `changed_files` obligatoire dans le JSON.**

### D2 — L'advisor tourne sur décision d'architecture

**Décision prise sans appui empirique direct, et assumée comme telle.** La justification par la fréquence — 11 sessions oracle sur 196 — vient d'un corpus de test et reste retirée (voir l'encadré « Les quatre rôles »).

La seconde justification, l'analogie avec `code-review`, reposait sur cinq rapports de revue ETL classés AR2, non récupérés. **Ils l'ont été depuis** : huit vraies revues dans `anime-etl`, sur les cinq fichiers attendus. Le constat qu'on en tirait est confirmé et amendé — **zéro `Approved` sur huit revues**, deux `Blocked`, trois `Needs Rework`, trois verdicts en français hors vocabulaire. Un signal qui ne prend jamais sa valeur positive porte moins d'information qu'on ne croit.

Reste que ce constat porte sur `code-review`, pas sur l'advisor. L'analogie tient comme argument de conception, pas comme mesure : un signal qui se déclenche à chaque tour cesse d'être un signal, et l'entrée d'un advisor par processus séparé doit être composée à la main.

Ce qui reste est un argument de conception, pas une mesure : un signal qui se déclenche à chaque tour cesse d'être un signal, et l'entrée d'un advisor par processus séparé doit être composée à la main — elle n'est pas gratuite comme un flux d'événements interne.

Le coût, lui, est mesuré : ~2 500 tokens par appel, plus les extraits verbatim du paquet.

→ **Déclencheur explicite : fork coûteux ou irréversible.** Un choix réversible et bon marché ne l'appelle pas — c'est déjà la règle d'AGENTS.md (« Cheap and reversible decisions are taken and stated inline »). Invocation manuelle toujours possible.

→ **Élargir les motifs déterministes de `bash-guard` plutôt qu'ajouter un mécanisme.** Le niveau HIGH escalade déjà vers un arbitre, à coût nul par tour puisqu'aucun modèle n'entre dans la boucle tant qu'aucun motif ne matche. Candidats à l'ajout : diff touchant un manifeste de dépendances, fichier de migration de schéma, `.tf` sur une ressource stateful, première écriture dans un nouveau répertoire de premier niveau, opération `IAM`. C'est la part de la valeur d'un advisor réactif — être interpellé sur ce qu'on n'a pas vu — qui s'obtient avec un prédicat écrit à la main.

### D3 — Pas d'AGENTS.md dans les enfants

AGENTS.md fait 4 392 tokens et s'adresse à un orchestrateur : chaîne de précédence, régimes d'exécution, table de délégation, workflow de compaction. Un worker qui le reçoit lit majoritairement des règles sur comment déléguer, alors qu'il ne délègue jamais.

Trois motifs : le coût (4 392 tokens × chaque appel, massivement hors sujet) ; la dilution — mesurée, l'ajout du plancher de vérification a fait passer les appels d'outils de 5-8 à 2-3, une règle bien placée change le comportement, une règle noyée non ; et le principe « One fact, one file ».

→ **`contextFiles: false`.** Chaque rôle porte ses règles dans son propre prompt : worker → plancher de vérification, hard limits, « smallest correct change », « match what's there » ; reviewer → matrice sévérité × confiance ; scout → contrainte de format ; advisor → interdiction d'éditer. Trente à cinquante lignes par rôle.

---

## Une session par tâche, pas par appel

**Oui, c'est possible, et c'est probablement le bon réglage — mais pas au niveau qu'on croit.**

Trois régimes existent :

| Régime | Flag | Ce que ça donne |
|:--|:--|:--|
| Une session par appel | `-p --no-session` | Ce que fait l'exemple officiel. Le plus simple. L'enfant repaie son prompt système à chaque fois — ~1 000 tokens avec `-nc`, très majoritairement en cache |
| Une session par tâche | `--session-id <runId>-<rôle>` | L'enfant garde son historique entre deux étapes de la même tâche. Un worker qui fait l'étape 2 se souvient de l'étape 1 |
| Un processus persistant | `--mode rpc` | Le processus reste vivant, on lui envoie plusieurs prompts sur stdin. Plus de latence de démarrage |

**Ce qu'on gagne à réutiliser** : la continuité sur une tâche multi-étapes, et l'économie de la latence de démarrage.

**Ce qu'on perd** : l'historique s'accumule et se relit à chaque tour. C'est précisément le mécanisme mesuré sur la baseline — la variance des tokens totaux venait entièrement du nombre de tours qui relisent le cache, pas du travail réel.

**Correction : `--session-id` porte deux effets séparables, qu'on avait confondus.** Le changelog 0.80.3 corrige `--no-session --session-id` explicitement pour « deterministic session IDs for provider cache affinity ». L'identifiant sert donc au routage de cache indépendamment de la persistance d'historique. L'objection ci-dessus — l'historique s'accumule et se relit — ne vise que la persistance.

→ **Décision, en deux régimes.**

| Rôle | Flags | Ce qu'on obtient |
|:--|:--|:--|
| `worker` | `--session-id <runId>-worker` | affinité de cache **et** continuité entre étapes d'une même tâche |
| `scout`, `advisor`, `reviewer` | `--no-session --session-id <runId>-<rôle>` | affinité de cache **sans** accumulation d'historique |

Un `runId` naît quand l'orchestrateur ouvre une tâche et meurt avec elle. La session du worker est abandonnée à la fermeture de la tâche.

Requiert pi ≥ 0.80.3. Version installée confirmée : 0.83.0 (`settings.json`, `lastChangelogVersion`).

`--mode rpc` n'est à envisager que si la latence de démarrage se révèle gênante — **à mesurer, pas à supposer**. Il impose de gérer un cycle de vie de processus, ce qui est nettement plus complexe.

### D4 — Skills sectionnées, section review réduite à un delta

**Une skill par domaine, avec deux sections adressées** : les conventions d'écriture, puis un bloc de relecture réduit.

Écarté : dédoubler chaque skill en `<domaine>-engineering` et `<domaine>-review`. Vingt fichiers deviendraient trente-cinq, et la dérive entre deux fichiers censés dire la même chose est exactement le défaut mesuré chez `gcp-dataeng-architecture`, qui recopie mal la formule de coût de `bigquery-ops` et ampute le seuil « <10K rows ».

**L'argument décisif est dans le corpus.** Dans `iac-terraform`, backend GCS et `prevent_destroy` apparaissent **trois fois** : « Non-negotiable rules », « Anti-patterns », « Review checklist ». Les 96 items de checklist cumulés du loadout reviewer ne sont pas de la connaissance supplémentaire — ce sont des reformulations des conventions d'écriture.

La découpe n'a donc pas à être 50/50 :

- chaque skill de domaine garde ses **conventions d'écriture** intégralement ;
- sa section review tombe à cinq ou dix lignes — uniquement ce qui est **spécifique à la relecture et absent des conventions** ;
- la méthode générique (matrice sévérité × confiance, règles de verdict) vit **une seule fois** dans `code-review`, que le reviewer reçoit toujours.

Le gain de tokens vient de la suppression de redondance, pas de la duplication de fichiers.

**Conséquence sur la configuration** : les tableaux `skills` de `settings.json` disparaissent.

#### Amendement — découpage par en-tête, tranché à l'injection

Quand D4 a été décidé, l'hypothèse mécanique était `--skill` et des tableaux de loadout. On sait maintenant que l'injection passe par `--append-system-prompt`, qui prend **un fichier entier**. Une skill non découpée enverrait donc ses règles de relecture au worker et ses conventions d'écriture au reviewer, sans moyen de trier — ce qui rouvrait la tentation de dédoubler les fichiers.

La sortie tient au fait qu'on écrit l'extension : `--append-system-prompt` accepte aussi bien un chemin **que du texte**. L'extension lit le `SKILL.md`, découpe sur un en-tête convenu, et n'injecte que la tranche voulue.

**Convention, obligatoire dans toute skill de domaine :**

```markdown
## Authoring
## Review delta
```

| Rôle | Tranches injectées |
|:--|:--|
| `worker` | `## Authoring` |
| `reviewer` | `## Authoring` + `## Review delta` |
| `advisor` | aucune — pas d'outil `read`, extraits verbatim du paquet seulement |

Le reviewer reçoit les deux : D4 exige qu'il tienne le même standard que le worker.

**Limite mesurée du découpage.** Sur quatre revues du même fichier dans `anime-etl`, seule celle dont l'entrée citait les étapes de la skill en a produit le format ; les trois autres ont fait le même travail sous leurs propres en-têtes, en français. Une tranche injectée transmet donc du **contenu**, jamais de la **forme**. `## Review delta` dit au reviewer quoi chercher ; c'est le schéma de `submit` qui dit comment le rendre. Ne rien écrire de formel dans les tranches. La découpe reste 90/10 en volume — elle devient simplement adressable. Un fichier par domaine, « One fact, one file » préservé, aucune surface de dérive créée.

**Le risque, et sa mitigation non négociable.** Découper sur un en-tête est un contrat de parsing : un titre renommé et l'injection tombe en silence. C'est exactement la classe de panne déjà rencontrée avec le parser de `/check-config` et son format de backticks obligatoire. **`pi-check-config` doit échouer si une skill de domaine n'a pas ses deux en-têtes exacts.** Sans cette garde, ne pas mettre le découpage en service.

**Ce que D4 vaut en tokens, mesuré sur le corpus.** Le reviewer est le rôle cher : il reçoit `code-review` (2 154 tokens estimés) plus une skill de domaine (1 711 pour `python-engineering`, 3 142 pour `gcp-engineering`). Les cinq blocs « Checklists by domain » de `code-review` occupent les lignes 82 à 140 et redisent les skills de domaine que le même reviewer reçoit par ailleurs. Sur l'ensemble du corpus, **102 items `- [ ]`** répartis sur dix skills — le chiffre de 96 retenu jusqu'ici était sous-évalué.

### D5 — Parallélisme sur les rôles read-only uniquement

Techniquement trivial : plusieurs `spawn`, on attend les promesses. L'exemple officiel le fait déjà.

**Autorisé** : plusieurs `scout` sur des questions distinctes ; `reviewer` et `advisor` en simultané. Aucun risque, gain réel sur le temps mur.

**Interdit pour l'instant** : deux `worker` en parallèle. Ils éditent le même arbre de travail et s'écrasent mutuellement. `git worktree add` réglerait le problème — chantier séparé, pas maintenant.

**Nuance sur le gain attendu.** Les runs inline mesurés font 29s à 1m18s ; les sessions déléguées faisaient 3m56s à 11m35s. Ce qui est lent, c'est la délégation elle-même, pas l'agent. Et une tâche linéaire ne se parallélise pas — annoter deux fonctions restera séquentiel.

Le levier de temps le plus sûr reste celui déjà obtenu : moins de tours. Passer de 5-8 appels d'outils à 2-3 a divisé la durée par deux.

### D6 — `data-quality` : délimiter les deux tensions

Les paires ne sont pas contradictoires, mais rien dans le fichier ne le dit — et Audit 2 les a lues comme des contradictions. Si un auditeur s'y trompe, un modèle aussi.

« Assert before writing » porte sur le schéma et les invariants, vérifiables avant écriture. « Implement as a post-load check » porte sur la comparaison de volumétrie **entre runs**, qui exige que les données soient écrites. Idem pour l'autre paire : « Fail loud » vise les invariants de lot, la quarantaine vise les lignes individuelles — et elle inclut déjà « Alert on any non-empty quarantine table », donc elle n'avale rien.

→ Deux en-têtes, `## Before writing` et `## After writing`, avec la ligne de partage explicite : **invariant de lot en échec dur, erreur de ligne en quarantaine sous un seuil défini**. Coût : quatre lignes.

### D7 — `bigquery-ops` : sortir le dry-run et `sqlfluff`

Deux motifs indépendants.

Sa description exclut l'authoring (« Not for authoring or optimising query text — see bigquery-engineering ») et son corps le réintroduit l.232 et l.307. Un fichier qui contredit sa propre description a un problème de contenu.

Et la règle de dry-run manuel est **périmée** : `pi-bq-cost-sentinel` dry-run tout `bq query` passé par `bash`, subagents inclus, et bloque directement au-delà de 1 TB sans UI. Application de la règle 2 — « No rule duplicates what an extension enforces ».

→ `sqlfluff` et le dry-run partent vers `bigquery-engineering`. `bigquery-ops` garde ce qui lui appartient : qui a accès, pourquoi ça a coûté ça, dans quel état est cette table. 325 lignes, le plus gros fichier du corpus, doit maigrir.

### D8 — Pas de skill pour le contrat de sortie

Trois raisons.

Le contrat est une **contrainte de mécanisme**, pas une connaissance de domaine. Il sera validé par l'extension : une sortie non conforme est rejetée avant d'atteindre l'orchestrateur. Une skill décrivant une contrainte déjà appliquée par du code viole la règle 2.

C'est mesuré : `agent-io` existait pour ça et son échec était structurel — sa description conditionnait le chargement à une intention de l'orchestrateur (« Load in the orchestrator session before delegating »), pas au contenu d'une tâche. Une skill ne peut pas se déclencher sur « je vais bientôt déléguer ».

Enfin, chaque rôle n'a besoin que de **son** schéma, pas des quatre.

→ `agent-io` disparaît d'elle-même. **Le corpus passe de 20 skills à 19.** Ce qui reste côté orchestrateur — composer un paquet d'entrée, choisir un rôle — va dans AGENTS.md, section délégation, une dizaine de lignes.

**Renforcé par le mécanisme `submit`.** Le schéma ne vit même plus dans le prompt du rôle : il est les `parameters` de l'outil terminal du rôle, et pi le fait respecter. Une skill décrivant une contrainte que le moteur d'appel d'outils applique déjà serait la violation la plus nette possible de la règle 2.

---

## Extensions

Trois questions, dans cet ordre : **où chaque hook tourne**, lesquelles survivent au chantier, lesquelles valent la peine d'être ajoutées.

### Où tourne chaque hook

Voir « Principe fondateur » : `-ne` partout, liste blanche `-e` par rôle. Un hook n'atteint un enfant que s'il lui a été passé — c'est une propriété du lancement, pas une hypothèse.

### Ce que le chantier change pour les extensions existantes

Les sept locales restent, mais quatre changent de statut.

| Extension | Ce qui bouge |
|:--|:--|
| `bash-guard` | **Valeur en hausse.** Ses motifs HIGH deviennent le déclencheur déterministe de l'advisor (D2). À élargir : manifeste de dépendances, migration de schéma, `.tf` sur ressource stateful, création d'un répertoire de premier niveau, opération `IAM`. Et il lui faut une règle pour les invocations de `pi` que l'extension de sous-agents va spawner |
| `pi-session-journal` | **Valeur en hausse.** Devient l'instrument de l'arbitrage n°8 — c'est sur ses `.jsonl` que se décide l'advisor réactif |
| `pi-check-config` | **Réécriture obligatoire.** Les tableaux `skills` de `settings.json` disparaissent. Il doit désormais vérifier : schéma `submit` déclaré par agent, modèles résolvables, chemins de hooks existants, et **la présence des en-têtes `## Authoring` / `## Review delta`** dans chaque skill de domaine — garde non négociable du découpage D4 |
| `pi-diff-review` | **Doublon probable** avec le rôle `reviewer`. Deux mécanismes pour la même chose : règle 2. À trancher une fois le reviewer en service — la question est de savoir s'il reste un usage propre à `/diff-review` que le rôle ne couvre pas |
| `pi-lint-gate`, `pi-bq-cost-sentinel` | Inchangées, mais désormais passées explicitement au worker |
| `pi-project-brief` | `.pi/BRIEF.md`, ~397 tokens. **À vérifier** : atteint-il encore un enfant lancé en `-nc` ? |
| `pi-powerline-footer`, `@tmustier/pi-raw-paste` | Inchangées, 0 token |

**`bin/check-envelope` est écrit contre l'ancien contrat.** Il valide `agent`, `status`, `summary` et affiche `f.get('location')` ; la nouvelle enveloppe utilise `role`, `path` + `line`, et ajoute `next`. Il lit aussi `.pi-subagents/artifacts/`. Avec la validation portée dans l'outil `submit`, il ne garde d'intérêt que comme sonde hors bande sur les artefacts disque — à réaligner ou supprimer. Arbitrage n°6.

**`pi-subagents` part**, en second temps, une fois la remplaçante en service. Voir D0.

### Candidats — exemples officiels du paquet

| Candidat | Ce qu'il apporte | Statut |
|:--|:--|:--|
| `structured-output.ts` | Outil terminal à schéma TypeBox, `terminate: true` | **Retenu** — c'est le mécanisme du contrat de sortie |
| `git-checkpoint.ts` | Stash git par tour (`on("turn_start")`) | **À évaluer sérieusement** : filet direct sous D1, où le worker écrit sans passer par un patch |
| `prompt-customizer.ts` | `systemPromptOptions` sur `before_agent_start` | À évaluer — peut-être plus propre que `--append-system-prompt` pour l'injection des tranches |
| `permission-gate.ts`, `protected-paths.ts` | Blocage de commandes et de chemins | **Écartés** — `bash-guard` couvre déjà, règle 2 |
| `plan-mode/` | Mode plan complet, au niveau session | Curiosité : le rôle `planner` a été supprimé, mais un mode de session n'est pas un sous-agent. Aucune décision attachée |

**hashline : pas maintenant.** Le gain mesuré est réel — 61 % de tokens de sortie en moins sur Grok 4 Fast — mais il vient de la suppression des boucles de reprise sur diffs ratés. Or les runs mesurés montrent 2 à 3 appels d'outils dont **un seul `edit`** : le problème ne se manifeste pas ici. Et c'est un package du monorepo omp (`@oh-my-pi/hashline`) — le format de patch est une chose, l'intégrer à l'outil `edit` de pi en est une autre. À reconsidérer si des tâches d'édition lourdes font apparaître des reprises.

---

## À trancher

| # | Question | Enjeu |
|:--|:--|:--|
| 4 | Le `reviewer` tourne-t-il systématiquement après le worker, ou seulement au-delà d'un seuil de diff ? | **Le worker est gratuit à la marge** (`openai-codex`, abonnement), le reviewer passe par `claude-bridge` et l'advisor par l'API Gemini. Le coût d'une délégation est donc presque entièrement chez le reviewer — argument pour un seuil plutôt qu'un passage systématique, et pour être généreux en tranches côté worker |
| 5 | Quelles skills garder, modifier, créer ? | Chantier en cours |
| 6 | `bin/check-envelope` : réaligner sur le nouveau schéma, ou supprimer une fois la validation dans l'extension ? | D8 |
| 7 | `--append-system-prompt` accepte-t-il un corps de 3 000 tokens sans buter sur la limite d'arguments du shell ? L'exemple officiel passe par un fichier temporaire | À vérifier sur `gcp-engineering` (12 570 caractères) |
| 8 | **Advisor réactif à la omp** — écarté pour l'instant, réouvrable sur preuve | Voir ci-dessous |

### 8 — Advisor réactif : écarté, avec une condition de réouverture

Le besoin est correctement posé : on ne peut pas invoquer un advisor pour un fork qu'on n'a pas vu. L'invocation explicite ne rattrape que les inconnues connues.

**Écarté pour trois raisons.** Ce n'est pas une variante de l'extension sous-agents mais une seconde extension, sans code commun : les sous-agents lancent des processus, un advisor réactif s'accroche aux événements de session, tient un client de modèle et réinjecte dans la conversation. Il consomme le contexte de l'orchestrateur, c'est-à-dire précisément les 14 528 tokens que tout ce chantier réduit. Et le point dur n'est pas le code mais **le prédicat de déclenchement** : trop large il devient du bruit ignoré, trop étroit il faut savoir écrire la condition — ce qui est le problème entier. Le corpus actuel ne permet pas de l'écrire.

**Condition de réouverture — à instruire sur les fichiers de session.** Après quelques semaines d'usage réel, dépouiller `~/.pi/agent/sessions/*.jsonl` en écartant les sessions de test, et chercher les moments où une contradiction aurait eu de la valeur : décision d'architecture prise inline sans escalade, choix de dépendance ou de forme de schéma, revirement en cours de session.

La question à trancher ensuite est unique : **combien de ces cas un motif déterministe de `bash-guard` n'aurait pas attrapés ?**

- Si la quasi-totalité est couverte par des motifs → étendre `bash-guard`, ne rien écrire de plus. Coût par tour : zéro.
- S'il reste une classe consistante de cas qu'aucun prédicat écrit à la main ne capture → l'advisor réactif se justifie, et il s'écrira sur des exemples plutôt que sur une intuition.

Aucun seuil chiffré n'est fixé ici : il tiendrait du même défaut que les fréquences retirées plus haut.

---

## Planchers de contexte — mesurés

Trois runs directs, sans soustraction. `pi --mode json -p --no-session -nc -ns`, fixture `bench-pi-baseline`, message « hi ».

| Outils passés | `input` mesuré |
|:--|--:|
| aucun (`-nt`) | **959** |
| `read,grep,find,ls` | **1 514** |
| `read,grep,find,ls,bash,edit,write` | **2 023** |

Le premier chiffre tombe **exactement** sur le poste « Socle pi + message » de la baseline (959), obtenu par une voie entièrement différente. Confirmation croisée.

Coût marginal des outils : 555 tokens pour les quatre premiers (~139 pièce), 509 pour les trois suivants (~170 pièce — schémas d'écriture plus gros).

**`--tools` est bien une allowlist stricte, vérifié empiriquement.** `-ne` n'était pas passé sur ces runs : `pi-subagents` était donc découvert, et ses 5 468 tokens de définitions d'outils n'apparaissent nulle part. Sans allowlist stricte, l'`input` du second run serait à ~7 000.

### La décomposition de la baseline n'est pas additive

2 023 − 959 = **1 064 tokens pour sept outils built-in**. La baseline annonçait 679.

L'origine est arithmétique : 5 468 + 4 392 + 2 894 + 959 + 679 + 136 = 14 528, le total exact. La ligne « outils built-in » n'a jamais été mesurée — c'était le **résidu** qui faisait tomber la somme juste, et elle absorbait donc l'erreur de toutes les autres.

Cause probable : les `promptSnippet` et `promptGuidelines` se recouvrent entre extensions et built-ins, donc retirer un poste d'un contexte plein ne donne pas son coût isolé. Il y a ~385 tokens de terme croisé, très probablement au débit de `pi-subagents`, dont le coût marginal réel serait plutôt **~5 083**.

> **Règle à retenir.** Les lignes de la baseline obtenues par soustraction (`-ns`, `-nc`, `-ne`, `-nt`, `-np`) sont des ordres de grandeur, pas des valeurs. Seules les mesures directes font foi. Les trois chiffres ci-dessus en sont.

### Cible par rôle

| Rôle | Outils | Plancher **mesuré** | Prompt de rôle | Tranches | Total estimé | vs 17 041 |
|:--|:--|--:|--:|:--|--:|--:|
| `advisor` | aucun + `submit` | **959** | ~400 | extraits du paquet | ~1 500 | **11,4×** |
| `scout` | 4 + `submit` | **1 514** | ~400 | aucune | ~2 050 | **8,3×** |
| `worker` | 7 + `submit` | **2 023** | ~500 | `## Authoring` | ~3 400 | **5,0×** |
| `reviewer` | 4 + `submit` | **1 514** | ~500 | `## Authoring` + `## Review delta` | ~4 000 | **4,3×** |

Seuls les planchers sont mesurés. Les colonnes « prompt de rôle » et « tranches » restent en chars/4 × 0,82 et bougeront avec D4 — c'est le reviewer qui en bénéficie le plus, puisque vider `code-review` de ses cinq blocs le fait maigrir en premier.

Note historique : la cible initiale de « ~1 000 » était plus juste que sa correction à « 3 000–4 500 ». Cette correction traitait les 2 204 du run de contrôle comme un plancher, sans vérifier qu'ils incluaient le mode interactif et les sept outils built-in.

---

## Ce qui reste à mesurer

- **Coût réel d'une délégation complète** scout → worker → reviewer. Les 0,27 $ par appel de la baseline sont **notionnels** : les runs passent par `openai-codex/gpt-5.6-sol`, abonnement ChatGPT, coût marginal nul, et pi applique une grille plate de 5,00 $/M sans connaître le fournisseur. Le coût réel se concentre sur `claude-bridge` (reviewer) et l'API Gemini (advisor).
- **Contexte de l'orchestrateur après retrait de `pi-subagents`** : ~9 060 par soustraction, donc à mesurer directement compte tenu de ce qui précède.
- **`thinking` sur une tâche non triviale.** Les cinq rôles tournent en `"thinking": "high"` — `defaultThinkingLevel: "medium"` est écrasé partout. Le raisonnement reste pourtant à 10 tokens sur la fixture. Ce n'est donc pas un « faux levier » : c'est un levier **sans effet mesurable sur les tâches de la classe testée, et non testé au-delà**. À rouvrir sur une tâche d'architecture.
