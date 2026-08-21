# Suivi — configuration pi

*Journal des runs et liste des tâches. Une ligne par run : ce qu'il a mesuré, ce qu'il a
corrigé. Une case par tâche restante : sa condition d'entrée et son chiffre de contrôle.*

Branche `feat/subagent-extension`. État courant : `1de8292`.
`CHANTIER.md` fait foi sur les décisions et leurs raisons ; ce fichier sur ce qui a été fait
et ce qui reste.

---

## Configuration au 21 août 2026

| Rôle | Modèle | Thinking | Session | Tours | Outils |
|:--|:--|:--|:--|--:|:--|
| worker | `openai-codex/gpt-5.6-sol` | `high` ¹ | éphémère | 20 | read, grep, find, ls, bash, edit, write |
| reviewer | `anthropic/claude-sonnet-5` | medium | éphémère | 6 ² | read, ls |
| scout | `deepseek/deepseek-v4-flash` | low ³ | éphémère | 12 | read, grep, find, ls, bash |
| advisor | — | — | — | — | **non écrit** |

¹ Sur disque depuis le 21 août, **pas encore commité**.
² 10 si le diff dépasse 16 kO, 12 si aucun diff n'a pu être fourni — le budget suit l'entrée.
³ `deepseek-v4-flash` mappe `minimal|low|medium` sur `null` : le scout tourne sans raisonnement.

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

- [ ] **Balance Âgée run 3** — worker en `high` + contrat d'entrée du scout.
      *Deux mesures séparables :*
      `cat .pi-subagent-runs/*refusals.jsonl | wc -l` — adoption de `find`/`scope`
      `python3 -c "import json,glob; w=[json.load(open(f)) for f in glob.glob('.pi-subagent-runs/*worker.json')]; print(len(w),'délég,',sum(x['turns'] for x in w),'tours')"` — contre 14 / 142
      *Décide :* si les tours worker baissent, le `high` reste. Si les réconciliations
      disparaissent des tâches scout (référence 4 sur 25), le contrat tient.

- [ ] **Commiter `worker.md` en `thinking: high`** — sur disque, absent du dépôt.

### Après le run 3

- [ ] **Règle de découpage des tâches worker**, si et seulement si un `max_turns` worker
      réapparaît. Le critère actuel d'`AGENTS.md:385` — « plus de la moitié des tours » —
      condamne la tâche médiane (10,1 tours sur 20). La version proposée porte sur le nombre de
      fichiers qu'on s'apprête à nommer, pas sur une prédiction de tours.

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
