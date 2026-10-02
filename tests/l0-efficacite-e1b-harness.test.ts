/**
 * l0-efficacite-e1b-harness.test.ts — LOT-EFFICACITÉ, E1-bis, dans la vraie extension (plan des
 * leviers v2 complétée, § 2.2 et § 2.4).
 *
 *   gel        un plan sans kept_consumers part au premier `task` : le kept dérivé est publié
 *              avant le planHash, nommé dans le résultat et porté au worker (R1-b) et au
 *              reviewer (RC) — E1b-gel
 *   reprise    après un rechargement, le kept durable est relu : l'analyse n'est pas rejouée, ni
 *              sur un arbre modifié, ni sans python3 — E1b-reprise
 *   inconnu    un kept durable altéré devient inconnu et est transmis tel quel au reviewer (RC)
 *              et au worker (R1-b garde son périmètre) — E1b-inconnu
 *   interrompu un kept présent sans planHash au manifeste : aucune délégation, scout compris ; rien
 *              n'est attaché, réutilisé ni remplacé, même après modification de l'arbre — E1b-interrompu
 *   manifeste  après attachement, un manifeste illisible ou invalide n'établit jamais l'absence de
 *              planHash : arrêt de reprise sans analyse pré-gel, publication ni délégation — E1b-manifeste
 *              (adjudication de la livraison, 02-10, correction 1)
 *
 * Remplace R1A-gel (tests/l0-reprises-r1a-harness.test.ts, retiré) : le refus « non classé » qu'il
 * éprouvait n'existe plus. Montage : `l0-b2-harness.ts` (vraie extension, dispatch substitué).
 */
import { test, type TestContext } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, git, monter, precondition, propriete, revue, tache, type Harnais } from "./l0-b2-harness.ts";
import { lirePlanAttache, planHash } from "../subagent-only/run-manifest.ts";
import { keptPath } from "../subagent-only/kept-durable.ts";
import { openLanes } from "../subagent-only/worktree.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
const locaux: string[] = [];
test.after(() => { for (const d of [...aJeter(), ...locaux]) rmSync(d, { recursive: true, force: true }); });

type Resultat = { isError?: boolean; content?: Array<{ text?: string }>; details?: Record<string, unknown> };
const texte = (r: unknown) => ((r as Resultat).content ?? []).map((c) => c.text ?? "").join("\n");

const PLAN = {
  version: 1,
  work_units: [{ id: "W03", goal: "extraire", depends_on: [], expected_write_scope: ["src/pkg/io.py", "src/a.py"] }],
};

async function paquet(): Promise<Harnais> {
  const h = await monter({ plan: PLAN });
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  mkdirSync(join(h.root, "src", "pkg"), { recursive: true });
  writeFileSync(join(h.root, "src", "pkg", "__init__.py"), "");
  writeFileSync(join(h.root, "src", "pkg", "io.py"), "def lire():\n    return 1\n");
  writeFileSync(join(h.root, "src", "pkg", "run.py"), "from .io import lire\n");
  git(h.root, "add", "-A");
  git(h.root, "commit", "-qm", "paquet");
  return h;
}

regressionCorrigee("E1b-gel", "un plan sans kept_consumers part au premier task, son kept dérivé publié avant le planHash et transmis", async () => {
  const h = await paquet();
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  const r = await h.outil.execute("e1b-1", tache("W03")) as Resultat;
  PILOTE.pendant = undefined;
  propriete(r.isError !== true && APPELS.length === 1, `le premier task part, sans refus R1-a (${texte(r).slice(0, 300)})`);
  const attache = lirePlanAttache(h.runDir);
  propriete(attache.etat === "attache", `plan gelé (${attache.etat})`);
  const kept = JSON.parse(readFileSync(keptPath(h.runDir, h.runId), "utf-8")) as { planHash?: string; units?: Record<string, { kept?: string[] }> };
  const manifeste = JSON.parse(readFileSync(join(h.runDir, "active-run.json"), "utf-8")) as { planHash?: string };
  propriete(kept.planHash === manifeste.planHash && manifeste.planHash === planHash(JSON.stringify(PLAN)),
    `kept durable au planHash du plan gelé (${kept.planHash} / ${manifeste.planHash})`);
  propriete(JSON.stringify(kept.units?.W03?.kept) === JSON.stringify(["src/pkg/run.py"]), `kept dérivé (${JSON.stringify(kept.units)})`);
  propriete(texte(r).includes("kept_consumers de W03, calculés par le runtime : src/pkg/run.py"), `le résultat qui gèle les nomme (${texte(r).slice(0, 300)})`);
  propriete(JSON.stringify((r.details?.plan_kept as Record<string, { kept?: string[] }> | undefined)?.W03?.kept) === JSON.stringify(["src/pkg/run.py"]),
    `details.plan_kept (${JSON.stringify(r.details?.plan_kept)})`);
  propriete(JSON.stringify(APPELS[0].perimetre?.kept) === JSON.stringify(["src/pkg/run.py"]), `R1-b : le worker reçoit le kept dérivé (${JSON.stringify(APPELS[0].perimetre)})`);
  const r2 = await h.outil.execute("e1b-2", revue("W03"));
  PILOTE.resultat = undefined;
  const rv = APPELS.find((a) => a.agent === "reviewer");
  propriete(JSON.stringify(rv?.gardes) === JSON.stringify({ unit: "W03", kept: ["src/pkg/run.py"] }),
    `RC : le reviewer reçoit le kept dérivé (${JSON.stringify(rv?.gardes)} ; ${texte(r2).slice(0, 200)})`);
  // Dit une fois : le résultat suivant ne répète pas le gel.
  propriete(!texte(r2).includes("calculés par le runtime"), "le gel n'est dit qu'une fois");
});

regressionCorrigee("E1b-reprise", "une reprise relit le kept durable sans rejouer l'analyse, ni sur un arbre modifié ni sans python3", async () => {
  const h = await paquet();
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("e1b-r1", tache("W03"));
  PILOTE.pendant = undefined;
  // L'arbre change après le gel : un nouvel importeur du module écrit, suivi.
  writeFileSync(join(h.root, "src", "pkg", "nouveau.py"), "from .io import lire\n");
  git(h.root, "add", "-A");
  git(h.root, "commit", "-qm", "nouvel importeur");
  // Et python3 disparaît du PATH : une analyse rejouée serait PLAN_PYTHON_ANALYSIS_IMPOSSIBLE. Le
  // PATH ne garde que git, par un lien dans un répertoire jetable.
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "pi-e1b-path-")));
  locaux.push(bin);
  symlinkSync(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).trim(), join(bin, "git"));
  const pathAvant = process.env.PATH;
  process.env.PATH = bin;
  try {
    precondition(spawnSync("python3", ["--version"]).error !== undefined, "python3 ne doit plus être joignable");
    const h2 = await h.recharger();
    const r = await h2.outil.execute("e1b-r2", revue("W03"));
    PILOTE.resultat = undefined;
    const rv = APPELS.find((a) => a.agent === "reviewer");
    propriete(JSON.stringify(rv?.gardes) === JSON.stringify({ unit: "W03", kept: ["src/pkg/run.py"] }),
      `Reprise d'un plan gelé après modification de l'arbre ou disparition de python3 : aucun nouvel appel à l'analyse pré-gel. (${JSON.stringify(rv?.gardes)} ; ${texte(r).slice(0, 300)})`);

  } finally {
    process.env.PATH = pathAvant;
  }
});

regressionCorrigee("E1b-inconnu", "un kept durable altéré est inconnu après reprise, transmis tel quel au worker et au reviewer", async () => {
  const h = await paquet();
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("e1b-k1", tache("W03"));
  PILOTE.pendant = undefined;
  const chemin = keptPath(h.runDir, h.runId);
  const doc = JSON.parse(readFileSync(chemin, "utf-8")) as { units: Record<string, unknown> };
  delete doc.units.W03;
  writeFileSync(chemin, JSON.stringify(doc));
  const h2 = await h.recharger();
  PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
  const r1 = await h2.outil.execute("e1b-k2", tache("W03"));
  PILOTE.pendant = undefined;
  const r2 = await h2.outil.execute("e1b-k3", revue("W03"));
  PILOTE.resultat = undefined;
  const w = APPELS.find((a) => a.agent === "worker") as { perimetre?: { kept?: string[]; keptInconnu?: string } } | undefined;
  const rv = APPELS.find((a) => a.agent === "reviewer") as { gardes?: { inconnu?: string; kept?: string[] } } | undefined;
  propriete(!!w?.perimetre?.keptInconnu && JSON.stringify(w.perimetre.kept) === "[]",
    `Fichier illisible, schéma invalide ou unité manquante : kept inconnu. R1-b garde son périmètre (${JSON.stringify(w?.perimetre)} ; ${texte(r1).slice(0, 200)})`);
  propriete(!!rv?.gardes?.inconnu && rv.gardes.kept === undefined,
    `l'état inconnu est transmis explicitement à RC, jamais une liste vide (${JSON.stringify(rv?.gardes)} ; ${texte(r2).slice(0, 200)})`);
});

regressionCorrigee("E1b-interrompu", "un kept publié sans planHash arrête toute délégation, sans réutilisation, remplacement ni attachement", async () => {
  const h = await paquet();
  const orphelin = JSON.stringify({ schema: "pi-kept/1", planHash: planHash(JSON.stringify(PLAN)), units: { W03: { kept: [], derived: [], declared: [], dropped: [] } } });
  writeFileSync(keptPath(h.runDir, h.runId), orphelin);
  for (const [id, params] of [["e1b-i1", tache("W03")], ["e1b-i2", { agent: "scout", task: "localiser", find: "où est lire ?", scope: ["src"] }]] as const) {
    const r = await h.outil.execute(id, params) as Resultat;
    propriete(r.isError === true && texte(r).includes("KEPT_PUBLICATION_INTERROMPUE"), `${params.agent} refusé, état nommé (${texte(r).slice(0, 200)})`);
  }
  // Même cas après modification des fichiers analysés, avec texte du plan inchangé : le même ARRÊT est exigé.
  writeFileSync(join(h.root, "src", "pkg", "nouveau.py"), "from .io import lire\n");
  git(h.root, "add", "-A");
  git(h.root, "commit", "-qm", "nouvel importeur");
  const h2 = await h.recharger();
  const r = await h2.outil.execute("e1b-i3", tache("W03")) as Resultat;
  propriete(r.isError === true && texte(r).includes("KEPT_PUBLICATION_INTERROMPUE"),
    `Même cas après modification des fichiers analysés, avec texte du plan inchangé : le même ARRÊT est exigé. (${texte(r).slice(0, 200)})`);
  propriete(APPELS.length === 0 && openLanes(h.root).length === 0, `aucune délégation ni lane (${APPELS.length})`);
  propriete(lirePlanAttache(h.runDir).etat === "non-attache", "aucun plan attaché");
  propriete(readFileSync(keptPath(h.runDir, h.runId), "utf-8") === orphelin, "le kept orphelin n'est ni réutilisé ni remplacé");
});

regressionCorrigee("E1b-manifeste", "un manifeste illisible ou invalide après attachement arrête la reprise sans analyse pré-gel, publication ni délégation", async () => {
  const h = await paquet();
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("e1b-m1", tache("W03"));
  PILOTE.pendant = undefined;
  precondition(lirePlanAttache(h.runDir).etat === "attache", "le plan doit être attaché");
  const manifeste = join(h.runDir, "active-run.json");
  const kept = keptPath(h.runDir, h.runId);
  const brut = readFileSync(manifeste, "utf-8");
  const keptAvant = readFileSync(kept, "utf-8");
  // python3 rendu indisponible, mais observable : chaque appel laisse une trace, puis échoue.
  const bin = realpathSync(mkdtempSync(join(tmpdir(), "pi-e1b-m-")));
  locaux.push(bin);
  symlinkSync(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).trim(), join(bin, "git"));
  writeFileSync(join(bin, "python3"), `#!/bin/sh\necho appel >> "${bin}/appels"\nexit 127\n`, { mode: 0o755 });
  const appelsPython = () => { try { return readFileSync(join(bin, "appels"), "utf-8").split("\n").filter(Boolean).length; } catch { return 0; } };
  for (const [i, illisible] of [["json", "{tronqué"], ["statut", JSON.stringify({ ...JSON.parse(brut), status: "bizarre" })]] as const) {
    // La session se charge sur un manifeste sain ; il devient inexploitable avant la première relecture du plan.
    const h2 = await h.recharger();
    precondition(h2.chargement.ok, `la session doit se charger (${JSON.stringify(h2.chargement)})`);
    writeFileSync(manifeste, illisible);
    writeFileSync(join(h.root, "src", "pkg", `nouveau_${i}.py`), "from .io import lire\n");
    git(h.root, "add", "-A");
    git(h.root, "commit", "-qm", `nouvel importeur ${i}`);
    const pathAvant = process.env.PATH;
    process.env.PATH = bin;
    const n0 = APPELS.length;
    let r: Resultat;
    try {
      r = await h2.outil.execute(`e1b-m-${i}`, tache("W03")) as Resultat;
    } finally {
      process.env.PATH = pathAvant;
    }
    propriete(appelsPython() === 0,
      `manifeste ${i} : aucun appel à l'analyse pré-gel des consommateurs (${appelsPython()} appel(s) à python3 ; ${texte(r).slice(0, 200)})`);
    propriete(r.isError === true && APPELS.length === n0, `manifeste ${i} : arrêt, aucune délégation (${texte(r).slice(0, 200)})`);
    propriete(readFileSync(manifeste, "utf-8") === illisible && readFileSync(kept, "utf-8") === keptAvant,
      `manifeste ${i} : rien n'est publié — ni manifeste ni kept réécrits`);
    writeFileSync(manifeste, brut);
  }
});
