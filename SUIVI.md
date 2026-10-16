# Suivi — configuration pi

*Journal des runs et liste des tâches. Une ligne par run : ce qu'il a mesuré, ce qu'il a
corrigé. Une case par tâche restante : sa condition d'entrée et son chiffre de contrôle.*

*Mise à jour du 16-10-2026 (portage de la clôture de la phase 3).* **État courant :** branche
`feat/subagent-extension`, tête distante et commit publié `186aac98a207b84cd0ddfca6fe0a34b4b127ed07` (C5), arbre
`2ec4adf4089ee01bb60d1e30f7769c14bf05660f`, au bout d'une chaîne de six commits à parents uniques posée sur
`604e89487e0eee2fa37ddfde7429aa3a41f785df` (code de la phase 0, arbre `cffdccab…`) : C0 `59ab3aee…` (portage de
la clôture de la phase 0, textes `7d449fd6…` / `2f566df3…`, arbre `65b1d2c1…`), C1 `54eb40e6…`, C2 `1672db59…`,
C3 `3bc6ba86…`, C4 `4ca90fda…` et C5. Établissement (acte 1) et publication (acte 2) adjugés conformes par Sol
le 16-10. **La phase 3 est achevée au niveau A, dans le périmètre adjugé P1, P2, P3, D1 et D2** (décision
`e87b4ea6…`), ce qui n'est pas la fermeture de toute dette historique : les limites reçues à la livraison et le
backlog restent entiers (voir *Phase 3* et *Ce qui est fait*). **La reprise ordinaire de pi 0.86.0, avec quatre
crochets actifs (pre-push compris), est autorisée à Mo ; ce portage ne constate aucune reprise effective.**
Règle d'exploitation nouvelle : tout push de ce dépôt exige une autorisation exacte à usage unique, créée par
l'opérateur ou sa recette, jamais par un agent, et les agents ne contournent pas les crochets (`--no-verify`
exclu). **Le candidat technique qualifié demeure `2def810f56d96bb459716efda4d409028b14de72`, arbre
`b1a99caa0e31e96cbc5279dbca19781335ac764b`** (LOT-PI-ADAPT, clos le 13-10), identité historique : aucune
qualification générale de pi, montée de version ni mesure QD n'est déduite de la phase 3, et la phase 0 reste
close au niveau B, « attribution non établie ». **Prochaine phase selon l'ordre du 08-10 : la phase 2**, qui
conserve son plan préalable, à soumettre ; sa construction n'est pas autorisée. maxParallel reste en phase 8 et
la montée de pi en phase 9b.

*État du 15-10-2026 (portage de la clôture de la phase 0), remplacé le 16-10 par le paragraphe ci-dessus et
conservé — « la prochaine phase » et « aucune construction de phase 3 » y décrivent l'état du 15-10 :* branche
`feat/subagent-extension`, tête distante et commit publié `604e89487e0eee2fa37ddfde7429aa3a41f785df` (code
de la phase 0, parent unique `32e2b3cb…`), arbre `cffdccabbd958e22c5a30a249a40007eb02d2647`, au-dessus de
`32e2b3cb7c1d014d64a79f24bf64ac5965b2cadd` (POST-3c, commit documentaire, parent unique `8ac87262…`), arbre
documentaire `7ddf6c0d9aa2fd986699c621d2a1b1e08b6c3a6b`. Publication jugée conforme par Sol le 15-10 (tête
distante relue avant `8ac87262…`, après `604e8948…`). **La phase 0 — mesure A et relevé de dépense — est
achevée dans son périmètre de niveau B ; son résultat est « attribution non établie »**, le résultat prévu par
le cadre et non un échec à réparer. Le rapport faisant référence est le rapport historique de r5
(`69228b2b…`) : ses premiers postes sont des classements descriptifs estimés, jamais des causes, et la mesure
ne qualifie rien (voir *Phase 0* et *Ce qui est fait*). **Le candidat technique qualifié demeure
`2def810f56d96bb459716efda4d409028b14de72`, arbre `b1a99caa0e31e96cbc5279dbca19781335ac764b`** (LOT-PI-ADAPT,
clos le 13-10) : la publication de l'instrument ne transforme pas la mesure en qualification, en gel ni en
référence sur cette identité. La reprise de pi 0.86.0 en usage ordinaire, crochets actifs et configuration
conservée, est autorisée (décision de Sol, 15-10). **Prochaine phase : la phase 3, avant la phase 2, sur un
plan préalable à adjuger** ; aucune construction, activation ni exécution de phase 3 avant cette
adjudication. maxParallel reste en phase 8 et la montée de pi en phase 9b. Le résultat non établi n'autorise ni
optimisation des phases 5 ou 6, ni nouveau QD, ni changement de contexte.

*État du 15-10-2026 (portage POST-3c), remplacé le 15-10 par le paragraphe ci-dessus et conservé — « le
présent portage » y désigne POST-3c :* branche `feat/subagent-extension`,
tête distante et commit publié `8ac87262ed01f38ad5e19dbf375a9420f04bcaf6` (POST-3b, commit
documentaire, parent unique `aa0fc55c…`), arbre documentaire
`a53c81ef3de406c5e83b3761f52a837544474ceb`. **Le candidat technique qualifié demeure
`2def810f56d96bb459716efda4d409028b14de72`, arbre `b1a99caa0e31e96cbc5279dbca19781335ac764b`**
(LOT-PI-ADAPT, clos le 13-10) : ses portes ne sont pas présentées comme rejouées sur les arbres
documentaires. pi 0.86.0 reste en usage ordinaire, crochets actifs. POST-3 (`aa0fc55c…`) et POST-3b
(`8ac87262…`) sont publiés et achevés ; le nettoyage borné est achevé, avec son écart de séquence P1/P2
maintenu ; maxParallel est seulement inscrit en phase 8. **La phase 0 n'est pas lancée : son plan est
adjugé, sa réalisation est à venir** (voir *Phase 0*). Le présent portage, POST-3c, est documentaire et
précède tout code de phase 0 ; il ne porte aucun résultat de mesure.

*État du 14-10-2026 (portage POST-3), remplacé le 15-10 par le paragraphe ci-dessus et conservé :*
branche `feat/subagent-extension`, commit publié `6a73e9ee1a84aad73e36756dad5556509a6019f9` (POST-2,
commit documentaire, parent unique `2def810f…`), arbre documentaire
`77d12c5b89cd1ccb4eadfbe363231168955f86df`.

Branche `feat/subagent-extension`. Chaîne des états : `c42f2d4` (correctif pré-pilote C4, arbre
`3a7de843`), puis `83eb62a` (`PORTES-GEL` v4, arbre `82a9b1b8`), **gelé par Sol et poussé le 27-09**, puis `a562579`
(LOT-PP, arbre `c43749c0`), **gelé et poussé le 29-09**, puis `85c5519` (lot ITE, ITE-1c, arbre
`78491822`), **gelé et poussé le 29-09**, puis `383a5f3` (lot ITE, P1, arbre `6b362b18`),
**gelé et poussé le 30-09**, puis `cc88bb20` (LOT-REPRISES, non poussé seul), puis `1e07ae13`
(LOT-REPRISES-CORRECTIF, arbre `6c03bd41`), **gelé et poussé le 01-10**, puis `555b202f` (lot
efficacité, arbre `8b821da4`), **gelé et poussé le 06-10**, puis `2def810f` (LOT-PI-ADAPT, arbre
`b1a99caa`), **établi, gelé et poussé le 13-10**, puis `6a73e9ee` (POST-2, arbre `77d12c5b`),
**établi et publié le 14-10**, puis `aa0fc55c` (POST-3, arbre `efb2ccd5`), **établi et publié le
14-10**, puis `8ac87262` (POST-3b, arbre `a53c81ef`), **établi et publié le 15-10**, puis `32e2b3cb` (POST-3c, arbre `7ddf6c0d`) et `604e8948` (code de la
phase 0, arbre `cffdccab`), **établis le 15-10 (13:34Z) et publiés le 15-10 (15:10Z)**, puis
`59ab3aee` (C0 : portage de la clôture de la phase 0, arbre `65b1d2c1`), `54eb40e6` (C1, arbre `55c04cfd`),
`1672db59` (C2, arbre `768735ea`), `3bc6ba86` (C3, arbre `50e065a8`), `4ca90fda` (C4, arbre `948262e9`) et
`186aac98` (C5, arbre `2ec4adf4`), **établis le 16-10 (08:41Z à 09:15Z) et publiés le 16-10 (10:09Z)**.
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

*Portes du candidat `b1a99caa` — LOT-PI-ADAPT, qualification Mac r4 du 13-10 (pi 0.86.0, Node 26.11.1) :*
`bin/test-guards` **1052 + 211**, `l0-check` **246**, `l0-mutants` **312** sans anomalie,
`lanes-concurrency` 4/4. Typage retenu des campagnes : N4 comparatif en bac, 13/13 diagnostics avec
multiplicités, aucun nouveau ni disparu ; S4 sur Mac r4, principal 127 → 125 et extensionless 33 → 33. Les comptes des paragraphes
précédents restent historiques, datés de leur gel. *Aucune de ces portes n'a été rejouée sur l'arbre
documentaire `77d12c5b` du 14-10.*

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

### LOT-PI-ADAPT, POST-1 et POST-2 — clôture, activation et documentation (13-10 → 14-10)

*Trois acquis, inscrits séparément. Pièces faisant foi : les adjudications de Sol du 13-10
(clôture ; POST-1 établi) et du 14-10 (POST-2 achevé, POST-3 ouvert), les retours d'établissement
et de publication de POST-2, et les textes publiés. Les audits restent sous
`/Users/MoG/audits/couche-pi/`, hors dépôt. Détail historique : [A] Partie 1, LOT-PI-ADAPT.*

- [x] **LOT-PI-ADAPT — clos le 13-10, niveau A, neutre sur pi 0.86.0.** Code qualifié, établi et
      publié par `2def810f56d96bb459716efda4d409028b14de72`, parent unique
      `b54532045e1305bd48ee93ea8fdebdcca534b847`, arbre `b1a99caa0e31e96cbc5279dbca19781335ac764b`,
      branche `feat/subagent-extension` sur `origin`. 256 fichiers suivis, delta 49 (41 ajouts,
      8 modifications) ; message `feat(pi-adapt): contrats et couche d'adaptation pi 0.86.0`. Les
      items 1 à 3 sont reçus dans le périmètre du plan ; chaîne d'établissement (E), de gel (G) et de
      publication (P) conforme, manifeste du lot
      `bd29e286ea08d04f5ae079985717c4dc596ec930656a2be4e8f1446ce73ff50e` (494 entrées).
      **Cela ne clôt pas P3 ni toutes les surfaces de pi.** Texte de clôture adjugé le 13-10, repris
      sans changement (ses mentions « POST-1 en préparation seulement » et « POST-2/POST-3 … soumis à
      leurs décisions propres » sont dépassées par les deux entrées suivantes) :
      ```text
      LOT-PI-ADAPT — CLOS le 13-10-2026, niveau A, neutre sur pi 0.86.0, avec les limites adjugées
      maintenues. Candidat qualifié en bac et sur Mac Node 26.11.1, établi par E, gelé par G et publié par
      P conformes. Commit 2def810f56d96bb459716efda4d409028b14de72, parent unique
      b54532045e1305bd48ee93ea8fdebdcca534b847, arbre b1a99caa0e31e96cbc5279dbca19781335ac764b ; sur
      origin, refs/heads/feat/subagent-extension concorde au relevé après P. Aucun QD nouveau ni montée de
      pi. Reprise d’usage ordinaire de pi 0.86.0 autorisée. POST-1 en préparation seulement ;
      POST-2/POST-3 et nettoyage restent soumis à leurs décisions propres.
      ```
      *Preuves, attribuées au candidat `b1a99caa` et à ses campagnes (synthèse ; les pièces sont dans
      les audits) :*
      - bac Node 22.22.0 et 26.11.1 ; Mac r4 : Node 26.11.1, pi 0.86.0 ; M1–M7 atteints ;
      - N5 : 27/27 exécutions, 85/85 verdicts ; C2 chargements 12/12, enregistrements 21/21,
        comportements 11/11 ; aucun constat, N6 sans différence ; 2 résumés et 45 tours comptés
        séparément ;
      - portes du candidat : `test-guards` 1052 + 211, `l0-check` 246, `l0-mutants` 312 sans anomalie,
        lanes 4/4 ;
      - typage : N4 comparatif 13/13 diagnostics avec multiplicités, aucun nouveau ni disparu ; S4
        principal 127 → 125 et extensionless 33 → 33 ; compilations ciblées des variantes d'instrument
        bac/Mac réalisées dans le bac sous Node 22/26. **Aucun « typage global vert »**, et aucune
        compilation ciblée prétendue sur le Mac ;
      - D1′ : résolutions Node non chargées rattachées à jiti, cible et parent évalués dans le même fil,
        avant ou après ; N5 Mac/n26 : C6.2 = 5, C2.9 = 44, C2.10 = 5, autres à zéro. Les échecs de
        résolution restent séparés des délégations réussies.

      *Limites maintenues ouvertes (renvoi `docs/MONTEE-PI.md`, § 8) :*
      - **D-P3-N1 / TMPDIR** — N1 non portable au TMPDIR macOS par défaut ; seules les portes M4 à
        `/Users/MoG` (10 caractères) sont qualifiées ; témoin à 12 caractères en échec, sans seuil
        universel. Dette de phase 3, non bloquante pour la clôture obtenue ;
      - **O1-7 / D-P3-PI-SURFACE-METADONNEES** — un `.DS_Store` peut produire un refus du scanner de
        surfaces. Dette de phase 3 ;
      - **O1-4** — `PI_VERSION_QUALIFIEE` est une déclaration, pas la garde effective ; liaison à
        l'identité contrôlée à planifier avant toute montée. On n'en déduit pas le comportement garanti
        des autres versions ;
      - **O2-1** — instrument interne et instrument externe distincts. Le CLI interne n'est pas annoncé
        comme requalification opérationnelle de la production établie. Instrument externe historique de
        18 fichiers sous `/Users/MoG/audits/couche-pi/qualif-mac-correctif-r4/paquet/instrument/`, lié
        au candidat et aux chemins qualifiés ; chaque cible future exige son identité et son instrument
        qualifiés ;
      - **O2-4 et portabilité** — formes jiti `fallback` et `json` non revendiquées comme éprouvées ;
        autres exclusions conservées ; pas de portée générale Bash 3.2 ni TUI, pas de qualification des
        fournisseurs réseau ;
      - **P3 non clos** — plan complémentaire des surfaces restantes exigé avant la montée (voir
        `MONTEE-PI`) ; le registre livré n'est pas une preuve exhaustive des événements, de
        `ctx.compact`, des formats JSONL ni des usages hors adaptation.

      *Conservation maintenue :* aucun nettoyage automatique du bac, des temporaires ou des audits du Mac
      n'est ouvert par ce portage.

- [x] **POST-1 — établi le 13-10 : activation locale des trois crochets qualifiés.** Aucun commit ni push
      pour cette activation. Six jugements Mac **0/1/0/1/0/1** (`commit-msg`, `pre-commit`,
      `reference-transaction` : cas ordinaire accepté, cas fautif refusé). **Configuration locale : ajout
      de la seule clé `core.hooksPath`** — pas « configuration inchangée ». Manifeste de l'activation
      `f0f05f93225c5b47759ac74c06ca112eb962af82cac5d7ed1c1b2fe7864f550e` (192 entrées).
      *État actuel :* `core.hooksPath=/Users/MoG/.pi/agent/git-hooks`, local ; trois fichiers actifs
      (`commit-msg`, `pre-commit`, `reference-transaction`), empreintes qualifiées, mode 755. Le chemin
      absolu sélectionne les crochets principaux pour les contextes dont la configuration effective le
      reprend ; il n'isole pas physiquement les crochets. Mac POST-1 : un worktree principal ; contexte
      lié avec espace éprouvé seulement dans les fixtures Linux. Une activation locale ne vaut pas
      activation globale dans les autres dépôts.
      *`commit-msg` :* `<type>[(<scope>)][!]: <subject>` ; types `feat`, `fix`, `refactor`, `perf`,
      `docs`, `test`, `chore`, `ci`, `build` ; scope optionnel ; première lettre du sujet en minuscule,
      pas de point final, **première ligne de sujet non vide et non commentée de 72 caractères au plus,
      préfixe type/scope/! et séparateur inclus, comptée par Bash**.
      L'impératif est une règle de rédaction, non une propriété vérifiée par regex. Exceptions de préfixe
      (espace final inclus) : `Merge `, `Revert `, `fixup! `, `squash! `, `amend! ` — à ne pas employer
      pour contourner un refus. Les messages du runtime `chore(subagent): …` n'ont aucune exemption ;
      leurs longueurs réelles restent non qualifiées. **Jamais `--no-verify`** : un refus est rapporté
      puis impose l'arrêt, sans raccourcissement ni répétition automatique.
      *`pre-commit` et `reference-transaction` :* refus si `PI_SUBAGENT_ROLE` est non vide (phase
      `prepared` pour le second) ; une variable vide n'est pas refusée. Ils ne rendent pas Git
      intégralement en lecture seule, ne prouvent pas à eux seuls l'impossibilité d'un push enfant et ne
      constituent pas un jeton de commit à usage unique. Les mentions de jeton plus haut dans ce fichier
      sont historiques ; le mécanisme TOKEN de `bash-guard` reste distinct pour les commandes qu'il
      intercepte et n'est pas une propriété de ces crochets. **La dette de garde du push reste ouverte**
      (phase 3).

- [x] **POST-2 — achevé le 14-10 : documentation.** README, nouveau `docs/MONTEE-PI.md` et skill
      `git-collaboration` — deux modifications, un ajout. Commit documentaire
      `6a73e9ee1a84aad73e36756dad5556509a6019f9`, parent unique `2def810f…`, arbre
      `77d12c5b89cd1ccb4eadfbe363231168955f86df`, message
      `docs(pi-adapt): document closure, pi upgrade and commit hooks`, **établi** (trois crochets actifs,
      aucun push) **puis publié** sans force ni tags : tête distante avant `2def810f…`, après
      `6a73e9ee…`. Manifeste de la publication `475985f60ffe03bdf28319610713ff471a286e3c599c41e11f0798dfcac49333` (160 empreintes).
      Empreintes des documents adjugés : README `1bd25cdc…`, `MONTEE-PI` `f0f6dbde…`, skill
      `8626c327…`. **Aucun nouveau run de qualification, QD ou changement de pi** dans ce commit
      documentaire ; la reprise d'usage ordinaire de pi 0.86.0 est autorisée. Le candidat technique
      qualifié reste l'arbre `b1a99caa…`.
      *Portage POST-3 (ce fichier, `CHANTIER.md`, boîte privée) :* préparé dans une livraison neuve,
      relue par Sol ; la pose, le commit et son éventuelle publication attendent sa décision.
      *[15-10, achevé :]* ce portage a été posé, commité et publié par POST-3 puis POST-3b — voir la
      section suivante.

### POST-3, nettoyage borné, POST-3b et reprise (14-10 → 15-10)

*Pièces faisant foi : les adjudications de Sol des 14 et 15-10 (textes POST-3 ; établissement et
publication ; inventaire de nettoyage, reprises et banc du nettoyage, M1 ; maxParallel ; POST-3b ;
réception de la reprise ; décision de reprise), les retours d'établissement et de publication, et le
registre des résultats, hors dépôt. Ce portage distingue les actes (exécutés par Mo), les observations
(rapportées par Claude) et les adjudications (de Sol) ; les écarts déclarés ne sont pas effacés par les
constats finaux conformes.*

- [x] **POST-3 — publié et achevé (14-10).** Textes adjugés avec corrections de Sol, posés dans le
      Projet (3/3 conformes), puis commit documentaire `aa0fc55cc1ca448daf7971f4ca04d0d4ca519d09`,
      parent unique `6a73e9ee…`, arbre `efb2ccd5…`, 257 fichiers suivis, message adjugé, **établi** une
      fois par Mo (22:21Z, aucun push) **puis publié** (22:43Z) sans force ni tag : tête distante avant
      `6a73e9ee…`, après `aa0fc55c…`. Manifestes des retours : établissement `6a152e2e…`, publication
      `71bfc4a3…`. Déclaré **achevé** par Sol (`2afa4ea4…`, 15-10) ; candidat technique inchangé
      (`b1a99caa…`).
- [x] **Nettoyage borné — achevé le 15-10, avec écarts déclarés.** Sur l'inventaire en lecture seule
      (`44042cc7…`) et la liste fermée adjugée par Sol (`928dc2fa…`) : M1 (archive redondante du Mac),
      B1 à B4 (mondes des bancs POST-2 R1, POST-2 R2 en deux passages et POST-3 R1, dans le bac) et P1, P2
      (copies Projet de l'ancien transit POST-3 et des sources POST-3, 21 documents).
      B1 et B2 retirés conformes. **Arrêts avant l'acte, sans suppression**, sur B3 : d'abord un fichier de
      résultats rangé dans la cible, puis des refus de lecture dans la recherche des références
      (décisions de Sol `64ce61fa…`, puis `37596117…`). Collecteur root et script de retrait corrigés ; banc de reprise conforme au
      troisième passage, après deux arrêts de banc déclarés (`a450cceb…`) ; B3 et B4 retirés conformes ;
      P1 et P2 retirés, chacun après relecture de taille et d'empreinte (état final jugé conforme par Sol,
      `6d04531c…`) ; M1 autorisé en deux temps (`6d04531c…`) et exécuté par Mo (contrôle, puis retrait), avec
      un jugement de références rendu conforme par Claude ; nettoyage déclaré achevé par Sol (`e5b56ba9…`).
      **Écart de séquence P1/P2 maintenu :** le Projet n'a pas été listé après chaque retrait (un listage
      avant P1, un après P2) ; l'état final est conforme et l'écart n'est pas effacé. **Aucune autre
      conservation n'est levée.** Ce nettoyage n'ouvre ni montée de pi, ni mesure A, ni QD.
- [x] **maxParallel, puis POST-3b — publié et achevé (15-10).** Proposition de Mo, inscrite en phase 8
      (mesure de la valeur ; plan à adjuger ; aucun réglage changé). Textes corrigés par Sol (`SUIVI.md`
      `bc62cdbb…`, boîte privée `426eb7dc…`), posés dans le Projet (2/2) après le nettoyage. Commit
      documentaire `8ac87262ed01f38ad5e19dbf375a9420f04bcaf6`, parent unique `aa0fc55c…`, arbre
      `a53c81ef3de406c5e83b3761f52a837544474ceb`, blob Git de `SUIVI.md` `255b1900…`, `CHANTIER.md`
      conservé (`d4d16412…`, contrôlé avant et après), message adjugé, **établi** une fois par Mo (07:08Z,
      aucun push) **puis publié** (07:31Z) sans force ni tag : tête distante avant `aa0fc55c…`, après
      `8ac87262…`. Manifestes des retours : établissement `e3860264…`, publication `b93371d0…`.
      **Écart d'authentification préalable du manifeste de POST-3b, maintenu comme écart historique** ;
      un précontrôle documentaire des trois manifestes a été consigné avant la publication. Clôture par
      Sol : manifeste de la décision `3962c33c…` (le texte de la décision porte `3371e479…` ; les
      citations futures distinguent les deux).
- [x] **Reprise du 15-10 : réception documentaire et décision.** Trois nouvelles conversations (construction,
      adjudication, suivi) reprennent sur un dossier de reprise (manifeste `7261b631…`, 13
      empreintes) et son archive (`76b009dd…`, 301 276 octets), retenus par Sol comme copies documentaires
      vérifiées (décision de réception, manifeste `72d010ef…`) ; aucun travail de chantier n'est ouvert
      par cette réception. L'incident de constitution de l'archive (échec initial, archive vide remplacée,
      temporaire à retirer par Mo) reste une **déclaration de Mo** : Sol ne l'a pas constaté et n'a rien
      supprimé. Le contrôle de l'archive par la conversation de suivi est consigné comme
      **déclaré**, non vérifié par Sol (note de réception `9a99ea4b…`). La reconstruction par la
      conversation de construction, dans un bac neuf, de la référence `8ac87262…` (arbre `a53c81ef…`, 257
      fichiers suivis, `fsck` code 0, tête locale égale à la tête distante) est reçue **sur compte rendu** ;
      Sol n'a observé ni ce bac ni le distant.
- [x] **Décision de reprise (Sol, manifeste `4734d360…`).** Deux préparations en parallèle — le portage
      par ce suivi, l'inventaire et le plan de phase 0 par la construction — avec **un seul POST-3c
      documentaire commun** (portage et inscription du plan), avant tout code de phase 0. Cadre de la
      phase 0 reçu : niveau B, aucun nouveau run, corpus principal QD-EFF-a/b ; détail dans *Phase 0*.
      L'ordre du 08-10 est inchangé. Le registre des résultats, hors dépôt, garde son statut documentaire ;
      sa version du Projet fait foi sur la copie de la reprise.
- [x] **Statut du bac précédent : conservations prescrites devenues matériellement inaccessibles.**
      Libellé de la décision de Sol, repris tel quel : *« Conservations prescrites du bac précédent :
      devenues matériellement inaccessibles depuis la nouvelle conversation, selon le constat transmis par
      Mo et Opus ; aucune suppression autorisée ou constatée par Sol, aucune levée générale des
      conservations. »* L'inaccessibilité ne prouve pas la destruction. La formule « caduques par
      inaccessibilité » n'est pas retenue. Aucune récupération de l'ancien bac n'est demandée ; les anciennes
      preuves ne sont pas attribuées à de nouvelles copies sans contrôle d'identité ; les citations
      historiques restent possibles avec leur statut. **Aucun futur acte ni résultat ne dépend d'une pièce
      présente seulement dans l'ancien bac** : si une preuve manque, la dépendance est rapportée à Sol,
      sans substitution silencieuse, nouvelle exécution ni récupération automatique. Les résultats déjà
      adjugés restent reçus dans les limites et sur les pièces de leurs décisions.
      *Règle de pérennité adoptée :* toute pièce du bac destinée à durer est déposée sur le Mac, dans un
      dossier neuf, sous manifeste vérifié, avant la fin de la conversation et avant qu'on invoque sa
      conservation durable ; un bac n'est pas un dépôt durable. Les éléments contenant des identifiants ne
      sont pas copiés par cette règle ; pour les installations privées, le plan de conservation précisera
      les artefacts reproductibles nécessaires.
      *Table par famille, constituée sur les documents disponibles — sans inventorier de nouveau le bac
      inaccessible :*

      | Famille | Dernière trace documentaire | Couverture Mac | Limite pour les travaux futurs |
      |:--|:--|:--|:--|
      | Références Git reconstruites dans l'ancien bac | registre, retours d'établissement et de publication | établie pour la tête publiée `8ac87262…` (reconstruction neuve vérifiée, sur compte rendu) ; copies de l'ancien bac : non relues | ne pas invoquer les anciennes copies |
      | Mondes et passage de développement de POST-3b | registre, § POST-3b R1 | dépôt Mac `post3b-r1` (manifeste `5ddc1e27…`) ; transport et passage de développement : **non établie** | pièces du bac inaccessibles ; pas de dépendance |
      | Banc du lanceur M1 (mondes factices) | registre, M1 | lanceur déposé sur le Mac (manifeste `fd626fa8…`) ; mondes du banc : **non établie** | idem |
      | Relectures des poses Projet POST-3 et POST-3b | registre, § 20–21 | preuve de la pose POST-3b sur le Mac (manifeste `8628dc4d…`) ; relectures restées au bac | pièces du bac inaccessibles ; couverture Mac limitée aux éléments effectivement identifiés et vérifiés, sans preuve supplémentaire au-delà des retours déjà adjugés |
      | 262 racines protégées de `/tmp` et temporaires C-r* | registre, §§ 4 et 10 | dépôts Mac sous manifeste pour les résultats ; les racines elles-mêmes : **non établie** | aucune levée générale des conservations |
      | Deux transports à couverture partielle | registre, §§ 2 et 4 | partielle | pièces du bac inaccessibles ; couverture Mac limitée aux éléments effectivement identifiés et vérifiés, sans preuve supplémentaire au-delà des retours déjà adjugés |
      | Distributions Node et installations pi privées | registre, § 4 | **non établie** | pas de copie d'éléments à identifiants ; artefacts reproductibles à préciser au plan de conservation |

### Phase 0 — clôture : mesure A et relevé de dépense, niveau B (15-10)

*Pièces faisant foi : les adjudications de Sol du 15-10 (revue regroupée de r3 ; revue de r4 ; réception de r5 et
autorisation de l'acte 1 ; retour d'établissement ; autorisation de l'acte 2 ; publication conforme et
achèvement), les retours d'établissement et de publication, la pièce d'identité du candidat r5, le rapport
historique de r5 et le registre des résultats (§§ 25 à 30), hors dépôt. Ce portage distingue les actes
(exécutés par Mo), les observations (rapportées par Claude) et les adjudications (de Sol), et distingue les
passages remplacés des preuves retenues : un passage remplacé reste conservé comme historique et n'est pas
attribué au candidat final. **Sol n'a exécuté aucun programme, test, banc, Git, pi ni crochet livré** : les
résultats d'exécution ci-dessous sont ceux des passages et des actes consignés, reçus sur leurs pièces.*

- [x] **Plan v3 révisé, posé au Projet avec sa limite de preuve.** Le plan consolidé de phase 0 a existé en
      trois états : `8dd655a1…` (reçu à r3, version déclarée au Projet jusqu'à la pose), `1aa8a64f…` (r4, pose non
      autorisée en l'état) et **`8750c76bd26199656c4baeae92506a0bca37458411aef7b2ce0f4bfd99b96a8b`** (r5, reçu).
      Ce dernier a été posé au Projet sous `suivi/sources-post3c/PLAN-PHASE0-v3.md` **avant l'acte 1**, sur
      autorisation de Sol, par envoi du fichier puis relecture intégrale du texte. **Limite conservée : aucun
      SHA-256 n'a été recalculé depuis les octets du Projet** (l'interface ne rend que du texte) ; les empreintes
      vérifiées par Sol sont celles des copies locales, et la concordance du Projet repose sur la méthode et la
      relecture déclarées. Retour de pose : manifeste `31a38247…`, 3/3, vérifié par Sol.
- [x] **Construction et revues de Sol — passages remplacés et preuves retenues.** Trois livraisons successives
      du candidat (r3, r4, r5), chacune revue par Sol. Les identités des deux premiers candidats (r3 : patch
      `55fb9eee…` ; r4 : patch `c90225ad…`) sont **historiques** et ne sont pas celles du candidat final.
      - *r3 (décision `6ea3062b…`).* Constitution reçue (manifeste `c33f143e…`, 442/442) ; rejeu limité des
        recettes admis pour les seules différences r2 → r3 ; **six corrections obligatoires, R1 à R6**, sur des
        défauts de contrôle, de couverture et de traçabilité : unicité des séquences et sources de risque
        exactes ; champ absent distinct d'un zéro, aussi dans l'artefact ; dénominateurs disponibles des
        délégations sans transcription ; pièces sources structurées par origine ; encadrement d'un `read` tronqué
        séparé des lignes nouvelles ; temporaires de la vérification native confinés à sa destination. Acte 1
        non autorisé.
      - *r4 (décision `27f08c00…`, livraison `758c4a2e…`, 613 empreintes).* R1, R4, R5 et R6 reçues ; R2 et R3
        reçues avec une réserve (**correction C1 de la revue r4** : une masse attendue inconnue ne doit pas être
        remplacée par la somme observée des tours) ; **correction C2** (identité périmée du candidat dans le
        plan). Acte 1 non autorisé.
      - *r5 (décision `07b8abe1…`, livraison `e86e8486…`, 861/861).* C1 et C2 levées (cas K48 et mutant M48 ; le
        plan renvoie à la pièce d'identité du candidat) ; correctif de tri retenu : dans `rapport.py`, le nom
        d'origine sert de clé secondaire à parts égales — il règle l'ordre des lignes, non les mesures. Acte 1
        autorisé une fois, et pose du plan autorisée.

      **Candidat final (r5).** Patch `64637e3709ad1ca48f84b4662a1e49caf6b120c55092592442504a179a2e49b9`, patch-id
      `afab9bd2…` ; arbre du patch sur `8ac87262…` seul `94cd5a01…`, arbre final `cffdccab…` ; `bin/run-cost`
      (mode 755) `22e83d39…`, `tests/test_run_cost.py` `f013be3c…`, `README.md` `5114e30f…` ; index de 78 lignes
      (3 modifiés, 75 ajoutés) ; copie scellée de 77 fichiers, SPEC native `a21a0757…` ; 75 tests annoncés OK à
      l'établissement, dont les 27 tests antérieurs, inchangés.
      **Preuves retenues.** Passage formel 5 du candidat (gel à 12:25:43Z, table neuve) : P0 à P8 conformes, K et
      M 48/48, préalable 8/8 à l'octet, quatre sorties de contexte de code 0. Passage 6 des recettes (gel à
      12:34:13Z) : BANC `502ddd2f…`, 40/40 résultats conservés CONFORME, 731 contrôles annoncés.
      **Passages remplacés, conservés comme historiques, non attribués au candidat final.** Passage formel 4 du
      candidat (tri non déterministe à parts égales dans `rapport.py` ; l'essai sous trois graines est un essai
      déclaré) ; passages formels 2 (r3) et 3 (r4), propres à leurs candidats ; passage 5 des recettes de r4 (gel
      à 11:51:06Z, BANC `f0f4581f…`) et passage 4 des recettes de r3 (gel à 11:03:09Z, BANC `bb22c52d…`).
- [x] **Établissement (acte 1) — conforme (15-10).** Lanceur r5 `9fcb4d0e…`, invoqué par Mo le 15-10 de 13:34:27Z à
      13:34:33Z, pi arrêté, sans sudo : neuf identités précontrôlées, destinations absentes, aucune variable
      `GIT_*` ; code brut 0, verdict « ÉTABLISSEMENT P0 — CONFORME ». Vérification native V1 à V6 conforme sur la
      copie scellée et les archives authentifiées, avant toute pose ; interpréteur effectivement employé relevé :
      Python 3.15.0, Darwin arm64 (relevé d'exécution, sans gel). Deux commits ordonnés, parents uniques, sans
      signature : POST-3c `32e2b3cb7c1d014d64a79f24bf64ac5965b2cadd` (parent `8ac87262…`, arbre
      `7ddf6c0d9aa2fd986699c621d2a1b1e08b6c3a6b`, message `docs(suivi): port tracking to 15-10 and record phase-0
      plan v3`), qui porte exactement les deux textes préparés par ce suivi, `SUIVI.md` `3702aca3…` et
      `CHANTIER.md` `a8e856f6…` ; puis code de phase 0 `604e89487e0eee2fa37ddfde7429aa3a41f785df` (parent
      `32e2b3cb…`, arbre `cffdccabbd958e22c5a30a249a40007eb02d2647`, message `feat(run-cost): add --contexte
      direct reading of child context`). Sol a recalculé les deux identités en SHA-1 à partir des objets commit
      conservés (327 octets chacun), sans Git. Aucun push parmi les 67 commandes consignées ; configuration
      locale inchangée avant/après (`42e28a8d…`), trois crochets actifs. Retour d'établissement : manifeste
      `c5b62906…`, 608/608, vérifié par Sol, qui a aussi comparé à l'octet les 16 sorties du préalable et les huit
      fichiers des quatre mesures de contexte à ceux du passage formel 5. **Déclaré, non observé par Sol :** la
      tête distante n'a pas été relue à l'établissement ; l'absence de publication est reçue sur la recette et le
      retour.
- [x] **Publication (acte 2) — conforme (15-10).** Lanceur fixé `d8ffac09…` (le modèle `dc47c5a4…` avec deux
      substitutions seulement, les deux identités de commit ; manifeste de réception `296bd53f…`, 3/3), invoqué
      par Mo le 15-10 de 15:10:01Z à 15:10:07Z, pi arrêté, sans sudo : précontrôles d'identité conformes, audit
      d'établissement présent, aucune variable `GIT_*` ; code brut du lanceur et du push 0, verdict « PUBLICATION
      P0 — CONFORME ». **Un seul push** de `604e8948…` vers `refs/heads/feat/subagent-extension` sur origin, sans
      force ni étiquette ; relecture distante avant `8ac87262…`, après `604e8948…` ; chaîne et arbres conformes à
      l'établissement ; configuration locale inchangée (`42e28a8d…`), trois crochets actifs, pi absent pendant
      l'acte. Retour de publication : manifeste `780dd07b…`, 174/174, vérifié par Sol. **Limites :** la tête distante
      est reçue à l'instant de sa relecture consignée dans l'acte, Sol n'a pas interrogé le distant ; le contrôle
      anonyme hors acte rapporté par la construction est une corroboration déclarée, non nécessaire à la preuve
      principale. L'autorisation d'acte 2 est consommée : elle ne permet ni relance ni second push.
- [x] **Phase 0 déclarée achevée au niveau B (décision de Sol `fd3b4208…`, 15-10).** D1 : publication conforme ;
      D2 : phase 0 achevée dans son périmètre ; D3 : reprise de pi ; D4 : portage et suite. La chaîne autorisée
      est complète : plan révisé reçu et posé au Projet avec sa limite, candidat r5 et preuves reçus,
      vérification native conforme sur copie scellée, établissement puis publication conformes. Le résultat
      **« attribution non établie »** est celui que le cadre prévoyait, non un échec à réparer pour obtenir une
      dominance. Les preuves de mesure et de qualification de l'instrument sont celles déjà adjugées, complétées
      par le retour natif d'établissement sous Python 3.15.0 ; Sol ne les a pas réexécutées. **Python 3.15.0
      reste un relevé d'exécution, sans gel durable de version.** L'identité technique qualifiée `b1a99caa…`
      (`2def810f…`) est inchangée : la publication de l'instrument ne transforme pas la mesure en qualification
      technique, en gel ni en référence actuelle sur cette identité. Aucun nouveau QD ni changement de contexte
      n'est ouvert ; le résultat non établi n'autorise pas d'optimisation des phases 5 ou 6.
- [x] **Rapport historique de r5 — ce qu'il dit, et ce qu'il ne dit pas.** Rapport faisant référence :
      `RAPPORT-HISTORIQUE.md`, SHA-256 `69228b2be00ab3b2d861c18ae9a9b445380ef977569b30225c5d734c3b97509f`, produit
      en bac le 15-10 par `rapport.py`, sous Python 3.13.16, sur les sorties de `run-cost --contexte` du candidat
      final (`22e83d39…`). Sorties gelées (JSON / texte) : QD-EFF-a `432790b0…` / `14f83297…` ; QD-EFF-b
      `8a0353d0…` / `6918cf68…` ; pilote final `5fb91707…` / `09660386…` ; QD-P1b `0bf6eae3…` / `3f47209f…`.
      **Aucune agrégation entre candidats, aucun montant monétaire.**
      **Mesure A, lecture historique et datée (niveau B).** Verdict pour tout relevé et tout rôle : **attribution
      non établie**. Le « premier poste estimé » est la tête d'un classement descriptif de textes observés,
      estimés à caractères/4 (estimateur non calibré), avec résidence non prouvée, résidu signé non redistribué et
      parts non renormalisées : ce n'est ni une cause, ni une origine dominante, et aucune correction de contexte
      n'en découle. Les premiers postes estimés sont résumés ci-dessous ; les parts et les masses résiduelles
      restent dans le rapport historique.

      **Limites déclarées par le rapport et par les revues.** La masse résiduelle est élevée et variable
      selon le relevé, le rôle, la variante et le segment ; le rapport ne rend aucun verdict pour
      l'orchestrateur. **Les têtes diffèrent selon le rôle et le corpus** (O-lecture pour
      les workers ; O-tâche sur le corpus principal puis O-préfixe sur les pilotes pour les reviewers ;
      O-autres-outils ou O-préfixe pour le scout) et la dispersion a/b par origine est forte ; la cause 1 du plan
      (dépense en findings lors d'une reprise) est « non
      exercée », le corpus principal ne contenant aucune reprise ; le corpus entièrement rapproché (62/62
      délégations) n'exerce pas la correction C1 de la revue r4, de sorte que l'absence de changement des premiers
      postes ne prouve pas ce comportement sur source manquante ; le pilote final n'a pas de trace `transmis` (diff
      injecté du reviewer « non établi ») ; l'en-tête de transcription ne porte pas la séquence (liaison par nom de
      fichier et journal) ; le repli de modèle (délégation n° 43 du pilote final) est isolé et publié à part, et
      les deux périodes du pilote sont séparées sans double compte.
      **Relevé de dépense (B).** Grille par rôle dans le rapport : tokens facturés, orchestrateur compris au
      dénominateur, `reasoning` compris dans `output` sans être additionné, durée cumulée des délégations
      distincte de la durée écoulée, aucun montant. Les totaux par run, les durées et les compactions restent
      dans le rapport historique, sans somme ni comparaison entre candidats.

- [x] **Reprise de pi et suite (décision `fd3b4208…`, D3 et D4).** **La reprise de pi 0.86.0 en usage ordinaire est
      autorisée**, avec les trois crochets actifs et la configuration conservée ; l'obligation temporaire de
      maintenir pi arrêté pour les deux actes est levée. Elle n'ouvre ni installation, ni changement de version ou
      de configuration, ni relance des recettes d'établissement ou de publication, ni nouvelle mesure de
      qualification. **Prochaine phase technique : la phase 3, avant la phase 2** (décision d'ordre du 08-10 relue ;
      sa copie de reprise est identique à l'original canonique, `73433179…`), sur un plan préalable à adjuger :
      priorités maintenues — protection des registres durables, instruments hors dépôt, garde du push ; les autres
      dettes à inclure ou à laisser au backlog sont nommées dans le plan ; pas de plafond automatique de trois
      items ; aucune construction, activation, modification de production ni exécution de phase 3 avant son
      adjudication. maxParallel reste en phase 8 ; la montée de pi reste en phase 9b. **Conservations :** toutes
      les livraisons, archives, passages remplacés, modèles, lanceurs, originaux d'actes et retours restent
      conservés ; aucun nettoyage ni retrait n'est ouvert.

### Phase 3 — clôture : registres, instruments, garde du push, D1 et D2, niveau A (16-10)

*Pièces faisant foi : les adjudications de Sol des 15-10 et 16-10 (plan de phase 3 avec recadrages ; A1 et Q-1 à
Q-3 ; livraison et acte 1 ; retour d'établissement ; autorisation de l'acte 2 ; publication conforme et
clôture), les retours d'établissement et de publication, le LISEZ-MOI de la livraison, la pièce d'identité du
candidat et le registre des résultats (§§ 33 à 45), hors dépôt. Les empreintes de manifeste citées sont celles
des dossiers de décision de Sol. Ce portage distingue les actes (exécutés par Mo), les observations (rapportées
par Claude) et les adjudications (de Sol), et distingue les passages remplacés des preuves retenues : un passage
remplacé reste conservé comme historique et n'est pas attribué au candidat final. **Sol n'a exécuté aucun
programme livré, test, banc, Git, pi, crochet ni lanceur** : les résultats d'exécution ci-dessous sont ceux des
passages et des actes consignés, reçus sur leurs pièces.*

- [x] **Plan adjugé avec recadrages, puis cadre complété (15-10).** Plan préalable v1 `66e79b46…` adjugé avec
      recadrages R1 à R5 (décision `9ec0aae9…`) : protection des registres **sur place**, sans déplacement ni
      migration hors dépôt ; copies d'instruments à l'octet et garde d'intégrité ; crochet `pre-push` et refus
      de `bash-guard` ; **P1, P2, P3, D1 et D2 inclus, B1 à B10 laissés au backlog**, niveau A ; chaîne de six
      commits C0 à C5, messages de 50, 58, 59, 56, 61 et 61 caractères, sans autorisation de commit ; une ligne
      factuelle dans la skill `git-collaboration`, limitée au push de ce dépôt. Le plan v2
      `68f35553…` a été figé avant la première construction. La v3 `953dea73…` et son complément A2
      `aa6eb7f4…` ont ensuite été déposés avant les écritures complémentaires qu'ils règlent. Les snapshots
      antérieurs à leur autorisation restent déclarés et conservés, sans conformité rétroactive. Décision
      `4c73ccb7…` : A1 reçu (preuves de P3 dans `tests/l0-garde-push.test.ts`, de P2 dans
      `tests/l0-instruments.test.ts`) ; **Q-1** accordée (`extensions/bash-guard/index.ts`, deux refus) ;
      **Q-2** recadrée — la campagne historique `bin/pi-contrats --qualifier` est incompatible avec le candidat
      (sa garde exige un ancien commit et un ancien arbre) et n'est ni modifiée ni lancée, remplacée par un
      pilote C2.1 ciblé hors du dépôt, avec sa garde propre ; **Q-3** accordée (sélection de mutants vide à C0,
      sur démonstration mécanique, rapportée « non lancé »). Les arbres, comptes et essais annoncés avant la
      livraison étaient des essais déclarés, non probatoires ; les snapshots du bac sont des objets de travail,
      distincts des commits établis.
- [x] **Contenu de la chaîne C0 à C5.** Delta de 42 chemins sur la base `604e8948…` ; arbre final de 362
      fichiers.
      - *C0* (50 caractères) : exclusivement les deux textes de la clôture de la phase 0, `SUIVI.md` `7d449fd6…`
        et `CHANTIER.md` `2f566df3…`, à l'octet.
      - *C1 — P1, registres durables.* Un dépôt Git imbriqué minimal est posé comme marqueur dans le répertoire
        des registres par `openRun`, **avant** les effets de `withSpaceGuard`, et contrôlé au préflight (`.git`
        réel, `HEAD` valide, `objects` et `refs` valides ; liens, types inattendus et marqueurs partiels refusés
        sans réparation). Portée prouvée sur des mondes jetables : `git clean -xfd`, `git clean -Xfd` et `git
        stash --all`.
      - *C2 — P3, garde du push.* Crochet `git-hooks/pre-push` : autorisation exacte à usage unique, de sept
        lignes, liée au dépôt local et à la destination, pour une seule mise à jour en avance rapide ;
        suppressions, étiquettes, créations de branche non autorisées et mises à jour non rapides refusées ;
        consommation exclusive (réclamation, disparition du nom disponible et présence au nom consommé
        contrôlées) **avant** l'acceptation, une autorisation consommée le restant si le transport échoue
        ensuite. `bash-guard` : deux refus avant toute whitelist et avant le jeton de commit — le fichier de
        l'autorisation, puis les contournements `--no-verify` et `commit -n`. Une ligne factuelle dans la skill
        `git-collaboration` énonce l'obligation. README et en-têtes décrivent le motif exact et les limites
        d'analyse.
      - *C3 — D1.* N1 de `tests/l0-pi-adapt.test.ts` rendu indépendant de la longueur du TMPDIR, dans le harnais
        seul (`describePlan` sur les arguments normalisés) ; références, générateur et code de production
        inchangés.
      - *C4 — D2.* Un `.DS_Store` ordinaire est admis sous `tests/pi-contrats` seulement, par son nom exact ;
        toute autre source non déclarée reste refusée.
      - *C5 — P2, instruments.* Dossier `instruments/` sous garde d'intégrité (25/25 sur le Mac) : vingt copies
        à l'octet des sources — les dix-huit fichiers de l'instrument externe de qualification Mac r4, le script
        S4 et son verrou d'outillage — et des documents et pièces de garde neufs, qui ne sont pas des copies
        historiques.

- [x] **Preuves retenues sur le candidat final (niveau A) et passages remplacés.** *Passage formel 5 du
      candidat* (table `c8207a91…`, script `b2cb14e7…`, de 01:58:55Z à 05:26:27Z le 16-10) : 170 contrôles P0 à
      P8 conformes, sans écart. À chaque étape C0 à C5 : `test-guards` (de 1 052 à 1 113 tests, 211, Python 65
      et 75), `l0-check` sans anomalie, `lanes-concurrency` 4/4 ; mutants par sélection mécanique falsifiée (C0
      : sélection applicable vide, 312 exclusions justifiées ; C1 212, C2 166, C3 92, C4 92 tués) ; sur l'arbre
      final, **suite complète : 379 mutants déclarés, 274 obligatoires, 294 preuves éprouvées, anomalies 0**.
      Preuves neuves rouges sur leur propriété avant, vertes après (C1 14/14, C2 39/39 ; pour C3 et C4, le rouge
      avant correction est porté par les mutants et par P5) ; S4 vert sur projection (références constituées sur
      la base ; 27 chemins hors de la classe S4, couverts par la garde d'intégrité, la revue et leurs preuves
      propres) ; D1 sous des TMPDIR de 4, 12 et 47 caractères (base : vert, rouge, rouge ; arbre final : vert
      trois fois) ; pilote C2.1 falsifié 20/20, ses 16 mutants tués, C2.1 et C2.1/b conformes aux états attendus
      (le comportement « violé » de la contre-épreuve sans garde est attendu, non un échec). *Banc des recettes,
      passage 2* (table `c3bafecc…`, banc `694dc0be…`) : 75/75 cas, 1 389 contrôles, passés par les lanceurs sur
      des mondes neufs à `604e8948…` avec les vrais crochets ; **la vérification native y est factice, sauf dans
      les cas NVR2 et NVR3**, et les 75 cas ne sont pas 75 exécutions réelles. *Qualification native 2 au profil
      du bac* (Linux x86_64, Node 22.22.0, npm 10.9.4, Git 2.43.0, Bash 5) : chaîne réelle des deux actes jouée
      une fois, conforme ; ce n'est pas une exécution sur le Mac. *Deux revues adverses indépendantes* : l'une
      sur le candidat (RA-1 à RA-18), l'autre sur les recettes, le vérificateur et le banc (RAR-1 à RAR-15),
      constats corrigés ou déclarés. **Passages remplacés, conservés comme historiques, non attribués au
      candidat final :** passages formels 1 à 4 du candidat (interruption volontaire pour corriger la
      documentation de C2 ; deux interruptions de l'environnement, sans écart ; arrêt P3-R14, une preuve de C1
      non déterministe — le monde jumeau copiait les registres sans leurs dates, six échecs sur soixante —,
      défaut de la preuve et non du code) ; passage 1 du banc (`f66b9b37…`) ; qualification native 1 (arrêt en
      V5-C2.1, vérificateur corrigé : `1214daf5…`) ; candidats remplacés d'arbres `74391205…` et `21874ccf…`.
- [x] **Établissement (acte 1) — conforme (16-10).** Lanceur `38c4bf56…`, invoqué par Mo le 16-10 de 08:41:59Z à
      09:15:02Z, pi arrêté, sans sudo : treize identités précontrôlées, destinations absentes ; code brut 0,
      stderr vide, verdict « ÉTABLISSEMENT P3 — CONFORME ». **Vérification native réelle V1 à V6 sur le Mac,
      conforme avant toute pose et tout commit** : relevés d'exécution Darwin arm64, Python 3.15.0, Node
      26.12.0, npm 11.20.0, Git 2.56.0, Bash des recettes 3.2.57 (des relevés, sans gel) ; arbre natif
      `2ec4adf4…` reconstruit depuis l'archive (362 fichiers) avant les portes ; V4 : `test-guards` 1 113/1 113,
      `l0-check` 307 déclarées et anomalies 0, `lanes-concurrency` 4/4, 379 mutants, chacun égal au bac, sous un
      TMPDIR réel de 108 caractères ; V5 : témoins P1 et P3, monde jouet (refus sans autorisation, acceptation
      exacte avec consommation unique, second push refusé, quatre invocations simultanées → une acceptation et
      une consommation) ; V5-C2.1 : pi 0.86.0 installé hors ligne dans un monde isolé, pilote C2.1 et C2.1/b
      conformes ; V6 : garde d'intégrité 25/25, paquet r4 `fe58ff7b…` 64/64, vingt copies égales. **Six commits
      établis**, parents uniques depuis `604e8948…`, arbres égaux aux attendus, messages adjugés, sans
      signature, crochets actifs sans contournement : C0 `59ab3aeecb2be161415002fccdc10ede872659ff`, C1
      `54eb40e6d09739d180579dbff4dc198deb100b59`, C2 `1672db59e8a4128a10bffb796cf6ca9da7c89c0a`, C3
      `3bc6ba8609c00781593b75cd812247416448ab13`, C4 `4ca90fdaedde5e49e052756afbeac705d2803361`, C5
      `186aac98a207b84cd0ddfca6fe0a34b4b127ed07` ; Sol a rehaché les six objets commit conservés. Configuration
      locale inchangée (`42e28a8d…`) ; crochets : trois avant C2, quatre à partir de C2 (pre-push compris) ;
      tête distante restée à `604e8948…`, aucun push, aucune autorisation de push créée ; pi arrêté avant,
      pendant et après. Retour d'établissement : manifeste `8e5c3402…`, 18 249/18 249, vérifié par Sol ; les 26
      liens symboliques de l'audit sont inventoriés mais **non copiés** (le manifeste couvre les fichiers
      ordinaires, non tous les types de nœuds) ; originaux en place. **Déclaré, non observé par Sol :** l'état
      de production et la tête distante sont reçus aux instants consignés par Mo.
- [x] **Publication (acte 2) — conforme (16-10).** Lanceur fixé
      `678ba414491387637c2c895fb4c75f0937bf2b7c0d71517e090e47a6dd05d978` (le modèle `ffb41f00…` avec six
      substitutions seulement, les six identités de commit ; `COMMITS.txt` `7d9e3d44…` ; manifeste du dossier
      `b10d1022…`, 3/3), invoqué par Mo le 16-10 de 10:09:15Z à 10:09:23Z, pi arrêté, sans sudo : six
      précontrôles conformes ; code brut 0, verdict « PUBLICATION P3 — CONFORME ». **Un seul push** de
      `186aac98…` vers `refs/heads/feat/subagent-extension` sur origin, sans force ni étiquette ; tête distante
      avant `604e8948…`, après `186aac98…`. Autorisation créée exclusivement par la recette (fichier ordinaire,
      mode 600, lien unique, sept lignes, SHA-256 `6563304e…`), **consommée une fois** avant l'acceptation et
      conservée sous un nom horodaté (10:09:19Z) ; aucune autorisation ne reste disponible, et aucun retrait,
      rétablissement ni recréation n'est demandé ou autorisé. Configuration `42e28a8d…` inchangée ; quatre
      crochets actifs ; état propre. Retour de publication : manifeste `95b19eb9…`, 246/246, retour écrit
      `bf49e892…`, vérifiés par Sol. **Limites :** Sol n'a pas lu l'autorisation en production (ses propriétés
      sont reçues sur le journal adjugé) ; la lecture anonyme du distant par le bac est reçue sur déclaration,
      sans relevé brut distinct, la relecture distante brute de la recette suffisant à l'adjudication.
      L'autorisation d'acte 2 est consommée : ni relance ni second push.
- [x] **Phase 3 déclarée achevée au niveau A (décision de Sol `e87b4ea6…`, 16-10).** D1 : publication conforme,
      acte 2 achevé ; D2 : phase 3 achevée **dans le périmètre adjugé P1, P2, P3, D1 et D2**, sur la chaîne
      C0–C5 établie, vérifiée nativement puis publiée (le portage de clôture de la phase 0, premier commit C0,
      est lui aussi publié) ; D3 : préparation du présent portage, pour adjudication de Sol avant tout
      remplacement, établissement, commit ou publication. **La clôture ne supprime aucune limite reçue à la
      livraison et ne ferme pas les dettes historiques** : les clôtures d'items cochées dans *Phase 3 — dette du
      chantier `3c`* sont des propositions, chacune avec sa preuve et sa limite, soumises à Sol.
- [x] **Reprise de pi 0.86.0 : autorisée, non constatée par ce portage (décision `e87b4ea6…`, D2).** Mo peut
      reprendre l'usage ordinaire de pi 0.86.0, avec les **quatre** crochets actifs, pre-push compris, sans
      nouvelle manipulation de garde ; l'attente imposée depuis l'établissement est levée par cette décision.
      Sol ne lance pas pi et ne prétend pas que la reprise a déjà eu lieu : **« reprise autorisée » n'est pas «
      reprise effectivement constatée »**, et aucune pièce de reprise effective n'est portée ici. **Règle
      d'exploitation nouvelle :** tout push de ce dépôt de configuration exige une autorisation exacte à usage
      unique, créée par l'opérateur ou sa recette, jamais par un agent ; les agents ne contournent pas les
      crochets (`--no-verify` exclu) ; un refus est rapporté, puis l'arrêt s'impose. Si une autorisation restait
      disponible après un ARRÊT, elle serait une capacité active : pi arrêté, rien poussé, fichier ni retiré, ni
      déplacé, ni restauré, retour à Sol (D2 de la décision `895c8a84…`) ; ici elle est consommée, aucune ne
      reste. Cette reprise n'ouvre ni qualification générale nouvelle de pi, ni montée de version, ni mesure QD.

- **Limites maintenues par la clôture** (adjugées à la livraison, décision `895c8a84…`, D4 ; reçues sans
  garantie plus large que leur périmètre éprouvé) :
  - *Registres :* protection contre `git clean -xfd`, `git clean -Xfd` et `git stash --all`, non contre la
    double force, la suppression explicite ni le retrait du marqueur ; les runs anciens sans marqueur ne sont
    protégés qu'après leur passage par la nouvelle préparation, sans migration ni protection rétroactive ; deux
    marqueurs illisibles ou non-Git échouent fermés par une erreur de chargement et non par le refus explicatif
    du préflight (RA-7).
  - *Autorisation de push :* contrôle de propriétaire et borne de longueur retirés du crochet, sans propriétaire
    vérifié revendiqué et sans garantie face à des fichiers hostiles ou volumineux ni à un acteur modifiant
    l'espace personnel ; objet sur 64 hexadécimaux et référence comparée exactement (RA-13), recette limitée à
    origin et à la branche reçue, aucun push par adresse ; trois refus post-création non provoqués par le banc
    (RAR-9) ; garde contre l'erreur ordinaire, non contre un opérateur décidé.
  - *`bash-guard` :* garde lexicale, non analyseur de shell ni confinement de tous les outils (RA-5, RA-15) ;
    redirections, continuations, certaines options citées, globs qui n'épellent pas le motif et outils `write`
    et `edit` hors garantie ; faux positifs déclarés (`-n` dans un message entre guillemets doubles, `git grep
    --no-verify`). TOKEN_SOURCES, préexistant, reste au backlog.
  - *D1 :* la normalisation en entrée de `describePlan` ne démontre pas le rendu brut pour toutes les longueurs
    de racine ; P5 et le TMPDIR long de V4 gardent leurs portées propres.
  - *Instruments :* S4 vert limité à sa projection, ne couvrant ni `pre-push` ni les copies sous `instruments/`
    ; **O2-1 reste ouverte** (instrument interne et instrument externe distincts ; `b1a99caa…` historique ;
    aucune requalification de pi) ; l'exclusion de M1–M7 reste une exclusion déclarée de requalification
    historique.
  - *Preuves :* vérification native factice dans le banc hors NVR2 et NVR3 ; qualification native 2 au profil du
    bac, non sur le Mac ; lanceurs C2.1 propres au bac ; copies de travail non jointes (inventaires, commandes
    et sorties joints) ; libellé de l'orchestrateur (`index.ts`, l. 4396) non modifié ; contrôles de Sol
    documentaires.
  - *B3 :* l'abonnement à `tool_result` est présent à la ligne 4213 de l'index à `604e8948…` (le commentaire
    C6.4 commence à la ligne 4209) ; c'est un constat de code documenté, non une preuve complète du contrat,
    sans clôture implicite.

- **Conservations et suite.** Toutes les conservations demeurent : livraison, passages remplacés, retours,
  audits originaux avec leurs liens, consommation de l'autorisation ; aucun nettoyage n'est autorisé. La phase
  suivante dans l'ordre du 08-10 est la **phase 2**, qui conserve son plan préalable à soumettre ; sa
  construction n'est pas autorisée par la clôture de la phase 3. maxParallel reste en phase 8, la montée de pi
  en phase 9b.

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

*Ordre actuel, adjugé le 08-10 et repris aux portages des 14-10 et 15-10, à la clôture de la phase 0
(15-10), puis à la clôture de la phase 3 (16-10) — il remplace celui du 06-10 :*

```text
LOT-PI-ADAPT clos, POST-1, POST-2, POST-3 et POST-3b achevés, POST-3c, phase 0 et phase 3 publiés
→ phase 0 : mesure A et relevé de dépense (achevée au niveau B le 15-10 ; attribution non établie)
→ phase 3 : dette prioritaire du chantier (achevée au niveau A le 16-10 ; périmètre P1, P2, P3, D1, D2)
→ phase 2 (plan préalable à soumettre) → 4 → 5 → 6 → 7 → 8 → 9
→ phase 9b : versions, dont montée directe de pi
→ QD de référence sur l'environnement final de 9b
→ phase 10 : modèles
```

**La phase 3, qui précédait la phase 2 par exception explicite à « phases 2 à 9 dans l'ordre », est achevée
(16-10) ; la phase 2 est la suivante, sur son plan préalable à soumettre, construction non autorisée.** *Texte
du 15-10, remplacé et conservé :* « La phase 3 reste avant la phase 2 (exception explicite à « phases 2 à 9 dans
l'ordre »). Ses trois priorités — protection des registres durables, instruments hors dépôt, garde du push —
restent prioritaires, sans plafond automatique de trois items ; les nouvelles dettes restent à inclure
explicitement au plan et ne deviennent pas réalisées par leur inscription. »
**Une phase par lot** (phases 2 à 10) : plan de phase adjugé (objectif commun, périmètre exact,
qualification bornée, retour arrière), construction et qualification en bac, une livraison, puis
corrections exactes avec diff contre la livraison reçue ; une phase trop large peut être découpée au
plan, avant construction. *Conditions d'entrée préservées :* mesure A avant tout changement de contexte,
banc avant tout allègement, gel et pilote avant tout ce qui touche l'intégration ; la phase 4 attend la
décision sur `.agents/memory/` ; les phases 5 et 6 viennent après la mesure A et leurs prérequis. Les
versions, modèles, prompts et baselines historiques restent datés. **Cette mise à jour ne lance ni
mesure A, ni phase suivante, ni montée de pi, ni QD.**

*Précisé le 15-10 (clôture de la phase 0) :* la phase 0 est achevée au niveau B ; **la prochaine phase est la
phase 3, avant la phase 2, sur un plan préalable à adjuger** ; cette mise à jour ne lance ni phase 3, ni
phase suivante, ni montée de pi, ni QD. *Texte du portage POST-3c, remplacé par le bloc ci-dessus et conservé :*
« LOT-PI-ADAPT clos, POST-1, POST-2, POST-3 et POST-3b achevés, portage POST-3c → phase 0 : mesure A et
relevé de dépense (plan adjugé, réalisation à venir) → phase 3 : dette prioritaire du chantier ».

*Précisé le 16-10 (clôture de la phase 3) :* la phase 3 est achevée au niveau A dans le périmètre P1, P2, P3, D1
et D2 ; **la prochaine phase est la phase 2**, sur son plan préalable à soumettre, construction non autorisée ;
cette mise à jour ne lance ni phase 2, ni phase suivante, ni montée de pi, ni QD. *Bloc du 15-10, remplacé par
le bloc ci-dessus et conservé :* « LOT-PI-ADAPT clos, POST-1, POST-2, POST-3 et POST-3b achevés, POST-3c et
phase 0 publiés → phase 0 : mesure A et relevé de dépense (achevée au niveau B le 15-10 ; attribution non
établie) → phase 3 : dette prioritaire du chantier (plan préalable à adjuger) → phase 2 → 4 → 5 → 6 → 7 → 8 → 9
→ phase 9b : versions, dont montée directe de pi → QD de référence sur l'environnement final de 9b → phase 10 :
modèles ».

*[Remplacé le 08-10 par l'ordre ci-dessus ; conservé pour l'historique. « Trois items par lot par
défaut » n'est plus la règle courante.]*
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

*[14-10]* Première phase de la suite adjugée le 08-10, après la clôture de LOT-PI-ADAPT : la mesure A
précède tout changement de contexte. **Non lancée** par le portage POST-3.

**[15-10, clôture] Phase 0 achevée au niveau B ; résultat « attribution non établie ».** Le plan ci-dessous a
été réalisé : option `--contexte` de `bin/run-cost`, tests et section d'usage du `README.md`, dans le commit de
code `604e8948…` (index de 78 lignes : 3 modifiés — `bin/run-cost`, `tests/test_run_cost.py`, `README.md` — et
75 ajoutés), publié le 15-10 au-dessus de POST-3c (`32e2b3cb…`). Le rapport historique de r5 (`69228b2b…`)
publie la lecture directe par origine (mesure A) et le relevé de dépense par rôle (B) sur le corpus adopté
(QD-EFF-a/b en principal ; pilote final et QD-P1b, distincts), sans agrégation entre candidats et sans montant.
La tête d'un classement est un « premier poste estimé » : descriptif, estimé, jamais une cause. **Rien n'est
qualifié :** ni qualification technique, ni gel, ni référence sur `b1a99caa…` ; le résultat n'autorise ni
optimisation des phases 5 ou 6, ni nouveau QD, ni changement de contexte. Détail, passages remplacés et preuves
retenues : *Ce qui est fait*, « Phase 0 — clôture ».

*[Entrée du portage POST-3c, remplacée le 15-10 par l'entrée de clôture ci-dessus et conservée : ses mots
« réalisation à venir », « rien n'est construit » et « aucun résultat n'est inscrit ici » décrivent l'état de
ce portage, non l'état courant.]*

**[15-10] Plan adjugé, réalisation à venir.** Le cadre est adjugé par Sol (décisions `4734d360…`,
`74cbcec9…`, `5c42e0f0…`, précision Python `5c5a4a8e…`). Le plan consolidé — v3, construit selon ce cadre
sans nouveau tour de cadrage — est livré avec le code et relu par Sol à cette occasion. **Rien n'est
construit dans le dépôt, rien n'est mesuré, aucun résultat n'est inscrit ici** : les résultats de la mesure
et du rapport s'inscriront dans un commit documentaire ultérieur, après leur adjudication.

- *Niveau et portée.* Niveau B : analyse historique de relevés conservés. Pas de run, pas de transfert vers
  `b1a99caa`, pas de qualification technique du candidat. Le préalable de reproduction de l'instrument
  inchangé (`f6581f37…`) est reçu conforme (décision `5c42e0f0…`) ; il ne qualifie ni `--contexte`, ni les
  autres corpus, ni une version de Python.
- *Objet.* Doter `bin/run-cost` d'une option `--contexte`, versionnée et testée, et la lire sur un corpus
  arrêté pour publier deux lectures historiques datées. **(A) Mesure A, descriptive :** les textes
  directement observés dans l'entrée des appels des workers, par origine (une seule origine par caractère,
  priorité fixée), leur estimation par caractères/4 — indépendante des usages relevés —, un résidu signé et
  un classement descriptif. **Verdict : « attribution non établie »** ; la tête du classement s'appelle
  « premier poste estimé ». **(B) Relevé de dépense :** grille par rôle (orchestrateur, worker, reviewer,
  scout, advisor, integration-worker ; `input`, `cacheRead`, `cacheWrite`, `output` dont `reasoning` non
  additionné ; appels, délégations, tours, `durationMs`, pic et médiane du contexte, compactions et
  horaires ; fenêtres avant et après la coupure), dénominateur = le run entier orchestrateur compris, puis
  par worker ; la durée cumulée des délégations reste distincte de la durée écoulée ; **aucun montant
  monétaire**. Ni causalité, ni correction de contexte ne sont autorisées par ces résultats ; ils éclairent
  les plans des phases 5 et 6.
- *Méthode, et ce que le plan écarte.* Lecture directe ; **aucune origine n'est mesurée par le solde
  d'autres postes.** L'attribution par différences d'un tour à l'autre n'est pas adjugée (elle rangerait
  dans une origine visible des éléments invisibles) ; les libellés « relevé sous hypothèse », le seuil de
  0,8 et le seuil calibré sur le premier tour sont retirés. La seule soustraction admise est le **résidu**
  R_t = C_t − Σ estimations résidentes, signé, publié, jamais redistribué ni écrêté, avec sa masse
  Σ|R_t| / ΣC_t sur les mêmes tours que les parts ; les parts ne sont pas renormalisées. La résidence des
  textes est une hypothèse non prouvée, affichée comme telle (texte nouveau distinct du cumul). Chaque
  résultat est donné avec et sans les textes `thinking` observés ; aucun raisonnement caché n'est converti en
  texte. La variation du contexte relevé par tour n'est qu'un contrôle de monotonie.
- *Corpus (décision `74cbcec9…`).* C1 = QD-EFF-a (`ebf2ba0c`, archive `dce7ca72…`) et QD-EFF-b (`c9e479b3`,
  archive `5cb467a6…`), configuration `555b202f` : principal pour la non-régression, la dépense et les
  origines exercées, avec une dispersion a/b |a − b| / ((a + b) / 2) (« non définie » si le dénominateur est
  nul) ; la dépense en findings lors d'une reprise y est « non exercée ». C2 = pilote final `0ffdeedc`
  (archive `aebccae8…`, configuration `83eb62a`) et QD-P1b `c3eba4f9` (archive `fdbe72ed…`, configuration
  `383a5f36`), distincts, avec les périodes du pilote séparées par la pièce de séparation (`6a335e18…`, ni
  cinquième run ni effectif à additionner) et le repli de modèle isolé. Pas d'agrégation entre candidats.
  **Changement explicite de corpus :** QD-EFF-a/b remplace la cible `a1c83f` du présent fichier, dont
  l'inventaire réalisé n'a trouvé aucune pièce (absence bornée à cet inventaire) ; la raison est conservée
  ici, sans nouvelle recherche historique. `1c5d47` (configuration `870f389`), les runs 12 à 15 et les autres QD sont exclus de
  l'attribution.
- *Périmètre du futur code.* `bin/run-cost` ; `tests/test_run_cost.py` (ajouts seuls : les 27 tests
  existants restent inchangés) ; un dossier de fixtures `tests/fixtures/run-cost-contexte/` ; une section
  d'usage dans `README.md`. Aucune dépendance nouvelle, aucun changement de runtime, de configuration ni
  d'extension. Sans `--contexte`, les sorties restent identiques à l'octet et les refus inchangés.
- *Qualification bornée.* Fixtures calculées à la main, cas mordants avec un mutant par garde, table et
  banc figés avant le passage, arrêt au premier écart, essais de mise au point séparés des preuves ; les
  huit cas du préalable sont rejoués avec le candidat. Un défaut d'admissibilité prévu donne « non établi » ;
  un écart d'instrument, d'intégrité ou de rapprochement impose l'ARRÊT. Le retour arrière est décrit au
  plan ; les relevés historiques et les sorties antérieures restent immuables.
- *Séquence.* Une livraison unique (plan, textes documentaires, code, preuves, recettes, identité du
  candidat), une revue de Sol, puis deux actes de Mo, chacun sur autorisation propre, pi arrêté, sans sudo,
  une fois : **établissement** (précontrôles ; vérification native du nouveau code sur les copies scellées,
  dont le premier écart arrête l'acte *avant* toute pose ou commit ; commit documentaire POST-3c, puis
  commit du code de phase 0), puis **publication** (un seul push, sans force ni tag, tête distante exigée
  `8ac87262…`). **POST-3c ne touche que `SUIVI.md` et `CHANTIER.md`** ; la boîte privée et le registre restent
  hors dépôt et hors push ; aucun fichier de code n'entre dans POST-3c.
- *Règle Python (précision `5c5a4a8e…`).* **Aucun gel de version.** Les passages emploient le Python stable
  courant de l'environnement habituel de la machine ; l'interpréteur est résolu une fois, puis invoqué
  explicitement, et **son chemin et sa version sont relevés dans l'environnement réel de l'invocation** —
  l'interpréteur qui exécute effectivement l'instrument, pas un autre `python3` résolu par le shell. Les
  lanceurs ne masquent pas par un `PATH` imposé l'installation habituelle de Mo. Un numéro annoncé par un
  relevé historique du bac n'est ni cible, ni minimum, ni condition d'admission. Une version différente
  entre bac et Mac, ou après une mise à jour automatique, n'est pas à elle seule un écart ni un motif
  d'ARRÊT ; l'écart, c'est une sortie canonique différente. Un échec effectif se rapporte avec son
  environnement et n'autorise aucun repli automatique vers une ancienne version. Aucune recherche de
  version sur Internet, installation, rétrogradation ni modification du système n'est ouverte.
- *[15-10, clôture] Relevés d'exécution, sans gel.* L'établissement a relevé l'interpréteur effectivement
  employé : Python 3.15.0, Darwin arm64 ; le rapport de r5 a été produit en bac sous Python 3.13.16. Ce sont des
  relevés, ni une cible, ni un minimum, ni un gel ; la règle ci-dessus est inchangée.

- [x] **Écrire la commande d'analyse, versionnée sous `bin/` et testée.** *29-09 : la part
      coût existe — `bin/run-cost`, livrée dans ITE-1, reproduit la baseline fonctionnelle ;
      la part contexte (mesure A) reste à écrire.* `ANALYSE-f0797e`,
      que `CHANTIER.md` citait comme l'endroit où elle vivait, est **introuvable** — ni dans
      les 202 commits de la branche, ni chez Mo. Sur le modèle du relevé de dépense : lecture
      directe de `.pi-subagent-runs/*.json` et des sessions, jamais par soustraction, contrôle
      du nombre de tours contre la session. *Troisième instrument perdu hors du dépôt* —
      après la porte S4 et la baseline `tsc`.
      *[15-10, clôture :]* faite sous la forme de l'option `--contexte` de `bin/run-cost` (lecture directe,
      rapprochement des artefacts de run et des transcriptions, sans soustraction), publiée dans `604e8948…` ;
      75 tests annoncés OK à l'établissement. Les phrases ci-dessus sont conservées : `ANALYSE-f0797e` n'est
      pas retrouvé, et l'option est un instrument nouveau, versionné et testé, non ce script.
- [x] **Mesure A — ce qui remplit le contexte du worker.** *Remontée de « Dette, sans
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
      *[15-10, corpus révisé :]* la base de la mesure devient QD-EFF-a/b (voir le plan ci-dessus) ;
      aucune pièce de `a1c83f` n'a été trouvée par l'inventaire réalisé (absence bornée à cet inventaire). La ligne ci-dessus est conservée pour
      l'historique.
      *Débloque :* phases 5 et 6, la moitié « économie »
      de la scission d'`AGENTS.md`, l'adoption d'un bras court de l'épreuve de concision.
      [A] Partie 2, *Mesure A — le pivot, renvoi*.
      *[15-10, clôture :]* réalisée au niveau B sur le corpus révisé (QD-EFF-a/b ; pilote final et QD-P1b) :
      **attribution non établie**, aucune cause n'est établie ; la cause 1 (findings d'une reprise) est « non
      exercée » par le corpus principal, qui ne contient aucune reprise. La ligne *Débloque* ci-dessus est
      conservée comme condition d'entrée, **non comme autorisation** : le résultat non établi n'autorise aucune
      optimisation des phases 5 ou 6 (décision de Sol, 15-10).
- [x] **Relevé de dépense par agent, au pilote.** Orchestrateur, worker, scout, reviewer,
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
      *[15-10, clôture :]* relevé historique publié par rôle selon la grille et le dénominateur du plan, sans
      montant et sans agrégation entre candidats ; la durée cumulée des délégations reste distincte de la durée
      écoulée. Les entrées ci-dessus (QD-P0, pilote du 27-09, sol/17, sol/18) sont conservées telles quelles ; ce
      relevé ne tranche pas le modèle du reviewer.
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

*[16-10, clôture de la phase 3]* La phase 2 est la suivante dans l'ordre du 08-10 ; elle conserve son plan
préalable, à soumettre, et sa construction n'est pas autorisée par la clôture de la phase 3. Aucun item
ci-dessous n'est ouvert, modifié ni coché par ce portage.

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

*Précisé le 08-10 (adjugé) et repris le 14-10 :* ces trois priorités restent prioritaires ; le plan de
phase les distingue des autres dettes et propose explicitement celles qu'il inclut, **sans plafond
automatique de trois items**. Les dettes ci-dessous, dont les deux issues de la clôture de
LOT-PI-ADAPT en fin de liste, sont inscrites, non réalisées.

*[15-10, clôture de la phase 0]* La phase 3 est la prochaine phase technique, **avant la phase 2** (décision de
Sol, 15-10). Son plan préalable, **à adjuger**, borne son périmètre, ses conditions d'entrée, sa qualification et
son retour arrière ; il nomme les autres dettes qu'il inclut ou laisse au backlog, sans plafond automatique de
trois items. Priorités maintenues : protection des registres durables, instruments hors dépôt, garde du push.
**Aucune construction, activation, modification de production ni exécution de phase 3 n'est autorisée avant
l'adjudication de ce plan.** La préparation documentaire du plan peut avancer en parallèle du portage du suivi,
à partir des pièces conservées. maxParallel reste en phase 8 ; la montée de pi reste en phase 9b.

*[16-10, clôture de la phase 3]* **La phase 3 est achevée au niveau A, dans le périmètre P1, P2, P3, D1 et D2**
(décision `e87b4ea6…` ; voir *Ce qui est fait*, « Phase 3 — clôture »). Le paragraphe du 15-10 ci-dessus (plan «
à adjuger », aucune construction) et la formule « inscrites, non réalisées » du 14-10 décrivent des états
antérieurs et sont conservés. **Les cases cochées le 16-10 sont des propositions de clôture, soumises à Sol,
chacune avec sa preuve et sa limite** ; une case laissée ouverte l'est avec son motif. Les limites maintenues et
le backlog B1 à B10 du plan (`66e79b46…`, hors dépôt) sont en fin de liste.

- [x] **`.pi-subagent-runs/` est ignoré par git et porte les registres durables.** Un
      `git clean -xfd` détruit le registre d'un run en vol ; constaté le 08-09, douze
      artefacts réels perdus. Forme indécise : déplacer hors du dépôt, ou protéger sur place.
      *[16-10, proposition de clôture]* **Traité sur place (P1, C1 `54eb40e6…`).** Forme adjugée : protection
      sur place, sans déplacement ; marqueur de dépôt imbriqué posé avant les effets de `withSpaceGuard`.
      *Preuve :* preuves neuves C1 14/14 rouges puis vertes ; `git clean -xfd`, `-Xfd` et `git stash --all`
      éprouvés sur des mondes jetables, jamais sur un espace réel ; témoins P1 verts sur le Mac (V5). *Limite :*
      ni double force (`-xffd`), ni suppression explicite, ni retrait du marqueur ; les runs anciens sans
      marqueur ne sont protégés qu'après leur passage par la nouvelle préparation, sans migration ni protection
      rétroactive ; marqueur illisible ou non-Git : échec fermé par erreur de chargement (RA-7).
- [ ] **Instruments hors dépôt : porte S4 v7 et baseline `tsc --strict`.** Ils vivent dans le
      répertoire d'audit local, reconstruits à chaque passage. Tant qu'ils ne sont pas dans le
      dépôt, une preuve dépend d'un script joint plutôt que d'un fichier relu. À verser au
      regel. Même famille que la commande d'analyse perdue.
      *[14-10]* Même famille aussi : l'instrument externe de qualification Mac r4 (18 fichiers) vit
      hors dépôt, sous `/Users/MoG/audits/couche-pi/qualif-mac-correctif-r4/paquet/instrument/`, lié à
      son candidat et à ses chemins (O2-1). Le CLI interne `bin/pi-contrats` n'est pas une
      requalification opérationnelle de la production établie.
      *[16-10, versé en partie, case laissée ouverte]* **Versé au dépôt (P2, C5 `186aac98…`)** : dossier
      `instruments/`, avec le script S4 (`06de488f…`), son verrou d'outillage et les dix-huit fichiers de
      l'instrument externe de qualification Mac r4, en copies à l'octet sous garde d'intégrité (25/25 et paquet
      r4 `fe58ff7b…` 64/64 sur le Mac ; vingt copies égales aux sources). *Reste ouvert :* **la baseline `tsc
      --strict` et les références S4, constituées en bac sur la base, ne sont pas versées par cette phase
      d'après les pièces reçues** ; instruments interne et externe restent distincts (**O2-1 ouverte**,
      `b1a99caa…` historique) ; S4 vert limité à sa projection, qui ne couvre ni `pre-push` ni les copies sous
      `instruments/` ; aucune requalification de pi.
- [ ] **Le manifeste de gel n'enregistre pas les outils de revue** — versions de Claude Code
      et de Codex, empreinte du prompt des relecteurs. Contourné à la main le 08-09.
- [x] **Le push n'est pas gardé en machine.** Le commit l'est (jeton à usage unique,
      `pre-commit`, `reference-transaction`) ; une adjudication « commit oui, push non » ne
      vit que dans un message — d'où l'écart `PUSH-B` du LOT 9. Candidat de garde, pas
      reproche.
      *[14-10, précisé au portage POST-3]* Le jeton à usage unique relève du mécanisme TOKEN de
      `bash-guard` pour les commandes interceptées, et non des trois crochets. Depuis POST-1 (13-10),
      `core.hooksPath` local active
      `commit-msg`, `pre-commit` et `reference-transaction` ; `pre-commit` refuse si
      `PI_SUBAGENT_ROLE` est non vide, `reference-transaction` refuse en phase `prepared` sous le même
      rôle ; une variable vide n'est pas refusée. Ils ne rendent pas Git intégralement en lecture
      seule, ne prouvent pas à eux seuls l'impossibilité d'un push enfant et ne constituent pas un
      jeton de commit à usage unique. **La dette de garde du push reste ouverte.**
      *[16-10, proposition de clôture dans le périmètre adjugé]* **Gardé en machine pour ce dépôt (P3, C2
      `1672db59…`)** : crochet `pre-push` à autorisation exacte à usage unique, deux refus de `bash-guard` (le
      fichier d'autorisation ; `--no-verify` et `commit -n`) ; **quatre crochets actifs** depuis C2. La phrase «
      reste ouverte » ci-dessus décrit l'état du 14-10, conservé. *Preuve :* preuves neuves C2 39/39 rouges puis
      vertes ; pushes réels vers des distants nus jouets avec le crochet exact du candidat (banc et Mac) ; sur
      le Mac, refus sans autorisation, acceptation exacte avec consommation unique, second push refusé,
      concurrence → une acceptation et une consommation (V5) ; acte 2 réel : un push, une consommation, tête
      distante C5. *Limite :* garde contre l'erreur ordinaire, non contre un opérateur décidé ni contre un
      acteur modifiant l'espace personnel (contrôles de propriétaire et de longueur retirés du crochet, adjugé)
      ; le crochet ne voit pas tous les drapeaux de la commande, et l'ascendance n'est pas la détection de
      `--force` ; `bash-guard` lexical (RA-5, RA-15) ; TOKEN_SOURCES préexistant, au backlog.
- [ ] **L'écrivain sous R accepte un registre v2 lisible mais `UNKNOWN`** — un `event_seq`
      dupliqué laisse passer un `REVIEWED`. Sans conséquence aujourd'hui (le producteur et la
      porte refusent en amont) ; durcissement distinct, avec falsification de l'absence
      complète d'écriture.
- [ ] **Aucun événement d'après-appel.** L'extension s'abonne à `session_start`,
      `session_shutdown` et `tool_call` ; C6.4 veut aussi une vérification après l'appel.
      *[16-10, constat de code, case laissée ouverte]* L'abonnement `pi.on("tool_result", …)` est présent à la
      ligne 4213 de l'index à `604e8948…` (le commentaire C6.4 commence à la ligne 4209), corroboré par Sol à la
      réception du plan. C'est un **constat de code, non une preuve complète du contrat C6.4** : l'item reste
      ouvert ; toute clôture documentaire citerait les preuves applicables et reviendrait à Sol (B3 du plan).
- [ ] **Aucune surface n'abandonne une lane saine.** `subagent-recover … abandoned` ne traite
      que les contradictions. Hors audit selon Sol : à canoniser d'abord (raison, bail, effet
      sur le worktree, événement durable).
- [ ] **Dettes laissées ouvertes par les deux correctifs**, hors périmètre adjugé : C5, C4/B6,
      C6, C7, D2 avec R15/R20 (diagnostics opérateur, avant généralisation), D3, D5 à D7, B7 ;
      R6/R17 acceptées comme limites de preuve. [A] Partie 1, correctifs UNKNOWN-LEGACY et C4.
- [ ] **Le footer ne dit pas quelle skill est sollicitée.** *La donnée manque d'abord :* la
      liste des skills dans l'artefact (voir phase 5). Afficher ce qui a été observé, ne pas
      observer pour afficher.
- [x] **D-P3-N1 / TMPDIR — N1 non portable au TMPDIR macOS par défaut.** *[13-10, clôture de
      LOT-PI-ADAPT]* `tests/l0-pi-adapt.test.ts` dépend du TMPDIR : seules les portes M4 à
      `/Users/MoG` (10 caractères) sont qualifiées ; un témoin à 12 caractères a échoué, sans seuil
      universel ; `/private/tmp` reste hors du périmètre de portabilité établi. Dette de
      phase 3, non bloquante pour la clôture obtenue. Devient condition d'entrée de la montée si les
      portes tournent sous un autre TMPDIR (`MONTEE-PI` § 8). *À inclure explicitement au plan.*
      *[16-10, proposition de clôture]* **Traité (D1, C3 `3bc6ba86…`).** N1 ne dépend plus de la longueur du
      TMPDIR : correction dans le harnais seul (`describePlan` sur arguments normalisés) ; références
      `6b9df735…`, générateur, attendus et code de production inchangés. *Preuve :* D1 sous des TMPDIR de 4, 12
      et 47 caractères (base : vert, rouge, rouge ; arbre final : vert trois fois) ; sur le Mac, quatre portes
      égales au bac sous un TMPDIR réel de 108 caractères (V4). *Limite :* la normalisation en entrée de
      `describePlan` ne démontre pas le rendu brut pour toutes les longueurs de racine ; P5 et V4 gardent leurs
      portées propres ; la condition d'entrée de la montée (`MONTEE-PI` § 8) reste à apprécier au plan de
      montée, non par ce portage.
- [x] **O1-7 / D-P3-PI-SURFACE-METADONNEES — un `.DS_Store` fait refuser le scanner de surfaces.**
      *[13-10]* Un `.DS_Store` sous `tests/pi-contrats` peut faire refuser `tests/l0-pi-surface.test.ts`.
      Correction future : distinguer cette métadonnée connue des sources non déclarées, sans ignorer
      tous les non-suivis. Dette de phase 3. *À inclure explicitement au plan.*
      *[16-10, proposition de clôture]* **Traité (D2, C4 `4ca90fda…`).** Un `.DS_Store` ordinaire est admis sous
      `tests/pi-contrats` seulement, par son nom exact ; `.DS_Store.ts`, tout autre fichier, un type anormal et
      la variante hors de la surface restent refusés. *Preuve :* preuve P3-O7 ; rouge avant correction porté par
      les mutants ; suite complète des mutants et portes de l'arbre final conformes. *Limite :* ce n'est pas un
      filtre général des non-suivis.
- [ ] **Limites maintenues par la clôture de la phase 3, non fermées (16-10).** TOKEN_SOURCES (même forme de
      retour arrière que le motif corrigé, préexistant) ; analyse lexicale de `bash-guard` (RA-5, RA-15) et faux
      positifs déclarés ; protection des registres de portée bornée, échec fermé par erreur de chargement pour
      deux marqueurs illisibles (RA-7) ; autorisation de push sans propriétaire vérifié ni borne de longueur,
      objet sur 64 hexadécimaux (RA-13), refus post-création non provoqués par le banc (RAR-9) ; O2-1 ;
      vérification native factice dans le banc hors NVR2 et NVR3, qualification native 2 au profil du bac et non
      sur le Mac ; copies de travail non jointes ; libellé de l'orchestrateur (`index.ts`, l. 4396) non modifié.
      Détail : *Ce qui est fait*, « Phase 3 — clôture ».
- [ ] **Backlog B1 à B10 du plan de phase 3 (`66e79b46…`, hors dépôt), laissé ouvert et motivé au plan.** Leur
      table n'est pas recopiée ici, aucune des pièces reçues pour ce portage ne la portant ; « introuvable sous
      audits » ne vaut pas inexistence ailleurs. B3 : voir *Aucun événement d'après-appel*.

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
- [ ] **Mesurer `maxParallel`, puis inscrire la valeur retenue dans la configuration.**
      *Proposition de Mo, 15-10 — inscription au suivi retenue ; plan de phase à adjuger.*
      Aucune mesure ni aucun changement de réglage n'est autorisé ici. La référence historique
      qualifiée est `maxParallel=2` (pilote du 27-09, qualifié le 29-09).
      Au plan de phase 8 : fixer les valeurs candidates, conserver 2 comme témoin et comparer sur un
      même corpus, à conditions contrôlées, avec répétitions et dispersion déclarées.
      *À fixer au plan :* objectif, périmètre, qualification bornée, retour arrière et critères de choix.
      Mesurer durée de campagne, qualité, coût et tokens, reprises, conflits et quota fournisseur ;
      aucun gain de coût ou de tokens n'est présumé. Conserver le détail par worker et les agrégats de
      campagne, selon les mêmes règles de comptage. Toute valeur retenue reste bornée au contexte testé.
      *Condition d'entrée :* l'ordre des phases est conservé (3 avant 2, phase 8 après 2 à 7), avec
      gel et pilote préalables, puis plan de phase adjugé.
      *Activation distincte :* après décision sur les résultats et autorisation de pose, la valeur
      persistante, révisable, vit dans la configuration versionnée ; le runtime l'applique au nominal.
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

*[Remplacé le 08-10, historique]* *Posée le 30-09 : juste après la clôture du lot ITE, jamais pendant un
lot mesuré ; précède la phase 10.* **Avancée le 06-10 pour pi :** la montée de pi passe juste après la
clôture du lot efficacité, avant la phase 0. [A] Partie 1, *Dépendances d'extensions non épinglées*, et
LOT-EFFICACITE, 06-10.

*Ordre actuel (08-10, repris le 14-10) :* la phase 9b vient **après la phase 9**, puis le QD de référence
sur son environnement final, puis la phase 10. La montée de pi n'est plus avancée avant la phase 0.
**0.86.0 reste la seule version qualifiée ; aucune cible n'est choisie ni recherchée par le portage.**
Procédure : `docs/MONTEE-PI.md`.

- [x] **Inventaire et couche d'adaptation pi** — niveau A, neutre sur 0.86 : ce que la
      configuration utilise de pi, isolé derrière une couche avant toute montée. **Clos le 13-10**
      (LOT-PI-ADAPT, commit `2def810f`, arbre `b1a99caa`) dans son périmètre ; voir *Ce qui est fait*.
      Ne clôt ni P3 ni la montée de pi : celle-ci reste ouverte ci-dessous.
- [ ] **Montée de pi directe vers la cible stable publiée.** *[adjugé le 08-10, remplace les paliers du
      06-10]* La cible est la dernière version stable publiée, **vérifiée à la constitution du plan de
      montée**, puis désignée par sa version exacte et ses empreintes ; jamais `latest` comme identité
      d'exécution ; une publication ultérieure ne change pas la cible adjugée. 0.87.0 et 0.99.0 ne
      sont plus des paliers qualifiés obligatoires : diagnostic déclaré et autorisé seulement ; une
      rupture nominale sur la cible impose ARRÊT et retour. pi 1.0.1 retire `npm-shrinkwrap.json`
      (notes officielles, constat de Sol du 08-10) : **épingler la seule version ne suffit pas** à
      identifier une installation reproductible ; la nouvelle identité d'instrument est soumise à Sol
      avant qualification. MCP et codemode restent désactivés sauf adjudication contraire. Les
      contrats avec le SDK réel, les portes et le registre servent à qualifier la cible ; des stubs
      seuls ne suffisent pas. *Conditions d'entrée :* `docs/MONTEE-PI.md` §§ 2 et 8 — plan
      complémentaire des surfaces restantes (P3), liaison de `PI_VERSION_QUALIFIEE` (O1-4),
      instrument de la cible (O2-1), formes jiti (O2-4), portabilité, D-P3-N1 et D-P3-PI-SURFACE-
      METADONNEES selon le cas, sujets de commit du runtime.
      *Ancien libellé (06-10), remplacé :* « Montée de pi par paliers — 0.87.0 obligatoire, 0.99.0
      explicite, version cible épinglée ; MCP et codemode désactivés sauf adjudication contraire.
      Toutes les portes et les contrats avec le SDK réel sont éprouvés à chaque palier ; des stubs
      seuls ne suffisent pas. Un run QD de référence après le dernier palier conforme. »

- [ ] **Monter les versions laissées en attente, une à la fois** — système et outils, puis
      Node, puis pi, puis les extensions non épinglées. Tout a été qualifié sur un
      environnement figé (pi 0.86.0, Node v26.10.0) ; après chaque montée, toutes les portes
      rejouées, et un run QD de référence après pi. Ce qui peut casser en silence : l'API des
      extensions, la compaction, les formats JSONL lus par les instruments, le catalogue de
      modèles. L'épinglage de pi dans les scripts se change par un commit explicite.
      *Pour pi, tranché le 06-10 (items ci-dessus).* Le QD conforme après le dernier palier
      devient la nouvelle référence de version ; les anciennes baselines restent immuables.
      *[14-10]* « Node v26.10.0 » est l'état du 06-10, historique : LOT-PI-ADAPT a été qualifié sous
      Node 22.22.0 et 26.11.1 (bac) et Node 26.11.1 (Mac r4), pi 0.86.0. *Pour pi, « par paliers » et
      « dernier palier » sont remplacés le 08-10 par la montée directe ci-dessus.* Les autres montées
      de la phase 9b restent séquencées, une version à la fois, toutes les portes applicables après
      chacune ; une livraison commune n'autorise pas une mise à jour simultanée. Le QD de référence suit
      la qualification de pi et la stabilisation des autres versions, sur l'environnement exact qui
      entre en phase 10, sur autorisation propre.

### Phase 10 — modèles

*Posée le 30-09, après tous les lots mesurés.* [A] Partie 2, 2E, *Modèles des rôles*.

- [ ] **Passer chaque rôle au dernier modèle de sa famille** — mise à jour de pi pour son
      catalogue, un commit par rôle, appel réel du modèle exact, run de référence et banc
      avant/après. Les identifiants exacts sont gardés : les noms génériques de pi choisissent
      par sous-chaîne et ordre alphabétique, pas par version. *L'avertissement au chargement*
      (« plus récent disponible », jamais de bascule automatique) peut venir plus tôt, hors de
      tout lot mesuré.
      *[08-10, repris le 14-10]* Une phase par lot : la livraison commune conserve les changements et
      mesures par rôle (modèle exact, un commit par rôle lorsqu'il est autorisé, appel réel, run de
      référence, banc avant/après). Le témoin avant changement de modèle est établi sur
      l'environnement final de 9b, pour ne pas attribuer au modèle l'effet d'une montée de pi ou de
      Node.

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
      *[16-10]* Depuis la phase 3, tout push de ce dépôt exige une autorisation exacte à usage unique propre à
      sa mise à jour ; la recette de la phase 3 n'en prévoit qu'une, pour `refs/heads/feat/subagent-extension`
      sur origin. Ce push vers `main` n'est ni préparé ni autorisé par ce portage.
- [ ] **Construire à l'exécution les littéraux factices des tests** — `tests/guards.test.ts` et
      `tests/l0-a-harness.test.ts`. *Proposition de Mo, après une alerte GitHub déclarée fermée
      « Used in tests ».* **Lot distinct, non urgent, à instruire** (adjugé le 14-10) : identifier les
      sites et la nature synthétique des données, préserver les propriétés et résultats des tests, ne
      pas assouplir une garde ni son détecteur. L'absence de toute nouvelle alerte n'est pas promise ;
      aucune conclusion générale sur les secrets de l'historique n'est acquise par ce signalement.
      Aucun changement de ces tests dans le portage POST-3 ; aucun scan ni purge ouverts ; les autres
      dettes de sécurité historiques (`CHANTIER.md`, § 8) sont conservées.

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

*Portage POST-3 (14-10) :* même régime — la boîte d'attente reste entière, le commit ne vaut ni
archivage ni autorisation de la vider. Un commit de documentation passe par le crochet `commit-msg`
actif (POST-1) : voir le format dans *Ce qui est fait*.

*Portage POST-3c (15-10) :* même régime. Le commit ne porte que ce fichier et `CHANTIER.md` ; la boîte
d'attente et le registre des résultats restent hors dépôt et hors push, et la boîte reste entière. Les
résultats de la phase 0 (mesure, rapport) s'inscriront dans un commit documentaire ultérieur, après leur
adjudication.

*Portage de la clôture de la phase 0 (15-10) :* même régime. Le commit ne porte que ce fichier et
`CHANTIER.md` ; la boîte d'attente et le registre des résultats restent hors dépôt et hors push, et la boîte
reste entière. Sa base publiée est le commit `604e8948…` ; son établissement et sa publication ont leurs
autorisations propres.

*Portage de la clôture de la phase 3 (16-10) :* même régime. Le commit ne porte que ce fichier et `CHANTIER.md`
; la boîte d'attente et le registre des résultats restent hors dépôt et hors push, et la boîte reste entière. Sa
base publiée est le commit `186aac98…` ; son établissement et sa publication auraient chacun leur autorisation
propre, et son push exigerait, comme tout push de ce dépôt, une autorisation exacte à usage unique.
