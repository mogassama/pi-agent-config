/**
 * l0-ite-p0a-harness.test.ts — lot ITE, P0-A : une unité INTEGRATED est terminale.
 *
 * Le défaut (sol/29, run QD `1d085ea9`) : après l'INTEGRATED de W01, quatre délégations de plus sur
 * W01, deux REVIEWED acceptés par le registre, sans aucun message opérateur. Trois couches le
 * ferment, et chacune se falsifie seule (tests/l0-mutants.json) :
 *
 *   porte        `refusP0`, avant la séquence, la lane et tout lancement — ITE-A-tete
 *   écrivain     `evenementV2` refuse toute transition sur une lane intégrée — ITE-A-ecrivain,
 *                et `OPENED` d'une génération suivante sans ABANDONED opérateur — ITE-A-generation
 *   allocation   `deciderLane` ne rejoint plus une lane intégrée (C1.5 supprimée, Q-G) —
 *                ITE-A-allocation, atteinte seulement quand la porte manque
 *
 * Montage : `l0-b2-harness.ts`.
 */
import { test, type TestContext } from "node:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import {
  abandonVersionne, aJeter, ecrire, integree, issue, monter, montrer, precondition, propriete, revue, tache,
  type Harnais,
} from "./l0-b2-harness.ts";
import { gardeDeRun } from "./l0-b3-fixtures.ts";
import { appendLaneEvent, type Lease } from "../subagent-only/run-manifest.ts";
import { openLanes } from "../subagent-only/worktree.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
test.after(() => {
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

const manifeste = (h: Harnais) =>
  JSON.parse(readFileSync(join(h.runDir, "active-run.json"), "utf-8")) as Record<string, unknown>;
const lignesRegistre = (h: Harnais) => {
  const p = join(h.runDir, `${h.runId}-lanes.jsonl`);
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
};
const bail = (h: Harnais) =>
  JSON.parse(readFileSync(join(h.runDir, `${h.runId}.lease`, "owner.json"), "utf-8")) as Lease;
const photo = (h: Harnais) => ({
  seq: manifeste(h).nextSeq,
  registre: lignesRegistre(h),
  lanes: openLanes(h.root).sort().join(),
  appels: APPELS.length,
});

// ================================================================== la porte

regressionCorrigee("ITE-A-tete", "après INTEGRATED, toute délégation qui désigne l'unité est refusée avant réservation, quel que soit le rôle", async () => {
  const h = await monter();
  try {
    await integrer(h, "W03", "a = 2", "1");
    precondition(integree(h.root, "src/a.py", "a = 2"), "W03 doit être intégrée");
    precondition(openLanes(h.root).every((l) => !l.includes("W03")), "la lane de W03 doit être rangée");
    const cas: Array<[string, Record<string, unknown>]> = [
      ["worker", tache("W03")],
      ["reviewer", { agent: "reviewer", work_unit: "W03", task: "rejuger" }],
      ["integration-worker", { agent: "integration-worker", work_unit: "W03", task: "résoudre" }],
      ["scout", { agent: "scout", work_unit: "W03", task: "localiser", find: "où est a.py", scope: ["src"] }],
      ["lot mêlant W09 et W03", {
        agent: "worker",
        batch: [{ work_unit: "W09", task: "écrire pour W09" }, { work_unit: "W03", task: "réécrire W03" }],
      }],
    ];
    const manques: string[] = [];
    let n = 0;
    for (const [quoi, params] of cas) {
      n += 1;
      const avant = photo(h);
      PILOTE.pendant = ecrire("src/a.py", "a = 9\n");
      const r = await issue(() => h.outil.execute(`t${n}`, params));
      PILOTE.pendant = undefined;
      PILOTE.resultat = undefined;
      const code = r.kind === "returned" ? gardeDeRun(r.value)?.code : undefined;
      const apres = photo(h);
      if (code !== "ITE_UNITE_TERMINALE" || JSON.stringify(apres) !== JSON.stringify(avant)) {
        manques.push(
          `${quoi} : code ${String(code)}, séquence ${String(avant.seq)}→${String(apres.seq)}, registre ` +
            `${avant.registre === apres.registre ? "intact" : "changé"}, lanes ${avant.lanes}→${apres.lanes}, ` +
            `enfants ${avant.appels}→${apres.appels} ; ${montrer(r)}`,
        );
      }
    }
    propriete(
      manques.length === 0,
      `chaque rôle, et un lot qui la contient, est refusé sur une unité intégrée par ITE_UNITE_TERMINALE, ` +
        `sans séquence réservée, sans ligne de registre, sans lane ni enfant ; ${manques.join(" · ")}`,
    );
  } finally { h.fin(); }
});

regressionCorrigee("ITE-A-allocation", "une lane intégrée ne se rejoint plus, même quand la porte manque", async () => {
  /*
   * La défense en profondeur de `deciderLane`. Sur l'objet intact, la porte refuse avant ; cette
   * preuve est donc verte avec elle comme sans elle, et son mutant retire les deux (forme
   * composée). Ce qu'elle affirme est plus étroit que ITE-A-tete : aucun worktree n'est recréé
   * pour l'unité intégrée, et aucun enfant ne part.
   */
  const h = await monter();
  try {
    await integrer(h, "W03", "a = 2", "1");
    precondition(openLanes(h.root).every((l) => !l.includes("W03")), "la lane de W03 doit être rangée");
    const appels = APPELS.length;
    PILOTE.pendant = ecrire("src/a.py", "a = 9\n");
    const r = await issue(() => h.outil.execute("2", tache("W03")));
    PILOTE.pendant = undefined;
    propriete(
      openLanes(h.root).every((l) => !l.includes("W03")) && APPELS.length === appels,
      `aucun worktree recréé pour W03 intégrée, aucun enfant lancé ; lanes ${openLanes(h.root).join()}, ` +
        `enfants ${appels}→${APPELS.length} ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== l'écrivain

regressionCorrigee("ITE-A-ecrivain", "l'écrivain refuse toute transition sur une lane intégrée, sauf VIOLATION et ABANDONED", async () => {
  const h = await monter();
  try {
    await integrer(h, "W03", "a = 2", "1");
    const lane = String(
      (h.evenements().filter((e) => e.work_unit === "W03" && e.event === "OPENED").pop() ?? {}).lane,
    );
    precondition(lane.includes("W03"), `la lane de W03 doit se lire au registre ; ${lane}`);
    const lease = bail(h);
    const at = new Date().toISOString();
    const refusees: Array<[string, Parameters<typeof appendLaneEvent>[1]]> = [
      ["REVIEWED", {
        event: "REVIEWED", work_unit: "W03", at, lane, from_tree: "0".repeat(40), tree: "1".repeat(40),
        verdict: "approved", reviewer: { delegation_seq: 99, agent: "reviewer", role: "reviewer" },
        proof: { mode: "none" },
      }],
      ["RISK", { event: "RISK", work_unit: "W03", at, lane, id: "r-ite", transition: "opened", by: "reviewer#99" }],
    ];
    const manques: string[] = [];
    for (const [quoi, ev] of refusees) {
      const avant = lignesRegistre(h);
      const r = await issue(() => appendLaneEvent(h.runDir, ev, lease));
      if (r.kind !== "threw" || !/P0-A/.test(r.error) || lignesRegistre(h) !== avant) {
        manques.push(`${quoi} : ${montrer(r)}, registre ${lignesRegistre(h) === avant ? "intact" : "changé"}`);
      }
    }
    const violation = await issue(() => appendLaneEvent(h.runDir, {
      event: "VIOLATION", work_unit: "W03", at, lane, kind: "reserved-violation", paths: ["DESIGN.md"],
      source: { delegation_seq: 99, agent: "worker" }, observed_tree: "2".repeat(40),
    }, lease));
    if (violation.kind !== "returned") manques.push(`VIOLATION refusée : ${montrer(violation)}`);
    propriete(
      manques.length === 0,
      `sur une lane intégrée, REVIEWED et RISK sont refusés (P0-A) sans rien écrire ; VIOLATION reste ` +
        `une observation écrivable ; ${manques.join(" · ")}`,
    );
  } finally { h.fin(); }
});

regressionCorrigee("ITE-A-generation", "aucune génération ne s'ouvre après INTEGRATED sans ABANDONED opérateur", async () => {
  const h = await monter();
  try {
    await integrer(h, "W03", "a = 2", "1");
    const lease = bail(h);
    const g2 = {
      event: "OPENED" as const, work_unit: "W03", at: new Date().toISOString(),
      base: "0".repeat(40), lane: `${h.runId}-W03-g2`, generation: 2,
    };
    const avant = lignesRegistre(h);
    const refus = await issue(() => appendLaneEvent(h.runDir, g2, lease));
    const intact = lignesRegistre(h) === avant;
    // La sortie opérateur contrôlée : ABANDONED de la lane intégrée, plan non terminal (W09 reste).
    abandonVersionne(h, "W03");
    const apres = await issue(() => appendLaneEvent(h.runDir, { ...g2, at: new Date().toISOString() }, lease));
    propriete(
      refus.kind === "threw" && /P0-A/.test(refus.error) && intact && apres.kind === "returned",
      `OPENED g2 refusé tant que la lane g1 est intégrée (${montrer(refus)}, registre intact ${intact}) ; ` +
        `admis après ABANDONED opérateur, le plan n'étant pas terminal (${montrer(apres)})`,
    );
  } finally { h.fin(); }
});

// ================================================================== ce qui doit survivre

preservation("ITE-A-lane-ouverte", "une lane encore ouverte se rejoint sans admission, comme avant", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    const w1 = await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
    const w2 = await issue(() => h.outil.execute("2", tache("W03")));
    PILOTE.pendant = undefined;
    const lanes = openLanes(h.root).filter((l) => l.includes("W03"));
    propriete(
      w2.kind === "returned" && (w2.value as { isError?: boolean }).isError === false && lanes.length === 1,
      `un rework sur une lane ouverte reste admis et rejoint la même lane ; lanes ${lanes.join()} ; ` +
        `${montrer({ kind: "returned", value: w1 })} · ${montrer(w2)}`,
    );
  } finally { h.fin(); }
});
