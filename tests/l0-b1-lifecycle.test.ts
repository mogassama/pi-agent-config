/**
 * l0-b1-lifecycle.test.ts — L0, vague B1 : terminaison, succession, archive.
 *
 * Ces preuves consomment les formats et les lecteurs prouvés dans
 * `l0-b1-registres.test.ts`, et suivent donc dans l'ordre interne du lot.
 *
 * La surface publique du verbe de fin est le dispatcher existant,
 * `bin/subagent-recover`, appelé avec le nouveau verbe. Pas d'import d'un symbole
 * futur : un import manquant rougirait au chargement, et le rouge ne dirait plus
 * rien sur le comportement. `issue()` n'entoure que cet appel.
 *
 * Les fixtures viennent de `l0-b1-fixtures.ts` : manifeste v2, registre v2, unités
 * intégrées réellement mergées dans git et privées de leur worktree.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { acquireRunOwnership } from "../subagent-only/run-manifest.ts";
import { openLanes } from "../subagent-only/worktree.ts";
import {
  aJeter, AT, cheminIntegrations, cheminLanes, GUARD_STALE_MS, manifeste, RUN, runEcrit,
} from "./l0-b1-fixtures.ts";

// ------------------------------------------------------------------ espèces

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
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
const montrer = (i: Issue): string => (JSON.stringify(i) ?? "(indicible)").slice(0, 300);

// ------------------------------------------------------------------ la surface publique

const REPO = join(import.meta.dirname, "..");
type Sortie = { status: number | null; sortie: string };
const flags = (): string[] =>
  Number(process.versions.node.split(".")[0]) < 23 ? ["--experimental-strip-types"] : [];
function recover(root: string, ...args: string[]): Sortie {
  const p = spawnSync(process.execPath, [...flags(), join(REPO, "bin", "subagent-recover"), ...args], {
    cwd: root, encoding: "utf-8",
  });
  return { status: p.status, sortie: `${p.stdout}${p.stderr}` };
}
const aAbouti = (s: Sortie): boolean => s.status === 0;
const aRefuse = (s: Sortie): boolean => typeof s.status === "number" && s.status !== 0;
const traceBrute = (s: Sortie): boolean =>
  /^\s+at .*\(.*:\d+:\d+\)$/m.test(s.sortie) || /Error: .*\n\s+at /.test(s.sortie);
const sortieDe = (i: Issue): Sortie => i.value as Sortie;

/**
 * Deux processus réellement simultanés, tenus à une barrière déterministe.
 *
 * `spawnSync` deux fois de suite n'est pas de la concurrence : le second démarre quand le
 * premier a fini. Une attente de durée fixe n'en est pas une preuve non plus. Chaque enfant
 * annonce donc qu'il est prêt par un témoin qui lui est propre, et le parent ne libère
 * qu'après les avoir vus tous les deux — ce qu'une PRÉCONDITION affirme.
 */
const attendre = async (condition: () => boolean, msMax = 30_000): Promise<boolean> => {
  for (let i = 0; i * 10 < msMax; i++) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return condition();
};

/** Le corps d'un enfant : annoncer, attendre la libération, puis agir. */
function corpsEnfant(pret: string, release: string, action: string): string {
  return (
    /*
     * Un espace de noms à part, pas des liaisons nommées : l'action qui suit importe elle
     * aussi `node:fs`, et deux `existsSync` dans le même module est une erreur de syntaxe
     * — l'enfant meurt alors avant de s'annoncer, et la barrière expire sans rien dire.
     *
     * L'attente dort au lieu de tourner : plusieurs enfants en boucle serrée saturent la
     * machine et font expirer la barrière qu'ils sont censés respecter.
     */
    `import * as fsBarriere from "node:fs";\n` +
    `fsBarriere.writeFileSync(${JSON.stringify(pret)}, "");\n` +
    `while (!fsBarriere.existsSync(${JSON.stringify(release)})) { await new Promise((r) => setTimeout(r, 5)); }\n` +
    action
  );
}
const actionRecover = (root: string, args: string[]): string =>
  `import * as enfantProc from "node:child_process";\n` +
  `const p = enfantProc.spawnSync(process.execPath, ${JSON.stringify([...flags(), join(REPO, "bin", "subagent-recover"), ...args])}, ` +
  `{ cwd: ${JSON.stringify(root)}, encoding: "utf-8" });\n` +
  `process.stdout.write(\`\${p.stdout}\${p.stderr}\`);\n` +
  `process.exit(p.status ?? 1);`;
/**
 * Ouvrir un run, et dire ce qu'on voyait À CET INSTANT.
 *
 * Un état final correct ne prouve pas l'ordre : un successeur créé trop tôt, puis rangé,
 * passerait. L'enfant relève donc, juste après `openRun`, si l'archive de R était là et si
 * `active-run.json` avait changé de main.
 */
const actionOuvrir = (dir: string, archive: string): string =>
  `import { existsSync, readFileSync } from "node:fs";\n` +
  `import { openRun } from ${JSON.stringify(join(REPO, "subagent-only", "run-manifest.ts"))};\n` +
  `try {\n` +
  `  const o = openRun(${JSON.stringify(dir)}, undefined);\n` +
  `  const p = ${JSON.stringify(join(dir, "active-run.json"))};\n` +
  `  const actif = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : {};\n` +
  `  console.log(JSON.stringify({ runId: o.manifest.runId, resumed: o.resumed,\n` +
  `    archiveRVisible: existsSync(${JSON.stringify(archive)}),\n` +
  `    ancienRunLibere: actif.runId !== ${JSON.stringify(RUN)}, activeRunId: actif.runId }));\n` +
  `} catch (e) { console.log(JSON.stringify({ err: e.constructor.name, message: e.message })); }`;

function enfant(code: string): Promise<Sortie> {
  return new Promise((resolve) => {
    // `spawn` ne prend pas `encoding` — c'est `spawnSync` qui l'accepte. Les flux se
    // décodent donc explicitement, sinon le type du processus s'effondre en `never`.
    const p = spawn(process.execPath, [...flags(), "--input-type=module", "-e", code]);
    let sortie = "";
    p.stdout.setEncoding("utf-8");
    p.stderr.setEncoding("utf-8");
    p.stdout.on("data", (d: string) => { sortie += d; });
    p.stderr.on("data", (d: string) => { sortie += d; });
    p.on("close", (status: number | null) => resolve({ status, sortie }));
  });
}

// ------------------------------------------------------------------ l'état, lu sur le disque

const archives = (dir: string): string[] =>
  readdirSync(dir).filter((f) => /^[0-9a-f]+-run\.json$/.test(f)).sort();
const actif = (dir: string): boolean => existsSync(join(dir, "active-run.json"));
const lireJson = (p: string): Record<string, unknown> | undefined =>
  existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>) : undefined;
const empreinte = (p: string): string => {
  const st = statSync(p);
  return `${st.ino}:${st.mtimeMs}:${readFileSync(p, "utf-8").length}`;
};

/** Ce qui manque à un manifeste terminal pour être complet (C1.8, § F). */
function terminalComplet(
  archive: Record<string, unknown> | undefined,
  outcome: string,
  actifAvant: Record<string, unknown>,
): string[] {
  const manques: string[] = [];
  if (!archive) return ["archive absente"];
  const ended = archive.ended as Record<string, unknown> | undefined;
  if (archive.runId !== RUN) manques.push(`runId ${String(archive.runId)}`);
  if (archive.status !== outcome) manques.push(`status ${String(archive.status)}`);
  if (!ended) manques.push("ended absent");
  else {
    if (typeof ended.at !== "string") manques.push("ended.at");
    if (typeof ended.by !== "string") manques.push("ended.by");
    if (ended.outcome !== outcome) manques.push(`ended.outcome ${String(ended.outcome)}`);
  }
  for (const champ of ["plan", "baseCommit", "ledgers", "version"]) {
    if (JSON.stringify(archive[champ]) !== JSON.stringify(actifAvant[champ])) {
      manques.push(`${champ} non conservé`);
    }
  }
  return manques;
}

// ================================================================== C1.8 — la fin d'un run

regression("C1.8-completed", "un run dont tout est intégré se termine, et son archive dit tout", () => {
  const r = runEcrit("l0-b1-fin-", [{ unite: "W03", integree: true }, { unite: "W09", integree: true }]);
  const avant = lireJson(join(r.dir, "active-run.json"))!;
  precondition(avant.status === "active", `le run doit être actif, vu : ${String(avant.status)}`);
  precondition(avant.version === 2, `le manifeste doit être v2, vu : ${String(avant.version)}`);
  precondition(openLanes(r.root).length === 0, "aucune lane ne doit rester ouverte");
  precondition(
    readFileSync(cheminLanes(r.dir), "utf-8").split("INTEGRATED").length === 3,
    "les deux unités doivent être intégrées au registre",
  );

  const i = issue(() => recover(r.root, "run", "completed"));
  precondition(i.kind === "returned", `le dispatcher doit rendre une sortie ; rendu : ${montrer(i)}`);
  const manques = terminalComplet(lireJson(join(r.dir, `${RUN}-run.json`)), "completed", avant);
  propriete(
    aAbouti(sortieDe(i)) && archives(r.dir).length === 1 && !actif(r.dir) && manques.length === 0,
    `le verbe doit aboutir, archiver un manifeste terminal complet et libérer active-run.json ; ` +
      `code ${sortieDe(i).status}, archives ${JSON.stringify(archives(r.dir))}, actif ${actif(r.dir)}, ` +
      `manques ${JSON.stringify(manques)}`,
  );
});

regression("C1.8-preconditions", "chaque précondition manquante refuse la fin, et le run sain l'obtient", () => {
  const cas: Array<[string, ReturnType<typeof runEcrit>]> = [];

  cas.push(["lane ouverte", runEcrit("l0-b1-pre-lane-", [{ unite: "W03", integree: true }, { unite: "W09", ouverte: true }])]);
  cas.push(["risque non résolu", runEcrit("l0-b1-pre-risque-", [{ unite: "W03", integree: true, risqueOuvert: true }])]);

  const sale = runEcrit("l0-b1-pre-sale-", [{ unite: "W03", integree: true }]);
  writeFileSync(join(sale.root, "src", "a.py"), "a = 2\n");
  cas.push(["racine sale", sale]);

  const sansPlan = runEcrit("l0-b1-pre-plan-", [{ unite: "W03", integree: true }]);
  unlinkSync(join(sansPlan.dir, `${RUN}-plan.json`));
  cas.push(["plan absent", sansPlan]);

  // Une unité que le plan connaît, jamais ouverte : ni lane, ni OPENED.
  const jamais = runEcrit("l0-b1-pre-jamais-", [{ unite: "W03", integree: true }]);
  const planJamais = lireJson(join(jamais.dir, `${RUN}-plan.json`))!;
  (planJamais.work_units as unknown[]).push({ id: "W42", goal: "faire W42", depends_on: [], expected_write_scope: ["src/W42.py"] });
  writeFileSync(join(jamais.dir, `${RUN}-plan.json`), `${JSON.stringify(planJamais, null, 2)}\n`);
  cas.push(["unité jamais ouverte", jamais]);

  const tentative = runEcrit("l0-b1-pre-tentative-", [{ unite: "W03", integree: true }]);
  writeFileSync(cheminIntegrations(tentative.dir), `${JSON.stringify({ integration_ledger: 1 })}\n${JSON.stringify({
    event: "ATTEMPT_OPENED", id: `${RUN}-W03-1`, work_unit: "W03", seq: 1,
    p1: tentative.base, p2: tentative.base, conflicts: ["src/a.py"], at: AT,
  })}\n`);
  manifeste(tentative.dir, {
    version: 2, base: tentative.base, plan: `${RUN}-plan.json`, ledgers: { lanes: 2, integrations: 1 },
  });
  cas.push(["tentative d'intégration ouverte", tentative]);

  const passes: string[] = [];
  for (const [nom, ctx] of cas) {
    const i = issue(() => recover(ctx.root, "run", "completed"));
    precondition(i.kind === "returned", `le dispatcher doit rendre une sortie pour « ${nom} »`);
    if (!aRefuse(sortieDe(i)) || archives(ctx.dir).length > 0 || !actif(ctx.dir)) passes.push(nom);
  }

  /*
   * Le contrôle positif appartient à la propriété, pas à la précondition.
   *
   * « Chaque cas dégradé refuse » est vrai d'un verbe qui refuse tout, y compris de
   * celui qui n'existe pas. Sans le run sain qui aboutit, cette preuve serait verte
   * sur l'objet pour la mauvaise raison.
   */
  const sain = runEcrit("l0-b1-pre-sain-", [{ unite: "W03", integree: true }]);
  const iSain = issue(() => recover(sain.root, "run", "completed"));
  precondition(iSain.kind === "returned", "le dispatcher doit rendre une sortie pour le run sain");
  const saineAboutie = aAbouti(sortieDe(iSain)) && archives(sain.dir).length === 1 && !actif(sain.dir);

  propriete(
    passes.length === 0 && saineAboutie,
    `le run sain doit aboutir (${saineAboutie}) et chacun des ${cas.length} cas dégradés refuser ` +
      `sans archiver ni libérer ; ont abouti à tort : ${JSON.stringify(passes)}`,
  );
});

regression("C1.8-abandoned", "abandoned exige une raison, aucun propriétaire vivant, et dit ce qu'il conserve", () => {
  const sansRaison = runEcrit("l0-b1-ab-sans-", [{ unite: "W03", ouverte: true }]);
  const i1 = issue(() => recover(sansRaison.root, "run", "abandoned"));
  precondition(i1.kind === "returned", "le dispatcher doit répondre sans raison");
  const refuseSansRaison = aRefuse(sortieDe(i1)) && archives(sansRaison.dir).length === 0;

  const tenu = runEcrit("l0-b1-ab-tenu-", [{ unite: "W03", ouverte: true }]);
  const pris = acquireRunOwnership(tenu.dir, RUN, "session-vivante");
  precondition(pris.ok, "le bail doit être détenu par une session vivante");
  const i2 = issue(() => recover(tenu.root, "run", "abandoned", "--reason", "essai"));
  precondition(i2.kind === "returned", "le dispatcher doit répondre sous bail tenu");
  const refuseSousBail = aRefuse(sortieDe(i2)) && archives(tenu.dir).length === 0;

  const libre = runEcrit("l0-b1-ab-libre-", [{ unite: "W03", ouverte: true }]);
  const avant = lireJson(join(libre.dir, "active-run.json"))!;
  const i3 = issue(() => recover(libre.root, "run", "abandoned", "--reason", "plan remplacé"));
  precondition(i3.kind === "returned", "le dispatcher doit répondre avec raison");
  const archive = lireJson(join(libre.dir, `${RUN}-run.json`));
  const manques = terminalComplet(archive, "abandoned", avant);
  const raison = (archive?.ended as Record<string, unknown> | undefined)?.reason;
  const aboutit = aAbouti(sortieDe(i3)) && manques.length === 0 && raison === "plan remplacé";

  // Le cas que C0 autorise : un registre illisible n'empêche pas d'abandonner, et
  // l'abandon ne prétend pas avoir traité les lanes qu'il ne sait pas relire.
  const abime = runEcrit("l0-b1-ab-abime-", [{ unite: "W03", ouverte: true }]);
  const registreAvant = readFileSync(cheminLanes(abime.dir), "utf-8");
  writeFileSync(cheminLanes(abime.dir), `${registreAvant}{ ligne abîmée\n`);
  const i4 = issue(() => recover(abime.root, "run", "abandoned", "--reason", "registre illisible"));
  precondition(i4.kind === "returned", "le dispatcher doit répondre sur registre illisible");
  const archiveAbimee = lireJson(join(abime.dir, `${RUN}-run.json`));
  const conserve =
    aAbouti(sortieDe(i4)) &&
    archiveAbimee?.status === "abandoned" &&
    readFileSync(cheminLanes(abime.dir), "utf-8").startsWith(registreAvant) &&
    openLanes(abime.root).length === 1 &&
    !readFileSync(cheminLanes(abime.dir), "utf-8").includes("ABANDONED");

  propriete(
    refuseSansRaison && refuseSousBail && aboutit && conserve,
    `sans raison refusé ${refuseSansRaison} · sous bail vivant refusé ${refuseSousBail} · ` +
      `avec raison abouti et ended complet ${aboutit} (manques ${JSON.stringify(manques)}, raison ` +
      `${JSON.stringify(raison)}) · registre illisible : terminalisé sans prétendre abandonner ses ` +
      `lanes ${conserve}`,
  );
});

regression("C1.8-idempotence", "une fin rejouée sur une archive identique aboutit sans la réécrire", () => {
  const r = runEcrit("l0-b1-idem-fin-", [{ unite: "W03", integree: true }]);
  const avant = lireJson(join(r.dir, "active-run.json"))!;
  /*
   * L'état canonique du crash entre `link` et `unlink` : l'archive existe déjà, et
   * `active-run.json` porte encore le même manifeste, terminal. Rejouer doit conclure,
   * pas recommencer.
   */
  const terminal = { ...avant, status: "completed", ended: { at: AT, by: "operator", outcome: "completed" } };
  writeFileSync(join(r.dir, `${RUN}-run.json`), `${JSON.stringify(terminal, null, 2)}\n`);
  writeFileSync(join(r.dir, "active-run.json"), `${JSON.stringify(terminal, null, 2)}\n`);
  const marque = empreinte(join(r.dir, `${RUN}-run.json`));
  const contenu = readFileSync(join(r.dir, `${RUN}-run.json`), "utf-8");

  const i = issue(() => recover(r.root, "run", "completed"));
  precondition(i.kind === "returned", `le dispatcher doit rendre une sortie ; rendu : ${montrer(i)}`);
  const apres = existsSync(join(r.dir, `${RUN}-run.json`));
  propriete(
    aAbouti(sortieDe(i)) &&
      apres &&
      readFileSync(join(r.dir, `${RUN}-run.json`), "utf-8") === contenu &&
      empreinte(join(r.dir, `${RUN}-run.json`)) === marque &&
      !actif(r.dir),
    `rejouer doit conclure sans réécrire : code ${sortieDe(i).status}, archive présente ${apres}, ` +
      `empreinte ${apres ? empreinte(join(r.dir, `${RUN}-run.json`)) : "—"} contre ${marque}, ` +
      `actif ${actif(r.dir)}`,
  );
});

// ================================================================== A-P1-F01 — succession

regression("A-P1-F01-reprise", "un manifeste terminal publié sans archive est repris et archivé", () => {
  const r = runEcrit("l0-b1-succ-a-", [{ unite: "W03", integree: true }]);
  const avant = lireJson(join(r.dir, "active-run.json"))!;
  // Le crash de C1.9 : terminal publié, archive pas encore écrite. Tous les champs
  // du manifeste actif sont conservés.
  const terminal = { ...avant, status: "completed", ended: { at: AT, by: "operator", outcome: "completed" } };
  writeFileSync(join(r.dir, "active-run.json"), `${JSON.stringify(terminal, null, 2)}\n`);
  precondition(archives(r.dir).length === 0, "aucune archive ne doit exister avant la reprise");

  const i = issue(() => recover(r.root, "run", "completed"));
  precondition(i.kind === "returned", `le dispatcher doit rendre une sortie ; rendu : ${montrer(i)}`);
  const manques = terminalComplet(lireJson(join(r.dir, `${RUN}-run.json`)), "completed", avant);
  propriete(
    aAbouti(sortieDe(i)) && archives(r.dir).length === 1 && !actif(r.dir) && manques.length === 0,
    `la reprise doit réussir, archiver et libérer ; code ${sortieDe(i).status}, archives ` +
      `${JSON.stringify(archives(r.dir))}, actif ${actif(r.dir)}, manques ${JSON.stringify(manques)}`,
  );
});

regression("A-P1-F01-archive", "une archive contradictoire est refusée, jamais remplacée", () => {
  const r = runEcrit("l0-b1-succ-b-", [{ unite: "W03", integree: true }]);
  const autre = {
    version: 2, runId: RUN, status: "abandoned", nextSeq: 99,
    ended: { at: AT, by: "operator", outcome: "abandoned", reason: "une autre histoire" },
  };
  writeFileSync(join(r.dir, `${RUN}-run.json`), `${JSON.stringify(autre, null, 2)}\n`);
  const contenu = readFileSync(join(r.dir, `${RUN}-run.json`), "utf-8");
  const marque = empreinte(join(r.dir, `${RUN}-run.json`));

  const i = issue(() => recover(r.root, "run", "completed"));
  precondition(i.kind === "returned", `le dispatcher doit rendre une sortie ; rendu : ${montrer(i)}`);
  const refusee =
    aRefuse(sortieDe(i)) &&
    readFileSync(join(r.dir, `${RUN}-run.json`), "utf-8") === contenu &&
    empreinte(join(r.dir, `${RUN}-run.json`)) === marque &&
    actif(r.dir);

  /*
   * Le contrôle discriminant : la même fixture, sans l'archive contradictoire, doit
   * aboutir. Sans lui, « refusé » serait vrai d'un verbe qui refuse tout.
   */
  const temoin = runEcrit("l0-b1-succ-b-temoin-", [{ unite: "W03", integree: true }]);
  const iTemoin = issue(() => recover(temoin.root, "run", "completed"));
  precondition(iTemoin.kind === "returned", "le témoin doit rendre une sortie");
  const temoinAbouti = aAbouti(sortieDe(iTemoin)) && archives(temoin.dir).length === 1;

  propriete(
    refusee && temoinAbouti,
    `l'archive d'un autre contenu doit faire refuser et rester intacte (${refusee}), alors que ` +
      `la même fin sans archive préexistante aboutit (${temoinAbouti}) ; code ${sortieDe(i).status}`,
  );
});

regression("A-P1-F01-concurrence", "deux fins simultanées ne produisent qu'une transition", async () => {
  const r = runEcrit("l0-b1-succ-c-", [{ unite: "W03", integree: true }]);
  const release = join(r.dir, "release");
  const prets = [join(r.dir, "ready-1"), join(r.dir, "ready-2")];
  const deux = prets.map((pret) => enfant(corpsEnfant(pret, release, actionRecover(r.root, ["run", "completed"]))));
  const armes = await attendre(() => prets.every((p) => existsSync(p)));
  // Libérer puis rejoindre AVANT d'affirmer : lever ici laisserait les deux enfants
  // tourner dans leur boucle d'attente, et le test finirait sans eux.
  writeFileSync(release, "");
  const sorties = await Promise.all(deux);
  precondition(armes, "les deux enfants doivent s'être annoncés prêts avant la libération");

  const lues = archives(r.dir).map((f) => readFileSync(join(r.dir, f), "utf-8"));
  /*
   * Compter les succès ne compte pas les mutations : une reprise idempotente réussit
   * aussi, légitimement. Ce qui se compte est l'effet — une archive, une histoire — et ce
   * que le second appel a le droit d'être : idempotent, ou refusé proprement.
   */
  const acceptables = sorties.every((s) => aAbouti(s) || aRefuse(s));
  propriete(
    archives(r.dir).length === 1 &&
      new Set(lues).size === 1 &&
      !actif(r.dir) &&
      acceptables &&
      sorties.some((s) => aAbouti(s)) &&
      !sorties.some((s) => traceBrute(s)),
    `une seule archive, une seule histoire, aucune trace brute, le second appel idempotent ou ` +
      `refusé ; archives ${JSON.stringify(archives(r.dir))}, histoires ${new Set(lues).size}, actif ` +
      `${actif(r.dir)}, codes ${JSON.stringify(sorties.map((s) => s.status))}`,
  );
});

regression("A-P1-F01-succession", "le successeur ne devient courant qu'après l'archive de R", async () => {
  const r = runEcrit("l0-b1-succ-d-", [{ unite: "W03", integree: true }]);
  const avant = lireJson(join(r.dir, "active-run.json"))!;
  const archiveR = join(r.dir, `${RUN}-run.json`);
  const release = join(r.dir, "release");
  const pretFin = join(r.dir, "ready-fin");
  const pretOuvre = join(r.dir, "ready-ouvre");

  const course = [
    enfant(corpsEnfant(pretFin, release, actionRecover(r.root, ["run", "completed"]))),
    enfant(corpsEnfant(pretOuvre, release, actionOuvrir(r.dir, archiveR))),
  ];
  const armes = await attendre(() => existsSync(pretFin) && existsSync(pretOuvre));
  writeFileSync(release, "");
  const [fin, ouverture] = await Promise.all(course);
  precondition(
    armes,
    `les deux enfants doivent s'être annoncés prêts avant la libération ; fin ${fin.status} ` +
      `${fin.sortie.trim().slice(0, 150)} · ouverture ${ouverture.status} ` +
      `${ouverture.sortie.trim().slice(0, 150)}`,
  );

  type Observation = {
    runId?: string; resumed?: boolean; archiveRVisible?: boolean;
    ancienRunLibere?: boolean; activeRunId?: string; err?: string;
  };
  const lire = (s: string): Observation => {
    const m = s.match(/\{"runId".*?\}|\{"err".*?\}/);
    return m ? (JSON.parse(m[0]) as Observation) : {};
  };
  // L'empreinte de l'archive, prise juste après la fin : la création de R2 ne doit pas
  // la remuer.
  const marque = existsSync(archiveR) ? empreinte(archiveR) : undefined;

  /*
   * Deux issues sont admises pendant la transition : le successeur naît après la
   * libération, ou l'ouverture reprend R — ou refuse — et un appel explicite le crée
   * ensuite. Zéro identité nouvelle, en revanche, n'en est pas une.
   */
  let nouveau = lire(ouverture.sortie);
  if (nouveau.runId === undefined || nouveau.runId === RUN) {
    nouveau = lire((await enfant(actionOuvrir(r.dir, archiveR))).sortie);
  }

  const courant = lireJson(join(r.dir, "active-run.json"));
  const manques = terminalComplet(lireJson(archiveR), "completed", avant);
  const archiveStable = marque !== undefined && existsSync(archiveR) && empreinte(archiveR) === marque;
  propriete(
    nouveau.runId !== undefined &&
      nouveau.runId !== RUN &&
      nouveau.activeRunId === nouveau.runId &&
      nouveau.archiveRVisible === true &&
      nouveau.ancienRunLibere === true &&
      courant?.runId === nouveau.runId &&
      archiveStable &&
      manques.length === 0 &&
      aAbouti(fin),
    `le successeur ne naît qu'une fois R archivé et libéré, et l'archive de R ne bouge ` +
      `plus ensuite ; observation ${JSON.stringify(nouveau)}, courant ` +
      `${JSON.stringify(courant?.runId)}, archive stable ${archiveStable}, manques ` +
      `${JSON.stringify(manques)}, fin ${fin.status}`,
  );
});

regression("C4.6", "un run terminé n'accepte plus aucune mutation de registre", () => {
  const r = runEcrit("l0-b1-fige-", [{ unite: "W03", integree: true }, { unite: "W09", ouverte: true }]);
  const fin = issue(() => recover(r.root, "run", "abandoned", "--reason", "gel"));
  precondition(fin.kind === "returned", "la fin doit rendre une sortie");
  const terminee = aAbouti(sortieDe(fin)) && archives(r.dir).length === 1 && !actif(r.dir);
  const archive = terminee ? join(r.dir, archives(r.dir)[0]) : undefined;
  const marqueArchive = archive ? empreinte(archive) : "—";
  const registreAvant = readFileSync(cheminLanes(r.dir), "utf-8");
  const seqAvant = (lireJson(archive ?? join(r.dir, "active-run.json")) ?? {}).nextSeq;

  const apresCoup = issue(() => recover(r.root, "W09", "abandoned"));
  precondition(apresCoup.kind === "returned", "la tentative de mutation doit rendre une sortie");
  const seqApres = (lireJson(archive ?? join(r.dir, "active-run.json")) ?? {}).nextSeq;
  const intact =
    readFileSync(cheminLanes(r.dir), "utf-8") === registreAvant &&
    (archive ? empreinte(archive) === marqueArchive : false) &&
    seqApres === seqAvant;

  propriete(
    terminee && aRefuse(sortieDe(apresCoup)) && intact,
    `terminé ${terminee} · mutation refusée ${aRefuse(sortieDe(apresCoup))} · archive, registre ` +
      `et séquence intacts ${intact}`,
  );
});

// ================================================================== ce qui doit survivre

preservation("C1.10", "un vestige de transition ancien ne lève ni verrou ni registre", () => {
  const r = runEcrit("l0-b1-vestige-", [{ unite: "W03", integree: true }, { unite: "W09", ouverte: true }], { ledger: 1 });
  const verrou = join(r.dir, `${RUN}.guard`);
  mkdirSync(verrou, { recursive: true });
  const vieux = (Date.now() - GUARD_STALE_MS * 4) / 1000;
  utimesSync(verrou, vieux, vieux);
  precondition(
    Date.now() - statSync(verrou).mtimeMs > GUARD_STALE_MS,
    `le vestige doit dépasser GUARD_STALE_MS, âge ${Date.now() - statSync(verrou).mtimeMs} ms`,
  );
  const registreAvant = readFileSync(cheminLanes(r.dir), "utf-8");
  const lanesAvant = openLanes(r.root).sort();

  const i = issue(() => recover(r.root, "cleanup", "--apply"));
  precondition(i.kind === "returned", "le dispatcher doit rendre une sortie");
  propriete(
    existsSync(verrou) &&
      readFileSync(cheminLanes(r.dir), "utf-8") === registreAvant &&
      openLanes(r.root).sort().join() === lanesAvant.join(),
    `le vestige, le registre et les lanes survivent au refus ; verrou ${existsSync(verrou)}, ` +
      `registre inchangé ${readFileSync(cheminLanes(r.dir), "utf-8") === registreAvant}, lanes ` +
      `${JSON.stringify(openLanes(r.root))}`,
  );
});

preservation("C1.8-observation", "observer un run sain ne le termine pas", () => {
  const r = runEcrit("l0-b1-observe-", [{ unite: "W03", integree: true }], { ledger: 1 });
  const avant = readFileSync(join(r.dir, "active-run.json"), "utf-8");
  const i = issue(() => recover(r.root));
  precondition(i.kind === "returned", "le dispatcher doit rendre une sortie");
  propriete(
    readFileSync(join(r.dir, "active-run.json"), "utf-8") === avant &&
      actif(r.dir) &&
      archives(r.dir).length === 0,
    `une observation ne mute rien : manifeste inchangé ` +
      `${readFileSync(join(r.dir, "active-run.json"), "utf-8") === avant}, actif ${actif(r.dir)}, ` +
      `archives ${JSON.stringify(archives(r.dir))}`,
  );
});

preservation("C1.8-trace", "un verbe inconnu refuse proprement, sans trace brute", () => {
  // Manifeste v1 : la surface doit lire le run pour en arriver au verbe, et le lecteur
  // d'aujourd'hui refuse un manifeste v2. Cette préservation porte sur le verbe, pas sur
  // la version du manifeste.
  const r = runEcrit("l0-b1-inconnu-", [{ unite: "W03", integree: true }], { ledger: 1, manifesteV1: true });
  const i = issue(() => recover(r.root, "run", "ceci-n-existe-pas"));
  precondition(i.kind === "returned", "le dispatcher doit rendre une sortie");
  propriete(
    aRefuse(sortieDe(i)) && !traceBrute(sortieDe(i)),
    `un verbe inconnu se refuse, il ne plante pas ; code ${sortieDe(i).status}, trace brute ` +
      `${traceBrute(sortieDe(i))}`,
  );
});
