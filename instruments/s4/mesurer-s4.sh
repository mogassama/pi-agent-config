#!/usr/bin/env bash
# mesurer-s4.sh — porte S4 : aucun diagnostic TypeScript nouveau, aucun delta non déclaré.
#
#   PI_AGENT_DIR=<dépôt mesuré> S4_SORTIE=<dossier neuf> S4_REFERENCES=<références> \
#   S4_REFERENCES_SHA256=<SHA-256 de MANIFESTE-REFERENCES.sha256> ./mesurer-s4.sh <plan>
#
#   S4_SORTIE=<dossier neuf> ./mesurer-s4.sh --constituer <plan> <dépôt contenant l'objet>
#       collecteur des références : compile le seul objet audité, canal par canal, et écrit
#       les références sous <dossier neuf>/references. Aucun arbre « après », aucun candidat.
#
# Lecture seule sur le dépôt, et c'est VÉRIFIÉ : empreintes de tous les fichiers mesurés et
# `git status --porcelain=v1 -z` sont relevés avant la contre-épreuve et comparés après.
# Tout ce qui se compile ou se mute vit sous S4_SORTIE/travail, conservé.
#
#   avant   git archive <objet>                    — l'objet audité, déclaré au plan
#   après   git archive <objet>, plus l'ensemble mesuré pris dans le WORKTREE
#
#   ensemble mesuré = fichiers L0 dérivés du dépôt ∪ S4_SCOPE ∪ S4_DOCUMENT_SCOPE
#
# DEUX CANAUX, parce qu'un seul mentait par omission :
#
#   principal       subagent-only/**/*.ts, tests/**/*.ts, extensions/**/*.ts
#   extensionless   les binaires sans extension déclarés au plan, copiés en <nom>.s4.ts
#                   dans le MÊME répertoire pour conserver les imports relatifs
#
# Historique des pannes v1 à v7 : voir mesurer-s4.sh v7 (f14ba568…), en-tête.
#
#   v8  (LOT-PI-ADAPT, adjudication 45ea4267 § 2) v7 ne pouvait conclure ni sur la base
#       b5453204 ni sur le candidat : objet f9791bd figé, documents limités aux .md, shim
#       exigé dans les deux arbres, liste de shims commune aux deux configurations, codes
#       du compilateur masqués par `|| true`, sha256sum absent du Mac, temporaire détruit
#       même après refus.
#       → objet lu d'un unique bloc S4_OBJET, sans repli ; références figées portant leur
#         provenance (objet, arbre, outillage, configuration, listes, codes), épinglées par
#         leur manifeste et reproduites par « avant » ; extensionless nouveau : absent de
#         l'objet et du programme « avant », présent et consommé dans « après » ; listes
#         `files` par arbre ; 13 chemins hors TypeScript admis nommément, sans règle
#         générale ; chaque opération du compilateur avec code brut, sorties séparées et
#         contrôle avant la suite ; SHA-256 par le Node contrôlé ; travail, caches et
#         journaux npm sous S4_SORTIE, conservés ; Git sans verrou optionnel ; aucun repli
#         sur la production pour le dépôt mesuré.
#
#   v9  (LOT-PI-ADAPT, plan correctif de l'ARRÊT M3, e5b2b498) les fragments du corpus pi-surface,
#       renommés en .ts.txt pour sortir du programme compilé, restent couverts en intégrité :
#       → neuf chemins ajoutés nommément à ADMIS_HORS_MD ; rien d'autre ne change (compilateur,
#         configuration, canaux, références, comparaison et refus identiques à v8).
#
# Même compilateur et même configuration que v7 : typescript@7.0.2 et @types/node@26.5.0
# épinglés, jetables. L'instrument se contrôle lui-même : « avant » doit reproduire à
# l'identique les références de CHAQUE canal, sinon la comparaison ne vaut rien.
set -euo pipefail
export LC_ALL=C

TS_VERSION="7.0.2"; TYPES_VERSION="26.5.0"
# Code admissible de la compilation noEmit en présence de diagnostics lisibles (adjudication
# Q-CODE 34da3473) : une constante, jamais adaptée au code observé. Ce n'est pas le verdict ;
# le code attendu de chaque canal est celui des références.
readonly S4_CODE_DIAGNOSTICS_NOEMIT=1
# Préfixes réservés à L0 (Sol, CP2). Même motif que tests/l0-lib.ts.
L0_MOTIF='^tests/(l0-[^/]+|tools/l0-[^/]+)$'
# Chemins hors TypeScript et hors .md admis dans S4_DOCUMENT_SCOPE, nommément, pour ce lot
# seul (45ea4267 § 2 ; v9 : fragments pi-surface .ts.txt). Aucune admission générale : tout autre
# chemin non .md est refusé.
ADMIS_HORS_MD='tests/fixtures/pi-adapt/references-b5453204.json
tests/fixtures/pi-adapt/transcriptions/commande-de-test.jsonl
tests/fixtures/pi-adapt/transcriptions/erreur-fournisseur.jsonl
tests/fixtures/pi-adapt/transcriptions/nominal.jsonl
tests/fixtures/pi-adapt/transcriptions/submit-refuse-puis-accepte.jsonl
tests/fixtures/pi-surface/acces-calcule.ts.txt
tests/fixtures/pi-surface/alias.ts.txt
tests/fixtures/pi-surface/ctx.ts.txt
tests/fixtures/pi-surface/destructuration.ts.txt
tests/fixtures/pi-surface/drapeau.ts.txt
tests/fixtures/pi-surface/evenement.ts.txt
tests/fixtures/pi-surface/flux.ts.txt
tests/fixtures/pi-surface/import.ts.txt
tests/fixtures/pi-surface/methode.ts.txt
tests/fixtures/pi-surface/python-cle.py
tests/pi-contrats/falsifier.sh
tests/pi-contrats/identite-0.86.0.json
tests/pi-contrats/identite-0.99.0.json
tests/pi-contrats/substituer-harnais.mjs
tests/pi-contrats/trace-resolution.mjs
tests/pi-surface.json
tests/stubs/fake-pi.mjs'

refus() {
  { echo; echo "S4 NON CONCLUANT : $*"; } >&2
  if [ -n "${T:-}" ] && [ -d "$T" ]; then find "$T" -type f | LC_ALL=C sort > "$SORTIE/INVENTAIRE-TRAVAIL.txt" || true; fi
  exit 1
}

MODE=mesure
if [ "${1:-}" = "--constituer" ]; then MODE=constitution; shift; fi
PLAN="${1:-}"
[ -n "$PLAN" ] || refus "usage : $0 [--constituer] <plan> [<dépôt>] — le périmètre se déclare dans le plan, pas à l'appel"
[ -f "$PLAN" ] || refus "plan introuvable : $PLAN"
if [ "$MODE" = constitution ]; then
  [ $# -eq 2 ] || refus "usage : $0 --constituer <plan> <dépôt contenant l'objet>"
  DEST="$2"
else
  [ $# -eq 1 ] || refus "usage : $0 <plan>"
  # Aucun repli sur ~/.pi/agent : le dépôt mesuré est toujours désigné.
  DEST="${PI_AGENT_DIR:-}"
  [ -n "$DEST" ] || refus "PI_AGENT_DIR non défini — aucun repli sur la production"
  REFS="${S4_REFERENCES:-}"; REFS_SHA="${S4_REFERENCES_SHA256:-}"
  [ -n "$REFS" ] && [ -d "$REFS" ] || refus "S4_REFERENCES absent ou non répertoire"
  [[ "$REFS_SHA" =~ ^[0-9a-f]{64}$ ]] || refus "S4_REFERENCES_SHA256 absent ou illisible — les références sont épinglées par le pilote"
fi
SORTIE="${S4_SORTIE:-}"
[ -n "$SORTIE" ] || refus "S4_SORTIE non défini"
[ ! -e "$SORTIE" ] && [ ! -L "$SORTIE" ] || refus "S4_SORTIE existe déjà — dossier neuf exigé : $SORTIE"
[ -d "$DEST/.git" ] || refus "$DEST n'est pas un dépôt git"
NODE="$(command -v node)" || refus "node introuvable"
NPM="$(command -v npm)" || refus "npm introuvable"
GIT=(git --no-optional-locks -C "$DEST")

mkdir -p "$SORTIE/travail"
# Le travail est conservé, y compris en cas de refus : aucun trap de suppression.
T="$("$NODE" -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$SORTIE/travail")"

# Outils du Node contrôlé : SHA-256 d'un fichier, vérification d'un manifeste, JSON.
cat > "$T/s4-outils.mjs" <<'MJS'
import { createHash } from "node:crypto";
import { readFileSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
const [op, ...a] = process.argv.slice(2);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
if (op === "sha256") {
  process.stdout.write(sha(a[0]) + "\n");
} else if (op === "verifier-manifeste") {
  // <dossier> <manifeste> : chaque ligne « <sha>  <chemin> », triée, fichiers ordinaires,
  // ensemble exact du dossier hors manifeste.
  const [dir, man] = a;
  const lignes = readFileSync(join(dir, man), "utf8").split("\n").filter(Boolean);
  const chemins = [];
  for (const l of lignes) {
    const m = /^([0-9a-f]{64})  (.+)$/.exec(l);
    if (!m) { console.log(`ligne illisible : ${l}`); process.exit(1); }
    const st = lstatSync(join(dir, m[2]), { throwIfNoEntry: false });
    if (!st || !st.isFile()) { console.log(`absent ou non ordinaire : ${m[2]}`); process.exit(1); }
    if (sha(join(dir, m[2])) !== m[1]) { console.log(`empreinte différente : ${m[2]}`); process.exit(1); }
    chemins.push(m[2]);
  }
  const trie = [...chemins].sort((x, y) => (Buffer.from(x) < Buffer.from(y) ? -1 : Buffer.from(x) > Buffer.from(y) ? 1 : 0));
  if (JSON.stringify(trie) !== JSON.stringify(chemins) || new Set(chemins).size !== chemins.length) {
    console.log("manifeste non trié ou avec doublon"); process.exit(1);
  }
  const reel = [];
  const parcourir = (r) => {
    for (const n of readdirSync(join(dir, r))) {
      const rel = r ? `${r}/${n}` : n;
      const st = lstatSync(join(dir, rel));
      if (st.isDirectory()) parcourir(rel);
      else if (rel !== man) reel.push(rel);
    }
  };
  parcourir("");
  if (JSON.stringify(reel.sort()) !== JSON.stringify([...chemins].sort())) {
    console.log("ensemble des fichiers différent du manifeste"); process.exit(1);
  }
  console.log(`MANIFESTE CONFORME : ${chemins.length} fichier(s)`);
} else if (op === "json") {
  JSON.parse(readFileSync(a[0], "utf8"));
} else if (op === "noemit") {
  const c = JSON.parse(readFileSync(a[0], "utf8"));
  if (!c.compilerOptions || c.compilerOptions.noEmit !== true) process.exit(1);
} else if (op === "outillage") {
  // <package-lock.json> : nom, version et integrity des paquets installés, triés ; indépendant
  // de la plateforme (les optionnels de toutes les plateformes y figurent).
  const lock = JSON.parse(readFileSync(a[0], "utf8"));
  const lignes = Object.entries(lock.packages ?? {}).filter(([k]) => k)
    .map(([k, v]) => `${k}\t${v.version ?? ""}\t${v.integrity ?? ""}`).sort();
  if (!lignes.length) { console.error("package-lock sans paquet"); process.exit(1); }
  console.log(lignes.join("\n"));
} else {
  console.error(`opération inconnue : ${op}`); process.exit(2);
}
MJS
empreinte() { "$NODE" "$T/s4-outils.mjs" sha256 "$1"; }

echo "--- mode $MODE ; travail conservé sous $T ---"
echo "  node $NODE $("$NODE" -v) · npm $NPM $("$NPM" -v) · $(git --version) · bash $BASH_VERSION"

# ---------------------------------------------------------------------------
# Les blocs déclaratifs du plan
# ---------------------------------------------------------------------------

bloc() {
  local nom="$2" debut fin
  debut="$(grep -c "^[[:space:]]*S4_${nom}_BEGIN[[:space:]]*$" "$1" || true)"
  fin="$(grep -c "^[[:space:]]*S4_${nom}_END[[:space:]]*$" "$1" || true)"
  [ "$debut" = "$fin" ] || refus "plan : S4_${nom} — $debut ouverture(s) pour $fin fermeture(s)"
  [ "$debut" -le 1 ] || refus "plan : S4_${nom} déclaré $debut fois"
  [ "$debut" -eq 1 ] || return 0
  awk -v b="S4_${nom}_BEGIN" -v e="S4_${nom}_END" '
    $0 ~ "^[[:space:]]*"b"[[:space:]]*$" { d=1; next }
    $0 ~ "^[[:space:]]*"e"[[:space:]]*$" { d=0; next }
    d { sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+$/, ""); if (length($0)) print }
  ' "$1"
}

bloc "$PLAN" OBJET                    > "$T/objet.declare"
bloc "$PLAN" SCOPE                    > "$T/scope.declare"
bloc "$PLAN" TYPESCRIPT_EXTENSIONLESS > "$T/ext.declare"
bloc "$PLAN" EXPECTED_REMOVED         > "$T/diag-retires.declare"
bloc "$PLAN" PROGRAM_ADDED            > "$T/prog-ajoutes.declare"
bloc "$PLAN" PROGRAM_REMOVED          > "$T/prog-retires.declare"
bloc "$PLAN" DOCUMENT_SCOPE           > "$T/doc.declare"

# L'objet audité : un unique bloc, une seule ligne, un identifiant complet de commit.
# Aucun repli sur f9791bd, HEAD ou le candidat.
grep -q "^[[:space:]]*S4_OBJET_BEGIN[[:space:]]*$" "$PLAN" || refus "plan : S4_OBJET absent — l'objet audité se déclare au plan"
[ "$(grep -c '' "$T/objet.declare")" -eq 1 ] || refus "plan : S4_OBJET doit contenir exactement une ligne"
OBJET="$(cat "$T/objet.declare")"
[[ "$OBJET" =~ ^[0-9a-f]{40}$ ]] || refus "plan : S4_OBJET illisible — identifiant complet de commit exigé : $OBJET"
"${GIT[@]}" cat-file -e "$OBJET^{commit}" 2>/dev/null || refus "l'objet audité $OBJET est absent de $DEST"
ARBRE_OBJET="$("${GIT[@]}" rev-parse "$OBJET^{tree}")"
echo "--- objet audité : $OBJET (arbre $ARBRE_OBJET) ---"

valider_chemin() {
  local f="$1" ou="$2"
  case "$f" in
    /*)            refus "$ou : chemin absolu interdit — $f" ;;
    ./*|*/./*)     refus "$ou : chemin non canonique — $f" ;;
    ..|../*|*/..|*/../*) refus "$ou : remontée interdite — $f" ;;
    *\**|*\?*|*\[*|*\]*) refus "$ou : glob interdit, un chemin littéral par ligne — $f" ;;
    *" "*)         refus "$ou : espace dans le chemin — $f" ;;
  esac
  [ -e "$DEST/$f" ] || refus "$ou : déclaré et absent du disque — $f"
  if [ -L "$DEST/$f" ]; then refus "$ou : lien symbolique — $f"; fi
  [ -f "$DEST/$f" ] || refus "$ou : n'est pas un fichier ordinaire — $f"
}

dans_objet() { "${GIT[@]}" cat-file -e "$OBJET:$1" 2>/dev/null; }

# Les extensionless : anciens (présents dans l'objet) et nouveaux (absents de l'objet).
EXT=(); EXT_ANCIENS=(); EXT_NOUVEAUX=()
while IFS= read -r f; do [ -n "$f" ] && EXT+=("$f"); done < "$T/ext.declare"
if [ "${#EXT[@]}" -gt 0 ]; then
  for f in "${EXT[@]}"; do
    if dans_objet "$f"; then EXT_ANCIENS+=("$f"); else EXT_NOUVEAUX+=("$f"); fi
  done
  [ "${#EXT_ANCIENS[@]}" -gt 0 ] \
    || refus "S4_TYPESCRIPT_EXTENSIONLESS : aucun binaire présent dans l'objet — le canal « avant » ne serait pas mesurable"
fi

SHIMS_AVANT_JSON=""; SHIMS_APRES_JSON=""
ajouter_json() { if [ -z "$1" ]; then printf '"%s"' "$2"; else printf '%s, "%s"' "$1" "$2"; fi; }
if [ "${#EXT_ANCIENS[@]}" -gt 0 ]; then
  for f in "${EXT_ANCIENS[@]}"; do SHIMS_AVANT_JSON="$(ajouter_json "$SHIMS_AVANT_JSON" "$f.s4.ts")"; done
fi
if [ "${#EXT[@]}" -gt 0 ]; then
  for f in "${EXT[@]}"; do SHIMS_APRES_JSON="$(ajouter_json "$SHIMS_APRES_JSON" "$f.s4.ts")"; done
fi

# ---------------------------------------------------------------------------
# Compilateur épinglé, installé sous le travail ; chaque opération contrôlée
# ---------------------------------------------------------------------------

# outil <nom> <codes admis, séparés par des virgules> <commande…> : commande, code brut,
# stdout et stderr conservés ; code contrôlé avant toute analyse ou opération suivante.
outil() {
  local nom="$1" admis="$2" rc=0; shift 2
  printf '%q ' "$@" > "$T/$nom.cmd"; echo >> "$T/$nom.cmd"
  ( cd "${OUTIL_CWD:-.}" && "$@" ) > "$T/$nom.out" 2> "$T/$nom.err" || rc=$?
  echo "$rc" > "$T/$nom.rc"
  case ",$admis," in *",$rc,"*) ;; *) refus "$nom : code $rc, admis $admis — voir $T/$nom.err" ;; esac
}

installer_compilateur() {
  echo; echo "--- compilateur épinglé, jetable, sous le travail ---"
  outil npm-installation 0 "$NPM" install --prefix "$T/ts" --cache "$T/npm-cache" --logs-dir "$T/npm-journaux" \
    --no-audit --no-fund --update-notifier=false "typescript@$TS_VERSION" "@types/node@$TYPES_VERSION"
  TSC="$T/ts/node_modules/.bin/tsc"; TYPES="$T/ts/node_modules/@types"
  outil tsc-version 0 "$TSC" --version
  vtsc="$(cat "$T/tsc-version.out")"; vtypes="$("$NODE" -p "require('$TYPES/node/package.json').version")"
  echo "  $vtsc · @types/node $vtypes"
  [ "$vtsc" = "Version $TS_VERSION" ] && [ "$vtypes" = "$TYPES_VERSION" ] || refus "versions inattendues"
  outil outillage 0 "$NODE" "$T/s4-outils.mjs" outillage "$T/ts/package-lock.json"
}

extraire_objet() { # extraire_objet <arbre>
  mkdir -p "$1"
  "${GIT[@]}" archive "$OBJET" > "$T/objet.tar" || refus "git archive $OBJET impossible"
  tar -x -f "$T/objet.tar" -C "$1" || refus "extraction de l'objet impossible"
}

# Shims : dans « avant », les seuls extensionless anciens ; un nouveau doit y être absent.
# Dans « après », tous les extensionless déclarés doivent exister.
poser_shims() {
  local arbre="$1" cote="$2" f
  [ "${#EXT[@]}" -gt 0 ] || return 0
  if [ "$cote" = avant ]; then
    for f in "${EXT_ANCIENS[@]}"; do
      [ -f "$arbre/$f" ] || refus "canal extensionless : $f absent de l'arbre avant"
      cp -p "$arbre/$f" "$arbre/$f.s4.ts"
    done
    if [ "${#EXT_NOUVEAUX[@]}" -gt 0 ]; then
      for f in "${EXT_NOUVEAUX[@]}"; do
        [ ! -e "$arbre/$f" ] || refus "canal extensionless : $f déclaré nouveau et présent dans l'arbre avant"
      done
    fi
  else
    for f in "${EXT[@]}"; do
      [ -f "$arbre/$f" ] || refus "canal extensionless : $f absent de l'arbre après"
      cp -p "$arbre/$f" "$arbre/$f.s4.ts"
    done
  fi
}

# mesurer <arbre> <nom> <canal> <côté> : configuration, liste et compilation, chacune
# contrôlée. Compilation : 0 sans diagnostic, ou S4_CODE_DIAGNOSTICS_NOEMIT avec diagnostics lisibles.
mesurer() {
  local arbre="$1" nom="$2" canal="$3" cote="$4" champ liste conf rc ndiag
  if [ "$canal" = "principal" ]; then
    champ="include"
    liste='"subagent-only/**/*.ts", "tests/**/*.ts", "extensions/**/*.ts"'
    conf="tsconfig.audit.json"
  else
    # `files` est la liste EXACTE des shims de CET arbre, jamais un glob ni une liste commune.
    champ="files"
    if [ "$cote" = avant ]; then liste="$SHIMS_AVANT_JSON"; else liste="$SHIMS_APRES_JSON"; fi
    conf="tsconfig.s4ext.json"
  fi
  cat > "$arbre/$conf" <<JSON
{
  "compilerOptions": {
    "strict": true, "noEmit": true, "target": "ES2022",
    "module": "ESNext", "moduleResolution": "bundler",
    "allowImportingTsExtensions": true, "skipLibCheck": true,
    "types": ["node"], "typeRoots": ["$TYPES"],
    "paths": {
      "@earendil-works/pi-coding-agent": ["./tests/stubs/pi-coding-agent.ts"],
      "typebox": ["./tests/stubs/typebox.ts"]
    }
  },
  "$champ": [$liste]
}
JSON
  # Configuration : code 0, JSON lisible, stderr vide.
  OUTIL_CWD="$arbre" outil "$nom.showconfig" 0 "$TSC" -p "$conf" --showConfig
  [ ! -s "$T/$nom.showconfig.err" ] || refus "$nom : --showConfig a écrit sur stderr"
  "$NODE" "$T/s4-outils.mjs" json "$T/$nom.showconfig.out" 2>/dev/null || refus "$nom : --showConfig illisible en JSON"
  # Profil effectif : noEmit vrai, aucune option de lancement ne le contredit.
  "$NODE" "$T/s4-outils.mjs" noemit "$T/$nom.showconfig.out" || refus "$nom : configuration effective sans noEmit: true — profil S4 contredit"
  # La configuration conservée ne porte pas le chemin du travail (typeRoots est relatif).
  cp "$T/$nom.showconfig.out" "$T/$nom.config.json"
  # Liste : code 0, stderr vide, aucune ligne de diagnostic, des chemins absolus existants.
  OUTIL_CWD="$arbre" outil "$nom.listfiles" 0 "$TSC" -p "$conf" --listFilesOnly
  [ ! -s "$T/$nom.listfiles.err" ] || refus "$nom : --listFilesOnly a écrit sur stderr"
  [ -s "$T/$nom.listfiles.out" ] || refus "$nom : --listFilesOnly n'a listé aucun fichier"
  if grep -q 'error TS' "$T/$nom.listfiles.out"; then refus "$nom : diagnostic dans la liste des fichiers"; fi
  while IFS= read -r l; do
    case "$l" in /*) [ -f "$l" ] || refus "$nom : fichier listé absent — $l" ;; *) refus "$nom : ligne de liste non analysable — $l" ;; esac
  done < "$T/$nom.listfiles.out"
  sed "s|^$arbre/||" "$T/$nom.listfiles.out" | grep -v '/node_modules/' | sort > "$T/$nom.fichiers" || true
  [ -s "$T/$nom.fichiers" ] || refus "$nom : aucun fichier du dépôt dans le programme"
  # Compilation : code brut d'abord, puis analyse complète de la sortie.
  OUTIL_CWD="$arbre" outil "$nom.compilation" "0,$S4_CODE_DIAGNOSTICS_NOEMIT" "$TSC" -p "$conf"
  rc="$(cat "$T/$nom.compilation.rc")"
  [ ! -s "$T/$nom.compilation.err" ] || refus "$nom : la compilation a écrit sur stderr"
  # Chaque ligne non vide est un diagnostic ou la suite indentée d'un diagnostic.
  if awk 'NF && !/^[^ ].*\([0-9]+,[0-9]+\): error TS[0-9]+: / && !/^error TS[0-9]+: / && !/^ / { exit 1 }' "$T/$nom.compilation.out"; then :
  else refus "$nom : sortie du compilateur non analysable"; fi
  ndiag="$(grep -c 'error TS' "$T/$nom.compilation.out" || true)"
  if [ "$rc" = 0 ] && [ "$ndiag" != 0 ]; then refus "$nom : code 0 avec $ndiag diagnostic(s)"; fi
  if [ "$rc" = "$S4_CODE_DIAGNOSTICS_NOEMIT" ] && [ "$ndiag" = 0 ]; then refus "$nom : code $rc sans diagnostic"; fi
  cp "$T/$nom.compilation.out" "$T/$nom.brut"
  grep 'error TS' "$T/$nom.brut" | sort > "$T/$nom.diag" || true
}

# ---------------------------------------------------------------------------
# Mode constitution : le collecteur des références, sur l'objet seul
# ---------------------------------------------------------------------------

if [ "$MODE" = constitution ]; then
  installer_compilateur
  extraire_objet "$T/avant"
  poser_shims "$T/avant" avant
  R="$SORTIE/references"; mkdir "$R"
  mesurer "$T/avant" avant principal avant
  canaux_ref=(principal:avant)
  if [ "${#EXT[@]}" -gt 0 ]; then mesurer "$T/avant" avantx extensionless avant; canaux_ref+=(extensionless:avantx); fi
  for c in "${canaux_ref[@]}"; do
    canal="${c%%:*}"; nom="${c#*:}"
    cp "$T/$nom.config.json" "$R/$canal.config.json"
    cp "$T/$nom.fichiers" "$R/$canal.fichiers"
    cp "$T/$nom.brut" "$R/$canal.brut"
    cp "$T/$nom.diag" "$R/$canal.diag"
    cp "$T/$nom.compilation.rc" "$R/$canal.rc"
    echo "  $canal : code $(cat "$R/$canal.rc") · fichiers $(grep -c '' "$R/$canal.fichiers") · diagnostics $(grep -c '' "$R/$canal.diag" || true)"
  done
  cp "$T/outillage.out" "$R/outillage.lock"
  {
    echo "objet $OBJET"
    echo "arbre $ARBRE_OBJET"
    echo "typescript $TS_VERSION"
    echo "types-node $TYPES_VERSION"
    echo "code-diagnostics-noemit $S4_CODE_DIAGNOSTICS_NOEMIT"
    if [ "${#EXT_ANCIENS[@]}" -gt 0 ]; then for f in "${EXT_ANCIENS[@]}"; do echo "extensionless $f"; done; fi
    echo "node-constitution $("$NODE" -v)"
    echo "plan-sha256 $(empreinte "$PLAN")"
  } > "$R/PROVENANCE.txt"
  ( cd "$R" && for f in $(ls | LC_ALL=C sort); do printf '%s  %s\n' "$(empreinte "$f")" "$f"; done ) > "$T/manifeste-references"
  mv "$T/manifeste-references" "$R/MANIFESTE-REFERENCES.sha256"
  "$NODE" "$T/s4-outils.mjs" verifier-manifeste "$R" MANIFESTE-REFERENCES.sha256 || refus "références : manifeste non vérifié"
  echo
  echo "S4 RÉFÉRENCES CONSTITUÉES : objet $OBJET, arbre $ARBRE_OBJET ; non gelées jusqu'à adjudication."
  echo "MANIFESTE-REFERENCES.sha256 $(empreinte "$R/MANIFESTE-REFERENCES.sha256")"
  find "$T" -type f | LC_ALL=C sort > "$SORTIE/INVENTAIRE-TRAVAIL.txt"
  exit 0
fi

# ---------------------------------------------------------------------------
# Les références : épinglées, provenance contrôlée avant toute mesure
# ---------------------------------------------------------------------------

[ "$(empreinte "$REFS/MANIFESTE-REFERENCES.sha256")" = "$REFS_SHA" ] \
  || refus "références : MANIFESTE-REFERENCES.sha256 différent de l'empreinte épinglée"
"$NODE" "$T/s4-outils.mjs" verifier-manifeste "$REFS" MANIFESTE-REFERENCES.sha256 > "$T/references.verification" \
  || refus "références : $(cat "$T/references.verification")"
provenance() { awk -v k="$1" '$1 == k { sub(/^[^ ]+ /, ""); print }' "$REFS/PROVENANCE.txt"; }
[ "$(provenance objet)" = "$OBJET" ] || refus "références : objet $(provenance objet) ≠ objet déclaré $OBJET"
[ "$(provenance arbre)" = "$ARBRE_OBJET" ] || refus "références : arbre $(provenance arbre) ≠ arbre de l'objet $ARBRE_OBJET"
[ "$(provenance typescript)" = "$TS_VERSION" ] && [ "$(provenance types-node)" = "$TYPES_VERSION" ] \
  || refus "références : versions du compilateur différentes de l'instrument"
[ "$(provenance code-diagnostics-noemit)" = "$S4_CODE_DIAGNOSTICS_NOEMIT" ] || refus "références : code admissible noEmit différent de l'instrument"
anciens_ref="$(provenance extensionless)"
anciens_calc=""; if [ "${#EXT_ANCIENS[@]}" -gt 0 ]; then anciens_calc="$(printf '%s\n' "${EXT_ANCIENS[@]}")"; fi
[ "$anciens_ref" = "$anciens_calc" ] || refus "références : extensionless de l'objet différents de ceux du plan"
for f in principal.config.json principal.fichiers principal.diag principal.rc outillage.lock; do
  [ -f "$REFS/$f" ] || refus "références : $f absent"
done
if [ "${#EXT[@]}" -gt 0 ]; then
  for f in extensionless.config.json extensionless.fichiers extensionless.diag extensionless.rc; do
    [ -f "$REFS/$f" ] || refus "références : $f absent"
  done
fi
echo "--- références : provenance conforme ($(cat "$T/references.verification")) ---"

# ---------------------------------------------------------------------------
# Le périmètre de production, validé avant tout
# ---------------------------------------------------------------------------

SCOPE=()
while IFS= read -r f; do [ -n "$f" ] && SCOPE+=("$f"); done < "$T/scope.declare"
[ "${#SCOPE[@]}" -gt 0 ] || refus "plan : S4_SCOPE vide — un lot de production déclare ce qu'il touche"

for f in "${SCOPE[@]}"; do valider_chemin "$f" "S4_SCOPE"; done
if ! diff -q <(printf '%s\n' "${SCOPE[@]}") <(printf '%s\n' "${SCOPE[@]}" | sort -u) >/dev/null; then
  refus "S4_SCOPE : liste non triée ou avec doublon"
fi

if [ "${#EXT[@]}" -gt 0 ]; then
  for f in "${EXT[@]}"; do
    valider_chemin "$f" "S4_TYPESCRIPT_EXTENSIONLESS"
    grep -qxF "$f" "$T/scope.declare" \
      || refus "S4_TYPESCRIPT_EXTENSIONLESS : $f n'est pas dans S4_SCOPE"
  done
fi

# Couverture d'intégrité hors TypeScript : les .md de v7, et les seuls chemins admis
# nommément. Jamais dans un programme ; mesurés par divergence, miroir, empreintes et
# contre-épreuve. Un fichier est un programme (S4_SCOPE) ou un document, pas les deux.
DOCS=()
while IFS= read -r f; do [ -n "$f" ] && DOCS+=("$f"); done < "$T/doc.declare"
if [ "${#DOCS[@]}" -gt 0 ]; then
  for f in "${DOCS[@]}"; do
    case "$f" in
      *.ts) refus "S4_DOCUMENT_SCOPE : TypeScript refusé — $f" ;;
      *.md) ;;
      # v10: membership tested without a pipeline (printf | grep -q under pipefail could end in
      # SIGPIPE, status 141, and refuse an admitted path: stop E1 of the A3 resumption r1).
      *) case $'\n'"$ADMIS_HORS_MD"$'\n' in
           *$'\n'"$f"$'\n'*) ;;
           *) refus "S4_DOCUMENT_SCOPE : $f n'est ni un .md ni un chemin admis nommément" ;;
         esac ;;
    esac
    case "$f" in
      *//*) refus "S4_DOCUMENT_SCOPE : chemin non canonique — $f" ;;
    esac
    valider_chemin "$f" "S4_DOCUMENT_SCOPE"
    if grep -qxF -- "$f" "$T/scope.declare"; then
      refus "S4_DOCUMENT_SCOPE : $f figure aussi dans S4_SCOPE — un fichier est un programme ou un document, pas les deux"
    fi
    if grep -qxF -- "$f" "$T/ext.declare"; then
      refus "S4_DOCUMENT_SCOPE : $f figure aussi dans S4_TYPESCRIPT_EXTENSIONLESS"
    fi
  done
  if ! diff -q <(printf '%s\n' "${DOCS[@]}") <(printf '%s\n' "${DOCS[@]}" | sort -u) >/dev/null; then
    refus "S4_DOCUMENT_SCOPE : liste non triée ou avec doublon"
  fi
fi

# ---------------------------------------------------------------------------
# L'ensemble mesuré : L0 dérivé du dépôt ∪ S4_SCOPE ∪ documents
# ---------------------------------------------------------------------------

"${GIT[@]}" ls-files --cached --others --exclude-standard \
  | grep -E "$L0_MOTIF" | sort -u > "$T/l0.liste" || true
[ -s "$T/l0.liste" ] || refus "aucun fichier L0 dans $DEST — rien à mesurer"

sort -u "$T/l0.liste" "$T/scope.declare" > "$T/programme.liste"
sort -u "$T/programme.liste" "$T/doc.declare" > "$T/mesure.liste"
MESURE=()
while IFS= read -r f; do [ -n "$f" ] && MESURE+=("$f"); done < "$T/mesure.liste"

echo "--- périmètre mesuré déclaré par le lot ($PLAN) ---"
printf '  %s\n' "${SCOPE[@]}"
echo "--- canal extensionless déclaré ---"
if [ "${#EXT[@]}" -gt 0 ]; then
  for f in "${EXT_ANCIENS[@]}"; do echo "  $f (présent dans l'objet)"; done
  if [ "${#EXT_NOUVEAUX[@]}" -gt 0 ]; then for f in "${EXT_NOUVEAUX[@]}"; do echo "  $f (nouveau, absent de l'objet)"; done; fi
else echo "  (aucun)"; fi
echo "--- documents et fichiers hors TypeScript déclarés ---"
if [ "${#DOCS[@]}" -gt 0 ]; then printf '  %s\n' "${DOCS[@]}"; else echo "  (aucun)"; fi
echo "--- fichiers L0 dérivés du dépôt ---"
sed 's/^/  /' "$T/l0.liste"
echo "--- ensemble mesuré : ${#MESURE[@]} fichier(s) ---"

for f in "${MESURE[@]}"; do
  [ -f "$DEST/$f" ] || refus "listé et absent du disque : $f"
done

# ---------------------------------------------------------------------------
# Divergence : état COMPLET contre l'objet audité
# ---------------------------------------------------------------------------

{ "${GIT[@]}" diff --name-only "$OBJET" --
  "${GIT[@]}" ls-files --others --exclude-standard
} | sort -u > "$T/diverge.reel"

hors="$(comm -23 "$T/diverge.reel" "$T/mesure.liste")"
if [ -n "$hors" ]; then
  echo "--- diverge de l'objet audité sans être mesuré ---"
  printf '%s\n' "$hors" | sed 's/^/  /'
  refus "un fichier diverge de l'objet audité hors de l'ensemble mesuré — $(printf '%s\n' "$hors" | paste -sd ',' - | sed 's/,/, /g')"
fi

# ---------------------------------------------------------------------------
# Le miroir, et la copie qui sera contre-éprouvée
# ---------------------------------------------------------------------------

mkdir -p "$T/miroir"
for f in "${MESURE[@]}"; do
  mkdir -p "$T/miroir/$(dirname "$f")"
  cp -p "$DEST/$f" "$T/miroir/$f"
done

# La seule fonction qui peuple un arbre « après ». La contre-épreuve l'exerce, donc ce
# qu'elle prouve porte sur le chemin réellement employé, et pas sur une imitation.
copier_ensemble() {
  local arbre="$1" f
  for f in "${MESURE[@]}"; do
    mkdir -p "$arbre/$(dirname "$f")"
    cp -p "$T/miroir/$f" "$arbre/$f"
  done
}

empreintes_depot() {
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf '%s\t%s\n' "$(empreinte "$DEST/$f")" "$f"
  done < "$T/mesure.liste"
}

echo; echo "--- contre-épreuve de l'instrument (dans le miroir, jamais dans le dépôt) ---"
empreintes_depot > "$T/depot.avant.sha256"
"${GIT[@]}" status --porcelain=v1 -z > "$T/depot.avant.status"

# contre_epreuve <chemin> <ligne ajoutée> <libellé> : la mutation du miroir doit traverser
# la copie réellement employée ; chaque épreuve garde son arbre sous le travail.
n_epreuve=0
contre_epreuve() {
  local f="$1" ligne="$2" quoi="$3" avant_h mute_h porte_h e
  n_epreuve=$((n_epreuve + 1)); e="$T/epreuve-$n_epreuve"
  avant_h="$(empreinte "$DEST/$f")"
  cp -p "$T/miroir/$f" "$T/miroir.sauvegarde"
  printf '%s\n' "$ligne" >> "$T/miroir/$f"
  mute_h="$(empreinte "$T/miroir/$f")"
  mkdir -p "$e"; copier_ensemble "$e"
  [ "$mute_h" != "$avant_h" ] \
    || refus "contre-épreuve $quoi : la mutation du miroir n'a rien changé"
  [ -f "$e/$f" ] \
    || refus "contre-épreuve $quoi : la copie n'a pas posé $f — l'arbre « après » ne contient pas le fichier mesuré"
  porte_h="$(empreinte "$e/$f")"
  [ "$porte_h" = "$mute_h" ] \
    || refus "contre-épreuve $quoi : la copie n'a pas porté la mutation de $f — l'arbre « après » ne reflète pas ce qui est mesuré"
  cp -p "$T/miroir.sauvegarde" "$T/miroir/$f"
  [ "$(empreinte "$T/miroir/$f")" = "$avant_h" ] || refus "contre-épreuve $quoi : miroir non restauré pour $f"
  echo "  ok  une ligne mutée dans $f traverse la copie et change l'empreinte ($quoi)"
}

contre_epreuve "${SCOPE[0]}" "// s4-contre-epreuve $$" programme
# Une épreuve par famille de suffixe déclarée hors TypeScript (.md, .json, .jsonl, .mjs,
# .py, .sh…) : le premier chemin de chaque famille.
if [ "${#DOCS[@]}" -gt 0 ]; then
  familles=""
  for doc in "${DOCS[@]}"; do
    suf="${doc##*.}"
    case " $familles " in *" $suf "*) continue ;; esac
    familles="$familles $suf"
    contre_epreuve "$doc" "s4-contre-epreuve $$" "document .$suf"
  done
fi

empreintes_depot > "$T/depot.apres.sha256"
"${GIT[@]}" status --porcelain=v1 -z > "$T/depot.apres.status"
cmp -s "$T/depot.avant.sha256" "$T/depot.apres.sha256" \
  || refus "contre-épreuve : le contenu d'au moins un fichier mesuré du dépôt a changé"
cmp -s "$T/depot.avant.status" "$T/depot.apres.status" \
  || refus "contre-épreuve : l'état Git du dépôt a changé"
echo "  ok  contenu mesuré et état Git du dépôt strictement inchangés"

installer_compilateur
cmp -s "$T/outillage.out" "$REFS/outillage.lock" \
  || refus "outillage : paquets, versions ou empreintes différents des références"
echo "  ok  outillage identique aux références (paquets, versions, integrity)"

extraire_objet "$T/avant"
extraire_objet "$T/apres"
copier_ensemble "$T/apres"
poser_shims "$T/avant" avant
poser_shims "$T/apres" apres

echo; echo "--- empreintes : worktree contre arbre « après » ---"
for f in "${MESURE[@]}"; do
  [ "$(empreinte "$DEST/$f")" = "$(empreinte "$T/apres/$f")" ] \
    || refus "empreinte différente après copie : $f — l'arbre mesuré n'est pas celui du disque"
done
echo "  ok  ${#MESURE[@]} fichier(s) identiques de part et d'autre de la copie"

# ---------------------------------------------------------------------------
# Mesure, deux canaux ; « avant » reproduit les références avant toute comparaison
# ---------------------------------------------------------------------------

reproduire() { # reproduire <nom> <canal>
  local nom="$1" canal="$2" x
  for x in config.json fichiers diag; do
    if ! cmp -s "$REFS/$canal.$x" "$T/$nom.$x"; then
      diff "$REFS/$canal.$x" "$T/$nom.$x" | head -20 || true
      refus "« avant » ne reproduit pas la référence $canal ($x) : l'instrument ne mesure pas l'objet audité"
    fi
  done
  [ "$(cat "$REFS/$canal.rc")" = "$(cat "$T/$nom.compilation.rc")" ] \
    || refus "« avant » : code de compilation $canal différent de la référence"
  echo "  ok  « avant » reproduit la référence $canal à l'identique (configuration, fichiers, diagnostics, code)"
}

echo; echo "--- mesure ---"
mesurer "$T/avant" avant principal avant
reproduire avant principal
mesurer "$T/apres" apres principal apres
[ "$(cat "$T/apres.compilation.rc")" = "$(cat "$REFS/principal.rc")" ] \
  || refus "« après » : code de compilation principal $(cat "$T/apres.compilation.rc") différent de l'attendu $(cat "$REFS/principal.rc")"
nr="$(grep -c '' "$REFS/principal.diag" || true)"
echo "  programme principal  : référence $nr · avant $(grep -c '' "$T/avant.diag" || true) · après $(grep -c '' "$T/apres.diag" || true)"

if [ "${#EXT[@]}" -gt 0 ]; then
  mesurer "$T/avant" avantx extensionless avant
  reproduire avantx extensionless
  mesurer "$T/apres" apresx extensionless apres
  [ "$(cat "$T/apresx.compilation.rc")" = "$(cat "$REFS/extensionless.rc")" ] \
    || refus "« après » : code de compilation extensionless $(cat "$T/apresx.compilation.rc") différent de l'attendu $(cat "$REFS/extensionless.rc")"
  nrx="$(grep -c '' "$REFS/extensionless.diag" || true)"
  echo "  canal extensionless  : référence $nrx · avant $(grep -c '' "$T/avantx.diag" || true) · après $(grep -c '' "$T/apresx.diag" || true)"
else
  : > "$T/avantx.diag"; : > "$T/apresx.diag"
fi

cp "$T/apres.config.json" "$SORTIE/s4-config.json"
cp "$T/avant.brut" "$SORTIE/s4-avant.txt"
cp "$T/apres.brut" "$SORTIE/s4-apres.txt"
if [ "${#EXT[@]}" -gt 0 ]; then
  cp "$T/avantx.brut" "$SORTIE/s4-avant-extensionless.txt"
  cp "$T/apresx.brut" "$SORTIE/s4-apres-extensionless.txt"
fi

# ---------------------------------------------------------------------------
# Le programme compilé : ensembles exacts, canal par canal
# ---------------------------------------------------------------------------
#
# Un fichier n'explique automatiquement une ENTRÉE que s'il est mesuré ET absent de
# l'objet audité ; dans le canal extensionless s'ajoute le shim <nom>.s4.ts dont
# l'original extensionless est lui-même mesuré et absent de l'objet.
#
# AUCUN retrait n'est jamais expliqué, dans aucun canal. S4_SCOPE déclare qu'un fichier
# est modifié, pas qu'il doit cesser d'être compilé.

"${GIT[@]}" ls-tree -r --name-only "$OBJET" | sort -u > "$T/objet.liste"
comm -23 "$T/programme.liste" "$T/objet.liste" > "$T/mesure.nouveaux"

cp "$T/mesure.nouveaux" "$T/explique.principal"
cp "$T/mesure.nouveaux" "$T/explique.extensionless"
if [ "${#EXT[@]}" -gt 0 ]; then
  for f in "${EXT[@]}"; do
    if grep -qxF "$f" "$T/mesure.nouveaux"; then printf '%s.s4.ts\n' "$f" >> "$T/explique.extensionless"; fi
  done
  sort -u -o "$T/explique.extensionless" "$T/explique.extensionless"
fi

cat > "$T/declarations.mjs" <<'MJS'
import { readFileSync } from "node:fs";

/*
 * Les déclarations de delta de programme, une ligne JSON chacune.
 *
 * `channel` fait partie de l'identité : un même chemin .ts peut être compilé dans les deux
 * canaux, et deux déclarations identiques sans canal seraient indiscernables.
 */
const [fichier, sens] = process.argv.slice(2);
const CANAUX = ["principal", "extensionless"];
const lignes = readFileSync(fichier, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean);
const vus = new Set();
const sortie = [];
for (const [i, ligne] of lignes.entries()) {
  let o;
  try {
    o = JSON.parse(ligne);
  } catch {
    console.error(`S4_PROGRAM (${sens}) ligne ${i + 1} : illisible en JSON`);
    process.exit(1);
  }
  if (!CANAUX.includes(o.channel)) {
    console.error(`S4_PROGRAM (${sens}) ligne ${i + 1} : channel doit valoir ${CANAUX.join(" ou ")}`);
    process.exit(1);
  }
  if (typeof o.path !== "string" || !o.path) {
    console.error(`S4_PROGRAM (${sens}) ligne ${i + 1} : path absent`);
    process.exit(1);
  }
  if (typeof o.justification !== "string" || !o.justification.trim()) {
    console.error(`S4_PROGRAM (${sens}) ligne ${i + 1} : justification vide`);
    process.exit(1);
  }
  const cle = `${o.channel}\t${o.path}`;
  if (vus.has(cle)) {
    console.error(`S4_PROGRAM (${sens}) ligne ${i + 1} : (channel, path) en double — ${cle}`);
    process.exit(1);
  }
  vus.add(cle);
  sortie.push(cle);
}
console.log(sortie.join("\n"));
MJS

"$NODE" "$T/declarations.mjs" "$T/prog-ajoutes.declare" ajoutes > "$T/declare.ajoutes" \
  || refus "S4_PROGRAM_ADDED — voir ci-dessus"
"$NODE" "$T/declarations.mjs" "$T/prog-retires.declare" retires > "$T/declare.retires" \
  || refus "S4_PROGRAM_REMOVED — voir ci-dessus"

comparer_programme() {
  local canal="$1" av="$2" ap="$3" explique="$4" sens
  echo
  echo "--- programme compilé · canal $canal ---"
  echo "  fichiers : avant $(wc -l < "$av" | tr -d ' ') · après $(wc -l < "$ap" | tr -d ' ')"

  comm -13 "$av" "$ap" | sort > "$T/$canal.ajoutes"
  comm -23 "$av" "$ap" | sort > "$T/$canal.retires"
  comm -12 "$T/$canal.ajoutes" "$explique" > "$T/$canal.ajoutes.explique"
  comm -23 "$T/$canal.ajoutes" "$T/$canal.ajoutes.explique" > "$T/$canal.ajoutes.inexplique"
  # Aucun retrait n'est expliqué : l'inexpliqué est le retrait entier.
  cp "$T/$canal.retires" "$T/$canal.retires.inexplique"

  echo "  ajoutés, expliqués — mesurés et absents de l'objet audité : $(wc -l < "$T/$canal.ajoutes.explique" | tr -d ' ')"
  sed 's/^/    /' "$T/$canal.ajoutes.explique"
  echo "  retirés : $(wc -l < "$T/$canal.retires" | tr -d ' ') — aucun retrait n'est jamais expliqué"
  sed 's/^/    /' "$T/$canal.retires"

  for sens in ajoutes retires; do
    awk -F'\t' -v c="$canal" '$1 == c { print $2 }' "$T/declare.$sens" | sort -u > "$T/$canal.$sens.attendu"
    if ! cmp -s "$T/$canal.$sens.inexplique" "$T/$canal.$sens.attendu"; then
      echo "  --- $sens non expliqués, canal $canal ---"
      sed 's/^/    réel     /' "$T/$canal.$sens.inexplique"
      sed 's/^/    déclaré  /' "$T/$canal.$sens.attendu"
      refus "programme ($canal) : delta réel et delta déclaré diffèrent ($sens)"
    fi
  done
  echo "  ok  aucun fichier n'entre ni ne sort du canal $canal sans être expliqué ou déclaré"
}

comparer_programme principal "$T/avant.fichiers" "$T/apres.fichiers" "$T/explique.principal"
if [ "${#EXT[@]}" -gt 0 ]; then
  comparer_programme extensionless "$T/avantx.fichiers" "$T/apresx.fichiers" "$T/explique.extensionless"
fi

if [ "${#EXT[@]}" -eq 0 ] && grep -q 'extensionless' "$T/declare.ajoutes" "$T/declare.retires" 2>/dev/null; then
  refus "une déclaration S4_PROGRAM_* vise le canal extensionless, qui n'est pas ouvert"
fi

# Tout fichier de S4_SCOPE doit être RÉELLEMENT consommé par un canal. Un extensionless
# ancien : shim présent avant et après. Un nouveau : absent de l'objet et du programme
# « avant », shim présent et consommé dans « après ». La déclaration seule ne prouve rien.
echo; echo "--- couverture du périmètre par les canaux ---"
est_ancien() { local x; [ "${#EXT_ANCIENS[@]}" -gt 0 ] || return 1; for x in "${EXT_ANCIENS[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
est_nouveau() { local x; [ "${#EXT_NOUVEAUX[@]}" -gt 0 ] || return 1; for x in "${EXT_NOUVEAUX[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
for f in "${SCOPE[@]}"; do
  if grep -qxF "$f" "$T/apres.fichiers"; then
    echo "  principal      $f"
  elif est_ancien "$f" \
    && grep -qxF "$f.s4.ts" "$T/avantx.fichiers" \
    && grep -qxF "$f.s4.ts" "$T/apresx.fichiers"; then
    echo "  extensionless  $f (avant et après)"
  elif est_nouveau "$f" \
    && ! dans_objet "$f" \
    && ! grep -qxF "$f.s4.ts" "$T/avantx.fichiers" \
    && grep -qxF "$f.s4.ts" "$T/apresx.fichiers"; then
    echo "  extensionless  $f (nouveau : absent avant, consommé après)"
  else
    refus "S4_SCOPE : $f n'est consommé par aucun canal — déclaré et jamais compilé"
  fi
done

# ---------------------------------------------------------------------------
# Diagnostics : multisets d'occurrences, agrégés seulement après la différence
# ---------------------------------------------------------------------------

cat > "$T/comparer.mjs" <<'MJS'
import { readFileSync } from "node:fs";

const [declareP, ...canaux] = process.argv.slice(2);

/*
 * Une identité PAR OCCURRENCE. Agréger avant la différence faisait lire une occurrence
 * passée de deux à une comme « ×2 disparue, ×1 nouvelle », et refuser à tort un
 * diagnostic nouveau. La multiplicité n'a de sens qu'après la soustraction.
 *
 * L'identité est chemin + code + message verbatim, moins le préfixe de localisation :
 * ligne et colonne bougent au moindre commentaire ajouté. Aucune autre normalisation.
 */
function lire(p) {
  return readFileSync(p, "utf-8").split("\n").filter((l) => l.includes("error TS")).map((l) => {
    const m = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(l);
    if (m) return { path: m[1], code: m[4], message: m[5] };
    const g = /^error (TS\d+): (.*)$/.exec(l);
    if (g) return { path: "", code: g[1], message: g[2] };
    return { path: "", code: "TS?", message: l };
  });
}
const cle = (d) => JSON.stringify([d.path, d.code, d.message]);

/** Différence de multisets : chaque occurrence de b consomme au plus une occurrence de a. */
function moins(a, b) {
  const reste = new Map();
  for (const d of b) reste.set(cle(d), (reste.get(cle(d)) ?? 0) + 1);
  const sortie = [];
  for (const d of a) {
    const k = cle(d);
    const n = reste.get(k) ?? 0;
    if (n > 0) reste.set(k, n - 1);
    else sortie.push(d);
  }
  return sortie;
}
function agreger(liste) {
  const m = new Map();
  for (const d of liste) {
    const k = cle(d);
    m.set(k, {
      path: d.path, code: d.code, message: d.message,
      multiplicity: (m.get(k)?.multiplicity ?? 0) + 1, canal: d.canal,
    });
  }
  return [...m.values()].sort((x, y) => cle(x).localeCompare(cle(y)));
}

const nouveaux = [];
const disparus = [];
for (let i = 0; i < canaux.length; i += 3) {
  const nom = canaux[i];
  const avant = lire(canaux[i + 1]);
  const apres = lire(canaux[i + 2]);
  for (const d of moins(apres, avant)) nouveaux.push({ ...d, canal: nom });
  for (const d of moins(avant, apres)) disparus.push({ ...d, canal: nom });
}

const parCanal = (liste) => {
  const m = new Map();
  for (const d of liste) m.set(d.canal, [...(m.get(d.canal) ?? []), d]);
  return [...m.entries()].flatMap(([, l]) => agreger(l));
};
const montrer = (d) => `  [${d.canal}] ${d.path || "(global)"} ${d.code} ×${d.multiplicity} ${d.message}`;

const nouveauxAgreges = parCanal(nouveaux);
const disparusAgreges = parCanal(disparus);

console.log("--- diagnostics nouveaux ---");
console.log(nouveauxAgreges.length ? nouveauxAgreges.map(montrer).join("\n") : "  aucun");
console.log("--- diagnostics disparus ---");
console.log(disparusAgreges.length ? disparusAgreges.map(montrer).join("\n") : "  aucun");

if (nouveauxAgreges.length) {
  console.log("\nREFUS : diagnostic nouveau — aucun n'est accepté (Sol, S4)");
  process.exit(1);
}

/*
 * Une ligne JSON par disparition attendue. Le séparateur « | » a été retiré du format :
 * un message TypeScript peut lui-même en contenir, et la déclaration devenait ambiguë.
 * La chaîne `message` est comparée après décodage JSON, caractère pour caractère.
 */
const brut = readFileSync(declareP, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean);
const declares = [];
for (const [i, ligne] of brut.entries()) {
  let o;
  try {
    o = JSON.parse(ligne);
  } catch {
    console.log(`\nREFUS : S4_EXPECTED_REMOVED ligne ${i + 1} illisible en JSON`);
    process.exit(1);
  }
  const refuser = (quoi) => {
    console.log(`\nREFUS : S4_EXPECTED_REMOVED ligne ${i + 1} — ${quoi}`);
    process.exit(1);
  };
  if (!["principal", "extensionless"].includes(o.channel)) refuser("channel doit valoir principal ou extensionless");
  if (typeof o.path !== "string") refuser("path absent ou non textuel");
  if (typeof o.code !== "string" || !/^TS\d+$/.test(o.code)) refuser("code doit être de la forme TS<chiffres>");
  if (typeof o.message !== "string") refuser("message absent ou non textuel");
  if (!Number.isInteger(o.multiplicity) || o.multiplicity < 1) refuser("multiplicity doit être un entier strictement positif");
  if (typeof o.justification !== "string" || !o.justification.trim()) refuser("justification vide");
  declares.push(o);
}

const norme = (d) => JSON.stringify([d.canal ?? d.channel, d.path, d.code, d.message, d.multiplicity]);
const reels = disparusAgreges.map(norme).sort();
const attendus = declares.map(norme).sort();
if (JSON.stringify(reels) !== JSON.stringify(attendus)) {
  console.log("\n  --- disparitions réelles ---");
  console.log(disparusAgreges.map(montrer).join("\n") || "  (aucune)");
  console.log("  --- disparitions déclarées ---");
  console.log(declares.map((d) => `  [${d.channel}] ${d.path} ${d.code} ×${d.multiplicity} ${d.message}`).join("\n") || "  (aucune)");
  console.log("\nREFUS : un diagnostic disparu non déclaré, déclaré sans disparaître, ou de multiplicité différente");
  process.exit(1);
}
if (declares.length) {
  console.log("--- justifications des disparitions ---");
  for (const d of declares) console.log(`  [${d.channel}] ${d.path} ${d.code} ×${d.multiplicity} : ${d.justification}`);
}
MJS

echo
canaux=(principal "$T/avant.diag" "$T/apres.diag")
if [ "${#EXT[@]}" -gt 0 ]; then canaux+=(extensionless "$T/avantx.diag" "$T/apresx.diag"); fi
"$NODE" "$T/comparer.mjs" "$T/diag-retires.declare" "${canaux[@]}" \
  || refus "comparaison des diagnostics — voir ci-dessus"

# Le dépôt mesuré, une dernière fois : inchangé depuis le début de la mesure.
empreintes_depot > "$T/depot.fin.sha256"
"${GIT[@]}" status --porcelain=v1 -z > "$T/depot.fin.status"
cmp -s "$T/depot.avant.sha256" "$T/depot.fin.sha256" && cmp -s "$T/depot.avant.status" "$T/depot.fin.status" \
  || refus "le dépôt mesuré a changé pendant la mesure"

echo
echo "S4 VERT : aucun diagnostic nouveau, aucune disparition non déclarée, aucun delta de"
echo "programme non expliqué, chaque fichier du périmètre consommé par un canal."
echo "Objet audité $OBJET ; références $REFS_SHA reproduites par « avant »."
if [ "${#DOCS[@]}" -gt 0 ]; then
  echo "Fichiers hors TypeScript déclarés : ${#DOCS[@]}, mesurés par divergence, miroir et empreinte, jamais par TypeScript."
fi
find "$T" -type f | LC_ALL=C sort > "$SORTIE/INVENTAIRE-TRAVAIL.txt"
echo "Relevés et travail conservés sous $SORTIE (inventaire : INVENTAIRE-TRAVAIL.txt)."
