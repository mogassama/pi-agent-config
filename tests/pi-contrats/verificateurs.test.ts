/**
 * Contre-épreuves des vérificateurs (MATRICES, convention (a)) et contrôles durables de l'item 1.
 *
 *   PI_CONTRATS_CAMPAGNE=<dossier nominal>[:<dossier des contre-épreuves réelles>] \
 *     node --test tests/pi-contrats/verificateurs.test.ts
 *
 * - (a) : chaque observation conservée, altérée précisément, donne l'état attendu ; l'observation
 *   nominale reste satisfaite. Les observations viennent des campagnes conservées, jamais d'un
 *   texte attendu seul.
 * - Rendu du prompt (adjudication du 08-10-2026) : formes content vide avec sections, ajout,
 *   remplacement et retrait de section, prompt forcé, blocs text ; comparé au transcript de
 *   pi-ai 0.86.0 identifié ; une forme non classable est refusée.
 * - D1 : la sonde réelle, chargée par le jiti identifié, expose des témoins définitifs à un écouteur
 *   réentrant inscrit après puis avant suivreFournisseur, sans doublon.
 * - I2 : le fournisseur réel reconnaît le seul contexte normalisé conforme après deux réponses
 *   ordinaires, refuse chaque forme divergente sans avancer le compteur ordinaire, refuse le
 *   résumé prématuré ou supplémentaire, et consigne les champs de contrôle.
 * Hors du balayage de `bin/test-guards`. Aucun pi n'est lancé ici.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRE_EPREUVES_A, C2_8, ECHANGES_K9, MESSAGE_REPRISE, SUMMARIZATION_SYSTEM_PROMPT, rendrePrompt } from "./scenarios.ts";
import { ICI_CONTRATS, lireIdentite, reevaluer } from "./harnais.ts";
import { resoudrePi } from "./identite.ts";

// ── (a) sur les observations conservées ──────────────────────────────────────

const campagne = process.env.PI_CONTRATS_CAMPAGNE;
test("les observations conservées de la campagne sont désignées", () => {
  assert.ok(campagne, "PI_CONTRATS_CAMPAGNE absent : les contre-épreuves (a) portent sur des observations conservées");
});
for (const a of CONTRE_EPREUVES_A) {
  test(`(a) ${a.id} — ${a.clause} : ${a.attendu}, garde ${a.cibles.join(", ")}`, () => {
    assert.ok(campagne, "PI_CONTRATS_CAMPAGNE absent");
    const r = reevaluer(campagne.split(":"), a.id);
    assert.equal(r.nominal, "satisfait", `observation nominale : ${r.nominal}`);
    assert.equal(r.etat, a.attendu, `observation altérée : ${r.etat} — ${r.motif}`);
  });
}

// ── Pi identifié : transcript de pi-ai et jiti ───────────────────────────────

function racinePi(): string {
  return resoudrePi(process.env.PATH ?? "", lireIdentite(join(ICI_CONTRATS, "identite-0.86.0.json"))).racine;
}

// ── Rendu du prompt ──────────────────────────────────────────────────────────

test("rendu du prompt : formes déclarées, identiques au transcript de pi-ai 0.86.0", async () => {
  const pi = racinePi();
  const t = await import(join(pi, "node_modules/@earendil-works/pi-ai/dist/utils/transcript.js"));
  const sys = (x: Record<string, unknown>) => ({ role: "system", timestamp: 0, ...x });
  const cas: Array<[string, any[], string]> = [
    ["content vide avec sections", [sys({ content: "", sections: { a: "A", b: "B" } })], "A\n\nB"],
    ["remplacement d'une section", [sys({ content: "", sections: { a: "A", b: "B" } }), sys({ content: "", sections: { a: "A2" } })], "A2\n\nB"],
    ["retrait d'une section (null)", [sys({ content: "", sections: { a: "A", b: "B" } }), sys({ content: "", sections: { a: null } })], "B"],
    ["retrait puis ajout : la section revient en fin", [sys({ content: "", sections: { a: "A", b: "B" } }), sys({ content: "", sections: { a: null } }), sys({ content: "", sections: { a: "A3" } })], "B\n\nA3"],
    ["prompt forcé (content seul)", [sys({ content: "PROMPT FORCÉ" })], "PROMPT FORCÉ"],
    ["contenu puis sections", [sys({ content: "C", sections: { a: "A" } })], "C\n\nA"],
    ["blocs text joints par un saut de ligne", [sys({ content: [{ type: "text", text: "x" }, { type: "text", text: "y" }] })], "x\ny"],
    ["contenus successifs, section vide ignorée", [sys({ content: "C1", sections: { v: "" } }), sys({ content: "C2" })], "C1\n\nC2"],
  ];
  for (const [nom, messages, attendu] of cas) {
    assert.equal(rendrePrompt(messages), attendu, nom);
    assert.equal(t.getCurrentSystemPrompt(messages), attendu, `${nom} (pi-ai)`);
  }
  assert.equal(rendrePrompt([sys({ content: 42 })]), null, "content non classable");
  assert.equal(rendrePrompt([sys({ content: "", sections: ["a"] })]), null, "sections non classables");
  assert.equal(rendrePrompt([sys({ content: "", sections: { a: 7 } })]), null, "valeur de section non classable");
});

// ── jiti identifié, avec les alias de pi ─────────────────────────────────────

function jitiIdentifie() {
  const pi = racinePi();
  const req = createRequire(join(pi, "package.json"));
  const { createJiti } = req("jiti");
  const N = join(pi, "node_modules/@earendil-works");
  return createJiti(import.meta.url, {
    moduleCache: false,
    alias: {
      "@earendil-works/pi-coding-agent": join(pi, "dist/index.js"),
      "@earendil-works/pi-tui": join(N, "pi-tui/dist/index.js"),
      "@earendil-works/pi-ai": join(N, "pi-ai/dist/compat.js"),
    },
  });
}

// ── D1 : sonde réelle, écouteur réentrant ────────────────────────────────────

for (const enTete of [false, true]) {
  test(`D1 : témoins définitifs vus par un écouteur réentrant inscrit ${enTete ? "avant" : "après"} suivreFournisseur`, async () => {
    const jiti = jitiIdentifie();
    delete (globalThis as any).__piContratsFournisseur;
    const tmp = mkdtempSync(join(tmpdir(), "d1-sonde-"));
    const journal = join(tmp, "sonde.jsonl");
    writeFileSync(journal, "");
    writeFileSync(join(tmp, "scenario.json"), JSON.stringify({ sonde: { attendreRapport: { prefixe: "check-config — " } } }));
    process.env.PI_CONTRATS_SONDE = journal;
    process.env.PI_CONTRATS_SCENARIO = join(tmp, "scenario.json");
    const sonde: any = await jiti.import(join(ICI_CONTRATS, "sonde.ts"), { default: true });
    const handlers: Record<string, any[]> = {}, commandes: Record<string, any> = {};
    sonde({ on: (n: string, f: any) => (handlers[n] ??= []).push(f), registerCommand: (n: string, d: any) => (commandes[n] = d), getAllTools: () => [], getActiveTools: () => [], getCommands: () => [] });
    const canal = (globalThis as any).__piContratsFournisseur;
    const lignes = () => readFileSync(journal, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const vus: string[][] = [];
    let profondeur = 0;
    const reentrant = () => {
      vus.push(lignes().filter((o) => o.t === "temoin-fournisseur").map((o) => `${o.evenement}:${o.appel}:${o.temoin}`));
      if (profondeur < 2) {
        profondeur++;
        for (const f of [...canal.ecouteurs]) f();
        profondeur--;
      }
    };
    if (enTete) {
      const autres = [...canal.ecouteurs];
      canal.ecouteurs.clear();
      canal.ecouteurs.add(reentrant);
      for (const f of autres) canal.ecouteurs.add(f);
    } else canal.ecouteurs.add(reentrant);
    const signaler = () => {
      for (const f of [...canal.ecouteurs]) f();
    };
    const fin = commandes["contrats-attendre-rapport"].handler(undefined, { waitForIdle: async () => {} });
    const me = (role: string, stopReason: string | null = null) => handlers.message_end.forEach((h) => h({ message: { role, stopReason } }));
    me("system");
    me("user");
    const recu = { appel: 0, forme: "ordinaire", messages: [{ role: "user", texte: "check-config — /x\nrapport" }], fini: false };
    canal.recus.push(recu);
    signaler();
    recu.fini = true;
    signaler();
    me("assistant", "stop");
    await fin;
    const L = lignes();
    const tf = L.filter((o) => o.t === "temoin-fournisseur");
    assert.deepEqual(tf.map((o) => [o.evenement, o.temoin]), [["recu", 3], ["fini", 4]]);
    const ph = Object.fromEntries(L.filter((o) => o.t === "barriere").map((o) => [o.phase, o]));
    assert.equal(ph["rapport-recu"].temoin, 3);
    assert.equal(ph["reponse-achevee"].temoin, 5);
    assert.ok(vus.length > 0);
    for (const v of vus) {
      assert.equal(new Set(v).size, v.length, "doublon vu par l'écouteur");
      for (const x of v) assert.ok(Number(x.split(":")[2]) > 0, `témoin non définitif : ${x}`);
    }
  });
}

// ── I2 : fournisseur réel, contextes synthétiques ────────────────────────────

async function fournisseur() {
  const jiti = jitiIdentifie();
  delete (globalThis as any).__piContratsFournisseur;
  const tmp = mkdtempSync(join(tmpdir(), "i2-fournisseur-"));
  writeFileSync(join(tmp, "scenario.json"), JSON.stringify(C2_8));
  writeFileSync(join(tmp, "fournisseur.jsonl"), "");
  process.env.PI_CONTRATS_SCENARIO = join(tmp, "scenario.json");
  process.env.PI_CONTRATS_FOURNISSEUR = join(tmp, "fournisseur.jsonl");
  const mod: any = await jiti.import(join(ICI_CONTRATS, "fournisseur-scripte.ts"), { default: true });
  let cfg: any = null;
  mod({ registerProvider: (_n: string, c: any) => (cfg = c) });
  const model = { ...cfg.models[0], api: cfg.api, provider: "scripte" };
  const appeler = async (context: any) => {
    const m = await cfg.streamSimple(model, context).result();
    return m.stopReason === "error" ? { erreur: m.errorMessage as string } : { texte: m.content.map((c: any) => c.text).join("") as string };
  };
  const lire = () => readFileSync(join(tmp, "fournisseur.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { appeler, lire };
}
async function normaliser() {
  return (await import(join(racinePi(), "node_modules/@earendil-works/pi-ai/dist/utils/transcript.js"))).normalizeContext;
}
const ordinaire = (norm: any, ...users: string[]) => norm({ systemPrompt: "PROMPT ORDINAIRE", messages: users.map((u) => ({ role: "user", content: [{ type: "text", text: u }], timestamp: 1 })), tools: [{ name: "read", description: "r", parameters: {} }] });
const conversation = `<conversation>\n[User]: ${ECHANGES_K9.u1}\n\n[Assistant]: ${ECHANGES_K9.a1}\n</conversation>\n\n`;
const conforme = (norm: any) => norm({ systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: conversation }], timestamp: 1 }] });

test("I2 : nominal, résumé unique, reprise sur son tour, supplémentaire refusé, journal de contrôle", async () => {
  const norm = await normaliser();
  const f = await fournisseur();
  const r = [await f.appeler(ordinaire(norm, ECHANGES_K9.u1)), await f.appeler(ordinaire(norm, ECHANGES_K9.u1, ECHANGES_K9.u2)), await f.appeler(conforme(norm)), await f.appeler(conforme(norm)), await f.appeler(ordinaire(norm, MESSAGE_REPRISE))];
  const j = f.lire();
  assert.deepEqual(j.map((x) => x.forme), ["ordinaire", "ordinaire", "resume", "resume-divergent", "ordinaire"]);
  assert.equal(r[2].texte, ECHANGES_K9.resume);
  assert.match(j[3].ecart, /supplémentaire \(2 > 1\)/);
  assert.equal(r[4].texte, ECHANGES_K9.reprise);
  const cr = j[2].contexteResume;
  assert.deepEqual([cr.systemPromptPresent, cr.toolsPresent, cr.metadataSystemPresentes, cr.messages.length], [false, false, [], 2]);
  assert.ok(j.filter((x) => x.forme === "ordinaire").every((x) => !("contexteResume" in x)));
});

const divergents: Array<[string, (c: any) => void, RegExp]> = [
  ["ancien champ systemPrompt", (c) => (c.systemPrompt = SUMMARIZATION_SYSTEM_PROMPT), /champ context\.systemPrompt présent/],
  ["ancien champ systemPrompt undefined", (c) => (c.systemPrompt = undefined), /champ context\.systemPrompt présent/],
  ["mauvais prompt", (c) => (c.messages[0].content += " "), /sans le contenu exact/],
  ["métadonnée sections null", (c) => (c.messages[0].sections = null), /métadonnée.*sections/],
  ["outil déclaré", (c) => (c.tools = [{ name: "read" }]), /context\.tools présent et non vide/],
  ["trois messages", (c) => c.messages.push({ role: "user", content: "x" }), /exactement deux messages/],
  ["second message assistant", (c) => (c.messages[1].role = "assistant"), /second message non user/],
  ["préfixe absent", (c) => (c.messages[1].content[0].text = c.messages[1].content[0].text.replace("<conversation>\n", "")), /saut de ligne/],
  ["marqueur absent", (c) => (c.messages[1].content[0].text = c.messages[1].content[0].text.replace("A1-BRAVO", "A1-XXXXX")), /A1-BRAVO/],
  ["fermeture absente", (c) => (c.messages[1].content[0].text = c.messages[1].content[0].text.replace("</conversation>", "")), /<\/conversation>/],
];
for (const [nom, muter, motif] of divergents) {
  test(`I2 : forme divergente refusée sans avancer le compteur ordinaire — ${nom}`, async () => {
    const norm = await normaliser();
    const f = await fournisseur();
    await f.appeler(ordinaire(norm, ECHANGES_K9.u1));
    await f.appeler(ordinaire(norm, ECHANGES_K9.u1, ECHANGES_K9.u2));
    const c = structuredClone(conforme(norm));
    muter(c);
    const rd = await f.appeler(c);
    const rr = await f.appeler(conforme(norm));
    const rp = await f.appeler(ordinaire(norm, MESSAGE_REPRISE));
    const j = f.lire();
    assert.ok(rd.erreur);
    assert.equal(j[2].forme, "resume-divergent");
    assert.match(j[2].ecart, motif);
    assert.ok(j[2].contexteResume);
    assert.equal(rr.texte, ECHANGES_K9.resume);
    assert.equal(rp.texte, ECHANGES_K9.reprise);
  });
}
test("I2 : résumé prématuré reconnaissable refusé, tours ordinaires conservés", async () => {
  const norm = await normaliser();
  const f = await fournisseur();
  await f.appeler(ordinaire(norm, ECHANGES_K9.u1));
  const rd = await f.appeler(conforme(norm));
  const r2 = await f.appeler(ordinaire(norm, ECHANGES_K9.u1, ECHANGES_K9.u2));
  const rr = await f.appeler(conforme(norm));
  const j = f.lire();
  assert.ok(rd.erreur);
  assert.match(j[1].ecart, /phase du résumé : 1 réponse\(s\) ordinaire\(s\), 2 attendue\(s\)/);
  assert.equal(r2.texte, ECHANGES_K9.a2);
  assert.equal(rr.texte, ECHANGES_K9.resume);
});
