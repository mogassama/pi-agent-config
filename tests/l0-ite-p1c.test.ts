/**
 * l0-ite-p1c.test.ts — lot ITE, P1-C : la note de regroupement du reviewer (plan P1 v2 gelé, `fbf65045`).
 *
 * Les formes mesurées sur QD-P0 (`ec276ba9`) : W#1 a modifié `run.py` seul, cinq tours de suite ; R#2
 * a lu 2, 1, 2, 1 puis 1 fichier(s) sur cinq tours. La consigne est dans le prompt du rôle ; la note
 * la rappelle là où l'écart se voit, jamais sous forme de refus.
 *
 *   P1-C   deux tours consécutifs de lecture seule après le premier, y compris à deux fichiers par
 *          tour, pour le reviewer ; une note par tour — ITE-P1C-note, ITE-P1C-une-par-tour
 *
 * Le branchement dans role-guard est éprouvé dans `l0-ite-p1bc-harness.test.ts`. Rien de pi ici.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { noteDeRegroupement, type TourObserve } from "../subagent-only/role-rules.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}

const edit = (chemin: string) => ({ outil: "edit", chemin });
const read = (chemin: string) => ({ outil: "read", chemin });
const tour = (...appels: Array<{ outil: string; chemin?: string }>): TourObserve => ({ appels });
const WORKER = { role: "worker", readOnly: false };
const REVIEWER = { role: "reviewer", readOnly: true };
const RUN = "src/balance_agee/run.py";

regressionCorrigee("ITE-P1C-note", "le reviewer reçoit la note au deuxième tour consécutif de lecture seule après le premier, même à deux fichiers par tour", () => {
  const t0 = tour(read("src/config.py"), read("src/run.py"));
  propriete(noteDeRegroupement(REVIEWER, [], t0, read("src/config.py"), false) === null, "le premier tour ne déclenche rien");
  propriete(noteDeRegroupement(REVIEWER, [t0], tour(read("src/config.py")), read("src/config.py"), false) === null,
    "le premier tour de lecture après le premier ne déclenche rien");
  const n = noteDeRegroupement(REVIEWER, [t0, tour(read("src/config.py"))], tour(read("tests/a.py"), read("tests/b.py")), read("tests/a.py"), false);
  propriete(n !== null && n.startsWith("Lectures échelonnées sur 2 tours"), `deuxième tour de lecture, deux fichiers : note (${n})`);
  const deuxDeux = noteDeRegroupement(REVIEWER, [t0, tour(read("a"), read("b"))], tour(read("c"), read("d")), read("c"), false);
  propriete(deuxDeux !== null, "deux fichiers par tour sur deux tours déclenchent aussi");
  propriete(noteDeRegroupement(REVIEWER, [t0, tour(read("a"), { outil: "submit" })], tour(read("c")), read("c"), false) === null,
    "un tour qui n'est pas de lecture seule rompt la série");
  propriete(noteDeRegroupement(WORKER, [t0, tour(read("a"))], tour(read("c")), read("c"), false) === null,
    "un worker ne reçoit pas la note P1-C");
});

regressionCorrigee("ITE-P1C-une-par-tour", "une seule note par tour, quel que soit le nombre de résultats du tour", () => {
  const h = [tour(read("a"), read("b")), tour(read("c"))];
  const courant = tour(read("d"), read("e"));
  propriete(noteDeRegroupement(REVIEWER, h, courant, read("d"), false) !== null, "le premier résultat du tour porte la note");
  propriete(noteDeRegroupement(REVIEWER, h, courant, read("e"), true) === null, "le second résultat du même tour n'en porte pas");
});
