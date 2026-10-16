/**
 * Extension de test : observations faites dans le processus pi.
 *
 * Elle consigne dans `PI_CONTRATS_SONDE`, une ligne JSON par observation :
 * les exports du SDK vus par le chargeur, la provenance des outils au
 * `session_start`, les commandes enregistrées et leur provenance, les membres
 * de `ctx` par phase (présence distinguée de la valeur), et chaque
 * `tool_call` / `turn_end`. Elle n'altère rien : aucun retour de gestionnaire.
 *
 * Témoins et commandes d'attente (K6, K9), enregistrés au chargement et
 * seulement si le scénario les déclare (`sonde`) :
 * - `message_end` (rôle, `customType`, `stopReason`) et `session_compact`
 *   (entrée écrite) sont consignés ;
 * - `/contrats-attendre-rapport` attend que le fournisseur ait reçu le rapport
 *   réel (message user commençant par le préfixe déclaré), que la réponse
 *   assistant suivante soit achevée, puis `ctx.waitForIdle()` ;
 * - `/contrats-attendre-compaction` attend `session_compact`, puis le message
 *   réel `customType` déclaré, la réception du texte de reprise par le
 *   fournisseur, la réponse assistant suivante achevée, puis
 *   `ctx.waitForIdle()` ; elle n'appelle ni `compact` ni `sendMessage` ;
 * - `/contrats-compacter` appelle `ctx.compact` une seule fois et attend
 *   `onComplete` ; `onError` est consigné comme échec.
 * Chaque barrière consigne son entrée, chaque témoin franchi et sa sortie ; un
 * délai de 30 000 ms la borne, et son expiration est consignée (indéterminé).
 * Aucune n'envoie de message ni ne relance de tour.
 *
 * Observations de l'item 1, consignées seulement si le scénario les déclare :
 * - `membres` (C5, C1.10, C6.5, C6.6) : à `session_start`, `tool_call`,
 *   `turn_end` et dans la commande `/contrats-membres`, l'état de `ctx` (présence
 *   distinguée de la valeur, nature de `signal`, `thinkingLevel`, `model.id`,
 *   identifiant de session, `getContextUsage()`), et pour `tool_call` le résultat
 *   de `isToolCallEventType("bash", e)` et `("read", e)` ;
 * - `constat` (contre-épreuve de C2.8) : `/contrats-constat` attend
 *   `ctx.waitForIdle()` (30 000 ms) puis consigne les compactions et messages
 *   custom vus ; elle n'attend aucune compaction et n'appelle pas compact.
 * - `cycle` (C2.6 b, B5) : `session_shutdown` est consigné, pour établir la
 *   fermeture de la session.
 * Au chargement, la sonde appelle aussi `visibleWidth("ab")` et
 * `truncateToWidth("abc", 1)` de pi-tui (C1.7, C1.8).
 */
import { appendFileSync, readFileSync } from "node:fs";
import * as sdk from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";

const F = process.env.PI_CONTRATS_SONDE!;
const consigner = (o: unknown) => appendFileSync(F, JSON.stringify(o) + "\n");

const EXPORTS = ["defineTool", "isToolCallEventType", "isEditToolResult", "isWriteToolResult", "getAgentDir", "withFileMutationQueue"];
const MEMBRES = ["cwd", "hasUI", "signal", "thinkingLevel", "model", "getContextUsage", "compact", "isIdle", "sessionManager", "getSessionStats"];
const CANAL = "__piContratsFournisseur";
const DELAI_MS = 30000;

type ConfigSonde = {
  attendreRapport?: { prefixe: string };
  attendreCompaction?: { customType: string; texteReprise: string };
  compacter?: boolean;
  membres?: boolean;
  constat?: boolean;
  cycle?: boolean;
};
const config: ConfigSonde = (JSON.parse(readFileSync(process.env.PI_CONTRATS_SCENARIO!, "utf8")) as { sonde?: ConfigSonde }).sonde ?? {};

/** État de `ctx` à une phase : présence distinguée de la valeur, et valeurs observables. */
function etatCtx(ctx: any) {
  const lire = (f: () => unknown) => {
    try {
      return { ok: true, valeur: f() };
    } catch (e) {
      return { ok: false, erreur: (e as Error).message };
    }
  };
  const signal = ctx?.signal;
  return {
    membres: membres(ctx),
    signal: ctx == null || !("signal" in ctx) ? "absent" : signal === undefined ? "undefined" : signal instanceof AbortSignal ? "AbortSignal" : typeof signal,
    cwd: ctx?.cwd ?? null,
    hasUI: ctx == null || !("hasUI" in ctx) ? "absent" : ctx.hasUI,
    thinkingLevel: ctx == null || !("thinkingLevel" in ctx) ? "absent" : ctx.thinkingLevel ?? null,
    modelId: ctx?.model == null ? null : ctx.model.id ?? null,
    getEntries: typeof ctx?.sessionManager?.getEntries,
    sessionId: lire(() => ctx?.sessionManager?.getSessionId?.() ?? null),
    usage: lire(() => (typeof ctx?.getContextUsage === "function" ? ctx.getContextUsage() ?? "<undefined>" : "<absent>")),
  };
}

function membres(ctx: any) {
  const o: Record<string, { present: boolean; type: string }> = {};
  for (const m of MEMBRES) o[m] = { present: ctx != null && m in ctx, type: ctx == null ? "absent" : typeof ctx[m] };
  return o;
}

// ── Témoins internes, partagés par les barrières ─────────────────────────────
type Temoin = { seq: number; quoi: string; [k: string]: unknown };
const temoins: Temoin[] = [];
const ecouteurs = new Set<() => void>();
let seq = 0;
function enregistrerTemoin(quoi: string, champs: Record<string, unknown>): Temoin {
  const t: Temoin = { seq: ++seq, quoi, ...champs };
  temoins.push(t);
  return t;
}
function notifierTemoins(): void {
  for (const f of [...ecouteurs]) f();
}
function temoin(quoi: string, champs: Record<string, unknown>): Temoin {
  const t = enregistrerTemoin(quoi, champs);
  notifierTemoins();
  return t;
}
type Recu = { appel: number; forme: string; messages: Array<{ role: string; texte: string }>; fini: boolean };
type Canal = { recus: Recu[]; ecouteurs: Set<() => void> };
// Même forme que dans fournisseur-scripte.ts ; le premier chargé le crée.
const canal: Canal = ((globalThis as any)[CANAL] ??= { recus: [], ecouteurs: new Set() });

/**
 * Réception et achèvement des appels du fournisseur, datés dans la suite des témoins au moment
 * où ils surviennent (et non quand une barrière les remarque).
 */
const vus = new Map<number, { recu: number; fini: number | null }>();
function suivreFournisseur(): void {
  for (const r of canal.recus) {
    // Le numéro définitif, l'entrée et le journal précèdent toute notification.
    let v = vus.get(r.appel);
    if (!v) {
      const t = enregistrerTemoin("fournisseur-recu", { appel: r.appel, forme: r.forme });
      v = { recu: t.seq, fini: null };
      vus.set(r.appel, v);
      consigner({ t: "temoin-fournisseur", evenement: "recu", temoin: v.recu, appel: r.appel, forme: r.forme });
      notifierTemoins();
    }
    if (r.fini && v.fini === null) {
      const t = enregistrerTemoin("fournisseur-fini", { appel: r.appel });
      v.fini = t.seq;
      consigner({ t: "temoin-fournisseur", evenement: "fini", temoin: v.fini, appel: r.appel });
      notifierTemoins();
    }
  }
}

class Expiration extends Error {}

/** Attend qu'un prédicat devienne vrai, sur notification des témoins ou du fournisseur, jamais par sommeil. */
function attendre<T>(predicat: () => T | null | undefined, echeance: number): Promise<T> {
  return new Promise((ok, ko) => {
    const c = canal;
    let fini = false;
    const verifier = () => {
      if (fini) return;
      let v: T | null | undefined;
      try {
        v = predicat();
      } catch (e) {
        fin();
        ko(e);
        return;
      }
      if (v !== null && v !== undefined && (v as unknown) !== false) {
        fin();
        ok(v);
      }
    };
    const minuteur = setTimeout(() => {
      fin();
      ko(new Expiration(`délai de ${DELAI_MS} ms écoulé`));
    }, Math.max(0, echeance - Date.now()));
    const fin = () => {
      fini = true;
      clearTimeout(minuteur);
      ecouteurs.delete(verifier);
      c.ecouteurs.delete(verifier);
    };
    ecouteurs.add(verifier);
    c.ecouteurs.add(verifier);
    verifier();
  });
}

/** Une promesse bornée par l'échéance ; le minuteur est annulé dès qu'elle se règle. */
function borner<T>(p: Promise<T>, echeance: number): Promise<T> {
  return new Promise((ok, ko) => {
    const minuteur = setTimeout(() => ko(new Expiration(`délai de ${DELAI_MS} ms écoulé`)), Math.max(0, echeance - Date.now()));
    p.then(
      (v) => {
        clearTimeout(minuteur);
        ok(v);
      },
      (e) => {
        clearTimeout(minuteur);
        ko(e);
      },
    );
  });
}

function barriere(nom: string, etapes: (b: { franchir: (etape: string, champs?: Record<string, unknown>) => void; echeance: number }) => Promise<void>) {
  return async (_args: unknown, ctx: any) => {
    const echeance = Date.now() + DELAI_MS;
    consigner({ t: "barriere", nom, phase: "entree", seq: seq, ts: Date.now() });
    const franchir = (etape: string, champs: Record<string, unknown> = {}) => consigner({ t: "barriere", nom, phase: etape, ts: Date.now(), ...champs });
    try {
      await etapes({ franchir, echeance });
      await borner(ctx.waitForIdle(), echeance);
      franchir("inactif");
      franchir("sortie");
    } catch (e) {
      franchir(e instanceof Expiration ? "expiration" : "erreur", { message: (e as Error).message });
    }
  };
}

export default function (pi: any) {
  const appelTui = (f: () => unknown) => {
    try {
      return f();
    } catch (e) {
      return `erreur : ${(e as Error).message}`;
    }
  };
  consigner({
    t: "chargement",
    exports: EXPORTS.map((k) => [k, typeof (sdk as any)[k]]),
    tui: ["truncateToWidth", "visibleWidth"].map((k) => [k, typeof (tui as any)[k]]),
    tuiAppels: {
      visibleWidthAb: appelTui(() => (tui as any).visibleWidth("ab")),
      largeurTroncature1: appelTui(() => (tui as any).visibleWidth((tui as any).truncateToWidth("abc", 1))),
    },
  });
  pi.on("session_start", (e: any, ctx: any) => {
    const commandes = typeof pi.getCommands === "function" ? pi.getCommands() : null;
    consigner({
      t: "session_start",
      reason: e?.reason ?? null,
      outils: pi.getAllTools().map((x: any) => ({ nom: x.name, source: x.sourceInfo?.source ?? null, chemin: x.sourceInfo?.path ?? null })),
      actifs: pi.getActiveTools(),
      commandes: commandes ? commandes.map((c: any) => c.name) : null,
      commandesDetail: commandes ? commandes.map((c: any) => ({ nom: c.name, source: c.source ?? null, chemin: c.sourceInfo?.path ?? null })) : null,
      ctx: membres(ctx),
    });
  });
  pi.on("tool_call", (e: any, ctx: any) => {
    consigner({ t: "tool_call", toolName: e?.toolName, toolCallId: e?.toolCallId, signal: ctx?.signal instanceof AbortSignal });
    if (config.membres) {
      const estType = (n: string) => {
        try {
          return (sdk as any).isToolCallEventType(n, e);
        } catch (x) {
          return `erreur : ${(x as Error).message}`;
        }
      };
      consigner({ t: "membres", phase: "tool_call", toolName: e?.toolName, toolCallId: e?.toolCallId, estBash: estType("bash"), estRead: estType("read"), ...etatCtx(ctx) });
    }
  });
  pi.on("turn_end", (_e: any, ctx: any) => {
    consigner({ t: "turn_end", usage: ctx?.getContextUsage?.() ?? null });
    if (config.membres) consigner({ t: "membres", phase: "turn_end", ...etatCtx(ctx) });
  });
  if (config.cycle) pi.on("session_shutdown", (e: any) => consigner({ t: "session_shutdown", reason: e?.reason ?? null }));
  if (config.membres) {
    pi.on("session_start", (_e: any, ctx: any) => consigner({ t: "membres", phase: "session_start", ...etatCtx(ctx) }));
    pi.registerCommand("contrats-membres", {
      description: "Instrument (test-only) : consigne l'état de ctx dans une commande",
      handler: async (_args: unknown, ctx: any) => consigner({ t: "membres", phase: "commande", ...etatCtx(ctx) }),
    });
  }

  const avecTemoins = !!(config.attendreRapport || config.attendreCompaction || config.compacter || config.constat);
  if (!avecTemoins) return;

  canal.ecouteurs.add(suivreFournisseur);
  suivreFournisseur();

  pi.on("message_end", (e: any) => {
    const m = e?.message ?? {};
    const t = temoin("message_end", { role: m.role ?? null, customType: m.customType ?? null, stopReason: m.stopReason ?? null });
    consigner({ t: "message_end", temoin: t.seq, role: t.role, customType: t.customType, stopReason: t.stopReason });
  });
  pi.on("session_compact", (e: any) => {
    const c = e?.compactionEntry ?? {};
    const t = temoin("session_compact", { id: c.id ?? null, firstKeptEntryId: c.firstKeptEntryId ?? null, timestamp: c.timestamp ?? null, summary: typeof c.summary === "string" ? c.summary : null });
    consigner({ t: "session_compact", temoin: t.seq, id: t.id, firstKeptEntryId: t.firstKeptEntryId, timestamp: t.timestamp, summary: t.summary, fromExtension: e?.fromExtension ?? null, reason: e?.reason ?? null });
  });

  /** Premier appel ordinaire du fournisseur dont un message user satisfait `test`, avec le témoin daté de sa réception. */
  const recuParFournisseur = (test: (texte: string) => boolean) => {
    suivreFournisseur();
    const r = canal.recus.find((x) => x.forme === "ordinaire" && x.messages.some((m) => m.role === "user" && test(m.texte)));
    const v = r ? vus.get(r.appel) : undefined;
    return r && v && Number.isSafeInteger(v.recu) && v.recu > 0 ? { appel: r.appel, temoinRecu: v.recu } : null;
  };
  /** Réponse achevée : premier message_end assistant de pi postérieur à la fin du flux de cet appel. */
  const reponseAchevee = (appel: number) => {
    suivreFournisseur();
    const v = vus.get(appel);
    if (!v || !Number.isSafeInteger(v.recu) || v.recu <= 0 || v.fini === null || !Number.isSafeInteger(v.fini) || v.fini <= v.recu) return null;
    const finFournisseur = v.fini;
    return temoins.find((t) => t.seq > finFournisseur && t.quoi === "message_end" && t.role === "assistant") ?? null;
  };

  if (config.attendreRapport) {
    const { prefixe } = config.attendreRapport;
    pi.registerCommand("contrats-attendre-rapport", {
      description: "Instrument (test-only) : attend la réception du rapport par le fournisseur et la réponse achevée",
      handler: barriere("attendre-rapport", async ({ franchir, echeance }) => {
        const recu = await attendre(() => recuParFournisseur((t) => t.startsWith(prefixe)), echeance);
        franchir("rapport-recu", { appel: recu.appel, temoin: recu.temoinRecu });
        const fin = await attendre(() => reponseAchevee(recu.appel), echeance);
        franchir("reponse-achevee", { appel: recu.appel, temoin: fin.seq, stopReason: fin.stopReason });
      }),
    });
  }

  if (config.attendreCompaction) {
    const { customType, texteReprise } = config.attendreCompaction;
    pi.registerCommand("contrats-attendre-compaction", {
      description: "Instrument (test-only) : attend la compaction du garde, le message de reprise et sa réponse achevée",
      handler: barriere("attendre-compaction", async ({ franchir, echeance }) => {
        const compact = await attendre(() => temoins.find((t) => t.quoi === "session_compact") ?? null, echeance);
        franchir("session-compact", { temoin: compact.seq, id: compact.id });
        const custom = await attendre(() => temoins.find((t) => t.seq > compact.seq && t.quoi === "message_end" && t.role === "custom" && t.customType === customType) ?? null, echeance);
        franchir("message-custom", { temoin: custom.seq, customType });
        const recu = await attendre(() => recuParFournisseur((t) => t === texteReprise), echeance);
        franchir("reprise-recue", { appel: recu.appel, temoin: recu.temoinRecu });
        const fin = await attendre(() => reponseAchevee(recu.appel), echeance);
        franchir("reponse-achevee", { appel: recu.appel, temoin: fin.seq, stopReason: fin.stopReason });
      }),
    });
  }

  if (config.constat) {
    pi.registerCommand("contrats-constat", {
      description: "Instrument (test-only) : constate compactions et messages custom après inactivité, sans attendre de compaction",
      handler: async (_args: unknown, ctx: any) => {
        const echeance = Date.now() + DELAI_MS;
        consigner({ t: "barriere", nom: "constat", phase: "entree", ts: Date.now() });
        try {
          await borner(ctx.waitForIdle(), echeance);
        } catch (e) {
          consigner({ t: "barriere", nom: "constat", phase: e instanceof Expiration ? "expiration" : "erreur", ts: Date.now(), message: (e as Error).message });
          return;
        }
        consigner({
          t: "barriere",
          nom: "constat",
          phase: "constat",
          ts: Date.now(),
          compactions: temoins.filter((t) => t.quoi === "session_compact").length,
          customs: temoins.filter((t) => t.quoi === "message_end" && t.role === "custom").map((t) => t.customType),
        });
        consigner({ t: "barriere", nom: "constat", phase: "sortie", ts: Date.now() });
      },
    });
  }

  if (config.compacter) {
    pi.registerCommand("contrats-compacter", {
      description: "Instrument (test-only) : appelle ctx.compact une seule fois et attend onComplete",
      handler: async (_args: unknown, ctx: any) => {
        const echeance = Date.now() + DELAI_MS;
        consigner({ t: "barriere", nom: "compacter", phase: "entree", ts: Date.now() });
        let issue: { ok: true; r: any } | { ok: false; message: string } | null = null;
        const fait = new Promise<void>((ok) => {
          ctx.compact({
            onComplete: (r: any) => {
              issue = { ok: true, r };
              ok();
            },
            onError: (e: Error) => {
              issue = { ok: false, message: e?.message ?? String(e) };
              ok();
            },
          });
        });
        consigner({ t: "barriere", nom: "compacter", phase: "compact-appele", ts: Date.now() });
        try {
          await borner(fait, echeance);
        } catch (e) {
          consigner({ t: "barriere", nom: "compacter", phase: "expiration", ts: Date.now(), message: (e as Error).message });
          return;
        }
        const i = issue as { ok: true; r: any } | { ok: false; message: string } | null;
        if (i && i.ok) {
          consigner({ t: "barriere", nom: "compacter", phase: "onComplete", ts: Date.now(), summary: i.r?.summary ?? null, firstKeptEntryId: i.r?.firstKeptEntryId ?? null, tokensBefore: i.r?.tokensBefore ?? null });
          consigner({ t: "barriere", nom: "compacter", phase: "sortie", ts: Date.now() });
        } else {
          consigner({ t: "barriere", nom: "compacter", phase: "onError", ts: Date.now(), message: i ? (i as any).message : "aucune issue" });
        }
      },
    });
  }
}
