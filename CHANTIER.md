# Chantier — état au 6 octobre 2026

*Registre de la configuration pi. Ce qui est fait quitte « à faire », ce qui a été
tranché ne garde que sa raison, ce qu'une mesure a réfuté le dit.*

Branche `feat/subagent-extension`. `SUIVI.md` tient le journal et la liste de ce qui reste ;
ce fichier tient l'architecture, les invariants et les décisions, avec leurs raisons.

---

## 1. Où on en est

Trois étapes, chacune justifiée par la précédente.

**Août — la primitive de délégation**, écrite puis exécutée de bout en bout sur `csv-to-bq`
(360 lignes, 5 livrables, aucun accès GCP) : neuf runs, reproductibilité établie à 2 % sur les
tours. **Fin août — l'échelle**, sur Spark-C (2 978 lignes en onze modules) : dix runs,
le dernier sans aucun échec. **Septembre — le chantier `3c`** : un audit externe de l'objet
`f9791bd`, 91 preuves écrites avant toute correction, neuf lots et deux correctifs qui rendent
la parallélisation des writers possible sous preuves. Aucune régression d'audit ne reste
ouverte.

**État courant :** `555b202f` (arbre `8b821da4`, patch-id `7af97b68`), **lot efficacité,
établi, gelé et poussé le 06-10** sur `1e07ae13` — quatre leviers d'efficacité et leur
mesure, après un diagnostic adjugé et cinq livraisons. **QD-EFF-a conforme** : unité
intégrée sans reprise, plan accepté au premier essai, 1 961 534 tokens avant coupure
(158,6 % de la cible 1 236 742), dont 77 % pour le worker ; **adjugé conforme**.
**QD-EFF-b conforme** (1 286 817 tokens) ; **moyenne 1 624 176, 131,3 % de la cible : cible
non atteinte**, chaque rôle restant en moyenne sous 110 % de sa baseline. **Jugement final
le 06-10 : P1 non atteint, lot non réussi** ; **lot clos le 06-10** (D-bis r2 conforme). *Ensuite :* portage du suivi, puis couche d'adaptation et montée de pi par paliers,
QD de référence, puis phases 0, 3 et 2, trois items par lot par défaut ; davantage seulement
sur plan adjugé, avec un objectif commun, une qualification bornée et un retour arrière défini. Cible inchangée, atteignabilité non établie. Avant lui : `1e07ae13`,
objet final de **LOT-REPRISES-CORRECTIF, qualifié et clos le 01-10** — périmètre
d'écriture du plan gelé avant toute délégation (R1), pas de revue `approved` avec un
risque ouvert (R2), cycles de reprise mesurés (R3), revue bloquante tenue d'inspecter les
consommateurs conservés (RC) ; efficacité non qualifiée, moyenne 1 994 464. Puis
`cc88bb20` (LOT-REPRISES), `383a5f36` (lot ITE, phase P1 — **lot ITE clos le 30-09**, P0
qualifié, cible P1 non qualifiée, moyenne 4 220 484), `85c5519` (lot ITE, P0 — unité
intégrée terminale, plan terminal irrévocable, garde de mutation de l'orchestrateur,
`bin/run-cost`), `a562579` (lot post-pilote) et `83eb62a` (`PORTES-GEL` v4). **Le pilote
— premier run Spark-C à `maxParallel=2` — est fait, clos et qualifié** : onze unités
intégrées le 27-09, puis le critère `design_update` établi le 29-09. Ce qui suit est rangé par phases dans `SUIVI.md`.

Le chantier n'est plus dans la phase où l'on conçoit contre des hypothèses : il
est dans celle où chaque changement se justifie par un run antérieur, **ou par une preuve
rouge pour sa raison** avant d'être corrigée.

### Les trois premiers runs (août)

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

**5 agents** dans `subagent-only/agents/` :

| Rôle | Modèle | Session | Outils | `maxTurns` |
|:--|:--|:--|:--|--:|
| `worker` | `openai-codex/gpt-5.6-terra` (abonnement), `thinking: high`, repli sur `sol` | éphémère | read, grep, find, ls, bash, edit, write, submit | **30** |
| `integration-worker` | `openai-codex/gpt-5.6-terra`, `thinking: high`, repli sur `sol` — résout un conflit de merge entre une lane approuvée et la base d'intégration, n'implémente rien | éphémère | read, grep, find, ls, bash, edit, write, submit | 30 |
| `reviewer` | `anthropic/claude-sonnet-5` (API) | éphémère | **read, ls, submit** | **12** |
| `scout` | `deepseek/deepseek-flash` (depuis `83eb62a`), `thinking: low` | éphémère | read, grep, find, ls, submit — **sans `bash` depuis le 26 août** | 12 |
| `advisor` | `xai/grok-4.6`, `thinking: xhigh` — **en service depuis le 24 août** | éphémère | read, grep, find, ls, submit | 8 |

*Les nombres de cette table et le seuil d'inline du diff ont tous été
calibrés sur `csv-to-bq` — 360 lignes — et ont tous dû être relevés pour un
projet huit fois plus gros. Ce sont les seules valeurs de la configuration qui
portent une taille de projet.*

Trois familles de modèles, vérifiées par `pi-check-config`. **Aucun rôle n'est en
session persistante** : le régime a été coupé après `3ed33e`, et `spawn-args`
passe `--session-id` dans les deux cas — l'affinité de cache du fournisseur ne
dépend pas de la persistance d'historique.

**10 extensions locales** : `bash-guard`, `compaction-guard`, `pi-bq-cost-sentinel`, `pi-check-config`,
`pi-lint-gate`, `pi-project-brief`, `pi-secret-gate`, `pi-session-journal`, `subagent`,
`subagent-footer`. Deux paquets externes, **non épinglés** : `@tmustier/pi-raw-paste` (npm) et
`monotykamary/pi-deepseek-provider` (git). pi épinglé à **0.86.0** pour le pilote.

---

## 2. Ce qui reste

*La liste vit dans `SUIVI.md`, rangée par phases. Ici ne restent que les attentes de mesure
qui gouvernent une décision d'architecture.*

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
*Cas courant, vérifié le 27-09 :* le LOT 9 a réécrit `templates/pi/DESIGN.md` pour la
grammaire de `design_update` (`94eae75`) ; la copie installée sur Claude.ai, restée à l'ancien modèle, est à
remplacer —
`SUIVI.md`, *Hors phase*.

### En attente d'une mesure précise

| Quoi | Ce qui le débloque |
|:--|:--|
| **Le coût de contexte du worker** — mesure A | `09-worker` de `f0797e` : 205 699 tokens pour 3 858 de sortie, 26,8k de contexte moyen par tour contre 12k sur les deux workers précédents. Trois causes possibles — texte de tâche gonflé par les findings de la revue, sorties de `pi-lint-gate` qui restent en contexte, relectures dans la délégation — et **trois correctifs incompatibles**. *La commande d'analyse, que ce registre disait être dans `ANALYSE-f0797e`, n'a jamais été versionnée et est introuvable* ; elle est à réécrire sous `bin/`, et la mesure à faire sur le run 10 `a1c83f`. C'est la phase 0 de `SUIVI.md`. Ne rien toucher au contexte avant |
| **Plafond de rounds de revue** | `f0797e` a fait quatre alternances worker/reviewer et s'est arrêté proprement. La défaillance que le plafond corrige n'a pas eu lieu ; l'ajouter maintenant serait du mécanisme sur une intuition |
| **Canal `needs_decision` pour le worker** | `pi-subagents` a `contact_supervisor`, bloquant, qui laisse le worker vivant pendant qu'il attend. Non transposable en `-p` ; l'équivalent atteignable est un champ d'enveloppe. Aucun run ne l'a encore rencontré |
| **Fiabilité du parallélisme sur un vrai projet** | Le pilote. Tout le reste — plafonds, admission, registres, reprise — est prouvé en L0 et dans les lots ; aucune suite ne dit qu'une exécution parallèle tient sur une tâche de production entière |

### ~~Le test Spark~~ — fait

Le « pipeline Spark de 2 978 lignes en onze modules » est Spark-C : dix runs, du premier
à 11,0 M tokens et huit plafonds au dixième sans aucun échec. Voir `SUIVI.md`. Le critère posé
ici tient toujours, et vaut pour le pilote : **la conformité du livrable décide, pas le coût.**
Un run moins cher qui livre un schéma inventé est une régression, pas une économie.

---

## 3. L'architecture, et pourquoi

### Trois invariants, dans l'ordre où ils s'appliquent

*Posés les 13 et 26 septembre. Ils gouvernent tout ce qui s'ajoute à cette configuration ;
chaque item de `SUIVI.md` les passe avant d'être écrit.*

**1. La configuration fonctionne à l'identique avec et sans le bundle Strategic Forge.**
Forge donne les grandes lignes, aide à préciser le projet et à le baliser ; il n'entre pas
dans le détail, et **il n'est la source unique d'aucune règle**. `INSTRUCTIONS.md`,
`ARCHITECTURE.md`, `DESIGN.md` et `CONVENTIONS.md` sont des artefacts de bundle : toute règle
qui n'existe que là disparaît en régime libre. Le plancher vit donc dans `~/.pi/agent/` —
`AGENTS.md` et les skills — et le bundle ne fait que **spécialiser ou déroger**. Précédent
mesuré : le bundle Spark-C a ajouté quatre dérogations à `CONVENTIONS.md` après six
défauts ; une dérogation suppose une règle antérieure.

*Et un enfant n'hérite de rien :* le worker ne voit jamais `AGENTS.md`.

```text
AGENTS.md            orchestrateur seulement — jamais injecté à un enfant
skills (authoring)   atteint le worker
skills (Review delta) atteint le reviewer
bundle               spécialise, déroge, borne — n'institue jamais
```

*Test :* retirer le bundle par la pensée. Si une règle disparaît, elle est au mauvais
endroit. Le bundle peut déplacer **quand** une question est répondue, jamais **si** elle est
posée.

**2. Ce qui est permanent est du code ; la prose ne porte que ce qui appelle un jugement.**
Critère : réussit ou échoue sans qu'un modèle ait son mot à dire. Une règle en prose, mesuré
ici, **est suivie une fois sur trois**.

```text
code        invariant et mécaniquement décidable → extension, garde, hook, runtime
prose armé  demande du jugement, infraction détectable → prose + déclencheur
prose       jugement irréductible → skill, moitié authoring ou Review delta
```

*Garde-fou :* ne jamais brancher une garde sur un champ que le modèle remplit lui-même. Un
contrôle de code se dérive du diff ou de l'arbre, pas d'une déclaration d'enveloppe.

**3. Ce qui est voulu s'active tout seul.** Pas d'option à cocher, pas de commande à se
rappeler pour le cas nominal ; une commande n'existe que pour **forcer** ou **consulter**.
C'est le deuxième invariant appliqué aux fonctionnalités : une option qu'il faut penser à
activer est une règle en prose. *Deux exceptions, à écrire comme telles :* un choix de
l'opérateur n'est pas un comportement (passer en sous-agents, lancer une campagne, pousser) ;
un mode qui multiplie le coût peut rester sur demande (`best-of-n`).

```text
où           hors bundle                          1er invariant
forme        code si permanent                    2e invariant
déclencheur  le runtime, jamais l'opérateur       3e invariant
             pour le cas nominal
```

### La parallélisation : des lanes isolées, un registre qui fait autorité

*Posée par le chantier `3c`, lots 1 à 9 et deux correctifs, du 11 au 26 septembre. Chaque
propriété ci-dessous est tenue par une preuve L0 et un mutant permanent.*

**Une lane par unité de travail.** Un writer travaille dans un worktree et une branche
propres à sa lane ; une lane porte une génération, et une unité n'a jamais deux lanes
ouvertes. Une seule admission sert le chemin simple et le lot. Le merge qui échoue sur un
conflit va à l'`integration-worker`, qui résout et n'implémente rien.

**Le registre durable fait autorité, pas la mémoire ni la réponse d'un appel.** Chaque run
tient sous `.pi-subagent-runs/` un registre de lanes et un registre d'intégrations en JSONL,
et un manifeste qui témoigne de leur existence. Tout ce qui décide — revue, violation,
risque, gel, merge — s'écrit d'abord dans le registre, puis se lit par la projection
autoritaire. Un risque se clé par `(run, unité, id)`, indépendamment de la génération.

**Inconnu n'est pas vide.** Avant toute consommation, la lecture établit un état C4 :
`KNOWN`, `EMPTY`, `UNKNOWN`, `LOST`, `MIGRATION_REQUIRED`, `RUN_WITHOUT_WITNESS`. Seuls les
deux premiers sont exploitables ; tout le reste refuse, **avant tout effet externe** — ni
séquence réservée, ni worktree, ni enfant, ni événement.

**La propriété du run est un bail.** Deux verrous, l'espace puis le run, toujours dans cet
ordre ; un vestige de transition se nomme au lieu de bloquer en silence. Perdre le bail
révoque toute la capacité en mémoire — une révocation n'est pas une libération.

**Une seule façon de finir.** Le setter général ne termine plus un run ; la fin est une
transition unique, publiée par lien puis retrait, reprise sans être réécrite. `completed`
est refusé tant que sept contrôles ne passent pas.

**Une seule chaîne d'intégration**, commune au merge ordinaire, à l'atterrissage et à la
reprise : `REVIEWED` sur l'arbre réellement montré → `FROZEN`, dont le commit est le seul
candidat au merge, revérifié juste avant → intégration git prouvée structurellement →
`MERGED` → phase Statut, où le runtime seul applique le `design_update` du plan gelé →
`INTEGRATED` final → nettoyage. La section critique couvre toute la transition ; les trois
fenêtres de crash se reprennent. Un échec du commit de Statut laisse `MERGED` et restaure
l'effet produit, rien de plus large.

### Un enfant n'hérite de rien

Chaque délégation lance un processus `pi` neuf : ni AGENTS.md, ni historique, ni
appels d'outils antérieurs, ni `APPEND_SYSTEM.md`.

**Une exception a existé, elle est retirée.** `.pi/BRIEF.md` était injecté en
`--append-system-prompt` au worker. L'audit du brief l'a retiré : `projectBrief` vaut `false`
par défaut, les deux rôles qui écrivent le déclarent explicitement, aucun enfant ne reçoit le
brief, et **l'orchestrateur en est le seul lecteur**. *La raison qui justifiait l'injection, conservée :* sans le brief, un worker à qui
AGENTS.md interdit de supposer une arborescence obéit en dépensant des tours à la découvrir,
et un tour coûte une relecture complète de contexte. Le scout trouve la structure en
cherchant ; le reviewer juge contre un barème, et les spécificités de projet appartiennent au
texte de tâche.

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

*Depuis le LOT 6 (23 septembre), sous lanes :* le reviewer reçoit le delta git **entier**
depuis la dernière revue durable de la lane, et `REVIEWED` enregistre l'arbre réellement
montré — une écriture faite pendant la revue n'est plus comptée comme couverte.

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

**Et la frontière, resserrée après le run `48acec`.** Le principe disait « ce qui
doit tenir inconditionnellement vit dans le code ». Une garde a été ajoutée puis
retirée un run plus tard parce qu'elle encodait comme invariant mécanique une
relation qui n'en est pas une : `severity(finding)` et `verdict(diff)` ne sont
pas la même variable. Un ensemble de LOW peut légitimement conduire à
`needs_rework` ; un MEDIUM certain peut être une remarque locale compatible avec
`approved`. La formulation juste est plus étroite :

> **Ce qui doit tenir indépendamment du jugement du rôle vit dans le code. Ce qui
> demande une appréciation d'ensemble reste au rôle.**

Bons candidats mécaniques : un reviewer ne juge pas son propre code, un scout
exige `find` + `scope`, pas de troisième revue identique, une enveloppe respecte
son schéma, un writer mort laisse son delta de fichiers. Le verdict, lui, est le
produit pour lequel on paie Sonnet.

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

### Ce que le chantier `3c` a appris — onze lots, cinq règles

*Chacune a coûté au moins une livraison refusée. Le détail source reste dans la Partie 1
de `SUIVI-en-attente.md`, boîte d'attente privée hors dépôt, désignée par [A] dans
`SUIVI.md`. Aucune archive correspondante n'est versionnée dans ce portage.*

**Un contrôle correct, placé après ce qu'il doit couvrir, ne couvre rien.** Le `catch` plus
bas que l'acquisition de propriété, la garde d'abandon après la branche terminale (LOT 1) ;
le pont qui retombe en mémoire sur un registre illisible (LOT 7) ; l'ancien gel lu dans le
registre brut, le second commit possible après `FROZEN` (LOT 8) ; la garde C4 posée après les
effets externes de délégation, un registre qui échappe à la garde (correctif C4). **Dix
occurrences en dix lots.** Le dernier plan en a fait une classe de falsification : remettre
le contrôle au mauvais endroit doit faire rougir une preuve.

> **Inconnu n'est pas vide.** Une absence, un état illisible, une version inconnue se
> refusent ; ils ne se traitent jamais comme le cas nominal.

**Une preuve doit être rouge pour SA raison.** Précondition impossible, refus obtenu pour
une cause étrangère, témoin absent, observation qui lève avant l'assertion : quinze
révisions de L0, toutes sur ce point. Et le symétrique : une preuve peut **verdir** pour une
raison étrangère quand une autre correction lui retire son chemin — la matrice preuves ×
corrections le voit, la suite non. Une falsification qui retire une entrée au lieu de la
garde mord par une autre porte et masque un câblage non couvert.

**Un instrument échoue en imprimant un résultat crédible.** La porte S4 a rendu trois fois
un vert creux ; une extraction a lu 27 preuves sur `PROPRIÉTÉ` là où il y en avait 45 ;
`|| true` change un échec en texte conforme. Une porte se juge sur son code de sortie **et**
sa sortie, et une contre-épreuve doit échouer pour la raison visée. *Et il dépend de la
machine qui le lance :* un tri sans locale fixée a donné deux empreintes pour les mêmes
diagnostics, VM et Mac (06-10). Toute liste comparée ou empreinte se calcule sous
`LC_ALL=C`, et une simulation se rejoue aussi en locale UTF-8.

**Seuls l'arbre et les compteurs installés font foi.** Un arbre soumis a différé de l'arbre
installé ; un relevé post-commit a été pris avant les commits. Le relevé se fait après, dans
un fichier, et se vérifie avant d'être envoyé.

**Un instrument qui vit hors du dépôt se perd.** La porte S4, la baseline `tsc --strict`, la
commande d'analyse de `f0797e` : trois fois. Ce qui prouve se versionne et se teste comme ce
qui est prouvé.

---

## 5. Décisions à ne pas rouvrir sans élément nouveau

| Décision | Raison |
|:--|:--|
| **`claude-bridge` retiré** | `src/index.ts:1249` passe le preset `claude_code` sans condition : ~26 000 tokens d'instructions d'un autre agent, dans un enfant dont le principe est de ne recevoir que ce qu'on lui passe |
| **Pas de `pi-anthropic-auth`** | Règle le problème à la racine mais utilise des jetons d'abonnement hors clients officiels. À 6 centimes la revue, l'API dispense de trancher |
| **Aucune session persistante** | Mesuré sur `3ed33e` : 24 relectures d'un contenu identique déjà en session, 79 % du coût worker en historique reporté. L'affinité de cache ne la justifie pas — `--session-id` est passé dans les deux régimes |
| **Le reviewer n'a ni `bash` ni `grep` ni `find`** | Il juge des fichiers, le scout les trouve, l'orchestrateur décide lesquels. `bash` serait un shell non gardé dans le rôle dont tout le contrat est de ne rien modifier — `reviewer.md` ne liste que `envelope`. oh-my-pi donne `bash` **et interdit explicitement** de s'en servir pour `git diff` |
| **Le reviewer n'édite pas** | Trois raisons : la sortie est le poste dominant ; `pi-check-config` interdit qu'une famille juge et exécute son propre travail, et un reviewer qui édite est un auteur ; le plancher de vérification (`pi-lint-gate`, `bash-guard`) est chez le worker, donc son code n'y passerait jamais |
| **Parallélisation des writers : rouverte, faite sous preuves** | *Raison d'origine :* les seuils d'oh-my-pi classent un projet sous 100 lignes ou ≤ 2 fichiers dans le bucket « 1 agent » ; le déclencheur n'est pas la taille du projet mais celle du diff. Écartée encore le 24 août sur le run 8 — quatre délégations disjointes, 10 % du temps mur, quatre mécanismes à réécrire. Rouverte en septembre sur un autre élément que la taille : l'isolation par lane et des registres durables, qui rendent la reprise et l'intégration prouvables. Faite en neuf lots et deux correctifs (§ 3). *Ce qui ne se rouvre pas :* le gain est le mur d'horloge, pas le coût — la parallélisation ne retire pas un token ; et le premier run parallèle réel reste à faire |
| **On ne retire pas `maxTurns` du worker** | `pi-subagents` l'interdit, sur une architecture où le worker peut escalader en cours de route. Ici, le plafond est compensé par la consigne de conclure et la récupération du dernier message ; le retirer rendrait le mode d'échec à 112k tokens sans filet |
| **Les deux skills d'architecture ne fusionnent pas** | Le fichier GCP implémente, il ne réénonce jamais |
| **Échelle ponytail coupée en deux** | Barreau 1 chez l'orchestrateur ; barreaux 2-6 dans `python-engineering`. Un worker à qui on donne ce barreau refuse du périmètre. **Revirement tranché le 13-09**, élément nouveau : bibliothèques pratiques plutôt que natives (`loguru`, `pendulum`), liste nommée + principe + confirmation, dans `python-engineering` seul pour que worker et reviewer jugent contre le même texte. Renverse le barreau 1 « bibliothèque standard d'abord » ; **pas encore appliqué** |
| **`bin/check-envelope` supprimé** | La validation se fait avant l'écriture, par pi, sur les arguments d'outil |
| **Pas de binaire OMP** | On part de pi et on prend outil par outil ce qui sert : six choses sur trente et une. OMP réalise en Rust ce que nous faisons en TypeScript appelant git — de la vitesse, pas de la garantie, pour le prix de ce que nous avons de plus rare : aucune étape d'installation |
| **`codebase-memory-mcp` : des morceaux, pas une reproduction** | Plus gros que tout le chantier `3c`. Et un graphe dans un `.md` n'est pas un graphe : un fichier se lit en entier, exactement le coût que le graphe existe pour éviter |
| **`AGENTS.md` n'est pas tronqué** | `project_doc_max_bytes` est un réglage de Codex CLI, pas de pi, qui concatène sans plafond. ~9 000 tokens chargés à chaque session, conservés à part par la compaction : coût connu et stable |
| **Pas d'advisor à chaque tour** | Cinq conditions cumulatives, deux invocations depuis le 24 août, et un reviewer déjà dur. L'advisor intervient quand les autres ne trouvent pas réponse à une question complexe |
| **Ordre test/code : une seule règle** | *Le test précède le code dès que le comportement attendu est connu ; sinon l'étape qui précède est la lecture de la source de vérité.* Le test écrit après épouse le code (`3ed33e`, schéma à quatre colonnes, tout vert) ; le pire défaut mesuré (`orders.csv` jamais lu) n'était rattrapable par aucun des deux paradigmes. Vit dans la moitié authoring des skills, pas dans `AGENTS.md` |
| **Worker et scout restent dans le cloud** | Bascule locale évaluée le 24-09 et abandonnée sur la performance et sur le coût. Seule condition de réouverture : un besoin de confidentialité |
| **Le reviewer reste sur Sonnet** | Deux portes mesurées contre des références connues (§ 6). Un juge moins cher qui ne conteste jamais rend le dispositif inutile |

---

## 6. Ce qui est planifié, et sa condition d'entrée

### Reviewer et advisor — tranché par la mesure, contre le plan

**Le reviewer reste sur Sonnet 5, medium.** Deux portes franchies sur `anime-etl`, fichiers
aux défauts vérifiés à la main, même prompt et même plafond des deux côtés :

- **Gemini 3.7 Flash** retrouve `config.py` et `load.py`, rend `approved` avec zéro finding
  sur une double boucle quadratique réelle, et atteint son plafond de douze tours sans rendre
  d'enveloppe quand on le repasse en `high`. 71 % moins cher, et il ne voit pas.
- **DeepSeek V4 Pro** fait jeu égal fichier par fichier — quatre sur cinq chacun, zéro faux
  positif des deux côtés sur le témoin — puis s'effondre à l'échelle : **un finding sur onze
  revues** sur Spark-C, contre quatorze sur dix-sept pour Sonnet, même bundle.

**Qwen n'a jamais été atteint** : trois clés, trois régions, un 403 `AccessDenied.Unpurchased`
qui n'a pas bougé. Piste abandonnée, pas réfutée.

**L'advisor n'ira pas sur Sonnet.** Écrit, **en service depuis le 24 août**, sur `grok-4.6` — un
quatrième laboratoire, indépendant du worker et du reviewer, sur le seul rôle sans barème.
DeepSeek est écarté d'office : ne jamais contester est exactement le mode de défaillance qui
rend un arbitre inutile.

### Le plan initial, pour mémoire

*Clos : Qwen n'a jamais été atteint, le reviewer est resté sur Sonnet, l'advisor est en
service. Gardé pour la raison de chaque porte.*

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

*Fait le 24 août : l'advisor est en service, `AGENTS.md` le place sur la seule route
d'escalade du régime libre. Gardé pour la raison des trois changements.*

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
*Placé le 26-09 en phase 5 de `SUIVI.md`, avant le banc :* sans lui, un banc compte des
findings sans pouvoir en juger la justesse.

**Rien ne relie une revue à la tâche qu'elle juge.** L'artefact ne porte pas de
`parentArtifact`, ni la liste des skills injectées — seulement `injectedTokens`.
Deux champs, et le registre de findings devient possible.

**Lectures, pas installations** : `mishanefedov/skill-issue`,
`anthony-chaudhary/dos-kernel`, `vaquarkhan/data-engineering-agent-skills`.

---

**Risque de classification accepté.** Le régime est détecté par la présence des quatre
fichiers du bundle à la racine. C'est bien plus fort que les deux exigés auparavant — un
dépôt ordinaire portant `ARCHITECTURE.md` et `INSTRUCTIONS.md` n'est plus classé bundle —
mais quatre noms de fichiers restent une **heuristique de provenance** : rien n'empêche un
dépôt tiers de les porter tous les quatre sans qu'aucun vienne d'une session Forge validée.
La détection se dit structurelle et ne l'est pas tout à fait. Le seul correctif sans faux
positif serait un marqueur produit par Forge lui-même ; ne pas le choisir avant d'avoir
regardé ce que Forge peut émettre naturellement. En attendant, vérifier avant chaque
benchmark que le dépôt de test ne porte pas les quatre noms par hasard.

**Le reviewer reste sur Sonnet 5, et c'est mesuré.** Gemini 3.7 Flash coûte 71 % de moins et
retrouve deux défauts sur trois, dont celui de `load.py` que ni `flake8` ni `mypy` ne voient.
Il manque entièrement la double boucle de `transform.py` en `medium`, et en `high` il atteint
son plafond de douze tours sans rendre d'enveloppe. Un portail de qualité qui laisse passer un
défaut quadratique ne s'évalue pas au prix du tour.

Ce que la porte a aussi produit, et qui vaut au-delà du choix de modèle : le verdict de Sonnet
n'est pas stable sur une entrée identique — `blocked` puis `needs_rework` sur le même fichier
avec le même finding `HIGH certain`. La référence contre laquelle on mesure un juge est donc
elle-même bruitée, ce qui plaide pour comparer des **localisations trouvées** plutôt que des
verdicts.

## 8. Dette

**`evidence/2026-08-03_submit-validation.jsonl`** reste dans l'historique Git avec
cinq occurrences d'`anime_password`. Purge = réécriture d'historique, à froid. La
clé API concernée a été révoquée.

**Le contexte de l'orchestrateur n'est pas auto-portant.** Ses tours, son contexte
et sa ligne de routage n'existent que si `--session-dir` a été passé. Les refus de
la garde sont désormais journalisés, mais le reste appartient à la session — c'est
un défaut par défaut dans le lanceur de test, pas un changement de code.

**Des instruments de preuve vivent hors du dépôt** — la porte S4 v7 et la baseline
`tsc --strict` sont reconstruites depuis le répertoire d'audit local. Tant qu'ils n'y sont
pas, une preuve dépend d'un script joint et non d'un fichier relu. Suivi en phase 3 de
`SUIVI.md`.

**Le push n'est pas gardé en machine.** Le commit l'est — jeton à usage unique,
`pre-commit`, `reference-transaction`. Une adjudication « commit oui, push non » ne vit que
dans un message, et c'est ce qui a permis le seul écart de protocole du chantier `3c`.

---

## 9. Méthode — comment un changement entre dans le dépôt

*Née au LOT 2, tenue jusqu'au correctif C4. Les règles ci-dessous décrivent le protocole
historique complet. Pour les lots futurs, les orientations adjugées le 06-10 s'appliquent
selon le niveau déclaré dans leur plan et adjugé avec lui.*

**Niveaux A, B, C.** A couvre intégration, registres, lanes, gardes de sûreté, contrats C0,
adaptation pi et tout instrument dont le résultat autorise établissement, gel, push ou
conformité technique : protocole complet. B couvre le code et les instruments hors de ces
chemins, dans un périmètre déjà autorisé : plan court et livraison en une adjudication,
portes complètes, mutants des preuves nouvelles ou modifiées, sans simulation de chaîne
obligatoire. C couvre seulement la documentation passive et le portage du suivi : relecture
de Sol, puis commit documentaire autorisé, sans établissement ni QD ; contrats, consignes
actives et settings en sont exclus.

**Mutants à l'établissement.** Suite complète sur le candidat final. Aux commits
intermédiaires, sélection mécanique, versionnée et éprouvée par falsification : mutants
nouveaux ou modifiés, cibles et preuves touchées, dépendances déclarées. Une correspondance
inconnue impose la suite complète ; aucun mutant requis ne disparaît silencieusement.

**Revue adverse avant livraison.** Un relecteur indépendant de la construction joint ses
constats : entrées obligatoires absentes, illisibles, non objets, plurielles ou contradictoires
refusées ou indéterminées ; absences optionnelles explicitement prévues ; provenance complète ;
contrôle avant l'effet ; preuve rouge pour sa raison ; mutant retirant la garde visée ;
ordre canonique des listes (`LC_ALL=C` pour `sort` et `comm`), simulations aussi en locale
UTF-8 attestée ; contrats avec le SDK réel ; journaux conservés sans écrasement.

Ces orientations ne remplacent pas l'adjudication des plans et n'autorisent à elles seules
aucune modification, migration, qualification ou poussée.

**Cadrer, planifier, geler, puis écrire.** Un lot est cadré par questions, puis planifié ;
le plan est gelé par son empreinte avant la première ligne de code, avec son périmètre de
fichiers exact. Tout chemin hors périmètre, toute modification des contrats `C0` ou de
l'instrument revient à adjudication avant écriture.

**Preuves avant correctifs.** Une régression est d'abord écrite rouge sur une assertion de
propriété, puis corrigée, puis gardée par un mutant permanent qui doit la faire rougir.

**Livrer par étapes identifiées.** Au plus trois étapes et un seuil S4 par livraison ; par
étape, un patch, son `patch-id` et l'arbre attendu. L'installeur applique en
`git am --no-3way`, vérifie chaque arbre, refuse les fichiers non suivis, exige un code nul
pour chaque porte, et rend OK ou l'écart. Un refus partiel gèle les étapes validées.

**Deux machines, un résultat.** Les portes se jouent en bac à sable (Linux, Node 22), puis
chez Mo (macOS, Node 26) ; la version de Node est enregistrée, une divergence de propriété
arrête le lot.

**Trois rôles, séparés.** Claude construit dans son bac ; Sol adjuge le plan, la livraison,
l'installation et le push ; **Mo seul commite et pousse**, sur autorisation explicite.

**Une règle du bundle qui exige un geste de l'opérateur passe au protocole d'exploitation.**
Appris au pilote du 27-09 : « `/compact` à ~50 % ou après chaque livrable » était écrit dans
le bundle, mais `/compact` est une commande opérateur — l'orchestrateur ne pouvait pas
l'appliquer, et le contexte est monté à 211 k sans compaction. Règle adjugée pour toute
exécution de qualification : `/compact` par l'opérateur après chaque unité intégrée, visible
dans la chronologie, sans unité créée pour le provoquer. Une phrase dans le bundle ne suffit
plus ; le protocole prévoit un point de contrôle entre unités. *Et quand le geste est
permanent, il devient du code :* `compaction-guard`, gelé le 29-09, a pris le relais —
compaction automatique à 50 % de la fenêtre, reprise du run par l'extension quand la
compaction l'interrompt ; `/compact` manuel reste un recours, pas une cadence.

**La fin d'un run suit un ordre fixe** — report, cleanup en lecture seule, `cleanup
--apply` sous le bail, report de contrôle, `run completed` en dernier, vérification finale.
Au pilote, l'ordre inverse a laissé le run « actif » après onze unités intégrées : un trou
de protocole, pas un défaut du runtime.

**Une lecture ne laisse pas de trace.** Une lecture git menée à distance a laissé un
`.git/index.lock` vide dans un dépôt de qualification (29-09) : toute sonde git en lecture
se lance désormais avec `git --no-optional-locks`.

**Une porte prouve qu'elle a regardé.** Trois fois, un instrument a rendu vert sans rien
mesurer — S4 en septembre, puis la porte 17 du lot ITE deux fois, dont une sur zéro fichier
compilé à cause d'un `sed` BSD. La leçon, à appliquer à toute nouvelle porte : rapporter ce
qu'elle a examiné (fichiers compilés, entrées lues) et traiter un compte nul comme un échec.
