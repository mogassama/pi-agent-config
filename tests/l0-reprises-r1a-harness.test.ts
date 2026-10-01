/**
 * l0-reprises-r1a-harness.test.ts — LOT-REPRISES, R1-a, dans le vrai `plan()` de l'extension
 * (PLAN-LOT-REPRISES v2 gelé, `1a840043`, § 2).
 *
 *   gel   un consommateur non classé refuse la délégation AVANT tout : aucun enfant, aucune
 *         lane, aucun plan attaché ; le résultat porte le refus structuré ; le plan corrigé
 *         est ensuite attaché tel quel, son planHash est celui du plan corrigé — R1A-gel
 *
 * Montage : `l0-b2-harness.ts` (vraie extension, dispatch substitué).
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APPELS } from "./stubs/dispatch.ts";
import { aJeter, git, monter, precondition, propriete, tache, texte } from "./l0-b2-harness.ts";
import { lirePlanAttache, planHash } from "../subagent-only/run-manifest.ts";
import { openLanes } from "../subagent-only/worktree.ts";
import { PLAN_NON_CLASSES } from "../subagent-only/consommateurs.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

const planAvec = (kept?: string[]) => ({
  version: 1,
  work_units: [{
    id: "W03", goal: "extraire", depends_on: [], expected_write_scope: ["src/pkg/io.py", "src/pkg/fp.py"],
    ...(kept ? { kept_consumers: kept } : {}),
  }],
});

regressionCorrigee("R1A-gel", "un consommateur non classé refuse la délégation avant tout effet, et le plan corrigé est attaché tel quel", async () => {
  const h = await monter({ plan: planAvec() });
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  mkdirSync(join(h.root, "src", "pkg"), { recursive: true });
  writeFileSync(join(h.root, "src", "pkg", "__init__.py"), "");
  writeFileSync(join(h.root, "src", "pkg", "io.py"), "def lire():\n    return 1\n");
  writeFileSync(join(h.root, "src", "pkg", "run.py"), "from .io import lire\n");
  git(h.root, "add", "-A");
  git(h.root, "commit", "-qm", "paquet");

  const refuse = await h.outil.execute("r1a-1", tache("W03")) as { isError?: boolean; details?: { plan_refusal?: { code?: string; missing?: Record<string, string[]> } } };
  propriete(refuse.isError === true, `la délégation est refusée (${texte(refuse).slice(0, 200)})`);
  propriete(refuse.details?.plan_refusal?.code === PLAN_NON_CLASSES, `refus structuré (${JSON.stringify(refuse.details)})`);
  propriete(JSON.stringify(refuse.details?.plan_refusal?.missing?.W03) === JSON.stringify(["src/pkg/run.py"]), "la liste nomme le consommateur");
  propriete(APPELS.length === 0, `aucun enfant lancé (${APPELS.length})`);
  propriete(openLanes(h.root).length === 0, "aucune lane ouverte");
  propriete(lirePlanAttache(h.runDir).etat === "non-attache", "aucun plan attaché ni planHash publié");

  const corrige = JSON.stringify(planAvec(["src/pkg/run.py"]));
  writeFileSync(join(h.runDir, `${h.runId}-plan.json`), corrige);
  const r = await h.outil.execute("r1a-2", tache("W03"));
  precondition(APPELS.length === 1, `le plan corrigé laisse partir la délégation (${texte(r).slice(0, 200)})`);
  const attache = lirePlanAttache(h.runDir);
  propriete(attache.etat === "attache" && attache.texte === corrige, `le plan corrigé est attaché tel quel (${attache.etat})`);
  const manifeste = JSON.parse(readFileSync(join(h.runDir, "active-run.json"), "utf-8")) as { planHash?: string };
  propriete(manifeste.planHash === planHash(corrige), "le planHash est celui du plan corrigé");
  assert.ok(true);
});
