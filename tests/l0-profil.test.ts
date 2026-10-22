/**
 * l0-profil.test.ts — phase 2, contrat pur du profil (K) : `subagent-only/profil.ts`.
 *
 * Plan v3.1 § 12.1. Chaque preuve est une couverture : verte sur le candidat, rouge sur son
 * mutant (tests/l0-mutants.json, M-K). Rien de pi, du disque ni de git n'est chargé ici : le
 * relevé est construit à la main, comme la découverte de l'extension le produit.
 *
 *   classes        K01–K20, K17b, K27–K29 : la priorité illisible, absent, terminé, vide, non terminé ;
 *                  K35 : preuves `ite-p0b/` de runs archivés sans manifeste (Q-P2-14)
 *   commandes      K21 : T2–T7, préconditions et argument inconnu
 *   textes         K22, K23 : refus et avertissement nomment le run et l'outil opérateur
 *   lecture seule  K24 : la provenance native décide, jamais le nom seul
 *   outils         K25 : la base, les restrictions, la levée ; jamais tous les outils
 *   chemins        K26 : aucun chemin de registre sur un runId vide
 *   composition    K30–K32 : voie (a), ajout à la fin, une seule fois, composition partielle
 *   séparateur     K33 : refus de montée sur illisible, un seul point après la raison ; K34 : avertissement, idem
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  avertissement, blocDeDelegation, classer, completerPromptForce, compositionPresente, decisionAppelSimple, designation,
  deciderCommande, ID_RUN, jugerPreuvesP0B, NOM_PREUVES_P0B, outilsDuProfil, piecesNonIdentifiables,
  refusLectureSeule, REFUS_PROFIL_SIMPLE, USAGE_SUBAGENTS, VERBES_RECOVER, type Inspection, type LectureDuRun,
  type PreuvesP0B, type Releve,
} from "../subagent-only/profil.ts";
// K35 : le nom du dossier est celui de P0-B. Seule la constante est lue ; rien n'est exécuté.
import { DOSSIER_PREUVES_P0B } from "../subagent-only/empreinte.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function couverture(id: string, titre: string, fn: Preuve): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}

const RUN = "0123456789abcdef";

function lu(extra: Partial<Extract<LectureDuRun, { ok: true }>> = {}): LectureDuRun {
  return {
    ok: true,
    runId: RUN,
    statut: "planning",
    nextSeq: 1,
    continuation: false,
    lanes: { ok: true, unitesOuvertes: [], lanesObservees: 0 },
    integrations: { ok: true },
    plan: { etat: "non-attache" },
    ...extra,
  };
}

/** Un espace présent, un marqueur valide, un manifeste présent : le cas le plus courant. */
function releve(extra: Partial<Releve> = {}, noms: string[] = [".git", "active-run.json"]): Releve {
  return {
    espace: { etat: "present" },
    manifeste: { etat: "present" },
    marqueur: { etat: "valide" },
    entrees: { ok: true, noms },
    run: lu(),
    ...extra,
  };
}
const classe = (r: Releve) => classer(r).classe;
const LECTURE = new Set(["read", "grep", "find", "ls"]);
const natif = (n: string) => LECTURE.has(n);

// ---------------------------------------------------------------------------- classes

couverture("P2-K01", "espace des runs absent : absent, descente admise, pas de lecture seule", () => {
  const c = classer({ espace: { etat: "absent" } });
  propriete(c.classe === "absent", `classe ${c.classe}`);
  const d = deciderCommande("off", { profil: "sous-agents", repos: true, delegationLisible: true }, c);
  propriete(d.action === "descendre", `descente ${d.action}`);
  propriete(decisionAppelSimple(c, "write", natif).bloquer === false, "aucune lecture seule sur un espace absent");
});

couverture("P2-K02", "espace présent, manifeste absent, aucune autre pièce : absent", () => {
  propriete(classe(releve({ manifeste: { etat: "absent" }, run: undefined }, [".git"])) === "absent", "absent attendu");
  propriete(classe(releve({ manifeste: { etat: "absent" }, run: undefined }, [])) === "absent", "absent attendu, espace vide");
});

couverture("P2-K03", "inspection de l'espace en échec : illisible, jamais absent", () => {
  for (const raison of ["EACCES", "ENOTDIR", "ELOOP"]) {
    const c = classer({ espace: { etat: "echec", raison } });
    propriete(c.classe === "illisible", `${raison} : ${c.classe}`);
  }
});

couverture("P2-K04", "espace non répertoire, manifeste non ordinaire : illisible", () => {
  propriete(classer({ espace: { etat: "echec", raison: "pas un répertoire réel" } }).classe === "illisible", "espace");
  propriete(classe(releve({ manifeste: { etat: "echec", raison: "lien symbolique" }, run: undefined })) === "illisible", "manifeste");
});

couverture("P2-K05", "planning, nextSeq 1, aucune entrée préfixée, aucune lane : vide", () => {
  propriete(classe(releve()) === "vide", `classe ${classe(releve())}`);
});

couverture("P2-K06", "un plan attaché rend le run non vide", () => {
  propriete(classe(releve({ run: lu({ plan: { etat: "attache" } }) })) === "non-termine", "non terminé attendu");
});

couverture("P2-K07", "nextSeq > 1 rend le run non vide", () => {
  propriete(classe(releve({ run: lu({ nextSeq: 2 }) })) === "non-termine", "non terminé attendu");
});

couverture("P2-K08", "un continuation_block rend le run non vide", () => {
  propriete(classe(releve({ run: lu({ continuation: true }) })) === "non-termine", "non terminé attendu");
});

couverture("P2-K09", "une entrée préfixée par le runId rend le run non vide", () => {
  for (const n of [`${RUN}-refusals.jsonl`, `${RUN}-plan.json`, `${RUN}.lease`]) {
    propriete(classe(releve({}, [".git", "active-run.json", n])) === "non-termine", `${n} : non terminé attendu`);
  }
});

couverture("P2-K10", "un run active est non terminé", () => {
  propriete(classe(releve({ run: lu({ statut: "active" }) })) === "non-termine", "non terminé attendu");
});

couverture("P2-K11", "completed et abandoned sont terminés, lanes à ranger comprises", () => {
  propriete(classe(releve({ run: lu({ statut: "completed" }) })) === "termine", "completed");
  propriete(classe(releve({ run: lu({ statut: "abandoned" }) })) === "termine", "abandoned");
  const avecLanes = lu({ statut: "completed", nextSeq: 9, lanes: { ok: true, unitesOuvertes: ["W01"], lanesObservees: 2 } });
  propriete(classe(releve({ run: avecLanes }, [".git", "active-run.json", `${RUN}-lanes.jsonl`])) === "termine", "completed avec lanes");
});

couverture("P2-K12", "manifeste illisible, version inconnue ou runId absent : illisible", () => {
  for (const raison of ["JSON illisible", "version 9", "runId absent"]) {
    propriete(classe(releve({ run: { ok: false, raison } })) === "illisible", raison);
  }
});

couverture("P2-K13", "un marqueur existant invalide rend l'état illisible", () => {
  propriete(classe(releve({ marqueur: { etat: "invalide", raison: "HEAD absent" } })) === "illisible", "illisible attendu");
});

couverture("P2-K14", "une liste du répertoire impossible rend l'état illisible", () => {
  propriete(classe(releve({ entrees: { ok: false, raison: "EACCES" } })) === "illisible", "illisible attendu");
});

couverture("P2-K15", "un registre des lanes partiel ou malformé rend l'état illisible", () => {
  propriete(classe(releve({ run: lu({ lanes: { ok: false, raison: "ligne illisible" } }) })) === "illisible", "illisible attendu");
});

couverture("P2-K16", "un plan attaché incohérent rend l'état illisible", () => {
  propriete(classe(releve({ run: lu({ plan: { etat: "rompu", raison: "empreinte changée" } }) })) === "illisible", "illisible attendu");
});

couverture("P2-K17", "registre des intégrations inexploitable, run planning ou active : illisible", () => {
  for (const statut of ["planning", "active"] as const) {
    const r = releve({ run: lu({ statut, nextSeq: 3, integrations: { ok: false, raison: "UNKNOWN" } }) });
    propriete(classe(r) === "illisible", `${statut} : ${classe(r)}`);
  }
});

couverture("P2-K17b", "registre des intégrations inexploitable, run terminé : illisible, jamais terminé", () => {
  for (const statut of ["completed", "abandoned"] as const) {
    const r = releve({ run: lu({ statut, integrations: { ok: false, raison: "LOST" } }) });
    propriete(classe(r) === "illisible", `${statut} : ${classe(r)}`);
  }
});

couverture("P2-K18", "priorité : illisible et terminé à la fois donne illisible", () => {
  const r = releve({ run: lu({ statut: "completed", lanes: { ok: false, raison: "partiel" } }) });
  propriete(classe(r) === "illisible", `classe ${classe(r)}`);
});

couverture("P2-K19", "des archives historiques ne changent pas la classe du run courant", () => {
  // Q-P2-24 : l'identité des archives suit la grammaire du runtime (ID_RUN).
  const archives = [".git", "aaaaaaaaaaaaaaaa-run.json", "aaaaaaaaaaaaaaaa-lanes.jsonl", "aaaaaaaaaaaaaaaa.lease"];
  propriete(classe(releve({ manifeste: { etat: "absent" }, run: undefined }, archives)) === "absent", "absent avec archives");
  propriete(classe(releve({ run: lu({ statut: "completed" }) }, [...archives, "active-run.json"])) === "termine", "terminé avec archives");
});

couverture("P2-K20", "une exception de lecture donne illisible, jamais absent ni vide", () => {
  propriete(classer({ espace: { etat: "absent" }, exception: "boom" }).classe === "illisible", "espace absent + exception");
  propriete(classe({ ...releve(), exception: "boom" }) === "illisible", "relevé vide + exception");
});

couverture("P2-K27", "manifeste absent, marqueur existant invalide : illisible, jamais absent", () => {
  const r = releve({ manifeste: { etat: "absent" }, run: undefined, marqueur: { etat: "invalide", raison: "partiel" } }, [".git"]);
  propriete(classe(r) === "illisible", `classe ${classe(r)}`);
});

couverture("P2-K28", "manifeste absent, pièces non identifiables : illisible", () => {
  for (const n of [`${RUN}.lease`, ".espace.guard", `${RUN}-lanes.jsonl`, "inconnu.txt", ".git.preparation-1-ab"]) {
    const r = releve({ manifeste: { etat: "absent" }, run: undefined }, [".git", n]);
    propriete(classe(r) === "illisible", `${n} : ${classe(r)}`);
  }
  // Q-P2-24 : d'un run archivé, seul le bail de nom exact est admis ; la garde de transition et toute
  // autre pièce `<id>.…` restent non identifiables. L'archive suit la grammaire de l'identité (ID_RUN).
  const A = "aaaaaaaaaaaaaaaa";
  for (const n of [`${A}.guard`, `${A}.autre`, `${A}.lease.x`]) {
    const r = releve({ manifeste: { etat: "absent" }, run: undefined }, [".git", `${A}-run.json`, n]);
    propriete(classe(r) === "illisible", `${n} d'un run archivé : ${classe(r)}`);
  }
  const court = releve({ manifeste: { etat: "absent" }, run: undefined }, [".git", "aaaa-run.json", "aaaa.lease"]);
  propriete(classe(court) === "illisible", `identité hors grammaire : ${classe(court)}`);
  propriete(
    piecesNonIdentifiables([".git", `${A}-run.json`, `${A}-lanes.jsonl`, `${A}.lease`, `${A}.guard`, `${RUN}.lease`]).join() ===
      [`${A}.guard`, `${RUN}.lease`].sort().join(),
    "seuls la garde et le bail sans archive sont non identifiables",
  );
});

couverture("P2-K29", "manifeste absent, seulement marqueur valide, archives et pièces archivées : absent", () => {
  const A = "aaaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbbb";
  const noms = [".git", `${A}-run.json`, `${A}-lanes.jsonl`, `${A}-integrations.jsonl`, `${A}.lease`, `${B}-run.json`];
  propriete(classe(releve({ manifeste: { etat: "absent" }, run: undefined }, noms)) === "absent", "absent attendu");
});

couverture("P2-K35", "manifeste absent, ite-p0b : seules les preuves fichiers de runs archivés sont admises", () => {
  const A = "aaaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbbb";
  const ok: Inspection = { etat: "present" };
  const preuve = (id: string, n = 1) => `${id}-2026-10-18T12-00-0${n}-000Z-a1b2c3.json`;
  const present = (entrees: Array<[string, Inspection]>, archives: Record<string, Inspection>): PreuvesP0B =>
    ({ etat: "present", entrees: entrees.map(([nom, inspection]) => ({ nom, inspection })), archives });
  const base = [".git", `${A}-run.json`, `${A}-lanes.jsonl`, `${B}-run.json`];
  const cas = (noms: string[], p: PreuvesP0B | undefined) =>
    classer(releve({ manifeste: { etat: "absent" }, run: undefined, preuvesP0B: p }, noms));

  propriete(NOM_PREUVES_P0B === DOSSIER_PREUVES_P0B, `nom du dossier : ${NOM_PREUVES_P0B} ≠ ${DOSSIER_PREUVES_P0B}`);
  propriete(ID_RUN.test(A) && !ID_RUN.test("aaaaaaaaaaaaaaa") && !ID_RUN.test("AAAAAAAAAAAAAAAA"), "grammaire de l'identité");

  // Admis : absent de la liste, vide, preuves de plusieurs runs archivés.
  const admis: Array<[string, string[], PreuvesP0B | undefined]> = [
    ["absent de la liste", base, undefined],
    ["répertoire vide", [...base, NOM_PREUVES_P0B], present([], {})],
    ["plusieurs runs archivés", [...base, NOM_PREUVES_P0B],
      present([[preuve(A), ok], [preuve(A, 2), ok], [preuve(B), ok]], { [A]: ok, [B]: ok })],
  ];
  for (const [nom, noms, p] of admis) {
    const c = cas(noms, p);
    propriete(c.classe === "absent", `${nom} : ${c.classe} (${c.raison ?? ""})`);
  }

  // Refusés : illisible, raison nommée.
  const C = "cccccccccccccccc";
  const approchant = "aaaaaaaaaaaaaaab";
  const refuses: Array<[string, string[], PreuvesP0B | undefined, string]> = [
    ["preuve sans archive", [...base, NOM_PREUVES_P0B], present([[preuve(C), ok]], {}), "aucune archive"],
    ["préfixe approchant", [...base, NOM_PREUVES_P0B], present([[preuve(approchant), ok]], {}), "aucune archive"],
    ["nom hors grammaire", [...base, NOM_PREUVES_P0B], present([["notes.txt", ok]], {}), "nom inconnu"],
    ["majuscules", [...base, NOM_PREUVES_P0B], present([[preuve("AAAAAAAAAAAAAAAA"), ok]], {}), "nom inconnu"],
    ["quinze chiffres", [...base, NOM_PREUVES_P0B], present([["aaaaaaaaaaaaaaa-x.json", ok]], {}), "nom inconnu"],
    ["suffixe vide", [...base, NOM_PREUVES_P0B], present([[`${A}-`, ok]], { [A]: ok }), "nom inconnu"],
    ["entrée en lien", [...base, NOM_PREUVES_P0B],
      present([[preuve(A), { etat: "echec", raison: "x n'est pas un fichier ordinaire" }]], { [A]: ok }), "fichier ordinaire"],
    ["sous-répertoire", [...base, NOM_PREUVES_P0B],
      present([[A, { etat: "echec", raison: `${A} n'est pas un fichier ordinaire` }]], {}), "fichier ordinaire"],
    ["ite-p0b non répertoire", [...base, NOM_PREUVES_P0B],
      { etat: "echec", raison: "ite-p0b n'est pas un répertoire réel" }, "répertoire réel"],
    ["erreur d'inspection", [...base, NOM_PREUVES_P0B], { etat: "echec", raison: "EACCES sur ite-p0b" }, "EACCES"],
    ["erreur de liste", [...base, NOM_PREUVES_P0B], { etat: "echec", raison: "ne se liste pas : EIO" }, "EIO"],
    ["erreur d'une entrée", [...base, NOM_PREUVES_P0B], present([[preuve(A), { etat: "echec", raison: "EACCES sur p" }]], { [A]: ok }), "EACCES"],
    ["entrée disparue", [...base, NOM_PREUVES_P0B], present([[preuve(A), { etat: "absent" }]], { [A]: ok }), "disparu"],
    ["archive en lien", [...base, NOM_PREUVES_P0B],
      present([[preuve(A), ok]], { [A]: { etat: "echec", raison: `${A}-run.json n'est pas un fichier ordinaire` } }), "archive"],
    ["archive non inspectée", [...base, NOM_PREUVES_P0B], present([[preuve(A), ok]], {}), "non inspectée"],
    ["faits non collectés", [...base, NOM_PREUVES_P0B], undefined, "pas été inspecté"],
  ];
  for (const [nom, noms, p, motif] of refuses) {
    const c = cas(noms, p);
    propriete(c.classe === "illisible" && (c.raison ?? "").includes(NOM_PREUVES_P0B) && (c.raison ?? "").includes(motif),
      `${nom} : ${c.classe} (${c.raison ?? ""})`);
  }
  // Q-P2-24 : un faux préfixe d'archive (`ite-run.json`) ne blanchit pas `ite-p0b` : il n'est pas une
  // archive, et l'inspection de Q-P2-14 reste due.
  const faux = cas([".git", "ite-run.json", NOM_PREUVES_P0B], undefined);
  propriete(faux.classe === "illisible" && (faux.raison ?? "").includes("ite-run.json") && (faux.raison ?? "").includes("pas été inspecté"),
    `faux préfixe d'archive : ${faux.classe} (${faux.raison ?? ""})`);
  // Une preuve admise n'admet pas les autres pièces : une entrée inconnue de l'espace reste refusée.
  const autre = cas([...base, NOM_PREUVES_P0B, "inconnu.txt"], present([[preuve(A), ok]], { [A]: ok }));
  propriete(autre.classe === "illisible" && !(autre.raison ?? "").includes(`${NOM_PREUVES_P0B},`) &&
    (autre.raison ?? "").includes("inconnu.txt"), `autre pièce : ${autre.raison ?? ""}`);
  // Le jugement est pur et ne dépend que des faits passés.
  propriete(jugerPreuvesP0B(base, present([], {})) === undefined, "vide : admis");
});

// ---------------------------------------------------------------------------- commandes

couverture("P2-K21", "T2–T7 : décisions et refus sur préconditions, argument inconnu", () => {
  const vide = classer(releve());
  const nonTermine = classer(releve({ run: lu({ statut: "active" }) }));
  const ill = classer(releve({ run: { ok: false, raison: "x" } }));
  const s = (profil: "simple" | "sous-agents", repos = true, delegationLisible = true) => ({ profil, repos, delegationLisible });
  propriete(deciderCommande("", s("simple"), vide).action === "rendre", "T2 rend");
  propriete(deciderCommande("on", s("simple"), vide).action === "monter", "T3 monte");
  propriete(deciderCommande("on", s("simple", false), vide).action === "refus", "T3 hors repos refusé");
  propriete(deciderCommande("on", s("simple"), ill).action === "refus", "T3 illisible refusé");
  propriete(deciderCommande("on", s("simple", true, false), vide).action === "refus", "T3 DELEGATION illisible refusé");
  propriete(deciderCommande("on", s("simple"), nonTermine).action === "monter", "T3 non terminé : reprise admise");
  propriete(deciderCommande("on", s("sous-agents"), vide).action === "rendre", "T4 rend");
  propriete(deciderCommande("off", s("sous-agents"), vide).action === "descendre", "T5 vide descend");
  propriete(deciderCommande("off", s("sous-agents"), classer(releve({ run: lu({ statut: "completed" }) }))).action === "descendre", "T5 terminé descend");
  propriete(deciderCommande("off", s("sous-agents"), nonTermine).action === "refus", "T5 non terminé refusé");
  propriete(deciderCommande("off", s("sous-agents"), ill).action === "refus", "T5 illisible refusé");
  propriete(deciderCommande("off", s("sous-agents", false), vide).action === "refus", "T5 hors repos refusé");
  propriete(deciderCommande("off", s("simple"), nonTermine).action === "rendre", "T6 rend");
  const u = deciderCommande("bascule", s("simple"), vide);
  propriete(u.action === "usage" && u.texte === USAGE_SUBAGENTS, "T7 usage");
  propriete(/`\/subagents`.*`\/subagents on`.*`\/subagents off`/.test(USAGE_SUBAGENTS), "l'usage liste les trois formes");
});

couverture("P2-K22", "refus de descente : runId, statut, unités et bin/subagent-recover avec ses verbes", () => {
  const c = classer(releve({ run: lu({ statut: "active", lanes: { ok: true, unitesOuvertes: ["W03", "W01"], lanesObservees: 2 } }) }));
  const d = deciderCommande("off", { profil: "sous-agents", repos: true, delegationLisible: true }, c);
  propriete(d.action === "refus", `action ${d.action}`);
  const t = d.action === "refus" ? d.texte : "";
  for (const attendu of [RUN, "active", "W01, W03", "bin/subagent-recover report", "run completed|abandoned --reason", "cleanup", "adopt|integrated|abandoned|discard"]) {
    propriete(t.includes(attendu), `le refus doit contenir « ${attendu} » : ${t}`);
  }
});

couverture("P2-K33", "refus de montée sur illisible : raison de l'observateur à l'octet, un seul séparateur, ponctuée ou non", () => {
  const s = { profil: "simple" as const, repos: true, delegationLisible: true };
  for (const raison of ["le registre des tentatives est inexploitable (LOST) : registre absent.", "ligne(s) 3 illisible(s)"]) {
    const c = classer(releve({ run: lu({ statut: "active", lanes: { ok: false, raison } }) }));
    propriete(c.classe === "illisible", `classe ${c.classe}`);
    const d = deciderCommande("on", s, c);
    propriete(d.action === "refus", `action ${d.action}`);
    const t = d.action === "refus" ? d.texte : "";
    const attendu = `registre des lanes inexploitable : ${raison}${raison.endsWith(".") ? "" : "."} Rien n'a été ouvert ni écrit. `;
    propriete(t.startsWith(`Montée refusée : run ${RUN} (active) — état durable illisible : `), `début du refus : ${t}`);
    propriete(t.includes(attendu), `la raison figure à l'octet, suivie d'un seul point : ${t}`);
    propriete(!t.includes(".. Rien"), `aucun point doublé : ${t}`);
  }
});

couverture("P2-K34", "avertissement sur illisible : raison de l'observateur à l'octet, un seul point, ponctuée ou non", () => {
  for (const raison of ["le registre des tentatives est inexploitable (LOST) : registre absent.", "ligne(s) 3 illisible(s)"]) {
    const c = classer(releve({ run: lu({ statut: "active", lanes: { ok: false, raison } }) }));
    propriete(c.classe === "illisible", `classe ${c.classe}`);
    const a = avertissement(c) ?? "";
    const attendu =
      `Run durable illisible : run ${RUN} (active) — état durable illisible : registre des lanes inexploitable : ` +
      `${raison}${raison.endsWith(".") ? "" : "."}\n` +
      "Profil simple en lecture seule : seule la lecture native vérifiée passe, rien n'est écrit.\n" +
      "Suites : `/subagents on` pour reprendre le run en profil sous-agents, `/subagent-report` pour le relevé, " +
      `ou l'outil opérateur : ${VERBES_RECOVER}.`;
    propriete(a === attendu, `texte exact de l'avertissement, un seul point après la raison : ${JSON.stringify(a)}`);
  }
});

couverture("P2-K23", "avertissement : run, lecture seule, suites ; rien pour absent, vide ou terminé", () => {
  const c = classer(releve({ run: lu({ statut: "active", lanes: { ok: true, unitesOuvertes: ["W02"], lanesObservees: 1 } }) }));
  const a = avertissement(c) ?? "";
  for (const attendu of [RUN, "active", "W02", "lecture seule", "/subagents on", "/subagent-report", "bin/subagent-recover"]) {
    propriete(a.includes(attendu), `l'avertissement doit contenir « ${attendu} »`);
  }
  const ill = avertissement(classer({ espace: { etat: "echec", raison: "EACCES" } })) ?? "";
  propriete(ill.includes("EACCES"), "l'avertissement d'un état illisible dit sa raison");
  for (const r of [{ espace: { etat: "absent" } } as Releve, releve(), releve({ run: lu({ statut: "completed" }) })]) {
    propriete(avertissement(classer(r)) === undefined, `aucun avertissement pour ${classer(r).classe}`);
  }
});

// ---------------------------------------------------------------------------- lecture seule et outils

couverture("P2-K24", "lecture seule : la lecture native vérifiée passe ; non natif, inconnu, sans nom refusés", () => {
  const c = classer(releve({ run: lu({ statut: "active" }) }));
  const verifie = (n: string) => n === "read";            // un `grep` remplacé n'est pas natif
  propriete(decisionAppelSimple(c, "read", verifie).bloquer === false, "read natif admis");
  for (const nom of ["grep", "write", "edit", "bash", "inconnu", "", undefined]) {
    const d = decisionAppelSimple(c, nom, verifie);
    propriete(d.bloquer === true, `${String(nom)} doit être refusé`);
    if (d.bloquer) propriete(d.raison === refusLectureSeule(c), "le refus nomme le run et ses sorties");
  }
  propriete(refusLectureSeule(c).includes(RUN) && refusLectureSeule(c).includes("/subagents on"), "texte du refus");
});

couverture("P2-K25", "outils : base, restrictions, levée ; task jamais en simple ; jamais tous les outils", () => {
  const enregistres = ["read", "grep", "find", "ls", "bash", "write", "edit", "task", "extra"];
  const base = ["read", "bash", "edit", "write"];   // --tools de l'opérateur : extra et task exclus
  const o = (profil: "simple" | "sous-agents", lectureSeule = false, p0cTerminal = false) =>
    outilsDuProfil({ profil, base, enregistres, lectureSeule, p0cTerminal, lectureVerifiee: natif });
  propriete(JSON.stringify(o("simple")) === JSON.stringify(base), `simple : ${o("simple")}`);
  propriete(JSON.stringify(o("simple", true)) === JSON.stringify(["read"]), `simple lecture seule : ${o("simple", true)}`);
  propriete(JSON.stringify(o("sous-agents")) === JSON.stringify([...base, "task"]), `sous-agents : ${o("sous-agents")}`);
  propriete(JSON.stringify(o("sous-agents", false, true)) === JSON.stringify(["read"]), `P0-C : ${o("sous-agents", false, true)}`);
  propriete(!o("simple").includes("task") && !o("simple", true).includes("task"), "task jamais en simple");
  propriete(!o("sous-agents").includes("extra"), "jamais tous les outils enregistrés");
  const avecTask = outilsDuProfil({ profil: "simple", base: [...base, "task"], enregistres, lectureSeule: false, p0cTerminal: false, lectureVerifiee: natif });
  propriete(!avecTask.includes("task"), "une base qui contient task la perd en simple");
  const sansTask = outilsDuProfil({ profil: "sous-agents", base, enregistres: enregistres.filter((n) => n !== "task"), lectureSeule: false, p0cTerminal: false, lectureVerifiee: natif });
  propriete(!sansTask.includes("task"), "task non enregistré n'est pas ajouté");
});

couverture("P2-K26", "relevé sans identité : aucune désignation ni chemin sur un runId vide", () => {
  const c = classer(releve({ manifeste: { etat: "absent" }, run: undefined }, [".git"]));
  propriete(c.runId === undefined, `runId ${String(c.runId)}`);
  // RA-P2-10 : la désignation d'un absent, et celle et l'avertissement d'un illisible sans identité.
  const sans = classer(releve({ manifeste: { etat: "absent" }, run: undefined, marqueur: { etat: "invalide", raison: "partiel" } }, [".git"]));
  propriete(sans.classe === "illisible" && sans.runId === undefined, `illisible sans identité : ${sans.classe}`);
  for (const t of [designation(c), designation(sans), avertissement(sans) ?? ""]) {
    propriete(t !== "" && !t.includes("undefined") && !/\brun [(—]/.test(t), `texte construit sur une identité absente : ${t}`);
  }
  propriete(REFUS_PROFIL_SIMPLE.includes("/subagents on"), "le refus de profil dit la sortie");
});

// ---------------------------------------------------------------------------- composition

const DELEG = "## Delegation\n\nRègles de délégation.";
const DUES = ["Plan file: .pi-subagent-runs/x-plan.json", "Second rule."];

couverture("P2-K30", "voie (a) : texte préexistant gardé à l'octet, ajout à la fin, une seule fois", () => {
  const avant = "PROMPT FORCÉ DU BRIEF\n<rules>\n- Be concise in your responses\n</rules>";
  const r = completerPromptForce(avant, DELEG, DUES);
  propriete(r.ajoute && r.prompt.startsWith(avant), "le préfixe est conservé à l'octet");
  propriete(r.prompt.split(blocDeDelegation(DELEG)).length === 2, "le bloc de délégation figure une fois");
  propriete(r.complete && compositionPresente(r.prompt, DELEG, DUES), "la composition est complète");
  const encore = completerPromptForce(r.prompt, DELEG, DUES);
  propriete(!encore.ajoute && encore.prompt === r.prompt, "un prompt déjà complet n'est pas complété deux fois");
});

couverture("P2-K31", "voie (a) : composition partielle — bloc présent, guidelines dues absentes, elles seules ajoutées", () => {
  const partiel = `X\n\n${blocDeDelegation(DELEG)}`;
  propriete(!compositionPresente(partiel, DELEG, DUES), "le bloc seul ne vaut pas composition");
  const r = completerPromptForce(partiel, DELEG, DUES);
  propriete(r.ajoute && r.prompt.split(blocDeDelegation(DELEG)).length === 2, "le bloc n'est pas dupliqué");
  propriete(DUES.every((g) => r.prompt.includes(`- ${g}`)) && r.complete, "les guidelines dues sont ajoutées");
});

couverture("P2-K32", "voie (a) : sans guideline due, seul le bloc de délégation est ajouté", () => {
  const r = completerPromptForce("Y", DELEG, []);
  propriete(r.prompt === `Y\n\n${blocDeDelegation(DELEG)}`, `rendu ${JSON.stringify(r.prompt)}`);
  propriete(!r.prompt.includes("<rules>"), "aucun bloc de règles vide");
});
