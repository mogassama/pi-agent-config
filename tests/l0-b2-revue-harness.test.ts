/**
 * l0-b2-revue-harness.test.ts — L0, vague B2 : l'approbation durable et la porte.
 *
 * C2.2 rend l'approbation et la frontière de revue durables ; C2.3 fait du mode de preuve
 * une propriété de la revue, et refuse d'intégrer sur une revue qui n'a rien reçu quand
 * rien d'antérieur ne couvre l'arbre. C3.7, enfin, veut qu'un refus de politique se lise
 * dans une sortie structurée et non dans une phrase.
 *
 * Montage : `l0-b2-harness.ts`.
 */
import { test, type TestContext } from "node:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PILOTE } from "./stubs/dispatch.ts";
import {
  aJeter, blocages, ecrire, enveloppeComplete, git, integree, issue, laneActive, monter, montrer,
  precondition, propriete, revue, tache, treeDeTravail,
} from "./l0-b2-harness.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

// ================================================================== l'approbation durable

regression("B2-reviewed-reload", "une approbation produite par task survit à la session", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    // Les deux trees réels, capturés AVANT la revue : l'approbation doit les porter.
    // `treeDeTravail` observe l'arbre de travail et remet l'index en place aussitôt.
    const lane = laneActive(h, "W03");
    const baseTree = git(h.root, "rev-parse", "HEAD^{tree}").trim();
    const laneTree = treeDeTravail(h, lane);
    precondition(baseTree !== laneTree, "la lane doit différer de sa base");

    await h.outil.execute("2", revue("W03", { verdict: "approved" }));
    PILOTE.resultat = undefined;
    precondition(
      integree(h.root, "src/a.py", "a = 2"),
      "la revue approuvée doit avoir intégré la lane dans cette session",
    );

    const decrire = (e: Record<string, unknown> | undefined): string[] => {
      const reviewer = e?.reviewer as Record<string, unknown> | undefined;
      const preuve = e?.proof as Record<string, unknown> | undefined;
      return [
        ...enveloppeComplete(e, "W03", lane),
        ...(e?.from_tree === baseTree ? [] : [`from_tree ${JSON.stringify(e?.from_tree)}`]),
        ...(e?.tree === laneTree ? [] : [`tree ${JSON.stringify(e?.tree)}`]),
        ...(e?.verdict === "approved" ? [] : [`verdict ${JSON.stringify(e?.verdict)}`]),
        ...(Number.isInteger(reviewer?.delegation_seq) ? [] : ["reviewer.delegation_seq"]),
        ...(reviewer?.agent === "reviewer" ? [] : [`reviewer.agent ${JSON.stringify(reviewer?.agent)}`]),
        ...(reviewer?.role === "reviewer" ? [] : [`reviewer.role ${JSON.stringify(reviewer?.role)}`]),
        ...(preuve?.mode === "diff" ? [] : [`proof.mode ${JSON.stringify(preuve?.mode)}`]),
      ];
    };
    const ecrit = h.evenements().find((e) => e.event === "REVIEWED" && e.work_unit === "W03");
    const formeEcrite = decrire(ecrit);

    const neuve = await h.recharger();
    const relu = neuve.evenements().find((e) => e.event === "REVIEWED" && e.work_unit === "W03");
    const formeRelue = decrire(relu);

    propriete(
      formeEcrite.length === 0 && formeRelue.length === 0 && JSON.stringify(relu) === JSON.stringify(ecrit),
      `task doit écrire un REVIEWED complet — enveloppe, from_tree et tree réels, verdict, ` +
        `reviewer, preuve — et il doit se relire à l'identique ; à l'écriture ` +
        `${JSON.stringify(formeEcrite)}, après rechargement ${JSON.stringify(formeRelue)}`,
    );
  } finally { h.fin(); }
});

regression("B2-proof-none", "une revue sans preuve n'autorise pas un arbre qu'aucune revue ne couvre", async () => {
  /*
   * Deux runs équivalents, pour isoler C2.3.
   *
   * Sans le témoin, une correction qui refuserait toutes les revues — ou qui planterait
   * avant d'intégrer — ferait passer la propriété. Les deux branches sont exemptes de
   * toute cause C3 : même scope, aucun réservé, aucun risque.
   */
  const sansPreuve = await monter();
  const avecPreuve = await monter();
  try {
    for (const h of [sansPreuve, avecPreuve]) {
      PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
      await h.outil.execute("1", tache("W03"));
      PILOTE.pendant = undefined;
    }

    // Branche `none` : après rechargement, le reviewer reçoit « juger » sans rien.
    const neuveSans = await sansPreuve.recharger();
    const rSans = await issue(() => neuveSans.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;
    const revueSans = neuveSans.evenements().find((e) => e.event === "REVIEWED");
    const modeSans = (revueSans?.proof as { mode?: string } | undefined)?.mode;
    const branche1 =
      rSans.kind === "returned" &&
      revueSans !== undefined &&
      revueSans.verdict === "approved" &&
      modeSans === "none" &&
      !integree(neuveSans.root, "src/a.py", "a = 2") &&
      (blocages(rSans.value) ?? []).length === 0;

    // Branche témoin : un écrivain dans la session neuve, donc un diff, donc une preuve.
    const neuveAvec = await avecPreuve.recharger();
    PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
    await neuveAvec.outil.execute("2", tache("W03"));
    PILOTE.pendant = undefined;
    const rAvec = await issue(() => neuveAvec.outil.execute("3", revue("W03")));
    PILOTE.resultat = undefined;
    const revueAvec = neuveAvec.evenements().find((e) => e.event === "REVIEWED");
    const modeAvec = (revueAvec?.proof as { mode?: string } | undefined)?.mode;
    const branche2 =
      rAvec.kind === "returned" &&
      modeAvec === "diff" &&
      integree(neuveAvec.root, "src/a.py", "a = 3") &&
      (blocages(rAvec.value) ?? []).length === 0;

    propriete(
      branche1 && branche2,
      `une revue qui n'a rien reçu approuve sans autoriser (branche none ${branche1}, mode ` +
        `${JSON.stringify(modeSans)}, intégrée ` +
        `${integree(neuveSans.root, "src/a.py", "a = 2")}), alors que la même revue avec un ` +
        `diff intègre (témoin ${branche2}, mode ${JSON.stringify(modeAvec)}) ; ` +
        `${montrer(rSans)} · ${montrer(rAvec)}`,
    );
  } finally { sansPreuve.fin(); avecPreuve.fin(); }
});

// ================================================================== la porte, C3.7

regression("B2-porte-blocages", "la porte rend l'ensemble exact de ses causes de politique", async () => {
  const h = await monter({ bundle: true });
  try {
    /*
     * Les quatre causes ensemble, sur une même lane :
     *   reserved-violation   DESIGN.md touché
     *   bundle-violation     ARCHITECTURE.md touché
     *   scope-breach         src/b.py, hors du scope de W03
     *   open-risks           le reviewer laisse un risque ouvert
     */
    PILOTE.pendant = (a) => {
      if (!a.cwd) return;
      writeFileSync(join(a.cwd, "src", "a.py"), "a = 2\n");
      writeFileSync(join(a.cwd, "src", "b.py"), "b = 'hors scope'\n");
      writeFileSync(join(a.cwd, "DESIGN.md"), "touché\n");
      writeFileSync(join(a.cwd, "ARCHITECTURE.md"), "touché\n");
    };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const racineAvant = git(h.root, "rev-parse", "HEAD").trim();

    const resultat = await issue(() =>
      h.outil.execute("2", revue("W03", { openRiskItems: [{ id: "r-1", text: "un risque ouvert" }] })),
    );
    PILOTE.resultat = undefined;
    const rendus = blocages(resultat.value);
    const attendus = ["bundle-violation", "open-risks", "reserved-violation", "scope-breach"];

    propriete(
      rendus !== null &&
        JSON.stringify(rendus) === JSON.stringify(attendus) &&
        git(h.root, "rev-parse", "HEAD").trim() === racineAvant &&
        !integree(h.root, "src/a.py", "a = 2"),
      `les causes doivent sortir triées, sans doublon et exactes (C3.7), et la racine ne ` +
        `doit pas bouger ; rendus ${JSON.stringify(rendus)}, attendus ${JSON.stringify(attendus)}, ` +
        `racine inchangée ${git(h.root, "rev-parse", "HEAD").trim() === racineAvant}`,
    );
  } finally { h.fin(); }
});
