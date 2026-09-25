/**
 * l0-b3-integration-harness.test.ts — L0, vague B3 : FROZEN → MERGED → INTEGRATED.
 *
 * § F fait de l'intégration trois états et non deux, pour distinguer « la lane est
 * mergée » de « le Statut est traité » et de « l'intégration est terminée ». Chaque
 * frontière est une fenêtre de crash, et chacune se monte en état git réel accordé à un
 * registre arrêté au bon événement — jamais un drapeau interne.
 *
 * Montage : `l0-b2-harness.ts` et `l0-b3-fixtures.ts`.
 */
import { test, type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PILOTE } from "./stubs/dispatch.ts";
import {
  aJeter, ecrire, enveloppeComplete, git, integree, issue, laneActive, monter, montrer,
  precondition, propriete, revue, tache,
} from "./l0-b2-harness.ts";
import {
  designMd, etatCanonique, integration, mergesDe, nettoyerHooks, planAvecDesign, racinePropre,
  statutDe, teteDe, treeDe,
} from "./l0-b3-fixtures.ts";
import { releaseRunOwnership, type Lease } from "../subagent-only/run-manifest.ts";
import { admettre } from "../subagent-only/scheduler.ts";
import { parsePlan, scopesCollide } from "../subagent-only/work-units.ts";

/** La lane d'une unité, même une fois son worktree retiré : le registre la nomme. */
const laneActive2 = (h: Awaited<ReturnType<typeof monter>>, unite: string): string =>
  String(h.evenements().find((e) => e.event === "OPENED" && e.work_unit === unite)?.lane
    ?? `${h.runId}-${unite}`);

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function couverture(id: string, titre: string, fn: Preuve): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
test.after(() => {
  nettoyerHooks();
  for (const d of aJeter()) rmSync(d, { recursive: true, force: true });
});

/** Une unité travaillée, revue et intégrée par la surface publique. */
async function integrer(h: Awaited<ReturnType<typeof monter>>, unite: string, valeur: string, seq: string) {
  const fichier = unite === "W03" ? "src/a.py" : "src/b.py";
  PILOTE.pendant = ecrire(fichier, `${valeur}\n`);
  await h.outil.execute(`${seq}a`, tache(unite));
  PILOTE.pendant = undefined;
  const r = await issue(() => h.outil.execute(`${seq}b`, revue(unite)));
  PILOTE.resultat = undefined;
  return r;
}

// ================================================================== la chaîne complète

regressionCorrigee("B3-chaine", "une intégration réussie écrit les trois états, et le dit en clair", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const lane = laneActive(h, "W03");
    const resultat = await issue(() => h.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;
    precondition(integree(h.root, "src/a.py", "a = 2"), "la lane doit avoir été intégrée");

    const decrire = (evts: Array<Record<string, unknown>>): string[] => {
      const gel = evts.find((e) => e.event === "FROZEN" && e.work_unit === "W03");
      const merge = evts.find((e) => e.event === "MERGED" && e.work_unit === "W03");
      const fin = evts.find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
      const commit = typeof merge?.integration_commit === "string"
        ? (merge.integration_commit as string) : undefined;
      const existe = commit !== undefined &&
        git(h.root, "cat-file", "-t", commit).trim() === "commit";
      return [
        ...enveloppeComplete(merge, "W03", lane),
        ...enveloppeComplete(fin, "W03", lane),
        ...(existe ? [] : [`integration_commit ${JSON.stringify(commit)} n'est pas un commit`]),
        ...(Number.isInteger(merge?.frozen_event_seq) && merge?.frozen_event_seq === gel?.event_seq
          ? [] : [`frozen_event_seq ${JSON.stringify(merge?.frozen_event_seq)}`]),
        ...(fin?.integration_commit === commit ? [] : ["integration_commit divergent"]),
        ...(JSON.stringify(fin?.status) === JSON.stringify({ outcome: "not-applicable" })
          ? [] : [`status ${JSON.stringify(fin?.status)}`]),
        ...(commit !== undefined && teteDe(h.root) === commit ? [] : ["HEAD ≠ integration_commit"]),
        ...(gel !== undefined && merge !== undefined && fin !== undefined &&
          Number(gel.event_seq) < Number(merge.event_seq) &&
          Number(merge.event_seq) < Number(fin.event_seq)
          ? [] : ["ordre FROZEN → MERGED → INTEGRATED"]),
      ];
    };
    const ecrit = decrire(h.evenements());
    const fin = h.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
    const sortie = integration(resultat.value);
    const conforme =
      sortie !== null &&
      sortie.outcome === "integrated" &&
      sortie.work_unit === "W03" &&
      sortie.lane === lane &&
      sortie.integration_commit === fin?.integration_commit &&
      sortie.integrated_event_seq === fin?.event_seq &&
      JSON.stringify(sortie.status) === JSON.stringify(fin?.status);

    // Les trois événements doivent se relire à l'identique après rechargement.
    const neuve = await h.recharger();
    const trois = (x: { evenements: () => Array<Record<string, unknown>> }) =>
      JSON.stringify(x.evenements().filter((e) =>
        ["FROZEN", "MERGED", "INTEGRATED"].includes(String(e.event))));
    const identique = trois(neuve) === trois(h);

    propriete(
      ecrit.length === 0 && conforme && identique,
      `les trois états, complets et dans l'ordre, avec details.integration identique au ` +
        `registre (C5.7) et une relecture stricte après rechargement ; forme ` +
        `${JSON.stringify(ecrit)}, sortie ${JSON.stringify(sortie)}, relecture identique ` +
        `${identique}`,
    );
  } finally { h.fin(); }
});

// ================================================================== L9-Q4 — la lane sans changement

couverture("B3-merge-sans-changement", "une lane approuvée sans changement suit la chaîne entière", async () => {
  /*
   * Le worker ne change rien : T_L = tree(base). Le LOT 8 n'écrivait alors aucun FROZEN et
   * mergeait un commit absent ; le LOT 9 exige un vrai gel vide, un vrai merge à deux
   * parents, puis la chaîne FROZEN → MERGED → INTEGRATED not-applicable.
   */
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 1\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const lane = laneActive(h, "W03");
    const base = teteDe(join(h.root, ".git", "pi-lanes", lane));
    const treeBase = treeDe(h.root, base);
    precondition(treeDe(h.root) === treeBase, "la racine doit porter le tree de la base de la lane");
    const racineAvant = teteDe(h.root);
    const resultat = await issue(() => h.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;

    const evts = h.evenements();
    const gel = evts.find((e) => e.event === "FROZEN" && e.work_unit === "W03");
    const merge = evts.find((e) => e.event === "MERGED" && e.work_unit === "W03");
    const fin = evts.find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
    const commitGel = typeof gel?.commit === "string" ? (gel.commit as string) : "";
    const parentsGel = commitGel ? git(h.root, "rev-list", "--parents", "-n", "1", commitGel).trim().split(/\s+/).slice(1) : [];
    const integ = typeof merge?.integration_commit === "string" ? (merge.integration_commit as string) : "";
    const parentsInteg = integ ? git(h.root, "rev-list", "--parents", "-n", "1", integ).trim().split(/\s+/).slice(1) : [];
    const sortie = integration(resultat.value);
    const manques = [
      ...(commitGel && parentsGel.length === 1 && parentsGel[0] === base && treeDe(h.root, commitGel) === treeBase &&
        gel?.parent === base && gel?.tree === treeBase ? [] : [`gel ${JSON.stringify(gel)} parents ${JSON.stringify(parentsGel)}`]),
      ...(merge !== undefined && merge.frozen_event_seq === gel?.event_seq ? [] : [`MERGED ${JSON.stringify(merge)}`]),
      ...(parentsInteg.length === 2 && parentsInteg[0] === racineAvant && parentsInteg[1] === commitGel
        ? [] : [`merge à deux parents ${JSON.stringify(parentsInteg)}`]),
      ...(treeDe(h.root, integ || "HEAD") === treeBase ? [] : ["tree de l'intégration ≠ tree(base)"]),
      ...(fin !== undefined && fin.integration_commit === integ &&
        JSON.stringify(fin.status) === JSON.stringify({ outcome: "not-applicable" }) ? [] : [`INTEGRATED ${JSON.stringify(fin)}`]),
      ...(sortie !== null && sortie.integrated_event_seq === fin?.event_seq && sortie.integration_commit === integ
        ? [] : [`details.integration ${JSON.stringify(sortie)}`]),
      ...(teteDe(h.root) === integ && racinePropre(h.root) ? [] : ["HEAD ≠ intégration ou racine sale"]),
    ];
    propriete(
      manques.length === 0,
      `lane sans changement : gel vide réel, FROZEN, merge à deux parents, MERGED, INTEGRATED ` +
        `not-applicable, details.integration, racine propre ; manques ${JSON.stringify(manques)} ; ${montrer(resultat)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== L9-Q15 — l'admission seule

preservation("B3-dependances-admission-seule", "une lane valablement ouverte ne se réadmet pas à l'intégration", async () => {
  /*
   * W03 dépend de W09, jamais intégrée. Sa lane est pourtant valablement ouverte : un worktree
   * orphelin adopté par l'opérateur (`subagent-recover W03 adopt`) porte un OPENED sans passer
   * par l'admission. Le témoin établit que réadmettre W03 maintenant la refuserait ; la
   * propriété, que son intégration aboutit malgré tout — les dépendances se jugent à
   * l'admission, et seulement là (L9-Q15).
   */
  const plan = {
    version: 1,
    work_units: [
      { id: "W03", goal: "faire W03", depends_on: ["W09"], expected_write_scope: ["src/a.py"] },
      { id: "W09", goal: "faire W09", depends_on: [], expected_write_scope: ["src/b.py"] },
    ],
  };
  const h = await monter({ plan });
  try {
    const lane = `${h.runId}-W03-g1`;
    git(h.root, "worktree", "add", "-q", "-b", `pi-lane/${lane}`, join(h.root, ".git", "pi-lanes", lane));
    const owner = join(h.runDir, `${h.runId}.lease`, "owner.json");
    if (existsSync(owner)) releaseRunOwnership(h.runDir, JSON.parse(readFileSync(owner, "utf-8")) as Lease);
    const majeur = Number(process.versions.node.split(".")[0]);
    const adoption = spawnSync(process.execPath, [
      ...(majeur < 23 ? ["--experimental-strip-types"] : []),
      join(import.meta.dirname, "..", "bin", "subagent-recover"), "W03", "adopt",
    ], { cwd: h.root, encoding: "utf-8" });
    precondition(
      adoption.status === 0 && h.evenements().some((e) => e.event === "OPENED" && e.lane === lane),
      `la lane de W03 doit être ouverte par adoption ; ${adoption.stdout}${adoption.stderr}`,
    );

    // Le témoin : l'admission, appelée sur l'état construit, refuserait W03.
    const temoin = admettre(
      { workUnitId: "W03", task: "réadmission" },
      { units: parsePlan(JSON.stringify(plan)).units, integrated: new Set<string>(), collide: scopesCollide },
      [],
    );
    precondition(
      temoin.issue === "refusee" && /W09/.test(temoin.reason),
      `le témoin doit refuser W03 sur sa dépendance ; ${JSON.stringify(temoin)}`,
    );

    const neuve = await h.recharger();
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await neuve.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const r = await issue(() => neuve.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;
    const fin = neuve.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
    propriete(
      integree(neuve.root, "src/a.py", "a = 2") && fin !== undefined && integration(r.value) !== null &&
        !neuve.evenements().some((e) => e.event === "INTEGRATED" && e.work_unit === "W09"),
      `W03, valablement ouverte, s'intègre sans réadmission alors que sa dépendance W09 ne l'est pas ` +
        `(témoin : ${temoin.issue === "refusee" ? temoin.reason : temoin.issue}) ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== les trois fenêtres

/**
 * Un état canonique, et son témoin.
 *
 * Un registre v2 est inerte pour le runtime d'aujourd'hui : il refuse tout. Chaque
 * fenêtre de crash a donc besoin de l'histoire complète à côté d'elle — sans quoi
 * « refusé » serait vrai sans qu'aucune reprise ait été tentée.
 */
async function fenetre(
  jusqua: "FROZEN" | "MERGED",
  options: { avecStatut?: boolean; fausser?: "parent" | "transformation" } = {},
) {
  const h = await monter({ bundle: true, design: DESIGN, plan: PLAN_D001 });
  // `avecStatut` sépare les deux fenêtres qui s'arrêtent à MERGED : l'une avant le commit
  // de Statut, l'autre après.
  const etat = etatCanonique(h, {
    jusqua,
    design: options.avecStatut ? TRANSITION : undefined,
    fausser: options.fausser,
  });
  return { h, etat };
}
const DESIGN = designMd([{ id: "D-001", titre: "orchestration", statut: "proposé" }]);
const TRANSITION = { decision_id: "D-001", from_status: "proposé", to_status: "en cours" };
const PLAN_D001 = planAvecDesign([{ id: "W03", design_update: TRANSITION }, { id: "W09" }]);

regressionCorrigee("B3-crash-merge", "un merge sans MERGED se reprend sur l'état exact, et se refuse sinon", async () => {
  const manques: string[] = [];

  /*
   * Le témoin : une histoire canonique COMPLÈTE doit être consommable.
   *
   * Vérifier qu'un INTEGRATED existe ne prouverait rien — la fixture vient de l'écrire.
   * Le témoin intègre donc une SECONDE unité par la surface publique, et exige son
   * propre INTEGRATED et son `details.integration`.
   */
  const temoin = await monter({
    bundle: true,
    design: DESIGN,
    // Aucun design_update : le `status: not-applicable` de la fixture est alors cohérent.
    plan: planAvecDesign([{ id: "W03" }, { id: "W09" }]),
  });
  try {
    etatCanonique(temoin, { jusqua: "INTEGRATED" });
    const neuf = await temoin.recharger();
    if (!neuf.chargement.ok) {
      manques.push(`témoin : la session ne s'ouvre pas sur un manifeste v2 — ${neuf.chargement.erreur}`);
    } else {
      const r = await integrer(neuf, "W09", "b = 2", "t");
      const fin = neuf.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W09");
      if (fin === undefined || integration(r.value)?.outcome !== "integrated") {
        manques.push(`témoin : W09 n'a pas été intégrée depuis un registre v2 ; ${montrer(r)}`);
      }
    }
  } finally { temoin.fin(); }

  for (const variante of ["exacte", "parent faux"] as const) {
    const { h } = await fenetre("FROZEN");
    try {
      if (variante === "parent faux") {
        writeFileSync(join(h.root, "src", "a.py"), "a = 'réécrit hors runtime'\n");
        git(h.root, "add", "-A");
        git(h.root, "commit", "-qm", "réécriture hors runtime");
      }
      precondition(
        !h.evenements().some((e) => ["MERGED", "INTEGRATED"].includes(String(e.event))),
        `${variante} : le registre doit s'arrêter à FROZEN`,
      );
      const avant = teteDe(h.root);
      const neuve = await h.recharger();
      if (!neuve.chargement.ok) {
        manques.push(`${variante} : session non ouverte — ${neuve.chargement.erreur}`);
        continue;
      }
      await issue(() => integrer(neuve, "W09", "b = 2", "2"));

      if (variante === "exacte") {
        if (mergesDe(neuve.root, "W03") !== 1) manques.push(`exacte : ${mergesDe(neuve.root, "W03")} merges`);
        if (!neuve.evenements().some((e) => e.event === "INTEGRATED" && e.work_unit === "W03")) {
          manques.push("exacte : l'intégration de W03 n'a pas été reprise au registre");
        }
      } else if (integree(neuve.root, "src/b.py", "b = 2") || teteDe(neuve.root) !== avant) {
        manques.push("parent faux : une mutation a été permise");
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `une histoire canonique complète se consomme, l'état exact se reprend sans remerge, ` +
      `l'état contradictoire se refuse sans mutation ; ${manques.join(" · ")}`,
  );
});

regressionCorrigee("B3-crash-statut", "MERGED écrit sans Statut traité : la reprise est déterministe", async () => {
  const { h, etat } = await fenetre("MERGED");
  try {
    precondition(
      h.evenements().some((e) => e.event === "MERGED") &&
        !h.evenements().some((e) => e.event === "INTEGRATED"),
      "le registre doit s'arrêter à MERGED",
    );
    precondition(teteDe(h.root) === etat.integrationCommit, "HEAD doit être le commit d'intégration");
    precondition(
      statutDe(readFileSync(join(h.root, "DESIGN.md"), "utf-8"), "D-001") === "proposé",
      "DESIGN doit être resté à from_status",
    );

    const neuve = await h.recharger();
    const r = await issue(() => integrer(neuve, "W09", "b = 2", "2"));
    const design = readFileSync(join(neuve.root, "DESIGN.md"), "utf-8");
    propriete(
      neuve.chargement.ok &&
        mergesDe(neuve.root, "W03") === 1 &&
        neuve.evenements().some((e) => e.event === "INTEGRATED" && e.work_unit === "W03") &&
        statutDe(design, "D-001") === "en cours" &&
        racinePropre(neuve.root),
      `la session doit s'ouvrir sur un manifeste v2 (${JSON.stringify(neuve.chargement)}), puis ` +
        `la reprise traite le Statut et termine l'intégration, sans remerger ; merges ` +
        `${mergesDe(neuve.root, "W03")}, INTEGRATED repris ` +
        `${neuve.evenements().some((e) => e.event === "INTEGRATED" && e.work_unit === "W03")}, ` +
        `D-001 ${JSON.stringify(statutDe(design, "D-001"))}, racine propre ` +
        `${racinePropre(neuve.root)} ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

regressionCorrigee("B3-crash-integrated", "un Statut commité sans INTEGRATED s'adopte sur preuve exacte", async () => {
  const manques: string[] = [];
  for (const variante of ["exacte", "parent faux", "transformation fausse"] as const) {
    const fausser = variante === "parent faux" ? "parent"
      : variante === "transformation fausse" ? "transformation" : undefined;
    const { h, etat } = await fenetre("MERGED", { avecStatut: true, fausser });
    try {
      precondition(etat.statusCommit !== undefined, `${variante} : le commit de Statut doit exister`);
      precondition(
        !h.evenements().some((e) => e.event === "INTEGRATED"),
        `${variante} : INTEGRATED doit manquer`,
      );
      const avant = teteDe(h.root);
      const neuve = await h.recharger();
      if (!neuve.chargement.ok) {
        manques.push(`${variante} : session non ouverte — ${neuve.chargement.erreur}`);
        continue;
      }
      await issue(() => integrer(neuve, "W09", "b = 2", "2"));

      const adopte = neuve.evenements().some((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
      if (variante === "exacte") {
        if (!adopte) manques.push("exacte : l'état exact n'a pas été adopté");
      } else if (adopte || teteDe(neuve.root) !== avant) {
        manques.push(`${variante} : une adoption ou une mutation a été permise`);
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `seul l'état dont le parent et la transformation sont exacts s'adopte ; ${manques.join(" · ")}`,
  );
});

// ================================================================== deux décisions à la fois

regressionCorrigee("B3-integration-concurrente", "deux intégrations entrelacées restent indivisibles", async () => {
  const D = designMd([
    { id: "D-001", titre: "orchestration", statut: "proposé" },
    { id: "D-002", titre: "registres", statut: "proposé" },
  ]);
  const h = await monter({
    bundle: true,
    design: D,
    plan: planAvecDesign([
      { id: "W03", design_update: { decision_id: "D-001", from_status: "proposé", to_status: "en cours" } },
      { id: "W09", design_update: { decision_id: "D-002", from_status: "proposé", to_status: "en cours" } },
    ]),
  });
  try {
    for (const [unite, fichier, valeur] of [["W03", "a", "a = 2"], ["W09", "b", "b = 2"]] as const) {
      PILOTE.pendant = ecrire(`src/${fichier}.py`, `${valeur}\n`);
      await h.outil.execute(`w-${unite}`, tache(unite));
      PILOTE.pendant = undefined;
    }
    precondition(
      h.evenements().filter((e) => e.event === "OPENED").length === 2,
      "les deux lanes doivent être ouvertes",
    );

    /*
     * Les deux revues partent avant que l'une ait fini. Chaque bloc merge → statut →
     * INTEGRATED doit rester indivisible, quel que soit l'ordre gagné : deux décisions
     * distinctes, deux commits de Statut, et aucun entrelacement entre les deux.
     */
    let pendantes = 0;
    let liberer: () => void = () => {};
    const relachement = new Promise<void>((r) => { liberer = r; });
    PILOTE.pendant = async () => { pendantes += 1; await relachement; };
    PILOTE.resultat = { verdict: "approved", changedFiles: [] } as never;
    const enVol = [
      issue(() => h.outil.execute("r-W03", { agent: "reviewer", work_unit: "W03", task: "juger" })),
      issue(() => h.outil.execute("r-W09", { agent: "reviewer", work_unit: "W09", task: "juger" })),
    ];
    for (let i = 0; i < 400 && pendantes < 2; i++) await new Promise((r) => setTimeout(r, 5));
    const simultanees = pendantes;
    liberer();
    const deux = await Promise.all(enVol);
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;
    precondition(simultanees === 2, `les deux revues devaient être pendantes ; vues : ${simultanees}`);

    const suite = h.evenements()
      .filter((e) => ["MERGED", "INTEGRATED"].includes(String(e.event)))
      .map((e) => `${e.event}(${e.work_unit})`);
    const indivisible =
      suite.length === 4 &&
      suite[0].startsWith("MERGED") &&
      suite[1] === `INTEGRATED(${suite[0].slice(7, -1)})` &&
      suite[2].startsWith("MERGED") &&
      suite[3] === `INTEGRATED(${suite[2].slice(7, -1)})`;

    /*
     * Rien ne dépend de l'ordre du tableau : l'ordre gagné se lit dans les `event_seq`
     * des deux MERGED, et les sorties sont indexées par unité. Sans cela, la preuve
     * deviendrait intermittente le jour où les deux intégrations fonctionneront.
     */
    const sorties = new Map<string, Record<string, unknown> | null>();
    for (const i of deux) {
      const o = integration(i.value);
      if (o && typeof o.work_unit === "string") sorties.set(o.work_unit, o);
    }
    const merges = h.evenements()
      .filter((e) => e.event === "MERGED")
      .sort((a, b) => Number(a.event_seq) - Number(b.event_seq))
      .map((e) => String(e.work_unit));
    const design = readFileSync(join(h.root, "DESIGN.md"), "utf-8");

    const parUnite = ["W03", "W09"].map((u) => {
      const o = sorties.get(u);
      const st = (o?.status ?? {}) as Record<string, unknown>;
      const commit = st.status_commit;
      const parentJuste =
        typeof commit === "string" &&
        git(h.root, "rev-parse", `${commit}^`).trim() === o?.integration_commit;
      return { unite: u, outcome: o?.outcome, statut: st.outcome, commit, parentJuste };
    });
    const commits = parUnite.map((x) => x.commit).filter((c) => typeof c === "string");

    // Le second gagnant descend du commit de Statut du premier.
    const premier = sorties.get(merges[0] ?? "");
    const second = sorties.get(merges[1] ?? "");
    const commitPremier = ((premier?.status ?? {}) as Record<string, unknown>).status_commit;
    const enchaine =
      merges.length === 2 &&
      typeof commitPremier === "string" &&
      typeof second?.integration_commit === "string" &&
      git(h.root, "merge-base", "--is-ancestor", commitPremier, String(second.integration_commit)) === "";

    propriete(
      parUnite.every((x) => x.outcome === "integrated" && x.statut === "committed" && x.parentJuste) &&
        commits.length === 2 &&
        new Set(commits).size === 2 &&
        indivisible &&
        statutDe(design, "D-001") === "en cours" &&
        statutDe(design, "D-002") === "en cours" &&
        enchaine &&
        racinePropre(h.root),
      `deux décisions, deux commits de Statut, deux blocs indivisibles et une racine propre ; ` +
        `suite ${JSON.stringify(suite)}, indivisible ${indivisible}, ordre gagné ` +
        `${JSON.stringify(merges)}, par unité ${JSON.stringify(parUnite)}, enchaînement ` +
        `${enchaine}, D-001 ${JSON.stringify(statutDe(design, "D-001"))}, D-002 ` +
        `${JSON.stringify(statutDe(design, "D-002"))}, racine propre ${racinePropre(h.root)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== ce qui doit survivre

preservation("B3-jamais-deux-merges", "une unité déjà intégrée ne se remerge pas après rechargement", async () => {
  const h = await monter();
  try {
    await integrer(h, "W03", "a = 2", "1");
    const mergesAvant = mergesDe(h.root, "W03");
    precondition(mergesAvant === 1, `W03 doit avoir été mergée une fois ; ${mergesAvant}`);

    // Une reprise après rechargement, puis une seconde : rien ne doit remerger.
    const neuve = await h.recharger();
    await issue(() => integrer(neuve, "W09", "b = 2", "2"));
    /*
     * Une tentative complète sur une unité déjà intégrée : worker puis revue. Une simple
     * revue serait refusée par la garde de streak, et le mutant ne mordrait pas.
     *
     * Elle est écrite ici plutôt que confiée à `integrer`, parce que sa PRÉCONDITION lui
     * est propre : le worker doit être ADMIS. `integrer` sert cinq autres preuves qui
     * n'ont pas à porter cette exigence, et l'imposer dans le helper la rendrait globale.
     *
     * Pourquoi cette précondition. La propriété ne dit que « un seul merge, racine
     * propre » — deux faits vrais de TOUT run qui refuse toute délégation. Sans elle, une
     * mutation qui paralyse le run à la porte de reprise laisserait la preuve verte pour
     * une raison étrangère à ce qu'elle affirme. Un worker admis établit que le run est
     * vivant ; ce qui suit mesure alors quelque chose.
     *
     * Elle n'affirme rien sur la revue : sur l'objet intact, le refus de la revue par
     * `residu-sale` est légitime, et c'est lui qui empêche le second merge.
     */
    const encore = await neuve.recharger();
    PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
    const worker: unknown = await encore.outil.execute("3a", tache("W03"));
    PILOTE.pendant = undefined;
    const admis =
      typeof worker === "object" && worker !== null &&
      (worker as { isError?: unknown }).isError === false;
    precondition(
      admis,
      `le worker de la seconde tentative doit être admis — un run paralysé ne prouve rien ; ` +
        `${JSON.stringify(worker).slice(0, 250)}`,
    );
    await issue(() => encore.outil.execute("3b", revue("W03")));
    PILOTE.resultat = undefined;

    const mergesApres = mergesDe(encore.root, "W03");
    propriete(
      mergesApres === 1 && racinePropre(encore.root),
      `une unité déjà intégrée ne se remerge pas, quelles que soient les reprises ; merges ` +
        `${mergesApres}, racine propre ${racinePropre(encore.root)}`,
    );
  } finally { h.fin(); }
});
