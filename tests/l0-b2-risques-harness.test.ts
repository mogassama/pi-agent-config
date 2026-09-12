/**
 * l0-b2-risques-harness.test.ts — L0, vague B2 : les risques durables.
 *
 * Un risque appartient à `(R, work_unit, id)` et ne bloque que son unité (C3.4). Il
 * survit au rechargement et au changement de génération de sa lane. `routed` le laisse
 * ouvert ; seul `resolved` lève la porte ; `ignored` n'est pas un événement canonique et
 * ne ferme rien.
 *
 * Le pont existant : un reviewer ouvre des risques par `openRiskItems`, un scout les
 * porte (`routed`), et une continuation les rend — `resolvedRisks` les ferme.
 *
 * Montage : `l0-b2-harness.ts`.
 */
import { test, type TestContext } from "node:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PILOTE } from "./stubs/dispatch.ts";
import {
  aJeter, abandonVersionne, blocages, ecrire, enveloppeComplete, formeRisque, integree, issue,
  laneActive, monter, montrer, precondition, propriete, revue, tache, type Harnais,
} from "./l0-b2-harness.ts";
import { openLanes, runBranches } from "../subagent-only/worktree.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

const risques = (h: Harnais, transition: string): Array<Record<string, unknown>> =>
  h.evenements().filter((e) => e.event === "RISK" && e.transition === transition);
/** Les transitions d'un risque, dans l'ordre, telles que le registre autoritaire les porte. */
const parcours = (h: Harnais, unite: string, id: string): string[] =>
  h.evenements()
    .filter((e) => e.event === "RISK" && e.work_unit === unite && e.id === id)
    .map((e) => String(e.transition));

/** Une unité travaillée puis revue avec un risque ouvert, par la surface publique. */
async function avecRisqueOuvert(h: Harnais, unite: string, id: string, seq: string): Promise<void> {
  PILOTE.pendant = ecrire(`src/${unite === "W03" ? "a" : "b"}.py`, `${unite} = 2\n`);
  await h.outil.execute(`${seq}a`, tache(unite));
  PILOTE.pendant = undefined;
  await h.outil.execute(`${seq}b`, revue(unite, { openRiskItems: [{ id, text: `risque de ${unite}` }] }));
  PILOTE.resultat = undefined;
}

// ================================================================== la clé du risque

regression("B2-risque-cle", "le même identifiant sur deux unités fait deux risques distincts", async () => {
  const h = await monter();
  try {
    /*
     * Le MÊME identifiant, ouvert par W03 puis par W09.
     *
     * Si la clé était l'identifiant seul, le second n'ouvrirait rien — le risque
     * « existe déjà » — et W09 s'intégrerait en portant un risque qu'elle n'a jamais
     * fermé. C3.4 dit que la clé est (R, work_unit, id).
     */
    await avecRisqueOuvert(h, "W03", "r-partage", "1");
    precondition(
      !integree(h.root, "src/a.py", "W03 = 2"),
      "W03 doit être bloquée par son risque avant qu'on regarde W09",
    );
    await avecRisqueOuvert(h, "W09", "r-partage", "2");
    const w09Bloquee = !integree(h.root, "src/b.py", "W09 = 2");
    const auRegistre = risques(h, "opened")
      .filter((e) => e.id === "r-partage")
      .map((e) => e.work_unit)
      .sort();

    // W09 résout le sien par le pont existant : reviewer → scout → continuation.
    await h.outil.execute("3", { agent: "scout", work_unit: "W09", task: "porter le risque" });
    PILOTE.resultat = { verdict: "approved", changedFiles: [], resolvedRisks: ["r-partage"] } as never;
    await h.outil.execute("4", { agent: "reviewer", work_unit: "W09", task: "juger" });
    PILOTE.resultat = undefined;
    const apres = await issue(() => h.outil.execute("5", revue("W03")));
    PILOTE.resultat = undefined;

    propriete(
      w09Bloquee &&
        JSON.stringify(auRegistre) === JSON.stringify(["W03", "W09"]) &&
        parcours(h, "W09", "r-partage").includes("resolved") &&
        !parcours(h, "W03", "r-partage").includes("resolved") &&
        integree(h.root, "src/b.py", "W09 = 2") &&
        !integree(h.root, "src/a.py", "W03 = 2") &&
        (blocages(apres.value) ?? []).includes("open-risks"),
      `W09 doit ouvrir son propre risque et en être bloquée (${w09Bloquee}), les deux doivent ` +
        `se distinguer au registre (${JSON.stringify(auRegistre)}), et résoudre celui de W09 ne ` +
        `doit pas lever celui de W03 ; W09 intégrée ${integree(h.root, "src/b.py", "W09 = 2")}, ` +
        `W03 intégrée ${integree(h.root, "src/a.py", "W03 = 2")}, parcours W09 ` +
        `${JSON.stringify(parcours(h, "W09", "r-partage"))}, parcours W03 ` +
        `${JSON.stringify(parcours(h, "W03", "r-partage"))}, blocages ` +
        `${JSON.stringify(blocages(apres.value))}`,
    );
  } finally { h.fin(); }
});

regression("B2-risque-reload", "un risque ouvert par task survit à la session", async () => {
  const h = await monter();
  try {
    await avecRisqueOuvert(h, "W03", "r-1", "1");
    const lane = laneActive(h, "W03");
    const ouvert = risques(h, "opened").find((e) => e.work_unit === "W03" && e.id === "r-1");
    const forme = formeRisque(ouvert, {
      unite: "W03", lane, id: "r-1", transition: "opened", champ: "by", valeur: "reviewer",
    });

    const neuve = await h.recharger();
    const relu = neuve.evenements().find((e) => e.event === "RISK" && e.id === "r-1");
    const resultat = await issue(() => neuve.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;
    propriete(
      forme.length === 0 &&
        JSON.stringify(relu) === JSON.stringify(ouvert) &&
        !integree(neuve.root, "src/a.py", "W03 = 2") &&
        (blocages(resultat.value) ?? []).includes("open-risks"),
      `RISK opened doit être écrit en entier — enveloppe, id, transition, provenance — se ` +
        `relire à l'identique, puis bloquer encore après rechargement ; forme ` +
        `${JSON.stringify(forme)}, intégrée ` +
        `${integree(neuve.root, "src/a.py", "W03 = 2")}, blocages ` +
        `${JSON.stringify(blocages(resultat.value))}`,
    );
  } finally { h.fin(); }
});

regression("B2-risque-generation", "un risque ouvert sur une génération bloque la suivante", async () => {
  const h = await monter();
  try {
    await avecRisqueOuvert(h, "W03", "r-1", "1");
    precondition(!integree(h.root, "src/a.py", "W03 = 2"), "W03 doit être bloquée par son risque");
    const risqueAvant = parcours(h, "W03", "r-1");
    const laneAvant = openLanes(h.root).find((l) => l.includes("W03"));
    const ouverturesAvant = h.evenements().filter((e) => e.event === "OPENED" && e.work_unit === "W03");

    // L'abandon est écrit dans la version que le registre porte, et retire le worktree
    // en laissant la branche : c'est ce que l'abandon laisse derrière lui.
    abandonVersionne(h, "W03");
    const neuve = await h.recharger();
    PILOTE.pendant = ecrire("src/a.py", "W03 = 3\n");
    await neuve.outil.execute("2", tache("W03"));
    PILOTE.pendant = undefined;
    const resultat = await issue(() => neuve.outil.execute("3", revue("W03")));
    PILOTE.resultat = undefined;

    const ouvertures = neuve.evenements().filter((e) => e.event === "OPENED" && e.work_unit === "W03");
    const laneApres = openLanes(neuve.root).find((l) => l.includes("W03"));
    const generationSuivante =
      ouvertures.length === ouverturesAvant.length + 1 &&
      Number(ouvertures.at(-1)?.generation) === Number(ouverturesAvant.at(-1)?.generation ?? 0) + 1;

    propriete(
      risqueAvant.includes("opened") &&
        generationSuivante &&
        laneApres !== undefined &&
        laneApres !== laneAvant &&
        runBranches(neuve.root, neuve.runId).filter((b) => b.includes("W03")).length === 2 &&
        !integree(neuve.root, "src/a.py", "W03 = 3") &&
        (blocages(resultat.value) ?? []).includes("open-risks"),
      `la reprise doit allouer la génération suivante, et le risque de la même unité doit la ` +
        `bloquer ; risque avant ${JSON.stringify(risqueAvant)}, ouvertures ` +
        `${JSON.stringify(ouvertures.map((e) => e.generation))}, lane ${JSON.stringify(laneApres)} ` +
        `contre ${JSON.stringify(laneAvant)}, branches ` +
        `${JSON.stringify(runBranches(neuve.root, neuve.runId))}, blocages ` +
        `${JSON.stringify(blocages(resultat.value))}`,
    );
  } finally { h.fin(); }
});

regression("B2-risque-routed", "routed laisse le risque ouvert, seul resolved lève la porte", async () => {
  const h = await monter();
  try {
    await avecRisqueOuvert(h, "W03", "r-1", "1");
    await h.outil.execute("2", { agent: "scout", work_unit: "W03", task: "porter le risque" });
    const apresRoute = await issue(() => h.outil.execute("3", revue("W03")));
    PILOTE.resultat = undefined;
    const lane = laneActive(h, "W03");
    const bloqueApresRoute =
      !integree(h.root, "src/a.py", "W03 = 2") &&
      (blocages(apresRoute.value) ?? []).includes("open-risks") &&
      JSON.stringify(parcours(h, "W03", "r-1")) === JSON.stringify(["opened", "routed"]);

    // La continuation rend le risque résolu : la porte s'ouvre alors, et alors seulement.
    PILOTE.resultat = { verdict: "approved", changedFiles: [], resolvedRisks: ["r-1"] } as never;
    const apresResolution = await issue(() => h.outil.execute("4", { agent: "reviewer", work_unit: "W03", task: "juger" }));
    PILOTE.resultat = undefined;
    // Le parcours se relit APRÈS la résolution : une fermeture qui ne vivrait qu'en
    // mémoire laisserait le registre à « routed », et le risque reviendrait à la session
    // suivante.
    const apresRegistre = parcours(h, "W03", "r-1");
    const neuve = await h.recharger();
    const survit = parcours(neuve, "W03", "r-1");

    /*
     * Chaque transition est vérifiée en entier, provenance comprise.
     *
     * Un `routed` ou un `resolved` squelettique ferait passer le parcours tout en ne
     * disant ni qui a porté le risque ni qui l'a fermé.
     */
    const evts = h.evenements().filter((e) => e.event === "RISK" && e.work_unit === "W03" && e.id === "r-1");
    const formes = [
      ...formeRisque(evts.find((e) => e.transition === "opened"), {
        unite: "W03", lane, id: "r-1", transition: "opened", champ: "by", valeur: "reviewer",
      }),
      ...formeRisque(evts.find((e) => e.transition === "routed"), {
        unite: "W03", lane, id: "r-1", transition: "routed", champ: "to", valeur: "scout",
      }),
      ...formeRisque(evts.find((e) => e.transition === "resolved"), {
        unite: "W03", lane, id: "r-1", transition: "resolved", champ: "by", valeur: "reviewer",
      }),
    ];

    propriete(
      bloqueApresRoute &&
        formes.length === 0 &&
        JSON.stringify(apresRegistre) === JSON.stringify(["opened", "routed", "resolved"]) &&
        JSON.stringify(survit) === JSON.stringify(apresRegistre) &&
        integree(h.root, "src/a.py", "W03 = 2") &&
        !(blocages(apresResolution.value) ?? []).includes("open-risks"),
      `routed laisse ouvert (${bloqueApresRoute}), chaque transition est complète ` +
        `(${JSON.stringify(formes)}), et resolved se lit au registre puis survit à la session : ` +
        `parcours ${JSON.stringify(apresRegistre)}, relu ${JSON.stringify(survit)}, ` +
        `intégrée ${integree(h.root, "src/a.py", "W03 = 2")}, blocages ` +
        `${JSON.stringify(blocages(apresResolution.value))}`,
    );
  } finally { h.fin(); }
});

regression("B2-risque-ignored", "ignored n'est pas un événement du registre autoritaire", async () => {
  const h = await monter();
  try {
    await avecRisqueOuvert(h, "W03", "r-1", "1");
    // Une continuation qui rend un identifiant inconnu : le pont la range en `ignored`.
    await h.outil.execute("2", { agent: "scout", work_unit: "W03", task: "porter le risque" });
    PILOTE.resultat = { verdict: "approved", changedFiles: [], resolvedRisks: ["r-inconnu"] } as never;
    const resultat = await issue(() => h.outil.execute("3", { agent: "reviewer", work_unit: "W03", task: "juger" }));
    PILOTE.resultat = undefined;

    const lane = laneActive(h, "W03");
    const evts = h.evenements().filter((e) => e.event === "RISK" && e.work_unit === "W03" && e.id === "r-1");
    const formes = [
      ...formeRisque(evts.find((e) => e.transition === "opened"), {
        unite: "W03", lane, id: "r-1", transition: "opened", champ: "by", valeur: "reviewer",
      }),
      ...formeRisque(evts.find((e) => e.transition === "routed"), {
        unite: "W03", lane, id: "r-1", transition: "routed", champ: "to", valeur: "scout",
      }),
    ];
    const autoritaire = parcours(h, "W03", "r-1");
    propriete(
      JSON.stringify(autoritaire) === JSON.stringify(["opened", "routed"]) &&
        formes.length === 0 &&
        !integree(h.root, "src/a.py", "W03 = 2") &&
        (blocages(resultat.value) ?? []).includes("open-risks"),
      `une continuation qui rend un identifiant inconnu ne ferme rien : le parcours reste ` +
        `exactement opened → routed, complets, sans ignored ni resolved ; parcours ` +
        `${JSON.stringify(autoritaire)}, formes ${JSON.stringify(formes)}, intégrée ` +
        `${integree(h.root, "src/a.py", "W03 = 2")}, ` +
        `blocages ${JSON.stringify(blocages(resultat.value))}`,
    );
  } finally { h.fin(); }
});

// ================================================================== ce qui doit survivre

preservation("B2-journal-non-autoritaire", "le journal des délégations ne décide dans aucun sens", async () => {
  const bloquant = await monter();
  const sain = await monter();
  try {
    /*
     * Deux directions, et il fallait les deux.
     *
     * Le journal ne peut pas AUTORISER : un état autoritaire qui bloque reste bloquant,
     * journal effacé ou porteur d'une fausse résolution. Et il ne peut pas BLOQUER : un
     * état autoritaire sain s'intègre, journal absent ou porteur de faux événements
     * défavorables. Une preuve qui ne monterait que le premier sens laisserait passer une
     * correction qui écoute le journal pour refuser.
     */
    const chemin = (h: Harnais) => join(h.runDir, `${h.runId}-delegations.jsonl`);
    // Une unité déjà intégrée n'est plus admise : chaque tentative du sens 2 prend donc
    // la sienne, sans quoi la seconde serait refusée pour une raison étrangère au journal.
    /*
     * L'ordre compte, et il était faux.
     *
     * Poser l'état du journal AVANT la délégation ne prouvait rien : cette délégation le
     * recrée, et le cas « absent » ne l'était plus au moment de la décision. L'état est
     * donc posé juste avant l'appel décisionnel, et une PRÉCONDITION vérifie qu'il y est.
     * `undefined` veut dire absent, pas vide.
     */
    const tenter = async (
      h: Harnais, contenu: string | undefined, unite: string, valeur: string, seq: string,
    ) => {
      const fichier = unite === "W03" ? "src/a.py" : "src/b.py";
      PILOTE.pendant = ecrire(fichier, `${valeur}\n`);
      await h.outil.execute(`${seq}a`, tache(unite));
      PILOTE.pendant = undefined;
      if (contenu === undefined) rmSync(chemin(h), { force: true });
      else writeFileSync(chemin(h), contenu);
      precondition(
        contenu === undefined
          ? !existsSync(chemin(h))
          : existsSync(chemin(h)) && readFileSync(chemin(h), "utf-8") === contenu,
        `le journal doit être dans l'état demandé immédiatement avant la revue de ${unite}`,
      );
      const r = await issue(() => h.outil.execute(`${seq}b`, revue(unite)));
      PILOTE.resultat = undefined;
      return { issue: r, integree: integree(h.root, fichier, valeur) };
    };
    /*
     * Les faux événements sont du JSON valide, et non précédés d'une ligne tronquée : un
     * lecteur qui abandonnerait sur la première ligne ne verrait jamais le mensonge, et
     * la preuve resterait verte sans avoir rien éprouvé. La troncature est un cas à part.
     */
    const FAUSSE_RESOLUTION = `${JSON.stringify({ seq: 99, role: "reviewer", risks_resolved: ["r-1"] })}\n`;
    const FAUX_DEFAVORABLE = `${JSON.stringify({
      seq: 99, role: "worker", reserved_touched: ["DESIGN.md"], risks_opened: ["r-inventé"],
    })}\n`;
    const TRONQUE = "{ ligne tronquée\n";

    // Sens 1 — le journal ne peut pas autoriser.
    await avecRisqueOuvert(bloquant, "W03", "r-1", "1");
    precondition(!integree(bloquant.root, "src/a.py", "W03 = 2"), "le risque ouvert doit bloquer W03");
    const absentBloquant = await tenter(bloquant, undefined, "W03", "W03 = 3", "2");
    const menteur = await tenter(bloquant, FAUSSE_RESOLUTION, "W03", "W03 = 4", "3");
    const tronque = await tenter(bloquant, TRONQUE, "W03", "W03 = 5", "4");

    // Sens 2 — le journal ne peut pas bloquer. Rien au registre autoritaire.
    precondition(
      !sain.evenements().some((e) => e.event === "RISK" || e.event === "VIOLATION"),
      "le run témoin ne doit porter ni risque ni violation au registre",
    );
    const absent = await tenter(sain, undefined, "W03", "sain = 2", "1");
    const defavorable = await tenter(sain, FAUX_DEFAVORABLE, "W09", "sain = 3", "2");

    const tous = [absentBloquant, menteur, tronque, absent, defavorable];
    propriete(
      !absentBloquant.integree &&
        !menteur.integree &&
        !tronque.integree &&
        absent.integree &&
        defavorable.integree &&
        tous.every((r) => r.issue.kind === "returned"),
      `le journal ne peut ni autoriser ni bloquer (T4) ; autorisé à tort — journal absent ` +
        `${absentBloquant.integree}, fausse résolution ${menteur.integree}, tronqué ` +
        `${tronque.integree} — bloqué à tort — journal absent ${!absent.integree}, faux ` +
        `événements défavorables ${!defavorable.integree} ; ${montrer(menteur.issue)} · ` +
        `${montrer(defavorable.issue)}`,
    );
  } finally { bloquant.fin(); sain.fin(); }
});
