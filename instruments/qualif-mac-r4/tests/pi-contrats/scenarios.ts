/**
 * Scénarios et vérificateurs purs.
 *
 * Un scénario porte le stimulus (tours du fournisseur scripté, usage,
 * épreuves) et ce que le vérificateur attend. Un vérificateur reçoit des
 * observations déjà lues et rend, par clause, un état parmi « satisfait »,
 * « violé », « indéterminé », avec le compte examiné. Aucun ne lit le disque.
 */
import { createHash } from "node:crypto";
import type { ScenarioFournisseur } from "./fournisseur-scripte.ts";

export type Etat = "satisfait" | "violé" | "indéterminé";
export type Verdict = { clause: string; etat: Etat; compte: number; detail: string };

/**
 * Gardes désarmées. Hors mutant, aucune. Un mutant ciblé de falsifier.sh (B8) inscrit dans une
 * copie du dépôt l'identifiant d'une seule garde dans l'ensemble ci-dessous, sur cette ligne.
 */
const DESARMEES: ReadonlySet<string> = new Set<string>([]);

/**
 * Garde d'un contrôle de vérificateur, identifiée de façon durable : vraie sauf si son identifiant
 * est désarmé par un mutant. Le contrôle ne produit alors aucun écart.
 */
export function garde(id: string): boolean {
  return !DESARMEES.has(id);
}

/**
 * Simulateur déclaré (K7) : posé comme fichier exécutable ordinaire `bin/<nom>` du temporaire.
 * Ses octets sont exactement `#!<node contrôlé>\n` suivi de `source` : l'interprète est déclaré
 * par son chemin absolu (le node vérifié par l'identité) et son empreinte, relevée avant lancement.
 * La source n'emploie que des modules intégrés de Node : aucun sous-programme.
 */
export type Simulateur = { nom: string; source: string };

/** Configuration des témoins et commandes d'attente de la sonde (K6, K9). */
export type ConfigSonde = {
  attendreRapport?: { prefixe: string };
  attendreCompaction?: { customType: string; texteReprise: string };
  compacter?: boolean;
  /** C5, C1.10, C6.5, C6.6 : état de ctx aux phases et dans `/contrats-membres`. */
  membres?: boolean;
  /** Contre-épreuves de compaction : `/contrats-constat`, sans attendre de compaction. */
  constat?: boolean;
  /** C2.6 (b), B5 : `session_shutdown` consigné. */
  cycle?: boolean;
};

export type Scenario = ScenarioFournisseur & {
  prompt: string;
  /** Messages suivants, passés dans l'ordre après `prompt` (print mode : un `prompt` par message). */
  prompts?: string[];
  outils: string;
  /** « dossier » : `--session-dir` temporaire à la place de `--no-session`. */
  session?: "aucune" | "dossier";
  /** K1 : variables complémentaires déclarées, à valeur exacte. */
  envDeclare?: Record<string, string>;
  /** Fichiers posés sous PI_CODING_AGENT_DIR avant lancement, chemin relatif → contenu texte. */
  agentDir?: Record<string, string>;
  /** Simulateurs déclarés, posés dans le bin/ temporaire. */
  simulateurs?: Simulateur[];
  /** Points d'entrée du dépôt chargés par `-e`, chemins relatifs à la copie du candidat. */
  extensionsDepot?: string[];
  sonde?: ConfigSonde;
  epreuves?: string[];
  horsRacine?: string;
  piAi?: string;
  cible?: string;
  fauxNode?: string;
  fauxWasm?: string;
  outilFils?: string;
  fichiers?: Record<string, string>;
  /** `details` attendus, par toolCallId, des résultats d'outils qui en portent. */
  detailsAttendus?: Record<string, unknown>;
  /** Table complète des comptes par type, déclarée explicitement quand le modèle général ne s'applique pas. */
  comptes?: Record<string, number>;
  // ── Item 1 ──
  /**
   * Arguments ajoutés après les drapeaux de session et avant les prompts. Marqueurs remplacés
   * avant lancement : `<TMP>`, `<CWD>`, `<BIN>`, `<AGENTDIR>` (chemins du temporaire).
   */
  argvEnPlus?: string[];
  /** C6.2 (b) seulement : lancement sans `-ne`. */
  sansNe?: boolean;
  /** C4.2 (b) : points d'entrée du dépôt chargés avant extensions-epreuve.ts. */
  depotAvantEpreuve?: boolean;
  /** Fichiers texte posés dans le cwd temporaire avant lancement, chemin relatif → contenu. */
  fichiersCwd?: Record<string, string>;
  /** Fichiers texte posés dans le tmp du temporaire, chemin relatif → contenu. */
  fichiersTmp?: Record<string, string>;
  /** Fichiers du cwd dont le contenu final est relevé (absent : null). */
  releverFichiers?: string[];
  /** K8 : identité Git locale fixée et comptes `git rev-list --count --all` avant et après. */
  gitIdentite?: boolean;
  /** Chemins retirés de la copie du candidat avant lancement (C2.9 b). */
  retirerDuCandidat?: string[];
  /** Point d'entrée de la copie du candidat remplacé par une erreur de syntaxe (contre-épreuve commune de C2). */
  casser?: string;
  /** C2.6 (b) : PI_JOURNAL_PATH vers un dossier en lecture seule du temporaire. */
  journalLectureSeule?: boolean;
  raisonBlocage?: string;
  ajoutToolResult?: string;
  marqueurPrompt?: string;
  lancement?: { commande: string; prefixePath?: string; shell?: boolean; modifier?: string };
  /** A1 : code, signal, stdout et stderr des lancements asynchrones consignés par le traceur. */
  sortiesFils?: boolean;
  /** B6 : capture variante déclarée, l'événement « fils » de cette commande omet `resolution`. */
  omettreResolution?: string;
  /** Fichiers du cwd (ou de `.git/…`) dont le contenu est relevé avant lancement (null : absent). */
  releverAvant?: string[];
};

const USAGE = { input: 100, output: 10, cacheRead: 5, cacheWrite: 0, totalTokens: 115 };

export const NOMINAL: Scenario = {
  nom: "nominal",
  prompt: "liste le dossier",
  outils: "read,ls,grep,find",
  tours: [{ appels: [{ id: "c1", name: "ls", arguments: { path: "." } }] }, { texte: "fini" }],
  usage: USAGE,
  contextWindow: 100000,
};

export const ERREUR_FOURNISSEUR: Scenario = {
  nom: "erreur-fournisseur",
  prompt: "provoque une erreur",
  outils: "read,ls,grep,find",
  tours: [{ erreur: "panne scriptée du fournisseur" }],
  usage: USAGE,
  contextWindow: 100000,
  // Établie depuis la capture réelle sur pi 0.86.0 (étape 0) et déclarée ici :
  // messages système, utilisateur et assistant en erreur ; aucune mise à jour de message.
  comptes: {
    session: 1,
    agent_start: 1,
    turn_start: 1,
    message_start: 3,
    message_end: 3,
    turn_end: 1,
    agent_end: 1,
    agent_settled: 1,
  },
};

/** Redéfinition réelle de `read` par une extension (C3.2). */
export const REDEFINITION_READ: Scenario = { ...NOMINAL, nom: "redefinition-read", epreuves: ["redefinir-read"] };

/** Résultat réel d'un outil `submit` de test, aux `details` explicites (C7.5). */
export const SUBMIT: Scenario = {
  nom: "submit",
  prompt: "soumets",
  outils: "read,ls,grep,find,submit",
  tours: [{ appels: [{ id: "s1", name: "submit", arguments: { valeur: 42 } }] }, { texte: "fini" }],
  usage: USAGE,
  contextWindow: 100000,
  epreuves: ["submit-epreuve"],
  detailsAttendus: { s1: { epreuve: "submit", valeur: 42, liste: [1, 2, 3] } },
};

/** Lecture d'une image : atteint le worker de redimensionnement et le WASM de photon. */
export const IMAGE: Scenario = {
  nom: "image",
  prompt: "lis l'image",
  outils: "read,ls,grep,find",
  tours: [{ appels: [{ id: "c1", name: "read", arguments: { path: "point.png" } }] }, { texte: "vu" }],
  usage: USAGE,
  contextWindow: 100000,
  fichiers: {
    // PNG 1×1, base64.
    "point.png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  },
};

export const TEMOINS: Scenario = { ...NOMINAL, nom: "temoins", epreuves: ["temoins"] };

/** Modules virtuels du bundle 0.86.0 (inventaire v2, § 10 ; `relever-pi.txt`). */
export const VIRTUELS = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-ai/oauth",
  "@earendil-works/pi-ai/providers/all",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-ai/compat",
  "@mariozechner/pi-ai/oauth",
  "@mariozechner/pi-ai/providers/all",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "@sinclair/typebox/compile",
  "@sinclair/typebox/value",
  "typebox",
  "typebox/compile",
  "typebox/value",
];

// ── C3 ────────────────────────────────────────────────────────────────────────

const NATIFS = ["read", "grep", "find", "ls"];

/** C3.1 : provenance des outils natifs observée par la sonde au `session_start`, une entrée exactement par nom. */
export function verifierC3(sonde: any[]): Verdict {
  const ss = sonde.filter((o) => o.t === "session_start");
  if (ss.length !== 1) return { clause: "C3.1", etat: "indéterminé", compte: 0, detail: `${ss.length} observation(s) session_start` };
  const outils: any[] = ss[0].outils ?? [];
  const ecarts: string[] = [];
  let compte = 0;
  for (const n of NATIFS) {
    const entrees = outils.filter((x) => x.nom === n);
    if (entrees.length === 0) {
      if (garde("C3.1/absent")) ecarts.push(`${n} absent`);
      continue;
    }
    compte += entrees.length;
    if (entrees.length > 1) {
      if (garde("C3.1/doublon")) ecarts.push(`${n} : ${entrees.length} entrées`);
      continue;
    }
    const o = entrees[0];
    if (garde("C3.1/provenance") && (o.source !== "builtin" || o.chemin !== `<builtin:${n}>`)) ecarts.push(`${n} : source=${o.source} chemin=${o.chemin}`);
  }
  if (compte === 0) return { clause: "C3.1", etat: "indéterminé", compte, detail: "aucun outil natif observé" };
  return ecarts.length
    ? { clause: "C3.1", etat: "violé", compte, detail: ecarts.join(" ; ") }
    : { clause: "C3.1", etat: "satisfait", compte, detail: NATIFS.map((n) => `${n} builtin <builtin:${n}>`).join(", ") };
}

/** C3.2 : après redéfinition réelle de `read`, une unique entrée `read`, de provenance non builtin. */
export function verifierC3_2(sonde: any[]): Verdict {
  const ss = sonde.filter((o) => o.t === "session_start");
  if (ss.length !== 1) return { clause: "C3.2", etat: "indéterminé", compte: 0, detail: `${ss.length} observation(s) session_start` };
  const reads = (ss[0].outils ?? []).filter((x: any) => x.nom === "read");
  if (reads.length === 0) return { clause: "C3.2", etat: "indéterminé", compte: 0, detail: "aucune entrée read" };
  if (reads.length > 1 && garde("C3.2/doublon")) return { clause: "C3.2", etat: "violé", compte: reads.length, detail: `${reads.length} entrées read` };
  const r = reads[0];
  const ok = !garde("C3.2/provenance") || (r.source !== "builtin" && r.chemin !== "<builtin:read>");
  return { clause: "C3.2", etat: ok ? "satisfait" : "violé", compte: 1, detail: `read : source=${r.source} chemin=${r.chemin}` };
}

// ── C7 ────────────────────────────────────────────────────────────────────────

const CHAMPS_USAGE = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const;

/** Comptes par type d'événement attendus pour un scénario sans erreur ni épreuve. */
export function comptesAttendus(s: Scenario): Record<string, number> {
  if (s.comptes) return s.comptes;
  const tours = s.tours.length;
  const appels = s.tours.reduce((a, t) => a + (t.appels?.length ?? 0), 0);
  // Un scénario d'erreur sans table déclarée n'a pas de modèle : tout type observé sera un écart.
  if (s.tours.some((t) => t.erreur)) return {};
  // Messages : système, utilisateur, un assistant par tour, un résultat par appel.
  const messages = 2 + tours + appels;
  // Mises à jour : deux par tour assistant (début et fin du bloc scripté), une paire par appel en plus du premier.
  const updates = s.tours.reduce((a, t) => a + 2 * Math.max(1, t.appels?.length ?? 0), 0);
  return {
    session: 1,
    agent_start: 1,
    turn_start: tours,
    message_start: messages,
    message_update: updates,
    message_end: messages,
    tool_execution_start: appels,
    tool_execution_end: appels,
    turn_end: tours,
    agent_end: 1,
    agent_settled: 1,
    message: 0,
  };
}

/** C7 sur un flux `--mode json` déjà découpé en événements. */
export function verifierC7(flux: any[], s: Scenario, cwd: string, rc: number | null): Verdict[] {
  const v: Verdict[] = [];
  const premier = flux[0];
  v.push(
    !premier
      ? { clause: "C7.1", etat: "indéterminé", compte: 0, detail: "flux vide" }
      : !garde("C7.1/session") || (premier.type === "session" && premier.cwd === cwd)
        ? { clause: "C7.1", etat: "satisfait", compte: 1, detail: `session, cwd ${premier.cwd}` }
        : { clause: "C7.1", etat: "violé", compte: 1, detail: `premier événement ${premier.type}, cwd ${premier.cwd}` },
  );
  const assistants = flux.filter((e) => e.type === "message_end" && e.message?.role === "assistant");
  const erreur = s.tours.find((t) => t.erreur);
  {
    const attendus = erreur ? ["error"] : s.tours.map((t) => (t.appels ? "toolUse" : "stop"));
    const ecarts: string[] = [];
    if (garde("C7.2/nombre") && assistants.length !== attendus.length) ecarts.push(`${assistants.length} message_end assistant, ${attendus.length} attendus`);
    assistants.forEach((e, i) => {
      const u = e.message.usage ?? {};
      for (const k of CHAMPS_USAGE) if (garde("C7.2/usage") && u[k] !== s.usage[k]) ecarts.push(`#${i} usage.${k}=${u[k]} ≠ ${s.usage[k]}`);
      if (garde("C7.2/reasoning") && "reasoning" in u && u.reasoning !== s.usage.reasoning) ecarts.push(`#${i} usage.reasoning=${u.reasoning} ≠ ${s.usage.reasoning}`);
      if (garde("C7.2/stopReason") && e.message.stopReason !== attendus[i]) ecarts.push(`#${i} stopReason=${e.message.stopReason} ≠ ${attendus[i]}`);
    });
    v.push(
      assistants.length === 0
        ? { clause: "C7.2", etat: "indéterminé", compte: 0, detail: "aucun message_end assistant" }
        : { clause: "C7.2", etat: ecarts.length ? "violé" : "satisfait", compte: assistants.length, detail: ecarts.join(" ; ") || `usage ${JSON.stringify(s.usage)}, reasoning absent ; stopReason ${attendus.join(",")}` },
    );
  }
  const messages = flux.filter((e) => e.type === "message").length;
  v.push({ clause: "C7.3", etat: messages === 0 || !garde("C7.3/message") ? "satisfait" : "violé", compte: messages, detail: "0 attendu" });
  const appels = s.tours.flatMap((t) => t.appels ?? []);
  {
    const starts = flux.filter((e) => e.type === "tool_execution_start");
    const ecarts: string[] = [];
    if (garde("C7.4/nombre") && starts.length !== appels.length) ecarts.push(`${starts.length} tool_execution_start, ${appels.length} attendus`);
    starts.forEach((e, i) => {
      const a = appels[i];
      if (!a) return;
      if (garde("C7.4/appel") && (e.toolName !== a.name || e.toolCallId !== a.id || JSON.stringify(e.args) !== JSON.stringify(a.arguments))) {
        ecarts.push(`#${i} ${e.toolName}/${e.toolCallId}/${JSON.stringify(e.args)}`);
      }
    });
    v.push(
      appels.length === 0 && starts.length === 0
        ? { clause: "C7.4", etat: "satisfait", compte: 0, detail: "0 attendu (aucun appel scripté)" }
        : { clause: "C7.4", etat: ecarts.length ? "violé" : "satisfait", compte: starts.length, detail: ecarts.join(" ; ") || appels.map((a) => `${a.name}/${a.id}/${JSON.stringify(a.arguments)}`).join(", ") },
    );
  }
  {
    // Un résultat unique apparié à chaque appel attendu, par toolCallId ; rien de plus.
    const ends = flux.filter((e) => e.type === "tool_execution_end");
    const ecarts: string[] = [];
    const attendus = appels.map((a) => a.id);
    for (const id of attendus) {
      const n = ends.filter((e) => e.toolCallId === id).length;
      if (garde("C7.5/aucun") && n === 0) ecarts.push(`${id} : aucun résultat`);
      if (garde("C7.5/doublon") && n > 1) ecarts.push(`${id} : ${n} résultats`);
    }
    for (const e of ends) if (garde("C7.5/inattendu") && !attendus.includes(e.toolCallId)) ecarts.push(`résultat inattendu ${e.toolCallId}`);
    const details: string[] = [];
    for (const e of ends) {
      if (garde("C7.5/isError") && e.isError !== false) ecarts.push(`${e.toolCallId} isError=${e.isError}`);
      const blocs = e.result?.content;
      if (!Array.isArray(blocs) || blocs.length === 0) {
        if (garde("C7.5/contenu")) ecarts.push(`${e.toolCallId} result.content vide ou illisible`);
      } else
        for (const c of blocs) {
          if (c?.type === "text" && typeof c.text !== "string") {
            if (garde("C7.5/contenu")) ecarts.push(`${e.toolCallId} bloc text sans text de type string`);
          } else if (c?.type !== "text" && c?.type !== "image" && garde("C7.5/contenu")) ecarts.push(`${e.toolCallId} bloc de type ${c?.type}`);
        }
      const attendu = s.detailsAttendus?.[e.toolCallId];
      if (attendu !== undefined && garde("C7.5/details")) {
        const d = e.result?.details;
        if (d === undefined) ecarts.push(`${e.toolCallId} details absents`);
        else if (d === null || typeof d !== "object" || Array.isArray(d)) ecarts.push(`${e.toolCallId} details inexploitables`);
        else if (JSON.stringify(d) !== JSON.stringify(attendu)) ecarts.push(`${e.toolCallId} details ${JSON.stringify(d)} ≠ ${JSON.stringify(attendu)}`);
        else details.push(`${e.toolCallId} details ${JSON.stringify(d)}`);
      }
    }
    for (const id of Object.keys(s.detailsAttendus ?? {})) if (garde("C7.5/details") && !ends.some((e) => e.toolCallId === id)) ecarts.push(`${id} : details attendus sans résultat`);
    v.push(
      appels.length === 0 && ends.length === 0
        ? { clause: "C7.5", etat: "satisfait", compte: 0, detail: "0 attendu (aucun appel scripté)" }
        : {
            clause: "C7.5",
            etat: ecarts.length ? "violé" : "satisfait",
            compte: ends.length,
            detail: ecarts.join(" ; ") || [ends.map((e) => `${e.toolCallId} apparié, isError=false, ${(e.result?.content ?? []).length} bloc(s)`).join(", "), ...details].join(" ; "),
          },
    );
  }
  {
    const n = flux.filter((e) => e.type === "turn_end").length;
    const attendu = erreur ? 1 : s.tours.length;
    v.push({ clause: "C7.6", etat: n === attendu || !garde("C7.6/nombre") ? "satisfait" : "violé", compte: n, detail: `${attendu} attendu(s)` });
  }
  if (erreur) {
    const e = assistants[0];
    const ok = e && (!garde("C7.7/erreur") || (e.message.stopReason === "error" && e.message.errorMessage === erreur.erreur && rc === 0));
    v.push({
      clause: "C7.7",
      etat: !e ? "indéterminé" : ok ? "satisfait" : "violé",
      compte: assistants.length,
      detail: e ? `stopReason=${e.message.stopReason}, errorMessage=${JSON.stringify(e.message.errorMessage)}, sortie ${rc}` : "aucun message assistant",
    });
  }
  {
    const att = comptesAttendus(s);
    const obs: Record<string, number> = {};
    for (const e of flux) obs[e.type] = (obs[e.type] ?? 0) + 1;
    // Rapprochement sur l'union des types attendus et observés : un type en plus ne disparaît pas.
    const types = [...new Set([...Object.keys(att), ...Object.keys(obs)])].sort();
    const ecarts = types.filter((k) => garde("C7.8/comptes") && (obs[k] ?? 0) !== (att[k] ?? 0)).map((k) => `${k} ${obs[k] ?? 0} ≠ ${att[k] ?? 0}`);
    v.push({ clause: "C7.8", etat: ecarts.length ? "violé" : "satisfait", compte: flux.length, detail: ecarts.join(" ; ") || Object.entries(att).map(([k, n]) => `${k}=${n}`).join(" ") });
  }
  return v;
}

// ── Mesures préalables C2.7, C2.8, C8.2 (adjudication K1-K9 du 08-10-2026) ─────

/**
 * Prompt système de résumé de pi 0.86.0, relevé dans `dist/core/compaction/utils.js` de
 * l'installation identifiée (SUMMARIZATION_SYSTEM_PROMPT) et présent à l'identique dans
 * `dist/bundle/chunks/chunk-7YM6BE7Y.js`, couvert par le manifeste. Le harnais vérifie avant
 * lancement l'empreinte de ce texte et sa présence dans ce chunk.
 */
export const SUMMARIZATION_SYSTEM_PROMPT =
  "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.";
export const SUMMARIZATION_SYSTEM_PROMPT_SHA256 = "c464889dcfa60441e642f291445b49523f263e6fb2725d0c25075543a2ec3f8f";
export const CHUNK_RESUME = "dist/bundle/chunks/chunk-7YM6BE7Y.js";

/**
 * Simulateur python3 de C2.7 (K6). Il consigne l'appel réel `-c` (script remplacé par son
 * SHA-256), la racine et la liste des skills, puis rend le JSON exact déclaré pour la liste
 * reçue et sort à 0. Il ne lit aucun YAML et ne qualifie pas Python.
 */
const SOURCE_PYTHON3 = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const a = process.argv.slice(2);
const journal = path.join(path.dirname(process.env.PI_CONTRATS_SONDE), "simulateur-python3.jsonl");
const c = a[0] === "-c";
fs.appendFileSync(journal, JSON.stringify({ simulateur: "python3", argv: c ? ["-c", "<script>", ...a.slice(2)] : a, scriptSha256: c ? crypto.createHash("sha256").update(a[1] ?? "").digest("hex") : null, cwd: process.cwd(), pid: process.pid, ppid: process.ppid }) + "\\n");
if (!c) process.exit(2);
const reponses = { "contrats-config": { ok: true, name: "contrats-config", hasDescription: true } };
const out = {};
for (const n of a.slice(3)) if (Object.prototype.hasOwnProperty.call(reponses, n)) out[n] = reponses[n];
process.stdout.write(JSON.stringify(out) + "\\n");
`;

/** Rapport attendu de check-config pour les fixtures K6 ; `<AGENTDIR>` est PI_CODING_AGENT_DIR. */
export const RAPPORT_C2_7 = [
  "check-config — <AGENTDIR>",
  "1 skills — 0 reviewer-facing, 0 mechanism, 0 orchestrator-only. 0 agents on 0 model families",
  "",
  "BLOCKING  subagent-only/agents/ unreadable — no delegation is possible",
  "BLOCKING  subagent-only/envelope/envelope.ts: no role schema found. Expected a `const payloads = {` map whose keys are role names. Every per-role check below is suspended.",
  "report    README.md unreadable — documentation drift not checked",
  "report    skills/contrats-config: in none of reviewer-facing, mechanism, orchestrator-only — intentional?",
  "",
  "Tier 1 failures. Do not stage, do not draft a commit message. Fix each blocking item, re-run /check-config, then resume.",
].join("\n");

/**
 * C2.7 (K6). Fixtures sous PI_CODING_AGENT_DIR : un skill `contrats-config` au frontmatter
 * déclarant name et une description non vide, et un settings.json dont les trois listes de
 * checkConfig sont vides. Aucune autre fixture : AGENTS.md, README.md, subagent-only/ et
 * l'enveloppe sont absents sous cette racine, et leurs rubriques figurent au rapport attendu.
 */
export const C2_7: Scenario = {
  nom: "c2-7-check-config",
  prompt: "/check-config",
  prompts: ["/contrats-attendre-rapport"],
  outils: "read,ls,grep,find",
  tours: [{ texte: "rapport lu" }],
  usage: USAGE,
  contextWindow: 100000,
  strict: true,
  extensionsDepot: ["extensions/pi-check-config/index.ts"],
  agentDir: {
    "settings.json": JSON.stringify({ checkConfig: { orchestratorOnlySkills: [], reviewerFacingSkills: [], mechanismSkills: [] } }, null, 2) + "\n",
    "skills/contrats-config/SKILL.md": "---\nname: contrats-config\ndescription: Skill de fixture des contrats C2.7.\n---\n\nCorps de fixture.\n",
  },
  simulateurs: [{ nom: "python3", source: SOURCE_PYTHON3 }],
  sonde: { attendreRapport: { prefixe: "check-config — " } },
};

/** Texte de reprise de compaction-guard (`extensions/compaction-guard/garde.ts`, MESSAGE_REPRISE). */
export const MESSAGE_REPRISE = "Compaction automatique terminée : reprends exactement là où tu t'étais arrêté.";
export const TYPE_REPRISE = "compaction-guard";

const usage = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output });

/**
 * Textes des échanges K9 : ASCII, pour que l'estimation de pi (ceil(caractères / 4)) se lise
 * sans ambiguïté sur les longueurs déclarées.
 */
export const ECHANGES_K9 = {
  u1: "Premier echange : marqueur U1-ALPHA.",
  a1: "Reponse au premier echange : marqueur A1-BRAVO.",
  u2: "Second echange : marqueur U2-CHARLIE.",
  a2: "Reponse au second echange : marqueur A2-DELTA.",
  reprise: "Reprise apres compaction : marqueur R-ECHO.",
  resume: "RESUME SCRIPTE : marqueur S-FOXTROT.",
};

/**
 * I1, option A adjugée le 08-10-2026 : garder le dernier échange entier.
 * Les textes déclarés sont ASCII : A2 = 46 caractères, soit 12 tokens estimés ;
 * U2 = 37 caractères, soit 10. K = estimation(A2) + 1 = 13 coupe donc sur U2.
 * Cette valeur est calculée depuis le texte déclaré, jamais depuis une observation.
 * Tout changement des textes ou du réglage revient à Sol avant écriture.
 */
export const KEEP_RECENT_TOKENS_K9: number | null = Math.ceil(ECHANGES_K9.a2.length / 4) + 1;

function reglagesK9(): string {
  return JSON.stringify({ compaction: { enabled: false, keepRecentTokens: KEEP_RECENT_TOKENS_K9, reserveTokens: 128 } }, null, 2) + "\n";
}

const resumeK9 = {
  systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
  marqueurs: ["U1-ALPHA", "A1-BRAVO"],
  apresOrdinaires: 2,
  nombre: 1,
  texte: ECHANGES_K9.resume,
  usage: usage(300, 20),
};

/** C2.8 (K9) : deux échanges sans outil, le second franchit 50 % ; le garde compacte et relance. */
export const C2_8: Scenario = {
  nom: "c2-8-compaction-guard",
  prompt: ECHANGES_K9.u1,
  prompts: [ECHANGES_K9.u2, "/contrats-attendre-compaction"],
  outils: "read,ls,grep,find",
  tours: [
    { texte: ECHANGES_K9.a1, usage: usage(1000, 24) },
    { texte: ECHANGES_K9.a2, usage: usage(2280, 24) },
    { texte: ECHANGES_K9.reprise, usage: usage(500, 12) },
  ],
  usage: USAGE,
  contextWindow: 4096,
  strict: true,
  resume: resumeK9,
  session: "dossier",
  extensionsDepot: ["extensions/compaction-guard/index.ts"],
  get agentDir() {
    return { "settings.json": reglagesK9() };
  },
  sonde: { attendreCompaction: { customType: TYPE_REPRISE, texteReprise: MESSAGE_REPRISE } },
};

/** C8.2 (K9) : scénario distinct, sans compaction-guard ; la sonde appelle ctx.compact une fois. */
export const C8_2: Scenario = {
  nom: "c8-2-compaction-sonde",
  prompt: ECHANGES_K9.u1,
  prompts: [ECHANGES_K9.u2, "/contrats-compacter"],
  outils: "read,ls,grep,find",
  tours: [{ texte: ECHANGES_K9.a1 }, { texte: ECHANGES_K9.a2 }],
  usage: USAGE,
  contextWindow: 4096,
  strict: true,
  resume: resumeK9,
  session: "dossier",
  get agentDir() {
    return { "settings.json": reglagesK9() };
  },
  sonde: { compacter: true },
};

export const MESURES_PREALABLES: Record<string, Scenario> = { "C2.7": C2_7, "C2.8": C2_8, "C8.2": C8_2 };

/** Observations d'une mesure préalable, déjà lues. */
export type ObservationsMesure = {
  rc: number | null;
  stderr: string;
  flux: any[];
  sonde: any[];
  fournisseur: any[];
  simulateurs: Record<string, any[]>;
  /** Lancements tracés (événements « fils »). */
  fils: any[];
  /** Entrées des fichiers de session, dans l'ordre du fichier. */
  sessions: Array<{ fichier: string; entrees: any[] }>;
  agentDir: string;
  /** Chemin absolu du point d'entrée du dépôt chargé, dans la copie du candidat. */
  extension: string | null;
  // ── Item 1 (absents des mesures préalables) ──
  cwd?: string;
  tmp?: string;
  bin?: string;
  candidat?: string;
  sessionsDir?: string;
  /** Points d'entrée chargés par -e, chemins absolus, dans l'ordre. */
  extensions?: string[];
  /** Fichiers évalués par jiti. */
  transpiles?: string[];
  /** Constats d'exécution (identifiants). */
  constats?: string[];
  /** Inventaires du cwd temporaire hors `.git`, avant et après. */
  inventaireCwd?: { avant: EntreeCwd[]; apres: EntreeCwd[] };
  /** K8 : comptes `git rev-list --count --all`. */
  git?: { avant: number | null; apres: number | null };
  /** Contenu final de PI_JOURNAL_PATH (null : absent). */
  journal?: string | null;
  /** Contenus finaux des fichiers relevés (null : absent). */
  fichiers?: Record<string, string | null>;
  /** Simulateurs posés : nom, chemin, empreinte déclarée (K7). */
  poses?: Array<{ nom: string; chemin: string; sha256: string }>;
  /** Constats d'exécution avec leur détail. */
  constatsDetail?: Array<{ id: string; etat: string; detail: string }>;
  /** Empreintes des points d'entrée chargés par -e, relevées avant lancement. */
  extensionsSha?: Record<string, string>;
  /** Contenus relevés avant lancement (null : absent). */
  fichiersAvant?: Record<string, string | null>;
  /** A1 : sorties des lancements asynchrones (variante sortiesFils). */
  sortiesFils?: any[];
  /** B5 : fixture du journal en lecture seule, établie avant lancement. */
  journalFixture?: { chemin: string; dossier: string; mode: string; inscriptible: boolean; presentAvant: boolean };
};

export type EntreeCwd = { chemin: string; type: "fichier" | "dossier" | "lien" | "autre"; sha256?: string };

type Ecarts = { viole: string[]; indetermine: string[]; vu: string[] };
const nouveauxEcarts = (): Ecarts => ({ viole: [], indetermine: [], vu: [] });
function conclure(clause: string, e: Ecarts, compte: number): Verdict {
  const etat: Etat = e.indetermine.length ? "indéterminé" : e.viole.length ? "violé" : "satisfait";
  const detail = [
    ...e.indetermine.map((x) => `INDÉTERMINÉ ${x}`),
    ...e.viole.map((x) => `VIOLÉ ${x}`),
    ...(etat === "satisfait" ? e.vu : []),
  ].join(" ; ");
  return { clause, etat, compte, detail };
}

/** Phases d'une barrière de la sonde, dans l'ordre exigé, sans expiration ni erreur. */
function phases(sonde: any[], nom: string, attendues: string[], e: Ecarts): any[] {
  const b = sonde.filter((o) => o.t === "barriere" && o.nom === nom);
  const vues = b.map((o) => o.phase);
  if (b.some((o) => o.phase === "expiration" || o.phase === "erreur") && garde("barriere/expiration")) {
    e.indetermine.push(`barrière ${nom} : ${b.filter((o) => o.phase === "expiration" || o.phase === "erreur").map((o) => `${o.phase} (${o.message})`).join(", ")}`);
  } else if (JSON.stringify(vues) !== JSON.stringify(attendues) && garde("barriere/phases")) {
    e.indetermine.push(`barrière ${nom} : phases ${vues.join(" → ") || "aucune"} ≠ ${attendues.join(" → ")}`);
  } else e.vu.push(`barrière ${nom} : ${vues.join(" → ")}`);
  return b;
}

function chargement(o: ObservationsMesure, commande: string | null, e: Ecarts): void {
  if (garde("C2/diagnostic") && o.extension && (o.stderr.includes(`Failed to load extension "${o.extension}"`) || o.stderr.includes(`Extension path does not exist: ${o.extension}`))) {
    e.viole.push(`diagnostic de chargement pour ${o.extension}`);
  }
  if (commande) {
    const ss = o.sonde.filter((x) => x.t === "session_start");
    if (ss.length !== 1) {
      if (garde("C2/session_start")) e.indetermine.push(`${ss.length} observation(s) session_start`);
    } else {
      const c = (ss[0].commandesDetail ?? []).filter((x: any) => x.nom === commande);
      if (c.length !== 1 && garde("C2/commande")) e.viole.push(`commande ${commande} : ${c.length} enregistrement(s)`);
      else if (c.length === 1 && c[0].chemin !== o.extension && garde("C2/provenance")) e.viole.push(`commande ${commande} : provenance ${c[0].chemin} ≠ ${o.extension}`);
      else if (c.length === 1) e.vu.push(`commande ${commande} enregistrée, provenance ${c[0].chemin}`);
    }
  }
  if (garde("C2/sortie") && o.rc !== 0) e.viole.push(`sortie ${o.rc}`);
}

/** Formes des appels du fournisseur : exactement la suite attendue, sans requête imprévue. */
function formes(o: ObservationsMesure, attendues: string[], e: Ecarts): any[] {
  const vues = o.fournisseur.map((x) => x.forme ?? "?");
  if (garde("formes/suite") && JSON.stringify(vues) !== JSON.stringify(attendues)) e.viole.push(`appels du fournisseur ${vues.join(",") || "aucun"} ≠ ${attendues.join(",")}${o.fournisseur.filter((x) => x.ecart).map((x) => ` [appel ${x.appel} : ${x.ecart}]`).join("")}`);
  else e.vu.push(`appels du fournisseur ${vues.join(",")}`);
  return o.fournisseur;
}

const numeroTemoin = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

/** D1 : rattacher les phases aux témoins définitifs du même appel ordinaire. */
function temoinsAppel(o: ObservationsMesure, recu: any, reponse: any, appel: unknown, e: Ecarts): { recu: number; reponse: number } | null {
  const invalide = (detail: string): null => {
    e.indetermine.push(`D1 : ${detail}`);
    return null;
  };
  if (typeof appel !== "number" || !Number.isSafeInteger(appel) || appel < 0) {
    if (garde("D1/appel-attendu")) return invalide("appel attendu non rattachable de façon unique");
    return null;
  }
  if (!recu || !reponse) {
    if (garde("D1/phases")) return invalide(`phases absentes pour l'appel ${appel}`);
    return null;
  }
  if (garde("D1/appel") && (recu.appel !== appel || reponse.appel !== appel)) return invalide(`phases non rattachées à l'appel ${appel}`);
  if (garde("D1/numero") && (!numeroTemoin(recu.temoin) || !numeroTemoin(reponse.temoin))) return invalide(`témoin de phase non définitif pour l'appel ${appel}`);
  const appels = o.fournisseur.filter((x) => x.appel === appel);
  const receptions = o.sonde.filter((x) => x.t === "temoin-fournisseur" && x.evenement === "recu" && x.appel === appel);
  const fins = o.sonde.filter((x) => x.t === "temoin-fournisseur" && x.evenement === "fini" && x.appel === appel);
  if (appels.length !== 1 || appels[0].forme !== "ordinaire") return invalide(`appel ${appel} absent, ambigu ou non ordinaire`);
  if (receptions.length === 0 || fins.length === 0) {
    if (garde("D1/presence")) return invalide(`appel ${appel} : réception ou fin absentes`);
    // Mutant seulement : sans ce contrôle, le vérificateur accepterait la phase sans témoin de la sonde.
    return { recu: recu.temoin, reponse: reponse.temoin };
  }
  if (garde("D1/unicite") && (receptions.length > 1 || fins.length > 1)) return invalide(`appel ${appel}, réception ou fin absents, ambigus ou non ordinaires`);
  const r = receptions[0], f = fins[0];
  if (garde("D1/temoins-sonde") && (r.forme !== "ordinaire" || !numeroTemoin(r.temoin) || !numeroTemoin(f.temoin))) return invalide(`témoins de la sonde non définitifs ou non ordinaires pour l'appel ${appel}`);
  // Un numéro de phase non définitif relève de D1/numero ; ce contrôle juge un numéro définitif différent.
  if (garde("D1/temoin-recu") && numeroTemoin(recu.temoin) && recu.temoin !== r.temoin) return invalide(`phase ${recu.phase} ≠ témoin définitif de réception de l'appel ${appel}`);
  const assistants = o.sonde.filter((x) => x.t === "message_end" && x.temoin === reponse.temoin);
  if (garde("D1/reponse") && (assistants.length !== 1 || assistants[0].role !== "assistant" || assistants[0].stopReason !== "stop" || reponse.stopReason !== "stop")) return invalide(`phase reponse-achevee non rattachée à un message_end assistant achevé pour l'appel ${appel}`);
  if (garde("D1/ordre") && !(r.temoin < f.temoin && f.temoin < reponse.temoin)) return invalide(`ordre réception, fin du fournisseur, réponse : ${r.temoin}, ${f.temoin}, ${reponse.temoin}`);
  return { recu: r.temoin, reponse: reponse.temoin };
}

/** C2.7 : rapport réel reçu par le fournisseur, réponse achevée, barrières K6 consignées. */
export function verifierC2_7(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  chargement(o, "check-config", e);
  // Simulateur python3 : un appel -c, racine PI_CODING_AGENT_DIR, liste des skills de fixture.
  const sim = o.simulateurs.python3 ?? [];
  const argvAttendu = ["-c", "<script>", o.agentDir, "contrats-config"];
  if (sim.length !== 1) {
    if (garde("C2.7/python3-nombre")) e.viole.push(`simulateur python3 : ${sim.length} appel(s), 1 attendu`);
  } else if (JSON.stringify(sim[0].argv) !== JSON.stringify(argvAttendu)) {
    if (garde("C2.7/python3-args")) e.viole.push(`simulateur python3 : arguments ${JSON.stringify(sim[0].argv)}`);
  } else e.vu.push(`python3 simulé appelé une fois (${JSON.stringify(argvAttendu)}), script ${sim[0].scriptSha256}`);
  const lancements = o.fils.filter((f) => f.commande === "python3");
  if (garde("C2.7/lancements") && lancements.length !== 1) e.viole.push(`lancements python3 tracés : ${lancements.length}`);
  // Le rapport réel, exact, dans l'unique appel ordinaire.
  const appels = formes(o, ["ordinaire"], e);
  const rapport = RAPPORT_C2_7.replace("<AGENTDIR>", o.agentDir);
  const recus = appels.filter((a) => (a.messages ?? []).some((m: any) => m.role === "user" && m.texte === rapport));
  if (recus.length !== 1 && garde("C2.7/rapport")) {
    const vu = appels.flatMap((a) => (a.messages ?? []).filter((m: any) => m.role === "user").map((m: any) => m.texte));
    e.viole.push(`rapport exact reçu par ${recus.length} appel(s) ; messages user reçus : ${JSON.stringify(vu).slice(0, 600)}`);
  } else if (recus.length === 1) e.vu.push("rapport exact reçu par le fournisseur");
  // Réponse assistant achevée, dans le flux.
  const fins = o.flux.filter((x) => x.type === "message_end" && x.message?.role === "assistant");
  if (garde("C2.7/reponse") && (fins.length !== 1 || fins[0].message.stopReason !== "stop")) e.viole.push(`réponses assistant dans le flux : ${fins.map((x) => x.message.stopReason).join(",") || "aucune"}`);
  else e.vu.push("réponse assistant achevée (stop)");
  // Barrière : entrée, rapport reçu, réponse achevée (témoin postérieur à la réception), inactivité, sortie.
  const b = phases(o.sonde, "attendre-rapport", ["entree", "rapport-recu", "reponse-achevee", "inactif", "sortie"], e);
  const r = b.find((x) => x.phase === "rapport-recu");
  const f = b.find((x) => x.phase === "reponse-achevee");
  // B8 : le rattachement D1 porte sur l'unique appel ordinaire, indépendamment du contrôle du
  // rapport, pour qu'une altération du rapport ne fasse rougir que la garde du rapport.
  const ordinaires = appels.filter((a) => a.forme === "ordinaire");
  temoinsAppel(o, r, f, ordinaires.length === 1 ? ordinaires[0].appel : undefined, e);
  return conclure("C2.7", e, recus.length);
}

/** Entrées de session portant un customType, sous l'une des deux formes de pi 0.86.0. */
function entreesCustom(entrees: any[], customType: string): Array<{ index: number; forme: string; texte: string }> {
  const texte = (c: any) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => (x?.type === "text" ? x.text : "")).join("") : "");
  const out: Array<{ index: number; forme: string; texte: string }> = [];
  entrees.forEach((x, index) => {
    if (x.type === "custom_message" && x.customType === customType) out.push({ index, forme: "custom_message", texte: texte(x.content) });
    else if (x.type === "message" && x.message?.role === "custom" && x.message?.customType === customType) out.push({ index, forme: "message/custom", texte: texte(x.message.content) });
  });
  return out;
}

function sessionUnique(o: ObservationsMesure, e: Ecarts): any[] | null {
  if (o.sessions.length !== 1) {
    if (garde("session/unique")) e.indetermine.push(`${o.sessions.length} fichier(s) de session`);
    return null;
  }
  return o.sessions[0].entrees;
}

const timestampLisible = (t: unknown) => (typeof t === "number" && Number.isFinite(t)) || (typeof t === "string" && !Number.isNaN(Date.parse(t)));

/** Entrée compaction unique, écrite sur disque, avec timestamp et résumé du fournisseur scripté. */
function compactionEcrite(entrees: any[], e: Ecarts): { index: number; entree: any } | null {
  const c = entrees.map((x, index) => ({ index, entree: x })).filter((x) => x.entree.type === "compaction");
  if (c.length !== 1) {
    if (garde("compaction/nombre")) e.viole.push(`${c.length} entrée(s) compaction écrite(s), 1 attendue`);
    return null;
  }
  const x = c[0].entree;
  const ici: string[] = [];
  if (garde("compaction/timestamp") && !timestampLisible(x.timestamp)) ici.push(`compaction : timestamp illisible ${JSON.stringify(x.timestamp)}`);
  if (garde("compaction/resume") && (typeof x.summary !== "string" || !x.summary.includes(ECHANGES_K9.resume))) ici.push("compaction : résumé sans le texte du fournisseur scripté");
  // I1-A : firstKeptEntryId doit désigner l'unique message U2 de la session.
  // Le stimulus n'a ni image ni autre bloc : texte brut ou unique bloc text.
  const texteUser = (c: any): string | null =>
    typeof c === "string" ? c :
      Array.isArray(c) && c.length === 1 && c[0]?.type === "text" && typeof c[0].text === "string" ? c[0].text : null;
  const u2 = entrees.map((entree, index) => ({ entree, index })).filter(({ entree }) =>
    entree.type === "message" && entree.message?.role === "user" && texteUser(entree.message.content) === ECHANGES_K9.u2);
  if (u2.length !== 1 || typeof u2[0]?.entree.id !== "string" || u2[0].entree.id.length === 0) {
    if (garde("I1-A/u2-unique")) e.indetermine.push(`I1-A : entrée U2 non rattachable de façon unique (${u2.length} correspondance(s))`);
  } else {
    if (garde("I1-A/u2-avant") && u2[0].index >= c[0].index) ici.push("I1-A : U2 n'est pas antérieure à l'entrée compaction");
    if (garde("I1-A/frontiere") && x.firstKeptEntryId !== u2[0].entree.id) ici.push(`I1-A : firstKeptEntryId ${x.firstKeptEntryId} ne désigne pas U2 (${u2[0].entree.id})`);
    if (u2[0].index < c[0].index && x.firstKeptEntryId === u2[0].entree.id) e.vu.push(`I1-A : firstKeptEntryId = id de U2 (${u2[0].entree.id})`);
  }
  e.viole.push(...ici);
  if (!ici.length && u2.length === 1 && typeof u2[0].entree.id === "string" && u2[0].entree.id.length > 0) e.vu.push(`entrée compaction écrite (timestamp ${x.timestamp}, firstKeptEntryId ${x.firstKeptEntryId})`);
  return c[0];
}

/** C2.8 : compaction déclenchée par le garde, reprise réelle reçue et achevée, dans l'ordre K9. */
export function verifierC2_8(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  chargement(o, null, e);
  // Usages réels vus par la sonde à chaque turn_end : sous le seuil, puis au-dessus.
  const usages = o.sonde.filter((x) => x.t === "turn_end").map((x) => x.usage?.tokens ?? null);
  if (garde("C2.8/usages") && (usages.length < 2 || usages[0] !== 1024 || usages[1] !== 2304)) e.viole.push(`usages getContextUsage aux turn_end : ${JSON.stringify(usages)}, 1024 puis 2304 attendus`);
  else e.vu.push(`usages aux turn_end ${JSON.stringify(usages)}`);
  formes(o, ["ordinaire", "ordinaire", "resume", "ordinaire"], e);
  const reprise = o.fournisseur[3];
  if (garde("C2.8/reprise-texte") && reprise && !(reprise.messages ?? []).some((m: any) => m.role === "user" && m.texte === MESSAGE_REPRISE)) e.viole.push("texte de reprise absent de la requête du fournisseur");
  const entrees = sessionUnique(o, e);
  if (entrees) {
    const c = compactionEcrite(entrees, e);
    const custom = entreesCustom(entrees, TYPE_REPRISE);
    if (custom.length !== 1) {
      if (garde("C2.8/custom")) e.viole.push(`${custom.length} entrée(s) de session customType=${TYPE_REPRISE}, 1 attendue`);
    } else if (custom[0].texte !== MESSAGE_REPRISE) {
      if (garde("C2.8/custom")) e.viole.push("message de reprise : texte différent");
    } else e.vu.push(`message de reprise écrit (forme ${custom[0].forme})`);
    if (garde("C2.8/ordre-session") && c && custom.length === 1 && !(custom[0].index > c.index)) e.viole.push("ordre : la reprise n'est pas postérieure à l'entrée compaction");
    const apres = custom.length === 1 ? entrees.slice(custom[0].index + 1).filter((x) => x.type === "message" && x.message?.role === "assistant") : [];
    if (garde("C2.8/reponse-reprise") && custom.length === 1 && (apres.length !== 1 || apres[0].message.stopReason !== "stop")) e.viole.push(`réponse de reprise écrite : ${apres.length}`);
  }
  const fluxCustom = o.flux.filter((x) => x.type === "message_end" && x.message?.role === "custom" && x.message?.customType === TYPE_REPRISE);
  if (garde("C2.8/flux-custom") && fluxCustom.length !== 1) e.viole.push(`flux : ${fluxCustom.length} message_end custom ${TYPE_REPRISE}`);
  const b = phases(o.sonde, "attendre-compaction", ["entree", "session-compact", "message-custom", "reprise-recue", "reponse-achevee", "inactif", "sortie"], e);
  const sc = b.find((x) => x.phase === "session-compact");
  const mc = b.find((x) => x.phase === "message-custom");
  const rr = b.find((x) => x.phase === "reprise-recue");
  const ra = b.find((x) => x.phase === "reponse-achevee");
  const t = temoinsAppel(o, rr, ra, reprise?.appel, e);
  if (garde("C2.8/ordre-temoins") && t && (!sc || !mc || !numeroTemoin(sc.temoin) || !numeroTemoin(mc.temoin) || !(sc.temoin < mc.temoin && mc.temoin < t.recu && t.recu < t.reponse))) e.indetermine.push(`ordre des témoins ${sc?.temoin}, ${mc?.temoin}, ${t.recu}, ${t.reponse}`);
  return conclure("C2.8", e, usages.length);
}

/** C8.2 : entrée compaction écrite après l'appel réel de ctx.compact par la sonde. */
export function verifierC8_2(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  chargement(o, null, e);
  formes(o, ["ordinaire", "ordinaire", "resume"], e);
  const b = phases(o.sonde, "compacter", ["entree", "compact-appele", "onComplete", "sortie"], e);
  const fin = b.find((x) => x.phase === "onComplete");
  const entrees = sessionUnique(o, e);
  if (entrees) {
    const c = compactionEcrite(entrees, e);
    if (garde("C8.2/oncomplete") && c && fin && (fin.summary !== c.entree.summary || fin.firstKeptEntryId !== c.entree.firstKeptEntryId)) e.viole.push("entrée écrite non rattachée au résultat de onComplete");
    else if (c && fin) e.vu.push("entrée rattachée au résultat de onComplete (résumé et firstKeptEntryId)");
  }
  return conclure("C8.2", e, b.length);
}

// ══ Item 1 : clauses C1 à C8 (PLAN § 3, MATRICES § A) ══════════════════════════

/**
 * Contrôle identifié d'un vérificateur de l'item 1 : `garde(id)` le rend désarmable par un
 * mutant ciblé ; `etat` est l'état produit si l'observation ne satisfait pas l'exigence.
 */
function exiger(e: Ecarts, id: string, ok: boolean, etat: "violé" | "indéterminé", ko: string, vu?: string): boolean {
  if (ok || !garde(id)) {
    if (ok && vu) e.vu.push(vu);
    return true;
  }
  (etat === "violé" ? e.viole : e.indetermine).push(ko);
  return false;
}

// ── Prompts ordinaires (adjudication du 08-10-2026) ──────────────────────────

/** Texte d'un content brut : chaîne, ou blocs text joints par un saut de ligne ; null si non classable. */
function texteContent(c: unknown): string | null {
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.every((b) => b !== null && typeof b === "object")) {
    if (c.some((b: any) => b.type === "text" && typeof b.text !== "string")) return null;
    return c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  }
  return null;
}

/**
 * Rendu du prompt depuis les messages system bruts reçus, selon le transcript identifié de
 * pi-ai 0.86.0 : contenu des messages system dans l'ordre ; sections mises à jour par nom,
 * une valeur null retirant la section ; contenus non vides puis valeurs des sections
 * actuelles non vides, joints par deux sauts de ligne. Les déclarations d'outils ne sont pas
 * ajoutées au texte. Une forme non classable rend null (indéterminé).
 */
export function rendrePrompt(systemes: any[]): string | null {
  if (!Array.isArray(systemes)) return null;
  const contenus: string[] = [];
  const sections = new Map<string, string>();
  for (const m of systemes) {
    if (m === null || typeof m !== "object") return null;
    const t = texteContent(m.content);
    if (t === null) return null;
    if (t.length > 0) contenus.push(t);
    if ("sections" in m) {
      const sec = m.sections;
      if (sec === null || typeof sec !== "object" || Array.isArray(sec)) return null;
      for (const [nom, valeur] of Object.entries(sec)) {
        if (valeur === null) sections.delete(nom);
        else if (typeof valeur === "string") sections.set(nom, valeur);
        else return null;
      }
    }
  }
  return [contenus.join("\n\n"), ...sections.values()].filter((x) => x.length > 0).join("\n\n");
}

/** Prompt reçu par un appel du fournisseur, rendu depuis ses messages system bruts (C2.5, C4.3, C6.3, C6.4, C6.8). */
function promptRecu(o: ObservationsMesure, appel: number, e: Ecarts, id: string): string | null {
  const a = o.fournisseur.filter((x) => x.appel === appel);
  if (a.length !== 1) {
    exiger(e, `${id}/capture`, false, "indéterminé", `appel ${appel} du fournisseur : ${a.length} entrée(s)`);
    return null;
  }
  if (!Array.isArray(a[0].systemes) || a[0].systemes.length === 0) {
    exiger(e, `${id}/capture`, false, "indéterminé", `appel ${appel} : messages system bruts absents du journal`);
    return null;
  }
  const p = rendrePrompt(a[0].systemes);
  if (p === null) exiger(e, `${id}/forme`, false, "indéterminé", `appel ${appel} : forme de message system non classable`);
  return p;
}

// ── Textes et simulateurs déclarés ───────────────────────────────────────────

export const RAISON_C4_1 = "bloqué par l'épreuve C4.1 : écriture de x.txt refusée";
export const AJOUT_C4_2 = "AJOUT-EPREUVE-C4.2";
export const MARQUEUR_C4_3 = "\n\nMARQUEUR-C4.3";
export const BRIEF_C2_5 = "# Brief de fixture\n\nMARQUEUR-BRIEF-C2.5 : orientation déclarée par le scénario.\n";
export const APPEND_C6_3 = "CONTENU-APPEND-C6.3 : texte du fichier déclaré.";
export const APPEND_C6_4 = "TEXTE-APPEND-C6.4 : texte passé en argument.";
export const ID_SESSION_C6_5 = "019a0c65-0000-7000-8000-000000000c65";
export const NOTE_RUFF = "a.py:1:8: F401 [*] `os` imported but unused NOTE-RUFF-C2.4";
export const PIEGE_SKILL_C6_8 = "PIEGE-SKILL-C6.8";
export const PIEGE_AGENTS_C6_8 = "PIEGE-AGENTS-C6.8";
export const CLE_C2_2 = "AKIAQWERTYUIOPASDFGH";
export const NOTE_REGROUPEMENT = "2 modifications de autorise.txt en 2 tours : grouper les suivantes en un seul appel";
export const SCOPE_C2_11 = '{"unit":"contrats-c2-11","scope":["autorise.txt"],"kept":[]}';
export const SCOPE_C2_11_DISTINCTS = '{"unit":"contrats-c2-11","scope":["autorise.txt","autre.txt"],"kept":[]}';

/** Source d'un simulateur qui consigne son appel dans `simulateur-<nom>.jsonl`, à côté du journal de la sonde. */
function simulateurSource(nom: string, corps: string): string {
  return `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const a = process.argv.slice(2);
const journal = path.join(path.dirname(process.env.PI_CONTRATS_SONDE), ${JSON.stringify(`simulateur-${nom}.jsonl`)});
const script = process.argv[1];
fs.appendFileSync(journal, JSON.stringify({ simulateur: ${JSON.stringify(nom)}, argv: a, cwd: process.cwd(), pid: process.pid, ppid: process.ppid, script, sha256: crypto.createHash("sha256").update(fs.readFileSync(script)).digest("hex") }) + "\\n");
${corps}
`;
}
const RUFF_NOTE: Simulateur = { nom: "ruff", source: simulateurSource("ruff", `process.stdout.write(${JSON.stringify(NOTE_RUFF + "\n")});\nprocess.exit(1);`) };
const RUFF_MUET: Simulateur = { nom: "ruff", source: simulateurSource("ruff", "process.exit(0);") };
const MYPY_OK: Simulateur = { nom: "mypy", source: simulateurSource("mypy", "process.exit(0);") };
const bq = (volume: string): Simulateur => ({
  nom: "bq",
  source: simulateurSource(
    "bq",
    `if (a.includes("--dry_run")) process.stdout.write(${JSON.stringify(`Query successfully validated. Assuming the tables are not modified, running this query will process ${volume} of data.\n`)});
else process.stdout.write("+-----+\\n| f0_ |\\n+-----+\\n|   1 |\\n+-----+\\n");
process.exit(0);`,
  ),
});
/** Commande K7 de C2.3 : `'B'/bq query …`, B échappé POSIX à la matérialisation. */
export const COMMANDE_BQ = "<BIN-QUOTE>/bq query --use_legacy_sql=false 'SELECT 1'";

const LINT_SETTINGS = JSON.stringify({ lintGate: { enabled: true, ruff: true, mypy: true } }, null, 2) + "\n";
const PIEGE_EXTENSION = `export default function (pi: any) {\n  pi.registerCommand("contrats-piege", { description: "piège C6.2", handler: async () => undefined });\n}\n`;

const outil = (id: string, name: string, args: Record<string, unknown>) => ({ appels: [{ id, name, arguments: args }] });

// ── Socle : C1, C3.1, C4.4, C5, C6.6, C6.7, C7, C8.1, C8.3 ───────────────────

export const SOCLE: Scenario = {
  nom: "socle",
  prompt: "exerce le socle",
  prompts: ["/contrats-membres"],
  outils: "read,ls,grep,find,bash,sondeargs",
  session: "dossier",
  argvEnPlus: ["--thinking", "low"],
  raisonnement: true,
  tours: [
    { appels: [{ id: "b1", name: "bash", arguments: { command: "true" } }, { id: "s1", name: "sondeargs", arguments: {} }] },
    { texte: "socle fini" },
  ],
  usage: USAGE,
  contextWindow: 100000,
  epreuves: ["outil-signal"],
  sonde: { membres: true },
  detailsAttendus: { s1: { epreuve: "outil-signal" } },
  // Modèle général de comptes (comptesAttendus), plus la mise à jour d'exécution que l'outil bash
  // de pi 0.86.0 émet pour son appel (relevée en construction, déclarée ici).
  comptes: {
    session: 1,
    agent_start: 1,
    turn_start: 2,
    message_start: 6,
    message_update: 6,
    message_end: 6,
    tool_execution_start: 2,
    tool_execution_update: 1,
    tool_execution_end: 2,
    turn_end: 2,
    agent_end: 1,
    agent_settled: 1,
    message: 0,
  },
};

/** Membres consignés par la sonde, par phase. */
const membresPhase = (o: ObservationsMesure, phase?: string) => o.sonde.filter((x) => x.t === "membres" && (phase === undefined || x.phase === phase));

/** C1 : exports, pi-tui, fabrique de flux, isToolCallEventType sur un vrai tool_call. */
export function verifierC1(o: ObservationsMesure): Verdict[] {
  const v: Verdict[] = [];
  const ch = o.sonde.filter((x) => x.t === "chargement");
  {
    const e = nouveauxEcarts();
    if (ch.length !== 1) exiger(e, "C1.1/chargement", false, "indéterminé", `${ch.length} observation(s) de chargement`);
    else {
      const ex = new Map<string, string>(ch[0].exports ?? []);
      for (const n of EXPORTS_C1) exiger(e, "C1.1/export", ex.get(n) === "function", "violé", `${n} : ${ex.get(n) ?? "absent"}`);
      if (!e.viole.length && !e.indetermine.length) e.vu.push(`${EXPORTS_C1.join(", ")} : fonctions`);
    }
    v.push(conclure("C1.1-C1.6", e, ch.length ? EXPORTS_C1.length : 0));
  }
  {
    const e = nouveauxEcarts();
    if (ch.length !== 1) exiger(e, "C1.7/chargement", false, "indéterminé", `${ch.length} observation(s) de chargement`);
    else {
      const t = new Map<string, string>(ch[0].tui ?? []);
      for (const n of ["truncateToWidth", "visibleWidth"]) exiger(e, "C1.7/fonction", t.get(n) === "function", "violé", `pi-tui ${n} : ${t.get(n) ?? "absent"}`);
      const ap = ch[0].tuiAppels ?? {};
      exiger(e, "C1.7/visibleWidth", ap.visibleWidthAb === 2, "violé", `visibleWidth("ab") = ${JSON.stringify(ap.visibleWidthAb)}`);
      exiger(e, "C1.8/troncature", typeof ap.largeurTroncature1 === "number" && ap.largeurTroncature1 <= 1, "violé", `largeur de truncateToWidth("abc", 1) = ${JSON.stringify(ap.largeurTroncature1)}`);
      if (!e.viole.length) e.vu.push(`truncateToWidth, visibleWidth : fonctions ; visibleWidth("ab")=2 ; largeur tronquée ${ap.largeurTroncature1}`);
    }
    v.push(conclure("C1.7-C1.8", e, ch.length ? 4 : 0));
  }
  {
    const e = nouveauxEcarts();
    const f = o.fournisseur;
    if (!f.length) exiger(e, "C1.9/capture", false, "indéterminé", "aucun appel du fournisseur");
    else exiger(e, "C1.9/fabrique", f.every((x) => x.fabrique === "function"), "violé", `createAssistantMessageEventStream : ${[...new Set(f.map((x) => x.fabrique))].join(",")}`, `createAssistantMessageEventStream : fonction, ${f.length} flux produits et consommés (C7)`);
    v.push(conclure("C1.9", e, f.length));
  }
  {
    const e = nouveauxEcarts();
    const tc = membresPhase(o, "tool_call");
    const bash = tc.filter((x) => x.toolName === "bash");
    if (bash.length === 0) exiger(e, "C1.10/capture", false, "indéterminé", "aucun tool_call bash observé");
    for (const x of bash) {
      exiger(e, "C1.10/bash", x.estBash === true, "violé", `isToolCallEventType("bash", e) = ${JSON.stringify(x.estBash)} pour ${x.toolCallId}`);
      exiger(e, "C1.10/read", x.estRead === false, "violé", `isToolCallEventType("read", e) = ${JSON.stringify(x.estRead)} pour ${x.toolCallId}`);
    }
    if (bash.length && !e.viole.length) e.vu.push(`tool_call bash : vrai pour bash, faux pour read (${bash.length} appel(s))`);
    v.push(conclure("C1.10", e, bash.length * 2));
  }
  return v;
}
const EXPORTS_C1 = ["defineTool", "isToolCallEventType", "isEditToolResult", "isWriteToolResult", "getAgentDir", "withFileMutationQueue"];

/** C4.4 : session_start.reason, un turn_end par tour, toolCallId apparié entre tool_call et tool_execution_end. */
export function verifierC4_4(o: ObservationsMesure, s: Scenario): Verdict {
  const e = nouveauxEcarts();
  const ss = o.sonde.filter((x) => x.t === "session_start");
  if (ss.length !== 1) exiger(e, "C4.4/session_start", false, "indéterminé", `${ss.length} session_start observé(s)`);
  else exiger(e, "C4.4/reason", ss[0].reason === "startup", "violé", `session_start.reason = ${JSON.stringify(ss[0].reason)}`, "session_start.reason = startup");
  const te = o.sonde.filter((x) => x.t === "turn_end").length;
  exiger(e, "C4.4/turn_end", te === s.tours.length, "violé", `${te} turn_end, ${s.tours.length} tours`, `${te} turn_end pour ${s.tours.length} tours`);
  const calls = o.sonde.filter((x) => x.t === "tool_call").map((x) => x.toolCallId);
  const ends = o.flux.filter((x) => x.type === "tool_execution_end").map((x) => x.toolCallId);
  const attendus = s.tours.flatMap((t) => t.appels ?? []).map((a) => a.id);
  if (!attendus.length) exiger(e, "C4.4/appels", false, "indéterminé", "aucun appel scripté");
  exiger(e, "C4.4/appariement", JSON.stringify([...calls].sort()) === JSON.stringify([...attendus].sort()) && JSON.stringify([...ends].sort()) === JSON.stringify([...attendus].sort()), "violé", `tool_call ${calls.join(",")} ; tool_execution_end ${ends.join(",")} ; attendus ${attendus.join(",")}`, `toolCallId appariés : ${attendus.join(", ")}`);
  return conclure("C4.4", e, 1 + te + calls.length);
}

/** C5 : membres de ctx aux phases session_start, tool_call, turn_end et commande. */
export function verifierC5(o: ObservationsMesure, thinking: string): Verdict[] {
  const v: Verdict[] = [];
  const m = membresPhase(o);
  const phasesRequises = ["session_start", "tool_call", "turn_end", "commande"];
  const manque = phasesRequises.filter((p) => !m.some((x) => x.phase === p));
  const base = (e: Ecarts) => {
    if (manque.length) exiger(e, "C5/phases", false, "indéterminé", `phase(s) sans observation : ${manque.join(", ")}`);
  };
  {
    const e = nouveauxEcarts();
    base(e);
    for (const x of m) {
      exiger(e, "C5.1/cwd", x.cwd === o.cwd, "violé", `${x.phase} : cwd ${x.cwd} ≠ ${o.cwd}`);
      exiger(e, "C5.1/hasUI", x.hasUI === false, "violé", `${x.phase} : hasUI = ${JSON.stringify(x.hasUI)}`);
    }
    if (m.length && !e.viole.length) e.vu.push(`cwd temporaire et hasUI=false aux ${m.length} observations`);
    v.push(conclure("C5.1", e, m.length));
  }
  {
    const e = nouveauxEcarts();
    base(e);
    const attendu: Record<string, string> = { session_start: "undefined", commande: "undefined", tool_call: "AbortSignal", turn_end: "AbortSignal" };
    for (const x of m) {
      exiger(e, "C5.2/membre", x.membres?.signal?.present === true && x.signal !== "absent", "violé", `${x.phase} : membre signal absent`);
      exiger(e, "C5.2/valeur", x.signal === attendu[x.phase], "violé", `${x.phase} : signal ${x.signal}, ${attendu[x.phase]} attendu`);
    }
    if (m.length && !e.viole.length) e.vu.push(`signal présent ; ${m.map((x) => `${x.phase}=${x.signal}`).join(", ")}`);
    v.push(conclure("C5.2", e, m.length));
  }
  {
    const e = nouveauxEcarts();
    base(e);
    for (const x of m) {
      exiger(e, "C5.3/present", x.membres?.thinkingLevel?.present === true && x.thinkingLevel !== "absent", "violé", `${x.phase} : membre thinkingLevel absent`);
      exiger(e, "C5.3/valeur", x.thinkingLevel === thinking || x.thinkingLevel === "absent", "violé", `${x.phase} : thinkingLevel ${JSON.stringify(x.thinkingLevel)}, ${thinking} attendu`);
    }
    if (m.length && !e.viole.length) e.vu.push(`thinkingLevel = ${thinking} aux ${m.length} observations`);
    v.push(conclure("C5.3", e, m.length));
  }
  {
    const e = nouveauxEcarts();
    const te = membresPhase(o, "turn_end");
    if (!te.length) exiger(e, "C5.4/capture", false, "indéterminé", "aucune observation turn_end");
    for (const x of te) {
      const u = x.usage?.ok ? x.usage.valeur : undefined;
      const formeA = u && typeof u === "object" && typeof u.tokens === "number" && typeof u.contextWindow === "number" && typeof u.percent === "number" && Object.keys(u).length === 3;
      const formeB = u && typeof u === "object" && u.tokens === null && typeof u.contextWindow === "number" && u.percent === null && Object.keys(u).length === 3;
      const formeC = u === "<undefined>";
      exiger(e, "C5.4/forme", !!(formeA || formeB || formeC), "violé", `getContextUsage() de forme non valide : ${JSON.stringify(x.usage)}`);
    }
    if (te.length && !e.viole.length) e.vu.push(`getContextUsage() : ${te.map((x) => JSON.stringify(x.usage.valeur)).join(" ; ")}`);
    v.push(conclure("C5.4", e, te.length));
  }
  {
    const e = nouveauxEcarts();
    base(e);
    for (const x of m) {
      for (const k of ["compact", "isIdle"]) exiger(e, "C5.5/membre", x.membres?.[k]?.present === true && x.membres?.[k]?.type === "function", "violé", `${x.phase} : ${k} ${JSON.stringify(x.membres?.[k])}`);
      exiger(e, "C5.5/getEntries", x.getEntries === "function", "violé", `${x.phase} : sessionManager.getEntries ${x.getEntries}`);
      exiger(e, "C5.5/model", x.modelId === "m", "violé", `${x.phase} : model.id ${JSON.stringify(x.modelId)}`);
    }
    if (m.length && !e.viole.length) e.vu.push("compact, isIdle, sessionManager.getEntries présents ; model.id = m");
    v.push(conclure("C5.5", e, m.length));
  }
  {
    const e = nouveauxEcarts();
    base(e);
    for (const x of m) exiger(e, "C5.6/absent", x.membres?.getSessionStats?.present === false, "violé", `${x.phase} : getSessionStats ${JSON.stringify(x.membres?.getSessionStats)}`);
    if (m.length && !e.viole.length) e.vu.push(`getSessionStats absent de ctx aux ${m.length} observations (et non présent à undefined)`);
    v.push(conclure("C5.6", e, m.length));
  }
  {
    const e = nouveauxEcarts();
    const x = o.sonde.filter((y) => y.t === "epreuve" && y.epreuve === "outil-signal");
    if (x.length !== 1) exiger(e, "C5.7/capture", false, "indéterminé", `${x.length} exécution(s) de l'outil d'épreuve`);
    else exiger(e, "C5.7/abortsignal", x[0].natures?.[2] === "AbortSignal", "violé", `3ᵉ argument d'execute : ${JSON.stringify(x[0].natures?.[2])} (clés ${JSON.stringify(x[0].troisiemeCles)})`, `3ᵉ argument d'execute : AbortSignal (${x[0].n} arguments)`);
    v.push(conclure("C5.7", e, x.length));
  }
  return v;
}

/** C6.6 : modèle et niveau observés par la sonde et par le fournisseur. */
export function verifierC6_6(o: ObservationsMesure, thinking: string): Verdict {
  const e = nouveauxEcarts();
  const m = membresPhase(o);
  if (!m.length || !o.fournisseur.length) exiger(e, "C6.6/capture", false, "indéterminé", `${m.length} observation(s) de la sonde, ${o.fournisseur.length} appel(s) du fournisseur`);
  for (const x of m) exiger(e, "C6.6/sonde", x.modelId === "m" && x.thinkingLevel === thinking, "violé", `sonde ${x.phase} : model ${x.modelId}, thinking ${x.thinkingLevel}`);
  for (const a of o.fournisseur) {
    exiger(e, "C6.6/modele", a.modele === "m", "violé", `fournisseur appel ${a.appel} : modèle ${a.modele}`);
    exiger(e, "C6.6/reasoning-present", a.reasoningPresent === true, "violé", `fournisseur appel ${a.appel} : options.reasoning absent`);
    exiger(e, "C6.6/reasoning-valeur", a.reasoningPresent !== true || a.reasoning === thinking, "violé", `fournisseur appel ${a.appel} : options.reasoning ${JSON.stringify(a.reasoning)}, ${thinking} attendu`);
  }
  if (m.length && o.fournisseur.length && !e.viole.length) e.vu.push(`modèle m et niveau ${thinking} : sonde (${m.length}), fournisseur (${o.fournisseur.length})`);
  return conclure("C6.6", e, m.length + o.fournisseur.length);
}

/** C6.7 : flux JSON ligne à ligne sur stdout, sortie 0. */
export function verifierC6_7(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  exiger(e, "C6.7/capture", (o.constats ?? []).every((c) => c !== "capture-illisible"), "indéterminé", "ligne illisible dans une capture");
  exiger(e, "C6.7/flux", o.flux.length > 0 && o.flux.every((x) => x !== null && typeof x === "object" && typeof x.type === "string"), "violé", `flux : ${o.flux.length} événement(s), forme non conforme`);
  exiger(e, "C6.7/sortie", o.rc === 0, "violé", `sortie ${o.rc}`);
  if (!e.viole.length && !e.indetermine.length) e.vu.push(`${o.flux.length} événements JSON, un par ligne ; sortie 0`);
  return conclure("C6.7", e, o.flux.length);
}

/** C8.1 : entrées message écrites dans le fichier de session. */
export function verifierC8_1(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  if (o.sessions.length === 0) {
    exiger(e, "C8.1/fichier", false, "violé", "aucun fichier de session écrit");
    return conclure("C8.1", e, 0);
  }
  const entrees = sessionUnique(o, e);
  if (!entrees) return conclure("C8.1", e, 0);
  const msgs = entrees.filter((x) => x.type === "message");
  const assist = msgs.filter((x) => x.message?.role === "assistant");
  const avecUsage = assist.filter((x) => x.message.usage && typeof x.message.usage.totalTokens === "number");
  const avecCall = assist.filter((x) => Array.isArray(x.message.content) && x.message.content.some((c: any) => c?.type === "toolCall"));
  const results = msgs.filter((x) => x.message?.role === "toolResult");
  exiger(e, "C8.1/assistant", assist.length > 0 && avecUsage.length === assist.length, "violé", `${assist.length} assistant, ${avecUsage.length} avec usage`);
  exiger(e, "C8.1/toolCall", avecCall.length > 0, "violé", "aucun assistant avec toolCall écrit");
  exiger(e, "C8.1/toolResult", results.length > 0 && results.every((x) => typeof x.message.toolCallId === "string"), "violé", `${results.length} toolResult, toolCallId : ${results.map((x) => x.message.toolCallId).join(",")}`);
  // details : ceux déclarés par le scénario (outil d'épreuve), écrits tels quels.
  const declares = Object.entries(SOCLE.detailsAttendus ?? {});
  for (const [id, d] of declares) {
    const r = results.filter((x) => x.message.toolCallId === id);
    exiger(e, "C8.1/details", r.length === 1 && JSON.stringify(r[0].message.details) === JSON.stringify(d), "violé", `toolResult ${id} : details écrits ${JSON.stringify(r[0]?.message?.details)}`);
  }
  if (!e.viole.length) e.vu.push(`fichier ${o.sessions[0].fichier} : ${assist.length} assistant avec usage (${avecCall.length} avec toolCall), ${results.length} toolResult avec toolCallId, details écrits pour ${declares.map(([k]) => k).join(", ")}`);
  return conclure("C8.1", e, msgs.length);
}

/** C8.3 : timestamp des entrées et des messages en millisecondes ou chaîne ISO. */
export function verifierC8_3(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const entrees = sessionUnique(o, e);
  if (!entrees) return conclure("C8.3", e, 0);
  const lisible = (t: unknown) => (typeof t === "number" && Number.isSafeInteger(t) && t > 0) || (typeof t === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(t) && !Number.isNaN(Date.parse(t)));
  let n = 0;
  const formes = new Set<string>();
  for (const x of entrees) {
    n++;
    exiger(e, "C8.3/entree", lisible(x.timestamp), "violé", `entrée ${x.type} ${x.id} : timestamp ${JSON.stringify(x.timestamp)}`);
    formes.add(typeof x.timestamp);
    if (x.type === "message" && "timestamp" in (x.message ?? {})) {
      n++;
      exiger(e, "C8.3/message", lisible(x.message.timestamp), "violé", `message ${x.id} : timestamp ${JSON.stringify(x.message.timestamp)}`);
      formes.add(typeof x.message.timestamp);
    }
  }
  if (!e.viole.length) e.vu.push(`${n} timestamp(s) lisibles, formes ${[...formes].join(" et ")}`);
  return conclure("C8.3", e, n);
}

// ── C3.2, C4.1 à C4.3 ────────────────────────────────────────────────────────

export const C4_1: Scenario = { nom: "c4-1-blocage", prompt: "écris x.txt", outils: "read,ls,grep,find,write", tours: [outil("w1", "write", { path: "x.txt", content: "x\n" }), { texte: "refus lu" }], usage: USAGE, contextWindow: 100000, epreuves: ["bloquer-write"], raisonBlocage: RAISON_C4_1 };
export const C4_1_B: Scenario = { ...C4_1, nom: "c4-1-b-block-false", epreuves: ["laisser-write"] };

const resultatDe = (o: ObservationsMesure, id: string) => o.flux.filter((x) => x.type === "tool_execution_end" && x.toolCallId === id);
const texteResultat = (r: any): string => (Array.isArray(r?.result?.content) ? r.result.content.map((c: any) => (c?.type === "text" ? c.text : "")).join("") : "");
const fichierApres = (o: ObservationsMesure, chemin: string): EntreeCwd | undefined => o.inventaireCwd?.apres.find((x) => x.chemin === chemin);

/** toolResult reçu par le fournisseur pour un toolCallId, contenu brut. */
function toolResultRecu(o: ObservationsMesure, id: string): { appel: number; content: any; isError: any }[] {
  const out: { appel: number; content: any; isError: any }[] = [];
  for (const a of o.fournisseur) {
    (a.messages ?? []).forEach((m: any, i: number) => {
      if (m.role === "toolResult" && m.toolCallId === id) out.push({ appel: a.appel, content: a.contenus?.[i]?.content, isError: m.isError });
    });
  }
  return out;
}

export function verifierC4_1(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  if (!o.inventaireCwd) exiger(e, "C4.1/inventaire", false, "indéterminé", "inventaire du cwd absent");
  else exiger(e, "C4.1/fichier", !fichierApres(o, "x.txt"), "violé", "x.txt présent après l'appel bloqué", "x.txt absent");
  const recus = toolResultRecu(o, "w1");
  if (!recus.length) exiger(e, "C4.1/capture", false, "indéterminé", "aucun toolResult w1 reçu par le fournisseur");
  else {
    const r = recus[recus.length - 1];
    exiger(e, "C4.1/raison", (texteContent(r.content) ?? "").includes(RAISON_C4_1), "violé", `toolResult reçu sans la raison : ${JSON.stringify(texteContent(r.content))}`, "toolResult reçu par le fournisseur porte la raison");
    exiger(e, "C4.1/isError", r.isError === true, "violé", `toolResult reçu isError=${r.isError}`, "isError");
  }
  return conclure("C4.1", e, recus.length + (o.inventaireCwd ? 1 : 0));
}

export const C4_2: Scenario = {
  nom: "c4-2-chaine",
  prompt: "écris a.py",
  outils: "read,ls,grep,find,write",
  tours: [outil("w1", "write", { path: "a.py", content: "import os\n" }), { texte: "résultat lu" }],
  usage: USAGE,
  contextWindow: 100000,
  epreuves: ["chaine-tool-result"],
  ajoutToolResult: AJOUT_C4_2,
  extensionsDepot: ["extensions/pi-lint-gate/index.ts"],
  agentDir: { "settings.json": JSON.stringify({ lintGate: { enabled: true, ruff: true, mypy: false } }, null, 2) + "\n" },
  simulateurs: [RUFF_NOTE],
  // B1 : ordre nominal des -e : fournisseur, sonde, pi-lint-gate, extensions-epreuve.
  depotAvantEpreuve: true,
};
export const C4_2_B: Scenario = { ...C4_2, nom: "c4-2-b-ordre-inverse", depotAvantEpreuve: false };

/** C4.2 : contenu reçu = original, puis l'ajout de chaque extension dans l'ordre de chargement (-e). */
export function verifierC4_2(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const recus = toolResultRecu(o, "w1");
  const c = recus.length ? recus[recus.length - 1].content : null;
  if (!Array.isArray(c)) {
    exiger(e, "C4.2/capture", false, "indéterminé", `contenu reçu non classable : ${JSON.stringify(c)}`);
    return conclure("C4.2", e, 0);
  }
  const textes = c.map((b: any) => (b?.type === "text" ? String(b.text) : `[${b?.type}]`));
  const iAjout = textes.findIndex((t) => t === AJOUT_C4_2);
  const iRuff = textes.findIndex((t) => t.includes("--- ruff (a.py) ---"));
  exiger(e, "C4.2/blocs", c.length === 3 && iAjout >= 0 && iRuff >= 0, "violé", `${c.length} bloc(s) reçus : ${JSON.stringify(textes.map((t) => t.slice(0, 40)))}`);
  exiger(e, "C4.2/original", c.length === 3 && iAjout !== 0 && iRuff !== 0 && typeof c[0]?.text === "string" && c[0].text.length > 0, "violé", "bloc original absent en tête du résultat reçu");
  // B1 : l'attendu est fixé par le scénario nominal : pi-lint-gate précède extensions-epreuve dans -e.
  if (c.length === 3) exiger(e, "C4.2/ordre", iRuff === 1 && iAjout === 2, "violé", `ordre reçu : note ruff #${iRuff}, ajout #${iAjout}`, `original, puis la note ruff, puis ${AJOUT_C4_2}, dans l'ordre de chargement`);
  return conclure("C4.2", e, c.length);
}

export const C4_3: Scenario = { nom: "c4-3-prompt", prompt: "réponds", outils: "read,ls,grep,find", tours: [{ texte: "prompt vu" }], usage: USAGE, contextWindow: 100000, epreuves: ["prompt-marqueur"], marqueurPrompt: MARQUEUR_C4_3 };
export const C4_3_B: Scenario = { ...C4_3, nom: "c4-3-b-undefined", epreuves: ["prompt-undefined"] };

/** C4.3 : prompt reçu = base consignée avant l'effet du gestionnaire + marqueur. */
export function verifierC4_3(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const bases = o.sonde.filter((x) => x.t === "epreuve" && x.epreuve === "prompt-base");
  const p = promptRecu(o, 0, e, "C4.3");
  if (bases.length !== 1 || typeof bases[0].base !== "string") exiger(e, "C4.3/base", false, "indéterminé", `${bases.length} base(s) consignée(s) avant l'effet`);
  else if (p !== null) exiger(e, "C4.3/egal", p === bases[0].base + MARQUEUR_C4_3, "violé", `prompt reçu (${p.length} car.) ≠ base (${bases[0].base.length} car.) + marqueur ; marqueur ${p.includes("MARQUEUR-C4.3") ? "présent" : "absent"}`, `prompt reçu = base consignée (${bases[0].base.length} car.) + marqueur`);
  return conclure("C4.3", e, p === null ? 0 : 1);
}

/** Contre-épreuve C4.3 (b) : marqueur absent, base conservée. */
export function verifierC4_3B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const bases = o.sonde.filter((x) => x.t === "epreuve" && x.epreuve === "prompt-base");
  const p = promptRecu(o, 0, e, "C4.3B");
  if (bases.length !== 1 || typeof bases[0].base !== "string") exiger(e, "C4.3B/base", false, "indéterminé", `${bases.length} base(s) consignée(s)`);
  else if (p !== null) exiger(e, "C4.3B/base-conservee", p === bases[0].base && !p.includes("MARQUEUR-C4.3"), "violé", `prompt reçu ≠ base, ou marqueur présent`, "marqueur absent, base conservée");
  return conclure("C4.3/b", e, p === null ? 0 : 1);
}

// ── C6 ───────────────────────────────────────────────────────────────────────

export const C6_1: Scenario = { nom: "c6-1-tools", prompt: "liste", outils: "read,ls,submit", tours: [{ texte: "ensemble vu" }], usage: USAGE, contextWindow: 100000, extensionsDepot: ["subagent-only/envelope/envelope.ts"], envDeclare: { PI_SUBAGENT_ROLE: "scout" } };
export const C6_1_B: Scenario = { ...C6_1, nom: "c6-1-b-read", outils: "read" };

/** C6.1 : outils actifs et outils déclarés au fournisseur = exactement l'ensemble attendu. */
export function verifierC6_1(o: ObservationsMesure, attendu: string[] = ["ls", "read", "submit"]): Verdict {
  const e = nouveauxEcarts();
  const ss = o.sonde.filter((x) => x.t === "session_start");
  const a0 = o.fournisseur.find((x) => x.appel === 0);
  if (ss.length !== 1 || !a0 || !Array.isArray(a0.systemes)) {
    exiger(e, "C6.1/capture", false, "indéterminé", `session_start ${ss.length}, appel 0 ${a0 ? "présent" : "absent"}`);
    return conclure("C6.1", e, 0);
  }
  const actifs = [...(ss[0].actifs ?? [])].sort();
  const declares = new Map<string, boolean>();
  for (const m of a0.systemes) {
    for (const n of Array.isArray(m.toolsRemoved) ? m.toolsRemoved : []) declares.delete(n);
    for (const n of Array.isArray(m.toolsAdded) ? m.toolsAdded : []) declares.set(n, true);
  }
  const decl = [...declares.keys()].sort();
  exiger(e, "C6.1/actifs", JSON.stringify(actifs) === JSON.stringify(attendu), "violé", `getActiveTools() = {${actifs.join(", ")}}`, `getActiveTools() = {${actifs.join(", ")}}`);
  exiger(e, "C6.1/declares", JSON.stringify(decl) === JSON.stringify(attendu), "violé", `outils déclarés au fournisseur = {${decl.join(", ")}}`, `outils déclarés au fournisseur = {${decl.join(", ")}}`);
  return conclure("C6.1", e, actifs.length + decl.length);
}

export const C6_2: Scenario = {
  nom: "c6-2-extensions",
  prompt: "réponds",
  outils: "read,ls,grep,find",
  tours: [{ texte: "extensions vues" }],
  usage: USAGE,
  contextWindow: 100000,
  epreuves: ["commande-a"],
  extensionsDepot: ["extensions/subagent-footer/index.ts"],
  agentDir: { "extensions/piege.ts": PIEGE_EXTENSION },
  // La sonde enregistre sa commande contrats-membres : provenance de la sonde observable.
  sonde: { membres: true },
};
export const C6_2_B: Scenario = { ...C6_2, nom: "c6-2-b-sans-ne", sansNe: true };
/** A3 : extension piège déclarée avant lancement, chemin relatif à PI_CODING_AGENT_DIR et empreinte. */
export const PIEGE_C6_2 = { relatif: "extensions/piege.ts", sha256: createHash("sha256").update(PIEGE_EXTENSION).digest("hex"), commande: "contrats-piege" };
export const PIEGE_EXTENSION_SOURCE = PIEGE_EXTENSION;
/** B2 : commande de l'infrastructure SDK intégrée (builtInExtensions de pi 0.86.0), classée séparément. */
export const COMMANDES_SDK_INTEGREES = [{ nom: "llama", source: "extension", chemin: "<inline:llama.cpp>" }];

/**
 * C6.2 (B2) : les quatre points d'entrée fichiers explicites sont exactement fournisseur, sonde,
 * A (extensions-epreuve.ts) et B (subagent-footer) ; les commandes d'épreuve sont rattachées à
 * sonde, A et B ; l'infrastructure SDK intégrée est déclarée séparément ; le piège n'est ni évalué
 * ni enregistré. Les imports auxiliaires évalués par jiti sont classés, non comptés comme points d'entrée.
 */
export function verifierC6_2(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const ss = o.sonde.filter((x) => x.t === "session_start");
  if (ss.length !== 1 || !o.extensions || !o.transpiles) {
    exiger(e, "C6.2/capture", false, "indéterminé", "session_start, extensions ou évaluations jiti non observées");
    return conclure("C6.2", e, 0);
  }
  const fin = (suffixe: string) => o.extensions!.filter((x) => x.endsWith(suffixe));
  const [fournisseur] = fin("/tests/pi-contrats/fournisseur-scripte.ts"), [sonde] = fin("/tests/pi-contrats/sonde.ts");
  const [a] = fin("/tests/pi-contrats/extensions-epreuve.ts"), [b] = fin("/extensions/subagent-footer/index.ts");
  const entrees = [fournisseur, sonde, a, b];
  exiger(e, "C6.2/points", o.extensions.length === 4 && entrees.every(Boolean) && new Set(o.extensions).size === 4 && entrees.every((x) => typeof o.extensionsSha?.[x] === "string"), "violé", `points d'entrée -e : ${o.extensions.join(", ")}`, "points d'entrée fichiers explicites = {fournisseur, sonde, A, B}, empreintes relevées");
  const cmds: any[] = ss[0].commandesDetail ?? [];
  const provenance = (nom: string) => cmds.filter((c) => c.nom === nom).map((c) => c.chemin);
  exiger(e, "C6.2/provenance", JSON.stringify(provenance("contrats-membres")) === JSON.stringify([sonde]) && JSON.stringify(provenance("contrats-epreuve-a")) === JSON.stringify([a]) && JSON.stringify(provenance("footer")) === JSON.stringify([b]), "violé", `provenances : contrats-membres ${provenance("contrats-membres")}, contrats-epreuve-a ${provenance("contrats-epreuve-a")}, footer ${provenance("footer")}`, "commandes d'épreuve rattachées à sonde, A et B");
  const attendues = new Set(["contrats-membres", "contrats-epreuve-a", "footer", PIEGE_C6_2.commande]);
  const sdk = cmds.filter((c) => COMMANDES_SDK_INTEGREES.some((x) => x.nom === c.nom && x.source === c.source && x.chemin === c.chemin));
  const inattendues = cmds.filter((c) => !attendues.has(c.nom) && !sdk.includes(c));
  exiger(e, "C6.2/commande-inattendue", inattendues.length === 0, "violé", `commande(s) inattendue(s) : ${inattendues.map((c) => `${c.nom} (${c.chemin})`).join(", ")}`, `infrastructure SDK intégrée déclarée séparément : ${sdk.map((c) => `${c.nom} ${c.chemin}`).join(", ") || "aucune"}`);
  const piege = cmds.filter((c) => c.nom === PIEGE_C6_2.commande);
  exiger(e, "C6.2/piege-commande", piege.length === 0, "violé", `commande du piège enregistrée (${piege.map((c) => c.chemin).join(", ")})`, "commande du piège absente");
  const sousAgent = o.transpiles.filter((f) => f.startsWith(o.agentDir + "/"));
  exiger(e, "C6.2/piege-evalue", sousAgent.length === 0, "violé", `jiti évalue sous PI_CODING_AGENT_DIR : ${sousAgent.join(", ")}`, "aucune évaluation sous PI_CODING_AGENT_DIR");
  exiger(e, "C6.2/evalues", entrees.every((x) => x && o.transpiles!.includes(x)), "indéterminé", "points d'entrée attendus non tous évalués par jiti", "les quatre points d'entrée évalués par jiti");
  const auxiliaires = o.transpiles.filter((f) => !entrees.includes(f) && !f.startsWith(o.agentDir + "/"));
  if (!e.viole.length && !e.indetermine.length) e.vu.push(`imports auxiliaires évalués, classés hors points d'entrée : ${auxiliaires.length} (${auxiliaires.map((f) => (o.candidat && f.startsWith(o.candidat) ? `<candidat>${f.slice(o.candidat.length)}` : f)).join(", ")})`);
  exiger(e, "C6.2/fournisseur", o.fournisseur.length > 0 && o.fournisseur.every((x) => x.modele === "m"), "indéterminé", "fournisseur scripté sans appel scripte/m", "fournisseur rattaché à l'appel réel scripte/m");
  return conclure("C6.2", e, cmds.length + o.transpiles.length);
}

/** A3 : contrôle de la contre-épreuve sans -ne : le piège déclaré est évalué, sa commande enregistrée, M2.11 le vise seul. */
export function verifierC6_2B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const chemin = `${o.agentDir}/${PIEGE_C6_2.relatif}`;
  const ss = o.sonde.filter((x) => x.t === "session_start");
  exiger(e, "C6.2B/evalue", (o.transpiles ?? []).includes(chemin), "violé", "piège non évalué par jiti", `piège ${chemin} évalué`);
  const piege = (ss[0]?.commandesDetail ?? []).filter((c: any) => c.nom === PIEGE_C6_2.commande);
  exiger(e, "C6.2B/commande", piege.length === 1 && piege[0].chemin === chemin, "violé", `commande du piège : ${JSON.stringify(piege)}`, "commande du piège enregistrée, provenance exacte");
  const m211 = (o.constatsDetail ?? []).filter((c) => c.id === "M2.11");
  exiger(e, "C6.2B/m211", m211.length === 1 && m211[0].etat === "INVALIDE" && m211[0].detail.includes(chemin), "violé", `constats M2.11 : ${JSON.stringify(m211)}`, "M2.11 INVALIDE visant exactement le piège, conservé");
  const autres = (o.constatsDetail ?? []).filter((c) => c.id !== "M2.11");
  exiger(e, "C6.2B/autres", autres.length === 0, "violé", `autres constats : ${autres.map((c) => c.id).join(", ")}`);
  return conclure("C6.2/b", e, 3);
}

export const C6_3: Scenario = { nom: "c6-3-append-fichier", prompt: "réponds", outils: "read,ls,grep,find", tours: [{ texte: "ajout vu" }], usage: USAGE, contextWindow: 100000, fichiersTmp: { "append.md": APPEND_C6_3 }, argvEnPlus: ["--append-system-prompt", "<TMP>/append.md"] };
export const C6_3_B: Scenario = { ...C6_3, nom: "c6-3-b-inexistant", fichiersTmp: {}, argvEnPlus: ["--append-system-prompt", "<TMP>/inexistant.md"] };
export function verifierC6_3(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const p = promptRecu(o, 0, e, "C6.3");
  if (p !== null) exiger(e, "C6.3/contenu", p.includes(APPEND_C6_3), "violé", "contenu du fichier absent du prompt reçu", "contenu du fichier présent dans le prompt reçu");
  return conclure("C6.3", e, p === null ? 0 : 1);
}
/** Contre-épreuve C6.3 (b) : le texte littéral du chemin inexistant est reçu. */
export function verifierC6_3B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const p = promptRecu(o, 0, e, "C6.3B");
  if (p !== null) exiger(e, "C6.3B/litteral", !!o.tmp && p.includes(`${o.tmp}/inexistant.md`), "violé", "texte littéral du chemin absent du prompt reçu", "texte littéral du chemin inexistant reçu");
  return conclure("C6.3/b", e, p === null ? 0 : 1);
}

export const C6_4: Scenario = { nom: "c6-4-append-texte", prompt: "réponds", outils: "read,ls,grep,find", tours: [{ texte: "texte vu" }], usage: USAGE, contextWindow: 100000, argvEnPlus: ["--append-system-prompt", APPEND_C6_4] };
export function verifierC6_4(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const p = promptRecu(o, 0, e, "C6.4");
  if (p !== null) exiger(e, "C6.4/texte", p.includes(APPEND_C6_4), "violé", "texte absent du prompt reçu", "texte reçu tel quel");
  return conclure("C6.4", e, p === null ? 0 : 1);
}

export const C6_5: Scenario = { nom: "c6-5-no-session", prompt: "réponds", outils: "read,ls,grep,find", tours: [{ texte: "session vue" }], usage: USAGE, contextWindow: 100000, session: "dossier", argvEnPlus: ["--no-session", "--session-id", ID_SESSION_C6_5], sonde: { membres: true } };
export const C6_5_B: Scenario = { ...C6_5, nom: "c6-5-b-avec-session", argvEnPlus: ["--session-id", ID_SESSION_C6_5] };
export function verifierC6_5(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  exiger(e, "C6.5/fichier", o.sessions.length === 0, "violé", `${o.sessions.length} fichier(s) de session écrit(s)`, "aucun fichier de session dans --session-dir");
  const ids = membresPhase(o).map((x) => (x.sessionId?.ok ? x.sessionId.valeur : `erreur ${x.sessionId?.erreur}`));
  if (!ids.length) exiger(e, "C6.5/capture", false, "indéterminé", "aucun identifiant de session observé");
  else exiger(e, "C6.5/id", ids.every((x) => x === ID_SESSION_C6_5), "violé", `identifiants observés : ${[...new Set(ids)].join(", ")}`, `identifiant observé = ${ID_SESSION_C6_5}`);
  return conclure("C6.5", e, ids.length + 1);
}

export const C6_8: Scenario = {
  nom: "c6-8-no-skills",
  prompt: "réponds",
  outils: "read,ls,grep,find",
  tours: [{ texte: "pièges vus" }],
  usage: USAGE,
  contextWindow: 100000,
  argvEnPlus: ["--no-skills", "--no-context-files"],
  agentDir: { "skills/piege-c68/SKILL.md": `---\nname: piege-c68\ndescription: ${PIEGE_SKILL_C6_8} skill piège.\n---\n\nCorps du piège.\n` },
  fichiersCwd: { "AGENTS.md": `${PIEGE_AGENTS_C6_8} : fichier de contexte piège.\n` },
};
export const C6_8_B: Scenario = { ...C6_8, nom: "c6-8-b-sans-drapeaux", argvEnPlus: [] };
export function verifierC6_8(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const p = promptRecu(o, 0, e, "C6.8");
  if (p !== null) {
    exiger(e, "C6.8/skill", !p.includes(PIEGE_SKILL_C6_8) && !p.includes("piege-c68"), "violé", "skill piège présent dans le prompt reçu", "aucune section de skills (piège absent)");
    exiger(e, "C6.8/contexte", !p.includes(PIEGE_AGENTS_C6_8), "violé", "AGENTS.md piège présent dans le prompt reçu", "aucun fichier de contexte (piège absent)");
  }
  return conclure("C6.8", e, p === null ? 0 : 2);
}

// ── C2 : les douze points d'entrée ───────────────────────────────────────────

/** Points d'entrée de C2, chemins relatifs à la copie du candidat. */
export const POINTS_C2: Record<string, string> = {
  "C2.1": "extensions/bash-guard/index.ts",
  "C2.2": "extensions/pi-secret-gate/index.ts",
  "C2.3": "extensions/pi-bq-cost-sentinel/index.ts",
  "C2.4": "extensions/pi-lint-gate/index.ts",
  "C2.5": "extensions/pi-project-brief/index.ts",
  "C2.6": "extensions/pi-session-journal/index.ts",
  "C2.7": "extensions/pi-check-config/index.ts",
  "C2.8": "extensions/compaction-guard/index.ts",
  "C2.9": "extensions/subagent/index.ts",
  "C2.10": "extensions/subagent-footer/index.ts",
  "C2.11": "subagent-only/role-guard.ts",
  "C2.12": "subagent-only/envelope/envelope.ts",
};

/** Exclusions adjugées des enregistrements de C2 (MATRICES § A, K2, K4), sans assertion de satisfaction. */
export const EXCLUSIONS_C2: Record<string, string[]> = {
  "C2.9": ["session_start", "tool_call", "tool_result", "tool_execution_end", "session_shutdown"],
  "C2.10": ["effet UI de session_start (setFooter)", "rendu TUI"],
};

const cheminPoint = (o: ObservationsMesure, clause: string) => (o.candidat ? `${o.candidat}/${POINTS_C2[clause]}` : null);
const sessionStart = (o: ObservationsMesure) => {
  const ss = o.sonde.filter((x) => x.t === "session_start");
  return ss.length === 1 ? ss[0] : null;
};
/** Provenance d'une commande enregistrée (getCommands), ou null. */
function commande(o: ObservationsMesure, nom: string): { n: number; chemin: string | null } {
  const ss = sessionStart(o);
  const c = (ss?.commandesDetail ?? []).filter((x: any) => x.nom === nom);
  return { n: c.length, chemin: c.length === 1 ? c[0].chemin : null };
}
/** Provenance d'un outil (getAllTools), ou null. */
function outilEnregistre(o: ObservationsMesure, nom: string): { n: number; chemin: string | null; source: string | null } {
  const ss = sessionStart(o);
  const c = (ss?.outils ?? []).filter((x: any) => x.nom === nom);
  return { n: c.length, chemin: c.length === 1 ? c[0].chemin : null, source: c.length === 1 ? c[0].source : null };
}

type Enregistrement = { nom: string; observe: boolean | null; detail: string };

/**
 * Verdicts d'un point d'entrée de C2 : chargement, enregistrements exigés, puis comportement(s).
 * Le chargement exige l'absence de diagnostic pour son chemin et l'établissement de l'observation
 * déclarée ; il ne se fonde jamais sur le code de sortie.
 */
function verdictsC2(o: ObservationsMesure, clause: string, enregistrements: Enregistrement[], comportements: Verdict[]): Verdict[] {
  const chemin = cheminPoint(o, clause);
  const v: Verdict[] = [];
  {
    const e = nouveauxEcarts();
    if (!chemin) exiger(e, "C2/candidat", false, "indéterminé", "copie du candidat inconnue");
    else {
      const diag = o.stderr.includes(`Failed to load extension "${chemin}"`) || o.stderr.includes(`Extension path does not exist: ${chemin}`);
      exiger(e, "C2/diagnostic", !diag, "violé", `diagnostic de chargement pour ${POINTS_C2[clause]}`, `aucun diagnostic pour ${POINTS_C2[clause]}`);
      // Sans diagnostic, l'absence de session_start rend le chargement indéterminé ; avec diagnostic,
      // le chargement est violé et pi s'arrête avant session_start (MATRICES § A, contre-épreuve commune).
      if (!diag && !sessionStart(o)) exiger(e, "C2/session_start", false, "indéterminé", "session_start non observé");
      const etablie = enregistrements.length > 0 && enregistrements.every((x) => x.observe === true);
      exiger(e, `C2/observation`, etablie, "violé", `observation déclarée non établie (${enregistrements.filter((x) => x.observe !== true).map((x) => x.nom).join(", ")})`, "observation déclarée établie");
    }
    v.push(conclure(`${clause}/chargement`, e, 1));
  }
  {
    const e = nouveauxEcarts();
    for (const x of enregistrements) {
      if (x.observe === null) exiger(e, `${clause}/enregistrement-capture`, false, "indéterminé", `${x.nom} : ${x.detail}`);
      else exiger(e, `${clause}/enregistrement`, x.observe, "violé", `${x.nom} : ${x.detail}`, `${x.nom} : ${x.detail}`);
    }
    const ex = EXCLUSIONS_C2[clause];
    if (ex && !e.viole.length && !e.indetermine.length) e.vu.push(`exclus explicitement, non qualifiés : ${ex.join(", ")}`);
    v.push(conclure(`${clause}/enregistrements`, e, enregistrements.length));
  }
  v.push(...comportements);
  return v;
}

/** Enregistrement d'une commande avec sa provenance. */
function enregCommande(o: ObservationsMesure, clause: string, nom: string): Enregistrement {
  const c = commande(o, nom);
  if (!sessionStart(o)) return { nom: `commande ${nom}`, observe: null, detail: "session_start non observé" };
  return { nom: `commande ${nom}`, observe: c.n === 1 && c.chemin === cheminPoint(o, clause), detail: `${c.n} enregistrement(s), provenance ${c.chemin}` };
}
/** Enregistrement d'un outil avec sa provenance. */
function enregOutil(o: ObservationsMesure, clause: string, nom: string): Enregistrement {
  const c = outilEnregistre(o, nom);
  if (!sessionStart(o)) return { nom: `outil ${nom}`, observe: null, detail: "session_start non observé" };
  // Provenance de l'extension : chemin exact du point d'entrée ; pi 0.86.0 classe la source d'un outil
  // chargé par -e comme « cli », jamais « builtin ».
  return { nom: `outil ${nom}`, observe: c.n === 1 && c.chemin === cheminPoint(o, clause) && c.source !== "builtin", detail: `${c.n} entrée(s), source ${c.source}, provenance ${c.chemin}` };
}

// C2.1 — bash-guard
export const C2_1: Scenario = {
  nom: "c2-1-bash-guard",
  prompt: "valide",
  outils: "read,ls,grep,find,bash",
  tours: [outil("g1", "bash", { command: "git commit --allow-empty -m x" }), { texte: "refus lu" }],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.1"]],
  gitIdentite: true,
};
export const C2_1_B: Scenario = { ...C2_1, nom: "c2-1-b-sans-garde", extensionsDepot: [] };
function comportementC2_1(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const r = resultatDe(o, "g1");
  if (r.length !== 1) exiger(e, "C2.1/capture", false, "indéterminé", `${r.length} résultat(s) g1`);
  else exiger(e, "C2.1/refus", r[0].isError === true && texteResultat(r[0]).includes("bash-guard"), "violé", `g1 isError=${r[0].isError}, texte ${JSON.stringify(texteResultat(r[0]).slice(0, 80))}`, "tool_execution_end.isError, raison « bash-guard »");
  if (!o.git || o.git.avant === null || o.git.apres === null) exiger(e, "C2.1/git-capture", false, "indéterminé", `comptes git non relevés (${JSON.stringify(o.git)})`);
  else {
    exiger(e, "C2.1/git-avant", o.git.avant === 0, "indéterminé", `git rev-list --count --all avant = ${o.git.avant}`);
    exiger(e, "C2.1/commit", o.git.apres === 0, "violé", `git rev-list --count --all après = ${o.git.apres}`, "aucun commit créé (rev-list --all : 0 → 0)");
  }
  return conclure("C2.1/comportement", e, r.length + (o.git ? 2 : 0));
}
export function verifierC2_1(o: ObservationsMesure): Verdict[] {
  const r = resultatDe(o, "g1");
  return verdictsC2(o, "C2.1", [{ nom: "gestionnaire tool_call", observe: r.length === 1 ? r[0].isError === true && texteResultat(r[0]).includes("bash-guard") : null, detail: "établi par le refus bash-guard" }], [comportementC2_1(o)]);
}
/** Contre-épreuve C2.1 (b) : exactement un commit créé (K8). */
export function verifierC2_1B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  if (!o.git || o.git.avant === null || o.git.apres === null) exiger(e, "C2.1B/git-capture", false, "indéterminé", "comptes git non relevés");
  else exiger(e, "C2.1B/un-commit", o.git.avant === 0 && o.git.apres === 1, "violé", `rev-list --all : ${o.git.avant} → ${o.git.apres}`, "exactement un commit créé (0 → 1)");
  return conclure("C2.1/b", e, o.git ? 2 : 0);
}

// C2.2 — pi-secret-gate
export const C2_2: Scenario = { nom: "c2-2-secret-gate", prompt: "écris la clé", outils: "read,ls,grep,find,write", tours: [outil("w1", "write", { path: "cle.txt", content: `${CLE_C2_2}\n` }), { texte: "refus lu" }], usage: USAGE, contextWindow: 100000, extensionsDepot: [POINTS_C2["C2.2"]] };
export const C2_2_B: Scenario = { ...C2_2, nom: "c2-2-b-sans-garde", extensionsDepot: [] };
function comportementC2_2(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const r = resultatDe(o, "w1");
  if (r.length !== 1) exiger(e, "C2.2/capture", false, "indéterminé", `${r.length} résultat(s) w1`);
  else exiger(e, "C2.2/refus", r[0].isError === true && texteResultat(r[0]).includes("pi-secret-gate"), "violé", `w1 isError=${r[0].isError}`, "refus pi-secret-gate");
  if (!o.inventaireCwd) exiger(e, "C2.2/inventaire", false, "indéterminé", "inventaire du cwd absent");
  else exiger(e, "C2.2/fichier", !fichierApres(o, "cle.txt"), "violé", "cle.txt présent", "cle.txt absent");
  return conclure("C2.2/comportement", e, r.length + 1);
}
export function verifierC2_2(o: ObservationsMesure): Verdict[] {
  const r = resultatDe(o, "w1");
  return verdictsC2(o, "C2.2", [{ nom: "gestionnaire tool_call", observe: r.length === 1 ? r[0].isError === true && texteResultat(r[0]).includes("pi-secret-gate") : null, detail: "établi par le refus pi-secret-gate" }], [comportementC2_2(o)]);
}

// C2.3 — pi-bq-cost-sentinel (K7)
export const C2_3: Scenario = {
  nom: "c2-3-bq-cost",
  prompt: "lance la requête",
  outils: "read,ls,grep,find,bash",
  tours: [outil("q1", "bash", { command: COMMANDE_BQ }), { texte: "résultat lu" }],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.3"]],
  simulateurs: [bq("2 TB")],
};
export const C2_3_B: Scenario = { ...C2_3, nom: "c2-3-b-petite-requete", simulateurs: [bq("512 MB")] };

/**
 * Appels du simulateur bq (B3) : chaque ligne du journal est rattachée à un unique lancement de
 * shell tracé de cette exécution dont le pid est son pid ou son ppid, et dont les arguments portent
 * la commande absolue K7 et la même forme (dry-run ou normale). Zéro correspondance ou plusieurs
 * donnent indéterminé. Chemin et SHA-256 du simulateur sont ceux de la pose déclarée.
 */
function appelsBq(o: ObservationsMesure, e: Ecarts, id: string): { dry: number; normal: number; n: number } | null {
  const j = o.simulateurs.bq;
  const pose = (o.poses ?? []).find((x) => x.nom === "bq");
  if (!Array.isArray(j) || !pose || !o.bin) {
    exiger(e, `${id}/journal`, false, "indéterminé", "journal ou pose du simulateur bq absents");
    return null;
  }
  const absolue = `'${o.bin.replace(/'/g, "'\\''")}'/bq query`;
  const shells = o.fils.filter((f) => ["bash", "sh"].includes(String(f.commande).split("/").pop()!) && typeof f.pid === "number");
  for (const x of j) {
    const dry = (x.argv ?? []).includes("--dry_run");
    exiger(e, `${id}/simulateur`, x.script === pose.chemin && x.sha256 === pose.sha256, "indéterminé", `appel bq non rattaché au simulateur déclaré : ${x.script} (${x.sha256})`);
    const candidats = shells.filter((f) => (f.pid === x.pid || f.pid === x.ppid) && (f.args ?? []).join(" ").includes(absolue) && (f.args ?? []).join(" ").includes("--dry_run") === dry);
    if (candidats.length === 0) exiger(e, `${id}/rattachement`, false, "indéterminé", `appel bq pid ${x.pid}/ppid ${x.ppid} (${dry ? "dry-run" : "normal"}) sans lancement de shell correspondant`);
    else exiger(e, `${id}/ambigu`, candidats.length === 1, "indéterminé", `appel bq pid ${x.pid}/ppid ${x.ppid} : ${candidats.length} lancements de shell correspondants`);
  }
  const dry = j.filter((x) => (x.argv ?? []).includes("--dry_run"));
  const normal = j.filter((x) => !(x.argv ?? []).includes("--dry_run"));
  for (const x of dry) exiger(e, `${id}/args`, JSON.stringify(x.argv) === JSON.stringify(["query", "--dry_run", "--use_legacy_sql=false", "SELECT 1"]), "violé", `arguments du dry-run : ${JSON.stringify(x.argv)}`);
  for (const x of normal) exiger(e, `${id}/args`, JSON.stringify(x.argv) === JSON.stringify(["query", "--use_legacy_sql=false", "SELECT 1"]), "violé", `arguments de l'invocation : ${JSON.stringify(x.argv)}`);
  if (!e.indetermine.length) e.vu.push(`appels bq rattachés à leur shell (pid/ppid, commande absolue, forme) : ${j.map((x) => `${(x.argv ?? []).includes("--dry_run") ? "dry-run" : "normal"} pid ${x.pid} ppid ${x.ppid}`).join(" ; ")}`);
  return { dry: dry.length, normal: normal.length, n: j.length };
}
function comportementC2_3(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const r = resultatDe(o, "q1");
  if (r.length !== 1) exiger(e, "C2.3/capture", false, "indéterminé", `${r.length} résultat(s) q1`);
  else exiger(e, "C2.3/refus", r[0].isError === true && texteResultat(r[0]).includes("bq-cost-sentinel"), "violé", `q1 isError=${r[0].isError}, texte ${JSON.stringify(texteResultat(r[0]).slice(0, 80))}`, "refus, raison « bq-cost-sentinel »");
  const b = appelsBq(o, e, "C2.3");
  if (b) {
    exiger(e, "C2.3/dry-run", b.dry === 1, "violé", `${b.dry} dry-run(s)`, "un dry-run rattaché");
    exiger(e, "C2.3/hors-dry-run", b.normal === 0, "violé", `${b.normal} invocation(s) hors dry-run`, "0 invocation hors dry-run");
  }
  return conclure("C2.3/comportement", e, r.length + (b?.n ?? 0));
}
export function verifierC2_3(o: ObservationsMesure): Verdict[] {
  const r = resultatDe(o, "q1");
  return verdictsC2(o, "C2.3", [{ nom: "gestionnaire tool_call", observe: r.length === 1 ? r[0].isError === true && texteResultat(r[0]).includes("bq-cost-sentinel") : null, detail: "établi par le refus bq-cost-sentinel" }, enregCommande(o, "C2.3", "bq-cost")], [comportementC2_3(o)]);
}
/** Contre-épreuve C2.3 (b) : pas de refus, un dry-run et une invocation normale, rattachés. */
export function verifierC2_3B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const r = resultatDe(o, "q1");
  if (r.length !== 1) exiger(e, "C2.3B/capture", false, "indéterminé", `${r.length} résultat(s) q1`);
  else exiger(e, "C2.3B/accepte", r[0].isError === false, "violé", `q1 isError=${r[0].isError}`, "pas de refus");
  const b = appelsBq(o, e, "C2.3B");
  if (b) exiger(e, "C2.3B/appels", b.dry === 1 && b.normal === 1, "violé", `${b.dry} dry-run, ${b.normal} invocation(s) normale(s)`, "un dry-run et une invocation normale");
  return conclure("C2.3/b", e, r.length + (b?.n ?? 0));
}

// C2.4 — pi-lint-gate (K3)
export const C2_4: Scenario = {
  nom: "c2-4-lint-gate",
  prompt: "écris a.py",
  outils: "read,ls,grep,find,write",
  tours: [outil("w1", "write", { path: "a.py", content: "import os\n" }), { texte: "note lue" }],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.4"]],
  agentDir: { "settings.json": LINT_SETTINGS },
  simulateurs: [RUFF_NOTE, MYPY_OK],
};
export const C2_4_B_RUFF: Scenario = { ...C2_4, nom: "c2-4-b-ruff-muet", simulateurs: [RUFF_MUET, MYPY_OK] };
export const C2_4_B_MYPY: Scenario = { ...C2_4, nom: "c2-4-b-mypy-absent", simulateurs: [RUFF_NOTE] };
function noteRuffRecue(o: ObservationsMesure): boolean | null {
  const recus = toolResultRecu(o, "w1");
  if (!recus.length) return null;
  const t = texteContent(recus[recus.length - 1].content) ?? "";
  return t.includes("--- ruff (a.py) ---") && t.includes(NOTE_RUFF);
}
function comportementC2_4Ruff(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const n = noteRuffRecue(o);
  if (n === null) exiger(e, "C2.4/capture", false, "indéterminé", "aucun toolResult w1 reçu");
  else exiger(e, "C2.4/note-ruff", n, "violé", "note ruff du simulateur absente du résultat reçu", "note ruff du simulateur reçue par le fournisseur");
  const j = o.simulateurs.ruff ?? [];
  exiger(e, "C2.4/ruff-appel", j.length === 1 && JSON.stringify(j[0].argv) === JSON.stringify(["check", "--output-format", "concise", "--no-fix", `${o.cwd}/a.py`]), "violé", `appels ruff : ${JSON.stringify(j.map((x) => x.argv))}`, "ruff appelé une fois sur le chemin absolu de a.py");
  return conclure("C2.4/comportement-ruff", e, j.length + (n === null ? 0 : 1));
}
function comportementC2_4Mypy(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const j = o.simulateurs.mypy;
  if (!Array.isArray(j)) {
    // Simulateur non posé : l'absence d'appel est établie par les lancements tracés.
    const lances = o.fils.filter((f) => f.commande === "mypy");
    exiger(e, "C2.4/mypy-appel", lances.length >= 1, "violé", `aucun appel mypy (${lances.length} lancement(s) tracé(s), simulateur non posé)`);
  } else {
    exiger(e, "C2.4/mypy-appel", j.length >= 1, "violé", "aucun appel mypy", "mypy appelé");
    exiger(e, "C2.4/mypy-unique", j.length <= 1, "violé", `${j.length} appels mypy : nouvel appel au tour sans écriture`, "aucun nouvel appel au tour sans écriture");
    if (j.length === 1) exiger(e, "C2.4/mypy-args", JSON.stringify(j[0].argv) === JSON.stringify(["--no-error-summary", `${o.cwd}/a.py`]), "violé", `arguments mypy : ${JSON.stringify(j[0].argv)}`, "--no-error-summary et le chemin absolu de a.py");
  }
  return conclure("C2.4/comportement-mypy", e, Array.isArray(j) ? j.length : 0);
}
export function verifierC2_4(o: ObservationsMesure): Verdict[] {
  const n = noteRuffRecue(o);
  const j = o.simulateurs.mypy;
  return verdictsC2(
    o,
    "C2.4",
    [
      { nom: "gestionnaire tool_result", observe: n, detail: "établi par la note ruff reçue" },
      { nom: "gestionnaire turn_end", observe: Array.isArray(j) ? j.length === 1 : null, detail: "établi par l'appel mypy journalisé" },
    ],
    [comportementC2_4Ruff(o), comportementC2_4Mypy(o)],
  );
}
/** Contre-épreuve C2.4 (b) mypy absent : la seule exigence mypy est jugée, à partir des lancements tracés. */
export function verifierC2_4BMypy(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const mypy = o.fils.filter((f) => f.commande === "mypy");
  exiger(e, "C2.4B/mypy-absent", mypy.length === 0, "violé", `${mypy.length} lancement(s) de mypy`, "aucun lancement de mypy (simulateur non disponible)");
  const n = noteRuffRecue(o);
  if (n === null) exiger(e, "C2.4B/capture", false, "indéterminé", "aucun toolResult w1 reçu");
  else exiger(e, "C2.4B/ruff-identique", n, "violé", "note ruff absente", "note ruff identique, reçue");
  return conclure("C2.4/b-mypy", e, 1 + (n === null ? 0 : 1));
}

// C2.5 — pi-project-brief
export const C2_5: Scenario = { nom: "c2-5-brief", prompt: "oriente-toi", outils: "read,ls,grep,find", tours: [{ texte: "brief vu" }], usage: USAGE, contextWindow: 100000, extensionsDepot: [POINTS_C2["C2.5"]], fichiersCwd: { ".pi/BRIEF.md": BRIEF_C2_5 } };
export const C2_5_B: Scenario = { ...C2_5, nom: "c2-5-b-sans-brief", fichiersCwd: {} };
function comportementC2_5(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const p = promptRecu(o, 0, e, "C2.5");
  if (p !== null) exiger(e, "C2.5/marqueur", p.includes("MARQUEUR-BRIEF-C2.5") && p.includes(`## Project brief\n\n${BRIEF_C2_5}`), "violé", "marqueur du brief absent du prompt reçu", "le prompt reçu par le fournisseur contient le brief et son marqueur");
  return conclure("C2.5/comportement", e, p === null ? 0 : 1);
}
export function verifierC2_5(o: ObservationsMesure): Verdict[] {
  const e = nouveauxEcarts();
  const p = promptRecu(o, 0, e, "C2.5-enreg");
  return verdictsC2(
    o,
    "C2.5",
    [
      { nom: "gestionnaire before_agent_start", observe: p === null ? null : p.includes("MARQUEUR-BRIEF-C2.5"), detail: "établi par le marqueur reçu" },
      enregCommande(o, "C2.5", "brief"),
    ],
    [comportementC2_5(o)],
  );
}

/**
 * C2.5, gestionnaire tool_result (A1 du 08-10-2026) : write scripté de .pi/BRIEF.md en 41 éléments,
 * sans saut final ; troncature à 40 et note reçue au tour suivant. Réglages projectBrief déclarés.
 */
export const BRIEF_41 = Array.from({ length: 41 }, (_, i) => `BRIEF-${String(i + 1).padStart(2, "0")}`).join("\n");
export const BRIEF_40 = Array.from({ length: 40 }, (_, i) => `BRIEF-${String(i + 1).padStart(2, "0")}`).join("\n");
export const NOTE_TRONCATURE = "\n\nTruncated to 40 lines by pi-project-brief (was 41). Rewrite it shorter rather than leaving it cut mid-sentence.";
export const C2_5_TR: Scenario = {
  nom: "c2-5-tool-result",
  prompt: "rédige le brief",
  outils: "read,ls,grep,find,write",
  tours: [outil("w1", "write", { path: ".pi/BRIEF.md", content: BRIEF_41 }), { texte: "brief écrit" }],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.5"]],
  agentDir: { "settings.json": JSON.stringify({ projectBrief: { enabled: true, maxLines: 40, commitBrief: false } }, null, 2) + "\n" },
  releverAvant: [".pi/BRIEF.md", ".pi/brief.meta.json", ".git/info/exclude"],
  releverFichiers: [".pi/BRIEF.md", ".pi/brief.meta.json", ".git/info/exclude"],
  sortiesFils: true,
};
export const C2_5_TR_B: Scenario = { ...C2_5_TR, nom: "c2-5-tool-result-b-40", tours: [outil("w1", "write", { path: ".pi/BRIEF.md", content: BRIEF_40 }), { texte: "brief écrit" }] };

/** toolResult reçus par le fournisseur portant un bloc text exact. */
function resultatsAvecBloc(o: ObservationsMesure, texte: string): Array<{ appel: number; toolCallId: string; content: any }> {
  const out: Array<{ appel: number; toolCallId: string; content: any }> = [];
  for (const a of o.fournisseur) (a.messages ?? []).forEach((m: any, i: number) => {
    const c = a.contenus?.[i]?.content;
    if (m.role === "toolResult" && Array.isArray(c) && c.some((b: any) => b?.type === "text" && b.text === texte)) out.push({ appel: a.appel, toolCallId: m.toolCallId, content: c });
  });
  return out;
}
function comportementC2_5TR(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const avecNote = resultatsAvecBloc(o, NOTE_TRONCATURE);
  exiger(e, "C2.5TR/note", avecNote.length >= 1, "violé", "note de troncature non reçue par le fournisseur", "note de troncature exacte reçue au tour suivant");
  if (avecNote.length) {
    const r = avecNote[avecNote.length - 1];
    exiger(e, "C2.5TR/rattachement", r.toolCallId === "w1", "violé", `note rattachée à ${r.toolCallId}, w1 attendu`, "note rattachée au write w1 de .pi/BRIEF.md");
    exiger(e, "C2.5TR/original", r.content.length === 2 && r.content[0]?.type === "text" && r.content[0].text !== NOTE_TRONCATURE && r.content[0].text.length > 0, "violé", `résultat reçu : ${r.content.length} bloc(s)`, "résultat original présent, puis la note");
  }
  const f = o.fichiers?.[".pi/BRIEF.md"];
  if (f === undefined) exiger(e, "C2.5TR/fichier-capture", false, "indéterminé", "contenu de .pi/BRIEF.md non relevé");
  else exiger(e, "C2.5TR/fichier", f === BRIEF_40 + "\n", "violé", `.pi/BRIEF.md après : ${f === null ? "absent" : `${f.length} octets, différent de l'attendu`}`, ".pi/BRIEF.md = 40 premiers éléments joints par \\n, puis un \\n final");
  exiger(e, "C2.5TR/initial", o.fichiersAvant?.[".pi/BRIEF.md"] === null && o.fichiersAvant?.[".pi/brief.meta.json"] === null, "indéterminé", "BRIEF.md ou brief.meta.json présents avant lancement");
  const meta = o.fichiers?.[".pi/brief.meta.json"];
  const revParse = (o.sortiesFils ?? []).filter((x) => (x.args ?? []).join(" ").includes("git rev-parse HEAD"));
  e.vu.push(`effets annexes conservés : brief.meta.json ${meta === null || meta === undefined ? "absent" : JSON.stringify(meta).slice(0, 160)} ; .git/info/exclude avant ${JSON.stringify(o.fichiersAvant?.[".git/info/exclude"] ?? null).slice(0, 60)}, après ${JSON.stringify(o.fichiers?.[".git/info/exclude"] ?? null).slice(0, 80)} ; rev-parse : ${revParse.map((x) => `code ${x.code}, stdout ${JSON.stringify(x.stdout).slice(0, 40)}, stderr ${JSON.stringify(x.stderr).slice(0, 60)}`).join(" | ") || "aucun lancement consigné"}`);
  return conclure("C2.5/comportement-tool_result", e, avecNote.length + 1);
}
export function verifierC2_5TR(o: ObservationsMesure): Verdict[] {
  const c = comportementC2_5TR(o);
  return verdictsC2(o, "C2.5", [{ nom: "gestionnaire tool_result", observe: resultatsAvecBloc(o, NOTE_TRONCATURE).some((r) => r.toolCallId === "w1"), detail: "établi par la note de troncature reçue et rattachée au write" }], [c]).map((v) =>
    v.clause.endsWith("/chargement") ? { ...v, clause: "C2.5/chargement-tool_result" } : v.clause.endsWith("/enregistrements") ? { ...v, clause: "C2.5/enregistrement-tool_result" } : v,
  );
}
/** Contrôle de la contre-épreuve (b) : fichier identique octet pour octet, aucune note. */
export function verifierC2_5TRB(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const f = o.fichiers?.[".pi/BRIEF.md"];
  exiger(e, "C2.5TRB/fichier", f === BRIEF_40, "violé", `.pi/BRIEF.md après : ${JSON.stringify(f)?.slice(0, 60)}`, "fichier identique octet pour octet au contenu écrit");
  exiger(e, "C2.5TRB/sans-note", resultatsAvecBloc(o, NOTE_TRONCATURE).length === 0 && !o.fournisseur.some((a) => JSON.stringify(a.contenus ?? []).includes("Truncated to")), "violé", "note de troncature reçue", "aucune note de troncature reçue");
  exiger(e, "C2.5TRB/resultat", toolResultRecu(o, "w1").length > 0, "indéterminé", "aucun toolResult w1 reçu");
  return conclure("C2.5/b-tool-result", e, 2);
}

// C2.6 — pi-session-journal
export const C2_6: Scenario = { nom: "c2-6-journal", prompt: "journalise cette session", outils: "read,ls,grep,find", tours: [{ texte: "session journalisée" }], usage: USAGE, contextWindow: 100000, session: "dossier", extensionsDepot: [POINTS_C2["C2.6"]] };
export const C2_6_B: Scenario = { ...C2_6, nom: "c2-6-b-lecture-seule", journalLectureSeule: true, sonde: { cycle: true } };
/** B5 : contrôle de la contre-épreuve : fixture non inscriptible, chargement, session complète et fermeture, journal absent. */
export function verifierC2_6B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const fx = o.journalFixture;
  exiger(e, "C2.6B/fixture", !!fx && fx.inscriptible === false && fx.presentAvant === false, "indéterminé", `fixture : ${JSON.stringify(fx)}`, `dossier ${fx?.dossier} mode ${fx?.mode}, non inscriptible, journal initialement absent`);
  const chemin = o.candidat ? `${o.candidat}/${POINTS_C2["C2.6"]}` : "";
  exiger(e, "C2.6B/charge", (o.transpiles ?? []).includes(chemin), "indéterminé", "pi-session-journal non évalué", "pi-session-journal évalué");
  exiger(e, "C2.6B/session", o.sessions.length === 1 && nomSession(o).length === 1, "indéterminé", `session : ${o.sessions.length} fichier(s), nom ${JSON.stringify(nomSession(o))}`, "session complète écrite, nommée");
  exiger(e, "C2.6B/fermeture", o.sonde.filter((x) => x.t === "session_shutdown").length === 1, "indéterminé", "session_shutdown non observé", "session_shutdown observé");
  exiger(e, "C2.6B/absent", o.journal === null, "violé", `journal présent (${String(o.journal).length} car.)`, "journal absent après fermeture");
  return conclure("C2.6/b", e, 5);
}
/** Nom de session écrit dans le fichier de session (setSessionName). */
function nomSession(o: ObservationsMesure): string[] {
  const out: string[] = [];
  for (const f of o.sessions) for (const x of f.entrees) if (x.type === "session_info" && typeof x.name === "string") out.push(x.name);
  return out;
}
function comportementC2_6(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const noms = nomSession(o);
  if (o.sessions.length !== 1) exiger(e, "C2.6/session", false, "indéterminé", `${o.sessions.length} fichier(s) de session`);
  else exiger(e, "C2.6/nom", noms.length === 1 && noms[0].endsWith(` — ${C2_6.prompt}`), "violé", `nom(s) de session écrit(s) : ${JSON.stringify(noms)}`, `nom de session « ${noms[0]} » lu dans la session`);
  if (o.journal === undefined) exiger(e, "C2.6/journal-capture", false, "indéterminé", "journal non relevé");
  else exiger(e, "C2.6/journal", typeof o.journal === "string" && noms.length === 1 && o.journal.includes(`— ${noms[0]}\n`), "violé", `journal ${o.journal === null ? "absent" : `sans l'entrée de la session (${o.journal.length} car.)`}`, "journal temporaire écrit avec l'entrée de la session");
  return conclure("C2.6/comportement", e, noms.length + (typeof o.journal === "string" ? 1 : 0));
}
export function verifierC2_6(o: ObservationsMesure): Verdict[] {
  const noms = nomSession(o);
  const j = typeof o.journal === "string" ? o.journal : null;
  return verdictsC2(
    o,
    "C2.6",
    [
      { nom: "gestionnaire session_start", observe: o.sessions.length === 1 ? noms.length === 1 && / — /.test(noms[0]) && !noms[0].startsWith(C2_6.prompt) : null, detail: "établi par la branche relevée au démarrage dans le nom" },
      { nom: "gestionnaire before_agent_start", observe: o.sessions.length === 1 ? noms.length === 1 : null, detail: "établi par setSessionName lu dans la session" },
      { nom: "gestionnaire session_shutdown", observe: o.journal === undefined ? null : j !== null && j.includes("### What happened"), detail: "établi par l'entrée écrite au journal" },
    ],
    [comportementC2_6(o)],
  );
}

// C2.7 : scénario C2_7 (K6, mesures préalables) ; contre-épreuve (b) sans skills.
export const C2_7_B: Scenario = { ...C2_7, nom: "c2-7-b-sans-skills", agentDir: { "settings.json": C2_7.agentDir!["settings.json"] } };
/**
 * Contrôle de la contre-épreuve C2.7 (b) : sans skills, check-config n'émet pas de rapport (notify
 * seulement, sans UI en -p) ; aucun appel du fournisseur, aucun appel python3, et la barrière K6
 * consigne son expiration. Cette absence prévue est distinguée d'une mesure nominale indéterminée.
 */
export function verifierC2_7B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  exiger(e, "C2.7B/aucun-rapport", !o.fournisseur.some((a) => (a.messages ?? []).some((m: any) => m.role === "user" && String(m.texte).startsWith("check-config — "))), "violé", "rapport reçu par le fournisseur", "rapport attendu absent : aucun appel du fournisseur ne le reçoit");
  exiger(e, "C2.7B/python3", (o.simulateurs.python3 ?? []).length === 0, "violé", "python3 appelé", "aucun appel python3");
  const b = o.sonde.filter((x) => x.t === "barriere" && x.nom === "attendre-rapport").map((x) => x.phase);
  exiger(e, "C2.7B/barriere", JSON.stringify(b) === JSON.stringify(["entree", "expiration"]), "indéterminé", `phases de la barrière : ${b.join(" → ")}`, "barrière K6 : entrée puis expiration consignée (absence prévue)");
  return conclure("C2.7/b", e, 3);
}
export function verifierC2_7Item(o: ObservationsMesure): Verdict[] {
  return verdictsC2(o, "C2.7", [enregCommande(o, "C2.7", "check-config")], [{ ...verifierC2_7(o), clause: "C2.7/comportement" }]);
}

// C2.8 : scénario C2_8 (K9) ; contre-épreuve (b) sous 50 %, constat sans attendre de compaction.
export const C2_8_B: Scenario = {
  ...C2_8,
  nom: "c2-8-b-sous-seuil",
  prompts: [ECHANGES_K9.u2, "/contrats-constat"],
  tours: [
    { texte: ECHANGES_K9.a1, usage: usage(1000, 24) },
    { texte: ECHANGES_K9.a2, usage: usage(1100, 24) },
  ],
  sonde: { constat: true },
};
export function verifierC2_8Item(o: ObservationsMesure): Verdict[] {
  const c = verifierC2_8(o);
  const usagesVus = o.sonde.filter((x) => x.t === "turn_end").length;
  return verdictsC2(o, "C2.8", [{ nom: "gestionnaire turn_end", observe: usagesVus ? c.etat === "satisfait" : null, detail: "établi par la compaction et la reprise observées" }], [{ ...c, clause: "C2.8/comportement" }]);
}
/** Contre-épreuves de compaction (b) : aucune entrée compaction, aucun message de reprise, constat fait. */
export function verifierSansCompaction(clause: string) {
  return (o: ObservationsMesure): Verdict => {
    const e = nouveauxEcarts();
    const b = phases(o.sonde, "constat", ["entree", "constat", "sortie"], e);
    const c = b.find((x) => x.phase === "constat");
    if (c) exiger(e, `${clause}B/constat`, c.compactions === 0 && (c.customs ?? []).length === 0, "violé", `constat : ${c.compactions} compaction(s), customs ${JSON.stringify(c.customs)}`, "constat : aucune compaction, aucun message custom");
    const entrees = o.sessions.flatMap((f) => f.entrees);
    if (o.sessions.length !== 1) exiger(e, `${clause}B/session`, false, "indéterminé", `${o.sessions.length} fichier(s) de session`);
    else {
      exiger(e, `${clause}B/compaction`, !entrees.some((x) => x.type === "compaction"), "violé", "entrée compaction écrite", "aucune entrée compaction écrite");
      exiger(e, `${clause}B/reprise`, !entrees.some((x) => x.type === "custom_message" || (x.type === "message" && x.message?.role === "custom")), "violé", "message de reprise écrit", "aucun message de reprise");
    }
    exiger(e, `${clause}B/resume`, !o.fournisseur.some((x) => x.forme === "resume" || x.forme === "resume-divergent"), "violé", "appel de résumé reçu", "aucun appel de résumé");
    return conclure(`${clause}/b`, e, entrees.length);
  };
}

// C2.9 — subagent (K2)
export const C2_9: Scenario = {
  nom: "c2-9-subagent",
  prompt: "délègue",
  outils: "read,ls,grep,find,task",
  tours: [outil("t1", "task", { agent: "scout", task: "explorer le dépôt" }), { texte: "refus lu" }],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.9"]],
};
export const C2_9_B: Scenario = { ...C2_9, nom: "c2-9-b-sans-agents", retirerDuCandidat: ["subagent-only/agents"], outils: "read,ls,grep,find" };
/** B4 : contrôle de la contre-épreuve : point d'entrée évalué, task absent, message stderr de la fixture déclarée. */
export function verifierC2_9B(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const point = o.candidat ? `${o.candidat}/${POINTS_C2["C2.9"]}` : "";
  exiger(e, "C2.9B/evalue", (o.transpiles ?? []).includes(point), "indéterminé", "point d'entrée subagent non évalué", "point d'entrée évalué");
  exiger(e, "C2.9B/task", outilEnregistre(o, "task").n === 0 && !!sessionStart(o), "violé", "task enregistré ou session_start absent", "task absent");
  const message = `subagent: no agent definitions found in ${o.candidat}/subagent-only/agents`;
  exiger(e, "C2.9B/message", o.stderr.split("\n").some((l) => l === message), "violé", "message stderr de la fixture absent", `stderr : « ${message} »`);
  exiger(e, "C2.9B/sans-diagnostic", !o.stderr.includes(`Failed to load extension "${point}"`), "violé", "diagnostic de chargement SDK présent");
  return conclure("C2.9/b", e, 4);
}
function comportementC2_9(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const r = resultatDe(o, "t1");
  if (r.length !== 1) exiger(e, "C2.9/capture", false, "indéterminé", `${r.length} résultat(s) t1`);
  else exiger(e, "C2.9/refus", texteResultat(r[0]).includes("ce dépôt n'est pas prêt pour un run"), "violé", `t1 texte ${JSON.stringify(texteResultat(r[0]).slice(0, 80))}`, `refus du runtime « ce dépôt n'est pas prêt pour un run » (isError=${r[0].isError} tel que transmis par pi)`);
  const enfants = o.fils.filter((f) => String(f.commande).split("/").pop() !== "git");
  exiger(e, "C2.9/sans-enfant", enfants.length === 0, "violé", `lancements autres que git : ${enfants.map((f) => f.commande).join(", ")}`, `aucun enfant pi (lancements : ${o.fils.map((f) => `${f.commande} ${(f.args ?? []).slice(0, 2).join(" ")}`).join(" ; ") || "aucun"})`);
  if (!o.inventaireCwd) exiger(e, "C2.9/inventaire", false, "indéterminé", "inventaires du cwd absents");
  else {
    const a = new Set(o.inventaireCwd.avant.map((x) => JSON.stringify(x)));
    const ajouts = o.inventaireCwd.apres.filter((x) => !a.has(JSON.stringify(x)));
    exiger(e, "C2.9/artefact", ajouts.length === 0 && o.inventaireCwd.apres.length === o.inventaireCwd.avant.length, "violé", `artefacts : ${ajouts.map((x) => x.chemin).join(", ")}`, "aucun .pi-subagent-runs ni artefact de délégation (inventaires identiques)");
  }
  return conclure("C2.9/comportement", e, r.length + o.fils.length);
}
export function verifierC2_9(o: ObservationsMesure): Verdict[] {
  return verdictsC2(o, "C2.9", [enregOutil(o, "C2.9", "task"), enregCommande(o, "C2.9", "subagent-report")], [comportementC2_9(o)]);
}

// C2.10 — subagent-footer (K4)
export const C2_10: Scenario = { nom: "c2-10-footer", prompt: "réponds", outils: "read,ls,grep,find", tours: [{ texte: "footer chargé" }], usage: USAGE, contextWindow: 100000, extensionsDepot: [POINTS_C2["C2.10"]] };
export function verifierC2_10(o: ObservationsMesure): Verdict[] {
  return verdictsC2(o, "C2.10", [enregCommande(o, "C2.10", "footer")], []);
}

// C2.11 — role-guard (K1, K5)
export const C2_11: Scenario = {
  nom: "c2-11-role-guard",
  prompt: "écris",
  outils: "read,ls,grep,find,write,edit",
  tours: [outil("w1", "write", { path: "interdit.txt", content: "interdit\n" }), outil("w2", "write", { path: "autorise.txt", content: "autorisé\n" }), { texte: "écritures vues" }],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.11"]],
  envDeclare: { PI_SUBAGENT_ROLE: "worker", PI_SUBAGENT_WRITE_SCOPE: SCOPE_C2_11 },
};
export const C2_11_B_PERIMETRE: Scenario = { ...C2_11, nom: "c2-11-b-dans-perimetre", tours: [outil("w1", "write", { path: "autorise.txt", content: "autorisé\n" }), outil("w2", "write", { path: "autorise.txt", content: "autorisé\n" }), { texte: "écritures vues" }] };
export const C2_11_K5: Scenario = {
  nom: "c2-11-k5-regroupement",
  prompt: "modifie",
  outils: "read,ls,grep,find,write,edit",
  tours: [
    outil("e1", "edit", { path: "autorise.txt", edits: [{ oldText: "ligne A", newText: "ligne B" }] }),
    outil("e2", "edit", { path: "autorise.txt", edits: [{ oldText: "ligne B", newText: "ligne C" }] }),
    { texte: "note lue" },
  ],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.11"]],
  envDeclare: { PI_SUBAGENT_ROLE: "worker", PI_SUBAGENT_WRITE_SCOPE: SCOPE_C2_11 },
  fichiersCwd: { "autorise.txt": "ligne A\n" },
  releverFichiers: ["autorise.txt"],
};
export const C2_11_K5_B: Scenario = {
  ...C2_11_K5,
  nom: "c2-11-k5-b-fichiers-distincts",
  tours: [
    outil("e1", "edit", { path: "autorise.txt", edits: [{ oldText: "ligne A", newText: "ligne B" }] }),
    outil("e2", "edit", { path: "autre.txt", edits: [{ oldText: "ligne A", newText: "ligne B" }] }),
    { texte: "note lue" },
  ],
  envDeclare: { PI_SUBAGENT_ROLE: "worker", PI_SUBAGENT_WRITE_SCOPE: SCOPE_C2_11_DISTINCTS },
  fichiersCwd: { "autorise.txt": "ligne A\n", "autre.txt": "ligne A\n" },
  releverFichiers: ["autorise.txt", "autre.txt"],
};
function comportementC2_11(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const w1 = resultatDe(o, "w1"), w2 = resultatDe(o, "w2");
  if (w1.length !== 1 || w2.length !== 1) exiger(e, "C2.11/capture", false, "indéterminé", `résultats w1 ${w1.length}, w2 ${w2.length}`);
  else {
    exiger(e, "C2.11/refus", w1[0].isError === true && texteResultat(w1[0]).includes("WRITE_OUTSIDE_SCOPE"), "violé", `w1 isError=${w1[0].isError}, texte ${JSON.stringify(texteResultat(w1[0]).slice(0, 80))}`, "(1) refus WRITE_OUTSIDE_SCOPE");
    exiger(e, "C2.11/accepte", w2[0].isError === false, "violé", `w2 isError=${w2[0].isError}`, "(2) écriture acceptée");
  }
  if (!o.inventaireCwd) exiger(e, "C2.11/inventaire", false, "indéterminé", "inventaire absent");
  else {
    exiger(e, "C2.11/interdit-absent", !fichierApres(o, "interdit.txt"), "violé", "interdit.txt présent", "interdit.txt absent");
    exiger(e, "C2.11/autorise-present", !!fichierApres(o, "autorise.txt"), "violé", "autorise.txt absent", "autorise.txt écrit");
  }
  return conclure("C2.11/comportement", e, w1.length + w2.length);
}
/** Blocs text d'un toolResult reçu par le fournisseur. */
function blocsRecus(o: ObservationsMesure, id: string): string[] | null {
  const r = toolResultRecu(o, id);
  if (!r.length) return null;
  const c = r[r.length - 1].content;
  return Array.isArray(c) ? c.map((b: any) => (b?.type === "text" ? String(b.text) : `[${b?.type}]`)) : typeof c === "string" ? [c] : null;
}
function comportementC2_11K5(o: ObservationsMesure, contenus: Record<string, string>): Verdict {
  const e = nouveauxEcarts();
  const e1 = resultatDe(o, "e1"), e2 = resultatDe(o, "e2");
  const b1 = blocsRecus(o, "e1"), b2 = blocsRecus(o, "e2");
  if (e1.length !== 1 || e2.length !== 1 || !b1 || !b2) exiger(e, "C2.11K5/capture", false, "indéterminé", `résultats e1 ${e1.length}, e2 ${e2.length} ; reçus ${!!b1}, ${!!b2}`);
  else {
    exiger(e, "C2.11K5/editions", e1[0].isError === false && e2[0].isError === false, "indéterminé", `éditions : isError ${e1[0].isError}, ${e2[0].isError}`);
    exiger(e, "C2.11K5/premier", !b1.some((t) => t.includes("modifications de")), "violé", "note au premier résultat", "aucune note au premier résultat");
    exiger(e, "C2.11K5/note", b2.some((t) => t === `\n\n${NOTE_REGROUPEMENT}`), "violé", `note absente du deuxième résultat reçu : ${JSON.stringify(b2.map((t) => t.slice(0, 60)))}`, `note « ${NOTE_REGROUPEMENT} » reçue au deuxième résultat`);
  }
  for (const [nom, attendu] of Object.entries(contenus)) {
    const f = o.fichiers?.[nom];
    if (f === undefined) exiger(e, "C2.11K5/disque-capture", false, "indéterminé", `contenu de ${nom} non relevé`);
    else exiger(e, "C2.11K5/disque", f === attendu, "indéterminé", `${nom} sur disque : ${JSON.stringify(f)}`, `${nom} sur disque : ${JSON.stringify(attendu)}`);
  }
  // K5 : le premier turn_end précède le deuxième appel.
  const sondeOrdre = o.sonde.filter((x) => x.t === "turn_end" || x.t === "tool_call").map((x) => (x.t === "turn_end" ? "T" : x.toolCallId));
  exiger(e, "C2.11K5/tours", JSON.stringify(sondeOrdre.slice(0, 3)) === JSON.stringify(["e1", "T", "e2"]), "indéterminé", `ordre tool_call/turn_end : ${sondeOrdre.join(",")}`, "premier turn_end avant le deuxième appel");
  return conclure("C2.11/comportement-k5", e, e1.length + e2.length);
}
export function verifierC2_11(o: ObservationsMesure): Verdict[] {
  const w1 = resultatDe(o, "w1");
  return verdictsC2(o, "C2.11", [{ nom: "gestionnaire tool_call", observe: w1.length === 1 ? w1[0].isError === true && texteResultat(w1[0]).includes("WRITE_OUTSIDE_SCOPE") : null, detail: "établi par le refus de périmètre" }], [comportementC2_11(o)]);
}
export function verifierC2_11K5(o: ObservationsMesure, contenus: Record<string, string> = { "autorise.txt": "ligne C\n" }): Verdict[] {
  const b2 = blocsRecus(o, "e2");
  const note = b2 ? b2.some((t) => t === `\n\n${NOTE_REGROUPEMENT}`) : null;
  return verdictsC2(
    o,
    "C2.11",
    [
      { nom: "gestionnaire tool_result", observe: note, detail: "établi par la note de regroupement reçue" },
      { nom: "gestionnaire turn_end", observe: note, detail: "établi par le décompte des tours de la note (K5)" },
    ],
    [comportementC2_11K5(o, contenus)],
  ).map((v) => (v.clause.endsWith("/chargement") ? { ...v, clause: "C2.11/chargement-k5" } : v.clause.endsWith("/enregistrements") ? { ...v, clause: "C2.11/enregistrements-k5" } : v));
}

// C2.12 — envelope (K1)
export const C2_12: Scenario = {
  nom: "c2-12-envelope",
  prompt: "soumets",
  outils: "read,ls,grep,find,submit",
  tours: [
    outil("u1", "submit", { status: "ok", summary: "incomplet", hits: [] }),
    outil("u2", "submit", { status: "ok", summary: "rien trouvé", hits: [], gaps: [] }),
  ],
  usage: USAGE,
  contextWindow: 100000,
  extensionsDepot: [POINTS_C2["C2.12"]],
  envDeclare: { PI_SUBAGENT_ROLE: "scout" },
};
export const C2_12_B: Scenario = { ...C2_12, nom: "c2-12-b-invalide-seul", tours: [outil("u1", "submit", { status: "ok", summary: "incomplet", hits: [] }), { texte: "abandon" }] };
function comportementC2_12(o: ObservationsMesure): Verdict {
  const e = nouveauxEcarts();
  const u1 = resultatDe(o, "u1"), u2 = resultatDe(o, "u2");
  if (u1.length !== 1) exiger(e, "C2.12/capture", false, "indéterminé", `${u1.length} résultat(s) u1`);
  else exiger(e, "C2.12/refus-schema", u1[0].isError === true && texteResultat(u1[0]).includes('Validation failed for tool "submit"'), "violé", `u1 isError=${u1[0].isError}, texte ${JSON.stringify(texteResultat(u1[0]).slice(0, 80))}`, "premier submit : refus de schéma");
  exiger(e, "C2.12/pas-de-terminate", o.fournisseur.some((a) => (a.messages ?? []).some((m: any) => m.role === "toolResult" && m.toolCallId === "u1")), "violé", "aucun appel du fournisseur après le submit invalide", "pas de terminate après le submit invalide");
  exiger(e, "C2.12/accepte", u2.length === 1 && u2[0].isError === false && u2[0].result?.details?.role === "scout", "violé", `u2 : ${u2.length} résultat(s), isError ${u2[0]?.isError}, details.role ${JSON.stringify(u2[0]?.result?.details?.role)}`, "second submit : details.role = scout");
  exiger(e, "C2.12/fin", o.fournisseur.length === 2, "violé", `${o.fournisseur.length} appel(s) du fournisseur, 2 attendus (fin du run après le submit valide)`, "fin du run : aucun appel après le submit valide");
  return conclure("C2.12/comportement", e, u1.length + u2.length);
}
export function verifierC2_12(o: ObservationsMesure): Verdict[] {
  return verdictsC2(o, "C2.12", [enregOutil(o, "C2.12", "submit")], [comportementC2_12(o)]);
}

// ── Plan de la campagne de l'item 1 : exécutions et états attendus, déclarés avant exécution ──

export type Execution = {
  id: string;
  nature: "nominal" | "contre-épreuve";
  scenario: Scenario;
  description: string;
  verifier: (o: ObservationsMesure) => Verdict[];
  /**
   * États attendus par clause. Exécution nominale : toutes les clauses produites, satisfaites.
   * Contre-épreuve : seules les clauses listées sont jugées ; les autres sont imprimées, non jugées.
   */
  attendus: Record<string, Etat>;
  /**
   * Contre-épreuve : clause visée et, si elle isole une seule garde (B8), cette garde, que son
   * mutant désarme. Une contre-épreuve qui fait rougir plusieurs gardes n'a pas de mutant : elle
   * est décomposée en contre-épreuves (a) d'une seule garde.
   */
  vise?: string;
  cibles?: string[];
  /**
   * Constats d'exécution attendus (sinon : aucun). A3 : chaque constat attendu vise une cible
   * exacte (`contient`, marqueurs <AGENTDIR> résolus) ; l'exécution reste non qualifiante.
   */
  constatsAttendus?: Array<{ id: string; contient: string }>;
  /** Contre-épreuve : exécution nominale dont l'observation doit rester satisfaite sous le mutant (B8). */
  nominal?: string;
  /** Mode de contre-épreuve de version : identité 0.99.0, NON QUALIFIANT. */
  version?: string;
};

const tous = (vs: Verdict[]): Record<string, Etat> => Object.fromEntries(vs.map((v) => [v.clause, "satisfait" as Etat]));

/** Socle : verdicts de toutes les clauses qu'il porte. */
function verifierSocle(o: ObservationsMesure): Verdict[] {
  return [
    ...verifierC1(o),
    verifierC3(o.sonde),
    verifierC4_4(o, SOCLE),
    ...verifierC5(o, "low"),
    verifierC6_6(o, "low"),
    verifierC6_7(o),
    ...verifierC7(o.flux, SOCLE, o.cwd ?? "", o.rc),
    verifierC8_1(o),
    verifierC8_3(o),
  ];
}
const CLAUSES_SOCLE = ["C1.1-C1.6", "C1.7-C1.8", "C1.9", "C1.10", "C3.1", "C4.4", "C5.1", "C5.2", "C5.3", "C5.4", "C5.5", "C5.6", "C5.7", "C6.6", "C6.7", "C7.1", "C7.2", "C7.3", "C7.4", "C7.5", "C7.6", "C7.8", "C8.1", "C8.3"];
const sat = (clauses: string[]): Record<string, Etat> => Object.fromEntries(clauses.map((c) => [c, "satisfait" as Etat]));
const c2 = (clause: string, comportements: string[]) => sat([`${clause}/chargement`, `${clause}/enregistrements`, ...comportements]);

export const EXECUTIONS_NOMINALES: Execution[] = [
  { id: "socle", nature: "nominal", scenario: SOCLE, description: "C1, C3.1, C4.4, C5, C6.6, C6.7, C7, C8.1, C8.3", verifier: verifierSocle, attendus: sat(CLAUSES_SOCLE) },
  { id: "erreur-fournisseur", nature: "nominal", scenario: ERREUR_FOURNISSEUR, description: "C7 sur erreur du fournisseur scriptée (C7.7)", verifier: (o) => verifierC7(o.flux, ERREUR_FOURNISSEUR, o.cwd ?? "", o.rc), attendus: sat(["C7.1", "C7.2", "C7.3", "C7.4", "C7.5", "C7.6", "C7.7", "C7.8"]) },
  { id: "C3.2", nature: "nominal", scenario: REDEFINITION_READ, description: "redéfinition de read", verifier: (o) => [verifierC3_2(o.sonde)], attendus: sat(["C3.2"]) },
  { id: "C4.1", nature: "nominal", scenario: C4_1, description: "blocage par tool_call", verifier: (o) => [verifierC4_1(o)], attendus: sat(["C4.1"]) },
  { id: "C4.2", nature: "nominal", scenario: C4_2, description: "chaîne tool_result : extensions-epreuve puis lint-gate", verifier: (o) => [verifierC4_2(o)], attendus: sat(["C4.2"]) },
  { id: "C4.3", nature: "nominal", scenario: C4_3, description: "systemPrompt de before_agent_start reçu", verifier: (o) => [verifierC4_3(o)], attendus: sat(["C4.3"]) },
  { id: "C6.1", nature: "nominal", scenario: C6_1, description: "--tools read,ls,submit", verifier: (o) => [verifierC6_1(o)], attendus: sat(["C6.1"]) },
  { id: "C6.2", nature: "nominal", scenario: C6_2, description: "-ne -e A -e B, piège sous PI_CODING_AGENT_DIR/extensions", verifier: (o) => [verifierC6_2(o)], attendus: sat(["C6.2"]) },
  { id: "C6.3", nature: "nominal", scenario: C6_3, description: "--append-system-prompt <fichier>", verifier: (o) => [verifierC6_3(o)], attendus: sat(["C6.3"]) },
  { id: "C6.4", nature: "nominal", scenario: C6_4, description: "--append-system-prompt <texte>", verifier: (o) => [verifierC6_4(o)], attendus: sat(["C6.4"]) },
  { id: "C6.5", nature: "nominal", scenario: C6_5, description: "--no-session --session-id", verifier: (o) => [verifierC6_5(o)], attendus: sat(["C6.5"]) },
  { id: "C6.8", nature: "nominal", scenario: C6_8, description: "--no-skills --no-context-files, pièges posés", verifier: (o) => [verifierC6_8(o)], attendus: sat(["C6.8"]) },
  { id: "C2.1", nature: "nominal", scenario: C2_1, description: "bash-guard, K8", verifier: verifierC2_1, attendus: c2("C2.1", ["C2.1/comportement"]) },
  { id: "C2.2", nature: "nominal", scenario: C2_2, description: "pi-secret-gate", verifier: verifierC2_2, attendus: c2("C2.2", ["C2.2/comportement"]) },
  { id: "C2.3", nature: "nominal", scenario: C2_3, description: "pi-bq-cost-sentinel, K7, dry-run > 1 To", verifier: verifierC2_3, attendus: c2("C2.3", ["C2.3/comportement"]) },
  { id: "C2.4", nature: "nominal", scenario: C2_4, description: "pi-lint-gate, ruff et mypy simulés, K3", verifier: verifierC2_4, attendus: c2("C2.4", ["C2.4/comportement-ruff", "C2.4/comportement-mypy"]) },
  { id: "C2.5", nature: "nominal", scenario: C2_5, description: "pi-project-brief, .pi/BRIEF.md", verifier: verifierC2_5, attendus: c2("C2.5", ["C2.5/comportement"]) },
  { id: "C2.5-tool_result", nature: "nominal", scenario: C2_5_TR, description: "pi-project-brief, write de .pi/BRIEF.md en 41 éléments (A1)", verifier: verifierC2_5TR, attendus: sat(["C2.5/chargement-tool_result", "C2.5/enregistrement-tool_result", "C2.5/comportement-tool_result"]) },
  { id: "C2.6", nature: "nominal", scenario: C2_6, description: "pi-session-journal", verifier: verifierC2_6, attendus: c2("C2.6", ["C2.6/comportement"]) },
  { id: "C2.7", nature: "nominal", scenario: C2_7, description: "pi-check-config, K6", verifier: verifierC2_7Item, attendus: c2("C2.7", ["C2.7/comportement"]) },
  { id: "C2.8", nature: "nominal", scenario: C2_8, description: "compaction-guard, K9", verifier: verifierC2_8Item, attendus: c2("C2.8", ["C2.8/comportement"]) },
  { id: "C2.9", nature: "nominal", scenario: C2_9, description: "subagent, preflight faux, K2", verifier: verifierC2_9, attendus: c2("C2.9", ["C2.9/comportement"]) },
  { id: "C2.10", nature: "nominal", scenario: C2_10, description: "subagent-footer, K4", verifier: verifierC2_10, attendus: c2("C2.10", []) },
  { id: "C2.11", nature: "nominal", scenario: C2_11, description: "role-guard, refus et acceptation, K1", verifier: verifierC2_11, attendus: c2("C2.11", ["C2.11/comportement"]) },
  { id: "C2.11-K5", nature: "nominal", scenario: C2_11_K5, description: "role-guard, deux éditions en deux tours, K5", verifier: (o) => verifierC2_11K5(o), attendus: sat(["C2.11/chargement-k5", "C2.11/enregistrements-k5", "C2.11/comportement-k5"]) },
  { id: "C2.12", nature: "nominal", scenario: C2_12, description: "envelope, scout, K1", verifier: verifierC2_12, attendus: c2("C2.12", ["C2.12/comportement"]) },
  { id: "C8.2", nature: "nominal", scenario: C8_2, description: "ctx.compact de la sonde, K9", verifier: (o) => [verifierC8_2(o)], attendus: sat(["C8.2"]) },
];
void tous;

/** Point d'entrée de C2 remplacé par une copie contenant une erreur de syntaxe : contre-épreuve commune. */
function syntaxeC2(clause: string, base: Scenario, verifier: (o: ObservationsMesure) => Verdict[]): Execution {
  return {
    id: `${clause}/b-syntaxe`,
    nature: "contre-épreuve",
    scenario: { ...base, nom: `${base.nom}-b-syntaxe`, casser: POINTS_C2[clause] },
    description: `${POINTS_C2[clause]} remplacé par une erreur de syntaxe`,
    // Le chargement est aussi jugé sur la même observation, sortie réécrite à 0 (contre-épreuve (a) commune).
    verifier: (o) => [...verifier(o), ...verifier({ ...o, rc: 0 }).filter((v) => v.clause === `${clause}/chargement`).map((v) => ({ ...v, clause: `${clause}/chargement (sortie réécrite à 0)` }))],
    attendus: { [`${clause}/chargement`]: "violé", [`${clause}/chargement (sortie réécrite à 0)`]: "violé" },
    vise: `${clause}/chargement`,
    nominal: clause,
  };
}

export const SOCLE_SANS_SESSION: Scenario = { ...SOCLE, nom: "socle-b-no-session", session: "aucune" };
export const C8_2_B: Scenario = { ...C8_2, nom: "c8-2-b-sans-compact", prompts: [ECHANGES_K9.u2, "/contrats-constat"], sonde: { constat: true } };

export const CONTRE_EPREUVES_REELLES: Execution[] = [
  { id: "C2.1/b", nature: "contre-épreuve", nominal: "C2.1", scenario: C2_1_B, description: "même appel sans bash-guard", verifier: (o) => [...verifierC2_1(o), verifierC2_1B(o)], attendus: { "C2.1/comportement": "violé", "C2.1/b": "satisfait" }, vise: "C2.1/comportement" },
  { id: "C2.2/b", nature: "contre-épreuve", nominal: "C2.2", scenario: C2_2_B, description: "écriture sans pi-secret-gate", verifier: verifierC2_2, attendus: { "C2.2/comportement": "violé" }, vise: "C2.2/comportement" },
  { id: "C2.3/b", nature: "contre-épreuve", nominal: "C2.3", scenario: C2_3_B, description: "dry-run < 1 Go", verifier: (o) => [...verifierC2_3(o), verifierC2_3B(o)], attendus: { "C2.3/comportement": "violé", "C2.3/b": "satisfait" }, vise: "C2.3/comportement" },
  { id: "C2.4/b-ruff", nature: "contre-épreuve", nominal: "C2.4", scenario: C2_4_B_RUFF, description: "ruff muet", verifier: verifierC2_4, attendus: { "C2.4/comportement-ruff": "violé", "C2.4/comportement-mypy": "satisfait" }, vise: "C2.4/comportement-ruff", cibles: ["C2.4/note-ruff"] },
  { id: "C2.4/b-mypy", nature: "contre-épreuve", nominal: "C2.4", scenario: C2_4_B_MYPY, description: "mypy non disponible, ruff identique", verifier: (o) => [...verifierC2_4(o), verifierC2_4BMypy(o)], attendus: { "C2.4/comportement-mypy": "violé", "C2.4/comportement-ruff": "satisfait", "C2.4/b-mypy": "satisfait" }, vise: "C2.4/comportement-mypy", cibles: ["C2.4/mypy-appel"] },
  { id: "C2.5/b", nature: "contre-épreuve", nominal: "C2.5", scenario: C2_5_B, description: "sans BRIEF.md", verifier: verifierC2_5, attendus: { "C2.5/comportement": "violé" }, vise: "C2.5/comportement", cibles: ["C2.5/marqueur"] },
  { id: "C2.5-tool_result/b", nature: "contre-épreuve", nominal: "C2.5-tool_result", scenario: C2_5_TR_B, description: "write de .pi/BRIEF.md en 40 éléments (A1)", verifier: (o) => [...verifierC2_5TR(o), verifierC2_5TRB(o)], attendus: { "C2.5/comportement-tool_result": "violé", "C2.5/b-tool-result": "satisfait" }, vise: "C2.5/comportement-tool_result" },
  { id: "C2.6/b", nature: "contre-épreuve", nominal: "C2.6", scenario: C2_6_B, description: "PI_JOURNAL_PATH dans un dossier non inscriptible (B5)", verifier: (o) => [...verifierC2_6(o), verifierC2_6B(o)], attendus: { "C2.6/comportement": "violé", "C2.6/b": "satisfait" }, vise: "C2.6/comportement", cibles: ["C2.6/journal"] },
  { id: "C2.7/b", nature: "contre-épreuve", nominal: "C2.7", scenario: C2_7_B, description: "mêmes fixtures sans skills : rapport attendu absent, expiration prévue de la barrière", verifier: (o) => [...verifierC2_7Item(o), verifierC2_7B(o)], attendus: { "C2.7/comportement": "indéterminé", "C2.7/b": "satisfait" }, vise: "C2.7/comportement" },
  { id: "C2.8/b", nature: "contre-épreuve", nominal: "C2.8", scenario: C2_8_B, description: "même historique sous 50 %, constat sans attendre de compaction", verifier: (o) => [...verifierC2_8Item(o), verifierSansCompaction("C2.8")(o)], attendus: { "C2.8/comportement": "indéterminé", "C2.8/b": "satisfait" }, vise: "C2.8/comportement" },
  { id: "C2.9/b", nature: "contre-épreuve", nominal: "C2.9", scenario: C2_9_B, description: "PI_AGENT_DIR sans subagent-only/agents (B4)", verifier: (o) => [...verifierC2_9(o), verifierC2_9B(o)], attendus: { "C2.9/enregistrements": "violé", "C2.9/b": "satisfait" }, vise: "C2.9/enregistrements", cibles: ["C2.9/enregistrement"] },
  { id: "C2.11/b-perimetre", nature: "contre-épreuve", nominal: "C2.11", scenario: C2_11_B_PERIMETRE, description: "même écriture dans le périmètre", verifier: verifierC2_11, attendus: { "C2.11/comportement": "violé" }, vise: "C2.11/comportement", cibles: ["C2.11/refus"] },
  { id: "C2.11/b-distincts", nature: "contre-épreuve", nominal: "C2.11-K5", scenario: C2_11_K5_B, description: "deux éditions de fichiers distincts, périmètre exact K1", verifier: (o) => verifierC2_11K5(o, { "autorise.txt": "ligne B\n", "autre.txt": "ligne B\n" }), attendus: { "C2.11/comportement-k5": "violé" }, vise: "C2.11/comportement-k5", cibles: ["C2.11K5/note"] },
  { id: "C2.12/b", nature: "contre-épreuve", nominal: "C2.12", scenario: C2_12_B, description: "submit invalide seul", verifier: verifierC2_12, attendus: { "C2.12/comportement": "violé" }, vise: "C2.12/comportement", cibles: ["C2.12/accepte"] },
  syntaxeC2("C2.1", C2_1, verifierC2_1),
  syntaxeC2("C2.2", C2_2, verifierC2_2),
  syntaxeC2("C2.3", C2_3, verifierC2_3),
  syntaxeC2("C2.4", C2_4, verifierC2_4),
  syntaxeC2("C2.5", C2_5, verifierC2_5),
  syntaxeC2("C2.6", C2_6, verifierC2_6),
  syntaxeC2("C2.7", C2_7, verifierC2_7Item),
  syntaxeC2("C2.8", C2_8, verifierC2_8Item),
  syntaxeC2("C2.9", C2_9, verifierC2_9),
  syntaxeC2("C2.10", C2_10, verifierC2_10),
  syntaxeC2("C2.11", C2_11, verifierC2_11),
  syntaxeC2("C2.12", C2_12, verifierC2_12),
  { id: "C3.1/b-0.99.0", nature: "contre-épreuve", nominal: "socle", scenario: SOCLE, version: "0.99.0", description: "contre-épreuve 0.99.0, NON QUALIFIANT", verifier: (o) => [verifierC3(o.sonde)], attendus: { "C3.1": "violé" }, vise: "C3.1", cibles: ["C3.1/provenance"] },
  { id: "C4.1/b", nature: "contre-épreuve", nominal: "C4.1", scenario: C4_1_B, description: "{block:false}", verifier: (o) => [verifierC4_1(o)], attendus: { "C4.1": "violé" }, vise: "C4.1" },
  { id: "C4.2/b", nature: "contre-épreuve", nominal: "C4.2", scenario: C4_2_B, description: "ordre de chargement inversé (B1)", verifier: (o) => [verifierC4_2(o)], attendus: { "C4.2": "violé" }, vise: "C4.2", cibles: ["C4.2/ordre"] },
  { id: "C4.3/b", nature: "contre-épreuve", nominal: "C4.3", scenario: C4_3_B, description: "retour undefined", verifier: (o) => [verifierC4_3(o), verifierC4_3B(o)], attendus: { "C4.3": "violé", "C4.3/b": "satisfait" }, vise: "C4.3", cibles: ["C4.3/egal"] },
  { id: "C6.1/b", nature: "contre-épreuve", nominal: "C6.1", scenario: C6_1_B, description: "--tools read seul", verifier: (o) => [verifierC6_1(o)], attendus: { "C6.1": "violé" }, vise: "C6.1" },
  { id: "C6.2/b", nature: "contre-épreuve", nominal: "C6.2", scenario: C6_2_B, description: "sans -ne : extension piège chargée (A3), NON QUALIFIANT", verifier: (o) => [verifierC6_2(o), verifierC6_2B(o)], attendus: { "C6.2": "violé", "C6.2/b": "satisfait" }, vise: "C6.2", constatsAttendus: [{ id: "M2.11", contient: `<AGENTDIR>/${PIEGE_C6_2.relatif}` }] },
  { id: "C6.3/b", nature: "contre-épreuve", nominal: "C6.3", scenario: C6_3_B, description: "chemin inexistant", verifier: (o) => [verifierC6_3(o), verifierC6_3B(o)], attendus: { "C6.3": "violé", "C6.3/b": "satisfait" }, vise: "C6.3", cibles: ["C6.3/contenu"] },
  { id: "C6.5/b", nature: "contre-épreuve", nominal: "C6.5", scenario: C6_5_B, description: "sans --no-session", verifier: (o) => [verifierC6_5(o)], attendus: { "C6.5": "violé" }, vise: "C6.5", cibles: ["C6.5/fichier"] },
  { id: "C6.8/b", nature: "contre-épreuve", nominal: "C6.8", scenario: C6_8_B, description: "sans --no-skills ni --no-context-files", verifier: (o) => [verifierC6_8(o)], attendus: { "C6.8": "violé" }, vise: "C6.8" },
  { id: "C8.1/b", nature: "contre-épreuve", nominal: "socle", scenario: SOCLE_SANS_SESSION, description: "--no-session", verifier: (o) => [verifierC8_1(o)], attendus: { "C8.1": "violé" }, vise: "C8.1", cibles: ["C8.1/fichier"] },
  { id: "C8.2/b", nature: "contre-épreuve", nominal: "C8.2", scenario: C8_2_B, description: "même historique sans ctx.compact", verifier: (o) => [verifierC8_2(o), verifierSansCompaction("C8.2")(o)], attendus: { "C8.2": "indéterminé", "C8.2/b": "satisfait" }, vise: "C8.2" },
];

// ── Contre-épreuves (a) des vérificateurs, sur les observations nominales conservées ──

export type ContreEpreuveA = {
  id: string;
  /** Exécution dont l'observation conservée est altérée : nominale, ou contre-épreuve réelle (`source: "b"`, décomposition B8). */
  execution: string;
  source?: "b";
  clause: string;
  alterer: (o: ObservationsMesure) => void;
  attendu: Etat;
  cibles: string[];
};

const premierQ = (l: any[], f: (x: any) => boolean) => {
  const x = l.find(f);
  if (!x) throw new Error("observation à altérer absente");
  return x;
};
const fournisseurAppel = (o: ObservationsMesure, n: number) => premierQ(o.fournisseur, (x) => x.appel === n);
const phaseB = (o: ObservationsMesure, nom: string, p: string) => premierQ(o.sonde, (x) => x.t === "barriere" && x.nom === nom && x.phase === p);
const tfB = (o: ObservationsMesure, ev: string, appel: number) => premierQ(o.sonde, (x) => x.t === "temoin-fournisseur" && x.evenement === ev && x.appel === appel);
const ssB = (o: ObservationsMesure) => premierQ(o.sonde, (x) => x.t === "session_start");
const sessionEntrees = (o: ObservationsMesure) => o.sessions[0].entrees;

export const CONTRE_EPREUVES_A: ContreEpreuveA[] = [
  // C1
  { id: "C1.1/export-retire", execution: "socle", clause: "C1.1-C1.6", attendu: "violé", cibles: ["C1.1/export"], alterer: (o) => { const c = premierQ(o.sonde, (x) => x.t === "chargement"); c.exports = c.exports.filter((x: any) => x[0] !== "defineTool"); } },
  { id: "C1.1/export-undefined", execution: "socle", clause: "C1.1-C1.6", attendu: "violé", cibles: ["C1.1/export"], alterer: (o) => { const c = premierQ(o.sonde, (x) => x.t === "chargement"); c.exports.find((x: any) => x[0] === "getAgentDir")[1] = "undefined"; } },
  { id: "C1.7/valeur", execution: "socle", clause: "C1.7-C1.8", attendu: "violé", cibles: ["C1.7/visibleWidth"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "chargement").tuiAppels.visibleWidthAb = 3; } },
  { id: "C1.8/valeur", execution: "socle", clause: "C1.7-C1.8", attendu: "violé", cibles: ["C1.8/troncature"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "chargement").tuiAppels.largeurTroncature1 = 2; } },
  { id: "C1.9/fabrique", execution: "socle", clause: "C1.9", attendu: "violé", cibles: ["C1.9/fabrique"], alterer: (o) => { o.fournisseur[0].fabrique = "undefined"; } },
  { id: "C1.10/bash-faux", execution: "socle", clause: "C1.10", attendu: "violé", cibles: ["C1.10/bash"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres" && x.phase === "tool_call" && x.toolName === "bash").estBash = false; } },
  { id: "C1.10/read-vrai", execution: "socle", clause: "C1.10", attendu: "violé", cibles: ["C1.10/read"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres" && x.phase === "tool_call" && x.toolName === "bash").estRead = true; } },
  // C3
  { id: "C3.1/builtin-read", execution: "socle", clause: "C3.1", attendu: "violé", cibles: ["C3.1/provenance"], alterer: (o) => { ssB(o).outils.find((x: any) => x.nom === "read").chemin = "builtin:read"; } },
  { id: "C3.1/doublon", execution: "socle", clause: "C3.1", attendu: "violé", cibles: ["C3.1/doublon"], alterer: (o) => { const s = ssB(o); s.outils.push({ ...s.outils.find((x: any) => x.nom === "read") }); } },
  { id: "C3.2/builtin", execution: "C3.2", clause: "C3.2", attendu: "violé", cibles: ["C3.2/provenance"], alterer: (o) => { const r = ssB(o).outils.find((x: any) => x.nom === "read"); r.source = "builtin"; r.chemin = "<builtin:read>"; } },
  // C4.4
  { id: "C4.4/reason", execution: "socle", clause: "C4.4", attendu: "violé", cibles: ["C4.4/reason"], alterer: (o) => { ssB(o).reason = "reload"; } },
  { id: "C4.4/turn_end", execution: "socle", clause: "C4.4", attendu: "violé", cibles: ["C4.4/turn_end"], alterer: (o) => { const i = o.sonde.findIndex((x) => x.t === "turn_end"); o.sonde.splice(i, 1); } },
  { id: "C4.4/toolCallId", execution: "socle", clause: "C4.4", attendu: "violé", cibles: ["C4.4/appariement"], alterer: (o) => { premierQ(o.flux, (x) => x.type === "tool_execution_end").toolCallId = "autre"; } },
  // C5
  { id: "C5.1/cwd", execution: "socle", clause: "C5.1", attendu: "violé", cibles: ["C5.1/cwd"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres").cwd = "/ailleurs"; } },
  { id: "C5.1/hasUI", execution: "socle", clause: "C5.1", attendu: "violé", cibles: ["C5.1/hasUI"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres").hasUI = true; } },
  { id: "C5.2/membre-retire", execution: "socle", clause: "C5.2", attendu: "violé", cibles: ["C5.2/membre"], alterer: (o) => { const m = premierQ(o.sonde, (x) => x.t === "membres" && x.phase === "session_start"); m.membres.signal.present = false; } },
  { id: "C5.2/valeur", execution: "socle", clause: "C5.2", attendu: "violé", cibles: ["C5.2/valeur"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres" && x.phase === "commande").signal = "AbortSignal"; } },
  { id: "C5.3/valeur", execution: "socle", clause: "C5.3", attendu: "violé", cibles: ["C5.3/valeur"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres").thinkingLevel = "off"; } },
  { id: "C5.4/forme", execution: "socle", clause: "C5.4", attendu: "violé", cibles: ["C5.4/forme"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres" && x.phase === "turn_end").usage = { ok: true, valeur: { tokens: "115", contextWindow: 100000, percent: 0.1 } }; } },
  { id: "C5.5/model", execution: "socle", clause: "C5.5", attendu: "violé", cibles: ["C5.5/model"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres").modelId = "autre"; } },
  { id: "C5.6/present", execution: "socle", clause: "C5.6", attendu: "violé", cibles: ["C5.6/absent"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres").membres.getSessionStats = { present: true, type: "undefined" }; } },
  { id: "C5.7/objet", execution: "socle", clause: "C5.7", attendu: "violé", cibles: ["C5.7/abortsignal"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "epreuve" && x.epreuve === "outil-signal").natures[2] = "object"; } },
  // C6
  { id: "C6.4/texte", execution: "C6.4", clause: "C6.4", attendu: "violé", cibles: ["C6.4/texte"], alterer: (o) => { const a = fournisseurAppel(o, 0); a.systemes = JSON.parse(JSON.stringify(a.systemes).split("TEXTE-APPEND-C6.4").join("TEXTE-ALTERE")); } },
  { id: "C6.6/reasoning-valeur", execution: "socle", clause: "C6.6", attendu: "violé", cibles: ["C6.6/reasoning-valeur"], alterer: (o) => { o.fournisseur[0].reasoning = "off"; } },
  { id: "C6.6/reasoning-absent", execution: "socle", clause: "C6.6", attendu: "violé", cibles: ["C6.6/reasoning-present"], alterer: (o) => { o.fournisseur[0].reasoningPresent = false; o.fournisseur[0].reasoning = null; } },
  { id: "C6.6/modele", execution: "socle", clause: "C6.6", attendu: "violé", cibles: ["C6.6/modele"], alterer: (o) => { o.fournisseur[0].modele = "autre"; } },
  { id: "C6.6/sonde", execution: "socle", clause: "C6.6", attendu: "violé", cibles: ["C6.6/sonde"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "membres").thinkingLevel = "off"; } },
  { id: "C5.3/present", execution: "socle", clause: "C5.3", attendu: "violé", cibles: ["C5.3/present"], alterer: (o) => { const m = premierQ(o.sonde, (x) => x.t === "membres"); m.membres.thinkingLevel = { present: false, type: "undefined" }; m.thinkingLevel = "absent"; } },
  { id: "C6.7/sortie", execution: "socle", clause: "C6.7", attendu: "violé", cibles: ["C6.7/sortie"], alterer: (o) => { o.rc = 1; } },
  // C7 (socle et erreur du fournisseur)
  { id: "C7.1/cwd", execution: "socle", clause: "C7.1", attendu: "violé", cibles: ["C7.1/session"], alterer: (o) => { o.flux[0].cwd = "/ailleurs"; } },
  { id: "C7.2/usage", execution: "socle", clause: "C7.2", attendu: "violé", cibles: ["C7.2/usage"], alterer: (o) => { premierQ(o.flux, (e) => e.type === "message_end" && e.message?.role === "assistant").message.usage.input = 99; } },
  { id: "C7.2/champ-retire", execution: "socle", clause: "C7.2", attendu: "violé", cibles: ["C7.2/usage"], alterer: (o) => { delete premierQ(o.flux, (e) => e.type === "message_end" && e.message?.role === "assistant").message.usage.cacheWrite; } },
  { id: "C7.2/reasoning", execution: "socle", clause: "C7.2", attendu: "violé", cibles: ["C7.2/reasoning"], alterer: (o) => { premierQ(o.flux, (e) => e.type === "message_end" && e.message?.role === "assistant").message.usage.reasoning = 3; } },
  { id: "C7.3/message", execution: "socle", clause: "C7.3", attendu: "violé", cibles: ["C7.3/message"], alterer: (o) => { o.flux.push({ type: "message" }); } },
  { id: "C7.4/args", execution: "socle", clause: "C7.4", attendu: "violé", cibles: ["C7.4/appel"], alterer: (o) => { premierQ(o.flux, (e) => e.type === "tool_execution_start").args = { command: "autre" }; } },
  { id: "C7.5/isError", execution: "socle", clause: "C7.5", attendu: "violé", cibles: ["C7.5/isError"], alterer: (o) => { premierQ(o.flux, (e) => e.type === "tool_execution_end").isError = true; } },
  { id: "C7.5/details", execution: "socle", clause: "C7.5", attendu: "violé", cibles: ["C7.5/details"], alterer: (o) => { premierQ(o.flux, (e) => e.type === "tool_execution_end" && e.toolCallId === "s1").result.details.epreuve = "autre"; } },
  { id: "C7.6/turn_end", execution: "socle", clause: "C7.6", attendu: "violé", cibles: ["C7.6/nombre"], alterer: (o) => { o.flux.splice(o.flux.findIndex((e) => e.type === "turn_end"), 1); } },
  { id: "C7.7/errorMessage", execution: "erreur-fournisseur", clause: "C7.7", attendu: "violé", cibles: ["C7.7/erreur"], alterer: (o) => { premierQ(o.flux, (e) => e.type === "message_end" && e.message?.role === "assistant").message.errorMessage = "autre"; } },
  { id: "C7.7/sortie", execution: "erreur-fournisseur", clause: "C7.7", attendu: "violé", cibles: ["C7.7/erreur"], alterer: (o) => { o.rc = 1; } },
  { id: "C7.8/agent_end", execution: "socle", clause: "C7.8", attendu: "violé", cibles: ["C7.8/comptes"], alterer: (o) => { o.flux.push({ type: "agent_end" }); } },
  { id: "C7.8/type-inconnu", execution: "socle", clause: "C7.8", attendu: "violé", cibles: ["C7.8/comptes"], alterer: (o) => { o.flux.push({ type: "type_inconnu" }); } },
  // C8
  { id: "C8.3/timestamp", execution: "socle", clause: "C8.3", attendu: "violé", cibles: ["C8.3/entree"], alterer: (o) => { sessionEntrees(o)[0].timestamp = "hier"; } },
  { id: "C8.2/entree-retiree", execution: "C8.2", clause: "C8.2", attendu: "violé", cibles: ["compaction/nombre"], alterer: (o) => { o.sessions[0].entrees = sessionEntrees(o).filter((x) => x.type !== "compaction"); } },
  { id: "C8.2/timestamp-retire", execution: "C8.2", clause: "C8.2", attendu: "violé", cibles: ["compaction/timestamp"], alterer: (o) => { delete premierQ(sessionEntrees(o), (x) => x.type === "compaction").timestamp; } },
  { id: "C8.2/I1-A", execution: "C8.2", clause: "C8.2", attendu: "violé", cibles: ["I1-A/frontiere"], alterer: (o) => { const autre = premierQ(sessionEntrees(o), (x) => x.type === "message" && x.message?.role === "assistant"); const c = premierQ(sessionEntrees(o), (x) => x.type === "compaction"); c.firstKeptEntryId = autre.id; premierQ(o.sonde, (x) => x.t === "barriere" && x.phase === "onComplete").firstKeptEntryId = autre.id; } },
  // C2
  { id: "C2.3/chemin", execution: "C2.3", clause: "C2.3/comportement", attendu: "indéterminé", cibles: ["C2.3/simulateur"], alterer: (o) => { o.simulateurs.bq[0].script = "/ailleurs/bq"; } },
  { id: "C2.3/rattachement", execution: "C2.3", clause: "C2.3/comportement", attendu: "indéterminé", cibles: ["C2.3/rattachement"], alterer: (o) => { o.simulateurs.bq[0].pid = -1; o.simulateurs.bq[0].ppid = -1; } },
  { id: "C2.7/rapport-retire", execution: "C2.7", clause: "C2.7/comportement", attendu: "violé", cibles: ["C2.7/rapport"], alterer: (o) => { const a = fournisseurAppel(o, 0); a.messages = a.messages.filter((m: any) => m.role !== "user"); } },
  { id: "C2.7/ordre-attente", execution: "C2.7", clause: "C2.7/comportement", attendu: "indéterminé", cibles: ["barriere/phases"], alterer: (o) => { const b = o.sonde.filter((x) => x.t === "barriere"); const i = o.sonde.indexOf(b[1]), j = o.sonde.indexOf(b[2]); [o.sonde[i], o.sonde[j]] = [o.sonde[j], o.sonde[i]]; } },
  { id: "C2.7/D1-numero-0", execution: "C2.7", clause: "C2.7/comportement", attendu: "indéterminé", cibles: ["D1/numero"], alterer: (o) => { phaseB(o, "attendre-rapport", "rapport-recu").temoin = 0; } },
  { id: "C2.7/D1-autre-numero", execution: "C2.7", clause: "C2.7/comportement", attendu: "indéterminé", cibles: ["D1/temoin-recu"], alterer: (o) => { phaseB(o, "attendre-rapport", "rapport-recu").temoin = tfB(o, "fini", 0).temoin; } },
  { id: "C2.7/D1-autre-appel", execution: "C2.7", clause: "C2.7/comportement", attendu: "indéterminé", cibles: ["D1/appel"], alterer: (o) => { phaseB(o, "attendre-rapport", "rapport-recu").appel = 1; } },
  { id: "C2.7/D1-reception-absente", execution: "C2.7", clause: "C2.7/comportement", attendu: "indéterminé", cibles: ["D1/presence"], alterer: (o) => { o.sonde.splice(o.sonde.indexOf(tfB(o, "recu", 0)), 1); } },
  { id: "C2.7/D1-reception-dupliquee", execution: "C2.7", clause: "C2.7/comportement", attendu: "indéterminé", cibles: ["D1/unicite"], alterer: (o) => { const r = tfB(o, "recu", 0); o.sonde.splice(o.sonde.indexOf(r) + 1, 0, { ...r }); } },
  { id: "C2.7/D1-ordre-inverse", execution: "C2.7", clause: "C2.7/comportement", attendu: "indéterminé", cibles: ["D1/ordre"], alterer: (o) => { const r = tfB(o, "recu", 0), f = tfB(o, "fini", 0); const x = r.temoin; r.temoin = f.temoin; f.temoin = x; phaseB(o, "attendre-rapport", "rapport-recu").temoin = r.temoin; } },
  { id: "C2.8/reprise-retiree", execution: "C2.8", clause: "C2.8/comportement", attendu: "violé", cibles: ["C2.8/reprise-texte"], alterer: (o) => { const a = fournisseurAppel(o, 3); a.messages = a.messages.map((m: any) => (m.texte === MESSAGE_REPRISE ? { ...m, texte: "autre" } : m)); } },
  { id: "C2.8/ordre", execution: "C2.8", clause: "C2.8/comportement", attendu: "indéterminé", cibles: ["C2.8/ordre-temoins"], alterer: (o) => { const sc = phaseB(o, "attendre-compaction", "session-compact"), mc = phaseB(o, "attendre-compaction", "message-custom"); const x = sc.temoin; sc.temoin = mc.temoin; mc.temoin = x; } },
  { id: "C2.8/I1-A", execution: "C2.8", clause: "C2.8/comportement", attendu: "violé", cibles: ["I1-A/frontiere"], alterer: (o) => { const autre = premierQ(sessionEntrees(o), (x) => x.type === "message" && x.message?.role === "assistant"); premierQ(sessionEntrees(o), (x) => x.type === "compaction").firstKeptEntryId = autre.id; } },
  { id: "C2.8/D1-numero-0", execution: "C2.8", clause: "C2.8/comportement", attendu: "indéterminé", cibles: ["D1/numero"], alterer: (o) => { phaseB(o, "attendre-compaction", "reprise-recue").temoin = 0; } },
  { id: "C2.8/D1-autre-appel", execution: "C2.8", clause: "C2.8/comportement", attendu: "indéterminé", cibles: ["D1/appel"], alterer: (o) => { phaseB(o, "attendre-compaction", "reprise-recue").appel = 2; } },
  { id: "C2.8/D1-reception-dupliquee", execution: "C2.8", clause: "C2.8/comportement", attendu: "indéterminé", cibles: ["D1/unicite"], alterer: (o) => { const r = tfB(o, "recu", 3); o.sonde.splice(o.sonde.indexOf(r) + 1, 0, { ...r }); } },
  { id: "C2.9/raison", execution: "C2.9", clause: "C2.9/comportement", attendu: "violé", cibles: ["C2.9/refus"], alterer: (o) => { const r = premierQ(o.flux, (x) => x.type === "tool_execution_end" && x.toolCallId === "t1"); r.result.content = [{ type: "text", text: "autre raison" }]; } },
  { id: "C2.9/artefact", execution: "C2.9", clause: "C2.9/comportement", attendu: "violé", cibles: ["C2.9/artefact"], alterer: (o) => { o.inventaireCwd!.apres.push({ chemin: ".pi-subagent-runs", type: "dossier" }); } },
  { id: "C2.10/commande-absente", execution: "C2.10", clause: "C2.10/enregistrements", attendu: "violé", cibles: ["C2.10/enregistrement"], alterer: (o) => { const s = ssB(o); s.commandesDetail = s.commandesDetail.filter((c: any) => c.nom !== "footer"); } },
  { id: "C2.10/provenance", execution: "C2.10", clause: "C2.10/enregistrements", attendu: "violé", cibles: ["C2.10/enregistrement"], alterer: (o) => { ssB(o).commandesDetail.find((c: any) => c.nom === "footer").chemin = "/ailleurs/index.ts"; } },
  { id: "C2.11/note-retiree", execution: "C2.11-K5", clause: "C2.11/comportement-k5", attendu: "violé", cibles: ["C2.11K5/note"], alterer: (o) => { const a = premierQ(o.fournisseur, (x) => (x.messages ?? []).some((m: any) => m.role === "toolResult" && m.toolCallId === "e2")); const i = a.messages.findIndex((m: any) => m.role === "toolResult" && m.toolCallId === "e2"); a.contenus[i].content = a.contenus[i].content.filter((b: any) => !(b?.type === "text" && String(b.text).includes("modifications de"))); } },
  // ── Décompositions B8 : une garde par contre-épreuve ──
  { id: "C2.1/refus", execution: "C2.1", clause: "C2.1/comportement", attendu: "violé", cibles: ["C2.1/refus"], alterer: (o) => { premierQ(o.flux, (x) => x.type === "tool_execution_end" && x.toolCallId === "g1").isError = false; } },
  { id: "C2.1/commit", execution: "C2.1", clause: "C2.1/comportement", attendu: "violé", cibles: ["C2.1/commit"], alterer: (o) => { o.git!.apres = 1; } },
  { id: "C2.2/refus", execution: "C2.2", clause: "C2.2/comportement", attendu: "violé", cibles: ["C2.2/refus"], alterer: (o) => { premierQ(o.flux, (x) => x.type === "tool_execution_end" && x.toolCallId === "w1").isError = false; } },
  { id: "C2.2/fichier", execution: "C2.2", clause: "C2.2/comportement", attendu: "violé", cibles: ["C2.2/fichier"], alterer: (o) => { o.inventaireCwd!.apres.push({ chemin: "cle.txt", type: "fichier", sha256: "0".repeat(64) }); } },
  { id: "C2.3/refus", execution: "C2.3", clause: "C2.3/comportement", attendu: "violé", cibles: ["C2.3/refus"], alterer: (o) => { premierQ(o.flux, (x) => x.type === "tool_execution_end" && x.toolCallId === "q1").isError = false; } },
  { id: "C2.3/ambigu", execution: "C2.3", clause: "C2.3/comportement", attendu: "indéterminé", cibles: ["C2.3/ambigu"], alterer: (o) => { const x = o.simulateurs.bq[0]; const sh = o.fils.find((f) => f.pid === x.pid || f.pid === x.ppid); o.fils.push({ ...sh }); } },
  { id: "C2.3/hors-dry-run", source: "b", execution: "C2.3/b", clause: "C2.3/comportement", attendu: "violé", cibles: ["C2.3/hors-dry-run"], alterer: (o) => { const r = premierQ(o.flux, (x) => x.type === "tool_execution_end" && x.toolCallId === "q1"); r.isError = true; r.result.content = [{ type: "text", text: "blocked by bq-cost-sentinel: réinséré par la contre-épreuve" }]; } },
  { id: "C2/diagnostic", execution: "C2.1", clause: "C2.1/chargement", attendu: "violé", cibles: ["C2/diagnostic"], alterer: (o) => { o.stderr += `Failed to load extension "${o.candidat}/${POINTS_C2["C2.1"]}": erreur réinsérée\n`; } },
  { id: "C2/observation", execution: "C2.10", clause: "C2.10/chargement", attendu: "violé", cibles: ["C2/observation"], alterer: (o) => { const s = ssB(o); s.commandesDetail = s.commandesDetail.filter((c: any) => c.nom !== "footer"); } },
  { id: "C2.5TR/note", execution: "C2.5-tool_result", clause: "C2.5/comportement-tool_result", attendu: "violé", cibles: ["C2.5TR/note"], alterer: (o) => { for (const a of o.fournisseur) for (const c of a.contenus ?? []) if (Array.isArray(c.content)) c.content = c.content.filter((b: any) => b?.text !== NOTE_TRONCATURE); } },
  { id: "C2.5TR/fichier", execution: "C2.5-tool_result", clause: "C2.5/comportement-tool_result", attendu: "violé", cibles: ["C2.5TR/fichier"], alterer: (o) => { o.fichiers![".pi/BRIEF.md"] = BRIEF_41; } },
  { id: "C2.5TR/rattachement", execution: "C2.5-tool_result", clause: "C2.5/comportement-tool_result", attendu: "violé", cibles: ["C2.5TR/rattachement"], alterer: (o) => { for (const a of o.fournisseur) (a.messages ?? []).forEach((m: any, i: number) => { if (m.role === "toolResult" && JSON.stringify(a.contenus?.[i]?.content ?? "").includes("Truncated to")) m.toolCallId = "autre"; }); } },
  { id: "C2.8/usages", execution: "C2.8", clause: "C2.8/comportement", attendu: "violé", cibles: ["C2.8/usages"], alterer: (o) => { premierQ(o.sonde, (x) => x.t === "turn_end").usage.tokens = 3000; } },
  { id: "C2.8/compaction-retiree", execution: "C2.8", clause: "C2.8/comportement", attendu: "violé", cibles: ["compaction/nombre"], alterer: (o) => { o.sessions[0].entrees = sessionEntrees(o).filter((x) => x.type !== "compaction"); } },
  { id: "C2.8/custom-retire", execution: "C2.8", clause: "C2.8/comportement", attendu: "violé", cibles: ["C2.8/custom"], alterer: (o) => { o.sessions[0].entrees = sessionEntrees(o).filter((x) => x.type !== "custom_message"); } },
  { id: "C2.8/flux-custom", execution: "C2.8", clause: "C2.8/comportement", attendu: "violé", cibles: ["C2.8/flux-custom"], alterer: (o) => { o.flux = o.flux.filter((x) => !(x.type === "message_end" && x.message?.role === "custom")); } },
  { id: "C2.8/barriere", execution: "C2.8", clause: "C2.8/comportement", attendu: "indéterminé", cibles: ["barriere/phases"], alterer: (o) => { o.sonde.splice(o.sonde.indexOf(phaseB(o, "attendre-compaction", "inactif")), 1); } },
  { id: "C4.1/fichier", execution: "C4.1", clause: "C4.1", attendu: "violé", cibles: ["C4.1/fichier"], alterer: (o) => { o.inventaireCwd!.apres.push({ chemin: "x.txt", type: "fichier", sha256: "0".repeat(64) }); } },
  { id: "C4.1/raison", execution: "C4.1", clause: "C4.1", attendu: "violé", cibles: ["C4.1/raison"], alterer: (o) => { for (const a of o.fournisseur) (a.messages ?? []).forEach((m: any, i: number) => { if (m.role === "toolResult" && m.toolCallId === "w1") a.contenus[i].content = [{ type: "text", text: "autre raison" }]; }); } },
  { id: "C4.1/isError", execution: "C4.1", clause: "C4.1", attendu: "violé", cibles: ["C4.1/isError"], alterer: (o) => { for (const a of o.fournisseur) for (const m of a.messages ?? []) if (m.role === "toolResult" && m.toolCallId === "w1") m.isError = false; } },
  { id: "C6.1/actifs", execution: "C6.1", clause: "C6.1", attendu: "violé", cibles: ["C6.1/actifs"], alterer: (o) => { ssB(o).actifs.push("grep"); } },
  { id: "C6.1/declares", execution: "C6.1", clause: "C6.1", attendu: "violé", cibles: ["C6.1/declares"], alterer: (o) => { premierQ(fournisseurAppel(o, 0).systemes, (m: any) => Array.isArray(m.toolsAdded)).toolsAdded.push("grep"); } },
  { id: "C6.2/points", execution: "C6.2", clause: "C6.2", attendu: "violé", cibles: ["C6.2/points"], alterer: (o) => { o.extensions!.push(`${o.candidat}/extensions/autre/index.ts`); } },
  { id: "C6.2/provenance", execution: "C6.2", clause: "C6.2", attendu: "violé", cibles: ["C6.2/provenance"], alterer: (o) => { ssB(o).commandesDetail.find((c: any) => c.nom === "footer").chemin = "/ailleurs/index.ts"; } },
  { id: "C6.2/commande-inattendue", execution: "C6.2", clause: "C6.2", attendu: "violé", cibles: ["C6.2/commande-inattendue"], alterer: (o) => { ssB(o).commandesDetail.push({ nom: "autre", source: "extension", chemin: "<inline:autre>" }); } },
  { id: "C6.2/piege-commande", execution: "C6.2", clause: "C6.2", attendu: "violé", cibles: ["C6.2/piege-commande"], alterer: (o) => { ssB(o).commandesDetail.push({ nom: PIEGE_C6_2.commande, source: "extension", chemin: `${o.agentDir}/${PIEGE_C6_2.relatif}` }); } },
  { id: "C6.2/piege-evalue", execution: "C6.2", clause: "C6.2", attendu: "violé", cibles: ["C6.2/piege-evalue"], alterer: (o) => { o.transpiles!.push(`${o.agentDir}/${PIEGE_C6_2.relatif}`); } },
  { id: "C6.8/skill", execution: "C6.8", clause: "C6.8", attendu: "violé", cibles: ["C6.8/skill"], alterer: (o) => { const a = fournisseurAppel(o, 0); a.systemes = [...a.systemes, { index: 99, cles: ["role", "content"], content: PIEGE_SKILL_C6_8 }]; } },
  { id: "C6.8/contexte", execution: "C6.8", clause: "C6.8", attendu: "violé", cibles: ["C6.8/contexte"], alterer: (o) => { const a = fournisseurAppel(o, 0); a.systemes = [...a.systemes, { index: 99, cles: ["role", "content"], content: PIEGE_AGENTS_C6_8 }]; } },
];
