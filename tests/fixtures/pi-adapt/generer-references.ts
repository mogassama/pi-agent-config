/**
 * Générateur des références de neutralité N1 à N3 (LOT-PI-ADAPT, item 2 ; PLAN § 4, MATRICES § C).
 *
 * Exécuté sur le checkout propre de la base, avant toute modification de production :
 *
 *   node --import ./tests/stubs/loader.mjs --experimental-strip-types \
 *     tests/fixtures/pi-adapt/generer-references.ts --depot
 *       écrit tests/fixtures/pi-adapt/references-b5453204.json : N1, N2 (quatre scénarios
 *       synthétiques rejoués par fake-pi.mjs) et N3, liés au commit, à l'arbre, au générateur et à
 *       son SHA-256 ;
 *
 *   … generer-references.ts --qdeff <dossier de sortie neuf> <archive.zip>=<dossier extrait> …
 *       écrit hors dépôt les projections N2 des transcriptions QD-EFF de chaque archive, liées à
 *       l'identité et au SHA-256 de l'archive et de chaque transcription (etablir-references-qdeff.sh) ;
 *
 *   … generer-references.ts --projeter-qdeff <dossier de sortie neuf> <archive.zip>=<dossier extrait> …
 *       mêmes projections, sans liaison à la base : pour verifier-neutralite-qdeff.sh sur un
 *       candidat. Le résultat porte « candidat » et n'est jamais une référence.
 *
 * Les modes --depot et --qdeff refusent (code 2) si le dépôt n'est pas exactement la base :
 * commit, arbre, aucun fichier suivi modifié hors tests/stubs/fake-pi.mjs (mode relecture),
 * aucun fichier non suivi hors tests/fixtures/pi-adapt/. Aucune source de production n'est
 * modifiée. Le résultat ne contient aucune valeur variable (ni date, ni chemin temporaire) : deux
 * exécutions sur la même base donnent les mêmes octets.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadAgents, type AgentDefinition } from "../../../subagent-only/agents.ts";
import { dispatch } from "../../../subagent-only/dispatch.ts";
import { buildSpawnPlan, describePlan, type BuildContext } from "../../../subagent-only/spawn-args.ts";
import { commandeDeTestDetail } from "../../../subagent-only/test-command.ts";

const ICI = dirname(fileURLToPath(import.meta.url));
const DEPOT = realpathSync(join(ICI, "..", "..", ".."));
const GENERATEUR = fileURLToPath(import.meta.url);
const FAUX_PI = join(DEPOT, "tests", "stubs", "fake-pi.mjs");
const SORTIE_DEPOT = join(ICI, "references-b5453204.json");

export const BASE = { commit: "b54532045e1305bd48ee93ea8fdebdcca534b847", arbre: "afaf99afeceff29f848e853249148095b4169ea7" };

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const git = (args: string[], cwd = DEPOT) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" } }).trim();

/** Le dépôt est-il exactement la base, au périmètre de la constitution près ? Rend les motifs de refus. */
export function controlerBase(): string[] {
  const motifs: string[] = [];
  const commit = git(["rev-parse", "HEAD"]);
  const arbre = git(["rev-parse", "HEAD^{tree}"]);
  if (commit !== BASE.commit) motifs.push(`commit ${commit} ≠ ${BASE.commit}`);
  if (arbre !== BASE.arbre) motifs.push(`arbre ${arbre} ≠ ${BASE.arbre}`);
  // Sans `trim` : la première colonne du format porcelaine est significative.
  const suivis = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: DEPOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" } }).split("\n").filter(Boolean);
  for (const l of suivis) if (l !== " M tests/stubs/fake-pi.mjs") motifs.push(`fichier suivi modifié hors périmètre : ${l}`);
  const nonSuivis = git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
  for (const f of nonSuivis) if (!f.startsWith("tests/fixtures/pi-adapt/")) motifs.push(`fichier non suivi hors périmètre : ${f}`);
  return motifs;
}

// ── Contexte commun : agentDir temporaire = contenu suivi de la base ─────────────

/** Fixture déclarée : le paquet du fournisseur du scout, installé sous npm/ dans un agentDir réel. */
const FIXTURE_FOURNISSEUR = { chemin: "npm/node_modules/pi-deepseek-provider/index.ts", contenu: "// Fixture N1/N2 : paquet du fournisseur deepseek, résolu par spawn-args.\nexport default function () {}\n" };

type Racines = { agentDir: string; cwd: string; artefacts: string; jetables: string[] };

function preparerRacines(): Racines {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "pi-adapt-agent-")));
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-adapt-cwd-")));
  const artefacts = realpathSync(mkdtempSync(join(tmpdir(), "pi-adapt-artefacts-")));
  // Le contenu suivi de HEAD, pas l'arbre de travail : la modification de fake-pi.mjs n'y entre pas.
  const archive = execFileSync("git", ["archive", "--format=tar", "HEAD"], { cwd: DEPOT, maxBuffer: 512 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", agentDir], { input: archive });
  mkdirSync(join(agentDir, dirname(FIXTURE_FOURNISSEUR.chemin)), { recursive: true });
  writeFileSync(join(agentDir, FIXTURE_FOURNISSEUR.chemin), FIXTURE_FOURNISSEUR.contenu);
  // cwd : un dépôt git minimal, pour treeState des rôles qui écrivent ; aucun fichier de données.
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, GIT_AUTHOR_NAME: "n", GIT_AUTHOR_EMAIL: "n@n", GIT_COMMITTER_NAME: "n", GIT_COMMITTER_EMAIL: "n@n", GIT_AUTHOR_DATE: "2026-10-08T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-08T00:00:00Z" };
  execFileSync("git", ["init", "-q"], { cwd, env });
  writeFileSync(join(cwd, "LISEZ-MOI.md"), "dépôt de référence\n");
  execFileSync("git", ["add", "LISEZ-MOI.md"], { cwd, env });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "base"], { cwd, env });
  return { agentDir, cwd, artefacts, jetables: [agentDir, cwd, artefacts] };
}

/** Normalisations déclarées (MATRICES § C), appliquées symétriquement à toute chaîne. */
function normaliseur(r: Racines) {
  const n = (s: string) => s.split(r.agentDir).join("<AGENTDIR>").split(r.cwd).join("<CWD>");
  const profond = (v: unknown): unknown =>
    typeof v === "string" ? n(v) : Array.isArray(v) ? v.map(profond) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, profond(x)])) : v;
  return profond;
}

function agentsDeLaBase(): Map<string, AgentDefinition> {
  return loadAgents(join(DEPOT, "subagent-only", "agents"));
}

// ── N1 ───────────────────────────────────────────────────────────────────────

export const AGENTS_N1 = ["worker", "integration-worker", "reviewer", "scout", "advisor"];
export const TACHE_N1 = "Tâche de référence N1 : décrire le rôle du module src/a.py.";

export const CONTEXTES_N1: Array<{ id: string; description: string; ctx: Partial<BuildContext> }> = [
  { id: "minimal", description: "agentDir, selfDir, runId, cwd", ctx: {} },
  { id: "commande-de-test", description: "+ testCommand et testCommandDeclaree", ctx: { testCommand: "pytest -q", testCommandDeclaree: "pytest tests/" } },
  {
    id: "perimetre-risques-gardes",
    description: "+ perimetre, risquesOuverts et gardes",
    ctx: {
      perimetre: { unit: "W01", scope: ["src/a.py", "tests/test_a.py"], kept: ["src/b.py"] },
      risquesOuverts: { ids: ["W01-R1"], remis: ["W01-R1"] },
      gardes: { unit: "W01", kept: ["src/b.py"] },
    },
  },
  {
    id: "injection-delegation",
    description: "+ injection et delegation",
    ctx: {
      injection: { run: "n1ref", planHash: "a".repeat(64), unit: "W01", seq: 2, tree: "b".repeat(40), files: [{ path: "src/b.py", blob: "c".repeat(40), size: 6 }] },
      delegation: { run: "n1ref", planHash: "a".repeat(64), unit: "W01", seq: 2 },
    },
  },
];

function n1(r: Racines) {
  const agents = agentsDeLaBase();
  const norm = normaliseur(r);
  const sorties: unknown[] = [];
  for (const nom of AGENTS_N1) {
    const agent = agents.get(nom);
    if (!agent) throw new Error(`N1 : agent ${nom} absent de la base`);
    for (const c of CONTEXTES_N1) {
      const ctx: BuildContext = { agentDir: r.agentDir, selfDir: join(r.agentDir, "subagent-only"), runId: "n1ref", cwd: r.cwd, ...c.ctx };
      const plan = buildSpawnPlan(agent, TACHE_N1, ctx);
      sorties.push(norm({
        agent: nom,
        contexte: c.id,
        args: plan.args,
        env: plan.env,
        injectedChars: plan.injectedChars,
        estimatedInputTokens: plan.estimatedInputTokens,
        withoutDelta: plan.withoutDelta,
        describePlan: describePlan(plan),
      }));
    }
  }
  return sorties;
}

// ── N2 ───────────────────────────────────────────────────────────────────────

/** Scénarios synthétiques versionnés : rôle rejoué et code de sortie de l'enregistrement sur pi 0.86.0. */
export const SCENARIOS_N2 = [
  { id: "nominal", fichier: "transcriptions/nominal.jsonl", role: "scout", code: 0 },
  { id: "erreur-fournisseur", fichier: "transcriptions/erreur-fournisseur.jsonl", role: "scout", code: 0 },
  { id: "submit-refuse-puis-accepte", fichier: "transcriptions/submit-refuse-puis-accepte.jsonl", role: "reviewer", code: 0 },
  { id: "commande-de-test", fichier: "transcriptions/commande-de-test.jsonl", role: "worker", code: 0 },
];
export const TACHE_N2 = "Tâche de relecture N2.";
/** Champs comparés (MATRICES § C). Exclus : durationMs et les horodatages, absents de la projection. */
export const CHAMPS_N2 = ["turns", "usage", "submit", "providerError", "failure", "degradedLastText", "commandeDeTestDetail"];

/** Rejoue une transcription par fake-pi.mjs dans dispatch() de l'arbre courant ; rend la projection. */
export async function projeter(r: Racines, transcription: string, code: number, role: string, seq: number) {
  const agent = agentsDeLaBase().get(role);
  if (!agent) throw new Error(`N2 : rôle ${role} sans définition`);
  const precedent = { replay: process.env.PI_FAKE_REPLAY, exit: process.env.PI_FAKE_EXIT };
  process.env.PI_FAKE_REPLAY = transcription;
  process.env.PI_FAKE_EXIT = String(code);
  let res;
  try {
    res = await dispatch(agent, TACHE_N2, {
      ctx: { agentDir: r.agentDir, selfDir: join(r.agentDir, "subagent-only"), runId: "n2ref", cwd: r.cwd },
      seq,
      artifactDir: r.artefacts,
      piPath: FAUX_PI,
    });
  } finally {
    if (precedent.replay === undefined) delete process.env.PI_FAKE_REPLAY;
    else process.env.PI_FAKE_REPLAY = precedent.replay;
    if (precedent.exit === undefined) delete process.env.PI_FAKE_EXIT;
    else process.env.PI_FAKE_EXIT = precedent.exit;
  }
  const artefact = JSON.parse(readFileSync(res.artifact, "utf8"));
  const lu = readFileSync(res.artifact.replace(/\.json$/, ".jsonl"), "utf8").split("\n");
  const source = readFileSync(transcription, "utf8").split("\n").filter((l) => l.trim());
  // Contrôle de relecture : dispatch a lu chaque ligne non vide de la transcription, dans l'ordre.
  const relu = lu.filter((l) => l.trim());
  if (relu.length !== source.length || relu.some((l, i) => l !== source[i])) {
    throw new Error(`N2 : relecture incomplète de ${transcription} (${relu.length} ligne(s) relue(s), ${source.length} attendue(s))`);
  }
  return {
    lignes: source.length,
    projection: {
      turns: res.turns,
      usage: res.usage,
      submit: artefact.envelope,
      providerError: artefact.providerError ?? null,
      failure: res.failure ?? null,
      degradedLastText: artefact.degraded?.lastText ?? null,
      commandeDeTestDetail: commandeDeTestDetail(lu),
    },
  };
}

async function n2(r: Racines) {
  const sorties: unknown[] = [];
  let seq = 0;
  for (const s of SCENARIOS_N2) {
    const f = join(ICI, s.fichier);
    const p = await projeter(r, f, s.code, s.role, ++seq);
    sorties.push({ id: s.id, transcription: s.fichier, sha256: sha(readFileSync(f)), role: s.role, code: s.code, lignes: p.lignes, projection: p.projection });
  }
  return sorties;
}

// ── N3 ───────────────────────────────────────────────────────────────────────

const SOURCE_PREDICAT = "extensions/subagent/index.ts";

/** Texte exact du prédicat de la base : la constante OUTILS_LECTURE et outilLectureVerifie. */
export function extrairePredicat(texte: string): { constante: string; fonction: string; lignes: string } {
  const lignes = texte.split("\n");
  const ic = lignes.findIndex((l) => l.startsWith("const OUTILS_LECTURE = "));
  const id = lignes.findIndex((l) => l.startsWith("function outilLectureVerifie("));
  if (ic < 0 || id < 0 || lignes.filter((l) => l.startsWith("function outilLectureVerifie(")).length !== 1) throw new Error("N3 : prédicat introuvable ou multiple");
  const fin = lignes.findIndex((l, i) => i > id && l === "}");
  return { constante: lignes[ic], fonction: lignes.slice(id, fin + 1).join("\n"), lignes: `${ic + 1} ; ${id + 1}-${fin + 1}` };
}

const natif = (name: string, path = `<builtin:${name}>`, source = "builtin") => ({ name, sourceInfo: { source, path } });

/** Les sept cas de MATRICES § C ; le sixième en deux formes (absent, levant). */
export const CAS_N3: Array<{ id: string; description: string; nom: string; api: "liste" | "sans-getAllTools" | "levant"; outils?: unknown[] }> = [
  { id: "1", description: "{builtin, \"<builtin:read>\"}", nom: "read", api: "liste", outils: [natif("read")] },
  { id: "2", description: "{builtin, \"builtin:read\"}", nom: "read", api: "liste", outils: [natif("read", "builtin:read")] },
  { id: "3", description: "{builtin, \"<builtin:grep>\"}, demandé pour read", nom: "read", api: "liste", outils: [natif("read", "<builtin:grep>")] },
  { id: "4", description: "{cli, \"<builtin:read>\"}", nom: "read", api: "liste", outils: [natif("read", "<builtin:read>", "cli")] },
  { id: "5", description: "sourceInfo absent", nom: "read", api: "liste", outils: [{ name: "read" }] },
  { id: "6a", description: "getAllTools absent", nom: "read", api: "sans-getAllTools" },
  { id: "6b", description: "getAllTools levant", nom: "read", api: "levant" },
  { id: "7", description: "nom hors de {read, grep, find, ls}", nom: "bash", api: "liste", outils: [natif("bash")] },
];

async function n3(r: Racines) {
  const texte = readFileSync(join(DEPOT, SOURCE_PREDICAT), "utf8");
  const p = extrairePredicat(texte);
  const module = join(r.artefacts, "predicat-base.ts");
  writeFileSync(module, `type OutilConnu = any;\nlet PI_API: any;\nexport function poser(api: any): void { PI_API = api; }\n${p.constante}\nexport ${p.fonction}\n`);
  const m = await import(pathToFileURL(module).href);
  const resultats = CAS_N3.map((c) => {
    m.poser(c.api === "sans-getAllTools" ? {} : c.api === "levant" ? { getAllTools: () => { throw new Error("getAllTools levant"); } } : { getAllTools: () => c.outils });
    return { id: c.id, description: c.description, nom: c.nom, api: c.api, outils: c.outils ?? null, attendu: m.outilLectureVerifie(c.nom) };
  });
  return { source: SOURCE_PREDICAT, lignes: p.lignes, sha256Texte: sha(`${p.constante}\n${p.fonction}`), constante: p.constante, fonction: p.fonction, cas: resultats };
}

// ── QD-EFF ───────────────────────────────────────────────────────────────────

const TRANSCRIPTION_QDEFF = /^([0-9a-f]+)-(\d{2})-([a-z-]+)\.jsonl$/;

async function qdeff(sortie: string, couples: string[], liee: boolean, r: Racines) {
  if (existsSync(sortie)) throw new Error(`${sortie} existe déjà`);
  const resultats: unknown[] = [];
  let seq = 0;
  for (const couple of couples) {
    const [archive, extrait] = couple.split("=");
    const runs = join(extrait, "releve", "runs");
    const fichiers = readdirSync(runs).filter((f) => TRANSCRIPTION_QDEFF.test(f)).sort();
    for (const f of fichiers) {
      const [, run, num, role] = TRANSCRIPTION_QDEFF.exec(f)!;
      const artefactSource = JSON.parse(readFileSync(join(runs, f.replace(/\.jsonl$/, ".json")), "utf8"));
      const code = artefactSource.exitCode;
      if (!Number.isInteger(code)) throw new Error(`QD-EFF : code de sortie absent de l'artefact de ${f}`);
      const p = await projeter(r, join(runs, f), code, role, ++seq);
      resultats.push({
        archive: basename(archive),
        archiveSha256: sha(readFileSync(archive)),
        membre: `releve/runs/${f}`,
        membreSha256: sha(readFileSync(join(runs, f))),
        run, delegation: num, role, code, lignes: p.lignes,
        projection: p.projection,
        // Témoin : ce que l'artefact du run d'origine a enregistré, pour lecture ; non comparé.
        artefactOrigine: { turns: artefactSource.turns, usage: artefactSource.usage, failure: artefactSource.failure, providerError: artefactSource.providerError },
      });
    }
  }
  mkdirSync(sortie, { recursive: true });
  const doc = {
    nature: liee ? "références QD-EFF, établies sur la base" : "projections du candidat, non référence",
    ...(liee ? { base: BASE } : { depot: { commit: git(["rev-parse", "HEAD"]), arbre: git(["rev-parse", "HEAD^{tree}"]) } }),
    generateur: { chemin: relative(DEPOT, GENERATEUR), sha256: sha(readFileSync(GENERATEUR)) },
    fakePi: { chemin: relative(DEPOT, FAUX_PI), sha256: sha(readFileSync(FAUX_PI)) },
    champs: CHAMPS_N2,
    projections: resultats,
  };
  writeFileSync(join(sortie, liee ? "references-qdeff.json" : "projections-candidat.json"), JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

async function principal(): Promise<number> {
  const [mode, ...reste] = process.argv.slice(2);
  if (mode !== "--depot" && mode !== "--qdeff" && mode !== "--projeter-qdeff") {
    process.stderr.write("usage : generer-references.ts --depot | --qdeff <sortie> <zip>=<extrait>… | --projeter-qdeff <sortie> <zip>=<extrait>…\n");
    return 2;
  }
  if (mode !== "--projeter-qdeff") {
    const motifs = controlerBase();
    if (motifs.length) {
      process.stderr.write(`REFUS — le dépôt n'est pas la base de référence :\n${motifs.map((m) => `  ${m}`).join("\n")}\n`);
      return 2;
    }
  }
  const r = preparerRacines();
  try {
    if (mode === "--depot") {
      const fichiers = (rel: string[]) => Object.fromEntries(rel.map((f) => [f, sha(readFileSync(join(DEPOT, f)))]));
      const doc = {
        lot: "LOT-PI-ADAPT",
        references: "N1 à N3, neutralité de l'item 2 sur pi 0.86.0 (PLAN § 4, MATRICES § C)",
        base: BASE,
        generateur: { chemin: relative(DEPOT, GENERATEUR), sha256: sha(readFileSync(GENERATEUR)) },
        entrees: fichiers([
          "subagent-only/spawn-args.ts", "subagent-only/dispatch.ts", "subagent-only/test-command.ts", "subagent-only/agents.ts",
          "extensions/subagent/index.ts", "tests/stubs/fake-pi.mjs",
          ...AGENTS_N1.map((a) => `subagent-only/agents/${a}.md`),
          ...SCENARIOS_N2.map((s) => relative(DEPOT, join(ICI, s.fichier))),
        ]),
        normalisations: { "<AGENTDIR>": "racine temporaire de agentDir (contenu suivi de HEAD + fixture du fournisseur)", "<CWD>": "racine temporaire de cwd (dépôt git minimal)" },
        fixtures: { [FIXTURE_FOURNISSEUR.chemin]: sha(FIXTURE_FOURNISSEUR.contenu) },
        n1: { tache: TACHE_N1, contextes: CONTEXTES_N1, plans: n1(r) },
        n2: { tache: TACHE_N2, champs: CHAMPS_N2, exclus: ["durationMs", "horodatages"], scenarios: await n2(r) },
        n3: await n3(r),
      };
      // Aucune chaîne ne doit garder une racine temporaire après normalisation.
      const texte = JSON.stringify(doc, null, 2) + "\n";
      if (/pi-adapt-(agent|cwd|artefacts)-/.test(texte)) throw new Error("racine temporaire non normalisée dans les références");
      writeFileSync(SORTIE_DEPOT, texte);
      process.stdout.write(`références écrites : ${relative(DEPOT, SORTIE_DEPOT)} sha256 ${sha(texte)}\n`);
      return 0;
    }
    const [sortie, ...couples] = reste;
    const doc = await qdeff(sortie, couples, mode === "--qdeff", r);
    process.stdout.write(`${doc.nature} : ${(doc.projections as unknown[]).length} transcription(s) → ${sortie}\n`);
    return 0;
  } finally {
    for (const d of r.jetables) rmSync(d, { recursive: true, force: true });
  }
}

process.exitCode = await principal();
