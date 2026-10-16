# PLAN S4 — <lot> — <objet audité> (gabarit)

Gabarit de déclaration pour `instruments/s4/mesurer-s4.sh`. Un plan concret remplace chaque `<…>` et garde tout le reste. Un plan S4 n'autorise jamais le lancement de S4 : il déclare seulement ce que la porte mesure.

**Conditions à écrire dans chaque plan concret :**

- **Objet audité :** commit complet et son arbre. La base est fixe ; aucun repli sur `~/.pi/agent`, le dépôt mesuré étant toujours désigné par `PI_AGENT_DIR`.
- **Références :** constituées sur cet objet par `--constituer`, avec le compilateur et les dépendances de `outillage.lock` (typescript 7.0.2, @types/node 26.5.0), puis figées et épinglées par l'empreinte de `MANIFESTE-REFERENCES.sha256` (`S4_REFERENCES_SHA256`). « Avant » doit les reproduire, canal par canal ; sinon la comparaison ne vaut rien.
- **Verdict :** aucun diagnostic nouveau n'est admis. Une disparition de diagnostic n'est admise que déclarée dans `S4_EXPECTED_REMOVED` avec sa justification. Une entrée ou une sortie de programme n'est admise que déclarée dans `S4_PROGRAM_ADDED` / `S4_PROGRAM_REMOVED`.
- **Couverture :** `S4_SCOPE` ne contient que des fichiers effectivement consommés par un canal TypeScript. `S4_DOCUMENT_SCOPE` n'admet que des `.md` et les chemins nommés dans `ADMIS_HORS_MD` de l'instrument. Un fichier du delta qui n'entre dans aucune des deux listes n'est **pas** couvert par S4 ; le plan concret le dit et nomme sa couverture complémentaire. Un vert S4 ne couvre que ce que la porte lit.
- **Divergence :** S4 refuse tout fichier qui diverge de l'objet hors de l'ensemble mesuré. Si le dépôt mesuré n'est pas l'arbre complet du candidat (projection sur l'ensemble mesuré), le plan concret le déclare, avec l'inventaire de la projection.

S4_OBJET_BEGIN
<commit complet de l'objet audité, 40 hexadécimaux>
S4_OBJET_END

S4_SCOPE_BEGIN
<un chemin TypeScript consommé par ligne, trié LC_ALL=C>
S4_SCOPE_END

S4_TYPESCRIPT_EXTENSIONLESS_BEGIN
<binaires sans extension compilés par le second canal, chacun aussi dans S4_SCOPE>
S4_TYPESCRIPT_EXTENSIONLESS_END

S4_DOCUMENT_SCOPE_BEGIN
<un .md, ou un chemin admis nommément, par ligne, trié LC_ALL=C>
S4_DOCUMENT_SCOPE_END

S4_PROGRAM_ADDED_BEGIN
<{"channel": "principal|extensionless", "path": "…", "justification": "…"} par ligne>
S4_PROGRAM_ADDED_END

S4_PROGRAM_REMOVED_BEGIN
<même forme>
S4_PROGRAM_REMOVED_END

S4_EXPECTED_REMOVED_BEGIN
<{"channel": …, "path": …, "code": "TS…", "message": …, "multiplicity": n, "justification": …} par ligne>
S4_EXPECTED_REMOVED_END
