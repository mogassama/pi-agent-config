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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { laneIdFor } from "../subagent-only/lane-context.ts";
import { observeLanes } from "../subagent-only/lane-observe.ts";
import { observeIntegrations } from "../subagent-only/integration-observe.ts";
import { openRun, readLaneEvents } from "../subagent-only/run-manifest.ts";
import { ensureLane, openLanes, runBranches } from "../subagent-only/worktree.ts";
import {
  aJeter, cheminIntegrations, cheminLanes, depot, git, manifeste, plan, Registre, RUN, runEcrit,
} from "./l0-b1-fixtures.ts";

// ------------------------------------------------------------------ espèces

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
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
  return { events: lu.events, malformedLines: lu.malformedLines, version: lu.version };
};
const lireLanes = (root: string, dir: string) =>
  issue(() => observeLanes({ root, runId: RUN, laneRead: laneRead(dir) }));
const lireIntegrations = (root: string, dir: string) =>
  issue(() => observeIntegrations({ root, runDir: dir, runId: RUN, laneRead: laneRead(dir) }));

// ================================================================== § F — le vocabulaire v2

regression("F-ledger-v2", "les huit natures d'événement v2 se relisent et se reconstruisent", () => {
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

regression("C4-etats", "les six issues de lecture portent chacune leur discriminant structuré", () => {
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

regression("C4-integrations", "le registre des intégrations porte aussi EMPTY, LOST et UNKNOWN", () => {
  const r = runEcrit("l0-b1-int-", [{ unite: "W03", integree: true }]);
  precondition(!existsSync(cheminIntegrations(r.dir)), "le registre des intégrations doit être absent");
  const absent = etat(lireIntegrations(r.root, r.dir));

  manifeste(r.dir, {
    version: 2, base: r.base, plan: `${RUN}-plan.json`, ledgers: { lanes: 2, integrations: 1 },
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

regression("C4-ledgers-partielle", "la table des témoins reste partielle tant qu'un registre n'a pas d'en-tête", () => {
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

// ================================================================== § F — générations

regression("F-generation", "l'identité d'une lane porte sa génération dès la première", () => {
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

regression("F-generation-ancienne", "un identifiant écrit avant les générations se reconstruit comme g1", () => {
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
