# Instruments versionnés

Les instruments qui ont autorisé un acte vivaient hors du dépôt, dans le répertoire d'audit. Une preuve dépendait alors d'un script joint plutôt que d'un fichier relu. Ce répertoire en porte des **copies exactes** (phase 3, P2).

| Chemin | Contenu |
|---|---|
| `s4/` | la porte S4 (`mesurer-s4.sh`), le verrou de son outillage, un gabarit de plan, la provenance |
| `qualif-mac-r4/` | l'instrument externe de la qualification Mac r4 de LOT-PI-ADAPT (dix-huit fichiers), et sa provenance |
| `MANIFESTE-INSTRUMENTS.sha256` | empreintes de tous les fichiers de ce répertoire, sauf lui-même, triées `LC_ALL=C` |
| `MODES-ATTENDUS.tsv` | le mode attendu de chacun de ces fichiers |

**Rien ici n'est exécuté** par `bin/test-guards`, par pi ou par une porte du dépôt. La garde `tests/l0-instruments.test.ts` en vérifie l'intégrité :

- ensemble exact ;
- chemins canoniques ;
- ni lien ni nœud spécial ;
- empreintes ;
- modes ;
- un compte nul est refusé.

Modifier un fichier d'ici, c'est changer un instrument : cela relève d'un lot et de son adjudication, pas d'une retouche. Les originaux restent conservés sous `~/audits` et font foi.
