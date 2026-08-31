# Suivi — configuration pi

*Journal des runs et liste des tâches. Une ligne par run : ce qu'il a mesuré, ce qu'il a
corrigé. Une case par tâche restante : sa condition d'entrée et son chiffre de contrôle.*

Branche `feat/subagent-extension`. État courant : `85d5644` + le lot de sortie unique.
`CHANTIER.md` fait foi sur les décisions et leurs raisons ; ce fichier sur ce qui a été fait
et ce qui reste.

---

## Configuration au 29 août 2026

| Rôle | Modèle | Thinking | Session | Tours | Outils |
|:--|:--|:--|:--|--:|:--|
| worker | `openai-codex/gpt-5.6-terra` ⁴ | `high` | éphémère | **30** ¹ | read, grep, find, ls, bash, edit, write |
| reviewer | `anthropic/claude-sonnet-5` | medium | éphémère | **12** ² | read, ls |
| scout | `deepseek/deepseek-v4-flash` | low ³ | éphémère | 12 | read, grep, find, ls, bash |
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

Huit extensions : `bash-guard`, `pi-bq-cost-sentinel`, `pi-check-config`, `pi-lint-gate`,
`pi-project-brief`, `pi-secret-gate`, `subagent`, `subagent-footer`.

Suite de tests : `bin/test-guards`, **156 cas**. Quatre modules feuilles sans import pi —
`fanout.ts`, `attempts.ts`, `tree.ts`, plus les fonctions pures de `run-state.ts` — existent
pour que les tests appellent la production au lieu de la recopier. Chacun a été extrait après
qu'un défaut est passé sous une suite verte qui décrivait sa propre copie.

---

## Références stables — les chiffres à comparer

| Projet | Run | Délég. | Tours | Coût | Échecs |
|:--|:--|--:|--:|--:|--:|
| `csv-to-bq` (360 l.) | `37acf6` | 12 | 56 | 0,60 $ | 0 |
| `csv-to-bq` | `f414d3` | 13 | 57 | 0,68 $ | 0 |
| **dispersion mesurée** | | **8 %** | **2 %** | **13 %** | |
| Balance Âgée (2 978 l.) | run 2 `6fcfbb` | 53 | 369 | ~3 $ | 3 |
| Balance Âgée | run 3 `b9baad` | 39 | 296 | ~3 $ | 0 |
| Balance Âgée | run 4 `2cab6c` | 40 | 303 | ~3,5 $ | 0 |
| Balance Âgée | run 5 | 34 | 274 | ~4,4 $ | 3 |
| Balance Âgée | run 6 `48acec` | 40 | 317 | 3,59 $ | 1 |
| Balance Âgée | run 7, dernier Sol | 42 | — | 4,37 $ | 0 |
| Balance Âgée | run 9, premier Terra | 14 | 124 | — | 0 |
| Balance Âgée | **run 10 `a1c83f`** | **40** | **330** | **3,64 $** | **0** |
| `transactions-etl` | régime libre | 14 | — | 1,19 $ | 0 |
| Balance Âgée — Claude Code | — | — | — | — | 1 h 12, 165 tests |

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

### Balance Âgée — dix runs

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
      réellement indépendants. Balance Âgée n'en est pas un.

- [x] **run 9 `1d6f3e`** — premier run worker sur Terra. 14 délégations, 124 tours, zéro échec,
      médiane worker 11, plafond de 30 jamais approché. Reviewer Sonnet : 14 findings sur 17
      revues au run 7 contre 4 `needs_rework` ici.
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

### Portes de modèle

- [x] **Reviewer, deux portes sur `anime-etl`**, fichiers aux défauts vérifiés à la main.
      **Gemini 3.7 Flash** retrouve deux défauts sur trois, rend `approved` avec zéro finding
      sur une double boucle quadratique réelle, et atteint son plafond sans rendre d'enveloppe
      en `high`. **DeepSeek V4 Pro** fait jeu égal fichier par fichier — quatre sur cinq
      chacun, zéro faux positif sur le témoin — puis s'effondre à l'échelle : **un finding sur
      onze revues** sur Balance Âgée contre quatorze sur dix-sept pour Sonnet.
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

### Bundle Balance Âgée

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

---

## Ce qui reste

### En cours

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


- [ ] **Lire un module de Balance Âgée en entier**, avec les sept critères de la revue en
      aveugle. Dix runs mesurent des défauts **prévus** et des diffs ; personne n'a jamais lu
      le livrable d'un œil critique. 161 tests au vert ne disent rien de la qualité de lecture.
      *Candidats :* `status.py` ou `io.py`.

### Ensuite

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

- [ ] **Run avec `/brief`** — première mesure du dispositif dans son domaine de validité : du
      code existant, une vraie histoire git.
      *Précondition, non négociable :* `rm -rf .pi/` puis régénérer **sur l'état initial**,
      avant la première délégation. Garder le worker en `high` : sinon deux variables.
      *Mesurer, pas le coût — la dispersion l'écrase :* délégations scout, fichiers nommés par
      texte de tâche, tours worker avant la première écriture, nombre de `needs_rework`.

- [ ] **Identifiant de flux par livrable** — idée de Mo, après le run 12. Chaque délégation
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

### Dette, sans urgence

- [ ] `cache/deepseek-models.json` suivi par git alors qu'il est régénérable —
      `git rm --cached` + `cache/` au `.gitignore`, en commit séparé.
- [ ] **Mesure A jamais lancée** : ce qui remplit le contexte du worker. Trois causes possibles,
      trois correctifs incompatibles — texte de tâche, sorties de `pi-lint-gate`, relectures.
- [ ] `parentArtifact` et la liste des skills dans l'artefact. Deux champs, et le registre de
      findings devient possible.
- [ ] **Registre de findings** — rien ne suit un finding de sa levée à sa clôture. Forme
      indécise : mécanisme contraignant ou fichier consultable, ce n'est pas le même code.
- [ ] `main` à jour : `git push --force-with-lease origin feat/subagent-extension:main`.

---

## Comment tenir ce fichier

Une entrée par run, écrite **après** l'analyse et pas avant : le run, ses chiffres, ce qu'il a
révélé, ce qu'il a corrigé. Une tâche cochée garde sa ligne — c'est l'historique qui a permis
trois fois de retrouver une cause dans un fichier qu'on ne regardait pas.
