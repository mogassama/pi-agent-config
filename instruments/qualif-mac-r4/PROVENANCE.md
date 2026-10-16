# Provenance de l'instrument externe de qualification Mac r4

Les dix-huit fichiers sous `bin/` et `tests/pi-contrats/` sont des **copies exactes** de `/Users/MoG/audits/couche-pi/qualif-mac-correctif-r4/paquet/instrument/`, aux mêmes chemins relatifs. Ils sont vérifiés contre `MANIFESTE-PAQUET.sha256` `fe58ff7b…` (64/64). Leurs empreintes sont dans `instruments/MANIFESTE-INSTRUMENTS.sha256`.

C'est l'instrument qui a qualifié LOT-PI-ADAPT sur le Mac : M1 à M7, retour `92aad2dc…`, adjugé CONFORME `09b815fb…`.

**O2-1 reste ouverte.** Quinze de ces fichiers sont identiques à l'instrument interne du dépôt (`bin/pi-contrats`, `tests/pi-contrats/`), à la base `604e8948…`. Trois diffèrent :

| Fichier | Externe (ici) | Interne |
|---|---|---|
| `tests/pi-contrats/falsifier.sh` | `12ec9483…` | `8d3a0017…` |
| `tests/pi-contrats/harnais.ts` | `9598e074…` | `5a014e85…` |
| `tests/pi-contrats/modes.ts` | `c6956064…` | `86d48598…` |

Les verser ici ne les réconcilie pas, ne remplace pas l'instrument interne, ne requalifie aucun contrat de pi et n'en fait pas un programme du dépôt. Aucun test, aucune porte et aucun chargement de pi ne les exécutent ; ils sont hors de `bin/test-guards`, du tsconfig de S4 et du balayage des surfaces. Leur garde est `tests/l0-instruments.test.ts`, qui en contrôle l'intégrité sans les exécuter.
