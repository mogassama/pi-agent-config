/**
 * l0-b1-registres.test.ts — L0, vague B1 : formats, lecteurs, générations.
 *
 * Les fixtures vivent dans `l0-b1-fixtures.ts` : registres et manifestes
 * sérialisés au format du § F de C0 v1.3, relus par la surface publique.
 * `issue()` n'entoure que l'appel public éprouvé ; le montage reste sous
 * `PRÉCONDITION`.
 *
 * Le discriminant `state` vient de C0 v1.4, C4.2 et C4.8 : six jetons de protocole,
 * EMPTY, KNOWN, LOST, UNKNOWN, MIGRATION_REQUIRED, RUN_WITHOUT_WITNESS. Aucun lecteur
 * de l'objet ne l'expose — `{ usable: false, reason: "…" }` ne se distingue qu'à la
 * prose — et c'est ce que les preuves ci-dessous réclament.
 *
 * Espèces : voir l'en-tête de `l0-a2-units.test.ts`. Chacune est décidée par ce
 * qui est mesuré, jamais par le lot.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { laneIdFor } from "../subagent-only/lane-context.ts";
import { observeLanes } from "../subagent-only/lane-observe.ts";
import { observeIntegrations } from "../subagent-only/integration-observe.ts";
import {
  acquireRunOwnership, appendIntegrationEvent, appendLaneEvent, integrationLedgerState, laneState, openRun,
  readIntegrationEvents, readLaneEvents, readWitnesses,
} from "../subagent-only/run-manifest.ts";
import { ensureLane, openLanes, runBranches } from "../subagent-only/worktree.ts";
import {
  aJeter, AT, cheminIntegrations, cheminLanes, depot, git, hashPlan, manifeste, plan, Registre, RUN, runEcrit,
} from "./l0-b1-fixtures.ts";

// ------------------------------------------------------------------ espèces

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
/**
 * Une régression CORRIGÉE : même nom, même scénario, mêmes assertions, sans `todo`.
 *
 * Elle est verte sur l'objet corrigé, et elle porte un mutant qui réintroduit le défaut.
 * Sans ce mutant, elle pourrait verdir grâce à une autre porte que celle qu'elle vise.
 */
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function couverture(id: string, titre: string, fn: Preuve): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------------ issue et lecture

/*
 * Les deux branches portent les deux champs, l'un des deux vide.
 *
 * Une union stricte obligerait chaque lecture à rétrécir d'abord ; or une PRÉCONDITION
 * n'est pas un garde de type, et `i.value` sur l'union levait dix-huit diagnostics
 * stricts sans rien dire de plus sur le comportement.
 */
type Issue =
  | { kind: "returned"; value: unknown; error?: undefined }
  | { kind: "threw"; value?: undefined; error: string };
function issue(fn: () => unknown): Issue {
  try {
    return { kind: "returned", value: fn() };
  } catch (e) {
    return { kind: "threw", error: `${(e as Error).constructor.name}: ${(e as Error).message}` };
  }
}
const montrer = (i: Issue): string =>
  (JSON.stringify(i, (_, v) => (v instanceof Map ? { Map: [...v] } : v)) ?? "(indicible)").slice(0, 300);

type Vu = {
  usable?: boolean;
  state?: string;
  snapshot?: {
    read?: { events?: Array<Record<string, unknown>> };
    reconciliation?: { conflicts: Map<string, { kind: string }> };
  };
};
const vu = (i: Issue): Vu => (i.kind === "returned" ? (i.value as Vu) : {});
const exploitable = (i: Issue): boolean => vu(i).usable === true;
/** Le discriminant structuré exigé par C4.2 — absent de l'objet, fixé par ces preuves. */
const etat = (i: Issue): string | undefined => vu(i).state;
const evenements = (i: Issue): Array<Record<string, unknown>> => vu(i).snapshot?.read?.events ?? [];
const conflits = (i: Issue): Array<[string, string]> =>
  [...(vu(i).snapshot?.reconciliation?.conflicts ?? new Map()).entries()].map(([u, c]) => [u, c.kind]);

/*
 * `readLaneEvents` rend un `LedgerRead`, dont `version` est facultative ; les lecteurs
 * attendent un `LaneRead`, dont elle est présente et peut valoir `undefined`. La
 * production fait le raccourci dans `bin/`, hors du périmètre de la baseline stricte ;
 * ici il coûterait deux diagnostics, alors on écrit la forme attendue.
 */
const laneRead = (dir: string) => {
  const lu = readLaneEvents(dir, RUN);
  return { events: lu.events, malformedLines: lu.malformedLines, version: lu.version, present: lu.present };
};
const lireLanes = (root: string, dir: string) =>
  issue(() => observeLanes({ root, runId: RUN, laneRead: laneRead(dir) }));
const lireIntegrations = (root: string, dir: string) =>
  issue(() => observeIntegrations({ root, runDir: dir, runId: RUN, laneRead: laneRead(dir) }));

// ================================================================== § F — le vocabulaire v2

regressionCorrigee("F-ledger-v2", "les huit natures d'événement v2 se relisent et se reconstruisent", () => {
  /*
   * Trois histoires conformes, pas un sac de mots.
   *
   * Une lane frappée d'une violation historique ou portant un risque ouvert n'est pas
   * intégrable : les réunir sur une seule unité aurait mis les huit natures dans le
   * fichier au prix d'une histoire que le contrat interdit.
   */
  const r = runEcrit("l0-b1-v2-", [
    { unite: "W03", integree: true },
    { unite: "W09", violation: true, abandonnee: true },
    { unite: "W12", ouverte: true, risqueOuvert: true },
  ]);
  const brut = readFileSync(cheminLanes(r.dir), "utf-8");
  const natures = ["OPENED", "REVIEWED", "VIOLATION", "RISK", "FROZEN", "MERGED", "INTEGRATED", "ABANDONED"];
  for (const n of natures) precondition(brut.includes(`"${n}"`), `la fixture doit porter ${n}`);
  precondition(brut.includes('"ledger":2'), "la fixture doit porter l'en-tête v2");

  const lu = lireLanes(r.root, r.dir);
  const vues = new Set(evenements(lu).map((e) => e.event as string));
  const manquantes = natures.filter((n) => !vues.has(n));
  const revue = evenements(lu).find((e) => e.event === "REVIEWED");
  const gel = evenements(lu).find((e) => e.event === "FROZEN");
  const merge = evenements(lu).find((e) => e.event === "MERGED");
  const renvois = gel?.reviewed_event_seq === revue?.event_seq && merge?.frozen_event_seq === gel?.event_seq;
  propriete(
    exploitable(lu) && manquantes.length === 0 && renvois,
    `le vocabulaire entier doit se reconstruire, renvois compris ; natures manquantes ` +
      `${JSON.stringify(manquantes)}, renvois cohérents ${renvois}, lu : ${montrer(lu)}`,
  );
});

couverture("F-version-inconnue", "une version de registre inconnue ferme la lecture", () => {
  const d = depot("l0-b1-inconnue-");
  // Le manifeste du run, lisible : sans lui, le refus viendrait de son absence (C4.9, ligne 0)
  // et non de la version, que cette preuve vise.
  manifeste(d.dir, { version: 2 });
  const r = new Registre(1);
  r.ajouterV1("W03", { event: "OPENED", base: d.base });
  writeFileSync(cheminLanes(d.dir), r.brut().replace('{"ledger":1}', '{"ledger":99}'));
  const lu = lireLanes(d.root, d.dir);
  propriete(
    vu(lu).usable === false,
    `une version inconnue se refuse, elle ne s'ignore pas ; lu : ${montrer(lu)}`,
  );
});

// ================================================================== C4 — les six issues

regressionCorrigee("C4-etats", "les six issues de lecture portent chacune leur discriminant structuré", () => {
  const cas: Array<[string, () => Issue]> = [];

  const vide = depot("l0-b1-vide-");
  manifeste(vide.dir, { version: 2 });
  precondition(!existsSync(cheminLanes(vide.dir)), "VIDE : aucun registre sur le disque");
  cas.push(["EMPTY", () => lireLanes(vide.root, vide.dir)]);

  const connu = depot("l0-b1-connu-");
  manifeste(connu.dir, { version: 2 });
  const rc = new Registre(2);
  rc.ajouter("W03", 1, { event: "OPENED", base: connu.base, generation: 1 });
  rc.ecrire(connu.dir);
  precondition(
    !readFileSync(join(connu.dir, "active-run.json"), "utf-8").includes("ledgers"),
    "CONNU : le registre doit précéder son témoin",
  );
  cas.push(["KNOWN", () => lireLanes(connu.root, connu.dir)]);

  const perdu = depot("l0-b1-perdu-");
  manifeste(perdu.dir, { version: 2, ledgers: { lanes: 2 } });
  precondition(
    readFileSync(join(perdu.dir, "active-run.json"), "utf-8").includes('"lanes": 2'),
    "PERDU : le témoin doit être au manifeste",
  );
  precondition(!existsSync(cheminLanes(perdu.dir)), "PERDU : le registre attendu doit être absent");
  cas.push(["LOST", () => lireLanes(perdu.root, perdu.dir)]);

  const inconnu = depot("l0-b1-inconnu-");
  manifeste(inconnu.dir, { version: 2, ledgers: { lanes: 2 } });
  writeFileSync(cheminLanes(inconnu.dir), `${JSON.stringify({ ledger: 2 })}\n{ pas du json\n`);
  cas.push(["UNKNOWN", () => lireLanes(inconnu.root, inconnu.dir)]);

  const aMigrer = depot("l0-b1-migrer-");
  manifeste(aMigrer.dir, { version: 2, ledgers: { lanes: 2 } });
  const ra = new Registre(1);
  ra.ajouterV1("W03", { event: "OPENED", base: aMigrer.base });
  writeFileSync(cheminLanes(aMigrer.dir), ra.brut().replace('{"ledger":1}\n', ""));
  precondition(
    !readFileSync(cheminLanes(aMigrer.dir), "utf-8").startsWith('{"ledger"'),
    "À MIGRER : le registre doit être sans en-tête",
  );
  cas.push(["MIGRATION_REQUIRED", () => lireLanes(aMigrer.root, aMigrer.dir)]);

  const sansTemoin = depot("l0-b1-sans-temoin-");
  manifeste(sansTemoin.dir, { version: 1 });
  const rs = new Registre(2);
  rs.ajouter("W03", 1, { event: "OPENED", base: sansTemoin.base, generation: 1 });
  rs.ecrire(sansTemoin.dir);
  precondition(
    readFileSync(join(sansTemoin.dir, "active-run.json"), "utf-8").includes('"version": 1'),
    "RUN-SANS-TÉMOIN : le manifeste doit être v1 (C4.7)",
  );
  cas.push(["RUN_WITHOUT_WITNESS", () => lireLanes(sansTemoin.root, sansTemoin.dir)]);

  const rendus = cas.map(([nom, lire]): [string, string | undefined] => [nom, etat(lire())]);
  const justes = rendus.filter(([nom, rendu]) => rendu === nom);
  propriete(
    justes.length === cas.length,
    `chaque issue doit se nommer, au lieu de se deviner à la prose (C4.2) ; rendus : ` +
      `${JSON.stringify(rendus)}`,
  );
});

regressionCorrigee("C4-integrations", "le registre des intégrations porte aussi EMPTY, LOST et UNKNOWN", () => {
  const r = runEcrit("l0-b1-int-", [{ unite: "W03", integree: true }]);
  precondition(!existsSync(cheminIntegrations(r.dir)), "le registre des intégrations doit être absent");
  const absent = etat(lireIntegrations(r.root, r.dir));

  manifeste(r.dir, {
    version: 2, base: r.base, plan: `${RUN}-plan.json`, ledgers: { lanes: 2, integrations: 1 },
    planHash: hashPlan(r.dir),
  });
  const perdu = etat(lireIntegrations(r.root, r.dir));

  writeFileSync(cheminIntegrations(r.dir), `${JSON.stringify({ integration_ledger: 1 })}\n{ abîmé\n`);
  const inconnu = etat(lireIntegrations(r.root, r.dir));

  propriete(
    absent === "EMPTY" && perdu === "LOST" && inconnu === "UNKNOWN",
    `sans témoin ni fichier : ${absent} (attendu EMPTY) · témoin sans fichier : ${perdu} ` +
      `(attendu LOST) · fichier abîmé : ${inconnu} (attendu UNKNOWN)`,
  );
});

regressionCorrigee("C4-ledgers-partielle", "la table des témoins reste partielle tant qu'un registre n'a pas d'en-tête", () => {
  const r = runEcrit("l0-b1-partielle-", [{ unite: "W03", integree: true }]);
  const brut = readFileSync(join(r.dir, "active-run.json"), "utf-8");
  precondition(brut.includes('"lanes": 2'), "le témoin des lanes doit être là");
  precondition(!brut.includes("integrations"), "aucun témoin ne doit être écrit d'office pour les intégrations");
  precondition(!existsSync(cheminIntegrations(r.dir)), "le registre des intégrations ne doit pas exister");
  const lanes = lireLanes(r.root, r.dir);
  const integrations = lireIntegrations(r.root, r.dir);
  propriete(
    etat(lanes) === "KNOWN" && etat(integrations) === "EMPTY",
    `un témoin partiel se lit tel quel : lanes ${etat(lanes)} (attendu KNOWN), intégrations ` +
      `${etat(integrations)} (attendu EMPTY) — écrire les deux clés d'office créerait un témoin ` +
      "en avance (C4.1)",
  );
});

preservation("C4-consommateur", "un registre d'intégrations abîmé ne ferme pas le lecteur des lanes", () => {
  const r = runEcrit("l0-b1-conso-", [{ unite: "W03", integree: true }], { ledger: 1 });
  writeFileSync(cheminIntegrations(r.dir), `${JSON.stringify({ integration_ledger: 1 })}\n{ abîmé\n`);
  const integrations = lireIntegrations(r.root, r.dir);
  const lanes = lireLanes(r.root, r.dir);
  precondition(
    vu(integrations).usable === false,
    `le consommateur des intégrations doit refuser ; lu : ${montrer(integrations)}`,
  );
  propriete(
    exploitable(lanes),
    `l'inconnu ne bloque que ce qui le consomme (C4.4) ; lanes : ${montrer(lanes)}`,
  );
});

couverture("C4-demarrage", "aucun registre n'est créé au simple démarrage d'un run", () => {
  const d = depot("l0-b1-demarrage-");
  const ouvert = issue(() => openRun(d.dir, undefined));
  precondition(ouvert.kind === "returned", `openRun doit rendre un run ; rendu : ${montrer(ouvert)}`);
  const runId = (ouvert.value as { manifest: { runId: string } }).manifest.runId;
  const poses = [`${runId}-lanes.jsonl`, `${runId}-integrations.jsonl`].filter((f) => existsSync(join(d.dir, f)));
  propriete(
    poses.length === 0,
    `l'initialisation reste paresseuse (C4.1) ; posés : ${JSON.stringify(poses)}`,
  );
});

/*
 * PLAN-CORRECTIF-UNKNOWN-LEGACY § 4.1 : l'état C4 se juge avant tout append, quelle que soit
 * la version de l'en-tête.
 *
 * La forme éprouvée est celle de l'arrêt de PORTES-GEL : manifeste v2 portant le témoin
 * `lanes: 2`, registre à en-tête v1 dont chaque ligne est lisible. C4.9 la classe UNKNOWN (le
 * témoin ne concorde qu'avec la version de l'en-tête), et c'est ce que la PRÉCONDITION relit
 * par la fonction même que les observateurs appellent.
 *
 * Les deux continuations legacy — ABANDONED et l'INTEGRATED sans `status` — y sont refusées,
 * et le refus doit nommer l'état C4 : un refus pour une autre raison ne dirait rien de la
 * garde. Le témoin 3 y est joint : UNKNOWN par la même ligne de C4.9, il fait rougir une
 * correction qui aurait figé le témoin 2 au lieu de juger l'état. Les témoins sont le même registre v1 avec un témoin absent puis `lanes: 1` : KNOWN
 * par C4.9, la continuation legacy y reste permise. Ils font partie de la PROPRIÉTÉ, parce
 * qu'une correction qui fermerait tout le v1 serait fausse et doit rougir ici.
 *
 * Une fixture fraîche par appel : aucun append n'hérite de l'effet du précédent.
 */
regressionCorrigee("PG-UNKNOWN-LEGACY", "un registre v1 que C4 juge UNKNOWN ne reçoit aucune continuation legacy", () => {
  type Temoin = "absent" | 1 | 2 | 3;
  const ecrireManifeste = (r: { dir: string; base: string }, temoin: Temoin): void =>
    manifeste(r.dir, {
      version: 2, base: r.base, plan: `${RUN}-plan.json`, planHash: hashPlan(r.dir),
      ...(temoin === "absent" ? {} : { ledgers: { lanes: temoin } }),
    });
  const etatC4 = (dir: string): string => {
    const lu = readLaneEvents(dir, RUN);
    return laneState(readWitnesses(dir, RUN), { ...lu, version: lu.version }, RUN);
  };

  const natures = {
    ABANDONED: { event: "ABANDONED" as const, work_unit: "W03", at: AT, reason: "PG-UNKNOWN-LEGACY" },
    INTEGRATED: { event: "INTEGRATED" as const, work_unit: "W03", at: AT },
  };
  type Nature = keyof typeof natures;

  /** Un run v1 frais sous manifeste v2, son témoin posé, un append sous bail valide. */
  function essayer(nature: Nature, temoin: Temoin) {
    const r = runEcrit(`l0-b1-pgul-${String(temoin)}-`, [{ unite: "W03", ouverte: true }], { ledger: 1, manifesteV1: false });
    ecrireManifeste(r, temoin);
    const lu = readLaneEvents(r.dir, RUN);
    precondition(
      lu.version === 1 && lu.malformedLines.length === 0 && lu.events.length === 1,
      `registre v1 lisible, une ouverture ; version ${String(lu.version)}, abîmées ${lu.malformedLines.length}, ` +
        `événements ${lu.events.length}`,
    );
    const etat = etatC4(r.dir);
    const attendu = temoin === "absent" || temoin === 1 ? "KNOWN" : "UNKNOWN";
    precondition(
      etat === attendu,
      `témoin ${String(temoin)} sur en-tête v1 : état C4 ${etat}, attendu ${attendu} (C4.9)`,
    );
    const pris = acquireRunOwnership(r.dir, RUN, `pgul-${nature}-${String(temoin)}`);
    precondition(pris.ok, `le bail doit être obtenu : le refus éprouvé ne doit pas venir de lui ; ${JSON.stringify(pris)}`);
    const avant = readFileSync(cheminLanes(r.dir));
    const bail = pris.ok ? pris.lease : undefined;
    const i = issue(() => appendLaneEvent(r.dir, natures[nature], bail!));
    const apres = readFileSync(cheminLanes(r.dir));
    return { etat, i, identiques: avant.equals(apres), ajout: apres.subarray(avant.length).toString("utf-8").trim() };
  }

  const refusC4 = (nature: Nature, i: Issue): boolean =>
    i.kind === "threw" && i.error.startsWith("RecoveryError: ") &&
    i.error.includes(`registre ${RUN} UNKNOWN : `) && i.error.includes(`ne reçoit aucun ${nature} ; rien n'est écrit`);

  const refus: string[] = [];
  for (const temoin of [2, 3] as const) {
    for (const nature of Object.keys(natures) as Nature[]) {
      const x = essayer(nature, temoin);
      if (!(refusC4(nature, x.i) && x.identiques)) {
        refus.push(`${nature} sur UNKNOWN (témoin ${temoin}) : ${x.identiques ? "octets identiques" : `ÉCRIT ${x.ajout}`}, ` +
          `issue ${montrer(x.i)}`);
      }
    }
  }
  const continuations: string[] = [];
  for (const temoin of ["absent", 1] as const) {
    for (const nature of Object.keys(natures) as Nature[]) {
      const x = essayer(nature, temoin);
      const ecrit = x.i.kind === "returned" && !x.identiques && (JSON.parse(x.ajout) as { event?: string }).event === nature;
      if (!ecrit) continuations.push(`${nature} sur KNOWN (témoin ${String(temoin)}) : issue ${montrer(x.i)}`);
    }
  }

  propriete(
    refus.length === 0 && continuations.length === 0,
    `sous R, un état C4 autre que KNOWN interdit tout append, en-tête v1 compris, et la continuation ` +
      `legacy reste permise sous KNOWN ; UNKNOWN non refusé : ${JSON.stringify(refus)} · KNOWN refusé : ` +
      `${JSON.stringify(continuations)}`,
  );
});

// ================================================================== R19 — le registre des intégrations sous C4

/*
 * PLAN-CORRECTIF-PRE-PILOTE-C4 § 6 et § 7 (R19) : `appendIntegrationEvent` décide sur l'état C4
 * avant tout octet — lanes, intégrations, témoins, un seul passage.
 *
 * Sur la base, l'écrivain créait l'en-tête dès que le fichier manquait, sans lire aucun témoin ni
 * l'état des lanes, et ne publiait jamais `ledgers.integrations` : un registre supprimé se
 * recréait sans trace, sous LOST comme sous des lanes inexploitables. Chaque cellule part d'une
 * fixture fraîche, lanes v2 KNOWN par défaut. Les refus comparent registre des lanes, registre des
 * intégrations (présence et octets) et manifeste ; ils doivent nommer l'état C4 attendu.
 *
 * Le chemin réel de `noteAttempt` est éprouvé par la vraie extension, dans un processus à part
 * sous le chargeur : une revue approuvée sur une lane qui conflicte avec la racine ouvre une
 * tentative. Un hook `post-checkout` — l'ouverture du contexte d'intégration est un
 * `git worktree add` — publie `integrations: 1` à cet instant, après FROZEN et avant
 * `noteAttempt` : l'état devient LOST sous l'appelant, comme le ferait un acteur concurrent.
 *
 * Les témoins sont dans la PROPRIÉTÉ : EMPTY crée l'en-tête puis publie le témoin puis écrit ;
 * KNOWN écrit ; KNOWN sans témoin (la fenêtre de crash de C4.1) publie le témoin puis écrit, sans
 * réécrire le préfixe ; le v1 legacy sous manifeste v1 écrit sans témoin.
 */
regressionCorrigee("PG-INTEGRATION-C4", "le registre des intégrations ne s'écrit que sous KNOWN ou EMPTY, témoin publié après l'en-tête", () => {
  const ecarts: string[] = [];
  const temoins: string[] = [];
  let n = 0;
  const tentative = () => {
    n += 1;
    return {
      event: "ATTEMPT_OPENED" as const, id: `${RUN}-W03-${90 + n}`, work_unit: "W03", seq: 90 + n,
      p1: "a".repeat(40), p2: "b".repeat(40), conflicts: ["src/W03.py"], at: AT,
    };
  };
  const entete = `${JSON.stringify({ integration_ledger: 1 })}\n`;
  const ligne = (e: Record<string, unknown>) => `${JSON.stringify(e)}\n`;
  const lire = (p: string) => (existsSync(p) ? readFileSync(p, "utf-8") : null);
  const pertinents = (dir: string) =>
    JSON.stringify([lire(cheminLanes(dir)), lire(cheminIntegrations(dir)), lire(join(dir, "active-run.json"))]);
  const etats = (dir: string) => {
    const temoinsRun = readWitnesses(dir, RUN);
    const lanes = readLaneEvents(dir, RUN);
    const lanesEtat = laneState(temoinsRun, { ...lanes, version: lanes.version }, RUN);
    return { lanes: lanesEtat, integrations: integrationLedgerState(temoinsRun, readIntegrationEvents(dir, RUN), lanesEtat) };
  };
  const temoinManifeste = (dir: string, integrations: number | undefined, lanes: number | undefined = 2) => {
    const m = JSON.parse(readFileSync(join(dir, "active-run.json"), "utf-8")) as Record<string, unknown>;
    const ledgers: Record<string, number> = {};
    if (lanes !== undefined) ledgers.lanes = lanes;
    if (integrations !== undefined) ledgers.integrations = integrations;
    writeFileSync(join(dir, "active-run.json"), `${JSON.stringify({ ...m, ledgers }, null, 2)}\n`);
  };
  const dupliquerLanes = (dir: string) => {
    const l = readFileSync(cheminLanes(dir), "utf-8").trim().split("\n");
    writeFileSync(cheminLanes(dir), `${[...l, l.at(-1)].join("\n")}\n`);
  };
  const connu = (dir: string) => writeFileSync(cheminIntegrations(dir), entete + ligne(tentative()));

  type Cellule = {
    nom: string; ledger?: 1; manifesteV1?: boolean; poser: (dir: string) => void;
    lanes: string; integrations: string;
    refus: boolean;
    /** Pour une cellule positive : la post-image attendue. */
    attendu?: (avantIntegrations: string | null, ajout: string, manifeste: string) => boolean;
  };
  const cellules: Cellule[] = [
    { nom: "1 LOST", poser: (d) => temoinManifeste(d, 1), lanes: "KNOWN", integrations: "LOST", refus: true },
    { nom: "2 UNKNOWN fichier vide", poser: (d) => writeFileSync(cheminIntegrations(d), ""), lanes: "KNOWN", integrations: "UNKNOWN", refus: true },
    { nom: "3 MIGRATION_REQUIRED sans en-tête", poser: (d) => writeFileSync(cheminIntegrations(d), ligne(tentative())),
      lanes: "KNOWN", integrations: "MIGRATION_REQUIRED", refus: true },
    { nom: "4 RUN_WITHOUT_WITNESS manifeste v1, absent", ledger: 1, manifesteV1: true, poser: () => {},
      lanes: "KNOWN", integrations: "RUN_WITHOUT_WITNESS", refus: true },
    { nom: "5 EMPTY apparent, lanes UNKNOWN", poser: (d) => dupliquerLanes(d), lanes: "UNKNOWN", integrations: "UNKNOWN", refus: true },
    { nom: "6 KNOWN apparent, lanes LOST", poser: (d) => { connu(d); rmSync(cheminLanes(d)); }, lanes: "LOST", integrations: "UNKNOWN", refus: true },
    { nom: "7 KNOWN apparent, lanes MIGRATION_REQUIRED", poser: (d) => {
      connu(d); writeFileSync(cheminLanes(d), readFileSync(cheminLanes(d), "utf-8").split("\n").slice(1).join("\n"));
    }, lanes: "MIGRATION_REQUIRED", integrations: "UNKNOWN", refus: true },
    { nom: "8 KNOWN apparent, lanes RUN_WITHOUT_WITNESS", poser: (d) => {
      connu(d);
      const m = JSON.parse(readFileSync(join(d, "active-run.json"), "utf-8")) as Record<string, unknown>;
      delete m.ledgers; delete m.planHash;
      writeFileSync(join(d, "active-run.json"), `${JSON.stringify({ ...m, version: 1 }, null, 2)}\n`);
    }, lanes: "RUN_WITHOUT_WITNESS", integrations: "UNKNOWN", refus: true },
    { nom: "9 EMPTY, lanes KNOWN", poser: () => {}, lanes: "KNOWN", integrations: "EMPTY", refus: false,
      attendu: (avant, ajout, m) => avant === null && ajout.startsWith(entete) && ajout.split("\n").length === 3 &&
        /"integrations": 1/.test(m) },
    { nom: "10 KNOWN, témoin 1", poser: (d) => { connu(d); temoinManifeste(d, 1); }, lanes: "KNOWN", integrations: "KNOWN", refus: false,
      attendu: (avant, ajout, m) => avant !== null && ajout.split("\n").length === 2 && /"integrations": 1/.test(m) },
    { nom: "11 KNOWN sans témoin (fenêtre C4.1)", poser: (d) => connu(d), lanes: "KNOWN", integrations: "KNOWN", refus: false,
      attendu: (avant, ajout, m) => avant !== null && ajout.split("\n").length === 2 && /"integrations": 1/.test(m) },
    { nom: "12 témoin contradictoire", poser: (d) => { connu(d); temoinManifeste(d, 2); }, lanes: "KNOWN", integrations: "UNKNOWN", refus: true },
    { nom: "14 legacy : manifeste v1, lanes v1, intégrations v1", ledger: 1, manifesteV1: true, poser: (d) => connu(d),
      lanes: "KNOWN", integrations: "KNOWN", refus: false,
      attendu: (avant, ajout, m) => avant !== null && ajout.split("\n").length === 2 && !/integrations/.test(m) },
  ];

  for (const c of cellules) {
    const r = runEcrit(`l0-b1-pgi4-`, [{ unite: "W03", ouverte: true }], c.ledger ? { ledger: 1, manifesteV1: c.manifesteV1 } : {});
    c.poser(r.dir);
    const vu = etats(r.dir);
    precondition(vu.lanes === c.lanes && vu.integrations === c.integrations,
      `${c.nom} : états lanes ${vu.lanes} (attendu ${c.lanes}), intégrations ${vu.integrations} (attendu ${c.integrations})`);
    const pris = acquireRunOwnership(r.dir, RUN, `pgi4-${n}`);
    precondition(pris.ok, `${c.nom} : le bail doit être obtenu`);
    const bail = pris.ok ? pris.lease : undefined;
    const avant = pertinents(r.dir);
    const avantIntegrations = lire(cheminIntegrations(r.dir));
    const i = issue(() => appendIntegrationEvent(r.dir, tentative(), bail!));
    if (c.refus) {
      const nomme = i.kind === "threw" && i.error.includes(`registre des intégrations ${RUN} ${c.integrations} (lanes ${c.lanes})`);
      if (!(nomme && pertinents(r.dir) === avant)) {
        ecarts.push(`${c.nom} : refus nommé ${nomme}, artefacts ${pertinents(r.dir) === avant ? "intacts" : "MODIFIÉS"} ; ${montrer(i)}`);
      }
    } else {
      const apresIntegrations = lire(cheminIntegrations(r.dir)) ?? "";
      const ajout = avantIntegrations === null ? apresIntegrations : apresIntegrations.slice(avantIntegrations.length);
      const prefixe = avantIntegrations === null || apresIntegrations.startsWith(avantIntegrations);
      const m = lire(join(r.dir, "active-run.json")) ?? "";
      if (!(i.kind === "returned" && prefixe && c.attendu!(avantIntegrations, ajout, m) && etats(r.dir).integrations === "KNOWN")) {
        temoins.push(`${c.nom} : issue ${montrer(i)}, préfixe ${prefixe}, ajout ${JSON.stringify(ajout).slice(0, 160)}, ` +
          `état après ${etats(r.dir).integrations}`);
      }
    }
  }

  // 13. Le chemin réel de noteAttempt, sous le chargeur.
  const repo = join(import.meta.dirname, "..");
  const code =
    `import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";\n` +
    `import { join } from "node:path";\n` +
    `import { PILOTE } from ${JSON.stringify(join(repo, "tests", "stubs", "dispatch.ts"))};\n` +
    `import { ecrire, git, monter, revue, tache, texte } from ${JSON.stringify(join(repo, "tests", "l0-b2-harness.ts"))};\n` +
    `const h = await monter();\n` +
    `PILOTE.pendant = ecrire("src/a.py", "a = 2\\n");\n` +
    `const r1 = await h.outil.execute("1", tache("W03"));\n` +
    `PILOTE.pendant = undefined;\n` +
    `writeFileSync(join(h.root, "src", "a.py"), "a = 'racine'\\n"); git(h.root, "add", "-A"); git(h.root, "commit", "-qm", "la racine avance");\n` +
    `const manifeste = join(h.runDir, "active-run.json"); const marqueur = join(h.root, ".git", "pgi4-hook");\n` +
    `const edition = "const fs=require('fs');const p=" + JSON.stringify(manifeste) + ";const m=JSON.parse(fs.readFileSync(p,'utf-8'));" +\n` +
    `  "m.ledgers={...(m.ledgers||{}),integrations:1};fs.writeFileSync(p,JSON.stringify(m,null,2)+'\\\\n');";\n` +
    `writeFileSync(join(h.root, ".git", "hooks", "post-checkout"),\n` +
    `  "#!/bin/sh\\ncase \\"$PWD\\" in *pi-integrations*) " + JSON.stringify(process.execPath) + " -e \\"" + edition.replace(/"/g, '\\\\"') + "\\" && touch " + JSON.stringify(marqueur) + " ;; esac\\n");\n` +
    `chmodSync(join(h.root, ".git", "hooks", "post-checkout"), 0o755);\n` +
    `const integ = join(h.runDir, h.runId + "-integrations.jsonl");\n` +
    `const avant = existsSync(integ) ? readFileSync(integ, "utf-8") : null;\n` +
    `let issue;\n` +
    `try { const r = await h.outil.execute("2", revue("W03")); issue = { erreur: r.isError === true, texte: texte(r) }; }\n` +
    `catch (e) { issue = { erreur: true, texte: "EXCEPTION " + (e && e.message) }; }\n` +
    `PILOTE.resultat = undefined;\n` +
    `console.log("PGI4 " + JSON.stringify({ runId: h.runId, premier: !r1.isError, avant, apres: existsSync(integ) ? readFileSync(integ, "utf-8") : null,\n` +
    `  hook: existsSync(marqueur), ...issue }));\n` +
    `h.fin();\n`;
  const flagsNode = Number(process.versions.node.split(".")[0]) < 23 ? ["--experimental-strip-types"] : [];
  const p = spawnSync(process.execPath, [...flagsNode, "--import", "./tests/stubs/loader.mjs", "--input-type=module", "-e", code], {
    cwd: repo, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
  });
  const releve = `${p.stdout}`.split("\n").find((l) => l.startsWith("PGI4 "));
  precondition(releve !== undefined, `noteAttempt : le processus doit rendre son relevé ; code ${p.status}, ${`${p.stderr}`.slice(-400)}`);
  const vu = JSON.parse(releve!.slice(5)) as { runId: string; premier: boolean; avant: string | null; apres: string | null; hook: boolean; erreur: boolean; texte: string };
  precondition(vu.premier && vu.avant === null, `noteAttempt : la lane doit être ouverte et aucune tentative encore écrite ; ${JSON.stringify(vu).slice(0, 300)}`);
  precondition(vu.hook, `noteAttempt : l'ouverture du contexte d'intégration doit avoir eu lieu (hook exécuté) ; ${vu.texte.slice(0, 200)}`);
  // Le refus d'appendIntegrationEvent remonte en exception jusqu'à l'outil : la séquence est déjà réservée et le
  // contexte d'intégration ouvert, mais aucun octet n'est écrit (fermé par défaut). C'est le refus central qui
  // est exigé, pas un refus quelconque.
  const refusCentral = vu.texte.includes(`registre des intégrations ${vu.runId} LOST (lanes KNOWN)`) &&
    vu.texte.includes("aucun ATTEMPT_OPENED");
  if (!(vu.apres === null && vu.erreur && refusCentral)) {
    ecarts.push(`13 noteAttempt sous LOST : registre ${JSON.stringify(vu.apres)}, erreur ${vu.erreur}, ${vu.texte.slice(0, 200)}`);
  }

  propriete(
    ecarts.length === 0 && temoins.length === 0,
    `hors KNOWN et EMPTY, aucun événement d'intégration n'est écrit, noteAttempt compris ; EMPTY crée puis publie ` +
      `le témoin, KNOWN écrit, la fenêtre C4.1 reprend son témoin ; refus manquants ${JSON.stringify(ecarts)} · ` +
      `témoins faux ${JSON.stringify(temoins)}`,
  );
});

// ================================================================== § F — générations

regressionCorrigee("F-generation", "l'identité d'une lane porte sa génération dès la première", () => {
  const id = issue(() => laneIdFor("W03", RUN));
  precondition(id.kind === "returned", `laneIdFor doit rendre un identifiant ; rendu : ${montrer(id)}`);
  propriete(
    id.value === `${RUN}-W03-g1`,
    `une seule grammaire, dès g1 : rendu ${JSON.stringify(id.value)}, attendu ` +
      `${JSON.stringify(`${RUN}-W03-g1`)}`,
  );
});




preservation("F-generation-isolation", "deux générations successives ne partagent ni worktree ni branche", () => {
  const r = runEcrit("l0-b1-iso-", [{ unite: "W03", abandonnee: true }], { ledger: 1 });
  const g2 = issue(() => ensureLane(r.root, `${RUN}-W03-g2`));
  precondition(g2.kind === "returned", `g2 doit s'ouvrir après l'abandon ; rendu : ${montrer(g2)}`);
  const b = g2.value as { cwd: string; branch: string };
  propriete(
    !b.cwd.endsWith(`${RUN}-W03`) &&
      !b.branch.endsWith(`${RUN}-W03`) &&
      runBranches(r.root, RUN).length === 2,
    `chaque génération garde son worktree et sa branche ; g2 ${b.branch}, branches ` +
      `${JSON.stringify(runBranches(r.root, RUN))}`,
  );
});

preservation("F-generation-idempotente", "rouvrir une lane existante la rend au lieu de la recréer", () => {
  const r = runEcrit("l0-b1-idem-", [{ unite: "W03", ouverte: true }], { ledger: 1 });
  const lane = `${RUN}-W03`;
  const seconde = issue(() => ensureLane(r.root, lane));
  const creee = seconde.kind === "returned" && (seconde.value as { created?: boolean }).created === true;
  propriete(
    seconde.kind === "returned" && !creee && openLanes(r.root).filter((l) => l === lane).length === 1,
    `rouvrir doit rendre la lane, sans échouer ni la recréer ; rendu ${montrer(seconde)}, lanes ` +
      `${JSON.stringify(openLanes(r.root))}`,
  );
});

regressionCorrigee("F-generation-ancienne", "un identifiant écrit avant les générations se reconstruit comme g1", () => {
  const d = depot("l0-b1-ancien-");
  manifeste(d.dir, { version: 1 });
  plan(d.dir, ["W03"]);
  ensureLane(d.root, `${RUN}-W03`);
  const r = new Registre(1);
  r.ajouterV1("W03", { event: "OPENED", base: d.base });
  r.ecrire(d.dir);
  const lu = lireLanes(d.root, d.dir);
  const ouverture = evenements(lu).find((e) => e.event === "OPENED");
  propriete(
    exploitable(lu) && ouverture?.generation === 1,
    `les registres antérieurs aux générations se relisent comme g1, pas seulement « lisibles » ; ` +
      `ouverture reconstruite : ${JSON.stringify(ouverture)}`,
  );
});

// ================================================================== provenance inconnue

preservation("F-orpheline-worktree", "un worktree sans OPENED est signalé comme tel, et conservé", () => {
  const r = runEcrit("l0-b1-orph-wt-", [{ unite: "W03", integree: true }], { ledger: 1 });
  const orpheline = `${RUN}-W09`;
  ensureLane(r.root, orpheline);
  const lu = lireLanes(r.root, r.dir);
  precondition(exploitable(lu), `le registre doit rester exploitable ; lu : ${montrer(lu)}`);
  const trouve = conflits(lu).find(([u]) => u === "W09");
  propriete(
    trouve?.[1] === "worktree-orphelin" && openLanes(r.root).includes(orpheline),
    `la contradiction doit nommer l'unité et sa nature, et la lane survivre ; conflits ` +
      `${JSON.stringify(conflits(lu))}, lanes ${JSON.stringify(openLanes(r.root))}`,
  );
});

preservation("F-orpheline-branche", "une branche sans worktree ni OPENED est signalée sans provenance", () => {
  const r = runEcrit("l0-b1-orph-br-", [{ unite: "W03", integree: true }], { ledger: 1 });
  const orpheline = `${RUN}-W09`;
  const lane = ensureLane(r.root, orpheline);
  git(r.root, "worktree", "remove", "--force", lane.cwd);
  precondition(!openLanes(r.root).includes(orpheline), "le worktree doit être retiré");
  precondition(runBranches(r.root, RUN).some((b) => b.includes("W09")), "la branche doit survivre");
  const lu = lireLanes(r.root, r.dir);
  const trouve = conflits(lu).find(([u]) => u === "W09");
  propriete(
    trouve?.[1] === "branche-sans-provenance" && runBranches(r.root, RUN).some((b) => b.includes("W09")),
    `la branche orpheline doit être nommée et conservée ; conflits ${JSON.stringify(conflits(lu))}`,
  );
});
