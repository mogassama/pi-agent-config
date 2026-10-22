/**
 * l0-profil-gardes.test.ts — phase 2, gardes et `/check-config` au chargement en simple (G).
 *
 * Plan v3.7 § 12.3 et § 5.1, § 5.5. G01 et G03 sont des préservations : les gardes générales et
 * les crochets ne changent pas en phase 2, et ces invariants sont déjà vrais sur la base. G02 et
 * G04 sont des couvertures, rouges sur leurs mutants M-G (tests/l0-mutants.json).
 *
 * Les extensions réelles sont chargées dans un processus enfant. L'extension `subagent` y est
 * chargée sous le chargeur commun (`tests/stubs/loader.mjs`), passé explicitement, comme le font
 * les processus enfants de `l0-b1-lifecycle.test.ts`. Les cinq gardes et `pi-check-config`
 * importent de pi des fonctions que le substitut commun n'expose pas (`getAgentDir`, …) : elles
 * reçoivent un substitut propre à ce fichier, écrit dans un temporaire, comme pour K-P19
 * (`l0-garde-push.test.ts`). `tests/stubs/` n'est pas touché. Le substitut ne décide rien : il
 * rend le répertoire de l'agent d'épreuve et reconnaît un événement par son `toolName`, comme pi.
 *
 * Aucun processus de ces preuves ne porte `PI_SUBAGENT_ROLE` : c'est l'orchestrateur, en simple.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";

type Preuve = (t: TestContext) => Promise<void> | void;
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

const REPO = join(import.meta.dirname, "..");
const HOOKS = join(REPO, "git-hooks");
const GARDES = ["bash-guard", "pi-secret-gate", "pi-lint-gate", "pi-bq-cost-sentinel", "compaction-guard"] as const;

const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });
function tmp(prefixe: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixe)));
  jetables.push(d);
  return d;
}
/** L'environnement d'un processus de l'orchestrateur : ni rôle d'enfant, ni configuration git héritée. */
function sansRole(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const e = { ...env };
  delete e.PI_SUBAGENT_ROLE;
  for (const k of Object.keys(e)) if (k.startsWith("GIT_")) delete e[k];
  return { ...e, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
}

// ------------------------------------------------------------------ le processus enfant

/**
 * Le prélude commun des scénarios : un dépôt d'épreuve, puis l'extension `subagent` chargée sur
 * lui comme pi la charge, `session_start` émis — le profil simple, sans `/subagents on`.
 */
const PRELUDE = String.raw`
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const REPO = process.env.G_REPO;
const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href);
const { SOURCE_NATIVE, cheminNatif } = await imp("subagent-only/pi-adapt.ts");
function depot() {
  const root = realpathSync(mkdtempSync(join(process.env.G_TMP, "depot-")));
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  mkdirSync(join(root, "src")); writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, ".gitignore"), ".pi-subagent-runs/\n");
  git("add", "-A"); git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "base");
  return root;
}
async function subagentSimple(root) {
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  const ev = new Map(); const cmds = new Map(); const notes = [];
  const tous = [...["read", "grep", "find", "ls", "bash", "write", "edit"].map((n) => ({ name: n, sourceInfo: { source: SOURCE_NATIVE, path: cheminNatif(n) } })),
    { name: "task", sourceInfo: { source: "local", path: join(REPO, "extensions", "subagent") } }];
  let actifs = tous.map((t) => t.name);
  const m = await imp("extensions/subagent/index.ts");
  m.default({
    on: (n, cb) => { ev.set(n, cb); }, registerTool: () => {}, registerCommand: (n, c) => { cmds.set(n, c.handler); },
    ui: { setStatus() {}, setFooter() {} },
    getAllTools: () => tous.map((o) => ({ ...o, sourceInfo: { ...o.sourceInfo } })),
    getActiveTools: () => [...actifs],
    setActiveTools: (noms) => { actifs = noms.filter((x) => tous.some((o) => o.name === x)); },
  });
  const ctx = () => ({ hasUI: true, cwd: process.cwd(), isIdle: () => true,
    sessionManager: { getSessionId: () => "session-g", getSessionFile: () => undefined },
    ui: { setStatus() {}, setFooter() {}, notify: (texte, genre) => { notes.push({ texte, genre }); } } });
  await ev.get("session_start")({ type: "session_start", reason: "startup" }, ctx());
  const sub = async (arg) => { const a = notes.length; await cmds.get("subagents")(arg, ctx()); return notes.slice(a); };
  const profil = async () => (await sub("")).map((n) => n.texte).join("\n");
  return { sub, profil };
}
`;

/** Lance un scénario : chargeur commun d'abord, puis le substitut de ce fichier pour les gardes. */
function enfant(scenario: string, env: Record<string, string> = {}): Record<string, unknown> {
  const d = tmp("pi-p2g-");
  writeFileSync(join(d, "pi.mjs"), [
    "export function getAgentDir() { return process.env.G_AGENT_DIR; }",
    "export function isToolCallEventType(kind, e) { return typeof e === 'object' && e !== null && e.toolName === kind; }",
    "export function isEditToolResult(e) { return typeof e === 'object' && e !== null && e.toolName === 'edit'; }",
    "export function isWriteToolResult(e) { return typeof e === 'object' && e !== null && e.toolName === 'write'; }",
    "export async function withFileMutationQueue(_p, fn) { return fn(); }",
  ].join("\n") + "\n");
  writeFileSync(join(d, "crochets.mjs"), [
    `const PI = ${JSON.stringify(pathToFileURL(join(d, "pi.mjs")).href)};`,
    "const GARDE = /\\/extensions\\/(bash-guard|pi-secret-gate|pi-lint-gate|pi-bq-cost-sentinel|pi-check-config)\\//;",
    "export function resolve(spec, ctx, next) {",
    "  const p = ctx.parentURL ?? '';",
    "  if (spec === '@earendil-works/pi-coding-agent' && GARDE.test(p)) return { url: PI, shortCircuit: true };",
    "  if (spec === './patterns' && p.endsWith('/bash-guard/index.ts')) return { url: new URL('./patterns.ts', p).href, shortCircuit: true };",
    "  return next(spec, ctx);",
    "}",
  ].join("\n") + "\n");
  writeFileSync(join(d, "enregistrer.mjs"), `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(join(d, "crochets.mjs")).href)});\n`);
  writeFileSync(join(d, "scenario.mjs"), PRELUDE + scenario);
  const home = join(d, "home");
  mkdirSync(join(home, ".pi"), { recursive: true });
  const [majeur] = process.versions.node.split(".").map(Number);
  const p = spawnSync(process.execPath, [
    ...(majeur < 23 ? ["--experimental-strip-types"] : []), "--no-warnings",
    "--import", pathToFileURL(join(REPO, "tests", "stubs", "loader.mjs")).href,
    "--import", pathToFileURL(join(d, "enregistrer.mjs")).href,
    join(d, "scenario.mjs"),
  ], { cwd: REPO, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024, env: { ...sansRole(process.env), HOME: home, G_REPO: REPO, G_TMP: d, ...env } });
  const ligne = `${p.stdout}`.split("\n").find((l) => l.startsWith("PGG "));
  precondition(p.status === 0 && ligne !== undefined, `le scénario doit rendre son relevé : code ${p.status}, ${`${p.stderr}`.slice(-600)}`);
  return JSON.parse(ligne!.slice(4)) as Record<string, unknown>;
}

// ------------------------------------------------------------------ G01

/** Les sources d'une garde : tous ses fichiers TypeScript, sans le README ni le package.json. */
function sources(garde: string): string[] {
  return readdirSync(join(REPO, "extensions", garde)).filter((f) => f.endsWith(".ts")).sort().map((f) => `extensions/${garde}/${f}`);
}
/** Les trois commentaires nommés au § 5.1, seules lignes des cinq gardes où le mot « subagent » paraît. */
const MENTIONS_NOMMEES = [
  "extensions/bash-guard/index.ts:181",
  "extensions/pi-bq-cost-sentinel/index.ts:8",
  "extensions/pi-secret-gate/rules.ts:4",
];
const commentaire = (l: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(l);

preservation("P2-G01", "aucune des cinq gardes ne lit le rôle d'enfant ni l'espace des runs, ni n'importe un module d'état de run", () => {
  const mentions: string[] = [];
  const fichiers = GARDES.flatMap(sources);
  precondition(GARDES.every((g) => sources(g).includes(`extensions/${g}/index.ts`)), `chaque garde a son index.ts : ${JSON.stringify(fichiers)}`);
  for (const f of fichiers) {
    const texte = readFileSync(join(REPO, f), "utf-8");
    propriete(!texte.includes("PI_SUBAGENT_ROLE"), `${f} ne lit pas PI_SUBAGENT_ROLE`);
    propriete(!texte.includes("pi-subagent-runs"), `${f} ne nomme pas l'espace des runs`);
    const specs = [...texte.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm)]
      .map((m) => m[1] ?? m[2] ?? m[3]);
    for (const s of specs) {
      const admis = s.startsWith("node:") || s === "@earendil-works/pi-coding-agent" || /^\.\/[^/]+$/.test(s);
      propriete(admis, `${f} : import ${s} — seuls node:, l'API de pi et un fichier voisin de la garde sont admis`);
    }
    texte.split("\n").forEach((l, i) => {
      if (/subagent/i.test(l)) mentions.push(`${f}:${i + 1}${commentaire(l) ? "" : " (hors commentaire)"}`);
    });
  }
  propriete(JSON.stringify([...mentions].sort()) === JSON.stringify([...MENTIONS_NOMMEES].sort()),
    `le mot « subagent » ne paraît que dans les trois commentaires nommés : ${JSON.stringify(mentions)}`);
});

// ------------------------------------------------------------------ G02

const SCENARIO_G02 = String.raw`
const root = depot();
const s = await subagentSimple(root);
const profil = await s.profil();
process.env.G_AGENT_DIR = realpathSync(mkdtempSync(join(process.env.G_TMP, "agent-")));
function api() {
  const r = { on: new Map(), commandes: [], execs: [], script: () => ({ code: 1, stdout: "", stderr: "" }) };
  r.pi = { on: (n, cb) => { r.on.set(n, cb); }, registerCommand: (n) => { r.commandes.push(n); },
    exec: async (cmd, args) => { r.execs.push([cmd, ...args]); return r.script(cmd, args); },
    sendUserMessage: () => {}, sendMessage: () => {} };
  return r;
}
async function charger(g) { const a = api(); (await imp("extensions/" + g + "/index.ts")).default(a.pi); return a; }
const appeler = async (a, evt, e, ctx) => { const h = a.on.get(evt); return h ? (await h(e, ctx)) ?? null : "absent"; };
const gardes = {};
{ // bash-guard : un contournement des crochets, refusé sans dialogue.
  const a = await charger("bash-guard"); let dialogues = 0;
  const ctx = { hasUI: true, cwd: root, ui: { select: async () => { dialogues++; return "Confirm"; }, notify() {} } };
  const temoin = await appeler(a, "tool_call", { toolName: "bash", toolCallId: "g1", input: { command: "git commit --no-verify -m x" } }, ctx);
  const contraste = await appeler(a, "tool_call", { toolName: "bash", toolCallId: "g2", input: { command: "git status" } }, ctx);
  gardes["bash-guard"] = { evenements: [...a.on.keys()], temoin, contraste, dialogues };
}
{ // pi-secret-gate : un littéral de forme AWS, construit ici pour ne jamais figurer tel quel dans une source.
  const a = await charger("pi-secret-gate");
  const cle = "AKIA" + "QWERTYUIOPASDFGH";
  const temoin = await appeler(a, "tool_call", { toolName: "write", toolCallId: "g3", input: { path: "src/conf.py", content: "KEY = '" + cle + "'\n" } }, {});
  const contraste = await appeler(a, "tool_call", { toolName: "write", toolCallId: "g4", input: { path: "src/conf.py", content: "x = 1\n" } }, {});
  gardes["pi-secret-gate"] = { evenements: [...a.on.keys()], temoin, contraste };
}
{ // pi-lint-gate : ruff rapporte, la note suit le résultat de l'édition.
  const a = await charger("pi-lint-gate");
  a.script = (cmd) => cmd === "sh" ? { code: 0, stdout: "/usr/bin/ruff\n", stderr: "" }
    : cmd === "ruff" ? { code: 1, stdout: "src/a.py:1:1: F401 os imported but unused\n", stderr: "" } : { code: 1, stdout: "", stderr: "" };
  const ctx = { cwd: root, signal: undefined };
  const contenu = [{ type: "text", text: "Successfully replaced text." }];
  const temoin = await appeler(a, "tool_result", { toolName: "edit", toolCallId: "g5", input: { path: "src/a.py" }, content: contenu, isError: false }, ctx);
  const contraste = await appeler(a, "tool_result", { toolName: "edit", toolCallId: "g6", input: { path: "NOTES.md" }, content: contenu, isError: false }, ctx);
  gardes["pi-lint-gate"] = { evenements: [...a.on.keys()], temoin, contraste, execs: a.execs };
}
{ // pi-bq-cost-sentinel : un essai à blanc au-delà d'un téraoctet, refusé sans interface.
  const a = await charger("pi-bq-cost-sentinel");
  a.script = (cmd) => cmd === "bash" ? { code: 0, stdout: "", stderr: "running this query will process 2.1 TB of data." } : { code: 1, stdout: "", stderr: "" };
  const ctx = { hasUI: false, cwd: root, signal: undefined, ui: { notify() {} } };
  const temoin = await appeler(a, "tool_call", { toolName: "bash", toolCallId: "g7", input: { command: "bq query --use_legacy_sql=false 'select 1'" } }, ctx);
  const execsTemoin = a.execs.length;
  const contraste = await appeler(a, "tool_call", { toolName: "bash", toolCallId: "g8", input: { command: "ls" } }, ctx);
  gardes["pi-bq-cost-sentinel"] = { evenements: [...a.on.keys()], temoin, contraste, execs: a.execs, execsTemoin };
}
{ // compaction-guard : au-dessus de la moitié de la fenêtre, une compaction ; en dessous, aucune.
  const compter = async (tokens) => {
    const a = await charger("compaction-guard"); let n = 0;
    const ctx = { getContextUsage: () => ({ tokens, contextWindow: 200000 }), isIdle: () => false, compact: () => { n++; }, hasUI: false };
    const rendu = await appeler(a, "turn_end", { type: "turn_end" }, ctx);
    return { evenements: [...a.on.keys()], rendu, compactions: n };
  };
  const temoin = await compter(150000); const contraste = await compter(1000);
  gardes["compaction-guard"] = { evenements: temoin.evenements, temoin: temoin.compactions, contraste: contraste.compactions };
}
const profilApres = await s.profil();
console.log("PGG " + JSON.stringify({ profil, profilApres, role: process.env.PI_SUBAGENT_ROLE ?? null, gardes }));
`;

const RAISON_CONTOURNEMENT =
  "blocked by bash-guard: --no-verify (or commit -n) bypasses this repository's hooks, which an agent never bypasses. Report the refusal and stop.";

couverture("P2-G02", "au chargement en simple, chaque garde est enregistrée et rend son verdict de référence sur un cas témoin", () => {
  const r = enfant(SCENARIO_G02) as {
    profil: string; profilApres: string; role: string | null;
    gardes: Record<string, { evenements: string[]; temoin: unknown; contraste: unknown; dialogues?: number; execs?: string[][]; execsTemoin?: number }>;
  };
  precondition(r.role === null, "aucun rôle d'enfant dans le processus");
  precondition(/Profil : simple\./.test(r.profil), `l'extension subagent est en simple au démarrage : ${JSON.stringify(r.profil)}`);
  const g = r.gardes;
  const attendus: Record<string, string> = {
    "bash-guard": "tool_call", "pi-secret-gate": "tool_call", "pi-lint-gate": "tool_result",
    "pi-bq-cost-sentinel": "tool_call", "compaction-guard": "turn_end",
  };
  for (const nom of GARDES) {
    propriete((g[nom]?.evenements ?? []).includes(attendus[nom]), `${nom} est enregistrée sur ${attendus[nom]} au chargement en simple : ${JSON.stringify(g[nom]?.evenements)}`);
  }
  const bg = g["bash-guard"];
  propriete(JSON.stringify(bg.temoin) === JSON.stringify({ block: true, reason: RAISON_CONTOURNEMENT }) && bg.dialogues === 0,
    `bash-guard refuse le contournement des crochets, sans dialogue : ${JSON.stringify(bg.temoin)}`);
  propriete(bg.contraste === null, `bash-guard laisse passer git status : ${JSON.stringify(bg.contraste)}`);
  const sg = g["pi-secret-gate"].temoin as { block?: boolean; reason?: string } | null;
  propriete(sg?.block === true && (sg.reason ?? "").startsWith("blocked by pi-secret-gate: this write puts a credential-shaped literal in src/conf.py.\n") &&
    (sg.reason ?? "").includes("AWS access key id"), `pi-secret-gate refuse le littéral de forme AWS : ${JSON.stringify(sg)}`);
  propriete(g["pi-secret-gate"].contraste === null, `pi-secret-gate laisse passer une écriture ordinaire : ${JSON.stringify(g["pi-secret-gate"].contraste)}`);
  const lg = g["pi-lint-gate"];
  const note = lg.temoin as { content?: Array<{ text?: string }> } | null;
  propriete(Array.isArray(note?.content) && note!.content!.length === 2 && note!.content![0].text === "Successfully replaced text." &&
    (note!.content![1].text ?? "").includes("--- ruff (src/a.py) ---\nsrc/a.py:1:1: F401 os imported but unused\n"),
    `pi-lint-gate ajoute la note de ruff au résultat : ${JSON.stringify(note)}`);
  propriete(lg.contraste === null, `pi-lint-gate ne touche pas un fichier non Python : ${JSON.stringify(lg.contraste)}`);
  const bq = g["pi-bq-cost-sentinel"];
  const vbq = bq.temoin as { block?: boolean; reason?: string } | null;
  propriete(vbq?.block === true && (vbq.reason ?? "").startsWith("blocked by bq-cost-sentinel: this query scans 2.10 TB / $13.1250, above the 1 TB threshold.\n") &&
    bq.execsTemoin === 1 && (bq.execs?.[0] ?? []).join(" ").includes("query --dry_run"),
    `pi-bq-cost-sentinel refuse au-delà d'un téraoctet, après un essai à blanc : ${JSON.stringify(bq)}`);
  propriete(bq.contraste === null && bq.execs?.length === 1, `pi-bq-cost-sentinel ne touche pas une commande sans bq : ${JSON.stringify(bq)}`);
  const cg = g["compaction-guard"];
  propriete(cg.temoin === 1 && cg.contraste === 0, `compaction-guard compacte au-dessus du seuil, pas en dessous : ${JSON.stringify(cg)}`);
  propriete(/Profil : simple\./.test(r.profilApres), `le profil reste simple : ${JSON.stringify(r.profilApres)}`);
});

// ------------------------------------------------------------------ G03

preservation("P2-G03", "profil simple : sans PI_SUBAGENT_ROLE, les crochets appliquent le chemin opérateur", () => {
  const d = tmp("pi-p2g3-");
  const home = join(d, "home");
  mkdirSync(join(home, ".pi"), { recursive: true });
  const nu = join(d, "nu.git");
  const clone = join(d, "clone");
  const env = { ...sansRole(process.env), HOME: home };
  const git = (args: string[], cwd = clone, e: NodeJS.ProcessEnv = env) => spawnSync("git", args, { cwd, env: e, encoding: "utf-8" });
  const ok = (args: string[], cwd = clone): string => {
    const p = git(args, cwd);
    precondition(p.status === 0, `git ${args.join(" ")} : ${p.stderr}`);
    return p.stdout.trim();
  };
  ok(["init", "-q", "--bare", nu], d);
  ok(["init", "-q", "-b", "principale", clone], d);
  ok(["config", "user.email", "t@t"]);
  ok(["config", "user.name", "t"]);
  writeFileSync(join(clone, "a.txt"), "a\n");
  ok(["add", "-A"]);
  ok(["-c", "core.hooksPath=/dev/null", "commit", "-qm", "test: base"]);
  ok(["remote", "add", "origin", nu]);
  ok(["-c", "core.hooksPath=/dev/null", "push", "-q", "origin", "principale"]);
  ok(["config", "core.hooksPath", HOOKS]);
  const base = ok(["rev-parse", "HEAD"]);

  writeFileSync(join(clone, "a.txt"), "b\n");
  ok(["add", "-A"]);
  const refuse = git(["commit", "-m", "Bad subject."]);
  propriete(refuse.status !== 0 && refuse.stderr.includes("commit-msg: subject line rejected") && ok(["rev-parse", "HEAD"]) === base,
    `commit-msg s'applique à l'opérateur : ${refuse.status} ${refuse.stderr.slice(0, 200)}`);
  const commit = git(["commit", "-m", "test: by the operator"]);
  const tete = ok(["rev-parse", "HEAD"]);
  propriete(commit.status === 0 && tete !== base, `le commit de l'opérateur passe pre-commit et reference-transaction : ${commit.stderr.slice(0, 200)}`);
  const push = git(["push", "origin", "principale"]);
  propriete(push.status !== 0 && push.stderr.includes("refused by pre-push: no authorisation") &&
    ok(["rev-parse", "refs/heads/principale"], nu) === base, `pre-push exige l'autorisation de l'opérateur : ${push.stderr.slice(0, 300)}`);
  // Contre-épreuve : le même commit, avec le rôle d'un enfant, est refusé par pre-commit.
  writeFileSync(join(clone, "a.txt"), "c\n");
  ok(["add", "-A"]);
  const enfantRefuse = git(["commit", "-m", "test: by a worker"], clone, { ...env, PI_SUBAGENT_ROLE: "worker" });
  propriete(enfantRefuse.status !== 0 && enfantRefuse.stderr.includes("commits belong to the runtime") && ok(["rev-parse", "HEAD"]) === tete,
    `avec le rôle d'un enfant, pre-commit refuse : ${enfantRefuse.stderr.slice(0, 200)}`);
});

// ------------------------------------------------------------------ G04

const SCENARIO_G04 = String.raw`
const root = depot();
const s = await subagentSimple(root);
const cc = await imp("extensions/pi-check-config/index.ts");
const variantes = JSON.parse(process.env.G_VARIANTES);
async function rapport(dir) {
  process.env.G_AGENT_DIR = dir;
  let handler; const messages = []; const notes = [];
  cc.default({
    registerCommand: (n, c) => { if (n === "check-config") handler = c.handler; },
    exec: async (cmd, args, opts) => { const p = spawnSync(cmd, args, { encoding: "utf-8", timeout: opts?.timeout }); return { code: p.status, stdout: p.stdout ?? "", stderr: p.stderr ?? "", killed: false }; },
    sendUserMessage: (t) => { messages.push(t); },
  });
  await handler("", { hasUI: true, cwd: root, ui: { notify: (t, g) => { notes.push([g, t]); } } });
  return { messages, notes };
}
const tous = async () => { const r = {}; for (const [nom, dir] of Object.entries(variantes)) r[nom] = await rapport(dir); return r; };
const simple = { profil: await s.profil(), rapports: await tous() };
const on = (await s.sub("on")).filter((n) => n.genre === "error").map((n) => n.texte);
const sousAgents = { profil: await s.profil(), rapports: await tous() };
console.log("PGG " + JSON.stringify({ simple, on, sousAgents }));
`;

const LIGNE = (etat: string) =>
  `BLOCKING  subagent-only/DELEGATION.md: ${etat} — the subagents profile cannot compose its prompt, task stays refused`;

/** Un répertoire d'agent d'épreuve : les seules pièces que `/check-config` lit, copiées du dépôt. */
function agentDEpreuve(delegation: "nominal" | "absent" | "illisible" | "vide"): string {
  const d = tmp(`pi-p2g4-${delegation}-`);
  for (const p of ["AGENTS.md", "README.md", "settings.json", "skills", "extensions", "subagent-only/agents", "subagent-only/envelope"]) {
    cpSync(join(REPO, p), join(d, p), { recursive: true });
  }
  const f = join(d, "subagent-only", "DELEGATION.md");
  if (delegation === "nominal") cpSync(join(REPO, "subagent-only", "DELEGATION.md"), f);
  if (delegation === "illisible") mkdirSync(f);
  if (delegation === "vide") writeFileSync(f, "\n  \n");
  return d;
}

couverture("P2-G04", "/check-config rend le même rapport en simple et en sous-agents ; DELEGATION.md absent, illisible ou vide est bloquant", () => {
  const variantes = {
    depot: REPO,
    nominal: agentDEpreuve("nominal"),
    absent: agentDEpreuve("absent"),
    illisible: agentDEpreuve("illisible"),
    vide: agentDEpreuve("vide"),
  };
  type Rapport = { messages: string[]; notes: string[][] };
  const r = enfant(SCENARIO_G04, { G_VARIANTES: JSON.stringify(variantes) }) as {
    simple: { profil: string; rapports: Record<string, Rapport> }; on: string[];
    sousAgents: { profil: string; rapports: Record<string, Rapport> };
  };
  precondition(/Profil : simple\./.test(r.simple.profil), `premier relevé en simple : ${JSON.stringify(r.simple.profil)}`);
  precondition(r.on.length === 0 && /Profil : sous-agents\./.test(r.sousAgents.profil), `second relevé en sous-agents : ${JSON.stringify(r)}`.slice(0, 600));
  const lignes = (x: Rapport): string[] => {
    precondition(x.messages.length === 1 && x.notes.length === 0, `un seul rapport, sans notification : ${JSON.stringify(x).slice(0, 300)}`);
    return x.messages[0].split("\n");
  };
  const bloquants = (l: string[]): string[] => l.filter((x) => x.startsWith("BLOCKING  "));
  for (const nom of Object.keys(variantes)) {
    propriete(JSON.stringify(r.simple.rapports[nom]) === JSON.stringify(r.sousAgents.rapports[nom]),
      `${nom} : même rapport en simple et en sous-agents`);
  }
  const nominal = lignes(r.simple.rapports.nominal);
  precondition(JSON.stringify(nominal.slice(1)) === JSON.stringify(lignes(r.simple.rapports.depot).slice(1)),
    `le répertoire d'épreuve rend le rapport du dépôt : ${JSON.stringify(nominal).slice(0, 400)}`);
  propriete(!nominal.some((l) => l.includes("DELEGATION.md")), `DELEGATION.md présent et lisible : aucun constat (${JSON.stringify(bloquants(nominal))})`);
  for (const [nom, etat] of [["absent", "missing"], ["illisible", "unreadable (EISDIR)"], ["vide", "empty"]] as const) {
    const l = lignes(r.simple.rapports[nom]);
    propriete(JSON.stringify([...bloquants(l)].sort()) === JSON.stringify([...bloquants(nominal), LIGNE(etat)].sort()),
      `${nom} : exactement un constat bloquant de plus, « ${LIGNE(etat)} » : ${JSON.stringify(bloquants(l))}`);
    propriete(l.some((x) => x.startsWith("Tier 1 failures.")), `${nom} : le rapport dit d'arrêter (Tier 1)`);
  }
});

