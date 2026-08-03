# Chantier — registre des modifications

*Tenu à jour à chaque séance. Trois états : **appliqué** (dans le dépôt),
**à déposer** (produit, pas encore installé), **à faire**.*

Branche de travail : `feat/subagent-extension`, partant de `main` à jour.

---

## 1. Fichiers produits — état

| Fichier | État | Note |
|:--|:--|:--|
| `SUBAGENTS-DESIGN.md` | **à déposer** | 5 révisions. Le dépôt ne le contient pas encore |
| `PLAN-V2-POST-MESURE.md` | **à déposer** | idem |
| `extensions/envelope/envelope.ts` | **v1 appliquée, v2 à déposer** | Le dépôt porte la v1 : `what`/`recommendation`, `verdict` capitalisé, sans `files_reviewed` ni `open_risks`. **À remplacer en premier à la reprise** |
| `skills/python-engineering/SKILL.md` | **à déposer** | +60 lignes, purement additif. Dérivé de `code-review:106-118` |
| `skills/gcp-engineering/SKILL.md` | **à déposer** | `## Review checklist` (`:279-295`) **supprimée et remplacée** par `## Review delta`. 295 → 344 lignes |
| `skills/iac-terraform/SKILL.md` | **à déposer** | `## Plan review` **et** `## Review checklist` supprimées, remplacées par `## Review delta`. 287 → 326 lignes. `Anti-patterns` conservée : c'est de l'authoring |
| `skills/sql-engineering/SKILL.md` | **à déposer** | **Deux** `### Review checklist` supprimées (Block 1 et Block 2). 105 → 151 lignes |
| `skills/bigquery-engineering/SKILL.md` | **à déposer** | `## Review checklist` supprimée. 149 → 202 lignes |
| `skills/airflow-engineering/SKILL.md` | **à déposer** | checklist supprimée. 245 → 282 lignes |
| `skills/data-quality/SKILL.md` | **à déposer** | checklist supprimée. 120 → 153 lignes |
| `skills/dbt-engineering/SKILL.md` | **à déposer** | checklist supprimée. 240 → 278 lignes |
| `skills/spark-engineering/SKILL.md` | **à déposer** | checklist supprimée. 268 → 308 lignes |
| `skills/bigquery-ops/SKILL.md` | **à déposer** | checklist supprimée. 325 → 367 lignes |
| `skills/technical-writing/SKILL.md` | **à déposer** | checklist supprimée. 214 → 253 lignes |
| `skills/code-review/SKILL.md` | **à déposer** | **Cinq blocs de domaine supprimés**, remplacés par une table de renvoi. Vocabulaire de verdict unifié. 216 → 188 lignes |
| `AGENTS.md` | appliqué | Version corrigée, mesurée, fusionnée dans `main` |
| `settings.json` | appliqué | Reformaté, pin `pi-subagents@0.39.0` |
| `.gitignore` | appliqué | `evidence/` |

**Une version obsolète à ne pas utiliser** : le premier `python-engineering` Review delta de cette séance, écrit sans consulter `code-review`. Il contredisait la table existante sur trois lignes (argument mutable classé HIGH au lieu de MEDIUM) et perdait `import *` et la gestion d'exception au point d'entrée. Remplacé.

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
