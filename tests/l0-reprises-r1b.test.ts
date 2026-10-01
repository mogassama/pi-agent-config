/**
 * l0-reprises-r1b.test.ts — LOT-REPRISES, R1-b : le refus avant mutation hors du périmètre gelé
 * (PLAN-LOT-REPRISES v2 gelé, `1a840043`, § 2 et Q1).
 *
 *   garde       `edit` et `write` hors de `expected_write_scope` refusés, `kept_consumers`
 *               compris ; dans le périmètre acceptés ; destination résolue depuis la lane ; un
 *               chemin qui sort de la lane refusé ; une lecture jamais visée — R1B-garde
 *   périmètre   présent mais illisible : tout est refusé, jamais l'absence de garde ; absent :
 *               aucune garde — R1B-lecture-env
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { decideRoleGuard, lirePerimetre, WRITE_OUTSIDE_SCOPE, type Perimetre } from "../subagent-only/role-rules.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}

const LANE = "/depot/.git/pi-lanes/abc-W01-g1";
const P: Perimetre = {
  unit: "W01",
  scope: ["src/pkg/io.py", "src/pkg/fingerprints.py", "tests/"],
  kept: ["src/pkg/run.py"],
};
const juger = (kind: "edit" | "write" | "read", path: string, perimetre: Perimetre | null = P) =>
  decideRoleGuard(kind, { path }, { root: null, cwd: LANE, readOnly: false, role: "worker", perimetre });

regressionCorrigee("R1B-garde", "edit et write hors périmètre sont refusés avant mutation, kept_consumers compris ; le périmètre passe", () => {
  for (const kind of ["edit", "write"] as const) {
    const hors = juger(kind, "src/pkg/entries.py");
    propriete(hors !== null && hors.includes(WRITE_OUTSIDE_SCOPE) && hors.includes("src/pkg/entries.py") && hors.includes("W01"),
      `${kind} hors du scope : refus codé et nommé (${hors})`);
    const garde = juger(kind, "src/pkg/run.py");
    propriete(garde !== null && garde.includes(WRITE_OUTSIDE_SCOPE) && garde.includes("kept_consumers"),
      `${kind} sur un consommateur à laisser intact : refusé (${garde})`);
    propriete(juger(kind, "src/pkg/io.py") === null, `${kind} dans le scope : accepté`);
    propriete(juger(kind, "tests/test_io.py") === null, `${kind} sous un répertoire du scope : accepté`);
    propriete(juger(kind, `${LANE}/src/pkg/fingerprints.py`) === null, `${kind} en chemin absolu dans la lane : accepté`);
    propriete(juger(kind, "./src/pkg/../pkg/io.py") === null, `${kind} : la destination est normalisée avant d'être jugée`);
    const sortie = juger(kind, "../../../src/pkg/io.py");
    propriete(sortie !== null && sortie.includes(WRITE_OUTSIDE_SCOPE), `${kind} qui sort de la lane : refusé (${sortie})`);
    const racine = juger(kind, "/depot/src/pkg/io.py");
    propriete(racine !== null && racine.includes(WRITE_OUTSIDE_SCOPE), `${kind} vers la racine du dépôt plutôt que la lane : refusé`);
  }
  propriete(juger("read", "src/pkg/entries.py") === null, "une lecture n'est jamais visée par le périmètre");
  propriete(juger("edit", "src/pkg/entries.py", null) === null, "sans périmètre, aucune garde de périmètre");
});

regressionCorrigee("R1B-lecture-env", "un périmètre présent mais illisible refuse tout ; absent, il n'y a pas de garde", () => {
  propriete(lirePerimetre(undefined) === null && lirePerimetre("") === null, "absent : aucune garde");
  const lu = lirePerimetre(JSON.stringify(P));
  propriete(JSON.stringify(lu) === JSON.stringify(P), "la forme transmise est relue telle quelle");
  for (const brut of ["{pas du json", JSON.stringify({ unit: "W01", scope: "src" }), JSON.stringify({ scope: [], kept: [] })]) {
    const p = lirePerimetre(brut);
    propriete(p !== null && p.scope.length === 0, `illisible (${brut}) : périmètre vide, pas d'absence de garde`);
    const r = decideRoleGuard("edit", { path: "src/pkg/io.py" }, { root: null, cwd: LANE, readOnly: false, role: "worker", perimetre: p });
    propriete(r !== null && r.includes(WRITE_OUTSIDE_SCOPE), "et toute écriture est refusée");
  }
});
