/**
 * Le trajet d'`execute`, éprouvé là où les tests de module ne voient rien.
 *
 * Cette phase a trouvé deux barrières mal placées qu'aucun test de module ne
 * pouvait attraper : `HISTORY.push` écrit avant la barrière du lot, et une
 * barrière qui interrogeait le bail courant de la session au lieu de celui
 * capturé avant le spawn. Les deux vivaient dans l'ordre des instructions
 * d'`execute`, pas dans les contrats des modules.
 *
 * Le harnais substitue les trois dépendances externes — l'API de pi, typebox,
 * et le dispatch qui lance des processus — et rien d'autre. Le plan, le
 * manifeste, le bail, les worktrees et git sont réels. Si la substitution
 * échoue, le chargement échoue et le test est rouge : aucun saut conditionnel,
 * parce qu'un test de câblage qui se saute est un test vert qui ne vérifie rien.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APPELS, PILOTE, reinitialiser } from "./stubs/dispatch.ts";
import {
  acquireRunOwnership,
  appendLaneEvent,
  readManifest,
  releaseRunOwnership,
  type Lease,
} from "../subagent-only/run-manifest.ts";

const RUNS = ".pi-subagent-runs";
/** Le dépôt lui-même sert de `PI_AGENT_DIR` : c'est là que vivent les agents. */
const REPO = join(import.meta.dirname, "..");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/**
 * Ce qu'une commande de pi reçoit, réduit à ce que l'extension en utilise.
 *
 * Le harnais n'appelait aucune commande : `registerCommand` manquait au faux
 * `pi`, et une extension qui en enregistre une plantait au chargement sans
 * qu'aucun test ne le dise. Ce qui est enregistré doit être appelable, sinon le
 * câblage n'est prouvé par rien.
 */
type CommandHandler = (
  args: unknown,
  ctx: { ui: { notify: (t: string, k?: string) => void } },
) => Promise<void> | void;

const PLAN = {
  version: 1,
  work_units: [
    { id: "W03", goal: "faire W03", depends_on: [], expected_write_scope: ["src/a.py"] },
    { id: "W09", goal: "faire W09", depends_on: [], expected_write_scope: ["src/b.py"] },
  ],
};

/**
 * Un dépôt, un plan gelé, et une instance fraîche de l'extension.
 *
 * `index.ts` lit `process.cwd()` au chargement pour situer le run : le
 * répertoire courant change donc avant l'import, et chaque scénario importe
 * l'extension sous une URL distincte pour ne pas hériter de l'état du
 * précédent.
 */
let compteur = 0;
/**
 * Recharger l'extension sur un dépôt qui existe déjà.
 *
 * Un nouveau `?scenario=` donne une instance de module neuve : `ATTEMPTS`,
 * `HISTORY` et le reste repartent vides, exactement comme après un redémarrage
 * de pi. Le disque, lui, n'a pas bougé.
 */
async function remonter(root: string, avecPlan: boolean) {
  const avant = process.cwd();
  const agentAvant = process.env.PI_AGENT_DIR;
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  /*
   * La racine du harnais doit être le chemin **résolu**.
   *
   * Sur macOS, `/var` est un lien vers `/private/var` : `mkdtempSync` rend le
   * chemin non résolu, `process.chdir` puis `process.cwd` rendent le résolu, et
   * git aussi. Le runtime, lui, a raison de partir de `process.cwd()`. C'est
   * donc la racine du test qui doit être canonique, sans quoi cinq tests
   * échouent plus loin sur un diff illisible où les deux chemins se ressemblent.
   *
   * Vérifié ici, une fois, au lieu d'être découvert cinq fois en aval. Se
   * reproduit sur Linux avec un `TMPDIR` qui est un lien symbolique.
   */
  assert.equal(root, process.cwd(), "la racine du harnais n'est pas le chemin résolu");
  reinitialiser();

  compteur += 1;
  const module = await import(`../extensions/subagent/index.ts?scenario=${compteur}`);
  let outil: {
    execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown>;
    promptGuidelines?: string[];
  } | undefined;
  const evenements = new Map<string, (...a: unknown[]) => unknown>();
  const commandes = new Map<string, CommandHandler>();
  module.default({
    on: (nom: string, h: (...a: unknown[]) => unknown) => evenements.set(nom, h),
    registerTool: (t: unknown) => { outil = t as typeof outil; },
    registerCommand: (nom: string, c: { handler: CommandHandler }) => commandes.set(nom, c.handler),
    ui: { setStatus: () => {}, setFooter: () => {} },
  });

  const manifeste = readManifest(join(root, RUNS));
  if (avecPlan && manifeste) {
    mkdirSync(join(root, RUNS), { recursive: true });
    writeFileSync(join(root, RUNS, `${manifeste.runId}-plan.json`), JSON.stringify(PLAN));
  }
  return {
    root,
    runDir: join(root, RUNS),
    runId: manifeste?.runId ?? "",
    outil: outil!,
    evenement: (nom: string) => evenements.get(nom),
    commande: (nom: string) => commandes.get(nom),
    done: () => {
      process.chdir(avant);
      if (agentAvant === undefined) delete process.env.PI_AGENT_DIR;
      else process.env.PI_AGENT_DIR = agentAvant;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function monter(options: {
  avecPlan?: boolean;
  ignoreInstrumentation?: boolean;
  /**
   * Reprendre un dépôt existant plutôt que d'en créer un.
   *
   * C'est le redémarrage : le disque survit, l'état module meurt. Sans ça, un
   * registre durable pourrait être parfait et `ATTEMPTS` continuer de ne jamais
   * le relire — le seul test qui prouve la reconstruction est celui qui perd la
   * mémoire pour de bon.
   */
  reprendre?: string;
} = {}) {
  const avecPlan = options.avecPlan ?? true;
  if (options.reprendre) return remonter(options.reprendre, avecPlan);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-exec-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  // L'instrumentation doit être ignorée, sinon le préflight refuse le run — et
  // il a raison : la racine resterait sale et aucune intégration ne partirait.
  // Ces dépôts ne l'ignoraient pas, et rien ne le disait.
  if (options.ignoreInstrumentation ?? true) {
    writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  const avant = process.cwd();
  const agentAvant = process.env.PI_AGENT_DIR;
  // L'extension lit ses définitions d'agents depuis `PI_AGENT_DIR` : le dépôt
  // lui-même les fournit, ce qui évite de dépendre du `~/.pi/agent` de la
  // machine et fait tourner le harnais partout de la même façon.
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  /*
   * La racine du harnais doit être le chemin **résolu**.
   *
   * Sur macOS, `/var` est un lien vers `/private/var` : `mkdtempSync` rend le
   * chemin non résolu, `process.chdir` puis `process.cwd` rendent le résolu, et
   * git aussi. Le runtime, lui, a raison de partir de `process.cwd()`. C'est
   * donc la racine du test qui doit être canonique, sans quoi cinq tests
   * échouent plus loin sur un diff illisible où les deux chemins se ressemblent.
   *
   * Vérifié ici, une fois, au lieu d'être découvert cinq fois en aval. Se
   * reproduit sur Linux avec un `TMPDIR` qui est un lien symbolique.
   */
  assert.equal(root, process.cwd(), "la racine du harnais n'est pas le chemin résolu");
  reinitialiser();

  compteur += 1;
  const module = await import(`../extensions/subagent/index.ts?scenario=${compteur}`);

  // Une API de pi qui ne fait que retenir ce qu'on lui donne.
  let outil: {
    execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown>;
    promptGuidelines?: string[];
  } | undefined;
  const evenements = new Map<string, (...a: unknown[]) => unknown>();
  const commandes = new Map<string, CommandHandler>();
  const pi = {
    on: (nom: string, h: (...a: unknown[]) => unknown) => evenements.set(nom, h),
    registerTool: (t: unknown) => {
      outil = t as typeof outil;
    },
    registerCommand: (nom: string, c: { handler: CommandHandler }) => commandes.set(nom, c.handler),
    ui: { setStatus: () => {}, setFooter: () => {} },
  };
  module.default(pi);

  // Le plan gelé, écrit là où le runtime le cherche. Omis pour les scénarios du
  // régime libre : sans plan, il n'y a ni unité, ni lane, ni `laneView`, et une
  // écriture inline de l'orchestrateur se juge sur `HISTORY` seul.
  const manifeste = readManifest(join(root, RUNS));
  if (avecPlan && manifeste) {
    mkdirSync(join(root, RUNS), { recursive: true });
    writeFileSync(join(root, RUNS, `${manifeste.runId}-plan.json`), JSON.stringify(PLAN));
  }

  return {
    root,
    runDir: join(root, RUNS),
    runId: manifeste?.runId ?? "",
    outil: outil!,
    evenement: (nom: string) => evenements.get(nom),
    commande: (nom: string) => commandes.get(nom),
    done: () => {
      process.chdir(avant);
      if (agentAvant === undefined) delete process.env.PI_AGENT_DIR;
      else process.env.PI_AGENT_DIR = agentAvant;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const tache = (unite: string) => ({
  agent: "worker",
  work_unit: unite,
  task: `écrire pour ${unite}`,
});
const texte = (r: unknown): string =>
  ((r as { content?: Array<{ text?: string }> })?.content ?? []).map((c) => c.text ?? "").join("");
const enErreur = (r: unknown): boolean => (r as { isError?: boolean })?.isError === true;
const lanes = (root: string): string[] => {
  const dir = join(root, ".git", "pi-lanes");
  return existsSync(dir)
    ? execFileSync("ls", [dir], { encoding: "utf-8" }).split("\n").filter(Boolean)
    : [];
};

// ------------------------------------------------------- run possédé ailleurs

/*
 * Le scénario que le refus doit garantir : rien n'est consommé.
 *
 * Pas seulement « la délégation est refusée », mais aucune séquence réservée,
 * aucun worktree ouvert, aucun enfant lancé. Ces trois-là ne se déduisent pas
 * du contrat des modules : ils dépendent de l'endroit exact où le refus est
 * posé dans `execute`.
 */
test("une session qui ne possède pas le run ne consomme rien", async () => {
  const h = await monter();
  try {
    // Une autre session tient le run.
    const autre = acquireRunOwnership(h.runDir, h.runId, "s-autre");
    assert.equal(autre.ok, true);

    const avant = readManifest(h.runDir)!.nextSeq;
    const r = await h.outil.execute("1", tache("W03"));

    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /LECTURE SEULE/);
    assert.equal(readManifest(h.runDir)!.nextSeq, avant, "aucune séquence réservée");
    assert.deepEqual(lanes(h.root), [], "aucun worktree");
    assert.deepEqual(APPELS, [], "aucun enfant lancé");
  } finally {
    h.done();
  }
});

test("un run libre laisse la délégation passer", async () => {
  const h = await monter();
  try {
    const r = await h.outil.execute("1", tache("W03"));
    assert.equal(enErreur(r), false, texte(r));
    assert.equal(readManifest(h.runDir)!.nextSeq, 2, "une séquence réservée");
    assert.deepEqual(APPELS.map((a) => a.seq), [1]);
    assert.deepEqual(lanes(h.root), [`${h.runId}-W03`]);
  } finally {
    h.done();
  }
});

// ------------------------------------------- propriété perdue pendant l'enfant

/*
 * L'annulation est au mieux rapide : un enfant peut revenir normalement juste
 * après la perte du bail. Ce qui suit — journal, registre, état de lane,
 * intégration — écrirait alors dans un run qu'une autre session a repris.
 */
test("un enfant revenu après la perte du bail ne déclenche aucune mutation", async () => {
  const h = await monter();
  try {
    // Pendant que « l'enfant tourne », le bail change de mains.
    PILOTE.pendant = () => {
      const bail = JSON.parse(
        execFileSync("cat", [join(h.runDir, `${h.runId}.lease`, "owner.json")], {
          encoding: "utf-8",
        }),
      ) as Lease;
      releaseRunOwnership(h.runDir, bail);
      acquireRunOwnership(h.runDir, h.runId, "s-autre");
    };

    const r = await h.outil.execute("1", tache("W03"));

    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /propriété perdue/);
    // L'enfant a bien tourné : c'est le propre de ce cas.
    assert.equal(APPELS.length, 1);
    // Mais rien n'a été journalisé.
    assert.equal(
      existsSync(join(h.runDir, `${h.runId}-delegations.jsonl`)),
      false,
      "aucune délégation journalisée",
    );
  } finally {
    h.done();
  }
});

/*
 * La barrière porte sur la capacité **capturée avant le spawn**, pas sur le
 * bail courant de la session.
 *
 * Sans ça, un enfant lancé sous L1 passerait parce que la session a depuis
 * acquis L2 — et toute la protection de capacité tomberait au moment précis où
 * elle doit tenir. C'est le défaut que cette phase a trouvé dans `stillOwns()`.
 */
test("un enfant de L1 ne passe pas la barrière parce que la session tient L2", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = () => {
      const bailL1 = JSON.parse(
        execFileSync("cat", [join(h.runDir, `${h.runId}.lease`, "owner.json")], {
          encoding: "utf-8",
        }),
      ) as Lease;
      // La même session relâche puis reprend : L2 est valide, L1 ne l'est plus.
      releaseRunOwnership(h.runDir, bailL1);
      const l2 = acquireRunOwnership(h.runDir, h.runId, bailL1.sessionId);
      assert.equal(l2.ok, true);
    };

    const r = await h.outil.execute("1", tache("W03"));

    assert.ok(enErreur(r), `la barrière a laissé passer un enfant de L1 : ${texte(r)}`);
    assert.match(texte(r), /propriété perdue/);
    assert.equal(
      existsSync(join(h.runDir, `${h.runId}-delegations.jsonl`)),
      false,
      "aucune délégation journalisée",
    );
  } finally {
    h.done();
  }
});

// ------------------------------------------------------------------- le lot

/*
 * Dans le lot, `HISTORY` et le journal sont écrits par le rappel de `runLanes`,
 * donc une barrière posée après le retour du lot arriverait trop tard. Ce cas
 * vérifie qu'elle est bien par enfant.
 */
test("dans un lot, la perte du bail arrête les mutations du premier enfant", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = (appel) => {
      if (!appel.task.includes("W03")) return;
      const bail = JSON.parse(
        execFileSync("cat", [join(h.runDir, `${h.runId}.lease`, "owner.json")], {
          encoding: "utf-8",
        }),
      ) as Lease;
      releaseRunOwnership(h.runDir, bail);
      acquireRunOwnership(h.runDir, h.runId, "s-autre");
    };

    const r = await h.outil.execute("1", {
      agent: "worker",
      batch: [
        { work_unit: "W03", task: "écrire pour W03" },
        { work_unit: "W09", task: "écrire pour W09" },
      ],
    });

    assert.ok(enErreur(r), texte(r));
    assert.equal(
      existsSync(join(h.runDir, `${h.runId}-delegations.jsonl`)),
      false,
      "aucune délégation journalisée après la perte",
    );
  } finally {
    h.done();
  }
});

/*
 * Le verrou périmé entre l'acquisition et l'ouverture de la lane.
 *
 * C'est le scénario que l'ordre `allocateSeq` → `openLane` existe pour
 * empêcher. `allocateSeq` est gardée par la capacité et par la clôture des
 * transitions ; `openLane` ne l'est pas. Dans l'ordre inverse, un verrou apparu
 * entre les deux laissait un worktree derrière lui sans qu'aucune séquence
 * n'ait été réservée ni aucun enfant lancé.
 */
test("un verrou périmé n'ouvre pas de worktree avant d'échouer", async () => {
  const h = await monter();
  try {
    // Une première délégation, qui prend le bail et réussit.
    await h.outil.execute("1", tache("W03"));
    const seqApres = readManifest(h.runDir)!.nextSeq;
    const lanesApres = lanes(h.root);

    // Un vestige de transition apparaît, plus vieux que le seuil.
    const verrou = join(h.runDir, `${h.runId}.guard`);
    mkdirSync(verrou, { recursive: true });
    const vieux = (Date.now() - 60_000) / 1000;
    utimesSync(verrou, vieux, vieux);

    const r = await h.outil.execute("2", tache("W09"));

    assert.ok(enErreur(r) || texte(r).length > 0, texte(r));
    assert.equal(readManifest(h.runDir)!.nextSeq, seqApres, "aucune séquence réservée");
    assert.deepEqual(lanes(h.root), lanesApres, "aucun worktree ouvert pour W09");
    assert.equal(APPELS.length, 1, "aucun second enfant");
  } finally {
    h.done();
  }
});

// ---------------------------------------------- reprise d'un run interrompu

/*
 * Le scénario que 3b.2 existe pour rendre possible.
 *
 * Une session ouvre une lane, meurt, une autre reprend. Elle doit retrouver la
 * lane comme sienne — même worktree, même possession — sans que rien ne soit
 * réparé en silence.
 */
test("une session reprise retrouve la lane ouverte par la précédente", async () => {
  const premier = await monter();
  let root: string;
  let runId: string;
  try {
    root = premier.root;
    runId = premier.runId;
    await premier.outil.execute("1", tache("W03"));
    assert.deepEqual(lanes(root), [`${runId}-W03`]);

    // Sortie propre : le bail disparaît, le run reste actif. C'est le chemin de
    // `/new`, `/resume` et de la fermeture ordinaire.
    await (premier.evenement("session_shutdown") as () => Promise<void>)();
    process.chdir(root);
  } finally {
    // On garde le dépôt : c'est lui que la seconde session reprend.
  }

  reinitialiser();
  compteur += 1;
  const module = await import(`../extensions/subagent/index.ts?scenario=${compteur}`);
  let outil2: { execute: (id: string, p: unknown) => Promise<unknown> } | undefined;
  module.default({
    on: () => {},
    registerTool: (t: unknown) => { outil2 = t as typeof outil2; },
    registerCommand: () => {},
    ui: { setStatus: () => {}, setFooter: () => {} },
  });

  try {
    // Le run est le même, et la lane de W03 est reconnue comme ouverte.
    const rd = join(root, RUNS);
    assert.equal(readManifest(rd)!.runId, runId, "le run doit être le même");

    // W09, qui ne recouvre pas W03, peut travailler : la reprise n'a rien cassé.
    const r = await outil2!.execute("1", tache("W09"));
    assert.equal(enErreur(r), false, texte(r));
    assert.deepEqual(lanes(root).sort(), [`${runId}-W03`, `${runId}-W09`]);
  } finally {
    premier.done();
  }
});

/*
 * Un worktree sans provenance au registre.
 *
 * C'est la fenêtre entre `git worktree add` et l'écriture de l'ouverture, et
 * l'ordre « effet d'abord, événement ensuite » la rend possible exprès. Elle
 * doit être nommée et refusée, pas adoptée en silence : l'orphelin ne possède
 * rien, donc il ne bloque rien, mais il est dit.
 */
/*
 * La contradiction est une porte du run, pas un état faible d'une WorkUnit.
 *
 * W09 est indépendante et son scope est disjoint. Elle est refusée quand même :
 * continuer sur elle ajouterait des faits à un run dont l'état précédent n'est
 * pas compris, et rendrait la récupération plus difficile. Une fois la
 * contradiction tranchée, elle passe.
 */
test("une contradiction ferme le run, et sa résolution le rouvre", async () => {
  const h = await monter();
  try {
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`,
      join(h.root, ".git", "pi-lanes", `${h.runId}-W03`), "HEAD"],
      { cwd: h.root, stdio: "ignore" });
    await (h.evenement("session_shutdown") as (() => Promise<void>) | undefined)?.();

    const nouvelle = async () => {
      reinitialiser();
      compteur += 1;
      const module = await import(`../extensions/subagent/index.ts?scenario=${compteur}`);
      let outil: { execute: (id: string, p: unknown) => Promise<unknown> } | undefined;
      module.default({
        on: () => {},
        registerTool: (t: unknown) => { outil = t as typeof outil; },
        registerCommand: () => {},
        ui: { setStatus: () => {}, setFooter: () => {} },
      });
      return outil!;
    };

    // W09 ne recouvre rien de W03, et elle est refusée quand même.
    const avant = readManifest(h.runDir)!.nextSeq;
    const bloque = await (await nouvelle()).execute("1", tache("W09"));
    assert.ok(enErreur(bloque));
    assert.match(texte(bloque), /reprise à trancher/);
    assert.match(texte(bloque), /W03/);
    assert.equal(readManifest(h.runDir)!.nextSeq, avant, "aucune séquence");
    assert.equal(existsSync(join(h.root, ".git", "pi-lanes", `${h.runId}-W09`)), false);
    assert.deepEqual(APPELS, [], "aucun enfant");

    // L'opérateur tranche, explicitement.
    execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
      ["W03", "adopt"], { cwd: h.root, stdio: "ignore" });

    // Et le run rouvre.
    const passe = await (await nouvelle()).execute("1", tache("W09"));
    assert.equal(enErreur(passe), false, texte(passe));
    assert.equal(APPELS.length, 1);
  } finally {
    h.done();
  }
});

test("un worktree orphelin est signalé, jamais adopté", async () => {
  const h = await monter();
  try {
    // Un worktree du run courant, créé hors de toute délégation.
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`,
      join(h.root, ".git", "pi-lanes", `${h.runId}-W03`), "HEAD"],
      { cwd: h.root, stdio: "ignore" });
    await (h.evenement("session_shutdown") as (() => Promise<void>) | undefined)?.();

    // Une nouvelle session le découvre.
    reinitialiser();
    compteur += 1;
    const module = await import(`../extensions/subagent/index.ts?scenario=${compteur}`);
    let outil2: { execute: (id: string, p: unknown) => Promise<unknown> } | undefined;
    module.default({
      on: () => {},
      registerTool: (t: unknown) => { outil2 = t as typeof outil2; },
      registerCommand: () => {},
      ui: { setStatus: () => {}, setFooter: () => {} },
    });

    const r = await outil2!.execute("1", tache("W09"));
    assert.match(texte(r), /worktree-orphelin/);
    assert.match(texte(r), /aucune n'est réparée automatiquement/);
  } finally {
    h.done();
  }
});

/*
 * L'ordre « effet d'abord, événement ensuite », éprouvé là où il compte.
 *
 * Dans le cas nominal les deux ordres donnent le même résultat : la différence
 * n'apparaît que si l'ouverture échoue. Ici `W..03` est un nom que git refuse
 * comme branche, donc `openLane` lève — et le registre ne doit contenir aucune
 * ouverture pour une lane qui n'a jamais existé.
 *
 * L'ordre inverse écrirait `OPENED W..03`, que la session suivante lirait comme
 * une lane disparue. Le registre affirmerait un fait qui n'a pas eu lieu, et
 * c'est précisément ce qu'on refuse : la réalité peut devancer le registre,
 * jamais l'inverse.
 */
test("une ouverture qui échoue ne laisse aucune trace au registre", async () => {
  const h = await monter();
  try {
    // Le plan doit connaître l'unité pour qu'on aille jusqu'à l'ouverture.
    writeFileSync(join(h.runDir, `${h.runId}-plan.json`), JSON.stringify({
      version: 1,
      work_units: [
        { id: "W..03", goal: "g", depends_on: [], expected_write_scope: ["src/a.py"] },
      ],
    }));

    const r = await h.outil.execute("1", tache("W..03"));
    assert.ok(enErreur(r), texte(r));

    const registre = join(h.runDir, `${h.runId}-lanes.jsonl`);
    const contenu = existsSync(registre) ? readFileSync(registre, "utf-8") : "";
    assert.equal(contenu.includes("W..03"), false,
      `le registre a enregistré une ouverture qui n'a pas eu lieu : ${contenu}`);
  } finally {
    h.done();
  }
});

/*
 * Le résidu sale, de bout en bout.
 *
 * Une unité intégrée dont le worktree porte encore des changements ne peut pas
 * être tenue pour terminée : la traiter ainsi libérerait son scope et
 * satisferait ses dépendantes pendant qu'un travail dort dans sa lane.
 */
test("un worktree sale après intégration ferme le run", async () => {
  const h = await monter();
  try {
    // Une lane intégrée, dont le worktree survit avec des modifications.
    const baseAvant = execFileSync("git", ["rev-parse", "HEAD"],
      { cwd: h.root, encoding: "utf-8" }).trim();
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`, laneDir, "HEAD"],
      { cwd: h.root, stdio: "ignore" });
    writeFileSync(join(laneDir, "src", "a.py"), "a = intégré\n");
    execFileSync("git", ["add", "-A"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "W03"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["merge", "--no-ff", "-m", "merge", `pi-lane/${h.runId}-W03`],
      { cwd: h.root, stdio: "ignore" });
    // Du travail postérieur, resté dans la lane.
    writeFileSync(join(laneDir, "src", "a.py"), "a = et puis autre chose\n");

    // Le registre dit intégrée, avec la base de la lane : sans elle, git ne peut
    // pas confirmer l'intégration et la contradiction serait tout autre.
    const bail = acquireRunOwnership(h.runDir, h.runId, "s-poseur");
    appendLaneEvent(h.runDir,
      { event: "OPENED", work_unit: "W03", at: new Date().toISOString(), base: baseAvant },
      (bail as { lease: Lease }).lease);
    appendLaneEvent(h.runDir,
      { event: "INTEGRATED", work_unit: "W03", at: new Date().toISOString() },
      (bail as { lease: Lease }).lease);
    releaseRunOwnership(h.runDir, (bail as { lease: Lease }).lease);

    reinitialiser();
    compteur += 1;
    const module = await import(`../extensions/subagent/index.ts?scenario=${compteur}`);
    let outil: { execute: (id: string, p: unknown) => Promise<unknown> } | undefined;
    module.default({
      on: () => {},
      registerTool: (t: unknown) => { outil = t as typeof outil; },
      registerCommand: () => {},
      ui: { setStatus: () => {}, setFooter: () => {} },
    });

    const r = await outil!.execute("1", tache("W09"));
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /residu-sale/);
    assert.deepEqual(APPELS, []);
  } finally {
    h.done();
  }
});

/*
 * Une ligne illisible au registre ferme le run.
 *
 * La compter sans bloquer revenait à la sauter : une réconciliation qui « ne
 * trouve aucun conflit » sur un registre amputé n'a rien vérifié, elle a
 * seulement regardé ce qui restait lisible.
 */
test("un registre illisible ferme le run", async () => {
  const h = await monter();
  try {
    writeFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ ledger: 1 })}\n{ceci n'est pas du json\n`);

    const r = await h.outil.execute("1", tache("W03"));
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /registre illisible/);
    assert.match(texte(r), /ne prouve rien/);
    assert.deepEqual(APPELS, []);
    assert.equal(readManifest(h.runDir)!.nextSeq, 1);
  } finally {
    h.done();
  }
});

/*
 * La reprise est recalculée à chaque délégation.
 *
 * `bin/subagent-recover` est un processus externe : une résolution faite au
 * terminal pendant que pi tourne serait restée invisible jusqu'au redémarrage,
 * et le run aurait continué de refuser sans raison.
 */
test("une résolution externe débloque la session en cours", async () => {
  const h = await monter();
  try {
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`,
      join(h.root, ".git", "pi-lanes", `${h.runId}-W03`), "HEAD"],
      { cwd: h.root, stdio: "ignore" });

    // La même instance de l'extension, sans redémarrage.
    const bloque = await h.outil.execute("1", tache("W09"));
    assert.ok(enErreur(bloque));
    assert.match(texte(bloque), /reprise à trancher/);

    execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
      ["W03", "adopt"], { cwd: h.root, stdio: "ignore" });

    const passe = await h.outil.execute("2", tache("W09"));
    assert.equal(enErreur(passe), false, texte(passe));
  } finally {
    h.done();
  }
});

/*
 * Une branche du run dont le worktree a été retiré et que le registre ignore.
 *
 * Elle n'apparaît ni dans les événements ni dans les worktrees : sans une
 * observation directe des refs du run, elle reste invisible. C'est pourtant le
 * cas même d'un travail présent dans le dépôt dont le run ne sait rien.
 */
test("une branche sans provenance ferme le run", async () => {
  const h = await monter();
  try {
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`, laneDir, "HEAD"],
      { cwd: h.root, stdio: "ignore" });
    writeFileSync(join(laneDir, "src", "a.py"), "a = 2\n");
    execFileSync("git", ["add", "-A"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "W03"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["worktree", "remove", "--force", laneDir], { cwd: h.root, stdio: "ignore" });

    const r = await h.outil.execute("1", tache("W09"));
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /branche-sans-provenance/);
    assert.deepEqual(APPELS, []);
  } finally {
    h.done();
  }
});

/*
 * Une adoption doit tenir jusqu'au merge.
 *
 * Sans base, `adopt` réparait le conflit du jour en préparant celui du
 * lendemain : l'unité travaillait, était intégrée, et la réconciliation
 * suivante refusait de confirmer son intégration faute de pouvoir la prouver.
 * Le run se rebloquait sans cause visible.
 */
test("une lane adoptée peut travailler puis s'intégrer sans reconflit", async () => {
  const h = await monter();
  try {
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`, laneDir, "HEAD"],
      { cwd: h.root, stdio: "ignore" });

    execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
      ["W03", "adopt"], { cwd: h.root, stdio: "ignore" });

    // L'ouverture porte bien une base.
    const registre = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");
    const ouverture = JSON.parse(registre.split("\n")[1]);
    assert.equal(ouverture.event, "OPENED");
    assert.ok(ouverture.base, "l'adoption doit consigner une base");

    // La lane travaille, puis s'intègre.
    writeFileSync(join(laneDir, "src", "a.py"), "a = adopté\n");
    execFileSync("git", ["add", "-A"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "W03"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["merge", "--no-ff", "-m", "merge", `pi-lane/${h.runId}-W03`],
      { cwd: h.root, stdio: "ignore" });
    const bail = acquireRunOwnership(h.runDir, h.runId, "s-poseur");
    appendLaneEvent(h.runDir,
      { event: "INTEGRATED", work_unit: "W03", at: new Date().toISOString() },
      (bail as { lease: Lease }).lease);
    releaseRunOwnership(h.runDir, (bail as { lease: Lease }).lease);

    // Et la réconciliation suivante ne trouve rien à redire.
    const r = await h.outil.execute("1", tache("W09"));
    assert.equal(enErreur(r), false, texte(r));
  } finally {
    h.done();
  }
});

/*
 * Une lane divergée s'adopte avec sa base, ou pas du tout.
 *
 * Le chemin est réel : un crash après un premier commit du worker laisse un
 * worktree qui a déjà une histoire. Le sommet de sa branche n'est alors pas sa
 * base, et l'adopter ainsi rendrait `isMerged` faux dans l'autre sens — la lane
 * paraîtrait n'avoir rien produit.
 */
test("une lane divergée exige sa base, et la vérifie", async () => {
  const h = await monter();
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"],
      { cwd: h.root, encoding: "utf-8" }).trim();
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`, laneDir, "HEAD"],
      { cwd: h.root, stdio: "ignore" });
    writeFileSync(join(laneDir, "src", "a.py"), "a = premier essai\n");
    execFileSync("git", ["add", "-A"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "essai"], { cwd: laneDir, stdio: "ignore" });

    const recover = join(import.meta.dirname, "..", "bin", "subagent-recover");
    const essai = (args: string[]) => {
      try {
        execFileSync(recover, args, { cwd: h.root, encoding: "utf-8", stdio: "pipe" });
        return { code: 0, err: "" };
      } catch (e) {
        const x = e as { status?: number; stderr?: string };
        return { code: x.status ?? 1, err: x.stderr ?? "" };
      }
    };

    // Sans base : refus.
    const sansBase = essai(["W03", "adopt"]);
    assert.notEqual(sansBase.code, 0);
    assert.match(sansBase.err, /--base/);

    // Base inexistante : refus.
    assert.notEqual(essai(["W03", "adopt", "--base", "0".repeat(40)]).code, 0);

    // Base étrangère à la lane : refus. Un commit du dépôt qui n'est pas un
    // ancêtre de cette branche n'est pas un point de départ.
    const etranger = execFileSync("git", ["commit-tree", "-m", "ailleurs",
      `${base}^{tree}`], { cwd: h.root, encoding: "utf-8" }).trim();
    const horsLane = essai(["W03", "adopt", "--base", etranger]);
    assert.notEqual(horsLane.code, 0);
    assert.match(horsLane.err, /ancêtre/);

    // La vraie base : acceptée, et le cycle complet tient.
    assert.equal(essai(["W03", "adopt", "--base", base]).code, 0);
    const ouverture = JSON.parse(
      readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8").split("\n")[1]);
    assert.equal(ouverture.base, base);

    execFileSync("git", ["merge", "--no-ff", "-m", "merge", `pi-lane/${h.runId}-W03`],
      { cwd: h.root, stdio: "ignore" });
    const bail = acquireRunOwnership(h.runDir, h.runId, "s-poseur");
    appendLaneEvent(h.runDir,
      { event: "INTEGRATED", work_unit: "W03", at: new Date().toISOString() },
      (bail as { lease: Lease }).lease);
    releaseRunOwnership(h.runDir, (bail as { lease: Lease }).lease);

    const r = await h.outil.execute("1", tache("W09"));
    assert.equal(enErreur(r), false, texte(r));
  } finally {
    h.done();
  }
});

/*
 * Une branche parasite se supprime, elle ne s'abandonne pas.
 *
 * `discard` ne retirait que le worktree — inexistant ici — puis écrivait
 * `ABANDONED`, ce qui faisait taire le conflit en donnant au registre une unité
 * qu'il n'a jamais connue. Un fait inventé pour masquer un symptôme.
 */
test("une branche sans provenance est supprimée, pas abandonnée", async () => {
  const h = await monter();
  try {
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`, laneDir, "HEAD"],
      { cwd: h.root, stdio: "ignore" });
    execFileSync("git", ["worktree", "remove", "--force", laneDir], { cwd: h.root, stdio: "ignore" });

    execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
      ["W03", "discard"], { cwd: h.root, stdio: "ignore" });

    // La branche a disparu, et le registre ne connaît toujours pas W03.
    const branches = execFileSync("git", ["for-each-ref", "--format=%(refname:short)",
      "refs/heads/pi-lane/*"], { cwd: h.root, encoding: "utf-8" });
    assert.equal(branches.includes("W03"), false, "la branche parasite doit être supprimée");
    assert.equal(existsSync(join(h.runDir, `${h.runId}-lanes.jsonl`)), false,
      "aucun fait ne doit avoir été inventé");

    const r = await h.outil.execute("1", tache("W09"));
    assert.equal(enErreur(r), false, texte(r));
  } finally {
    h.done();
  }
});

/*
 * L'outil ne fabrique pas ce qu'il prétend enregistrer.
 *
 * Chaque verbe a une postcondition, vérifiée après la prise du bail et sur
 * l'état réel du dépôt. Sans elles, `adopt` inventerait une ouverture sans
 * worktree, `integrated` un merge qui n'a pas eu lieu, et `discard` un abandon
 * sur du travail déjà intégré.
 */
test("les verbes de résolution refusent de fabriquer un fait", async () => {
  const h = await monter();
  try {
    const recover = join(import.meta.dirname, "..", "bin", "subagent-recover");
    const essai = (args: string[]) => {
      try {
        execFileSync(recover, args, { cwd: h.root, encoding: "utf-8", stdio: "pipe" });
        return { code: 0, sortie: "" };
      } catch (e) {
        const err = e as { status?: number; stderr?: string };
        return { code: err.status ?? 1, sortie: err.stderr ?? "" };
      }
    };

    // Une branche mergée sans provenance, worktree retiré.
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W03`,
      join(h.root, ".git", "pi-lanes", `${h.runId}-W03`), "HEAD"], { cwd: h.root, stdio: "ignore" });
    execFileSync("git", ["worktree", "remove", "--force",
      join(h.root, ".git", "pi-lanes", `${h.runId}-W03`)], { cwd: h.root, stdio: "ignore" });

    // `adopt` n'a rien à adopter, et le dit.
    const sansWorktree = essai(["W03", "adopt"]);
    assert.notEqual(sansWorktree.code, 0);
    assert.match(sansWorktree.sortie, /n'a pas de sens|aucun worktree/);

    // Et le registre est resté vide.
    assert.equal(
      existsSync(join(h.runDir, `${h.runId}-lanes.jsonl`)),
      false,
      "aucun fait n'a été écrit",
    );
  } finally {
    h.done();
  }
});

/*
 * Un registre d'une autre version n'est pas un registre abîmé.
 *
 * Confondre les deux ferait proposer de « corriger des lignes » là où il faut
 * migrer, et l'opérateur réécrirait de la provenance qu'il ne comprend pas.
 */
test("un registre d'une autre version ferme le run et le dit", async () => {
  const h = await monter();
  try {
    writeFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ ledger: 7 })}\n`);

    const r = await h.outil.execute("1", tache("W03"));
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /autre version/);
    assert.match(texte(r), /pas une corruption/);
    assert.equal(texte(r).includes("illisible"), false, "ce n'est pas le diagnostic d'illisibilité");
    assert.deepEqual(APPELS, []);
  } finally {
    h.done();
  }
});

// Sans en-tête : écrit avant que le protocole soit versionné, donc à migrer.
test("un registre sans version est traité comme une évolution", async () => {
  const h = await monter();
  try {
    writeFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "INTEGRATED", work_unit: "W01", at: "x" })}\n`);

    const r = await h.outil.execute("1", tache("W03"));
    assert.match(texte(r), /aucune version déclarée/);
    assert.match(texte(r), /--migrate-ledger/);
  } finally {
    h.done();
  }
});

/*
 * Le chemin d'évolution complet : registre ancien, migration, run rouvert.
 *
 * Sans lui, un durcissement du contrat laissait un run bloqué sans autre issue
 * qu'une réécriture manuelle de sa provenance — c'est-à-dire la seule chose que
 * tout ce lot refuse de faire.
 */
test("un registre ancien se migre, et le run repart", async () => {
  const h = await monter();
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"],
      { cwd: h.root, encoding: "utf-8" }).trim();
    // Un registre écrit avant que le protocole soit versionné, mais compatible.
    writeFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "OPENED", work_unit: "W03", at: "x", base })}\n`);

    const bloque = await h.outil.execute("1", tache("W09"));
    assert.match(texte(bloque), /autre version/);

    execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
      ["--migrate-ledger"], { cwd: h.root, stdio: "ignore" });

    // Le fait est conservé, l'en-tête est posé.
    const lignes = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8")
      .trim().split("\n");
    assert.deepEqual(JSON.parse(lignes[0]), { ledger: 1 });
    assert.equal(JSON.parse(lignes[1]).work_unit, "W03");

    // W03 est ouverte au registre et son worktree n'existe pas : le run reste
    // fermé, mais pour la bonne raison, et l'outil sait la traiter.
    const apres = await h.outil.execute("2", tache("W09"));
    assert.equal(texte(apres).includes("autre version"), false);
    assert.match(texte(apres), /lane-disparue/);
  } finally {
    h.done();
  }
});

// La migration ne devine jamais : une ligne qu'elle ne sait pas lire arrête tout.
test("une migration refuse de réécrire ce qu'elle ne comprend pas", async () => {
  const h = await monter();
  try {
    writeFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "OPENED", work_unit: "W03", at: "x" })}\n`);

    let sortie = "";
    try {
      execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
        ["--migrate-ledger"], { cwd: h.root, encoding: "utf-8", stdio: "pipe" });
    } catch (e) {
      sortie = (e as { stderr?: string }).stderr ?? "";
    }
    assert.match(sortie, /migration impossible/);
    assert.match(sortie, /ne réécrit aucune ligne/);

    // Le registre est intact.
    const contenu = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");
    assert.equal(contenu.includes("ledger"), false, "aucun en-tête n'a été posé");
  } finally {
    h.done();
  }
});

// ------------------------------------------------------- appel mal formé

/*
 * L'acquisition vient après les validations pures : un appel qui n'a pas de
 * sens ne doit ni prendre le bail ni démarrer le battement.
 */
test("un appel mal formé ne prend pas la propriété", async () => {
  const h = await monter();
  try {
    const r = await h.outil.execute("1", {
      agent: "worker",
      task: "les deux à la fois",
      batch: [{ work_unit: "W03", task: "aussi" }],
    });

    assert.ok(enErreur(r));
    assert.match(texte(r), /exclusifs/);
    assert.equal(
      existsSync(join(h.runDir, `${h.runId}.lease`)),
      false,
      "le bail ne doit pas avoir été pris",
    );
    assert.equal(readManifest(h.runDir)!.nextSeq, 1);
    assert.deepEqual(APPELS, []);
  } finally {
    h.done();
  }
});


// -------------------------------------------- garde des actions opérateur

test("une migration ne peut pas réécrire le registre d'un run tenu", async () => {
  const h = await monter();
  try {
    const path = join(h.runDir, `${h.runId}-lanes.jsonl`);
    const base = git(h.root, "rev-parse", "HEAD").trim();
    writeFileSync(path,
      `${JSON.stringify({ event: "OPENED", work_unit: "W03", at: "x", base })}\n`);

    const owner = acquireRunOwnership(h.runDir, h.runId, "session-vivante");
    assert.equal(owner.ok, true);
    const avant = readFileSync(path, "utf-8");
    let code = 0;
    try {
      execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
        ["--migrate-ledger"], { cwd: h.root, stdio: "pipe" });
    } catch (e) {
      code = (e as { status?: number }).status ?? 1;
    }
    assert.notEqual(code, 0);
    assert.equal(readFileSync(path, "utf-8"), avant, "la migration refusée ne touche pas au registre");
    releaseRunOwnership(h.runDir, (owner as { lease: Lease }).lease);
  } finally {
    h.done();
  }
});

test("discard d'une unité hors plan nettoie sans inventer ABANDONED", async () => {
  const h = await monter();
  try {
    const laneId = `${h.runId}-W99`;
    const laneDir = join(h.root, ".git", "pi-lanes", laneId);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${laneId}`, laneDir, "HEAD"],
      { cwd: h.root, stdio: "ignore" });

    execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"),
      ["W99", "discard"], { cwd: h.root, stdio: "ignore" });

    assert.equal(existsSync(laneDir), false);
    assert.throws(() => git(h.root, "rev-parse", "--verify", `pi-lane/${laneId}`));
    const ledger = join(h.runDir, `${h.runId}-lanes.jsonl`);
    if (existsSync(ledger)) {
      assert.equal(readFileSync(ledger, "utf-8").includes("W99"), false,
        "une unité hors plan ne doit jamais entrer dans la provenance");
    }
  } finally {
    h.done();
  }
});

test("discard d'une branche non intégrée exige --force", async () => {
  const h = await monter();
  try {
    const laneId = `${h.runId}-W03`;
    const laneDir = join(h.root, ".git", "pi-lanes", laneId);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${laneId}`, laneDir, "HEAD"],
      { cwd: h.root, stdio: "ignore" });
    writeFileSync(join(laneDir, "src", "a.py"), "a = branche\n");
    execFileSync("git", ["add", "-A"], { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "branche sans provenance"],
      { cwd: laneDir, stdio: "ignore" });
    execFileSync("git", ["worktree", "remove", "--force", laneDir],
      { cwd: h.root, stdio: "ignore" });

    const recover = join(import.meta.dirname, "..", "bin", "subagent-recover");
    assert.throws(() => execFileSync(recover, ["W03", "discard"],
      { cwd: h.root, stdio: "pipe" }));
    assert.doesNotThrow(() => git(h.root, "rev-parse", "--verify", `pi-lane/${laneId}`));

    execFileSync(recover, ["W03", "discard", "--force"], { cwd: h.root, stdio: "ignore" });
    assert.throws(() => git(h.root, "rev-parse", "--verify", `pi-lane/${laneId}`));
  } finally {
    h.done();
  }
});

// ------------------------------------------ l'écriture inline de l'orchestrateur

/*
 * Le second `tool_call` de l'extension, que rien n'éprouvait.
 *
 * Il fait deux choses opposées : une écriture matérielle de l'orchestrateur
 * entre dans `HISTORY`, une écriture sous `.pi-subagent-runs/` n'y entre pas.
 * Tester la seconde seule serait vert avec un gestionnaire entièrement mort —
 * exactement le piège dans lequel le harnais de `role-guard` est tombé une
 * version plus tôt. Les deux vont donc ensemble, et la paire ne tient que si
 * le gestionnaire est vivant *et* le filtre aussi.
 *
 * Régime libre, sans plan : sans unité il n'y a pas de lane, donc pas de
 * `laneView`, et l'écriture inline se juge sur `HISTORY` seul.
 */

/** Un `tool_call` de la forme de pi. */
const ecriture = (path: string) => ({
  toolName: "write",
  toolCallId: "test-call",
  input: { path },
});

const review = () => ({ agent: "reviewer", task: "juger le changement" });

test("une écriture inline de l'orchestrateur entre dans l'historique", async () => {
  const h = await monter({ avecPlan: false });
  try {
    const toolCall = h.evenement("tool_call");
    assert.ok(toolCall, "l'extension ne s'abonne pas à tool_call");

    writeFileSync(join(h.root, "src", "a.py"), "a = 2\n");
    await toolCall(ecriture("src/a.py"));

    const r1 = await h.outil.execute("1", review());
    assert.equal(enErreur(r1), false, texte(r1));
    // Le diff est là parce que l'écriture est entrée dans l'historique.
    assert.match(APPELS[0].task, /src\/a\.py/);
    assert.match(APPELS[0].task, /a = 2/);

    writeFileSync(join(h.root, "src", "a.py"), "a = 3\n");
    await toolCall(ecriture("src/a.py"));

    /*
     * La partie qui tombe quand le gestionnaire est mort.
     *
     * Sans l'entrée poussée par l'écriture, la dernière délégation reste le
     * reviewer et cette seconde review est refusée — « a review already ran and
     * no worker has run since ». C'est ce qui distingue « le filtre marche » de
     * « rien n'est jamais arrivé ».
     */
    const r2 = await h.outil.execute("2", review());
    assert.equal(enErreur(r2), false, texte(r2));
    assert.match(APPELS[1].task, /a = 3/);
  } finally {
    h.done();
  }
});

test("une écriture d'instrumentation ne compte pas comme un changement", async () => {
  const h = await monter({ avecPlan: false });
  try {
    const toolCall = h.evenement("tool_call")!;

    writeFileSync(join(h.root, "src", "a.py"), "a = 2\n");
    await toolCall(ecriture("src/a.py"));
    assert.equal(enErreur(await h.outil.execute("1", review())), false);

    // Le plan fantôme, écrit par l'orchestrateur lui-même. Instrumentation du
    // run, jamais son sujet.
    const plan = join(RUNS, `${h.runId}-plan.json`);
    writeFileSync(join(h.root, plan), JSON.stringify(PLAN));
    await toolCall(ecriture(plan));

    const r = await h.outil.execute("2", review());
    assert.ok(enErreur(r), "une rereview devrait rester refusée");
    assert.match(texte(r), /a review already ran/);
  } finally {
    h.done();
  }
});

// -------------------------------------------------- le préflight du dépôt

/*
 * Un dépôt qui n'ignore pas l'instrumentation du run.
 *
 * Depuis 3c.1c, la racine doit être propre pour ouvrir un contexte
 * d'intégration et pour intégrer. Un `.pi-subagent-runs/` non ignoré la salit
 * lui-même, définitivement, et aucune intégration ne peut plus partir — un
 * défaut silencieux jusqu'au premier conflit, c'est-à-dire jusqu'au moment le
 * plus coûteux pour le découvrir.
 *
 * Le refus est ici parce que c'est ici qu'il coûte quelque chose ; la
 * vérification, elle, a eu lieu avant la première écriture.
 */
test("un dépôt qui n'ignore pas son instrumentation ne délègue pas", async () => {
  const h = await monter({ ignoreInstrumentation: false });
  try {
    const r = await h.outil.execute("1", tache("W03"));
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /n'est pas prêt pour un run/);
    assert.match(texte(r), /n'est pas ignoré par ce dépôt/);
    assert.deepEqual(APPELS, [], "aucun enfant lancé");
  } finally {
    h.done();
  }
});

test("rien n'est écrit quand le préflight refuse", async () => {
  /*
   * La moitié qui compte. Refuser après avoir créé le manifeste laisserait
   * derrière soi exactement ce que le refus reproche au dépôt.
   */
  const h = await monter({ ignoreInstrumentation: false, avecPlan: false });
  try {
    assert.equal(existsSync(h.runDir), false, "aucun répertoire d'instrumentation");
    assert.equal(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"],
        { cwd: h.root, encoding: "utf-8" }).trim(),
      "",
      "la racine est restée propre",
    );
  } finally {
    h.done();
  }
});

test("le prompt n'ordonne pas d'écrire là où le préflight refuse", async () => {
  /*
   * Le runtime n'écrit rien, mais l'orchestrateur suit ses instructions — et la
   * guideline normale lui dit d'écrire un plan sous le répertoire qui est
   * précisément le problème, avec un `runId` vide puisque aucun run n'a été
   * ouvert. `.pi-subagent-runs/-plan.json` serait créé avant même le premier
   * `task`, donc avant que quoi que ce soit puisse le refuser.
   */
  const h = await monter({ ignoreInstrumentation: false, avecPlan: false });
  try {
    const g = (h.outil.promptGuidelines ?? []).join("\n");
    assert.doesNotMatch(g, /-plan\.json/, "aucune instruction d'écrire un plan");
    assert.match(g, /not ready for a run/);
    assert.match(g, /restart pi/);
  } finally {
    h.done();
  }
});

test("le prompt demande un plan quand le dépôt est prêt", async () => {
  const h = await monter();
  try {
    const g = (h.outil.promptGuidelines ?? []).join("\n");
    assert.match(g, new RegExp(`${RUNS}/${h.runId}-plan\\.json`));
  } finally {
    h.done();
  }
});

// ------------------------------------------- le cycle d'intégration, bout en bout

/*
 * La contre-épreuve centrale de ce lot : ces scénarios doivent tomber si le
 * branchement disparaît du vrai chemin `task`. Les primitives de 3c.1c ont leurs
 * propres tests ; ceux-ci ne prouvent qu'une chose, celle qui manquait — qu'elles
 * sont appelées.
 */

/** Une lane approuvée dont l'intégration conflictuera avec la base. */
async function conflit(h: Awaited<ReturnType<typeof monter>>) {
  const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
  // Le worker écrit dans sa lane.
  PILOTE.pendant = () => {
    writeFileSync(join(laneDir, "src", "a.py"), "a = 'lane'\n");
  };
  await h.outil.execute("1", tache("W03"));
  PILOTE.pendant = undefined;

  // La base avance sur la même ligne, hors de la lane.
  writeFileSync(join(h.root, "src", "a.py"), "a = 'racine'\n");
  execFileSync("git", ["add", "-A"], { cwd: h.root });
  execFileSync("git", ["commit", "-qm", "racine avance"], { cwd: h.root });
}

const revueDe = (verdict: string) => {
  PILOTE.resultat = { verdict, changedFiles: [] } as never;
  return { agent: "reviewer", work_unit: "W03", task: "juger" };
};

test("un conflit d'intégration ouvre un contexte et le dit", async () => {
  const h = await monter();
  try {
    await conflit(h);
    const r = await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;

    assert.match(texte(r), /CONFLIT D'INTÉGRATION\s+W03/);
    assert.match(texte(r), /agent=integration-worker/);
    assert.match(texte(r), /src\/a\.py/);

    // Le contexte existe réellement, détaché, hors de la lane et de la racine.
    const contextes = execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
      { encoding: "utf-8" }).split("\n").filter(Boolean);
    assert.equal(contextes.length, 1, "un contexte d'intégration ouvert");
    assert.match(contextes[0], new RegExp(`^${h.runId}-W03-\\d+$`));
    // Et la racine n'a pas bougé.
    assert.equal(
      execFileSync("git", ["status", "--porcelain"], { cwd: h.root, encoding: "utf-8" }).trim(),
      "",
    );
  } finally {
    h.done();
  }
});

test("le worker est refusé tant que la tentative vit, le reviewer non", async () => {
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;

    const w = await h.outil.execute("3", tache("W03"));
    assert.ok(enErreur(w), texte(w));
    assert.match(texte(w), /tentative d'intégration est ouverte/);

    const inconnu = await h.outil.execute("4", {
      agent: "integration-worker", work_unit: "W09", task: "résoudre",
    });
    assert.ok(enErreur(inconnu), texte(inconnu));
    assert.match(texte(inconnu), /aucune tentative d'intégration/);
  } finally {
    h.done();
  }
});

test("l'integration-worker travaille dans le contexte, pas dans la lane", async () => {
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;

    const avant = APPELS.length;
    PILOTE.pendant = (appel) => {
      // Le cwd qu'il reçoit est le contexte : c'est là que le conflit existe.
      assert.ok(appel.cwd?.includes("pi-integrations"), `cwd = ${appel.cwd}`);
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    const r = await h.outil.execute("3", {
      agent: "integration-worker", work_unit: "W03", task: "résoudre",
    });
    PILOTE.pendant = undefined;

    assert.equal(enErreur(r), false, texte(r));
    assert.match(texte(r), /RÉSOLUTION PRÊTE/);
    // Sa tâche porte les fichiers en conflit, et rien d'autre comme scope.
    assert.match(APPELS[avant].task, /Merge conflict — W03/);
    assert.match(APPELS[avant].task, /src\/a\.py/);
    // La lane n'a pas été touchée.
    assert.equal(
      readFileSync(join(h.root, ".git", "pi-lanes", `${h.runId}-W03`, "src", "a.py"), "utf-8"),
      "a = 'lane'\n",
    );
  } finally {
    h.done();
  }
});

test("la review d'intégration voit les deux vues et le bon répertoire", async () => {
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });
    PILOTE.pendant = undefined;

    const avant = APPELS.length;
    PILOTE.resultat = { verdict: "approved", changedFiles: [] } as never;
    const r = await h.outil.execute("4", revueDe("approved"));
    PILOTE.resultat = undefined;

    const tache4 = APPELS[avant];
    assert.ok(tache4.cwd?.includes("pi-integrations"), `cwd = ${tache4.cwd}`);
    assert.match(tache4.task, /Integration review — W03/);
    assert.match(tache4.task, /P1 → T/);
    assert.match(tache4.task, /P2 → T/);
    assert.match(tache4.task, /résolu/);

    // Et l'intégration a eu lieu : la racine porte le merge.
    assert.match(texte(r), /intégrée : W03/);
    assert.equal(readFileSync(join(h.root, "src", "a.py"), "utf-8"), "a = 'résolu'\n");
    const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", "HEAD"],
      { cwd: h.root, encoding: "utf-8" }).trim().split(/\s+/);
    assert.equal(parents.length, 3, "un merge à deux parents");
    // Et le registre porte la preuve durable.
    const ledger = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");
    assert.match(ledger, /"event":"INTEGRATED"/);
    assert.match(ledger, /"integration_commit":"[0-9a-f]{40}"/);
  } finally {
    h.done();
  }
});

test("un dépassement de scope termine la tentative et rend l'unité à sa lane", async () => {
  /*
   * La transition demandée : la tentative meurt, l'unité vit. Rien n'est
   * enregistré au registre, rien n'est recopié du contexte vers la lane, et le
   * worker redevient admissible — sans quoi notre propre règle « worker refusé
   * si une tentative est ouverte » interdirait le retour qu'on demande.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;

    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
      writeFileSync(join(appel.cwd!, "src", "b.py"), "b = 'hors conflit'\n");
    };
    const r = await h.outil.execute("3", {
      agent: "integration-worker", work_unit: "W03", task: "résoudre",
    });
    PILOTE.pendant = undefined;

    assert.match(texte(r), /TENTATIVE ABANDONNÉE/);
    assert.match(texte(r), /src\/b\.py/);
    assert.match(texte(r), /agent=worker work_unit=W03/);

    // Aucun commit d'intégration, aucun INTEGRATED.
    assert.equal(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: h.root, encoding: "utf-8" }).trim(),
      "2",
      "la racine n'a pas avancé",
    );
    const ledger = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");
    assert.doesNotMatch(ledger, /INTEGRATED/);
    assert.doesNotMatch(ledger, /ABANDONED/, "l'unité n'est pas abandonnée, la tentative l'est");

    // Le contexte est retiré, et la lane est intacte.
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations")) &&
      execFileSync("ls", [join(h.root, ".git", "pi-integrations")], { encoding: "utf-8" }).trim(),
      "");
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    assert.equal(readFileSync(join(laneDir, "src", "a.py"), "utf-8"), "a = 'lane'\n");
    assert.equal(readFileSync(join(laneDir, "src", "b.py"), "utf-8"), "b = 1\n",
      "rien n'est transporté du contexte vers la lane");

    // Et le worker est de nouveau admissible.
    const w = await h.outil.execute("4", tache("W03"));
    assert.equal(enErreur(w), false, texte(w));
  } finally {
    h.done();
  }
});

test("une délégation d'intégration n'appartient à aucune lane", async () => {
  /*
   * Elle appartient à l'unité, mais elle ne s'est pas exécutée dans sa lane. Lui
   * donner le `laneId` ferait entrer dans `laneView(W03)` des changements faits
   * dans un autre worktree — la confusion exacte que le contexte d'intégration
   * existe pour supprimer, et que la review de lane suivante paierait.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });
    PILOTE.pendant = undefined;

    const journal = readFileSync(join(h.runDir, `${h.runId}-delegations.jsonl`), "utf-8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const integ = journal.find((e) => e.role === "integration-worker");
    assert.ok(integ, "la délégation d'intégration est journalisée");
    assert.equal(integ.work_unit, "W03", "elle appartient bien à l'unité");
    assert.equal(integ.lane_id, null, "et à aucune lane");
    assert.ok(integ.cwd.includes("pi-integrations"));

    // Le worker de la lane, lui, en a une : c'est la distinction qui compte.
    const w = journal.find((e) => e.role === "worker");
    assert.equal(w.lane_id, `${h.runId}-W03`);
  } finally {
    h.done();
  }
});

test("une résolution qui signale un besoin hors conflits n'est pas intégrée", async () => {
  /*
   * Le chemin sûr que son mandat lui prescrit : ne touche pas le fichier, mets-le
   * dans `deviations`. Un agent qui obéit parfaitement ne modifie donc rien hors
   * conflits — et le contrôle mécanique seul annonçait « résolution prête », en
   * emportant le problème signalé jusque dans l'intégration. La récompense de
   * l'obéissance était de rendre le signal invisible.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = { deviations: ["src/b.py doit aussi changer"] } as never;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    const r = await h.outil.execute("3", {
      agent: "integration-worker", work_unit: "W03", task: "résoudre",
    });
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;

    assert.match(texte(r), /TENTATIVE ABANDONNÉE/);
    assert.match(texte(r), /src\/b\.py doit aussi changer/);
    assert.doesNotMatch(texte(r), /RÉSOLUTION PRÊTE/);

    const ledger = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");
    assert.doesNotMatch(ledger, /INTEGRATED/);
    // Et le worker est de nouveau admissible : c'est lui qui fera le changement.
    assert.equal(enErreur(await h.outil.execute("4", tache("W03"))), false);
  } finally {
    h.done();
  }
});

test("integration-worker doit déclarer son unité, pas la dériver", async () => {
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    const r = await h.outil.execute("3", { agent: "integration-worker", task: "résoudre" });
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /doit déclarer son/);
  } finally {
    h.done();
  }
});

test("une base qui a bougé rouvre une tentative au lieu de bloquer", async () => {
  /*
   * L'ancien chemin conseillait une review de lane. Il était inexécutable : le
   * dernier agent est le reviewer d'intégration, et la garde globale refuse une
   * review qu'aucun worker ne sépare de la précédente. Le conseil était bloqué
   * avant d'atteindre la lane.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });

    // La base bouge pendant la review d'intégration.
    PILOTE.pendant = () => {
      writeFileSync(join(h.root, "src", "b.py"), "b = 'ailleurs'\n");
      execFileSync("git", ["add", "-A"], { cwd: h.root });
      execFileSync("git", ["commit", "-qm", "une autre intégration passe devant"], { cwd: h.root });
    };
    PILOTE.resultat = { verdict: "approved" } as never;
    const r = await h.outil.execute("4", revueDe("approved"));
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;

    assert.match(texte(r), /TENTATIVE PÉRIMÉE, ROUVERTE/);
    // Une seule tentative vivante, et c'est la nouvelle.
    const contextes = execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
      { encoding: "utf-8" }).split("\n").filter(Boolean);
    assert.equal(contextes.length, 1);
    // Rien n'a été intégré, et l'unité n'est pas bloquée : la suite est nommée.
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /INTEGRATED/);
    assert.match(texte(r), /agent=(integration-worker|reviewer) work_unit=W03/);
  } finally {
    h.done();
  }
});

test("un atterrissage bloqué se reprend à la délégation suivante", async () => {
  /*
   * `M` existe et vaut ; l'obstacle est hors du runtime. Annoncer « corrigez
   * puis relancez » sans réessayer laisserait l'unité bloquée : le worker est
   * interdit, le reviewer n'a plus d'objet, et rien ne rouvrirait la porte.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });

    // La racine se salit pendant la review : le ff-only n'est plus autorisé.
    PILOTE.pendant = () => {
      writeFileSync(join(h.root, "brouillon.txt"), "non suivi\n");
    };
    PILOTE.resultat = { verdict: "approved" } as never;
    const bloque = await h.outil.execute("4", revueDe("approved"));
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;

    assert.match(texte(bloque), /ATTERRISSAGE BLOQUÉ/);
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /INTEGRATED/);

    // Tant que l'obstacle est là, la délégation est refusée et réessaie.
    const encore = await h.outil.execute("5", tache("W03"));
    assert.ok(enErreur(encore), texte(encore));
    assert.match(texte(encore), /ATTERRISSAGE BLOQUÉ/);

    // Un rôle en lecture seule ne déclenche rien : il peut être rattaché à W03
    // par la provenance de ses risques, et il n'a pas à causer un `ff-only`.
    const avantScout = APPELS.length;
    rmSync(join(h.root, "brouillon.txt"));
    const sc = await h.outil.execute("6", {
      agent: "scout", work_unit: "W03", task: "localiser", find: "où est a.py", scope: ["src"],
    });
    assert.equal(enErreur(sc), false, texte(sc));
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /INTEGRATED/);
    assert.ok(APPELS.length > avantScout, "le scout a bien tourné");

    // L'obstacle levé, la délégation suivante fait atterrir M — et ne lance
    // personne : l'unité vient d'être intégrée, un worker n'y a plus d'objet.
    const avant = APPELS.length;
    const r = await h.outil.execute("7", tache("W03"));
    assert.equal(enErreur(r), false, texte(r));
    assert.match(texte(r), /intégrée : W03/);
    assert.equal(APPELS.length, avant, "aucun enfant lancé");
    const ledger = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");
    assert.match(ledger, /"event":"INTEGRATED"/);
    assert.match(ledger, /"integration_commit":"[0-9a-f]{40}"/);
  } finally {
    h.done();
  }
});

test("un commit dont la forme est fausse met la tentative en reprise", async () => {
  /*
   * Le cas que `git commit` a rendu possible et que `commit-tree` n'avait pas :
   * un hook `pre-commit` qui stage un fichier de plus. Le commit réussit, son
   * tree n'est plus celui qui a été revu — et le contexte a avancé, donc il n'est
   * plus sur `P1` et n'a plus de `MERGE_HEAD`.
   *
   * Laisser la tentative en `resolving` y renverrait un integration-worker qui
   * ne trouverait plus de conflit, pendant que le worker de la lane resterait
   * interdit. Rien n'en sortirait.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });
    PILOTE.pendant = undefined;

    const hooks = mkdtempSync(join(tmpdir(), "pi-hooks-"));
    writeFileSync(join(hooks, "pre-commit"),
      "#!/bin/sh\nprintf 'ajouté par le hook\\n' > intrus.txt\ngit add intrus.txt\n",
      { mode: 0o755 });
    execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: h.root });

    PILOTE.resultat = { verdict: "approved" } as never;
    const r = await h.outil.execute("4", revueDe("approved"));
    PILOTE.resultat = undefined;
    rmSync(hooks, { recursive: true, force: true });

    assert.match(texte(r), /REPRISE REQUISE/);
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /INTEGRATED/);

    // Plus aucune délégation sur l'unité : ni la lane, ni le contexte.
    for (const appel of [tache("W03"),
      { agent: "integration-worker", work_unit: "W03", task: "résoudre" }]) {
      const refus = await h.outil.execute("5", appel);
      assert.ok(enErreur(refus), texte(refus));
    }
    // Et le contexte est conservé pour le diagnostic.
    assert.equal(
      execFileSync("ls", [join(h.root, ".git", "pi-integrations")], { encoding: "utf-8" })
        .split("\n").filter(Boolean).length,
      1,
    );
  } finally {
    h.done();
  }
});

test("un atterrissage bloqué puis périmé rouvre au lieu de boucler", async () => {
  /*
   * Les deux découvertes de péremption partagent maintenant une transition.
   * Elles avaient deux machines : celle du premier atterrissage rouvrait, celle
   * de la reprise rendait le motif et laissait la phase inchangée — toutes les
   * reprises suivantes repartaient alors de l'ancien `P1`, et rien n'en sortait.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });

    // La racine se salit : M est construit mais n'atterrit pas.
    PILOTE.pendant = () => {
      writeFileSync(join(h.root, "brouillon.txt"), "non suivi\n");
    };
    PILOTE.resultat = { verdict: "approved" } as never;
    assert.match(texte(await h.outil.execute("4", revueDe("approved"))), /ATTERRISSAGE BLOQUÉ/);
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;

    const ancien = execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
      { encoding: "utf-8" }).trim();

    // L'obstacle est levé, mais la base a avancé entre-temps.
    rmSync(join(h.root, "brouillon.txt"));
    writeFileSync(join(h.root, "src", "b.py"), "b = 'ailleurs'\n");
    execFileSync("git", ["add", "-A"], { cwd: h.root });
    execFileSync("git", ["commit", "-qm", "une autre intégration passe devant"], { cwd: h.root });
    const nouvelleBase = execFileSync("git", ["rev-parse", "HEAD"],
      { cwd: h.root, encoding: "utf-8" }).trim();

    const avant = APPELS.length;
    const r = await h.outil.execute("5", tache("W03"));
    assert.match(texte(r), /TENTATIVE PÉRIMÉE, ROUVERTE/);
    assert.equal(APPELS.length, avant, "aucun enfant lancé par la reprise");

    // Un seul contexte, et c'est le nouveau, ouvert sur la base courante.
    const contextes = execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
      { encoding: "utf-8" }).split("\n").filter(Boolean);
    assert.equal(contextes.length, 1);
    assert.notEqual(contextes[0], ancien);
    const tete = execFileSync("git", ["rev-parse", "HEAD"],
      { cwd: join(h.root, ".git", "pi-integrations", contextes[0]), encoding: "utf-8" }).trim();
    assert.equal(tete, nouvelleBase, "le nouveau contexte part de la base courante");

    // Et rien n'a été intégré : la suite est nommée, pas devinée.
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /INTEGRATED/);
  } finally {
    h.done();
  }
});

// ------------------------------------- les rôles globaux le sont jusqu'au bout

/*
 * Un scout ou un advisor peut porter une unité — déclarée, ou héritée de la
 * provenance de ses risques — sans que cela change ce qu'il est. Le laisser
 * ouvrir une lane lui ferait créer un worktree et un `OPENED` pour une unité que
 * personne n'a commencée ; le laisser hériter du contexte d'intégration lui
 * ferait lire des marqueurs de conflit que son contrat ne mentionne pas.
 */

const global_ = (agent: string, unit: string) =>
  agent === "scout"
    ? { agent, work_unit: unit, task: "localiser", find: "où est a.py", scope: ["src"] }
    : { agent, work_unit: unit, task: "conseiller", question: "quelle option ?" };

for (const agent of ["scout", "advisor"]) {
  test(`un ${agent} portant une unité n'ouvre ni lane ni registre`, async () => {
    const h = await monter();
    try {
      let vu: string | undefined;
      PILOTE.pendant = (appel) => { vu = appel.cwd; };
      const r = await h.outil.execute("1", global_(agent, "W09"));
      PILOTE.pendant = undefined;

      assert.equal(enErreur(r), false, texte(r));
      assert.equal(vu, h.root, "il répond sur le dépôt, pas dans une lane");
      assert.equal(existsSync(join(h.root, ".git", "pi-lanes")), false, "aucun worktree ouvert");
      assert.equal(existsSync(join(h.runDir, `${h.runId}-lanes.jsonl`)), false, "aucun OPENED écrit");
    } finally {
      h.done();
    }
  });

  test(`un ${agent} ne tombe pas dans le contexte d'intégration`, async () => {
    const h = await monter();
    try {
      await conflit(h);
      await h.outil.execute("2", revueDe("approved"));
      PILOTE.resultat = undefined;

      let vu: string | undefined;
      PILOTE.pendant = (appel) => { vu = appel.cwd; };
      const r = await h.outil.execute("3", global_(agent, "W03"));
      PILOTE.pendant = undefined;

      assert.equal(enErreur(r), false, texte(r));
      assert.equal(vu, h.root, "ni la lane, ni le contexte : le dépôt");
      assert.ok(!vu?.includes("pi-integrations"));
      // Et rien n'a bougé : la tentative est toujours là, intacte.
      assert.equal(
        execFileSync("ls", [join(h.root, ".git", "pi-integrations")], { encoding: "utf-8" })
          .split("\n").filter(Boolean).length,
        1,
      );
    } finally {
      h.done();
    }
  });
}

// ------------------------------------------- la reconstruction au redémarrage

/*
 * La contre-épreuve centrale de 3c.2a.
 *
 * Le disque survit, l'état module meurt. Sans ces scénarios, on pourrait
 * construire un registre parfait que `ATTEMPTS` continuerait de ne jamais
 * relire, et rien ne le dirait — le seul test qui prouve la reconstruction est
 * celui qui perd la mémoire pour de bon.
 */

/**
 * Ferme la session sans détruire le dépôt, puis en rouvre une.
 *
 * `session_shutdown` d'abord : c'est ce que pi appelle en s'arrêtant, et c'est
 * là que le bail est rendu. Sans ça la seconde session verrait le run tenu par
 * la première — vrai dans le test, où le pid ne change pas, et faux d'un vrai
 * redémarrage.
 */
async function redemarrer(h: Awaited<ReturnType<typeof monter>>) {
  const root = h.root;
  await h.evenement("session_shutdown")?.();
  process.chdir(REPO);
  return await monter({ reprendre: root });
}

test("une tentative en résolution est retrouvée après un redémarrage", async () => {
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    const contexte = execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
      { encoding: "utf-8" }).trim();

    h2 = await redemarrer(h);

    // La politique sait de nouveau qu'une tentative vit : le worker est refusé.
    const w = await h2.outil.execute("1", tache("W03"));
    assert.ok(enErreur(w), texte(w));
    assert.match(texte(w), /tentative d'intégration est ouverte/);

    // Et l'integration-worker retrouve son contexte, pas la lane.
    let vu: string | undefined;
    PILOTE.pendant = (appel) => {
      vu = appel.cwd;
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    const r = await h2.outil.execute("2", {
      agent: "integration-worker", work_unit: "W03", task: "résoudre",
    });
    PILOTE.pendant = undefined;
    assert.equal(enErreur(r), false, texte(r));
    assert.equal(vu, join(h.root, ".git", "pi-integrations", contexte));
    assert.match(texte(r), /RÉSOLUTION PRÊTE/);
  } finally {
    (h2 ?? h).done();
  }
});

test("une tentative en attente d'atterrissage est retrouvée avec son commit", async () => {
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });
    PILOTE.pendant = () => { writeFileSync(join(h.root, "brouillon.txt"), "non suivi\n"); };
    PILOTE.resultat = { verdict: "approved" } as never;
    assert.match(texte(await h.outil.execute("4", revueDe("approved"))), /ATTERRISSAGE BLOQUÉ/);
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;

    h2 = await redemarrer(h);

    // L'obstacle levé, la première délégation fait atterrir M — donc la phase
    // et le commit ont bien traversé le redémarrage.
    rmSync(join(h.root, "brouillon.txt"));
    const avant = APPELS.length;
    const r = await h2.outil.execute("1", tache("W03"));
    assert.match(texte(r), /intégrée : W03/);
    assert.equal(APPELS.length, avant, "aucun enfant lancé");
    assert.match(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /INTEGRATED/);
  } finally {
    (h2 ?? h).done();
  }
});

test("un contexte sans provenance ferme la porte au redémarrage", async () => {
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;

    // Le registre disparaît, le contexte reste : exactement ce qu'un runtime
    // sans provenance durable produisait à chaque redémarrage.
    rmSync(join(h.runDir, `${h.runId}-integrations.jsonl`));
    h2 = await redemarrer(h);

    const r = await h2.outil.execute("1", tache("W09"));
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /tentatives d'intégration à trancher/);
    assert.match(texte(r), /contexte-sans-provenance/);
    assert.deepEqual(APPELS.slice(-1).filter((a) => a.role === "worker" && a.task.includes("W09")), []);
  } finally {
    (h2 ?? h).done();
  }
});

test("une tentative dont le contexte a disparu ferme la porte au redémarrage", async () => {
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;

    // L'inverse : la provenance reste, le contexte disparaît. Une seule des deux
    // directions serait une garde à moitié.
    const contexte = execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
      { encoding: "utf-8" }).trim();
    execFileSync("git", ["worktree", "remove", "--force",
      join(h.root, ".git", "pi-integrations", contexte)], { cwd: h.root });

    h2 = await redemarrer(h);
    const r = await h2.outil.execute("1", tache("W09"));
    assert.ok(enErreur(r), texte(r));
    assert.match(texte(r), /tentative-sans-contexte/);
  } finally {
    (h2 ?? h).done();
  }
});

test("une réouverture enregistre avant de retirer, et garde l'ancien si elle échoue", async () => {
  /*
   * L'ordre : ouvrir, enregistrer l'ouverture, enregistrer le remplacement,
   * retirer. Une version antérieure retirait l'ancien contexte même quand
   * l'ouverture échouait — le travail restait dans `P2`, mais la seule chose qui
   * le désignait disparaissait avec le contexte.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });

    const ancien = execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
      { encoding: "utf-8" }).trim();

    // La base avance et la racine se salit : le landing sera périmé, et la
    // réouverture refusée puisqu'elle exige une racine propre.
    PILOTE.pendant = () => {
      writeFileSync(join(h.root, "src", "b.py"), "b = 'ailleurs'\n");
      execFileSync("git", ["add", "-A"], { cwd: h.root });
      execFileSync("git", ["commit", "-qm", "une autre intégration"], { cwd: h.root });
      writeFileSync(join(h.root, "brouillon.txt"), "non suivi\n");
    };
    PILOTE.resultat = { verdict: "approved" } as never;
    const r = await h.outil.execute("4", revueDe("approved"));
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;

    assert.match(texte(r), /la rouvrir a échoué/);
    // L'ancien contexte est là : il est la seule chose qui désigne ce travail.
    assert.equal(
      execFileSync("ls", [join(h.root, ".git", "pi-integrations")], { encoding: "utf-8" }).trim(),
      ancien,
    );
    // Et le registre ne l'a pas remplacé par une tentative qui n'existe pas.
    const ledger = readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8");
    assert.doesNotMatch(ledger, /SUPERSEDED/);
  } finally {
    h.done();
  }
});

test("une réouverture réussie écrit l'ouverture avant le remplacement", async () => {
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });

    PILOTE.pendant = () => {
      writeFileSync(join(h.root, "src", "b.py"), "b = 'ailleurs'\n");
      execFileSync("git", ["add", "-A"], { cwd: h.root });
      execFileSync("git", ["commit", "-qm", "une autre intégration"], { cwd: h.root });
    };
    PILOTE.resultat = { verdict: "approved" } as never;
    assert.match(texte(await h.outil.execute("4", revueDe("approved"))), /ROUVERTE/);
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;

    const lignes = readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8")
      .split("\n").filter(Boolean).slice(1).map((l) => JSON.parse(l));
    const ouvertures = lignes.filter((e) => e.event === "ATTEMPT_OPENED");
    const remplace = lignes.findIndex((e) => e.event === "SUPERSEDED");
    const seconde = lignes.findIndex((e) => e.event === "ATTEMPT_OPENED" && e.id === ouvertures[1].id);
    assert.equal(ouvertures.length, 2);
    assert.ok(seconde < remplace, "la nouvelle tentative est enregistrée avant le remplacement");
    assert.equal(lignes[remplace].by, ouvertures[1].id);
    // Et le même P2 : la review de lane approuve le travail, pas la rencontre.
    assert.equal(ouvertures[1].p2, ouvertures[0].p2);
    assert.notEqual(ouvertures[1].p1, ouvertures[0].p1);
  } finally {
    h.done();
  }
});

test("un registre de tentatives inexploitable ferme la porte au redémarrage", async () => {
  /*
   * Reconstruire à partir de ce qu'on arrive encore à lire, c'est décider que
   * ce qu'on ne lit pas ne comptait pas. L'écriture refusait déjà une version
   * inconnue et une ligne abîmée ; la lecture les acceptait et continuait.
   */
  for (const abimer of [
    (p: string) => writeFileSync(p, `${JSON.stringify({ integration_ledger: 2 })}\n`),
    (p: string) => writeFileSync(p, `${readFileSync(p, "utf-8")}{ pas du json\n`),
  ]) {
    const h = await monter();
    let h2: Awaited<ReturnType<typeof monter>> | undefined;
    try {
      await conflit(h);
      await h.outil.execute("2", revueDe("approved"));
      PILOTE.resultat = undefined;

      abimer(join(h.runDir, `${h.runId}-integrations.jsonl`));
      h2 = await redemarrer(h);

      // Une unité sans rapport est refusée : la porte est celle du run.
      const r = await h2.outil.execute("1", tache("W09"));
      assert.ok(enErreur(r), texte(r));
      assert.match(texte(r), /journal-illisible/);
      assert.match(texte(r), /inexploitable/);
    } finally {
      (h2 ?? h).done();
    }
  }
});

// ------------------------------- le recovery opérateur des tentatives

/** `bin/subagent-recover`, lancé comme un opérateur le lancerait. */
function recover(root: string, args: string[]) {
  try {
    return {
      ok: true,
      out: execFileSync(join(import.meta.dirname, "..", "bin", "subagent-recover"), args,
        { cwd: root, encoding: "utf-8" }),
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** Un run dont une tentative d'intégration est ouverte, et son id. */
async function tentativeOuverte(h: Awaited<ReturnType<typeof monter>>) {
  await conflit(h);
  await h.outil.execute("2", revueDe("approved"));
  PILOTE.resultat = undefined;
  return execFileSync("ls", [join(h.root, ".git", "pi-integrations")],
    { encoding: "utf-8" }).trim();
}

test("l'outil montre les tentatives et ne les touche pas", async () => {
  const h = await monter();
  try {
    const id = await tentativeOuverte(h);
    const r = recover(h.root, ["attempts"]);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, new RegExp(id));
    assert.match(r.out, /unité\s+W03/);
    assert.match(r.out, /état\s+resolving/);
    assert.match(r.out, /contexte\s+présent/);
    // Montrer ne modifie rien.
    assert.match(readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8"),
      /ATTEMPT_OPENED/);
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8"),
      /CLOSED/);
  } finally {
    h.done();
  }
});

test("return-to-lane clôt la tentative et rend l'unité à sa lane", async () => {
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    const id = await tentativeOuverte(h);

    // Tant que la session tient le bail, l'outil refuse : une décision durable
    // exige la capacité, ici comme partout ailleurs.
    const tenu = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(tenu.ok, false);
    assert.match(tenu.out, /tenu par une autre session/);

    // L'opérateur agit hors session, comme il le ferait vraiment.
    await h.evenement("session_shutdown")?.();
    const r = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(r.ok, true, r.out);

    const ledger = readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8");
    assert.match(ledger, /"event":"CLOSED".*"outcome":"returned-to-lane"/);
    // Le contexte est parti, la lane est intacte, et W03 n'est pas abandonnée.
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), false);
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /ABANDONED/);
    assert.equal(
      readFileSync(join(h.root, ".git", "pi-lanes", `${h.runId}-W03`, "src", "a.py"), "utf-8"),
      "a = 'lane'\n",
    );

    // Et le runtime redémarré laisse repartir le worker.
    process.chdir(REPO);
    h2 = await monter({ reprendre: h.root });
    assert.equal(enErreur(await h2.outil.execute("1", tache("W03"))), false);
  } finally {
    (h2 ?? h).done();
  }
});

test("discard-context refuse une tentative vivante et accepte un résidu", async () => {
  const h = await monter();
  try {
    const id = await tentativeOuverte(h);
    await h.evenement("session_shutdown")?.();
    const refus = recover(h.root, ["attempt", id, "discard-context"]);
    assert.equal(refus.ok, false);
    assert.match(refus.out, /encore vivante/);
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), true);

    // Une fois close, le contexte devient un résidu retirable — et le retirer
    // n'ajoute aucun événement métier : il n'y a rien de nouveau à raconter.
    const ledgerPath = join(h.runDir, `${h.runId}-integrations.jsonl`);
    appendFileSync(ledgerPath,
      `${JSON.stringify({ event: "CLOSED", id, outcome: "returned-to-lane", at: "t" })}\n`);
    const avant = readFileSync(ledgerPath, "utf-8");

    const ok = recover(h.root, ["attempt", id, "discard-context"]);
    assert.equal(ok.ok, true, ok.out);
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), false);
    assert.equal(readFileSync(ledgerPath, "utf-8"), avant, "le registre est inchangé");

    // Et l'autre verbe n'a plus d'objet : une tentative terminée ne se clôt pas
    // deux fois, et le dire éviterait un second `CLOSED` sur la même histoire.
    const tard = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(tard.ok, false);
    assert.match(tard.out, /déjà terminée/);
    assert.equal(readFileSync(ledgerPath, "utf-8"), avant);
  } finally {
    h.done();
  }
});

test("l'outil n'intègre jamais M lui-même", async () => {
  /*
   * Le runtime sait déjà faire atterrir un commit vérifié. Donner un second
   * chemin à l'outil créerait deux mécanismes concurrents capables d'intégrer,
   * et le diagnostic doit donc renvoyer vers celui qui existe.
   */
  const h = await monter();
  try {
    await conflit(h);
    await h.outil.execute("2", revueDe("approved"));
    PILOTE.resultat = undefined;
    PILOTE.pendant = (appel) => {
      writeFileSync(join(appel.cwd!, "src", "a.py"), "a = 'résolu'\n");
    };
    await h.outil.execute("3", { agent: "integration-worker", work_unit: "W03", task: "résoudre" });
    PILOTE.pendant = () => { writeFileSync(join(h.root, "brouillon.txt"), "non suivi\n"); };
    PILOTE.resultat = { verdict: "approved" } as never;
    await h.outil.execute("4", revueDe("approved"));
    PILOTE.pendant = undefined;
    PILOTE.resultat = undefined;
    rmSync(join(h.root, "brouillon.txt"));

    const tete = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf-8" }).trim();
    const r = recover(h.root, ["attempts"]);
    assert.match(r.out, /état\s+ready-to-land/);
    assert.match(r.out, /le runtime refera atterrir M lui-même/);
    assert.doesNotMatch(r.out, /return-to-lane/);
    // Et rien n'a bougé.
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf-8" }).trim(), tete);
    assert.doesNotMatch(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), /INTEGRATED/);
  } finally {
    h.done();
  }
});

test("un contexte sans provenance n'a pas de verbe", async () => {
  const h = await monter();
  try {
    const id = await tentativeOuverte(h);
    rmSync(join(h.runDir, `${h.runId}-integrations.jsonl`));

    const vu = recover(h.root, ["attempts"]);
    assert.equal(vu.ok, true, vu.out);
    assert.match(vu.out, /aucune provenance au registre/);
    assert.match(vu.out, /ne se clôt pas, il se comprend/);

    // Et aucun verbe ne s'applique : rien n'est fabriqué pour le faire taire.
    const r = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(r.ok, false);
    assert.match(r.out, /n'existe pas au registre/);
  } finally {
    h.done();
  }
});

test("un lane ledger corrompu ferme le runtime et l'outil de la même façon", async () => {
  /*
   * La divergence que l'observateur partagé supprime.
   *
   * Le runtime réutilisait le snapshot validé du registre des lanes ; l'outil en
   * faisait une seconde lecture sans en regarder ni la version ni les lignes
   * abîmées. Un registre corrompu fermait donc le run pendant que l'outil
   * calculait tranquillement et acceptait de trancher — un opérateur et un
   * runtime qui regardent le même disque et concluent deux états différents.
   */
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    const id = await tentativeOuverte(h);
    await h.evenement("session_shutdown")?.();
    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "{ pas du json\n");

    // L'outil refuse de montrer, et refuse surtout de trancher.
    const vu = recover(h.root, ["attempts"]);
    assert.equal(vu.ok, false, vu.out);
    assert.match(vu.out, /registre des lanes est inexploitable/);

    const ledgerAvant = readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8");
    const r = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(r.ok, false);
    assert.match(r.out, /registre des lanes est inexploitable/);
    assert.equal(
      readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8"),
      ledgerAvant,
      "aucune mutation avant le refus",
    );
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), true);

    // Et le runtime refuse aussi, pour la même raison.
    process.chdir(REPO);
    h2 = await monter({ reprendre: h.root });
    const d = await h2.outil.execute("1", tache("W09"));
    assert.ok(enErreur(d), texte(d));
  } finally {
    (h2 ?? h).done();
  }
});

test("un contexte verrouillé fait échouer le retrait au lieu de l'annoncer", async () => {
  /*
   * `removeIntegration` rend un booléen et ne jette pas. L'ignorer faisait
   * annoncer « close, l'unité repart en lane » avec un contexte toujours là —
   * et sortir en succès. `git worktree lock` fournit exactement cette panne.
   */
  const h = await monter();
  try {
    const id = await tentativeOuverte(h);
    await h.evenement("session_shutdown")?.();
    execFileSync("git", ["worktree", "lock", join(h.root, ".git", "pi-integrations", id)],
      { cwd: h.root });

    const r = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /n'a pas pu être retiré/);
    assert.match(r.out, /discard-context/, "l'outil dit ce qu'il reste à faire");

    // La décision durable, elle, est bien passée : on ne défait pas un CLOSED.
    assert.match(readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8"),
      /"event":"CLOSED"/);
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), true);

    // Et l'état est un résidu nommé, pas une contradiction.
    const vu = recover(h.root, ["attempts"]);
    assert.equal(vu.ok, true, vu.out);
    assert.match(vu.out, /close \(returned-to-lane\)/);
    assert.doesNotMatch(vu.out, /contradictions/);

    execFileSync("git", ["worktree", "unlock", join(h.root, ".git", "pi-integrations", id)],
      { cwd: h.root });
    const range = recover(h.root, ["attempt", id, "discard-context"]);
    assert.equal(range.ok, true, range.out);
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), false);
  } finally {
    h.done();
  }
});

test("return-to-lane refuse quand la lane n'existe plus, et garde le contexte", async () => {
  /*
   * Le cas le plus dangereux des deux verbes.
   *
   * `P2` existe ne prouve pas que la lane existe : tant que le contexte
   * d'intégration est là, il tient cette référence à lui seul. Clore la
   * tentative et retirer son contexte supprimerait alors la dernière chose qui
   * protège le travail gelé — au moment précis où l'outil annonce l'avoir rendu
   * à une lane qui n'est plus là. Un SHA dans un JSONL, promis au
   * ramasse-miettes.
   */
  const h = await monter();
  try {
    const id = await tentativeOuverte(h);
    await h.evenement("session_shutdown")?.();

    const p2 = JSON.parse(
      readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8")
        .split("\n").filter(Boolean)[1],
    ).p2;

    // La lane disparaît sous la tentative.
    execFileSync("git", ["worktree", "remove", "--force",
      join(h.root, ".git", "pi-lanes", `${h.runId}-W03`)], { cwd: h.root });
    // Et `P2` est toujours là — c'est bien le contexte qui le tient.
    execFileSync("git", ["cat-file", "-e", `${p2}^{commit}`], { cwd: h.root });

    const ledgerAvant = readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8");
    const r = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /n'a pas de lane où revenir/);
    assert.match(r.out, /la référence qui protège le travail gelé/);

    // Rien n'a été décidé, et rien n'a été retiré.
    assert.equal(readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8"), ledgerAvant);
    assert.doesNotMatch(ledgerAvant, /CLOSED/);
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), true);
    execFileSync("git", ["cat-file", "-e", `${p2}^{commit}`], { cwd: h.root });
  } finally {
    h.done();
  }
});

test("return-to-lane refuse une unité que le registre ne donne plus ouverte", async () => {
  /*
   * L'autre moitié de la garde. Une lane sans contradiction mais déjà intégrée
   * — ou abandonnée — n'est pas un endroit où revenir non plus : le registre
   * dit qu'elle a fini son cycle, et y renvoyer une unité inventerait une suite
   * que rien n'attend.
   */
  const h = await monter();
  try {
    const id = await tentativeOuverte(h);
    await h.evenement("session_shutdown")?.();

    // La lane est déclarée abandonnée, et son worktree retiré : plus de
    // contradiction, mais plus d'unité ouverte non plus.
    execFileSync("git", ["worktree", "remove", "--force",
      join(h.root, ".git", "pi-lanes", `${h.runId}-W03`)], { cwd: h.root });
    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "ABANDONED", work_unit: "W03", at: "t", reason: "opérateur" })}\n`);

    const ledgerAvant = readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8");
    const r = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /n'a pas de lane où revenir/);
    assert.equal(readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8"), ledgerAvant);
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), true);
  } finally {
    h.done();
  }
});

// ------------------------------------------- l'abandon d'une unité

test("abandonner range le worktree et ne laisse pas de résidu", async () => {
  /*
   * Le verbe n'écrivait que l'événement. La réconciliation voyait alors une
   * unité abandonnée dont le worktree est encore là — `residu-d-abandon`, une
   * contradiction qui ferme le run au tour suivant. L'outil créait donc le
   * problème qu'il venait résoudre, une contradiction plus loin.
   */
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    // Une lane ouverte, du travail dedans, et une contradiction à trancher.
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    PILOTE.pendant = () => { writeFileSync(join(laneDir, "src", "a.py"), "a = 'lane'\n"); };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.evenement("session_shutdown")?.();

    /*
     * Une unité que le registre dit intégrée sans que git le montre —
     * `integration-non-confirmee` — et dont le worktree est bien là. C'est le
     * cas où l'abandon doit ranger quelque chose.
     */
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf-8" }).trim();
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W09`,
      join(h.root, ".git", "pi-lanes", `${h.runId}-W09`)], { cwd: h.root, stdio: "pipe" });
    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "OPENED", work_unit: "W09", at: "t", base })}\n` +
      `${JSON.stringify({ event: "INTEGRATED", work_unit: "W09", at: "t" })}\n`);
    assert.equal(existsSync(join(h.root, ".git", "pi-lanes", `${h.runId}-W09`)), true);

    const r = recover(h.root, ["W09", "abandoned"]);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /worktree rangé/);
    assert.equal(existsSync(join(h.root, ".git", "pi-lanes", `${h.runId}-W09`)), false);
    // La branche survit : elle porte le travail abandonné.
    execFileSync("git", ["rev-parse", `pi-lane/${h.runId}-W09`], { cwd: h.root, stdio: "pipe" });

    // Et le run rouvre : aucun résidu d'abandon.
    process.chdir(REPO);
    h2 = await monter({ reprendre: h.root });
    const d = await h2.outil.execute("1", tache("W03"));
    assert.equal(enErreur(d), false, texte(d));
  } finally {
    (h2 ?? h).done();
  }
});

test("abandonner refuse une lane dont le travail n'est pas dans sa branche", async () => {
  /*
   * Le cas destructif : branche sur A, worktree portant B non commité, unité
   * déclarée intégrée sans que git le confirme. La réconciliation classe
   * `integration-non-confirmee` sans que le contrôle de saleté ait eu
   * l'occasion de dire quoi que ce soit, et l'abandon retirait alors un
   * worktree dont le contenu n'existait nulle part ailleurs.
   */
  const h = await monter();
  try {
    // Une délégation d'abord : c'est elle qui crée le registre des lanes avec
    // son en-tête versionné.
    await h.outil.execute("1", tache("W03"));
    await h.evenement("session_shutdown")?.();

    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf-8" }).trim();
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W09`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W09`, laneDir],
      { cwd: h.root, stdio: "pipe" });
    // A : commité sur la branche.
    writeFileSync(join(laneDir, "src", "a.py"), "a = 'A commité'\n");
    execFileSync("git", ["-C", laneDir, "add", "-A"], { cwd: h.root });
    execFileSync("git", ["-C", laneDir, "commit", "-qm", "chore(subagent): freeze"], { cwd: h.root });
    const tipA = execFileSync("git", ["rev-parse", `pi-lane/${h.runId}-W09`],
      { cwd: h.root, encoding: "utf-8" }).trim();
    // B : présent seulement dans le worktree.
    writeFileSync(join(laneDir, "src", "a.py"), "a = 'B non commité'\n");

    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "OPENED", work_unit: "W09", at: "t", base })}\n` +
      `${JSON.stringify({ event: "INTEGRATED", work_unit: "W09", at: "t" })}\n`);
    const ledgerAvant = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");

    const r = recover(h.root, ["W09", "abandoned"]);
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /retirer ce worktree le détruirait/);

    // Rien n'a été décidé, rien n'a été détruit.
    assert.equal(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), ledgerAvant);
    assert.doesNotMatch(ledgerAvant, /ABANDONED/);
    assert.equal(existsSync(laneDir), true);
    assert.equal(readFileSync(join(laneDir, "src", "a.py"), "utf-8"), "a = 'B non commité'\n");
    assert.equal(
      execFileSync("git", ["rev-parse", `pi-lane/${h.runId}-W09`], { cwd: h.root, encoding: "utf-8" }).trim(),
      tipA,
    );
  } finally {
    h.done();
  }
});

// --------------------------------------------------- le nettoyage terminal

test("le nettoyage montre avant d'agir, et n'écrit aucun événement", async () => {
  /*
   * L'invariant transversal, éprouvé de bout en bout : après chaque suppression
   * il doit rester une preuve du contenu que l'objet supprimé pouvait porter.
   * Ici, `M` pour l'unité intégrée — donc son worktree et sa branche partent.
   */
  const h = await monter();
  try {
    // W03 intégrée avec preuve durable, worktree encore là.
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    PILOTE.pendant = () => { writeFileSync(join(laneDir, "src", "a.py"), "a = 'lane'\n"); };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    PILOTE.resultat = { verdict: "approved", changedFiles: [] } as never;
    await h.outil.execute("2", { agent: "reviewer", work_unit: "W03", task: "juger" });
    PILOTE.resultat = undefined;
    await h.evenement("session_shutdown")?.();

    const ledgerAvant = readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8");
    assert.match(ledgerAvant, /"integration_commit"/);

    // Sans --apply : il montre et ne touche à rien.
    const vu = recover(h.root, ["cleanup"]);
    assert.equal(vu.ok, true, vu.out);
    assert.match(vu.out, /relancer avec --apply/);
    assert.equal(
      execFileSync("git", ["branch", "--list", `pi-lane/${h.runId}-W03`],
        { cwd: h.root, encoding: "utf-8" }).trim().length > 0,
      true,
    );

    const fait = recover(h.root, ["cleanup", "--apply"]);
    assert.equal(fait.ok, true, fait.out);
    assert.match(fait.out, new RegExp(`retiré  pi-lane/${h.runId}-W03`));

    // La branche est partie, le travail est dans l'intégration.
    assert.equal(
      execFileSync("git", ["branch", "--list", `pi-lane/${h.runId}-W03`],
        { cwd: h.root, encoding: "utf-8" }).trim(),
      "",
    );
    assert.equal(readFileSync(join(h.root, "src", "a.py"), "utf-8"), "a = 'lane'\n");
    // Et aucun événement n'a été écrit : le nettoyage ne décide de rien.
    assert.equal(readFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "utf-8"), ledgerAvant);
  } finally {
    h.done();
  }
});

test("le nettoyage conserve ce qui porte encore du contenu, et dit pourquoi", async () => {
  const h = await monter();
  try {
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    PILOTE.pendant = () => { writeFileSync(join(laneDir, "src", "a.py"), "a = 'lane'\n"); };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.evenement("session_shutdown")?.();

    // Une unité abandonnée, worktree propre : le worktree part, la branche non.
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf-8" }).trim();
    const w09 = join(h.root, ".git", "pi-lanes", `${h.runId}-W09`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W09`, w09],
      { cwd: h.root, stdio: "pipe" });
    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "OPENED", work_unit: "W09", at: "t", base })}\n` +
      `${JSON.stringify({ event: "ABANDONED", work_unit: "W09", at: "t" })}\n`);

    const vu = recover(h.root, ["cleanup"]);
    assert.match(vu.out, new RegExp(`worktree  ${h.runId}-W09`));
    assert.match(vu.out, /seule référence vers son travail/);
    assert.doesNotMatch(vu.out, new RegExp(`branche   pi-lane/${h.runId}-W09`));

    const fait = recover(h.root, ["cleanup", "--apply"]);
    assert.equal(fait.ok, true, fait.out);
    assert.equal(existsSync(w09), false, "le worktree propre est parti");
    execFileSync("git", ["rev-parse", `pi-lane/${h.runId}-W09`], { cwd: h.root, stdio: "pipe" });
  } finally {
    h.done();
  }
});

test("le nettoyage ne touche pas un worktree sale", async () => {
  const h = await monter();
  try {
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    PILOTE.pendant = () => { writeFileSync(join(laneDir, "src", "a.py"), "a = 'lane'\n"); };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.evenement("session_shutdown")?.();

    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf-8" }).trim();
    const w09 = join(h.root, ".git", "pi-lanes", `${h.runId}-W09`);
    execFileSync("git", ["worktree", "add", "-b", `pi-lane/${h.runId}-W09`, w09],
      { cwd: h.root, stdio: "pipe" });
    writeFileSync(join(w09, "src", "a.py"), "a = 'travail non commité'\n");
    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`),
      `${JSON.stringify({ event: "OPENED", work_unit: "W09", at: "t", base })}\n` +
      `${JSON.stringify({ event: "ABANDONED", work_unit: "W09", at: "t" })}\n`);

    recover(h.root, ["cleanup", "--apply"]);
    assert.equal(existsSync(w09), true, "un worktree sale ne se range pas");
    assert.equal(readFileSync(join(w09, "src", "a.py"), "utf-8"), "a = 'travail non commité'\n");
  } finally {
    h.done();
  }
});

test("le nettoyage refuse d'agir sous une session qui tient le run, mais montre", async () => {
  /*
   * Observer n'exige pas la propriété : le plan se lit toujours. Agir l'exige —
   * retirer un worktree sous une session qui travaille dedans serait un dégât,
   * et le plan appliqué doit être celui qu'on a lu sous le bail, pas celui d'un
   * monde qui a pu changer entre-temps.
   */
  const h = await monter();
  try {
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    PILOTE.pendant = () => { writeFileSync(join(laneDir, "src", "a.py"), "a = 'lane'\n"); };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    PILOTE.resultat = { verdict: "approved", changedFiles: [] } as never;
    await h.outil.execute("2", { agent: "reviewer", work_unit: "W03", task: "juger" });
    PILOTE.resultat = undefined;

    // La session tient encore le run : le dry-run passe.
    const vu = recover(h.root, ["cleanup"]);
    assert.equal(vu.ok, true, vu.out);
    assert.match(vu.out, new RegExp(`branche   pi-lane/${h.runId}-W03`));

    // L'application, non — et rien n'est supprimé.
    const refus = recover(h.root, ["cleanup", "--apply"]);
    assert.equal(refus.ok, false, refus.out);
    assert.match(refus.out, /tenu par une autre session/);
    assert.notEqual(
      execFileSync("git", ["branch", "--list", `pi-lane/${h.runId}-W03`],
        { cwd: h.root, encoding: "utf-8" }).trim(),
      "",
    );

    // Le bail rendu, l'application passe.
    await h.evenement("session_shutdown")?.();
    const fait = recover(h.root, ["cleanup", "--apply"]);
    assert.equal(fait.ok, true, fait.out);
    // Le plan appliqué est affiché juste avant d'agir.
    assert.match(fait.out, /à retirer :/);
    assert.match(fait.out, new RegExp(`retiré  pi-lane/${h.runId}-W03`));
  } finally {
    h.done();
  }
});

// ------------------------- un registre partiel ne reconstruit rien, nulle part

test("un registre de lanes amputé ferme le runtime et l'outil de la même façon", async () => {
  /*
   * Le runtime tenait déjà cette règle ; l'outil calculait un bilan sur les
   * événements encore lisibles, et pouvait en tirer un plan de suppression. Les
   * lignes illisibles pouvaient précisément être celles qui protégeaient ce
   * qu'il allait retirer.
   */
  const h = await monter();
  let h2: Awaited<ReturnType<typeof monter>> | undefined;
  try {
    const laneDir = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`);
    PILOTE.pendant = () => { writeFileSync(join(laneDir, "src", "a.py"), "a = 'lane'\n"); };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    PILOTE.resultat = { verdict: "approved", changedFiles: [] } as never;
    await h.outil.execute("2", { agent: "reviewer", work_unit: "W03", task: "juger" });
    PILOTE.resultat = undefined;
    await h.evenement("session_shutdown")?.();

    // Le plan existe tant que le registre est lisible.
    assert.match(recover(h.root, ["cleanup"]).out, new RegExp(`pi-lane/${h.runId}-W03`));

    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "{ pas du json\n");

    const vu = recover(h.root, ["cleanup"]);
    assert.equal(vu.ok, false, vu.out);
    assert.match(vu.out, /registre des lanes est inexploitable/);

    const applique = recover(h.root, ["cleanup", "--apply"]);
    assert.equal(applique.ok, false, applique.out);
    // Rien n'a été retiré : ni la branche, ni le worktree.
    assert.notEqual(
      execFileSync("git", ["branch", "--list", `pi-lane/${h.runId}-W03`],
        { cwd: h.root, encoding: "utf-8" }).trim(),
      "",
    );

    // Et le runtime refuse aussi, pour la même raison.
    process.chdir(REPO);
    h2 = await monter({ reprendre: h.root });
    const d = await h2.outil.execute("1", tache("W09"));
    assert.ok(enErreur(d), texte(d));
  } finally {
    (h2 ?? h).done();
  }
});

test("une version de registre inconnue ferme le nettoyage", async () => {
  const h = await monter();
  try {
    await h.outil.execute("1", tache("W03"));
    await h.evenement("session_shutdown")?.();
    const p = join(h.runDir, `${h.runId}-lanes.jsonl`);
    writeFileSync(p, readFileSync(p, "utf-8").replace('{"ledger":1}', '{"ledger":2}'));

    const vu = recover(h.root, ["cleanup"]);
    assert.equal(vu.ok, false, vu.out);
    assert.match(vu.out, /version 2 au lieu de 1/);
  } finally {
    h.done();
  }
});

test("un registre de lanes amputé ferme aussi les verbes de tentative", async () => {
  // `exigerLanes` garde tous les chemins de l'outil, pas seulement le nettoyage.
  const h = await monter();
  try {
    const id = await tentativeOuverte(h);
    await h.evenement("session_shutdown")?.();
    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "{ pas du json\n");

    const ledgerAvant = readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8");
    const r = recover(h.root, ["attempt", id, "return-to-lane"]);
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /registre des lanes est inexploitable/);
    assert.equal(readFileSync(join(h.runDir, `${h.runId}-integrations.jsonl`), "utf-8"), ledgerAvant);
    assert.equal(existsSync(join(h.root, ".git", "pi-integrations", id)), true);
  } finally {
    h.done();
  }
});

// ------------------------------------------------------------------ le relevé

/** Appeler une commande de pi et récupérer ce qu'elle a notifié. */
async function commander(h: Awaited<ReturnType<typeof monter>>, nom: string) {
  const dits: { texte: string; niveau?: string }[] = [];
  const handler = h.commande(nom);
  assert.ok(handler, `la commande ${nom} n'est pas enregistrée`);
  await handler({}, { ui: { notify: (t: string, k?: string) => dits.push({ texte: t, niveau: k }) } });
  assert.equal(dits.length, 1, "une commande dit une chose, une fois");
  return dits[0];
}

test("le relevé nomme le run, ses unités et ce que sa reconstruction a coûté", async () => {
  const h = await monter();
  try {
    await h.outil.execute("1", tache("W03"));

    const dit = await commander(h, "subagent-report");
    assert.equal(dit.niveau, "info");
    assert.match(dit.texte, new RegExp(`run ${h.runId}`));
    assert.match(dit.texte, /W03/);
    assert.match(dit.texte, /reconstruction : \d+ ms, \d+ invocation\(s\) git/);

    const sondes = Number(/(\d+) invocation\(s\) git/.exec(dit.texte)![1]);
    assert.ok(sondes > 0, "une reconstruction sonde git : un zéro voudrait dire qu'elle n'a pas eu lieu");
  } finally {
    h.done();
  }
});

test("le relevé reconstruit : ce qui est apparu depuis la dernière reprise y figure", async () => {
  /*
   * La contrainte est « aucune reconstruction indépendante », pas « ne rien
   * relire ». Un relevé bâti sur le snapshot du chargement décrirait un disque
   * qui n'existe plus ; un relevé qui collecterait de son côté décrirait un état
   * que le runtime n'a jamais eu. Passer par `reconstruire()` évite les deux, et
   * c'est ce que cette branche créée derrière le dos du runtime prouve.
   */
  const h = await monter();
  try {
    await h.outil.execute("1", tache("W03"));
    execFileSync("git", ["branch", `pi-lane/${h.runId}-W99`], { cwd: h.root });

    const dit = await commander(h, "subagent-report");
    assert.match(dit.texte, /W99/, "le relevé a bien reconstruit avant de projeter");
  } finally {
    h.done();
  }
});

test("deux relevés successifs : chacun le compte de sa propre reconstruction", async () => {
  const h = await monter();
  try {
    await h.outil.execute("1", tache("W03"));
    const sondesDe = (t: string) => Number(/(\d+) invocation\(s\) git/.exec(t)![1]);

    const un = sondesDe((await commander(h, "subagent-report")).texte);
    const deux = sondesDe((await commander(h, "subagent-report")).texte);

    assert.ok(un > 0);
    assert.equal(deux, un, "le second ne porte pas le premier : un delta, jamais un cumul");
  } finally {
    h.done();
  }
});

test("runtime et outil décrivent le même run", async () => {
  /*
   * La divergence de 3c.1 transposée à un rapport : deux surfaces qui regardent
   * le même disque et publient deux états. Elles passent par les mêmes
   * observateurs et la même projection ; ce test le vérifie plutôt que de le
   * supposer.
   */
  const h = await monter();
  try {
    await h.outil.execute("1", tache("W03"));
    execFileSync("git", ["branch", `pi-lane/${h.runId}-W99`], { cwd: h.root });

    const outil = recover(h.root, ["report", "--json"]);
    assert.equal(outil.ok, true, outil.out);
    const releve = JSON.parse(outil.out);
    const dit = (await commander(h, "subagent-report")).texte;

    assert.equal(releve.run.run_id, h.runId);
    for (const u of [...releve.work_units.open, ...releve.physical_state.lane_branches]) {
      assert.match(dit, new RegExp(u), `${u} vu par l'outil, absent du relevé du runtime`);
    }
    assert.deepEqual(releve.physical_state.lane_branches.sort(), ["W03", "W99"]);
  } finally {
    h.done();
  }
});

test("le relevé de l'outil ne sonde rien de plus que sa reconstruction", async () => {
  const h = await monter();
  try {
    await h.outil.execute("1", tache("W03"));
    const r = recover(h.root, ["report", "--json"]);
    assert.equal(r.ok, true, r.out);
    const releve = JSON.parse(r.out);

    assert.ok(releve.performance.git_probe_count > 0);
    assert.equal(
      releve.performance.run_branch_count,
      releve.physical_state.lane_branches.length,
      "le compte des branches se déduit de l'observation, il ne se resonde pas",
    );
    assert.ok(releve.performance.recovery_scan_ms >= 0);
  } finally {
    h.done();
  }
});

test("registre de lanes amputé : aucun relevé, ni au runtime ni à l'outil", async () => {
  /*
   * La même session, sans redémarrage — c'est le cas fort. Au chargement, le
   * registre était bon et le snapshot valide ; il est ensuite amputé. Un runtime
   * qui garderait la vue précédente publierait un relevé propre sur un disque
   * qu'il vient justement de renoncer à lire, et ce serait pire qu'un refus :
   * ce serait un rapport crédible.
   */
  const h = await monter();
  try {
    await h.outil.execute("1", tache("W03"));
    assert.match((await commander(h, "subagent-report")).texte, /reconstruction : /);

    appendFileSync(join(h.runDir, `${h.runId}-lanes.jsonl`), "{ pas du json\n");

    const dit = await commander(h, "subagent-report");
    assert.equal(dit.niveau, "error");
    assert.match(dit.texte, /inexploitable/);
    assert.doesNotMatch(dit.texte, /reconstruction : /, "aucun relevé n'est publié");

    const r = recover(h.root, ["report"]);
    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /registre des lanes est inexploitable/);
  } finally {
    h.done();
  }
});
