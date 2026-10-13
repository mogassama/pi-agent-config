#!/usr/bin/env bash
#
# falsifier.sh — épreuves des refus d'identité et d'isolement (M2, M6), avec leurs mutants.
#
#   tests/pi-contrats/falsifier.sh            toutes les épreuves
#   tests/pi-contrats/falsifier.sh M2.3/v20   une seule
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
tmp="$(mktemp -d "${TMPDIR:-/tmp}/falsifier.XXXXXX")"
# G-I1-base : les épreuves clonent le dépôt d'origine, y compris depuis la copie mutée (sans .git).
export PI_CONTRATS_DEPOT_GIT="$racine"

copier_depot() {
  rm -rf "$1" && mkdir "$1"
  (cd "$racine" && tar cf - --exclude=.git .) | (cd "$1" && tar xf -)
}

if [ "${1:-}" = "--contre-epreuves-reelles" ]; then
  dossier="${2:-}"
  [ -n "$dossier" ] || { echo "usage : falsifier.sh --contre-epreuves-reelles <dossier> [id …]"; exit 2; }
  [ ! -e "$dossier" ] || { echo "CONTRE-ÉPREUVES RÉELLES : $dossier existe déjà, dossier neuf exigé"; exit 2; }
  shift 2
  if [ $# -gt 0 ]; then ids="$*"; else ids="$("$racine/bin/pi-contrats" --liste-contre-epreuves-reelles | tr '\n' ' ')"; fi
  n=0; ok=0; echecs=""
  for id in $ids; do
    n=$((n + 1))
    if "$racine/bin/pi-contrats" --contre-epreuve-reelle "$id" --conserver "$dossier" > "$tmp/b.txt" 2>&1; then ok=$((ok + 1)); else echecs="$echecs $id"; fi
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
  "$racine/bin/pi-contrats" --lecteur-interprete "$entrees" --resultat "$dossier/controle-inchange.json" > "$tmp/c0.txt" 2>&1; echo "$?" > "$dossier/controle-inchange.rc"
  "$racine/bin/pi-contrats" --lecteur-interprete "$entrees" --alterer --resultat "$dossier/controle-altere.json" > "$tmp/c1.txt" 2>&1; echo "$?" > "$dossier/controle-altere.rc"
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
      node --import "$racine/tests/pi-contrats/substituer-harnais.mjs" "$racine/bin/pi-contrats" "$@"
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
  liste="$("$racine/bin/pi-contrats" --liste-mutants-verificateurs)"
  if [ $# -gt 0 ]; then liste="$(for id in "$@"; do printf '%s\n' "$liste" | awk -F'\t' -v id="$id" '$1 == id'; done)"; fi
  copie="$tmp/copie"
  n=0; mordent=0; echecs=""
  while IFS="$(printf '\t')" read -r id nature cible; do
    [ -n "$id" ] || continue
    n=$((n + 1))
    echo "── mutant de vérificateur $id ($nature) : garde $cible"
    rm -f "$tmp/c.json" "$tmp/m.json"
    "$racine/bin/pi-contrats" --reevaluer "$dossiers" "$id" --resultat "$tmp/c.json" > /dev/null 2> "$tmp/c.err"
    copier_depot "$copie"
    sites=$(grep -c 'const DESARMEES: ReadonlySet<string> = new Set<string>(\[\]);' "$copie/tests/pi-contrats/scenarios.ts")
    CIBLE="$cible" perl -pi -e 's/(const DESARMEES: ReadonlySet<string> = new Set<string>\()\[\](\);)/$1\["$ENV{CIBLE}"\]$2/' "$copie/tests/pi-contrats/scenarios.ts"
    "$copie/bin/pi-contrats" --reevaluer "$dossiers" "$id" --resultat "$tmp/m.json" > /dev/null 2> "$tmp/m.err"
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

liste_mode="--liste-refus"
if [ "${1:-}" = "--item1" ]; then
  liste_mode="--liste-refus-item1"
  shift
fi

if [ $# -gt 0 ]; then
  liste="$(for id in "$@"; do "$racine/bin/pi-contrats" "$liste_mode" | awk -F'\t' -v id="$id" '$1 == id'; done)"
else
  liste="$("$racine/bin/pi-contrats" "$liste_mode")"
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
  "$racine/bin/pi-contrats" --refus "$id" --resultat "$tmp/controle.json" > "$tmp/controle.txt" 2>&1
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
    "$copie/bin/pi-contrats" --refus "$id" --resultat "$tmp/mutant.json" > "$tmp/mutant.txt" 2>&1
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
