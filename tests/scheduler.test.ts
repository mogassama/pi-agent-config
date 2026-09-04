/**
 * L'admission et l'ordonnancement, sur des délais contrôlés.
 *
 * Les critères de ce lot ont été fixés avant d'écrire le code, et le plus
 * important est temporel : prouver que ce n'est pas une vague déguisée. Un
 * fan-out attend la plus lente du groupe avant de repartir ; un scheduler
 * remplit l'emplacement libéré tout de suite. Les deux passent les mêmes tests
 * de comptage — seule l'horloge les distingue.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SchedulerInputError,
  SchedulerInvariantError,
  admit,
  runLanes,
  type Candidate,
} from "../subagent-only/scheduler.ts";
import { scopesCollide, type WorkUnit } from "../subagent-only/work-units.ts";

const unit = (id: string, scope: string[], deps: string[] = []): WorkUnit => ({
  id,
  goal: `goal ${id}`,
  dependsOn: deps,
  expectedWriteScope: scope,
});
const cand = (id: string): Candidate => ({ workUnitId: id, task: `faire ${id}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un journal horodaté : ce qui a démarré, ce qui a fini, et quand. */
function tracer() {
  const t0 = Date.now();
  const events: Array<{ at: number; what: string; id: string }> = [];
  return {
    events,
    async run(c: Candidate, u: WorkUnit, ms: number) {
      events.push({ at: Date.now() - t0, what: "start", id: u.id });
      await sleep(ms);
      events.push({ at: Date.now() - t0, what: "end", id: u.id });
      return u.id;
    },
    at(what: string, id: string) {
      return events.find((e) => e.what === what && e.id === id)?.at ?? -1;
    },
  };
}

// ------------------------------------------------------------- admission

test("une unité inconnue du plan gelé est refusée", () => {
  const r = admit(cand("W99"), { units: [unit("W01", ["a.py"])], integrated: new Set(), collide: scopesCollide });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /ne figure pas dans le plan/);
});

// Intégrée, et non terminée : une dépendance dont le travail existe mais n'est
// pas dans l'intégration laisserait la lane partir d'une base incomplète.
test("une dépendance non intégrée refuse le candidat", () => {
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"], ["W01"])];
  const r = admit(cand("W02"), { units, integrated: new Set(), collide: scopesCollide });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /dépend de W01/);
});

test("une dépendance intégrée laisse passer", () => {
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"], ["W01"])];
  assert.equal(admit(cand("W02"), { units, integrated: new Set(["W01"]), collide: scopesCollide }).ok, true);
});

test("plusieurs dépendances manquantes sont toutes nommées", () => {
  const units = [unit("W01", ["a"]), unit("W02", ["b"]), unit("W03", ["c"], ["W01", "W02"])];
  const r = admit(cand("W03"), { units, integrated: new Set(["W01"]), collide: scopesCollide });
  assert.match(r.ok === false ? r.reason : "", /W02/);
});

// --------------------------------------------------------- parallélisme

test("deux unités indépendantes se recouvrent réellement dans le temps", async () => {
  const t = tracer();
  const units = [unit("W01", ["src/a.py"]), unit("W03", ["tests/x.py"])];
  const out = await runLanes([cand("W01"), cand("W03")], { units, integrated: new Set(), collide: scopesCollide }, 2,
    (c, u) => t.run(c, u, 60));
  assert.deepEqual(out.map((o) => o.state), ["done", "done"]);
  // La seconde démarre avant que la première ne finisse.
  assert.ok(t.at("start", "W03") < t.at("end", "W01"), JSON.stringify(t.events));
});

test("le nombre de lanes actives ne dépasse jamais la limite", async () => {
  const t = tracer();
  const units = ["W01", "W02", "W03", "W04"].map((id) => unit(id, [`src/${id}.py`]));
  let active = 0;
  let peak = 0;
  await runLanes(units.map((u) => cand(u.id)), { units, integrated: new Set(), collide: scopesCollide }, 2,
    async (c, u) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(30);
      active -= 1;
      return u.id;
    });
  assert.equal(peak, 2);
});

/*
 * Le test qui distingue un scheduler d'un fan-out.
 *
 * W01 dure longtemps, W02 est courte, W03 attend un emplacement. Une vague
 * attendrait la fin de W01 pour repartir ; la file démarre W03 dès que W02
 * libère sa place. La différence ne se voit que sur l'horloge.
 */
test("un emplacement libéré repart aussitôt, sans attendre la lane longue", async () => {
  const t = tracer();
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"]), unit("W03", ["c.py"])];
  const durees: Record<string, number> = { W01: 200, W02: 30, W03: 30 };
  await runLanes([cand("W01"), cand("W02"), cand("W03")], { units, integrated: new Set(), collide: scopesCollide }, 2,
    (c, u) => t.run(c, u, durees[u.id]));

  assert.ok(t.at("start", "W03") >= t.at("end", "W02"), "W03 attend la place de W02");
  assert.ok(t.at("start", "W03") < t.at("end", "W01"),
    `W03 ne doit pas attendre W01 : ${JSON.stringify(t.events)}`);
});

// ----------------------------------------------------- scopes et attente

/*
 * Deux unités légales dont les scopes se recouvrent : aucune n'est refusée, la
 * seconde reste en file — et y reste jusqu'à la fin de l'appel.
 *
 * La version précédente de ces tests attendait que W02 démarre après la fin du
 * worker W01, et c'était le défaut : la lane W01 existe toujours, elle n'est ni
 * revue ni intégrée, donc W02 serait partie d'une base qui ne la contient pas.
 * Deux branches concurrentes sur le même fichier depuis la même base — la
 * sérialisation n'achetait rien.
 */
test("des scopes incompatibles font attendre, ils ne refusent pas", async () => {
  const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/a.py"])];
  const out = await runLanes([cand("W01"), cand("W02")],
    { units, integrated: new Set(), collide: scopesCollide }, 2, async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.state), ["done", "queued"]);
  assert.match(out[1].reason, /détenu par W01/);
});

// `queued` est terminal pour cet appel : la review du propriétaire est un appel
// séparé, elle ne peut pas survenir pendant celui-ci.
test("une candidate en file le reste jusqu'au retour de l'appel", async () => {
  const t = tracer();
  const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/a.py"]), unit("W03", ["tests/x.py"])];
  const out = await runLanes([cand("W01"), cand("W02"), cand("W03")],
    { units, integrated: new Set(), collide: scopesCollide }, 2,
    (c, u) => t.run(c, u, u.id === "W01" ? 120 : 30));
  assert.deepEqual(out.map((o) => o.state), ["done", "queued", "done"]);
  // W03 ne possède rien de commun : il occupe la seconde voie tout de suite.
  assert.ok(t.at("start", "W03") < t.at("end", "W01"));
  assert.equal(t.at("start", "W02"), -1);
});

/*
 * La possession traverse les appels.
 *
 * `runLanes` ne connaît que ses propres lanes ; une lane ouverte par un appel
 * précédent et pas encore intégrée possède pourtant toujours ses fichiers.
 * Sans `owners`, deux appels batch successifs se marcheraient dessus sans que
 * rien ne le voie.
 */
test("une lane ouverte par un appel précédent bloque encore", async () => {
  const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/a.py"])];
  const out = await runLanes([cand("W02")],
    { units, integrated: new Set(), collide: scopesCollide, owners: [units[0]] }, 2,
    async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.state), ["queued"]);
});

/*
 * Une unité possède son scope contre les autres, jamais contre elle-même.
 *
 * Sa lane est ouverte parce qu'elle attend une review ; le rework vient
 * précisément la reprendre, dans le même worktree et sur la même branche. La
 * bloquer sur sa propre possession l'aurait rendue inéligible pour toujours —
 * son propriétaire ne pouvant se libérer que par une intégration qui n'arrivera
 * jamais sans rework.
 */
test("un rework n'est pas bloqué par sa propre lane", async () => {
  const units = [unit("W01", ["src/a.py"])];
  const out = await runLanes([cand("W01")],
    { units, integrated: new Set(), collide: scopesCollide, owners: [units[0]] }, 2,
    async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.state), ["done"]);
});

test("un rework partage un lot avec une unité indépendante", async () => {
  const units = [unit("W01", ["src/a.py"]), unit("W09", ["tests/x.py"])];
  const out = await runLanes([cand("W01"), cand("W09")],
    { units, integrated: new Set(), collide: scopesCollide, owners: [units[0]] }, 2,
    async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.state), ["done", "done"]);
});

test("un rework passe, une unité qui chevauche sa lane attend", async () => {
  const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/a.py"])];
  const out = await runLanes([cand("W01"), cand("W02")],
    { units, integrated: new Set(), collide: scopesCollide, owners: [units[0]] }, 2,
    async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.state), ["done", "queued"]);
});

// Le propriétaire est nommé : savoir quelle lane intégrer est ce qui permet
// d'agir, « une lane non intégrée » ne le dit pas.
test("une mise en file nomme la lane qui détient le scope", async () => {
  const units = [unit("W01", ["src/a.py"]), unit("W02", ["src/a.py"])];
  const out = await runLanes([cand("W01"), cand("W02")],
    { units, integrated: new Set(), collide: scopesCollide }, 2, async (c, u) => u.id);
  assert.match(out[1].reason, /détenu par W01/);
});

test("un propriétaire sans rapport ne bloque personne", async () => {
  const units = [unit("W01", ["src/a.py"]), unit("W02", ["tests/x.py"])];
  const out = await runLanes([cand("W02")],
    { units, integrated: new Set(), collide: scopesCollide, owners: [units[0]] }, 2,
    async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.state), ["done"]);
});

// Un chemin réservé n'appartient à personne, donc il ne fait attendre personne.
test("un scope réservé ne crée aucune collision d'ownership", async () => {
  const t = tracer();
  const units = [unit("W01", ["src/a.py", "DESIGN.md"]), unit("W02", ["src/b.py", "DESIGN.md"])];
  await runLanes([cand("W01"), cand("W02")], { units, integrated: new Set(), collide: scopesCollide }, 2,
    (c, u) => t.run(c, u, 50));
  assert.ok(t.at("start", "W02") < t.at("end", "W01"), JSON.stringify(t.events));
});

test("un recouvrement par glob met en file aussi", async () => {
  const units = [unit("W01", ["src/**"]), unit("W02", ["src/a.py"])];
  const out = await runLanes([cand("W01"), cand("W02")],
    { units, integrated: new Set(), collide: scopesCollide }, 2, async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.state), ["done", "queued"]);
});

// ------------------------------------------------------------- résultats

test("chaque candidat a son résultat, refusés compris", async () => {
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"], ["W01"])];
  const out = await runLanes([cand("W01"), cand("W02"), cand("W99")],
    { units, integrated: new Set(), collide: scopesCollide }, 2, async (c, u) => u.id);
  assert.deepEqual(out.map((o) => o.workUnitId), ["W01", "W02", "W99"]);
  assert.deepEqual(out.map((o) => o.state), ["done", "refused", "refused"]);
});

// L'orchestrateur a écrit ses tâches dans un ordre ; les lui rendre mélangées
// lui demanderait de les rapparier, et il le ferait par position.
test("l'ordre rendu est celui des candidats, pas celui des fins", async () => {
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"])];
  const out = await runLanes([cand("W01"), cand("W02")], { units, integrated: new Set(), collide: scopesCollide }, 2,
    async (c, u) => {
      await sleep(u.id === "W01" ? 60 : 10);
      return u.id;
    });
  assert.deepEqual(out.map((o) => o.workUnitId), ["W01", "W02"]);
  assert.deepEqual(out.map((o) => o.value), ["W01", "W02"]);
});

test("une lane qui échoue libère sa place sans emporter les autres", async () => {
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"]), unit("W03", ["c.py"])];
  const out = await runLanes([cand("W01"), cand("W02"), cand("W03")],
    { units, integrated: new Set(), collide: scopesCollide }, 2,
    async (c, u) => {
      await sleep(20);
      if (u.id === "W01") throw new Error("la lane a explosé");
      return u.id;
    });
  assert.deepEqual(out.map((o) => o.state), ["done", "done", "done"]);
  assert.match(String((out[0].error as Error)?.message), /explosé/);
  assert.deepEqual([out[1].value, out[2].value], ["W02", "W03"]);
});

test("une seule lane fonctionne comme avant", async () => {
  const units = [unit("W01", ["a.py"])];
  const out = await runLanes([cand("W01")], { units, integrated: new Set(), collide: scopesCollide }, 2,
    async (c, u) => u.id);
  assert.deepEqual(out, [{ workUnitId: "W01", state: "done", reason: "", value: "W01" }]);
});

test("aucun candidat ne rend aucun résultat", async () => {
  assert.deepEqual(await runLanes([], { units: [], integrated: new Set(), collide: scopesCollide }, 2, async () => 1), []);
});

// ------------------------------------------------ invariants de bord

/*
 * Une configuration invalide meurt avant tout worktree et tout processus.
 *
 * La première version corrigeait `0` en `1`. C'est la réparation muette qui
 * fabrique une mesure plausible et fausse : la configuration dirait zéro, le
 * runtime exécuterait, et le relevé rapporterait une concurrence que personne
 * n'a demandée. `2` doit vouloir dire exactement deux.
 */
for (const mauvais of [0, -1, 1.5, NaN, Infinity]) {
  test(`maxParallel = ${mauvais} est refusé, rien ne démarre`, async () => {
    const units = [unit("W01", ["a.py"])];
    let starts = 0;
    await assert.rejects(
      () => runLanes([cand("W01")], { units, integrated: new Set(), collide: scopesCollide },
        mauvais, async () => { starts += 1; return 1; }),
      SchedulerInputError,
    );
    assert.equal(starts, 0);
  });
}

/*
 * Toute la machine est indexée par identifiant d'unité. Deux candidats pour la
 * même unité n'y sont pas représentables : au mieux le second écrase le
 * premier, au pire les deux deviennent actifs sous la même clé et une promesse
 * disparaît du suivi. Un lot mal formé est une erreur d'interface : rien ne
 * démarre.
 */
test("un lot contenant deux fois la même unité est rejeté avant tout démarrage", async () => {
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"])];
  let starts = 0;
  await assert.rejects(
    () => runLanes([cand("W01"), cand("W02"), cand("W01")],
      { units, integrated: new Set(), collide: scopesCollide }, 2,
      async () => { starts += 1; return 1; }),
    SchedulerInputError,
  );
  assert.equal(starts, 0);
});

/*
 * Un `start` qui jette avant de rendre sa promesse ferait rejeter `runLanes`
 * lui-même, et les autres lanes sortiraient du contrat qui promet qu'un échec
 * n'emporte pas les résultats acquis. Le callback fera du travail synchrone —
 * ouvrir un worktree, valider — donc le cas n'est pas théorique.
 */
test("un throw synchrone de start n'emporte pas les autres lanes", async () => {
  const units = [unit("W01", ["a.py"]), unit("W02", ["b.py"]), unit("W03", ["c.py"])];
  const out = await runLanes([cand("W01"), cand("W02"), cand("W03")],
    { units, integrated: new Set(), collide: scopesCollide }, 2,
    (c, u) => {
      if (u.id === "W01") throw new Error("échec synchrone à l'ouverture");
      return sleep(20).then(() => u.id);
    });
  assert.deepEqual(out.map((o) => o.state), ["done", "done", "done"]);
  assert.match(String((out[0].error as Error)?.message), /synchrone/);
  assert.deepEqual([out[1].value, out[2].value], ["W02", "W03"]);
});

/*
 * Le type porte la distinction, pas le message.
 *
 * Un appel mal formé est une faute de l'orchestrateur, qu'il peut corriger. Un
 * invariant rompu est un bug du runtime, qu'il ne doit surtout pas se voir
 * attribuer. Les reconnaître au texte de leur message créerait un protocole
 * caché qui se casse à la première reformulation — et ces messages sont écrits
 * pour être lus par un humain, pas parsés.
 */
test("les deux familles d'erreur se distinguent par leur type", async () => {
  const units = [unit("W01", ["a.py"])];
  const ctx = { units, integrated: new Set<string>(), collide: scopesCollide };

  const parMauvaiseLimite = await runLanes([cand("W01")], ctx, 2, async () => 1)
    .then(() => undefined, (e) => e);
  assert.equal(parMauvaiseLimite, undefined);

  for (const appel of [
    () => runLanes([cand("W01")], ctx, 0, async () => 1),
    () => runLanes([cand("W01"), cand("W01")], ctx, 2, async () => 1),
  ]) {
    const err = await appel().then(() => undefined, (e) => e);
    assert.ok(err instanceof SchedulerInputError, `attendu SchedulerInputError, reçu ${err}`);
    assert.ok(!(err instanceof SchedulerInvariantError));
  }
});

// Les deux classes existent séparément et ne se confondent pas : un `catch`
// qui traite l'une ne doit jamais avaler l'autre.
test("un invariant rompu n'est pas une erreur d'appel", () => {
  assert.ok(new SchedulerInvariantError("x") instanceof Error);
  assert.ok(!(new SchedulerInvariantError("x") instanceof SchedulerInputError));
  assert.ok(!(new SchedulerInputError("x") instanceof SchedulerInvariantError));
});
