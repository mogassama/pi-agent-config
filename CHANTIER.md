# Chantier — état au 5 août 2026

*Registre de la configuration pi. Remplace la version d'accumulation : ce qui
était fait a quitté « à faire », ce qui a été tranché ne garde que sa raison.*

Branche `feat/subagent-extension`.

---

## 1. Où on en est

Le chantier partait d'un audit par deux modèles dont une bonne partie des
constats s'est révélée fausse. Il aboutit à une primitive de délégation écrite,
mesurée, et validée sur trois rôles.

### Ce qui a changé, chiffré

| | Avant | Après |
|:--|--:|--:|
| Contexte de l'orchestrateur, mode print | 15 195 | **8 803** |
| Contexte d'un enfant | 17 041 (fork) | **~1 500 à 6 000** selon le rôle |
| Outils de délégation dans l'orchestrateur | 5 468 (`pi-subagents`, 6 outils) | **190** (`task`, 1 outil) |
| AGENTS.md | 4 424 | 4 233 |
| Coût d'une recherche déléguée | — | **< 0,01 $** |
| Coût d'une revue déléguée | — | **~0,06 $** |

L'orchestrateur perd 42 % de son contexte initial ; un enfant en perd un ordre
de grandeur.

### Inventaire

**19 skills** — 11 orientées relecture avec un `## Review delta`, 1 de mécanique
(`code-review`), 7 réservées à l'orchestrateur.

**3 agents** dans `subagent-only/agents/` : `worker` (`openai-codex/gpt-5.6-sol`,
abonnement), `reviewer` (`anthropic/claude-sonnet-5`, API), `scout`
(`google/gemini-3.1-flash-lite`). Trois familles de modèles.

**8 extensions locales** : `bash-guard`, `pi-bq-cost-sentinel`,
`pi-check-config`, `pi-diff-review`, `pi-lint-gate`, `pi-project-brief`,
`subagent`, `subagent-footer`. Un seul paquet npm reste : `@tmustier/pi-raw-paste`.

**Thème** `tokyonight`, rendu par `~/.config/theme` depuis `colors.toml`.

---

## 2. Ce qui reste

### Faisable maintenant

| Quoi | Pourquoi |
|:--|:--|
| **Commiter `pi-check-config`** | La version poussée est l'ancienne : elle lit encore `subagents.agentOverrides`. Vérifier avec `grep -c agentOverrides` |
| **Réécrire `README.md`** | 294 lignes, 21 mentions de `check-envelope`, `agent-io`, `.pi-subagents/`, oracle, planner. Il décrit une architecture retirée — il n'est plus incomplet, il est faux |
| **`agents/oracle-deep.md`** | Écrit contre le frontmatter `pi-subagents`. À supprimer si le dossier `agents/` racine existe encore |

### En attente du corpus

Ces trois-là dépendent du même manque : aucun usage réel prolongé. Les rouvrir
avant le test reviendrait à décider par intuition, ce que ce chantier a passé
deux jours à corriger.

| Quoi | Ce qui le débloque |
|:--|:--|
| **Agent `advisor`** | Son déclencheur n'est pas mesurable. Le schéma existe dans `envelope.ts`, la définition non. `/check-config` le signale comme état voulu |
| **Advisor réactif** | Arbitrage n°8 : combien de cas un motif déterministe de `bash-guard` n'attraperait pas. S'instruit sur les `.jsonl` |
| **Adapter Strategic Forge** | `claude/strategic-forge/SKILL.md` décrit encore `pi-subagents`, `oracle`, `agentOverrides`, `inheritProjectContext`. Doit produire des paquets de tâche autonomes — un enfant tourne en `-nc` et son texte de tâche *est* son instruction |

### Le test de bout en bout

Une vraie tâche de projet, exécutée par pi puis par Claude Code, avec relevé
complet. Le pipeline et les instructions Strategic Forge existent déjà.

**Métriques** : délégations effectives et pour quels rôles, modèles réellement
utilisés (`modelUsed` — un repli silencieux fausse tout le reste), tours par
délégation contre `maxTurns`, contexte et coût par rôle, enveloppes valides
contre `no_submit`, durée, et la qualité du rendu.

**Discipline** : le critère de qualité s'écrit **avant** les runs. Et la
comparaison n'isole pas le harnais — les modèles diffèrent aussi — donc elle
mesure si la chaîne tient sur une tâche réelle, pas laquelle des deux est
supérieure.

---

## 3. L'architecture, et pourquoi

### Un enfant n'hérite de rien

Chaque délégation lance un processus `pi` neuf. Ni AGENTS.md, ni historique, ni
appels d'outils antérieurs, ni `.pi/BRIEF.md`, ni `APPEND_SYSTEM.md`.

Le fork de `pi-subagents` valait **17 041 tokens, dont 2 frais** — presque tout
en lecture de cache. L'argument économique contre lui ne tenait donc pas ; ce
qui le condamne est le contrôle : du contexte parent non demandé, et un mode de
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

D'où l'injection par `--append-system-prompt` en texte, et non par `--skill` :
un pointeur coûterait un tour de `read` à l'enfant.

### Un seul outil, `task`

190 tokens contre 5 468 pour les six de `pi-subagents`. Le rôle est un
paramètre. Seul le `summary` revient à l'orchestrateur ; l'enveloppe complète va
dans `.pi-subagent-runs/`.

### Le contrat de sortie est un outil, pas une consigne

`submit`, schéma TypeBox, `terminate: true`. **Mesuré** : sur dix runs reviewer
de `pi-subagents`, l'enveloppe apparaissait 5/5 quand le texte de tâche la
nommait et 0/3 sinon. Une skill chargée n'impose jamais son format de sortie.
D'où la clôture ajoutée par le code au texte de tâche, et non laissée au
rédacteur.

Le schéma est **plat** : chaque enfant ne voit qu'un rôle, donc le conteneur
`payload` ne séparait rien et coûtait une validation ratée plus une reprise sur
trois runs sur trois. `dispatch` reconstruit la séparation à l'écriture.

### Le domaine appartient à la tâche

`task` prend un `skills` optionnel. Les définitions d'agent ne déclarent aucun
domaine par défaut : un défaut juste une fois sur trois est pire que pas de
défaut, et il inviterait l'orchestrateur à omettre le paramètre.

`mechanism` reste dans la définition — `code-review` est lié au rôle, pas à la
tâche.

### Les skills sont découpées, pas dédoublées

Un marqueur unique `## Review delta`, dernière section. Le worker reçoit
l'authoring, le reviewer l'authoring plus le delta, l'advisor rien. Le delta est
une **table de sévérité**, pas un rappel de règles — c'est ce qui rend un verdict
reproductible.

> **Une règle, un fichier. Une sévérité par surface où la règle peut être
> enfreinte.** L'énoncé « jamais de `WRITE_APPEND` aveugle » vit une fois ; son
> poids doit exister partout où un reviewer peut le rencontrer, puisqu'il ne
> charge qu'une skill de domaine. Une sévérité dupliquée entre deux surfaces
> n'est pas un défaut ; une sévérité **contradictoire** en est un.

La garde du marqueur vit dans `pi-check-config`, pas dans le découpeur : y
échouer est gratuit, alors qu'à l'exécution ça abandonnait une délégation entière
pour une skill sans delta légitime.

---

## 4. Ce que les mesures ont corrigé

### Le corpus de 196 sessions ne mesurait rien

Entre 100 et 120 de ces sessions étaient du debug de configuration. Toutes les
fréquences qu'on en tirait — scout 3 fois, oracle 11 fois — décrivaient ce qui
avait été tapé en phase de test. Retirées de toute justification.

L'erreur s'est répétée : « le scout ne sert pas » venait du même corpus. Le scout
est aujourd'hui le rôle le plus sollicité.

### La décomposition n'est pas additive

`2 023 − 959 = 1 064` tokens pour sept outils built-in, contre 679 annoncés. La
ligne « outils built-in » n'avait jamais été mesurée : c'était le **résidu** qui
faisait tomber la somme juste, et il absorbait l'erreur de toutes les autres.

> Un nombre obtenu par soustraction est un ordre de grandeur, pas une valeur.
> Seules les mesures directes se citent.

### Un coût nul supposé doit être vérifié

`ANTHROPIC_API_KEY` était exportée globalement depuis `~/.config/env/api_keys.zsh`.
Claude Code, en sa présence, bascule en mode API et ignore l'abonnement. Deux
jours de tests ont consommé le crédit en croyant tirer sur Max.

> Le coût se lit sur la console du fournisseur, jamais sur l'`usage` rapporté par
> l'agent. Une délégation mesurée est sortie **4× au-dessus** de ce que l'`usage`
> laissait croire : `reasoning` et `cacheWrite` n'étaient pas comptés.

### « Flash » est un nom de famille, pas une gamme de prix

Gemini 3.5 Flash liste à 1,50 $/9 $, à un quart de 3.1 Pro. La table de tarifs
était par provider et le masquait : elle rapportait un scout Flash comme coûtant
moins qu'une revue Sonnet. Tarifs désormais par modèle.

### Le transcript des enfants était le trou bloquant

Seuls les totaux revenaient, et un total ne distingue pas un rôle qui **lit** son
chemin vers la réponse d'un rôle qui le **cherche**. `dispatch` écrit le flux brut
de l'enfant, `bin/subagent-trace` le lit.

Calibrage du scout sur cinq runs, chacun corrigeant ce que le transcript montrait :

| | run 1 | run 5 |
|:--|--:|--:|
| Pic de contexte | 42,6k | **9,1k** |
| Cache relu | 102,2k | **8,1k** |
| Ratio recherche/lecture | 2 pour 2 | **3 pour 1** |

Corrections successives : modèle (3.5 Flash → 3.1 Flash-Lite), outils (`bash`
ajouté), interdiction nommée des vidages d'arbre — son premier run avait dépensé
40k tokens en `ls -R` —, et aplatissement du schéma `submit`, qui a supprimé une
reprise systématique et un tour.

---

## 5. Décisions à ne pas rouvrir sans élément nouveau

| Décision | Raison |
|:--|:--|
| **`claude-bridge` retiré** | `src/index.ts:1249` passe le preset `claude_code` sans condition : ~26 000 tokens d'instructions d'un autre agent, dans un enfant dont le principe est de ne recevoir que ce qu'on lui passe. Provider `anthropic` natif à la place |
| **Pas de `pi-anthropic-auth`** | Règle le problème à la racine mais utilise des jetons d'abonnement hors clients officiels. À 6 centimes la revue, l'API dispense de trancher |
| **Sonnet à l'advisor, modèle bon marché au reviewer** *(si un advisor arrive)* | Le reviewer applique un barème écrit ; l'advisor tranche des forks irréversibles sans barème. Le meilleur modèle va où l'erreur coûte le plus cher, pas où il tourne le plus souvent. **Conditionné au test** sur les cinq fichiers d'`anime-etl` |
| **Les deux skills d'architecture ne fusionnent pas** | Six sections sur huit de `gcp-dataeng-architecture` sont la contrepartie GCP d'une section générique. Discipline à tenir : le fichier GCP implémente, il ne réénonce jamais |
| **Échelle ponytail coupée en deux** | Barreau 1 (« ça doit-il exister ? ») chez l'orchestrateur ; barreaux 2-6 dans `python-engineering`. Un worker à qui on donne ce barreau refuse du périmètre |
| **`bin/check-envelope` supprimé** | La validation se fait avant l'écriture, par pi, sur les arguments d'outil. Un validateur qui relit un fichier déjà validé duplique un mécanisme |

---

## 6. Manques identifiés, non urgents

**Backfill / reprocessing** et **évolution de schéma** — deux opérations
irréversibles, exactement le déclencheur d'advisor, et aucune skill ne les
décrit. À écrire après le test, pas avant : chaque skill coûte ~145 tokens de
description dans chaque session.

**`.pi/BRIEF.md` n'atteint aucun enfant.** `pi-project-brief` est une extension
locale, `-ne` est actif, et aucun rôle ne la liste. `buildSpawnPlan` devrait le
lire et l'injecter comme une tranche de skill, pour les quatre rôles. Le bundle
Strategic Forge dit **les consignes et le travail** ; le brief dit **l'état du
dépôt à l'instant t** — ils se complètent.

**Pas de chemin de retour.** Les skills encodent ce qu'on savait avant, les
prompts déclenchent une tâche, rien n'encode ce que le système a appris. Huit
revues produites sur `anime-etl` n'ont jamais été relues — retrouvées par `grep`,
par accident. Même arbitrage que l'advisor réactif.

**Lectures, pas installations** : `mishanefedov/skill-issue` pour l'étape C,
`anthony-chaudhary/dos-kernel` pour la vérification des « c'est fait »,
`vaquarkhan/data-engineering-agent-skills` au moment d'écrire les deux manques.

---

## 7. Dette

`evidence/2026-08-03_submit-validation.jsonl` reste dans l'historique Git avec
cinq occurrences d'`anime_password`. Purge = réécriture d'historique, à froid.
La clé API concernée a été révoquée.
