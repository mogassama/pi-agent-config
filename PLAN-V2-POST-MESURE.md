# Plan de remédiation v2 — après mesure

Remplace le plan v1 sur tout ce qui touche aux priorités. Le v1 reste utile pour le détail des 44 constats de récolte.

*Révision du 3 août 2026 — trois planchers de contexte mesurés directement, décomposition déclarée non additive, coût déclaré notionnel, ligne `thinking` corrigée, quatre comptages de l'étape D rectifiés.*

---

## Ce qui est établi

### Mesures directes — font foi

| Fait | Valeur | Source |
|:--|--:|:--|
| Contexte initial, config complète | **14 528** tokens (14 925 avec brief) | 8 runs identiques au token près |
| Contexte initial sans config | **2 204** | run de contrôle, mode interactif, 7 outils |
| Plancher enfant, aucun outil (`-nc -ns -nt`) | **959** | run direct |
| Plancher enfant, `read,grep,find,ls` | **1 514** | run direct |
| Plancher enfant, 7 outils built-in | **2 023** | run direct |
| Tokens frais par tâche | ~20 200, dispersion **6,0 %** | 8 runs |
| Délégations observées | **0 / 8** | tous les runs de la fixture |
| `ruff` + `mypy` lancés à la main | **8 / 8** | alors que `pi-lint-gate` les exécute |

### Lignes obtenues par soustraction — ordres de grandeur seulement

| Poste | Valeur annoncée | Statut |
|:--|--:|:--|
| AGENTS.md | 4 392 | `pi -nc` |
| extensions | 5 604 | `pi -ne` |
| descriptions de skills | 2 894 | `pi -ns` |
| définitions d'outils | 9 177 | `pi -nt`, recouvre les extensions |
| templates de prompts | 0 | `pi -np` |
| `.pi/BRIEF.md` | ~397 | écart entre les deux séries |
| socle pi + message | 959 | **confirmé par mesure directe** |
| outils built-in | 679 | **faux — mesuré à 1 064** |

> **La décomposition n'est pas additive.**
>
> 2 023 − 959 = **1 064 tokens pour sept outils built-in**, contre 679 annoncés.
>
> L'origine est arithmétique : 5 468 + 4 392 + 2 894 + 959 + 679 + 136 = 14 528, le total exact. La ligne « outils built-in » n'a jamais été mesurée — c'était le **résidu** qui faisait tomber la somme juste, et elle absorbait donc l'erreur de toutes les autres.
>
> Cause probable : les `promptSnippet` et `promptGuidelines` se recouvrent entre extensions et built-ins, donc retirer un poste d'un contexte plein ne donne pas son coût isolé. Il reste ~385 tokens de terme croisé, très probablement au débit de `pi-subagents`, dont le coût marginal réel serait plutôt **~5 083**.
>
> Aucune décision prise jusqu'ici ne bascule : les ordres de grandeur tiennent, et le classement des postes est inchangé. Mais aucune de ces lignes ne doit servir de valeur de référence dans un calcul.

### Le fork est mesuré à 17 041, dont 2 tokens frais

Quatre sessions enfants de `anime-etl` donnent le même chiffre au token près : `in=2, cacheRead=17041`. Ce sont les quatre entrées portant un `## Acceptance Contract`.

Deux corrections. Le chiffre de la baseline, 15 749, est faux. Et surtout : **le fork est presque intégralement en lecture de cache**, environ dix fois moins cher par token, sur des runs à coût marginal nul. L'argument économique contre le fork ne tient pas.

Ce qui le condamne reste entier, mais change de nature : 17 041 tokens de contexte parent non demandés, qui diluent l'attention et remplissent la fenêtre ; plus le mode de défaillance mesuré au canari — le fork transmet le texte du parent mais pas ses appels d'outils. **Argument de correction, pas d'économie.**

Réserve d'extraction : les autres lignes de la même mesure (`in=2 cacheRead=0`) sont des artefacts — le premier événement `message` porteur d'`usage` n'est pas toujours le premier appel modèle. Seules les quatre lignes à 17 041 sont exploitables, et leur identité mutuelle les valide.

### L'enveloppe n'est produite que si le prompt la réclame

Sur les dix runs reviewer d'`anime-etl`, l'enveloppe JSON apparaît dans **5 sorties**. La corrélation est parfaite : **5/5 quand l'entrée de tâche la nomme**, **0/3 quand elle décrit seulement le travail**. La skill `code-review` était chargée dans tous les cas.

Champs réellement émis : `agent`, `status`, `summary`, `verdict`, `findings` (19 au total, en `severity`/`confidence`/`location`/`issue`/`fix`), `tooling`, `out_of_scope`, `open_risks`, `files_reviewed`. **Seul `mergeable` n'existe nulle part** — c'est-à-dire précisément le champ sur lequel portait T7.

Correction d'un constat antérieur : « l'enveloppe n'a jamais été produite » était faux, et venait d'un `grep` sur `mergeable` seul. Le contrat sortait, sous un autre nom de verdict, une fois sur deux.

Second constat, plus large : sur **quatre revues du même fichier** (`load.py`), une seule a produit le format de la skill — celle dont l'entrée citait les étapes une à une. Les trois autres ont fait un travail de fond équivalent, en français, sous leurs propres en-têtes. **Une skill chargée en contexte n'impose pas son format de sortie.**

La substance converge — les quatre relèvent la non-idempotence des `to_sql(if_exists="append")` et l'absence de transaction partagée. C'est la forme qui diverge. Le reviewer n'est donc pas calibré pour bloquer à vide : il travaille, mais rend comme il veut.

### Le coût affiché est notionnel

Les runs passent par `openai-codex/gpt-5.6-sol` — abonnement ChatGPT, **coût marginal nul**. pi applique une grille plate de 5,00 $/M sans connaître le fournisseur réel.

Donc **0,27 $ par délégation contre 0,09 $ inline** ne décrit pas une dépense. Le coût réel se concentre sur `claude-bridge` (reviewer, limites Max partagées avec Claude Code interactif) et l'API Gemini (advisor). Le worker est gratuit à la marge.

Conséquence directe sur l'arbitrage du seuil de déclenchement du reviewer : c'est lui qu'il faut borner, pas le worker.

**Instrument de mesure** : un message, un appel modèle, un chiffre. Toute modification se valide en 10 secondes.

```bash
cd ~/bench-pi-baseline && pi --name "mesure-N" --session-dir ~/bench-sessions
# taper "hi", quitter, lire le in= du premier appel
```

Pour un plancher enfant, sans passer par la session interactive :

```bash
pi --mode json -p --no-session -nc -ns --tools <liste> "hi" 2>/dev/null | python3 -c "
import sys,json
for l in sys.stdin:
    try: e=json.loads(l)
    except: continue
    m=e.get('message') or {}
    if e.get('type')=='message_end' and m.get('role')=='assistant':
        print(m.get('usage')); break"
```

---

## Ce que la mesure a tué

À ne plus faire, et à retirer des deux audits.

| Item | Pourquoi il tombe |
|:--|:--|
| **X1 — plancher de délégation** | Zéro délégation sur 8 runs de la fixture. Le comportement est conforme sur cette classe de tâche. Tient, parce qu'il s'appuie sur un protocole reproductible et non sur le journal d'usage |
| **X2 tel qu'écrit — `subagents/worker.md`** | Aucun worker impliqué. Le champ `Validation:` n'est pas en cause ici. **La correction doit viser AGENTS.md** |
| **X20 — format scout** | Aucun scout lancé sur les 8 runs. Priorité 1 d'Audit 1, sans objet sur cette classe de tâche. À reprendre seulement si une tâche réelle en déclenche un |
| **Réduction des prompts pour raison de coût** | 0 token. `prompts/debug`, `bq-triage`, `new-dag`, `docstrings` : aucun gain de contexte. Seul l'argument « double formulation à maintenir » subsiste — hygiène, pas économie |
| **R43/R44 — structure des skills** | `read .pi/agent/skills/python-engineering/SKILL.md` dans 8/8 runs. Structure en dossiers confirmée. Question ouverte 2 d'Audit 2 fermée |
| **X28 — suppression d'`agent-io`** | Retiré au lot 3 : c'était le véhicule documenté du contrat d'enveloppe. `agent-io` disparaît tout de même, mais par D8, pour une raison différente |

### Ce qui ne tombe plus — le corpus de 196 sessions est disqualifié

Entre 100 et 120 des 196 sessions sont du debug de configuration avec un assistant externe ; le reste comprend des `hi` de mesure et des invocations manuelles du type « lance worker ». **Aucune fréquence tirée de ce corpus ne mesure un besoin.**

Sont retirés de toute justification : « scout dans 3 sessions sur 196 », « 11 sessions oracle », « oracle-deep 5 fois », et l'inférence tirée des 28 délégations. Le fait que ces 28 délégations aient été commandées explicitement par l'opérateur reste vrai ; en conclure que le modèle ne délègue pas spontanément est tautologique dans un corpus où la délégation était l'objet du test.

**T8 est rouvert** pour cette raison.

Les mesures de coût et de contexte ne sont pas touchées : elles ne dépendent d'aucune fréquence de session.

### Ce qui doit être reformulé, pas supprimé

| Item | Formulation actuelle | Formulation correcte |
|:--|:--|:--|
| **Levier `thinking`** | « 93–170 tokens de raisonnement, `thinking=medium` partout. Faux levier, question fermée » | **`settings.json` porte `"thinking": "high"` sur cinq rôles** ; `defaultThinkingLevel: "medium"` est un défaut global écrasé partout. Le JSONL le confirme : `openai-codex/gpt-5.6-sol:high`. Le raisonnement reste à ~10 tokens sur la fixture — donc **avec** `high`, pas malgré `medium`. Lecture correcte : **sans effet mesurable sur les tâches de la classe testée, non testé au-delà.** À rouvrir sur une tâche d'architecture |

La différence n'est pas cosmétique : « question fermée » interdit d'y revenir, « non testé au-delà » désigne l'expérience qui manque.

---

## Ce que la mesure a confirmé

| Item | Preuve |
|:--|:--|
| **Question ouverte n°2 des deux audits — résolue** | Texte de tâche minimal, ni worker ni planner, et pourtant : `git diff` 3/8, import runtime 2/8, `rg` d'usages 2/8, test de bundle Forge 5/8. Hypothèses (a) et (b) éliminées, reste (c). **La source est AGENTS.md** |
| **Double exécution du lint** | `uv run ruff check .` et `uv run mypy bench` à la main dans 8 runs sur 8, alors que `pi-lint-gate` les lance déjà |
| **Le socle fixe est le vrai problème** | 74 % du coût. Les deux audits mesuraient le worker à 6,4k et concluaient « normal » ; personne n'a mesuré l'orchestrateur, qui est à 14,5k |
| **`--tools` est une allowlist stricte** | Lu dans `core/agent-session.js:1943-1960`, puis vérifié : `-ne` absent des trois runs de plancher, `pi-subagents` donc découvert, et ses 5 468 tokens d'outils absents de l'`input` |
| **`gpt-5.6-sol` fonctionne** | Trois runs aboutis. Le bug OpenAI « model not supported when using Codex with a ChatGPT account » ne se manifeste plus |

---

## À faire — dans l'ordre

### Étape A — décomposition — CLÔTURÉE, avec réserve

Les deux mesures `-nt -ne` et `-nt -nc` prévues ici n'ont plus d'objet sous cette forme : la règle de décision qu'elles devaient trancher supposait l'additivité, qui est fausse.

Ce qu'il faut à la place : **mesurer directement**, jamais par différence. Les trois planchers enfants ci-dessus en sont le modèle.

### Étape B — AGENTS.md — APPLIQUÉE

| | Avant | Après |
|:--|:--|:--|
| Appels d'outils | 5 à 8 | **2 à 3** |
| `ruff`/`mypy` manuels | 8/8 runs | **0/3** |
| Tokens totaux | 72 920 | **−24 %** |
| Coût | ~0,14 $ | **−21 %** |

Le gain vient du **nombre de tours**, pas du poids du prompt. Chaque tour évité économise une relecture du contexte en cache.

Appliqué : suppression de « Run `/bq-cost` before approving any SQL query » (`handler: if (!ctx.hasUI) { return; }`, inopérant en subagent, et redondant avec le sentinel), suppression de « oracle cannot read the files otherwise » (`inherit: false` coupe le contexte, pas les outils de lecture), ajout du plancher de vérification et de la section « Rules about rules ».

**Reste à faire** : mesurer l'`in=` résultant. La correction a été validée sur le nombre de tours et le coût total, jamais sur le contexte initial. La cible annoncée était −1 000 à −1 500 tokens sur 4 392.

**Puis, après l'extension** : la section « Delegation with pi-subagents » (l.204-247, ~950 tokens) est à réécrire et « Loadouts » (l.162-181, ~440 tokens) à supprimer. C'est le plus gros gain restant sur ce fichier.

### Étape C — Descriptions de skills

**2 894 tokens pour 20 skills**, ~145 chacune. `agent-io` disparaissant avec D8, il en reste **19**.

Ne pas supprimer de skill : elles servent l'auto-load de l'orchestrateur. Resserrer les descriptions les plus longues, en gardant les marqueurs de reconnaissance. Cibles identifiées à la récolte : `gcp-engineering`, `dataeng-architecture`, `python-engineering`, `technical-writing`, `improve-codebase-architecture`.

Mesure à chaque passe. Gain attendu modeste.

### Étape D — Corrections d'hygiène

Aucune ne réduit le prompt. Toutes corrigent une erreur factuelle ou une double source. **Indépendantes de tout le reste — faisables à tout moment.**

Vérifiées ligne à ligne sur `mogassama/pi-agent-config@main`. Quatre comptages du plan d'origine étaient faux.

| Fichier | Correction | Vérification |
|:--|:--|:--|
| `skills/airflow-engineering` | Template de logging : `extra={...}`, supprimer `contextualize` | **Plus grave qu'annoncé.** l.47 obtient un logger par `logging.getLogger(__name__)`, l.71 appelle `logger.contextualize(...)` — API Loguru sur un `logging.Logger`. C'est un `AttributeError` à l'exécution, pas une incohérence de style. l.103 ajoute un troisième `logger`, Loguru celui-là, sous le même nom |
| `skills/gcp-dataeng-architecture` | Supprimer la requête `JOBS_BY_PROJECT`, pointer vers `bigquery-ops` | Formule fausse sur **deux** axes, pas un : `POW(10,12)` (TB décimal) contre `POW(1024,4)` (TiB) dans `bigquery-ops:128`, et `total_bytes_processed` contre `total_bytes_billed`. BigQuery facture le second, en TiB |
| Tarif `$6.25/TiB` | Paramétrer, ne pas coder en dur. C'est le tarif US multi-region appliqué à `europe-west1` sans le déclarer | **3 emplacements, pas 5** : `gcp-dataeng-architecture:84`, `bigquery-ops:128`, `bigquery-ops:173` |
| `bigquery-engineering:22`, `gcp-engineering:21` | Retirer « (Paris) » — `europe-west1` est St-Ghislain, Paris est `europe-west9` | 2 emplacements confirmés. **27 occurrences** d'`europe-west1` au total, pas 26. Si Paris était voulu, c'est un chantier d'infra, pas une correction de doc |
| `skills/spark-engineering` | Dédupliquer le bloc `classify_udf` | Doublon confirmé, l.52 et l.154 |
| `skills/gcp-engineering:267` | Pointeur cassé | Confirmé : pointe vers `bigquery-engineering`, la cible correcte est `bigquery-ops` |
| `APPEND_SYSTEM.md` | Supprimer `- scout: results[]` ; borner « propose 2 options » | Confirmé : l.35 contredite par l.38 (« scout is exempt ») ; l.12 sans borne. **Le contrat d'enveloppe y devient obsolète après l'extension** — traiter en une seule passe |
| `skills/iac-terraform` | Fusionner « Non-negotiable » et « Anti-patterns » | **4 sections, pas 3** : `prevent_destroy` en l.19 (Non-negotiable), 251 (Plan review), 269 (Anti-patterns), 281 (Review checklist). Il y a deux checklists distinctes |
| `skills/git-collaboration` | Retirer le corps de `/check-config` et le scan intégral de secrets | Confirmé : `/check-config` l.228-261+, `/audit` l.120-140. L'extension s'exécute seule |
| `extensions/bash-guard/README.md` | Documenter le niveau TOKEN | R13 |
| `AGENTS.md:206` | « Never use for: Before a planner plan exists » contredit `worker.md:3` | **Déjà corrigé** dans la version installée : « Work with no approved direction behind it » |

### Étape E — Ce qui reste non testé

| Test | Statut |
|:--|:--|
| `bin/check-envelope` existe-t-il ? | **Répondu — oui.** Mais écrit contre l'ancien contrat : valide `agent`/`status`/`summary`, affiche `f.get('location')`, lit `.pi-subagents/artifacts/`. La nouvelle enveloppe utilise `role`, `path`+`line`, `next` |
| **C1 — matrice à 4 marqueurs** | **Sans objet.** L'extension pose `-nc` par construction : l'enfant ne reçoit que ce qu'on lui passe. Plus de chaîne de précédence à départager |
| **C3 — `contact_supervisor`** | **Sans objet** pour la même raison |
| **AR2 — les rapports de revue ETL** | **Récupérés.** `~/projets_personnels/anime-etl/.pi-subagents/artifacts/` : dix runs reviewer, dont **huit vraies revues** sur `load.py`, `transform.py`, `extract.py`, `config.py`, `logger.py`. Les deux écartés sont une question de lecture sur la skill et un `PROTOCOL_CHECK`. **`code-review.md` est dégelé**, T7 instruisable |
| Une tâche réelle qui déclenche un worker ou un scout | Toujours en attente. Rejouer la mesure sur cette classe avant de toucher `worker.md` ou `scout.md` |

---

## Les arbitrages qui subsistent

| # | Fork | Statut |
|:--|:--|:--|
| T1 | Oracle : héritage ou arbitre sans mémoire | **Mort.** `-nc` par construction |
| T2 | Modèle scout | Ouvert. Attend une tâche réelle. Le chiffre « 50-200 calls/session » d'AGENTS.md n'est vérifié par personne |
| T3 | Reviewer read-only, ou rôle `fix-worker` distinct | Ouvert. Attend un usage réel |
| T4 | Place d'`APPEND_SYSTEM.md` dans la chaîne de précédence | **Réduit.** Ne concerne plus que l'orchestrateur : les enfants portent leur prompt de rôle |
| T7 | Condition `mergeable` de `code-review` | **Dégelé, et déplacé.** Le champ `mergeable` n'apparaît dans **aucun** des huit `_output.md`, alors que quatre entrées le réclamaient nommément. La question n'est plus « quelle condition » mais « comment le faire produire » — réponse : le schéma de `submit`. Décompte réel : 2 `Blocked`, 3 `Needs Rework`, 3 verdicts en français hors vocabulaire, **0 `Approved`** |
| T8 | Six rôles se justifient-ils ? | **Rouvert.** Le corpus qui le tranchait est disqualifié |
| — | Seuil de déclenchement du reviewer | Nouveau. Durci par la répartition réelle du coût : worker gratuit, reviewer payant |
| — | Advisor réactif à la omp | Écarté, condition de réouverture instruite sur les `.jsonl`. Voir SUBAGENTS-DESIGN, arbitrage n°8 |

---

## La règle qui manque

Sans elle, l'état actuel se reconstitue. En tête d'`AGENTS.md` — et elle se paie en tokens, donc à écrire serré.

```markdown
## Rules about rules

1. Every rule states its floor. A rule that applies identically to a 3-line
   diff and a 300-line diff is a ritual below some size — name that size.
2. No rule duplicates what an extension enforces. If a hook already runs it,
   the rule is "report the hook's result", never "run it".
3. One fact, one file. Cost formulas, regions, triage orders and operator
   lists live in exactly one place; everywhere else is a pointer.
4. Descriptions trigger on task content, never on operator intent.
5. A mandatory output field must have a legal empty form.
```

### Une sixième, pour ce document

```markdown
6. A number obtained by subtraction is an order of magnitude, not a value.
   Only direct measurements are quotable. State which one a figure is.
```
