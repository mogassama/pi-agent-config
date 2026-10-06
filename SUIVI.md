# Suivi — configuration pi

*Journal des runs et liste des tâches. Une ligne par run : ce qu'il a mesuré, ce qu'il a
corrigé. Une case par tâche restante : sa condition d'entrée et son chiffre de contrôle.*

Branche `feat/subagent-extension`. État courant : `c42f2d4` (correctif pré-pilote C4, arbre
`3a7de843`), puis `83eb62a` (`PORTES-GEL` v4, arbre `82a9b1b8`), **gelé par Sol et poussé le 27-09**, puis `a562579`
(LOT-PP, arbre `c43749c0`), **gelé et poussé le 29-09**, puis `85c5519` (lot ITE, ITE-1c, arbre
`78491822`), **gelé et poussé le 29-09**, puis `383a5f3` (lot ITE, P1, arbre `6b362b18`),
**gelé et poussé le 30-09**, puis `cc88bb20` (LOT-REPRISES, non poussé seul), puis `1e07ae13`
(LOT-REPRISES-CORRECTIF, arbre `6c03bd41`), **gelé et poussé le 01-10**, puis `555b202f` (lot
efficacité, arbre `8b821da4`), **gelé et poussé le 06-10**.
`CHANTIER.md` fait foi sur les décisions et leurs raisons ; ce fichier sur ce qui a été fait
et ce qui reste. Les références **[A]** désignent les sections de
`SUIVI-en-attente.md`, boîte d'attente privée tenue par Mo hors du dépôt.
Ce sont des renvois de provenance externe ; aucune archive correspondante
n'est versionnée dans ce portage.
*Spark-C* est le nom de code d'un projet client : un pipeline Spark de 2 978 lignes en
onze modules.

---

## Configuration au 30 septembre 2026 — gel `383a5f3`

| Rôle | Modèle | Thinking | Session | Tours | Outils |
|:--|:--|:--|:--|--:|:--|
| worker | `openai-codex/gpt-5.6-terra` ⁴ | `high` | éphémère | **30** ¹ | read, grep, find, ls, bash, edit, write |
| integration-worker | `openai-codex/gpt-5.6-terra` | `high` | éphémère | 30 | read, grep, find, ls, bash, edit, write |
| reviewer | `anthropic/claude-sonnet-5` | medium | éphémère | **12** ² | read, ls |
| scout | `deepseek/deepseek-flash` ⁶ | low ³ | éphémère | 12 | read, grep, find, ls ⁷ |
| advisor | `xai/grok-4.6` | `xhigh` ⁵ | éphémère | 8 | read, grep, find, ls |

¹ Monté de 20 à 30 après le run `b9baad`, où quatre workers sur quatorze ont soumis au tour
exact du plafond en étant encore en train d'éditer. Consigne : conclure quatre tours avant.
² Plafond plat à 12 depuis le run 5, où trois revues sont mortes à 8 en tenant leur diff.
L'échelle s'était inversée : le chemin dégradé donnait 12 tours et le chemin inline 8, donc
relever `DIFF_MAX_CHARS` avait fait sortir les plus gros changements du 12 pour les mettre
dans le 8. Douze partout ne peut plus s'inverser. Le chemin dégradé garde `grep` et `find`.
⁴ Bascule depuis `gpt-5.6-sol` le 24 août, à mesurer. Référence à battre, run 7 : dix-sept
délégations worker, médiane 10 tours, 47 tests ajoutés. Sol reste en repli.
⁵ **En service depuis le 24 août**, invoqué deux fois, toutes deux en régime libre et sur une
frontière durable. `xhigh` et non `max` — la table de pi mappe `max` sur `null`, donc champ
omis, donc défaut du modèle. Cinq conditions cumulatives, régime libre seulement : sur un
projet à bundle il ne se déclenche pas, et c'est le résultat attendu.

³ **Correction du 22 août.** `minimal|low|medium → null` ne veut pas dire « pas de
raisonnement » mais « champ omis », donc le modèle retombe sur son défaut — et
`deepseek-v4-flash` est hybride. Les douze scouts du run `b9baad` ont émis entre 323 et
2 409 tokens de raisonnement, 1,3 % de leur budget. Les trois niveaux bas sont un seul et
même réglage ; seuls `high` et `max` déplacent quelque chose.
*Datée, pas réécrite (26-09) :* cette mesure porte sur V4-Flash. DeepSeek a retiré ce modèle
le 10 septembre ; `deepseek-v4-flash` est depuis redirigé vers V4.1-Flash, et le champ `model`
des artefacts enregistre le nom demandé, pas le modèle servi. Elle ne se transfère pas.
⁶ **Bascule du scout vers `deepseek/deepseek-flash`** — qualifiée par `PORTES-GEL` v3, Q1,
portée par le plan v4 et **gelée dans `83eb62a` le 27-09** : pi accepte le nom comme modèle
canonique, § 12.9 non déclenché. La clé de `RATES` est renommée dans le même commit, tarifs
inchangés, donc le footer compte le scout. *Faite sans l'épinglage de `pi-deepseek-provider`*,
qui devait la précéder : voir *Phase 1*.
⁷ **Le scout n'a plus `bash` depuis le 26 août** (`4d4954d`, trois contournements fermés après
l'audit externe). La table du 29 août le lui donnait encore : elle était fausse.

**Dix extensions locales** : `bash-guard`, `compaction-guard` (depuis `a562579`),
`pi-bq-cost-sentinel`, `pi-check-config`, `pi-lint-gate`, `pi-project-brief`, `pi-secret-gate`, `pi-session-journal`, `subagent`,
`subagent-footer`. Deux paquets externes, **non épinglés** : `@tmustier/pi-raw-paste` (npm) et
`monotykamary/pi-deepseek-provider` (git). Version de pi épinglée pour le pilote : **0.86.0**.

Portes de la suite, à `555b202f` (06-10) : `bin/test-guards` **993 + 211 cas**, tous verts,
ombre Python 65 · `l0-check` 187 preuves, 0 régression ouverte, 149 corrigées · `l0-mutants`
252 déclarés, 160 obligatoires, 177 éprouvés · `lanes-concurrency` 4/4 · TypeScript 127 → 127.
*À `383a5f3` :* 972 + 192, ombre Python 65, `l0-check` 147, `l0-mutants` 176 / 120 / 137,
`lanes-concurrency` 4/4, TypeScript 127 → 127 sur 111 fichiers. *À `85c5519` :* 959 + 184, `l0-check` 126, `l0-mutants` 140 / 99 / 116. *À `a562579` :* 959 + 165, ombre Python 65, `l0-check` 107,
`l0-mutants` 110 / 83 / 100, `lanes-concurrency` 4/4, S4 127 → 127 et 33 → 33.
Quatre modules feuilles sans import pi — `fanout.ts`, `attempts.ts`, `tree.ts`, plus les
fonctions pures de `run-state.ts` — existent pour que les tests appellent la production au
lieu de la recopier. Chacun a été extrait après qu'un défaut est passé sous une suite verte
qui décrivait sa propre copie.

*Lecture des compteurs, partout dans ce fichier :*

```text
test-guards   suite 1 total/verts/échecs/todo · suite 2 idem · ombre Python
l0-check      preuves déclarées/REG ouvertes/REG corrigées/COUV/PRES/anomalies
l0-mutants    déclarés/obligatoires/éprouvés/anomalies
S4            diagnostics stricts avant → après, canal principal / extensionless
```

*Configuration au 29 août 2026, pour mémoire :* huit extensions (sans `pi-session-journal`),
suite à 156 cas, pas d'`integration-worker`, scout sur `deepseek/deepseek-v4-flash`.

---

## Références stables — les chiffres à comparer

| Projet | Run | Délég. | Tours | Coût | Échecs |
|:--|:--|--:|--:|--:|--:|
| `csv-to-bq` (360 l.) | `37acf6` | 12 | 56 | 0,60 $ | 0 |
| `csv-to-bq` | `f414d3` | 13 | 57 | 0,68 $ | 0 |
| **dispersion mesurée** | | **8 %** | **2 %** | **13 %** | |
| Spark-C (2 978 l.) | run 2 `6fcfbb` | 53 | 369 | ~3 $ | 3 |
| Spark-C | run 3 `b9baad` | 39 | 296 | ~3 $ | 0 |
| Spark-C | run 4 `2cab6c` | 40 | 303 | ~3,5 $ | 0 |
| Spark-C | run 5 | 34 | 274 | ~4,4 $ | 3 |
| Spark-C | run 6 `48acec` | 40 | 317 | 3,59 $ | 1 |
| Spark-C | run 7, dernier Sol | 42 | — | 4,37 $ | 0 |
| Spark-C | run 9, premier Terra | 14 | 124 | — | 0 |
| Spark-C | **run 10 `a1c83f`** | **40** | **330** | **3,64 $** | **0** |
| `transactions-etl` | régime libre | 14 | — | 1,19 $ | 0 |
| Spark-C — Claude Code | — | — | — | — | 1 h 12, 165 tests |

**Aucune conclusion ne tient sous ces écarts.** Un gain de 13 % sur `csv-to-bq` est du bruit.

---

## Ce qui est fait

### `csv-to-bq` — neuf runs

- [x] **run 1** — 13 délégations, 0,73 $. Point de départ.
- [x] **`3ed33e`** — 15 délégations, 4,17 M tokens. *Trois défauts majeurs :* le fichier de
      données jamais nommé dans une tâche → schéma à quatre colonnes contre un fichier à cinq,
      sept revues aveugles ; le `verdict` n'atteignait pas l'orchestrateur — quatre
      `needs_rework` rendus en `[reviewer: ok]` ; session worker persistante, 24 relectures d'un
      contenu identique, 79 % du coût worker en historique reporté.
      → **Corrigé** : `session: ephemeral`, verdict et compteurs dans l'en-tête, `next` dérivé,
      `out_of_scope` optionnel, scan des fichiers de données non nommés.
- [x] **`ac451a`** — 17 délégations, 98 tours, 1,55 $. *Quatre revues consécutives puis trois
      inventaires identiques ; un scout tué à 112 683 tokens sans enveloppe.*
      → **Corrigé** : garde de boucle mécanique, convergence avant plafond dans les trois
      prompts, récupération du dernier message, condition d'arrêt dans `AGENTS.md`, les trois
      règles qui excluaient le scout retirées, `RATES` avec multiplicateurs de cache.
- [x] **`f0797e`** — 10 délégations, 47 tours, 0,55 $, zéro échec. *Le reviewer recevait des
      chemins, donc aucune définition de « le changement ».*
      → **Corrigé** : diff construit depuis `changed_files`, six critères d'admission, clause
      `cross-boundary`, refus journalisés, `bash-guard` sur le scout.
- [x] **`ac684d`** — 11 délégations, 0,86 $, 1 échec. *A tourné sans le lot précédent.* Un
      reviewer tué à 6 tours faute de diff.
      → **Corrigé** : consigne de groupage des lectures, série de la garde bornée au même rôle.
- [x] **`8c88c5`** — 9 délégations, 0,40 $, zéro échec. *Le raisonnement était compté deux fois
      dans le coût ; les prompts affirmaient qu'un bundle absent l'était.*
      → **Corrigé** : `reasoning` retiré du calcul, les trois prompts disent le périmètre au
      lieu de nier un fait vérifiable.
- [x] **`adee82`** — 4 délégations, 0,21 $. *L'orchestrateur a écrit sept modules lui-même ; un
      `needs_rework` jamais revalidé, parce que la garde bloquait mécaniquement la seconde revue.*
      → **Corrigé** : écritures inline enregistrées dans `HISTORY`, invariant « le code d'un
      livrable est délégué » dans `AGENTS.md`.
- [x] **`37acf6`** — 12 délégations, 0,60 $. Architecture rétablie, zéro écriture inline.
      → **Corrigé** : diff construit depuis tout ce qui a changé depuis la dernière revue.
- [x] **`f414d3`** — 13 délégations, 0,68 $. **Reproductibilité établie** : 2 % d'écart sur les
      tours contre 56 % entre deux configurations proches auparavant.

### Spark-C — dix runs, puis le pilote

- [x] **run 1 `4a7d2d`** — 45 délégations, 11,0 M tokens. *Huit plafonds, 25 % des tokens
      perdus, dont un worker à 946 918 tokens sans enveloppe.*
      → **Corrigé** : arbre relevé avant/après un rôle mutateur, fichiers générés hors du diff,
      outils et plafond suivant le paquet d'entrée, budget de tours dans le prompt du scout.
- [x] **run 2 `6fcfbb`** — 53 délégations, 3 plafonds, 8 % de tokens perdus, 1 h 19.
      *Le scout a doublé en nombre — cause trouvée : une guideline lui demandant de découper.
      Un reviewer tué à 6 tours **avec** son diff.*
      → **Corrigé** : plafond du reviewer indexé sur la taille du diff, contrat d'entrée du
      scout (`find` + `scope`, refus mécanique).
- [x] **run 3 `b9baad`** — 39 délégations, 296 tours, **zéro `max_turns`**, zéro perte,
      159 tests contre 156, scout divisé par 3,3 en tokens et par 2 en délégations.
      *Premier run avec worker en `thinking: high`.* Trois constats des mesures :
      quatre workers sur quatorze ont soumis au tour 20 sur 20 **en étant encore en train
      d'éditer** ; les tours du reviewer ne suivent pas la taille du diff ; un scout a terminé
      normalement sur un tour de raisonnement pur, sans enveloppe — classe d'échec que
      ni `max_turns`, ni `timeout`, ni `provider_error` ne couvre.
      → **Corrigé** : worker à 30 tours avec consigne de conclure quatre tours avant, plafond
      reviewer plat à 8 et conditionnel de taille retiré, retry unique sur `no_submit` pour un
      rôle en lecture seule.
      *Non corrigé, délibérément :* le contrat `find`. Dix des douze en portent plus d'une
      question et neuf ont réussi — vérifier l'unicité rejetterait neuf délégations qui
      marchent pour attraper un échec qui avait une autre cause.
- [x] **run 4 `2cab6c`** — 40 délégations, 303 tours, **zéro échec de toute nature** : ni
      `max_turns`, ni `no_submit`, ni `timeout`. Première fois en quatre runs. 158 tests,
      zéro régression.
      *Les quatre relevés :* le worker s'étale — `[6,7,8,8,8,10,10,11,12,14,15,16,18,27]`,
      un seul au-dessus de 20, aucun sur 26 ni 30 : **le plafond de 20 bridait bien**, et 30
      ne mord plus. Son exploration est à **88 % en première moitié** de délégation, ce qui
      écarte définitivement l'hypothèse de la redécouverte et donc la réécriture du bundle.
      Le retry n'a pas eu à tirer. Le reviewer tient son plafond plat, **sauf deux revues
      dégradées** à 7 et 11 tours.
      → **Corrigé** : seuil d'inline du diff porté de 32 000 à 80 000 caractères.
      *Ce que la mesure a établi :* quatre revues dégradées sur deux runs — 7, 5, 7, 11 tours
      contre une médiane de 4 — et un ordre monotone avec la taille, 38 kO → 7 tours,
      71 kO → 11. Le reviewer tourne à 48 328 tokens par tour, donc la revue à 11 tours a
      coûté ~531 000 tokens là où son diff en pesait 17 750. Lire douze fichiers entiers pour
      reconstruire 71 kO de changements coûte nécessairement plus que les 71 kO.
      *80 000 et non 64 000 :* 64 000 ne convertit qu'un des deux cas observés.

- [x] **run 5** — 34 délégations, **3 revues mortes à 8 tours en tenant leur diff**. Cause :
      deux corrections qui se composent — le conditionnel de taille retiré, puis
      `DIFF_MAX_CHARS` relevé, ce qui a fait passer les plus gros changements du chemin
      dégradé à 12 tours au chemin inline à 8. Échelle inversée.
      → **Corrigé** : plafond reviewer plat à 12.
- [x] **run 6 `48acec`** — 40 délégations, 160 tests, meilleur livrable des six. Deux revues
      à 10 et 11 tours **concluent** là où le run 5 en tuait trois. Coût reviewer 4,37 → 3,59 $,
      entièrement par les trois revues mortes qui ne se refont plus. Un `no_submit` worker à
      cinq tours sans rien écrire, rattrapé par l'orchestrateur lui-même.
      → **Corrigé** : retry pour un writer dont l'arbre est prouvé inchangé.
      → **Retiré** : la règle A, un run après sa pose. Elle déclassait un `needs_rework` sur
      des LOW seuls ; le même run a montré une revue rendant `approved` avec un MEDIUM certain
      qui ne justifiait pas de renvoyer le livrable. Une sévérité note un finding, un verdict
      note le diff.
- [x] **Douze contradictions relevées par `gpt-5.6-sol`**, lu en tant que destinataire
      d'`AGENTS.md` : précédence, régime libre, ligne unique d'un livrable, seuil des
      50 lignes, deux listes de critères, signature de l'outil, brief, escalade du worker,
      `reviewer → scout → reviewer` bloqué par la garde, bootstrap du scout, double échéance.
      Puis cinq de plus à la relecture : « backlog deliverable » inexistant en régime libre,
      `/compact` sans `INSTRUCTIONS.md`, détection du bundle sur deux fichiers au lieu de
      quatre, substance du `project AGENTS.md` qui ne traverse pas la frontière enfant.

- [x] **Porte reviewer — Sonnet 5 contre Gemini 3.7 Flash**, sur quatre fichiers d'`anime-etl`
      aux défauts vérifiés. Première mesure de la série qui compare un jugement à une
      **référence** et non à une autre exécution.
      *Résultat : Sonnet garde le rôle.* Gemini retrouve les défauts de `config.py` et
      `load.py` — dont le HIGH que ni `flake8` ni `mypy` ne voient — mais rend **`approved`
      avec zéro finding sur `transform.py`**, où le recalcul de `normalize_title` dans une
      double boucle est réel et confirmé. Rejoué en `thinking: high` sur ce seul fichier :
      **plafond de 12 tours atteint, aucune enveloppe, 213 159 tokens**. Il ne voit pas en
      `medium` et ne conclut pas en `high`.
      *Coût, pour mémoire :* 0,118 $ contre 0,409 $ sur les quatre revues, −71 %. L'économie
      est réelle et ne compense pas un défaut quadratique laissé passer.
      *Deux acquis annexes :* Gemini ne met rien en cache sur les revues courtes — 97 757
      tokens d'entrée plein tarif contre 187 508 relus à 10 % chez Sonnet, donc l'économie
      vient du tarif d'entrée seul et se dégradera sur des revues plus longues. Et Sonnet a
      rendu `blocked` puis `needs_rework` sur `config.py` avec le même finding `HIGH certain`
      à deux runs d'intervalle — le verdict n'est pas stable sur une entrée identique.
      *Une correction à la référence :* `extract.py`, tenu pour corrigé, porte encore un
      défaut réel que Sonnet a trouvé — l'ordre des décorateurs place `retry` sous `limits`,
      donc les reprises tenacity contournent le rate-limiter. Il n'y avait donc aucun fichier
      témoin, et les faux positifs n'ont pas pu être mesurés.

- [x] **run 7** — 42 délégations, 17 workers, 17 reviewers, 8 scouts, 156 tests, zéro échec.
      Reviewer Sonnet : **14 findings sur 17 revues**, dont un HIGH bloquant. C'est la
      baseline de qualité du reviewer.
- [x] **run 8** — même bundle, reviewer basculé sur DeepSeek V4 Pro. 162 tests au vert, le
      meilleur livrable des huit — et **1 finding sur 11 revues**, dix `approved` à zéro
      finding. Deux `provider_error` sur quota ChatGPT, hors configuration.
      *Décision : Sonnet garde le rôle.* Le mode de défaillance n'est pas l'erreur, c'est de
      ne jamais contester — et tout le dispositif repose sur un tiers qui voit ce que
      l'auteur ne voit pas. 2,6 fois plus lent par revue en prime : `34-reviewer`, quatre
      tours, 37 560 tokens de sortie dont 35 922 de raisonnement, dix minutes pour un MEDIUM.
- [x] **Temps mur mesuré pour la première fois**, reconstruit par différence entre lancements :
      worker 47 %, reviewer 41 %, scout 12 %. Le scout, qui a coûté trois lots de réglage,
      pèse un huitième. → `durationMs` entre dans l'artefact ; la reconstruction supposait la
      séquentialité et aurait cessé d'être valide au moment où elle servirait.
- [x] **Parallélisation écartée pour les writers, faite pour les scouts.** Sur le run 8,
      quatre délégations seulement étaient disjointes en écriture — un README, un script, des
      fixtures, `pyproject.toml`, aucun code source — soit 18 minutes en série contre 6,3 en
      parallèle : 10 % du temps mur contre quatre mécanismes à réécrire et la perte de
      l'historique linéaire. Les scouts, eux, n'écrivent rien : `find` accepte désormais un
      tableau, jusqu'à quatre en parallèle, sans qu'aucun invariant d'état ne bouge.
      *Condition de réouverture pour les writers :* un projet dont les livrables sont
      réellement indépendants. Spark-C n'en est pas un.
      *Rouverte en septembre, sur un autre élément que la taille :* l'isolation par lane et
      des registres durables — voir « Chantier de parallélisation » plus bas.

- [x] **run 9 `1d6f3e`** — premier run worker sur Terra. 14 délégations, 124 tours, zéro échec,
      médiane worker 11, plafond de 30 jamais approché. Reviewer Sonnet : 14 findings sur 17
      revues au run 7 contre 4 `needs_rework` ici.
      *27-09 — numéro contesté, non tranché :* la pièce `RESULTATS-run9-terra.md` décrit
      `1c5d47` (44 délégations), un run du même jour sur Terra, absent de ce journal. Sol acte
      le conflit sans le trancher ; la ligne reste telle quelle d'ici là.
      *27-09, sol/11 :* recherche historique close — numéro de `1c5d47` **non établi**, non
      bloquant. La ligne garde `1d6f3e`.
      [A] Partie 1, *Le pilote*, entrée du 27-09.
- [x] **run 10 `a1c83f`** — 40 délégations, 330 tours, **81,3 min d'exécution sur 96 de run**,
      zéro échec de toute nature, 161 tests au vert contre 117 au départ.
      *Terra confirmé sur un second point :* médiane worker 10 — celle de Sol —, `needs_rework`
      à 3 contre 8 chez Sol, distribution `[5,5,6,6,7,8,10,14,16,18,20,23,25]`.
      *Le reviewer a relu l'orchestrateur.* Sept lignes `Statut` de `DESIGN.md` basculées en
      `Implemented` dans un diff qui n'ajoutait qu'un export log4j2 : le finding est juste, et
      c'est la première fois que le mécanisme du lot `adee82` — écritures inline enregistrées
      dans `HISTORY`, donc versées au diff de la revue suivante — produit un résultat.
      *Second finding du même calibre :* un test comparant un `tmp_path` non résolu à ce que
      `pwd -P` renvoie, donc vert sous Linux et rouge sur un Mac où `/var/folders` est un lien.
      *Et le temps d'orchestrateur mesuré pour la première fois :* 15 min sur 79 tours, 16 %
      du run. Un seul message opérateur sur les 96 minutes.
- [x] **pilote `0ffdeedc` (27-09)** — premier run à `maxParallel=2`, sur `83eb62a` et le
      baseline `b3861a8d`. **Onze unités sur onze intégrées par le runtime**, dépôt final propre
      (`bb2cf0ea`, 22 commits) ; `~/.pi/agent` inchangé, Q3 et Q4 conformes après le run.
      *Interrompu par le quota ChatGPT après W10*, repris dans la même session et le même run
      après compaction. **Qualification globale suspendue :** aucune transition `design_update`,
      le plan gelé n'en déclarant aucune. Sous-agents 10,2 M tokens, orchestrateur 14,5 M, aucune
      compaction avant la reprise (pic 211 k) — trou de protocole opérateur, pas écart de
      l'orchestrateur ; cause unique du surcoût d'orchestrateur non établie. *Comparaison au run 10 : par worker seulement, et à
      bundle reconstitué.* [A] Partie 1, *Le pilote*, sol/15 et sol/16.

### Portes de modèle

- [x] **Reviewer, deux portes sur `anime-etl`**, fichiers aux défauts vérifiés à la main.
      **Gemini 3.7 Flash** retrouve deux défauts sur trois, rend `approved` avec zéro finding
      sur une double boucle quadratique réelle, et atteint son plafond sans rendre d'enveloppe
      en `high`. **DeepSeek V4 Pro** fait jeu égal fichier par fichier — quatre sur cinq
      chacun, zéro faux positif sur le témoin — puis s'effondre à l'échelle : **un finding sur
      onze revues** sur Spark-C contre quatorze sur dix-sept pour Sonnet.
      → **Sonnet garde le rôle.** Qwen n'a jamais été atteint : trois clés, trois régions, un
      403 `AccessDenied.Unpurchased` qui n'a pas bougé.
- [x] **Advisor écrit, puis mis en service.** `grok-4.6` en `xhigh`, quatrième famille,
      indépendant du worker et du reviewer. Règle d'invocation à cinq conditions cumulatives
      dans `Execution regimes`, régime libre seulement. Le double `needs_rework` est
      explicitement **écarté** comme déclencheur : rien dans une enveloppe reviewer ne
      distingue un second défaut d'un correctif manqué ou d'un vrai désaccord.

### Régime libre — la moitié jamais exercée

- [x] **Benchmark `transactions-etl`** — un prompt, aucun bundle, six pièges, contre Claude
      Code. **Le résultat du chantier :** les deux systèmes ont écrit le même `MERGE` dont la
      borne `event_date` ne s'applique qu'à la cible, donc une correction hors fenêtre
      s'insère en doublon. Le reviewer de pi l'a trouvé, `HIGH probable`, un worker l'a
      corrigé, la revue suivante a approuvé. **Claude Code l'a livré.** C'est l'événement que
      le protocole définissait comme décisif, et ce n'était aucun des six pièges plantés — un
      défaut que les deux ont *créé* en résolvant le vrai problème.
      *Portes :* composition et décision gagnées par pi, conformité ratée à moitié des deux
      côtés, réalité, sémantique et ciblage à égalité.
      *Advisor invoqué pour la première fois*, 0,087 $, avec un critère que ni l'orchestrateur
      ni Claude Code n'avaient formulé — et il a nommé comme condition bloquante ce que Claude
      Code a listé comme « ouvert, hors périmètre ».
- [x] **Bibliothèque de récurrence, deux runs**, dossier vide, lecture en aveugle contre
      Claude Code. Claude Code produit une occurrence que son propre `is_occurrence` refuse —
      générateur et vérificateur en désaccord le seul jour de l'année où la question se pose —
      et livre un README vide alors que le prompt demandait les décisions.
      *Ce que la revue en aveugle n'a pas pu voir :* presque tout ce qui distinguait le
      livrable de pi était **spécifié par l'advisor avant la première ligne**. Un livrable
      coupé de la conversation qui l'a produit ne se juge pas — quatre lectures d'un même fait
      dans cette revue, trois fausses.
      *Second run après réécriture de l'échelle des dépendances :* le renoncement est
      désormais écrit dans le livrable, une seule politique pour tous les cas impossibles, et
      le reviewer rattrape un champ `time` masquant sa classe importée.

### Audit externe

- [x] **Trois blockers et quatre concerns**, relevés hors de cette configuration et vérifiés
      un par un dans le dépôt avant correction.
      `extensions/pi-secret-gate/` était **déclaré partout et absent de la branche** — un
      `.gitignore` global excluant `*secret*` le rendait invisible, donc aucune délégation
      worker ne pouvait démarrer sur un clone frais. Le salvage manquait la transition
      *dirty → clean* : un fichier remis à `HEAD` par un worker quittait `git status`, donc
      « rien n'a changé » — la condition même qui autorise un retry, sur un arbre où le worker
      venait d'effacer une modification de l'opérateur. `git status --porcelain` sans `-z`
      mentait sur les chemins accentués et les renommages. Et la promesse « workarounds fail »
      du token de commit dépassait ce que `bash-guard` garantit, son propre README le disant.
      → union `before ∪ after`, format `-z`, promesse réduite, et `tests/dispatch.test.ts`.
      *En écrivant ces tests :* une suppression depuis un arbre propre restait invisible, les
      deux côtés valant la chaîne vide. Le test a trouvé le trou dans la correction.
- [x] **Deux contournements de `pi-secret-gate`**, le lendemain de sa mise en service.
      Le câblage lisait `new_str` là où pi envoie `{ edits: [{ oldText, newText }] }` : **tout
      `edit` passait sans être inspecté**. Et le test de placeholder portait sur la ligne, donc
      un `# example` ou un `// TODO` en fin de ligne désarmait la garde pour la clé qui
      précédait. → le câblage parcourt l'entrée au lieu de nommer des champs, le placeholder
      porte sur la valeur, et neuf tests exercent des formes d'appel réelles.

### Bundle Spark-C

- [x] **Quatre dérogations ajoutées à `CONVENTIONS.md`** après six défauts relevés à la main :
      `PYSPARK_PYTHON` et `PYSPARK_DRIVER_PYTHON` avant tout `pytest`, `setuptools` déclaré
      pour l'absence de `distutils` en 3.12, les chemins Spark en URI `file:///`, et
      l'extension à tout fichier d'une règle qui ne visait que `docs/` — toute invocation
      écrite hors du code est recopiée depuis la source qui la définit.
      *Mesuré au run 10 :* `PYSPARK_PYTHON` est cité dans les treize tâches worker, aucune
      invocation inventée n'est réapparue. Et la commande fautive du mémo — `$(which python3)`
      au lieu de l'interpréteur du venv — a produit 47 échecs contre 117 succès sur le même
      dépôt, ce qui est la meilleure démonstration de la dérogation qu'elle décrit.

### Hors run

- [x] Audit du dispositif `.pi/BRIEF.md` — le brief survivait aux remises à zéro et décrivait
      le résultat des runs précédents ; la péremption ne pouvait pas se déclencher ; le digest
      était aveugle aux fichiers non suivis. → un seul lecteur (l'orchestrateur), empreinte
      d'arbre, données non suivies dans le digest, code mort `pi-subagents` retiré.
- [x] `pi-diff-review` supprimé.
- [x] `CHANTIER.md` réécrit, `README.md` aligné, docs de mesure datées.

### Chantier de parallélisation (`3c`) — un audit, neuf lots, deux correctifs

*Du 8 au 26 septembre. Une entrée par lot, écrite après sa clôture : ce qu'il a posé, son
commit et son arbre, ses compteurs, et ce qu'il a appris. Le détail de chaque étape, de chaque
refus et de chaque falsification est dans **[A]**, Partie 1, sous le même titre.*

*Méthode commune à tous les lots.* Chaque lot est cadré puis planifié ; le plan est gelé par
son empreinte avant la première écriture. Chaque livraison porte, par étape, un patch, son
`patch-id` et l'arbre attendu ; un installeur les vérifie et rend OK ou l'écart. Rien n'est
installé, commité ou poussé sans l'adjudication de Sol, et seul Mo commite et pousse. Les
portes se jouent en bac à sable sous Node 22, puis chez Mo sous Node 26 ; **seuls l'arbre et
les compteurs installés font foi**.

- [x] **Audit de l'objet `f9791bd`** (gelé le 2026-09-08). Relecture externe en plusieurs
      passes, contrats canonisés dans `C0-CONTRATS.md` (v1.2 au départ, **v2.0** à la fin).
      *Cinq bloqueurs* conditionnaient le pilote — `C-P1-F01` à `F03`, `A-P1-F01` et `F03` ;
      les lots 1 à 9 les adressent tous, chacun avec ses preuves et ses mutants.
      *Premier dégât constaté :* un script de vérification a effacé douze artefacts réels de
      `.pi-subagent-runs/`, ignoré par git — voir *Phase 3*.

- [x] **L0 — preuves avant correctifs** (2026-09-11 → 13). Cinq vagues : A1 `7593d47`,
      A2 `66ec507`, B1 `d3a8ff0`, B2 `db2df52`, B3 `2d1a7f4`, puis une 91ᵉ preuve `0e3a6d0`
      (le setter général terminait un run). **Aucune ligne de production touchée.**
      91 preuves : 65 régressions ouvertes, rouges sur une assertion `PROPRIÉTÉ` et gardées
      en `todo` jusqu'au lot qui les corrige ; 8 couvertures ; 18 préservations ; 13 mutants.
      Portes : `bin/test-guards`, `tests/tools/l0-check`, `l0-mutants`, S4 (127 diagnostics).
      *La règle acquise :* **une preuve doit être rouge pour SA raison.** Les cinq vagues ont
      coûté quinze révisions, toutes sur ce point et jamais sur le fond.

- [x] **Instrument S4 — trois tours, puis gel avant le LOT 9** (2026-09-13, 2026-09-24).
      La porte de compilation stricte rendait un résultat crédible et creux : liste dérivée
      d'un motif réservé à L0, binaire du périmètre (`bin/subagent-recover`) compilé par
      personne, second canal sans porte de programme. Trois tours de correction, douze
      falsifications. La v7 (`f14ba568…`) est la première gelée **avant** le lot au lieu
      d'être corrigée après. *Leçon :* une falsification peut être creuse — le premier
      montage passait au vert parce que le module visé restait atteignable par une autre
      branche du graphe d'imports. *Toujours pas versionné* — voir *Phase 3*.

- [x] **LOT 1 — identité et propriété durable du run** (2026-09-13 → 16). Clôture
      `a7a8f75`. Neuf étapes, neuf commits : `f302d92` et `32e13fd` (manifestes v1/v2),
      `10a9dcd`, `ace2ec6`, `39de92c`, `79eca87`, `b242028`, `ebb8141`, `8ad5bbd`, `a7a8f75`.
      *Posé :* l'exclusion de l'espace de runs (`RUN_TRANSITION_LOCKED`, vestiges nommés),
      l'ordre N puis R, une seule transition terminale publiée par lien puis retrait, un
      setter général qui ne termine plus un run, les verbes `run completed` et `run abandoned
      --reason`, la révocation de toute la capacité avant de signaler la perte du bail.
      ```text
      suite 833 / 145 / 65 · 0 échec · l0-check 91/57/8/8/18/0 · mutants 23/16/23/0
      S4 127 → 127 · 33 → 33
      ```
      *Reporté au LOT 2 :* cinq régressions, le mutant de `B3-jamais-deux-merges`, et
      `run-end.ts`. *Leçon :* un mutant qui ne mord pas ne prouve pas que la preuve est hors
      d'atteinte ; il prouve d'abord qu'on n'a pas trouvé le bon angle.

- [x] **LOT 2 — lecteurs v2 autoritaires et `completed`** (2026-09-16 → 18). Clôture
      `b086835`, arbre `c645b431`. Pré-étape 0 `e4c2357`, étapes 1 à 8 : `6676167`,
      `3b621a1`, `c8825bb`, `c09243e`, `113ce77`, `5e9b79f`, `d030c2f`, `b086835` ; étape 9
      de mesure seule.
      *Posé :* la grammaire v2 du registre des lanes, les **états C4** — `KNOWN`, `EMPTY`,
      `UNKNOWN`, `LOST`, `MIGRATION_REQUIRED`, `RUN_WITHOUT_WITNESS` — établis avant toute
      consommation, les témoins du manifeste, la lecture legacy en génération 1, les
      projections communes, la politique `completed` (`run-end.ts`, sept contrôles), le
      mutant composite de `B3-jamais-deux-merges` (20/20).
      ```text
      suite 905/898/0/7 · 145/107/0/38 · ombre 65 · l0-check 94/45/23/8/18/0
      mutants 44/31/39/0 · S4 127 → 127 · 33 → 33
      ```
      *Né ici :* la livraison multi-étapes adjugée (au plus trois étapes, un patch et un
      arbre par étape, installeur `git am --no-3way`), et Node dans les conditions de mesure.
      *Leçons :* un instrument échoue en imprimant un résultat crédible — l'extraction lisait
      « 27 sur PROPRIÉTÉ » là où il y en avait 45 ; une porte se juge sur son code de sortie
      **et** sa sortie, `|| true` change un échec en texte conforme.

- [x] **LOT 3 — observations git et allocation des lanes** (2026-09-18 → 19). Clôture
      `6fe99ff`, arbre `b45ad4de`. Six étapes : `1dc1066`, `14ae147`, `b5d708e`, `6d0388e`,
      `275fd59`, `6fe99ff`.
      *Posé :* des observations git qui disent ce qu'elles savent, les chemins lus en
      enregistrements NUL, la provenance d'une lane par sa branche, l'identité portant la
      génération, l'écrivain v2 et la file par unité, l'allocation dans une seule section
      critique sous R, l'observation de la seule génération courante.
      ```text
      suite 923/921/0/2 · 158/123/0/35 · ombre 65 · l0-check 94/37/31/8/18/0
      mutants 56/39/50/0 · S4 127 → 127 · 33 → 33
      ```
      *Leçon :* le contre-exemple de `C-P1-F05b` était vert pour une raison étrangère
      (« nothing has changed on disk ») ; refait avec une branche avancée hors du run.

- [x] **LOT 4 — admission et vue de lane (C1.5, C1.7)** (2026-09-19 → 20). Clôture `5d250de`,
      arbre `6179e932`. Étapes `b5d907c` (une seule admission pour le chemin simple et le
      lot) et `5d250de` (la garde de revue lit la vue de la lane).
      ```text
      suite 923/921/0/2 · 160/129/0/31 · ombre 65 · l0-check 96/33/35/9/19/0
      mutants 62/44/56/0 · S4 127 → 127 · 33 → 33 · pi 0.86.0 relevé
      ```
      *Leçon :* une preuve peut verdir pour une raison étrangère quand une **autre**
      correction lui retire son chemin ; la matrice preuves × corrections le voit, pas la
      suite.

- [x] **LOT 5 — gardes de secret et de rôle** (2026-09-20). Clôture `cb539cb`, arbre
      `2383b8f5`. `35ffe25` : `pi-secret-gate` lit le schéma `edit` de pi et refuse ce qu'il
      ne sait pas lire. `cb539cb` : la garde de rôle juge le bundle gelé sur la destination
      réelle — identité `(dev, ino)`, `cwd` obligatoire, `cd` dynamique fail-closed.
      Qualification de pi **0.86.0**.
      ```text
      suite 923/923/0/0 · 160/130/0/30 · ombre 65 · l0-check 96/30/38/9/19/0
      mutants 67/47/61/0 · S4 127 → 127 · 33 → 33 (23 fichiers)
      ```
      *Leçon :* l'arbre installé (`2383b8f5`) diffère de l'arbre soumis (`9a965a19`) ; seuls
      l'arbre et les compteurs installés font foi.

- [x] **Pré-étape d'instrument — courses de `l0-mutants` sur témoin EEXIST** (2026-09-22).
      `e237183`, un seul fichier. Le calibrage des délais est refusé : chaque attente se
      termine sur un témoin, le délai redevient un échec de garde. **27 min → 9 min 23 s**
      (Linux, Node 22) et 7 min 49 s (macOS, Node 26).

- [x] **LOT 6 — `REVIEWED` et violations durables** (2026-09-22 → 23). Clôture `c38c764`,
      arbre `65f87953`. `0ed4385` : `REVIEWED` durable, le reviewer reçoit le delta git
      entier depuis la dernière revue durable. `c38c764` : `VIOLATION` durable, nature
      `bundle-violation` créée et exposée dans `policy_blockers` (C3.7).
      ```text
      suite 923/923/0/0 · 161/138/0/23 · ombre 65 · l0-check 97/23/45/9/20/0
      mutants 76/54/69/0 · S4 127 → 127 · 33 → 33
      ```
      *Trois livraisons ; la v1 refusée sur quatre blocages*, dont `tree` recalculé après le
      retour du reviewer — une écriture faite pendant la revue passait pour couverte.
      *Leçons :* un défaut corrigé dans un chemin a un jumeau dans un autre — chercher les
      frères d'un motif avant de livrer ; un mutant tué avant ce qu'il prétend prouver
      n'éprouve rien.

- [x] **LOT 7 — risques durables et porte décisionnelle** (2026-09-23). Clôture `8284e90`,
      arbre `097ccfd7`. Étapes `23227e5` (l'écrivain refuse un registre v2 non `KNOWN`) et
      `8284e90` (`RISK` durable sous la clé `(R, work_unit, id)`, indépendante de la
      génération ; porte et pont lisent le registre).
      ```text
      suite 923/923/0/0 · 162/144/0/18 · ombre 65 · l0-check 98/18/50/9/21/0
      mutants 83/59/75/0 · S4 127 → 127 · 33 → 33
      ```
      *Livraison refusée puis corrigée :* le pont retombait en mémoire sur un registre
      inexploitable, la barrière laissait passer par absence. Deux fois le même défaut —
      **inconnu n'est pas vide**.

- [x] **LOT 8 — `FROZEN`, hooks et validation du plan** (2026-09-24). Clôture `0383b1c`,
      arbre `d2a838ec`. `c7041b9` : `FROZEN` durable avant le merge, relecture git du gel
      (C2.4), classes de hooks. `0383b1c` : `design_update` validé dans `plan()`, avant tout
      gel du plan (C6.1).
      ```text
      suite 923/923/0/0 · 162/149/0/13 · ombre 65 · l0-check 98/13/54/9/22/0
      mutants 89/63/80/0 · S4 127 → 127 · 33 → 33
      ```
      *Livraison refusée puis corrigée :* un ancien gel lu dans le registre brut, un second
      commit possible après le `FROZEN`. Une décision prise sur un état lu au mauvais
      endroit, ou trop tôt. *Leçon de procédure :* le relevé des arbres et des `patch-id` se
      fait après les commits, dans un fichier, et se vérifie avant d'être envoyé.

- [x] **LOT 9 — `MERGED`, Statut, `INTEGRATED` final** (2026-09-24 → 25). Clôture
      `45509bf`, arbre `a21a1f02`. **Dernier lot du chantier.** `94eae75` (livraison B,
      étapes 1 à 5) et `45509bf` (livraison C, étape 6), instrument S4 v7 gelé avant.
      *Posé :* une chaîne finale commune aux trois chemins d'intégration — `FROZEN` →
      intégration git prouvée → `MERGED` → phase Statut → `INTEGRATED` final →
      `details.integration` → nettoyage ; les trois fenêtres de crash reprises ; l'adoption
      d'un commit de gel par l'opérateur (C2.5) ; le gel vide pour une lane sans changement ;
      la garde de `DESIGN.md` (C6.4, C6.6) ; `AGENTS.md` et le modèle Forge alignés sur
      `design_update` (C6.5).
      ```text
      suite 923/923/0/0 · 165/165/0/0 · ombre 65 · l0-check 101/0/67/11/23/0
      mutants 105/78/95/0 · S4 127 → 127 · 33 → 33
      ```
      *Les deux questions de clôture :* un faux positif dans une coïncidence de fenêtre vaut
      mieux qu'une écriture qu'on ne saurait plus distinguer d'une reprise (Q-C1) ; l'autorité
      publique est le registre durable, pas la réponse d'un appel (Q-C2).
      *Seul écart de protocole des dix lots :* la branche poussée jusqu'au commit B alors que
      le push restait interdit. Entériné, sans réécriture du remote. Le commit est gardé en
      machine, le push ne l'est pas — voir *Phase 3*.

- [x] **Correctif UNKNOWN-LEGACY** (2026-09-25). `81a5656`, arbre `2fc689bf`. L'état C4 est
      jugé avant la création d'un registre de lanes, les appends legacy et la migration.
      ```text
      suite 927/927/0/0 · 165/165/0/0 · ombre 65 · l0-check 105/0/70/11/24/0
      mutants 108/81/98/0 · lanes-concurrency 4/4/0 · S4 127 → 127 · 33 → 33
      ```
      *Laisse deux bloquants avant le gel et le pilote :* la garde C4 placée après les
      effets externes de délégation (R11), le registre des intégrations hors C4 (R19).

- [x] **Correctif pré-pilote C4** (2026-09-26). `c42f2d4`, arbre `3a7de843`, `patch-id`
      `32fa612a`. Une délégation liée à une lane est refusée hors `KNOWN` et `EMPTY` **avant
      tout effet** — ni séquence, ni worktree, ni enfant ; `allocateLanes` relit C4 sous R.
      Le registre des intégrations passe sous C4 : création exclusive, `fsync` du fichier
      puis du répertoire, témoin publié **après** l'en-tête durable.
      ```text
      suite 929/929/0/0 · 165/165/0/0 · ombre 65 · l0-check 107/0/72/11/24/0
      mutants 110/83/100/0 · lanes-concurrency 4/4/0 · S4 127 → 127 · 33 → 33
      ```
      *Six chemins contre cinq au plan v1 :* le sixième est `tests/execute-harness.test.ts`,
      adjugé par `ADDENDUM-SIXIEME-CHEMIN` §§ 3–4 — deux tests attendent le refus `LOST`
      d'un registre d'intégrations supprimé mais témoigné.
      *Ce que le plan a changé :* la famille « contrôle correct, placé après ce qu'il doit
      couvrir » — **dixième occurrence en dix lots** — devient une classe de falsification
      explicite : trois des seize falsifications remettent le contrôle au mauvais endroit.

---

## Ce qui reste

*Rangé par phases depuis le 26 septembre. Trois dépendances gouvernent l'ordre, dans cet
ordre : **mesure A avant tout ce qui change le contexte**, **banc avant tout allègement**,
**gel et pilote avant tout ce qui touche l'intégration**. Chaque ligne donne sa condition
d'entrée ; le raisonnement complet est dans **[A]**, section citée. Un item s'ouvre en
recopiant son détail depuis la source privée dans le plan de sa phase.*

*Du 27 au 29-09,* l'ouverture des phases 2 à 9 était suspendue à la qualification du pilote
sur `design_update`. **Qualifié le 29-09** (sol/29). Le lot suivant, cadré par Sol,
**« invariants terminales + efficacité »** — sûreté d'abord (P0), puis efficacité (P1),
jugée contre une baseline de coût figée —, est **clos le 30-09** : P0 qualifié, cible P1
non qualifiée. Suivent **LOT-REPRISES** et son correctif, **qualifiés et clos le 01-10**
(objet final `1e07ae13`, efficacité toujours non qualifiée). Tout chantier suivant passe par
un nouveau lot ; le suivant recommandé par Sol est **l'efficacité P1, diagnostic d'abord**.

*Ordre retenu le 06-10 pour la suite :* clôture du lot efficacité → inventaire et couche
d'adaptation de pi → **montée de pi par paliers** (phase 9b, avancée) → QD de référence →
phase 0 → phase 3 (trois items) → phase 2 → le reste dans l'ordre des phases. **Trois items
par lot par défaut ; davantage seulement sur plan adjugé, avec un objectif commun,
une qualification bornée et un retour arrière défini.**

*Et trois filtres s'appliquent à chaque item avant de l'écrire* — `CHANTIER.md`, § 3,
*Trois invariants* : où la règle vit (hors bundle), sous quelle forme (code si permanente),
qui la déclenche (le runtime, pas l'opérateur). Tout item porte une ligne *Activation* à
son ouverture ; un item qui ne sait pas la remplir n'est pas encore écrivable.

### En cours

- [x] **`PORTES-GEL` v4 — `83eb62a` gelé par Sol le 27-09, cinq chemins exactement.**
      Commit candidat local `83eb62a2` (parent `c42f2d4`, arbre `82a9b1b8`, `patch-id`
      `57dff9b7`), non poussé ; Q1 5/5, Q2-A et Q2-B conformes, rejeu Node 26 conforme.
      **Arrêt sur la source du pilote :** le dépôt fourni était une sauvegarde de run ; Q3 et Q4
      à refaire sur une source propre.
      **Gelé par Sol le 27-09 :** `83eb62a213aecbba5055db10db3710afb29d56d3`, parent `c42f2d4`,
      arbre `82a9b1b8`, `patch-id` `57dff9b7`, cinq chemins — `.gitignore`,
      `cache/deepseek-models.json` (retiré), `settings.json`, `subagent-only/agents/scout.md`,
      `subagent-only/dispatch.ts`. Q4 et Q3 refaites sur le baseline propre du pilote, rejeu
      § 9 conforme dans des clones jetables du même commit, `~/.pi/agent` identique avant et
      après. **Poussé le 27-09** en fast-forward simple depuis `c42f2d4`, sans force : HEAD =
      origin = distant = `83eb62a`, statut vide. **Second smoke conforme le 27-09** — Q1 5/5
      dans un dépôt jetable neuf, aucun fallback, `settings.json` inchangé ; pilote sur
      **pilote autorisé le 27-09**.
      Le v3 (plan `38818723…`, base `c42f2d4` / `3a7de843`) avait été qualifié chez Mo : Q1 conforme 5/5 sous pi 0.86.0, scout
      `deepseek/deepseek-flash` accepté comme modèle canonique ; Q2 identité, continuation et
      refus `UNKNOWN` fail-closed conformes ; Q3 conforme ; rejeu Node 26 conforme.
      *Premier passage des rôles par le vrai dispatch de l'extension installée, sur la machine
      du pilote* — et ses trois écarts sont du type qu'aucun harnais ne voit : `settings.json`
      réécrit par pi au lancement, `.pi/brief.meta.json` écrit à la racine par une autre
      extension, pas de continuation `KNOWN` après rechargement.
      *Suite :* source du pilote → Q3 et Q4 → gel du SHA → push → pilote.
      **Commit, push et pilote interdits jusque-là.** [A] Partie 1, *PORTES-GEL v3*.
      *Règle posée par Sol le 27-09 :* aucun commit, même de documentation, entre le gel et
      le pilote sans nouvelle adjudication — un nouveau commit change l'arbre qualifié.

- [ ] **Le fan-out des scouts n'a jamais servi — mécanisme gardé, affordance refaite.**
      Zéro appel multi-questions depuis sa mise en service. Au run 10, quatorze scouts dont
      deux séries consécutives — `22,23` et `33` à `36` — avec un **`scope` identique** à
      l'intérieur de chaque série et des questions indépendantes : la série de quatre est
      exactement le cas décrit par la guideline, au plafond exact. Deux explications écartées
      par ces chiffres : ni contrainte d'interface, ni dépendance temporelle.

      *Correction de fait, vérifiée dans la documentation de pi :* `promptGuidelines` n'est
      pas réinjecté à chaque appel de l'outil — les bullets sont ajoutées **à plat** dans la
      section `Guidelines` du prompt système, sans regroupement, d'où l'obligation que chacune
      nomme son outil. La guideline du découpage faisait 609 caractères dans une liste qui
      contient aussi « Be concise in your responses ».

      *Ce qui a été fait :* le déclencheur devient **prospectif** — rassembler les questions
      connues avant le premier scout — et vit dans la description du champ `find`, à l'endroit
      où l'appel se construit. L'exemple est un tableau de trois questions et **aucun
      singleton n'est montré** ; la chaîne est nommée comme raccourci. La guideline ne garde
      que le refus des audits déguisés et renvoie au paramètre. Le type reste
      `string | string[]` : rien ne prouve que l'union soit la cause, et un tableau n'empêche
      pas quatre singletons successifs. Coût net : +6 tokens.

      *Référence du prochain run, mécaniquement comptable :* délégations scout consécutives
      partageant un `scope`. Run 10 → **0 % de capture, 4 appels sérialisés excédentaires**.
      Validation à ≥ 70 % sur ≥ 5 groupes. Zéro sur cinq voudrait dire que le prompt n'est pas
      le levier, et le passage à `find: string[]` devient l'essai suivant.
      *Se lit au pilote* (phase 1), sans rien ajouter au run.

- [x] **Onze défauts sur un chemin jamais exécuté**, trouvés par simulation et par cinq
      relectures externes — jamais par un run, puisqu'il n'y en a jamais eu.
      *Les deux premiers :* `details` construit depuis `results[0]` — six tours rapportés sur
      trente-quatre, `isError: false` avec un enfant mort — et un créneau `running` unique par
      rôle, écrasé par chaque `markStart`, vidé par le premier `markEnd`.
      *Les trois suivants :* la liste de sévérité tenait six noms d'échec là où `RunResult` en
      déclare huit, donc `timeout` et `aborted` valaient `ok` ; les tentatives comptaient pour
      des délégations, donc un `provider_error` rattrapé par un repli survivait au lot ;
      `details.next` restait celui du premier enfant, donc `status: failed` et `next: done`
      dans la même réponse.
      *Les trois derniers, sur les chemins exceptionnels :* une exception laissait le créneau
      ouvert pour toujours ; `recordAttempt` venait après les écritures, donc une panne disque
      effaçait une consommation déjà réelle ; et `Promise.all` rendait la main alors que trois
      enfants du même appel tournaient encore.
      *Et le neuvième était dans le correctif :* un abandon entre deux tentatives tombait dans
      `exhausted`, qui annonce que toute la chaîne a refusé — alors que les modèles suivants
      n'avaient pas été essayés.
      *Les deux derniers, dans le correctif du correctif :* `abandon` fermait la délégation au
      nom du modèle de départ, donc une exception après un repli retirait du lot le modèle d'un
      frère encore vivant ; et il ne posait pas `closed`, alors que son commentaire promettait
      qu'il était sans effet une fois la délégation terminée. Tous deux trouvés dans
      `batchLifecycle` — la fonction extraite au lot précédent pour qu'un test puisse
      l'atteindre, ce qui est exactement ce qui les a rendus visibles.
      *Et le onzième, sur le dernier chemin exceptionnel restant :* un rejet sur un appel à un
      seul enfant fermait l'état en mémoire sans le republier, donc le footer gardait un
      instantané montrant le rôle en cours. Le chemin singleton disparaît : `allSettled` sert
      pour un enfant comme pour quatre, et un `finally` publie sur les deux issues.
      **Le point commun de tous :** la primitive savait représenter la bonne chose et
      l'appelant faisait autre chose, dans un module que les tests ne pouvaient pas atteindre.
      D'où les quatre modules feuilles, et `tests/attempts.test.ts` qui observe la séquence
      d'appels plutôt que le résultat.
      *Un installeur a aussi saboté un arbre de travail* — une vérification qui cassait un
      fichier pour prouver que les tests l'attrapent, dans un script portant `set -euo
      pipefail`, donc la restauration n'a jamais tourné. Le sabotage a été commité et la suite
      l'a rattrapé sur un clone frais.

- [ ] **Lire un module de Spark-C en entier**, avec les sept critères de la revue en
      aveugle. Dix runs mesurent des défauts **prévus** et des diffs ; personne n'a jamais lu
      le livrable d'un œil critique. 161 tests au vert ne disent rien de la qualité de lecture.
      *Candidats :* `status.py` ou `io.py`. *Hors phase* — ne dépend de rien.

### Phase 0 — le pivot : mesure A et relevé de dépense

*Un seul instrument, deux lectures : ce qui remplit le contexte, où part la dépense par
rôle. N'attend pas le pilote ; se mène en parallèle de la phase 1.*

- [ ] **Écrire la commande d'analyse, versionnée sous `bin/` et testée.** *29-09 : la part
      coût existe — `bin/run-cost`, livrée dans ITE-1, reproduit la baseline fonctionnelle ;
      la part contexte (mesure A) reste à écrire.* `ANALYSE-f0797e`,
      que `CHANTIER.md` citait comme l'endroit où elle vivait, est **introuvable** — ni dans
      les 202 commits de la branche, ni chez Mo. Sur le modèle du relevé de dépense : lecture
      directe de `.pi-subagent-runs/*.json` et des sessions, jamais par soustraction, contrôle
      du nombre de tours contre la session. *Troisième instrument perdu hors du dépôt* —
      après la porte S4 et la baseline `tsc`.
- [ ] **Mesure A — ce qui remplit le contexte du worker.** *Remontée de « Dette, sans
      urgence » le 26-09 : un pivot rangé en dette ne se lance pas.* Trois causes candidates,
      trois correctifs incompatibles : texte de tâche gonflé par les findings, sorties de
      `pi-lint-gate` restées en contexte, relectures dans la délégation. **Base : le run 10
      `a1c83f`** — les artefacts de `f0797e` ont pu disparaître, et décrivent une
      configuration d'avant les neuf lots. *Premier geste :* vérifier ce qui reste dans
      `.pi-subagent-runs/` pour `a1c83f` — en commençant par la sauvegarde de run rejetée
      comme source du pilote le 27-09, qui contient des artefacts de run. Adjugé par Sol :
      rien n'y est nettoyé avant son identification — `runId` présents, inventaire de
      `.pi-subagent-runs/`, `mesures/` relié aux `runId`, manifestes, lanes et intégrations,
      puis seulement : est-ce la base de la mesure A ? *Réponse du 27-09 :* un seul run, `1c5d47`
      (24-08, 44 délégations, config `870f389`), transcriptions complètes — absent du journal ;
      base disponible, datée d'avant les neuf lots. Worker Terra et identité du corpus
      adjugés, numéro non établi (voir run 9).
      *Débloque :* phases 5 et 6, la moitié « économie »
      de la scission d'`AGENTS.md`, l'adoption d'un bras court de l'épreuve de concision.
      [A] Partie 2, *Mesure A — le pivot, renvoi*.
- [ ] **Relevé de dépense par agent, au pilote.** Orchestrateur, worker, scout, reviewer,
      advisor, chacun séparément : `input`, `cacheRead`, `cacheWrite`, `output` (dont
      `reasoning`, qui ne s'additionne pas), délégations, tours, `durationMs` ; dénominateur
      = le run entier, orchestrateur compris ; ramené aussi par worker. Lu après coup, sans
      rien ajouter au run. *Décide encore :* le modèle du reviewer, seul poste réellement
      facturé. [A] Partie 2, 2G.
      *QD-P0, 29-09, par `bin/run-cost` :* orchestrateur 369 194, workers 1 545 439, reviewers
      573 054 — 2 487 687 avant intégration, 46 954 après. Première décomposition par rôle
      produite par l'instrument versionné.
      *Premiers totaux, pilote du 27-09 :* sous-agents 10,2 M tokens, orchestrateur 14,5 M,
      fenêtre ChatGPT épuisée avant la fin. La décomposition par rôle reste à faire.
      *Adjugé le 27-09 (sol/17) :* sous-agents dans l'enveloppe des runs 12 à 15 ; différentiel
      concentré sur l'orchestrateur, absence de compaction plausible, cause unique **non
      établie** — faute de sessions d'orchestrateur historiques comparables. La mesure devient
      exigée à chaque exécution, compactions et horaires compris.
      *Attribution (sol/18) :* au pic (≈ 213 k), 89 % du contexte de l'orchestrateur vient de
      **ses propres lectures** — bundle relu, gros fichiers source, lanes, artefacts reviewer
      complets ; 6 % de `bash`, 3 % des retours de délégation. L'hypothèse « extension
      `subagent` trop verbeuse » est écartée. Aucune correction imposée à ce stade. L'épuisement
      du quota dépend aussi de la facturation et du cache du fournisseur.
- *Seuil de bruit, à porter par toute comparaison :* 13 % de dispersion sur le coût entre
  deux runs identiques de `csv-to-bq`. Jamais mesuré sur Spark-C.

### Phase 1 — gel et pilote

- [x] **`lastChangelogVersion` versionné à la version épinglée.** *Corrigé par l'étape 3
      de `PORTES-GEL` v4, gelé dans `83eb62a` le 27-09.* pi réécrit `settings.json`
      au lancement — `0.84.4` → `0.85.1` le 10-09, → `0.86.0` pendant la qualification du
      26-09. Le correctif bon marché retenu par l'adjudication, aligner la valeur versionnée
      sur `0.86.0`, n'a jamais été appliqué. Une ligne, sous adjudication.
      *Et à connaître pour le préflight :* un simple lancement crée aussi
      `.pi-subagent-runs/active-run.json`. [A] Partie 1, *État d'exécution versionné*.
- [x] **`.pi/brief.meta.json` salit la racine et bloque l'intégration — réglé pour le
      pilote.** Constaté à la qualification v3 ; *traité par Q4 de la v4, conforme sur le
      baseline du pilote le 27-09, `/.pi/brief.meta.json` dans son `.gitignore`.* Hors du
      pilote, la question reste celle de `/brief` (phase 7). À régler avant le pilote : hors de la racine, ou ignoré.
      [A] Partie 2, 2D, `/brief`.
- [ ] **Modèle par défaut.** `settings.json` déclare `openai-codex/gpt-5.6-sol`, qui échoue
      avec un compte ChatGPT (« model not supported »). À vérifier avant le pilote.
      *27-09 :* hors du périmètre de la v4, qui ne change qu'une ligne de `settings.json` ;
      inchangé dans `83eb62a`. Les sessions interactives de Q2 ont abouti.
- [ ] **Épingler les deux paquets externes, puis basculer le scout.** `pi-raw-paste` suit
      `latest`, `pi-deepseek-provider` suit la branche par défaut — leur code change sans
      qu'aucun commit ne bouge. Épingler `pi-deepseek-provider` **avant** la bascule : son
      catalogue décide de `reasoning`, donc du sort de `--thinking low`. Bascule :
      `scout.md` et `RATES` dans le même commit, preuve que `--thinking low` atteint le
      modèle, appel réel conservé comme la porte `O-P2-I02`. *Garde envisagée :* toute
      entrée de `packages` porte une version ou un ref exact. [A] Partie 1, *Dépendances
      d'extensions non épinglées*.
      *27-09 :* **la bascule est faite et gelée dans `83eb62a` ; l'épinglage ne l'est pas** —
      hors du périmètre de la v4. Les deux paquets flottent toujours, entre le second smoke et
      le pilote compris.
- [ ] **Racine propre.** Neuf répertoires `.backup-*` laissés par les installeurs du 20 au
      22 août, `crashes.json` : ignorés par git, mais le préflight exige une racine propre.
      Les installeurs devraient écrire ailleurs.
- [ ] **Source propre et bundle compatible — précondition adjugée par Sol le 27-09.** Le
      dépôt pilote contient le projet et le bundle nécessaire au workflow, mais aucun état
      d'un run antérieur : ni `.pi-subagent-runs/`, ni `mesures/`, ni `.pi/`, ni worktree,
      registre, manifeste ou autre état runtime hérité ; le baseline git est établi avant le
      premier run ; une source qui porte un tel état est impropre même si son `git status`
      est propre. Le premier dépôt fourni (`4eee8b27`) était une sauvegarde de run, rejeté.
      ```text
      PROJET propre + BUNDLE complet + DESIGN.md conforme à C6.1 + zéro état runtime hérité
      ```
      *Bundle :* un `DESIGN.md` à l'ancienne grammaire de `Statut` arrête avant le baseline,
      sans migration silencieuse ; migration ou régénération définie explicitement contre le
      modèle qualifié du dépôt. Celui de ce projet porte l'ancienne grammaire (run 10, sept
      `Statut` en `Implemented`) : **l'arrêt est probable**. *Et si l'on régénère*, recharger
      d'abord la copie Forge de Claude.ai (voir *Hors phase*), sinon elle reproduit le défaut.
      *27-09, rectificatif de Sol :* l'archive du lot 17 est la source candidate ; le bundle
      `1c5d47` n'est qu'une pièce de provenance ; **les quatre dérogations sont obligatoires
      avant le baseline**. Déroulé : collecte des runs 12 à 15 en lecture seule, rapport,
      choix de Sol, baseline.
      *Même jour :* collecte adjugée ; worker de `1c5d47` = Terra ; **P0-9 bloquant** — le texte
      des dérogations est absent des sources, candidat retrouvé dans une conversation, à
      adjuger. Et les runs 12 à 15 ont tourné **sans** les quatre dérogations : toute
      comparaison de ces runs au run 10 porte la variable `CONVENTIONS`.
      *Puis, rapport B v2 adjugé :* le texte exact des quatre dérogations est **établi**
      (script original, dans une conversation de Mo) — P0-9 n'est plus bloquant sur le texte.
      Leur présence effective au run 10 reste à corroborer : P0-9bis autorisée, en lecture
      seule, sur les artefacts `a1c83f`, les `CONVENTIONS*.md` archivés et les sessions pi.
      P0-6 partiel, P0-8 ouvert, P0-11 suspendu. **Construction du bundle, baseline, push et
      pilote interdits.** [A] Partie 1, *Le pilote*, entrée du 27-09.
      *Puis, seuil de recherche historique fixé par Sol :* une seule collecte réelle P0-9bis,
      plus au plus une récupération ciblée sur un pointeur concret nouveau ; ensuite la
      recherche est close. Le numéro de `1c5d47`, la version exacte du bundle du run 10 et le
      blob exact du run 10 deviennent **non bloquants** ; P0-11 tranche alors aussitôt, sur les
      pièces disponibles, entre migration contrôlée et régénération contrôlée. *Restent
      bloquants avant le baseline :* texte de D1-D4 indisponible, D1-D4 absentes du bundle
      final, `DESIGN.md` non reconnu mécaniquement, contrôles négatifs C6 non mordants,
      `INSTRUCTIONS.md` contraire à C6.4, provenance du bundle décrite faussement, état runtime
      hérité. *État :* outil P0-9bis livré à Sol (L1), collecte réelle non lancée ; trois
      livraisons proposées jusqu'au pilote (L1 à L3). [A] Partie 1, *Le pilote*, seuil du 27-09.
      *Puis L1 adjugée par Sol (sol/10) :* **P0-11 = migration contrôlée**, la régénération
      est écartée ; **source projet définitive du premier pilote** : l'archive du lot 17
      (`a854393e…`). `CONVENTIONS.md` vaut `0b8d9e18…` dans toutes les branches sauf un autre
      blob limité exactement à D1-D4 ; seule la phrase de provenance dépend de P0-9bis.
      Outil P0-9bis corrigé sans L1bis (`2f24ea8c…`, falsification 21/21), exécution réelle
      autorisée, en cours. *Suite :* L2 — rapport P0-9bis, récupération ciblée éventuelle,
      bundle final, provenance, vérificateur, `etablir-pilote.sh` — adjugée en un passage ;
      puis L3 — baseline, Q4, Q3, rejeu § 9, demande de gel. Baseline, Q4/Q3 et rejeu
      interdits avant L2 ; gel, push, second smoke et pilote, chacun sur autorisation
      séparée. [A] Partie 1, *Le pilote*, L1 du 27-09.
      *Puis L2 adjugée sans correction (sol/11) :* **P0-9bis close sur le critère A** — une
      occurrence historique de `0b8d9e18…` (membre du 30-08), lien direct au run 10 non établi ;
      P0-6 et P0-8 non établis, recherche close, non bloquants ; **P0-11 clos**, branche « A
      seul ». **Bundle final gelé pour le baseline** : `INSTRUCTIONS` `9fccc50e…`,
      `ARCHITECTURE` `2bdeb066…`, `DESIGN` `d30905fc…` (12 décisions, 8 proposées, 4
      terminées), `CONVENTIONS` `0b8d9e18…` ; vérificateur Q6, 57 contrôles, falsification
      48/48. **`etablir-pilote.sh` autorisé** — baseline, Q4, Q3, rejeu § 9 dans des clones
      jetables de `83eb62a2`. Gel, push, second smoke et pilote toujours interdits ; suite : L3
      et demande de gel. [A] Partie 1, *Le pilote*, L2 du 27-09.

- [x] **Le pilote : premier run Spark-C avec `maxParallel=2`** — *fait et clos le 27-09,
      qualifié le 29-09 (critère `design_update`, sol/29).* Ce que la suite ne peut pas établir et que le README
      laisse délibérément non revendiqué : qu'une exécution parallèle tienne sur une tâche de
      production entière — 2 978 lignes en onze modules.
      *Borné par* le gel `PORTES-GEL` v4, puis les préconditions ci-dessus. *27-09 :* gel
      fait (`83eb62a`), baseline du pilote gelé comme état de départ ; push fait, second
      smoke conforme, **pilote autorisé le 27-09**. **Critère de qualification** : au moins une
      transition `design_update` « proposé → en cours » réelle, sur une unité substantielle —
      sinon le pilote revient à Sol avant toute conclusion (texte exact dans [A] ; confirmé par
      Sol le 27-09 : une transition provoquée hors travail réel n'est pas recevable).
      *27-09, 20 h 10 :* **interrompu par le quota ChatGPT après W10** — dix unités sur onze
      intégrées, W11 ouverte. Reprise de W11 seule autorisée dans le même run, après `/compact`.
      Le plan gelé ne déclare aucun `design_update` : critère non satisfait à ce stade.
      Orchestrateur 14,5 M tokens, sous-agents 10,2 M, aucune compaction sur 114 appels.
      Conformité non adjugeable avant le relevé final. [A] Partie 1, *Le pilote*, sol/15.
      *Fin du run, sol/16 :* **achevé fonctionnellement** — onze unités intégrées par le runtime,
      dépôt propre, agent inchangé, Q3 et Q4 conformes, reprise conforme. **Non qualifié
      globalement :** les huit décisions visées sont restées « proposé ». Pas de rejeu ; à
      qualifier par une unité réelle ultérieure relevant d'une décision encore « proposé ».
      *Clôture, sol/20 et sol/21 :* `run completed` — archive terminale, `active-run.json`
      libéré ; les onze branches de lanes rangées à la main sur autorisation ; aucun worktree
      résiduel ; dépôt `bb2cf0ea` propre, agent inchangé sur `83eb62a`.
      *Mesure au passage :* le relevé de dépense, le fan-out des scouts. *Référence :* run 10
      `a1c83f`, par worker seulement — un run parallèle ne se compare jamais en totaux.
      [A] Partie 1, *Le pilote — ce que le mot désigne*.
- [x] **Qualifier le pilote par une unité réelle** portant une transition `design_update`
      « proposé → en cours » sur l'une de D-001…D-006, D-010, D-011 — sans unité artificielle.
      *Porte de toutes les phases 2 à 9.* La transition doit être déclarée au plan gelé : c'est
      ce qui a manqué au pilote. *Protocole (sol/17) :* `/compact` par l'opérateur après chaque
      unité intégrée, visible dans la chronologie ; relevé orchestrateur et sous-agents par
      rôle — entrée, cache relu, sortie, appels, pic et médiane de contexte, compactions et
      horaires, durée. *Ordre (sol/18) :* après le lot post-pilote, son gel et son push —
      faits le 29-09. **Qualifié le 29-09 (sol/29)** : sur `a562579`, dans un dépôt neuf,
      l'orchestrateur a déclaré de lui-même au plan gelé un `design_update` D-001 « proposé →
      en cours », appliqué par le runtime après l'intégration de W01. *Mais une dérive après
      `INTEGRATED`* — quatre délégations de plus sur l'unité intégrée, deux `REVIEWED` acceptés
      par le registre, un correctif appliqué à la racine hors du flux — interdit de rouvrir la
      suite avant les correctifs P0 ci-dessous. [A] Partie 1, *Le pilote*, sol/16 à sol/29.
- [x] **`active-run.json` reste « active » après la fin de l'orchestrateur** (pilote, `nextSeq`
      46) — *caractérisé le 27-09 (sol/20) : nominal.* Le run reste actif tant que `run
      completed` n'est pas passé ; c'est **l'ordre de fin de run suivi par l'opérateur** qui
      était le trou, pas le runtime. Protocole de fin de run faisant foi : report → cleanup en
      lecture seule → `cleanup --apply`, run encore actif → report de contrôle → `run
      completed`, dernière opération runtime → vérification finale. [A] Partie 1, *Le pilote*,
      sol/20.
- [x] **Lot post-pilote — `compaction-guard` et protocole de fin de run** (autorisé le 27-09,
      sol/18 ; **gelé et poussé le 29-09**, `a562579`). Extension séparée `extensions/compaction-guard`, sur `turn_end` : une compaction
      au franchissement de 50 % de la fenêtre du modèle courant, réarmement seulement après
      retour sous le seuil. Modifie l'objet gelé : nouveau lot, nouvelle qualification, nouveau
      gel. Preuves A à E et falsification exigées. *Jusqu'à son gel,* `/compact` opérateur après
      chaque unité intégrée reste obligatoire ; ensuite, la compaction automatique devient le
      mécanisme nominal et `/compact` manuel un recours.
      *Fait (LOT-PP, sol/19 et sol/22 à sol/28) :* **A** — fin de run portée par
      `exploitation/terminer-run.sh`, qualifiée sur un run réel ; **B** — `compaction-guard`,
      avec une reprise envoyée par l'extension quand `ctx.compact()` interrompt un run actif
      (défaut de pi 0.86.0 trouvé par la porte E v3), porte E v4 conforme en runtime réel ;
      **C** — `design_update` obligatoire dans `AGENTS.md` pour une unité qui réalise une
      décision « proposé ». Chaîne additive `83eb62a` → `5162174` → `a562579`, push
      fast-forward. **Depuis ce gel, la compaction automatique à 50 % est le mécanisme
      nominal.** *Constats laissés à un lot de maintenance :* `cleanable_branches` liste une
      branche retirée ; un message `fatal` d'une sonde git sur stderr. [A] Partie 1, LOT-PP.
- [x] **Lot « invariants terminales + efficacité »** — cadré par Sol le 29-09 (sol/29),
      prochaine livraison. *P0, sûreté, trois portes falsifiées indépendamment :* **P0-A**
      unité `INTEGRATED` terminale, refus avant réservation et avant lancement ; **P0-C** plan
      entièrement intégré terminal, priorité 1 ; **P0-B** garde de mutation de l'orchestrateur,
      exprimée en effets et en capacités, pas en liste de commandes. *P1, efficacité, sans perte
      de qualité :* relectures de l'orchestrateur, contexte injecté aux sous-agents,
      allers-retours worker ↔ reviewer — tout en code ou en instrumentation. **Jugé contre la
      baseline fonctionnelle** de W01 : 1 648 989 tokens (orchestrateur 404 007, sous-agents
      1 244 982) ; à ne pas confondre avec la baseline d'incident (3 984 515, dont 58,6 % de
      gaspillage après `INTEGRATED`). Reprend la demande de Mo du 29-09 (lot « consommation »).
      *Avant lui :* la clôture du run de qualification `1d085ea9` — **conforme le 29-09**, racine
      propre sur `c876b874`. *Questions préparées pour son plan* (non adjugées) : P0-A et P0-C
      définis sur le registre du run, pas sur git ; lanes éphémères au lot suivant ; P0-B en
      deux temps, détection par effet d'abord ; seuil de `compaction-guard` inchangé avant P1 ;
      périmètre P1. [A] Partie 1, *Le pilote*, questions du 29-09.
      *29-09 :* **plan ITE v2 adjugé recevable** (corrections de Sol incorporées ; construction
      autorisée, ni gel ni push). **Livraison ITE-1 construite** — P0-A unité intégrée
      terminale, P0-C plan terminal irrévocable, P0-B garde de mutation par capacité et
      empreinte avant/après, P1-0 `bin/run-cost` qui reproduit exactement la baseline
      fonctionnelle. Portes chez Claude : `test-guards` 959 · 184, `l0-check` 126/0/88/11/27/0,
      `l0-mutants` 140/99/116/0, `tsc` 127 → 127. En attente de l'adjudication de Sol et de
      l'établissement du candidat sur le Mac. [A] Partie 1, lot ITE.
      *29-09, 16 h 50 :* **ITE-1 non gelable.** Porte 17 rouge par défaut du vérificateur, sans
      diagnostic nouveau ; corrections exigées sur P0-B (hachage complet des grands registres,
      un seul appel non exempté à la fois), preuve P0-C de reprise après compaction, entrées non
      ambiguës de `bin/run-cost`. Écarts : E7 refusé (raccourci au-delà de 1 Mio), E11 refusé
      sans preuve, E9 à qualifier au run réel. **Aucun levier P1 avant QD-P0.** Cible P1
      maintenue : −25 %, soit ≤ 1 236 742 tokens. **ITE-1b** déposée — un commit correctif au-
      dessus de `1e91c5b7` — ; reprise des portes sur le Mac et adjudication en attente ; ni gel,
      ni push, ni QD-P0.
      *29-09, 18 h 30 :* **ITE-1b non gelable** — relevés de la porte 17 faussement verts (zéro
      fichier compilé, `sed` BSD) ; `bin/run-cost` acceptait la session d'un autre run.
      Corrections de Sol appliquées. **ITE-1c conforme sur le Mac** : candidat `85c5519f`,
      arbre `78491822`, toutes portes vertes, porte 17 rejouée sur les trois candidats (99 → 104
      fichiers, 127 → 127). **Gelé et poussé le 29-09** — fast-forward de quatre commits depuis
      `a562579`, sans force. *Suite :* **QD-P0**, qualification réelle de P0 ; les leviers P1
      viennent après elle.
      *29-09, QD-P0 :* **partie P0 close.** Run réel `ec276ba9` sur `85c5519`, même unité que QD,
      sans intervention : QD0–QD7 et P0-1 à P0-5 conformes — après l'intégration finale, aucune
      délégation, aucun appel, une seule réponse ; outils réduits à la lecture ; fin de run
      conforme. *Réserve de Sol :* aucun appel interdit n'ayant été émis, l'interception réelle
      par P0-B n'est pas démontrée par ce run (étayée par L0). **Mesure :** avant intégration
      2 487 687 tokens (+50,9 % sur la référence fonctionnelle, runs sur candidats différents,
      pas de bande de bruit) ; après, 46 954 contre 2 335 526 à la baseline d'incident. *Suite :*
      plan P1 soumis à Sol avant codage — tours et contexte des workers d'abord, puis contexte
      initial des reviewers. Cible inchangée (≤ 1 236 742).
      *29-09, plan P1 adjugé et gelé :* quatre leviers **en expériences** — P1-A commande de test
      transmise aux workers (code), P1-B lectures groupées du worker (prose armée), P1-C lectures
      groupées du reviewer à couverture intégrale (prose armée), P1-D résultat `task` qui évite
      les relectures de l'orchestrateur (code) ; instrument `bin/run-cost --tours`. **Posé avant
      codage :** même au plafond, les leviers n'atteignent pas la cible sur des runs semblables
      (≈ 157 468 au-dessus en moyenne). Jugement sur deux runs, QD-P1a et QD-P1b, sur le même
      candidat ; cible manquée → mesures et écarts par rôle publiés, retour à Sol.
      *30-09 :* **livraison P1c adjugée** — P1-A refuse une commande de test portant un
      commentaire suivi d'un saut de ligne, avec preuve et mutant dédiés. Établissement du
      candidat autorisé ; gel, push et runs QD-P1 après le relevé.
      *30-09 :* **candidat P1 établi et gelé** — `383a5f36` (arbre `6b362b18`), cinq commits
      au-dessus de `85c5519` : P1-A à P1-D et `run-cost --tours`. Portes conformes sur le Mac :
      `test-guards` 972 + 192, ombre 65, `l0-check` 147 / 0 / 109 / 11 / 27 / 0, `l0-mutants`
      176 / 120 / 137 / 0, `lanes-concurrency` 4/4, TypeScript 127 → 127 sur 111 fichiers ;
      `--tours` retrouve les références de QD et QD-P0. **Poussé le 30-09** — `PUSH CONFORME`,
      avance rapide depuis `85c5519`, sans force.
      *30-09, QD-P1a :* **run conforme** (QD0–QD7, P0, fin de run, agent inchangé). Coût avant
      coupure 3 525 705 tokens, 213,8 % de la baseline fonctionnelle (orchestrateur 654 161,
      sous-agents 2 871 544) ; après coupure 83 471. Leviers : P1-D exercé, P1-C exercé sans
      effet, P1-A et P1-B non exercés. QD-P1b en attente de Sol.
      *30-09, QD-P1b :* **run conforme**, même candidat. Coût avant coupure 4 915 263
      (orchestrateur 1 858 170, sous-agents 3 057 093), 5 workers dont 4 reprises. **Moyenne P1
      4 220 484 contre la cible 1 236 742 : manquée.** Cause commune aux deux runs : le plan
      déclare quatre fichiers écrits, l'extraction touche aussi les consommateurs d'`io.py` —
      scope-breach, intégration refusée, reprise, et risques ouverts dans une revue approuvée.
      Leviers : P1-A et P1-D exercés, P1-C exercé avec effet non attribuable, P1-B sans
      occasion admissible (toujours une correction ruff). Jugement de Sol en attente.
      *Suite :* push conforme → QD-P1a → constat de Sol → QD-P1b sur le même candidat, sans code
      entre les deux. [A] Partie 1, sol/29.
      *30-09, jugement final de Sol :* **lot CLOS.** P0 qualifié (P0-A, P0-C ; P0-B sur les QD
      observés) ; P1 conforme sur QD-P1a et QD-P1b, **cible d'efficacité non qualifiée** —
      moyenne 4 220 484, soit 341,3 % de la cible et 255,9 % de la baseline. *Cause dominante :*
      le nombre de cycles worker → reviewer → reprise, pas la micro-structure des tours ; deux
      causes de reprise établies (R1 périmètre d'écriture, R2 `approved` avec `open_risks`).
      `383a5f36` reste l'objet poussé et la référence ; aucun rollback ; la cible ne se déplace
      pas a posteriori. [A] Partie 1, « Lot ITE, phase P1 », jugement final.
- [x] **LOT-REPRISES — périmètre du plan et sémantique de revue.** Autorisé à planifier par
      Sol le 30-09 ; aucun code avant le plan. **R1** périmètre d'écriture réel (opération,
      consommateurs directs) établi et gelé avant la première délégation writer, fail-closed ;
      **R2** `approved` impose `open_risks` vide ; **R3** mesure des cycles de reprise ;
      **R4** requalification du coût sur deux QD identiques. *Invariants intouchables :*
      scope-breach bloquant, revue risquée bloquante, terminalité P0, garde de
      l'orchestrateur, `design_update`. [A] Partie 1, LOT-REPRISES.
      *01-10 :* **candidat établi** — `cc88bb20` (arbre `a1cff6d5`), 4 commits sur `383a5f36`,
      non poussé ; portes 10–23 conformes. *En attente de Sol :* gel, script de push,
      QD-REPRISES-a.
      *01-10 :* scripts QD-REPRISES adjugés conformes après correctif de Sol (Q5 à trois états :
      TENU, INDÉTERMINÉ, NON TENU). **QD-REPRISES-a autorisé** ; b bloqué jusqu'au contrôle de
      Sol.
      *01-10, QD-REPRISES-a :* **non conforme** — W01 non intégrée, run laissé actif. Plan accepté
      par R1-a après trois refus, avec sept consommateurs conservés dont `test_config.py` ; une
      revue demande une reprise sur une prémisse fausse (`test_config.py` non lu), la reprise
      casse ce test et l'orchestrateur s'arrête. Aucun scope-breach, R2 non exercé ; coût
      2 198 963. En attente du contrôle de Sol ; b bloqué.
      *01-10, adjugé par Sol :* run valide, **non conforme, consommé**. R1 fonctionne (aucun
      scope-breach) ; le reviewer #2 est en faute factuelle (consommateur conservé non
      inspecté) ; l'arrêt de l'orchestrateur est correct ; R2 non évalué, R4 non satisfait.
      **QD-REPRISES-b non autorisé** ; `cc88bb20` inchangé ; le run est clos en `abandoned`
      (abandon conforme, 01-10).
- [x] **LOT-REPRISES-CORRECTIF — une revue bloquante doit avoir inspecté les consommateurs
      conservés.** Plan v1 soumis à Sol le 01-10 : une revue bloquante exige la lecture réelle
      des consommateurs conservés de l'unité. *01-10 :* plan adjugé conforme et gelé ;
      candidat codé sur `cc88bb20` (RC + RC-mesure, patch-id `c9460da4`), portes locales vertes ;
      livraison soumise à Sol. *01-10 :* candidat `1e07ae13` **gelé** (établissement conforme,
      manifeste 29/29) ; script de push et scripts de mesure QD-RC (consommateurs conservés
      attendus, inspectés et manquants par revue bloquante) **adjugés conformes** — rejoué sur
      QD-REPRISES-a, le script retrouve le défaut (`test_config.py` non inspecté). Push
      autorisé ; QD-RC-a après `PUSH CONFORME` ; QD-RC-b pas encore.
      *01-10, QD-RC-a :* **run conforme** — W01 intégrée sans reprise, P0 et A2 conformes ;
      consommateurs conservés tenus, sans revue bloquante pour exercer le correctif ; R2 a
      refusé une fois une revue `approved` avec un risque ouvert, resoumise proprement ; quatre
      refus de plan avant gel. Coût avant coupure 2 158 655. *Adjugé conforme par Sol*, premier
      run de qualification : R2 exercé et conforme, RC non déclenché ; un finding mineur erroné
      mais non bloquant, des lectures `../../../` constatées, les refus de plan répétés classés
      inefficacité hors lot. Coût publié sans seuil (≈ 174,5 % de la cible). **QD-RC-b
      autorisé** sur le même candidat, sans code entre les deux.
      *01-10, adjudication finale :* **QD-RC-b conforme ; lot qualifié et clos.** Qualifiés :
      R1-a, R1-b, R2 (domaine adjugé), R3 (mesure), RC, P0, Q5. Objet final `1e07ae13`
      (arbre `6c03bd41`, patch-id `c9460da4`). Borne : RC sur le chemin batch n'étend pas R2 au
      batch. **Efficacité non qualifiée** — moyenne 1 994 464 contre la cible 1 236 742
      (161,3 %). Un `fatal: Needed a single revision` de `terminer-run.sh` sur stderr, non
      fatal, reste à nettoyer dans un lot ultérieur. Tout chantier suivant passe par un nouveau
      lot. [A] Partie 1, LOT-REPRISES-CORRECTIF.
- [x] **Lot efficacité — P1, diagnostic avant tout code. Non réussi.** Recommandé par Sol le 01-10. Plan v1
      soumis le 01-10, phase D (diagnostic) seule. *Pré-diagnostic, non adjugé :* les refus de
      plan de R1-a pèsent 523 667 et 328 743 tokens sur les deux runs QD-RC et font tout le
      dépassement de l'orchestrateur ; sans eux, la moyenne serait d'environ 1 568 259, encore
      331 517 au-dessus de la cible. *02-10 :* architecture de la phase D adjugée ; deux
      conclusions jugées trop fortes par Sol (le reste n'est pas établi comme venant des seuls
      sous-agents) et D1 à compléter (ventilation de l'orchestrateur, coupure du run, pas de
      double compte). Plan v2 limité à ces corrections : D1–D6 exécutables en lecture seule si
      son diff est conforme. **Code et nouveau run QD interdits.** *02-10 :* diagnostic
      **reproduit sur le Mac**, 24 sorties sur 24 identiques ; rapport D soumis à Sol.
      *02-10 :* **rapport de diagnostic adjugé conforme**, cause établie. Quatre leviers
      candidats, le premier envisagé écarté comme levier principal ; une porte de décision
      exigée sur le poste worker edit/write (293 423 tokens). Cible inchangée, atteignabilité
      non établie. **Plan des leviers autorisé** ; code et runs non autorisés ; `1e07ae13`
      inchangé. Travail relayé vers de nouvelles conversations. *02-10 :* plan des leviers v1
      jugé non conforme en l'état — mécanismes recevables, six corrections exigées, cinq
      commits distincts et une porte globale d'efficacité retenus ; plan v2 soumis à Sol, avec
      une seule adjudication demandée jusqu'au premier run de mesure. *02-10 :* **livraison
      unique** — candidat `fc1c8d68` sur `1e07ae13`, quatre leviers et la mesure ; portes
      conformes hors du Mac, deux écarts au plan déclarés. **Jugée non conforme** : huit
      corrections exigées, les deux écarts acceptés. *02-10 :* livraison révisée — candidat
      `2ae7d840` sur `1e07ae13`, corrections faites avec preuves et mutants hors du Mac,
      **jugée non conforme** (quatre corrections). Troisième livraison : candidat `555b202f`,
      non conforme sur un seul point (un cas ignoré par l'observateur RC). *05-10 :*
      quatrième livraison, candidat inchangé, correction de l'observateur seule — **jugée
      conforme**. Candidat `555b202f`. Chaîne autorisée sans adjudication intermédiaire, une
      tentative par étape : établissement (le gel s'acquiert sur un établissement conforme),
      push sans force, puis un seul run QD-EFF-a et son relevé ; tout arrêt rend la main à Sol
      sans réparation ni nouvelle tentative. QD-EFF-b attend l'adjudication de a.
      *06-10 :* **arrêt à l'établissement** — une empreinte de diagnostics différait entre la
      VM et le Mac à diagnostics identiques : le tri dépendait de la locale. Aucun écart du
      candidat, aucun gel. Instrument corrigé (`LC_ALL=C`), configuration remise à la base,
      livraison r5 avec le même candidat ; même chaîne réautorisée, une tentative par étape.
      *06-10 :* **chaîne menée au bout.** Établissement conforme sur le Mac, `555b202f`
      **gelé et poussé** (avance rapide depuis `1e07ae13`) ; **QD-EFF-a conforme** — unité
      intégrée sans reprise, plan accepté au premier essai. Coût avant coupure 1 961 534
      (158,6 % de la cible) : l'orchestrateur tombe à 172 635, le worker pèse 77 %.
      **QD-EFF-a adjugé conforme** ; la voie d'inspection au submit n'y est pas exercée. Pour
      tenir la cible en moyenne, b devra rester sous 511 950 tokens ; au-delà, le lot n'est pas
      réussi, la cible reste la même. **QD-EFF-b autorisé une fois**, même candidat, pi 0.86.0,
      sans aucune intervention.
      *06-10, QD-EFF-b :* **run conforme**, unité intégrée sans reprise ; 1 286 817 tokens
      (104,0 % de la cible). **Moyenne des deux runs 1 624 176, soit 131,3 % de la cible : cible
      non atteinte**, bien que chaque rôle, en moyenne, reste sous 110 % de sa baseline. Jugement
      P1 et clôture du lot demandés à Sol. *06-10 :* diagnostic après dépassement (D-bis)
      préparé sans nouveau run, rapproché des deux mesures à l'unité près, soumis à Sol ;
      deux affirmations de portée ramenées au rang d'hypothèses, mesures retenues. **Jugement
      final : P1 non atteint, lot non réussi.**
      **D-bis r2 adjugé conforme, lot clos le 06-10.**
      ```text
      LOT-EFFICACITÉ — CLOS, NON RÉUSSI (P1).

      QD-EFF-a et QD-EFF-b : CONFORMES.
      Moyenne avant coupure : 1 624 175,5 tokens.
      Cible : 1 236 742 tokens, NON ATTEINTE.
      Plafonds moyens de l’orchestrateur et des sous-agents : TENUS.

      D-bis r2 : CONFORME.
      Manifeste SHA-256 :
      dc24372b2935a4afbc82a2ab4303d850e280e87fa86ca3891e410d1ef287db5b
      Journal de reproduction Mac SHA-256 :
      dd2430637d37526a68237d44cd307a6f89a4e5c25daaea4dbd65dd0ab837d1e7

      Candidat gelé et poussé :
      555b202fc89bf07f8f6e61359791233157bd603a

      Aucun QD supplémentaire pour repasser sous la cible.
      Les attributions d’origine du contexte restent conditionnelles
      sous H1 ; aucun gain causal net individuel n’est établi.
      ```
      [A] Partie 1, LOT-EFFICACITE.

### Phase 2 — profil simple, part structure

*Tranché le 13-09 : `simple` devient le défaut, le réseau de sous-agents une bascule par
commande. Remonté le 27-09 : c'est le chantier prioritaire après la parallélisation, et
cette part ne touche pas au contexte, donc n'attend pas la mesure A. Ne dépend ni du gel ni
du pilote.* [A] Partie 2, 2B à 2D.

- [ ] **Scission d'`AGENTS.md` — cohérence.** Bloquant pour le profil simple : en simple,
      aucun outil `task` n'existe et la moitié du fichier explique comment déléguer. *Ce qui
      se décide ici :* quelle moitié est chargée dans quel profil. *Ce qui attend la mesure
      A :* ce que la scission fait économiser (phase 6).
- [ ] **Profil simple par défaut, sous-agents sur commande.** Bascule asymétrique (montée
      toujours permise ; descente refusée sur run non terminé ; état illisible = refus, le
      refus nomme le run et renvoie à `bin/subagent-recover`) ; gardes toutes chargées,
      inchangées. *Coût caché :* monter à chaud ajoute `task`, donc invalide le préfixe en
      cache — à trancher avant d'écrire.
- [ ] **Avertissement de run durable au démarrage**, dérivé des observateurs existants, sans
      sondage git propre ; un état illisible avertit aussi.
- [ ] **Tests du chargement en profil simple** — aucune garde ne dépend de
      `PI_SUBAGENT_ROLE` ni d'un état de run ; la bascule et son refus ; l'avertissement ;
      `/check-config` sans dispositif sous-agents. Mutation sur les gardes seulement.

### Phase 3 — dette du chantier `3c`

*Le passage prioritaire retenu le 06-10 porte sur trois items : protection des registres
durables, instruments hors dépôt, push non gardé. Les autres dettes restent au backlog
pour des plans ultérieurs.*

- [ ] **`.pi-subagent-runs/` est ignoré par git et porte les registres durables.** Un
      `git clean -xfd` détruit le registre d'un run en vol ; constaté le 08-09, douze
      artefacts réels perdus. Forme indécise : déplacer hors du dépôt, ou protéger sur place.
- [ ] **Instruments hors dépôt : porte S4 v7 et baseline `tsc --strict`.** Ils vivent dans le
      répertoire d'audit local, reconstruits à chaque passage. Tant qu'ils ne sont pas dans le
      dépôt, une preuve dépend d'un script joint plutôt que d'un fichier relu. À verser au
      regel. Même famille que la commande d'analyse perdue.
- [ ] **Le manifeste de gel n'enregistre pas les outils de revue** — versions de Claude Code
      et de Codex, empreinte du prompt des relecteurs. Contourné à la main le 08-09.
- [ ] **Le push n'est pas gardé en machine.** Le commit l'est (jeton à usage unique,
      `pre-commit`, `reference-transaction`) ; une adjudication « commit oui, push non » ne
      vit que dans un message — d'où l'écart `PUSH-B` du LOT 9. Candidat de garde, pas
      reproche.
- [ ] **L'écrivain sous R accepte un registre v2 lisible mais `UNKNOWN`** — un `event_seq`
      dupliqué laisse passer un `REVIEWED`. Sans conséquence aujourd'hui (le producteur et la
      porte refusent en amont) ; durcissement distinct, avec falsification de l'absence
      complète d'écriture.
- [ ] **Aucun événement d'après-appel.** L'extension s'abonne à `session_start`,
      `session_shutdown` et `tool_call` ; C6.4 veut aussi une vérification après l'appel.
- [ ] **Aucune surface n'abandonne une lane saine.** `subagent-recover … abandoned` ne traite
      que les contradictions. Hors audit selon Sol : à canoniser d'abord (raison, bail, effet
      sur le worktree, événement durable).
- [ ] **Dettes laissées ouvertes par les deux correctifs**, hors périmètre adjugé : C5, C4/B6,
      C6, C7, D2 avec R15/R20 (diagnostics opérateur, avant généralisation), D3, D5 à D7, B7 ;
      R6/R17 acceptées comme limites de preuve. [A] Partie 1, correctifs UNKNOWN-LEGACY et C4.
- [ ] **Le footer ne dit pas quelle skill est sollicitée.** *La donnée manque d'abord :* la
      liste des skills dans l'artefact (voir phase 5). Afficher ce qui a été observé, ne pas
      observer pour afficher.

### Phase 4 — mémoire portable, écriture seulement

*Condition d'entrée :* le sort de `.agents/memory/` face à la porte d'intégration — versionné
ou ignoré — **tranché avec Sol avant d'activer l'écriture**. `HANDOFF.md` relu à la main deux
fois avant d'avoir un lecteur. [A] Partie 2, 2H, *Mémoire portable et reprise inter-harnais*.

- [ ] Couche `.agents/memory/` — `DECISIONS`, `HANDOFF`, `LEARNINGS`.
- [ ] `pi-session-journal` écrit la mémoire portable — append de `DECISIONS`, régénération de
      `HANDOFF`.
- [ ] Skills canoniques dans `.agents/skills/`, liens `.claude/skills` et `.codex/skills`.
- [ ] Rôles déclaratifs versionnés `.agents/agents/<rôle>.md`, générés vers les autres harnais.

### Phase 5 — banc

- [ ] **`parentArtifact` et la liste des skills dans l'artefact.** *Prérequis du registre de
      findings, du footer et du banc.* Deux champs.
- [ ] **Registre de findings** — rien ne suit un finding de sa levée à sa clôture. Forme
      indécise : mécanisme contraignant ou fichier consultable. *Doit précéder le banc* :
      sans lui, la colonne « findings » compte sans juger la justesse.
- [ ] **Banc minimal sur le corpus gelé**, pi et Claude Code sur un sous-ensemble : réussite
      des tâches **et** findings du reviewer — sans les findings, il ne voit pas la seule
      régression qui coûte. [A] Partie 2, 2H.
- [ ] **Comparaison bornée avec OpenCode** — orientation retenue le 06-10, sur un
      sous-ensemble du corpus gelé, en environnement isolé. Versions, modèles, paramètres,
      budget et métriques fixés au plan ; comparabilité déclarée. Aucune installation dans
      `~/.pi/agent`, aucune migration autorisée.
- [ ] **Épreuve de concision** — une skill courte tient-elle autant qu'une longue ? Jouée sur
      le banc. [A] Partie 2, 2E.

### Phase 6 — contexte

*Chaque changement passe le banc avant et après. Le reste de la liste seulement si la mesure
le justifie.* [A] Partie 2, 2H, *Coût de contexte*, et 2E.

*Décision du 06-10 :* la clôture de LOT-EFFICACITÉ n'ouvre pas de nouveau lot dédié aux
tokens. Leur traitement est rangé ici, après la mesure A de phase 0.

- [ ] Amaigrissement du préfixe du reviewer — le seul poste facturé. *En premier.*
- [ ] Interdictions en prose d'`AGENTS.md` déplacées vers les gardes.
- [ ] Socle d'`AGENTS.md` sous 200 lignes, budget testé.
- [ ] Description de l'outil `task` générée par rôle.
- [ ] Scission d'`AGENTS.md` — part économie, et forme de `task` en profil simple : ce que
      chaque moitié coûte, mesuré, pas estimé.
- [ ] Économie des sorties — ne pas produire, puis ne pas faire entrer.
- [ ] Messages de l'orchestrateur lisibles (30-09) : une unité nommée par ce qu'elle fait à sa
      première mention (pas « W01 »), et ce qui s'est passé plutôt que l'état interne du
      registre. *Après la mesure A.*
- [ ] Injection différée de règles scopées par chemin, déclenchée par le runtime.
- [ ] *Si la mesure le justifie :* Context7, outils rares derrière une recherche d'outils,
      commentaires de mainteneur retirés avant injection, reprises OMP sur le contexte
      (Hashline).

### Phase 7 — profil simple, usages

*Après la mémoire portable (phase 4), dont `HANDOFF` est la matière.* [A] Partie 2, 2D et 2H.

- [ ] `/brief` évalué pour le profil simple seul ; lecteur de `HANDOFF` et d'une queue bornée
      de `DECISIONS` à l'ouverture.
- [ ] `/handoff` proposé automatiquement au seuil de compaction.
- [ ] Cadrer un sujet par questions quand il n'y a pas de bundle.
- [ ] **Run avec `/brief`** — première mesure du dispositif dans son domaine de validité : du
      code existant, une vraie histoire git.
      *Précondition, non négociable :* `rm -rf .pi/` puis régénérer **sur l'état initial**,
      avant la première délégation. Garder le worker en `high` : sinon deux variables.
      *Mesurer, pas le coût — la dispersion l'écrase :* délégations scout, fichiers nommés par
      texte de tâche, tours worker avant la première écriture, nombre de `needs_rework`.

### Phase 8 — orchestration

*Après le gel et le pilote : tout ceci touche l'intégration.* [A] Partie 1 (post-LOT 9) et
Partie 2, 2E et 2H.

- [ ] Porte de preuve à la fin d'un worker — « fini » exige une preuve exécutée par le
      runtime, pas déclarée.
- [ ] Dépendances entre lots et déblocage automatique dans le registre de lanes.
- [ ] Invariant testé : arrêter le parent arrête tous les enfants.
- [ ] **Revue d'ensemble après intégration** — ce qui casse au croisement des lanes.
- [ ] Chaînes de repli et rotation de clés, par rôle (OMP).
- [ ] **Lanes en workspaces éphémères, sans worktree git** — direction de Sol : workspace
      privé, preuves dans un dépôt fantôme durable, suppression après état terminal
      réconcilié, jamais de repli vers la racine partagée. *29-09 :* les worktrees git
      actuels sont **provisoires** (rappel de Mo) ; le QD a montré l'orchestrateur manipulant
      lui-même worktree et branche de lane. Proposé pour le lot qui suit « invariants
      terminales + efficacité » — question posée à Sol avec son plan.
- [ ] Sandbox OS des workers en lane, réseau refusé par défaut.
- [ ] `best-of-n` ponctuel sur une lane — *exception assumée* à l'activation automatique : il
      double le worker et le reviewer.

### Phase 9 — discipline, puis outillage externe

[A] Partie 2, 2E, *Conventions et discipline*, puis 2F et *Modèles et outillage externe*.

- [ ] Garde de dépendance — la part codable de Ponytail : aucune dépendance hors liste sans
      confirmation.
- [ ] Code neuf sans test neuf dans le même diff — en signal d'abord, bloquant seulement si
      un run montre l'infraction.
- [ ] Le reviewer ne peut pas exécuter la suite : « tout est vert » est déclaré par l'auteur.
- [ ] Plancher de couverture — prose, irréductible.
- [ ] **Ponytail — revirement du 13-09 à appliquer :** bibliothèques pratiques plutôt que
      natives, liste nommée + principe + confirmation, dans `python-engineering` seul.
- [ ] Règle d'or des skills — les onze orientées relecture, plus Strategic Forge.
- [ ] Coût des relecteurs — règle opérationnelle pour les campagnes d'audit.
- [ ] *À investiguer :* exécution en arrière-plan (après mesure A), `/btw`, Jev (un seul
      usage, sous conditions).
- [ ] *Outillage externe :* `codebase-memory-mcp` (en prendre des morceaux), reprises OMP,
      critiques de pi relevées dans une vidéo, `pi-session-hub`, export de session vers
      OpenCode et Markdown.

### Phase 9b — versions

*Posée le 30-09 : juste après la clôture du lot ITE, jamais pendant un lot mesuré ; précède la
phase 10.* **Avancée le 06-10 pour pi :** la montée de pi passe juste après la clôture du lot
efficacité, avant la phase 0. [A] Partie 1, *Dépendances d'extensions non épinglées*, et
LOT-EFFICACITE, 06-10.

- [ ] **Inventaire et couche d'adaptation pi** — niveau A, neutre sur 0.86 : ce que la
      configuration utilise de pi, isolé derrière une couche avant toute montée.
- [ ] **Montée de pi par paliers** — 0.87.0 obligatoire, 0.99.0 explicite, version cible
      épinglée ; MCP et codemode désactivés sauf adjudication contraire. Toutes les portes
      et les contrats avec le SDK réel sont éprouvés à chaque palier ; des stubs seuls ne
      suffisent pas. Un run QD de référence après le dernier palier conforme.

- [ ] **Monter les versions laissées en attente, une à la fois** — système et outils, puis
      Node, puis pi, puis les extensions non épinglées. Tout a été qualifié sur un
      environnement figé (pi 0.86.0, Node v26.10.0) ; après chaque montée, toutes les portes
      rejouées, et un run QD de référence après pi. Ce qui peut casser en silence : l'API des
      extensions, la compaction, les formats JSONL lus par les instruments, le catalogue de
      modèles. L'épinglage de pi dans les scripts se change par un commit explicite.
      *Pour pi, tranché le 06-10 (items ci-dessus).* Le QD conforme après le dernier palier
      devient la nouvelle référence de version ; les anciennes baselines restent immuables.

### Phase 10 — modèles

*Posée le 30-09, après tous les lots mesurés.* [A] Partie 2, 2E, *Modèles des rôles*.

- [ ] **Passer chaque rôle au dernier modèle de sa famille** — mise à jour de pi pour son
      catalogue, un commit par rôle, appel réel du modèle exact, run de référence et banc
      avant/après. Les identifiants exacts sont gardés : les noms génériques de pi choisissent
      par sous-chaîne et ordre alphabétique, pas par version. *L'avertissement au chargement*
      (« plus récent disponible », jamais de bascule automatique) peut venir plus tôt, hors de
      tout lot mesuré.

### Hors phase — faisable à tout moment

*Ne touche ni le contexte ni l'intégration.*

- [ ] `.gitignore` global de la machine, sans ancrage.
- [ ] Puces colorées dans les récapitulatifs.
- [ ] Nommage des sessions — dériver à la lecture, pas à la fermeture.
- [ ] Deux détails de méthode repris d'OMP, sans rien installer.
- [ ] **Remplacer la copie de Strategic Forge installée sur Claude.ai.** *Aurait été
      une précondition du pilote si son bundle avait été régénéré — écarté le 27-09, P0-11
      adjugé en migration contrôlée.* Vérifié le 27-09 :
      elle a **pris du retard sur le dépôt sans que personne n'y touche** — l'installation du
      LOT 9 (`94eae75`) a réécrit `templates/pi/DESIGN.md` et `templates/pi/INSTRUCTIONS.md`
      pour la grammaire de `design_update`. La copie Claude.ai produit donc encore des
      `DESIGN.md` en `To implement | Implemented | Roadmap`, que C6.1 refuse. Son `SKILL.md`
      cite en plus `pi-diff-review`, supprimé. *Geste :* recharger le dossier
      `claude/strategic-forge/` du dépôt dans la skill. *Au passage :* la liste d'extensions
      de `SKILL.md` n'a ni `pi-secret-gate` ni `pi-session-journal`, aux deux endroits ; et la
      cible `claude-code` garde l'ancien vocabulaire — aligner, ou l'assumer par écrit.
      *Activation manquante :* rien ne signale une divergence entre les deux copies — il y en a
      deux à ce jour, `SKILL.md` et les modèles. Candidat : une empreinte du dossier dans `pi-check-config`, comparée à
      une empreinte déclarée à chaque mise à jour de la skill.

### Conditionnels

- [ ] ~~Règle de découpage des tâches worker~~ — **sans objet**. Le run 4 montre un étalement
      sans concentration sur le plafond, et l'exploration à 88 % en première moitié écarte la
      redécouverte. Ne rien réécrire du bundle.
      *Ancien libellé, conservé :* si et seulement si un run montre un étalement jusqu'à 30. Le critère d'`AGENTS.md:385` — « plus de la moitié des tours » —
      condamne la tâche médiane (11,5 tours sur 20 au run 3). La version proposée porte sur le
      nombre de fichiers qu'on s'apprête à nommer, pas sur une prédiction de tours.
- [ ] **Second run worker à `thinking: medium`**, si et seulement si le rendement continue de
      se dégrader sur un run de plus.
      Repère mesuré au run 3 : 161 tours pour 45 tests ajoutés, contre 142 pour 41 au run 2 —
      soit 3,58 tours par test contre 3,46. Le rendement est plat ; le worker a fait plus, pas
      moins bien.

- [x] **Identifiant de flux par livrable** — idée de Mo, après le run 12. *Devenu le chantier
      `3c` : lanes par unité de travail, isolation par worktree, registres durables — voir
      « Chantier de parallélisation » plus haut.* Le libellé d'origine est conservé.
      Chaque délégation
      porte le livrable qu'elle sert ; à terme un couloir par livrable, chacun avec sa propre
      séquence.
      *Ce que ça débloque :* `HISTORY`, `sinceReview` et `wroteNothing` sont aujourd'hui des
      structures globales qui supposent une ligne de délégations ordonnée. En `Map<laneId, …>`
      la garde de série redevient sensée — une séquence par couloir — et le reviewer retrouve
      un diff attribuable. La plomberie de dispatch existe déjà : `tasks[]` + `allSettled` est
      générique, seul le scout multiplie ses tâches (`index.ts:610`).
      *Ce que ça ne règle pas :* l'isolation disque. Un identifiant sans `git worktree` par
      couloir est de la comptabilité posée sur une course. Et la réconciliation de fin de
      couloirs n'a pas de titulaire — l'orchestrateur ne code pas.
      *La vraie forme :* les livrables 2 à 11 importent ce que le 1 a créé. Ce n'est pas onze
      couloirs, c'est un préfixe série puis un éventail. Où l'éventail commence est une
      propriété du bundle, à déclarer par Strategic Forge, pas à inférer par l'orchestrateur —
      sinon on repaie en scouts ce qu'on gagne en horloge.
      *Valeur immédiate, à concurrence 1 :* le champ seul permet de lire les questions scout
      par worker **par livrable** au lieu d'une moyenne sur quinze. C'est l'angle mort de la
      cible ≤ 1,5 — un worker peut légitimement demander trois localisations. Coût : un champ
      dans le schéma de `task` et dans l'artefact. Donc pas dans le run 12 : ça change le
      schéma de l'outil.
      *Règle, non négociable :* le champ est auto-déclaré par l'orchestrateur. Tant qu'il ne
      sert qu'à mesurer, un mauvais label coûte de la précision. **Ne jamais brancher une garde
      sur un champ que le modèle remplit lui-même.**
      *Note de méthode :* le gain est le mur d'horloge, pas le coût — la parallélisation ne
      retire pas un token. À confronter avec gpt sol avant de toucher l'architecture.

### ~~Séquence Qwen / advisor~~ — close

Qwen n'a jamais été atteint et la piste est abandonnée, pas réfutée : trois clés, trois
régions, un 403 `AccessDenied.Unpurchased` inchangé. Le reviewer reste sur Sonnet après deux
portes mesurées, et l'advisor est en service sur `grok-4.6`. Voir *Portes de modèle*.

### ~~Le test final — régime libre~~ — fait

Deux benchmarks : `transactions-etl` avec ses six pièges, et la bibliothèque de récurrence
depuis un dossier vide, en lecture aveugle. Voir *Régime libre*. Ce qu'ils ont appris sur la
méthode, et qui vaut pour le prochain : **un livrable coupé de la conversation qui l'a produit
ne se juge pas.** La lecture en aveugle reste le bon garde-fou contre le biais d'attribution,
mais elle doit porter sur le code **plus les escalades**, anonymisées de la même façon.

### ~~Bascule locale du worker et du scout~~ — abandonnée (2026-09-24)

Évaluée sur la machine de travail : aucun modèle local dans une fourchette de mémoire
raisonnable n'approche `gpt-5.6-terra` en qualité ou en vitesse, et un scout local tourne à
moins de la moitié du débit de DeepSeek V4.1-Flash en API, pour un coût cloud déjà
dérisoire. Worker et scout restent dans le cloud. **Seule condition de réouverture :** un
besoin de confidentialité spécifique. Le relevé de dépense survit à l'abandon, avec une autre
finalité (phase 0). [A] Partie 2, 2G.

### Dette, sans urgence

- [x] `cache/deepseek-models.json` suivi par git alors qu'il est régénérable — *retiré de
      l'arbre et `cache/` ignoré par `PORTES-GEL` v4, gelé dans `83eb62a` le 27-09* —
      `git rm --cached` + `cache/` au `.gitignore`, en commit séparé.
- [ ] ~~**Mesure A jamais lancée**~~ — *remontée en phase 0 le 26-09.*
- [ ] ~~`parentArtifact` et la liste des skills dans l'artefact~~ — *en phase 5, prérequis.*
- [ ] ~~**Registre de findings**~~ — *en phase 5, avant le banc.*
- [ ] `main` à jour : `git push --force-with-lease origin feat/subagent-extension:main`.
      *Un push :* sur adjudication de Sol, après le gel.

---

## Comment tenir ce fichier

Une entrée par run, écrite **après** l'analyse et pas avant : le run, ses chiffres, ce qu'il a
révélé, ce qu'il a corrigé. Une tâche cochée garde sa ligne — c'est l'historique qui a permis
trois fois de retrouver une cause dans un fichier qu'on ne regardait pas.

*Depuis le 26 septembre :* ce qui arrive entre deux mises à jour s'écrit d'abord dans une
boîte d'attente hors du dépôt, au même format ; sa synthèse se porte ici à chaque clôture de
lot ou de gel, dans un commit de documentation seul. Pour ce portage du 06-10, la boîte
d'attente reste entière : le commit ne vaut ni archivage ni autorisation de la vider.
Une publication ultérieure d'archive fera l'objet d'une livraison documentaire distincte,
après relecture de `A-RELIRE-AVANT-PUBLICATION.md` et des octets destinés au dépôt.
