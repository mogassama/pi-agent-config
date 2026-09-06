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
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync,
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
async function monter() {
  const root = mkdtempSync(join(tmpdir(), "pi-exec-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  const avant = process.cwd();
  const agentAvant = process.env.PI_AGENT_DIR;
  // L'extension lit ses définitions d'agents depuis `PI_AGENT_DIR` : le dépôt
  // lui-même les fournit, ce qui évite de dépendre du `~/.pi/agent` de la
  // machine et fait tourner le harnais partout de la même façon.
  process.env.PI_AGENT_DIR = REPO;
  process.chdir(root);
  reinitialiser();

  compteur += 1;
  const module = await import(`../extensions/subagent/index.ts?scenario=${compteur}`);

  // Une API de pi qui ne fait que retenir ce qu'on lui donne.
  let outil: { execute: (id: string, params: unknown, ctx?: unknown) => Promise<unknown> } | undefined;
  const evenements = new Map<string, (...a: unknown[]) => unknown>();
  const pi = {
    on: (nom: string, h: (...a: unknown[]) => unknown) => evenements.set(nom, h),
    registerTool: (t: unknown) => {
      outil = t as typeof outil;
    },
    ui: { setStatus: () => {}, setFooter: () => {} },
  };
  module.default(pi);

  // Le plan gelé, écrit là où le runtime le cherche.
  const manifeste = readManifest(join(root, RUNS));
  mkdirSync(join(root, RUNS), { recursive: true });
  writeFileSync(join(root, RUNS, `${manifeste!.runId}-plan.json`), JSON.stringify(PLAN));

  return {
    root,
    runDir: join(root, RUNS),
    runId: manifeste!.runId,
    outil: outil!,
    evenement: (nom: string) => evenements.get(nom),
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
