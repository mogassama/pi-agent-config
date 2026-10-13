/**
 * Extension de test : stimuli des contre-épreuves et témoins des voies aveugles.
 *
 * Le comportement est choisi par le champ `epreuves` du scénario
 * (`PI_CONTRATS_SCENARIO`). Sans épreuve déclarée, l'extension n'enregistre
 * rien et ne fait rien.
 *
 * - `import-hors-racine` : importe `horsRacine`, un module .ts posé hors des
 *   racines admises (voie jiti, M2.11) ;
 * - `require-pi-ai` : fait charger par Node le `dist/index.js` de pi-ai
 *   installé (M2.16) ;
 * - `ecrire-pi-reel` : ajoute une ligne à `cible`, dans un faux « .pi réel »
 *   (M6.13) ;
 * - `redefinir-read` : enregistre un outil `read` (C3.2) ;
 * - `submit-epreuve` : enregistre un outil `submit` de test, dont le résultat
 *   porte des `details` explicites (C7.5). Il qualifie la transmission par le
 *   SDK, pas le contrat métier de l'enveloppe ;
 * - `temoins` : atteint chaque voie aveugle une fois, pour prouver que son
 *   instrument la voit (dlopen d'un faux `.node`, lecture d'un `.wasm`,
 *   Worker de fichier, Worker `eval`, Worker vivant arrêté par terminate(),
 *   processus fils, import `data:`).
 *
 * Item 1 (les textes viennent du scénario, déclarés dans scenarios.ts) :
 * - `bloquer-write` / `laisser-write` (C4.1) : `tool_call` d'un `write` rend
 *   `{block:true, reason}` ou `{block:false}` ;
 * - `chaine-tool-result` (C4.2) : `tool_result` d'un `write` ajoute un bloc
 *   `text` déclaré au contenu reçu, sans rien retirer ;
 * - `prompt-marqueur` / `prompt-undefined` (C4.3) : `before_agent_start`
 *   consigne la base reçue, avant tout effet, puis rend `{systemPrompt: base +
 *   marqueur}` ou `undefined` ;
 * - `outil-signal` (C5.7) : outil `sondeargs` dont `execute` consigne le nombre
 *   et la nature de ses arguments ;
 * - `commande-a` (C6.2) : enregistre la commande `contrats-epreuve-a` ;
 * - `lancer` (M6.15) : lance `lancement.commande` sans argument, par son nom,
 *   avec les options déclarées (PATH préfixé, shell, octets ajoutés avant).
 */
import { readFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { Type } from "typebox";

type Scenario = {
  epreuves?: string[];
  horsRacine?: string;
  piAi?: string;
  cible?: string;
  fauxNode?: string;
  fauxWasm?: string;
  outilFils?: string;
  fichierWorker?: string;
  fichierWorkerVivant?: string;
  raisonBlocage?: string;
  ajoutToolResult?: string;
  marqueurPrompt?: string;
  lancement?: { commande: string; prefixePath?: string; shell?: boolean; modifier?: string };
};

const scenario: Scenario = JSON.parse(readFileSync(process.env.PI_CONTRATS_SCENARIO!, "utf8"));
const epreuves = new Set(scenario.epreuves ?? []);
const consigner = (o: unknown) => appendFileSync(process.env.PI_CONTRATS_SONDE!, JSON.stringify({ t: "epreuve", ...(o as object) }) + "\n");

export default async function (pi: any) {
  if (epreuves.has("bloquer-write") || epreuves.has("laisser-write")) {
    pi.on("tool_call", (e: any) => {
      if (e?.toolName !== "write") return undefined;
      return epreuves.has("bloquer-write") ? { block: true, reason: scenario.raisonBlocage } : { block: false };
    });
  }
  if (epreuves.has("chaine-tool-result")) {
    pi.on("tool_result", (e: any) => {
      if (e?.toolName !== "write") return undefined;
      return { content: [...(e.content ?? []), { type: "text", text: scenario.ajoutToolResult }] };
    });
  }
  if (epreuves.has("prompt-marqueur") || epreuves.has("prompt-undefined")) {
    pi.on("before_agent_start", (e: any) => {
      const base = e?.systemPrompt;
      // La base est consignée avant l'effet du gestionnaire.
      consigner({ epreuve: "prompt-base", base: typeof base === "string" ? base : null, type: typeof base });
      return epreuves.has("prompt-marqueur") ? { systemPrompt: `${base}${scenario.marqueurPrompt}` } : undefined;
    });
  }
  if (epreuves.has("outil-signal")) {
    pi.registerTool({
      name: "sondeargs",
      label: "sondeargs (épreuve)",
      description: "Outil de test : consigne la nature de ses arguments.",
      parameters: Type.Object({}),
      async execute(...a: any[]) {
        const nature = (x: unknown) => (x instanceof AbortSignal ? "AbortSignal" : x === null ? "null" : Array.isArray(x) ? "array" : typeof x);
        consigner({ epreuve: "outil-signal", n: a.length, natures: a.map(nature), troisiemeCles: a[2] !== null && typeof a[2] === "object" && !(a[2] instanceof AbortSignal) ? Object.keys(a[2]) : null });
        return { content: [{ type: "text", text: "arguments consignés" }], details: { epreuve: "outil-signal" } };
      },
    });
  }
  if (epreuves.has("commande-a")) {
    pi.registerCommand("contrats-epreuve-a", { description: "Commande de test de l'épreuve (C6.2)", handler: async () => undefined });
  }
  if (epreuves.has("lancer")) {
    const l = scenario.lancement!;
    if (l.modifier) appendFileSync(l.modifier, "\n// octets ajoutés par l'épreuve\n");
    const env = { ...process.env, PATH: l.prefixePath ? `${l.prefixePath}:${process.env.PATH}` : process.env.PATH };
    const r = spawnSync(l.commande, [], { stdio: "ignore", env, shell: l.shell === true });
    consigner({ epreuve: "lancer", commande: l.commande, statut: r.status, erreur: r.error ? String(r.error.message) : null });
  }
  if (epreuves.has("redefinir-read")) {
    pi.registerTool({
      name: "read",
      label: "read (épreuve)",
      description: "Redéfinition d'épreuve de l'outil read.",
      parameters: Type.Object({ path: Type.String() }),
      async execute(_id: string, params: { path: string }) {
        return { content: [{ type: "text", text: `lecture d'épreuve : ${params.path}` }], details: {} };
      },
    });
  }
  if (epreuves.has("submit-epreuve")) {
    pi.registerTool({
      name: "submit",
      label: "submit (épreuve)",
      description: "Outil de test : rend des details explicites.",
      parameters: Type.Object({ valeur: Type.Number() }),
      async execute(_id: string, params: { valeur: number }) {
        return { content: [{ type: "text", text: "accepté" }], details: { epreuve: "submit", valeur: params.valeur, liste: [1, 2, 3] } };
      },
    });
  }
  if (epreuves.has("import-hors-racine")) {
    const m = await import(scenario.horsRacine!);
    consigner({ epreuve: "import-hors-racine", valeur: m.default ?? null });
  }
  if (epreuves.has("require-pi-ai")) {
    const req = createRequire(import.meta.url);
    const m = req(scenario.piAi!);
    consigner({ epreuve: "require-pi-ai", type: typeof m });
  }
  if (epreuves.has("ecrire-pi-reel")) {
    appendFileSync(scenario.cible!, "écrit par une extension d'épreuve\n");
    consigner({ epreuve: "ecrire-pi-reel" });
  }
  if (epreuves.has("temoins")) {
    const req = createRequire(import.meta.url);
    let dlopen = "aucune erreur";
    try {
      req(scenario.fauxNode!);
    } catch (e) {
      dlopen = (e as Error).message.split("\n")[0];
    }
    const wasm = readFileSync(scenario.fauxWasm!).length;
    const fils = spawnSync(scenario.outilFils!, [], { stdio: "ignore" }).status;
    // Un worker de fichier hérite de `--import` ; un worker `eval` ne l'hérite pas.
    const attendre = (w: Worker) => new Promise<number>((ok) => w.on("exit", (c) => ok(c)));
    const worker = await attendre(new Worker(scenario.fichierWorker!));
    const workerEval = await attendre(new Worker("0", { eval: true }));
    // Un worker vivant arrêté par terminate() : sa fin propre est demandée par l'instrument avant l'arrêt.
    const vivant = new Worker(scenario.fichierWorkerVivant!);
    await new Promise((ok) => setTimeout(ok, 300));
    const workerTermine = await vivant.terminate();
    const data = (await import("data:text/javascript,export default 41")).default;
    consigner({ epreuve: "temoins", dlopen, wasm, fils, worker, workerEval, workerTermine, data });
  }
}
