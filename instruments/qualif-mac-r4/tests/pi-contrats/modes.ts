/**
 * Modes de bin/pi-contrats (LOT-PI-ADAPT), typés — instrument N5 externe R3.
 *
 * Traduction typée des modes de l'ancien lanceur : mêmes drapeaux et positions d'arguments, mêmes
 * lignes de sortie, mêmes codes (0 conforme, 1 non conforme, 2 usage ou épreuve inconnue ; 3 reste
 * posé par le lanceur sur une exception). Les modules de l'instrument sont chargés à la demande, aux
 * mêmes moments et sous les mêmes URL qu'avant (tests/pi-contrats/<module>.ts).
 *
 * R3 (bloc B du plan correctif M3, adjudication 42e2000c) : ce module porte les modes N5 du lanceur
 * R2 (plan N5 corrigé par Sol, 09-10-2026, option B). Tout mode exige en tête
 * `--depot <chemin absolu canonique>`, le dépôt à qualifier, sinon code 2 avant tout chargement du
 * harnais. Aucun dépôt ne se déduit de la position de l'instrument ni d'une variable d'environnement.
 *
 *   bin/pi-contrats --depot <d> --qualifier-candidat <arbre> [--conserver <dossier>]
 *                                     N5 : campagne nominale C1 à C8 sur le candidat final, garde G-N5
 *                                     seule ; <arbre> doit être exactement l'arbre épinglé, sinon code 2
 *                                     avant chargement du harnais
 *   bin/pi-contrats --depot <d> --liste-refus-n5
 *   bin/pi-contrats --depot <d> --refus-n5 <id> [--resultat <fichier.json>]
 *                                     épreuve d'intégration de G-N5 (premier refus, aucun lancement)
 *   bin/pi-contrats --depot <d> --lecteur-n5 <id> <clause> [--resultat <fichier.json>] [--conserver <dossier>]
 *                                     lecteur local d'une clause de G-N5 : témoin, puis altération
 *   bin/pi-contrats --depot <d> --selection-n5 <r2|r5-candidat|r5-base> [--resultat <fichier.json>]
 *                                     sélection de la garde et absence de repli, sans pi
 *   Les modes historiques prennent le même préfixe --depot <d> ; --qualifier emploie G-I1-base
 *   seule, sur le dépôt choisi.
 *
 * Le choix explicite du dépôt (lecture et contrôle de --depot) précède le premier chargement du
 * harnais ; le dépôt est fixé par choisirDepot une seule fois, dès le premier module chargé, avant
 * toute lecture du dépôt, comme dans le lanceur R2.
 *
 * Écarts de forme, sans effet observable : une valeur absente après --conserver ou --resultat est
 * transmise comme null au lieu d'undefined (le harnais ne les teste que par vérité) ; le message
 * d'erreur du lecteur se lit par un rétrécissement de type au lieu d'un accès non typé.
 */
import { realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ClauseN5 } from "./harnais.ts";

const ARBRE_N5 = "b1a99caa0e31e96cbc5279dbca19781335ac764b";
const USAGE_DEPOT = "usage : pi-contrats --depot <chemin absolu canonique> <mode> …";

/** --depot en tête, chemin absolu canonique d'un répertoire ; sinon null (code 2, rien n'est chargé). */
function depotDeLaLigne(argv: readonly string[]): string | null {
  const [drapeau, chemin] = argv.slice(2, 4);
  if (drapeau !== "--depot" || !chemin || !isAbsolute(chemin)) return null;
  try {
    if (realpathSync(chemin) !== chemin || !statSync(chemin).isDirectory()) return null;
  } catch {
    return null;
  }
  return chemin;
}

let depotChoisi: string | null = null;
let depotFixe = false;

/** Le module chargé, après avoir fixé le dépôt une seule fois, dès le premier chargement. */
async function choisi<T>(m: T): Promise<T> {
  if (!depotFixe) {
    if (depotChoisi === null) throw new Error("dépôt non établi avant le chargement des modules");
    const h = await import("./harnais.ts");
    h.choisirDepot(depotChoisi);
    depotFixe = true;
  }
  return m;
}

function sortie(lignes: string[]): void {
  process.stdout.write(lignes.join("\n") + "\n");
}

async function refus(id: string, resultat: string | null): Promise<number> {
  const h = await choisi(await import("./harnais.ts"));
  const st = h.stimuli().find((s) => s.id === id);
  if (!st) {
    sortie([`épreuve inconnue : ${id}`]);
    return 2;
  }
  const r = h.eprouverRefus(st, process.env.PATH || "");
  if (resultat) writeFileSync(resultat, JSON.stringify(r.resultat) + "\n");
  sortie([`ÉPREUVE ${st.id} (règle ${st.regle}, refus ${st.moment === "avant" ? "avant lancement" : st.moment === "lecteur" ? "du lecteur d'identité, sans lancement" : "pendant ou après l'exécution"})`, ...r.lignes, `RÉSULTAT ${st.id} : ${r.conforme ? "REFUS OBTENU" : "REFUS NON OBTENU"}`]);
  return r.conforme ? 0 : 1;
}

async function mesure(id: string, conserver: string | null): Promise<number> {
  const h = await choisi(await import("./harnais.ts"));
  const r = h.mesurePrealable(id, process.env.PATH || "", conserver);
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

async function qualifier(conserver: string | null, garde: "base" | "candidat"): Promise<number> {
  const h = await choisi(await import("./harnais.ts"));
  const r = h.qualifier(process.env.PATH || "", conserver, garde);
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

async function refusN5(id: string, resultat: string | null): Promise<number> {
  const h = await choisi(await import("./harnais.ts"));
  const st = h.stimuli().find((s) => s.id === id && h.ITEM_N5_REFUS(s.id));
  if (!st) {
    sortie([`épreuve N5 inconnue : ${id}`]);
    return 2;
  }
  const avant = h.compteurs.tentatives;
  const r = h.eprouverRefus(st, process.env.PATH || "");
  if (resultat) writeFileSync(resultat, JSON.stringify({ ...r.resultat, tentatives: h.compteurs.tentatives - avant, appels: [...h.appelsGardes] }) + "\n");
  sortie([`ÉPREUVE N5 ${st.id} (premier refus attendu ${st.regle}, avant lancement)`, ...r.lignes, `gardes appelées : ${h.appelsGardes.join(", ") || "aucune"}`, `RÉSULTAT ${st.id} : ${r.conforme ? "REFUS OBTENU" : "REFUS NON OBTENU"}`]);
  return r.conforme ? 0 : 1;
}

async function contreEpreuveReelle(id: string, conserver: string | null): Promise<number> {
  const h = await choisi(await import("./harnais.ts"));
  const r = h.contreEpreuveReelle(id, process.env.PATH || "", conserver);
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

async function etape0(): Promise<number> {
  const h = await choisi(await import("./harnais.ts"));
  const r = h.etape0(process.env.PATH || "");
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

/** The message of a thrown value, read as the former launcher did: its `message` if truthy, else itself. */
function messageDe(e: unknown): unknown {
  if ((typeof e === "object" || typeof e === "function") && e !== null && "message" in e && e.message) return e.message;
  return e;
}

/** `argv` is the whole process.argv; the --depot <d> prefix is checked, then removed for the positions. */
export async function principal(argv: readonly string[]): Promise<number> {
  const depot = depotDeLaLigne(argv);
  if (depot === null) {
    sortie([USAGE_DEPOT, "ARRÊT — --depot absent, non absolu, non canonique ou non répertoire : rien n'est chargé"]);
    return 2;
  }
  depotChoisi = depot;
  // Les modes historiques lisent leurs arguments par position : le préfixe --depot <d> est retiré.
  const a: readonly string[] = [argv[0] ?? "", argv[1] ?? "", ...argv.slice(4)];
  const [mode, arg, option, valeur] = a.slice(2);
  let code = 2;
  if (mode === "--qualifier-candidat") {
    // L'arbre est vérifié avant tout chargement du harnais.
    if (arg !== ARBRE_N5 || (option !== undefined && option !== "--conserver") || (option === "--conserver" && !valeur)) {
      sortie([`usage : pi-contrats --depot <d> --qualifier-candidat ${ARBRE_N5} [--conserver <dossier>]`, `ARRÊT — arbre ${arg === undefined ? "absent" : arg} : seul ${ARBRE_N5} est admis ; harnais non chargé`]);
      return 2;
    }
    code = await qualifier(option === "--conserver" ? valeur ?? null : null, "candidat");
  } else if (mode === "--refus" && arg) code = await refus(arg, option === "--resultat" ? valeur ?? null : null);
  else if (mode === "--liste-refus" || mode === "--liste-refus-item1") {
    // Sans suffixe : les 38 épreuves historiques ; « -item1 » : M6.14, M6.15 et G-I1-base de l'item 1.
    // Les épreuves G-N5 ne figurent dans aucune de ces deux listes.
    const h = await choisi(await import("./harnais.ts"));
    sortie(h.stimuli().filter((s) => !h.ITEM_N5_REFUS(s.id) && h.ITEM1_REFUS(s.id) === (mode === "--liste-refus-item1")).map((s) => `${s.id}\t${s.regle}`));
    code = 0;
  } else if (mode === "--liste-refus-n5") {
    const h = await choisi(await import("./harnais.ts"));
    sortie(h.CAS_N5.map((c) => `${c.id}\tG-N5/${c.premier}\t${c.clauses.join(",")}`));
    code = 0;
  } else if (mode === "--refus-n5" && arg) code = await refusN5(arg, option === "--resultat" ? valeur ?? null : null);
  else if (mode === "--lecteur-n5" && arg && option) {
    const h = await choisi(await import("./harnais.ts"));
    const reste = a.slice(5);
    const lire = (d: string): string | null => {
      const i = reste.indexOf(d);
      return i >= 0 ? reste[i + 1] ?? null : null;
    };
    // The clause is passed as given; lecteurLocalN5 refuses an undeclared clause, as under R2.
    const r = h.lecteurLocalN5(arg, option as ClauseN5, lire("--conserver"));
    const fichier = lire("--resultat");
    if (fichier) writeFileSync(fichier, JSON.stringify({ ...r, tentatives: h.compteurs.tentatives }) + "\n");
    sortie([`LECTEUR LOCAL N5 ${arg} — clause ${option}`, `  témoin : ${r.temoin}`, `  altéré : ${r.altere}`, `  tentatives de lancement : ${h.compteurs.tentatives}`]);
    code = 0;
  } else if (mode === "--selection-n5" && arg) {
    const h = await choisi(await import("./harnais.ts"));
    // The case is passed as given; selectionN5 refuses an unknown case, as under R2.
    const r = h.selectionN5(arg as Parameters<typeof h.selectionN5>[0]);
    if (option === "--resultat" && valeur) writeFileSync(valeur, JSON.stringify(r) + "\n");
    sortie([`SÉLECTION N5 ${r.cas} — garde demandée ${r.garde}`, `  refus : ${r.refus ?? "aucun"}`, `  relevé : ${r.resultat.slice(0, 400)}`, `  gardes appelées : ${r.appels.join(", ") || "aucune"} ; tentatives de lancement : ${r.tentatives}`]);
    code = 0;
  } else if (mode === "--etape0") code = await etape0();
  else if (mode === "--mesure-prealable" && arg) code = await mesure(arg, option === "--conserver" ? valeur ?? null : null);
  else if (mode === "--qualifier") code = await qualifier(arg === "--conserver" ? option ?? null : null, "base");
  else if (mode === "--contre-epreuve-reelle" && arg) code = await contreEpreuveReelle(arg, option === "--conserver" ? valeur ?? null : null);
  else if (mode === "--contre-epreuve" && arg === "0.99.0") code = await contreEpreuveReelle("C3.1/b-0.99.0", option === "--conserver" ? valeur ?? null : null);
  else if (mode === "--liste-contre-epreuves-reelles") {
    const s = await choisi(await import("./scenarios.ts"));
    sortie(s.CONTRE_EPREUVES_REELLES.map((x) => x.id));
    code = 0;
  } else if (mode === "--contre-epreuves-a" && arg) {
    const h = await choisi(await import("./harnais.ts"));
    const ids = a.slice(4);
    const r = h.contreEpreuvesA(arg.split(":"), ids.length ? ids : undefined);
    sortie(r.lignes);
    code = r.conforme ? 0 : 1;
  } else if (mode === "--reevaluer" && arg && option) {
    const h = await choisi(await import("./harnais.ts"));
    const r = h.reevaluer(arg.split(":"), option);
    const [, , , , , drapeau, fichier] = a;
    if (drapeau === "--resultat" && fichier) writeFileSync(fichier, JSON.stringify(r) + "\n");
    sortie([JSON.stringify(r)]);
    code = 0;
  } else if (mode === "--liste-mutants-verificateurs") {
    const h = await choisi(await import("./harnais.ts"));
    sortie(h.mutantsVerificateurs().map((m) => `${m.id}\t${m.nature}\t${m.cibles.join(",")}`));
    code = 0;
  } else if (mode === "--lecteur-interprete" && arg) {
    // R3 (adjudication a0000800) : contrôle de lecteur M6.15/interprete, sans lancer pi.
    const reste = a.slice(4);
    const alterer = reste.includes("--alterer");
    const i = reste.indexOf("--resultat");
    const fichier = i >= 0 ? reste[i + 1] : null;
    const l = await choisi(await import("./lecteur-interprete.ts"));
    let r;
    try {
      r = l.lecteurInterprete(arg, alterer);
    } catch (e) {
      if (fichier) writeFileSync(fichier, JSON.stringify({ alteration: alterer, erreur: String(messageDe(e)) }) + "\n");
      throw e;
    }
    if (fichier) {
      writeFileSync(fichier, JSON.stringify({ ...r, contexteAnalyse: undefined }, null, 2) + "\n");
      writeFileSync(`${fichier}.contexte.json`, JSON.stringify(r.contexteAnalyse, null, 2) + "\n");
    }
    sortie([
      `LECTEUR M6.15/interprete — entrées ${arg} ; Contexte ${alterer ? "ALTÉRÉ (copie)" : "inchangé"}`,
      `  identité : ${r.identite.fichier} (sha256 ${r.identite.sha256})`,
      `  interprète de ${r.interprete.simulateur} : ${r.interprete.chemin} ; SHA-256 mémorisé ${r.interprete.sha256Declare} ; SHA-256 réel ${r.interprete.sha256Reel}`,
      `  analyse : ${r.resume.evenements} événements, ${r.resume.resolutions} résolutions, ${r.resume.chargements} chargements dont ${r.resume.verifies} vérifiés, ${r.resume.jiti} événements jiti, ${r.resume.fils} processus fils ; admis (M6.15) : ${r.resume.admis.join(", ") || "aucun"}`,
      `  constats : ${r.constats.length ? r.constats.map((c) => `${c.etat} ${c.id} — ${c.detail}`).join(" | ") : "aucun"}`,
    ]);
    code = 0;
  }
  else sortie(["usage : pi-contrats --depot <d> --qualifier-candidat <arbre> [--conserver <dossier>] | --liste-refus-n5 | --refus-n5 <id> | --lecteur-n5 <id> <clause> | --selection-n5 <cas> ; ou, après --depot <d> : --etape0 | --refus <id> | --liste-refus | --mesure-prealable <id> [--conserver <dossier>] | --qualifier [--conserver <dossier>] | --contre-epreuve-reelle <id> [--conserver <dossier>] | --contre-epreuve 0.99.0 | --contre-epreuves-a <dossier> [<id> …] | --reevaluer <dossier> <id> [--resultat <f>] | --liste-contre-epreuves-reelles | --liste-mutants-verificateurs | --lecteur-interprete <entrées> [--alterer] [--resultat <f>]"]);
  return code;
}
