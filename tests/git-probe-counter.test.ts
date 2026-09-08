/**
 * git-probe-counter.test.ts — compter des invocations, pas des appels de helper.
 *
 * Le piège de ce lot est qu'un compteur se teste trop facilement avec lui-même :
 * incrémenter puis relire prouve l'addition, pas la couverture. Le test qui
 * compte est donc l'**oracle externe** — un `git` de substitution en tête de
 * `PATH` qui journalise chaque lancement avant de déléguer au vrai. Le nombre de
 * lignes journalisées et le delta du compteur doivent être le même nombre.
 *
 * Il attrape ce qu'aucune relecture du compteur n'attrape : un lanceur oublié,
 * un lanceur ajouté plus tard sans incrément, et un incrément placé sur un
 * chemin qui ne lance rien.
 *
 * `PATH` est modifié pendant ces tests. `node --test` isole chaque fichier dans
 * son processus, et les tests d'un même fichier s'exécutent l'un après l'autre :
 * la substitution ne déborde pas.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { readGitInvocationCount, recordGitInvocation } from "../subagent-only/git-probe-counter.ts";
import { observeLanes } from "../subagent-only/lane-observe.ts";
import { observeIntegrations } from "../subagent-only/integration-observe.ts";
import { ensureLane } from "../subagent-only/worktree.ts";
import { integrationsDir } from "../subagent-only/integration.ts";
import { treeState } from "../subagent-only/tree.ts";
import { instrumentationIgnored } from "../subagent-only/repo-preflight.ts";
import { LANE_LEDGER_VERSION } from "../subagent-only/run-manifest.ts";

const RUNS = ".pi-subagent-runs";
const RUN_ID = "0123456789abcdef";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/**
 * Un dépôt avec une lane ouverte et un contexte d'intégration présent.
 *
 * Les trois lanceurs qu'une reconstruction emprunte doivent tous avoir de quoi
 * travailler : sans worktree de lane, sans branche de run et sans contexte,
 * l'oracle vaudrait zéro contre zéro et passerait quoi qu'on retire.
 */
function depot(avecExclusion = true): { root: string; done: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-probe-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  if (avecExclusion) writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  ensureLane(root, `${RUN_ID}-W03`);
  mkdirSync(join(root, RUNS), { recursive: true });

  const contexte = join(integrationsDir(root), `${RUN_ID}-W03-1`);
  mkdirSync(integrationsDir(root), { recursive: true });
  git(root, "worktree", "add", "--detach", "-q", contexte, "HEAD");

  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

const lectureVide = {
  events: [],
  malformedLines: [] as number[],
  version: LANE_LEDGER_VERSION,
};

/**
 * Exécuter sous un `git` qui se journalise, et rendre les deux comptes.
 *
 * Le vrai chemin de git est résolu **avant** la substitution : le shim s'appelle
 * `git` lui-même, et le résoudre après aurait produit une récursion.
 */
function sousOracle<T>(fn: () => T): { valeur: T; lancements: number; delta: number } {
  const vrai = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).trim();
  const dir = mkdtempSync(join(tmpdir(), "pi-shim-"));
  const journal = join(dir, "invocations.log");
  writeFileSync(join(dir, "git"), `#!/bin/sh\necho . >> "${journal}"\nexec "${vrai}" "$@"\n`, {
    mode: 0o755,
  });

  const pathAvant = process.env.PATH;
  process.env.PATH = `${dir}:${pathAvant ?? ""}`;
  const avant = readGitInvocationCount();
  try {
    const valeur = fn();
    const lancements = existsSync(journal)
      ? readFileSync(journal, "utf-8").split("\n").filter(Boolean).length
      : 0;
    return { valeur, lancements, delta: readGitInvocationCount() - avant };
  } finally {
    if (pathAvant === undefined) delete process.env.PATH;
    else process.env.PATH = pathAvant;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------- l'oracle

test("une reconstruction : autant d'invocations journalisées que comptées", () => {
  const d = depot();
  try {
    const { valeur, lancements, delta } = sousOracle(() => {
      const lanes = observeLanes({ root: d.root, runId: RUN_ID, laneRead: lectureVide });
      const tentatives = observeIntegrations({
        root: d.root,
        runDir: join(d.root, RUNS),
        runId: RUN_ID,
        laneRead: lectureVide,
      });
      return { lanes, tentatives };
    });

    assert.equal(valeur.lanes.usable, true);
    assert.equal(valeur.tentatives.usable, true);
    assert.ok(lancements > 0, "la reconstruction a bien lancé git");
    assert.equal(delta, lancements, "le compteur et l'oracle disent le même nombre");
  } finally {
    d.done();
  }
});

test("le contexte a bien été observé : sans lui, un lanceur ne serait pas couvert", () => {
  const d = depot();
  try {
    const { valeur } = sousOracle(() =>
      observeIntegrations({
        root: d.root,
        runDir: join(d.root, RUNS),
        runId: RUN_ID,
        laneRead: lectureVide,
      }),
    );
    assert.equal(valeur.usable, true);
    assert.deepEqual(
      valeur.usable ? valeur.snapshot.contexts : [],
      [`${RUN_ID}-W03-1`],
      "`ref()` d'integration-observe n'est atteint que s'il y a un contexte",
    );
  } finally {
    d.done();
  }
});

test("l'état de l'arbre : journalisé et compté pareil", () => {
  const d = depot();
  try {
    writeFileSync(join(d.root, "b.txt"), "b\n");
    const { lancements, delta } = sousOracle(() => treeState(d.root));
    assert.equal(lancements, 1);
    assert.equal(delta, 1);
  } finally {
    d.done();
  }
});

test("le préflight : journalisé et compté pareil", () => {
  const d = depot();
  try {
    const { valeur, lancements, delta } = sousOracle(() => instrumentationIgnored(d.root, RUNS));
    assert.equal(valeur.ok, true);
    assert.ok(lancements >= 2, "ls-files puis check-ignore");
    assert.equal(delta, lancements);
  } finally {
    d.done();
  }
});

// ------------------------------------------------------- ce que compte l'unité

test("une invocation qui sort en non-zéro compte quand même", () => {
  // Sans exclusion, `check-ignore` ne trouve rien et sort en 1. Le processus a
  // été lancé et payé : le code de sortie ne change rien à ce qu'il a coûté.
  const d = depot(false);
  try {
    const { valeur, lancements, delta } = sousOracle(() => instrumentationIgnored(d.root, RUNS));
    assert.equal(valeur.ok, false, "le préflight refuse, donc git a bien échoué");
    assert.ok(lancements > 0);
    assert.equal(delta, lancements);
  } finally {
    d.done();
  }
});

test("un lancement qui n'aboutit pas compte aussi : l'unité est l'invocation tentée", () => {
  /*
   * `cwd` inexistant : node échoue avant d'avoir un processus git, donc l'oracle
   * ne journalise rien. Le compteur, lui, incrémente — et c'est la définition
   * choisie, pas un défaut. Ce que la métrique doit dire est ce que le code a
   * demandé au système ; un helper qui tente et se rate a le même coût de
   * décision qu'un autre, et la borne haute est celle qu'on veut surveiller.
   *
   * L'écart est mesurable, donc il est écrit ici plutôt que sous-entendu.
   */
  const absent = join(tmpdir(), "pi-probe-inexistant-0123456789");
  assert.equal(existsSync(absent), false);
  const { lancements, delta } = sousOracle(() => treeState(absent));
  assert.equal(delta, 1, "une tentative, un incrément");
  assert.equal(lancements, 0, "et rien n'a tourné : l'oracle ne voit que les processus réels");
});

test("un helper qui en enveloppe un autre compte pour un", () => {
  const d = depot();
  try {
    /*
     * `openIntegrations` passe par `tryGit`, qui passe par `git`. Si les deux
     * incrémentaient, le compteur vaudrait le double de l'oracle — et c'est
     * exactement ce que ce test attrape, sans avoir à savoir lequel des deux a
     * été instrumenté.
     */
    const { lancements, delta } = sousOracle(() => integrationsDir(d.root));
    assert.equal(lancements, 1);
    assert.equal(delta, 1, "une invocation, un incrément");
  } finally {
    d.done();
  }
});

// ------------------------------------------------------------- les fenêtres

test("une invocation avant la fenêtre ne change pas son delta", () => {
  const d = depot();
  try {
    treeState(d.root); // hors fenêtre, et le compteur global bouge
    const global = readGitInvocationCount();

    const avant = readGitInvocationCount();
    treeState(d.root);
    const fenetre = readGitInvocationCount() - avant;

    assert.equal(fenetre, 1, "la fenêtre ne voit que ce qu'elle contient");
    assert.ok(readGitInvocationCount() > global, "le total, lui, a bien monté");
  } finally {
    d.done();
  }
});

test("deux fenêtres successives ont chacune leur compte, sans cumul", () => {
  const d = depot();
  try {
    const mesurer = <T,>(fn: () => T): number => {
      const avant = readGitInvocationCount();
      fn();
      return readGitInvocationCount() - avant;
    };
    const une = mesurer(() => observeLanes({ root: d.root, runId: RUN_ID, laneRead: lectureVide }));
    const deux = mesurer(() => observeLanes({ root: d.root, runId: RUN_ID, laneRead: lectureVide }));

    assert.ok(une > 0);
    assert.equal(deux, une, "la seconde ne porte pas la première");
  } finally {
    d.done();
  }
});

test("le compteur est monotone et n'expose aucune remise à zéro", async () => {
  const avant = readGitInvocationCount();
  recordGitInvocation();
  assert.equal(readGitInvocationCount(), avant + 1);

  const module = await import("../subagent-only/git-probe-counter.ts");
  assert.deepEqual(
    Object.keys(module).sort(),
    ["readGitInvocationCount", "recordGitInvocation"],
    "ni reset, ni setter : une fenêtre se mesure par différence",
  );
});

// ------------------------------------------------- la couverture, par le texte

/**
 * Les fichiers de production qui peuvent lancer git. Les tests sont exclus :
 * leurs propres appels à git montent des dépôts, ils ne sondent rien.
 */
function sourcesDeProduction(): string[] {
  const racine = join(import.meta.dirname, "..");
  const trouves: string[] = [];
  const marcher = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // Les répertoires cachés sont écartés en bloc : `.git`, mais aussi les
        // sauvegardes que l'installeur dépose sous `.backup-*`. Une copie de
        // l'état d'avant un lot n'est pas du code de production, et la scanner
        // aurait fait échouer ce test sur du code déjà remplacé.
        if (e.name.startsWith(".")) continue;
        if (["node_modules", "tests", "cache", "evidence"].includes(e.name)) continue;
        marcher(p);
        continue;
      }
      if (/\.(ts|mjs|js)$/.test(e.name) || dir.endsWith("/bin")) trouves.push(p);
    }
  };
  marcher(racine);
  return trouves;
}

/*
 * L'inventaire des lanceurs, en deux couches.
 *
 * La version précédente mélangeait les deux et affirmait « tout lanceur git de
 * production incrémente ». C'était faux — `pi.exec("git", …)` et
 * `pi.exec("bash", ["-lc", …])` lui échappaient entièrement — et un test qui
 * rate une feuille est pire qu'aucun test, puisqu'il fait croire à une
 * couverture.
 *
 *   couche 1   inventaire   tout lanceur reconnaissable est CLASSÉ
 *   couche 2   exactitude   seuls les sites du chemin de reconstruction
 *                           incrémentent, et l'oracle prouve qu'ils suffisent
 *
 * Trois classes :
 *
 *   counted-git        lance git ET appelle `recordGitInvocation()`
 *   outside-recovery   lance git sans incrément, déclaré hors de la fenêtre
 *   opaque-shell       lance un shell dont le contenu n'est pas analysé
 *
 * **Les noms de classe sont factuels.** La première s'est d'abord appelée
 * `recovery-git`, ce qui affirmait qu'un site était atteignable depuis
 * `reconstruire()` — or `baseCommit`, `gitDiffFor`, `repo-preflight`, `tree` et le
 * `rev-parse` du verbe `discard` incrémentent tous sans jamais être dans une
 * fenêtre. La classification reproduisait, en plus étroit, le défaut de langage
 * qu'elle corrigeait. `counted-git` ne dit que ce qui est vérifiable : ce site
 * lance git et l'incrémente.
 *
 * **La classe se déduit du code, pas d'une étiquette redondante.** Un site qui
 * appelle `recordGitInvocation()` EST `counted-git` ; les deux autres classes
 * portent une annotation. Écrire `// git-launch: recovery-git` au-dessus d'un
 * incrément aurait créé deux sources de vérité qui peuvent diverger — l'étiquette
 * survivant au retrait de l'incrément. Ici, retirer l'incrément déclasse le site,
 * et le test tombe.
 *
 * Ce que ce test ne fait pas, et ne doit pas prétendre faire : suivre une
 * liaison de variable. `pi.exec("bash", ["-lc", cmd])` est déclaré opaque, pas
 * analysé. L'invariant tenu est donc : aucun lanceur statiquement reconnaissable
 * n'est non classé, et aucun shell opaque ne vit dans le chemin de reconstruction.
 */
const LANCEUR_GIT =
  /\b(execFileSync|execFile|spawnSync|spawn|execSync)\(\s*(["'])git(?:\2|\s)|\bpi\.exec\(\s*(["'])git\3/;
const SHELL_OPAQUE = /\bpi\.exec\(\s*(["'])(bash|sh|zsh)\1|\b(execFileSync|execSync|spawnSync)\(\s*(["'])(bash|sh|zsh)\4/;

/** Les modules qu'une reconstruction peut traverser synchroniquement. */
const SURFACE_RECONSTRUCTION = ["subagent-only/", "extensions/subagent/", "bin/"];

const RACINE_SOURCES = join(import.meta.dirname, "..");

/**
 * Le chemin complet depuis la racine, jamais tronqué.
 *
 * Il l'était : `split("/").slice(-2)` rendait `subagent/index.ts` pour
 * `extensions/subagent/index.ts`, si bien qu'aucun préfixe de surface ne
 * correspondait plus. La garde du shell opaque était donc aveugle à tout
 * `extensions/subagent/`, et ma propre mutation ne l'avait pas vu parce qu'elle
 * ne portait que sur `subagent-only/`.
 */
function cheminRelatif(fichier: string): string {
  return relative(RACINE_SOURCES, fichier).split(sep).join("/");
}

const dansSurfaceDeReconstruction = (fichier: string): boolean =>
  SURFACE_RECONSTRUCTION.some((prefixe) => fichier.startsWith(prefixe));

interface Site { fichier: string; ligne: number; classe: string }

function inventaire(): Site[] {
  const sites: Site[] = [];
  for (const fichier of sourcesDeProduction()) {
    if (fichier.endsWith("git-probe-counter.ts")) continue;
    const source = readFileSync(fichier, "utf-8");
    const lignes = source.split("\n");
    const releve = (motif: RegExp, genre: string) => {
      for (const trouve of source.matchAll(new RegExp(motif.source, "g"))) {
        const i = source.slice(0, trouve.index).split("\n").length - 1;
        const avant = lignes.slice(Math.max(0, i - 6), i).join("\n");
        let classe = "NON CLASSÉ";
        if (genre === "git" && avant.includes("recordGitInvocation()")) classe = "counted-git";
        else if (avant.includes("// git-launch: outside-recovery")) classe = "outside-recovery";
        else if (avant.includes("// git-launch: opaque-shell")) classe = "opaque-shell";
        sites.push({ fichier: cheminRelatif(fichier), ligne: i + 1, classe });
      }
    };
    releve(LANCEUR_GIT, "git");
    releve(SHELL_OPAQUE, "shell");
  }
  return sites;
}

test("le détecteur voit les guillemets simples, execFile, pi.exec et le multiligne", () => {
  const formes = [
    'execFileSync("git", args, opts);',
    "execFileSync('git', args, opts);",
    'execFile("git", args, cb);',
    'spawnSync("git", args);',
    "spawn('git', args);",
    'execSync("git status");',
    'execFileSync(\n  "git",\n  args,\n);',
    'await pi.exec("git", ["branch", "--show-current"], {',
    "await pi.exec('git', ['status']);",
  ];
  for (const forme of formes) assert.ok(LANCEUR_GIT.test(forme), `non détecté : ${forme}`);

  const shells = [
    'await pi.exec("bash", ["-lc", cmd], { timeout });',
    "await pi.exec('sh', ['-c', `command -v ${name}`]);",
    'execFileSync("bash", ["-lc", cmd]);',
  ];
  for (const forme of shells) assert.ok(SHELL_OPAQUE.test(forme), `shell non détecté : ${forme}`);

  // Ce qu'aucun motif ne voit, et qui est assumé : l'exécutable ou la commande
  // passés par une variable. Un test textuel ne suit pas une liaison.
  assert.equal(LANCEUR_GIT.test('const exe = "git";\nexecFileSync(exe, args);'), false);
  // Et ce qui ne doit pas déclencher.
  assert.equal(LANCEUR_GIT.test('// on lance ensuite execFileSync avec "git"'), false);
  assert.equal(LANCEUR_GIT.test('const message = "git a échoué";'), false);
  assert.equal(SHELL_OPAQUE.test('await pi.exec("python3", ["-c", script]);'), false);
});

// ------------------------------------------------------ couche 1 : inventaire

test("aucun lanceur reconnaissable n'échappe à une classe", () => {
  const nonClasses = inventaire()
    .filter((s) => s.classe === "NON CLASSÉ")
    .map((s) => `${s.fichier}:${s.ligne}`);
  assert.deepEqual(
    nonClasses,
    [],
    "un lanceur git ou un shell opaque n'est pas classé : ajouter `recordGitInvocation()` " +
      "s'il est dans le chemin de reconstruction, sinon `// git-launch: outside-recovery` " +
      "ou `// git-launch: opaque-shell`",
  );
});

test("l'inventaire est celui qu'on croit : un lanceur ajouté le fait bouger", () => {
  const parClasse = new Map<string, number>();
  for (const s of inventaire()) parClasse.set(s.classe, (parClasse.get(s.classe) ?? 0) + 1);
  assert.deepEqual(
    [...parClasse.entries()].sort(),
    [["counted-git", 10], ["opaque-shell", 3], ["outside-recovery", 2]],
    "l'inventaire a changé — classer le nouveau site plutôt que d'ajuster ce compte",
  );
});

// ------------------------------------------------------ couche 2 : exactitude

test("dans la surface de reconstruction, tout lanceur est compté", () => {
  /*
   * L'invariant, dans sa forme honnête : tout lanceur direct présent dans la
   * surface de reconstruction est compté ; aucun lanceur non compté ni shell
   * opaque n'y est admis.
   *
   * L'interdit du shell opaque est ce qui rend l'inventaire utile — un shell
   * appelé pendant une reconstruction lancerait git sans qu'on puisse ni le
   * compter ni le prouver, et le contrat deviendrait invérifiable. La formulation
   * précédente ne visait que lui ; celle-ci couvre aussi le lanceur direct qu'on
   * aurait oublié d'instrumenter.
   */
  const intrus = inventaire()
    .filter((s) => dansSurfaceDeReconstruction(s.fichier))
    .filter((s) => s.classe !== "counted-git")
    .map((s) => `${s.fichier}:${s.ligne} (${s.classe})`);
  assert.deepEqual(
    intrus,
    [],
    "un lanceur non compté ou un shell opaque vit dans la surface de reconstruction",
  );
});

test("un site hors reconstruction n'incrémente pas", () => {
  /*
   * L'inverse de la garde précédente. Un incrément posé hors fenêtre ne fausse
   * rien aujourd'hui — la synchronie l'empêche de s'intercaler — mais il ferait
   * du compteur un total approximatif au lieu d'une mesure de fenêtre, et c'est
   * précisément la confusion que le contrat corrigé écarte.
   */
  const fautifs: string[] = [];
  for (const fichier of sourcesDeProduction()) {
    if (fichier.endsWith("git-probe-counter.ts")) continue;
    const source = readFileSync(fichier, "utf-8");
    const lignes = source.split("\n");
    for (const trouve of source.matchAll(new RegExp(LANCEUR_GIT.source, "g"))) {
      const i = source.slice(0, trouve.index).split("\n").length - 1;
      const avant = lignes.slice(Math.max(0, i - 6), i).join("\n");
      if (avant.includes("// git-launch: outside-recovery") && avant.includes("recordGitInvocation()")) {
        fautifs.push(`${cheminRelatif(fichier)}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(fautifs, [], "un site déclaré hors reconstruction incrémente quand même");
});
