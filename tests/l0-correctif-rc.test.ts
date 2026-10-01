/**
 * l0-correctif-rc.test.ts — LOT-REPRISES-CORRECTIF, RC : une revue bloquante est fondée sur les
 * kept_consumers (PLAN-LOT-REPRISES-CORRECTIF gelé, § 2 et § 5, Q1 à Q5).
 *
 *   refus    `needs_rework` et `blocked` refusés tant qu'un kept_consumer de l'unité n'est pas
 *            inspecté, et nommé ; tous inspectés : acceptés ; `approved` jamais concerné ; aucune
 *            obligation sans liste ; liste illisible : verdict bloquant refusé, jamais « aucun
 *            kept » — RC-refus
 *   preuve   seul un `read` terminé sans erreur, qui résout après realpath dans le worktree de
 *            l'enfant, inspecte ; `grep`, `ls`, un `read` en erreur, un chemin hors du worktree ou
 *            un chemin absolu d'un autre arbre n'inspectent rien ; relatif et absolu équivalents —
 *            RC-preuve
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cheminReelDansWorktree,
  inspecte,
  lireGardes,
  REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS,
  refusBloquant,
  texteDuRefusInspection,
} from "../subagent-only/envelope/inspection.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

/** Un worktree d'enfant : deux kept_consumers, un autre fichier, et un arbre voisin hors du worktree. */
function worktree(): { lane: string; voisin: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-rc-")));
  jetables.push(base);
  const lane = join(base, "lane");
  const voisin = join(base, "racine");
  for (const r of [lane, voisin]) {
    mkdirSync(join(r, "tests"), { recursive: true });
    mkdirSync(join(r, "src", "pkg"), { recursive: true });
    writeFileSync(join(r, "tests", "test_config.py"), "import pkg.io as io_mod\n");
    writeFileSync(join(r, "src", "pkg", "run.py"), "from .io import lire\n");
    writeFileSync(join(r, "src", "pkg", "io.py"), "def lire():\n    return 1\n");
  }
  return { lane, voisin };
}
const KEPT = ["tests/test_config.py", "src/pkg/run.py"];
const lu = (path: unknown, isError = false, toolName = "read") => ({ type: "tool_result", toolName, toolCallId: "c", input: { path }, isError, content: [] });

regressionCorrigee("RC-refus", "un verdict bloquant est refusé tant qu'un kept_consumer n'est pas inspecté, et seulement alors", () => {
  const { lane } = worktree();
  const gardes = { unit: "W01", kept: KEPT };
  const tous = new Set(KEPT.map((k) => realpathSync(join(lane, k))));
  for (const verdict of ["needs_rework", "blocked"]) {
    const rien = refusBloquant({ verdict }, gardes, new Set(), lane);
    propriete(rien?.code === REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS && rien.unit === "W01" &&
      JSON.stringify(rien.missing_kept_consumers) === JSON.stringify(KEPT), `${verdict} sans lecture : refusé, tous nommés (${JSON.stringify(rien)})`);
    const un = refusBloquant({ verdict }, gardes, new Set([realpathSync(join(lane, KEPT[1]))]), lane);
    propriete(un !== null && JSON.stringify(un.missing_kept_consumers) === JSON.stringify([KEPT[0]]),
      `${verdict} avec un seul lu : refusé, le manquant nommé (${JSON.stringify(un)})`);
    propriete(refusBloquant({ verdict }, gardes, tous, lane) === null, `${verdict} avec tous lus : accepté`);
  }
  propriete(refusBloquant({ verdict: "approved" }, gardes, new Set(), lane) === null, "approved n'est jamais concerné");
  propriete(refusBloquant({ verdict: "needs_rework" }, null, new Set(), lane) === null, "sans liste transmise : aucune obligation");
  // Un kept qui ne résout plus dans le worktree ne peut pas avoir été inspecté.
  const absent = refusBloquant({ verdict: "needs_rework" }, { unit: "W01", kept: ["tests/disparu.py"] }, tous, lane);
  propriete(absent !== null && absent.missing_kept_consumers.includes("tests/disparu.py"), "un kept introuvable reste manquant");
  const illisible = refusBloquant({ verdict: "blocked" }, { inconnu: "liste illisible" }, tous, lane);
  propriete(illisible?.code === REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS && illisible.kept_inconnu === "liste illisible",
    `liste inconnue : verdict bloquant refusé, jamais « aucun kept » (${JSON.stringify(illisible)})`);
  propriete(lireGardes(undefined) === null && lireGardes("") === null, "variable absente : aucune liste");
  propriete(JSON.stringify(lireGardes(JSON.stringify({ unit: "W01", kept: KEPT }))) === JSON.stringify({ unit: "W01", kept: KEPT }),
    "la liste transmise est relue telle quelle");
  for (const brut of ["{illisible", JSON.stringify({ unit: "W01" }), JSON.stringify({ unit: "W01", kept: [] }), JSON.stringify({ kept: KEPT }),
    JSON.stringify({ unit: "W01", kept: [1] })]) {
    const g = lireGardes(brut);
    propriete(g !== null && "inconnu" in g, `variable ${brut} : inconnue, jamais absente`);
  }
  const texte = texteDuRefusInspection(un0(lane));
  propriete(texte.includes(REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS) && texte.includes("tests/test_config.py") && texte.includes("read"),
    "le texte nomme le code, les fichiers manquants et l'outil");
});
function un0(lane: string) {
  return refusBloquant({ verdict: "needs_rework" }, { unit: "W01", kept: KEPT }, new Set(), lane)!;
}

regressionCorrigee("RC-preuve", "seul un read réussi qui résout dans le worktree inspecte un fichier", () => {
  const { lane, voisin } = worktree();
  const cible = realpathSync(join(lane, "tests", "test_config.py"));
  propriete(inspecte(lu("tests/test_config.py"), lane) === cible, "read relatif réussi : inspecté");
  propriete(inspecte(lu(join(lane, "tests", "test_config.py")), lane) === cible, "read absolu dans le worktree : le même fichier");
  propriete(inspecte(lu("./tests/../tests/test_config.py"), lane) === cible, "chemin non normalisé : résolu");
  propriete(inspecte(lu("tests/test_config.py", true), lane) === null, "read en erreur : rien");
  propriete(inspecte({ ...lu("tests/test_config.py"), isError: undefined }, lane) === null, "isError absent : rien");
  for (const outil of ["grep", "ls", "find", "bash"]) {
    propriete(inspecte(lu("tests/test_config.py", false, outil), lane) === null, `${outil} : rien`);
  }
  propriete(inspecte(lu(join(voisin, "tests", "test_config.py")), lane) === null, "chemin absolu d'un autre arbre : rien");
  propriete(inspecte(lu("../racine/tests/test_config.py"), lane) === null, "chemin relatif qui sort du worktree : rien");
  propriete(inspecte(lu("tests/absent.py"), lane) === null, "chemin qui ne résout pas : rien");
  propriete(inspecte(lu(""), lane) === null && inspecte({ toolName: "read", isError: false, input: {} }, lane) === null, "sans chemin : rien");
  symlinkSync(join(voisin, "tests", "test_config.py"), join(lane, "dehors.py"));
  propriete(inspecte(lu("dehors.py"), lane) === null, "lien vers l'extérieur du worktree : rien");
  symlinkSync(join(lane, "tests", "test_config.py"), join(lane, "alias.py"));
  propriete(inspecte(lu("alias.py"), lane) === cible, "lien interne : résolu par realpath vers le kept lui-même");
  propriete(cheminReelDansWorktree(".", lane) === null, "le worktree lui-même n'est pas un fichier inspecté");
  // La preuve et le refus se rejoignent : un read réussi du kept satisfait refusBloquant.
  const vus = new Set([inspecte(lu("tests/test_config.py"), lane)!, inspecte(lu(join(lane, "src/pkg/run.py")), lane)!]);
  propriete(refusBloquant({ verdict: "needs_rework" }, { unit: "W01", kept: KEPT }, vus, lane) === null,
    "les deux kept lus par read : le verdict bloquant passe");
});
