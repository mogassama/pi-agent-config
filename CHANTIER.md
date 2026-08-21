# Chantier — état au 19 août 2026

*Registre de la configuration pi. Ce qui est fait quitte « à faire », ce qui a été
tranché ne garde que sa raison, ce qu'une mesure a réfuté le dit.*

Branche `feat/subagent-extension`.

---

## 1. Où on en est

La primitive de délégation est écrite, mesurée, et **exécutée trois fois de bout
en bout** sur le même projet de test `csv-to-bq` — 5 livrables, aucun accès GCP.
Le chantier n'est plus dans la phase où l'on conçoit contre des hypothèses : il
est dans celle où chaque changement se justifie par un run antérieur.

### Les trois runs

| | `3ed33e` | `ac451a` | `f0797e` |
|:--|--:|--:|--:|
| Délégations | 15 | 17 | **10** |
| Tours cumulés | — | 98 | **47** |
| Tokens cumulés | 4 170 000 | 2 248 389 | **802 051** |
| Coût Sonnet | — | ~1,55 $ | **~0,55 $** |
| worker / reviewer / scout | 8 / 7 / 0 | 5 / 7 / 5 | **5 / 4 / 1** |
| Livrable conforme aux données | **non** | oui | oui |

**`f0797e` est le premier run propre** : séquence `scout, worker, worker,
reviewer, worker, reviewer, worker, reviewer, worker, reviewer`, sans répétition
consécutive, cycle de revue `approved / needs_rework / needs_rework / approved`,
livrable correct et légèrement plus explicite que celui de Claude Code sur le
même bundle.

### Ce que chaque run a corrigé

**Après `3ed33e`** — la session persistante du worker relisait 24 fois un contenu
déjà présent à l'octet près, et 2,61 M de ses 3,32 M tokens étaient de
l'historique reporté. Le verdict du reviewer n'atteignait pas l'orchestrateur :
quatre revues `needs_rework` arrivaient en `[reviewer: ok, next=done]`. Et
`data/orders.csv` n'était nommé dans aucune des 15 tâches ni lu une seule fois
sur 104 lectures — le worker a déclaré un schéma à quatre colonnes contre un
fichier à cinq, tous les tests passaient, sept revues n'ont rien vu.

**Après `ac451a`** — les sept dernières délégations ne changeaient aucun fichier :
quatre revues consécutives, puis trois inventaires identiques. Personne n'avait à
décider que c'était fini. Et un scout a atteint son plafond de tours après
112 683 tokens sans rendre d'enveloppe.

**Après `f0797e`** — le reviewer recevait des chemins, donc aucune définition du
mot « changement » : il ne pouvait pas distinguer le neuf du préexistant, lisait
tout, et rejugeait tout.

### Inventaire

**19 skills** — 11 orientées relecture avec un `## Review delta`, 1 de mécanique
(`code-review`), 7 réservées à l'orchestrateur.

**3 agents** dans `subagent-only/agents/` :

| Rôle | Modèle | Session | Outils | `maxTurns` |
|:--|:--|:--|:--|--:|
| `worker` | `openai-codex/gpt-5.6-sol` (abonnement), `thinking: high` | éphémère | read, grep, find, ls, bash, edit, write, submit | **30** |
| `reviewer` | `anthropic/claude-sonnet-5` (API) | éphémère | **read, ls, submit** | **12** |
| `scout` | `deepseek/deepseek-v4-flash` | éphémère | read, grep, find, ls, bash, submit | 12 |

*Les quatre nombres de cette table et le seuil d'inline du diff ont tous été
calibrés sur `csv-to-bq` — 360 lignes — et ont tous dû être relevés pour un
projet huit fois plus gros. Ce sont les seules valeurs de la configuration qui
portent une taille de projet.*

Trois familles de modèles, vérifiées par `pi-check-config`. **Aucun rôle n'est en
session persistante** : le régime a été coupé après `3ed33e`, et `spawn-args`
passe `--session-id` dans les deux cas — l'affinité de cache du fournisseur ne
dépend pas de la persistance d'historique.

**7 extensions locales** : `bash-guard`, `pi-bq-cost-sentinel`, `pi-check-config`,
`pi-lint-gate`, `pi-project-brief`, `subagent`, `subagent-footer`. Deux paquets externes : `@tmustier/pi-raw-paste` (npm) et
`monotykamary/pi-deepseek-provider` (git).

---

## 2. Ce qui reste

### Fait depuis la version précédente de ce registre

Les trois entrées « faisable maintenant » du 5 août sont closes : `pi-check-config`
est poussé dans sa version réécrite, `README.md` est réécrit — plus une seule
mention de `check-envelope`, `agent-io`, oracle ou planner —, et le dossier
`agents/` racine n'existe plus. `claude/strategic-forge/SKILL.md` est adapté :
ses seules mentions de `planner`, `oracle` et `inheritProjectContext` sont des
interdictions.

**`claude/` n'est pas chargé par pi.** Strategic Forge est une skill Claude.ai qui
tourne **en amont**, avant qu'une session pi ne commence, pour borner un gros
projet et produire le paquet figé. Le répertoire est ici pour être versionné avec
la configuration qu'il décrit, rien ne le découvre côté pi — les skills pi vivent
dans `skills/`. Conséquence à ne pas oublier : **une modification ici doit être
répercutée dans la skill installée sur Claude.ai**, sinon Forge continue de
générer des paquets qui décrivent une configuration périmée. C'est le seul fichier
du dépôt dont la copie qui s'exécute n'est pas celle qui est versionnée.

### En attente d'une mesure précise

| Quoi | Ce qui le débloque |
|:--|:--|
| **Le coût de contexte du worker** | `09-worker` de `f0797e` : 205 699 tokens pour 3 858 de sortie, 26,8k de contexte moyen par tour contre 12k sur les deux workers précédents. Trois causes possibles — texte de tâche gonflé par les findings de la revue, sorties de `pi-lint-gate` qui restent en contexte, relectures dans la délégation — et **trois correctifs incompatibles**. La commande d'analyse est dans `ANALYSE-f0797e`. Ne rien toucher avant |
| **Plafond de rounds de revue** | `f0797e` a fait quatre alternances worker/reviewer et s'est arrêté proprement. La défaillance que le plafond corrige n'a pas eu lieu ; l'ajouter maintenant serait du mécanisme sur une intuition |
| **Canal `needs_decision` pour le worker** | `pi-subagents` a `contact_supervisor`, bloquant, qui laisse le worker vivant pendant qu'il attend. Non transposable en `-p` ; l'équivalent atteignable est un champ d'enveloppe. Aucun run ne l'a encore rencontré |

### Le test Spark

Prochaine exécution : un pipeline Spark de **2 978 lignes réparties en onze
modules**. C'est le premier projet où l'écart d'échelle mord, et il change trois
choses en même temps par rapport à `csv-to-bq` :

- le reviewer reçoit un diff pour la première fois ;
- il applique six critères d'admission neufs, qui **doivent** faire baisser le
  nombre de findings ;
- le projet ne tient plus dans un contexte.

**Référence à comparer** : `f0797e` — 10 délégations, 47 tours, 802 051 tokens,
~0,55 $, revues à 2 / 2 / 5 / 2 tours. **Le critère qui décide n'est aucun de
ceux-là : c'est la conformité du livrable.** Un run moins cher qui livre un
schéma inventé est une régression, pas une économie.

---

## 3. L'architecture, et pourquoi

### Un enfant n'hérite de rien

Chaque délégation lance un processus `pi` neuf : ni AGENTS.md, ni historique, ni
appels d'outils antérieurs, ni `APPEND_SYSTEM.md`.

**Une exception, explicite et mesurée** : `.pi/BRIEF.md` est injecté en
`--append-system-prompt` aux rôles qui déclarent `projectBrief: true` —
aujourd'hui le worker seul. Sans lui, un worker à qui AGENTS.md interdit de
supposer une arborescence obéit en dépensant des tours à la découvrir, et un tour
coûte une relecture complète de contexte. Le scout trouve la structure en
cherchant ; le reviewer juge contre un barème, et les spécificités de projet
appartiennent au texte de tâche.

*Ce registre affirmait le contraire jusqu'au 19 août. C'était faux depuis que
`buildSpawnPlan` injecte le brief.*

Le fork de `pi-subagents` valait **17 041 tokens, dont 2 frais** — presque tout en
lecture de cache. L'argument économique contre lui ne tenait donc pas ; ce qui le
condamne est le contrôle : du contexte parent non demandé, et un mode de
défaillance mesuré — le fork transmet le texte du parent mais pas ses appels
d'outils, d'où un reviewer accusant l'orchestrateur d'avoir fabriqué ses
délégations.

### Sémantique CLI, lue dans la source de pi 0.83.0

| Flag | Effet réel |
|:--|:--|
| `--tools` | Allowlist stricte sur les définitions built-in **et** extension |
| `-ns` / `-ne` | Coupent la découverte ; les chemins explicites survivent |
| `--skill <path>` | Injecte **nom + description + chemin**, jamais le corps — et seulement si `read` est présent |
| `--append-system-prompt` | Texte **ou** contenu de fichier : `existsSync` décide |
| `--session-id` | Combinable avec `--no-session` — affinité de cache sans historique |

### Un seul outil, `task`

190 tokens contre 5 468 pour les six de `pi-subagents`. Le rôle est un paramètre.
Seul le `summary` revient à l'orchestrateur ; l'enveloppe complète va dans
`.pi-subagent-runs/`.

**Ce qui traverse la frontière de l'outil, depuis `3ed33e`** : le `verdict`, le
nombre de findings et le nombre d'entrées hors périmètre, dans la ligne d'en-tête.
`status` répond à « la délégation est allée au bout » et vaut `ok` sur toute revue
qui a soumis, y compris une revue qui rejette. Ce sont deux questions
différentes ; la confusion a masqué quatre `needs_rework`.

### Le contrat de sortie est un outil, pas une consigne

`submit`, schéma TypeBox, `terminate: true`. **Mesuré** : sur dix runs reviewer de
`pi-subagents`, l'enveloppe apparaissait 5/5 quand le texte de tâche la nommait et
0/3 sinon. Une skill chargée n'impose jamais son format de sortie.

**Un champ requis dont le contenu n'est pas un produit naturel du rôle coûte plus
qu'il ne rapporte.** Mesuré sur `ac451a` : cinq revues sur sept ont échoué à leur
premier `submit`, sur `next` et `out_of_scope` — 203 098 tokens, 25 % du coût du
reviewer. Des quatre enveloppes qui n'ont émis `out_of_scope` qu'après rejet, deux
étaient vides et deux étaient des avertissements de périmètre. La seule entrée
substantielle du run venait d'un reviewer qui l'avait remplie spontanément.
`next` a été supprimé du schéma et dérivé du verdict ; `out_of_scope` est devenu
optionnel.

### Le reviewer juge un changement, donc il reçoit le changement

Depuis `f0797e`, l'extension ajoute le diff au texte de tâche du reviewer. Il est
construit depuis `changed_files` de l'enveloppe worker précédente, **pas depuis une
révision git** : les workers ne commitent jamais et un dépôt de bundle n'a qu'un
commit, donc `HEAD~1` échoue et le repli `git diff` renvoie tout depuis le bundle,
en grossissant à chaque livrable. Les fichiers non suivis sont diffés contre
`/dev/null` plutôt que passés par `git add -N`, qui muterait un index appartenant
au worker. Au-delà de 15 fichiers ou 32 kO, la tâche porte la liste et le reviewer
lit — seuil plus bas que les 50 kO d'oh-my-pi, parce que ce reviewer est plafonné
à six tours et le leur ne l'est pas.

Le diff est ce qui rend le critère « introduit par ce changement » applicable. Sans
frontière de patch, « préexistant » n'a pas de définition et le critère n'est pas
seulement absent : il est inapplicable.

### Les règles qui doivent tenir vivent dans le code

Trois fois, une règle écrite en prose dans `AGENTS.md` n'a pas tenu :

| Règle | Où elle était | Ce qu'elle est devenue |
|:--|:--|:--|
| « Nomme les fichiers dont le travail dépend » | `AGENTS.md` + description du paramètre `task` | Scan des fichiers de données non nommés, dans `spawn-args` |
| « La session s'arrête quand tous les items ont passé leur critère » | `INSTRUCTIONS.md` | Garde de boucle dans `index.ts`, refus avant `dispatch` |
| « Chercher est le travail du scout » | `AGENTS.md` | Trois règles contraires retirées du même fichier, plus un nudge déclenché sur preuve |

Le corollaire vaut aussi dans l'autre sens : une garde qui refuse et n'écrit rien
n'est pas mesurable. Les refus sont journalisés dans
`.pi-subagent-runs/<runId>-refusals.jsonl` — un fichier vide est une mesure, un
fichier absent est une supposition.

### Le domaine appartient à la tâche

`task` prend un `skills` optionnel. Les définitions d'agent ne déclarent aucun
domaine par défaut : un défaut juste une fois sur trois est pire que pas de
défaut, et il inviterait l'orchestrateur à omettre le paramètre. `mechanism` reste
dans la définition — `code-review` est lié au rôle, pas à la tâche.

### Les skills sont découpées, pas dédoublées

Un marqueur unique `## Review delta`, dernière section. Le worker reçoit
l'authoring, le reviewer l'authoring plus le delta, l'advisor rien.

> **Une règle, un fichier. Une sévérité par surface où la règle peut être
> enfreinte.** Une sévérité dupliquée entre deux surfaces n'est pas un défaut ;
> une sévérité **contradictoire** en est un.

La garde du marqueur vit dans `pi-check-config`, pas dans le découpeur : y échouer
est gratuit, alors qu'à l'exécution ça abandonnait une délégation entière pour une
skill sans delta légitime.

---

## 4. Ce que les mesures ont corrigé

### Le corpus de 196 sessions ne mesurait rien

Entre 100 et 120 de ces sessions étaient du debug de configuration. Toutes les
fréquences qu'on en tirait — scout 3 fois, oracle 11 fois — décrivaient ce qui
avait été tapé en phase de test.

### La décomposition n'est pas additive

`2 023 − 959 = 1 064` tokens pour sept outils built-in, contre 679 annoncés.

> Un nombre obtenu par soustraction est un ordre de grandeur, pas une valeur.
> Seules les mesures directes se citent.

### Un coût nul supposé doit être vérifié

`ANTHROPIC_API_KEY` exportée globalement faisait basculer Claude Code en mode API,
abonnement ignoré.

> Le coût se lit sur la console du fournisseur, jamais sur l'`usage` rapporté par
> l'agent. Une délégation mesurée est sortie **4× au-dessus**.

### « Flash » est un nom de famille, pas une gamme de prix

Tarifs par modèle, plus par provider. **Et pas seulement le prix : le modèle de
cache.** DeepSeek écrit son préfixe gratuitement et le relit à ~1/60 de l'entrée ;
appliquer les multiplicateurs Anthropic (1,25 et 0,1) surfacturerait un scout d'un
facteur plusieurs. Les entrées de `RATES` acceptent des multiplicateurs
facultatifs. Le tarif DeepSeek encodé est **celui de pointe** : sa fenêtre couvre
08:00-12:00 heure de Paris, et une table qui annonce moins que la facture est pire
qu'une table qui annonce plus.

### La lecture ne coûte pas ce que `cacheRead` annonce

Erreur de diagnostic commise et corrigée sur `ac451a` : la lecture du projet
semblait coûter 0,13 $ sur 1,55 $. Mais `cacheWrite` **est** le coût d'entrée du
contenu dans le contexte — un fichier lu est écrit une fois en cache, puis relu à
chaque tour. La lecture coûtait 0,72 $, soit 46 %. Et 234 249 de `cacheWrite`
moins 76 819 de sortie réinjectée ≈ 157 000 tokens ingérés sur sept revues, soit
**sept fois le projet par revue**.

### Un plafond de tours ne met rien de côté : il perd tout

L'enfant est tué sans `submit`, l'enveloppe est `null`. Mesuré : un scout à
112 683 tokens pour une ligne d'échec. Les trois prompts demandent désormais de
conclure avant le plafond, et `dispatch` retient le dernier message de l'enfant
pour l'ajouter au résumé d'échec — un prompt est une demande, pas une garantie.

### Un rôle mal employé coûte plus qu'un rôle non appelé

Le scout des 112k tokens répondait à une demande d'*« inventaire final de
complétude »*. C'est un jugement, et son prompt dit « Report locations, not
opinions ». Le rôle a fonctionné ; l'affectation était fausse. Corollaire mesuré
sur `f0797e` : une guideline trop large — « is anything complete » au lieu de « is
what was just written complete » — a envoyé un scout inventorier un dépôt ne
contenant que le bundle.

---

## 5. Décisions à ne pas rouvrir sans élément nouveau

| Décision | Raison |
|:--|:--|
| **`claude-bridge` retiré** | `src/index.ts:1249` passe le preset `claude_code` sans condition : ~26 000 tokens d'instructions d'un autre agent, dans un enfant dont le principe est de ne recevoir que ce qu'on lui passe |
| **Pas de `pi-anthropic-auth`** | Règle le problème à la racine mais utilise des jetons d'abonnement hors clients officiels. À 6 centimes la revue, l'API dispense de trancher |
| **Aucune session persistante** | Mesuré sur `3ed33e` : 24 relectures d'un contenu identique déjà en session, 79 % du coût worker en historique reporté. L'affinité de cache ne la justifie pas — `--session-id` est passé dans les deux régimes |
| **Le reviewer n'a ni `bash` ni `grep` ni `find`** | Il juge des fichiers, le scout les trouve, l'orchestrateur décide lesquels. `bash` serait un shell non gardé dans le rôle dont tout le contrat est de ne rien modifier — `reviewer.md` ne liste que `envelope`. oh-my-pi donne `bash` **et interdit explicitement** de s'en servir pour `git diff` |
| **Le reviewer n'édite pas** | Trois raisons : la sortie est le poste dominant ; `pi-check-config` interdit qu'une famille juge et exécute son propre travail, et un reviewer qui édite est un auteur ; le plancher de vérification (`pi-lint-gate`, `bash-guard`) est chez le worker, donc son code n'y passerait jamais |
| **Pas de parallélisation** | Les seuils d'oh-my-pi classent un projet sous 100 lignes ou ≤2 fichiers dans le bucket « 1 agent ». Le déclencheur n'est pas la taille du projet mais celle du diff : quand une revue unique ne tient plus en six tours **après** avoir reçu le diff |
| **On ne retire pas `maxTurns` du worker** | `pi-subagents` l'interdit, sur une architecture où le worker peut escalader en cours de route. Ici, le plafond est compensé par la consigne de conclure et la récupération du dernier message ; le retirer rendrait le mode d'échec à 112k tokens sans filet |
| **Les deux skills d'architecture ne fusionnent pas** | Le fichier GCP implémente, il ne réénonce jamais |
| **Échelle ponytail coupée en deux** | Barreau 1 chez l'orchestrateur ; barreaux 2-6 dans `python-engineering`. Un worker à qui on donne ce barreau refuse du périmètre |
| **`bin/check-envelope` supprimé** | La validation se fait avant l'écriture, par pi, sur les arguments d'outil |

---

## 6. Ce qui est planifié, et sa condition d'entrée

### Reviewer sur Qwen 3.8 Max, advisor sur Sonnet 5

**Le principe, repris d'oh-my-pi** : le meilleur modèle va où l'erreur coûte le
plus cher, pas où il tourne le plus souvent. Le reviewer applique un barème écrit
— la table de sévérité de la skill de domaine —, ce qui borne l'espace de son
jugement. L'advisor tranche des forks irréversibles **sans barème**. Les deux ne
demandent pas la même chose au modèle.

**L'économie visée.** Qwen 3.8 Max : 2 $ / 6 $ le million, contexte 1M, sorti le
3 août 2026, 6ᵉ sur 218 chez BenchLM avec le rang 1 en raisonnement. Contre Sonnet
5 à 2 $ / 10 $ : même prix en entrée, **40 % moins cher en sortie** — et la sortie
est le poste dominant du reviewer, mesuré à 0,77 $ sur ~1,55 $ pendant `ac451a`.

**Séquence arrêtée, avec sa porte de sortie à chaque étape.** Chaque étape existe
pour ne pas confondre deux causes, et chacune peut arrêter la suivante :

1. **`csv-to-bq` avec la configuration courante**, comparé à `f0797e` — 10
   délégations, 47 tours, 802 051 tokens, revues à 2/2/5/2. Trois changements y
   arrivent ensemble : le diff, les six critères d'admission, la clause
   cross-boundary. Les deux derniers doivent faire *baisser* le nombre de
   findings ; le premier doit faire baisser les tours. **Porte** : si le livrable
   cesse d'être conforme, on s'arrête là.
2. **Le pipeline Spark, sur pi et sur Claude Code**, mêmes bundles. Ce n'est plus
   une mesure de coût, c'est une mesure de niveau : est-ce que cette chaîne tient
   sur 2 978 lignes en onze modules. **Porte** : si pi n'est pas à la hauteur de
   Claude Code sur le même bundle, le problème n'est pas le modèle du reviewer et
   changer de juge ne le réglera pas.
3. **Qwen 3.8 Max sur les cinq fichiers d'`anime-etl` dont les verdicts sont
   connus.** Seule mesure de la séquence qui compare un jugement à une référence
   plutôt qu'à une autre exécution. Réserve à lever : à ce jour, seules des
   comparaisons publiées par le constructeur. **Porte** : un verdict qui diverge
   d'une référence connue arrête tout.
4. **Qwen sur le reviewer et `advisor` sur Sonnet 5, ensemble.** Les deux
   changements sont posés dans le même commit parce qu'ils sont un seul
   arbitrage : le meilleur modèle va où l'erreur coûte le plus cher.
5. **Le run Spark rejoué**, comparé au Spark de l'étape 2.

**Ce que l'étape 4 rend ambigu, et comment le lever.** Ajouter un rôle n'est pas
neutre même s'il n'est jamais appelé : `advisor.md` entre dans l'énumération du
paramètre `agent` et dans `agentMenu`, donc l'orchestrateur a une option de plus à
chaque routage. Deux vérifications suffisent à séparer les deux causes sur le run
de l'étape 5 :

```bash
ls .pi-subagent-runs/*advisor*.json 2>/dev/null | wc -l   # 0 → la comparaison est propre
```

et le contexte de départ de l'orchestrateur, qui doit monter du coût du nouveau
menu et de rien d'autre. Si un advisor a bien tourné, la comparaison porte sur
deux changements et il faut le dire plutôt que l'attribuer au reviewer.

**Ce qu'il faut vérifier avant l'étape 3**, et qui n'est pas acquis : que pi expose
un provider Qwen, et quel est son modèle de cache. L'entrée `RATES` naïve a déjà
coûté une correction sur DeepSeek — `cacheWrite` gratuit contre 1,25× l'entrée.

**Ce qui invaliderait le plan** : une baisse du nombre de findings à
`confidence: certain` aux étapes 3 ou 5. La sortie moins chère ne rachète pas un
portail de qualité plus faible.

### L'advisor — ce qui existe déjà et ce qui manquera le jour J

L'infrastructure est prête : créer `subagent-only/agents/advisor.md` suffit à le
faire apparaître dans l'énumération du paramètre `agent`, `loadAgents` lisant le
répertoire et `agentMenu` construisant le menu depuis les descriptions. Aucun
changement de code. `envelope.ts` porte déjà `payloads.advisor` — `concerns[]
{level, what, why}` plus `recommendation` — et `slicer.ts` a
`MODE_BY_ROLE.advisor = "none"`.

Trois choses devront changer le même jour, sinon le menu proposera un rôle que la
documentation interdit :

- `AGENTS.md` — la ligne « designed but not written. Do not invoke it » devient une
  ligne dans la table de décision ;
- `AGENTS.md` — « There is no advisor role today: a fork with a high cost of being
  wrong goes straight to the operator » ;
- `dispatch.ts` / `deriveNext()` — un rôle sans `verdict` renvoie `done`. Un avis
  d'advisor n'est jamais `done` : sa sortie est une entrée de décision, donc
  `orchestrator`. Une branche à ajouter **à ce moment-là**, pas maintenant : une
  branche pour un rôle inexistant est l'abstraction « au cas où » qu'`AGENTS.md`
  interdit.

Le littéral `"advisor"` a déjà quitté l'union `Next` : il proposait une
destination non lançable. Quand l'advisor existera, la destination sera calculée,
pas choisie.

### Emprunts encore ouverts aux implémentations de référence

Lus intégralement : `pi-subagents@0.39.0` (`agents/` + `prompts/`) et
`can1357/oh-my-pi`. Ce qui reste à emprunter, par ordre d'utilité :

| Quoi | D'où | Condition |
|:--|:--|:--|
| **Plafond de rounds de revue** | `review-loop.md` — trois par défaut | Une alternance worker/reviewer qui ne converge pas. `f0797e` en a fait quatre et s'est arrêté seul |
| **Canal `needs_decision`** | `contact_supervisor` | Un worker bloqué par une décision non approuvée. Aucun run ne l'a rencontré |
| **`spawns: scout` au reviewer** | oh-my-pi | Contrepoids possible au retrait de `grep`. À n'envisager que si le diff ne suffit pas sur Spark — il déplacerait le contrôle de boucle hors du parent |

Déjà repris : la définition du round (« only when it made material changes »,
devenue le critère de changement matériel de la garde), les six critères
d'admission, la clause `<cross-boundary>`, le dosage `quick/medium/thorough` du
scout, l'obligation d'une seconde stratégie de recherche, les quatre conditions
d'arrêt et la synthèse écrite par l'orchestrateur.

Non repris volontairement : l'écriture d'un `context.md` par le scout — un canal
de plus, non validé, contraire au principe du contrat de sortie unique.

---

## 7. Manques identifiés, non urgents

**Backfill / reprocessing** et **évolution de schéma** — deux opérations
irréversibles, exactement le déclencheur d'advisor, et aucune skill ne les décrit.
À écrire quand l'advisor entre en service : chaque skill coûte ~145 tokens de
description dans chaque session.

**Pas de chemin de retour.** Les skills encodent ce qu'on savait avant, les prompts
déclenchent une tâche, rien n'encode ce que le système a appris. Huit revues
produites sur `anime-etl` n'ont jamais été relues. Le registre de findings — suivre
un finding de sa levée à sa clôture — reste non écrit, parce que sa forme dépend
d'une décision non prise : est-ce que l'orchestrateur *doit* clore un finding avant
de passer au livrable suivant, ou est-ce qu'un registre consultable suffit ? La
première réponse est un mécanisme contraignant, la seconde un fichier.

**Rien ne relie une revue à la tâche qu'elle juge.** L'artefact ne porte pas de
`parentArtifact`, ni la liste des skills injectées — seulement `injectedTokens`.
Deux champs, et le registre de findings devient possible.

**Lectures, pas installations** : `mishanefedov/skill-issue`,
`anthony-chaudhary/dos-kernel`, `vaquarkhan/data-engineering-agent-skills`.

---

## 8. Dette

**`evidence/2026-08-03_submit-validation.jsonl`** reste dans l'historique Git avec
cinq occurrences d'`anime_password`. Purge = réécriture d'historique, à froid. La
clé API concernée a été révoquée.

**Le contexte de l'orchestrateur n'est pas auto-portant.** Ses tours, son contexte
et sa ligne de routage n'existent que si `--session-dir` a été passé. Les refus de
la garde sont désormais journalisés, mais le reste appartient à la session — c'est
un défaut par défaut dans le lanceur de test, pas un changement de code.
