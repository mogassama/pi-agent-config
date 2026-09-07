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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

function repo(): { root: string; mesures: string; done: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-conc-")));
  /*
   * Les mesures s'écrivent **hors** du dépôt.
   *
   * Un fichier de mesure posé sous `root` salirait la racine, et ce test vérifie
   * précisément qu'elle ne voit rien passer. L'instrument ne doit pas modifier
   * ce qu'il mesure.
   */
  const mesures = realpathSync(mkdtempSync(join(tmpdir(), "pi-conc-mesures-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return {
    root,
    mesures,
    done: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(mesures, { recursive: true, force: true });
    },
  };
}

/**
 * Aucune lane n'a rejeté.
 *
 * `state: "done"` ne le dit pas : le scheduler enregistre aussi une lane dont le
 * callback a rejeté comme `done`, avec `reason: "échec"` et un `error`. Une
 * assertion sur le seul `state` passe donc sur un succès comme sur un échec, ce
 * qui est vrai depuis l'origine de ce fichier. C'est `error` qui distingue.
 */
function sansEchec(out: readonly { error?: unknown }[]): void {
  assert.deepEqual(
    out.filter((o) => o.error !== undefined).map((o) => String(o.error)),
    [],
    "une lane a rejeté — `done` ne distingue pas le succès de l'échec",
  );
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
async function fauxWorker(
  cwd: string,
  fichier: string,
  contenu: string,
  ms: number,
  journal: string,
) {
  /*
   * L'enfant écrit ses horodatages dans un fichier, pas sur `stdout`.
   *
   * Le fait observé, et rien de plus : sous node 26 et pendant la suite, le
   * `stdout` de cet enfant ne rendait pas deux nombres — `Number` en tirait
   * `NaN`, la mesure disparaissait, et le test accusait l'ordonnanceur d'un
   * défaut qui n'était pas le sien. La même invocation, lancée seule, rend ses
   * deux horodatages. **La cause n'est pas identifiée** ; l'écrire ici comme si
   * elle l'était serait inventer une explication.
   *
   * Ce qui est corrigé est autre chose, et vrai indépendamment de cette cause :
   * le recouvrement de deux processus n'a aucune raison de passer par un canal
   * que le lanceur de tests partage. Un fichier n'a qu'un seul écrivain, et une
   * mesure ne doit dépendre que de ce qu'elle mesure.
   */
  const code =
    `const {writeFileSync}=require("fs");` +
    `const debut=Date.now();` +
    `setTimeout(()=>{` +
    `writeFileSync(process.argv[1],process.argv[2]);` +
    `writeFileSync(process.argv[3],JSON.stringify({debut,fin:Date.now()}))` +
    `},${ms});`;
  await run(process.execPath, ["-e", code, join(cwd, fichier), contenu, journal]);

  const brut = readFileSync(journal, "utf-8");
  try {
    return JSON.parse(brut) as { debut: number; fin: number };
  } catch {
    // Le contenu brut plutôt qu'un `NaN` muet : un instrument qui échoue doit
    // dire ce qu'il a lu.
    throw new Error(`journal de mesure illisible : ${JSON.stringify(brut)}`);
  }
}

test("deux vrais workers écrivent en même temps dans deux vrais worktrees", async () => {
  const { root, mesures, done } = repo();
  const journal = (id: string) => join(mesures, `${id}.json`);
  try {
    const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/b.py"])];
    const lanes = new Map<string, string>();

    /*
     * Une barrière, et non un chronomètre.
     *
     * Le test pariait sur 120 ms : le premier worker devait dormir assez
     * longtemps pour que le second démarre. `ensureLane` crée un worktree, ce
     * qui est synchrone et parfois lent, si bien que le premier processus
     * pouvait finir avant le lancement du second. L'échec ne réfutait alors pas
     * l'ordonnanceur, seulement l'horloge — un test qui ment une fois sur trois,
     * c'est-à-dire pire qu'absent, puisque le compte de la suite est ce sur quoi
     * repose la détection de dérive.
     *
     * La propriété à prouver est que les deux callbacks sont actifs ensemble.
     * Elle se vérifie donc directement : chacun signale sa présence et attend
     * l'autre. Le recouvrement des deux processus, mesuré ensuite, redevient une
     * conséquence plutôt qu'un pari.
     */
    let ouvrir!: () => void;
    let refuser!: (erreur: Error) => void;
    let prets = 0;
    const depart = new Promise<void>((resolve, reject) => {
      ouvrir = resolve;
      refuser = reject;
    });
    // Sans expiration, un ordonnanceur qui sérialiserait les lanes ferait pendre
    // la suite au lieu de la faire échouer. Le défaut doit rester lisible.
    const expiration = setTimeout(
      () => refuser(new Error("les deux callbacks n'ont pas été planifiés ensemble")),
      5_000,
    );

    const out = await runLanes(
      [cand("W01"), cand("W02")],
      { units, integrated: new Set(), collide: scopesCollide },
      2,
      async (c, u) => {
        const lane = ensureLane(root, `run-${u.id}`);
        lanes.set(u.id, lane.cwd);
        const fichier = u.id === "W01" ? "src/a.py" : "src/b.py";
        prets += 1;
        if (prets === 2) {
          clearTimeout(expiration);
          ouvrir();
        }
        await depart;
        return fauxWorker(lane.cwd, fichier, `${u.id} est passée\n`, 500, journal(u.id));
      },
    );

    sansEchec(out);
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
  const { root, mesures, done } = repo();
  const journal = (id: string) => join(mesures, `${id}.json`);
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
        return fauxWorker(lane.cwd, "src/a.py", `${u.id}\n`, 40, journal(u.id));
      },
    );

    sansEchec(out);
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
  const { root, mesures, done } = repo();
  const journal = (id: string) => join(mesures, `${id}.json`);
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
        return fauxWorker(lane.cwd, "src/a.py", "reprise\n", 20, journal(u.id));
      });

    sansEchec(out);
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
