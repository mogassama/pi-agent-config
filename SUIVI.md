# Suivi — configuration pi

*Journal des runs et liste des tâches. Une ligne par run : ce qu'il a mesuré, ce qu'il a
corrigé. Une case par tâche restante : sa condition d'entrée et son chiffre de contrôle.*

Branche `feat/subagent-extension`. État courant : lot `5543d92` + corrections post-relecture.
`CHANTIER.md` fait foi sur les décisions et leurs raisons ; ce fichier sur ce qui a été fait
et ce qui reste.

---

## Configuration au 21 août 2026

| Rôle | Modèle | Thinking | Session | Tours | Outils |
|:--|:--|:--|:--|--:|:--|
| worker | `openai-codex/gpt-5.6-sol` | `high` | éphémère | **30** ¹ | read, grep, find, ls, bash, edit, write |
| reviewer | `anthropic/claude-sonnet-5` | medium | éphémère | **12** ² | read, ls |
| scout | `deepseek/deepseek-v4-flash` | low ³ | éphémère | 12 | read, grep, find, ls, bash |
| advisor | — | — | — | — | **non écrit** |

¹ Monté de 20 à 30 après le run `b9baad`, où quatre workers sur quatorze ont soumis au tour
exact du plafond en étant encore en train d'éditer. Consigne : conclure quatre tours avant.
² Plafond plat à 12 depuis le run 5, où trois revues sont mortes à 8 en tenant leur diff.
L'échelle s'était inversée : le chemin dégradé donnait 12 tours et le chemin inline 8, donc
relever `DIFF_MAX_CHARS` avait fait sortir les plus gros changements du 12 pour les mettre
dans le 8. Douze partout ne peut plus s'inverser. Le chemin dégradé garde `grep` et `find`.
³ **Correction du 22 août.** `minimal|low|medium → null` ne veut pas dire « pas de
raisonnement » mais « champ omis », donc le modèle retombe sur son défaut — et
`deepseek-v4-flash` est hybride. Les douze scouts du run `b9baad` ont émis entre 323 et
2 409 tokens de raisonnement, 1,3 % de leur budget. Les trois niveaux bas sont un seul et
même réglage ; seuls `high` et `max` déplacent quelque chose.

Sept extensions : `bash-guard`, `pi-bq-cost-sentinel`, `pi-check-config`, `pi-lint-gate`,
`pi-project-brief`, `subagent`, `subagent-footer`.

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
| Balance Âgée | **run 6 `48acec`** | **40** | **317** | **3,59 $** | **1** |
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

### Balance Âgée — deux runs

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

- [ ] **Balance Âgée run 5** — un seul changement : le seuil d'inline du diff, 32 000 → 80 000.
      *Attendu :* zéro revue dégradée — les deux du run 4, à 38 et 71 kO, passent en inline.
      *Mesurer :* `grep -c 'No diff is inlined' .pi-subagent-runs/*reviewer.json` doit valoir 0,
      et les tours du reviewer se comparer à `[2,2,2,3,4,4,5,5,6,6,7,8,8,11]`. Si la queue à
      8 et 11 disparaît, le seuil était la cause ; si elle demeure, elle est ailleurs.
      *Surveiller :* le coût du reviewer — 2,86 → 2,94 → **3,49 $**, seul poste qui ne baisse
      pas. Son coût *par tour* est plat à ~0,049 $ : il coûte plus parce qu'il tourne plus,
      pas parce qu'il est devenu cher.
      *Et le rendement du worker :* 3,58 → 3,95 tours par test ajouté. Un run de plus avant
      d'en tirer quoi que ce soit — l'écart est dans la dispersion.

### Après le run 4

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

### Séquence Qwen / advisor

- [ ] **Vérifier que pi expose Qwen** — `pi models | grep -i qwen`. Sans provider, tout
      s'arrête là. Et son modèle de cache doit entrer dans `RATES` avec ses propres
      multiplicateurs : une entrée naïve surfacturerait, comme elle l'aurait fait pour DeepSeek.
- [ ] **Qwen 3.8 Max sur les cinq fichiers d'`anime-etl`** aux verdicts connus. Seule mesure de
      la séquence qui compare un jugement à une **référence** et non à une autre exécution.
      *Porte :* une divergence contre un verdict connu arrête tout.
- [ ] **Qwen sur le reviewer**, puis `csv-to-bq` contre `37acf6`/`f414d3`.
      *Porte :* baisse des findings à `confidence: certain` → on revient à Sonnet.
      *Gain attendu :* ~0,09 $ sur 0,68 $, soit 13 % — **sous la dispersion**. Cette étape se
      justifie par la qualité du jugement, pas par le coût.
- [ ] **Écrire `advisor.md`**, Sonnet 5. Trois choses le même jour, sinon le menu proposera un
      rôle que la documentation interdit : retirer « designed but not written » d'`AGENTS.md`,
      retirer « There is no advisor role today », ajouter une branche à `deriveNext()` — un avis
      n'est jamais `done`, sa sortie est une entrée de décision.
- [ ] **Balance Âgée rejoué**, contre le run 3.
      *Lever l'ambiguïté :* `ls .pi-subagent-runs/*advisor*.json | wc -l` — zéro délégation
      advisor = comparaison propre sur le seul reviewer.

### Le test final — régime libre

- [ ] **Un sujet corsé, un seul prompt, aucun bundle, plusieurs pièges**, comparé à Claude Code
      en Sonnet 5 `high`.

      C'est le seul régime que treize runs n'ont **jamais** exercé. Tout ce qui est mesuré à ce
      jour porte sur un backlog borné : livrables énumérés, critères de fin écrits, territoire
      nommé. `AGENTS.md` décrit un « régime libre » que rien n'a jamais éprouvé — et la chaîne
      d'invocation y est censée commencer par un scout, ce qui n'a jamais été observé.

      *Ce que le sujet devra contenir, à écrire le moment venu :* une exigence qui ne peut être
      satisfaite qu'en lisant une donnée réelle non décrite dans le prompt ; une optimisation
      naturelle qui casse une propriété non énoncée ; une décision irréversible sans réponse
      évidente — le cas advisor ; un piège de conformité que seul un test contre la réalité
      révèle.

      *Le critère de qualité s'écrit avant les deux runs.* Sinon il s'écrira en fonction de
      celui qui aura le mieux marché.

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
