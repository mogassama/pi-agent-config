# Chantier — registre des modifications

*Tenu à jour à chaque séance. Trois états : **appliqué** (dans le dépôt),
**à déposer** (produit, pas encore installé), **à faire**.*

Branche de travail : `feat/subagent-extension`, partant de `main` à jour.

---

## 1. Fichiers produits — état

*Branche `feat/subagent-extension`. Tout ce qui est marqué **poussé** est en ligne.*

### Poussé

| Fichier | Note |
|:--|:--|
| `skills/*/SKILL.md` — 11 deltas | Ancienne section de relecture supprimée dans chacune |
| `skills/code-review/SKILL.md` | Cinq blocs de domaine retirés, table de renvoi à la place. 216 → 185 lignes |
| `SUBAGENTS-DESIGN.md`, `PLAN-V2-POST-MESURE.md`, `CHANTIER.md` | Racine du dépôt |
| `subagent-only/envelope/envelope.ts` | v2 : `issue`/`fix`, verdict minuscule, `files_reviewed`, `open_risks` |
| `subagent-only/slicer.ts` | Découpeur, validé sur les 20 skills |
| `subagent-only/agents.ts` | Schéma étendu + `mechanism` |
| `subagent-only/dispatch.ts` | Boucle, chaîne de repli, erreurs fournisseur |
| `subagent-only/spawn-args.ts` | Construction d'argv, clôture imposée |
| `subagent-only/agents/{worker,reviewer}.md` | |
| `extensions/subagent/{index.ts,package.json}` | Outil `task` — **190 tokens** dans l'orchestrateur, contre 5 468 pour les six de `pi-subagents` |
| `AGENTS.md`, `settings.json`, `.gitignore` | Fusionnés dans `main` |

### À déposer

| Fichier | Correction |
|:--|:--|
| `subagent-only/agents/reviewer.md` | `model: anthropic/claude-sonnet-5` — retrait de `claude-bridge` |
| `subagent-only/spawn-args.ts` | `PROVIDER_PACKAGE` vidé, mécanisme conservé |
| `CHANTIER.md` | Ce fichier |

### Chiffres mesurés

| | Valeur |
|:--|--:|
| Orchestrateur, mode print, avant l'extension | 15 005 |
| Orchestrateur, avec l'outil `task` | **15 195** |
| Planchers enfants — 0 / 4 / 7 outils | 959 / 1 514 / 2 023 |
| Coût de la définition de `submit` | ~467 |
| Fork `pi-subagents`, mesuré | **17 041**, dont 2 frais |
| Tranche injectée — worker / reviewer | ~1 375 / ~1 946 en moyenne |
| Total estimé — worker / reviewer | ~4 034 / ~5 742 |

**Une version obsolète à ne pas réutiliser** : le premier Review delta de
`python-engineering`, écrit sans consulter `code-review`. Il contredisait la
table existante et perdait `import *` ainsi que la gestion d'exception au point
d'entrée.

---

## 2. À supprimer

| Quoi | Où | Quand | Pourquoi |
|:--|:--|:--|:--|
| Marqueurs de canari | `agents/worker.md` | dès que possible | `description: MON WORKER LOCAL`, `MARQUEUR-LOCAL-4471`. Fichier public, description qui ne décrit rien |
| `agents/oracle-deep.md` | dépôt | au basculement | Écrit contre le frontmatter `pi-subagents`. Devient une option `--model` sur `advisor` (D0) |
| Blocs « Checklists by domain » | `code-review:80-140` | après migration | Les cinq blocs partent vers les skills de domaine. Voir §3 |
| Section « Delegation with pi-subagents » | `AGENTS.md:204-247` | **après** basculement | ~950 tokens. Ne pas toucher avant que la nouvelle primitive tourne |
| Section « Loadouts » | `AGENTS.md:162-181` | après basculement | ~440 tokens. Meurt avec D4 |
| Bloc `subagents.agentOverrides` | `settings.json` | au basculement | Double source qui écrasait tout |
| Tableaux `skills` | `settings.json` | au basculement | Remplacés par l'injection par tranches |
| `agent-io` | `skills/` | au basculement | D8. Le corpus passe de 20 à 19 skills |
| `pi-subagents` | `settings.json` packages | au basculement | 5 468 tokens d'outils dans l'orchestrateur. **En second temps**, jamais avant que la remplaçante tourne |
| `bin/check-envelope` | dépôt | à trancher | Écrit contre l'ancien contrat (`agent`, `location`, `.pi-subagents/artifacts/`). Réaligner ou supprimer — arbitrage n°6 |
| Requête `JOBS_BY_PROJECT` | `gcp-dataeng-architecture:84` | étape D | Formule fausse sur deux axes |
| Bloc `classify_udf` dupliqué | `spark-engineering:154` | étape D | Identique à `:52` |
| Corps de `/check-config` | `git-collaboration:228-261` | étape D | 46 lignes documentant une extension qui s'exécute seule |
| Scan intégral de secrets | `git-collaboration:120-140` | étape D | |
| Ligne `- scout: results[]` | `APPEND_SYSTEM.md:35` | étape D | Contredite par `:38` |
| Mention « (Paris) » | `bigquery-engineering:22`, `gcp-engineering:21` | étape D | `europe-west1` = St-Ghislain |

---

## 3. Migration `code-review` → skills de domaine

**Principe** : une ligne de sévérité vit avec la règle d'écriture qu'elle pèse.
Si la règle est dans deux fichiers, résoudre la duplication **avant** de placer
la sévérité — sinon on obtient deux tables contradictoires.

Les cinq blocs de `code-review:80-140` sont déjà écrits sous la forme
« Rules: see X skill. Severity assignment: » — c'est-à-dire exactement la forme
d'un delta. La migration est un déplacement, pas une réécriture.

| Bloc source | Destination | État |
|:--|:--|:--|
| Python engineering (`:106-118`) | `python-engineering` | **fait** |
| Security & identity (`:82-90`) | **éclaté** — `gcp-engineering`, `sql-engineering`, `python-engineering` | **fait pour gcp** |
| GCP configs (`:133-139`) | `gcp-engineering` | **fait** |
| Data engineering & costs (`:92-104`) | **éclaté** — voir ci-dessous | **fait** |
| Terraform / IaC (`:123-131`) | `iac-terraform` | **fait** |

### Découverte structurante — dix skills ont déjà une section de relecture

`airflow-engineering`, `bigquery-engineering`, `bigquery-ops`, `code-review`,
`data-quality`, `dbt-engineering`, `gcp-engineering`, `iac-terraform`,
`spark-engineering`, `technical-writing`.

C'est là que vivent les 102 items `- [ ]`. **`python-engineering` n'en fait pas
partie** — le pilote était le cas atypique, et la méthode a été généralisée
depuis lui à tort.

Pour ces dix skills, `## Review delta` **absorbe et remplace** la section
existante. Il ne s'y ajoute pas, sinon on obtient deux sections de relecture
dont une liste de cases à cocher non pondérée.

Conséquence sur la nature du travail : `code-review` et la checklist de la
skill de domaine sont **deux listes parallèles pour le même domaine**, l'une
pesée, l'autre pas. Le delta est leur fusion, pas un déplacement.

### Éclatement du bloc « Security & identity »

| Ligne | Destination | Justification |
|:--|:--|:--|
| Secrets, tokens, mots de passe en dur | `gcp-engineering` | `## Secret Manager` y vit |
| Référence à `service-account.json` | `gcp-engineering` | Règle présente dans la checklist `:281`, pas dans le corps |
| `roles/owner` / `roles/editor` | `gcp-engineering` | **Dupliqué** — `gcp-engineering:50` est la formulation canonique ; `iac-terraform:20` y ajoute `roles/viewer` en production. Divergence à trancher |
| Interpolation f-string dans du SQL | **`sql-engineering`** | La règle y vit. N'a rien à faire dans un bloc GCP |
| `os.system()` / `subprocess.call()` non assaini | **`python-engineering`** | **Orphelin — aucune règle nulle part.** Sévérité HIGH sans règle derrière. À écrire dans `python-engineering`, pas juste à déplacer |
| ADC non utilisé | `gcp-engineering` | Règle présente `:26` |

### Orphelins — sévérité sans règle d'écriture

Deux lignes de `code-review` pèsent une règle qui n'existe dans aucune skill.
Les migrer suppose d'**écrire la règle**, pas de la déplacer.

| Ligne | Sévérité | Décision |
|:--|:--|:--|
| `os.system()` / `subprocess.call()` avec entrée non assainie | HIGH | À écrire dans `python-engineering`, section anti-patterns. Un HIGH sans règle est un trou réel |
| Cloud Function sans limite `max-instances` | MEDIUM | À écrire dans `gcp-engineering`. Garde de coût légitime, absente du corpus |

### Duplications de règle à résoudre avant migration

| Règle | Emplacements | Arbitrage |
|:--|:--|:--|
| Dead-letter Pub/Sub | **4** — `dataeng-architecture:124`, `gcp-dataeng-architecture:110`, `gcp-engineering:206-212`, `code-review:137` | `gcp-engineering` garde l'exemple de commande ; `gcp-dataeng-architecture:110` est l'anti-patron canonique ; `dataeng-architecture:124` est la règle générique d'architecture. **Trois niveaux légitimes ou trois copies ? À trancher** |
| `roles/owner` / `roles/editor` | 3 — `gcp-engineering:50`, `:284`, `iac-terraform:20`, `:283` | `gcp-engineering:50` canonique. `iac-terraform` ajoute `roles/viewer` |
| Expiration de table de staging | 3 — `bigquery-ops:247`, `gcp-dataeng-architecture:66`, `code-review:139` | Aucune n'est une règle explicite, seulement des exemples. La règle reste à écrire |
| `WRITE_APPEND` sans dedup | 2 — `python-engineering:145`, `bigquery-engineering:80` | → `bigquery-engineering` |
| `SELECT *` | 2 — `sql-engineering:32`, `bigquery-engineering:24` | → `sql-engineering` |

### Éclatement du bloc « Data engineering & costs »

| Ligne | Destination | Justification |
|:--|:--|:--|
| Chargement en liste au lieu d'un générateur | `python-engineering` | Règle unique, `python-engineering:135` |
| `download_as_bytes()` sur gros objet GCS | `python-engineering` | Règle unique, `:144` |
| `WRITE_APPEND` sans dedup | `bigquery-engineering` | **Règle dupliquée** — `python-engineering:145` et `bigquery-engineering:80`. BigQuery porte le patron MERGE complet (`:65-80`), Python garde un pointeur |
| Clé `MERGE` unique manquante | `bigquery-engineering` | Idem |
| `SELECT *` en SQL de production | `sql-engineering` | **Règle dupliquée en 4 endroits**, pas 2 : `sql-engineering:32` et sa checklist, `bigquery-engineering:24` et sa checklist. Idem pour « JOIN sans `ON` explicite ». Hygiène SQL générique ; `bigquery-engineering` pointe désormais |
| Filtre de partition absent | `bigquery-engineering` | Règle unique, `:129` |
| `WHERE DATE(timestamp_col)` sur colonne de partition | `bigquery-engineering` | Règle unique, `:56` |
| Note de confiance liée au dry-run | `bigquery-engineering` | Suit le filtre de partition |

### Ce que `code-review` garde

La mécanique de verdict : définitions de sévérité, axe de confiance, règle
`blocked`, étapes de sortie. Rien de spécifique à un domaine.

---

## 3bis. Arbitrages tranchés — 3 août

**Critère appliqué aux duplications** : *si je change d'avis sur cette règle,
combien de fichiers dois-je éditer ?* Un principe et son implémentation ne sont
pas le même fait. Une réénonciation, si.

**Second critère, plus fort** : la règle doit vivre **là où elle sera injectée**,
pas là où elle est conceptuellement la plus pure. Un reviewer de souscription
Pub/Sub charge `gcp-engineering`, pas la skill d'architecture.

| Sujet | Décision | Fait |
|:--|:--|:--|
| **Dead-letter** | `dataeng-architecture:124` reste — sur-ensemble couvrant tout at-least-once, pas seulement Pub/Sub. `gcp-engineering:206` reste et porte la sévérité. **`gcp-dataeng-architecture:110` part**, remplacé par un pointeur : il réénonce au lieu d'implémenter | pointeur à écrire |
| **Rôles de base** | Énoncé canonique étendu aux **trois** rôles dans `gcp-engineering:50`. `owner`/`editor` = HIGH, `viewer` = MEDIUM (il lit, il ne détruit pas). `iac-terraform` pointe et garde ses sévérités propres au Terraform | ✅ |
| **`os.system()` / `subprocess`** | Règle écrite dans `python-engineering`, **plus étroite que la ligne de `code-review`** : l'interdit est la construction d'une commande shell par interpolation d'entrée externe, marqueur `shell=True`. `subprocess` en liste d'arguments reste légitime. HIGH conservé | ✅ |
| **`max-instances`** | **Pas ajouté comme ligne.** La règle Dataflow `--max-workers` est généralisée : *tout service autoscalé déclare son plafond*, avec Dataflow, Cloud Run et Cloud Functions comme instances. Une règle au lieu de trois sœurs, l'orphelin disparaît sans addition | ✅ |

### Les deux skills d'architecture ne fusionnent pas

Suspicion levée après mesure. Six sections sur huit de `gcp-dataeng-architecture`
sont la contrepartie GCP d'une section de `dataeng-architecture` — appariement
délibéré, pas doublon.

Discipline à tenir à la place, testable : **le fichier GCP implémente, il ne
réénonce jamais.** Toute ligne de `gcp-dataeng-architecture` lisible sans
connaître GCP est une copie. `:110` en est une ; à vérifier s'il y en a d'autres.

### Toutes les skills n'ont pas besoin d'un delta

`dataeng-architecture`, `gcp-dataeng-architecture`, `diagnose`, `grill-me`,
`improve-codebase-architecture` servent l'advisor ou l'orchestrateur, pas le
reviewer. Le découpage D4 ne concerne que les skills qu'un reviewer charge.
Cadrage à confirmer skill par skill.

---

## 4. Décisions prises

| Décision | Conséquence |
|:--|:--|
| **Un seul marqueur `## Review delta`**, dernière section du fichier | Amende D4, qui parlait de deux en-têtes. Tout ce qui précède est l'authoring. Évite de rétrograder tous les titres de 19 fichiers en `###`. Changement purement additif |
| Le delta est une **table de sévérité**, pas un rappel de règles | Rend le verdict reproductible — c'est ce qui manquait quand deux revues du même fichier ont rendu `blocked` et `needs_rework` |
| `pi-check-config` valide la présence de `## Review delta` | **Garde non négociable.** Sans elle, un titre renommé fait tomber l'injection en silence |
| `WRITE_APPEND`/`MERGE` → `bigquery-engineering` ; `SELECT *` → `sql-engineering` | Résout deux duplications de règle |

---

### Onze deltas — terminé

Toutes les skills chargées par un reviewer portent désormais un
`## Review delta`, et leur ancienne section de relecture est supprimée :
`python-engineering`, `gcp-engineering`, `iac-terraform`, `sql-engineering`,
`bigquery-engineering`, `airflow-engineering`, `data-quality`,
`dbt-engineering`, `spark-engineering`, `bigquery-ops`, `technical-writing`.

`code-review` est vidé de ses cinq blocs de domaine et ne garde que la
mécanique : définitions de sévérité, axe de confiance, règle `blocked`, étapes
de sortie, plus une table de renvoi vers les onze deltas.

### T7 — résolu

`code-review:171` déclarait le vocabulaire de verdict `mergeable |
needs_rework | blocked`, alors que l'étape 5, lisible, écrivait `Approved`.
**Deux mots pour le même verdict positif dans le même fichier.**

Donc `mergeable` n'était pas un champ manquant : c'était une **valeur légale
jamais atteinte**, aucune des huit revues n'ayant été positive. Le `grep` du
3 août cherchait une valeur et ne trouvait rien — correctement.

Décision : `mergeable` est retiré, le vocabulaire est `approved |
needs_rework | blocked`, en minuscules, aligné sur le schéma de `submit`.

### Ce que l'éclatement a produit

**`code-review` est vide de contenu de domaine.** Les cinq blocs sont migrés.
Il ne garde que la mécanique de verdict — définitions de sévérité, axe de
confiance, règle `blocked`, étapes de sortie.

**Une règle nouvelle, propre à BigQuery** : la confiance est fixée par le
dry-run, pas par le jugement. Un finding dont la sévérité dépend de la taille
de table est `certain` **seulement si** le dry-run confirme le volume scanné ;
sinon `probable`. Comme un HIGH `probable` bloque quand même, la porte n'est pas
affaiblie — mais deux revues du même fichier se mettent d'accord.

**Une règle nouvelle, propre à Terraform** : relire le plan, pas le diff. Si la
sortie de `terraform plan` n'est pas disponible, le verdict est plafonné à
`needs_rework` et le manque va dans `open_risks`.

**Le sentinel change ce qu'il faut rapporter.** `pi-bq-cost-sentinel` dry-run
déjà tout `bq query`. « Pas de dry-run effectué » cesse d'être un finding
légitime — c'est le doublon d'une porte qui a déjà tourné. Le reviewer rapporte
le *résultat* du dry-run quand il change une sévérité, jamais l'absence de
l'étape.

---

## 4bis. Manques identifiés — candidats après basculement

Recensés le 3 août en balayant les catalogues publics (`sickn33/agentic-awesome-skills`,
`vaquarkhan/data-engineering-agent-skills`). **Rien à installer** : ces catalogues
sont de la largeur, majoritairement hors domaine.

| Manque | Pourquoi il compte |
|:--|:--|
| **Backfill / reprocessing** | Opération coûteuse et irréversible — exactement le déclencheur d'advisor posé par D2 — et aucune skill ne la décrit. Un backfill mal borné réécrit des partitions en production |
| **Évolution de schéma / contrat** | Même statut : irréversible côté consommateurs en aval. Ni `data-quality` (tests) ni `bigquery-engineering` (écriture de requêtes) ne le couvrent |

**Ne pas les écrire avant le basculement.** Chaque skill coûte ~145 tokens de
description dans chaque session d'orchestrateur, définitivement. Onze deltas
sont en cours ; agrandir le chantier pendant qu'on le range est le défaut qu'on
corrige.

### Lectures, pas installations

- `mishanefedov/skill-issue` — audit des métadonnées de déclenchement, correspondance prompt/description, détection de collisions. **Pour l'étape C**, où il faut resserrer 2 894 tokens de descriptions sans casser l'auto-load
- `anthony-chaudhary/dos-kernel` — vérifie qu'un « c'est fait » de l'agent correspond au diff réel. Angle sortie du plancher de vérification
- `vaquarkhan/data-engineering-agent-skills` — 73 workflows dont backfill et changement de schéma. À lire au moment d'écrire les deux manques ci-dessus

### Le manque de fond : pas de chemin de retour

Les skills encodent ce qu'on savait avant. Les prompts déclenchent une tâche.
**Rien n'encode ce que le système a appris.** Huit revues produites sur
`anime-etl` — findings, `open_risks`, verdicts — écrites dans
`.pi-subagents/artifacts/` et jamais relues. Retrouvées le 3 août par `grep`,
par accident, en cherchant autre chose.

Même manque que l'advisor réactif vu d'un autre angle, et même réponse : pas
maintenant, faute de corpus d'usage réel. S'instruit avec les mêmes `.jsonl`,
sous l'arbitrage n°8.

---

## 4ter. Contrôle de cohérence — 3 août

Effectué sur la branche poussée : 118 lignes de sévérité extraites des onze
deltas, comparées entre elles.

### Le défaut trouvé — sévérité et fait ne suivent pas la même règle

`python-engineering` renvoyait les secrets en dur à `gcp-engineering` et
`WRITE_APPEND` à `bigquery-engineering`. Or **un reviewer de fichier `.py` ne
charge que `python-engineering`.** Les deux HIGH que le corpus réel a produits
sur des fichiers Python seraient donc restés non pesés :

| Fichier | Finding | Verdict du corpus |
|:--|:--|:--|
| `config.py` | mots de passe avec valeur par défaut littérale | `blocked` |
| `load.py` | `to_sql(if_exists="append")` non rejouable | HIGH, 4 revues sur 4 |

**Cause** : la règle 3 — « one fact, one file » — a été appliquée aux
sévérités. Elle gouverne les *faits*.

### La règle corrigée

> **Une règle, un fichier. Une sévérité par surface où la règle peut être
> enfreinte.**
>
> L'énoncé « jamais de `WRITE_APPEND` aveugle » vit une seule fois, dans
> `bigquery-engineering`. Son poids doit exister partout où un reviewer peut le
> rencontrer — `python-engineering` pour un client, `airflow-engineering` pour
> une tâche — parce que le reviewer ne charge qu'une skill de domaine.
>
> Une sévérité dupliquée entre deux surfaces n'est pas un défaut. Une sévérité
> **contradictoire** entre deux surfaces en est un.

### Ce que le contrôle a validé

- **Aucune sévérité contradictoire** sur 118 lignes
- Deux doublons exacts, `allUsers` et cycle de vie GCS, entre `gcp-engineering`
  et `iac-terraform` : **corrects**, deux surfaces pour le même défaut, même poids
- `WRITE_APPEND` pesé HIGH dans `airflow-engineering` et `bigquery-engineering` :
  correct pour la même raison
- Les renvois de `gcp-engineering` et `sql-engineering` sont sains : les skills
  cibles pèsent bien ce qui leur est délégué
- `SELECT *` n'est pesé qu'une fois, dans `sql-engineering` — correct, un
  fichier SQL charge toujours cette skill

### Correction appliquée

`python-engineering` gagne deux lignes HIGH — secret avec valeur par défaut,
écriture d'entrepôt sans stratégie de dedup — et sa clause de renvoi distingue
désormais ce qui est **aussi** pesé ailleurs de ce qui ne l'est **pas** ici.

---

## 4quater. Retrait de claude-bridge — 3 août

**Cause.** `pi-claude-bridge/src/index.ts:1249` passe `systemPrompt: { type: "preset",
preset: "claude_code" }` **sans condition**. Le drapeau `appendSystemPrompt` ne
remplace pas le preset : il coupe seulement ce que pi y ajoute, et il **active**
`settingSources: ["user","project"]`, donc le chargement de `CLAUDE.md`. Le
défaut était déjà le plus isolé possible ; le preset n'est pas exposé.

Conséquence mesurée : un enfant sur `claude-bridge` portait **~26 000 tokens**
d'instructions de comportement d'un autre agent, non contrôlables, dans un
processus dont le principe est de ne recevoir que ce qu'on lui passe. Coût nul
(mis en cache dès le second appel), mais contrôle nul aussi.

**Décision : provider `anthropic` natif, sur API.** ~0,11 $ par revue au tarif
d'introduction Sonnet 5 (2 $/10 $ jusqu'au 31 août, puis 3 $/15 $), dont 80 %
en sortie. Vingt revues par jour ouvré coûteraient ~45 €/mois — un rythme
jamais approché.

**Écartées** : `pi-claude-auth`, `@gotgenes/pi-anthropic-auth`,
`@cortexkit/pi-anthropic-auth`. Elles règlent le problème à la racine — provider
natif, pas de Claude Code, pas de preset — mais utilisent des jetons
d'abonnement hors clients officiels, ce que les CGU d'Anthropic n'autorisent
pas. À 11 centimes la revue, l'API dispense de trancher. À reconsidérer si
l'usage montait.

**Incident associé** : `ANTHROPIC_API_KEY` était exportée globalement depuis
`~/.config/env/api_keys.zsh`, elle-même lisant le trousseau macOS. Claude Code,
en présence de cette variable, bascule en mode API et ignore l'abonnement. Les
tests des deux derniers jours ont consommé 10 € de crédit en croyant tirer sur
Max. Clé retirée du trousseau et de l'export, révoquée.

> **Règle qui en sort.** Un coût affiché comme nul parce qu'on croit être sur
> abonnement doit être vérifié auprès du fournisseur, jamais déduit de la
> configuration. La même erreur avait failli être commise sur `openai-codex`.

### Allocation des modèles — révisée

| Rôle | Modèle | Raison |
|:--|:--|:--|
| orchestrateur, worker | `openai-codex/gpt-5.6-sol` | abonnement, coût marginal nul |
| reviewer | `anthropic/claude-sonnet-5` | ~0,11 $/revue, prompt système sous contrôle |
| advisor (futur) | `anthropic/claude-sonnet-5` ou mieux | jugement ouvert, sans barème |
| scout | Google | inchangé |

**Inversion assumée d'un principe.** Le document disait « le budget va au
reviewer, vrai portail de qualité ». C'était juste avant les deltas. Le reviewer
applique désormais une **table de sévérité explicite** — application de barème,
pas jugement ouvert. L'advisor n'a aucun barème : c'est là que la capacité du
modèle compte.

→ Si un advisor est mis en service, il prend Sonnet et le reviewer bascule sur
un modèle bon marché. Quatre familles au lieu de trois.

**Objection écartée : « l'advisor sert peu, c'est dommage d'y mettre Sonnet ».**
Un modèle facturé à l'usage ne se gâche pas en restant inactif — sur un advisor
appelé trois fois par mois, Sonnet coûte quelques centimes. Choisir un modèle
pour qu'il serve est du coût irrécupérable appliqué à un service à l'usage.

**Le vrai risque est l'inverse** : si Sonnet quitte le reviewer, un modèle non
testé prend le portail de qualité le plus sollicité. C'est pourquoi la bascule
est conditionnée au protocole de test ci-dessous, et à rien d'autre.

> **Principe.** Le meilleur modèle va là où une erreur coûte le plus cher, pas
> là où il tourne le plus souvent. L'advisor tranche des forks irréversibles —
> un mauvais conseil s'y paie en semaines. Le reviewer applique un barème écrit
> — une erreur s'y rattrape à la revue suivante.

### Candidats reviewer bon marché — à tester, pas à adopter

Tarifs au 3 août 2026, coût estimé sur la revue réelle de `config.py`
(5 700 tokens frais, ~50 000 en cache, 8 663 en sortie) :

| Modèle | Tarif | Coût/revue |
|:--|:--|--:|
| `anthropic/claude-sonnet-5` | 2 $ / 10 $ | ~0,110 $ |
| GLM-5.2 | 1,40 $ / 4,40 $ | ~0,046 $ |
| MiniMax M3 | 0,60 $ / 2,40 $ | ~0,024 $ |
| **DeepSeek V4 Flash** | **0,14 $ / 0,28 $** | **~0,004 $** |
| Kimi K3 | 3 $ / 15 $ | ~0,140 $ — plus cher que Sonnet |

**Protocole de test, quand on voudra.** Rejouer les cinq fichiers d'`anime-etl`
dont les verdicts sont connus. Critère : retrouver le HIGH des identifiants par
défaut sur `config.py` et la non-idempotence sur `load.py`. Un reviewer qui rate
un HIGH ne coûte pas 11 centimes, il coûte un `blocked` manquant.

Note : `kimi-coding` est **déjà configuré** dans `--list-models` — aucun intérêt
au prix actuel.

---

## 4quinquies. Test de bout en bout — pi contre Claude Code

**Objet.** Une vraie tâche de projet, exécutée deux fois : par pi avec la
nouvelle configuration, puis par Claude Code. On relève tout et on compare.

**Le sujet est disponible** : un pipeline à améliorer, dont Strategic Forge a
déjà produit les instructions. C'est le bon cas — travail réel, périmètre connu,
pas une fixture.

### Métriques à relever

| Quoi | Comment |
|:--|:--|
| Délégation effective | l'outil `task` a-t-il été appelé, pour quels rôles, combien de fois |
| Modèles réellement utilisés | `modelUsed` dans les artefacts ; un repli silencieux fausse tout le reste |
| Tours par délégation | contre `maxTurns` ; une boucle longue pour peu de résultat est le défaut à traquer |
| Contexte et coût | `in`, `cacheRead`, sortie, par rôle et au total |
| Enveloppes valides | combien de `submit` contre combien de `no_submit` |
| Durée | mur, par délégation et au total |
| **Qualité du rendu** | voir ci-dessous |

### Discipline de protocole — à respecter, sinon le test ne vaut rien

**Le critère de qualité s'écrit avant les runs.** Sinon on juge après coup, et
on trouve ce qu'on espérait. Poser à l'avance : ce que le pipeline doit faire de
plus, ce qui ne doit pas casser, la forme attendue du diff.

**Ce que la comparaison n'isole pas.** pi et Claude Code ne diffèrent pas que
par le harnais : les modèles diffèrent aussi. Un écart de résultat ne prouve
donc rien sur l'architecture de délégation. Ce que le test mesure honnêtement,
c'est **si la chaîne complète tient sur une tâche réelle** — pas laquelle des
deux est supérieure.

**Un seul essai par côté ne conclut pas.** La dispersion mesurée sur la fixture
était de 6 % ; sur une tâche de projet elle sera bien supérieure.

### Prérequis — adapter Strategic Forge

Le bundle actuel (`INSTRUCTIONS.md`, `ARCHITECTURE.md`, `DESIGN.md`,
`CONVENTIONS.md`) suppose que l'agent lit des fichiers de contexte. **La nouvelle
configuration l'interdit** : un enfant tourne en `-nc`, ne reçoit ni AGENTS.md ni
brief, et son texte de tâche est son instruction entière.

Ce que Strategic Forge devrait produire à la place :

- des **paquets de tâche autonomes**, un par délégation prévue, chacun se
  suffisant à lui-même — fichiers nommés, contexte cité verbatim, rien
  d'implicite
- le **rôle visé** pour chacun, worker ou reviewer, avec la skill de domaine à
  injecter
- ce qui reste inline chez l'orchestrateur, et pourquoi
- **ne pas décrire le format de sortie** : l'enveloppe est imposée par le schéma
  de `submit`, la réclamer en prose est ce qui produisait un rapport au lieu d'un
  appel

Rappel déjà noté : le board Strategic Forge doit demander explicitement Loguru
ou la `logging` standard quand le projet est en Python, au lieu d'imposer Loguru.

---

## 4sexies. `.pi/BRIEF.md` — la couche manquante

**Constat.** Le brief n'atteint aucun enfant. `pi-project-brief` est une
extension locale, `-ne` est actif, et ni le worker ni le reviewer ne la listent
en `-e`. Personne ne l'avait relevé.

**Pourquoi c'est un trou.** Un enfant reçoit son prompt de rôle, des conventions
de domaine **génériques**, et une tâche **spécifique**. Il manque la couche
intermédiaire : ce projet-ci. La skill dit « jamais de `WRITE_APPEND` aveugle » ;
le brief dirait « ici les tables sont partitionnées par `event_date` en
`europe-west1` ». Sans lui, tout le contexte projet doit transiter par le texte
de tâche, ce qui rend sa composition coûteuse et fragile.

**Décision : injection directe, pas l'extension.** `buildSpawnPlan` lit
`.pi/BRIEF.md` et l'injecte en `--append-system-prompt`, comme une tranche de
skill. Aucune dépendance à la découverte, et le contenu apparaît dans le plan
avant exécution.

**Pour les quatre rôles, par défaut.** Le worker écrit dans ce projet, le
reviewer juge contre ses conventions, le scout y cherche, l'advisor conseille
dessus. Seule pièce de contexte dont les quatre ont besoin. ~397 tokens.

### Bundle et brief se complètent — ils ne se recouvrent pas

| | Rôle |
|:--|:--|
| **Bundle Strategic Forge** | les consignes de base à respecter, et le travail à faire |
| **`.pi/BRIEF.md`** | l'état du dépôt à l'instant t |

Distinction posée par l'opérateur, et elle lève l'inquiétude d'une double source :
l'un est prescriptif et daté de la tâche, l'autre descriptif et daté du dépôt.
À maintenir explicitement quand Strategic Forge sera adapté — la tentation sera
de décrire l'état du dépôt dans le bundle.

---

## 4septies. Extension powerline — chantier de fin

L'actuelle ne convient pas. Références souhaitées :
[CCometixLine](https://github.com/Haleclipse/CCometixLine) et surtout
[ccstatusline](https://github.com/sirmalloc/ccstatusline).

**Faisable.** pi expose `ctx.ui.setFooter({ render(width) { … } })`, qui
**remplace entièrement** le footer intégré, plus un `ReadonlyFooterDataProvider`
pour les données de session et un exemple officiel `custom-footer.ts`
(`docs/extensions.md:2455-2566`, `2926`). Chaque ligne rendue est sous contrôle.

**Difficulté : modérée.** Le rendu est du texte avec les couleurs du thème ; le
travail est de composer les segments et de gérer la largeur, pas de se battre
contre l'API. Les deux références visées ciblent Claude Code, donc rien n'est
réutilisable tel quel — c'est le **design** qu'on porte, pas le code.

**À instruire au moment venu** : quelles données le `FooterDataProvider` expose
réellement (modèle, tokens, coût, branche git, durée), et lesquelles demandent
un calcul propre. Un segment de coût est trivial ; un segment de quota
d'abonnement, probablement pas.

### Spécifications posées par l'opérateur

À décider ensemble avant d'écrire quoi que ce soit :

- **Combien de lignes.** Piste évoquée : une ligne pour l'orchestrateur, une
  pour les sous-agents. Faisabilité à vérifier — le `render(width)` rend du
  texte multiligne, mais l'état des enfants n'est pas exposé par le
  `FooterDataProvider` : il faudrait que l'extension `subagent` le publie
- **Quelles informations** sont pertinentes, ligne par ligne
- **Comment on les affiche** : palette **tokyonight**, formes — par exemple une
  barre qui se remplit pour le contexte consommé plutôt qu'un nombre nu

Contrainte à ne pas perdre : les données des enfants ne remontent aujourd'hui
que par l'artefact sur disque. Un segment « sous-agents » suppose que
`dispatch` publie un état en cours de route, pas seulement à la fin.

**Ordonnancement : aucune contrainte.** Correction d'une réserve mal fondée —
le footer est du **rendu terminal**, il n'entre jamais dans le prompt envoyé au
modèle. Les 0 tokens de l'actuel ne sont pas une performance à préserver, c'est
la nature de l'objet : trois lignes colorées avec icônes coûteront exactement
autant qu'une ligne nue, soit rien.

Le chantier est donc **totalement indépendant** — il ne touche ni les enfants,
ni le contexte, ni la délégation. Faisable à n'importe quel moment.

Seule nuance restante : afficher une donnée que pi ne calcule pas déjà — un
quota d'abonnement, par exemple — demanderait un appel réseau ou un
sous-processus au rafraîchissement. Coût de latence, jamais de tokens.

---

## 4octies. Basculement — 4 août

**Déclencheur** : les deux rôles qui comptent ont tourné de bout en bout avec la
nouvelle extension.

| Rôle | Résultat |
|:--|:--|
| `reviewer` sur `anthropic/claude-sonnet-5` | `status: ok`, verdict `blocked` sur `config.py`, 3 tours, `failure: null` |
| `worker` sur `openai-codex/gpt-5.6-sol` | 2 fonctions typées correctement, 1 fichier touché, `deviations: []`, 5 tours |

**Le plancher de vérification survit à l'injection par tranches.** Le worker a
rendu `validation: "Automatic pi-lint-gate checks (ruff after edit; mypy at turn
end)"` — il rapporte le résultat du hook au lieu de relancer les outils. Mesure
d'origine : 8/8 à la main. Après : 0/1.

`injectedTokens: 1544` contre ~1 375 estimés — l'estimation tenait à 12 % près.

### AGENTS.md réécrit

4 424 → **3 852 tokens** estimés (−13 %).

Supprimé : `### Loadouts` (mort avec D4), toute la section
`## Delegation with pi-subagents` (six agents, `turnBudget`, `/parallel`,
`inheritProjectContext`), la mention d'`agent-io`.

Ajouté, tiré des mesures : **un enfant n'hérite de rien** ; **déléguer remplace
lire** — mesuré, l'orchestrateur lisait `config.py` avant de le confier ;
**décrire le travail, pas le format de sortie** — 5/5 contre 0/3.

Deux coupes appliquées au brouillon, sur les règles du fichier lui-même : le
vocabulaire des échecs redisait ce que `dispatch` écrit déjà (règle 2), et une
ligne de table par agent non appelable se payait dans chaque session (règle 1).

### Ce qui reste après

- `bin/check-envelope` : réaligner sur le schéma `submit`, ou supprimer
- `pi-check-config` : réécriture, plus la garde sur `## Review delta`
- Étape D, onze corrections d'hygiène
- **Transcript des enfants non observable.** Seul le total d'usage revient ; le
  détail par tour est perdu. Une option `keepTranscript` écrivant le flux JSON
  de l'enfant à côté de l'artefact le comblerait. Pour un chantier construit sur
  la mesure, c'est un trou

---

## 4nonies. Étape D — appliquée, 4 août

Les onze corrections d'hygiène. Aucune ne réduit le prompt ; toutes corrigent une
erreur factuelle ou une double source.

| Constat | Correction appliquée |
|:--|:--|
| **R21** `airflow-engineering` | `logger.contextualize()` sur un `logging.Logger` lève un `AttributeError`. Remplacé par `extra={...}` par appel, avec le commentaire qui dit pourquoi |
| **R8** `spark-engineering` | Bloc `classify_udf` dupliqué mot pour mot — la seconde occurrence devient un renvoi |
| **R6/R33** `gcp-dataeng-architecture` | Requête `JOBS_BY_PROJECT` supprimée. Elle était fausse sur **deux** axes : `total_bytes_processed` au lieu de `billed`, TB décimal au lieu de TiB. Renvoi vers `bigquery-ops` |
| **Tarif** | `$6.25` codé en dur → `@on_demand_usd_per_tib`, avec la région du tarif déclarée. Le tableau slots/on-demand ne cite plus de chiffre |
| **R7** « (Paris) » | `europe-west1` = St-Ghislain, Belgique. Paris est `europe-west9`, et si un projet l'exige c'est une décision d'infra |
| **R9** `gcp-engineering` | Pointeur corrigé : coût et `INFORMATION_SCHEMA` → `bigquery-ops`, conventions de requête → `bigquery-engineering` |
| **A4/A6** `APPEND_SYSTEM.md` | « propose 2 options » borné à une question **sans contrainte qui sélectionne une réponse**. Section `## Subagent output` **vidée** : le contrat vit dans le schéma de `submit`, et ce fichier n'atteint plus un enfant |
| **R31** `iac-terraform` | `Anti-patterns` réécrit pour ne plus redire `Non-negotiable` ; il liste les *formes* qui violent les règles, la table de sévérité les pèse |
| **R37** `git-collaboration` | Corps de `/check-config` supprimé — l'extension s'exécute seule. `/audit` réécrit : `git ls-files` au lieu d'un scan intégral, et des motifs de **forme** de credential au lieu des mots `key`/`secret`/`token`, qui noyaient le vrai résultat |
| **R13** `bash-guard/README.md` | Niveau **TOKEN** documenté : vérifié avant HIGH, MEDIUM et la whitelist, pas d'always-allow. Couvre `git commit` et `gh pr merge\|create` |
| **AGENTS.md:206** | Déjà corrigé antérieurement |

`git-collaboration` passe de 277 à 234 lignes.

---

## 4decies. ponytail — l'idée oui, le paquet non

[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail), 595 étoiles,
18 commits, MIT. Évalué le 4 août.

**Ce que c'est** : une échelle de décision à six barreaux, à parcourir avant
d'écrire du code. Ça doit-il exister → stdlib → primitive native de la
plateforme → dépendance déjà installée → une ligne → sinon le minimum qui
marche. Avec la garde explicite : validation aux frontières de confiance, perte
de données, sécurité et accessibilité ne sont jamais coupées.

**Le benchmark ne vaut pas ce qu'il annonce.** Six tâches, un run par bras,
l'auteur a conçu les tâches, les bras, les sondes **et** la métrique — laquelle
est le nombre de lignes de code, c'est-à-dire l'objectif même de
l'intervention. Les 47 % de tokens et le facteur 7 sont plausibles, pas établis.
Même défaut de protocole que celui qu'on corrige ailleurs dans ce document.

**Pas un plugin pi.** Plugin Claude Code plus des fichiers de règles Cursor,
Windsurf, Cline. Le porter revient à copier du texte.

**La config en couvre déjà les trois quarts** : « Smallest correct change »,
« Defensible code » (pas de wrapper au cas où, pas de dépendance sans bénéfice
net démontré), « Readability over cleverness ». Ce qui manque est **l'ordre de
recherche** avant d'écrire.

### Décision : l'échelle est coupée en deux

Le premier barreau — *« ça doit-il exister ? »* — est **dangereux pour un
worker** à qui on a donné une tâche cadrée : il l'invite à refuser du périmètre,
alors que son contrat est de faire ce qui est demandé et de signaler le reste
dans `deviations`.

| Barreau | Où il va |
|:--|:--|
| 1. Ça doit-il exister ? | Orchestrateur, et advisor quand il existera. Jamais le worker |
| 2-6. stdlib → natif → dépendance installée → une ligne → minimum | `python-engineering`, section authoring — ~6 lignes |

À écrire au moment de la passe cosmétique. Coût estimé : négligeable côté
orchestrateur (le corps des skills ne lui coûte rien), ~40 tokens dans la
tranche worker.

---

## 5. À faire — ordre

1. **Déposer la v2 d'`envelope.ts`** — le dépôt porte la v1
2. Déposer `python-engineering/SKILL.md`, `SUBAGENTS-DESIGN.md`, `PLAN-V2-POST-MESURE.md`
3. Amender D4 dans le document : un marqueur au lieu de deux
4. Migrer les quatre blocs restants de `code-review`, en résolvant les deux duplications de règle
5. Écrire l'extension de sous-agents : schéma d'agent, découpeur par en-tête, ligne de commande, boucle de dispatch, `maxTurns`, `timeoutMs`
6. Réécrire `pi-check-config`
7. **Basculement** : retrait de `pi-subagents`, réécriture d'`AGENTS.md`, nettoyage de `settings.json`
8. Étape D — les onze corrections d'hygiène, indépendantes, faisables à tout moment

### Contraintes à ne pas perdre

- **Le prompt de rôle doit couper la chasse au contexte.** Mesuré : privé de fichier de contexte par `-nc`, le modèle a cherché `AGENTS.md` inexistant en premier appel
- **`submit` coûte ~467 tokens.** Plancher reviewer à 1 981, pas 1 514. Resserrer les descriptions du schéma avant de le figer
- **Vérifier si `subagentOnlyExtensions` existe côté pi** — `agents/worker.md` le mentionne comme mécanisme `pi-subagents` ; pourrait simplifier la ligne de commande
- **Dette** : `evidence/2026-08-03_submit-validation.jsonl` reste dans l'historique Git avec cinq occurrences d'`anime_password`. Purge = réécriture d'historique, à froid
