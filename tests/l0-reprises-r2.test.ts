/**
 * l0-reprises-r2.test.ts — LOT-REPRISES, R2 : `approved` incompatible avec tout risque restant ouvert
 * (PLAN-LOT-REPRISES v2 gelé, `1a840043`, § 3, Q3 et Q4).
 *
 *   refus        `approved` + nouveaux `open_risks` refusé ; `approved` avec un risque de l'unité
 *                encore ouvert après la soumission refusé — `routed` compris, puisque la
 *                projection porte tout ce qui n'est pas `resolved` ; fermé seulement s'il est
 *                remis ET réclamé ; `needs_rework`/`blocked` jamais refusés — R2-refus
 *   projection   absente : seuls les nouveaux `open_risks` se jugent ; illisible ou inconnue :
 *                `approved` refusé — R2-projection
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  lireProjection,
  REVIEW_APPROVED_WITH_OPEN_RISKS,
  refusApprobation,
  texteDuRefus,
} from "../subagent-only/envelope/approbation.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}

regressionCorrigee("R2-refus", "approved est refusé tant qu'un risque reste ouvert après la soumission, et seulement alors", () => {
  const vide = { ids: [], remis: [] };
  const nouveau = refusApprobation({ verdict: "approved", open_risks: ["où vit X ?"] }, vide);
  propriete(nouveau?.code === REVIEW_APPROVED_WITH_OPEN_RISKS && nouveau.new_open_risks === 1,
    `approved + open_risks : refusé (${JSON.stringify(nouveau)})`);

  const ouvert = { ids: ["r-1", "r-2"], remis: ["r-1"] };
  const restant = refusApprobation({ verdict: "approved", open_risks: [], resolved_risks: ["r-1"] }, ouvert);
  propriete(restant !== null && JSON.stringify(restant.open_risk_ids) === JSON.stringify(["r-2"]),
    `un risque de l'unité non remis reste ouvert : refusé, et nommé (${JSON.stringify(restant)})`);
  const nonReclame = refusApprobation({ verdict: "approved", open_risks: [] }, { ids: ["r-1"], remis: ["r-1"] });
  propriete(nonReclame !== null && nonReclame.open_risk_ids.includes("r-1"), "un risque remis mais non réclamé reste ouvert : refusé");
  const nonRemis = refusApprobation({ verdict: "approved", open_risks: [], resolved_risks: ["r-2"] }, ouvert);
  propriete(nonRemis !== null && nonRemis.open_risk_ids.includes("r-2"),
    "réclamer un id qu'on ne vous a pas remis ne le ferme pas : le registre l'ignore");
  propriete(refusApprobation({ verdict: "approved", open_risks: [], resolved_risks: ["r-1"] }, { ids: ["r-1"], remis: ["r-1"] }) === null,
    "remis et réclamé : la projection est vide, approved accepté");
  propriete(refusApprobation({ verdict: "approved", open_risks: [] }, vide) === null, "rien d'ouvert : approved accepté");
  for (const verdict of ["needs_rework", "blocked"]) {
    propriete(refusApprobation({ verdict, open_risks: ["où vit X ?"] }, ouvert) === null, `${verdict} + open_risks : jamais refusé`);
  }
  const texte = texteDuRefus(restant!);
  propriete(texte.includes(REVIEW_APPROVED_WITH_OPEN_RISKS) && texte.includes("r-2") && texte.includes("needs_rework") &&
    texte.includes("finding"), "le texte nomme le code, les ids et les issues");
});

regressionCorrigee("R2-projection", "sans projection seuls les nouveaux open_risks se jugent ; une projection illisible ou inconnue refuse approved", () => {
  propriete(lireProjection(undefined) === null && lireProjection("") === null, "absente : null");
  propriete(refusApprobation({ verdict: "approved", open_risks: [] }, null) === null, "sans projection, approved sans open_risks passe");
  propriete(refusApprobation({ verdict: "approved", open_risks: ["x"] }, null) !== null, "sans projection, approved + open_risks refusé");
  const lu = lireProjection(JSON.stringify({ ids: ["r-1"], remis: [] }));
  propriete(JSON.stringify(lu) === JSON.stringify({ ids: ["r-1"], remis: [] }), "la forme transmise est relue telle quelle");
  for (const brut of ["{illisible", JSON.stringify({ ids: "r-1" }), JSON.stringify({ ids: ["r-1"] }), JSON.stringify({ inconnu: "registre rompu" })]) {
    const p = lireProjection(brut);
    const r = refusApprobation({ verdict: "approved", open_risks: [] }, p);
    propriete(r !== null && r.code === REVIEW_APPROVED_WITH_OPEN_RISKS, `projection ${brut} : approved refusé (${JSON.stringify(r)})`);
  }
});
