/**
 * l0-b3-statut-harness.test.ts — L0, vague B3 : C6, la ligne Statut.
 *
 * Rien de `design_update` n'existe dans l'objet : ni la validation au gel du plan, ni
 * l'application après intégration, ni l'interdit d'écriture inline. Ces huit preuves
 * décrivent ce que C6 exige, et le montage passe par la surface publique — plan écrit,
 * `task` appelé, résultat lu dans `details`, jamais dans une phrase.
 *
 * Montage : `l0-b2-harness.ts` et `l0-b3-fixtures.ts`.
 */
import { test, type TestContext } from "node:test";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { execFileSync, spawnSync } from "node:child_process";

import {
  aJeter, ecrire, git, integree, issue, monter, montrer, precondition, propriete, revue, tache,
} from "./l0-b2-harness.ts";
import {
  aTourne, designMd, gardeDeRun, integration, marqueurHook, nettoyerHooks, planAvecDesign,
  poserPreCommitRacine, racinePropre, statutDe, teteDe,
} from "./l0-b3-fixtures.ts";
import { openLanes } from "../subagent-only/worktree.ts";
import { releaseRunOwnership, type Lease } from "../subagent-only/run-manifest.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
test.after(() => {
  nettoyerHooks();
  for (const d of aJeter()) rmSync(d, { recursive: true, force: true });
});

const DECISIONS = [
  { id: "D-001", titre: "orchestration", statut: "proposé" },
  { id: "D-002", titre: "registres", statut: "en cours" },
];
const DESIGN = designMd(DECISIONS);
/** Le même DESIGN.md, décisions déplacées : une recherche par numéro de ligne y échoue. */
const DESIGN_DEPLACE = designMd(
  [...DECISIONS].reverse(),
  "## Contexte\n\nUn préambule qui décale tout ce qui suit.\n\n",
);

const planStatut = (update: Record<string, string> | undefined) =>
  planAvecDesign([
    { id: "W03", ...(update ? { design_update: update as never } : {}) },
    { id: "W09" },
  ]);

/** Travailler puis faire approuver une unité : la seule façon d'atteindre la phase Statut. */
async function integrer(h: Awaited<ReturnType<typeof monter>>, unite: string, valeur: string, seq: string) {
  const fichier = unite === "W03" ? "src/a.py" : "src/b.py";
  PILOTE.pendant = ecrire(fichier, `${valeur}\n`);
  await h.outil.execute(`${seq}a`, tache(unite));
  PILOTE.pendant = undefined;
  const r = await issue(() => h.outil.execute(`${seq}b`, revue(unite)));
  PILOTE.resultat = undefined;
  return r;
}
// ------------------------------------------------------------------ deux lectures de git

/** Le verbe de reprise, pour le sous-cas `completed` / `abandoned` de C6.6. */
const recover = (root: string, ...args: string[]): { status: number | null; sortie: string } => {
  const majeur = Number(process.versions.node.split(".")[0]);
  const p = spawnSync(
    process.execPath,
    [...(majeur < 23 ? ["--experimental-strip-types"] : []),
      join(import.meta.dirname, "..", "bin", "subagent-recover"), ...args],
    { cwd: root, encoding: "utf-8" },
  );
  return { status: p.status, sortie: `${p.stdout}${p.stderr}` };
};

const git0 = (root: string, commit: string): string =>
  execFileSync("git", ["rev-parse", `${commit}^`], { cwd: root, encoding: "utf-8" }).trim();
const gitDiff = (root: string, commit: string): string[] =>
  execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commit], {
    cwd: root, encoding: "utf-8",
  }).split("\n").filter(Boolean);

/**
 * Lire sans jeter.
 *
 * Une observation qui lève interrompt la preuve avant son assertion : le rouge ne dit
 * plus rien de la propriété. Tout ce qui est observé passe donc par ici.
 */
const lireOuAbsent = (p: string): string => (existsSync(p) ? readFileSync(p, "utf-8") : "(absent)");
/** Le manifeste, ou un objet vide s'il est absent ou illisible — jamais une exception. */
const manifesteDe = (x: { runDir: string }): Record<string, unknown> => {
  try {
    return JSON.parse(lireOuAbsent(join(x.runDir, "active-run.json"))) as Record<string, unknown>;
  } catch {
    return {};
  }
};
const gitStatut = (root: string): string =>
  execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root, encoding: "utf-8",
  }).trim();
const designDe = (h: { root: string }): string => lireOuAbsent(join(h.root, "DESIGN.md"));

// ================================================================== C6.1 — au gel du plan

regressionCorrigee("B3-plan-design-update-refus", "un design_update invalide fait refuser avant toute lane", async () => {
  const cas: Array<[string, Record<string, string> | undefined, unknown]> = [
    ["decision_id absent", { decision_id: "D-404", from_status: "proposé", to_status: "en cours" }, undefined],
    ["from_status inconnu", { decision_id: "D-001", from_status: "brouillon", to_status: "en cours" }, undefined],
    ["to_status inconnu", { decision_id: "D-001", from_status: "proposé", to_status: "archivé" }, undefined],
    ["transition interdite", { decision_id: "D-001", from_status: "proposé", to_status: "terminé" }, undefined],
  ];
  const manques: string[] = [];

  /*
   * L'état entier, capturé avant l'appel et comparé après.
   *
   * « Aucun OPENED » ne disait rien du reste : un refus qui aurait ouvert une lane,
   * commité, ou réécrit le plan serait passé. On compare HEAD, le registre brut, les
   * lanes, le plan et DESIGN.md.
   */
  const photo = (x: Awaited<ReturnType<typeof monter>>) => ({
    tete: teteDe(x.root),
    registre: lireOuAbsent(join(x.runDir, `${x.runId}-lanes.jsonl`)),
    lanes: openLanes(x.root).sort().join(),
    plan: lireOuAbsent(join(x.runDir, `${x.runId}-plan.json`)),
    design: designDe(x),
  });
  const inchange = async (nom: string, h: Awaited<ReturnType<typeof monter>>) => {
    const avant = photo(h);
    const r = await issue(() => h.outil.execute("1", tache("W03")));
    const apres = photo(h);
    const ecarts = Object.keys(avant).filter(
      (k) => avant[k as keyof typeof avant] !== apres[k as keyof typeof apres],
    );
    if (ecarts.length > 0 || h.evenements().length > 0) {
      manques.push(`${nom} : écarts ${JSON.stringify(ecarts)}, événements ` +
        `${h.evenements().length} ; ${montrer(r)}`);
    }
  };

  for (const [nom, update] of cas) {
    const h = await monter({ bundle: true, design: DESIGN, plan: planStatut(update) });
    try { await inchange(nom, h); } finally { h.fin(); }
  }

  // Deux cas qui portent sur le plan entier, et non sur une unité.
  const duplique = designMd([...DECISIONS, { id: "D-001", titre: "doublon", statut: "proposé" }]);
  const h1 = await monter({
    bundle: true, design: duplique,
    plan: planStatut({ decision_id: "D-001", from_status: "proposé", to_status: "en cours" }),
  });
  try { await inchange("décision dupliquée", h1); } finally { h1.fin(); }

  const deuxProprietaires = planAvecDesign([
    { id: "W03", design_update: { decision_id: "D-001", from_status: "proposé", to_status: "en cours" } },
    { id: "W09", design_update: { decision_id: "D-001", from_status: "proposé", to_status: "en cours" } },
  ]);
  const h2 = await monter({ bundle: true, design: DESIGN, plan: deuxProprietaires });
  try { await inchange("deux propriétaires", h2); } finally { h2.fin(); }

  // Septième cas : hors bundle, l'ensemble des fichiers gelés est vide (T3), et un plan
  // qui prétendrait mettre à jour une décision n'a rien à mettre à jour.
  const h3 = await monter({
    plan: planStatut({ decision_id: "D-001", from_status: "proposé", to_status: "en cours" }),
  });
  try { await inchange("hors bundle", h3); } finally { h3.fin(); }

  propriete(
    manques.length === 0,
    `chaque design_update invalide doit faire refuser au gel du plan, avant toute lane, sans ` +
      `événement, sans lane, sans commit et sans toucher au plan ni à DESIGN.md — y compris ` +
      `hors bundle ; ${manques.join(" · ")}`,
  );
});

// ================================================================== C6.2 — les trois issues

regressionCorrigee("B3-statut-committed", "une transition autorisée est appliquée et commitée", async () => {
  const manques: string[] = [];
  for (const [nom, design] of [["nominal", DESIGN], ["décision déplacée", DESIGN_DEPLACE]] as const) {
    const h = await monter({
      bundle: true, design,
      plan: planStatut({ decision_id: "D-001", from_status: "proposé", to_status: "en cours" }),
    });
    try {
      const r = await integrer(h, "W03", "a = 2", "1");
      const sortie = integration(r.value);
      const statut = (sortie?.status ?? {}) as Record<string, unknown>;
      const commitStatut = statut.status_commit as string | undefined;
      const fin = h.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
      const parentJuste =
        typeof commitStatut === "string" &&
        git0(h.root, commitStatut) === (fin?.integration_commit as string);
      // Le commit de Statut ne touche que DESIGN.md, et n'y change que cette transition.
      const touche = typeof commitStatut === "string"
        ? gitDiff(h.root, commitStatut)
        : [];
      const attendu = design.replace(
        /(### D-001 [^]*?Statut : )proposé/,
        "$1en cours",
      );
      const ok =
        statut.outcome === "committed" &&
        JSON.stringify(statut) === JSON.stringify((fin?.status ?? {}) as Record<string, unknown>) &&
        designDe(h) === attendu &&
        statut.decision_id === "D-001" &&
        statut.target_status === "en cours" &&
        parentJuste &&
        JSON.stringify(touche) === JSON.stringify(["DESIGN.md"]) &&
        statutDe(designDe(h), "D-001") === "en cours" &&
        statutDe(designDe(h), "D-002") === "en cours" &&
        racinePropre(h.root);
      if (!ok) {
        manques.push(
          `${nom} : status ${JSON.stringify(statut)}, parent juste ${parentJuste}, fichiers ` +
            `${JSON.stringify(touche)}, D-001 ${JSON.stringify(statutDe(designDe(h), "D-001"))}`,
        );
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `to_status appliqué, status_commit descendant du commit d'intégration et ne changeant que ` +
      `cette transition — quelle que soit la place de la décision dans le fichier ; ` +
      `${manques.join(" · ")}`,
  );
});

regressionCorrigee("B3-statut-unchanged", "une décision déjà au statut cible ne produit aucun commit", async () => {
  // D-002 est déjà « en cours » : la transition est autorisée, sa cible est atteinte.
  const h = await monter({
    bundle: true, design: DESIGN,
    plan: planStatut({ decision_id: "D-002", from_status: "proposé", to_status: "en cours" }),
  });
  try {
    const r = await integrer(h, "W03", "a = 2", "1");
    const sortie = integration(r.value);
    const statut = (sortie?.status ?? {}) as Record<string, unknown>;
    const fin = h.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
    propriete(
      statut.outcome === "unchanged" &&
        statut.decision_id === "D-002" &&
        statut.target_status === "en cours" &&
        statut.status_commit === undefined &&
        teteDe(h.root) === (fin?.integration_commit as string) &&
        racinePropre(h.root),
      `outcome unchanged, aucun status_commit, HEAD = integration_commit, racine propre ; ` +
        `status ${JSON.stringify(statut)}, HEAD ${teteDe(h.root).slice(0, 7)}, integration ` +
        `${String(fin?.integration_commit).slice(0, 7)}, racine propre ${racinePropre(h.root)}`,
    );
  } finally { h.fin(); }
});

regressionCorrigee("B3-statut-na", "une unité sans design_update rend not-applicable", async () => {
  const h = await monter({ bundle: true, design: DESIGN, plan: planStatut(undefined) });
  try {
    const r = await integrer(h, "W03", "a = 2", "1");
    const sortie = integration(r.value);
    const statut = (sortie?.status ?? {}) as Record<string, unknown>;
    const fin = h.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
    propriete(
      statut.outcome === "not-applicable" &&
        Object.keys(statut).length === 1 &&
        teteDe(h.root) === (fin?.integration_commit as string) &&
        designDe(h) === DESIGN &&
        racinePropre(h.root),
      `outcome not-applicable et rien d'autre, HEAD = integration_commit, DESIGN.md intact ; ` +
        `status ${JSON.stringify(statut)}, DESIGN inchangé ${designDe(h) === DESIGN}`,
    );
  } finally { h.fin(); }
});

regressionCorrigee("B3-statut-refus", "un statut courant inattendu fait refuser la phase Statut", async () => {
  const h = await monter({
    bundle: true, design: DESIGN,
    // D-001 est « proposé » ; ce plan attend « en cours » — transition autorisée, mais
    // incompatible avec le statut courant. Une transition interdite aurait été refusée au
    // gel du plan, et la preuve n'aurait jamais atteint la phase Statut.
    plan: planStatut({ decision_id: "D-001", from_status: "en cours", to_status: "terminé" }),
  });
  try {
    const r = await integrer(h, "W03", "a = 2", "1");
    const sortie = integration(r.value);
    const fin = h.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");
    const merge = h.evenements().find((e) => e.event === "MERGED" && e.work_unit === "W03");
    // Le merge a déjà eu lieu : « aucune modification » ne vise que la phase Statut.
    propriete(
      merge !== undefined &&
        teteDe(h.root) === (merge?.integration_commit as string) &&
        sortie === null &&
        fin === undefined &&
        designDe(h) === DESIGN &&
        racinePropre(h.root),
      `MERGED présent, HEAD = integration_commit, aucun status_commit, aucun INTEGRATED, ` +
        `DESIGN strictement inchangé, racine propre ; MERGED ${merge !== undefined}, sortie ` +
        `${JSON.stringify(sortie)}, DESIGN inchangé ${designDe(h) === DESIGN}, racine propre ` +
        `${racinePropre(h.root)} ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

regressionCorrigee("B3-statut-commit-echec", "un commit de Statut qui échoue laisse l'intégration inachevée", async () => {
  const h = await monter({
    bundle: true, design: DESIGN,
    plan: planStatut({ decision_id: "D-001", from_status: "proposé", to_status: "en cours" }),
  });
  try {
    /*
     * Un `pre-commit` sur la racine qui ne refuse QUE le commit de Statut.
     *
     * Un `.git/index.lock` posé d'avance bloquerait aussi le merge, donc avant MERGED :
     * la preuve ne dirait plus rien de la phase Statut. Ce hook laisse passer tout ce
     * qui n'est pas exactement « DESIGN.md seul dans l'index », et laisse un marqueur.
     */
    const marqueur = marqueurHook();
    poserPreCommitRacine(
      h,
      `indexes=$(git diff --cached --name-only | sort | tr '\\n' ' ')\n` +
        `if [ "$indexes" = "DESIGN.md " ]; then printf 'refusé\\n' > "${marqueur}"; exit 1; fi\n` +
        `exit 0`,
    );

    const r = await integrer(h, "W03", "a = 2", "1");
    const merge = h.evenements().find((e) => e.event === "MERGED" && e.work_unit === "W03");
    const fin = h.evenements().find((e) => e.event === "INTEGRATED" && e.work_unit === "W03");

    propriete(
      aTourne(marqueur) &&
        merge !== undefined &&
        fin === undefined &&
        integration(r.value) === null &&
        teteDe(h.root) === (merge?.integration_commit as string) &&
        statutDe(designDe(h), "D-001") === "proposé" &&
        racinePropre(h.root),
      `le hook doit avoir refusé le seul commit de Statut (${aTourne(marqueur)}), MERGED rester ` +
        `durable (${merge !== undefined}), aucun INTEGRATED (${fin === undefined}), HEAD = ` +
        `integration_commit, DESIGN restauré (${JSON.stringify(statutDe(designDe(h), "D-001"))}) ` +
        `et l'arbre propre (${racinePropre(h.root)}) ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== C6.4 et C6.6

regressionCorrigee("B3-statut-inline", "un contournement de la garde bloque durablement le run", async () => {
  const h = await monter({
    bundle: true, design: DESIGN,
    plan: planStatut({ decision_id: "D-001", from_status: "proposé", to_status: "en cours" }),
  });
  try {
    const bloc = (x: Awaited<ReturnType<typeof monter>> = h) =>
      manifesteDe(x).continuation_block as Record<string, unknown> | undefined;
    const photo = (x: Awaited<ReturnType<typeof monter>> = h) => ({
      tete: teteDe(x.root),
      statut: gitStatut(x.root),
      seq: (manifesteDe(x) as { nextSeq?: number }).nextSeq,
      lanesRegistre: lireOuAbsent(join(x.runDir, `${x.runId}-lanes.jsonl`)),
      integrations: lireOuAbsent(join(x.runDir, `${x.runId}-integrations.jsonl`)),
      plan: lireOuAbsent(join(x.runDir, `${x.runId}-plan.json`)),
      design: designDe(x),
      lanes: openLanes(x.root).sort().join(),
    });

    /*
     * Le premier niveau de C6.4 : la matrice entière, trois outils × trois désignations.
     * Aucun de ces refus préventifs ne doit écrire de blocage — refuser n'est pas
     * constater un contournement.
     */
    const lien = join(h.root, "alias-design.md");
    symlinkSync(join(h.root, "DESIGN.md"), lien);
    const cibles: Array<[string, string]> = [
      ["relatif", "DESIGN.md"],
      ["absolu", join(h.root, "DESIGN.md")],
      ["lien", lien],
    ];
    const passees: string[] = [];
    let n = 0;
    for (const [forme, chemin] of cibles) {
      for (const outil of ["write", "edit", "bash"] as const) {
        n += 1;
        const input =
          outil === "write" ? { path: chemin, content: "x" }
          : outil === "edit" ? { path: chemin, edits: [{ oldText: "a", newText: "b" }] }
          : { command: `echo x > ${JSON.stringify(chemin)}` };
        const d = await h.emettre("tool_call", { toolName: outil, toolCallId: `p${n}`, input });
        if ((d as { block?: boolean } | undefined)?.block !== true) passees.push(`${outil} ${forme}`);
      }
    }
    const sansBlocAvant = bloc() === undefined;

    /*
     * Le second niveau : une commande que l'avant-appel ne reconnaît pas, l'écriture
     * pendant l'outil, puis l'après-appel — qui doit constater et bloquer. Le blocage
     * doit exister AVANT toute invocation de `task`.
     */
    const contournement = "python3 -c \"open('DESIGN'+'.md','a').write('x')\"";
    const preAppel = await h.emettre("tool_call", {
      toolName: "bash", toolCallId: "c1", input: { command: contournement },
    });
    const contournementPasse = (preAppel as { block?: boolean } | undefined)?.block !== true;
    const contourne = `${DESIGN}\n<!-- écrit en contournant la garde -->\n`;
    writeFileSync(join(h.root, "DESIGN.md"), contourne);
    const apresAppel = h.abonnements().find((x) => x === "tool_result");
    if (apresAppel) await h.emettre(apresAppel, { toolName: "bash", toolCallId: "c1" });
    const blocPose = bloc();
    const avantRoles = photo();

    const appelsAvant = APPELS.length;
    const refus: Array<{ role: string; garde: Record<string, unknown> | null }> = [];
    for (const role of ["worker", "reviewer", "scout"]) {
      const r = await issue(() =>
        h.outil.execute(`c-${role}`, { agent: role, work_unit: "W03", task: "après contournement" }),
      );
      refus.push({ role, garde: gardeDeRun(r.value) });
    }
    const rienMute =
      APPELS.length === appelsAvant &&
      JSON.stringify(photo()) === JSON.stringify(avantRoles);
    const immuable = JSON.stringify(bloc()) === JSON.stringify(blocPose);

    const neuve = await h.recharger();
    const avantRechargement = photo(neuve);
    const apres = await issue(() => neuve.outil.execute("c-reload", tache("W03")));
    const gardeApres = gardeDeRun(apres.value);
    const rienMuteApres = JSON.stringify(photo(neuve)) === JSON.stringify(avantRechargement);
    const immuableApres = JSON.stringify(bloc(neuve)) === JSON.stringify(blocPose);

    /*
     * Le sous-cas terminal demande son propre run, et il faut dire pourquoi.
     *
     * Sur le premier, aucune unité n'est intégrée : `completed` refuserait de toute façon,
     * sans que `continuation_block` y soit pour rien. Le second run est donc par ailleurs
     * terminable — une unité intégrée, une racine propre — et son bail est rendu avant
     * d'appeler le verbe, sinon le refus viendrait du propriétaire vivant.
     */
    const terminable = await monter({
      bundle: true, design: DESIGN, plan: planAvecDesign([{ id: "W03" }]),
    });
    let sousCas = "non atteint";
    let finRefusee: { status: number | null; sortie: string } = { status: 0, sortie: "" };
    let finAbandon: { status: number | null; sortie: string } = { status: 1, sortie: "" };
    let blocTerminal: Record<string, unknown> | undefined;
    let blocArchive: Record<string, unknown> | undefined;
    let manifesteApresCompleted: Record<string, unknown> = {};
    let prete = false;
    let manifesteIntact = false;
    try {
      await integrer(terminable, "W03", "a = 2", "1");
      const integree2 = terminable.evenements().some((e) => e.event === "INTEGRATED");
      await terminable.emettre("tool_call", {
        toolName: "bash", toolCallId: "t1", input: { command: contournement },
      });
      writeFileSync(join(terminable.root, "DESIGN.md"), `${DESIGN}\n<!-- contourné -->\n`);
      const apres2 = terminable.abonnements().find((x) => x === "tool_result");
      if (apres2) await terminable.emettre(apres2, { toolName: "bash", toolCallId: "t1" });
      blocTerminal = bloc(terminable);

      // La modification reste observable, mais la racine redevient propre : un opérateur
      // la commite. Sans cela, `completed` refuserait pour racine sale.
      git(terminable.root, "add", "-A");
      git(terminable.root, "commit", "-qm", "trace du contournement");
      const owner = join(terminable.runDir, `${terminable.runId}.lease`, "owner.json");
      if (existsSync(owner)) {
        releaseRunOwnership(terminable.runDir, JSON.parse(readFileSync(owner, "utf-8")) as Lease);
      }
      // Libérer ne suffit pas : il faut constater que le bail est parti. Sinon `completed`
      // pourrait refuser pour propriétaire vivant, et la preuve mettrait ce refus au
      // compte du blocage.
      const bailRendu = !existsSync(owner);
      prete =
        integree2 &&
        gitStatut(terminable.root) === "" &&
        openLanes(terminable.root).length === 0 &&
        bailRendu;

      const avantFin = lireOuAbsent(join(terminable.runDir, "active-run.json"));
      finRefusee = recover(terminable.root, "run", "completed");
      manifesteApresCompleted = manifesteDe(terminable);
      manifesteIntact = lireOuAbsent(join(terminable.runDir, "active-run.json")) === avantFin;
      finAbandon = recover(terminable.root, "run", "abandoned", "--reason", "contournement constaté");
      try {
        blocArchive = (JSON.parse(
          lireOuAbsent(join(terminable.runDir, `${terminable.runId}-run.json`)),
        ) as Record<string, unknown>).continuation_block as Record<string, unknown> | undefined;
      } catch { blocArchive = undefined; }
      sousCas = `terminable ${prete} (bail rendu ${bailRendu}), manifeste intact ` +
        `${manifesteIntact}, statut ${String(manifesteApresCompleted.status)}`;
    } finally { terminable.fin(); }

    /*
     * Un run bloqué n'est pas un run fini : `completed` reste impossible, `abandoned`
     * reste permis, et l'archive garde la trace du blocage.
     */

    propriete(
      passees.length === 0 &&
        sansBlocAvant &&
        contournementPasse &&
        apresAppel !== undefined &&
        blocPose?.code === "RUN_CONTINUATION_BLOCKED" &&
        typeof blocPose.at === "string" &&
        refus.every((r) => r.garde?.code === "RUN_CONTINUATION_BLOCKED") &&
        rienMute &&
        immuable &&
        gardeApres?.code === "RUN_CONTINUATION_BLOCKED" &&
        designDe(neuve) === contourne &&
        rienMuteApres &&
        immuableApres &&
        prete &&
        blocTerminal?.code === "RUN_CONTINUATION_BLOCKED" &&
        finRefusee.status !== 0 &&
        manifesteIntact &&
        manifesteApresCompleted.status === "active" &&
        JSON.stringify(manifesteApresCompleted.continuation_block) === JSON.stringify(blocTerminal) &&
        finAbandon.status === 0 &&
        JSON.stringify(blocArchive) === JSON.stringify(blocTerminal),
      `neuf formes refusées avant l'appel sans écrire de blocage (passées ` +
        `${JSON.stringify(passees)}, bloc avant ${sansBlocAvant}) ; le contournement passe le ` +
        `pré-appel (${contournementPasse}), un callback d'après-appel existe (${apresAppel ?? "aucun"}) ` +
        `et pose le blocage avant tout task (${JSON.stringify(blocPose)}) ; les trois rôles sont ` +
        `refusés sans rien muter (${rienMute}), le bloc est immuable (${immuable}) et survit au ` +
        `rechargement sans rien muter (${JSON.stringify(gardeApres)}, ${rienMuteApres}, ` +
        `${immuableApres}) ; sur un run par ailleurs terminable (${sousCas}), completed refuse ` +
        `(${finRefusee.status}) sans toucher au manifeste, abandoned aboutit ` +
        `(${finAbandon.status}) et l'archive porte le bloc à l'identique ` +
        `(${JSON.stringify(blocArchive)} contre ${JSON.stringify(blocTerminal)})`,
    );
  } finally { h.fin(); }
});

// ================================================================== ce qui doit survivre

preservation("B3-statut-hors-bundle", "hors bundle et sans design_update, l'intégration ordinaire passe", async () => {
  /*
   * Le chemin légitime hors régime : pas de bundle, pas de design_update, donc rien à
   * écrire. L'interdiction, elle, est une régression — le septième cas de
   * `B3-plan-design-update-refus`.
   */
  const h = await monter({ plan: planStatut(undefined) });
  try {
    const r = await integrer(h, "W03", "a = 2", "1");
    propriete(
      integree(h.root, "src/a.py", "a = 2") &&
        !existsSync(join(h.root, "DESIGN.md")) &&
        racinePropre(h.root) &&
        r.kind === "returned",
      `hors bundle, une intégration ordinaire passe, aucun DESIGN.md n'est créé et la racine ` +
        `reste propre ; intégrée ${integree(h.root, "src/a.py", "a = 2")}, DESIGN.md présent ` +
        `${existsSync(join(h.root, "DESIGN.md"))}, propre ${racinePropre(h.root)} ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

