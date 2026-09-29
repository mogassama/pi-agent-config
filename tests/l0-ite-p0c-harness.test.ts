/**
 * l0-ite-p0c-harness.test.ts — lot ITE, P0-C : un plan entièrement intégré est terminal.
 *
 * Le défaut (sol/29) : au run QD, 2 335 526 tokens — 58,6 % du run — après que le travail qualifié
 * était intégré. Dès que toutes les unités du plan gelé portent un INTEGRATED final, le plan est
 * TERMINAL, irrévocablement pour le run :
 *
 *   délégation      toute délégation refusée, tous rôles, avant réservation — ITE-C-delegation
 *   capacité        outils actifs réduits à la lecture native vérifiée ; `tool_call` refuse tout
 *                   le reste, même si la liste active est rétablie — ITE-C-outils
 *   irrévocable     un ABANDONED opérateur ultérieur ne réouvre rien — ITE-C-irrevocable
 *   redémarrage     l'état se retrouve sur le registre seul — ITE-C-redemarrage
 *   identité        un plan attaché qui manque, diverge ou devient illisible refuse tout — ITE-C-plan-rompu
 *   compatibilité   un INTEGRATED sans status sous un plan à design_update : indéterminé — ITE-C-indetermine
 *   reprise         la reprise de compaction-guard après le dernier INTEGRATED final ne rouvre rien —
 *                   ITE-C-reprise-compaction (adjudication ITE-1, E11)
 *
 * Montage : `l0-b2-harness.ts` (dont `OUTILS_PI`, l'API d'outils de pi 0.86) et `l0-b3-fixtures.ts`.
 */
import { test, type TestContext } from "node:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import {
  abandonVersionne, aJeter, ecrire, issue, monter, montrer, OUTILS_PI, outilsPiParDefaut, precondition,
  propriete, revue, tache, texte, type Harnais,
} from "./l0-b2-harness.ts";
import { designMd, gardeDeRun, nettoyerHooks, planAvecDesign } from "./l0-b3-fixtures.ts";
import { appendLaneEvent, type Lease } from "../subagent-only/run-manifest.ts";
import compactionGuard from "../extensions/compaction-guard/index.ts";
import { execFileSync } from "node:child_process";

type Preuve = (t: TestContext) => Promise<void> | void;
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

async function integrer(h: Harnais, unite: string, valeur: string, seq: string) {
  const fichier = unite === "W03" ? "src/a.py" : "src/b.py";
  PILOTE.pendant = ecrire(fichier, `${valeur}\n`);
  await h.outil.execute(`${seq}a`, tache(unite));
  PILOTE.pendant = undefined;
  const r = await issue(() => h.outil.execute(`${seq}b`, revue(unite)));
  PILOTE.resultat = undefined;
  return r;
}

const DESIGN = designMd([
  { id: "D-001", titre: "orchestration", statut: "proposé" },
  { id: "D-002", titre: "registres", statut: "proposé" },
]);
const PLAN_DECISIONS = planAvecDesign([
  { id: "W03", design_update: { decision_id: "D-001", from_status: "proposé", to_status: "en cours" } },
  { id: "W09", design_update: { decision_id: "D-002", from_status: "proposé", to_status: "en cours" } },
]);

/** Les deux régimes : sans bundle (status not-applicable), avec bundle et Statut commité. */
const REGIMES: Array<[string, Parameters<typeof monter>[0]]> = [
  ["sans bundle", {}],
  ["bundle", { bundle: true, design: DESIGN, plan: PLAN_DECISIONS }],
];

const manifeste = (h: Harnais) =>
  JSON.parse(readFileSync(join(h.runDir, "active-run.json"), "utf-8")) as Record<string, unknown>;
const bail = (h: Harnais) =>
  JSON.parse(readFileSync(join(h.runDir, `${h.runId}.lease`, "owner.json"), "utf-8")) as Lease;
const scoutGlobal = { agent: "scout", task: "localiser", find: "où est b.py", scope: ["src"] };
const advisorGlobal = { agent: "advisor", task: "conseiller", question: "quelle option ?" };
const LECTURE = ["read", "grep", "find", "ls"];

/** Un plan de deux unités, les deux intégrées : rend le texte de chaque intégration. */
async function toutIntegrer(h: Harnais, strict = true): Promise<{ premier: string; dernier: string; integrees: number }> {
  const r1 = await integrer(h, "W03", "a = 2", "1");
  precondition(r1.kind === "returned", `W03 doit s'intégrer ; ${montrer(r1)}`);
  const r2 = await integrer(h, "W09", "b = 2", "2");
  const integrees = h.evenements().filter((e) => e.event === "INTEGRATED").length;
  if (strict) precondition(integrees === 2, `les deux unités doivent être intégrées ; ${montrer(r2)}`);
  return { premier: texte(r1.value), dernier: r2.kind === "returned" ? texte(r2.value) : "", integrees };
}

const outil = (h: Harnais, toolName: string, toolCallId: string, input: Record<string, unknown> = {}) =>
  h.emettre("tool_call", { toolName, toolCallId, input }) as Promise<{ block?: boolean; reason?: string } | undefined>;

// ================================================================== délégation

regressionCorrigee("ITE-C-delegation", "un plan entièrement intégré refuse toute délégation, tous rôles, avant réservation", async () => {
  const manques: string[] = [];
  for (const [regime, options] of REGIMES) {
    const h = await monter(options);
    try {
      const { premier, dernier, integrees } = await toutIntegrer(h, false);
      if (integrees !== 2) manques.push(`${regime} : ${integrees} unité(s) intégrée(s) sur 2 — le plan s'est fermé trop tôt`);
      if (premier.includes("PLAN TERMINAL")) manques.push(`${regime} : W03 seule a déclaré le plan terminal`);
      if (!dernier.includes("PLAN TERMINAL")) manques.push(`${regime} : la dernière intégration ne dit pas PLAN TERMINAL`);
      const cas: Array<[string, Record<string, unknown>]> = [
        ["scout global", scoutGlobal],
        ["advisor global", advisorGlobal],
        ["worker sur une unité du plan", tache("W09")],
        ["reviewer", { agent: "reviewer", task: "juger" }],
      ];
      let n = 0;
      for (const [quoi, params] of cas) {
        n += 1;
        const avant = { seq: manifeste(h).nextSeq, appels: APPELS.length, registre: JSON.stringify(h.evenements()) };
        const r = await issue(() => h.outil.execute(`c${n}`, params));
        const code = r.kind === "returned" ? gardeDeRun(r.value)?.code : undefined;
        const apres = { seq: manifeste(h).nextSeq, appels: APPELS.length, registre: JSON.stringify(h.evenements()) };
        if (code !== "ITE_PLAN_TERMINAL" || JSON.stringify(avant) !== JSON.stringify(apres)) {
          manques.push(`${regime} · ${quoi} : code ${String(code)}, ${JSON.stringify(avant)} → ${JSON.stringify(apres)} ; ${montrer(r)}`);
        }
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `dans les deux régimes, la dernière intégration annonce PLAN TERMINAL et toute délégation est ` +
      `refusée par ITE_PLAN_TERMINAL, sans séquence, enfant ni registre ; ${manques.join(" · ")}`,
  );
});

// ================================================================== capacité

regressionCorrigee("ITE-C-outils", "un plan terminal réduit l'orchestrateur à la lecture native vérifiée, et tool_call fait autorité", async () => {
  const h = await monter();
  try {
    /*
     * Un appel frère préparé AVANT le changement d'outils : pi prépare tous les appels d'un
     * message, puis les exécute. Une délégation en vol et un bash frère sont exclus l'un de
     * l'autre (P0-B) ; après la délégation qui achève le plan, tout nouvel appel est jugé par
     * la couche tool_call de P0-C.
     */
    await integrer(h, "W03", "a = 2", "1");
    PILOTE.pendant = ecrire("src/b.py", "b = 2\n");
    await h.outil.execute("2a", tache("W09"));
    PILOTE.pendant = undefined;
    const tacheEnVol = await outil(h, "task", "T1", revue("W09"));
    const frereAvant = await outil(h, "bash", "B1", { command: "true" });
    await h.outil.execute("T1", revue("W09"));
    PILOTE.resultat = undefined;
    await h.emettre("tool_result", { toolName: "task", toolCallId: "T1", content: [] });
    const actifsApres = [...OUTILS_PI.actifs].sort();

    // Quelqu'un rétablit la liste complète : la couche tool_call refuse quand même.
    OUTILS_PI.actifs = OUTILS_PI.tous.map((o) => o.name);
    const refus: Record<string, boolean> = {};
    for (const [nom, input] of [
      ["bash", { command: "ls" }],
      ["write", { path: "/tmp/ite-hors-depot.txt", content: "x" }],
      ["edit", { path: "src/a.py", edits: [] }],
      ["task", scoutGlobal],
    ] as Array<[string, Record<string, unknown>]>) {
      refus[nom] = (await outil(h, nom, `x-${nom}`, input))?.block === true;
    }
    const lectureAdmise = (await outil(h, "read", "r1", { path: "src/a.py" }))?.block !== true;
    // Un `read` redéfini par une extension n'a plus la provenance native : refusé lui aussi.
    OUTILS_PI.tous = OUTILS_PI.tous.map((o) =>
      o.name === "read" ? { name: "read", sourceInfo: { source: "local", path: "/ext/faux-read.ts" } } : o);
    const readRedefiniRefuse = (await outil(h, "read", "r2", { path: "src/a.py" }))?.block === true;
    outilsPiParDefaut();

    propriete(
      tacheEnVol?.block !== true && frereAvant?.block === true &&
        JSON.stringify(actifsApres) === JSON.stringify([...LECTURE].sort()) &&
        Object.values(refus).every(Boolean) && lectureAdmise && readRedefiniRefuse,
      `le frère préparé pendant la délégation est refusé (${JSON.stringify(frereAvant)}) ; après le plan ` +
        `terminal, outils actifs = lecture native (${JSON.stringify(actifsApres)}) ; liste rétablie, ` +
        `tool_call refuse bash/write/edit/task (${JSON.stringify(refus)}), admet read natif ` +
        `(${lectureAdmise}), refuse un read redéfini (${readRedefiniRefuse})`,
    );
  } finally { h.fin(); outilsPiParDefaut(); }
});

// ================================================================== irrévocable

regressionCorrigee("ITE-C-irrevocable", "un ABANDONED opérateur après le plan terminal ne réouvre ni la délégation ni une génération", async () => {
  const h = await monter();
  try {
    await toutIntegrer(h);
    abandonVersionne(h, "W03");
    precondition(h.evenements().some((e) => e.event === "ABANDONED" && e.work_unit === "W03"), "l'ABANDONED doit être au registre");
    const avant = manifeste(h).nextSeq;
    const r = await issue(() => h.outil.execute("s1", scoutGlobal));
    const code = r.kind === "returned" ? gardeDeRun(r.value)?.code : undefined;
    const g2 = await issue(() => appendLaneEvent(h.runDir, {
      event: "OPENED", work_unit: "W03", at: new Date().toISOString(),
      base: "0".repeat(40), lane: `${h.runId}-W03-g2`, generation: 2,
    }, bail(h)));
    propriete(
      code === "ITE_PLAN_TERMINAL" && manifeste(h).nextSeq === avant && g2.kind === "threw" && /P0-C/.test(g2.error),
      `après ABANDONED opérateur de W03, le plan reste terminal (${String(code)}, séquence ${String(avant)}→` +
        `${String(manifeste(h).nextSeq)}) et l'écrivain refuse OPENED g2 (${montrer(g2)})`,
    );
  } finally { h.fin(); }
});

// ================================================================== redémarrage

regressionCorrigee("ITE-C-redemarrage", "après redémarrage, l'état terminal se retrouve sur le registre et retire les outils", async () => {
  const h = await monter();
  try {
    await toutIntegrer(h);
    const neuve = await h.recharger();
    OUTILS_PI.actifs = OUTILS_PI.tous.map((o) => o.name);
    await neuve.emettre("session_start", {}, { ui: { setStatus: () => {} } });
    const actifs = [...OUTILS_PI.actifs].sort();
    const r = await issue(() => neuve.outil.execute("s1", scoutGlobal));
    const code = r.kind === "returned" ? gardeDeRun(r.value)?.code : undefined;
    propriete(
      JSON.stringify(actifs) === JSON.stringify([...LECTURE].sort()) && code === "ITE_PLAN_TERMINAL",
      `une session neuve retrouve le plan terminal dès session_start (outils ${JSON.stringify(actifs)}) ` +
        `et refuse la délégation (${String(code)})`,
    );
  } finally { h.fin(); outilsPiParDefaut(); }
});

// ================================================================== identité du plan

regressionCorrigee("ITE-C-plan-rompu", "un plan attaché qui diverge, manque ou devient illisible refuse toute délégation", async () => {
  const manques: string[] = [];
  const alterations: Array<[string, (p: string) => void]> = [
    ["réécrit mais valide", (p) => {
      const doc = JSON.parse(readFileSync(p, "utf-8")) as { work_units: Array<{ goal: string }> };
      doc.work_units[0].goal = "un autre objectif";
      writeFileSync(p, JSON.stringify(doc));
    }],
    ["supprimé", (p) => rmSync(p)],
    ["illisible", (p) => writeFileSync(p, "{pas du json")],
  ];
  for (const [quoi, alterer] of alterations) {
    const h = await monter();
    try {
      PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
      await h.outil.execute("1", tache("W03"));
      PILOTE.pendant = undefined;
      precondition(typeof manifeste(h).planHash === "string", `${quoi} : le plan doit être attaché`);
      alterer(join(h.runDir, `${h.runId}-plan.json`));
      const avant = { seq: manifeste(h).nextSeq, appels: APPELS.length };
      const r = await issue(() => h.outil.execute("2", scoutGlobal));
      const code = r.kind === "returned" ? gardeDeRun(r.value)?.code : undefined;
      if (code !== "ITE_PLAN_ROMPU" || manifeste(h).nextSeq !== avant.seq || APPELS.length !== avant.appels) {
        manques.push(`${quoi} : ${String(code)} ; ${montrer(r)}`);
      }
    } finally { h.fin(); }
  }
  propriete(manques.length === 0, `plan rompu ⇒ ITE_PLAN_ROMPU, rien de réservé ni lancé ; ${manques.join(" · ")}`);
});

// ================================================================== compatibilité

regressionCorrigee("ITE-C-indetermine", "un INTEGRATED sans status sous un plan à design_update rend la qualification indéterminée", async () => {
  const h = await monter({ bundle: true, design: DESIGN, plan: PLAN_DECISIONS });
  try {
    await integrer(h, "W03", "a = 2", "1");
    // L'ancienne forme, lue à demeure et jamais écrite : l'INTEGRATED de W03 perd son status.
    const chemin = join(h.runDir, `${h.runId}-lanes.jsonl`);
    const lignes = readFileSync(chemin, "utf-8").split("\n").filter(Boolean).map((l, i) => {
      if (i === 0) return l;
      const e = JSON.parse(l) as Record<string, unknown>;
      if (e.event === "INTEGRATED" && e.work_unit === "W03") delete e.status;
      return JSON.stringify(e);
    });
    writeFileSync(chemin, `${lignes.join("\n")}\n`);
    precondition(existsSync(chemin), "le registre doit exister");
    const avant = manifeste(h).nextSeq;
    const r = await issue(() => h.outil.execute("s1", scoutGlobal));
    const code = r.kind === "returned" ? gardeDeRun(r.value)?.code : undefined;
    propriete(
      code === "ITE_QUALIFICATION_INDETERMINEE" && manifeste(h).nextSeq === avant,
      `INTEGRATED sans status sous design_update : délégation refusée, qualification indéterminée ` +
        `(${String(code)}) ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== reprise après compaction

regressionCorrigee("ITE-C-reprise-compaction", "la reprise de compaction-guard après le dernier INTEGRATED final ne rouvre ni délégation ni mutation", async () => {
  /*
   * Adjudication ITE-1 (E11) : la séquence exacte que QD-P0 rencontrera. Le plan est terminal ; le
   * contexte franchit 50 % ; compaction-guard compacte pendant un run actif et envoie sa reprise
   * (triggerTurn). Le tour repris est celui d'un modèle qui voudrait « reprendre là où il s'était
   * arrêté » : il ne peut plus que lire et répondre.
   */
  const h = await monter();
  try {
    await toutIntegrer(h);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: h.root, encoding: "utf-8" });
    const etatProjet = () => ({
      tete: git("rev-parse", "HEAD"), statut: git("status", "--porcelain", "--untracked-files=all"),
      refs: git("for-each-ref"), worktrees: git("worktree", "list", "--porcelain"),
      registre: JSON.stringify(h.evenements()), seq: manifeste(h).nextSeq, enfants: APPELS.length,
    });
    const avant = etatProjet();

    // compaction-guard, chargé comme pi le charge, sur un run actif au-dessus du seuil.
    const reprises: Array<{ message: { customType: string }; options?: { triggerTurn?: boolean } }> = [];
    let finDeTour: ((e: unknown, ctx: unknown) => void) | undefined;
    compactionGuard({
      on: (_n: "turn_end", cb: (e: unknown, ctx: never) => void) => { finDeTour = cb as typeof finDeTour; },
      sendMessage: (message, options) => { reprises.push({ message, options }); },
    });
    precondition(finDeTour !== undefined, "compaction-guard doit écouter turn_end");
    finDeTour!({}, {
      getContextUsage: () => ({ tokens: 150_000, contextWindow: 272_000 }),
      isIdle: () => false,
      compact: (o?: { onComplete?: (r: unknown) => void }) => o?.onComplete?.({}),
    });

    // Le tour repris : tout ce qu'un modèle tenterait pour « reprendre le travail ».
    const outilsRepris: Array<[string, Record<string, unknown>]> = [
      ["task", tache("W03")],
      ["task", { agent: "reviewer", task: "rejuger" }],
      ["bash", { command: "git apply correctif.patch" }],
      ["write", { path: "src/a.py", content: "a = 'repris'\n" }],
      ["edit", { path: "src/b.py", edits: [] }],
    ];
    const passes: string[] = [];
    let n = 0;
    for (const [nom, input] of outilsRepris) {
      n += 1;
      if ((await outil(h, nom, `rep-${n}`, input))?.block !== true) passes.push(nom);
    }
    const delegation = await issue(() => h.outil.execute("rep-exec", tache("W03")));
    const codeDelegation = delegation.kind === "returned" ? gardeDeRun(delegation.value)?.code : undefined;
    const lectureAdmise = (await outil(h, "read", "rep-read", { path: "src/a.py" }))?.block !== true;
    const actifs = [...OUTILS_PI.actifs].sort();
    const apres = etatProjet();

    propriete(
      reprises.length === 1 && reprises[0].options?.triggerTurn === true &&
        passes.length === 0 && codeDelegation === "ITE_PLAN_TERMINAL" && lectureAdmise &&
        JSON.stringify(actifs) === JSON.stringify([...LECTURE].sort()) &&
        JSON.stringify(apres) === JSON.stringify(avant),
      `une reprise exactement (${reprises.length}) ; dans le tour repris, aucun outil mutant ni délégation ` +
        `ne passe (passés ${JSON.stringify(passes)}, exécution ${String(codeDelegation)}), la lecture reste ` +
        `(${lectureAdmise}), outils actifs ${JSON.stringify(actifs)} ; projet, registre, séquence et enfants ` +
        `inchangés (${JSON.stringify(apres) === JSON.stringify(avant)})`,
    );
  } finally { h.fin(); outilsPiParDefaut(); }
});

// ================================================================== ce qui doit survivre

preservation("ITE-C-en-cours", "un plan partiellement intégré laisse déléguer les unités restantes", async () => {
  const h = await monter();
  try {
    await integrer(h, "W03", "a = 2", "1");
    PILOTE.pendant = ecrire("src/b.py", "b = 2\n");
    const r = await issue(() => h.outil.execute("2", tache("W09")));
    PILOTE.pendant = undefined;
    const tousActifs = OUTILS_PI.actifs.length === OUTILS_PI.tous.length;
    propriete(
      r.kind === "returned" && (r.value as { isError?: boolean }).isError === false && tousActifs,
      `W03 intégrée, W09 reste délégable et aucun outil n'est retiré ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});
