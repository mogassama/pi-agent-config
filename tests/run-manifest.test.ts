/**
 * L'identité d'un run doit survivre à la session qui l'exécute.
 *
 * Le scénario que ces cas éprouvent est celui qui perdait du travail : une
 * session ouvre un run, gèle un plan, ouvre une lane, réserve une séquence, puis
 * meurt. La session suivante doit reprendre le même run — même identifiant, même
 * plan, mêmes lanes — et surtout ne jamais redistribuer une séquence déjà
 * donnée, sous peine de faire désigner deux risques différents par le même
 * identifiant.
 */
import assert from "node:assert/strict";
import { copieJetable } from "./l0-lib.ts";
import { test } from "node:test";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync,
  writeFileSync,
} from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import {
  NotOwnerError,
  RecoveryError,
  RunBusyError,
  appendIntegrationEvent,
  appendLaneEvent,
  decideUnderLease,
  integrationLedgerPath,
  readIntegrationEvents,
  laneLedgerPath,
  migrateLaneLedger,
  readLaneEvents,
  acquireRunOwnership,
  allocateSeq,
  createRunExclusive,
  describeAccess,
  inspectRun,
  attachPlan,
  heartbeatRun,
  openRun,
  startHeartbeat,
  ownsRun,
  planHash,
  readManifest,
  releaseRunOwnership,
  setStatus,
  takeOverRun,
  archivePath,
  terminerRun,
  LANE_LEDGER_V2,
  RUNS_DIR,
  integrationLedgerState,
  laneLedgerState,
  ledgerObservation,
  laneState,
  readWitnesses,
  type LedgerShape,
  type LedgerWitnesses,
  type Lease,
  type RunManifest,
} from "../subagent-only/run-manifest.ts";
import {
  integrationCommits,
  laneLedgerIncoherences,
  parseLaneEventV2,
  projectIntegrated,
  projectLegacyGenerations,
  projectReviews,
  projectRisks,
  projectViolations,
  riskKey,
  type LaneEvent,
  type LaneEventV2,
} from "../subagent-only/lane-ledger.ts";
import { observeLanes } from "../subagent-only/lane-observe.ts";
import { observeIntegrations } from "../subagent-only/integration-observe.ts";

function dossier(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-run-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const S = "s-test";
/** Prend la propriété et rend le bail : toute mutation l'exige, la lecture non. */
function own(dir: string, runId: string, session = S): Lease {
  const r = acquireRunOwnership(dir, runId, session);
  assert.equal(r.ok, true, `propriété refusée : ${JSON.stringify(r)}`);
  return (r as { lease: Lease }).lease;
}
function attachPlanOwned(dir: string, m: RunManifest, text: string) {
  return attachPlan(dir, text, own(dir, m.runId));
}
/**
 * Sérialise un manifeste TERMINAL conforme, directement sur le disque.
 *
 * Réservé aux fixtures. Depuis que la fin d'un run passe par le verbe opérateur et par
 * lui seul (C1.8), `setStatus` refuse les statuts terminaux : un test qui a besoin d'un
 * run DÉJÀ terminé le pose, il ne le fabrique pas par un chemin que la production
 * n'offre plus. Les tests qui prétendent éprouver une vraie terminaison, eux, passent par
 * `terminerRun`.
 */
function poserTerminal(
  dir: string,
  outcome: "completed" | "abandoned",
  reason?: string,
): RunManifest {
  const courant = readManifest(dir);
  assert.ok(courant, "PRÉCONDITION — poserTerminal exige un manifeste actif");
  const terminal: RunManifest = {
    ...courant,
    status: outcome,
    ended: {
      at: "2026-09-14T10:00:00.000Z",
      by: "fixture",
      outcome,
      ...(outcome === "abandoned" ? { reason: reason ?? "fixture" } : {}),
    },
  };
  writeFileSync(join(dir, "active-run.json"), `${JSON.stringify(terminal, null, 2)}\n`);
  return terminal;
}

const PLAN = JSON.stringify({
  version: 1,
  work_units: [{ id: "W03", goal: "g", depends_on: [], expected_write_scope: ["src/a.py"] }],
});

// ------------------------------------------------------------- ouverture

test("un premier run est créé et écrit sur le disque", () => {
  const { dir, done } = dossier();
  try {
    const { manifest, resumed } = openRun(dir, "abc123");
    assert.equal(resumed, false);
    assert.match(manifest.runId, /^[0-9a-f]{16}$/);
    assert.equal(manifest.status, "planning");
    assert.equal(manifest.nextSeq, 1);
    assert.equal(manifest.baseCommit, "abc123");
    assert.deepEqual(readManifest(dir), manifest);
  } finally {
    done();
  }
});

/*
 * Le cas qui a motivé tout ce sous-lot.
 *
 * Une nouvelle session n'est pas un nouveau run : sans cela elle repartirait
 * avec un autre identifiant, ne retrouverait ni son plan ni ses lanes, et
 * rouvrirait des worktrees neufs à côté de ceux qui portent le travail.
 */
test("une seconde session reprend le même run", () => {
  const { dir, done } = dossier();
  try {
    const premier = openRun(dir).manifest;
    const second = openRun(dir);
    assert.equal(second.resumed, true);
    assert.equal(second.manifest.runId, premier.runId);
  } finally {
    done();
  }
});

/*
 * La seule mutation qui ne peut pas demander de bail — il se prend sur un
 * `runId`, qui n'existe pas encore — porte donc sa propre exclusion.
 *
 * Sans elle, deux sessions démarrant ensemble sur un dépôt vierge créeraient
 * chacune un run, la seconde écraserait la première, et toutes deux prendraient
 * un bail sur deux identités différentes. Chacune se croirait propriétaire,
 * écrirait ses artefacts sous son propre préfixe et ouvrirait ses worktrees.
 */
/*
 * L'invariant, éprouvé de façon déterministe.
 *
 * La course qu'il protège tient dans deux appels système. Deux processus
 * synchronisés par une barrière ne la reproduisent qu'une fois sur quatre —
 * mesuré — donc le test de bout en bout qui suit ne prouve pas grand-chose à
 * lui seul. Le contrat de la fonction, lui, se teste en une ligne : si le
 * manifeste apparaît entre la lecture et l'écriture, on adopte celui du disque.
 */
test("créer sur un manifeste apparu entre-temps adopte celui du disque", () => {
  const { dir, done } = dossier();
  try {
    const gagnant = openRun(dir).manifest;
    const perdant: RunManifest = { version: 1, runId: "zzzzzz", status: "planning", nextSeq: 1 };

    const r = createRunExclusive(dir, perdant);
    assert.equal(r.resumed, true);
    assert.equal(r.manifest.runId, gagnant.runId);
    assert.equal(readManifest(dir)!.runId, gagnant.runId);
  } finally {
    done();
  }
});

/*
 * Le remplacement d'un run terminé doit être aussi exclusif que la création.
 *
 * La première version écrivait puis relisait pour adopter ce qu'elle trouvait,
 * ce qui ne converge que si les écritures s'entrelacent : une session qui écrit
 * puis relit avant l'autre repart sur une identité que le disque remplace
 * ensuite. `rename` tranche à la place, et il se teste sans course.
 */
test("remplacer un run terminé archive l'ancien manifeste", () => {
  const { dir, done } = dossier();
  try {
    const vieux = openRun(dir).manifest;
    poserTerminal(dir, "completed");

    const neuf = openRun(dir);
    assert.equal(neuf.resumed, false);
    assert.notEqual(neuf.manifest.runId, vieux.runId);
    assert.equal(readManifest(dir)!.runId, neuf.manifest.runId);

    // Le run précédent n'est pas perdu : la réconciliation en aura besoin.
    const archive = JSON.parse(readFileSync(join(dir, `${vieux.runId}-run.json`), "utf-8"));
    assert.equal(archive.runId, vieux.runId);
    assert.equal(archive.status, "completed");
  } finally {
    done();
  }
});

// Le perdant de l'archivage trouve un dépôt sans manifeste, ce qui est le bon
// état pour la suite : `wx` décide ensuite, et un seul run naît.
test("archiver un manifeste déjà archivé ne casse rien", () => {
  const { dir, done } = dossier();
  try {
    const vieux = openRun(dir).manifest;
    void vieux;
    poserTerminal(dir, "completed");

    const a = openRun(dir);
    // La seconde session arrive après : elle voit un run actif et le rejoint.
    const b = openRun(dir);
    assert.equal(b.manifest.runId, a.manifest.runId);
    assert.equal(b.resumed, true);
  } finally {
    done();
  }
});

test("créer sur un dépôt vierge écrit le run proposé", () => {
  const { dir, done } = dossier();
  try {
    const propose: RunManifest = { version: 1, runId: "aaaaaa", status: "planning", nextSeq: 1 };
    const r = createRunExclusive(dir, propose);
    assert.equal(r.resumed, false);
    assert.equal(readManifest(dir)!.runId, "aaaaaa");
  } finally {
    done();
  }
});

test("deux créations concurrentes rejoignent le même run", async () => {
  /*
   * Deux vrais processus, synchronisés par une barrière.
   *
   * Deux appels séquentiels ne testent rien : le second lit le manifeste du
   * premier et passe par la reprise, sans jamais atteindre le chemin de
   * création. Et deux processus lancés ensemble ne se chevauchent pas non plus
   * — le démarrage de node dure bien plus longtemps que la fenêtre entre la
   * lecture et l'écriture. Vérifié : sans `wx`, six exécutions n'ont jamais
   * produit la course.
   *
   * Chacun signale qu'il est prêt puis attend l'autre, ce qui ramène l'écart à
   * quelques microsecondes. Même ainsi la course ne se produit qu'une fois sur
   * quatre : ce cas vérifie que le mécanisme tient en conditions réelles, il ne
   * remplace pas le test déterministe ci-dessus.
   */
  const script =
    `const { openRun } = await import(${JSON.stringify(
      join(import.meta.dirname, "..", "subagent-only", "run-manifest.ts"),
    )});` +
    `const fs = await import("node:fs");` +
    `const [dir, moi, autre] = process.argv.slice(1);` +
    `fs.writeFileSync(moi, "prêt");` +
    `while (!fs.existsSync(autre)) {}` +
    `const r = openRun(dir);` +
    `console.log(JSON.stringify({ runId: r.manifest.runId, resumed: r.resumed }));`;

  const course = async (dir: string, barriere: string) => {
    const lance = (moi: string, autre: string) =>
      new Promise<{ runId: string; resumed: boolean }>((res, rej) => {
        execFile(
          process.execPath,
          ["--experimental-strip-types", "--input-type=module", "-e", script,
            dir, join(barriere, moi), join(barriere, autre)],
          (err, stdout) => (err ? rej(err) : res(JSON.parse(stdout.trim()))),
        );
      });
    return Promise.all([lance("a", "b"), lance("b", "a")]);
  };

  // Plusieurs tours : une course perdue une fois ne prouve rien.
  for (let tour = 0; tour < 4; tour += 1) {
    const { dir, done } = dossier();
    const barriere = mkdtempSync(join(tmpdir(), "pi-barriere-"));
    try {
      const [a, b] = await course(dir, barriere);
      assert.equal(a.runId, b.runId, `tour ${tour} : deux runs créés, ${a.runId} et ${b.runId}`);
      assert.equal(readManifest(dir)!.runId, a.runId);
      assert.notEqual(a.resumed, b.resumed, `tour ${tour} : les deux ont créé ou les deux ont repris`);
    } finally {
      rmSync(barriere, { recursive: true, force: true });
      done();
    }
  }
});

test("une création n'écrase jamais un manifeste existant", () => {
  const { dir, done } = dossier();
  try {
    const un = openRun(dir).manifest;
    poserTerminal(dir, "completed");

    // Terminé : le suivant est un autre run, et il s'écrit une seule fois.
    const deux = openRun(dir);
    assert.equal(deux.resumed, false);
    assert.notEqual(deux.manifest.runId, un.runId);
    assert.equal(readManifest(dir)!.runId, deux.manifest.runId);
  } finally {
    done();
  }
});

test("un run terminé n'est pas repris : le suivant en est un autre", () => {
  const { dir, done } = dossier();
  try {
    const premier = openRun(dir).manifest;
    poserTerminal(dir, "completed");
    const second = openRun(dir);
    assert.equal(second.resumed, false);
    assert.notEqual(second.manifest.runId, premier.runId);
  } finally {
    done();
  }
});

test("un run abandonné n'est pas repris non plus", () => {
  const { dir, done } = dossier();
  try {
    const premier = openRun(dir).manifest;
    void premier;
    poserTerminal(dir, "abandoned", "fixture abandonnée");
    assert.equal(openRun(dir).resumed, false);
  } finally {
    done();
  }
});

// ------------------------------------------------------------- le plan

test("attacher un plan rend le run actif et retient son empreinte", () => {
  const { dir, done } = dossier();
  try {
    const m = attachPlanOwned(dir, openRun(dir).manifest, PLAN);
    assert.equal(m.status, "active");
    assert.equal(m.plan, `${m.runId}-plan.json`);
    assert.equal(m.planHash, planHash(PLAN));
    assert.deepEqual(readManifest(dir), m);
  } finally {
    done();
  }
});

test("réattacher le même plan ne change rien", () => {
  const { dir, done } = dossier();
  try {
    const un = attachPlanOwned(dir, openRun(dir).manifest, PLAN);
    assert.deepEqual(attachPlan(dir, PLAN, bailDe(dir, un.runId)), un);
  } finally {
    done();
  }
});

/*
 * Le plan est gelé. S'il a changé sous un run qui l'exécute, les lanes ouvertes
 * et les mesures déjà prises portent sur autre chose : on refuse plutôt que de
 * continuer sur un plan qu'on n'a pas commencé.
 */
test("un plan qui a changé sous le run est une erreur de reprise", () => {
  const { dir, done } = dossier();
  try {
    const m = attachPlanOwned(dir, openRun(dir).manifest, PLAN);
    assert.throws(() => attachPlan(dir, `${PLAN} `, bailDe(dir, m.runId)), RecoveryError);
  } finally {
    done();
  }
});

// --------------------------------------------------------- les séquences

test("les séquences sont distribuées une seule fois", () => {
  const { dir, done } = dossier();
  try {
    let m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    const vues: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const a = allocateSeq(dir, bail);
      vues.push(a.seq);
      m = a.manifest;
    }
    assert.deepEqual(vues, [1, 2, 3, 4, 5]);
    assert.equal(readManifest(dir)?.nextSeq, 6);
  } finally {
    done();
  }
});

/*
 * Le cœur du problème que Sol a soulevé : persister le runId sans l'espace de
 * séquence ferait porter le même identifiant à deux artefacts et à deux risques.
 * `4e9499-04-1` doit désigner un seul risque, pour toujours.
 */
test("après un redémarrage, aucune séquence n'est redistribuée", () => {
  const { dir, done } = dossier();
  try {
    let m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    for (let i = 0; i < 7; i += 1) m = allocateSeq(dir, bail).manifest;

    // La session meurt ici. La suivante ne connaît que le disque.
    const reprise = openRun(dir);
    assert.equal(reprise.resumed, true);
    const { seq } = allocateSeq(dir, bailDe(dir, reprise.manifest.runId));
    assert.equal(seq, 8);
  } finally {
    done();
  }
});

// Un trou ne coûte rien, une réutilisation coûte la provenance : la réservation
// a lieu avant la délégation, donc une mort entre les deux laisse un numéro
// perdu et c'est le comportement voulu.
test("un numéro réservé et jamais utilisé n'est pas repris", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    const perdu = allocateSeq(dir, bail).seq;
    const suivant = allocateSeq(dir, bail).seq;
    assert.equal(suivant, perdu + 1);
  } finally {
    done();
  }
});

// Le disque fait autorité : un manifeste en mémoire plus ancien que le disque ne
// doit pas redistribuer ce que le disque a déjà donné.
test("un manifeste périmé en mémoire ne redistribue rien", () => {
  const { dir, done } = dossier();
  try {
    const vieux = openRun(dir).manifest;
    const bail = own(dir, vieux.runId);
    allocateSeq(dir, bail);
    allocateSeq(dir, bail);
    assert.equal(allocateSeq(dir, bail).seq, 3);
  } finally {
    done();
  }
});

// ------------------------------------------------------- manifeste abîmé

/*
 * Aucune réparation silencieuse. Un manifeste illisible sous un dépôt qui porte
 * des worktrees serait le pire moment pour repartir à zéro : la session
 * créerait un nouveau run et abandonnerait le travail en place.
 */
test("un manifeste illisible est une erreur de reprise", () => {
  const { dir, done } = dossier();
  try {
    openRun(dir);
    writeFileSync(join(dir, "active-run.json"), "{ ceci n'est pas du JSON");
    assert.throws(() => readManifest(dir), RecoveryError);
    assert.throws(() => openRun(dir), RecoveryError);
  } finally {
    done();
  }
});

test("un manifeste sans run exploitable est une erreur de reprise", () => {
  const { dir, done } = dossier();
  try {
    openRun(dir);
    writeFileSync(join(dir, "active-run.json"), JSON.stringify({ version: 1, nextSeq: 3 }));
    assert.throws(() => readManifest(dir), RecoveryError);
  } finally {
    done();
  }
});

test("un nextSeq invalide est une erreur de reprise", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    writeFileSync(
      join(dir, "active-run.json"),
      `${JSON.stringify({ ...m, nextSeq: 0 }, null, 2)}\n`,
    );
    assert.throws(() => readManifest(dir), RecoveryError);
  } finally {
    done();
  }
});



test("un statut de manifeste inconnu est une erreur de reprise, jamais un run fini", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    writeFileSync(
      join(dir, "active-run.json"),
      `${JSON.stringify({ ...m, status: "mystere" }, null, 2)}\n`,
    );
    assert.throws(() => openRun(dir), RecoveryError);
    assert.equal(
      existsSync(join(dir, `${m.runId}-run.json`)),
      false,
      "un statut invalide ne doit pas archiver silencieusement le run",
    );
  } finally {
    done();
  }
});

test("un manifeste absent n'est pas une erreur", () => {
  const { dir, done } = dossier();
  try {
    assert.equal(readManifest(dir), undefined);
  } finally {
    done();
  }
});

// -------------------------------------------------------------- le bail

test("un run libre s'attache à la session qui veut le muter", () => {
  const { dir, done } = dossier();
  try {
    const r = acquireRunOwnership(dir, "4e9499", "s-A");
    assert.equal(r.ok, true);
    assert.equal(r.ok === true ? r.taken : "", "acquired");
    assert.equal(ownsRun(dir, (r as { lease: Lease }).lease), true);
    assert.equal(ownsRun(dir, { ...(r as { lease: Lease }).lease, sessionId: "s-B" }), false);
  } finally {
    done();
  }
});

test("la même session redemande sans conflit", () => {
  const { dir, done } = dossier();
  try {
    acquireRunOwnership(dir, "4e9499", "s-A");
    const r = acquireRunOwnership(dir, "4e9499", "s-A");
    assert.equal(r.ok === true ? r.taken : "", "already-mine");
  } finally {
    done();
  }
});

/*
 * L'invariant que ce sous-lot existe pour poser : lire est libre, muter ne
 * l'est pas. Deux sessions peuvent examiner le même run ; une seule peut
 * réserver le prochain numéro, sous peine de faire porter le même identifiant à
 * deux artefacts et à deux risques.
 */
test("deux sessions lisent le même run, une seule réserve", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;

    // Les deux lisent, sans rien posséder.
    assert.deepEqual(readManifest(dir), m);
    assert.equal(openRun(dir).manifest.runId, m.runId);

    const bailA = own(dir, m.runId, "s-A");
    const refus = acquireRunOwnership(dir, m.runId, "s-B");
    assert.equal(refus.ok, false);

    const a = allocateSeq(dir, bailA);
    assert.equal(a.seq, 1);
    assert.throws(() => allocateSeq(dir, { ...bailA, sessionId: "s-B" }), NotOwnerError);

    // Et B lit toujours ce que A a écrit.
    assert.equal(readManifest(dir)?.nextSeq, 2);
  } finally {
    done();
  }
});

test("geler le plan et changer le statut demandent aussi la propriété", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bailA = own(dir, m.runId, "s-A");
    const usurpe = { ...bailA, sessionId: "s-B" };
    assert.throws(() => attachPlan(dir, PLAN, usurpe), NotOwnerError);
    /*
     * « active » et non « completed » : cette preuve porte sur la PROPRIÉTÉ. Depuis que
     * le setter refuse les statuts terminaux, un `completed` serait refusé par la garde
     * de C1.8 et la preuve serait verte par une autre porte que celle qu'elle vise.
     */
    assert.throws(() => setStatus(dir, "active", usurpe), NotOwnerError);
  } finally {
    done();
  }
});

test("un bail tenu par une session vivante est refusé, pas repris", () => {
  const { dir, done } = dossier();
  try {
    acquireRunOwnership(dir, "4e9499", "s-A");
    const r = acquireRunOwnership(dir, "4e9499", "s-B");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false ? r.kind : "", "held");
  } finally {
    done();
  }
});

/*
 * Un bail périmé n'est pas un bail libre : on a perdu la preuve que le
 * propriétaire précédent est sorti proprement. La reprise passe par une
 * réconciliation, jamais par un remplacement muet.
 */
test("un bail périmé demande une reprise, il ne se remplace pas seul", () => {
  const { dir, done } = dossier();
  try {
    poseBail(dir, "4e9499", { sessionId: "s-morte", leaseId: "l-vieux" },
      new Date(Date.now() - 600_000).toISOString());

    const r = acquireRunOwnership(dir, "4e9499", "s-B");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false ? r.kind : "", "recovery-required");
    // La reprise est explicite, une fois la réconciliation faite.
    const repris = takeOverRun(dir, "4e9499", "s-B");
    assert.equal(ownsRun(dir, repris), true);
  } finally {
    done();
  }
});

test("un bail illisible demande une reprise, pas un écrasement", () => {
  const { dir, done } = dossier();
  try {
    mkdirSync(join(dir, "4e9499.lease"), { recursive: true });
    writeFileSync(join(dir, "4e9499.lease", "owner.json"), "pas du json");
    const r = acquireRunOwnership(dir, "4e9499", "s-B");
    assert.equal(r.ok === false ? r.kind : "", "recovery-required");
  } finally {
    done();
  }
});

// Un PID se réutilise : un battement trop vieux périme le bail même si le
// numéro répond encore.
test("un battement trop vieux périme le bail malgré un PID vivant", () => {
  const { dir, done } = dossier();
  try {
    poseBail(dir, "4e9499", { sessionId: "s-morte", leaseId: "l-1", pid: 1 },
      "2020-01-01T00:00:00.000Z");
    const r = acquireRunOwnership(dir, "4e9499", "s-B");
    assert.equal(r.ok === false ? r.kind : "", "recovery-required");
  } finally {
    done();
  }
});

// Mieux vaut refuser un run libre que prendre un run qui tourne.
test("un bail récent posé ailleurs est considéré vivant", () => {
  const { dir, done } = dossier();
  try {
    poseBail(dir, "4e9499", { sessionId: "s-ailleurs", leaseId: "l-2", pid: 999_999,
      host: "une-autre-machine" }, new Date().toISOString());
    const r = acquireRunOwnership(dir, "4e9499", "s-B");
    assert.equal(r.ok === false ? r.kind : "", "held");
  } finally {
    done();
  }
});

const bailDe = (dir: string, runId: string): Lease =>
  JSON.parse(readFileSync(join(dir, `${runId}.lease`, "owner.json"), "utf-8"));

/** Pose un bail brut, comme le ferait une session dont on simule l'état. */
function poseBail(dir: string, runId: string, owner: Partial<Lease>, battement?: string) {
  const complet: Lease = {
    version: 1, runId, sessionId: "s-x", leaseId: "l-x", pid: process.pid,
    host: hostname(), acquiredAt: new Date().toISOString(), ...owner,
  };
  mkdirSync(join(dir, `${runId}.lease`), { recursive: true });
  writeFileSync(join(dir, `${runId}.lease`, "owner.json"), JSON.stringify(complet));
  if (battement !== undefined) {
    writeFileSync(join(dir, `${runId}.lease`, `hb-${complet.leaseId}`), battement);
  }
  return complet;
}

test("le battement repousse la péremption", () => {
  const { dir, done } = dossier();
  try {
    const r = acquireRunOwnership(dir, "4e9499", "s-A");
    const bail = r.ok === true ? r.lease : undefined;
    const battementDe = () =>
      readFileSync(join(dir, "4e9499.lease", `hb-${bail!.leaseId}`), "utf-8").trim();
    const avant = battementDe();
    assert.equal(heartbeatRun(dir, bail!), true);
    assert.ok(Date.parse(battementDe()) >= Date.parse(avant));
  } finally {
    done();
  }
});

test("une session ne relâche pas le bail d'une autre", () => {
  const { dir, done } = dossier();
  try {
    const a = acquireRunOwnership(dir, "4e9499", "s-A");
    const bailA = a.ok === true ? a.lease : undefined;
    assert.equal(releaseRunOwnership(dir, { ...bailA!, sessionId: "s-B" }), false);
    assert.equal(ownsRun(dir, bailA!), true);
    assert.equal(releaseRunOwnership(dir, bailA!), true);
    assert.equal(existsSync(join(dir, "4e9499.lease")), false);
  } finally {
    done();
  }
});

/*
 * La protection ABA, et c'est le cas le moins évident.
 *
 * Une même session peut libérer un run puis le reprendre. Un battement retardé
 * de l'ancienne acquisition ne doit pas modifier le nouveau bail au seul motif
 * que le `sessionId` correspond — ni, pire, celui d'une session qui aurait
 * repris entre-temps.
 */
test("un battement d'une acquisition périmée ne touche pas le bail courant", () => {
  const { dir, done } = dossier();
  try {
    const un = acquireRunOwnership(dir, "4e9499", "s-A");
    const ancien = un.ok === true ? un.lease : undefined;
    releaseRunOwnership(dir, ancien!);

    const deux = acquireRunOwnership(dir, "4e9499", "s-A");
    const nouveau = deux.ok === true ? deux.lease : undefined;
    assert.notEqual(nouveau!.leaseId, ancien!.leaseId);

    assert.equal(heartbeatRun(dir, ancien!), false);
    assert.equal(bailDe(dir, "4e9499").leaseId, nouveau!.leaseId);
    assert.equal(releaseRunOwnership(dir, ancien!), false);
    assert.equal(existsSync(join(dir, "4e9499.lease")), true);
  } finally {
    done();
  }
});

test("un battement ne ressuscite pas une propriété reprise par une autre session", () => {
  const { dir, done } = dossier();
  try {
    const bailA = poseBail(dir, "4e9499", { sessionId: "s-A", leaseId: "l-A" },
      new Date(Date.now() - 600_000).toISOString());
    const bailB = takeOverRun(dir, "4e9499", "s-B");

    assert.equal(heartbeatRun(dir, bailA!), false);
    assert.equal(ownsRun(dir, bailB), true);
  } finally {
    done();
  }
});

/*
 * La même classe ABA que le battement, déplacée vers les mutations.
 *
 * « Je suis cette session » ne suffit pas : une opération asynchrone
 * appartenant à une acquisition libérée peut se réveiller après que la même
 * session a repris le run, et muter sous un bail qui n'est pas le sien. Ce que
 * l'appelant doit prouver n'est pas son identité mais sa capacité.
 */
test("une mutation présentant un bail périmé de la même session est refusée", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const ancien = own(dir, m.runId, "s-A");
    releaseRunOwnership(dir, ancien);
    const nouveau = own(dir, m.runId, "s-A");
    assert.notEqual(nouveau.leaseId, ancien.leaseId);

    assert.throws(() => allocateSeq(dir, ancien), NotOwnerError);
    assert.throws(() => attachPlan(dir, PLAN, ancien), NotOwnerError);
    // « active » : cette preuve porte sur la propriété, pas sur la terminalité.
    assert.throws(() => setStatus(dir, "active", ancien), NotOwnerError);

    // Le bail courant, lui, passe.
    assert.equal(allocateSeq(dir, nouveau).seq, 1);
  } finally {
    done();
  }
});

// Le battement est attaché à la propriété, pas aux délégations : le bail reste
// vivant même quand aucun appel ne se termine.
test("le battement périodique tient le bail sans aucune délégation", async () => {
  const { dir, done } = dossier();
  try {
    const r = acquireRunOwnership(dir, "4e9499", "s-A");
    const bail = r.ok === true ? r.lease : undefined;
    const hb = () => readFileSync(join(dir, "4e9499.lease", `hb-${bail!.leaseId}`), "utf-8").trim();
    const avant = hb();
    await new Promise((res) => setTimeout(res, 10));

    const battement = startHeartbeat(dir, bail!, undefined, 5);
    await new Promise((res) => setTimeout(res, 40));
    battement.stop();

    assert.ok(Date.parse(hb()) > Date.parse(avant));
  } finally {
    done();
  }
});

// Perdre la propriété arrête le battement et le dit : la session ne peut plus
// muter, et les gardes de mutation le confirment de toute façon.
test("un battement qui perd la propriété s'arrête et prévient", async () => {
  const { dir, done } = dossier();
  try {
    const r = acquireRunOwnership(dir, "4e9499", "s-A");
    const bail = r.ok === true ? r.lease : undefined;
    let perdu: string | undefined;
    const battement = startHeartbeat(dir, bail!, (runId) => { perdu = runId; }, 5);

    // Le propriétaire disparaît : c'est ce que le battement doit détecter.
    rmSync(join(dir, "4e9499.lease"), { recursive: true, force: true });
    await new Promise((res) => setTimeout(res, 40));
    battement.stop();

    assert.equal(perdu, "4e9499");
  } finally {
    done();
  }
});

// ------------------------------------------------- la séquence complète

test("session A meurt, session B reprend tout", () => {
  const { dir, done } = dossier();
  try {
    // Session A : ouvre, gèle son plan, réserve sept numéros.
    const a = openRun(dir, "base123");
    let m = attachPlanOwned(dir, a.manifest, PLAN);
    const bail = bailDe(dir, m.runId);
    for (let i = 0; i < 7; i += 1) m = allocateSeq(dir, bail).manifest;
    const laneA = `${m.runId}-W03`;

    // Elle meurt sans relâcher son verrou. Session B ne connaît que le disque.
    const b = openRun(dir);
    assert.equal(b.resumed, true);
    assert.equal(b.manifest.runId, m.runId, "le run doit être le même");
    assert.equal(b.manifest.planHash, planHash(PLAN), "le plan doit être le même");
    assert.equal(b.manifest.baseCommit, "base123");
    assert.equal(allocateSeq(dir, bailDe(dir, b.manifest.runId)).seq, 8,
      "aucune séquence redistribuée");
    assert.equal(`${b.manifest.runId}-W03`, laneA, "la lane doit porter le même nom");

    /*
     * Le bail laissé par A est encore frais : du point de vue du disque, A
     * pourrait tout aussi bien être vivante. Un crash est indiscernable d'un
     * propriétaire actif tant que le bail n'a pas vieilli, et c'est exactement
     * ce que le seuil de péremption existe pour trancher — pas une devinette.
     */
    const tropTot = acquireRunOwnership(dir, b.manifest.runId, "s-B");
    assert.equal(tropTot.ok === false ? tropTot.kind : "", "held");

    // Une fois le bail périmé, B ne le reprend toujours pas toute seule.
    writeFileSync(
      join(dir, `${b.manifest.runId}.lease`, `hb-${bail.leaseId}`),
      new Date(Date.now() - 600_000).toISOString(),
    );
    const apres = acquireRunOwnership(dir, b.manifest.runId, "s-B");
    assert.equal(apres.ok === false ? apres.kind : "", "recovery-required");

    // La reprise est explicite, et elle continue la numérotation.
    const bailB = takeOverRun(dir, b.manifest.runId, "s-B");
    assert.equal(allocateSeq(dir, bailB).seq, 9);
  } finally {
    done();
  }
});

// -------------------------------------------- l'état vu par la session

/*
 * Observer un propriétaire n'est pas devenir propriétaire.
 *
 * Le chargement de l'extension lit cet état pour l'afficher : une session qui
 * découvre un dépôt occupé doit le savoir tout de suite, sans avoir à provoquer
 * un échec de délégation pour l'apprendre.
 */
test("inspecter ne prend rien", () => {
  const { dir, done } = dossier();
  try {
    assert.deepEqual(inspectRun(dir, "4e9499", "s-A"), { kind: "free" });
    assert.equal(existsSync(join(dir, "4e9499.lease")), false);
  } finally {
    done();
  }
});

test("les quatre états se distinguent", () => {
  const { dir, done } = dossier();
  try {
    assert.equal(inspectRun(dir, "4e9499", "s-A").kind, "free");

    acquireRunOwnership(dir, "4e9499", "s-A");
    assert.equal(inspectRun(dir, "4e9499", "s-A").kind, "owned");
    assert.equal(inspectRun(dir, "4e9499", "s-B").kind, "owned-by-other");

    mkdirSync(join(dir, "4e9499.lease"), { recursive: true });
    writeFileSync(join(dir, "4e9499.lease", "owner.json"), "illisible");
    assert.equal(inspectRun(dir, "4e9499", "s-B").kind, "recovery-required");
  } finally {
    done();
  }
});

// Le refus doit dire qui tient le run et que rien n'a été consommé.
test("le refus nomme le propriétaire et ce qui n'a pas eu lieu", () => {
  const { dir, done } = dossier();
  try {
    acquireRunOwnership(dir, "4e9499", "s-A");
    const texte = describeAccess(inspectRun(dir, "4e9499", "s-B"), "4e9499");
    assert.match(texte, /LECTURE SEULE/);
    assert.match(texte, /s-A/);
    assert.match(texte, /aucune séquence réservée/);
  } finally {
    done();
  }
});

test("une reprise requise dit qu'elle n'est pas automatique", () => {
  const { dir, done } = dossier();
  try {
    mkdirSync(join(dir, "4e9499.lease"), { recursive: true });
    writeFileSync(join(dir, "4e9499.lease", "owner.json"), "illisible");
    const texte = describeAccess(inspectRun(dir, "4e9499", "s-B"), "4e9499");
    assert.match(texte, /REPRISE REQUISE/);
    assert.match(texte, /rien n'est repris automatiquement/);
  } finally {
    done();
  }
});

/*
 * Les quatre propriétés du câblage, éprouvées là où elles sont éprouvables.
 *
 * L'absence d'artefact et de lane suit du fait que le refus précède le
 * dispatch ; ce qui se teste ici est la partie durable : la séquence n'avance
 * pas, la lecture reste possible, et une libération propre rend le même run.
 */
test("une session qui ne possède pas ne fait pas avancer la séquence", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bailA = own(dir, m.runId, "s-A");
    const avant = readManifest(dir)!.nextSeq;

    assert.equal(acquireRunOwnership(dir, m.runId, "s-B").ok, false);
    assert.throws(() => allocateSeq(dir, { ...bailA, sessionId: "s-B" }), NotOwnerError);
    assert.equal(readManifest(dir)!.nextSeq, avant);

    // Et elle lit toujours.
    assert.equal(readManifest(dir)!.runId, m.runId);
  } finally {
    done();
  }
});

// Le bail ne définit pas la durée de vie du run : une session peut se retirer
// proprement d'un run qui reste actif, et la suivante le reprend tel quel.
test("une libération propre laisse le run actif pour la session suivante", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bailA = own(dir, m.runId, "s-A");
    const a = allocateSeq(dir, bailA);
    releaseRunOwnership(dir, bailA);

    const reprise = openRun(dir);
    assert.equal(reprise.resumed, true);
    assert.equal(reprise.manifest.runId, m.runId);
    const bailB = own(dir, m.runId, "s-B");
    assert.equal(allocateSeq(dir, bailB).seq, a.seq + 1);
  } finally {
    done();
  }
});

// ------------------------------------------------ le cycle d'une session

/*
 * Le cycle complet que `session_shutdown` doit produire.
 *
 * Le bail ne définit pas la durée de vie du run : une session qui se retire
 * proprement laisse un run toujours actif, que la suivante reprend sans passer
 * par une réconciliation qu'aucun incident ne justifie. Et la numérotation
 * continue — c'est elle qui garantit qu'aucun identifiant de risque ne sera
 * porté deux fois.
 */
test("une session se retire proprement, la suivante reprend sans réconciliation", () => {
  const { dir, done } = dossier();
  try {
    // Session A : découvre, ne possède rien.
    const a = openRun(dir, "base");
    assert.equal(inspectRun(dir, a.manifest.runId, "s-A").kind, "free");

    // Première mutation : elle prend le bail et bat.
    const bailA = own(dir, a.manifest.runId, "s-A");
    const battement = startHeartbeat(dir, bailA, undefined, 5);
    let m = attachPlan(dir, PLAN, bailA);
    m = allocateSeq(dir, bailA).manifest;
    assert.equal(inspectRun(dir, a.manifest.runId, "s-A").kind, "owned");

    // session_shutdown : arrêt du battement, libération, run inchangé.
    battement.stop();
    releaseRunOwnership(dir, bailA);
    assert.equal(readManifest(dir)!.status, "active");
    assert.equal(inspectRun(dir, a.manifest.runId, "s-B").kind, "free");

    // Session B : même run, aucune reprise à faire, numérotation continue.
    const b = openRun(dir);
    assert.equal(b.resumed, true);
    assert.equal(b.manifest.runId, a.manifest.runId);
    assert.equal(b.manifest.planHash, planHash(PLAN));
    const bailB = own(dir, b.manifest.runId, "s-B");
    assert.equal(allocateSeq(dir, bailB).seq, m.nextSeq);
  } finally {
    done();
  }
});

// Le pendant : sans sortie propre, le bail survit et devient périmé. C'est le
// comportement prévu — la réconciliation existe pour les sorties non propres.
test("sans sortie propre, la session suivante doit réconcilier", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bailA = own(dir, m.runId, "s-A");

    // A disparaît sans relâcher. Son battement vieillit.
    writeFileSync(
      join(dir, `${m.runId}.lease`, `hb-${bailA.leaseId}`),
      new Date(Date.now() - 600_000).toISOString(),
    );

    assert.equal(inspectRun(dir, m.runId, "s-B").kind, "recovery-required");
    assert.equal(acquireRunOwnership(dir, m.runId, "s-B").ok, false);
  } finally {
    done();
  }
});

// ----------------------------------------- atomicité de l'acquisition

/*
 * `mkdir` est l'arbitre, et il se teste sans course.
 *
 * La première version faisait « regarder puis écrire » : deux sessions
 * pouvaient toutes deux observer un run libre puis écrire chacune son bail.
 * Mesuré : trois fois sur quarante courses synchronisées, les deux se
 * croyaient propriétaires. Un remplacement atomique ne donne pas l'exclusion.
 */
test("acquérir un bail déjà pris n'écrase rien", () => {
  const { dir, done } = dossier();
  try {
    const a = acquireRunOwnership(dir, "4e9499", "s-A");
    const bailA = (a as { lease: Lease }).lease;

    const b = acquireRunOwnership(dir, "4e9499", "s-B");
    assert.equal(b.ok, false);
    assert.equal(bailDe(dir, "4e9499").leaseId, bailA.leaseId);
    assert.equal(ownsRun(dir, bailA), true);
  } finally {
    done();
  }
});

/*
 * La course TOCTOU entre battement et reprise.
 *
 * Le `leaseId` réglait « B prend L2, puis A se réveille », mais pas « A vérifie
 * L1, B prend L2, A agit après sa vérification ». Mesuré par Sol : une fois sur
 * cinquante, l'ancien propriétaire ressuscitait son bail après une reprise
 * réussie.
 *
 * La séparation supprime la fenêtre plutôt que de la réduire : un battement
 * n'écrit que le fichier portant son propre `leaseId`, et la vivacité se lit
 * dans celui du propriétaire courant. Le battement de L1 écrit donc dans un
 * fichier que plus personne ne lit.
 */
test("un battement retardé ne ressuscite pas un bail repris", () => {
  const { dir, done } = dossier();
  try {
    const bailA = poseBail(dir, "4e9499", { sessionId: "s-A", leaseId: "l-A" },
      new Date(Date.now() - 600_000).toISOString());
    const bailB = takeOverRun(dir, "4e9499", "s-B");

    // A bat après la reprise, comme si sa vérification avait précédé.
    heartbeatRun(dir, bailA);

    assert.equal(bailDe(dir, "4e9499").leaseId, bailB.leaseId);
    assert.equal(ownsRun(dir, bailB), true);
    assert.equal(ownsRun(dir, bailA), false);
    assert.equal(inspectRun(dir, "4e9499", "s-B").kind, "owned");
  } finally {
    done();
  }
});

// Un état illisible n'est pas libérable : la première version le supprimait,
// ce qui laissait une ancienne capacité effacer un bail que tout le reste
// classait « reprise requise ».
test("une ancienne capacité ne libère pas un bail illisible", () => {
  const { dir, done } = dossier();
  try {
    const bailA = poseBail(dir, "4e9499", { sessionId: "s-A", leaseId: "l-A" });
    writeFileSync(join(dir, "4e9499.lease", "owner.json"), "illisible");

    assert.equal(releaseRunOwnership(dir, bailA), false);
    assert.equal(existsSync(join(dir, "4e9499.lease")), true);
    assert.equal(inspectRun(dir, "4e9499", "s-B").kind, "recovery-required");
  } finally {
    done();
  }
});

// La reprise n'est pas un écrasement déguisé : elle refuse tant que l'état ne
// la justifie pas.
test("reprendre un bail vivant est refusé", () => {
  const { dir, done } = dossier();
  try {
    acquireRunOwnership(dir, "4e9499", "s-A");
    assert.throws(() => takeOverRun(dir, "4e9499", "s-B"), NotOwnerError);
    assert.equal(bailDe(dir, "4e9499").sessionId, "s-A");
  } finally {
    done();
  }
});

test("reprendre un run libre est refusé aussi", () => {
  const { dir, done } = dossier();
  try {
    assert.throws(() => takeOverRun(dir, "4e9499", "s-B"), NotOwnerError);
  } finally {
    done();
  }
});

// --------------------------------- le manifeste ne régresse jamais

/*
 * Le défaut le plus insidieux du lot.
 *
 * `{ ...manifest, champ }` reconstruisait tous les autres champs depuis la
 * copie mémoire de l'appelant. Une mutation sous un manifeste périmé remettait
 * donc le statut à `planning` et effaçait le plan gelé — seule la séquence
 * était protégée, parce qu'elle relisait le disque.
 */
test("muter sous un manifeste périmé ne détruit ni le statut ni le plan", () => {
  const { dir, done } = dossier();
  try {
    const vieuxA = openRun(dir).manifest;
    assert.equal(vieuxA.status, "planning");

    // B fait avancer le run pendant que A garde sa copie.
    const bailB = own(dir, vieuxA.runId, "s-B");
    attachPlan(dir, PLAN, bailB);
    allocateSeq(dir, bailB);
    releaseRunOwnership(dir, bailB);

    // A reprend et mute avec sa vieille copie en main.
    const bailA = own(dir, vieuxA.runId, "s-A");
    allocateSeq(dir, bailA);

    const surLeDisque = readManifest(dir)!;
    assert.equal(surLeDisque.status, "active", "le statut ne doit pas régresser");
    assert.equal(surLeDisque.planHash, planHash(PLAN), "le plan gelé ne doit pas disparaître");
    assert.equal(surLeDisque.nextSeq, 3);
  } finally {
    done();
  }
});

test("muter alors que le manifeste a disparu est une erreur de reprise", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    rmSync(join(dir, "active-run.json"));
    assert.throws(() => allocateSeq(dir, bail), RecoveryError);
  } finally {
    done();
  }
});

// Une capacité portant un autre run ne mute pas celui-ci.
test("une capacité d'un autre run est refusée", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    const autre = poseBail(dir, "autre1", { sessionId: S, leaseId: bail.leaseId });
    assert.throws(() => allocateSeq(dir, autre), RecoveryError);
  } finally {
    done();
  }
});

// --------------------------------------- la clôture des transitions

/*
 * Vérifier qu'on possède le run et empêcher qu'on nous le reprenne d'ici la fin
 * de l'écriture sont deux choses différentes. `mkdir` donnait la première ;
 * c'est la seconde dont 3b.1 a besoin.
 *
 * Les deux courses avaient la même racine :
 *
 *     A relâche L1 : vérifie qu'il possède     → vrai
 *     B reprend    : retire L1, installe L2
 *     A relâche L1 : supprime le répertoire    → efface L2
 *
 * et la même sur les mutations : `assertOwner` passait, la reprise s'intercalait,
 * l'écriture avait lieu sous une capacité perdue.
 *
 * On ne peut pas reproduire l'entrelacement dans un seul fil, mais on peut
 * vérifier ce que la clôture garantit : sous le verrou, une transition ne
 * s'exécute pas.
 */
test("une transition inachevée bloque les autres plutôt que de les laisser passer", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);

    // Un verrou laissé par une transition morte, plus vieux que le seuil.
    mkdirSync(join(dir, `${m.runId}.guard`), { recursive: true });
    const vieux = Date.now() - 60_000;
    utimesSync(join(dir, `${m.runId}.guard`), vieux / 1000, vieux / 1000);

    // Aucune transition ne passe, et aucune ne force.
    assert.throws(() => allocateSeq(dir, bail), RecoveryError);
    assert.throws(() => releaseRunOwnership(dir, bail), RecoveryError);
    assert.throws(() => takeOverRun(dir, m.runId, "s-B"), RecoveryError);
    assert.equal(readManifest(dir)!.nextSeq, 1, "rien n'a été réservé");
    assert.equal(ownsRun(dir, bail), true, "le bail n'a pas été effacé");
  } finally {
    done();
  }
});

// Le verrou ne survit pas à la transition : il est retiré même si elle échoue,
// sinon le premier refus rendrait le run définitivement inutilisable.
/*
 * Occupé n'est pas cassé.
 *
 * Un verrou frais tenu par une transition en cours demande de réessayer ; un
 * verrou périmé demande une réconciliation. Les deux notions étaient confondues,
 * et pi restait bloqué cinq secondes sur une contention normale — synchrone,
 * donc bloqué pour de bon, et sans rien afficher.
 */
test("un verrou frais rend la main en une demi-seconde, pas en cinq", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    mkdirSync(join(dir, `${m.runId}.guard`), { recursive: true });

    const debut = Date.now();
    assert.throws(() => allocateSeq(dir, bail), RunBusyError);
    const attendu = Date.now() - debut;
    assert.ok(attendu >= 400, `a rendu la main trop vite : ${attendu} ms`);
    assert.ok(attendu < 2000, `a attendu trop longtemps : ${attendu} ms`);
  } finally {
    done();
  }
});

test("un run occupé n'est pas un run à réconcilier", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    mkdirSync(join(dir, `${m.runId}.guard`), { recursive: true });
    let err: unknown;
    try {
      allocateSeq(dir, bail);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof RunBusyError);
    assert.ok(!(err instanceof RecoveryError));
  } finally {
    done();
  }
});

test("le verrou est rendu même quand la transition échoue", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    const autre = poseBail(dir, "autre1", { sessionId: S, leaseId: bail.leaseId });

    assert.throws(() => allocateSeq(dir, autre), RecoveryError);
    assert.equal(existsSync(join(dir, "autre1.guard")), false);

    // Et la transition suivante passe.
    assert.equal(allocateSeq(dir, bail).seq, 1);
  } finally {
    done();
  }
});

test("le verrou ne confère aucune propriété", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    own(dir, m.runId, "s-A");
    // s-B prend et rend le verrou en tentant une transition : il ne devient pas
    // propriétaire pour autant.
    const bailB = poseBail(dir, "autre2", { sessionId: "s-B", leaseId: "l-B" });
    assert.throws(() => allocateSeq(dir, bailB), RecoveryError);
    assert.equal(inspectRun(dir, m.runId, "s-B").kind, "owned-by-other");
  } finally {
    done();
  }
});

// Le battement pendant une reprise : le répertoire disparaît sous lui, et c'est
// une réponse, pas une panne.
test("un battement dont le bail a disparu rend faux sans jeter", () => {
  const { dir, done } = dossier();
  try {
    const bail = poseBail(dir, "4e9499", { sessionId: "s-A", leaseId: "l-A" });
    rmSync(join(dir, "4e9499.lease"), { recursive: true, force: true });
    assert.equal(heartbeatRun(dir, bail), false);
  } finally {
    done();
  }
});

// ------------------------------------------------ le registre des lanes

/*
 * Le registre est une vérité durable sur le run, donc son écriture demande la
 * capacité — au même titre que le manifeste. Le laisser hors de la garde aurait
 * sécurisé l'un en ouvrant l'autre.
 */
test("écrire au registre demande le bail courant", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    const evt = { event: "OPENED" as const, work_unit: "W03", at: new Date().toISOString(), base: "abc123" };

    appendLaneEvent(dir, evt, bail);
    assert.deepEqual(readLaneEvents(dir, m.runId).events.map((e) => e.work_unit), ["W03"]);

    assert.throws(
      () => appendLaneEvent(dir, evt, { ...bail, sessionId: "s-autre" }),
      NotOwnerError,
    );
    assert.equal(readLaneEvents(dir, m.runId).events.length, 1, "rien n'a été ajouté");
  } finally {
    done();
  }
});

// Même protection ABA que partout : une capacité libérée puis remplacée par la
// même session ne peut plus écrire l'histoire du run.
test("un bail périmé n'écrit pas au registre", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const ancien = own(dir, m.runId, "s-A");
    releaseRunOwnership(dir, ancien);
    own(dir, m.runId, "s-A");

    assert.throws(
      () => appendLaneEvent(dir, { event: "OPENED", work_unit: "W03", at: "x", base: "abc" }, ancien),
      NotOwnerError,
    );
    assert.equal(existsSync(laneLedgerPath(dir, m.runId)), false);
  } finally {
    done();
  }
});

test("le registre garde l'ordre des faits", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    appendLaneEvent(dir, { event: "OPENED", work_unit: "W01", at: "1", base: "b1" }, bail);
    appendLaneEvent(dir, { event: "OPENED", work_unit: "W03", at: "2", base: "b3" }, bail);
    appendLaneEvent(dir, { event: "INTEGRATED", work_unit: "W01", at: "3" }, bail);
    assert.deepEqual(
      readLaneEvents(dir, m.runId).events.map((e) => `${e.event}:${e.work_unit}`),
      ["OPENED:W01", "OPENED:W03", "INTEGRATED:W01"],
    );
  } finally {
    done();
  }
});

/*
 * Une ligne illisible est comptée, pas ignorée.
 *
 * La sauter en silence reviendrait à réécrire l'histoire du run — précisément
 * ce que ce fichier existe pour empêcher. Le compte remonte à la réconciliation,
 * qui saura qu'elle raisonne sur un registre incomplet.
 */
test("une ligne illisible est comptée, pas sautée", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    appendLaneEvent(dir, { event: "OPENED", work_unit: "W03", at: "x", base: "abc" }, bail);
    writeFileSync(laneLedgerPath(dir, m.runId),
      `${readFileSync(laneLedgerPath(dir, m.runId), "utf-8")}{ceci n'est pas du json\n`);

    const lu = readLaneEvents(dir, m.runId);
    assert.equal(lu.events.length, 1);
    assert.equal(lu.malformed, 1);
    // Les numéros, pas seulement le compte : une procédure qui sait qu'elle
    // doit agir mais pas où n'est pas une procédure. La ligne 1 porte la
    // version, donc l'événement est en 2 et la ligne abîmée en 3.
    assert.deepEqual(lu.malformedLines, [3]);
  } finally {
    done();
  }
});

test("un événement d'un type inconnu est compté comme malformé", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    writeFileSync(laneLedgerPath(dir, m.runId),
      `${JSON.stringify({ event: "PEUT-ÊTRE", work_unit: "W03", at: "x" })}\n`);
    const lu = readLaneEvents(dir, m.runId);
    assert.equal(lu.events.length, 0);
    assert.equal(lu.malformed, 1);
  } finally {
    done();
  }
});

/*
 * Une ouverture sans base n'est pas une ouverture.
 *
 * `base` décide si l'unité peut être prouvée intégrée, donc si ses dépendantes
 * sont admissibles. L'accepter laisserait le run utilisable jusqu'au merge, où
 * il se rebloquerait avec une `integration-non-confirmee` sans cause visible.
 */
test("une ouverture sans base est comptée comme malformée", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    writeFileSync(laneLedgerPath(dir, m.runId),
      `${JSON.stringify({ event: "OPENED", work_unit: "W03", at: "x" })}\n`);
    const lu = readLaneEvents(dir, m.runId);
    assert.equal(lu.events.length, 0);
    assert.deepEqual(lu.malformedLines, [1]);
  } finally {
    done();
  }
});

test("une intégration et un abandon n'ont pas besoin de base", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    writeFileSync(laneLedgerPath(dir, m.runId),
      `${JSON.stringify({ event: "INTEGRATED", work_unit: "W01", at: "x" })}\n` +
      `${JSON.stringify({ event: "ABANDONED", work_unit: "W07", at: "x" })}\n`);
    assert.equal(readLaneEvents(dir, m.runId).events.length, 2);
  } finally {
    done();
  }
});

test("un registre absent n'est pas une erreur", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    assert.deepEqual(readLaneEvents(dir, m.runId),
      { events: [], malformed: 0, malformedLines: [], version: 1, present: false });
  } finally {
    done();
  }
});

// ------------------------------------------- la version du registre

/*
 * Le manifeste avait une version, le registre non — et c'est lui qui contient la
 * provenance. Un durcissement du contrat rendait donc tout registre antérieur
 * « illisible », indistinguable d'une corruption : le run se fermait avec un
 * diagnostic faux, et la seule issue était de deviner quelles lignes réécrire.
 */
test("un registre neuf porte sa version", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    appendLaneEvent(dir, { event: "OPENED", work_unit: "W03", at: "x", base: "b" }, bail);

    const premiere = readFileSync(laneLedgerPath(dir, m.runId), "utf-8").split("\n")[0];
    assert.deepEqual(JSON.parse(premiere), { ledger: 1 });
    assert.equal(readLaneEvents(dir, m.runId).version, 1);
    assert.equal(readLaneEvents(dir, m.runId).events.length, 1);
  } finally {
    done();
  }
});

test("l'en-tête n'est écrit qu'une fois", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    appendLaneEvent(dir, { event: "OPENED", work_unit: "W01", at: "1", base: "b" }, bail);
    appendLaneEvent(dir, { event: "OPENED", work_unit: "W03", at: "2", base: "b" }, bail);
    const lignes = readFileSync(laneLedgerPath(dir, m.runId), "utf-8").trim().split("\n");
    assert.equal(lignes.length, 3);
    assert.equal(readLaneEvents(dir, m.runId).events.length, 2);
  } finally {
    done();
  }
});

// Un registre sans en-tête a été écrit avant que le protocole soit versionné :
// c'est une évolution à traiter, pas une corruption à réparer.
test("un registre sans version le dit, sans compter ses lignes comme abîmées", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    writeFileSync(laneLedgerPath(dir, m.runId),
      `${JSON.stringify({ event: "INTEGRATED", work_unit: "W01", at: "x" })}\n`);
    const lu = readLaneEvents(dir, m.runId);
    assert.equal(lu.version, undefined);
    assert.deepEqual(lu.malformedLines, [], "ses lignes ne sont pas abîmées");
  } finally {
    done();
  }
});

test("une version inconnue est rendue telle quelle", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    writeFileSync(laneLedgerPath(dir, m.runId), `${JSON.stringify({ ledger: 7 })}\n`);
    assert.equal(readLaneEvents(dir, m.runId).version, 7);
  } finally {
    done();
  }
});


// --------------------------------------- migration gardée du registre

test("migrer le registre demande la capability courante", () => {
  const { dir, done } = dossier();
  try {
    const { manifest } = openRun(dir, "base");
    const path = laneLedgerPath(dir, manifest.runId);
    writeFileSync(path,
      `${JSON.stringify({ event: "OPENED", work_unit: "W03", at: "x", base: "base" })}\n`);

    const bail = own(dir, manifest.runId);
    const ancien = { ...bail, leaseId: "ancien" };
    assert.throws(() => migrateLaneLedger(dir, manifest.runId, ancien), NotOwnerError);

    const r = migrateLaneLedger(dir, manifest.runId, bail);
    assert.deepEqual(r, { status: "migrated", events: 1 });
    const lignes = readFileSync(path, "utf-8").trim().split("\n");
    assert.deepEqual(JSON.parse(lignes[0]), { ledger: 1 });
    assert.equal(JSON.parse(lignes[1]).work_unit, "W03");
    releaseRunOwnership(dir, bail);
  } finally {
    done();
  }
});

test("appendLaneEvent refuse un registre legacy tant qu'il n'est pas migré", () => {
  const { dir, done } = dossier();
  try {
    const { manifest } = openRun(dir, "base");
    writeFileSync(laneLedgerPath(dir, manifest.runId),
      `${JSON.stringify({ event: "OPENED", work_unit: "W03", at: "x", base: "base" })}\n`);
    const bail = own(dir, manifest.runId);
    assert.throws(
      () => appendLaneEvent(dir, { event: "INTEGRATED", work_unit: "W03", at: "y" }, bail),
      RecoveryError,
    );
    releaseRunOwnership(dir, bail);
  } finally {
    done();
  }
});

/*
 * Le commit d'intégration est facultatif, sa forme ne l'est pas.
 *
 * Absent, l'intégration se prouve par la branche — c'est le régime des
 * registres écrits avant ce champ, et il reste légitime. Présent mais vide, la
 * ligne prétend porter une preuve qui n'en est pas une : l'accepter rendrait
 * `integration_commit: ""` indistinguable de l'absence, et la lane retomberait
 * sur la preuve par branche en croyant en avoir une durable.
 */
test("un commit d'intégration traverse l'écriture et la relecture", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    appendLaneEvent(dir, { event: "OPENED", work_unit: "W03", at: "x", base: "abc" }, bail);
    appendLaneEvent(
      dir,
      { event: "INTEGRATED", work_unit: "W03", at: "x", integration_commit: "deadbeef" },
      bail,
    );
    const lu = readLaneEvents(dir, m.runId);
    assert.equal(lu.malformed, 0);
    const e = lu.events[1];
    assert.equal(e.event === "INTEGRATED" ? e.integration_commit : undefined, "deadbeef");
  } finally {
    done();
  }
});

test("une intégration sans commit reste lisible", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    appendLaneEvent(dir, { event: "INTEGRATED", work_unit: "W03", at: "x" }, bail);
    const lu = readLaneEvents(dir, m.runId);
    assert.equal(lu.malformed, 0);
    assert.equal(lu.events.length, 1);
  } finally {
    done();
  }
});

test("un commit d'intégration vide ou d'un autre type est une ligne abîmée", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    for (const valeur of ["", 7, null, {}]) {
      writeFileSync(laneLedgerPath(dir, m.runId),
        `${JSON.stringify({ ledger: 1 })}\n` +
        `${JSON.stringify({ event: "INTEGRATED", work_unit: "W03", at: "x", integration_commit: valeur })}\n`);
      const lu = readLaneEvents(dir, m.runId);
      assert.equal(lu.events.length, 0, `integration_commit=${JSON.stringify(valeur)}`);
      assert.deepEqual(lu.malformedLines, [2]);
    }
  } finally {
    done();
  }
});

// ------------------------------- le registre des tentatives d'intégration

/*
 * Même discipline que celui des lanes, et pour la même raison : c'est une vérité
 * durable sur le run. Une session qui a perdu son bail ne doit pas pouvoir
 * écrire l'histoire des tentatives, sinon on aurait sécurisé le manifeste tout
 * en ouvrant une seconde vérité sans règles.
 */

const attemptOuverte = (id: string, unit = "W03") => ({
  event: "ATTEMPT_OPENED" as const,
  id, work_unit: unit, seq: 7,
  p1: "a".repeat(40), p2: "b".repeat(40),
  conflicts: ["src/a.py"], at: "t",
});

test("un événement de tentative traverse l'écriture et la relecture", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    appendIntegrationEvent(dir, attemptOuverte("r-W03-7"), bail);
    appendIntegrationEvent(dir,
      { event: "COMMITTED", id: "r-W03-7", commit: "c".repeat(40), tree: "d".repeat(40), at: "t" },
      bail);
    const lu = readIntegrationEvents(dir, m.runId);
    assert.equal(lu.malformed, 0);
    assert.equal(lu.version, 1);
    assert.equal(lu.events.length, 2);
    assert.equal(lu.events[0].id, "r-W03-7");
  } finally {
    done();
  }
});

test("écrire sans le bail est refusé", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    // Un bail d'une autre session : la capacité n'est pas la sienne.
    const usurpe = { ...bail, sessionId: "s-autre" };
    assert.throws(() => appendIntegrationEvent(dir, attemptOuverte("r-W03-7"), usurpe));
    assert.equal(readIntegrationEvents(dir, m.runId).events.length, 0);
  } finally {
    done();
  }
});

test("un événement incomplet est une ligne abîmée, pas un fait partiel", () => {
  /*
   * Chaque nature a ses champs obligatoires. Accepter un `COMMITTED` sans
   * `tree` reviendrait à enregistrer une preuve qui ne prouve rien, et la
   * réconciliation en tirerait un état qu'elle croirait vérifié.
   */
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const incomplets = [
      { event: "ATTEMPT_OPENED", id: "x", work_unit: "W03", seq: 1, p1: "a", at: "t" },
      { event: "COMMITTED", id: "x", commit: "c", at: "t" },
      { event: "SUPERSEDED", id: "x", at: "t" },
      { event: "CLOSED", id: "x", at: "t" },
      { event: "INCONNU", id: "x", at: "t" },
      { event: "COMMITTED", commit: "c", tree: "d", at: "t" },
    ];
    for (const doc of incomplets) {
      writeFileSync(integrationLedgerPath(dir, m.runId),
        `${JSON.stringify({ integration_ledger: 1 })}\n${JSON.stringify(doc)}\n`);
      const lu = readIntegrationEvents(dir, m.runId);
      assert.equal(lu.events.length, 0, JSON.stringify(doc));
      assert.deepEqual(lu.malformedLines, [2], JSON.stringify(doc));
    }
  } finally {
    done();
  }
});

test("une ligne abîmée bloque toute écriture ultérieure", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    writeFileSync(integrationLedgerPath(dir, m.runId),
      `${JSON.stringify({ integration_ledger: 1 })}\n{ pas du json\n`);
    assert.throws(() => appendIntegrationEvent(dir, attemptOuverte("r-W03-7"), bail), /illisible/);
  } finally {
    done();
  }
});

test("une version inconnue exige une migration avant d'écrire", () => {
  const { dir, done } = dossier();
  try {
    const m = openRun(dir).manifest;
    const bail = own(dir, m.runId);
    writeFileSync(integrationLedgerPath(dir, m.runId),
      `${JSON.stringify({ integration_ledger: 2 })}\n`);
    assert.throws(() => appendIntegrationEvent(dir, attemptOuverte("r-W03-7"), bail), /migration/);
  } finally {
    done();
  }
});

// ------------------------------ décider sous la propriété, pas avant

/*
 * Acquérir un bail sérialise les écritures futures ; cela ne rend pas
 * rétroactivement valide une décision prise avant. Cette primitive existe pour
 * que l'ordre soit une propriété vérifiable, et non la disposition des lignes
 * d'un appelant.
 */

test("l'état est relu après l'acquisition, jamais avant", () => {
  const trace: string[] = [];
  const r = decideUnderLease({
    acquire: () => trace.push("bail"),
    reread: () => { trace.push("relecture"); return { ok: true }; },
    validate: () => { trace.push("validation"); return null; },
    act: () => trace.push("mutation"),
    release: () => trace.push("rendu"),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(trace, ["bail", "relecture", "validation", "mutation", "rendu"]);
});

test("un état qui a changé sous le bail refuse la mutation", () => {
  // Ce que la fenêtre produisait : une autre session tranche entre le premier
  // relevé et l'acquisition, et la décision partait sur le monde d'avant.
  let mute = false;
  const r = decideUnderLease({
    acquire: () => {},
    reread: () => ({ closeParQuelquUnDautre: true }),
    validate: (etat) => (etat.closeParQuelquUnDautre ? "la tentative a été close entre-temps" : null),
    act: () => { mute = true; },
    release: () => {},
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /close entre-temps/);
  assert.equal(mute, false, "aucune mutation sur un état périmé");
});

test("le bail est rendu sur un refus comme sur une panne", () => {
  let rendus = 0;
  decideUnderLease({
    acquire: () => {}, reread: () => 1, validate: () => "non",
    act: () => {}, release: () => { rendus += 1; },
  });
  assert.throws(() => decideUnderLease({
    acquire: () => {}, reread: () => 1, validate: () => null,
    act: () => { throw new Error("disque plein"); },
    release: () => { rendus += 1; },
  }), /disque plein/);
  assert.equal(rendus, 2);
});

/*
 * La sortie de garde : ce qu'un `finally` a le droit d'écraser, et ce qu'il n'a pas.
 *
 * `sousGuardAcquis` porte la sortie des DEUX exclusions. Un `finally` qui lève
 * substitue silencieusement l'erreur de nettoyage à celle du corps : la panne réelle
 * disparaît derrière un incident de libération, et le diagnostic porte sur le mauvais
 * objet. Les deux cas ci-dessous fixent la priorité.
 *
 * Le retrait est rendu impossible par INJECTION dans une copie jetable du module, selon
 * le mécanisme des mutants, et non par une permission refusée : une permission ne refuse
 * rien à un utilisateur privilégié, et la preuve serait alors verte en conteneur pour
 * aucune raison. L'injection échoue partout de la même manière.
 *
 * Aucune surface d'injection n'est ajoutée à la production : l'original n'est jamais
 * touché, seule la copie l'est.
 */
const ANCRE_RETRAIT = "rmSync(path, { recursive: true, force: true });";
const RETRAIT_INJECTE = `throw Object.assign(new Error("L0_RETRAIT_INJECTE"), {
      code: "L0_RETRAIT_INJECTE",
    });`;

/** Une copie jetable du dépôt dont le retrait de verrou lève, et le chemin du module muté. */
function copieAuRetraitImpossible(): { copie: string } {
  const copie = copieJetable(join(import.meta.dirname, ".."));
  const cible = join(copie, "subagent-only", "run-manifest.ts");
  const source = readFileSync(cible, "utf-8");
  const occurrences = source.split(ANCRE_RETRAIT).length - 1;
  assert.equal(
    occurrences,
    1,
    `PRÉCONDITION — l'ancre d'injection doit apparaître exactement une fois dans ` +
      `subagent-only/run-manifest.ts, trouvée ${occurrences} fois. Sans elle, ` +
      `l'injection ne porte sur rien et la propriété serait satisfaite par un ` +
      `chargement qui échoue ailleurs.`,
  );
  const mute = source.replace(ANCRE_RETRAIT, RETRAIT_INJECTE);
  assert.notEqual(mute, source, "PRÉCONDITION — le module muté doit différer de l'original");
  writeFileSync(cible, mute);
  return { copie };
}

/**
 * Exerce `withSpaceGuard` dans un enfant frais, sur la copie mutée.
 *
 * L'enfant rend un relevé structuré : le rappel a-t-il été atteint, qu'est-ce qui est
 * sorti, et le verrou est-il resté sur le disque. Le parent n'interprète aucun message.
 */
function exercerGardeEspace(copie: string, corps: "abouti" | "en-echec"): {
  atteint: boolean;
  sortie: { name: string; message: string; code?: string } | null;
  valeur?: unknown;
  verrouRestant: boolean;
} {
  const enfant = join(copie, "s4-sortie-de-garde.ts");
  writeFileSync(
    enfant,
    `import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSpaceGuard } from "./subagent-only/run-manifest.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-sortie-garde-"));
const releve = { atteint: false, sortie: null, valeur: undefined, verrouRestant: false };
try {
  releve.valeur = withSpaceGuard(dir, () => {
    releve.atteint = true;
    ${corps === "en-echec" ? 'throw Object.assign(new Error("ERREUR_CORPS"), { code: "ERREUR_CORPS" });' : 'return "corps-abouti";'}
  });
} catch (err) {
  releve.sortie = { name: err?.constructor?.name, message: String(err?.message), code: err?.code };
}
releve.verrouRestant = existsSync(join(dir, ".espace.guard"));
process.stdout.write(JSON.stringify(releve));
`,
  );
  const p = spawnSync(process.execPath, ["--experimental-strip-types", enfant], {
    cwd: copie,
    encoding: "utf-8",
  });
  assert.equal(
    p.status,
    0,
    `PRÉCONDITION — l'enfant doit sortir avec le code 0 ; ` +
      `statut ${String(p.status)}, signal ${String(p.signal)}, ` +
      `stdout « ${p.stdout.trim().slice(0, 200) || "(vide)"} », ` +
      `stderr « ${p.stderr.trim().slice(0, 400) || "(vide)"} »`,
  );
  assert.ok(
    p.stdout.trim().startsWith("{"),
    `PRÉCONDITION — l'enfant doit charger le module muté et rendre un relevé ; ` +
      `sortie ${p.status}, stdout « ${p.stdout.trim().slice(0, 200) || "(vide)"} », ` +
      `stderr « ${p.stderr.trim().slice(0, 400)} »`,
  );
  return JSON.parse(p.stdout.trim());
}

test("sousGuardAcquis — corps abouti et retrait impossible : l'échec de libération est explicite", () => {
  const { copie } = copieAuRetraitImpossible();
  try {
    const r = exercerGardeEspace(copie, "abouti");

    assert.ok(r.atteint, "PRÉCONDITION — le rappel doit avoir été atteint, sinon rien n'est éprouvé");
    assert.ok(r.verrouRestant, "PRÉCONDITION — le verrou doit être resté : c'est ce qui rend le retrait impossible observable");

    assert.ok(r.sortie, "un retrait impossible après un corps abouti doit lever, pas passer en silence");
    assert.equal(r.sortie.name, "RecoveryError");
    assert.match(r.sortie.message, /verrou d'espace/);
    assert.match(r.sortie.message, /L0_RETRAIT_INJECTE/);
    assert.match(r.sortie.message, /\.espace\.guard/);
  } finally {
    rmSync(copie, { recursive: true, force: true });
  }
});

test("sousGuardAcquis — corps en échec et retrait impossible : l'erreur du corps reste prioritaire", () => {
  const { copie } = copieAuRetraitImpossible();
  try {
    const r = exercerGardeEspace(copie, "en-echec");

    assert.ok(r.atteint, "PRÉCONDITION — le rappel doit avoir été atteint, sinon rien n'est éprouvé");
    assert.ok(r.verrouRestant, "PRÉCONDITION — le verrou doit être resté sur le disque");
    assert.ok(r.sortie, "PRÉCONDITION — quelque chose doit être sorti de la garde");

    assert.equal(r.sortie.code, "ERREUR_CORPS", "l'erreur du corps doit rester l'issue primaire");
    assert.notEqual(r.sortie.code, "L0_RETRAIT_INJECTE", "le nettoyage ne doit jamais se substituer au corps");
    assert.doesNotMatch(r.sortie.message, /verrou d'espace non libéré/);
  } finally {
    rmSync(copie, { recursive: true, force: true });
  }
});



/*
 * La transition terminale : une seule primitive, et ce qu'elle refuse ne laisse rien.
 *
 * Chaque refus est monté à côté du cas où la même opération DOIT aboutir. Sans ce
 * témoin positif, « X est refusé » serait vrai d'un runtime qui refuse tout.
 *
 * AUCUN témoin positif ne détient de bail : C1.8 termine un run dont plus personne
 * n'est propriétaire, et un montage qui garderait le bail éprouverait le contraire du
 * contrat.
 */

/** Un run v2 actif, SANS propriétaire — l'état dans lequel une fin se pose. */
function runTerminable(champs: Partial<RunManifest> = {}): { dir: string; done: () => void; m: RunManifest } {
  const { dir, done } = dossier();
  const { manifest } = openRun(dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
  const lease = own(dir, manifest.runId);
  releaseRunOwnership(dir, lease);
  if (Object.keys(champs).length > 0) {
    const actif = join(dir, "active-run.json");
    const courant = JSON.parse(readFileSync(actif, "utf-8"));
    writeFileSync(actif, `${JSON.stringify({ ...courant, ...champs }, null, 2)}\n`);
  }
  return { dir, done, m: JSON.parse(readFileSync(join(dir, "active-run.json"), "utf-8")) };
}

/** Le manifeste actif, octet pour octet — ce qu'un refus ne doit pas avoir touché. */
const actifBrut = (dir: string): string => readFileSync(join(dir, "active-run.json"), "utf-8");
/** L'identité physique d'un fichier : un contenu identique ne prouve pas la non-réécriture. */
function identite(p: string) {
  const st = statSync(p, { bigint: true });
  return { dev: st.dev, ino: st.ino, mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs, size: st.size };
}

test("terminerRun — une fin explicite archive, libère active-run.json, et préserve les registres", () => {
  const { dir, done, m } = runTerminable({ ledgers: { lanes: 2 } });
  try {
    assert.equal(m.version, 2, "PRÉCONDITION — le run doit naître en v2");
    assert.ok(existsSync(join(dir, "active-run.json")), "PRÉCONDITION — le manifeste actif doit être là");

    const terminal = terminerRun(dir, m.runId, {
      by: "operator", outcome: "abandoned", reason: "preuve de mécanique terminale",
    });

    assert.equal(terminal.status, "abandoned");
    assert.equal(terminal.ended?.outcome, "abandoned");
    assert.equal(terminal.ended?.by, "operator");
    assert.deepEqual(terminal.ledgers, { lanes: 2 }, "les registres attestés doivent survivre à la fin");
    assert.equal(existsSync(join(dir, "active-run.json")), false, "active-run.json doit être libéré");

    const archive = JSON.parse(readFileSync(archivePath(dir, m.runId), "utf-8"));
    assert.equal(archive.status, "abandoned");
    assert.equal(archive.ended.by, "operator");
    assert.deepEqual(archive.ledgers, { lanes: 2 });
  } finally {
    done();
  }
});

test("terminerRun — un abandon exige sa raison, et l'abandon motivé aboutit", () => {
  const refus = runTerminable();
  try {
    const avant = actifBrut(refus.dir);
    assert.throws(
      () => terminerRun(refus.dir, refus.m.runId, { by: "operator", outcome: "abandoned" }),
      /ne s'accorde pas sans raison/,
    );
    assert.equal(actifBrut(refus.dir), avant, "le refus ne modifie pas le manifeste, octet pour octet");
    assert.equal(existsSync(archivePath(refus.dir, refus.m.runId)), false, "un refus n'archive rien");
  } finally {
    refus.done();
  }

  /*
   * Raison présente ET propriétaire présent : le refus vient de la propriété, pas de la
   * raison. C1.8 termine un run dont plus personne n'est propriétaire ; un run possédé
   * n'est pas à terminer, quelle que soit la qualité de la demande.
   */
  const possede = runTerminable();
  try {
    own(possede.dir, possede.m.runId); // le bail est repris, et pas rendu
    const avant = actifBrut(possede.dir);
    assert.throws(
      () => terminerRun(possede.dir, possede.m.runId, { by: "operator", outcome: "abandoned", reason: "raison présente" }),
      /propriétaire est encore inscrit/,
    );
    assert.throws(
      () => terminerRun(possede.dir, possede.m.runId, { by: "operator", outcome: "completed" }),
      /propriétaire est encore inscrit/,
    );
    assert.equal(actifBrut(possede.dir), avant, "aucun des deux refus ne modifie le manifeste, octet pour octet");
    assert.equal(existsSync(archivePath(possede.dir, possede.m.runId)), false, "aucun des deux refus n'archive");
  } finally {
    possede.done();
  }

  // Témoin positif : sans propriétaire et avec sa raison, l'abandon aboutit.
  const ok = runTerminable();
  try {
    const terminal = terminerRun(ok.dir, ok.m.runId, { by: "operator", outcome: "abandoned", reason: "pilote interrompu" });
    assert.equal(terminal.ended?.reason, "pilote interrompu");
    assert.equal(existsSync(join(ok.dir, "active-run.json")), false);
  } finally {
    ok.done();
  }
});

test("terminerRun — continuation_block interdit d'aboutir, l'abandon reste ouvert, et completed demeure fail-closed", () => {
  const bloc = { at: "2026-09-14T08:00:00.000Z", code: "RUN_CONTINUATION_BLOCKED" } as const;

  const refus = runTerminable({ continuation_block: bloc });
  try {
    const avant = actifBrut(refus.dir);
    assert.throws(
      () => terminerRun(refus.dir, refus.m.runId, { by: "operator", outcome: "completed" }),
      /RUN_CONTINUATION_BLOCKED/,
    );
    assert.equal(actifBrut(refus.dir), avant, "le refus ne modifie pas le manifeste");
    assert.equal(existsSync(archivePath(refus.dir, refus.m.runId)), false, "le refus n'archive rien");
  } finally {
    refus.done();
  }

  const abandon = runTerminable({ continuation_block: bloc });
  try {
    const terminal = terminerRun(abandon.dir, abandon.m.runId, { by: "operator", outcome: "abandoned", reason: "garde contournée" });
    assert.equal(terminal.status, "abandoned");
    assert.deepEqual(terminal.continuation_block, bloc, "le champ est préservé, jamais effacé");
  } finally {
    abandon.done();
  }

  const sansBloc = runTerminable();
  try {
    const avant = actifBrut(sansBloc.dir);
    assert.throws(
      () => terminerRun(sansBloc.dir, sansBloc.m.runId, { by: "operator", outcome: "completed" }),
      /vérification métier de completed indisponible.*registre des lanes v2/s,
    );
    assert.equal(actifBrut(sansBloc.dir), avant, "le refus transitoire ne modifie pas le manifeste");
    assert.equal(existsSync(archivePath(sansBloc.dir, sansBloc.m.runId)), false, "le refus transitoire n'archive rien");
  } finally {
    sansBloc.done();
  }
});

test("terminerRun — un manifeste v1 n'est pas terminable, et le v2 équivalent l'est", () => {
  const v1 = runTerminable();
  try {
    const actif = join(v1.dir, "active-run.json");
    const courant = JSON.parse(readFileSync(actif, "utf-8"));
    delete courant.ledgers;
    writeFileSync(actif, `${JSON.stringify({ ...courant, version: 1 }, null, 2)}\n`);
    assert.equal(JSON.parse(actifBrut(v1.dir)).version, 1, "PRÉCONDITION — le manifeste doit être en v1");
    const avant = actifBrut(v1.dir);

    assert.throws(() => terminerRun(v1.dir, v1.m.runId, { by: "operator", outcome: "completed" }), /version 1/);
    assert.throws(() => terminerRun(v1.dir, v1.m.runId, { by: "operator", outcome: "abandoned", reason: "r" }), /conversion implicite/);
    assert.equal(actifBrut(v1.dir), avant, "aucun des deux refus ne modifie le manifeste");
    assert.equal(existsSync(archivePath(v1.dir, v1.m.runId)), false, "aucun des deux refus n'archive");
  } finally {
    v1.done();
  }

  const v2 = runTerminable();
  try {
    assert.equal(
      terminerRun(v2.dir, v2.m.runId, {
        by: "operator", outcome: "abandoned", reason: "preuve de version",
      }).status,
      "abandoned",
    );
  } finally {
    v2.done();
  }
});

test("publication exclusive — une archive contradictoire est refusée, une archive identique n'est pas réécrite", () => {
  const a = runTerminable();
  try {
    const terminal = terminerRun(a.dir, a.m.runId, {
      by: "operator", outcome: "abandoned", reason: "preuve de publication",
    });
    const chemin = archivePath(a.dir, terminal.runId);
    const posee = readFileSync(chemin, "utf-8");
    const avantId = identite(chemin);

    // Un manifeste terminé reparaît, avec une histoire différente sous le même nom.
    writeFileSync(join(a.dir, "active-run.json"), `${JSON.stringify({ ...terminal, nextSeq: terminal.nextSeq + 7 }, null, 2)}\n`);
    const actifAvant = actifBrut(a.dir);
    assert.throws(() => openRun(a.dir, "cbf7015a57b5e296d7c964790bb4989c4380da25"), /archive contradictoire/);
    assert.equal(readFileSync(chemin, "utf-8"), posee, "l'archive existante n'est jamais remplacée");
    assert.deepEqual(identite(chemin), avantId, "ni réécrite : même inode, mêmes horodatages");
    assert.equal(actifBrut(a.dir), actifAvant, "le manifeste terminal actif reste strictement inchangé");
  } finally {
    a.done();
  }

  const b = runTerminable();
  try {
    const terminal = terminerRun(b.dir, b.m.runId, {
      by: "operator", outcome: "abandoned", reason: "preuve de publication",
    });
    const chemin = archivePath(b.dir, terminal.runId);
    const posee = readFileSync(chemin, "utf-8");
    const avantId = identite(chemin);
    writeFileSync(join(b.dir, "active-run.json"), posee);
    const suivant = openRun(b.dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
    assert.notEqual(suivant.manifest.runId, terminal.runId, "un successeur doit naître");
    assert.equal(readFileSync(chemin, "utf-8"), posee, "l'archive identique reste ce qu'elle était");
    assert.deepEqual(identite(chemin), avantId, "et n'est pas réécrite : dev, ino, mtimeNs, ctimeNs et taille inchangés");
  } finally {
    b.done();
  }
});


/*
 * Les deux fenêtres qu'aucun montage séquentiel ordinaire n'atteint.
 *
 * Une interruption entre le manifeste terminal et son archive, et un système de
 * fichiers sans lien physique, ne se produisent pas sur commande. Ils s'INJECTENT dans
 * une copie jetable du module — le mécanisme des mutants — et jamais par une couture
 * ajoutée à la production.
 */
const ANCRE_LINK = "    linkSync(source, destination);";
const ANCRE_COPIE = '    writeFileSync(destination, contenu, { encoding: "utf-8", flag: "wx" });';

/** Une copie jetable du dépôt, mutée par remplacements dont chacun est prouvé unique. */
function copieMutee(remplacements: Array<[string, string]>): string {
  const copie = copieJetable(join(import.meta.dirname, ".."));
  const cible = join(copie, "subagent-only", "run-manifest.ts");
  let source = readFileSync(cible, "utf-8");
  for (const [ancre, remplacement] of remplacements) {
    const n = source.split(ancre).length - 1;
    assert.equal(
      n,
      1,
      `PRÉCONDITION — l'ancre « ${ancre.trim()} » doit apparaître exactement une fois, ` +
        `trouvée ${n} fois. Sans elle, l'injection ne porte sur rien.`,
    );
    source = source.replace(ancre, remplacement);
  }
  writeFileSync(cible, source);
  return copie;
}

/** Monte un run terminable dans un enfant frais, le termine, et rend un relevé structuré. */
function terminerDansEnfant(copie: string): {
  erreur: { name: string; message: string; code?: string } | null;
  actif: { existe: boolean; status?: string; aEnded?: boolean; brut?: string };
  archive: { existe: boolean; contenu?: string };
  rejeu: { name: string; message: string } | null;
  actifApresRejeu?: string;
  proprietaireAvant: boolean;
} {
  const enfant = join(copie, "s4-terminaison.ts");
  writeFileSync(
    enfant,
    `import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireRunOwnership, archivePath, openRun, releaseRunOwnership, terminerRun,
} from "./subagent-only/run-manifest.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-terminaison-"));
const { manifest } = openRun(dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
const pris = acquireRunOwnership(dir, manifest.runId, "s-enfant");
releaseRunOwnership(dir, pris.lease);

const actifPath = join(dir, "active-run.json");
const arch = archivePath(dir, manifest.runId);
const releve = {
  erreur: null,
  actif: { existe: false },
  archive: { existe: false },
  rejeu: null,
  proprietaireAvant: existsSync(join(dir, \`\${manifest.runId}.lease\`, "owner.json")),
};

try {
  terminerRun(dir, manifest.runId, {
    by: "operator", outcome: "abandoned", reason: "preuve de mécanique terminale",
  });
} catch (err) {
  releve.erreur = { name: err?.constructor?.name, message: String(err?.message), code: err?.code };
}

releve.actif.existe = existsSync(actifPath);
if (releve.actif.existe) {
  releve.actif.brut = readFileSync(actifPath, "utf-8");
  const m = JSON.parse(releve.actif.brut);
  releve.actif.status = m.status;
  releve.actif.aEnded = m.ended !== undefined;
}
releve.archive.existe = existsSync(arch);
if (releve.archive.existe) releve.archive.contenu = readFileSync(arch, "utf-8");

try {
  terminerRun(dir, manifest.runId, {
    by: "operator", outcome: "abandoned", reason: "preuve de mécanique terminale",
  });
} catch (err) {
  releve.rejeu = { name: err?.constructor?.name, message: String(err?.message) };
}
if (existsSync(actifPath)) releve.actifApresRejeu = readFileSync(actifPath, "utf-8");

// Sérialisé AVANT le nettoyage : effacer d'abord perdrait ce qu'on vient d'observer.
const sortie = JSON.stringify(releve);
rmSync(dir, { recursive: true, force: true });
process.stdout.write(sortie);
`,
  );
  const p = spawnSync(process.execPath, ["--experimental-strip-types", enfant], {
    cwd: copie,
    encoding: "utf-8",
  });
  assert.equal(
    p.status,
    0,
    `PRÉCONDITION — l'enfant doit sortir avec le code 0 ; statut ${String(p.status)}, ` +
      `stdout « ${p.stdout.trim().slice(0, 200) || "(vide)"} », ` +
      `stderr « ${p.stderr.trim().slice(0, 400) || "(vide)"} »`,
  );
  assert.ok(p.stdout.trim().startsWith("{"), `PRÉCONDITION — relevé illisible : ${p.stdout.slice(0, 200)}`);
  return JSON.parse(p.stdout.trim());
}

test("terminerRun — interrompu entre le terminal et l'archive : le terminal est durable, rien n'est archivé", () => {
  const copie = copieMutee([
    [ANCRE_LINK, '    throw Object.assign(new Error("L0_CRASH_PUBLICATION"), { code: "L0_CRASH_PUBLICATION" });'],
  ]);
  try {
    const r = terminerDansEnfant(copie);

    assert.ok(r.erreur, "PRÉCONDITION — l'appel doit avoir échoué au point de publication");
    assert.equal(r.erreur.code, "L0_CRASH_PUBLICATION", "et échouer là, pas ailleurs");

    assert.ok(r.actif.existe, "active-run.json doit être resté : c'est la fenêtre terminal → link → unlink");
    assert.equal(r.actif.status, "abandoned", "et être durablement terminal");
    assert.equal(r.actif.aEnded, true, "avec sa fin posée");
    assert.equal(r.archive.existe, false, "aucune archive ne doit exister");

    /*
     * Depuis l'étape 5, un second appel REPREND la transition au lieu de la refuser. Ici
     * l'injection tient toujours : la reprise bute au même point, et rien ne bouge. Ce
     * qu'on vérifie, c'est qu'elle ne réécrit pas la fin déjà posée.
     */
    assert.ok(r.rejeu, "la reprise doit buter sur la même injection");
    assert.match(r.rejeu.message, /L0_CRASH_PUBLICATION/, "au point de publication, pas ailleurs");
    assert.equal(r.actifApresRejeu, r.actif.brut, "et ne rien modifier — la fin posée n'est pas réécrite");
  } finally {
    rmSync(copie, { recursive: true, force: true });
  }
});

test("publication exclusive — sans lien physique, le repli copie et VÉRIFIE, et refuse une copie partielle", () => {
  const sansLien = '    throw Object.assign(new Error("pas de lien physique"), { code: "EOPNOTSUPP" });';

  // Repli nominal : la copie exclusive aboutit, et l'archive est complète.
  const complet = copieMutee([[ANCRE_LINK, sansLien]]);
  try {
    const r = terminerDansEnfant(complet);
    assert.equal(r.erreur, null, `le repli doit aboutir ; ${JSON.stringify(r.erreur)}`);
    assert.equal(r.actif.existe, false, "active-run.json doit être libéré comme par le chemin nominal");
    assert.ok(r.archive.existe, "l'archive doit avoir été posée par le repli");
    const archive = JSON.parse(r.archive.contenu ?? "");
    assert.equal(archive.status, "abandoned");
    assert.equal(archive.ended.by, "operator");
  } finally {
    rmSync(complet, { recursive: true, force: true });
  }

  // Copie tronquée : la relecture refuse, et la destination incomplète reste en obstacle.
  const tronque = copieMutee([
    [ANCRE_LINK, sansLien],
    [ANCRE_COPIE, '    writeFileSync(destination, contenu.slice(0, 5), { encoding: "utf-8", flag: "wx" });'],
  ]);
  try {
    const r = terminerDansEnfant(tronque);
    assert.ok(r.erreur, "une copie partielle ne doit pas passer pour une archive");
    assert.match(r.erreur.message, /archive non vérifiée après copie exclusive/);
    assert.ok(r.actif.existe, "le manifeste terminal actif reste présent");
    assert.equal(r.actif.status, "abandoned");
    assert.ok(r.archive.existe, "la destination incomplète n'est pas effacée : elle est un obstacle à réconcilier");
    assert.notEqual(r.archive.contenu, r.actif.brut, "et elle n'est ni acceptée ni complétée");
    assert.ok(r.rejeu, "la reprise doit refuser");
    assert.match(
      r.rejeu.message,
      /archive contradictoire/,
      "la reprise bute sur la destination incomplète — elle ne la remplace pas",
    );
  } finally {
    rmSync(tronque, { recursive: true, force: true });
  }
});


/*
 * T2 : ne rien avoir vu n'est pas avoir vu qu'il n'y a rien.
 *
 * Une observation de la propriété qui ÉCHOUE n'établit aucune absence. Traiter ce
 * silence comme un ENOENT terminerait le run d'autrui. La branche ne s'atteint pas sur
 * commande : elle s'injecte dans une copie jetable.
 */
const ANCRE_PROPRIETAIRE = "        statSync(ownerPath(dir, runId));";

test("terminerRun — une propriété inobservable refuse, et ne laisse rien derrière", () => {
  const copie = copieMutee([
    [
      ANCRE_PROPRIETAIRE,
      '        throw Object.assign(new Error("L0_PROPRIETE_INCONNUE"), { code: "EACCES" });',
    ],
  ]);
  try {
    const r = terminerDansEnfant(copie);

    assert.equal(
      r.proprietaireAvant,
      false,
      "PRÉCONDITION — le run doit être réellement sans propriétaire avant l'observation injectée",
    );
    assert.ok(r.erreur, "PRÉCONDITION — l'appel doit avoir été atteint et avoir échoué");
    assert.match(
      r.erreur.message,
      /la propriété de .* n'a pas pu être observée/,
      "le refus doit porter sur l'impossibilité d'observer, pas sur autre chose",
    );

    assert.ok(r.actif.existe, "aucun unlink : active-run.json doit être resté");
    assert.equal(r.actif.status, "planning", "et n'avoir pas été rendu terminal");
    assert.equal(r.actif.aEnded, false, "aucune fin n'a été posée");
    assert.equal(r.archive.existe, false, "aucune archive");
    assert.equal(r.actifApresRejeu, r.actif.brut, "le rejeu ne modifie rien non plus");
  } finally {
    rmSync(copie, { recursive: true, force: true });
  }
});


/*
 * L'ordre durable, observé et non supposé.
 *
 * `fsync` ne change rien d'observable par une lecture ordinaire : c'est précisément ce
 * qui le rend facile à oublier et impossible à éprouver de l'extérieur. La séquence est
 * donc INSTRUMENTÉE dans une copie jetable — chaque synchronisation, la publication et
 * l'unlink s'inscrivent dans un journal — et le test compare l'ordre obtenu à celui que
 * C0 impose.
 */
const ANCRE_FSYNC = "function synchroniserChemin(path: string): void {";
const ANCRE_UNLINK = "  unlinkSync(source);";
const JOURNALISER = (quoi: string) =>
  `  appendFileSync(String(process.env.L0_JOURNAL), \`${quoi}\\n\`);`;

/** Termine un run dans un enfant frais et rend le journal des opérations durables. */
function journalDeTerminaison(copie: string): string[] {
  const enfant = join(copie, "s4-ordre-durable.ts");
  writeFileSync(
    enfant,
    `import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  acquireRunOwnership, archivePath, openRun, releaseRunOwnership, terminerRun,
} from "./subagent-only/run-manifest.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-ordre-"));
const { manifest } = openRun(dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
const pris = acquireRunOwnership(dir, manifest.runId, "s-enfant");
releaseRunOwnership(dir, pris.lease);

const journal = join(dir, "journal.txt");
process.env.L0_JOURNAL = journal;
terminerRun(dir, manifest.runId, {
  by: "operator", outcome: "abandoned", reason: "preuve d'ordre durable",
});

const lignes = readFileSync(journal, "utf-8").trim().split("\\n")
  .map((l) => l
    .replace(join(dir, "active-run.json"), "<source>")
    .replace(archivePath(dir, manifest.runId), "<destination>")
    .replace(dir, "<N>"));
const sortie = JSON.stringify(lignes);
rmSync(dir, { recursive: true, force: true });
process.stdout.write(sortie);
`,
  );
  const p = spawnSync(process.execPath, ["--experimental-strip-types", enfant], {
    cwd: copie,
    encoding: "utf-8",
  });
  assert.equal(
    p.status,
    0,
    `PRÉCONDITION — l'enfant doit sortir avec le code 0 ; statut ${String(p.status)}, ` +
      `stdout « ${p.stdout.trim().slice(0, 200) || "(vide)"} », ` +
      `stderr « ${p.stderr.trim().slice(0, 400) || "(vide)"} »`,
  );
  assert.ok(p.stdout.trim().startsWith("["), `PRÉCONDITION — journal illisible : ${p.stdout.slice(0, 200)}`);
  return JSON.parse(p.stdout.trim());
}

test("publication durable — la séquence fsync exigée par C0, au lien physique comme au repli", () => {
  const instrumentation: Array<[string, string]> = [
    [ANCRE_FSYNC, `${ANCRE_FSYNC}\n${JOURNALISER("fsync ${path}")}`],
    [ANCRE_UNLINK, `${JOURNALISER("unlink")}\n${ANCRE_UNLINK}`],
  ];

  // Chemin nominal : le lien physique.
  const nominal = copieMutee([
    ...instrumentation,
    [ANCRE_LINK, `${JOURNALISER("publication link")}\n${ANCRE_LINK}`],
  ]);
  try {
    assert.deepEqual(journalDeTerminaison(nominal), [
      "fsync <source>",
      "fsync <N>",
      "publication link",
      "fsync <destination>",
      "fsync <N>",
      "unlink",
      "fsync <N>",
    ]);
  } finally {
    rmSync(nominal, { recursive: true, force: true });
  }

  // Repli : pas de lien physique, la destination est un autre inode — le fsync qui la
  // suit n'est donc pas redondant avec celui de la source.
  const repli = copieMutee([
    ...instrumentation,
    [
      ANCRE_LINK,
      `${JOURNALISER("publication link refusée")}\n    throw Object.assign(new Error("pas de lien physique"), { code: "EOPNOTSUPP" });`,
    ],
    [ANCRE_COPIE, `${JOURNALISER("publication wx")}\n${ANCRE_COPIE}`],
  ]);
  try {
    assert.deepEqual(journalDeTerminaison(repli), [
      "fsync <source>",
      "fsync <N>",
      "publication link refusée",
      "publication wx",
      "fsync <destination>",
      "fsync <N>",
      "unlink",
      "fsync <N>",
    ]);
  } finally {
    rmSync(repli, { recursive: true, force: true });
  }
});


/*
 * La source disparue entre la relecture stable et l'archivage.
 *
 * Cette branche T2 n'est pas comme les trois invariants de concurrence : elle est
 * DÉTERMINISTE et injectable. Un mutant qui la supprime ne ferait rougir aucune suite —
 * elle resterait décorative. Elle est donc éprouvée, et par la surface publique.
 */
const ANCRE_RELECTURE_SOURCE = '    contenu = readFileSync(source, "utf-8");';

/** Monte un run terminal conforme dans un enfant frais, puis ouvre — et n'observe que ça. */
function ouvrirSurTerminal(copie: string): {
  issue: { name: string; message: string } | null;
  archiveExiste: boolean;
  activeExiste: boolean;
  successeurCree: boolean;
} {
  const enfant = join(copie, "s4-source-disparue.ts");
  writeFileSync(
    enfant,
    `import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireRunOwnership, archivePath, openRun, releaseRunOwnership,
} from "./subagent-only/run-manifest.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-source-"));
const { manifest } = openRun(dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
const pris = acquireRunOwnership(dir, manifest.runId, "s-enfant");
releaseRunOwnership(dir, pris.lease);

// Un terminal CONFORME, avec sa fin : c'est l'état sur lequel la succession s'exerce.
const actif = join(dir, "active-run.json");
const terminal = {
  ...JSON.parse(readFileSync(actif, "utf-8")),
  status: "completed",
  ended: { at: "2026-09-14T09:00:00.000Z", by: "operator", outcome: "completed" },
};
writeFileSync(actif, JSON.stringify(terminal, null, 2) + "\\n");

const releve = { issue: null, archiveExiste: false, activeExiste: false, successeurCree: false };
try {
  const ouvert = openRun(dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
  releve.successeurCree = ouvert.manifest.runId !== manifest.runId;
} catch (err) {
  releve.issue = { name: err?.constructor?.name, message: String(err?.message) };
}
releve.archiveExiste = existsSync(archivePath(dir, manifest.runId));
releve.activeExiste = existsSync(actif);

const sortie = JSON.stringify(releve);
rmSync(dir, { recursive: true, force: true });
process.stdout.write(sortie);
`,
  );
  const p = spawnSync(process.execPath, ["--experimental-strip-types", enfant], {
    cwd: copie,
    encoding: "utf-8",
  });
  assert.equal(
    p.status,
    0,
    `PRÉCONDITION — l'enfant doit sortir avec le code 0 ; statut ${String(p.status)}, ` +
      `stdout « ${p.stdout.trim().slice(0, 200) || "(vide)"} », ` +
      `stderr « ${p.stderr.trim().slice(0, 400) || "(vide)"} »`,
  );
  assert.ok(p.stdout.trim().startsWith("{"), `PRÉCONDITION — relevé illisible : ${p.stdout.slice(0, 200)}`);
  return JSON.parse(p.stdout.trim());
}

test("archivage — une source disparue refuse, et ne fait naître aucun successeur", () => {
  const disparue = copieMutee([
    [ANCRE_RELECTURE_SOURCE, `    unlinkSync(source);\n${ANCRE_RELECTURE_SOURCE}`],
  ]);
  try {
    const r = ouvrirSurTerminal(disparue);

    assert.ok(r.issue, "la disparition de la source ne doit pas passer pour un archivage réussi");
    assert.equal(r.issue.name, "RecoveryError");
    assert.match(r.issue.message, /manifeste terminal impossible à relire/);
    assert.equal(r.archiveExiste, false, "rien n'a pu être publié");
    assert.equal(r.activeExiste, false, "l'injection a bien supprimé la source");
    assert.equal(r.successeurCree, false, "aucun successeur ne naît sur une histoire jamais publiée");
  } finally {
    rmSync(disparue, { recursive: true, force: true });
  }

  // Contrôle positif : le MÊME montage, sans disparition, archive et fait naître un successeur.
  const intacte = copieMutee([]);
  try {
    const r = ouvrirSurTerminal(intacte);
    assert.equal(r.issue, null, `le montage sain doit aboutir ; ${JSON.stringify(r.issue)}`);
    assert.equal(r.archiveExiste, true, "le terminal doit avoir été archivé");
    assert.equal(r.successeurCree, true, "et un successeur distinct doit être né");
  } finally {
    rmSync(intacte, { recursive: true, force: true });
  }
});


/*
 * L'équivalence v2, dans le sens que l'étape 1 ne pouvait pas fermer.
 *
 *     status ∈ {completed, abandoned} ⇔ ended est présent
 *
 * Le sens « ended présent → statut terminal concordant » était déjà tenu. L'autre ne
 * pouvait pas l'être tant que le setter général produisait des statuts terminaux sans
 * fin. Il se ferme au même changement que sa garde, et il se vérifie ici : sans quoi la
 * fermeture serait décorative, et son retrait ne ferait rougir personne.
 */
function poserManifesteBrut(dir: string, champs: Record<string, unknown>): void {
  const courant = readManifest(dir);
  assert.ok(courant, "PRÉCONDITION — un manifeste actif doit exister");
  const doc = { ...courant, ...champs } as Record<string, unknown>;
  for (const [cle, valeur] of Object.entries(champs)) {
    if (valeur === undefined) delete doc[cle];
  }
  writeFileSync(join(dir, "active-run.json"), `${JSON.stringify(doc, null, 2)}\n`);
}

test("manifeste v2 — un run terminal sans sa fin est illisible, et le même avec sa fin se lit", () => {
  const sansFin = dossier();
  try {
    openRun(sansFin.dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
    poserManifesteBrut(sansFin.dir, { status: "completed", ended: undefined });
    const avant = readFileSync(join(sansFin.dir, "active-run.json"), "utf-8");
    assert.equal(JSON.parse(avant).version, 2, "PRÉCONDITION — le manifeste doit être en v2");
    assert.equal(JSON.parse(avant).ended, undefined, "PRÉCONDITION — et ne porter aucune fin");

    assert.throws(
      () => readManifest(sansFin.dir),
      /un run est terminal si et seulement s'il porte sa fin/,
      "ne pas savoir qui a terminé, quand et pourquoi, c'est ne pas savoir si le run est terminé",
    );
    // Non réinscriptible : aucune surface publique ne peut le reprendre.
    assert.throws(() => openRun(sansFin.dir, "cbf7015a57b5e296d7c964790bb4989c4380da25"), /porte sa fin/);
    assert.equal(
      readFileSync(join(sansFin.dir, "active-run.json"), "utf-8"),
      avant,
      "et le refus ne modifie rien",
    );
  } finally {
    sansFin.done();
  }

  // Témoin positif : le MÊME terminal, avec sa fin, se lit et s'archive.
  const avecFin = dossier();
  try {
    const { manifest } = openRun(avecFin.dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
    poserTerminal(avecFin.dir, "completed");
    assert.equal(readManifest(avecFin.dir)!.status, "completed");
    const suivant = openRun(avecFin.dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
    assert.notEqual(suivant.manifest.runId, manifest.runId, "et la succession a lieu");
  } finally {
    avecFin.done();
  }
});


/*
 * La reprise d'une transition interrompue, et son idempotence.
 *
 * L'étape 3 a rendu le terminal DURABLE avant l'archive : la fenêtre
 * terminal → link → unlink existe, et une coupure dedans laisse un état reprenable.
 * Reprendre n'est pas terminer une seconde fois — la fin déjà posée n'est jamais réécrite.
 */

/** Un run v2 dont le manifeste actif est terminal et conforme, sans propriétaire. */
function runDejaTerminal(outcome: "completed" | "abandoned" = "completed"): {
  dir: string;
  done: () => void;
  m: RunManifest;
} {
  const { dir, done, m } = runTerminable();
  const terminal = poserTerminal(dir, outcome, "fin d'origine");
  return { dir, done, m: terminal };
}

test("reprise — un terminal publié sans archive est archivé, et sa fin n'est pas réécrite", () => {
  const { dir, done, m } = runDejaTerminal();
  try {
    assert.equal(existsSync(archivePath(dir, m.runId)), false, "PRÉCONDITION — aucune archive avant la reprise");
    const finPosee = JSON.stringify(m.ended);

    const repris = terminerRun(dir, m.runId, { by: "quelqu-un-d-autre", outcome: "completed" });

    assert.equal(JSON.stringify(repris.ended), finPosee, "la fin d'origine est conservée, pas remplacée");
    assert.equal(repris.ended?.by, "fixture", "ni le by de la reprise, ni son instant");
    assert.ok(existsSync(archivePath(dir, m.runId)), "l'archive manquante est posée");
    assert.equal(existsSync(join(dir, "active-run.json")), false, "et le manifeste actif est libéré");
    assert.equal(JSON.parse(readFileSync(archivePath(dir, m.runId), "utf-8")).ended.by, "fixture");
  } finally {
    done();
  }
});

test("reprise — rejouée sur une archive identique, elle conclut sans rien réécrire", () => {
  const { dir, done, m } = runDejaTerminal();
  try {
    // L'état canonique du crash entre link et unlink : archive posée, actif encore là.
    const chemin = archivePath(dir, m.runId);
    const actif = join(dir, "active-run.json");
    writeFileSync(chemin, readFileSync(actif, "utf-8"));
    const contenu = readFileSync(chemin, "utf-8");
    const avantId = identite(chemin);

    const repris = terminerRun(dir, m.runId, { by: "operator", outcome: "completed" });

    assert.equal(repris.status, "completed");
    assert.equal(readFileSync(chemin, "utf-8"), contenu, "l'archive n'est pas réécrite");
    assert.deepEqual(identite(chemin), avantId, "ni même touchée : dev, ino, mtimeNs, ctimeNs, taille");
    assert.equal(existsSync(actif), false, "et la fenêtre se referme : actif libéré");
  } finally {
    done();
  }
});

test("reprise — elle ne change pas l'issue, et l'issue concordante aboutit", () => {
  const contradictoire = runDejaTerminal("completed");
  try {
    const actif = join(contradictoire.dir, "active-run.json");
    const avant = readFileSync(actif, "utf-8");
    assert.throws(
      () => terminerRun(contradictoire.dir, contradictoire.m.runId, { by: "operator", outcome: "abandoned", reason: "r" }),
      /porte déjà une fin completed/,
      "une reprise conclut la transition commencée, elle n'en change pas l'issue",
    );
    assert.equal(readFileSync(actif, "utf-8"), avant, "et le refus ne modifie rien");
    assert.equal(existsSync(archivePath(contradictoire.dir, contradictoire.m.runId)), false, "ni n'archive");
  } finally {
    contradictoire.done();
  }

  // Témoin positif : le MÊME montage, avec l'issue concordante, aboutit.
  const concordante = runDejaTerminal("abandoned");
  try {
    /*
     * Une reprise `abandoned` reste un abandon demandé : elle exige sa raison. Que la
     * raison CONSERVÉE soit celle d'origine ne dispense pas d'en fournir une — c'est la
     * demande qui doit être motivée, pas seulement l'archive.
     */
    const actif = join(concordante.dir, "active-run.json");
    const avant = readFileSync(actif, "utf-8");
    assert.throws(
      () => terminerRun(concordante.dir, concordante.m.runId, { by: "operator", outcome: "abandoned" }),
      /ne s'accorde pas sans raison/,
    );
    assert.equal(readFileSync(actif, "utf-8"), avant, "et ce refus ne modifie rien");
    assert.equal(existsSync(archivePath(concordante.dir, concordante.m.runId)), false, "ni n'archive");

    const repris = terminerRun(concordante.dir, concordante.m.runId, { by: "operator", outcome: "abandoned", reason: "autre raison" });
    assert.equal(repris.ended?.reason, "fin d'origine", "et la raison d'origine reste la sienne");
    assert.ok(existsSync(archivePath(concordante.dir, concordante.m.runId)));
  } finally {
    concordante.done();
  }
});


/*
 * La perte de bail : ce que le signal a le droit de trouver derrière lui.
 *
 * La preuve L0 `C-P1-F09` établit qu'une panne de maintien signale au lieu de tuer le
 * processus. Le plan exige deux choses de plus, qu'aucune preuve n'atteignait :
 * la capacité doit être révoquée AVANT le signal, et le signal reste unique même si son
 * écriture échoue.
 */

/** Un run possédé dont le fichier de battement est devenu inécrivable. */
function bailQuiVaSePerdre(): { dir: string; done: () => void; lease: Lease } {
  const { dir, done } = dossier();
  const { manifest } = openRun(dir, "cbf7015a57b5e296d7c964790bb4989c4380da25");
  const lease = own(dir, manifest.runId);
  const hb = join(dir, `${manifest.runId}.lease`, `hb-${lease.leaseId}`);
  assert.ok(existsSync(hb), "PRÉCONDITION — le battement initial doit exister");
  rmSync(hb);
  mkdirSync(hb); // la prochaine écriture rendra EISDIR
  return { dir, done, lease };
}

test("perte de bail — la capacité entière est révoquée AVANT le signal, pas après", (t) => {
  const { dir, done, lease } = bailQuiVaSePerdre();
  try {
    /*
     * Le gestionnaire tente une mutation, comme le ferait un vrai : arrêter des enfants,
     * journaliser, remonter un refus. S'il peut encore écrire, la fenêtre existe.
     */
    let mutationPendantLeSignal: string | undefined;
    t.mock.timers.enable({ apis: ["setInterval"] });
    const battement = startHeartbeat(dir, lease, () => {
      try {
        allocateSeq(dir, lease);
        mutationPendantLeSignal = "la mutation a ABOUTI";
      } catch (err) {
        mutationPendantLeSignal = `refusée : ${(err as Error).constructor.name}`;
      }
    }, 10);
    t.mock.timers.tick(35);
    battement.stop();

    assert.equal(
      mutationPendantLeSignal,
      "refusée : NotOwnerError",
      "le gestionnaire ne doit plus rien pouvoir muter : révoquer après le signal laisserait " +
        "la fenêtre ouverte pendant tout son travail",
    );
    // Et la révocation survit au signal : ce qui vient après ne mute pas davantage.
    assert.throws(() => allocateSeq(dir, lease), /révoquée après une perte de bail/);

    /*
     * La révocation ne ferme pas seulement les mutateurs qui passent par `assertOwner`.
     * Rebattre maintiendrait vivant un bail inutilisable ; le libérer le rendrait
     * reprenable par un tiers ; le réacquérir sous la même session ferait les deux.
     */
    const owner = join(dir, `${lease.runId}.lease`, "owner.json");
    const ownerApresSignal = readFileSync(owner, "utf-8");
    assert.equal(heartbeatRun(dir, lease), false, "une capacité révoquée ne rebat plus");
    assert.equal(
      releaseRunOwnership(dir, lease),
      false,
      "une capacité révoquée ne libère pas le bail qu'elle ne sait plus prouver",
    );
    const reacquisition = acquireRunOwnership(dir, lease.runId, lease.sessionId);
    assert.equal(reacquisition.ok, false, "le même leaseId révoqué ne doit pas être réacquis");
    if (!reacquisition.ok) {
      assert.equal(reacquisition.kind, "recovery-required");
    }
    assert.equal(
      readFileSync(owner, "utf-8"),
      ownerApresSignal,
      "battement, libération et réacquisition refusés doivent laisser owner.json intact",
    );
  } finally {
    done();
  }
});

test("perte de bail — le signal reste unique par capacité, même si son écriture échoue", (t) => {
  const { dir, done, lease } = bailQuiVaSePerdre();
  try {
    let appels = 0;
    t.mock.timers.enable({ apis: ["setInterval"] });
    const signal = () => {
      appels += 1;
      throw new Error("l'écriture du signal a échoué");
    };
    // Deux contrôleurs sur la même capacité : `clearInterval` ne suffit pas à rendre le
    // signal unique entre eux. La transition de révocation, elle, est commune.
    const battementA = startHeartbeat(dir, lease, signal, 10);
    const battementB = startHeartbeat(dir, lease, signal, 10);

    assert.doesNotThrow(() => t.mock.timers.tick(100), "un gestionnaire qui lève ne doit pas sortir du timer");
    battementA.stop();
    battementB.stop();

    assert.equal(
      appels,
      1,
      "deux pertes annoncées pour une seule perte réelle, et la seconde arriverait sur un " +
        "monde que la première a déjà changé",
    );
  } finally {
    done();
  }
});

// ================================================= registre des lanes v2 : la grammaire (LOT 2, étape 1)

/*
 * Chaque cas écrit un registre `{"ledger":2}` fait d'une ligne témoin valide puis d'une
 * ligne à juger, et vérifie les deux : la ligne témoin lue, la ligne jugée lue ou comptée
 * abîmée à son numéro. Un lecteur qui refuserait tout échouerait sur le témoin ; un
 * lecteur qui accepterait tout échouerait sur la ligne jugée.
 */
const RV2 = "run-v2";
const enveloppe = (seq: number, reste: Record<string, unknown>): Record<string, unknown> => ({
  event_seq: seq, work_unit: "W03", lane: `${RV2}-W03-g1`, at: "2026-09-16T00:00:00Z", ...reste,
});
const valides: Record<string, Record<string, unknown>> = {
  OPENED: { event: "OPENED", base: "b1", generation: 1 },
  REVIEWED: {
    event: "REVIEWED", from_tree: "t0", tree: "t1", verdict: "approved",
    reviewer: { delegation_seq: 2, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" },
  },
  VIOLATION: {
    event: "VIOLATION", kind: "reserved-violation", paths: ["DESIGN.md", "src/a.py"],
    source: { delegation_seq: 3, agent: "worker" }, observed_tree: "t1",
  },
  RISK: { event: "RISK", id: "r1", transition: "opened", by: "reviewer" },
  FROZEN: { event: "FROZEN", commit: "c1", parent: "b1", tree: "t1", reviewed_event_seq: 2 },
  MERGED: { event: "MERGED", integration_commit: "i1", frozen_event_seq: 5 },
  INTEGRATED: { event: "INTEGRATED", integration_commit: "i1", status: { outcome: "not-applicable" } },
  ABANDONED: { event: "ABANDONED", by: "operator", reason: "essai", generation: 1 },
};

function lireV2(lignes: Record<string, unknown>[], entete: Record<string, unknown> = { ledger: 2 }) {
  const { dir, done } = dossier();
  try {
    const corps = lignes.map((l) => JSON.stringify(l));
    writeFileSync(laneLedgerPath(dir, RV2), `${[JSON.stringify(entete), ...corps].join("\n")}\n`);
    return readLaneEvents(dir, RV2);
  } finally {
    done();
  }
}

/** La ligne jugée, précédée du témoin OPENED valide. */
function juger(ligne: Record<string, unknown>) {
  const lu = lireV2([enveloppe(1, valides.OPENED), ligne]);
  assert.equal(lu.version, LANE_LEDGER_V2);
  assert.equal(lu.events.length >= 1 && lu.events[0].event === "OPENED", true, "le témoin OPENED doit être lu");
  return lu;
}
function accepte(ligne: Record<string, unknown>, quoi: string): void {
  const lu = juger(ligne);
  assert.deepEqual(lu.malformedLines, [], `${quoi} : aucune ligne abîmée attendue`);
  assert.equal(lu.events.length, 2, `${quoi} : la ligne doit être lue`);
}
function refuse(ligne: Record<string, unknown>, quoi: string): void {
  const lu = juger(ligne);
  assert.deepEqual(lu.malformedLines, [3], `${quoi} : la ligne 3 doit être comptée abîmée`);
  assert.equal(lu.malformed, 1, quoi);
  assert.equal(lu.events.length, 1, `${quoi} : la ligne ne doit pas être lue`);
}
const sans = (o: Record<string, unknown>, cle: string): Record<string, unknown> => {
  const copie = { ...o };
  delete copie[cle];
  return copie;
};

test("registre v2 : les huit natures de § F se lisent, dans l'ordre, sans ligne abîmée", () => {
  const natures = Object.keys(valides);
  const lu = lireV2(natures.map((n, i) => enveloppe(i + 1, valides[n])));
  assert.equal(lu.version, LANE_LEDGER_V2);
  assert.deepEqual(lu.malformedLines, []);
  assert.deepEqual(lu.events.map((e) => e.event), natures);
});

test("registre v2 : l'enveloppe est exigée champ par champ", () => {
  const ligne = enveloppe(2, valides.REVIEWED);
  accepte(ligne, "enveloppe complète");
  for (const cle of ["event_seq", "work_unit", "lane", "at"]) refuse(sans(ligne, cle), `sans ${cle}`);
  refuse({ ...ligne, event_seq: 0 }, "event_seq nul");
  refuse({ ...ligne, event_seq: 1.5 }, "event_seq non entier");
  refuse({ ...ligne, event_seq: "2" }, "event_seq chaîne");
  refuse({ ...ligne, work_unit: "" }, "work_unit vide");
});

test("registre v2 : une nature inconnue, ou un tableau, est une ligne abîmée", () => {
  refuse(enveloppe(2, { event: "STILL_OPEN" }), "nature inconnue");
  refuse(enveloppe(2, sans(valides.RISK, "event")), "nature absente");
  const { dir, done } = dossier();
  try {
    writeFileSync(laneLedgerPath(dir, RV2), `{"ledger":2}\n${JSON.stringify(enveloppe(1, valides.OPENED))}\n[1,2]\nnull\n`);
    assert.deepEqual(readLaneEvents(dir, RV2).malformedLines, [3, 4]);
  } finally {
    done();
  }
});

test("registre v2 : champs obligatoires et types exacts, nature par nature", () => {
  const cas: Array<[string, string]> = [
    ["OPENED", "base"], ["OPENED", "generation"],
    ["REVIEWED", "from_tree"], ["REVIEWED", "tree"], ["REVIEWED", "verdict"],
    ["REVIEWED", "reviewer"], ["REVIEWED", "proof"],
    ["VIOLATION", "kind"], ["VIOLATION", "paths"], ["VIOLATION", "source"], ["VIOLATION", "observed_tree"],
    ["RISK", "id"], ["RISK", "transition"],
    ["FROZEN", "commit"], ["FROZEN", "parent"], ["FROZEN", "tree"], ["FROZEN", "reviewed_event_seq"],
    ["MERGED", "integration_commit"], ["MERGED", "frozen_event_seq"],
    ["INTEGRATED", "integration_commit"], ["INTEGRATED", "status"],
    ["ABANDONED", "by"], ["ABANDONED", "reason"], ["ABANDONED", "generation"],
  ];
  for (const [nature, champ] of cas) {
    accepte(enveloppe(2, valides[nature]), `${nature} complet`);
    refuse(enveloppe(2, sans(valides[nature], champ)), `${nature} sans ${champ}`);
  }
  refuse(enveloppe(2, { ...valides.OPENED, generation: 0 }), "génération nulle");
  refuse(enveloppe(2, { ...valides.ABANDONED, generation: "1" }), "génération chaîne");
  refuse(enveloppe(2, { ...valides.FROZEN, reviewed_event_seq: 0 }), "renvoi REVIEWED nul");
  refuse(enveloppe(2, { ...valides.MERGED, frozen_event_seq: "5" }), "renvoi FROZEN chaîne");
  refuse(enveloppe(2, { ...valides.OPENED, base: "" }), "base vide");
});

test("registre v2 : l'identité du reviewer et le mode de preuve", () => {
  const r = valides.REVIEWED;
  const reviewer = r.reviewer as Record<string, unknown>;
  for (const cle of ["delegation_seq", "agent", "role"]) {
    refuse(enveloppe(2, { ...r, reviewer: sans(reviewer, cle) }), `reviewer sans ${cle}`);
  }
  refuse(enveloppe(2, { ...r, reviewer: { ...reviewer, delegation_seq: 0 } }), "delegation_seq nul");
  refuse(enveloppe(2, { ...r, reviewer: "reviewer" }), "reviewer chaîne");
  accepte(enveloppe(2, { ...r, proof: { mode: "none" } }), "preuve none");
  accepte(enveloppe(2, { ...r, proof: { mode: "reading-list", paths: ["src/a.py"] } }), "reading-list avec paths");
  refuse(enveloppe(2, { ...r, proof: { mode: "reading-list" } }), "reading-list sans paths");
  refuse(enveloppe(2, { ...r, proof: { mode: "reading-list", paths: [] } }), "reading-list aux paths vides");
  refuse(enveloppe(2, { ...r, proof: { mode: "sampled" } }), "mode inconnu");
  refuse(enveloppe(2, { ...r, proof: { mode: "diff", paths: ["../x"] } }), "paths facultatifs mais faux");
});

test("registre v2 : une violation porte des chemins canoniques, triés, uniques", () => {
  const v = valides.VIOLATION;
  refuse(enveloppe(2, { ...v, kind: "scope-breach" }), "scope-breach n'est pas une violation historique");
  for (const [paths, quoi] of [
    [["src/a.py", "DESIGN.md"], "non triés"],
    [["DESIGN.md", "DESIGN.md"], "doublon"],
    [["/etc/passwd"], "absolu"],
    [["src/../DESIGN.md"], "segment .."],
    [["./DESIGN.md"], "segment ."],
    [["src//a.py"], "segment vide"],
    [["src\\a.py"], "barre inverse"],
    [[""], "chemin vide"],
    [[], "liste vide"],
    ["DESIGN.md", "chaîne au lieu d'une liste"],
  ] as Array<[unknown, string]>) {
    refuse(enveloppe(2, { ...v, paths }), `chemins ${quoi}`);
  }
  const source = v.source as Record<string, unknown>;
  refuse(enveloppe(2, { ...v, source: sans(source, "agent") }), "source sans agent");
  refuse(enveloppe(2, { ...v, source: sans(source, "delegation_seq") }), "source sans delegation_seq");
});

test("registre v2 : un risque a une transition connue, et exactement un de by ou to", () => {
  const k = valides.RISK;
  accepte(enveloppe(2, { ...k, transition: "routed", by: undefined, to: "scout" }), "routed vers");
  accepte(enveloppe(2, { ...k, transition: "resolved" }), "resolved par");
  refuse(enveloppe(2, { ...k, transition: "ignored" }), "ignored");
  refuse(enveloppe(2, { ...k, transition: "still-open" }), "still-open");
  refuse(enveloppe(2, { ...k, to: "scout" }), "by et to");
  refuse(enveloppe(2, sans(k, "by")), "ni by ni to");
  refuse(enveloppe(2, { ...k, by: "" }), "by vide");
});

test("registre v2 : le Statut d'une intégration n'a que trois issues, à clés exactes", () => {
  const i = valides.INTEGRATED;
  const u = { outcome: "unchanged", decision_id: "D-01", target_status: "done" };
  const c = { ...u, outcome: "committed", status_commit: "s1" };
  accepte(enveloppe(2, { ...i, status: u }), "unchanged");
  accepte(enveloppe(2, { ...i, status: c }), "committed");
  refuse(enveloppe(2, { ...i, status: { outcome: "not-applicable", status_commit: "s1" } }), "not-applicable avec commit");
  refuse(enveloppe(2, { ...i, status: { ...u, status_commit: "s1" } }), "unchanged avec commit");
  refuse(enveloppe(2, { ...i, status: sans(c, "status_commit") }), "committed sans commit");
  refuse(enveloppe(2, { ...i, status: sans(u, "decision_id") }), "unchanged sans décision");
  refuse(enveloppe(2, { ...i, status: sans(u, "target_status") }), "unchanged sans cible");
  refuse(enveloppe(2, { ...i, status: { outcome: "merged" } }), "issue inconnue");
  // Une clé présente mais vide n'est pas une clé renseignée ; une clé en trop change l'issue.
  refuse(enveloppe(2, { ...i, status: { ...u, decision_id: "" } }), "unchanged à décision vide");
  refuse(enveloppe(2, { ...i, status: { ...u, target_status: 3 } }), "unchanged à cible numérique");
  refuse(enveloppe(2, { ...i, status: { ...c, status_commit: "" } }), "committed à commit vide");
  refuse(enveloppe(2, { ...i, status: { ...c, decision_id: "" } }), "committed à décision vide");
  refuse(enveloppe(2, { ...i, status: { ...c, note: "x" } }), "committed avec clé en trop");
  refuse(enveloppe(2, { ...i, status: "not-applicable" }), "statut chaîne");
});

test("registre des lanes : l'en-tête choisit la grammaire, et la v1 reste inchangée", () => {
  // Une ouverture v1 authentique : lue sous v1, abîmée sous v2.
  const v1 = { event: "OPENED", work_unit: "W03", at: "2026-09-16T00:00:00Z", base: "b1" };
  const { dir, done } = dossier();
  try {
    const ecrire = (entete: string, ...lignes: unknown[]) =>
      writeFileSync(laneLedgerPath(dir, RV2), `${[entete, ...lignes.map((l) => JSON.stringify(l))].join("\n")}\n`);
    ecrire(`{"ledger":1}`, v1);
    let lu = readLaneEvents(dir, RV2);
    assert.deepEqual([lu.version, lu.events.length, lu.malformedLines], [1, 1, []], "v1 lue en v1");
    ecrire(`{"ledger":2}`, v1);
    lu = readLaneEvents(dir, RV2);
    assert.deepEqual([lu.version, lu.events.length, lu.malformedLines], [2, 0, [2]], "v1 refusée en v2");
    // Une revue v2 : lue sous v2, abîmée sous v1 — les deux grammaires ne se mêlent pas.
    ecrire(`{"ledger":2}`, enveloppe(1, valides.REVIEWED));
    assert.deepEqual(readLaneEvents(dir, RV2).malformedLines, [], "REVIEWED lu en v2");
    ecrire(`{"ledger":1}`, enveloppe(1, valides.REVIEWED));
    assert.deepEqual(readLaneEvents(dir, RV2).malformedLines, [2], "REVIEWED refusé en v1");
    // Un en-tête ailleurs qu'en première ligne n'en est pas un.
    ecrire(`{"ledger":2}`, enveloppe(1, valides.OPENED), { ledger: 2 });
    assert.deepEqual(readLaneEvents(dir, RV2).malformedLines, [3], "second en-tête abîmé");
  } finally {
    done();
  }
});

test("parseLaneEventV2 rend null, sans lever, pour ce qui n'est pas un objet", () => {
  for (const v of [null, undefined, 42, "OPENED", [], [enveloppe(1, valides.OPENED)]]) {
    assert.equal(parseLaneEventV2(v), null, `valeur ${JSON.stringify(v)}`);
  }
  assert.notEqual(parseLaneEventV2(enveloppe(1, valides.OPENED)), null, "le témoin objet est lu");
  // Un sous-objet nul se refuse sans lever : la fonction ne compte pas sur le catch du lecteur.
  const nuls: Array<[string, Record<string, unknown>]> = [
    ["reviewer", { ...valides.REVIEWED, reviewer: null }],
    ["proof", { ...valides.REVIEWED, proof: null }],
    ["source", { ...valides.VIOLATION, source: null }],
    ["status", { ...valides.INTEGRATED, status: null }],
  ];
  for (const [quoi, ligne] of nuls) {
    assert.doesNotThrow(() => parseLaneEventV2(enveloppe(2, ligne)), `${quoi} nul ne doit pas lever`);
    assert.equal(parseLaneEventV2(enveloppe(2, ligne)), null, `${quoi} nul`);
  }
});

/*
 * L'écrivain reste v1 (C4.9). Cette borne est un type, pas un contrôle : aucune exécution
 * ne la voit. La directive ci-dessous la rend mesurable — si `appendLaneEvent` acceptait
 * une nature v2, la directive deviendrait inutile et le compilateur le signalerait, ce
 * que S4 refuse comme diagnostic nouveau. La fonction n'est jamais appelée.
 */
export function ecrivainBorneALaV1(dir: string, lease: Lease): void {
  // Une revue v2 bien typée : la seule erreur attendue est celle de l'écrivain.
  const revue: LaneEventV2 = {
    event_seq: 1, work_unit: "W03", lane: `${RV2}-W03-g1`, at: "2026-09-16T00:00:00Z",
    event: "REVIEWED", from_tree: "t0", tree: "t1", verdict: "approved",
    reviewer: { delegation_seq: 2, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" },
  };
  // @ts-expect-error — REVIEWED est une nature v2, que l'écrivain n'a pas le droit d'écrire
  appendLaneEvent(dir, revue, lease);
}

// ================================================= états C4 : la matrice C4.9 (LOT 2, étape 2)

/*
 * Chaque ligne de la matrice a son cas, et chaque cas nomme sa ligne. La forme d'un
 * snapshot se décrit par ce que le lecteur rend : présence, version d'en-tête, nombre
 * d'événements et de lignes abîmées.
 */
const forme = (present: boolean, version: number | undefined, events = 0, abimees = 0): LedgerShape => ({
  present, version, events: Array(events).fill({}), malformedLines: Array.from({ length: abimees }, (_, i) => i + 2),
});
const ABSENT = forme(false, 1);
const VIDE = forme(true, undefined);
const SANS_ENTETE = forme(true, undefined, 1);
const SANS_ENTETE_ABIME = forme(true, undefined, 0, 1);
const t2 = (ledgers: Record<string, number> = {}): LedgerWitnesses => ({ manifestVersion: 2, ledgers });
const T1: LedgerWitnesses = { manifestVersion: 1, ledgers: {} };

test("C4.9 lanes : chaque ligne de la matrice porte son état", () => {
  const cas: Array<[string, LedgerWitnesses | null, LedgerShape, string]> = [
    ["0  manifeste illisible ou absent", null, forme(true, 1, 1), "UNKNOWN"],
    ["1  v2, absent, témoin", t2({ lanes: 2 }), ABSENT, "LOST"],
    ["1  v2, absent, témoin v1", t2({ lanes: 1 }), ABSENT, "LOST"],
    ["2  v2, absent, sans témoin", t2(), ABSENT, "EMPTY"],
    ["2  v2, absent, témoin d'un autre registre", t2({ integrations: 1 }), ABSENT, "EMPTY"],
    ["3  v2, vide", t2(), VIDE, "UNKNOWN"],
    ["4  v2, sans en-tête", t2(), SANS_ENTETE, "MIGRATION_REQUIRED"],
    ["4  v2, sans en-tête, témoin", t2({ lanes: 2 }), SANS_ENTETE, "MIGRATION_REQUIRED"],
    ["4  v2, sans en-tête, lignes abîmées", t2(), SANS_ENTETE_ABIME, "MIGRATION_REQUIRED"],
    ["5  v2, en-tête v2, sans témoin", t2(), forme(true, 2, 1), "KNOWN"],
    ["5  v2, en-tête v1, sans témoin (hybride)", t2(), forme(true, 1, 1), "KNOWN"],
    ["5  v2, en-tête seul", t2(), forme(true, 2), "KNOWN"],
    ["6  v2, en-tête v2, témoin 2", t2({ lanes: 2 }), forme(true, 2, 1), "KNOWN"],
    ["6  v2, en-tête v1, témoin 1", t2({ lanes: 1 }), forme(true, 1, 1), "KNOWN"],
    ["7  v2, en-tête v1, témoin 2", t2({ lanes: 2 }), forme(true, 1, 1), "UNKNOWN"],
    ["7  v2, en-tête v2, témoin 1", t2({ lanes: 1 }), forme(true, 2, 1), "UNKNOWN"],
    ["8  v2, en-tête v2, ligne abîmée", t2(), forme(true, 2, 1, 1), "UNKNOWN"],
    ["8  v2, en-tête v1, ligne abîmée", t2(), forme(true, 1, 1, 1), "UNKNOWN"],
    ["9  v2, en-tête 99", t2(), forme(true, 99, 1), "UNKNOWN"],
    ["9  v2, en-tête 99, témoin 99", t2({ lanes: 99 }), forme(true, 99, 1), "UNKNOWN"],
    ["10 v1, absent", T1, ABSENT, "RUN_WITHOUT_WITNESS"],
    ["11 v1, vide", T1, VIDE, "UNKNOWN"],
    ["12 v1, sans en-tête", T1, SANS_ENTETE, "MIGRATION_REQUIRED"],
    ["13 v1, en-tête v1", T1, forme(true, 1, 1), "KNOWN"],
    ["13 v1, en-tête seul", T1, forme(true, 1), "KNOWN"],
    ["14 v1, en-tête v1, ligne abîmée", T1, forme(true, 1, 1, 1), "UNKNOWN"],
    ["15 v1, en-tête v2", T1, forme(true, 2, 1), "RUN_WITHOUT_WITNESS"],
    ["15 v1, en-tête 99, ligne abîmée", T1, forme(true, 99, 1, 1), "RUN_WITHOUT_WITNESS"],
  ];
  const faux = cas.filter(([, t, lu, attendu]) => laneLedgerState(t, lu) !== attendu)
    .map(([nom, t, lu, attendu]) => `${nom} : ${laneLedgerState(t, lu)} au lieu de ${attendu}`);
  assert.deepEqual(faux, []);
});

test("C4.9 intégrations : chaque ligne de la matrice porte son état", () => {
  const cas: Array<[string, LedgerWitnesses | null, LedgerShape, string, string]> = [
    ["0  manifeste illisible ou absent", null, forme(true, 1, 1), "KNOWN", "UNKNOWN"],
    ["1  lanes LOST", t2(), forme(true, 1, 1), "LOST", "UNKNOWN"],
    ["1  lanes MIGRATION_REQUIRED", t2(), forme(true, 1, 1), "MIGRATION_REQUIRED", "UNKNOWN"],
    ["1  lanes RUN_WITHOUT_WITNESS", T1, forme(true, 1, 1), "RUN_WITHOUT_WITNESS", "UNKNOWN"],
    ["1  lanes UNKNOWN", t2(), ABSENT, "UNKNOWN", "UNKNOWN"],
    ["2  v2, absent, témoin", t2({ integrations: 1 }), ABSENT, "KNOWN", "LOST"],
    ["3  v2, absent, sans témoin", t2({ lanes: 2 }), ABSENT, "KNOWN", "EMPTY"],
    ["3  v2, absent, lanes EMPTY", t2(), ABSENT, "EMPTY", "EMPTY"],
    ["4  v2, vide", t2(), VIDE, "KNOWN", "UNKNOWN"],
    ["5  v2, sans en-tête", t2({ integrations: 1 }), SANS_ENTETE, "KNOWN", "MIGRATION_REQUIRED"],
    ["6  v2, en-tête v1, sans témoin", t2(), forme(true, 1, 1), "KNOWN", "KNOWN"],
    ["6  v2, en-tête v1, témoin 1", t2({ integrations: 1 }), forme(true, 1, 1), "KNOWN", "KNOWN"],
    ["7  v2, en-tête v1, témoin 2", t2({ integrations: 2 }), forme(true, 1, 1), "KNOWN", "UNKNOWN"],
    ["8  v2, ligne abîmée", t2(), forme(true, 1, 1, 1), "KNOWN", "UNKNOWN"],
    ["8  v2, en-tête 2", t2(), forme(true, 2, 1), "KNOWN", "UNKNOWN"],
    ["9  v1, absent", T1, ABSENT, "KNOWN", "RUN_WITHOUT_WITNESS"],
    ["10 v1, vide", T1, VIDE, "KNOWN", "UNKNOWN"],
    ["11 v1, sans en-tête", T1, SANS_ENTETE, "KNOWN", "MIGRATION_REQUIRED"],
    ["12 v1, en-tête v1", T1, forme(true, 1, 1), "KNOWN", "KNOWN"],
    ["13 v1, ligne abîmée", T1, forme(true, 1, 1, 1), "KNOWN", "UNKNOWN"],
    ["13 v1, en-tête 2 et ligne abîmée", T1, forme(true, 2, 1, 1), "KNOWN", "UNKNOWN"],
    ["14 v1, en-tête 2", T1, forme(true, 2, 1), "KNOWN", "RUN_WITHOUT_WITNESS"],
  ];
  const faux = cas
    .filter(([, t, lu, lanes, attendu]) => integrationLedgerState(t, lu, lanes as "KNOWN") !== attendu)
    .map(([nom, t, lu, lanes, attendu]) =>
      `${nom} : ${integrationLedgerState(t, lu, lanes as "KNOWN")} au lieu de ${attendu}`);
  assert.deepEqual(faux, []);
});

test("C4.9 : un snapshot sans présence observée est UNKNOWN, jamais « absent »", () => {
  const incomplet = { version: 1, events: [], malformedLines: [] } as unknown as LedgerShape;
  const nonBooleen = { ...ABSENT, present: "non" } as unknown as LedgerShape;
  for (const lu of [incomplet, nonBooleen]) {
    assert.equal(laneLedgerState(t2(), lu), "UNKNOWN");
    assert.equal(laneLedgerState(T1, lu), "UNKNOWN");
    assert.equal(integrationLedgerState(t2(), lu, "KNOWN"), "UNKNOWN");
    assert.equal(integrationLedgerState(T1, lu, "KNOWN"), "UNKNOWN");
  }
  // Témoin : la même forme, présence renseignée, n'est pas UNKNOWN.
  assert.equal(laneLedgerState(t2(), ABSENT), "EMPTY");
  assert.equal(integrationLedgerState(T1, ABSENT, "KNOWN"), "RUN_WITHOUT_WITNESS");
});

test("C4.9 : la présence est observée par le lecteur, et une erreur de lecture n'est pas une absence", () => {
  const { dir, done } = dossier();
  try {
    assert.equal(readLaneEvents(dir, "r").present, false, "lanes absent");
    assert.equal(readIntegrationEvents(dir, "r").present, false, "intégrations absent");
    writeFileSync(laneLedgerPath(dir, "r"), "");
    writeFileSync(integrationLedgerPath(dir, "r"), "");
    assert.equal(readLaneEvents(dir, "r").present, true, "lanes vide mais présent");
    assert.equal(readIntegrationEvents(dir, "r").present, true, "intégrations vide mais présent");
    // Un répertoire à la place du fichier : une erreur de lecture, qui remonte.
    mkdirSync(laneLedgerPath(dir, "s"));
    mkdirSync(integrationLedgerPath(dir, "s"));
    assert.throws(() => readLaneEvents(dir, "s"), /EISDIR/);
    assert.throws(() => readIntegrationEvents(dir, "s"), /EISDIR/);
  } finally {
    done();
  }
});

test("C4.9 ligne 0 : les témoins se relisent du manifeste du même run, sinon null", () => {
  const { dir, done } = dossier();
  try {
    assert.equal(readWitnesses(dir, "r"), null, "manifeste absent");
    writeFileSync(join(dir, "active-run.json"), "{ illisible");
    assert.equal(readWitnesses(dir, "r"), null, "manifeste illisible");
    writeFileSync(join(dir, "active-run.json"),
      JSON.stringify({ version: 2, runId: "r", status: "active", nextSeq: 1, ledgers: { lanes: 2 } }));
    assert.equal(readWitnesses(dir, "autre"), null, "manifeste d'un autre run");
    assert.deepEqual(readWitnesses(dir, "r"), { manifestVersion: 2, ledgers: { lanes: 2 } });
    writeFileSync(join(dir, "active-run.json"),
      JSON.stringify({ version: 1, runId: "r", status: "active", nextSeq: 1 }));
    assert.deepEqual(readWitnesses(dir, "r"), { manifestVersion: 1, ledgers: {} });
  } finally {
    done();
  }
});

test("P3 : observeLanes relit le manifeste de sa racine, et refuse sans lui", () => {
  const { dir: root, done } = dossier();
  try {
    mkdirSync(join(root, RUNS_DIR));
    const runs = join(root, RUNS_DIR);
    const lu = { events: [], malformedLines: [], version: 1, present: false };
    const observer = (runId: string) => observeLanes({ root, runId, laneRead: lu });
    let vu = observer("r");
    assert.deepEqual([vu.state, vu.usable], ["UNKNOWN", false], "manifeste absent");
    writeFileSync(join(runs, "active-run.json"), "{ illisible");
    vu = observer("r");
    assert.deepEqual([vu.state, vu.usable], ["UNKNOWN", false], "manifeste illisible");
    writeFileSync(join(runs, "active-run.json"),
      JSON.stringify({ version: 2, runId: "r", status: "active", nextSeq: 1, ledgers: { lanes: 2 } }));
    vu = observer("autre");
    assert.deepEqual([vu.state, vu.usable], ["UNKNOWN", false], "manifeste d'un autre run");
    vu = observer("r");
    assert.deepEqual([vu.state, vu.usable], ["LOST", false], "témoin présent, registre absent");
    assert.match(vu.usable ? "" : vu.reason, /inexploitable \(LOST\)/);
  } finally {
    done();
  }
});

test("P5 : usable découle de state, dans un seul constructeur", () => {
  const etats = ["EMPTY", "LOST", "UNKNOWN", "MIGRATION_REQUIRED", "KNOWN", "RUN_WITHOUT_WITNESS"] as const;
  let construits = 0;
  for (const s of etats) {
    const o = ledgerObservation(s, () => { construits += 1; return "snapshot"; }, () => "raison");
    const exploitable = s === "KNOWN" || s === "EMPTY";
    assert.equal(o.state, s);
    assert.equal(o.usable, exploitable, s);
    assert.deepEqual(o.usable ? o.snapshot : o.reason, exploitable ? "snapshot" : "raison", s);
  }
  // Le snapshot n'est construit que pour les deux états exploitables.
  assert.equal(construits, 2);
});

test("C4.9 ligne 1 : observeIntegrations refuse quand le registre des lanes n'est pas exploitable", () => {
  const { dir: root, done } = dossier();
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    const runs = join(root, RUNS_DIR);
    mkdirSync(runs);
    const manifeste = (ledgers?: Record<string, number>) => writeFileSync(join(runs, "active-run.json"),
      JSON.stringify({ version: 2, runId: "r", status: "active", nextSeq: 1, ...(ledgers ? { ledgers } : {}) }));
    const laneRead = { events: [], malformedLines: [], version: 1, present: false };
    const observer = () => observeIntegrations({ root, runDir: runs, runId: "r", laneRead });
    // Registre des intégrations absent et sans témoin : seule la ligne 1 peut refuser.
    manifeste({ lanes: 2 });
    let vu = observer();
    assert.deepEqual([vu.state, vu.usable], ["UNKNOWN", false], "lanes LOST");
    assert.match(vu.usable ? "" : vu.reason, /registre des lanes est inexploitable \(LOST\)/);
    // Témoin : sans témoin de lanes, les lanes sont EMPTY et les intégrations aussi.
    manifeste();
    vu = observer();
    assert.deepEqual([vu.state, vu.usable], ["EMPTY", true], "lanes EMPTY");
  } finally {
    done();
  }
});

// ================================================= lecture legacy : génération 1 (LOT 2, étape 3)

test("C4.9 : un registre v1 se projette en g1, sans toucher ce qu'il a reçu", () => {
  const v1: LaneEvent[] = [
    { event: "OPENED", work_unit: "W03", at: "t", base: "b" },
    { event: "INTEGRATED", work_unit: "W03", at: "t", integration_commit: "c" },
    { event: "ABANDONED", work_unit: "W09", at: "t", reason: "r" },
  ];
  const avant = JSON.stringify(v1);
  const projetes = projectLegacyGenerations(v1, 1) as Array<Record<string, unknown>>;
  assert.deepEqual(projetes.map((e) => e.generation), [1, undefined, 1],
    "OPENED et ABANDONED en g1 ; INTEGRATED n'a pas de génération");
  assert.equal(JSON.stringify(v1), avant, "le tableau reçu et ses objets restent intacts");
  assert.notEqual(projetes, v1, "un nouveau tableau");
  assert.equal(projetes[1], v1[1], "un événement sans génération n'est pas recopié");
  // Une génération portée par une ligne v1 n'a pas d'autorité : la projection la remplace.
  const porte = [{ ...v1[0], generation: 5 } as LaneEvent];
  assert.equal((projectLegacyGenerations(porte, 1)[0] as Record<string, unknown>).generation, 1);
});

test("C4.9 : la projection v1 ne s'applique qu'à un en-tête v1", () => {
  const ouverture = { event: "OPENED", work_unit: "W03", at: "t", base: "b" } as LaneEvent;
  for (const version of [2, 99, undefined]) {
    const rendus = projectLegacyGenerations([ouverture], version);
    assert.equal((rendus[0] as Record<string, unknown>).generation, undefined, `version ${version}`);
    assert.equal(rendus[0], ouverture, `version ${version} : rendu tel quel`);
  }
  const v2 = enveloppe(1, valides.OPENED) as unknown as LaneEvent;
  assert.equal((projectLegacyGenerations([v2], 2)[0] as Record<string, unknown>).generation, 1, "v2 garde la sienne");
  const g3 = { ...enveloppe(1, valides.OPENED), generation: 3 } as unknown as LaneEvent;
  assert.equal((projectLegacyGenerations([g3], 2)[0] as Record<string, unknown>).generation, 3, "v2 non réécrit");
});

test("C4.9 : l'hybride (manifeste v2, registre v1) se lit en g1, et le fichier reste v1 octet pour octet", () => {
  const { dir: root, done } = dossier();
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    const runs = join(root, RUNS_DIR);
    mkdirSync(runs);
    writeFileSync(join(runs, "active-run.json"),
      JSON.stringify({ version: 2, runId: "r", status: "active", nextSeq: 1 }));
    const brut = `{"ledger":1}\n${JSON.stringify({ event: "OPENED", work_unit: "W03", at: "t", base: "b" })}\n`;
    writeFileSync(laneLedgerPath(runs, "r"), brut);
    const lu = readLaneEvents(runs, "r");
    const vu = observeLanes({
      root, runId: "r",
      laneRead: { events: lu.events, malformedLines: lu.malformedLines, version: lu.version, present: lu.present },
    });
    assert.equal(vu.state, "KNOWN");
    assert.equal(vu.usable && (vu.snapshot.read.events[0] as Record<string, unknown>).generation, 1, "g1 synthétisée");
    assert.equal(vu.usable && vu.snapshot.read.version, 1, "la lecture reste v1");
    assert.equal((lu.events[0] as Record<string, unknown>).generation, undefined, "la lecture brute n'est pas modifiée");
    assert.equal(readFileSync(laneLedgerPath(runs, "r"), "utf-8"), brut, "le fichier n'est pas réécrit");
  } finally {
    done();
  }
});

// ================================================= cohérence P4 et projections (LOT 2, étape 4)

/*
 * Une histoire v2 cohérente, construite ligne à ligne. Chaque cas part d'elle, n'y change
 * qu'une chose, et vérifie que l'incohérence est nommée — la même histoire intacte
 * servant de témoin : aucune incohérence.
 */
function histoire(): Array<Record<string, unknown>> {
  const ev = (seq: number, unite: string, reste: Record<string, unknown>) =>
    ({ event_seq: seq, work_unit: unite, lane: `${RV2}-${unite}-g1`, at: "t", ...reste });
  return [
    ev(1, "W03", { event: "OPENED", base: "b", generation: 1 }),
    ev(2, "W03", { event: "REVIEWED", from_tree: "t0", tree: "t1", verdict: "approved",
      reviewer: { delegation_seq: 2, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" } }),
    ev(3, "W03", { event: "REVIEWED", from_tree: "t1", tree: "t2", verdict: "approved",
      reviewer: { delegation_seq: 4, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" } }),
    ev(4, "W03", { event: "FROZEN", commit: "c", parent: "b", tree: "t2", reviewed_event_seq: 3 }),
    ev(5, "W03", { event: "MERGED", integration_commit: "i", frozen_event_seq: 4 }),
    ev(6, "W03", { event: "INTEGRATED", integration_commit: "i", status: { outcome: "not-applicable" } }),
    ev(7, "W09", { event: "OPENED", base: "b", generation: 1 }),
    ev(8, "W09", { event: "RISK", id: "r1", transition: "opened", by: "reviewer" }),
    ev(9, "W09", { event: "ABANDONED", by: "operator", reason: "x", generation: 1 }),
  ];
}
const incoherences = (h: Array<Record<string, unknown>>) =>
  laneLedgerIncoherences(h as unknown as LaneEvent[], RV2);
function incoherent(modifier: (h: Array<Record<string, unknown>>) => void, motif: RegExp, quoi: string): void {
  const h = histoire();
  modifier(h);
  const faits = incoherences(h);
  assert.equal(faits.length > 0, true, `${quoi} : une incohérence attendue`);
  assert.match(faits.join(" | "), motif, `${quoi} : l'incohérence doit être nommée`);
}

test("P4 : une histoire v2 cohérente n'a aucune incohérence, et chaque ligne passe la grammaire", () => {
  const h = histoire();
  assert.deepEqual(incoherences(h), []);
  assert.deepEqual(h.map((l) => parseLaneEventV2(l) !== null), h.map(() => true));
});

test("P4 : event_seq strictement croissant et unique", () => {
  incoherent((h) => { h[2].event_seq = 2; }, /ne suit pas event_seq 2/, "doublon");
  incoherent((h) => { h[2].event_seq = 1; }, /ne suit pas event_seq 2/, "retour en arrière");
  // Un trou n'est pas une incohérence : strictement croissant, pas contigu.
  const trou = histoire();
  trou[8].event_seq = 20;
  assert.deepEqual(incoherences(trou), []);
});

test("P4 : lane cohérente avec (runId, work_unit, generation), et ouverte avant usage", () => {
  incoherent((h) => { h[0].lane = `${RV2}-W03-g2`; }, /lane run-v2-W03-g2 au lieu de run-v2-W03-g1/, "génération");
  incoherent((h) => { h[0].lane = `autre-W03-g1`; h[1].lane = "autre-W03-g1"; },
    /au lieu de run-v2-W03-g1/, "autre run");
  incoherent((h) => { h[8].generation = 2; }, /ABANDONED \(event_seq 9\) : lane run-v2-W09-g1 au lieu de run-v2-W09-g2/, "abandon");
  incoherent((h) => { h[1].lane = `${RV2}-W12-g1`; }, /n'a pas été ouverte pour W03/, "lane jamais ouverte");
  incoherent((h) => { h[7].work_unit = "W03"; }, /run-v2-W09-g1 n'a pas été ouverte pour W03/, "unité différente");
  incoherent((h) => { h.splice(0, 1); }, /n'a pas été ouverte/, "revue avant ouverture");
});

test("P4 : la chaîne des revues est continue par lane", () => {
  incoherent((h) => { h[2].from_tree = "tX"; }, /chaîne rompue sur run-v2-W03-g1, from_tree tX après tree t1/, "rupture");
  // Deux lanes ont deux chaînes : la première revue d'une lane n'est pas jugée sur l'autre.
  const deux = histoire();
  deux.splice(8, 0, { event_seq: 8.5, work_unit: "W09", lane: `${RV2}-W09-g1`, at: "t", event: "REVIEWED",
    from_tree: "z0", tree: "z1", verdict: "approved",
    reviewer: { delegation_seq: 6, agent: "reviewer", role: "reviewer" }, proof: { mode: "diff" } });
  assert.deepEqual(incoherences(deux), []);
});

test("P4 : les renvois désignent une revue ou un gel ANTÉRIEURS de la même lane", () => {
  incoherent((h) => { h[3].reviewed_event_seq = 1; }, /reviewed_event_seq 1 ne désigne aucune revue/, "vers OPENED");
  incoherent((h) => { h[3].reviewed_event_seq = 99; }, /reviewed_event_seq 99/, "vers rien");
  incoherent((h) => { h[4].frozen_event_seq = 3; }, /frozen_event_seq 3 ne désigne aucun gel/, "vers REVIEWED");
  incoherent((h) => { h[4].frozen_event_seq = 6; }, /frozen_event_seq 6/, "vers un événement postérieur");
  // Une revue d'une autre lane ne compte pas.
  incoherent((h) => {
    h.splice(8, 0, { event_seq: 8.5, work_unit: "W09", lane: `${RV2}-W09-g1`, at: "t", event: "FROZEN",
      commit: "c", parent: "b", tree: "t2", reviewed_event_seq: 3 });
  }, /reviewed_event_seq 3 ne désigne aucune revue antérieure de run-v2-W09-g1/, "revue d'une autre lane");
  incoherent((h) => {
    h.splice(8, 0, { event_seq: 8.5, work_unit: "W09", lane: `${RV2}-W09-g1`, at: "t", event: "MERGED",
      integration_commit: "i", frozen_event_seq: 4 });
  }, /frozen_event_seq 4 ne désigne aucun gel antérieur de run-v2-W09-g1/, "gel d'une autre lane");
  incoherent((h) => { h[3].event_seq = 3.5; h[3].reviewed_event_seq = 3.5; }, /reviewed_event_seq 3.5/, "vers soi-même");
});

test("P4 : un événement sans enveloppe dans un registre v2 est une incohérence", () => {
  const h = histoire();
  h.push({ event: "OPENED", work_unit: "W12", at: "t", base: "b" });
  assert.match(incoherences(h).join(" | "), /OPENED sans enveloppe v2/);
});

test("P4 : laneState rend UNKNOWN un registre v2 incohérent, jamais un v1", () => {
  const coherent = { present: true, version: 2, events: histoire() as unknown as LaneEvent[], malformedLines: [] };
  assert.equal(laneState(t2(), coherent, RV2), "KNOWN");
  const rompu = histoire();
  rompu[2].from_tree = "tX";
  assert.equal(laneState(t2(), { ...coherent, events: rompu as unknown as LaneEvent[] }, RV2), "UNKNOWN");
  // Le même contenu sous un autre runId : lanes incohérentes.
  assert.equal(laneState(t2(), coherent, "autre"), "UNKNOWN");
  // Un registre v1 n'est jamais jugé sur l'enveloppe v2.
  const v1 = { present: true, version: 1, events: [{ event: "OPENED", work_unit: "W03", at: "t", base: "b" }] as LaneEvent[], malformedLines: [] };
  assert.equal(laneState(t2(), v1, RV2), "KNOWN");
  // Un état déjà refusé le reste, quelle que soit la cohérence.
  assert.equal(laneState(t2({ lanes: 1 }), coherent, RV2), "UNKNOWN");
  assert.equal(laneState(null, coherent, RV2), "UNKNOWN");
});

test("projections : un projecteur par nature, sur une histoire v2", () => {
  const h = histoire() as unknown as LaneEvent[];
  const revues = projectReviews(h);
  assert.deepEqual([...revues.keys()], [`${RV2}-W03-g1`]);
  assert.deepEqual(revues.get(`${RV2}-W03-g1`)!.map((r) => [r.from_tree, r.tree, r.reviewer.delegation_seq]),
    [["t0", "t1", 2], ["t1", "t2", 4]]);
  assert.deepEqual(projectViolations(h), []);
  const risques = projectRisks(h, RV2);
  assert.deepEqual([...risques.keys()], [riskKey(RV2, "W09", "r1")]);
  assert.equal(risques.get(riskKey(RV2, "W09", "r1"))!.open, true);
  const integrees = projectIntegrated(h, 2);
  assert.deepEqual([...integrees.keys()], ["W03"], "seul INTEGRATED intègre ; W09 abandonnée ne l'est pas");
  assert.deepEqual(integrees.get("W03"),
    { work_unit: "W03", integration_commit: "i", status: { outcome: "not-applicable" }, event_seq: 6 });
});

test("projections : ni FROZEN, ni MERGED, ni ABANDONED ne valent INTEGRATED", () => {
  const h = histoire().filter((e) => e.event !== "INTEGRATED") as unknown as LaneEvent[];
  assert.deepEqual([...projectIntegrated(h, 2).keys()], []);
  assert.deepEqual([...integrationCommits(h).keys()], []);
});

test("projections : un risque se juge sur sa dernière transition, sous (R, unité, id)", () => {
  const r = (seq: number, unite: string, id: string, transition: string) => ({
    event_seq: seq, work_unit: unite, lane: `${RV2}-${unite}-g1`, at: "t", event: "RISK", id, transition,
    ...(transition === "routed" ? { to: "scout" } : { by: "reviewer" }),
  });
  const h = [
    r(1, "W09", "r1", "opened"),
    r(2, "W03", "r1", "opened"), r(3, "W03", "r1", "resolved"),
    r(4, "W12", "r2", "opened"), r(5, "W12", "r2", "routed"),
    r(6, "W14", "r3", "resolved"), r(7, "W14", "r3", "opened"),
  ] as unknown as LaneEvent[];
  const risques = projectRisks(h, RV2);
  const ouverts = [...risques.values()].filter((f) => f.open).map((f) => `${f.work_unit}:${f.id}:${f.transition}`);
  assert.deepEqual(ouverts, ["W09:r1:opened", "W12:r2:routed", "W14:r3:opened"],
    "même id sur deux unités : deux risques ; routed reste ouvert ; rouvert après résolution : ouvert");
  assert.equal(risques.get(riskKey(RV2, "W03", "r1"))!.open, false);
  // La clé porte le run : le même couple unité/id sous un autre run est un autre risque.
  assert.notEqual(riskKey(RV2, "W03", "r1"), riskKey("autre", "W03", "r1"));
  assert.equal(projectRisks(h, "autre").has(riskKey(RV2, "W03", "r1")), false);
});

test("projections : v1 et v2 convergent vers le même projecteur d'INTEGRATED", () => {
  const v1 = [
    { event: "OPENED", work_unit: "W03", at: "t", base: "b" },
    { event: "INTEGRATED", work_unit: "W03", at: "t", integration_commit: "a" },
    { event: "INTEGRATED", work_unit: "W03", at: "t", integration_commit: "z" },
    { event: "INTEGRATED", work_unit: "W09", at: "t" },
  ] as LaneEvent[];
  assert.deepEqual([...projectIntegrated(v1, 1).values()], [
    { work_unit: "W03", integration_commit: "z", status: undefined, event_seq: undefined },
    { work_unit: "W09", integration_commit: undefined, status: undefined, event_seq: undefined },
  ], "la dernière intégration gagne, v1 sans statut ni séquence");
  assert.deepEqual([...integrationCommits(v1)], [["W03", "z"], ["W09", undefined]], "integrationCommits en est la vue");
});

test("projections : les champs propres à v2 n'ont aucune autorité sous un en-tête v1", () => {
  const surnumeraire = [{
    event: "INTEGRATED", work_unit: "W03", at: "t", integration_commit: "i",
    event_seq: 99,
    status: { outcome: "committed", decision_id: "d", target_status: "done", status_commit: "s" },
  }] as unknown as LaneEvent[];
  assert.deepEqual(projectIntegrated(surnumeraire, 1).get("W03"), {
    work_unit: "W03", integration_commit: "i", status: undefined, event_seq: undefined,
  }, "la grammaire v1 tolère les champs surnuméraires sans leur donner l'autorité v2");
  assert.deepEqual(projectIntegrated(surnumeraire, 2).get("W03"), {
    work_unit: "W03", integration_commit: "i",
    status: { outcome: "committed", decision_id: "d", target_status: "done", status_commit: "s" },
    event_seq: 99,
  }, "les mêmes champs appartiennent à la projection sous un en-tête v2");
});

test("observeLanes : le snapshot porte les projections, et la prose d'un refus nomme l'incohérence", () => {
  const { dir: root, done } = dossier();
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    const runs = join(root, RUNS_DIR);
    mkdirSync(runs);
    writeFileSync(join(runs, "active-run.json"),
      JSON.stringify({ version: 2, runId: RV2, status: "active", nextSeq: 1, ledgers: { lanes: 2 } }));
    const ecrire = (h: Array<Record<string, unknown>>) =>
      writeFileSync(laneLedgerPath(runs, RV2), `${['{"ledger":2}', ...h.map((l) => JSON.stringify(l))].join("\n")}\n`);
    const observer = () => {
      const lu = readLaneEvents(runs, RV2);
      return observeLanes({ root, runId: RV2,
        laneRead: { events: lu.events, malformedLines: lu.malformedLines, version: lu.version, present: lu.present } });
    };
    ecrire(histoire());
    let vu = observer();
    assert.equal(vu.state, "KNOWN");
    assert.equal(vu.usable && vu.snapshot.projections.integrated.has("W03"), true);
    assert.equal(vu.usable && vu.snapshot.projections.risks.size, 1);
    assert.equal(vu.usable && vu.snapshot.projections.reviews.get(`${RV2}-W03-g1`)!.length, 2);
    const rompu = histoire();
    rompu[2].from_tree = "tX";
    ecrire(rompu);
    vu = observer();
    assert.equal(vu.state, "UNKNOWN");
    assert.match(vu.usable ? "" : vu.reason, /chaîne rompue sur run-v2-W03-g1/);
  } finally {
    done();
  }
});

test("P4 : observeIntegrations refuse aussi quand les lanes v2 sont incohérentes", () => {
  const { dir: root, done } = dossier();
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    const runs = join(root, RUNS_DIR);
    mkdirSync(runs);
    writeFileSync(join(runs, "active-run.json"),
      JSON.stringify({ version: 2, runId: RV2, status: "active", nextSeq: 1, ledgers: { lanes: 2 } }));
    const observer = (h: Array<Record<string, unknown>>) => {
      writeFileSync(laneLedgerPath(runs, RV2), `${['{"ledger":2}', ...h.map((l) => JSON.stringify(l))].join("\n")}\n`);
      const lu = readLaneEvents(runs, RV2);
      return observeIntegrations({ root, runDir: runs, runId: RV2,
        laneRead: { events: lu.events, malformedLines: lu.malformedLines, version: lu.version, present: lu.present } });
    };
    // Témoin : l'histoire cohérente, registre des intégrations absent et sans témoin.
    let vu = observer(histoire());
    assert.deepEqual([vu.state, vu.usable], ["EMPTY", true], "lanes cohérentes");
    const rompu = histoire();
    rompu[2].from_tree = "tX";
    vu = observer(rompu);
    assert.deepEqual([vu.state, vu.usable], ["UNKNOWN", false], "lanes incohérentes");
    assert.match(vu.usable ? "" : vu.reason, /registre des lanes est inexploitable \(UNKNOWN\)/);
  } finally {
    done();
  }
});

test("observeLanes transmet la version du snapshot au projecteur d'intégration", () => {
  const { dir: root, done } = dossier();
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    const runs = join(root, RUNS_DIR);
    mkdirSync(runs);
    writeFileSync(join(runs, "active-run.json"),
      JSON.stringify({ version: 2, runId: RV2, status: "active", nextSeq: 1 }));
    const statut = { outcome: "committed", decision_id: "d", target_status: "done", status_commit: "s" };
    const projete = (entete: string, lignes: Array<Record<string, unknown>>) => {
      writeFileSync(laneLedgerPath(runs, RV2), `${[entete, ...lignes.map((l) => JSON.stringify(l))].join("\n")}\n`);
      const lu = readLaneEvents(runs, RV2);
      const vu = observeLanes({ root, runId: RV2,
        laneRead: { events: lu.events, malformedLines: lu.malformedLines, version: lu.version, present: lu.present } });
      assert.equal(vu.state, "KNOWN", entete);
      return vu.usable ? vu.snapshot.projections.integrated.get("W03") : undefined;
    };
    // v1 (hybride) : la ligne de Sol, champs v2 surnuméraires compris — sans autorité.
    const v1 = projete('{"ledger":1}', [
      { event: "OPENED", work_unit: "W03", at: "t", base: "b" },
      { event: "INTEGRATED", work_unit: "W03", at: "t", integration_commit: "i", event_seq: 99, status: statut },
    ]);
    assert.deepEqual(v1, { work_unit: "W03", integration_commit: "i", status: undefined, event_seq: undefined });
    // Témoin v2 : les mêmes champs, sous leur en-tête, sont projetés.
    const h = histoire();
    h[5].status = statut;
    const v2 = projete('{"ledger":2}', h);
    assert.deepEqual(v2, { work_unit: "W03", integration_commit: "i", status: statut, event_seq: 6 });
  } finally {
    done();
  }
});
