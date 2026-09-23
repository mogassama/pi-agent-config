/**
 * l0-a-harness.test.ts — L0, vague A : les preuves avant les correctifs.
 *
 * Deux espèces, et les confondre figerait le défaut comme attendu :
 *
 *   régression   rouge sur f9791bd, verte après correction. `regression(…)` est
 *                déclarée `todo` : un todo rouge ne fait pas échouer la suite, et
 *                le compte `todo` dit combien de défauts restent ouverts. Le lot
 *                qui corrige remplace `regression(` par `regressionCorrigee(` —
 *                même nom, même scénario, mêmes assertions — et déclare le mutant
 *                qui réintroduit le défaut : une régression corrigée peut passer
 *                grâce à une autre porte, et seul son mutant le révèle.
 *   couverture   verte sur l'intact, rouge sur le mutant qui retire la porte.
 *
 * Les mutants sont déclarés dans `tests/l0-mutants.json`. Une régression ouverte
 * n'en a pas encore : le défaut est présent, il n'y a rien à retirer.
 *
 * Un test rouge ne prouve quelque chose que s'il est rouge pour la bonne raison.
 * Les assertions de la propriété portent le marqueur `PROPRIÉTÉ` ; celles qui
 * vérifient que le scénario s'est bien monté portent `PRÉCONDITION`.
 * `tests/tools/l0-check` refuse une régression rouge sans le marqueur, et
 * `tests/tools/l0-mutants` un mutant qui rougit sans lui — une exception de
 * montage ou une mutation qui casse la compilation ne vaut pas preuve.
 *
 * Contrats : C0-CONTRATS.md v1.2, adjugé par Sol le 2026-09-11. Le harnais
 * reprend celui des sondes de l'audit (claude-PASS-3, annexe A) : vrai
 * `execute()`, vrai git, vrais worktrees ; seuls pi, typebox et dispatch sont
 * substitués.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE, reinitialiser } from "./stubs/dispatch.ts";
import { acquireRunOwnership, readManifest, releaseRunOwnership, type Lease } from "../subagent-only/run-manifest.ts";
import secretGate from "../extensions/pi-secret-gate/index.ts";

const RUNS = ".pi-subagent-runs";
const REPO = join(import.meta.dirname, "..");

// ------------------------------------------------------------------ espèces

function regression(id: string, titre: string, fn: () => Promise<void> | void): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur f9791bd jusqu'au lot qui corrige ${id}` }, fn);
}
/**
 * Deux fonctions plutôt qu'un booléen en dernier argument : l'état se lit sur la
 * première ligne de la déclaration, là où les instruments le lisent, sans
 * interpréter le corps du test.
 */
function regressionCorrigee(id: string, titre: string, fn: () => Promise<void> | void): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function couverture(id: string, titre: string, fn: () => Promise<void> | void): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

// ------------------------------------------------------------------ montage

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}
const lanes = (root: string): string[] => {
  const dir = join(root, ".git", "pi-lanes");
  return existsSync(dir) ? execFileSync("ls", [dir], { encoding: "utf-8" }).split("\n").filter(Boolean) : [];
};
type Evenement = { event?: string; work_unit?: string };
const evenements = (h: { runDir: string; runId: string }): Evenement[] => {
  const p = join(h.runDir, `${h.runId}-lanes.jsonl`);
  return existsSync(p)
    ? readFileSync(p, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Evenement)
    : [];
};
const ouvertures = (h: { runDir: string; runId: string }, unite: string): number =>
  evenements(h).filter((e) => e.event === "OPENED" && e.work_unit === unite).length;
const agents = (): string[] => APPELS.map((a) => a.agent);
const compter = (role: string): number => APPELS.filter((a) => a.agent === role).length;
const lire = (root: string, rel: string): string => readFileSync(join(root, rel), "utf-8").trim();
const tache = (unite: string) => ({ agent: "worker", work_unit: unite, task: `écrire pour ${unite}` });
const revue = (unite: string, extra: Record<string, unknown> = {}) => {
  PILOTE.resultat = { verdict: "approved", changedFiles: [], ...extra } as never;
  return { agent: "reviewer", work_unit: unite, task: "juger" };
};
const bail = (h: { runDir: string; runId: string }): Lease =>
  JSON.parse(readFileSync(join(h.runDir, `${h.runId}.lease`, "owner.json"), "utf-8")) as Lease;

const PLAN_DEFAUT = {
  version: 1,
  work_units: [
    { id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py"] },
    { id: "W09", goal: "faire W09", depends_on: [], expected_write_scope: ["src/b.py"] },
  ],
};

let generation = 0;
/** Une instance neuve de l'extension sur un dépôt existant. */
async function charger(root: string) {
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  reinitialiser();
  generation += 1;
  const module = await import(`../extensions/subagent/index.ts?l0a=${generation}`);
  let outil: { execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown> } | undefined;
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  module.default({
    on: (nom: string, h: (...a: unknown[]) => unknown) => handlers.set(nom, h),
    registerTool: (t: unknown) => { outil = t as typeof outil; },
    registerCommand: () => {},
    ui: { setStatus: () => {}, setFooter: () => {} },
  });
  const manifeste = readManifest(join(root, RUNS));
  precondition(manifeste !== undefined, "le run n'a pas été publié au chargement");
  precondition(outil !== undefined, "l'outil task n'a pas été enregistré");
  return {
    root,
    runDir: join(root, RUNS),
    runId: manifeste!.runId,
    outil: outil!,
    handler: (nom: string) => handlers.get(nom),
    fin: () => { process.chdir(REPO); rmSync(root, { recursive: true, force: true }); },
  };
}
async function monter(plan: unknown = PLAN_DEFAUT) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0a-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const h = await charger(root);
  writeFileSync(join(h.runDir, `${h.runId}-plan.json`), JSON.stringify(plan));
  return h;
}
const ecrire = (rel: string, contenu: string) => (a: { cwd?: string }) => {
  if (a.cwd) writeFileSync(join(a.cwd, rel), contenu);
};

// ================================================================== C1.5 — C-P1-F02

regressionCorrigee("C-P1-F02", "le chemin simple refuse une unité dont la dépendance n'est pas intégrée", async () => {
  const h = await monter({
    version: 1,
    work_units: [
      { id: "W03", goal: "g", depends_on: [], expected_write_scope: ["src/a.py"] },
      { id: "W09", goal: "g", depends_on: ["W03"], expected_write_scope: ["src/b.py"] },
    ],
  });
  try {
    await h.outil.execute("1", tache("W09"));
    propriete(APPELS.length === 0, `aucun enfant ne doit partir pour W09 ; lancés : ${agents().join(", ")}`);
    propriete(!lanes(h.root).includes(`${h.runId}-W09-g1`), "aucune lane ne doit s'ouvrir pour W09");
    propriete(ouvertures(h, "W09") === 0, "aucun OPENED ne doit être écrit pour W09");
  } finally { h.fin(); }
});

regressionCorrigee("C-P1-F02", "le chemin simple refuse une unité dont le scope est détenu par une lane ouverte", async () => {
  const h = await monter({
    version: 1,
    work_units: [
      { id: "W03", goal: "g", depends_on: [], expected_write_scope: ["src/a.py"] },
      { id: "W09", goal: "g", depends_on: [], expected_write_scope: ["src/a.py"] },
    ],
  });
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    precondition(lanes(h.root).includes(`${h.runId}-W03-g1`), "la lane W03 doit être ouverte");
    await h.outil.execute("2", tache("W09"));
    propriete(APPELS.length === 1, `seul l'enfant de W03 doit être parti ; lancés : ${agents().join(", ")}`);
    propriete(ouvertures(h, "W09") === 0, "aucun OPENED ne doit être écrit pour W09, même suivi d'un nettoyage");
    propriete(!lanes(h.root).includes(`${h.runId}-W09-g1`), "aucune lane ne doit s'ouvrir pour W09");
  } finally { h.fin(); }
});

// ================================================================== C1.7 — C-P1-F01

regressionCorrigee("C-P1-F01", "la revue d'une lane part après la revue d'une autre lane", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = (a) => {
      if (a.cwd) writeFileSync(join(a.cwd, "src", a.task.includes("W03") ? "a.py" : "b.py"), "x = 2\n");
    };
    await h.outil.execute("1", {
      agent: "worker",
      batch: [{ work_unit: "W03", task: "écrire pour W03" }, { work_unit: "W09", task: "écrire pour W09" }],
    });
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03"));
    precondition(compter("reviewer") === 1, "la revue de W03 doit être partie");
    precondition(lire(join(h.root, ".git", "pi-lanes", `${h.runId}-W09-g1`), "src/b.py") === "x = 2",
      "la lane W09 doit porter sa modification");
    await h.outil.execute("3", revue("W09"));
    PILOTE.resultat = undefined;
    // L'intégration de W09 dépend des portes aval ; C1.7 ne porte que sur le départ de la revue.
    propriete(compter("reviewer") === 2, `la revue de W09 doit partir ; lancés : ${agents().join(", ")}`);
  } finally { h.fin(); }
});

regressionCorrigee("C-P1-F01", "une écriture globale de l'orchestrateur entre deux revues ne rouvre pas la revue d'une lane inchangée", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03", { verdict: "needs_rework" }));
    PILOTE.resultat = undefined;
    precondition(compter("reviewer") === 1, "la première revue doit être partie");
    const toolCall = h.handler("tool_call") as ((e: unknown) => Promise<unknown>) | undefined;
    precondition(toolCall !== undefined, "l'extension doit écouter tool_call");
    await toolCall!({ toolName: "write", toolCallId: "orch-1", input: { path: "NOTES.md", content: "note\n" } });
    await h.outil.execute("3", revue("W03"));
    PILOTE.resultat = undefined;
    propriete(compter("reviewer") === 1, `aucune seconde revue ne doit partir sur la lane inchangée ; lancés : ${agents().join(", ")}`);
  } finally { h.fin(); }
});

/**
 * Le streak de revue d'une lane se compte dans la vue de la lane (C1.7, PLAN-LOT4 L4-Q2).
 *
 * Sur l'objet, la règle 1 refusait déjà la deuxième revue : aucune REG ne pouvait voir que
 * le streak comptait les revues de TOUTES les lanes. Une fois la vue corrigée, la troisième
 * lane se heurtait encore à « 2 reviewer delegations already ran back to back ».
 */
couverture("C1.7", "la revue d'une troisième lane part après les revues de deux autres lanes", async () => {
  const h = await monter({
    version: 1,
    work_units: [
      { id: "W03", goal: "g", depends_on: [], expected_write_scope: ["src/a.py"] },
      { id: "W09", goal: "g", depends_on: [], expected_write_scope: ["src/b.py"] },
      { id: "W10", goal: "g", depends_on: [], expected_write_scope: ["src/c.py"] },
    ],
  });
  try {
    PILOTE.pendant = (a) => {
      if (!a.cwd) return;
      const cible = a.task.includes("W03") ? "a.py" : a.task.includes("W09") ? "b.py" : "c.py";
      writeFileSync(join(a.cwd, "src", cible), "x = 2\n");
    };
    await h.outil.execute("1", {
      agent: "worker",
      batch: [
        { work_unit: "W03", task: "écrire pour W03" },
        { work_unit: "W09", task: "écrire pour W09" },
        { work_unit: "W10", task: "écrire pour W10" },
      ],
    });
    PILOTE.pendant = undefined;
    precondition(compter("worker") === 3, `les trois workers du lot doivent être partis ; lancés : ${agents().join(", ")}`);
    await h.outil.execute("2", revue("W03"));
    await h.outil.execute("3", revue("W09"));
    precondition(compter("reviewer") === 2, `les revues de W03 et de W09 doivent être parties ; lancés : ${agents().join(", ")}`);
    const r = await h.outil.execute("4", revue("W10"));
    PILOTE.resultat = undefined;
    const dit = ((r as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");
    propriete(
      compter("reviewer") === 3,
      `la revue de W10 doit partir après celles de deux autres lanes ; lancés : ${agents().join(", ")} ; réponse : ${dit}`,
    );
  } finally { h.fin(); }
});

couverture("C-P1-F04-m10", "une revue après un worker qui n'a rien écrit est refusée", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03", { verdict: "needs_rework" }));
    PILOTE.resultat = undefined;
    await h.outil.execute("3", tache("W03"));
    precondition(compter("worker") === 2, "le second worker doit être parti");
    await h.outil.execute("4", revue("W03"));
    PILOTE.resultat = undefined;
    propriete(compter("reviewer") === 1, `la seconde revue doit être refusée ; lancés : ${agents().join(", ")}`);
  } finally { h.fin(); }
});

// ================================================================== C1.6 — C-P1-F05b

regressionCorrigee("C-P1-F05b", "une lane dont HEAD n'est plus sa base, sans FROZEN, est refusée avant revue et sans reset", async () => {
  // Scope a.py + b.py : le commit de l'enfant reste dans le scope, pour qu'aucune
  // porte de scope ne puisse rendre cette preuve verte à la place de C1.6.
  const h = await monter({
    version: 1,
    work_units: [{ id: "W03", goal: "g", depends_on: [], expected_write_scope: ["src/a.py", "src/b.py"] }],
  });
  try {
    PILOTE.pendant = (a) => {
      if (!a.cwd) return;
      writeFileSync(join(a.cwd, "src", "b.py"), "b = 'commité par l'enfant'\n");
      git(a.cwd, "add", "-A");
      git(a.cwd, "commit", "-qm", "commit de l'enfant");
      writeFileSync(join(a.cwd, "src", "a.py"), "a = 2\n");
    };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const laneId = `${h.runId}-W03-g1`;
    const branche = `pi-lane/${laneId}`;
    precondition(git(h.root, "log", "-1", "--format=%s", branche).trim() === "commit de l'enfant",
      "HEAD de la lane doit être le commit de l'enfant");
    const shaAvant = git(h.root, "rev-parse", branche).trim();
    await h.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    propriete(compter("reviewer") === 0, `aucune revue ne doit partir ; lancés : ${agents().join(", ")}`);
    propriete(git(h.root, "rev-parse", branche).trim() === shaAvant, "la branche de lane ne doit pas bouger");
    propriete(lire(h.root, "src/a.py") === "a = 1" && lire(h.root, "src/b.py") === "b = 1", "la racine doit rester inchangée");
    propriete(lanes(h.root).includes(laneId), "la lane doit être conservée");
  } finally { h.fin(); }

  /*
   * Contre-exemple de l'exception INTEGRATED.
   *
   * L'intégration légitime fait avancer la branche au-delà de sa base et doit être
   * admise : c'est ce qui maintient B3 mordante. Mais son événement ne donne pas un
   * blanc-seing à toutes les têtes futures. Après un nouveau commit non intégré, la
   * branche n'est plus ancêtre de HEAD ; la même garde doit donc refuser avant revue.
   */
  const h2 = await monter({
    version: 1,
    work_units: [
      { id: "W03", goal: "g", depends_on: [], expected_write_scope: ["src/a.py"] },
      { id: "W09", goal: "g", depends_on: [], expected_write_scope: ["src/b.py"] },
    ],
  });
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h2.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h2.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    precondition(
      evenements(h2).some((e) => e.event === "INTEGRATED" && e.work_unit === "W03"),
      "la première tentative doit être intégrée et enregistrée",
    );
    precondition(lire(h2.root, "src/a.py") === "a = 2", "la première intégration doit être dans la racine");

    const laneId = `${h2.runId}-W03-g1`;
    const branche = `pi-lane/${laneId}`;
    const shaIntegre = git(h2.root, "rev-parse", branche).trim();
    /*
     * La branche avancée par une main extérieure, et pas par un worker de reprise.
     *
     * Mesuré, et c'est ce qui décide de la forme de ce cas : après l'intégration, le
     * runtime retire le worktree et conserve la branche. Aucune reprise ne peut alors
     * faire avancer cette branche ET atteindre une revue — trois gardes ANTÉRIEURES à
     * la provenance l'interceptent : un worktree sale sous une unité intégrée est
     * « residu-sale » et la porte de reprise refuse ; un worker qui commit tout laisse
     * l'arbre propre, rapporte `changedFiles: []`, et la garde de changement matériel
     * refuse ; et la réouverture d'une unité déjà intégrée casse sur `noterOuverture`,
     * faute de base. Une branche avancée hors du run — autre session, opérateur,
     * script — est le seul chemin qui mène la tête déplacée jusqu'à cette garde, et
     * c'est aussi le cas qu'elle existe pour attraper.
     */
    const dehors = mkdtempSync(join(tmpdir(), "pi-l0a-dehors-"));
    git(h2.root, "worktree", "add", "-q", dehors, branche);
    writeFileSync(join(dehors, "src", "a.py"), "a = 3\n");
    git(dehors, "add", "-A");
    git(dehors, "commit", "-qm", "commit postérieur à INTEGRATED");
    git(h2.root, "worktree", "remove", "--force", dehors);
    const shaAvant = git(h2.root, "rev-parse", branche).trim();
    precondition(shaAvant !== shaIntegre, "la branche doit avoir avancé au-delà du commit intégré");

    /*
     * Un scout global entre la première revue et celle-ci, et il est nécessaire.
     *
     * Depuis le LOT 4, le garde de revue d'une lane lit la vue de C1 (C1.7). Le worker
     * d'une AUTRE unité, qui franchissait ici la garde de changement matériel quand elle
     * lisait l'historique du run, n'est plus dans la vue de W03 : « a review already ran »
     * refusait la revue en amont, et la preuve restait verte sans atteindre la provenance
     * (mesuré au LOT 4). Un scout global appartient à la vue sans y écrire, et
     * reviewer → scout → reviewer reste permis (L4-Q6) : la revue atteint la garde
     * qu'elle éprouve.
     */
    await h2.outil.execute("3", { agent: "scout", find: "où est défini a", scope: ["src"], task: "localiser a" });
    precondition(compter("scout") === 1, "le scout global doit être parti");

    await h2.outil.execute("4", revue("W03"));
    PILOTE.resultat = undefined;
    propriete(
      compter("reviewer") === 1,
      `INTEGRATED ne doit pas excuser un commit postérieur non intégré ; lancés : ${agents().join(", ")}`,
    );
    propriete(git(h2.root, "rev-parse", branche).trim() === shaAvant, "la branche ne doit pas bouger");
    propriete(lire(h2.root, "src/a.py") === "a = 2", "le commit postérieur ne doit pas atteindre la racine");
  } finally { h2.fin(); }
});

// ================================================================== C3 — violations

regression("C-P1-F04-m28", "après perte du bail, le nouveau propriétaire recalcule la violation réservée", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = (a) => {
      if (!a.cwd) return;
      writeFileSync(join(a.cwd, "DESIGN.md"), "design modifié\n");
      releaseRunOwnership(h.runDir, bail(h));
      const autre = acquireRunOwnership(h.runDir, h.runId, "session-autre");
      if (autre.ok) releaseRunOwnership(h.runDir, autre.lease);
    };
    await h.outil.execute("1", { agent: "worker", batch: [{ work_unit: "W03", task: "écrire pour W03" }] });
    PILOTE.pendant = undefined;
    precondition(existsSync(join(h.root, ".git", "pi-lanes", `${h.runId}-W03-g1`, "DESIGN.md")),
      "DESIGN.md doit être dans la lane");
    precondition(
      !evenements(h).some((e) => e.event === "VIOLATION"),
      "l'ancien propriétaire, bail perdu, ne doit avoir écrit aucun VIOLATION",
    );
    /*
     * D2 (PLAN-LOT6) : une délégation autorisée du nouveau propriétaire, dans la même lane.
     * Sans elle, la revue suivante n'aurait rien reçu, C2.3 refuserait, et DESIGN.md
     * resterait hors de la racine pour une raison qui n'a rien à voir avec R.
     */
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    try {
      await h.outil.execute("1b", tache("W03"));
    } finally {
      PILOTE.pendant = undefined;
    }
    precondition(
      existsSync(join(h.runDir, `${h.runId}.lease`, "owner.json")) && bail(h).sessionId !== "session-autre",
      "le nouveau propriétaire doit tenir le bail",
    );
    precondition(!existsSync(join(h.root, "DESIGN.md")), "DESIGN.md ne doit pas être déjà dans la racine");
    await h.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    precondition(compter("reviewer") === 1, "la revue doit être partie une fois le bail repris");
    const paquet = APPELS.filter((a) => a.agent === "reviewer").at(-1)?.task ?? "";
    precondition(
      paquet.includes("diff --git a/DESIGN.md b/DESIGN.md") && paquet.includes("diff --git a/src/a.py b/src/a.py"),
      "la revue doit avoir reçu le diff complet, DESIGN.md et src/a.py compris",
    );
    propriete(!existsSync(join(h.root, "DESIGN.md")), "DESIGN.md ne doit pas atteindre la racine");
    propriete(lanes(h.root).includes(`${h.runId}-W03-g1`), "la lane doit être conservée");
  } finally { h.fin(); }
});

couverture("C-P1-F04-m3", "un fichier hors scope bloque l'intégration", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/b.py", "b = 'hors scope'\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    precondition(compter("reviewer") === 1, "la revue doit être partie");
    propriete(lire(h.root, "src/b.py") === "b = 1", "le fichier hors scope ne doit pas atteindre la racine");
    propriete(lanes(h.root).includes(`${h.runId}-W03-g1`), "la lane doit être conservée");
  } finally { h.fin(); }
});

couverture("C-P1-F04-m4a", "une écriture réservée dans un lot bloque l'intégration", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("DESIGN.md", "design\n");
    await h.outil.execute("1", { agent: "worker", batch: [{ work_unit: "W03", task: "écrire pour W03" }] });
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    precondition(compter("reviewer") === 1, "la revue doit être partie");
    propriete(!existsSync(join(h.root, "DESIGN.md")), "DESIGN.md ne doit pas atteindre la racine");
  } finally { h.fin(); }
});

couverture("C-P1-F04-m4b", "une écriture réservée par le chemin simple bloque l'intégration", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("DESIGN.md", "design\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    precondition(compter("reviewer") === 1, "la revue doit être partie");
    propriete(!existsSync(join(h.root, "DESIGN.md")), "DESIGN.md ne doit pas atteindre la racine");
  } finally { h.fin(); }
});

couverture("C-P1-F04-m5", "un risque laissé ouvert bloque l'intégration", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03", { openRiskItems: [{ id: "r-1", text: "un risque laissé ouvert" }] }));
    PILOTE.resultat = undefined;
    precondition(compter("reviewer") === 1, "la revue doit être partie");
    propriete(lire(h.root, "src/a.py") === "a = 1", "la lane à risque ouvert ne doit pas être intégrée");
    propriete(lanes(h.root).includes(`${h.runId}-W03-g1`), "la lane doit être conservée");
  } finally { h.fin(); }
});

// ================================================================== A-P1-F03 — garde de secrets

type Decision = { block?: boolean; reason?: string } | undefined;
function brancherSecretGate(): (event: unknown) => Promise<Decision> {
  let handler: ((event: unknown) => Promise<Decision>) | undefined;
  secretGate({ on: (_: string, h: (e: unknown) => Promise<Decision>) => { handler = h; } } as never);
  precondition(handler !== undefined, "pi-secret-gate ne s'est abonné à aucun événement");
  return handler!;
}
// Littéral synthétique, de la forme reconnue par rules.ts ; aucune vraie clé.
const CLE = `API_KEY = "AIzaSyB1234567890abcdefghijklmnopqrstuv"`;

regressionCorrigee("A-P1-F03", "un edit au schéma edits[] de pi 0.85.1 est inspecté sur chaque newText", async () => {
  const appeler = brancherSecretGate();
  const ecriture = await appeler({ toolName: "write", toolCallId: "w", input: { path: "src/app.py", content: CLE } });
  precondition(ecriture?.block === true, "la même clé dans un write doit être bloquée");
  const edition = await appeler({
    toolName: "edit",
    toolCallId: "e",
    input: {
      path: "src/app.py",
      edits: [
        { oldText: "x = 1", newText: "x = 2" },
        { oldText: "y = 1", newText: CLE },
      ],
    },
  });
  propriete(edition?.block === true, "la clé introduite par le second newText doit être bloquée");
});
