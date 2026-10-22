/**
 * profil.ts — profil simple par défaut, sous-agents sur commande (phase 2).
 *
 * Module feuille, pur : ni pi, ni disque, ni git. L'extension `subagent` relève l'état de
 * l'espace des runs (découverte fermée, plan § 4.2) et lui passe ce relevé ; ce module le classe,
 * décide des commandes `/subagents`, de la règle de lecture seule et de la liste d'outils, et
 * rédige les textes des refus et de l'avertissement. Tout ce qui décide est ici, pour que le
 * contrat se prouve sans monter l'extension (K) et que l'extension se prouve sur son
 * application (H, R).
 *
 * Classes, par priorité (la première qui s'applique) :
 *
 *   illisible     échec d'inspection ; marqueur existant invalide (manifeste présent ou non) ;
 *                 liste du répertoire impossible ; pièces non identifiables sans manifeste ;
 *                 manifeste illisible ou invalide ; registre des lanes ou des intégrations
 *                 inexploitable ; plan attaché incohérent ; toute exception de lecture
 *   absent        absence établie du manifeste, sans pièce non identifiable
 *   terminé       statut completed ou abandoned
 *   vide          planning, nextSeq = 1, sans continuation_block, sans plan attaché, aucune entrée
 *                 de l'espace préfixée par le runId, aucune lane observée
 *   non terminé   planning ou active, et non vide
 *
 * Illisible n'est jamais absent : une absence se prouve (`ENOENT`), un échec ne prouve rien.
 */

export type Profil = "simple" | "sous-agents";
export type Classe = "illisible" | "absent" | "termine" | "vide" | "non-termine";
export type StatutRun = "planning" | "active" | "completed" | "abandoned";

/** L'issue d'un `lstat` : absence établie, présence de la forme attendue, ou échec. */
export type Inspection = { etat: "absent" } | { etat: "present" } | { etat: "echec"; raison: string };

export type EtatDuMarqueur = { etat: "absent" } | { etat: "valide" } | { etat: "invalide"; raison: string };

/** Ce que les observateurs communs ont rendu pour le run identifié par le manifeste. */
export type LectureDuRun =
  | { ok: false; raison: string }
  | {
      ok: true;
      runId: string;
      statut: StatutRun;
      nextSeq: number;
      continuation: boolean;
      lanes: { ok: true; unitesOuvertes: string[]; lanesObservees: number } | { ok: false; raison: string };
      integrations: { ok: true } | { ok: false; raison: string };
      plan: { etat: "non-attache" } | { etat: "attache" } | { etat: "rompu"; raison: string };
    };

/** Le relevé de la découverte. Les champs absents n'ont pas été lus, faute d'objet. */
export interface Releve {
  espace: Inspection;
  manifeste?: Inspection;
  marqueur?: EtatDuMarqueur;
  entrees?: { ok: true; noms: string[] } | { ok: false; raison: string };
  run?: LectureDuRun;
  /** Une exception pendant la découverte : la classe est illisible, jamais absente ni vide. */
  exception?: string;
}

export interface Classement {
  classe: Classe;
  /** La raison d'une classe illisible, dite à l'opérateur. */
  raison?: string;
  runId?: string;
  statut?: StatutRun;
  unitesOuvertes: string[];
}

/** Le nom du marqueur de l'espace des runs (repo-preflight.ts, `MARQUEUR`). */
export const NOM_MARQUEUR = ".git";

/** Q-P2-24 : une archive `<id>-run.json`, l'identité dans la grammaire du runtime : 16 chiffres hexadécimaux minuscules. */
const ARCHIVE = /^([0-9a-f]{16})-run\.json$/;

/**
 * Les entrées d'un espace sans manifeste qui ne permettent pas d'identifier sûrement le run.
 *
 * Sont admis : le marqueur, les archives `<id>-run.json` (`<id>` dans la grammaire du runtime), les pièces `<id>-…`
 * d'un run dont l'archive existe et, de nom exact, son bail `<id>.lease` (Q-P2-24 : admission
 * nominale, ni acquisition ni validation du propriétaire). Tout le reste — garde de transition
 * `<id>.guard`, autre pièce `<id>.…`, bail sans archive, garde `.espace.guard`, registre sans archive,
 * préparation de marqueur, entrée inconnue — est rendu ici.
 */
export function piecesNonIdentifiables(noms: readonly string[]): string[] {
  const archives = new Set<string>();
  for (const n of noms) {
    const m = ARCHIVE.exec(n);
    if (m) archives.add(m[1]);
  }
  const archivee = (n: string): boolean => {
    for (const id of archives) if (n.startsWith(`${id}-`) || n === `${id}.lease`) return true;
    return false;
  };
  return noms.filter((n) => n !== NOM_MARQUEUR && !ARCHIVE.test(n) && !archivee(n)).sort();
}

const illisible = (raison: string, base: Partial<Classement> = {}): Classement => ({
  unitesOuvertes: [],
  ...base,
  classe: "illisible",
  raison,
});

/** Le classement d'un relevé, par la seule priorité de l'en-tête. */
export function classer(r: Releve): Classement {
  if (r.exception !== undefined) return illisible(`la découverte a échoué : ${r.exception}`);
  if (r.espace.etat === "echec") return illisible(`l'espace des runs ne s'inspecte pas : ${r.espace.raison}`);
  if (r.espace.etat === "absent") return { classe: "absent", unitesOuvertes: [] };

  // L'espace existe : le marqueur et la liste se lisent, que le manifeste existe ou non.
  if (r.marqueur === undefined) return illisible("le marqueur n'a pas été inspecté");
  if (r.marqueur.etat === "invalide") return illisible(`marqueur de l'espace des runs invalide : ${r.marqueur.raison}`);
  if (r.entrees === undefined) return illisible("l'espace des runs n'a pas été listé");
  if (!r.entrees.ok) return illisible(`l'espace des runs ne se liste pas : ${r.entrees.raison}`);
  if (r.manifeste === undefined) return illisible("le manifeste n'a pas été inspecté");
  if (r.manifeste.etat === "echec") return illisible(`le manifeste ne s'inspecte pas : ${r.manifeste.raison}`);

  if (r.manifeste.etat === "absent") {
    const autres = piecesNonIdentifiables(r.entrees.noms);
    if (autres.length > 0) {
      return illisible(
        `manifeste absent, mais des pièces ne permettent pas d'identifier le run courant : ${autres.join(", ")}`,
      );
    }
    return { classe: "absent", unitesOuvertes: [] };
  }

  const run = r.run;
  if (run === undefined) return illisible("le run n'a pas été lu");
  if (!run.ok) return illisible(`manifeste illisible ou invalide : ${run.raison}`);
  const base = { runId: run.runId, statut: run.statut };
  if (!run.lanes.ok) return illisible(`registre des lanes inexploitable : ${run.lanes.raison}`, base);
  if (!run.integrations.ok) return illisible(`registre des intégrations inexploitable : ${run.integrations.raison}`, base);
  if (run.plan.etat === "rompu") return illisible(`plan attaché incohérent : ${run.plan.raison}`, base);

  const unitesOuvertes = [...run.lanes.unitesOuvertes].sort();
  if (run.statut === "completed" || run.statut === "abandoned") return { classe: "termine", ...base, unitesOuvertes };
  const prefixees = r.entrees.noms.filter((n) => n.startsWith(`${run.runId}-`) || n.startsWith(`${run.runId}.`));
  const vide =
    run.statut === "planning" &&
    run.nextSeq === 1 &&
    !run.continuation &&
    run.plan.etat === "non-attache" &&
    prefixees.length === 0 &&
    run.lanes.lanesObservees === 0 &&
    unitesOuvertes.length === 0;
  return { classe: vide ? "vide" : "non-termine", ...base, unitesOuvertes };
}

/** La lecture seule en profil simple : un run non terminé, ou un état qu'on ne sait pas lire. */
export function lectureSeuleRequise(c: Classement): boolean {
  return c.classe === "non-termine" || c.classe === "illisible";
}

// ---------------------------------------------------------------------------- textes

export const VERBES_RECOVER =
  "`bin/subagent-recover report`, `bin/subagent-recover run completed|abandoned --reason <raison>`, " +
  "`bin/subagent-recover cleanup`, `bin/subagent-recover <unité> adopt|integrated|abandoned|discard`";

/** Ce qui désigne le run : identité, statut, unités ouvertes — ou la raison d'illisibilité. */
export function designation(c: Classement): string {
  if (c.classe === "illisible") {
    const id = c.runId ? `run ${c.runId}${c.statut ? ` (${c.statut})` : ""} — ` : "";
    return `${id}état durable illisible : ${c.raison ?? "raison inconnue"}`;
  }
  if (c.classe === "absent") return "aucun run dans l'espace des runs";
  const unites = c.unitesOuvertes.length > 0 ? `unités ouvertes ${c.unitesOuvertes.join(", ")}` : "aucune unité ouverte";
  return `run ${c.runId} (${c.statut}), ${unites}`;
}

const NOMS_CLASSE: Record<Classe, string> = {
  illisible: "illisible",
  absent: "absent",
  termine: "terminé",
  vide: "vide",
  "non-termine": "non terminé",
};
export const nomClasse = (c: Classe): string => NOMS_CLASSE[c];

/** L'avertissement de démarrage (§ 6) : projection pure du classement, rien pour absent, vide, terminé. */
export function avertissement(c: Classement): string | undefined {
  if (!lectureSeuleRequise(c)) return undefined;
  return (
    `Run durable ${nomClasse(c.classe)} : ${designation(c)}.\n` +
    "Profil simple en lecture seule : seule la lecture native vérifiée passe, rien n'est écrit.\n" +
    "Suites : `/subagents on` pour reprendre le run en profil sous-agents, `/subagent-report` pour le relevé, " +
    `ou l'outil opérateur : ${VERBES_RECOVER}.`
  );
}

/** Le refus d'un appel en lecture seule (T10). */
export function refusLectureSeule(c: Classement): string {
  return (
    `Refusé : profil simple en lecture seule — ${designation(c)} (classe ${nomClasse(c.classe)}). ` +
    "Seule la lecture native vérifiée passe. Sorties : `/subagents on`, ou " +
    "`bin/subagent-recover run completed|abandoned --reason <raison>` puis `bin/subagent-recover report`."
  );
}

/** Le refus de `task` hors du profil sous-agents (T12). */
export const REFUS_PROFIL_SIMPLE = "Refusé : profil simple — `/subagents on` pour l'activer.";

/** Le refus de `task` quand la délégation de l'exécution courante n'est pas composée (Q-P2-4). */
export const REFUS_DELEGATION_NON_COMPOSEE =
  "Refusé : délégation non composée pour cette exécution — les instructions de délégation n'ont pas été " +
  "établies dans le prompt de cette requête. Rien n'a été réservé ni lancé.";

export const USAGE_SUBAGENTS =
  "Usage : `/subagents` (état), `/subagents on` (profil sous-agents), `/subagents off` (profil simple).";

// ---------------------------------------------------------------------------- décisions

export interface EtatDeCommande {
  profil: Profil;
  /** `ctx.isIdle()`, aucun appel d'outil en vol, aucune exécution de `task` en cours. */
  repos: boolean;
  /** `subagent-only/DELEGATION.md` lu à l'instant. */
  delegationLisible: boolean;
}

export type DecisionDeCommande =
  | { action: "rendre"; texte: string }
  | { action: "monter" }
  | { action: "descendre" }
  | { action: "refus"; texte: string }
  | { action: "usage"; texte: string };

/** L'état, rendu par `/subagents`, `/subagents on` en sous-agents, `/subagents off` en simple. */
export function etatRendu(profil: Profil, c: Classement, composition?: string): string {
  const lignes = [
    `Profil : ${profil === "simple" ? "simple" : "sous-agents"}.`,
    `Run : ${designation(c)} (classe ${nomClasse(c.classe)}).`,
  ];
  if (profil === "simple" && lectureSeuleRequise(c)) lignes.push("Lecture seule : oui.");
  if (composition) lignes.push(`Délégation : ${composition}.`);
  return lignes.join("\n");
}

/**
 * Les transitions T2 à T7 : la décision sur l'état qu'on vient de relire.
 *
 * Le refus de montée est une dérogation explicite au « toujours autorisée » du 13-09, limitée
 * à ses préconditions ; un refus n'a aucun effet.
 */
export function deciderCommande(argument: string, s: EtatDeCommande, c: Classement, composition?: string): DecisionDeCommande {
  const arg = argument.trim();
  if (arg === "") return { action: "rendre", texte: etatRendu(s.profil, c, composition) };
  if (arg === "on") {
    if (s.profil === "sous-agents") return { action: "rendre", texte: etatRendu(s.profil, c, composition) };
    if (!s.repos) return { action: "refus", texte: "Montée refusée : la session n'est pas au repos. Rien n'a changé." };
    if (c.classe === "illisible") {
      return {
        action: "refus",
        texte:
          `Montée refusée : ${designation(c)}. Rien n'a été ouvert ni écrit. ` +
          `Relevé : \`/subagent-report\` ; outil opérateur : ${VERBES_RECOVER}.`,
      };
    }
    if (!s.delegationLisible) {
      return { action: "refus", texte: "Montée refusée : subagent-only/DELEGATION.md est absent ou illisible. Rien n'a changé." };
    }
    return { action: "monter" };
  }
  if (arg === "off") {
    if (s.profil === "simple") return { action: "rendre", texte: etatRendu(s.profil, c, composition) };
    if (!s.repos) return { action: "refus", texte: "Descente refusée : la session n'est pas au repos. Rien n'a changé." };
    if (c.classe === "non-termine" || c.classe === "illisible") {
      return {
        action: "refus",
        texte:
          `Descente refusée : ${designation(c)} (classe ${nomClasse(c.classe)}). Le run n'est pas terminé ; ` +
          `il se termine par l'outil opérateur : ${VERBES_RECOVER}. Rien n'a changé.`,
      };
    }
    return { action: "descendre" };
  }
  return { action: "usage", texte: USAGE_SUBAGENTS };
}

/** T10 : un appel en profil simple. `lectureVerifiee` vient de `outilLectureVerifie`. */
export function decisionAppelSimple(
  c: Classement,
  nom: unknown,
  lectureVerifiee: (nom: string) => boolean,
): { bloquer: false } | { bloquer: true; raison: string } {
  if (!lectureSeuleRequise(c)) return { bloquer: false };
  if (typeof nom === "string" && nom !== "" && lectureVerifiee(nom)) return { bloquer: false };
  return { bloquer: true, raison: refusLectureSeule(c) };
}

/**
 * La liste d'outils actifs que le profil impose (§ 4.5).
 *
 * `base` est la liste relevée au `session_start`, avant toute restriction ; `enregistres` les
 * outils que pi connaît. Jamais « tous les outils enregistrés », jamais `task` en simple.
 */
export function outilsDuProfil(input: {
  profil: Profil;
  base: readonly string[];
  enregistres: readonly string[];
  lectureSeule: boolean;
  p0cTerminal: boolean;
  lectureVerifiee: (nom: string) => boolean;
}): string[] {
  const connus = new Set(input.enregistres);
  const base = [...new Set(input.base)].filter((n) => connus.has(n) && n !== "task");
  if (input.profil === "simple") return input.lectureSeule ? base.filter(input.lectureVerifiee) : base;
  if (input.p0cTerminal) return base.filter(input.lectureVerifiee);
  return connus.has("task") ? [...base, "task"] : base;
}

// ---------------------------------------------------------------------------- composition

/** La section `delegation` telle que pi 0.86.0 la rend (system-prompt.js : `<nom>\ncontenu\n</nom>`). */
export function blocDeDelegation(texte: string): string {
  return `<delegation>\n${texte}\n</delegation>`;
}

/** Des guidelines telles que pi les rend dans ses règles : une puce par règle, normalisée par `trim`. */
export function lignesDeGuidelines(guidelines: readonly string[]): string[] {
  const vues = new Set<string>();
  const lignes: string[] = [];
  for (const g of guidelines) {
    const n = g.trim();
    if (!n || vues.has(n)) continue;
    vues.add(n);
    lignes.push(`- ${n}`);
  }
  return lignes;
}

/**
 * La voie (a) : compléter un prompt déjà forcé (Q-P2-1, bornes 1 à 5 ; Q-P2-4).
 *
 * Le texte préexistant est gardé à l'octet ; on n'ajoute à la fin que ce qui manque — le bloc de
 * délégation s'il n'y figure pas à l'octet, les puces dues qui n'y figurent pas, dans un bloc
 * `<rules>` rendu comme pi rend le sien. Rien n'est ajouté deux fois.
 *
 * `complete` dit si, après ajout, toutes les contributions dues sont présentes ; c'est la seule
 * chose sur laquelle l'état de composition peut se fonder.
 */
export function completerPromptForce(
  prompt: string,
  delegation: string,
  guidelinesDues: readonly string[],
): { prompt: string; ajoute: boolean; complete: boolean } {
  const bloc = blocDeDelegation(delegation);
  const ajouts: string[] = [];
  if (!prompt.includes(bloc)) ajouts.push(bloc);
  const manquantes = lignesDeGuidelines(guidelinesDues).filter((l) => !lignePresente(prompt, l));
  if (manquantes.length > 0) ajouts.push(`<rules>\n${manquantes.join("\n")}\n</rules>`);
  if (ajouts.length === 0) return { prompt, ajoute: false, complete: true };
  const resultat = `${prompt}\n\n${ajouts.join("\n\n")}`;
  return { prompt: resultat, ajoute: true, complete: compositionPresente(resultat, delegation, guidelinesDues) };
}

function lignePresente(texte: string, ligne: string): boolean {
  return texte.split("\n").some((l) => l === ligne);
}

/** Toutes les contributions dues figurent-elles dans un prompt rendu ? */
export function compositionPresente(prompt: string, delegation: string, guidelinesDues: readonly string[]): boolean {
  if (!prompt.includes(blocDeDelegation(delegation))) return false;
  return lignesDeGuidelines(guidelinesDues).every((l) => lignePresente(prompt, l));
}
