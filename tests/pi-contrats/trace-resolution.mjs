/**
 * Traceur de l'instrument `bin/pi-contrats`, chargé dans pi par `--import`.
 *
 * Il consigne, une ligne JSON par événement, dans le fichier nommé par
 * `PI_CONTRATS_TRACE` :
 * - voie Node : chaque résolution (réussie ou en échec) et chaque chargement
 *   vus par `module.registerHooks` ;
 * - voie jiti : chaque appel de `console.log`, avec le fichier de l'appelant,
 *   pour que le harnais attribue au jiti contrôlé ce qui vient de lui, et à
 *   l'application le reste ;
 * - voies aveugles des deux précédentes (inventaire v2, constat 15) : lecture
 *   d'un `.wasm` ou d'un `.node` par `fs.readFileSync`, `process.dlopen`,
 *   création d'un `Worker`, lancement d'un processus fils, avec son cwd, le
 *   PATH applicable et la résolution de la commande (K7).
 *
 * Chaque fil (principal et workers de fichier, qui héritent de `--import`) écrit
 * un unique `debut`, une unique attestation `enveloppes` et une unique `fin`,
 * qui doit être son dernier événement.
 * Les enveloppes laissent passer l'appel tel quel : elles observent, elles ne
 * décident rien. Toute décision est prise par le harnais, après coup.
 *
 * Processus fils (K7, B3 du 08-10-2026) : le cwd, le PATH applicable et la
 * résolution sont calculés avant le lancement ; l'API est ensuite appelée, puis
 * l'unique événement « fils » est écrit avec le pid réel de l'enfant rendu par
 * l'API (`pid`), ou `pid: null` et le fait qui l'explique (`pidMotif`). Si l'API
 * lève, l'événement est écrit avant de relancer l'exception. Aucun événement
 * supplémentaire n'est ajouté à la trace.
 *
 * Variantes déclarées par le scénario (PI_CONTRATS_SCENARIO), test-only :
 * - `sortiesFils` (C2.5, A1) : pour les lancements asynchrones, code, signal,
 *   stdout et stderr de l'enfant sont consignés à sa fermeture dans
 *   `<PI_CONTRATS_TRACE>.sorties.jsonl`, hors de la trace ; la sortie n'est ni
 *   modifiée ni redirigée ;
 * - `omettreResolution` (M6.15, B6) : pour la commande nommée, l'événement « fils »
 *   omet uniquement le champ `resolution` (capture variante déclarée).
 */
import { registerHooks, syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import childProcess from "node:child_process";
import workerThreads from "node:worker_threads";
import { fileURLToPath } from "node:url";

const cible = process.env.PI_CONTRATS_TRACE;
if (!cible) throw new Error("trace-resolution : PI_CONTRATS_TRACE absent, aucune trace possible");

const ICI = fileURLToPath(import.meta.url);
// Variantes de capture déclarées par le scénario, lues une fois au chargement (aucun événement).
const variantes = (() => {
  try {
    const s = JSON.parse(fs.readFileSync(process.env.PI_CONTRATS_SCENARIO, "utf8"));
    return { sorties: s.sortiesFils === true, omettre: typeof s.omettreResolution === "string" ? s.omettreResolution : null };
  } catch {
    return { sorties: false, omettre: null };
  }
})();
const appendOriginal = fs.appendFileSync;
const fd = fs.openSync(cible, "a");
const th = workerThreads.threadId;
let n = 0;
// Écriture synchrone, une ligne par événement, numérotée par fil : rien n'est
// mis en mémoire tampon, donc un fil interrompu ne perd aucun événement déjà
// survenu, et une ligne manquante se voit à un trou de numérotation.
const ecrire = (o) => {
  n++;
  fs.writeSync(fd, JSON.stringify({ th, seq: n, ...o }) + "\n");
};

// Fin propre de chaque fil : écrite une seule fois. Un événement écrit après elle
// reste écrit, et le harnais le voit. Un Worker arrêté par terminate() ne passe
// par aucun gestionnaire de sortie : son parent lui demande d'abord d'écrire sa
// fin, par un BroadcastChannel distinct du canal de messages du Worker.
const CANAL_FIN = `pi-contrats-fin-${process.pid}`;
let fini = false;
const terminer = (raison, code) => {
  if (fini) return;
  fini = true;
  ecrire({ t: "fin", raison, code: code ?? null });
};
if (!workerThreads.isMainThread) {
  const bc = new workerThreads.BroadcastChannel(CANAL_FIN);
  bc.unref();
  bc.onmessage = (m) => {
    if (m.data?.demande === th) {
      terminer("terminate");
      bc.postMessage({ accuse: th });
    }
  };
}

/** Premier cadre de pile hors de ce fichier : `{ fichier, cadre }`, ou null si la pile est illisible. */
function appelant() {
  const limite = Error.stackTraceLimit;
  Error.stackTraceLimit = 20;
  const pile = new Error().stack;
  Error.stackTraceLimit = limite;
  if (typeof pile !== "string") return null;
  for (const ligne of pile.split("\n").slice(1)) {
    const m = ligne.match(/\(?((?:file:\/\/)?\/[^():]+):\d+:\d+\)?\s*$/);
    if (!m) continue;
    const fichier = m[1].startsWith("file://") ? fileURLToPath(m[1]) : m[1];
    if (fichier === ICI) continue;
    return { fichier, cadre: ligne.trim() };
  }
  return null;
}

ecrire({ t: "debut", pid: process.pid, principal: workerThreads.isMainThread, execArgv: process.execArgv });

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      const r = nextResolve(specifier, context);
      ecrire({ t: "resolve", spec: specifier, parent: context.parentURL ?? null, url: r.url });
      return r;
    } catch (e) {
      ecrire({ t: "resolve-echec", spec: specifier, parent: context.parentURL ?? null, code: e?.code ?? String(e) });
      throw e;
    }
  },
  load(url, context, nextLoad) {
    const r = nextLoad(url, context);
    ecrire({ t: "load", url, format: r.format ?? null });
    return r;
  },
});

// Voie jiti : chaque console.log, avec son appelant.
const logOriginal = console.log;
console.log = function (...args) {
  const a = appelant();
  const texte = args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  ecrire({ t: "console", texte, origine: a?.fichier ?? null, cadre: a?.cadre ?? null });
  return logOriginal.apply(this, args);
};

const lireOriginal = fs.readFileSync;
// Modules intégrés obtenus hors du chargeur ESM : la voie Node tracée reste celle d'etape0-r3.
const crypto = process.getBuiltinModule("node:crypto");
const path = process.getBuiltinModule("node:path");

/**
 * Lancement d'un processus fils (K7) : cwd, PATH effectivement applicable, et résolution de la
 * commande telle que le lancement sans shell la fait (recherche dans ce PATH, entrées relatives
 * et vides prises depuis ce cwd). Observation seulement : la commande n'est ni modifiée ni
 * redirigée. Une résolution que ce calcul ne peut pas établir est consignée comme telle.
 */
function lancement(api, args) {
  const tableau = Array.isArray(args[1]);
  const options = (tableau ? args[2] : args[1]) ?? {};
  const commande = String(args[0]);
  let cwd;
  try {
    const c = options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd;
    cwd = c === undefined || c === null ? process.cwd() : path.resolve(process.cwd(), String(c));
  } catch {
    return { cwd: null, path: null, shell: null, resolution: { etat: "non-etablie", motif: "cwd illisible" } };
  }
  const env = options.env ?? process.env;
  const PATH = typeof env.PATH === "string" ? env.PATH : null;
  const shell = api === "exec" || api === "execSync" || !!options.shell;
  const base = { cwd, path: PATH, shell };
  if (api === "fork") return { ...base, resolution: { etat: "non-etablie", motif: "fork : module Node, sans recherche de commande" } };
  if (shell) return { ...base, resolution: { etat: "non-etablie", motif: "lancement par un shell" } };
  const executable = (f) => {
    try {
      return fs.statSync(f).isFile() && (fs.accessSync(f, fs.constants.X_OK), true);
    } catch {
      return false;
    }
  };
  let trouve = null;
  if (commande.includes("/")) {
    const f = path.resolve(cwd, commande);
    if (executable(f)) trouve = f;
  } else {
    if (PATH === null) return { ...base, resolution: { etat: "non-etablie", motif: "PATH absent de l'environnement applicable" } };
    for (const d of PATH.split(":")) {
      const f = path.join(d === "" ? cwd : path.resolve(cwd, d), commande);
      if (executable(f)) {
        trouve = f;
        break;
      }
    }
  }
  if (trouve === null) return { ...base, resolution: { etat: "introuvable" } };
  try {
    const reel = fs.realpathSync(trouve);
    const sha256 = crypto.createHash("sha256").update(lireOriginal.call(fs, reel)).digest("hex");
    return { ...base, resolution: { etat: "resolue", chemin: trouve, reel, sha256 } };
  } catch (e) {
    return { ...base, resolution: { etat: "non-etablie", motif: `lecture de la cible : ${e?.code ?? String(e)}` } };
  }
}

// Voies aveugles. Les liaisons ESM nommées des modules natifs sont resynchronisées
// plus bas, pour qu'un `import { spawn } from "node:child_process"` voie l'enveloppe.
for (const k of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
  const o = childProcess[k];
  childProcess[k] = function (...args) {
    let l;
    try {
      l = lancement(k, args);
    } catch (e) {
      l = { cwd: null, path: null, shell: null, resolution: { etat: "non-etablie", motif: `calcul impossible : ${e?.message ?? String(e)}` } };
    }
    // Le pid de l'enfant (K7, rattachement des petits-enfants) est relevé après le lancement ;
    // l'événement reste unique et écrit même si le lancement lève.
    const evenement = { t: "fils", api: k, commande: String(args[0]), args: Array.isArray(args[1]) ? args[1].map(String) : null, origine: appelant()?.fichier ?? null, ...l };
    if (variantes.omettre !== null && evenement.commande === variantes.omettre) delete evenement.resolution;
    let r;
    try {
      r = o.apply(this, args);
    } catch (e) {
      ecrire({ ...evenement, pid: null, pidMotif: `exception de l'API : ${e?.code ?? e?.message ?? String(e)}` });
      throw e;
    }
    const pid = typeof r?.pid === "number" ? r.pid : null;
    ecrire({ ...evenement, pid, ...(pid === null ? { pidMotif: r === null || typeof r !== "object" ? `API ${k} sans objet de processus` : "pid absent du résultat de l'API" } : {}) });
    if (variantes.sorties && pid !== null && typeof r?.on === "function") {
      const sorties = { stdout: [], stderr: [] };
      r.stdout?.on?.("data", (d) => sorties.stdout.push(String(d)));
      r.stderr?.on?.("data", (d) => sorties.stderr.push(String(d)));
      r.on("close", (code, signal) => {
        try {
          appendOriginal.call(fs, `${cible}.sorties.jsonl`, JSON.stringify({ pid, commande: evenement.commande, args: evenement.args, code, signal, stdout: sorties.stdout.join(""), stderr: sorties.stderr.join("") }) + "\n");
        } catch {}
      });
    }
    return r;
  };
}
fs.readFileSync = function (p, ...reste) {
  const s = p instanceof URL ? fileURLToPath(p) : typeof p === "string" ? p : null;
  if (s && /\.(wasm|node)$/.test(s)) ecrire({ t: "lecture", chemin: s, origine: appelant()?.fichier ?? null });
  return lireOriginal.call(this, p, ...reste);
};
const dlopenOriginal = process.dlopen;
process.dlopen = function (module, fichier, ...reste) {
  ecrire({ t: "dlopen", chemin: String(fichier), origine: appelant()?.fichier ?? null });
  return dlopenOriginal.call(this, module, fichier, ...reste);
};
const WorkerOriginal = workerThreads.Worker;
workerThreads.Worker = class extends WorkerOriginal {
  constructor(url, options) {
    ecrire({ t: "worker", url: String(url), execArgv: options?.execArgv ?? null, origine: appelant()?.fichier ?? null });
    super(url, options);
    const id = this.threadId;
    let sorti = false;
    let enAttente = null;
    this.on("exit", (code) => {
      sorti = true;
      ecrire({ t: "worker-fin", worker: id, code });
      // Le Worker sortait de lui-même pendant la demande : sa fin vient de son gestionnaire de sortie.
      if (enAttente) enAttente();
    });
    const terminateOriginal = this.terminate.bind(this);
    this.terminate = () =>
      // Un Worker déjà sorti a écrit sa fin par son gestionnaire de sortie : rien à demander.
      sorti ? terminateOriginal() : new Promise((ok, ko) => {
        const bc = new workerThreads.BroadcastChannel(CANAL_FIN);
        let fait = false;
        const suite = () => {
          if (fait) return;
          fait = true;
          enAttente = null;
          clearTimeout(minuteur);
          bc.close();
          terminateOriginal().then(ok, ko);
        };
        enAttente = suite;
        const minuteur = setTimeout(() => {
          ecrire({ t: "fin-sans-accuse", worker: id });
          suite();
        }, 2000);
        bc.onmessage = (m) => {
          if (m.data?.accuse === id) suite();
        };
        bc.postMessage({ demande: id });
      });
    ecrire({ t: "worker-cree", worker: id, url: String(url) });
  }
};
syncBuiltinESMExports();

// Attestation : les liaisons ESM nommées voient bien les enveloppes.
const nsCp = await import("node:child_process");
const nsFs = await import("node:fs");
const nsWt = await import("node:worker_threads");
ecrire({
  t: "enveloppes",
  fils: nsCp.spawn === childProcess.spawn && nsCp.execFile === childProcess.execFile,
  lecture: nsFs.readFileSync === fs.readFileSync,
  worker: nsWt.Worker === workerThreads.Worker,
  dlopen: process.dlopen !== dlopenOriginal,
  console: console.log !== logOriginal,
});

// La fin propre doit être le dernier événement du fil : le gestionnaire de sortie
// est replacé en dernière position chaque fois qu'un autre est ajouté.
const surSortie = (code) => terminer("exit", code);
process.on("exit", surSortie);
process.on("newListener", (nom, f) => {
  if (nom !== "exit" || f === surSortie) return;
  queueMicrotask(() => {
    process.removeListener("exit", surSortie);
    process.on("exit", surSortie);
  });
});
