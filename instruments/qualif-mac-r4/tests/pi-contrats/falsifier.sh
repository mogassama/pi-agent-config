#!/usr/bin/env bash
#
# falsifier.sh — épreuves des refus d'identité et d'isolement (M2, M6), avec leurs mutants.
#
# Instrument N5 hors dépôt (plan N5 corrigé par Sol, 09-10-2026, option B) : tous les modes exigent en tête
# `--depot <chemin absolu canonique>`, transmis à chaque appel de bin/pi-contrats ; sinon code 2. La racine
# de l'instrument (copiée pour les mutants) et le dépôt à qualifier sont distincts.
#
#   tests/pi-contrats/falsifier.sh --depot <d>            toutes les épreuves
#   tests/pi-contrats/falsifier.sh --depot <d> M2.3/v20   une seule
#
#   falsifier.sh --depot <candidat> --n5 <dossier neuf>
#                                                 G-N5 : pour chaque cas, contre-épreuve d'intégration
#                                                 (premier refus déclaré, aucun lancement), puis, pour
#                                                 chaque clause déclarée, lecteur local : témoin
#                                                 satisfait, altération refusée par la clause ; mutant de
#                                                 cette seule clause (`refuser("G-N5/<clause>",` →
#                                                 `ignorer(`), même lecteur : témoin satisfait, altération
#                                                 admise. Puis sélection : r1, r2, r3, r4, r5-candidat.
#   falsifier.sh --depot <dépôt de base> --n5-selection-base <dossier neuf>
#                                                 r5-base : le mode base n'appelle que G-I1-base.
#
# Pour chaque épreuve (matrices, § B) :
#   1. contrôle : `bin/pi-contrats --refus <id>` sur le dépôt ;
#   2. mutant : dans une copie du dépôt, la seule garde visée est désarmée
#      (`refuser("<règle>",` et `releve("<règle>",`, y compris sur plusieurs lignes,
#      deviennent `ignorer("<règle>",` dans tests/pi-contrats/*.ts), puis le même stimulus.
# Le verdict est calculé sur les résultats structurés (--resultat), jamais sur les
# lignes du rapport :
#   - garde avant lancement : le contrôle est refusé par elle, sans lancement ; le
#     mutant mord s'il franchit la frontière gardée (lancement tenté) sans autre
#     refus ni erreur préalables. C'est une preuve locale de la garde. Les constats
#     et erreurs postérieurs sont conservés et imprimés ; ils ne masquent pas cette
#     preuve, mais l'exécution ultérieure n'est alors pas qualifiée ;
#   - épreuve du lecteur d'identité (sans lancement) : le contrôle est refusé par la
#     garde ; le mutant mord si la lecture est acceptée ;
#   - garde d'exécution : le contrôle est lancé et porte le constat de la règle ; le
#     mutant mord si ce constat disparaît et qu'aucun constat absent du contrôle
#     n'apparaît à sa place (pas de masquage).
# Un mutant inerte (aucun site changé), cassé (erreur avant la frontière, ou sans
# lancement ni refus) ou masqué compte comme un échec.
#
# Écrit seulement dans un dossier temporaire. bash 3.2.
#
# Item 1 (adjudications du 08-10-2026), modes séparés, hors du 38/38 historique :
#   falsifier.sh --item1 [id …]                  épreuves M6.14, M6.15 et G-I1-base, même logique
#                                                 contrôle/mutant que ci-dessus
#   falsifier.sh --contre-epreuves-reelles <dossier> [id …]
#                                                 contre-épreuves réelles (b) du plan, une fois chacune,
#                                                 pièces conservées dans <dossier> (neuf)
#   falsifier.sh --mutants-verificateurs <dossiers séparés par :> [id …]
#                                                 mutants des vérificateurs (B8) : dans une copie, une
#                                                 seule garde désarmée (ensemble DESARMEES de
#                                                 scenarios.ts) ; réévaluation des observations
#                                                 conservées, sans relancer pi. Le mutant mord si la
#                                                 contre-épreuve donne alors « satisfait » et que le
#                                                 nominal reste « satisfait ».
#   falsifier.sh --lecteur-item1 <entrées> <dossier>
#                                                 contrôle de lecteur M6.15/interprete (R3, adjudication
#                                                 a0000800), compté à part des 16 refus réels et des
#                                                 110 mutants de vérificateurs. Sans lancer pi :
#                                                 contrôle : Contexte inchangé → aucun constat ; copie du
#                                                 Contexte dont l'empreinte mémorisée de l'interprète est
#                                                 altérée → exactement un constat M6.15/interprete
#                                                 INVALIDE, rattaché au simulateur et à l'interprète ;
#                                                 mutant : le seul site `releve("M6.15/interprete",`
#                                                 désarmé dans une copie du dépôt, dont le harnais est
#                                                 servi à l'URL du harnais d'origine (substituer-harnais.mjs,
#                                                 pour garder la racine d'instrument de l'exécution) ; il
#                                                 mord si la copie altérée et l'inchangée sont toutes deux
#                                                 admises sans constat. Témoin : la même substitution
#                                                 d'une copie non mutée redonne les résultats du contrôle.
#                                                 SHA-256 de l'interprète relu avant et après. Entrées,
#                                                 résultats et diff du mutant conservés dans <dossier> (neuf).
set -u
export LC_ALL=C
racine="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "${1:-}" != "--depot" ] || [ -z "${2:-}" ]; then
  echo "usage : falsifier.sh --depot <chemin absolu canonique> [mode …]"
  exit 2
fi
depot="$2"
shift 2
case "$depot" in /*) ;; *) echo "falsifier.sh : dépôt non absolu : $depot"; exit 2 ;; esac
[ "$(cd "$depot" 2>/dev/null && pwd -P)" = "$depot" ] || { echo "falsifier.sh : dépôt illisible ou non canonique : $depot"; exit 2; }
tmp="$(mktemp -d "${TMPDIR:-/tmp}/falsifier.XXXXXX")"
# G-I1-base : les épreuves clonent le dépôt explicitement choisi (--depot), jamais la racine de
# l'instrument ; la copie mutée reste un instrument, sans dépôt implicite.

copier_depot() {
  rm -rf "$1" && mkdir "$1"
  (cd "$racine" && tar cf - --exclude=.git .) | (cd "$1" && tar xf -)
}

if [ "${1:-}" = "--contre-epreuves-reelles" ]; then
  dossier="${2:-}"
  [ -n "$dossier" ] || { echo "usage : falsifier.sh --contre-epreuves-reelles <dossier> [id …]"; exit 2; }
  [ ! -e "$dossier" ] || { echo "CONTRE-ÉPREUVES RÉELLES : $dossier existe déjà, dossier neuf exigé"; exit 2; }
  shift 2
  if [ $# -gt 0 ]; then ids="$*"; else ids="$("$racine/bin/pi-contrats" --depot "$depot" --liste-contre-epreuves-reelles | tr '\n' ' ')"; fi
  n=0; ok=0; echecs=""
  for id in $ids; do
    n=$((n + 1))
    if "$racine/bin/pi-contrats" --depot "$depot" --contre-epreuve-reelle "$id" --conserver "$dossier" > "$tmp/b.txt" 2>&1; then ok=$((ok + 1)); else echecs="$echecs $id"; fi
    sed 's/^/  /' "$tmp/b.txt"
  done
  rm -rf "$tmp"
  echo
  echo "CONTRE-ÉPREUVES RÉELLES : $n exécution(s) ; $ok conforme(s) à leurs états attendus déclarés"
  if [ "$ok" -eq "$n" ] && [ "$n" -gt 0 ]; then echo "CONTRE-ÉPREUVES RÉELLES CONFORMES"; exit 0; fi
  echo "CONTRE-ÉPREUVES RÉELLES NON CONFORMES :$echecs"
  exit 1
fi

if [ "${1:-}" = "--lecteur-item1" ]; then
  entrees="${2:-}"; dossier="${3:-}"
  [ -n "$entrees" ] && [ -n "$dossier" ] || { echo "usage : falsifier.sh --lecteur-item1 <entrées> <dossier>"; exit 2; }
  [ ! -e "$dossier" ] || { echo "LECTEUR ITEM 1 : $dossier existe déjà, dossier neuf exigé"; exit 2; }
  mkdir -p "$dossier"
  interprete="$(node -e 'const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(c.simulateurs[0].interprete.chemin)' "$entrees/contexte.json")"
  (cd "$entrees" && find . -type f | LC_ALL=C sort | sed 's|^\./||' | while read -r f; do sha256sum "$f"; done) > "$dossier/entrees.sha256"
  avant="$(sha256sum "$interprete" | cut -d' ' -f1)"
  echo "── M6.15/interprete (contrôle de lecteur, sans lancement)"
  echo "  entrées : $entrees ($(wc -l < "$dossier/entrees.sha256" | tr -d ' ') fichiers, liste conservée)"
  echo "  interprète : $interprete ; SHA-256 avant les contrôles : $avant"
  "$racine/bin/pi-contrats" --depot "$depot" --lecteur-interprete "$entrees" --resultat "$dossier/controle-inchange.json" > "$tmp/c0.txt" 2>&1; echo "$?" > "$dossier/controle-inchange.rc"
  "$racine/bin/pi-contrats" --depot "$depot" --lecteur-interprete "$entrees" --alterer --resultat "$dossier/controle-altere.json" > "$tmp/c1.txt" 2>&1; echo "$?" > "$dossier/controle-altere.rc"
  sed 's/^/  contrôle inchangé │ /' "$tmp/c0.txt"; sed 's/^/  contrôle altéré   │ /' "$tmp/c1.txt"
  diff "$dossier/controle-inchange.json.contexte.json" "$dossier/controle-altere.json.contexte.json" > "$dossier/alteration-contexte.diff"
  copie="$tmp/copie"
  copier_depot "$copie"
  sites=0
  for f in "$copie"/tests/pi-contrats/*.ts; do
    c=$(perl -0777 -ne '$n = () = /\breleve\(\s*"M6\.15\/interprete",/g; print $n' "$f")
    sites=$((sites + c))
    perl -0777 -pi -e 's/\breleve\((\s*)"M6\.15\/interprete",/ignorer($1"M6.15\/interprete",/g' "$f"
  done
  (cd "$tmp" && diff -r "$racine/tests/pi-contrats" "copie/tests/pi-contrats") > "$dossier/mutant.diff"
  lignes_changees=$(grep -c '^>' "$dossier/mutant.diff")
  # La copie est servie à la place du harnais d'origine, pour son URL (substituer-harnais.mjs) :
  # l'analyse garde la racine d'instrument de l'exécution. Témoin : la même substitution avec une
  # copie non mutée doit redonner exactement les résultats du contrôle.
  temoin_copie="$tmp/harnais-temoin.ts"; cp "$racine/tests/pi-contrats/harnais.ts" "$temoin_copie"
  substituer() { # $1 copie servie, $2 témoin du nombre de substitutions, puis les arguments
    copie_servie="$1"; compte="$2"; shift 2
    PI_CONTRATS_HARNAIS_COPIE="$copie_servie" PI_CONTRATS_HARNAIS_CIBLE="$racine/tests/pi-contrats/harnais.ts" PI_CONTRATS_SUBSTITUTION_TEMOIN="$compte" \
      node --import "$racine/tests/pi-contrats/substituer-harnais.mjs" "$racine/bin/pi-contrats" --depot "$depot" "$@"
  }
  substituer "$temoin_copie" "$dossier/temoin-altere.substitutions" --lecteur-interprete "$entrees" --alterer --resultat "$dossier/temoin-altere.json" > "$tmp/t1.txt" 2>&1; echo "$?" > "$dossier/temoin-altere.rc"
  substituer "$temoin_copie" "$dossier/temoin-inchange.substitutions" --lecteur-interprete "$entrees" --resultat "$dossier/temoin-inchange.json" > "$tmp/t0.txt" 2>&1; echo "$?" > "$dossier/temoin-inchange.rc"
  substituer "$copie/tests/pi-contrats/harnais.ts" "$dossier/mutant-altere.substitutions" --lecteur-interprete "$entrees" --alterer --resultat "$dossier/mutant-altere.json" > "$tmp/m1.txt" 2>&1; echo "$?" > "$dossier/mutant-altere.rc"
  substituer "$copie/tests/pi-contrats/harnais.ts" "$dossier/mutant-inchange.substitutions" --lecteur-interprete "$entrees" --resultat "$dossier/mutant-inchange.json" > "$tmp/m0.txt" 2>&1; echo "$?" > "$dossier/mutant-inchange.rc"
  sed 's/^/  témoin altéré     │ /' "$tmp/t1.txt"; sed 's/^/  témoin inchangé   │ /' "$tmp/t0.txt"
  sed 's/^/  mutant altéré     │ /' "$tmp/m1.txt"; sed 's/^/  mutant inchangé   │ /' "$tmp/m0.txt"
  substitutions="$(cat "$dossier/temoin-altere.substitutions" "$dossier/temoin-inchange.substitutions" "$dossier/mutant-altere.substitutions" "$dossier/mutant-inchange.substitutions" 2>/dev/null | tr '\n' ' ')"
  apres="$(sha256sum "$interprete" | cut -d' ' -f1)"
  printf 'avant %s\naprès %s\n' "$avant" "$apres" > "$dossier/interprete.sha256.txt"
  v="$(node -e '
const fs = require("node:fs");
const lire = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const d = process.argv[1], sites = Number(process.argv[2]), lignes = Number(process.argv[3]), avant = process.argv[4], apres = process.argv[5];
const substitutions = process.argv[6].trim().split(/\s+/).map(Number);
const c0 = lire(d + "/controle-inchange.json"), c1 = lire(d + "/controle-altere.json");
const t0 = lire(d + "/temoin-inchange.json"), t1 = lire(d + "/temoin-altere.json");
const m0 = lire(d + "/mutant-inchange.json"), m1 = lire(d + "/mutant-altere.json");
const propre = (r) => r && !r.erreur && Array.isArray(r.constats);
const visé = (r) => propre(r) && r.constats.length === 1 && r.constats[0].id === "M6.15/interprete" && r.constats[0].etat === "INVALIDE"
  && r.constats[0].detail.includes(r.interprete.simulateur) && r.constats[0].detail.includes(r.interprete.chemin)
  && r.interprete.sha256Declare !== r.interprete.sha256Reel;
const memes = (x, y) => propre(x) && propre(y) && JSON.stringify(x.constats) === JSON.stringify(y.constats) && JSON.stringify(x.resume) === JSON.stringify(y.resume);
const controle = propre(c0) && c0.constats.length === 0 && c0.interprete.sha256Declare === c0.interprete.sha256Reel && visé(c1)
  && memes(t0, c0) && memes(t1, c1) ? "CONFORME" : "ÉCHEC";
let mutant;
if (substitutions.length !== 4 || substitutions.some((n) => n !== 1)) mutant = "CASSÉ (substitutions " + substitutions.join(",") + ")";
else if (sites !== 1 || lignes !== 1) mutant = "INERTE OU ÉTENDU (" + sites + " site(s), " + lignes + " ligne(s) changée(s))";
else if (!propre(m1) || !propre(m0)) mutant = "CASSÉ";
else if (m1.constats.length === 0 && m0.constats.length === 0) mutant = "MORD";
else if (m1.constats.some((x) => x.id === "M6.15/interprete")) mutant = "SURVIT";
else mutant = "NON PROUVÉ (" + [...m1.constats, ...m0.constats].map((x) => x.etat + " " + x.id).join(", ") + ")";
const node = avant === apres ? "inchangé" : "MODIFIÉ";
process.stdout.write([controle, mutant, node].join("\t") + "\n");
' "$dossier" "$sites" "$lignes_changees" "$avant" "$apres" "$substitutions")"
  controle="$(printf '%s' "$v" | cut -f1)"; mutant="$(printf '%s' "$v" | cut -f2)"; node_etat="$(printf '%s' "$v" | cut -f3)"
  echo "  interprète : SHA-256 après les contrôles : $apres ($node_etat)"
  echo "  mutant : $sites site(s) désarmé(s), $lignes_changees ligne(s) changée(s) ; diff conservé ; substitutions du harnais (témoin ×2, mutant ×2) : $substitutions"
  echo "  VERDICT  │ contrôle $controle ; mutant $mutant"
  rm -rf "$tmp"
  echo
  ok=0; [ "$controle" = "CONFORME" ] && [ "$mutant" = "MORD" ] && [ "$node_etat" = "inchangé" ] && ok=1
  echo "LECTEUR ITEM 1 : 1 contrôle(s) de lecteur ; $([ "$controle" = "CONFORME" ] && echo 1 || echo 0) conforme(s) ; $([ "$mutant" = "MORD" ] && echo 1 || echo 0) mutant(s) qui mordent ; interprète $node_etat"
  if [ "$ok" -eq 1 ]; then echo "LECTEUR ITEM 1 CONFORME"; exit 0; fi
  echo "LECTEUR ITEM 1 NON CONFORME"
  exit 1
fi

if [ "${1:-}" = "--mutants-verificateurs" ]; then
  dossiers="${2:-}"
  [ -n "$dossiers" ] || { echo "usage : falsifier.sh --mutants-verificateurs <dossiers> [id …]"; exit 2; }
  shift 2
  liste="$("$racine/bin/pi-contrats" --depot "$depot" --liste-mutants-verificateurs)"
  if [ $# -gt 0 ]; then liste="$(for id in "$@"; do printf '%s\n' "$liste" | awk -F'\t' -v id="$id" '$1 == id'; done)"; fi
  copie="$tmp/copie"
  n=0; mordent=0; echecs=""
  while IFS="$(printf '\t')" read -r id nature cible; do
    [ -n "$id" ] || continue
    n=$((n + 1))
    echo "── mutant de vérificateur $id ($nature) : garde $cible"
    rm -f "$tmp/c.json" "$tmp/m.json"
    "$racine/bin/pi-contrats" --depot "$depot" --reevaluer "$dossiers" "$id" --resultat "$tmp/c.json" > /dev/null 2> "$tmp/c.err"
    copier_depot "$copie"
    sites=$(grep -c 'const DESARMEES: ReadonlySet<string> = new Set<string>(\[\]);' "$copie/tests/pi-contrats/scenarios.ts")
    CIBLE="$cible" perl -pi -e 's/(const DESARMEES: ReadonlySet<string> = new Set<string>\()\[\](\);)/$1\["$ENV{CIBLE}"\]$2/' "$copie/tests/pi-contrats/scenarios.ts"
    "$copie/bin/pi-contrats" --depot "$depot" --reevaluer "$dossiers" "$id" --resultat "$tmp/m.json" > /dev/null 2> "$tmp/m.err"
    v="$(node -e '
const fs = require("node:fs");
const lire = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const c = lire(process.argv[1]), m = lire(process.argv[2]), sites = Number(process.argv[3]);
const controle = c && c.etat === c.attendu && c.nominal === "satisfait" ? "CONFORME" : "ÉCHEC";
let mutant;
if (sites !== 1) mutant = "INERTE";
else if (!m) mutant = "CASSÉ";
else if (m.etat === "satisfait" && m.nominal === "satisfait") mutant = "MORD";
else if (m.etat === (c && c.attendu)) mutant = "SURVIT";
else mutant = "NON PROUVÉ (" + m.etat + ", nominal " + m.nominal + ")";
process.stdout.write([controle, mutant, c ? c.etat + "/" + c.attendu + " nominal " + c.nominal + " — " + String(c.motif).slice(0, 200) : "—", m ? m.etat + " nominal " + m.nominal : "—"].join("\t") + "\n");
' "$tmp/c.json" "$tmp/m.json" "$sites")"
    controle="$(printf '%s' "$v" | cut -f1)"; mutant="$(printf '%s' "$v" | cut -f2)"
    echo "  contrôle │ $(printf '%s' "$v" | cut -f3)"
    echo "  mutant   │ $(printf '%s' "$v" | cut -f4)"
    echo "  VERDICT  │ contrôle $controle ; mutant $mutant"
    if [ "$controle" = "CONFORME" ] && [ "$mutant" = "MORD" ]; then mordent=$((mordent + 1)); else echecs="$echecs $id"; fi
  done <<LISTE
$liste
LISTE
  rm -rf "$tmp"
  echo
  echo "MUTANTS DES VÉRIFICATEURS : $n mutant(s) ; $mordent contrôle(s) conforme(s) et mutant(s) qui mordent"
  if [ "$mordent" -eq "$n" ] && [ "$n" -gt 0 ]; then echo "MUTANTS DES VÉRIFICATEURS CONFORMES"; exit 0; fi
  echo "MUTANTS DES VÉRIFICATEURS NON CONFORMES :$echecs"
  exit 1
fi

if [ "${1:-}" = "--n5" ] || [ "${1:-}" = "--n5-selection-base" ]; then
  mode_n5="$1"
  [ -n "$tmp" ] && [ -d "$tmp" ] && [ ! -L "$tmp" ] || { echo "ARRÊT — N5 : temporaire non établi" >&2; exit 3; }
  dossier="${2:-}"
  [ -n "$dossier" ] || { echo "usage : falsifier.sh --depot <d> $mode_n5 <dossier neuf>"; exit 2; }
  [ ! -e "$dossier" ] && [ ! -L "$dossier" ] || { echo "N5 : $dossier existe déjà, dossier neuf exigé"; exit 2; }
  mkdir -p "$dossier" || { echo "ARRÊT — N5 : création du dossier impossible"; exit 3; }
  bin="$racine/bin/pi-contrats"
  echecs=""; n=0; ok=0
  # Verdict JSON d'un résultat : jq absent, node seul.
  champ() { node -e 'const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), r); process.stdout.write(typeof v === "string" ? v : JSON.stringify(v ?? null));' "$1" "$2" 2>/dev/null || printf 'ILLISIBLE'; }
  arret_n5() { echo "ARRÊT — N5 : $* ; suite non exécutée ; pièces conservées dans $dossier ; temporaire conservé $tmp" >&2; exit 3; }
  exiger_code_n5() { [ "$(cat "$1")" = "$2" ] || arret_n5 "code $(cat "$1") au lieu de $2 : $1"; }
  copier_instrument() {
    case "$1" in "$tmp/"*) ;; *) arret_n5 "copie hors du temporaire contrôlé : $1" ;; esac
    [ ! -e "$1" ] && [ ! -L "$1" ] || arret_n5 "copie préexistante : $1"
    mkdir "$1" || arret_n5 "création de la copie : $1"
    (set -o pipefail; (cd "$racine" && tar cf - --exclude=.git .) | (cd "$1" && tar xf -)) || arret_n5 "copie de l'instrument : $1"
    cmp -s "$racine/tests/pi-contrats/harnais.ts" "$1/tests/pi-contrats/harnais.ts" || arret_n5 "harnais copié différent"
  }
  bilan() { n=$((n + 1)); echo "  VERDICT  │ $1 : $2"; if [ "$2" = "CONFORME" ] || [ "$2" = "MORD" ]; then ok=$((ok + 1)); else arret_n5 "$1 : $2"; fi; }

  if [ "$mode_n5" = "--n5-selection-base" ]; then
    echo "── r5-base : le mode base n'appelle que G-I1-base (dépôt $depot)"
    "$bin" --depot "$depot" --selection-n5 r5-base --resultat "$dossier/r5-base.json" > "$dossier/r5-base.txt" 2>&1; echo "$?" > "$dossier/r5-base.rc"
    exiger_code_n5 "$dossier/r5-base.rc" 0
    sed 's/^/  /' "$dossier/r5-base.txt"
    v="ÉCHEC"; [ "$(cat "$dossier/r5-base.rc")" = "0" ] && [ "$(champ "$dossier/r5-base.json" refus)" = "null" ] && [ "$(champ "$dossier/r5-base.json" appels)" = '["G-I1-base"]' ] && [ "$(champ "$dossier/r5-base.json" tentatives)" = "0" ] && v="CONFORME"
    bilan r5-base "$v"
  else
    liste="$("$bin" --depot "$depot" --liste-refus-n5)" || { echo "N5 INDÉTERMINÉ : liste des cas illisible"; exit 3; }
    [ -n "$liste" ] || { echo "N5 INDÉTERMINÉ : aucun cas"; exit 3; }
    printf '%s\n' "$liste" > "$dossier/cas.tsv"
    i=0
    while IFS="$(printf '\t')" read -r id regle clauses; do
      [ -n "$id" ] || continue
      i=$((i + 1)); k="$(printf '%02d' "$i")"
      echo "── $id : premier refus d'intégration attendu $regle ; clauses déclarées $clauses"
      "$bin" --depot "$depot" --refus-n5 "$id" --resultat "$dossier/$k-integration.json" > "$dossier/$k-integration.txt" 2>&1; echo "$?" > "$dossier/$k-integration.rc"
      exiger_code_n5 "$dossier/$k-integration.rc" 0
      sed 's/^/  intégration │ /' "$dossier/$k-integration.txt"
      v="ÉCHEC"; [ "$(champ "$dossier/$k-integration.json" lancementTente)" = "false" ] && [ "$(champ "$dossier/$k-integration.json" refus.id)" = "$regle" ] && [ "$(champ "$dossier/$k-integration.json" appels)" = '["G-N5"]' ] && [ "$(champ "$dossier/$k-integration.json" tentatives)" = "1" ] && v="CONFORME"
      bilan "$id/intégration" "$v"
      for clause in $(printf '%s' "$clauses" | tr ',' ' '); do
        c="$dossier/$k-$clause"
        "$bin" --depot "$depot" --lecteur-n5 "$id" "$clause" --resultat "$c-controle.json" --conserver "$c-controle-etats" > "$c-controle.txt" 2>&1; echo "$?" > "$c-controle.rc"
        exiger_code_n5 "$c-controle.rc" 0
        sed 's/^/  local controle │ /' "$c-controle.txt"
        t="$(champ "$c-controle.json" temoin)"; a="$(champ "$c-controle.json" altere)"
        v="ÉCHEC"; [ "$(champ "$c-controle.json" tentatives)" = "0" ] && [ "$t" = "satisfait" ] && case "$a" in "refus G-N5/$clause "*) v="CONFORME" ;; esac
        bilan "$id/$clause/contrôle" "$v"
        copie="$tmp/copie-$k-$clause"; copier_instrument "$copie"
        sites=$(CLAUSE="G-N5/$clause" perl -0777 -ne '$n = () = /\brefuser\(\s*"\Q$ENV{CLAUSE}\E",/g; print $n' "$copie/tests/pi-contrats/harnais.ts")
        [ "$sites" = "1" ] || arret_n5 "site de mutation non unique : $sites"
        CLAUSE="G-N5/$clause" perl -0777 -pi -e 's/\brefuser\((\s*)"\Q$ENV{CLAUSE}\E",/ignorer($1"$ENV{CLAUSE}",/g' "$copie/tests/pi-contrats/harnais.ts" || arret_n5 "mutation impossible"
        diff -u "$racine/tests/pi-contrats/harnais.ts" "$copie/tests/pi-contrats/harnais.ts" > "$c-mutant.diff"
        rc_diff=$?
        [ "$rc_diff" = "1" ] || arret_n5 "diff du mutant : code $rc_diff au lieu de 1"
        "$copie/bin/pi-contrats" --depot "$depot" --lecteur-n5 "$id" "$clause" --resultat "$c-mutant.json" --conserver "$c-mutant-etats" > "$c-mutant.txt" 2>&1; echo "$?" > "$c-mutant.rc"
        exiger_code_n5 "$c-mutant.rc" 0
        sed 's/^/  local mutant   │ /' "$c-mutant.txt"
        t="$(champ "$c-mutant.json" temoin)"; a="$(champ "$c-mutant.json" altere)"
        [ "$(champ "$c-mutant.json" tentatives)" = "0" ] || arret_n5 "lecteur mutant : appel de tenter"
        if [ "$sites" != "1" ]; then v="INERTE OU ÉTENDU ($sites site(s))"
        elif [ "$t" != "satisfait" ]; then v="CASSÉ (témoin : $t)"
        else case "$a" in satisfait|"admis (relevé désarmé)") v="MORD" ;; "refus G-N5/$clause "*) v="SURVIT" ;; *) v="NON PROUVÉ ($a)" ;; esac
        fi
        bilan "$id/$clause/mutant" "$v"
      done
    done <<LISTE
$liste
LISTE

    echo "── r1 : arbre faux ou absent, code 2, harnais non chargé"
    copie="$tmp/r1"; copier_instrument "$copie"
    printf 'throw new Error("HARNAIS CHARGÉ (r1)");\n' > "$copie/tests/pi-contrats/harnais.ts"
    "$copie/bin/pi-contrats" --depot "$depot" --qualifier-candidat 0000000000000000000000000000000000000000 > "$dossier/r1-faux.txt" 2>&1; echo "$?" > "$dossier/r1-faux.rc"
    exiger_code_n5 "$dossier/r1-faux.rc" 2
    ! grep -q "HARNAIS CHARGÉ" "$dossier/r1-faux.txt" || arret_n5 "r1 : harnais chargé"
    "$copie/bin/pi-contrats" --depot "$depot" --qualifier-candidat > "$dossier/r1-absent.txt" 2>&1; echo "$?" > "$dossier/r1-absent.rc"
    exiger_code_n5 "$dossier/r1-absent.rc" 2
    ! grep -q "HARNAIS CHARGÉ" "$dossier/r1-absent.txt" || arret_n5 "r1 : harnais chargé"
    sed 's/^/  r1 faux   │ /' "$dossier/r1-faux.txt"; sed 's/^/  r1 absent │ /' "$dossier/r1-absent.txt"
    v="ÉCHEC"; [ "$(cat "$dossier/r1-faux.rc")" = "2" ] && [ "$(cat "$dossier/r1-absent.rc")" = "2" ] && ! grep -q "HARNAIS CHARGÉ" "$dossier/r1-faux.txt" "$dossier/r1-absent.txt" && v="CONFORME"
    bilan r1 "$v"

    echo "── r2 : qualification candidate, index altéré dans une copie neuve : refus G-N5/index, aucune tentative"
    "$bin" --depot "$depot" --selection-n5 r2 --resultat "$dossier/r2.json" > "$dossier/r2.txt" 2>&1; echo "$?" > "$dossier/r2.rc"
    exiger_code_n5 "$dossier/r2.rc" 0
    sed 's/^/  /' "$dossier/r2.txt"
    v="ÉCHEC"; [ "$(champ "$dossier/r2.json" refus)" = "G-N5/index" ] && [ "$(champ "$dossier/r2.json" appels)" = '["G-N5"]' ] && [ "$(champ "$dossier/r2.json" tentatives)" = "0" ] && v="CONFORME"
    bilan r2 "$v"

    echo "── r3 : mutant de sélection (G-N5 remplacée par G-I1-base), même entrée : motif G-I1-base/suivis"
    copie="$tmp/r3"; copier_instrument "$copie"
    sites=$(perl -0777 -ne '$n = () = /\? verifierCandidat\(c!\) :/g; print $n' "$copie/tests/pi-contrats/harnais.ts")
    [ "$sites" = "1" ] || arret_n5 "site de mutation non unique : $sites"
    perl -0777 -pi -e 's/\? verifierCandidat\(c!\) :/? verifierBase(c!.depot) :/g' "$copie/tests/pi-contrats/harnais.ts" || arret_n5 "mutation impossible"
    (cd "$tmp" && diff -u "$racine/tests/pi-contrats/harnais.ts" "r3/tests/pi-contrats/harnais.ts") > "$dossier/r3-mutant.diff"
    rc_diff=$?
    [ "$rc_diff" = "1" ] || arret_n5 "diff du mutant : code $rc_diff au lieu de 1"
    "$copie/bin/pi-contrats" --depot "$depot" --selection-n5 r2 --resultat "$dossier/r3.json" > "$dossier/r3.txt" 2>&1; echo "$?" > "$dossier/r3.rc"
    exiger_code_n5 "$dossier/r3.rc" 0
    sed 's/^/  /' "$dossier/r3.txt"
    v="ÉCHEC"; [ "$sites" = "1" ] && [ "$(champ "$dossier/r3.json" refus)" = "G-I1-base/suivis" ] && [ "$(champ "$dossier/r3.json" appels)" = '["G-I1-base"]' ] && [ "$(champ "$dossier/r3.json" tentatives)" = "0" ] && v="CONFORME"
    bilan r3 "$v"

    echo "── r4 : choix du dépôt absent, non canonique, second choix, lecture avant choix"
    "$bin" --liste-refus-n5 > "$dossier/r4-absent.txt" 2>&1; echo "$?" > "$dossier/r4-absent.rc"
    exiger_code_n5 "$dossier/r4-absent.rc" 2
    "$bin" --depot "relatif/depot" --liste-refus-n5 > "$dossier/r4-relatif.txt" 2>&1; echo "$?" > "$dossier/r4-relatif.rc"
    exiger_code_n5 "$dossier/r4-relatif.rc" 2
    node --experimental-strip-types -e '
import(process.argv[1]).then((h) => {
  h.choisirDepot(process.argv[2]);
  try { h.choisirDepot(process.argv[2]); console.log("SECOND CHOIX ADMIS"); } catch (e) { console.log("second choix refusé : " + e.message); }
});' "$racine/tests/pi-contrats/harnais.ts" "$depot" > "$dossier/r4-second.txt" 2>&1; echo "$?" > "$dossier/r4-second.rc"
    exiger_code_n5 "$dossier/r4-second.rc" 0
    grep -q "^second choix refusé : " "$dossier/r4-second.txt" || arret_n5 "r4 : second choix admis"
    node --experimental-strip-types -e '
import(process.argv[1]).then((h) => {
  try { h.verifierBase(); console.log("LECTURE ADMISE AVANT CHOIX"); } catch (e) { console.log("lecture avant choix refusée : " + e.message + " ; gardes appelées : " + (h.appelsGardes.join(",") || "aucune")); }
});' "$racine/tests/pi-contrats/harnais.ts" > "$dossier/r4-avant.txt" 2>&1; echo "$?" > "$dossier/r4-avant.rc"
    exiger_code_n5 "$dossier/r4-avant.rc" 0
    grep -q "^lecture avant choix refusée : dépôt non choisi" "$dossier/r4-avant.txt" && grep -q "gardes appelées : aucune" "$dossier/r4-avant.txt" || arret_n5 "r4 : lecture avant choix non refusée"
    for f in absent relatif second avant; do sed "s/^/  r4 $f │ /" "$dossier/r4-$f.txt"; done
    v="ÉCHEC"; [ "$(cat "$dossier/r4-absent.rc")" = "2" ] && [ "$(cat "$dossier/r4-relatif.rc")" = "2" ] && grep -q "^second choix refusé : " "$dossier/r4-second.txt" && grep -q "^lecture avant choix refusée : dépôt non choisi" "$dossier/r4-avant.txt" && grep -q "gardes appelées : aucune" "$dossier/r4-avant.txt" && v="CONFORME"
    bilan r4 "$v"

    echo "── r5-candidat : le mode candidat n'appelle que G-N5"
    "$bin" --depot "$depot" --selection-n5 r5-candidat --resultat "$dossier/r5-candidat.json" > "$dossier/r5-candidat.txt" 2>&1; echo "$?" > "$dossier/r5-candidat.rc"
    exiger_code_n5 "$dossier/r5-candidat.rc" 0
    sed 's/^/  /' "$dossier/r5-candidat.txt"
    v="ÉCHEC"; [ "$(champ "$dossier/r5-candidat.json" refus)" = "null" ] && [ "$(champ "$dossier/r5-candidat.json" appels)" = '["G-N5"]' ] && [ "$(champ "$dossier/r5-candidat.json" tentatives)" = "0" ] && v="CONFORME"
    bilan r5-candidat "$v"
  fi
  rm -rf "$tmp"
  echo
  echo "N5 ($mode_n5) : $n verdict(s) ; $ok conforme(s) ou mutant(s) qui mordent"
  if [ -z "$echecs" ] && [ "$ok" -eq "$n" ] && [ "$n" -gt 0 ]; then echo "N5 CONFORME"; exit 0; fi
  echo "N5 NON CONFORME :$echecs"
  exit 1
fi

liste_mode="--liste-refus"
if [ "${1:-}" = "--item1" ]; then
  liste_mode="--liste-refus-item1"
  shift
fi

if [ $# -gt 0 ]; then
  liste="$(for id in "$@"; do "$racine/bin/pi-contrats" --depot "$depot" "$liste_mode" | awk -F'\t' -v id="$id" '$1 == id'; done)"
else
  liste="$("$racine/bin/pi-contrats" --depot "$depot" "$liste_mode")"
fi
[ -n "$liste" ] || { echo "FALSIFICATION INDÉTERMINÉE : aucune épreuve"; exit 2; }

# Verdict structuré : contrôle et mutant, en JSON.
verdict() {
  node -e '
const fs = require("node:fs");
const lire = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const c = lire(process.argv[1]), m = lire(process.argv[2]), sites = Number(process.argv[3]);
const ids = (r) => new Set((r?.constats ?? []).map((x) => x.id));
let controle = "ÉCHEC", mutant = "CASSÉ", ulterieur = "—";
if (c) {
  const ok = c.moment === "avant" || c.moment === "lecteur"
    ? !c.lancementTente && c.refus?.id === c.regle
    : c.lancementTente && !c.refus && !c.erreur && (c.constats ?? []).some((x) => x.id === c.regle);
  controle = ok ? "CONFORME" : "ÉCHEC";
}
if (sites === 0) mutant = "INERTE";
else if (!m) mutant = "CASSÉ";
else if (m.erreur && !m.erreur.apresLancement) mutant = "CASSÉ";
else if (m.moment === "lecteur") mutant = m.refus ? "MASQUÉ" : "MORD";
else if (m.refus) mutant = "MASQUÉ";
else if (!m.lancementTente) mutant = "CASSÉ";
else if (m.moment === "avant") {
  mutant = "MORD";
  const propre = !m.erreur && m.rc === 0 && (m.constats ?? []).length === 0;
  ulterieur = propre ? "qualifiée" : "non qualifiée (" + [m.erreur ? "erreur " + m.erreur.message : null, "sortie " + m.rc, ...(m.constats ?? []).map((x) => x.etat + " " + x.id)].filter(Boolean).join(", ") + ")";
} else {
  const cm = ids(m), cc = ids(c);
  const nouveaux = [...cm].filter((x) => x !== m.regle && !cc.has(x));
  if (m.erreur) mutant = "CASSÉ";
  else if (cm.has(m.regle)) mutant = "SURVIT";
  else if (nouveaux.length) mutant = "MASQUÉ par " + nouveaux.join(", ");
  else mutant = "MORD";
}
process.stdout.write([controle, mutant, ulterieur].join("\t") + "\n");
' "$1" "$2" "$3"
}

n=0; controles=0; mordent=0; nonqualifies=0
echecs=""
while IFS="$(printf '\t')" read -r id regle; do
  [ -n "$id" ] || continue
  n=$((n + 1))
  echo "── $id (règle $regle)"
  rm -f "$tmp/controle.json" "$tmp/mutant.json"
  "$racine/bin/pi-contrats" --depot "$depot" --refus "$id" --resultat "$tmp/controle.json" > "$tmp/controle.txt" 2>&1
  sed 's/^/  contrôle │ /' "$tmp/controle.txt"

  copie="$tmp/copie"
  rm -rf "$copie" && mkdir "$copie"
  (cd "$racine" && tar cf - --exclude=.git .) | (cd "$copie" && tar xf -)
  sites=0
  for f in "$copie"/tests/pi-contrats/*.ts; do
    # Un appel peut s'étendre sur plusieurs lignes : `refuser(` puis l'identifiant à la ligne suivante.
    c=$(REGLE="$regle" perl -0777 -ne '$n = () = /\b(?:refuser|releve)\(\s*"\Q$ENV{REGLE}\E",/g; print $n' "$f")
    sites=$((sites + c))
    REGLE="$regle" perl -0777 -pi -e 's/\b(?:refuser|releve)\((\s*)"\Q$ENV{REGLE}\E",/ignorer($1"$ENV{REGLE}",/g' "$f"
  done
  if [ "$sites" -gt 0 ]; then
    "$copie/bin/pi-contrats" --depot "$depot" --refus "$id" --resultat "$tmp/mutant.json" > "$tmp/mutant.txt" 2>&1
    sed 's/^/  mutant   │ /' "$tmp/mutant.txt"
  fi
  v="$(verdict "$tmp/controle.json" "$tmp/mutant.json" "$sites")"
  controle="$(printf '%s' "$v" | cut -f1)"; mutant="$(printf '%s' "$v" | cut -f2)"; ulterieur="$(printf '%s' "$v" | cut -f3)"
  echo "  VERDICT  │ contrôle $controle ; mutant ($sites site(s) désarmé(s)) $mutant ; exécution ultérieure du mutant : $ulterieur"
  [ "$controle" = "CONFORME" ] && controles=$((controles + 1)) || echecs="$echecs $id:contrôle"
  case "$mutant" in
    MORD) mordent=$((mordent + 1)) ;;
    *) echecs="$echecs $id:mutant-$(printf '%s' "$mutant" | cut -d' ' -f1)" ;;
  esac
  case "$ulterieur" in "non qualifiée"*) nonqualifies=$((nonqualifies + 1)) ;; esac
done <<LISTE
$liste
LISTE

rm -rf "$tmp"
echo
echo "FALSIFICATION : $n épreuve(s) ; $controles contrôle(s) conforme(s) ; $mordent mutant(s) qui mordent (preuve locale de garde) ; $nonqualifies exécution(s) ultérieure(s) de mutant non qualifiée(s), imprimées ci-dessus"
if [ -z "$echecs" ] && [ "$controles" -eq "$n" ] && [ "$mordent" -eq "$n" ]; then
  echo "FALSIFICATION CONFORME"
  exit 0
fi
echo "FALSIFICATION NON CONFORME :$echecs"
exit 1
