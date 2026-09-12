/**
 * l0-b1-generations.test.ts — L0, vague B1 : l'allocation durable d'une génération.
 *
 * `ensureLane()` ne fait que créer un worktree. Ce que § F définit est autre chose :
 * **allouer** une génération sous la garde du run et en écrire l'`OPENED`. La seule
 * surface qui fasse cela est l'outil `task` de l'orchestrateur — d'où ce fichier, monté
 * comme les harnais d'A1 et d'A2 : vrai `execute()`, vrai git, vrais worktrees, pi et
 * dispatch substitués.
 *
 * **Sur la concurrence.** Deux processus n'éprouveraient pas l'allocateur : il n'y a
 * qu'un orchestrateur, dans un seul processus, et deux délégations concurrentes y sont
 * deux `execute()` entrelacés sur leurs points d'attente. C'est cet entrelacement que la
 * preuve monte. La course entre processus, elle, porte sur l'espace de runs, et c'est
 * `l0-b1-lifecycle.test.ts` qui l'éprouve, avec de vrais processus et une barrière.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE, reinitialiser } from "./stubs/dispatch.ts";
import { readManifest } from "../subagent-only/run-manifest.ts";
import { openLanes, runBranches } from "../subagent-only/worktree.ts";

// ------------------------------------------------------------------ espèces

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

/*
 * Les deux branches portent les deux champs, l'un des deux vide.
 *
 * Une union stricte obligerait chaque lecture à rétrécir d'abord ; or une PRÉCONDITION
 * n'est pas un garde de type, et `i.value` sur l'union levait dix-huit diagnostics
 * stricts sans rien dire de plus sur le comportement.
 */
type Issue =
  | { kind: "returned"; value: unknown; error?: undefined }
  | { kind: "threw"; value?: undefined; error: string };
async function issue(fn: () => Promise<unknown> | unknown): Promise<Issue> {
  try {
    return { kind: "returned", value: await fn() };
  } catch (e) {
    return { kind: "threw", error: `${(e as Error).constructor.name}: ${(e as Error).message}` };
  }
}
const montrer = (i: Issue): string => (JSON.stringify(i) ?? "(indicible)").slice(0, 250);

// ------------------------------------------------------------------ montage

const REPO = join(import.meta.dirname, "..");
const RUNS = ".pi-subagent-runs";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}
const PLAN = {
  version: 1,
  work_units: [
    { id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py"] },
    { id: "W09", goal: "faire W09", depends_on: [], expected_write_scope: ["src/b.py"] },
  ],
};
const tache = (unite: string) => ({ agent: "worker", work_unit: unite, task: `écrire pour ${unite}` });
const ecrire = (rel: string, contenu: string) => (a: { cwd?: string }) => {
  if (a.cwd) writeFileSync(join(a.cwd, rel), contenu);
};

let generation = 0;
async function monter() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0b1g-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  reinitialiser();
  generation += 1;
  const module = await import(`../extensions/subagent/index.ts?l0b1g=${generation}`);
  let outil: { execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown> } | undefined;
  module.default({
    on: () => {},
    registerTool: (t: unknown) => { outil = t as typeof outil; },
    registerCommand: () => {},
    ui: { setStatus: () => {}, setFooter: () => {} },
  });
  const manifeste = readManifest(join(root, RUNS));
  precondition(manifeste !== undefined && outil !== undefined, "le run et l'outil doivent exister");
  const runDir = join(root, RUNS);
  const runId = manifeste!.runId;
  writeFileSync(join(runDir, `${runId}-plan.json`), JSON.stringify(PLAN));
  return {
    root, runDir, runId, outil: outil!,
    evenements: (): Array<Record<string, unknown>> => {
      const p = join(runDir, `${runId}-lanes.jsonl`);
      return existsSync(p)
        ? readFileSync(p, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
    },
    fin: () => { process.chdir(REPO); rmSync(root, { recursive: true, force: true }); },
  };
}
function recover(root: string, ...args: string[]): { status: number | null; sortie: string } {
  const majeur = Number(process.versions.node.split(".")[0]);
  const p = spawnSync(
    process.execPath,
    [...(majeur < 23 ? ["--experimental-strip-types"] : []), join(REPO, "bin", "subagent-recover"), ...args],
    { cwd: root, encoding: "utf-8" },
  );
  return { status: p.status, sortie: `${p.stdout}${p.stderr}` };
}

/**
 * L'abandon durable, écrit comme le runtime l'écrirait.
 *
 * Le verbe de reprise ne sait abandonner qu'une lane en contradiction : abandonner une
 * lane saine n'a pas de surface aujourd'hui, et c'est ce que `F-abandon-durable` porte.
 * Pour les preuves d'allocation, l'état d'abandon est donc posé comme les autres
 * fixtures de B1 — un événement sérialisé au registre, relu par la surface publique —
 * et non injecté sous une forme réduite.
 */
function abandonEcrit(h: { root: string; runDir: string; runId: string }, unite: string): void {
  const chemin = join(h.runDir, `${h.runId}-lanes.jsonl`);
  const lignes = readFileSync(chemin, "utf-8").split("\n").filter(Boolean);
  const entete = JSON.parse(lignes[0]) as { ledger?: number };
  const corps = lignes.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
  // La fixture suit la version réellement ouverte : en v1 un événement v1, en v2
  // l'enveloppe entière. Écrire toujours du v1 corromprait le registre le jour où le
  // runtime écrira du v2, et la preuve ne pourrait plus verdir sans changer de scénario.
  let ligne: string;
  if (entete.ledger === 2) {
    // La monotonie n'est pas la contiguïté : la séquence suivante se prend au maximum
    // observé, jamais au nombre de lignes. Et `lane` comme `generation` se cherchent sur
    // le dernier événement de l'unité QUI LES PORTE, pas sur le dernier quel qu'il soit.
    const seqs = corps.map((e) => e.event_seq).filter((v): v is number => Number.isInteger(v));
    // Balayage arrière explicite : `findLast` demande une bibliothèque plus récente que
    // celle de la baseline stricte, et la preuve n'a pas à la déplacer.
    const dernier = (
      liste: Array<Record<string, unknown>>,
      porte: (e: Record<string, unknown>) => boolean,
    ): Record<string, unknown> | undefined => {
      for (let i = liste.length - 1; i >= 0; i--) if (porte(liste[i])) return liste[i];
      return undefined;
    };
    const deLUnite = corps.filter((e) => e.work_unit === unite);
    const avecLane = dernier(deLUnite, (e) => typeof e.lane === "string");
    const avecGeneration = dernier(deLUnite, (e) => Number.isInteger(e.generation));
    if (!avecLane || !avecGeneration) {
      throw new Error(`fixture : impossible de construire un ABANDONED v2 pour ${unite}`);
    }
    ligne = JSON.stringify({
      event_seq: Math.max(0, ...seqs) + 1,
      work_unit: unite,
      lane: avecLane.lane,
      at: new Date().toISOString(),
      event: "ABANDONED",
      by: "operator",
      reason: "fixture",
      generation: avecGeneration.generation,
    });
  } else {
    ligne = JSON.stringify({
      event: "ABANDONED", work_unit: unite, at: new Date().toISOString(), by: "operator", reason: "fixture",
    });
  }
  writeFileSync(chemin, `${readFileSync(chemin, "utf-8")}${ligne}\n`);
  const lane = openLanes(h.root).find((l) => l.includes(unite));
  if (lane) git(h.root, "worktree", "remove", "--force", join(h.root, ".git", "pi-lanes", lane));
}

// ================================================================== l'allocation

regression("F-generation-allocation", "après l'abandon durable d'une lane, l'unité en reçoit une nouvelle", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const premiere = openLanes(h.root).filter((l) => l.includes("W03"));
    precondition(premiere.length === 1, `une lane doit être ouverte, vues : ${JSON.stringify(premiere)}`);
    abandonEcrit(h, "W03");
    precondition(
      h.evenements().some((e) => e.event === "ABANDONED" && e.work_unit === "W03"),
      "l'abandon doit être durable au registre",
    );

    PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
    const seconde = await issue(() => h.outil.execute("2", tache("W03")));
    PILOTE.pendant = undefined;
    const lanes = openLanes(h.root).filter((l) => l.includes("W03"));
    const ouvertures = h.evenements().filter((e) => e.event === "OPENED" && e.work_unit === "W03");
    const nouvelle = lanes.length === 1 && lanes[0] !== premiere[0];
    propriete(
      seconde.kind === "returned" &&
        nouvelle &&
        ouvertures.length === 2 &&
        ouvertures[1].generation === 2 &&
        runBranches(h.root, h.runId).filter((b) => b.includes("W03")).length === 2,
      `la reprise doit rendre, et allouer une génération distincte avec son OPENED et sa ` +
        `branche — une allocation qui crée ses artefacts puis lève ne prouve rien ; ` +
        `lanes ${JSON.stringify(lanes)} contre ${JSON.stringify(premiere)}, ouvertures ` +
        `${JSON.stringify(ouvertures.map((e) => e.generation))}, branches ` +
        `${JSON.stringify(runBranches(h.root, h.runId))}, seconde délégation ${montrer(seconde)}`,
    );
  } finally { h.fin(); }
});

regression("F-generation-lot", "un lot réalloue deux unités sans croiser générations, lanes ni worktrees", async () => {
  const h = await monter();
  try {
    /*
     * La surface qui alloue en parallèle est le lot : le runtime ouvre une lane par
     * unité et en fait tourner deux à la fois. C'est là que deux allocations se
     * rencontrent — deux délégations sur la même unité, elles, ne sont pas concurrentes
     * mais séquentielles par contrat.
     */
    PILOTE.pendant = (appel) => {
      if (appel.cwd) writeFileSync(join(appel.cwd, "src", appel.task.includes("W03") ? "a.py" : "b.py"), "x = 2\n");
    };
    await h.outil.execute("1", {
      agent: "worker",
      batch: [{ work_unit: "W03", task: "écrire pour W03" }, { work_unit: "W09", task: "écrire pour W09" }],
    });
    PILOTE.pendant = undefined;
    const premieres = openLanes(h.root).sort();
    precondition(premieres.length === 2, `deux lanes doivent être ouvertes, vues : ${JSON.stringify(premieres)}`);
    abandonEcrit(h, "W03");
    abandonEcrit(h, "W09");
    precondition(
      h.evenements().filter((e) => e.event === "ABANDONED").length === 2,
      "les deux abandons doivent être durables au registre",
    );

    // La barrière : chaque délégation annonce son point d'attente et s'y bloque. Les
    // allocations, elles, ont déjà eu lieu — c'est ce que la preuve veut voir.
    let pendantes = 0;
    let liberer: () => void = () => {};
    const relachement = new Promise<void>((r) => { liberer = r; });
    PILOTE.pendant = async (appel) => {
      if (appel.cwd) writeFileSync(join(appel.cwd, "src", appel.task.includes("W03") ? "a.py" : "b.py"), "x = 3\n");
      pendantes += 1;
      await relachement;
    };
    const enVol = issue(() => h.outil.execute("2", {
      agent: "worker",
      batch: [{ work_unit: "W03", task: "écrire pour W03" }, { work_unit: "W09", task: "écrire pour W09" }],
    }));
    for (let i = 0; i < 400 && pendantes < 2; i++) await new Promise((r) => setTimeout(r, 5));
    // La valeur se capture AVANT la libération — le compteur bouge après — et la
    // précondition ne se lève qu'une fois les deux appels rejoints : lever avant
    // laisserait les délégations bloquées sur une promesse que personne ne résout.
    const simultanees = pendantes;
    liberer();
    const resultat = await enVol;
    PILOTE.pendant = undefined;
    precondition(
      simultanees === 2,
      `les deux délégations devaient être pendantes en même temps ; vues : ${simultanees}`,
    );

    const lanes = openLanes(h.root).sort();
    const appelsLot = APPELS.filter((a) => a.agent === "worker").slice(-2);
    /*
     * Deux lanes distinctes et deux étiquettes justes ne suffisent pas : il faut que la
     * lane nommée dans OPENED soit celle qui existe, et que le worktree livré au worker
     * soit le sien. Sans cela, un échange de worktrees passerait inaperçu.
     */
    const mapping = ["W03", "W09"].map((unite) => {
      const ouverts = h.evenements().filter((e) => e.event === "OPENED" && e.work_unit === unite);
      const dernier = ouverts.at(-1);
      const lane = dernier?.lane;
      return {
        unite,
        deux: ouverts.length === 2,
        generation: dernier?.generation,
        lane,
        laneExiste: typeof lane === "string" && lanes.includes(lane),
        cwdJuste: appelsLot.some(
          (a) => a.task.includes(unite) && typeof a.cwd === "string" && a.cwd.endsWith(`/${lane}`),
        ),
      };
    });
    propriete(
      mapping.every((m) => m.deux && m.generation === 2 && m.laneExiste && m.cwdJuste) &&
        lanes.length === 2 &&
        new Set(lanes).size === 2 &&
        lanes.join() !== premieres.join() &&
        resultat.kind === "returned",
      `chaque unité doit recevoir sa propre génération, sa propre lane et son propre ` +
        `worktree ; mapping ${JSON.stringify(mapping)}, lanes ${JSON.stringify(lanes)} contre ` +
        `${JSON.stringify(premieres)}, issue ${montrer(resultat)}`,
    );
  } finally { h.fin(); }
});

preservation("F-generation-ordre", "sans abandon, une seconde délégation reste dans la lane ouverte", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    const premiere = openLanes(h.root).filter((l) => l.includes("W03"));
    precondition(premiere.length === 1, "une lane doit être ouverte");
    precondition(
      !h.evenements().some((e) => e.event === "ABANDONED"),
      "aucun abandon ne doit avoir eu lieu",
    );
    await h.outil.execute("2", tache("W03"));
    PILOTE.pendant = undefined;
    const ouvertures = h.evenements().filter((e) => e.event === "OPENED" && e.work_unit === "W03");
    propriete(
      openLanes(h.root).filter((l) => l.includes("W03")).length === 1 &&
        ouvertures.length === 1 &&
        APPELS.filter((a) => a.agent === "worker").length === 2,
      `g(n+1) ne s'alloue qu'après un abandon : lanes ` +
        `${JSON.stringify(openLanes(h.root))}, ouvertures ${ouvertures.length}, workers ` +
        `${APPELS.filter((a) => a.agent === "worker").length}`,
    );
  } finally { h.fin(); }
});

preservation("F-generation-serialisee", "deux délégations sur la même unité s'allouent l'une après l'autre", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    abandonEcrit(h, "W03");
    precondition(
      h.evenements().some((e) => e.event === "ABANDONED" && e.work_unit === "W03"),
      "l'abandon de la première lane doit être durable",
    );
    const ouverturesAvant = h.evenements().filter((e) => e.event === "OPENED").length;

    let atteints = 0;
    let liberer: () => void = () => {};
    const relachement = new Promise<void>((r) => { liberer = r; });
    PILOTE.pendant = async (appel) => {
      if (appel.cwd) writeFileSync(join(appel.cwd, "src", "a.py"), "a = 3\n");
      atteints += 1;
      await relachement;
    };
    const premiere = issue(() => h.outil.execute("2", tache("W03")));
    for (let i = 0; i < 200 && atteints < 1; i++) await new Promise((r) => setTimeout(r, 5));
    const seconde = issue(() => h.outil.execute("3", tache("W03")));
    await new Promise((r) => setTimeout(r, 100));

    // L'observation qui compte : pendant que la première est pendante, la seconde ne
    // doit avoir alloué ni lane ni OPENED.
    const pendant = {
      atteints,
      lanes: openLanes(h.root).filter((l) => l.includes("W03")).length,
      ouvertures: h.evenements().filter((e) => e.event === "OPENED").length - ouverturesAvant,
    };
    liberer();
    const deux = await Promise.all([premiere, seconde]);
    PILOTE.pendant = undefined;

    const apres = {
      lanes: openLanes(h.root).filter((l) => l.includes("W03")).length,
      ouvertures: h.evenements().filter((e) => e.event === "OPENED").length - ouverturesAvant,
    };
    propriete(
      pendant.atteints === 1 &&
        pendant.lanes === 1 &&
        pendant.ouvertures === 1 &&
        deux.every((i) => i.kind === "returned") &&
        apres.lanes === 1 &&
        apres.ouvertures === 1,
      `sur une même unité, l'allocation est sérialisée : pendant ${JSON.stringify(pendant)}, ` +
        `après ${JSON.stringify(apres)}, issues ${deux.map(montrer).join(" | ")}`,
    );
  } finally { h.fin(); }
});
