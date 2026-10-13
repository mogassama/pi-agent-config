/**
 * Extension de test : fournisseur scripté `scripte/m`.
 *
 * Il rejoue les tours du scénario (`PI_CONTRATS_SCENARIO`) et consigne, pour
 * chaque appel, ce qu'il reçoit (`PI_CONTRATS_FOURNISSEUR`) : prompt système,
 * outils déclarés, messages. Ce journal rend observables les effets des
 * extensions sur la requête. Aucun réseau, aucune authentification.
 *
 * Il qualifie les surfaces locales du SDK exercées ; il ne qualifie ni le
 * transport des fournisseurs réseau ni le rendu TUI.
 *
 * K9/I2 : le contexte normalisé ne porte pas de champ systemPrompt ; il
 * contient exactement un message system au contenu exact déclaré, sans
 * outils ni sections, puis un unique message user dont le texte commence par
 * « <conversation> » et un saut de ligne, contient les marqueurs déclarés et la
 * fermeture « </conversation> ». Les résumés ont leur propre compteur, distinct
 * de celui des réponses ordinaires. Dans un scénario strict, toute requête non
 * prévue est refusée (réponse en erreur), sans réponse de repli.
 *
 * Les barrières de la sonde lisent les appels reçus et leur achèvement par un
 * canal du processus (`globalThis[CANAL]`) ; le fournisseur n'y lit rien.
 *
 * Prompts ordinaires (C2.5, C4.3, C6.3, C6.4, adjudication du 08-10-2026) : la
 * requête réelle est consignée à l'entrée de streamSimple, avant toute réponse.
 * Le journal conserve, en plus des champs historiques, les messages system bruts
 * (`systemes` : content, sections, noms des outils ajoutés ou retirés, clés
 * présentes, dans l'ordre) et le contenu brut de chaque message (`contenus`),
 * ainsi que l'identifiant du modèle et la fabrique de flux (C1.9). Le niveau de
 * raisonnement reçu (`reasoning`) n'est consigné que si le scénario déclare
 * `raisonnement` ; le modèle scripté déclare alors reasoning:true (C5.3, C6.6).
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

type Appel = { id: string; name: string; arguments: Record<string, unknown> };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; reasoning?: number };
type Tour = { appels?: Appel[]; texte?: string; erreur?: string; usage?: Usage };
export type ResumeAttendu = {
  /** Texte exact du prompt système de résumé de pi 0.86.0 identifié. */
  systemPrompt: string;
  /** Marqueurs de l'historique qui doivent figurer dans la conversation à résumer. */
  marqueurs: string[];
  /** Nombre de réponses ordinaires précédant l'appel de résumé, fixé avant mesure. */
  apresOrdinaires: number;
  /** Nombre d'appels de résumé attendus. */
  nombre: number;
  /** Résumé distinctif rendu, sans outil. */
  texte: string;
  usage?: Usage;
};
export type ScenarioFournisseur = {
  nom: string;
  tours: Tour[];
  usage: Usage;
  contextWindow: number;
  /** Toute requête non prévue est refusée, sans « fin du scénario ». */
  strict?: boolean;
  resume?: ResumeAttendu;
  /** C5.3, C6.6 : le modèle scripté déclare reasoning:true ; défaut false. */
  raisonnement?: boolean;
};

/** Canal du processus vers les barrières de la sonde (test-only). */
export const CANAL = "__piContratsFournisseur";
type Recu = { appel: number; forme: string; messages: Array<{ role: string; texte: string }>; fini: boolean };
type Canal = { recus: Recu[]; ecouteurs: Set<() => void> };
const canal: Canal = ((globalThis as any)[CANAL] ??= { recus: [], ecouteurs: new Set() });
const signaler = () => {
  for (const f of [...canal.ecouteurs]) f();
};

const scenario: ScenarioFournisseur = JSON.parse(readFileSync(process.env.PI_CONTRATS_SCENARIO!, "utf8"));
const JOURNAL = process.env.PI_CONTRATS_FOURNISSEUR!;
const consigner = (o: unknown) => appendFileSync(JOURNAL, JSON.stringify(o) + "\n");

let appel = 0;
let ordinaire = 0;
let resumes = 0;

function texteDe(m: any): string {
  if (typeof m?.content === "string") return m.content;
  if (Array.isArray(m?.content)) return m.content.map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("");
  return "";
}

const present = (o: any, cle: string): boolean => o !== null && typeof o === "object" && cle in o;

/** Bloc de contenu brut, sans les données d'image (remplacées par leur longueur). */
function blocBrut(c: any): unknown {
  if (c === null || typeof c !== "object") return c;
  if (c.type === "image") return { type: "image", mimeType: c.mimeType ?? null, longueur: typeof c.data === "string" ? c.data.length : null };
  return c;
}
const contenuBrut = (content: any): unknown => (Array.isArray(content) ? content.map(blocBrut) : content === undefined ? "<absent>" : content);
const nomsOutils = (l: any): string[] | "<absent>" => (Array.isArray(l) ? l.map((t: any) => t?.name ?? null) : l === undefined ? "<absent>" : l);

/** Messages system bruts, dans l'ordre : champs content et sections, métadonnées présentes. */
function systemesBruts(bruts: any[]): unknown[] {
  return bruts
    .map((m, index) =>
      m?.role !== "system"
        ? null
        : {
            index,
            cles: Object.keys(m),
            content: contenuBrut(m.content),
            ...(present(m, "sections") ? { sections: m.sections === undefined ? "<undefined>" : m.sections } : {}),
            ...(present(m, "toolsAdded") ? { toolsAdded: nomsOutils(m.toolsAdded) } : {}),
            ...(present(m, "toolsRemoved") ? { toolsRemoved: nomsOutils(m.toolsRemoved) } : {}),
          },
    )
    .filter((x) => x !== null);
}

/** I2 : forme exacte du contexte normalisé reçu par le fournisseur. */
function ecartResume(context: any, r: ResumeAttendu): string | null {
  if (context === null || typeof context !== "object") return "contexte non objet";
  if (present(context, "systemPrompt")) return "champ context.systemPrompt présent";
  if (present(context, "tools") && (!Array.isArray(context.tools) || context.tools.length !== 0)) return "context.tools présent et non vide ou non tableau";
  const messages = context.messages;
  if (!Array.isArray(messages) || messages.length !== 2) return "contexte sans exactement deux messages";
  const system = messages[0], user = messages[1];
  if (system?.role !== "system" || typeof system.content !== "string" || system.content !== r.systemPrompt) return "message system initial sans le contenu exact de SUMMARIZATION_SYSTEM_PROMPT";
  const metadata = ["toolsAdded", "toolsRemoved", "sections"].filter((k) => present(system, k));
  if (metadata.length) return `métadonnée(s) du message system présente(s) : ${metadata.join(", ")}`;
  if (user?.role !== "user") return "second message non user";
  const c = user.content;
  const t = typeof c === "string" ? c : Array.isArray(c) && c.length === 1 && c[0]?.type === "text" && typeof c[0].text === "string" ? c[0].text : null;
  if (t === null) return "message user sans texte brut ou unique bloc text";
  if (!t.startsWith("<conversation>\n")) return "texte sans « <conversation> » initial suivi d'un saut de ligne";
  if (!t.includes("</conversation>")) return "texte sans « </conversation> »";
  const manquants = r.marqueurs.filter((m) => !t.includes(m));
  if (manquants.length) return `marqueur(s) absent(s) : ${manquants.join(", ")}`;
  return null;
}

function stream(model: any, context: any, _options?: any) {
  const s = createAssistantMessageEventStream();
  const n = appel++;
  const bruts: any[] = Array.isArray(context?.messages) ? context.messages : [];
  const messages = bruts.map((m: any) => ({ role: m?.role ?? null, toolCallId: m?.toolCallId ?? null, isError: m?.isError ?? null, texte: texteDe(m) }));
  const r = scenario.resume;
  let forme: "ordinaire" | "resume" | "resume-divergent" | "imprevu";
  let tour: Tour;
  let ecart: string | null = null;
  // La phase prévue exige le résumé ; une forme divergente ne consomme pas
  // une réponse ordinaire. Les indices de résumé hors de cette phase sont
  // aussi vérifiés puis refusés, sans reconnaissance par sous-chaîne générique.
  const viseResume = r && (
    (resumes < r.nombre && ordinaire >= r.apresOrdinaires) ||
    context?.systemPrompt === r.systemPrompt ||
    bruts.some((m) => m?.role === "system" && m.content === r.systemPrompt) ||
    bruts.some((m) => m?.role === "user" && texteDe(m).startsWith("<conversation>\n"))
  );
  if (r && viseResume) {
    ecart = ecartResume(context, r);
    if (ecart === null && ordinaire !== r.apresOrdinaires) ecart = `phase du résumé : ${ordinaire} réponse(s) ordinaire(s), ${r.apresOrdinaires} attendue(s)`;
    if (ecart === null && resumes < r.nombre) {
      forme = "resume";
      tour = { texte: r.texte, usage: r.usage };
      resumes++;
    } else {
      forme = "resume-divergent";
      ecart = ecart ?? `appel de résumé supplémentaire (${resumes + 1} > ${r.nombre})`;
      tour = { erreur: `requête de résumé non prévue : ${ecart}` };
    }
  } else if (ordinaire < scenario.tours.length) {
    forme = "ordinaire";
    tour = scenario.tours[ordinaire++];
  } else if (scenario.strict) {
    forme = "imprevu";
    tour = { erreur: "requête non prévue par le scénario" };
  } else {
    forme = "ordinaire";
    tour = { texte: "fin du scénario" };
    ordinaire++;
  }
  // Les champs consignés par l'étape 0 restent inchangés ; la forme et l'écart s'y ajoutent.
  consigner({
    appel: n,
    systemPrompt: context?.systemPrompt ?? null,
    outils: (Array.isArray(context?.tools) ? context.tools : []).map((t: any) => t?.name).sort(),
    messages,
    ...(r || scenario.strict ? { forme, ...(ecart ? { ecart } : {}) } : {}),
    // Observations supplémentaires (adjudication du 08-10-2026) ; les champs ci-dessus sont inchangés.
    systemes: systemesBruts(bruts),
    contenus: bruts.map((m: any) => ({ role: m?.role ?? null, content: contenuBrut(m?.content) })),
    modele: model?.id ?? null,
    fabrique: typeof createAssistantMessageEventStream,
    ...(scenario.raisonnement !== undefined ? { reasoningPresent: present(_options, "reasoning"), reasoning: _options?.reasoning ?? null } : {}),
    ...(forme === "resume" || forme === "resume-divergent" ? {
      contexteResume: {
        systemPromptPresent: present(context, "systemPrompt"),
        toolsPresent: present(context, "tools"),
        tools: context?.tools ?? null,
        messages: context?.messages ?? null,
        metadataSystemPresentes: ["toolsAdded", "toolsRemoved", "sections"].filter((k) => present(bruts[0], k)),
      },
    } : {}),
  });
  const recu: Recu = { appel: n, forme, messages: messages.map((m: any) => ({ role: m.role, texte: m.texte })), fini: false };
  canal.recus.push(recu);
  signaler();
  (async () => {
    const usage = tour.usage ?? scenario.usage;
    const out: any = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    s.push({ type: "start", partial: out });
    if (tour.erreur) {
      out.stopReason = "error";
      out.errorMessage = tour.erreur;
      s.push({ type: "error", reason: "error", error: out });
    } else if (tour.appels) {
      for (const a of tour.appels) {
        const i = out.content.length;
        out.content.push({ type: "toolCall", id: a.id, name: a.name, arguments: a.arguments });
        s.push({ type: "toolcall_start", contentIndex: i, partial: out });
        s.push({ type: "toolcall_end", contentIndex: i, toolCall: out.content[i], partial: out });
      }
      out.stopReason = "toolUse";
      s.push({ type: "done", reason: out.stopReason, message: out });
    } else {
      const t = tour.texte ?? "";
      out.content.push({ type: "text", text: t });
      s.push({ type: "text_start", contentIndex: 0, partial: out });
      s.push({ type: "text_end", contentIndex: 0, content: t, partial: out });
      out.stopReason = "stop";
      s.push({ type: "done", reason: out.stopReason, message: out });
    }
    s.end();
    recu.fini = true;
    signaler();
  })();
  return s;
}

export default function (pi: any) {
  pi.registerProvider("scripte", {
    baseUrl: "http://127.0.0.1:9",
    apiKey: "factice",
    api: "scripte-api",
    models: [
      {
        id: "m",
        name: "m",
        reasoning: scenario.raisonnement === true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: scenario.contextWindow,
        maxTokens: 1000,
      },
    ],
    streamSimple: stream,
  });
}
