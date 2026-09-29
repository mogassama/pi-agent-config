/**
 * l0-ite-p1b.test.ts — lot ITE, P1-B : la note de regroupement du rôle qui écrit (plan P1 v2 gelé, `fbf65045`).
 *
 * Les formes mesurées sur QD-P0 (`ec276ba9`) : W#1 a modifié `run.py` seul, cinq tours de suite ; R#2
 * (P1-C, `l0-ite-p1c.test.ts`) a lu 2, 1, 2, 1 puis 1 fichier(s) sur cinq tours. La consigne est dans le prompt du rôle ; la note
 * la rappelle là où l'écart se voit, jamais sous forme de refus.
 *
 *   P1-B   au deuxième tour consécutif à un seul `edit` du même fichier, pour un rôle qui écrit ;
 *          jamais après un retour ruff — ITE-P1B-note, ITE-P1B-ruff
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

regressionCorrigee("ITE-P1B-note", "un rôle qui écrit reçoit la note au deuxième tour consécutif à un seul edit du même fichier", () => {
  const lecture = tour(read(RUN), read("src/io.py"));
  propriete(noteDeRegroupement(WORKER, [lecture], tour(edit(RUN)), edit(RUN), false) === null,
    "un premier edit isolé ne déclenche rien");
  const deux = noteDeRegroupement(WORKER, [lecture, tour(edit(RUN))], tour(edit(RUN)), edit(RUN), false);
  propriete(deux !== null && deux.startsWith(`2 modifications de ${RUN} en 2 tours`), `deuxième tour : note (${deux})`);
  const cinq = noteDeRegroupement(WORKER, [lecture, tour(edit(RUN)), tour(edit(RUN)), tour(edit(RUN)), tour(edit(RUN))], tour(edit(RUN)), edit(RUN), false);
  propriete(cinq !== null && cinq.startsWith(`5 modifications de ${RUN} en 5 tours`), `la série est comptée (${cinq})`);
  propriete(noteDeRegroupement(WORKER, [tour(edit("src/io.py"))], tour(edit(RUN)), edit(RUN), false) === null,
    "un autre fichier au tour précédent ne compte pas");
  propriete(noteDeRegroupement(WORKER, [tour(edit(RUN))], tour(edit(RUN), edit("src/io.py")), edit(RUN), false) === null,
    "un tour qui groupe déjà deux appels ne reçoit rien");
  propriete(noteDeRegroupement(REVIEWER, [tour(edit(RUN))], tour(edit(RUN)), edit(RUN), false) === null,
    "un rôle en lecture ne reçoit jamais la note P1-B");
});

regressionCorrigee("ITE-P1B-ruff", "un edit qui suit un retour ruff ne déclenche pas la note : le plancher de vérification prime", () => {
  const signale: TourObserve = { appels: [edit(RUN)], ruff: true };
  propriete(noteDeRegroupement(WORKER, [signale], tour(edit(RUN)), edit(RUN), false) === null,
    "corriger un retour ruff n'est pas un edit qu'on pouvait grouper");
  const apres = noteDeRegroupement(WORKER, [signale, tour(edit(RUN))], tour(edit(RUN)), edit(RUN), false);
  propriete(apres !== null && apres.startsWith("2 modifications"), `la série repart après la correction (${apres})`);
});

regressionCorrigee("ITE-P1B-une-par-tour", "une seule note P1-B par tour", () => {
  propriete(noteDeRegroupement(WORKER, [tour(edit(RUN))], tour(edit(RUN)), edit(RUN), true) === null, "une note déjà ajoutée dans le tour : rien de plus");
});
