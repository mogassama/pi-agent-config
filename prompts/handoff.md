On va switch de modèle. Avant le switch, produis UN SEUL message contenant les sections suivantes.

Format dense, pas de prose explicative. Pas de récap de la discussion. Ce message est le brief unique au prochain modèle après `/compact`.

---

## 1. Décisions actées
Bullet list, une ligne par décision, sans rationale.

## 2. Plan d'exécution
Étapes numérotées. Chaque étape doit être exécutable indépendamment par le prochain modèle sans contexte additionnel.

## 3. Contraintes à respecter
Ce qui ne doit PAS bouger. Inclure les contraintes techniques, les choix d'architecture figés, et les règles de style actives dans cette session.

## 4. Points d'attention
Pièges concrets où le prochain modèle pourrait se tromper. Formuler comme : "Ne pas X — risque de Y."

## 5. Fichiers concernés
Un fichier par ligne avec son état :
- `path/to/file.py` — modifié, continuer à l'étape N
- `path/to/new_file.py` — à créer, spec dans la section 2
- `path/to/ref.md` — référence uniquement, ne pas modifier

## 6. Commande de reprise
La commande exacte à taper après le switch pour reprendre sans ambiguïté :
```
pi "..."
```
