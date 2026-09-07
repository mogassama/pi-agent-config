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
import { join } from "node:path";

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

/**
 * Ce qui compte comme un lancement de git dans une source.
 *
 * Les guillemets simples et `execFile` manquaient : `execFileSync('git', args)`
 * passait entièrement sous le radar — `vus` restait à onze et `manquants` restait
 * vide, donc le test restait vert en ne regardant rien. Un détecteur qui rate
 * une feuille est pire qu'aucun détecteur, puisqu'il fait croire à une
 * couverture.
 *
 * `(["'])` puis `\\2` : le guillemet fermant doit être le même que l'ouvrant, sans
 * quoi `"git'` passerait.
 *
 * Un écart assumé par rapport au correctif demandé : `git` peut être suivi du
 * guillemet **ou d'un espace**, parce qu'`execSync` prend une ligne de commande
 * entière — `execSync("git status")` est un lancement de git au même titre, et la
 * forme exacte l'aurait raté comme elle ratait les guillemets simples. Aucun
 * `execSync` n'existe aujourd'hui dans le dépôt ; c'est le lanceur de demain que
 * ça couvre.
 */
const LANCEUR = /\b(execFileSync|execFile|spawnSync|spawn|execSync)\(\s*(["'])git(?:\2|\s)/;

/** Le détecteur d'avant le correctif, gardé pour montrer ce qu'il ratait. */
const LANCEUR_AVANT = /(execFileSync|spawnSync|execSync|spawn)\(\s*"git"/;

test("le détecteur voit les guillemets simples et execFile", () => {
  const formes = [
    'execFileSync("git", args, opts);',
    "execFileSync('git', args, opts);",
    'execFile("git", args, cb);',
    "execFile('git', args, cb);",
    'spawnSync("git", args);',
    "spawn('git', args);",
    'execSync("git status");',
    '  recordGitInvocation();\n  return execFileSync( "git", args);',
    // Réparti sur plusieurs lignes : invisible tant que le motif s'appliquait
    // ligne à ligne.
    'execFileSync(\n  "git",\n  args,\n);',
    "execFileSync(\n  'git',\n  args,\n);",
  ];
  for (const forme of formes) {
    assert.ok(LANCEUR.test(forme), `non détecté : ${forme}`);
  }

  // Ce que l'ancien ratait, et qui motive le correctif.
  assert.equal(LANCEUR_AVANT.test("execFileSync('git', args, opts);"), false);
  assert.equal(LANCEUR_AVANT.test('execFile("git", args, cb);'), false);

  // Ce qu'aucun des deux ne voit, et qui est assumé : le nom de l'exécutable
  // passé par une variable. Un test sur du texte ne suit pas une liaison.
  assert.equal(LANCEUR.test('const executable = "git";\nexecFileSync(executable, args);'), false);

  // Et ce qui ne doit pas déclencher : une mention en commentaire ou en chaîne.
  assert.equal(LANCEUR.test('// on lance ensuite execFileSync avec "git"'), false);
  assert.equal(LANCEUR.test('const message = "git a échoué";'), false);
});

test("tout lanceur git de production incrémente le compteur", () => {
  /*
   * L'oracle prouve que la fenêtre de reconstruction est exactement couverte. Il
   * ne peut rien dire des lanceurs qu'aucune fenêtre ne traverse — `baseCommit`,
   * `gitDiffFor`, le statut du footer, les deux de l'outil de reprise : retirer
   * leur incrément ne ferait échouer aucune mesure, parce qu'aucune mesure ne
   * passe par eux.
   *
   * Ce test-ci les couvre, et couvre surtout le vrai risque : un lanceur ajouté
   * plus tard, sur un chemin qui deviendra un jour un chemin d'observation. La
   * règle « tout lanceur de production incrémente » est inconditionnelle, donc
   * elle vit dans le code plutôt qu'en prose.
   *
   * Il lit du texte, ce qui est un aveu : il ne prouve pas que l'incrément est
   * atteint, seulement qu'il est écrit au bon endroit. C'est l'oracle qui prouve
   * l'atteinte, là où une fenêtre existe. Les deux ensemble, pas l'un ou l'autre.
   */
  const manquants: string[] = [];
  let vus = 0;

  for (const fichier of sourcesDeProduction()) {
    if (fichier.endsWith("git-probe-counter.ts")) continue;
    /*
     * Sur la source entière, pas ligne à ligne.
     *
     * Appliqué par ligne, le motif ne voyait pas un appel réparti sur plusieurs
     * lignes — `execFileSync(\n  "git",\n  args,\n);`. Le total restait à onze et
     * le test passait : exactement la fausse preuve qu'il existe pour empêcher.
     * Le `\s*` du motif traverse déjà les retours à la ligne ; c'est le découpage
     * qui l'en empêchait.
     */
    const source = readFileSync(fichier, "utf-8");
    const lignes = source.split("\n");
    for (const trouve of source.matchAll(new RegExp(LANCEUR.source, "g"))) {
      const i = source.slice(0, trouve.index).split("\n").length - 1;
      vus += 1;
      // Trois lignes de marge : l'incrément se place juste avant le lancement,
      // et un appel peut être précédé d'un commentaire ou d'une accolade.
      const avant = lignes.slice(Math.max(0, i - 3), i).join("\n");
      if (!avant.includes("recordGitInvocation()")) {
        manquants.push(`${fichier.split("/").slice(-2).join("/")}:${i + 1}`);
      }
    }
  }

  assert.deepEqual(manquants, [], "des lanceurs git de production n'incrémentent pas");
  assert.equal(vus, 11, "onze feuilles connues — un écart veut dire qu'il en est apparu une");
});
