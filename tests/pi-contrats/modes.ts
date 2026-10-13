/**
 * Modes de bin/pi-contrats (LOT-PI-ADAPT), typés.
 *
 * Traduction typée des modes de l'ancien lanceur : mêmes drapeaux et positions d'arguments, mêmes
 * lignes de sortie, mêmes codes (0 conforme, 1 non conforme, 2 usage ou épreuve inconnue ; 3 reste
 * posé par le lanceur sur une exception). Les modules de l'instrument sont chargés à la demande, aux
 * mêmes moments et sous les mêmes URL qu'avant (tests/pi-contrats/<module>.ts).
 *
 * Écarts de forme, sans effet observable : une valeur absente après --conserver ou --resultat est
 * transmise comme null au lieu d'undefined (le harnais ne les teste que par vérité) ; le message
 * d'erreur du lecteur se lit par un rétrécissement de type au lieu d'un accès non typé.
 */
import { writeFileSync } from "node:fs";

function sortie(lignes: string[]): void {
  process.stdout.write(lignes.join("\n") + "\n");
}

async function refus(id: string, resultat: string | null): Promise<number> {
  const h = await import("./harnais.ts");
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
  const h = await import("./harnais.ts");
  const r = h.mesurePrealable(id, process.env.PATH || "", conserver);
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

async function qualifier(conserver: string | null): Promise<number> {
  const h = await import("./harnais.ts");
  const r = h.qualifier(process.env.PATH || "", conserver);
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

async function contreEpreuveReelle(id: string, conserver: string | null): Promise<number> {
  const h = await import("./harnais.ts");
  const r = h.contreEpreuveReelle(id, process.env.PATH || "", conserver);
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

async function etape0(): Promise<number> {
  const h = await import("./harnais.ts");
  const r = h.etape0(process.env.PATH || "");
  sortie(r.lignes);
  return r.conforme ? 0 : 1;
}

/** The message of a thrown value, read as the former launcher did: its `message` if truthy, else itself. */
function messageDe(e: unknown): unknown {
  if ((typeof e === "object" || typeof e === "function") && e !== null && "message" in e && e.message) return e.message;
  return e;
}

/** `argv` is the whole process.argv: positions are those of the former launcher. */
export async function principal(argv: readonly string[]): Promise<number> {
  const [mode, arg, option, valeur] = argv.slice(2);
  let code = 2;
  if (mode === "--refus" && arg) code = await refus(arg, option === "--resultat" ? valeur ?? null : null);
  else if (mode === "--liste-refus" || mode === "--liste-refus-item1") {
    // Sans suffixe : les 38 épreuves historiques ; « -item1 » : M6.14, M6.15 et G-I1-base de l'item 1.
    const h = await import("./harnais.ts");
    sortie(h.stimuli().filter((s) => h.ITEM1_REFUS(s.id) === (mode === "--liste-refus-item1")).map((s) => `${s.id}\t${s.regle}`));
    code = 0;
  } else if (mode === "--etape0") code = await etape0();
  else if (mode === "--mesure-prealable" && arg) code = await mesure(arg, option === "--conserver" ? valeur ?? null : null);
  else if (mode === "--qualifier") code = await qualifier(arg === "--conserver" ? option ?? null : null);
  else if (mode === "--contre-epreuve-reelle" && arg) code = await contreEpreuveReelle(arg, option === "--conserver" ? valeur ?? null : null);
  else if (mode === "--contre-epreuve" && arg === "0.99.0") code = await contreEpreuveReelle("C3.1/b-0.99.0", option === "--conserver" ? valeur ?? null : null);
  else if (mode === "--liste-contre-epreuves-reelles") {
    const s = await import("./scenarios.ts");
    sortie(s.CONTRE_EPREUVES_REELLES.map((x) => x.id));
    code = 0;
  } else if (mode === "--contre-epreuves-a" && arg) {
    const h = await import("./harnais.ts");
    const ids = argv.slice(4);
    const r = h.contreEpreuvesA(arg.split(":"), ids.length ? ids : undefined);
    sortie(r.lignes);
    code = r.conforme ? 0 : 1;
  } else if (mode === "--reevaluer" && arg && option) {
    const h = await import("./harnais.ts");
    const r = h.reevaluer(arg.split(":"), option);
    const [, , , , , drapeau, fichier] = argv;
    if (drapeau === "--resultat" && fichier) writeFileSync(fichier, JSON.stringify(r) + "\n");
    sortie([JSON.stringify(r)]);
    code = 0;
  } else if (mode === "--liste-mutants-verificateurs") {
    const h = await import("./harnais.ts");
    sortie(h.mutantsVerificateurs().map((m) => `${m.id}\t${m.nature}\t${m.cibles.join(",")}`));
    code = 0;
  } else if (mode === "--lecteur-interprete" && arg) {
    // R3 (adjudication a0000800) : contrôle de lecteur M6.15/interprete, sans lancer pi.
    const reste = argv.slice(4);
    const alterer = reste.includes("--alterer");
    const i = reste.indexOf("--resultat");
    const fichier = i >= 0 ? reste[i + 1] : null;
    const l = await import("./lecteur-interprete.ts");
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
  else sortie(["usage : pi-contrats --etape0 | --refus <id> | --liste-refus | --mesure-prealable <id> [--conserver <dossier>] | --qualifier [--conserver <dossier>] | --contre-epreuve-reelle <id> [--conserver <dossier>] | --contre-epreuve 0.99.0 | --contre-epreuves-a <dossier> [<id> …] | --reevaluer <dossier> <id> [--resultat <f>] | --liste-contre-epreuves-reelles | --liste-mutants-verificateurs | --lecteur-interprete <entrées> [--alterer] [--resultat <f>]"]);
  return code;
}
