# Conventions — [NOM DU PROJET]

> **Périmètre de ce fichier.** Il ne contient que ce qui est propre à ce projet, et
> uniquement sous forme de **dérogation** : « contrairement au défaut, ici… ». Ce qui
> reformule un défaut déjà porté ailleurs crée une contradiction silencieuse que rien
> n'arbitre.
>
> **Personne ne lit ce fichier, sauf l'orchestrateur.** Le `reviewer` ne le reçoit
> jamais : c'est l'orchestrateur qui cite une règle et sa sévérité dans le texte de
> tâche. Chaque entrée doit donc être **citable seule** — la règle, sa sévérité, et de
> quoi juger sans le reste du fichier. Une règle qui renvoie à une autre section de ce
> fichier est inutilisable.
>
> **Test préalable — à passer avant d'écrire la moindre ligne.**
> 1. Cette règle est-elle déjà garantie par du code ? Lint et typage Python
>    (`pi-lint-gate`), format de commit (hook git `commit-msg`), commit sur jeton
>    (niveau TOKEN de `bash-guard`), coût BigQuery (`pi-bq-cost-sentinel`), contrat de
>    sortie des sous-agents (outil `submit` à schéma TypeBox), allocation des modèles
>    (`subagent-only/agents/`). Si oui : ne pas l'écrire. L'écrire ajoute du contexte
>    sans ajouter de garantie.
> 2. Est-elle déjà dans une skill ? `python-engineering`, `sql-engineering`,
>    `bigquery-engineering`, `bigquery-ops`, `spark-engineering`, `airflow-engineering`,
>    `dbt-engineering`, `data-quality`, `gcp-engineering`, `iac-terraform`,
>    `technical-writing` couvrent leurs territoires en profondeur, `logging.getLogger`
>    sous `dags/` compris. Si oui : ne pas l'écrire — **sauf** si ce projet y déroge,
>    auquel cas écrire la dérogation seule.
> 3. Est-elle dans l'`AGENTS.md` global ? Typage, docstrings Google, hygiène des
>    secrets, taille de modules, comportement de l'agent. Si oui : ne pas l'écrire.
>
> Une règle dupliquée est une règle qui divergera. Si ce fichier est vide après
> filtrage, le livrer vide plutôt que de le remplir.
>
> **Règle de production.** Aucune section n'est conservée « au cas où ». Une section
> sans dérogation à porter est supprimée du fichier produit, pas laissée vide.

## Sévérités

Le `reviewer` juge contre une table de sévérité : chaque skill de domaine se termine par
une section `## Review delta` qui donne, pour chaque manquement, `HIGH`, `MEDIUM` ou
`LOW`. Le verdict `blocked` exige au moins un `HIGH`.

Une convention propre à ce projet ne figure dans aucune skill. Énoncée sans poids, elle
laisse le `reviewer` inventer une sévérité, et le verdict cesse d'être reproductible.
**Chaque règle de ce fichier porte donc la sienne**, dans le vocabulaire existant :

- **HIGH** — perte de données, faille de sécurité, explosion de coût, défaut de correction
- **MEDIUM** — risque d'échec silencieux, dette de maintenabilité, violation de politique
- **LOW** — nommage, structure, clarté que le linter ne corrige pas

Une convention sans sévérité est une convention que personne n'appliquera. Si une règle
ne mérite aucune des trois, elle ne mérite pas d'être écrite.

**Forme d'une entrée.** Trois colonnes, toujours :

| Règle | Sévérité | Ce que le reviewer observe |
|---|---|---|
| [l'énoncé, vérifiable, en une ligne] | `HIGH` \| `MEDIUM` \| `LOW` | [le signe concret du manquement dans le code] |

La troisième colonne est ce qui rend la règle jugeable hors contexte. « Respecter le
nommage des entités » n'est pas observable ; « une table dont le nom ne commence pas par
`raw_`, `stg_` ou `fct_` » l'est.

## Outillage propre au projet

> Table entière supprimée si le projet n'ajoute rien. Ne pas lister lint, format et
> typage Python : `pi-lint-gate` les applique déjà.

| Fonction | Outil retenu | Commande |
|---|---|---|
| [fonction non couverte par l'outillage global] | [outil] | `[commande]` |

## Conventions propres au projet

> Le cœur utile de ce fichier. Nommage d'entités métier, contrats de données, structure
> imposée par une contrainte du projet, vocabulaire du domaine — ce qui n'existe dans
> aucune skill parce que ce projet l'invente.

| Règle | Sévérité | Ce que le reviewer observe |
|---|---|---|
| [règle vérifiable en une ligne] | `HIGH` \| `MEDIUM` \| `LOW` | [signe concret du manquement] |

## Patterns interdits dans ce projet

> Ce qui se **juge**. Un anti-pattern qui existe seulement comme conséquence d'une
> alternative rejetée appartient à `DESIGN.md` — c'est une justification à consulter,
> pas une règle à appliquer. Ici, uniquement ce que le `reviewer` peut constater.
>
> Ne pas reprendre les interdits portés par l'`AGENTS.md` global, par une skill, ou déjà
> bloqués par `bash-guard`, `pi-lint-gate` ou `pi-bq-cost-sentinel`.

| Pattern interdit | Sévérité | À la place |
|---|---|---|
| [ce que le code ne doit jamais contenir] | `HIGH` \| `MEDIUM` \| `LOW` | [le comportement correct] |

Un interdit sans raison lisible dans la colonne « à la place » n'est pas respecté.

## Tests

> **Section présente uniquement s'il existe une dérogation.** La couverture, le nommage
> des tests et la stratégie d'intégration sont portés par `tdd` et par la skill de
> domaine. Ne rien écrire ici pour redire le défaut.

| Dérogation | Sévérité | Ce que le reviewer observe |
|---|---|---|
| [contrairement au défaut, ici…] | `HIGH` \| `MEDIUM` \| `LOW` | [signe concret] |

## Documentation

> **Section présente uniquement s'il existe une dérogation.** Le format de docstring et
> les règles de rédaction technique sont imposés globalement et par `technical-writing`.

| Dérogation | Sévérité | Ce que le reviewer observe |
|---|---|---|
| [contrairement au défaut, ici…] | `HIGH` \| `MEDIUM` \| `LOW` | [signe concret] |

## Quand une convention peut être violée

Aucune convention n'est sacrée. Une violation est acceptable si :

1. Elle est annoncée **dans le code**, sur place, par un commentaire qui donne la raison.
2. Elle est justifiée par un cas concret — contrainte technique, performance, lisibilité.
3. Elle est localisée, pas une cascade.

Le `reviewer` ne voit ni ce fichier, ni l'historique, ni la discussion qui a précédé : il
voit le diff et l'extrait qu'on lui a cité. Une dérogation dont la trace n'est pas dans
le code sera jugée à sa sévérité nominale, et c'est le comportement correct.
