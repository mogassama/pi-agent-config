/**
 * l0-pi-adapt.test.ts — LOT-PI-ADAPT, item 2 : la couche d'adaptation ne change rien sur pi 0.86.0
 * (PLAN § 4, MATRICES § C ; adjudications 7c83adc0 et 050281a6).
 *
 *   N1   les vingt SpawnPlan complets et describePlan — PI-ADAPT-N1
 *   N2   dispatch() rejoué par fake-pi.mjs sur les quatre transcriptions synthétiques — PI-ADAPT-N2
 *   N3   la table de vérité du prédicat de provenance, huit formes des sept cas — PI-ADAPT-N3
 *
 * Les références sont celles de la base b5453204 / afaf99af, constituées avant toute modification de
 * production par tests/fixtures/pi-adapt/generer-references.ts (a9cea47f). Leur empreinte et leurs
 * liaisons sont contrôlées avant toute comparaison ; elles ne sont jamais régénérées ici.
 *
 * spawn-args.ts et dispatch.ts importent leurs voisins en `.js` : ce fichier, qui tourne sans
 * chargeur, calcule donc dans un processus enfant lancé sous tests/stubs/loader.mjs. dispatch.ts y
 * est importé par son chemin `.ts` : le dispatch réel, jamais celui du harnais.
 *
 * Les cinq transcriptions QD-EFF se comparent hors dépôt (verifier-neutralite-qdeff.sh).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

type Preuve = (t: TestContext) => Promise<void> | void;
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

const RACINE = join(import.meta.dirname, "..");
const REFERENCES = "tests/fixtures/pi-adapt/references-b5453204.json";
const SHA_REFERENCES = "6b9df7357eb179d7d7fe530eeedf308b1e6d600b3dcf26b46f50de705b8e15fc";
const BASE = { commit: "b54532045e1305bd48ee93ea8fdebdcca534b847", arbre: "afaf99afeceff29f848e853249148095b4169ea7" };
const GENERATEUR = "tests/fixtures/pi-adapt/generer-references.ts";
const SHA_GENERATEUR = "a9cea47f68c4445244140c3da6f0bebad12f79e187945c9396596846f530e4fe";
/** Fixture déclarée des références (son SHA-256 y est inscrit) : le paquet du fournisseur du scout. */
const FIXTURE_FOURNISSEUR = {
  chemin: "npm/node_modules/pi-deepseek-provider/index.ts",
  contenu: "// Fixture N1/N2 : paquet du fournisseur deepseek, résolu par spawn-args.\nexport default function () {}\n",
};
/** Les entrées des références qui sont des stimuli, et non du code de production : inchangées. */
const STIMULI = /^(tests\/stubs\/fake-pi\.mjs|subagent-only\/agents\/[a-z-]+\.md|tests\/fixtures\/pi-adapt\/transcriptions\/[a-z-]+\.jsonl)$/;

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const jetables: string[] = [];
test.after(() => {
  for (const d of jetables) rmSync(d, { recursive: true, force: true });
});

/** Forme canonique : clés triées, pour comparer des objets sans dépendre de leur ordre d'écriture. */
function canonique(v: unknown): string {
  const trier = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(trier)
      : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, trier((x as Record<string, unknown>)[k])]))
        : x;
  return JSON.stringify(trier(v));
}

/** Les références, après contrôle de leur empreinte et de leurs liaisons. Tout écart refuse. */
function references(): Record<string, any> {
  const chemin = join(RACINE, REFERENCES);
  precondition(existsSync(chemin), `références absentes : ${REFERENCES}`);
  const brut = readFileSync(chemin);
  precondition(sha(brut) === SHA_REFERENCES, `empreinte des références ${sha(brut)} ≠ ${SHA_REFERENCES}`);
  const ref = JSON.parse(brut.toString("utf8"));
  precondition(ref.base?.commit === BASE.commit && ref.base?.arbre === BASE.arbre, "références non liées à b5453204 / afaf99af");
  precondition(ref.generateur?.chemin === GENERATEUR && ref.generateur?.sha256 === SHA_GENERATEUR, "références non liées au générateur a9cea47f");
  precondition(sha(readFileSync(join(RACINE, GENERATEUR))) === SHA_GENERATEUR, "générateur du dépôt différent de a9cea47f");
  precondition(ref.fixtures?.[FIXTURE_FOURNISSEUR.chemin] === sha(FIXTURE_FOURNISSEUR.contenu), "fixture du fournisseur différente de celle des références");
  const stimuli = Object.entries(ref.entrees as Record<string, string>).filter(([f]) => STIMULI.test(f));
  precondition(stimuli.length === 10, `dix stimuli attendus dans les entrées des références, ${stimuli.length} trouvés`);
  for (const [f, empreinte] of stimuli) {
    precondition(existsSync(join(RACINE, f)) && sha(readFileSync(join(RACINE, f))) === empreinte, `stimulus ${f} différent de celui des références`);
  }
  for (const s of ref.n2.scenarios as Array<{ transcription: string; sha256: string }>) {
    precondition(sha(readFileSync(join(RACINE, "tests/fixtures/pi-adapt", s.transcription))) === s.sha256, `transcription ${s.transcription} différente`);
  }
  return ref;
}

/**
 * Le calcul sur le dépôt courant, dans un processus enfant sous le chargeur des harnais.
 *
 * Racines : agentDir reçoit les fichiers suivis (`git ls-files --cached`) ou, dans une copie sans
 * .git (celles de l'outil des mutants, qui ne contiennent que les fichiers suivis et L0), tous les
 * fichiers de la copie ; puis la fixture du fournisseur. cwd est le dépôt git minimal des références.
 * Normalisations, symétriques : <AGENTDIR> et <CWD>, rien d'autre.
 */
const SCRIPT_ENFANT = String.raw`
const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs");
const path = await import("node:path");
const os = await import("node:os");
const url = await import("node:url");
const R = process.cwd();
const ref = JSON.parse(fs.readFileSync(path.join(R, process.env.PI_ADAPT_REFERENCES), "utf8"));
const fixture = JSON.parse(process.env.PI_ADAPT_FIXTURE);
const partie = process.env.PI_ADAPT_PARTIE;
const imp = (rel) => import(url.pathToFileURL(path.join(R, rel)).href);

function copier(src, dst) {
  let st;
  try { st = fs.lstatSync(src); } catch { return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
  else if (st.isFile()) { fs.copyFileSync(src, dst); fs.chmodSync(dst, st.mode & 0o7777); }
}
function tous(dir, rel = "") {
  const out = [];
  for (const n of fs.readdirSync(path.join(dir, rel))) {
    const r = rel ? rel + "/" + n : n;
    const st = fs.lstatSync(path.join(dir, r));
    if (st.isDirectory()) out.push(...tous(dir, r));
    else out.push(r);
  }
  return out;
}
function racines() {
  const t = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
  const agentDir = t("pi-adapt-agent-"), cwd = t("pi-adapt-cwd-"), artefacts = t("pi-adapt-artefacts-");
  const fichiers = fs.existsSync(path.join(R, ".git"))
    ? execFileSync("git", ["ls-files", "--cached", "-z"], { cwd: R, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean)
    : tous(R);
  for (const f of fichiers) copier(path.join(R, f), path.join(agentDir, f));
  fs.mkdirSync(path.join(agentDir, path.dirname(fixture.chemin)), { recursive: true });
  fs.writeFileSync(path.join(agentDir, fixture.chemin), fixture.contenu);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, GIT_AUTHOR_NAME: "n", GIT_AUTHOR_EMAIL: "n@n", GIT_COMMITTER_NAME: "n", GIT_COMMITTER_EMAIL: "n@n", GIT_AUTHOR_DATE: "2026-10-08T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-08T00:00:00Z" };
  execFileSync("git", ["init", "-q"], { cwd, env });
  fs.writeFileSync(path.join(cwd, "LISEZ-MOI.md"), "dépôt de référence\n");
  execFileSync("git", ["add", "LISEZ-MOI.md"], { cwd, env });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "base"], { cwd, env });
  return { agentDir, cwd, artefacts };
}
function normaliseur(r) {
  const n = (s) => s.split(r.agentDir).join("<AGENTDIR>").split(r.cwd).join("<CWD>");
  const profond = (v) => typeof v === "string" ? n(v) : Array.isArray(v) ? v.map(profond) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, profond(x)])) : v;
  return profond;
}

const r = racines();
const resultat = {};
try {
  if (partie === "n1") {
    const { loadAgents } = await imp("subagent-only/agents.ts");
    const { buildSpawnPlan, describePlan } = await imp("subagent-only/spawn-args.ts");
    const agents = loadAgents(path.join(R, "subagent-only", "agents"));
    const norm = normaliseur(r);
    resultat.plans = ref.n1.plans.map((p) => {
      const agent = agents.get(p.agent);
      const c = ref.n1.contextes.find((x) => x.id === p.contexte);
      if (!agent || !c) throw new Error("N1 : agent ou contexte introuvable : " + p.agent + " / " + p.contexte);
      const plan = buildSpawnPlan(agent, ref.n1.tache, { agentDir: r.agentDir, selfDir: path.join(r.agentDir, "subagent-only"), runId: "n1ref", cwd: r.cwd, ...c.ctx });
      return norm({ agent: p.agent, contexte: p.contexte, args: plan.args, env: plan.env, injectedChars: plan.injectedChars, estimatedInputTokens: plan.estimatedInputTokens, withoutDelta: plan.withoutDelta, describePlan: describePlan({ ...plan, args: norm(plan.args) }) });
    });
  } else if (partie === "n2") {
    const { loadAgents } = await imp("subagent-only/agents.ts");
    const { dispatch } = await imp("subagent-only/dispatch.ts");
    const { commandeDeTestDetail } = await imp("subagent-only/test-command.ts");
    const agents = loadAgents(path.join(R, "subagent-only", "agents"));
    const fauxPi = path.join(R, "tests", "stubs", "fake-pi.mjs");
    let seq = 0;
    resultat.scenarios = [];
    for (const s of ref.n2.scenarios) {
      const transcription = path.join(R, "tests", "fixtures", "pi-adapt", s.transcription);
      const agent = agents.get(s.role);
      if (!agent) throw new Error("N2 : rôle sans définition : " + s.role);
      process.env.PI_FAKE_REPLAY = transcription;
      process.env.PI_FAKE_EXIT = String(s.code);
      let res;
      try {
        res = await dispatch(agent, ref.n2.tache, { ctx: { agentDir: r.agentDir, selfDir: path.join(r.agentDir, "subagent-only"), runId: "n2ref", cwd: r.cwd }, seq: ++seq, artifactDir: r.artefacts, piPath: fauxPi });
      } finally {
        delete process.env.PI_FAKE_REPLAY;
        delete process.env.PI_FAKE_EXIT;
      }
      const artefact = JSON.parse(fs.readFileSync(res.artifact, "utf8"));
      const lu = fs.readFileSync(res.artifact.replace(/\.json$/, ".jsonl"), "utf8").split("\n");
      const source = fs.readFileSync(transcription, "utf8").split("\n").filter((l) => l.trim());
      const relu = lu.filter((l) => l.trim());
      const relectureComplete = relu.length === source.length && relu.every((l, i) => l === source[i]);
      resultat.scenarios.push({
        id: s.id, lignes: source.length, relectureComplete,
        projection: {
          turns: res.turns, usage: res.usage, submit: artefact.envelope,
          providerError: artefact.providerError ?? null, failure: res.failure ?? null,
          degradedLastText: artefact.degraded?.lastText ?? null,
          commandeDeTestDetail: commandeDeTestDetail(lu),
        },
      });
    }
  } else if (partie === "n3") {
    const texte = fs.readFileSync(path.join(R, ref.n3.source), "utf8").split("\n");
    const ic = texte.findIndex((l) => l.startsWith("const OUTILS_LECTURE = "));
    const ids = texte.map((l, i) => l.startsWith("function outilLectureVerifie(") ? i : -1).filter((i) => i >= 0);
    if (ic < 0 || ids.length !== 1) throw new Error("N3 : prédicat introuvable ou multiple dans " + ref.n3.source);
    const fin = texte.findIndex((l, i) => i > ids[0] && l === "}");
    const constante = texte[ic];
    const fonction = texte.slice(ids[0], fin + 1).join("\n");
    const couche = ["OUTILS_LECTURE_NATIFS", "provenanceNativeLecture", "SOURCE_NATIVE", "cheminNatif"].filter((n) => new RegExp("\\b" + n + "\\b").test(constante + "\n" + fonction));
    const entete = couche.length ? "import { " + couche.join(", ") + " } from " + JSON.stringify(url.pathToFileURL(path.join(R, "subagent-only", "pi-adapt.ts")).href) + ";\n" : "";
    const module = path.join(r.artefacts, "predicat-candidat.ts");
    fs.writeFileSync(module, entete + "type OutilConnu = any;\nlet PI_API: any;\nexport function poser(api: any): void { PI_API = api; }\n" + constante + "\nexport " + fonction + "\n");
    const m = await import(url.pathToFileURL(module).href);
    resultat.lignes = (ic + 1) + " ; " + (ids[0] + 1) + "-" + (fin + 1);
    resultat.couche = couche;
    resultat.cas = ref.n3.cas.map((c) => {
      m.poser(c.api === "sans-getAllTools" ? {} : c.api === "levant" ? { getAllTools: () => { throw new Error("getAllTools levant"); } } : { getAllTools: () => c.outils });
      return { id: c.id, obtenu: m.outilLectureVerifie(c.nom) };
    });
  } else throw new Error("partie inconnue : " + partie);
} finally {
  for (const d of [r.agentDir, r.cwd, r.artefacts]) fs.rmSync(d, { recursive: true, force: true });
}
fs.writeFileSync(process.env.PI_ADAPT_SORTIE, JSON.stringify(resultat));
`;

function calculer(partie: "n1" | "n2" | "n3", tmpdirEnfant?: string): Record<string, any> {
  const dossier = mkdtempSync(join(tmpdir(), "pi-adapt-test-"));
  jetables.push(dossier);
  const sortie = join(dossier, `${partie}.json`);
  const majeur = Number(process.versions.node.split(".")[0]);
  const p = spawnSync(process.execPath, [
    ...(majeur < 23 ? ["--experimental-strip-types"] : []),
    "--no-warnings", "--import", "./tests/stubs/loader.mjs", "--input-type=module", "-e", SCRIPT_ENFANT,
  ], {
    cwd: RACINE,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      ...(tmpdirEnfant ? { TMPDIR: tmpdirEnfant } : {}),
      PI_ADAPT_PARTIE: partie,
      PI_ADAPT_SORTIE: sortie,
      PI_ADAPT_REFERENCES: REFERENCES,
      PI_ADAPT_FIXTURE: JSON.stringify(FIXTURE_FOURNISSEUR),
    },
  });
  precondition(p.status === 0 && existsSync(sortie), `calcul ${partie} impossible (rc ${p.status}) : ${(p.stderr ?? "").slice(-3000)}`);
  return JSON.parse(readFileSync(sortie, "utf8"));
}

preservation("PI-ADAPT-N1", "les vingt SpawnPlan et describePlan du candidat sont ceux de la base", () => {
  const ref = references();
  precondition(ref.n1.plans.length === 20, `vingt plans de référence attendus, ${ref.n1.plans.length}`);
  const ecarts = ecartsN1(ref, calculer("n1").plans);
  propriete(ecarts.length === 0, `N1 : ${ecarts.length} écart(s) sur 20 plans × 8 champs\n${ecarts.slice(0, 10).join("\n")}`);
});

/** Les écarts de N1 : chacun des huit champs des vingt plans, comparé sous forme canonique. */
function ecartsN1(ref: Record<string, any>, plans: Array<Record<string, unknown>>): string[] {
  precondition(Array.isArray(plans) && plans.length === 20, "vingt plans calculés attendus");
  const ecarts: string[] = [];
  ref.n1.plans.forEach((attendu: Record<string, unknown>, i: number) => {
    for (const champ of ["agent", "contexte", "args", "env", "injectedChars", "estimatedInputTokens", "withoutDelta", "describePlan"]) {
      if (canonique(attendu[champ]) !== canonique(plans[i][champ])) {
        ecarts.push(`${attendu.agent}/${attendu.contexte} ${champ} : ${canonique(attendu[champ]).slice(0, 200)} → ${canonique(plans[i][champ]).slice(0, 200)}`);
      }
    }
  });
  return ecarts;
}

/*
 * D-P3-N1 (phase 3, D1). `describePlan` élide tout argument de plus de 80 caractères en
 * « <N chars> ». Les chemins sous agentDir et cwd portent la racine temporaire : plus TMPDIR est
 * long, plus tôt un chemin franchit 80, et la forme élidée ne se normalise plus. Le harnais
 * décrit donc le plan normalisé (racines remplacées par <AGENTDIR> et <CWD>, symétriquement),
 * au lieu de normaliser la description du plan réel. Les huit champs restent comparés ; les
 * références, le générateur et le code de production sont inchangés.
 */
regressionCorrigee("P3-N1", "N1 ne dépend pas de la longueur de TMPDIR : vert sous le TMPDIR courant et sous un TMPDIR long", () => {
  const ref = references();
  precondition(ref.n1.plans.length === 20, `vingt plans de référence attendus, ${ref.n1.plans.length}`);
  // Le TMPDIR courant lui-même, puis un répertoire de plus de 48 caractères sous lui. Les trois
  // longueurs du diagnostic (≤ 5, 12, ≥ 40) ne sont pas toutes constructibles partout (sur le Mac,
  // /tmp vaut /private/tmp, 12 caractères) : le diagnostic les a relevées dans le bac (plan, § 5.4).
  const courant = realpathSync(tmpdir());
  const base = realpathSync(mkdtempSync(join(tmpdir(), "p3n1-")));
  jetables.push(base);
  const long = join(base, "x".repeat(48));
  mkdirSync(long);
  for (const t of [courant, long]) {
    const ecarts = ecartsN1(ref, calculer("n1", t).plans);
    propriete(ecarts.length === 0, `N1 sous TMPDIR de ${t.length} caractères : ${ecarts.length} écart(s)\n${ecarts.slice(0, 5).join("\n")}`);
  }
});

preservation("PI-ADAPT-N2", "dispatch rejoue les quatre transcriptions synthétiques avec les projections de la base", () => {
  const ref = references();
  precondition(ref.n2.scenarios.length === 4, `quatre scénarios de référence attendus, ${ref.n2.scenarios.length}`);
  const champs: string[] = ref.n2.champs;
  precondition(canonique(champs) === canonique(["turns", "usage", "submit", "providerError", "failure", "degradedLastText", "commandeDeTestDetail"]), "champs N2 des références inattendus");
  const { scenarios } = calculer("n2");
  precondition(Array.isArray(scenarios) && scenarios.length === 4, "quatre projections calculées attendues");
  const ecarts: string[] = [];
  ref.n2.scenarios.forEach((s: Record<string, any>, i: number) => {
    const c = scenarios[i];
    precondition(c.id === s.id && c.lignes === s.lignes, `scénario ${s.id} : identité ou nombre de lignes différents`);
    if (!c.relectureComplete) ecarts.push(`${s.id} : relecture incomplète de la transcription`);
    for (const champ of champs) {
      if (canonique(s.projection[champ]) !== canonique(c.projection[champ])) {
        ecarts.push(`${s.id} ${champ} : ${canonique(s.projection[champ]).slice(0, 200)} → ${canonique(c.projection[champ]).slice(0, 200)}`);
      }
    }
  });
  propriete(ecarts.length === 0, `N2 : ${ecarts.length} écart(s) sur 4 scénarios × ${champs.length} champs\n${ecarts.join("\n")}`);
});

preservation("PI-ADAPT-N3", "le prédicat de provenance du candidat rend la table de vérité de la base, getAllTools absent et levant compris", () => {
  const ref = references();
  const ids = ref.n3.cas.map((c: { id: string }) => c.id);
  precondition(canonique(ids) === canonique(["1", "2", "3", "4", "5", "6a", "6b", "7"]), `huit formes de cas attendues, ${ids.join(" ")}`);
  precondition(ref.n3.cas.filter((c: { attendu: boolean }) => c.attendu).map((c: { id: string }) => c.id).join() === "1", "références N3 : vrai au seul cas 1");
  const { cas } = calculer("n3");
  precondition(Array.isArray(cas) && cas.length === 8, "huit résultats calculés attendus");
  const ecarts = ref.n3.cas
    .map((c: { id: string; description: string; attendu: boolean }, i: number) => ({ c, obtenu: cas[i].obtenu, id: cas[i].id }))
    .filter((x: { c: { id: string; attendu: boolean }; obtenu: unknown; id: string }) => x.id !== x.c.id || x.obtenu !== x.c.attendu)
    .map((x: { c: { id: string; description: string; attendu: boolean }; obtenu: unknown }) => `cas ${x.c.id} (${x.c.description}) : attendu ${x.c.attendu}, obtenu ${x.obtenu}`);
  propriete(ecarts.length === 0, `N3 : ${ecarts.length} écart(s) sur 8\n${ecarts.join("\n")}`);
});
