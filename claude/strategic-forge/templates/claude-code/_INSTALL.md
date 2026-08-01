# Protocole de dépôt — cible Claude Code

> **Ce fichier ne fait pas partie du bundle.** Il s'adresse au board et à l'opérateur.
> Il n'est jamais copié dans le projet.

## Emplacements

```
[racine du projet]/
├── CLAUDE.md              → à déplacer en .claude/CLAUDE.md OU laisser en racine
├── ARCHITECTURE.md
├── DESIGN.md
├── BACKLOG.md
└── .claude/
    └── rules/
        ├── [territoire].md
        └── [territoire].md
```

Les deux emplacements de `CLAUDE.md` (racine ou `.claude/`) sont découverts. Retenir
un seul et s'y tenir : deux `CLAUDE.md` seraient concaténés, et rien n'arbitre une
contradiction entre eux.

## Le bundle doit être committé

Un fichier d'instructions non suivi par git est utilisé comme **signal de suspicion
supplémentaire** par le modèle : une rule non versionnée a plus de chances d'être
traitée comme une injection de prompt qu'appliquée.

Le dépôt inclut donc systématiquement :

```bash
git add CLAUDE.md ARCHITECTURE.md DESIGN.md BACKLOG.md .claude/rules/
git commit
```

Vérifier qu'aucune règle `.gitignore` héritée n'exclut `.claude/`.

## Vérification au premier lancement

Trois points à confirmer sur pièce, une fois, à la première session sur le projet :

1. **Les rules se chargent au bon moment.** L'indication de chargement doit apparaître
   à l'ouverture d'un fichier du territoire déclaré, pas avant. Si elle n'apparaît
   jamais, le champ `paths` est mal formé — la portée écrite en clair dans le corps de
   la rule sert alors de filet.
2. **Aucune rule n'est signalée comme injection de prompt.** Si c'est le cas, elle
   contient une méta-instruction : la reformuler en convention.
3. **Le `CLAUDE.md` projet ne fait pas exploser le contexte de démarrage.** Comparer
   la consommation au démarrage avec et sans le projet.

## Filtre de livraison

Avant de remettre le bundle, vérifier que :

- aucune règle déjà portée par `~/.claude/CLAUDE.md`, `~/.claude/rules/conventions.md`
  ou un hook n'est redéclarée ;
- aucune rule ne contient de méta-instruction de format ou de comportement ;
- le `CLAUDE.md` projet tient sous 120 lignes ;
- le backlog est dans `BACKLOG.md`, pas dans `CLAUDE.md` ;
- aucun fichier ne porte de timestamp, date ou identifiant de session en tête ;
- aucune phrase ne crée une condition d'arrêt hors du cas 3 ;
- aucune phrase ne renvoie vers Strategic Forge ;
- les instructions de production adressées au board ont toutes disparu.
