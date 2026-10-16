/**
 * l0-registres-git-clean.test.ts — phase 3, P1 : les registres durables survivent à l'hygiène git
 * ordinaire (PLAN-PHASE3 v2, § 5.1 ; adjudication 9ec0aae9, D-P3-1 et R1).
 *
 * `.pi-subagent-runs/` est ignoré par git, et il porte les registres d'un run en vol : manifeste,
 * registres de lanes et d'intégrations, archives, artefacts, verrous. Le 08-09, un `git clean -xfd`
 * en a détruit douze artefacts réels. `openRun` pose désormais dans cet espace un marqueur de dépôt
 * imbriqué minimal, que `git clean` à simple force et `git stash --all` ne retirent pas.
 *
 * Chaque monde est jetable, sous TMPDIR : aucun nettoyage n'est jamais joué sur un espace réel.
 * Le test sans marqueur constate d'abord la perte dans son propre monde ; sans ce constat, le
 * monde serait faux et la propriété ne prouverait rien.
 *
 * Les preuves n'importent que des symboles qui existaient avant P1 (`openRun`,
 * `instrumentationIgnored`, `prendreEmpreinte`) : sur l'arbre d'avant, elles chargent, et elles
 * échouent sur leur PROPRIÉTÉ, pas sur un import.
 *
 * Portée prouvée, et seulement elle : `git clean -xfd`, `git clean -Xfd`, `git stash --all`. Ni la
 * double force, ni une suppression explicite, ni le retrait du marqueur ne sont couverts.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { openRun } from "../subagent-only/run-manifest.ts";
import { instrumentationIgnored } from "../subagent-only/repo-preflight.ts";
import { prendreEmpreinte } from "../subagent-only/empreinte.ts";
import { readGitInvocationCount } from "../subagent-only/git-probe-counter.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
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

const RUNS = ".pi-subagent-runs";
const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

/** git sans configuration globale ni système : un réglage de l'hôte ne décide pas d'une preuve. */
const ENV_GIT = (() => {
  const e: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_") && k !== "GIT_CONFIG_GLOBAL" && k !== "GIT_CONFIG_NOSYSTEM") delete e[k];
  return e;
})();
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env: ENV_GIT });

/** Un dépôt jouet qui ignore son instrumentation, comme l'exige le préflight. */
function monde(): { root: string; runs: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-p3r-")));
  jetables.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return { root, runs: join(root, RUNS) };
}

/** Le contenu d'un espace, fichiers et répertoires, pour comparer avant et après. */
function inventaire(dir: string): string[] {
  const out: string[] = [];
  const parcourir = (rel: string) => {
    for (const nom of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${nom}` : nom;
      const st = lstatSync(join(dir, r));
      if (st.isSymbolicLink()) out.push(`${r} -> lien`);
      else if (st.isDirectory()) { out.push(`${r}/`); parcourir(r); }
      else out.push(`${r} ${readFileSync(join(dir, r), "utf-8").length}:${readFileSync(join(dir, r), "base64")}`);
    }
  };
  if (existsSync(dir)) parcourir("");
  return out;
}

/** Registres, archive, artefact et verrou d'un run en vol, écrits APRÈS l'ouverture. */
function peupler(runs: string, runId: string): void {
  writeFileSync(join(runs, `${runId}-lanes.jsonl`), '{"v":2,"evenement":"ouverte"}\n');
  writeFileSync(join(runs, `${runId}-integrations.jsonl`), '{"v":1}\n');
  writeFileSync(join(runs, `0123456789abcdef-run.json`), '{"archive":true}\n');
  writeFileSync(join(runs, `${runId}-01-worker.json`), '{"artefact":true}\n');
  mkdirSync(join(runs, `${runId}.guard`), { recursive: true });
}

/** Le marqueur que le runtime doit poser, vérifié par le système de fichiers. */
function marqueurPose(runs: string): boolean {
  const g = join(runs, ".git");
  if (!existsSync(g) || !lstatSync(g).isDirectory() || lstatSync(g).isSymbolicLink()) return false;
  const head = join(g, "HEAD");
  if (!existsSync(head) || !lstatSync(head).isFile()) return false;
  return readFileSync(head, "utf-8") === "ref: refs/heads/registres\n"
    && lstatSync(join(g, "objects")).isDirectory() && lstatSync(join(g, "refs")).isDirectory();
}

function nomErreur(fn: () => unknown): string | null {
  try { fn(); return null; } catch (err) { return (err as Error)?.constructor?.name ?? "inconnue"; }
}

// ── K-R1 à K-R3 : le nettoyage ordinaire ne retire plus l'espace ────────────────────────────────

function epreuveNettoyage(t: TestContext, commande: string[]): void {
  // Constat d'abord, dans un monde sans marqueur : la commande y détruit bien l'espace.
  const temoin = monde();
  mkdirSync(temoin.runs);
  peupler(temoin.runs, "fedcba9876543210");
  git(temoin.root, ...commande);
  precondition(!existsSync(temoin.runs), `le monde témoin devait perdre ${RUNS} sous git ${commande.join(" ")}`);

  // Puis la propriété : ouvert par openRun, le même espace survit.
  const m = monde();
  const ouvert = openRun(m.runs);
  peupler(m.runs, ouvert.manifest.runId);
  const avant = inventaire(m.runs);
  precondition(avant.length >= 6, "espace peuplé avant le nettoyage : manifeste, deux registres, archive, artefact, verrou");
  writeFileSync(join(m.root, "a.txt"), "modifie\n");
  writeFileSync(join(m.root, "nouveau.txt"), "n\n");
  git(m.root, ...commande);
  const apres = inventaire(m.runs);
  propriete(
    JSON.stringify(apres) === JSON.stringify(avant),
    `git ${commande.join(" ")} laisse ${RUNS} intact ; manquants : ${avant.filter((x) => !apres.includes(x)).slice(0, 5).join(", ") || "aucun"}`,
  );
  t.diagnostic(`git ${commande.join(" ")} : ${avant.length} entrées conservées`);
}

regressionCorrigee("P3-R1", "git clean -xfd laisse intact l'espace des runs ouvert par openRun", (t) => {
  epreuveNettoyage(t, ["clean", "-xfd"]);
});

regressionCorrigee("P3-R2", "git clean -Xfd laisse intact l'espace des runs ouvert par openRun", (t) => {
  epreuveNettoyage(t, ["clean", "-Xfd"]);
});

regressionCorrigee("P3-R3", "git stash --all laisse intact l'espace des runs ouvert par openRun", (t) => {
  epreuveNettoyage(t, ["stash", "push", "--all", "-q"]);
});

// ── K-R4 : le marqueur précède la garde d'espace ────────────────────────────────────────────────

regressionCorrigee("P3-R4", "le marqueur est posé avant la garde d'espace et avant tout fichier du run", () => {
  const m = monde();
  // Une garde d'espace restée inachevée fait refuser l'ouverture par withSpaceGuard.
  mkdirSync(join(m.runs, ".espace.guard"), { recursive: true });
  const vieux = new Date(Date.now() - 60_000);
  utimesSync(join(m.runs, ".espace.guard"), vieux, vieux);
  const erreur = nomErreur(() => openRun(m.runs));
  precondition(erreur === "TransitionLockedError", `refus attendu de la garde d'espace, obtenu ${erreur}`);
  propriete(marqueurPose(m.runs), "le marqueur existe même quand la garde d'espace refuse : il la précède");
  propriete(!existsSync(join(m.runs, "active-run.json")), "aucun manifeste écrit");
});

// ── K-R5 à K-R9 : un marqueur invalide est refusé, sans écriture ────────────────────────────────

function epreuveMarqueurInvalide(preparer: (git: string) => void, quoi: string): void {
  const m = monde();
  mkdirSync(m.runs);
  preparer(join(m.runs, ".git"));
  const avant = inventaire(m.runs);
  const erreur = nomErreur(() => openRun(m.runs));
  propriete(erreur === "MarqueurInvalideError", `${quoi} : refus MarqueurInvalideError attendu, obtenu ${erreur ?? "aucun refus"}`);
  propriete(JSON.stringify(inventaire(m.runs)) === JSON.stringify(avant), `${quoi} : l'espace est inchangé, rien n'est écrit ni réparé`);
  const pf = instrumentationIgnored(m.root, RUNS);
  propriete(!pf.ok, `${quoi} : le préflight refuse avant toute écriture`);
}

function marqueurValide(g: string): void {
  mkdirSync(join(g, "objects"), { recursive: true });
  mkdirSync(join(g, "refs"), { recursive: true });
  writeFileSync(join(g, "HEAD"), "ref: refs/heads/registres\n");
}

regressionCorrigee("P3-R5", "un HEAD absent, non ordinaire, trop long ou au contenu invalide fait refuser l'espace, sans écriture", () => {
  epreuveMarqueurInvalide((g) => { marqueurValide(g); writeFileSync(join(g, "HEAD"), "n'importe quoi\n"); }, "HEAD invalide");
  epreuveMarqueurInvalide((g) => { marqueurValide(g); writeFileSync(join(g, "HEAD"), "ref: refs/../x\n"); }, "HEAD qui remonte");
  epreuveMarqueurInvalide((g) => { marqueurValide(g); writeFileSync(join(g, "HEAD"), "ref: refs/heads/a..b\n"); }, "HEAD avec .. dans un composant");
  epreuveMarqueurInvalide((g) => { marqueurValide(g); writeFileSync(join(g, "HEAD"), `ref: refs/heads/${"a".repeat(5000)}\n`); }, "HEAD trop long, de forme valide");
  epreuveMarqueurInvalide((g) => { marqueurValide(g); rmSync(join(g, "HEAD")); }, "HEAD absent");
  epreuveMarqueurInvalide((g) => { marqueurValide(g); rmSync(join(g, "HEAD")); mkdirSync(join(g, "HEAD")); }, "HEAD répertoire");
});

regressionCorrigee("P3-R6", "un marqueur sans objects, ou dont objects n'est pas un répertoire, fait refuser l'espace", () => {
  epreuveMarqueurInvalide((g) => { marqueurValide(g); rmSync(join(g, "objects"), { recursive: true }); }, "objects absent");
  epreuveMarqueurInvalide((g) => { marqueurValide(g); rmSync(join(g, "objects"), { recursive: true }); writeFileSync(join(g, "objects"), ""); }, "objects fichier");
});

regressionCorrigee("P3-R7", "un marqueur sans refs, ou dont refs n'est pas un répertoire, fait refuser l'espace", () => {
  epreuveMarqueurInvalide((g) => { marqueurValide(g); rmSync(join(g, "refs"), { recursive: true }); }, "refs absent");
  epreuveMarqueurInvalide((g) => { marqueurValide(g); rmSync(join(g, "refs"), { recursive: true }); writeFileSync(join(g, "refs"), ""); }, "refs fichier");
});

regressionCorrigee("P3-R8", "un marqueur lien symbolique fait refuser l'espace, même vers un marqueur valide", () => {
  epreuveMarqueurInvalide((g) => {
    const cible = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-p3r-cible-")));
    jetables.push(cible);
    marqueurValide(cible);
    symlinkSync(cible, g);
  }, ".git lien");
  epreuveMarqueurInvalide((g) => {
    marqueurValide(g);
    rmSync(join(g, "HEAD"));
    const ailleurs = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-p3r-head-")));
    jetables.push(ailleurs);
    writeFileSync(join(ailleurs, "HEAD"), "ref: refs/heads/registres\n");
    symlinkSync(join(ailleurs, "HEAD"), join(g, "HEAD"));
  }, "HEAD lien");
});

regressionCorrigee("P3-R9", "un .git fichier (gitdir:) fait refuser l'espace", () => {
  epreuveMarqueurInvalide((g) => { writeFileSync(g, "gitdir: /nulle/part\n"); }, ".git fichier");
});

// ── K-R10 : une préparation interrompue n'est pas un marqueur ───────────────────────────────────

regressionCorrigee("P3-R10", "une préparation interrompue reste un vestige nommé et n'est jamais prise pour le marqueur", () => {
  const m = monde();
  mkdirSync(m.runs);
  const vestige = join(m.runs, ".git.preparation-1-0123456789abcdef");
  marqueurValide(vestige);
  const avantVestige = inventaire(vestige);
  openRun(m.runs);
  propriete(marqueurPose(m.runs), "un marqueur complet est posé malgré le vestige");
  propriete(existsSync(vestige) && JSON.stringify(inventaire(vestige)) === JSON.stringify(avantVestige), "le vestige est conservé tel quel");
});

// ── K-R11 : deux ouvertures concurrentes ────────────────────────────────────────────────────────

/** Deux processus Node ouvrent le même espace neuf au même instant ; chacun rend son verdict. */
async function ouverturesConcurrentes(runs: string): Promise<string[]> {
  const module = pathToFileURL(join(import.meta.dirname, "..", "subagent-only", "run-manifest.ts")).href;
  const [majeur] = process.versions.node.split(".").map(Number);
  const depart = join(runs + ".depart");
  const script = (n: number) =>
    `import { openRun } from ${JSON.stringify(module)};\n` +
    `import { existsSync, writeFileSync } from "node:fs";\n` +
    `writeFileSync(${JSON.stringify(depart + "-pret-" + n)}, "");\n` +
    `while (!existsSync(${JSON.stringify(depart)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);\n` +
    `try { openRun(${JSON.stringify(runs)}); process.stdout.write("ouvert"); }\n` +
    `catch (e) { process.stdout.write("refus " + (e && e.constructor ? e.constructor.name : "?") + " " + (e && e.message)); }\n`;
  const enfants = [1, 2].map((n) => new Promise<string>((resolve) => {
    const p = spawn(process.execPath, [
      ...(majeur < 23 ? ["--experimental-strip-types"] : []),
      "--no-warnings", "--input-type=module", "-e", script(n),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("close", () => resolve(out));
  }));
  const limite = Date.now() + 20_000;
  while (!(existsSync(depart + "-pret-1") && existsSync(depart + "-pret-2")) && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 5));
  }
  writeFileSync(depart, "");
  return Promise.all(enfants);
}

regressionCorrigee("P3-R11", "deux ouvertures concurrentes d'un espace neuf publient un seul marqueur complet", async () => {
  for (let i = 0; i < 5; i++) {
    const m = monde();
    const verdicts = await ouverturesConcurrentes(m.runs);
    propriete(verdicts.every((v) => v === "ouvert"), `tour ${i} : les deux ouvertures aboutissent (${verdicts.join(" | ")})`);
    propriete(marqueurPose(m.runs), `tour ${i} : un seul marqueur, complet`);
  }
});

// ── K-R12 : le préflight refuse avant toute écriture ────────────────────────────────────────────

regressionCorrigee("P3-R12", "le préflight refuse un marqueur invalide et dit pourquoi, sans rien écrire", () => {
  const m = monde();
  mkdirSync(join(m.runs, ".git"), { recursive: true });
  writeFileSync(join(m.runs, ".git", "HEAD"), "ref: refs/heads/registres\n");
  const avant = inventaire(m.runs);
  const r = instrumentationIgnored(m.root, RUNS);
  propriete(!r.ok, "un marqueur sans objects ni refs est refusé par le préflight");
  if (!r.ok) propriete(/marqueur/.test(r.reason), `la raison nomme le marqueur : ${r.reason}`);
  propriete(JSON.stringify(inventaire(m.runs)) === JSON.stringify(avant), "le préflight n'écrit rien");
});

// ── K-R13, K-R14 : ce qui ne change pas ─────────────────────────────────────────────────────────

preservation("P3-R13", "l'ouverture d'un run ne lance aucun processus git de plus", () => {
  const m = monde();
  const avant = readGitInvocationCount();
  openRun(m.runs);
  propriete(readGitInvocationCount() === avant, "compteur d'invocations git inchangé par openRun");
});

/**
 * Les lecteurs du § 5.1 du plan. `empreinte.ts` (parcours récursif), `bin/run-cost`,
 * `bin/subagent-trace` et `bin/subagent-shadow` sont exécutés ici, avec et sans marqueur. Les deux
 * lecteurs de `extensions/subagent/index.ts` (l. 1917, `readdirSync` d'un sous-dossier de preuves ;
 * l. 2569, filtre `<runId>-` + `.json`) ne s'exécutent pas sans charger l'extension : leur
 * indifférence est établie à la lecture, et déclarée comme telle.
 */
preservation("P3-R14", "le marqueur reste stable d'une ouverture à l'autre, et les lecteurs des runs l'ignorent", () => {
  const m = monde();
  // Contenu, inode et date de modification de chaque entrée du marqueur : une réécriture à
  // l'identique se verrait aussi.
  const cliche = () => [...inventaire(join(m.runs, ".git")), ...readdirSync(join(m.runs, ".git")).sort().map((n) => {
    const st = lstatSync(join(m.runs, ".git", n));
    return `${n} ino ${st.ino} mtime ${st.mtimeMs}`;
  })];
  openRun(m.runs);
  const marqueur1 = cliche();
  const ouvert = openRun(m.runs);
  const marqueur2 = cliche();
  propriete(marqueur1.length > 0 && JSON.stringify(marqueur1) === JSON.stringify(marqueur2), "le marqueur n'est pas réécrit par une seconde ouverture");
  peupler(m.runs, ouvert.manifest.runId);
  const e1 = JSON.stringify(prendreEmpreinte(m.root, m.runs));
  propriete(typeof e1 === "string" && e1.length > 2, "l'empreinte de l'espace se calcule avec le marqueur présent");
  // Un monde jumeau, même contenu, sans marqueur : chaque lecteur doit rendre la même chose.
  // `subagent-trace` ordonne les registres par date de modification : des dates distinctes, fixées ici
  // puis conservées par la copie, rendent cet ordre déterministe dans les deux mondes.
  readdirSync(m.runs).filter((n) => n.endsWith(".jsonl")).sort().forEach((n, i) => {
    utimesSync(join(m.runs, n), 1_700_000_000 + i, 1_700_000_000 + i);
  });
  const jumeau = monde();
  cpSync(m.runs, jumeau.runs, { recursive: true, preserveTimestamps: true, filter: (src) => !src.split("/").includes(".git") });
  precondition(!existsSync(join(jumeau.runs, ".git")) && existsSync(join(m.runs, ".git")), "seul le marqueur distingue les deux mondes");
  const lire = (w: { root: string; runs: string }, outil: string, args: string[]) => {
    const r = spawnSync("python3", ["-I", "-B", join(import.meta.dirname, "..", "bin", outil), ...args], { cwd: w.root, encoding: "utf-8" });
    return `${r.status}\n${r.stdout.split(w.root).join("<R>")}\n${r.stderr.split(w.root).join("<R>")}`;
  };
  for (const [outil, args] of [["subagent-trace", ["--all"]], ["subagent-trace", [ouvert.manifest.runId]], ["subagent-shadow", [ouvert.manifest.runId]]] as Array<[string, string[]]>) {
    propriete(lire(m, outil, args) === lire(jumeau, outil, args), `${outil} ${args.join(" ")} rend la même chose avec et sans marqueur`);
  }
  const cout = (w: { runs: string }) => execFileSync("python3", ["-I", "-B", "-c", [
    "import importlib.machinery, importlib.util, sys",
    `l = importlib.machinery.SourceFileLoader("run_cost", ${JSON.stringify(join(import.meta.dirname, "..", "bin", "run-cost"))})`,
    "s = importlib.util.spec_from_loader('run_cost', l); m = importlib.util.module_from_spec(s); l.exec_module(m)",
    `print(",".join(m.runs_du_dossier(${JSON.stringify(w.runs)})))`,
  ].join("\n")], { encoding: "utf-8" }).trim();
  const c = cout(m);
  propriete(c === cout(jumeau) && c.split(",").includes(ouvert.manifest.runId), `run-cost lit les mêmes runs avec et sans marqueur : ${c}`);
  propriete(!c.split(",").some((id) => id.startsWith(".")), "aucun identifiant tiré du marqueur");
});
