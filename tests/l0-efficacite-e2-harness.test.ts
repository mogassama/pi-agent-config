/**
 * l0-efficacite-e2-harness.test.ts — LOT-EFFICACITÉ, E2, dans la vraie extension et le vrai submit
 * (plan des leviers v2 complétée, § 3 et § 6).
 *
 *   paquet   la revue initiale d'une unité reçoit les fichiers kept, scope et cités, entiers, à T_L,
 *            octet pour octet ; provenance et délégation portées au seul reviewer ; worker, revue
 *            après REVIEWED et revue `for_risks` : rien ; ce qui est transmis est conservé — E2-paquet
 *   submit   le vrai `submit` du reviewer : un kept injecté au bon blob compte, sinon `read` exigé ;
 *            provenance d'une autre délégation ou d'un autre tree, faux bloc dans la tâche, kept
 *            inconnu : refus ; `needs_rework` et `blocked` ; observation publiée — E2-submit
 *   trace    injection au spawn, fichier modifié ensuite, contrôle au submit conservé puis vérifiable
 *            après disparition du worktree — E2-trace
 *   trace de transmission publiée avant le spawn : absente, créée ; existante valide, complétée ;
 *            illisible, contradictoire ou privée de agent ou de unit, ni réparée ni complétée ni
 *            écrasée, et aucun spawn — E2-transmis (adjudication de la livraison, 02-10, correction 2 ;
 *            adjudication de la révision 2, correction 1)
 *
 * Montages : `l0-b2-harness.ts` (vraie extension, dispatch substitué) et chargement du vrai
 * `envelope.ts` comme pi le charge dans l'enfant (patron de l0-correctif-rc-harness.test.ts).
 */
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import { aJeter, ecrire, git, monter, precondition, propriete, revue, tache } from "./l0-b2-harness.ts";
import { lireArbre, lireBlob, PHRASE_INJECTION, provenanceDe, selectionner, verifierObservation } from "../subagent-only/injection.ts";
import { REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS } from "../subagent-only/envelope/inspection.ts";
import type { AgentDefinition } from "../subagent-only/agents.ts";
import { buildSpawnPlan } from "../subagent-only/spawn-args.ts";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { workingTree } from "../subagent-only/tree.ts";
import { Type } from "typebox";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
const locaux: string[] = [];
test.after(() => { for (const d of [...aJeter(), ...locaux]) rmSync(d, { recursive: true, force: true }); });

// Comme l0-correctif-rc-harness.test.ts : `envelope.ts` construit son schéma avec `Type.Null`.
(Type as unknown as Record<string, unknown>).Null ??= (options?: Record<string, unknown>) => ({ kind: "null", ...options });

type Resultat = { content: Array<{ text?: string }>; details: Record<string, unknown>; terminate?: boolean; isError?: boolean };
type Outil = { execute: (id: string, p: Record<string, unknown>) => Promise<Resultat> };
type Gestionnaire = (e: unknown) => Promise<unknown>;

// ------------------------------------------------------------------ le vrai runtime

regressionCorrigee("E2-paquet", "la revue initiale reçoit kept, scope et cités entiers à T_L, au seul reviewer, et ce qui est transmis est conservé", async () => {
  const plan = {
    version: 1,
    work_units: [{ id: "W03", goal: "extraire", depends_on: [], expected_write_scope: ["src/pkg/io.py", "src/a.py"] }],
  };
  const h = await monter({ plan });
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  mkdirSync(join(h.root, "src", "pkg"), { recursive: true });
  mkdirSync(join(h.root, "conf"), { recursive: true });
  writeFileSync(join(h.root, "src", "pkg", "__init__.py"), "");
  writeFileSync(join(h.root, "src", "pkg", "io.py"), "def lire():\n    return 1\n");
  writeFileSync(join(h.root, "src", "pkg", "run.py"), "from .io import lire\n");
  writeFileSync(join(h.root, "conf", "c.yaml"), "cle: 1\n");
  git(h.root, "add", "-A");
  git(h.root, "commit", "-qm", "paquet");

  PILOTE.pendant = ecrire("src/pkg/io.py", "def lire():\n    return 2\n");
  await h.outil.execute("e2-1", tache("W03"));
  PILOTE.pendant = undefined;
  // Une revue qui demande une reprise : l'unité n'est pas intégrée, une seconde revue suivra.
  const r = await h.outil.execute("e2-2", { ...revue("W03", { verdict: "needs_rework" }), task: "juger ; voir conf/c.yaml" });
  PILOTE.resultat = undefined;
  const w = APPELS.find((a) => a.agent === "worker");
  const rv = APPELS.find((a) => a.agent === "reviewer");
  precondition(rv !== undefined, `le reviewer doit partir (${JSON.stringify(r).slice(0, 300)})`);
  propriete(w?.injection == null && w?.delegation == null && !w!.task.includes(PHRASE_INJECTION), "le worker ne reçoit rien");
  const prov = rv!.injection;
  propriete(!!prov && JSON.stringify(prov.files.map((f) => f.path)) === JSON.stringify(["src/pkg/run.py", "src/a.py", "src/pkg/io.py", "conf/c.yaml"]),
    `kept, puis scope, puis cité (${JSON.stringify(prov?.files)})`);
  propriete(rv!.task.includes(PHRASE_INJECTION), "le texte adjugé précède les fichiers");
  // Octet pour octet : le contenu injecté est `git show T_L:<path>`, et le blob est celui de T_L.
  for (const f of prov!.files) {
    const montre = execFileSync("git", ["show", `${prov!.tree}:${f.path}`], { cwd: h.root, encoding: "utf-8" });
    const blob = execFileSync("git", ["rev-parse", `${prov!.tree}:${f.path}`], { cwd: h.root, encoding: "utf-8" }).trim();
    propriete(rv!.task.includes(`<file path="${f.path}" blob="${f.blob}">\n${montre}</file>`) && blob === f.blob,
      `${f.path} entier, au blob de T_L`);
  }
  propriete(JSON.stringify(rv!.delegation) === JSON.stringify({ run: h.runId, planHash: prov!.planHash, unit: "W03", seq: prov!.seq }),
    `délégation courante portée (${JSON.stringify(rv!.delegation)})`);
  // Conservé, par délégation.
  const transmis = JSON.parse(readFileSync(join(h.runDir, `${h.runId}-${String(prov!.seq).padStart(2, "0")}-transmis.json`), "utf-8")) as
    { injection?: { provenance?: unknown; exclus?: unknown[]; octets_injectes?: number; surcout_octets?: number } };
  propriete(JSON.stringify(transmis.injection?.provenance) === JSON.stringify(prov) && typeof transmis.injection?.surcout_octets === "number" &&
    transmis.injection.octets_injectes === prov!.files.reduce((n, f) => n + f.size, 0), `injection conservée (${JSON.stringify(transmis).slice(0, 300)})`);

  // `buildSpawnPlan` porte provenance et délégation au seul reviewer, par l'environnement.
  const ICI = dirname(fileURLToPath(import.meta.url));
  const ctx = { agentDir: process.cwd(), selfDir: join(ICI, "..", "subagent-only"), runId: h.runId, cwd: h.root, injection: prov, delegation: rv!.delegation };
  const role = (nom: string, tools: string[]) => ({
    name: nom, description: "", model: "m", fallbackModels: [], tools, extensions: [], skills: [], mechanism: [], sliceMode: "none",
    keepTranscript: true, prompt: "", body: "", path: "/dev/null", contextFiles: false, projectBrief: false, session: "ephemeral",
    maxTurns: 10, timeoutMs: 60_000,
  }) as unknown as AgentDefinition;
  const pr = buildSpawnPlan(role("reviewer", ["read", "ls", "submit"]), "juger", ctx as never);
  propriete(pr.env.PI_SUBAGENT_INJECTED === JSON.stringify(prov) && pr.env.PI_SUBAGENT_DELEGATION === JSON.stringify(rv!.delegation),
    "le reviewer reçoit provenance et délégation par l'environnement");
  for (const [nom, outils] of [["worker", ["read", "edit", "write", "submit"]], ["scout", ["read", "grep", "submit"]]] as const) {
    const p = buildSpawnPlan(role(nom, [...outils]), "faire", ctx as never);
    propriete(p.env.PI_SUBAGENT_INJECTED === undefined && p.env.PI_SUBAGENT_DELEGATION === undefined, `${nom} : aucune provenance`);
  }

  // Après un REVIEWED de l'unité : plus de revue initiale, aucune injection.
  PILOTE.pendant = ecrire("src/pkg/io.py", "def lire():\n    return 3\n");
  APPELS.length = 0;
  const r3 = await h.outil.execute("e2-3", tache("W03"));
  PILOTE.pendant = undefined;
  const r4 = await h.outil.execute("e2-4", revue("W03"));
  PILOTE.resultat = undefined;
  const suite = APPELS.find((a) => a.agent === "reviewer");
  precondition(suite !== undefined, `la seconde revue doit partir (${JSON.stringify(r3).slice(0, 200)} ; ${JSON.stringify(r4).slice(0, 200)})`);
  propriete(suite!.injection == null && !suite!.task.includes(PHRASE_INJECTION),
    `revue après REVIEWED : aucune injection (${JSON.stringify(suite?.injection)})`);
});

// ------------------------------------------------------------------ le vrai submit

async function enfant(cwd: string, env: Record<string, string | undefined>): Promise<{ outil: Outil; resultat?: Gestionnaire }> {
  const avant = { env: { ...process.env }, cwd: process.cwd() };
  process.env.PI_SUBAGENT_ROLE = "reviewer";
  for (const v of ["PI_SUBAGENT_OPEN_RISKS", "PI_SUBAGENT_KEPT_CONSUMERS", "PI_SUBAGENT_INJECTED", "PI_SUBAGENT_DELEGATION"]) delete process.env[v];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  let outil: Outil | undefined;
  let resultat: Gestionnaire | undefined;
  process.chdir(cwd);
  try {
    const m = await import(`../subagent-only/envelope/envelope.ts?e2=${Math.random()}`);
    m.default({
      registerTool: (t: Outil) => { outil = t; },
      on: (nom: string, h: Gestionnaire) => { if (nom === "tool_result") resultat = h; },
    });
  } finally {
    process.chdir(avant.cwd);
    process.env = avant.env;
  }
  precondition(outil !== undefined, "l'extension doit enregistrer submit");
  return { outil: outil!, resultat };
}
const soumission = (verdict: string) => ({
  status: "ok", summary: "jugé", findings: [], verdict, files_reviewed: ["src/pkg/io.py"], open_risks: [], top_priority: null, tooling: [],
});
const evt = (path: string) => ({ type: "tool_result", toolName: "read", toolCallId: `c-${path}`, input: { path }, isError: false, content: [] });

/** Une lane réelle, deux kept, et la provenance que le parent construit pour la délégation 4 de W01. */
function laneInjectee() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-e2-lane-")));
  locaux.push(root);
  const g = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(join(root, "src", "pkg"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "src", "pkg", "run.py"), "from .io import lire\n");
  writeFileSync(join(root, "tests", "test_config.py"), "import pkg.io as io_mod\n");
  g("add", "-A"); g("commit", "-qm", "base");
  const tree = workingTree(root);
  const arbre = lireArbre(root, tree);
  const sel = selectionner([{ path: "src/pkg/run.py", categorie: "kept" }, { path: "tests/test_config.py", categorie: "kept" }],
    arbre, new Set(arbre.keys()), lireBlob(root));
  const delegation = { run: "run1", planHash: "ph", unit: "W01", seq: 4 };
  const prov = provenanceDe(delegation, tree, sel.injectes);
  const gardes = { unit: "W01", kept: ["src/pkg/run.py", "tests/test_config.py"] };
  const env = (p: unknown = prov, d: unknown = delegation, k: unknown = gardes) => ({
    PI_SUBAGENT_INJECTED: p === null ? undefined : typeof p === "string" ? p : JSON.stringify(p),
    PI_SUBAGENT_DELEGATION: JSON.stringify(d),
    PI_SUBAGENT_KEPT_CONSUMERS: JSON.stringify(k),
  });
  return { root, prov, delegation, gardes, env };
}

regressionCorrigee("E2-submit", "le vrai submit compte un kept injecté au bon blob, exige read sinon, et publie son observation", async () => {
  const L = laneInjectee();
  precondition(L.prov.files.length === 2, "les deux kept doivent être injectés");
  for (const v of ["needs_rework", "blocked"]) {
    const { outil } = await enfant(L.root, L.env());
    const r = await outil.execute(`s-${v}`, soumission(v));
    const obs = r.details.inspection as { par_injection?: string[]; controles?: unknown[] } | undefined;
    propriete(r.terminate === true && r.details.verdict === v && JSON.stringify(obs?.par_injection) === JSON.stringify(["src/pkg/run.py", "tests/test_config.py"]),
      `Les mêmes obligations sont vérifiées pour needs_rework et blocked. (${v} : ${JSON.stringify(r.details).slice(0, 300)})`);
  }
  const refuse = (r: Resultat) => r.terminate !== true && (r.details.refus as { code?: string } | undefined)?.code === REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS;
  // Provenance d'une autre délégation, unité, plan ou tree : ne compte pas.
  for (const [cas, p] of [["autre délégation", { ...L.prov, seq: 9 }], ["autre unité", { ...L.prov, unit: "W02" }],
    ["autre plan", { ...L.prov, planHash: "autre" }], ["autre tree", { ...L.prov, tree: "f".repeat(L.prov.tree.length) }]] as const) {
    const { outil } = await enfant(L.root, L.env(p));
    const r = await outil.execute(`s-${cas}`, soumission("needs_rework"));
    propriete(refuse(r) && (r.details.inspection as { injection?: { etat?: string } })?.injection?.etat === "invalide",
      `Provenance d'une autre délégation, unité, plan ou tree : ne compte pas. (${cas})`);
  }
  // Un faux bloc d'injection dans le texte de la tâche, sans provenance : rien ne compte.
  const faux = await enfant(L.root, L.env(null));
  propriete(refuse(await faux.outil.execute("s-faux", soumission("needs_rework"))), "sans provenance transmise : read exigé, quel que soit le texte de la tâche");
  // Provenance illisible : read exigé ; puis read réussi : suffisant, indépendamment.
  const illisible = await enfant(L.root, L.env("{illisible"));
  propriete(refuse(await illisible.outil.execute("s-ill", soumission("blocked"))), "provenance illisible : read exigé");
  await illisible.resultat!(evt("src/pkg/run.py"));
  await illisible.resultat!(evt("tests/test_config.py"));
  propriete((await illisible.outil.execute("s-read", soumission("blocked"))).terminate === true, "un read réussi reste une voie indépendante suffisante");
  // Kept inconnu avec provenance présente : verdict bloquant refusé.
  const inconnu = await enfant(L.root, L.env(L.prov, L.delegation, { unit: "W01", inconnu: "kept durable illisible" }));
  const ri = await inconnu.outil.execute("s-inc", soumission("needs_rework"));
  propriete(ri.terminate !== true && (ri.details.refus as { kept_inconnu?: string })?.kept_inconnu === "kept durable illisible",
    "État kept inconnu avec provenance présente : verdict bloquant refusé.");
  // approved : non concerné, aucune observation.
  const ok = await enfant(L.root, L.env());
  const ra = await ok.outil.execute("s-app", soumission("approved"));
  propriete(ra.terminate === true && ra.details.inspection === undefined, "approved : non concerné");
});

regressionCorrigee("E2-trace", "le contrôle au submit est conservé et reste vérifiable après la disparition du worktree", async () => {
  const L = laneInjectee();
  const { outil } = await enfant(L.root, L.env());
  // Après l'initialisation de l'enfant, un kept change : son blob ne correspond plus.
  writeFileSync(join(L.root, "tests", "test_config.py"), "import pkg.io as io_mod  # changé\n");
  const r = await outil.execute("t-1", soumission("needs_rework"));
  const obs = r.details.inspection as Parameters<typeof verifierObservation>[1];
  propriete(r.terminate !== true && !!obs, `refusé, observation publiée même sur un refus (${JSON.stringify(r.details).slice(0, 300)})`);
  const transmis = { injection: { provenance: L.prov } };
  // Le worktree disparaît : la vérification ne lit que les pièces conservées.
  rmSync(L.root, { recursive: true, force: true });
  const v = verifierObservation(transmis, JSON.parse(JSON.stringify(obs)));
  const c = (obs?.controles ?? []).find((x) => x.path === "tests/test_config.py");
  propriete(v.ok && c !== undefined && c.ok === false && c.lu !== c.attendu && JSON.stringify((obs as { par_injection?: string[] }).par_injection) === JSON.stringify(["src/pkg/run.py"]),
    `vérifiable après disparition du worktree : contrôle du kept modifié en échec, l'autre retenu (${JSON.stringify(v)} ; ${JSON.stringify(obs)})`);
  // Une observation qui ne correspond pas à la transmission est détectée.
  const falsifiee = { ...JSON.parse(JSON.stringify(obs)), controles: [{ path: "tests/test_config.py", attendu: "0".repeat(40), lu: "0".repeat(40), ok: true }] };
  propriete(!verifierObservation(transmis, falsifiee).ok, "une observation qui contredit la transmission est rejetée");
  propriete(!verifierObservation(transmis, null).ok, "observation absente : non établie, jamais conforme par défaut");
});

regressionCorrigee("E2-transmis", "la trace de transmission se crée, se complète, mais une trace illisible ou contradictoire n'est jamais écrasée et arrête avant le spawn", async () => {
  const h = await monter({ plan: { version: 1, work_units: [{ id: "W03", goal: "faire", depends_on: [], expected_write_scope: ["src/a.py"] }] } });
  precondition(h.chargement.ok, `la session doit se charger (${JSON.stringify(h.chargement)})`);
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("e2t-1", tache("W03"));
  PILOTE.pendant = undefined;
  const trace = (seq: number) => join(h.runDir, `${h.runId}-${String(seq).padStart(2, "0")}-transmis.json`);
  const reviewers = () => APPELS.filter((a) => a.agent === "reviewer").length;
  // Absente : créée avant le spawn, et le reviewer part.
  const r0 = await h.outil.execute("e2t-2", revue("W03", { verdict: "needs_rework" }));
  PILOTE.resultat = undefined;
  const cree = JSON.parse(readFileSync(trace(2), "utf-8")) as { run?: string; seq?: number; agent?: string; unit?: string; injection?: unknown };
  propriete(reviewers() === 1 && cree.run === h.runId && cree.seq === 2 && cree.agent === "reviewer" && cree.unit === "W03" && "injection" in cree,
    `trace absente : créée, reviewer parti (${JSON.stringify(cree).slice(0, 200)} ; ${JSON.stringify(r0).slice(0, 200)})`);
  // Une reprise du worker (séquence 3), pour qu'une nouvelle revue soit admise.
  PILOTE.pendant = ecrire("src/a.py", "a = 3\n");
  await h.outil.execute("e2t-3w", tache("W03"));
  PILOTE.pendant = undefined;
  // Illisible, puis contradictoire : ni réparée ni écrasée, aucun spawn.
  // Puis privée de agent, de unit, ou des deux : inexploitable, jamais complétée (correction 1 de
  // l'adjudication de la révision 2).
  const cas: [number, string][] = [
    [4, "{tronqué"],
    [5, JSON.stringify({ run: h.runId, seq: 5, agent: "reviewer", unit: "W09" })],
    [6, JSON.stringify({ run: h.runId, seq: 6, unit: "W03" })],
    [7, JSON.stringify({ run: h.runId, seq: 7, agent: "reviewer" })],
    [8, JSON.stringify({ run: h.runId, seq: 8 })],
  ];
  for (const [seq, contenu] of cas) {
    writeFileSync(trace(seq), contenu);
    const n = reviewers();
    const r = await h.outil.execute(`e2t-${seq}`, revue("W03", { verdict: "needs_rework" })) as { isError?: boolean; content?: { text?: string }[] };
    PILOTE.resultat = undefined;
    const t = (r.content ?? []).map((c) => c.text ?? "").join("");
    propriete(readFileSync(trace(seq), "utf-8") === contenu, `trace ${seq} : jamais écrasée ni remplacée par un objet vide`);
    propriete(r.isError === true && t.includes("TRANSMIS_INEXPLOITABLE") && reviewers() === n,
      `trace ${seq} : arrêt avant le spawn (${t.slice(0, 200)})`);
  }
  // Existante et valide pour cette délégation : complétée, son contenu gardé, et le reviewer part.
  writeFileSync(trace(9), JSON.stringify({ run: h.runId, seq: 9, agent: "reviewer", unit: "W03", note: "posée avant" }));
  const n = reviewers();
  const r5 = await h.outil.execute("e2t-9", revue("W03", { verdict: "needs_rework" }));
  PILOTE.resultat = undefined;
  const complete = JSON.parse(readFileSync(trace(9), "utf-8")) as Record<string, unknown>;
  propriete(reviewers() === n + 1 && complete.note === "posée avant" && "injection" in complete,
    `trace existante valide : complétée, reviewer parti (${JSON.stringify(complete).slice(0, 200)} ; ${JSON.stringify(r5).slice(0, 200)})`);
});
