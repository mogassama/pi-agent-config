/**
 * Là où la concurrence et les worktrees réels se rencontrent enfin.
 *
 * Jusqu'ici les deux propriétés étaient prouvées séparément : l'ordonnancement
 * sur des délais contrôlés, l'isolation sur de vrais dépôts. Aucun test ne les
 * combinait, et le premier run parallèle allait être le premier endroit où
 * elles se rencontrent — sur quatre-vingt-dix minutes et des sous-agents LLM.
 *
 * Ce fichier paie quelques centaines de millisecondes pour ne pas avoir à
 * découvrir là-bas qu'elles ne tiennent pas ensemble. Pas de modèle, pas de pi :
 * deux vrais processus qui dorment brièvement et écrivent dans leur worktree.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { runLanes, type Candidate } from "../subagent-only/scheduler.ts";
import { scopesCollide, type WorkUnit } from "../subagent-only/work-units.ts";
import { ensureLane, laneChanges, lanesDir } from "../subagent-only/worktree.ts";

const run = promisify(execFile);

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

function repo(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "pi-conc-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

const unit = (id: string, scope: string[]): WorkUnit => ({
  id,
  goal: `goal ${id}`,
  dependsOn: [],
  expectedWriteScope: scope,
});
const cand = (id: string): Candidate => ({ workUnitId: id, task: `écrire pour ${id}` });

/**
 * Un « worker » qui existe vraiment : un processus node séparé, qui dort puis
 * écrit dans le répertoire qu'on lui donne. C'est le minimum pour que la
 * simultanéité soit celle du système d'exploitation et non celle d'une
 * promesse.
 */
async function fauxWorker(cwd: string, fichier: string, contenu: string, ms: number) {
  const code =
    `const {writeFileSync}=require("fs");` +
    `setTimeout(()=>{writeFileSync(process.argv[1],process.argv[2]);` +
    `console.log(Date.now())},${ms});` +
    `console.log(Date.now())`;
  const { stdout } = await run(process.execPath, ["-e", code, join(cwd, fichier), contenu]);
  const [debut, fin] = stdout.trim().split("\n").map(Number);
  return { debut, fin };
}

test("deux vrais workers écrivent en même temps dans deux vrais worktrees", async () => {
  const { root, done } = repo();
  try {
    const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/b.py"])];
    const lanes = new Map<string, string>();

    const out = await runLanes(
      [cand("W01"), cand("W02")],
      { units, integrated: new Set(), collide: scopesCollide },
      2,
      async (c, u) => {
        const lane = ensureLane(root, `run-${u.id}`);
        lanes.set(u.id, lane.cwd);
        const fichier = u.id === "W01" ? "src/a.py" : "src/b.py";
        return fauxWorker(lane.cwd, fichier, `${u.id} est passée\n`, 120);
      },
    );

    assert.deepEqual(out.map((o) => o.state), ["done", "done"]);

    // Simultanéité réelle : chacun a démarré avant que l'autre ne finisse.
    const a = out[0].value as { debut: number; fin: number };
    const b = out[1].value as { debut: number; fin: number };
    assert.ok(a.debut < b.fin && b.debut < a.fin,
      `les deux processus ne se recouvrent pas : ${JSON.stringify([a, b])}`);

    // Deux répertoires distincts, tous deux sous le répertoire git.
    const un = lanes.get("W01")!;
    const deux = lanes.get("W02")!;
    assert.notEqual(un, deux);
    for (const cwd of [un, deux]) assert.ok(cwd.startsWith(lanesDir(root)), cwd);

    // Chaque lane ne voit que son propre changement.
    assert.deepEqual(laneChanges(root, "run-W01"), ["src/a.py"]);
    assert.deepEqual(laneChanges(root, "run-W02"), ["src/b.py"]);
    assert.equal(readFileSync(join(un, "src", "a.py"), "utf-8"), "W01 est passée\n");
    assert.equal(readFileSync(join(un, "src", "b.py"), "utf-8"), "b = 1\n");
    assert.equal(readFileSync(join(deux, "src", "b.py"), "utf-8"), "W02 est passée\n");
    assert.equal(readFileSync(join(deux, "src", "a.py"), "utf-8"), "a = 1\n");

    // Et la racine d'intégration n'a rien vu passer.
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=all").trim(), "");
    assert.equal(readFileSync(join(root, "src", "a.py"), "utf-8"), "a = 1\n");
  } finally {
    done();
  }
});

/*
 * Le pendant du précédent : deux unités qui écrivent le même fichier ne doivent
 * pas obtenir deux worktrees concurrents depuis la même base.
 *
 * C'est le défaut que la possession persistante corrige. Sans elle les deux
 * lanes existeraient, chacune avec sa version, et le second merge serait un
 * conflit garanti sur un travail déjà fait.
 */
test("deux unités sur le même fichier n'ouvrent pas deux worktrees", async () => {
  const { root, done } = repo();
  try {
    const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/a.py"])];
    const ouvertes: string[] = [];

    const out = await runLanes(
      [cand("W01"), cand("W02")],
      { units, integrated: new Set(), collide: scopesCollide },
      2,
      async (c, u) => {
        const lane = ensureLane(root, `run-${u.id}`);
        ouvertes.push(u.id);
        return fauxWorker(lane.cwd, "src/a.py", `${u.id}\n`, 40);
      },
    );

    assert.deepEqual(out.map((o) => o.state), ["done", "queued"]);
    assert.deepEqual(ouvertes, ["W01"]);
    assert.equal(existsSync(join(lanesDir(root), "run-W02")), false);
  } finally {
    done();
  }
});

/*
 * Le rework reprend le worktree existant, il n'en crée pas un second.
 *
 * C'est le pendant concret de « une unité ne se possède pas contre elle-même » :
 * si elle se bloquait, le rework n'aurait jamais lieu ; si elle passait mais
 * ouvrait un nouvel arbre, il repartirait d'une base sans le premier essai.
 */
test("un rework retrouve le worktree de sa lane, il n'en ouvre pas un second", async () => {
  const { root, done } = repo();
  try {
    const units = [unit("W01", ["src/a.py"])];
    const premier = ensureLane(root, "run-W01");
    writeFileSync(join(premier.cwd, "src", "a.py"), "premier essai\n");

    const out = await runLanes([cand("W01")],
      { units, integrated: new Set(), collide: scopesCollide, owners: [units[0]] }, 2,
      async (c, u) => {
        const lane = ensureLane(root, `run-${u.id}`);
        assert.equal(lane.cwd, premier.cwd);
        assert.equal(lane.created, false);
        // Le rework voit ce que la première tentative a laissé.
        assert.equal(readFileSync(join(lane.cwd, "src", "a.py"), "utf-8"), "premier essai\n");
        return fauxWorker(lane.cwd, "src/a.py", "reprise\n", 20);
      });

    assert.deepEqual(out.map((o) => o.state), ["done"]);
    assert.equal(readFileSync(join(premier.cwd, "src", "a.py"), "utf-8"), "reprise\n");
    assert.deepEqual(laneChanges(root, "run-W01"), ["src/a.py"]);
  } finally {
    done();
  }
});

// La possession traverse les appels : une lane ouverte par un appel précédent
// et non intégrée détient encore ses fichiers.
test("une lane ouverte par un appel précédent empêche d'en ouvrir une seconde", async () => {
  const { root, done } = repo();
  try {
    const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/a.py"])];
    ensureLane(root, "run-W01");

    let ouvertures = 0;
    const out = await runLanes(
      [cand("W02")],
      { units, integrated: new Set(), collide: scopesCollide, owners: [units[0]] },
      2,
      async (c, u) => {
        ouvertures += 1;
        ensureLane(root, `run-${u.id}`);
        return { debut: 0, fin: 0 };
      },
    );

    assert.deepEqual(out.map((o) => o.state), ["queued"]);
    assert.equal(ouvertures, 0);
    assert.equal(existsSync(join(lanesDir(root), "run-W02")), false);
  } finally {
    done();
  }
});
