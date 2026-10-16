# Provenance de la porte S4 versionnée

| Fichier | SHA-256 | Source |
|---|---|---|
| `mesurer-s4.sh` | `06de488f3574b8500c3c8cd81f35d5ac3d4d59c1ac7635261123adae205a6f42` | `/Users/MoG/audits/couche-pi/qualif-mac-correctif-r4/paquet/s4/mesurer-s4.sh` ; paquet `MANIFESTE-PAQUET.sha256` `fe58ff7b…` (64/64) |
| `outillage.lock` | `f1bf098148326223ef3fce73e8151cc5c13620c470ab886dcc0c788b6a1ff290` | `…/paquet/s4/references/outillage.lock`, couvert par `MANIFESTE-REFERENCES.sha256` `37aa3870…` |

Ce sont des **copies exactes**. Leur identité est leur empreinte, même si l'en-tête du script retrace son historique de v1 à v9 ; les plans de LOT-PI-ADAPT l'appelaient « v10 ». Le même octet est présent dans tous les paquets Mac depuis `qualif-mac-correctif`.

L'instrument a servi à la qualification Mac r4 de LOT-PI-ADAPT (M3 : S4 VERT, 127 → 125 et 33 → 33 ; retour `92aad2dc…`, adjugé `09b815fb…`).

Les références de l'objet `b5453204…` / `afaf99af…` restent des pièces de mesure sous `~/audits`. Elles ne sont pas versionnées : chaque objet audité a les siennes.

Copier la porte dans le dépôt ne la modifie pas et ne la requalifie pas. La configuration TypeScript des deux canaux est écrite par le script lui-même : elle devient, par ce versement, un fichier relu du dépôt.
