---
paths: ["[glob]", "[glob]"]
---

<!--
================================================================================
TEMPLATE DE RULE — ne pas livrer ce fichier tel quel.
Produire un fichier par territoire de fichiers, nommé d'après le territoire :
  .claude/rules/python.md, .claude/rules/sql.md, .claude/rules/dbt.md, ...
Les commentaires de ce bloc ne survivent pas dans le fichier produit.
================================================================================

TEST PRÉALABLE — À PASSER AVANT D'ÉCRIRE LA MOINDRE LIGNE

  1. Cette règle est-elle déjà dans ~/.claude/rules/conventions.md ?
     → OUI : ne pas l'écrire. Le socle global couvre Python, SQL (BigQuery et
       PostgreSQL), dbt, Airflow et Terraform en profondeur. Sur ces territoires,
       une convention projet n'existe que sous forme de DÉROGATION.
     → NON : continuer.

  2. Est-elle déjà garantie par un hook ?
     → Commit sur jeton, gardes destructives, gate de coût BigQuery, lint et typage
       Python sont appliqués par du code. Les réécrire ajoute du contexte sans
       ajouter de garantie. Ne pas les écrire.

  3. Est-ce une convention, ou une instruction de comportement ?
     → « les modèles incrémentaux déclarent une unique_key » : convention, valide.
     → « commence tes réponses par… », « réponds toujours en… », « utilise ce
       format de sortie » : méta-instruction. REFUSÉE par le modèle et signalée
       comme injection de prompt. Ne jamais en écrire dans une rule.

  Si les trois tests passent, la règle a sa place ici.

FORME OBLIGATOIRE — LA DÉROGATION EXPLICITE

  Rien n'arbitre les contradictions entre instructions : tous les fichiers découverts
  sont concaténés, et deux règles contradictoires donnent un tirage au sort.

  Une règle qui s'écarte du socle s'écrit donc en conditionnelle explicite :

      « Contrairement au défaut global, dans ce projet <X> plutôt que <Y>,
        parce que <raison en une ligne>. »

  Jamais : « on utilise X » — qui laisse le socle et la rule s'affronter en silence.

ADDITIVITÉ — LES RULES NE S'EXCLUENT PAS

  Un fichier peut charger deux rules dont les globs se recouvrent, et le glob le plus
  spécifique NE l'emporte PAS. Un models/m.sql charge sql.md ET dbt.md.

  Deux rules qui se recouvrent doivent donc SE COMPOSER : l'une porte le socle
  projet, l'autre l'incrément. Jamais se répéter, jamais se contredire.

GLOBS — vérifier à la première utilisation que la portée déclarée se charge bien
  au moment attendu, et pas avant. Le format exact du champ `paths` se confirme sur
  pièce lors du premier dépôt.
================================================================================
-->

# [Territoire] — [NOM DU PROJET]

**Portée :** [énoncer en clair les fichiers couverts, en plus du frontmatter. La portée
écrite en texte survit à un problème de glob.]

## Dérogations au socle global

| Règle globale | Ici | Raison |
|---|---|---|
| [ce que dit le défaut] | [ce qui s'applique dans ce projet] | [une ligne] |

Section supprimée s'il n'y a aucune dérogation — ce qui est le cas normal.

## Conventions propres au projet

[Uniquement ce qui n'existe nulle part ailleurs : nommage d'entités métier, structure
imposée par une contrainte du projet, contrat de données spécifique. Chaque entrée
tient en une ligne et s'énonce comme une règle vérifiable.]

## Patterns interdits sur ce territoire

| Pattern | Raison | À la place |
|---|---|---|
| [ce qu'il ne faut pas faire] | [pourquoi, en une ligne] | [le comportement correct] |

Ne pas reprendre les interdits universels du socle global. Uniquement le spécifique.
Un interdit sans raison n'est pas respecté.
