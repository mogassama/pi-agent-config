# Attendus chiffrés — `run-cost --contexte`

Ce dossier contient les fixtures de la classe `Contexte` de `tests/test_run_cost.py` (cas K01 à K48). Elles sont produites par `generer.py`, qui est déterministe : une nouvelle exécution redonne les mêmes octets. Le dossier `golden/` n'est pas touché par le générateur. Run synthétique : `f0f0f0f0f0f0f0f0`.

Chaque valeur ci-dessous a été calculée à la main à partir des textes des fixtures, avant d'être comparée à l'instrument.

## Unités et conventions

- **Unités.** 1 caractère vaut ¼ de jeton estimé. Les quantités `*_q` sont des caractères, donc des quarts. C_t est relevé en jetons et multiplié par 4 pour le résidu : R_q = 4·C_t − Σ caractères résidents à t.
- **Message assistant du tour t.** Il n'est **pas** résident à l'appel t. Il le devient à t+1 (hypothèse H-rés).

## nominal (K01, K02, K03, K22, K28, K31, K35)

**Worker #1, deux tours.**

| Tour | C_t | 4·C_t | Résidents (caractères) | Total | R_q |
|---|---|---|---|---|---|
| 1 | 150 | 600 | préfixe 400 + tâche 240 | 640 | −40 |
| 2 | 200 | 800 | 640 + sortie 41 + thinking 40 + lecture 9 | 730 | 70 |

**Totaux, avec thinking.**

- Σ estimé = 640 + 730 = 1 370 q, soit 342,50 jetons.
- ΣC = 350.
- ΣR_q = 30 (7,50 jetons) ; Σ|R_q| = 110 (27,50 jetons).
- Masse résiduelle = 110 / 1 400 = 0,078571.

**Variante sans thinking.**

- Tour 2 = 690, donc Σ estimé = 1 330 q (332,50 jetons).
- R_q = [−40, 110] ; masse = 150 / 1 400 = 0,107143.

**Parts, avec thinking** (cumul / 4·ΣC, non renormalisées) :

| Origine | Calcul | Part |
|---|---|---|
| O-préfixe | 800 / 1 400 | 0,571429 |
| O-tâche | 480 / 1 400 | 0,342857 |
| O-sortie | 41 / 1 400 | 0,029286 |
| O-sortie-thinking | 40 / 1 400 | 0,028571 |
| O-lecture | 9 / 1 400 | 0,006429 |

**Caractères observés.** O-sortie 43 (41, plus 2 au tour 2, non résidents). O-préfixe : 1 occurrence (K28 : `message_start` est ignoré).

**Cas dérivés de nominal.**

- **K02.** Sans `--contexte`, la sortie et le JSON sont identiques octet pour octet à `golden/`, produits par l'instrument antérieur `f6581f37…`.
- **K03.** Les sections système 201 + 199 donnent toujours O-préfixe 400 : aucun arrondi par portion.
- **K31.** Avec input +10 au tour 1 (artefact ajusté), les estimations ne changent pas et R_q du tour 1 augmente de 40.
- **K35.** Avec output de l'artefact +1, le rapprochement par champ refuse (code 2, « champ output »).
- **K41.** Tel quel, le rapprochement est « rapproché » : `cacheWrite` vaut 0 et il est présent, c'est un vrai zéro. Sans `cacheWrite` dans l'artefact (tous les tours à 0), code 0, rapprochement « non établi » et état « non établie pour le rapprochement : champ cacheWrite absent de l'artefact ».
- **K42.** Sans `turns` dans l'artefact : code 0, rapprochement « non établi », état « champ turns absent de l'artefact ».
- **K48.** Tel quel : masse attendue du worker #1 = 350 (C de l'artefact), rôle worker 350 connue, aucune inconnue, 350 observée. Sans `cacheWrite` dans l'artefact (tours à 0 explicites) : masse attendue de #1 inconnue (`null`), masse attendue connue 0, masses inconnues [#1], masse observée 350 inchangée. La mesure des tours ne remplace pas la référence absente.
- **K43.** `cacheWrite` = `false` dans l'artefact : refus code 2, « champ cacheWrite de l'artefact non entier (False) ». `cacheWrite` = `false` dans les tours : code 0, rapprochement « non établi » (usage non entier, compté comme absent).

## relecture (K04 à K08)

Worker #1, système 40 caractères, tâche 5, onze appels. Chaque ligne `A0nn\n` ou `B0nn\n` fait 5 caractères.

| Appel | Résultat | Origine : caractères |
|---|---|---|
| t2 | read a.py 1–10 | lecture 50 |
| t3 | read a.py 5–100 | relecture 30 (lignes 5–10), lecture 450 (K04) |
| t4 | read b.py 1–10, pied `[7 more lines…offset=4…]` | plage 1–3 : lecture 15 (K05) ; encadrement 50 (séparateur et pied) en O-autre, « encadrement de read » (K47) |
| t5 | read b.py 1–5 | relecture 15, lecture 10 (K05) |
| t6 | edit a.py | edit-write 35 ; a.py invalidé |
| t7 | read a.py 1–10 | lecture 50 (K06) |
| t8 | bash | bash 10 ; les lignes sûres de b.py deviennent incertaines |
| t9 | read b.py 1–2 | relecture-incertaine 10 (K07) |
| t10 | read c.py en erreur | autre 20 (K08) |
| t11 | read d.py, pied `[Output truncated…]` inconnu | relecture-incertaine 31 (K08) |
| t12 | read lien/a.py (alias, chemin distinct) | lecture 10 (K08) |

**Totaux observés.**

| Origine | Caractères | Détail |
|---|---|---|
| O-lecture | 585 | 50 + 450 + 15 + 10 + 50 + 10 |
| O-relecture | 45 | 30 + 15 |
| O-relecture-incertaine | 41 | 10 + 31 |
| O-autre | 70 | 20 « read en erreur » + 50 « encadrement de read » |
| O-edit-write | 35 | |
| O-bash | 10 | |
| O-préfixe | 40 | |
| O-tâche | 5 | |

Σ estimé, avec et sans thinking : 9 989 q. Il est identique avant et après le reclassement de l'encadrement : seule l'origine change, aucun caractère n'est perdu ni compté deux fois (K47).

**Références par appel (K45).** O-lecture garde une référence par `read` qui apporte des lignes nouvelles : `c1` [1–10], `c2` [11–100], `c3` [1–3], `c4` [4–5], `c6` [1–10], `c11` [1–2]. O-relecture : `c2` [5–10], `c4` [1–3]. Chaque référence porte le membre `f0…-01-worker.jsonl` et le rang du message. L'encadrement de `c3` porte sa référence sans plage de lignes (K47).

## lint (K09, K10, K11, K33)

- **O-lint 177.** Un bloc ruff de 121 caractères (dernier bloc, cible `.py`, chemin cité relatif) et un message mypy de 56 caractères, après `turn_end`.
- **O-edit-write 102 = 35 + 36 + 31.**
  - 35 : succès de l'edit de `x.py`.
  - 36 : succès de l'edit de `y.txt`.
  - 31 : bloc `--- ruff (y.txt) ---` littéral sur une cible non `.py`, qui reste à l'outil (K10).
- **O-lecture 31.** Un `read` de `z.py` qui cite la marque ruff hors transport (K10).
- **O-bash 40.** Une sortie bash qui commence par la marque ruff (K10).
- **O-autre 59.** Un message user qui commence par la marque mypy, sans `turn_end` qui le précède.

## revue (K12 à K18)

Longueurs des chaînes, en caractères : I1 67, F1 71, R1 68, Z1 68, Y1 73, G1 72.

Tâche du worker #5, unité W01 :

> `Reprise. I1 | F1[:45] | R1 | R1 | Z1 | reformulation(I1) | Y1 | G1`

Les sources retenues sont les reviewers #2 et #3, tous deux antérieurs et dans W01. Le reviewer #4 appartient à une autre unité ; le reviewer #6 est postérieur.

**O-revue = 180 = 67 (I1) + 45 (F1 tronqué, ≥ 40) + 68 (R1).**

- R1 est présent deux fois dans la tâche, mais SequenceMatcher n'en apparie qu'une occurrence. I1 et R1 figurent dans #2 et #3 : les positions fusionnées sont comptées une fois.
- Z1 (autre unité) et Y1 (postérieur) ne sont pas reconnus.
- G1 figure dans #2 mais aussi dans le système du worker : c'est un texte générique exclu (« 1 bloc »).
- La reformulation ne partage avec I1 aucun bloc exact ≥ 40.
- Le reviewer #2 porte 2 champs ignorés (`fix` vide, `impact` non textuel).

**K15.** Sans I1 en tête de tâche, O-revue = 45 + 68 = 113 : la reformulation n'est pas reconnue.

**Liens `for_risks` (K18).**

| Risque | Résultat |
|---|---|
| `f0…-02-1` | reviewer 2, pièce `f0…-02-reviewer.json` |
| `f0…-99-1` | « non documenté » |

**Références de revue (K46).** O-revue = 180 caractères, et cinq références : #2 `findings[0].issue`, #2 `findings[0].fix`, #2 `open_risks[0]`, #3 `findings[0].issue`, #3 `open_risks[0]`. I1 a le même intervalle de tâche pour #2 et #3 : deux références, des caractères comptés une fois.

**Contre-exemples `for_risks`, ajoutés en copie (K39, K40).** Aucun ne donne de provenance confirmée.

| Risque | Événement `opened` | Résultat |
|---|---|---|
| `f0…-02-2` | `by` = `aaaaaaaaaaaaaaaa-02-reviewer.json` (autre run, même numéro) | « non documenté » (K39) |
| `f0…-02-3` | `by` = `f0…-02-worker.json` (autre rôle, même numéro) | « non documenté » (K39) |
| `f0…-02-4` | deux événements, `by` #2 et `by` #3 (contradictoires) | « non documenté » (K40) |
| `f0…-03-5` | sans `by` | « non documenté » (K40) |
| `f0…-02-1` | doublon identique de l'événement d'origine | reviewer 2, inchangé (K40) |

## usage (K20, K21, K29, K30, K32)

**Worker #1.**

- Les états des tours, variante sans thinking, sont `ok`, `contexte nul`, `ok`, `ok`, `usage absent`. Le dernier C est nul (`None`), pas 0.
- 2 tours non monotones.
- L'état « non établie pour le rapprochement : usage absent » s'applique.

**Reviewer #2.** Transcription absente : attendues 1, lues 0, non établies [2]. Sa masse attendue connue (C de l'artefact) vaut 10.

**K44.** Un worker #3, ajouté en copie sans transcription, a un artefact avec input 70, cacheRead 5, cacheWrite 0 et turns 1.

- Effectifs du rôle worker : attendues 2, lues 1.
- Masse observée : 450 (ΣC relevé du worker #1 : 200 + 0 + 150 + 100). Masse attendue connue : 525 (450 + 75). Masse attendue inconnue : aucune.
- Non établie : #3, de masse attendue 75.
- Périmètre : « sous-ensemble observé : 1 délégation(s) lue(s) sur 2 attendue(s) ». Il est repris dans chaque classement du rôle et dans la sortie texte.

**K30.** Le premier poste estimé est O-sortie-thinking avec thinking et O-préfixe sans thinking : « DIVERGENCE ».

**K32.** Avec thinking, la somme des parts vaut 7,647778 (dont 6,666667 pour la tête O-sortie-thinking) ; sans thinking, 0,981111. Les parts ne sont pas renormalisées.

## identite (K23 à K27, K36)

Worker #1 et reviewer #2. La trace `f0…-02-transmis.json` n'est pas une délégation (rôles : reviewer, worker) ; `diff_injecte_trace` = 123.

Refus attendus, tous en code 2, après altération en copie :

| Cas | Altération | Refus |
|---|---|---|
| K23 | en-tête d'un autre run | `en-tête de session aaaaaaaaaaaaaaaa-worker` |
| K24 | seq 3 dans le journal | `délégation #3 (worker)` |
| K25 | `message_end` doublé | `collision de message_end` |
| K27 | ligne tronquée | fichier et ligne nommés |
| K36 | journal réduit à #1 | `absent du journal des délégations` |
| K38 | reviewer renommé `f0…-01-reviewer`, ligne du journal à seq 1 | `séquence #1 portée par deux artefacts, f0…-01-worker.json et f0…-01-reviewer.json` |

## compaction (K19) et compaction-ambigue (K34)

**Orchestrateur, deux segments.**

| Segment | ΣC | Σ estimé (avec thinking) |
|---|---|---|
| 0 | 130 | 214 q (53,50) |
| 1 | 60 | 120 q (30,00) |

Les résidents initiaux du segment 1 sont le résumé (O-résumé) et les messages gardés depuis `firstKeptEntryId`.

**K34.** Deux enfants pour un même `parentId` : « non établie : branche ambiguë dans la session ».

## Rapprochement interne (K37)

Pour chaque délégation, chaque rôle et chaque segment d'orchestrateur, et pour chaque variante, deux égalités sont vérifiées :

- Σ cumul par origine = Σ estimé ;
- Σ estimé + ΣR = 4·ΣC (en quarts).

Elles sont vraies par construction. Un défaut vaut code 1 (« INCOHÉRENCE INTERNE ») et ARRÊT. K37 le provoque en faussant ΣR de 1 quart par substitution de `ctx_bilan` dans le test ; aucune fixture n'est nécessaire au-delà de nominal.
