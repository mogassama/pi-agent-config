# Changer de version de pi

Procédure à suivre le jour où cette configuration devra passer à une autre version de pi.

C'est un texte de procédure : rien n'y est exécuté, choisi ni autorisé.
- **pi 0.86.0 est la seule version qualifiée.** Aucune version cible n'est choisie ici.
- Les commandes citées ne valent qu'avec leurs préconditions et leur autorisation propre.

Contexte : `README.md`, section « pi version and the adaptation layer (LOT-PI-ADAPT) ».

## 0. En attendant

- **Garder pi à la 0.86.0.** Ne pas le laisser se mettre à jour seul, ni le mettre à jour « pour voir ».
  - `PI_VERSION_QUALIFIEE` est une déclaration, pas une garde effective de version (§ 7). Cela ne décrit pas tous les refus possibles de la production.
  - Le comportement d’une autre version n’est pas qualifié. Elle pourrait provoquer des refus ou des ruptures ; aucune détection exhaustive ni absence d’avertissement n’est garantie.
- **Identité de la production qualifiée** (Mac, qualification r4) :
  - pi `@earendil-works/pi-coding-agent` 0.86.0, sous `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/` ;
  - CLI `dist/bundle/cli.js` de SHA-256 `a7c29b72044cb7e03b026424b59a177133ae95dbbd7d12f9421be811e8e2eeac` ;
  - Node 26.11.1, `/opt/homebrew/Cellar/node/26.11.1/bin/node`, SHA-256 `f75a79e4c96954709a130427e452d6720b35c90318ca8293727a4c6376198453`.

  Ces identités servent de référence au retour arrière (§ 9).

## 1. Ce que la montée n'est pas

- **Pas une mise à jour.** C'est un lot à part entière, avec son plan adjugé, ses qualifications bac puis Mac, sa revue adverse, puis son établissement, son gel et sa publication, chacun sur autorisation.
- **Pas une simple vérification de contrats.** LOT-PI-ADAPT était une première tranche de P3. Certaines surfaces restent hors de la couche :
  - les événements des autres extensions ;
  - `ctx.compact` ;
  - la lecture des sessions JSONL ;
  - la configuration.

  Le plan de LOT-PI-ADAPT (§ 1) l'exige : avant toute montée, un plan complémentaire traite chaque surface restante, ou fait adjuger explicitement son maintien hors couche, avec sa raison et ses contrats. Le registre `tests/pi-surface.json` décrit ces écarts ; il ne les couvre pas.

## 2. Conditions d'entrée

Avant tout acte de la montée :

1. **Identité de la production relevée** : dépôt, branche, HEAD, arbre, configuration locale (dont `core.hooksPath`), crochets, worktrees, identité de pi et de Node.
2. **pi arrêté** pour les actes qui l'exigent. Aucune collision avec le travail en cours de l'opérateur : rien n'est écrasé.
3. **Plan de montée adjugé** :
   - cible gelée (§ 3) ;
   - plan complémentaire des surfaces restantes (§ 1) ;
   - liaison de `PI_VERSION_QUALIFIEE` (§ 7) ;
   - dettes devenues conditions d'entrée (§ 8).
4. **Retour arrière défini et autorisable** (§ 9) avant le premier acte sur la production.

## 3. Choisir puis geler la cible

- **Version.** Choisir un numéro de version **exact et publié**, puis le geler dans le plan avant toute construction ou mesure. `latest` n'est pas une identité reproductible et n'est jamais une cible.
- **Identité d'installation.** Relever et épingler l'identité des paquets installés (`pi-coding-agent`, `pi-ai`, `pi-tui`), de Node et de l'outillage. La méthode de `relever-pi.sh` (plan v2) compare chaque archive à une empreinte attendue explicite. Archive absente, empreinte différente ou extraction échouée donnent un relevé incomplet, jamais une absence de membre du SDK.
- **Ordre.** Monter directement vers la cible, selon l'ordre déjà adjugé. Les versions intermédiaires servent seulement au diagnostic, jamais d'étape de production.
- **Changements déjà relevés.** Le plan v2 (§ 2) a relevé, au moment de LOT-PI-ADAPT, des changements entre 0.86.0 et 1.0.4. Par exemple, en 0.99.0, la provenance des outils natifs passe de `<builtin:NOM>` à `builtin:NOM`, ce qui casse C3. Ces relevés sont datés : ils sont à refaire sur la cible gelée, pas à reprendre tels quels.

## 4. L'instrument

- **Instrument qualifié, conservé hors du dépôt.**
  - Emplacement : `/Users/MoG/audits/couche-pi/qualif-mac-correctif-r4/paquet/instrument/`.
  - Harnais `9598e0749ff871b0089554a3759787b1936888a445563aa1baa97c2274b5398d`, dix-huit fichiers, liste Mac `94009d6f…`.
  - Recette et pièces : sous `qualif-mac-correctif-r4/`.
  - **Cette recette est liée à son candidat et à ses chemins.** Ce n'est pas un lanceur générique vers une autre version ni vers la production.
- **`bin/pi-contrats` (dans le dépôt) n'est pas l'outil de requalification.**
  - C'est le CLI de l'item 1 (harnais `5a014e85…`), sans la règle D1′ ni le mode N5 externe.
  - Son contrôle de base refuse sur l'arbre établi.
  - Seul pi 0.86.0 y est qualifiant. Sa contre-épreuve `--contre-epreuve 0.99.0` est non qualifiante : elle montre la rupture de C3 et ne déclare aucun vert.
- **Pour la cible**, le plan de montée prévoit l'identité et la qualification d'un instrument pour cette version. Le rapprochement des deux instruments (O2-1) relève de ce plan.

## 5. Vérifier

Chaque mesure se fait une fois, sur autorisation, et s'arrête à la première rupture. Un résultat inattendu ou indéterminé donne un ARRÊT et un retour, jamais une réparation ni une relance.

**Contrats C1 à C8 contre le pi réel** (plan v2, § 3) :

| Contrat | Objet |
|---|---|
| C1 | Exports utilisés présents et appelables |
| C2 | Les douze points d'entrée, chacun chargé dans son contexte réel |
| C3 | Provenance des outils natifs |
| C4 | Événements : blocage effectif, chaînage, champs reçus |
| C5 | Membres de `ctx`, contrats négatifs compris |
| C6 | CLI des enfants, par effets observés |
| C7 | Flux `--mode json` |
| C8 | Session de l'orchestrateur |

Chaque contrat est dans l’un de trois états : satisfait, violé ou indéterminé. **Seul « satisfait » compte vert.**

**À rejouer ensuite** :
- le registre des surfaces et sa garde (`tests/l0-pi-surface.test.ts`) ;
- les portes (`test-guards`, `l0-check`, `lanes-concurrency`, `l0-mutants`, S4) ;
- les mutants ;
- la revue adverse.

L'ordre reste celui du plan : qualification dans le bac, puis sur le Mac, chacune avec son autorisation.

## 6. Corriger

- **Où.** L'intention est de concentrer les corrections d'adaptation dans `subagent-only/pi-adapt.ts`, puisque le savoir sur pi y est regroupé. Rien ne garantit que toute rupture s'y réduise : une rupture dans une surface hors couche (§ 1), ou dans le comportement, relève d'un autre fichier.
- **Périmètre.** Tout élargissement du périmètre prévu revient à Sol **avant écriture**.
- **Défauts de comportement.** Un défaut constaté à cette occasion n'est pas corrigé en passant. Par exemple, l'interruption qui n'atteint pas les enfants, ou `getSessionStats` absent (constats 8 et 4). Il va dans un lot distinct, avec sa preuve rouge.

## 7. Lier `PI_VERSION_QUALIFIEE` (O1-4)

- **Aujourd'hui.** `PI_VERSION_QUALIFIEE` (`subagent-only/pi-adapt.ts`) déclare `0.86.0`. Ce n'est pas la garde effective de version : l'identité contrôlée est celle de l'instrument (`tests/pi-contrats/identite-0.86.0.json`).
- **À planifier.** La lier réellement à l'identité contrôlée est un travail à inscrire au plan de montée, avant de qualifier une autre version. Ce n'est pas une garde déjà en service.
- **Interdit.** Ne pas assouplir l'identité pi exigée pour accepter une nouvelle cible. La nouvelle identité se qualifie ; l'ancienne ne s'élargit pas.

## 8. Dettes et limites, et quand elles deviennent des conditions d'entrée

| Dette ou limite | Aujourd'hui | Devient condition d'entrée… |
|---|---|---|
| D-P3-N1 — TMPDIR | `tests/l0-pi-adapt.test.ts` dépend de TMPDIR ; un témoin de chemin réel à 12 caractères a échoué, sans seuil général revendiqué ; portes qualifiées avec `/Users/MoG` (10) | … si les portes de la montée tournent sous un autre TMPDIR, notamment `/private/tmp` |
| D-P3-PI-SURFACE-METADONNEES | `l0-pi-surface` peut refuser un `.DS_Store` sous `tests/pi-contrats` | … si un tel fichier est présent au moment des portes |
| O2-1 — instruments interne et externe | deux instruments distincts (§ 4) | … toujours : l'instrument de la cible doit être identifié et qualifié |
| O1-4 — `PI_VERSION_QUALIFIEE` | déclaration seulement (§ 7) | … toujours, avant de qualifier une autre version |
| O2-4 — formes jiti `fallback` et `json` | non revendiquées comme éprouvées ; forme inconnue non admise | … si la cible charge des extensions par ces formes |
| Portabilité | Linux : Node 22.22.0 et 26.11.1 ; Mac : Node 26.11.1 ; Bash 3.2 et TUI hors champ ; exclusions C2.9 et C2.10 | … si la cible ou l'outillage sort de ce champ |
| Sujets de commit du runtime | soumis au crochet `commit-msg` (≤ 72, sans exemption) ; longueurs réelles non qualifiées | … si la montée modifie les messages du runtime |

## 9. Revenir en arrière

Le retour arrière fait partie du plan de montée, avec sa propre autorisation.

- **Ce qu'on conserve avant la montée :**
  - l'identité de 0.86.0 et de Node (§ 0) ;
  - l'état de la configuration ;
  - le commit et l'arbre de la production.
- **Ce qu'on restaure :**
  - l’installation de référence 0.86.0 et l’outillage conservés, avec l’identité complète adjugée et vérifiée ; la version du paquet et le SHA-256 du CLI ne suffisent pas, seuls, à cette vérification ;
  - la configuration d'avant ;
  - le code d'avant, si la montée a été établie.
- **Comment on vérifie :** identité de pi, configuration, HEAD et arbre, puis les mêmes contrôles que pour la production qualifiée.
- **Ce qu'on ne réutilise pas :** ni le retour de l'acte E de LOT-PI-ADAPT, ni le retour des crochets de POST-1. Ce sont des recettes liées à leurs actes.

## 10. Après la montée

Un QD de référence sur la nouvelle version se fait sur autorisation distincte, après la montée établie.

Ce document n'autorise ni QD, ni mesure, ni montée de pi. Il ne modifie pas l'ordre des phases du suivi.
