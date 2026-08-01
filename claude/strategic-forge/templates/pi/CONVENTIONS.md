# Conventions — [NOM DU PROJET]

> **Périmètre de ce fichier.** Il ne contient que ce qui est propre à ce projet.
>
> **Test préalable — à passer avant d'écrire la moindre ligne.**
> 1. Cette règle est-elle déjà garantie par du code ? Lint et typage Python
>    (`pi-lint-gate`), format de commit (hook git `commit-msg`), commit sur jeton
>    (`bash-guard`), coût BigQuery (`pi-bq-cost-sentinel`). Si oui : ne pas l'écrire.
>    L'écrire ajoute du contexte sans ajouter de garantie.
> 2. Est-elle déjà dans une skill ? `python-engineering`, `sql-engineering`,
>    `bigquery-engineering`, `dbt-engineering`, `airflow-engineering`, `iac-terraform`,
>    `spark-engineering`, `gcp-engineering` couvrent leurs territoires en profondeur.
>    Si oui : ne pas l'écrire.
> 3. Est-elle dans l'`AGENTS.md` global ? Typage, docstrings Google, hygiène des
>    secrets, taille de modules, comportement de l'agent. Si oui : ne pas l'écrire.
>
> Une règle dupliquée est une règle qui divergera. Si ce fichier est vide après
> filtrage, le livrer vide plutôt que de le remplir.
>
> **Règle de production.** Aucune section n'est conservée « au cas où ». Un outil non
> validé en session ne laisse aucune trace dans le fichier produit.

## Outillage propre au projet

| Fonction | Outil retenu | Commande |
|---|---|---|
| [fonction non couverte par l'outillage global] | [outil] | `[commande]` |

> Ne pas lister lint, format et typage Python : `pi-lint-gate` les applique déjà.
> Cette table ne porte que l'outillage que ce projet ajoute — générateur, migrateur,
> validateur de schéma, runner spécifique.
>
> Table entière supprimée si le projet n'ajoute rien.

## Tests

### Couverture — règle qualitative, pas de pourcentage cible
- Toute logique métier non triviale : test unitaire.
- Toute fonction manipulant des données : test sur données réalistes, pas sur données jouets.
- Tout artefact déployable (job, DAG, modèle, endpoint) : test d'intégrité minimal.
- Tout contrat de données : test sur les clés et les valeurs autorisées.

### Nommage
Format : `test_<unité>_<comportement_attendu>`. Le nom du test décrit l'assertion,
pas la mise en place.

### Tests d'intégration
- Émulateurs locaux quand ils existent.
- Sinon : environnement dédié, ressources préfixées et isolées par branche.
- Cleanup obligatoire en fin de test, y compris en cas d'échec.

## Documentation

### README — contenu minimum
1. **Quoi** : ce que fait le projet, en 1-2 phrases.
2. **Pourquoi** : le contexte qui justifie son existence.
3. **Comment** : commandes d'installation, d'exécution et de test.
4. **Stack** : outils principaux et versions.
5. **Architecture** : lien vers `ARCHITECTURE.md`.

### Commentaires
Un commentaire explique *pourquoi*, jamais *quoi*. Un commentaire qui paraphrase le
code est supprimé.

> Le format de docstring est imposé globalement et ne se redéclare pas ici.

## Conventions propres au projet

> Le cœur utile de ce fichier. Nommage d'entités métier, contrats de données,
> structure imposée par une contrainte du projet, vocabulaire du domaine.
> Chaque entrée s'énonce comme une règle vérifiable, en une ligne.

## Patterns interdits dans ce projet

[Liste issue du débat de Phase 2. Chaque entrée nomme le pattern et la raison en
une ligne. Un interdit sans raison n'est pas respecté.]

Ne pas reprendre les interdits déjà portés par l'`AGENTS.md` global ou par une skill.
Uniquement le spécifique.

## Quand une convention peut être violée

Aucune convention n'est sacrée. Une violation est acceptable si :
1. Elle est annoncée explicitement dans le commit ou la PR.
2. Elle est justifiée par un cas concret — contrainte technique, performance, lisibilité.
3. Elle est localisée, pas une cascade.

Une convention violée silencieusement est un bug. Une convention violée et discutée
est un trade-off légitime.
