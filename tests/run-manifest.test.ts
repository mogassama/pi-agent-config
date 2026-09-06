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
import { test } from "node:test";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import {
  NotOwnerError,
  RecoveryError,
  RunBusyError,
  appendLaneEvent,
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
  type Lease,
  type RunManifest,
} from "../subagent-only/run-manifest.ts";

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
    setStatus(dir, "completed", own(dir, vieux.runId));

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
    setStatus(dir, "completed", own(dir, vieux.runId));

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
    const bail = own(dir, un.runId);
    setStatus(dir, "completed", bail);
    releaseRunOwnership(dir, bail);

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
    setStatus(dir, "completed", own(dir, premier.runId));
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
    setStatus(dir, "abandoned", own(dir, premier.runId));
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
    assert.throws(() => setStatus(dir, "completed", usurpe), NotOwnerError);
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
    assert.throws(() => setStatus(dir, "completed", ancien), NotOwnerError);

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
      { events: [], malformed: 0, malformedLines: [], version: 1 });
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
