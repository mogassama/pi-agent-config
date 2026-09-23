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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import {
  acquireRunOwnership, type Lease, releaseRunOwnership,
} from "../subagent-only/run-manifest.ts";
import {
  aJeter, blocages, ecrire, enveloppeComplete, git, integree, issue, laneActive, monter, montrer,
  precondition, propriete, revue, tache, treeDeTravail,
} from "./l0-b2-harness.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
/**
 * Une régression CORRIGÉE : même nom, même scénario, mêmes assertions, sans `todo`, et un
 * mutant qui réintroduit le défaut.
 */
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

// ================================================================== l'approbation durable

regressionCorrigee("B2-reviewed-reload", "une approbation produite par task survit à la session", async () => {
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

regressionCorrigee("B2-proof-none", "une revue sans preuve n'autorise pas un arbre qu'aucune revue ne couvre", async () => {
  /*
   * Deux runs équivalents, pour isoler C2.3.
   *
   * Sans le témoin, une correction qui refuserait toutes les revues — ou qui planterait
   * avant d'intégrer — ferait passer la propriété. Les deux branches sont exemptes de
   * toute cause C3 : même scope, aucun réservé, aucun risque.
   *
   * L6-D4 (PLAN-LOT6) : le paquet est le delta complet depuis le dernier tree revu (D3),
   * même après rechargement. Une revue sans preuve n'y existe plus que si le delta porte un
   * fichier généré, que la politique ne montre ni ne fait lire : `src/uv.lock` ici, dans
   * le scope de W03 pour qu'aucun dépassement ne s'en mêle.
   */
  const plan = {
    version: 1,
    work_units: [
      { id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py", "src/uv.lock"] },
    ],
  };
  const sansPreuve = await monter({ plan });
  const avecPreuve = await monter({ plan });
  try {
    for (const h of [sansPreuve, avecPreuve]) {
      const genere = h === sansPreuve;
      PILOTE.pendant = (a) => {
        if (!a.cwd) return;
        writeFileSync(join(a.cwd, "src", "a.py"), "a = 2\n");
        if (genere) writeFileSync(join(a.cwd, "src", "uv.lock"), "verrou\n");
      };
      // Le runtime prend sa racine dans le répertoire courant, et `monter` y laisse le
      // DERNIER harnais monté : sans ce chdir, la tâche de `sansPreuve` s'exécutait dans
      // le dépôt d'`avecPreuve`, et la branche `none` mesurait une unité sans lane.
      process.chdir(h.root);
      await h.outil.execute("1", tache("W03"));
      PILOTE.pendant = undefined;
    }

    // La branche `none` porte réellement sa lane et son changement, dans son dépôt.
    const laneSans = laneActive(sansPreuve, "W03");
    const baseSans = git(sansPreuve.root, "rev-parse", "HEAD^{tree}").trim();
    precondition(
      sansPreuve.evenements().some((e) => e.event === "OPENED" && e.lane === laneSans),
      `sansPreuve doit avoir enregistré l'ouverture de ${laneSans}`,
    );
    precondition(treeDeTravail(sansPreuve, laneSans) !== baseSans, "le T_L de sansPreuve doit différer de sa base");
    const delegationsDe = (h: typeof sansPreuve) => h.journal().filter((r) => r.role === "worker");
    const laneAvec = laneActive(avecPreuve, "W03");
    precondition(
      delegationsDe(sansPreuve).length === 1 && delegationsDe(sansPreuve)[0].lane_id === laneSans &&
        delegationsDe(avecPreuve).length === 1 && delegationsDe(avecPreuve)[0].lane_id === laneAvec,
      `chaque harnais doit porter sa seule délégation, dans sa lane ; sansPreuve ` +
        `${JSON.stringify(delegationsDe(sansPreuve).map((r) => r.lane_id))}, avecPreuve ` +
        `${JSON.stringify(delegationsDe(avecPreuve).map((r) => r.lane_id))}`,
    );
    const verrou = (h: typeof sansPreuve, lane: string) =>
      existsSync(join(h.root, ".git", "pi-lanes", lane, "src", "uv.lock"));
    precondition(
      verrou(sansPreuve, laneSans) && !verrou(avecPreuve, laneAvec),
      "seule la lane de sansPreuve porte le fichier généré src/uv.lock",
    );

    // Branche `none` : après rechargement, le delta porte un fichier généré, non montré.
    const neuveSans = await sansPreuve.recharger();
    precondition(laneActive(neuveSans, "W03") === laneSans, "la branche none doit juger la lane de sansPreuve");
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

    // Branche témoin : le même changement, sans fichier généré, donc un diff, donc une preuve.
    const neuveAvec = await avecPreuve.recharger();
    const rAvec = await issue(() => neuveAvec.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;
    const revueAvec = neuveAvec.evenements().find((e) => e.event === "REVIEWED");
    const modeAvec = (revueAvec?.proof as { mode?: string } | undefined)?.mode;
    const branche2 =
      rAvec.kind === "returned" &&
      modeAvec === "diff" &&
      integree(neuveAvec.root, "src/a.py", "a = 2") &&
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

preservation("B2-paquet-complet", "la revue reçoit tout le delta, même ce qu'un bail perdu a écrit", async () => {
  /*
   * D3 (PLAN-LOT6) : la frontière en mémoire est un contexte, pas une borne de preuve.
   *
   * `src/b.py` est écrit par une délégation dont le bail se perd : le lot rend avant
   * `HISTORY`, et aucune délégation de la session n'en rend compte. `src/a.py` est écrit
   * ensuite par le nouveau propriétaire. Les deux sont dans le scope de W03 ; aucun
   * n'est réservé ni du bundle. Le reviewer doit avoir vu les deux avant d'approuver.
   */
  const h = await monter({
    plan: {
      version: 1,
      work_units: [{ id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py", "src/b.py"] }],
    },
  });
  try {
    PILOTE.pendant = (a) => {
      if (!a.cwd) return;
      writeFileSync(join(a.cwd, "src", "b.py"), "b = 'sous bail perdu'\n");
      const bail = JSON.parse(readFileSync(join(h.runDir, `${h.runId}.lease`, "owner.json"), "utf-8")) as Lease;
      releaseRunOwnership(h.runDir, bail);
      const autre = acquireRunOwnership(h.runDir, h.runId, "session-autre");
      if (autre.ok) releaseRunOwnership(h.runDir, autre.lease);
    };
    try {
      await h.outil.execute("1", { agent: "worker", batch: [{ work_unit: "W03", task: "écrire pour W03" }] });
    } finally {
      PILOTE.pendant = undefined;
    }
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    try {
      await h.outil.execute("2", tache("W03"));
    } finally {
      PILOTE.pendant = undefined;
    }

    const lane = laneActive(h, "W03");
    const cheminLane = join(h.root, ".git", "pi-lanes", lane);
    precondition(
      readFileSync(join(cheminLane, "src", "b.py"), "utf-8") === "b = 'sous bail perdu'\n" &&
        readFileSync(join(cheminLane, "src", "a.py"), "utf-8") === "a = 2\n",
      "les deux changements doivent être dans l'arbre de la lane",
    );
    const ecritures = h.journal().flatMap((r) => (r.changed_files as string[] | undefined) ?? []);
    precondition(
      !ecritures.includes("src/b.py") && ecritures.includes("src/a.py"),
      `src/b.py ne doit apparaître dans aucune délégation journalisée ; ${JSON.stringify(ecritures)}`,
    );
    const proprietaire = JSON.parse(
      readFileSync(join(h.runDir, `${h.runId}.lease`, "owner.json"), "utf-8"),
    ) as Lease;
    precondition(proprietaire.sessionId !== "session-autre", "le nouveau propriétaire doit tenir le bail");

    const r = await issue(() => h.outil.execute("3", revue("W03")));
    PILOTE.resultat = undefined;
    const paquet = APPELS.filter((a) => a.agent === "reviewer").at(-1)?.task ?? "";
    const vuB = paquet.includes("diff --git a/src/b.py b/src/b.py");
    const vuA = paquet.includes("diff --git a/src/a.py b/src/a.py");
    const approbation = h.evenements().find((e) => e.event === "REVIEWED");
    const integreeOk = integree(h.root, "src/a.py", "a = 2") && integree(h.root, "src/b.py", "b = 'sous bail perdu'");

    propriete(
      vuB && vuA && r.kind === "returned" && integreeOk && (blocages(r.value) ?? []).length === 0,
      `le reviewer a vu src/b.py ${vuB} et src/a.py ${vuA} ; preuve ` +
        `${JSON.stringify(approbation?.proof)} ; intégrée ${integreeOk} ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== la porte, C3.7

regressionCorrigee("B2-porte-blocages", "la porte rend l'ensemble exact de ses causes de politique", async () => {
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
