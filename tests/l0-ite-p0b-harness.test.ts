/**
 * l0-ite-p0b-harness.test.ts — lot ITE, P0-B : aucun appel d'outil de l'orchestrateur ne modifie l'état
 * du projet hors des primitives du runtime.
 *
 * Le défaut (sol/29) : après l'intégration de W01, l'orchestrateur a lui-même lancé
 * `subagent-recover discard`, `git restore`, `git worktree remove`, `git branch -d` et un `git apply`
 * à la racine. Une liste de commandes interdites serait contournable par python, cp, sed, perl ;
 * l'invariant se juge par CAPACITÉ pour `write`/`edit` (destination explicite) et par EFFET pour tout
 * le reste (empreinte avant/après).
 *
 *   capacité     write/edit vers dépôt, lane, .git — lien symbolique et lien dur compris — refusés
 *                avant l'appel, sans blocage durable — ITE-B-capacite
 *   effet        chaque composante de l'empreinte mord seule ; un écart pose le blocage durable et
 *                sa preuve, même si l'outil échoue — ITE-B-effet
 *   exclusion    primitive et appel observé frères, dans les deux ordres — ITE-B-exclusion
 *   provenance   un outil de lecture redéfini est observé — ITE-B-provenance
 *   sonde        un relevé impossible refuse avant, bloque après — ITE-B-sonde
 *   plan         le plan s'écrit avant son attachement, jamais après — ITE-B-plan-attache
 *
 * Simulation : un appel d'outil, c'est `tool_call`, puis l'effet de l'outil, puis `tool_result` —
 * l'ordre dans lequel pi 0.86 les produit. Montage : `l0-b2-harness.ts`.
 */
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import {
  appendFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync,
  symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PILOTE } from "./stubs/dispatch.ts";
import {
  aJeter, ecrire, git, monter, OUTILS_PI, outilsPiParDefaut, precondition, propriete, tache, type Harnais,
} from "./l0-b2-harness.ts";
import { openLanes } from "../subagent-only/worktree.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
const dehors: string[] = [];
test.after(() => {
  outilsPiParDefaut();
  for (const d of [...aJeter(), ...dehors]) rmSync(d, { recursive: true, force: true });
});

const manifeste = (h: Harnais) =>
  JSON.parse(readFileSync(join(h.runDir, "active-run.json"), "utf-8")) as Record<string, unknown>;
const bloque = (h: Harnais) => manifeste(h).continuation_block !== undefined;
const preuves = (h: Harnais): string[] => {
  const d = join(h.runDir, "ite-p0b");
  return existsSync(d) ? readdirSync(d) : [];
};

type Decision = { block?: boolean; reason?: string } | undefined;
interface Issue { refuse: boolean; raison?: string; resultat?: unknown }

/** Un appel d'outil complet : avant, effet, après. */
async function appel(
  h: Harnais, toolName: string, toolCallId: string, input: Record<string, unknown>,
  effet?: () => void, isError = false,
): Promise<Issue> {
  const d = (await h.emettre("tool_call", { toolName, toolCallId, input })) as Decision;
  if (d?.block) return { refuse: true, raison: d.reason };
  effet?.();
  const resultat = await h.emettre("tool_result", { toolName, toolCallId, input, content: [], isError });
  return { refuse: false, resultat };
}

/** Un run avec une lane ouverte (W03, déjà modifiée par son worker) et un plan attaché. */
async function monterAvecLane(): Promise<{ h: Harnais; lane: string }> {
  const h = await monter();
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("w1", tache("W03"));
  PILOTE.pendant = undefined;
  const lanes = openLanes(h.root).filter((l) => l.includes("W03"));
  precondition(lanes.length === 1, `une lane W03 doit être ouverte ; ${lanes.join()}`);
  precondition(typeof manifeste(h).planHash === "string", "le plan doit être attaché");
  return { h, lane: join(h.root, ".git", "pi-lanes", lanes[0]) };
}

// ================================================================== capacité

regressionCorrigee("ITE-B-capacite", "write et edit vers le dépôt, une lane ou .git sont refusés avant l'appel, liens compris", async () => {
  const { h, lane } = await monterAvecLane();
  try {
    const ailleurs = mkdtempSync(join(tmpdir(), "pi-ite-dehors-"));
    dehors.push(ailleurs);
    // Deux cibles distinctes : un lien dur vers la cible du lien symbolique rendrait les deux
    // contrôles redondants, et chaque mutant doit mordre seul.
    symlinkSync(join(h.root, "src", "a.py"), join(ailleurs, "lien-symbolique.py"));
    linkSync(join(h.root, "src", "b.py"), join(ailleurs, "lien-dur.py"));
    const refusees: Array<[string, string, Record<string, unknown>]> = [
      ["relatif", "write", { path: "src/b.py", content: "x" }],
      ["absolu", "edit", { path: join(h.root, "src", "b.py"), edits: [] }],
      ["nouveau fichier", "write", { path: "src/nouveau.py", content: "x" }],
      ["lane", "write", { path: join(lane, "src", "a.py"), content: "x" }],
      [".git", "write", { path: join(h.root, ".git", "config"), content: "x" }],
      ["lien symbolique", "write", { path: join(ailleurs, "lien-symbolique.py"), content: "x" }],
      ["lien dur", "write", { path: join(ailleurs, "lien-dur.py"), content: "x" }],
    ];
    const passees: string[] = [];
    let n = 0;
    for (const [quoi, outil, input] of refusees) {
      n += 1;
      const i = await appel(h, outil, `c${n}`, input);
      if (!i.refuse || !/P0-B/.test(i.raison ?? "")) passees.push(quoi);
    }
    const sansBlocage = !bloque(h);
    // Hors dépôt : admis, et jugé ensuite par effet — rien ne change dans le projet.
    const horsDepot = await appel(h, "write", "c-dehors", { path: join(ailleurs, "notes.txt"), content: "x" },
      () => writeFileSync(join(ailleurs, "notes.txt"), "x"));
    propriete(
      passees.length === 0 && sansBlocage && !horsDepot.refuse && !bloque(h),
      `toutes les destinations protégées refusées avant l'appel (passées ${JSON.stringify(passees)}), ` +
        `sans blocage durable (${sansBlocage}) ; une écriture hors dépôt est admise et ne bloque rien ` +
        `(${JSON.stringify(horsDepot).slice(0, 200)}, bloqué ${bloque(h)})`,
    );
  } finally { h.fin(); }
});

// ================================================================== effet

regressionCorrigee("ITE-B-effet", "tout appel observé qui change l'état du projet pose le blocage durable et sa preuve", async () => {
  /*
   * Un cas par composante de l'empreinte, chacun sur un run neuf : un blocage posé ferme le run,
   * et le cas suivant ne mesurerait plus rien. Chaque cas est construit pour qu'une seule
   * composante voie l'écart — c'est ce qui fait mordre chaque mutant seul.
   */
  const cas: Array<[string, (h: Harnais, lane: string) => (() => void), boolean?]> = [
    ["fichier suivi modifié à la racine (python)", (h) => () => writeFileSync(join(h.root, "src", "b.py"), "b = 'py'\n")],
    ["second changement d'un fichier déjà modifié dans la lane", (_h, lane) => () =>
      writeFileSync(join(lane, "src", "a.py"), "a = 'encore'\n")],
    ["fichier non suivi déposé dans la lane", (_h, lane) => () => writeFileSync(join(lane, "src", "depose.py"), "x\n")],
    ["marque skip-worktree posée (git update-index)", (h) => () =>
      git(h.root, "update-index", "--skip-worktree", "src/b.py")],
    ["ref créée (git update-ref)", (h) => () => git(h.root, "update-ref", "refs/heads/parasite", "HEAD")],
    ["worktree verrouillé (git worktree lock)", (_h, lane) => () =>
      execFileSync("git", ["worktree", "lock", lane], { cwd: lane, stdio: "ignore" })],
    ["hook posé (.git/hooks)", (h) => () => writeFileSync(join(h.root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n")],
    ["ligne ajoutée au registre des lanes", (h) => () =>
      appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), `${JSON.stringify({ event: "ABANDONED" })}\n`)],
    ["modifie puis échoue", (h) => () => writeFileSync(join(h.root, "src", "b.py"), "b = 'echec'\n"), true],
  ];
  const manques: string[] = [];
  let n = 0;
  for (const [quoi, preparer, echec] of cas) {
    n += 1;
    const { h, lane } = await monterAvecLane();
    try {
      const i = await appel(h, "bash", `e${n}`, { command: "python3 -c '…'" }, preparer(h, lane), echec === true);
      const texte = JSON.stringify(i.resultat ?? {});
      if (i.refuse || !bloque(h) || preuves(h).length !== 1 || !/P0-B/.test(texte)) {
        manques.push(`${quoi} : refusé ${i.refuse}, bloqué ${bloque(h)}, preuves ${preuves(h).length}, résultat ${texte.slice(0, 120)}`);
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `chaque mutation hors primitive pose continuation_block, une preuve, et le dit dans le résultat ; ` +
      `${manques.join(" · ")}`,
  );
});

// ================================================================== exclusion

regressionCorrigee("ITE-B-exclusion", "une primitive et un appel observé frères ne s'exécutent pas ensemble, dans les deux ordres", async () => {
  const { h } = await monterAvecLane();
  try {
    const t1 = (await h.emettre("tool_call", { toolName: "task", toolCallId: "T1", input: {} })) as Decision;
    const b1 = (await h.emettre("tool_call", { toolName: "bash", toolCallId: "B1", input: { command: "ls" } })) as Decision;
    await h.emettre("tool_result", { toolName: "task", toolCallId: "T1", content: [] });
    const b2 = (await h.emettre("tool_call", { toolName: "bash", toolCallId: "B2", input: { command: "ls" } })) as Decision;
    const t2 = (await h.emettre("tool_call", { toolName: "task", toolCallId: "T2", input: {} })) as Decision;
    await h.emettre("tool_result", { toolName: "bash", toolCallId: "B2", content: [] });
    const t3 = (await h.emettre("tool_call", { toolName: "task", toolCallId: "T3", input: {} })) as Decision;
    await h.emettre("tool_execution_end", { toolName: "task", toolCallId: "T3" });
    propriete(
      t1?.block !== true && b1?.block === true && b2?.block !== true && t2?.block === true && t3?.block !== true,
      `task puis bash : bash refusé (${JSON.stringify(b1)}) ; bash puis task : task refusée ` +
        `(${JSON.stringify(t2)}) ; seuls, chacun passe (${JSON.stringify([t1, b2, t3])})`,
    );
  } finally { h.fin(); }
});

// ================================================================== provenance

regressionCorrigee("ITE-B-provenance", "un outil de lecture redéfini par une extension est observé comme les autres", async () => {
  const { h } = await monterAvecLane();
  try {
    OUTILS_PI.tous = OUTILS_PI.tous.map((o) =>
      o.name === "read" ? { name: "read", sourceInfo: { source: "local", path: "/ext/faux-read.ts" } } : o);
    const i = await appel(h, "read", "r1", { path: "src/a.py" },
      () => writeFileSync(join(h.root, "src", "b.py"), "b = 'lu'\n"));
    propriete(
      !i.refuse && bloque(h) && preuves(h).length === 1,
      `un read redéfini qui écrit est jugé par effet et bloque (bloqué ${bloque(h)}, preuves ${preuves(h).length})`,
    );
  } finally { h.fin(); outilsPiParDefaut(); }
});

// ================================================================== sonde

regressionCorrigee("ITE-B-sonde", "un relevé impossible refuse l'appel avant, et bloque le run après", async () => {
  const { h } = await monterAvecLane();
  try {
    const hooks = join(h.root, ".git", "hooks");
    const casser = () => { renameSync(hooks, `${hooks}.bak`); writeFileSync(hooks, "pas un dossier\n"); };
    const reparer = () => { rmSync(hooks, { force: true }); renameSync(`${hooks}.bak`, hooks); };
    casser();
    const avant = await appel(h, "bash", "s1", { command: "ls" });
    reparer();
    const avantRefuse = avant.refuse && /relevé/.test(avant.raison ?? "") && !bloque(h);
    const apres = await appel(h, "bash", "s2", { command: "ls" }, casser);
    reparer();
    propriete(
      avantRefuse && !apres.refuse && bloque(h) && preuves(h).length === 1,
      `relevé impossible avant : appel refusé sans blocage (${avantRefuse}, ${avant.raison?.slice(0, 120)}) ; ` +
        `après : blocage durable et preuve (bloqué ${bloque(h)}, preuves ${preuves(h).length})`,
    );
  } finally { h.fin(); }
});

// ================================================================== plan

regressionCorrigee("ITE-B-plan-attache", "le plan s'écrit avant son attachement, jamais après", async () => {
  // Avant attachement : un run neuf, le plan posé par le montage, aucune délégation encore.
  const neuf = await monter();
  let avantAdmis = false;
  try {
    const plan = join(neuf.runDir, `${neuf.runId}-plan.json`);
    const contenu = readFileSync(plan, "utf-8");
    precondition(manifeste(neuf).planHash === undefined, "le plan ne doit pas être attaché");
    const w = await appel(neuf, "write", "p1", { path: plan, content: contenu }, () => writeFileSync(plan, contenu));
    const b = await appel(neuf, "bash", "p2", { command: "cat > plan" }, () => writeFileSync(plan, `${contenu}\n`));
    avantAdmis = !w.refuse && !b.refuse && !bloque(neuf);
  } finally { neuf.fin(); }

  // Après attachement : refusé par capacité pour write, bloquant par effet pour bash.
  const { h } = await monterAvecLane();
  try {
    const plan = join(h.runDir, `${h.runId}-plan.json`);
    const w = await appel(h, "write", "p3", { path: plan, content: "{}" });
    const doc = JSON.parse(readFileSync(plan, "utf-8")) as { work_units: Array<{ goal: string }> };
    doc.work_units[0].goal = "réécrit après coup";
    const b = await appel(h, "bash", "p4", { command: "python3 réécrit le plan" },
      () => writeFileSync(plan, JSON.stringify(doc)));
    propriete(
      avantAdmis && w.refuse && !b.refuse && bloque(h) && preuves(h).length === 1,
      `avant attachement, write et bash sur le plan admis (${avantAdmis}) ; après, write refusé (${w.refuse}) ` +
        `et bash bloquant (bloqué ${bloque(h)}, preuves ${preuves(h).length})`,
    );
  } finally { h.fin(); }
});

// ================================================================== ce qui doit survivre

preservation("ITE-B-nominal", "lire, interroger git et lancer des tests ne bloquent rien", async () => {
  const { h, lane } = await monterAvecLane();
  try {
    appendFileSync(join(h.root, ".gitignore"), "build/\n");
    git(h.root, "add", ".gitignore");
    git(h.root, "commit", "-qm", "ignorer build");
    const cas: Array<[string, () => void]> = [
      ["cat", () => { readFileSync(join(h.root, "src", "a.py")); }],
      ["git log et git status (rafraîchit l'index)", () => {
        const t = new Date(Date.now() + 5_000);
        utimesSync(join(h.root, "src", "a.py"), t, t);
        git(h.root, "log", "--oneline");
        git(h.root, "status");
        git(lane, "status");
      }],
      ["tests qui écrivent dans un dossier ignoré", () => {
        mkdirSync(join(h.root, "build"), { recursive: true });
        writeFileSync(join(h.root, "build", "cache"), "x");
      }],
    ];
    const bloquants: string[] = [];
    let n = 0;
    for (const [quoi, effet] of cas) {
      n += 1;
      const i = await appel(h, "bash", `n${n}`, { command: quoi }, effet);
      if (i.refuse || bloque(h)) bloquants.push(quoi);
    }
    // Un `read` natif n'est pas sondé : il ne peut pas écrire.
    const lu = await appel(h, "read", "n-read", { path: "src/a.py" });
    propriete(
      bloquants.length === 0 && !lu.refuse && preuves(h).length === 0,
      `aucune lecture ni exécution de test ne bloque ; bloquants ${JSON.stringify(bloquants)}`,
    );
  } finally { h.fin(); }
});
