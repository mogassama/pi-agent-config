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
 * - Phase 2 (plan § 12.7) : témoin d'argv et d'environnement des scénarios existants, et tests des
 *   vérificateurs de C2.9/montee et de C2.9/R01 à C2.9/R09 sur observations synthétiques, contre-épreuves
 *   comprises. Ni campagne ni pi : `node --test --test-name-pattern "phase 2" …`.
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
import { createHash } from "node:crypto";
import {
  BLOC_BRIEF_R08, CONTRE_EPREUVES_REELLES, EXECUTIONS_NOMINALES, EXECUTIONS_PHASE2, GUIDELINE_TASK, MANIFESTE_R07, OUTIL_INTROUVABLE,
  REFUS_PREFLIGHT_R05, RUN_ID_R08D, fixtureR08D, guidelinePlan, monteeC2_9, outilsDeclares, sectionDelegation,
  verifierR01, verifierR02, verifierR03, verifierR04, verifierR05, verifierR06, verifierR07, verifierR08A, verifierR08B, verifierR08C,
  verifierR08D, verifierR08DTemoin, verifierR09,
  type Etat, type ObservationsMesure, type OrdreR08, type Verdict,
} from "./scenarios.ts";

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

// ── Phase 2 : témoin d'argv et d'environnement (§ 12.7) ──────────────────────

/** La base de la phase 2, d'où les empreintes ci-dessous ont été relevées. */
const BASE_PHASE2 = "0237b74e949eb1a826d491751216f758324f715d";
/** SHA-256 de `tests/pi-contrats/harnais.ts` à la base. */
const HARNAIS_BASE_SHA256 = "5a014e851769616d8f3f7a53d7714cf8e7198d436d04eec91ec4296e4e577a54";
/** Base : id, SHA-256 du scénario, SHA-256 des attendus, pour chaque exécution existante, dans l'ordre. */
const EMPREINTES_BASE: Array<[string, string, string]> = [
  ["socle", "12efbb31cc41d0c3cb6ec7eed9dfbd725c9fba81bf05aefdc80a88e63273ab24", "b0fe4bd2891a11db9575a1df55adb60bb9071602ecb8accbd8ef6317cbadb819"],
  ["erreur-fournisseur", "3e00442e13b01862b29fdbddeaf3169ffdd521edc5ae7705dc2afda3f8479d06", "deec75ef37218e0555b4e35e75131eab59595eaa44a1bfbd962496c41e09d7ab"],
  ["C3.2", "736252bf1ad42a363a260220c08d28cd471436eb119fc8c90bafe7c14ecb88f2", "9ef6c1ab1c9676086e968b05920427e8d7d494a1f7f9b2b5e2c4a18c8c9636b4"],
  ["C4.1", "830c8356d11d579004028c09ffbfc56b83e18b993240c1e7885c89f9b18a5f89", "0f72150c96dff55494f9ff1a4c7ef0456d5c12e2bf440f97dad9324d795a7930"],
  ["C4.2", "5f7e0174c27f6bd96e3bb888be13e728ee0678c1bbcbde50fc42cd5d6a509068", "7174392936faea5cf1e3e2406e1a3f1e6f8416f792d93972547189aaf9374023"],
  ["C4.3", "9dcebc6e057814061665ba6dfc7a542191b12fce0d3a37f197195ea8973e1184", "559ec1af954261109e311f71a94fefac2a566f6d566e2d7853fcc3f2bb051f57"],
  ["C6.1", "e7e53d6ea381c10f7c4cbb897717c6dff7db7e83f28c67237fe5842a1984f6fc", "40410e7b4fdb93df87450dfc56886036dfac60cf6bca5ddcb20100cd467e0b90"],
  ["C6.2", "ff278307293598005c587aab10b0bea1207cb2cc45d2459d29e7cfc089c86365", "34bd1b0df2ea18e0d2329d30fc526c496e6516f34a983800a909de5cd5f21a9d"],
  ["C6.3", "9fb874ff8f8bb23f8b68393b3bc4c8cdb088f2d64a92536506433e442745d376", "ae24039eaf72c9151ad6bbc4ca6f71b1fb5a385e4aff688d9627a567f0da10d2"],
  ["C6.4", "5eba273aa0eb1f37089bc19fa82cecd00e839f82c736b4c41e0f824cf0af436c", "898261633bc1ce81ce8f0abd2d8c9d004af459c8c5f16afcde77c6da0b1c4283"],
  ["C6.5", "ca4295a62ed105cde44042fe2304c5e76a87f10862887a41737214c8f7d70f62", "7ddfa2cb51376fb2f8d864a405f4b227909930c80b5ac6db2a0071d02b6e7173"],
  ["C6.8", "3ce5f325f4f137fd0dd4e0ba09a60a8fc165a92e8865a2393a6f51a903cd1a6a", "cda0664a4d956af0f40fc605f8cbfdc1f85d9f5a9a92336bbff6a9ec0cf4ff1c"],
  ["C2.1", "2e5d829007e9b88944e024888f5a8b1f46db5dca818c454c394bf7dd539e5ba1", "eb78c8b31445599974b1d0f11aacc3a2b32d6b8a116868c9e1e86ef8dcb29fad"],
  ["C2.2", "01556f4dd63ac909123016776be230e39252da0e7045a05bd9e990a010e6e623", "58f19db6e63d8b07d64fa8c9001b7c2307e9b1d5cee35f77502d35d9d6f2566b"],
  ["C2.3", "7467e9cf9f7b1d6e5e3d407c1a75df0d1e399eb3bb953d66d413b7f69cd08e3d", "73e1535e0db9a6d183bdc092680ba90fa2d9e41c6fdcedf2265bfdd23db89375"],
  ["C2.4", "c0e66b695074f10da186bd5806dc8ceb5cca4dc8e53dc5da5267f1cbd48102b2", "019b67bd6c58398a3c15f6f571bb1b7f9f2f85a4d79e9fa631d29682f6468399"],
  ["C2.5", "046f03751f567f5c816e30020273abc1fc2d9ce0e5f11213ff35bb094a7abed1", "f7bcaa7a7bcff6eadd6634010ef8187164378e752fb8ee810bc1a2101eac9b3b"],
  ["C2.5-tool_result", "e11a8e6f5460c7d610e7666230d2d2b0673114f00b3efd3bcb394f9c2cd0c08e", "3c0373a72b02125dc33bfa029727c14a4cbc16a645bccd49bffbe0d478a664f2"],
  ["C2.6", "12fa1f8ef8904426ec93dbf5515927ad490742333d74cdcff08c47d48ffc0839", "d8deee993df4f523478211ee79eca6cb55a55a1f3e01bc8f951ce0dc62f9f8e6"],
  ["C2.7", "56b8f2ff7a85ca08139cfbfbb96d730e0050785235248b300af71b28ee2a39d2", "50d42c25ff29b7c2745d84a722e3d5da97b8e8dbb90512b1f66465097c60728e"],
  ["C2.8", "264e4b86a39aa18eab8f78033899235c97a4d81b5306a3aac9335a79825fb1cb", "71c316e0b8acd6d82e5a2beaa499126e9604a2ee90a8d43dbd1fa780b87aa718"],
  ["C2.9", "b822676a963557249b39054bd55ece2ba89fa2144e4f32f482352b912f61e00b", "cbd401fd6b854c704055d3b93d6364de8e9f21d6c758a1ed4501d3065cd663d2"],
  ["C2.10", "b8f2145da1c1442d351db83e82739e2dcf8f4cf2557d7239fe64fec164c7168d", "a27b2983763036541fb93cba05bd8d1ba8a177156cf43b01c0edc535e0b722a8"],
  ["C2.11", "cbdcd8a422be9c009c30709aca42d8f9ec8abda9954425743db6ac1684910157", "af1e4f83b8ec04da5f8650ed362b280d7f66a7561c9362685e7fdc1135c3491b"],
  ["C2.11-K5", "bb48a42593017bb5ae9081b54619bc22efe0198502a320da47d026c6b298bc81", "f7ada0c99dd2c35b213fa5f8b6d7f302235ba41082e8506f840fef6f08d0793d"],
  ["C2.12", "0467b0959b9dcf00be5f6243ca475c75b3389614bd990a02e7683f79bd2a6958", "a33c250e1a8ea5c7a80d5bcdca2e65deb506d399fdb6c314b9f97691270ca1b2"],
  ["C8.2", "9290788ae4de85d40619bc92f07a4ed5c31a29830c27d784b25e451df871bebe", "a9305355e812fd106c874b07c2bc5a37f41977b429011689c620050f6314b086"],
  ["C2.1/b", "9eba26a2d309eb72ad9fc2df1004c70a4127233a04b8f6e06f281beb1936805a", "2a572a420ce1096385ddaa932afe0ea46a5bf75152683618474d19d8f91ab980"],
  ["C2.2/b", "7291b062ed29e0c7709257403d551b73c639c072bece4303764a3fb6fae16bac", "bb6b0e092e0b085b5ec2b523e1d935a92c3a0663eafd2210beb528eb9c13351f"],
  ["C2.3/b", "ea633f72cb7da974a4355ab0c3f233d794e181b6f5e237be9809de289bff6759", "b662ef8774da7fe931a12247ba40cf8c92af5e14e784d82fde826ce30ff4ccac"],
  ["C2.4/b-ruff", "92a4b92de5d12e1c7b51e91915b35c88a6fef07da14a36a8bbd97fadddae90e5", "8b8042c743a140188d23694e0264ea06fcba0636b0aa6e3428129450615ae8b9"],
  ["C2.4/b-mypy", "624ed274fd5d1bcbdea701f801760d6c516adb9eff01edfc08a0d6fc399a963e", "241427e737e8e5b1a8ef884283703a2608ef53b8ccc6da41fbb9fa507b04d8d4"],
  ["C2.5/b", "a3670529f9bd634d3f1c1366d78730845ec5ba3e8ffd45eeeb435395fb81120e", "f3f72e0eb4a424c7f7847b6800935de3838911b31d90c1e33f9d4819ab429d55"],
  ["C2.5-tool_result/b", "d6a0921a41e2e467ae6222374d2a8be7a5194896899e4b534b442e23d58ee569", "078e2df754d3813e860a104575d17cebeccf40df79b89ae4b3c07cce64190168"],
  ["C2.6/b", "cd5d560f7ca7b5efec6fd35139efee86580647e83ffb0587f390c13e8d449880", "62f6401d429ee61476666524bfa709b1ac047b6526ed54a3a839e679c3fdf593"],
  ["C2.7/b", "3875039e07f5e24e82c36b92ecca59b9502ee89156d03ec8a62f1ae231232f13", "72c8e9988bcfeba8f1130ae8c630ccfa75fe662e2f64d187bf2e667426c21971"],
  ["C2.8/b", "a6cdb28fbe2bebfff19a3529e0d20f6388d2b92e7bd57bd4450075ce5c19689c", "e005026deb065cb727760557281e266b56f10d26a4d9f75b520e5d77d2fb7b63"],
  ["C2.9/b", "fd3854b829198cc6f2af9e5805d6758feb51bfaceec9ca18fdeb3eea253de2fa", "09e6cc93d878053aff81bda27ffdf7380a7c028034bd9128287bb36001f39025"],
  ["C2.11/b-perimetre", "a4d3c18d3f00f33177f46d5f422ff52b9bfdf8ddb87ef55b3643951264dabfa9", "3ff17d79692ed7f34021f0994d62434f75532c758e3b37eb65d1fdd3bc3a58bc"],
  ["C2.11/b-distincts", "e2a4c7e53fafc3856af9f512f93e6b44759628080ed461bf3fbccc339348aa5b", "10266b8b3126222c5b67a4737078191c3c96c425331e8b88c63285a6142ae2d9"],
  ["C2.12/b", "6e12977981df4c0d7ee3a67b673d2e1f85d62951068533be93d38d5062384fb2", "62bed8898b68c98265559f5b9b146f06a041e0509d841da3c316d5b3b7821d48"],
  ["C2.1/b-syntaxe", "2b0588385790fa667458751b92b78f91281b6e9da7691c03b95d07fc77bc44fe", "50d0acf80a9041e38d041ac51488937c2e5db312c8dde9d6d71de38353c0010f"],
  ["C2.2/b-syntaxe", "3e00fc5bbe7c59d790a9892918ce3715c0991389de4e9d232350933bc3c77257", "e5a5e1cf3401dc71bcee5681e397d53a5546d9bc60d1fbc92eb362254e36c65c"],
  ["C2.3/b-syntaxe", "1af8d386242e55bdebae69ca2ee88d0c6bfe94fe0de8a398c7b0ee4d50974cba", "f501ca33cd51919afee03e92cf64c15316a442677c435d36b4d98c1b55c4728e"],
  ["C2.4/b-syntaxe", "338e536acfb219002f3261b878e6c9c6d55217b1f90e95a47cdccc968400455c", "0ff75c6a011c0566d564396bf0e51d85f69fba6500e39c12531e79e2a34f2f6d"],
  ["C2.5/b-syntaxe", "411be4dfd6ae9a3dbca478ec4253cf9ba94e42d39bee4d113329b84febd99771", "3345952cc757b5b3f1a433f3d6b1ba242ab8f3ea249ae6f3cc00d279f4020fa0"],
  ["C2.6/b-syntaxe", "7957abd613da054f61ce108b26049ab0e8e6a33101b464ff7df53506a184c0a2", "9a82df2e2e2b144f22874488d730d1496cc874613a4a0589af9bbde35e140b38"],
  ["C2.7/b-syntaxe", "c1da961d7cfb47d02a61a561882950441b44f202aa92789b2370dc1bb7e56515", "30b544b10954f5f0c4bbca54995706d8ee666611495986902f7ca26072618e36"],
  ["C2.8/b-syntaxe", "9a1f751704bf4b05cf2f6a6677499d5565df71fb8240326466723177756d2abe", "6d1c0bc4d6474f7a1fb916ac1ba8b43593e8dcc5f48ba3fd8252a3c4ef19b277"],
  ["C2.9/b-syntaxe", "29d96669fd38c6fa9a397a18041056d44e34bbc70814d8460388f63775295183", "95da4961b1ece792229af9b0f17543b90c4d16a07b91e3844ec19ac6e5b47616"],
  ["C2.10/b-syntaxe", "3aad41ef2992dfc08419b01c9987e1b000b955778a1b13df948482451324b3e3", "457ee34c783f51ef324225fcded43cf93c6cb40a5c8bb8352e9d15e00681bc14"],
  ["C2.11/b-syntaxe", "8d11b783d0bf5a3de8dff8bbfca8149e2117d5c45bf7989fa3ae12e0745ebbac", "acce019addd1e8a64e174e2c08a31e189cf1bb95bda5d06d65722dc39aaaf3e7"],
  ["C2.12/b-syntaxe", "451f4b1eb5cf98844bcc9e5b88b516e1ade0fb5e6f77943832a40058476438fc", "174293fae1b65eff778f367528303ffe4c4c87a641cb30e66ca7c5fd28d3517e"],
  ["C3.1/b-0.99.0", "12efbb31cc41d0c3cb6ec7eed9dfbd725c9fba81bf05aefdc80a88e63273ab24", "015c1bf5b9a07fdce8e807a423420d362e49374b049e33d7f2700acef719f4d7"],
  ["C4.1/b", "cf803cfcfe3665432a8a726b03c1d2a25d76c64546615183dadd81ff5dfe0a36", "34cb39968d076f7cdf6a15c23500cbeb3a62fe0626b9144bb8867c57d91de00a"],
  ["C4.2/b", "a7cd5361d73f1ac54d321e04de7e56cce977191960b1372908be86926fdcdc02", "af94aaa8681400367e798c538457c88bbaca4f38080a57b8eae83a42d9236a37"],
  ["C4.3/b", "29e0c5a4102d722d559fa5414326c1d55ffdded9a3989c575645714cf53eb7b0", "7ea24ca7314e29a67c178b5408cdbad480d96fee5b775c899f9ff8c2346f031c"],
  ["C6.1/b", "c25a71fb61af1daa140c2ca414a54ca2660be221cd65cd1d1e144bd283d7e8b3", "dc430fcc7b4111e3860691054ceadad22cec3d0e621883549cf75f396136c353"],
  ["C6.2/b", "ee48b0fa6561635863126a79f25d48358f75977abcf17246707c3c395c952d77", "48f188e2e65d4b0fe0456bac4b8271210ce12c3677d4ff2cfe66437638f63ec2"],
  ["C6.3/b", "d08202422ac27a277790d6a80426e9deff4fbf329c97c7a4cc3aa76333ba3927", "b9abc4f884b3996b2f3857ca8ee7856045d158db3740b6bd19ba8a7992aaab46"],
  ["C6.5/b", "6ea0416f268c42775c68bcd42fc6688836c2ea46941b6c6c6b6ca6d11b50bfa5", "ebd37d034277891ad6294a07655b2fb6083d31023a410c61d0cffa22aeae9e6c"],
  ["C6.8/b", "3a694507bf82968a36e4dc8eedb5e4cefd80dc8d82874b99968b2aaa8131f3e4", "aa91274db1b8bac66537a0ec065dfb4643d2d1199b18e5af1ca87d606ba9c8f6"],
  ["C8.1/b", "acc9ffcf3d99233e401e7ca4f28e4ef6dd5fa9017553427dad3074eb67fcb78f", "857e4fb0edb18256e004a937c73aa5f991139f3131387fd2f05b635adf27076f"],
  ["C8.2/b", "98a56ce80068a87dca3f5b236d331cb4bb70c0b91af3201779bb8dc9565a6a0a", "f91415c56480a00a78f55cefcf1856cdc6567138b93c05ed4a3a8abc557245ef"],
];
/** Base : SHA-256 de C2.9 sans ses invites (`prompt`, `prompts`). */
const C2_9_SANS_INVITES_BASE = "0695721cf1e66e6322563d6fc0acfc179a230f9aa4f255357398a91f9317b7e6";
const empreinte = (x: unknown) => createHash("sha256").update(JSON.stringify(x, (_k, v) => (typeof v === "function" ? `fonction:${String(v)}` : v))).digest("hex");
const sans = (o: Record<string, unknown>, ...cles: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !cles.includes(k)));
const invites = (s: { prompt: string; prompts?: string[] }) => [s.prompt, ...(s.prompts ?? [])];

test(`phase 2 — témoin : exécutions existantes inchangées en entrées, argv de la base hors C2.9 (base ${BASE_PHASE2.slice(0, 8)})`, () => {
  const l = [...EXECUTIONS_NOMINALES, ...CONTRE_EPREUVES_REELLES];
  assert.deepEqual(l.map((x) => x.id), EMPREINTES_BASE.map((x) => x[0]), "liste et ordre des exécutions existantes");
  l.forEach((x, i) => {
    const [id, scenario, attendus] = EMPREINTES_BASE[i];
    assert.equal((x.scenario as { reprise?: unknown }).reprise, undefined, `${id} : aucune reprise`);
    if (id === "C2.9") {
      assert.equal(empreinte(sans(x.scenario, "prompt", "prompts")), C2_9_SANS_INVITES_BASE, "C2.9 : seules les invites changent");
      assert.deepEqual(invites(x.scenario), ["/subagents on", "délègue"], "C2.9 : le seul préambule de montée");
      assert.equal(empreinte(sans(x.attendus, "C2.9/montee")), attendus, "C2.9 : attendus de la base, plus C2.9/montee");
      assert.equal(x.attendus["C2.9/montee"], "satisfait");
    } else if (id === "C2.9/b") {
      assert.equal(empreinte(sans(x.scenario, "prompts")), scenario, "C2.9/b : scénario de la base, prompts explicite");
      assert.deepEqual(x.scenario.prompts, []);
      assert.deepEqual(invites(x.scenario), ["délègue"], "C2.9/b : argv de la base");
      assert.equal(empreinte(x.attendus), attendus, "C2.9/b : attendus inchangés");
    } else {
      assert.equal(empreinte(x.scenario), scenario, `${id} : scénario de la base`);
      assert.equal(empreinte(x.attendus), attendus, `${id} : attendus de la base`);
    }
  });
  assert.ok(EXECUTIONS_PHASE2.every((x) => !l.includes(x)), "EXECUTIONS_PHASE2 distincte des listes existantes");
});

test("phase 2 — témoin : harnais.ts = base + les seuls ajouts déclarés, reprise gardée par s.reprise", () => {
  let t = readFileSync(join(ICI_CONTRATS, "harnais.ts"), "utf8");
  const unique = (motif: string) => {
    const i = t.indexOf(motif);
    assert.ok(i >= 0 && t.indexOf(motif, i + 1) < 0, `motif unique : ${JSON.stringify(motif.slice(0, 60))}`);
    return i;
  };
  const remplacer = (avant: string, apres: string) => { const i = unique(avant); t = t.slice(0, i) + apres + t.slice(i + avant.length); };
  const retirerBloc = (debut: string, fin: string) => { const i = unique(debut); const j = t.indexOf(fin, i); assert.ok(j > i, `fin du bloc ${JSON.stringify(debut.slice(0, 40))}`); t = t.slice(0, i) + t.slice(j + fin.length); };
  assert.equal(t.split("reprendre(").length - 1, 2, "reprendre : une définition, un appel");
  remplacer("realpathSync, renameSync, rmSync", "realpathSync, rmSync");
  retirerBloc("  /** Phase 2 : la seconde invocation (`-c`) d'un scénario qui déclare `reprise`. */\n", "    fichiers: Record<string, string | null>;\n  };\n");
  remplacer("    if (s.reprise) reprendre(t, s, iso, argv, env, cwd, o.delaiMs);\n", "");
  retirerBloc("/**\n * Phase 2 : seconde invocation, avec `-c`", "\n}\n\n");
  remplacer("    ...(t.reprise ? { reprise: observerReprise(t) } : {}),\n", "");
  retirerBloc("/** Phase 2 : observations de la seconde invocation", "\n}\n\n");
  assert.equal(createHash("sha256").update(t).digest("hex"), HARNAIS_BASE_SHA256, "le reste de harnais.ts est celui de la base, à l'octet");
});

// ── Phase 2 : vérificateurs de C2.9/montee et de C2.9/R01 à R09, observations synthétiques ──

const D = sectionDelegation();
const RUN = "0123456789abcdef";
const AUTRE_RUN = "fedcba9876543210";
const MANIFESTE = ".pi-subagent-runs/active-run.json";
const LECTURE = ["read", "ls", "grep", "find"];
const regles = (runId: string) => `<rules>\n- ${GUIDELINE_TASK}\n- Before the first delegation, ${guidelinePlan(runId)} {"version":1}\n</rules>`;
const systeme = (x: Record<string, unknown>) => ({ role: "system", content: "", ...x });
const simple = () => systeme({ sections: { preamble: "P", tools: "<tools>\n- read\n</tools>", rules: "<rules>\n- lire\n</rules>" }, toolsAdded: [...LECTURE] });
const sousAgents = (runId = RUN) => systeme({ sections: { preamble: "P", tools: "<tools>\n- read\n- task\n</tools>", rules: regles(runId), delegation: D }, toolsAdded: [...LECTURE, "task"] });
const force = (texte: string, outils: string[]) => systeme({ content: texte, toolsAdded: [...outils] });
const requete = (appel: number, systemes: any[], messages: any[] = []) => ({ appel, systemes, outils: [], systemPrompt: null, messages });
const manifeste = (runId = RUN) => `${JSON.stringify({ version: 2, runId, status: "planning", nextSeq: 1 }, null, 2)}\n`;
const resultat = (id: string, texte: string) => ({ type: "tool_execution_end", toolCallId: id, result: { content: [{ type: "text", text: texte }] } });
const obs = (p: Partial<ObservationsMesure>): ObservationsMesure => ({
  rc: 0, stderr: "", flux: [], sonde: [], fournisseur: [], simulateurs: {}, fils: [], sessions: [], agentDir: "", extension: null,
  extensions: [], inventaireCwd: { avant: [], apres: [] }, fichiers: {}, ...p,
});
const etatDe = (vs: Verdict[], clause: string): Etat => {
  const v = vs.filter((x) => x.clause === clause);
  assert.equal(v.length, 1, `un verdict ${clause}`);
  return v[0].etat;
};
const q = (o: ObservationsMesure, appel: number) => o.fournisseur.find((x) => x.appel === appel);
const dernierSys = (o: ObservationsMesure, appel: number) => q(o, appel).systemes[q(o, appel).systemes.length - 1];

/** Un vérificateur : l'observation nominale satisfait, chaque altération donne l'état attendu. */
function eprouver(nom: string, clause: string, verifier: (o: ObservationsMesure) => Verdict[], nominale: () => ObservationsMesure, contre: Array<[string, (o: ObservationsMesure) => void, Etat]>): void {
  test(`phase 2 — ${nom} : nominal satisfait, ${contre.length} contre-épreuve(s)`, () => {
    const n = verifier(nominale());
    assert.equal(etatDe(n, clause), "satisfait", n.map((v) => v.detail).join(" | "));
    for (const [cas, alterer, attendu] of contre) {
      const o = nominale();
      alterer(o);
      const v = verifier(o);
      assert.equal(etatDe(v, clause), attendu, `${cas} : ${v.map((x) => x.detail).join(" | ")}`);
    }
  });
}

test("phase 2 — outilsDeclares : union des outils et des toolsAdded, moins les toolsRemoved ; forme non classable refusée", () => {
  assert.deepEqual(outilsDeclares({ outils: [], systemes: [systeme({ toolsAdded: ["read", "task"] }), systeme({ toolsRemoved: ["task"] })] }), ["read"]);
  assert.deepEqual(outilsDeclares({ outils: ["ls"], systemes: [systeme({ toolsAdded: ["task"] })] }), ["ls", "task"]);
  assert.equal(outilsDeclares({ outils: [], systemes: [systeme({ toolsAdded: "task" })] }), null);
  assert.equal(outilsDeclares({ outils: [], systemes: [systeme({ toolsRemoved: [1] })] }), null);
  assert.equal(outilsDeclares({ systemes: [] }), null);
});

eprouver("C2.9/montee", "C2.9/montee", (o) => [monteeC2_9(o)],
  () => obs({ fournisseur: [requete(0, [systeme({ toolsAdded: [...LECTURE, "task"] })])] }), [
    ["task non déclaré", (o) => { q(o, 0).systemes[0].toolsAdded = [...LECTURE]; }, "violé"],
    ["task retiré ensuite", (o) => { q(o, 0).systemes.push(systeme({ toolsRemoved: ["task"] })); }, "violé"],
    ["déclaration non classable", (o) => { q(o, 0).systemes[0].toolsAdded = "task"; }, "indéterminé"],
    ["appel 0 absent", (o) => { o.fournisseur = []; }, "indéterminé"],
  ]);

eprouver("C2.9/R01", "C2.9/R01", verifierR01, () => obs({ fournisseur: [requete(0, [simple()])] }), [
  ["task déclaré", (o) => { q(o, 0).systemes[0].toolsAdded.push("task"); }, "violé"],
  ["section delegation posée", (o) => { q(o, 0).systemes[0].sections.delegation = ""; }, "violé"],
  ["délégation dans le prompt", (o) => { q(o, 0).systemes[0].sections.extra = D; }, "violé"],
  ["guideline de task", (o) => { q(o, 0).systemes[0].sections.rules = regles(RUN); }, "violé"],
  ["espace des runs créé", (o) => { o.inventaireCwd!.apres.push({ chemin: ".pi-subagent-runs", type: "dossier" }); }, "violé"],
  ["deux requêtes", (o) => { o.fournisseur.push(requete(1, [simple()])); }, "indéterminé"],
  ["messages system absents", (o) => { q(o, 0).systemes = []; }, "indéterminé"],
]);

const montee2 = () => obs({ fournisseur: [requete(0, [sousAgents()]), requete(1, [sousAgents()])], fichiers: { [MANIFESTE]: manifeste() } });
eprouver("C2.9/R02", "C2.9/R02", verifierR02, montee2, [
  ["guideline d'un autre run", (o) => { q(o, 1).systemes[0].sections.rules = regles(AUTRE_RUN); }, "violé"],
  ["guideline générique", (o) => { q(o, 0).systemes[0].sections.rules = regles("<runId>"); }, "violé"],
  ["guidelines absentes", (o) => { delete q(o, 1).systemes[0].sections.rules; }, "violé"],
  ["délégation dupliquée", (o) => { q(o, 0).systemes[0].sections.extra = D; }, "violé"],
  ["délégation tronquée", (o) => { q(o, 1).systemes[0].sections.delegation = D.slice(0, -20); }, "violé"],
  ["task non déclaré", (o) => { q(o, 1).systemes[0].toolsAdded = [...LECTURE]; }, "violé"],
  ["prompt forcé", (o) => { q(o, 0).systemPrompt = "forcé"; }, "violé"],
  ["contenu system forcé", (o) => { q(o, 1).systemes[0].content = "forcé"; }, "violé"],
  ["manifeste non relevé", (o) => { o.fichiers = {}; }, "indéterminé"],
  ["une seule requête", (o) => { o.fournisseur.pop(); }, "indéterminé"],
]);

const patchMontee = () => systeme({ sections: { rules: regles(RUN), delegation: D }, toolsAdded: ["task"] });
const patchDescente = () => systeme({ sections: { rules: "<rules>\n- lire\n</rules>", delegation: null }, toolsRemoved: ["task"] });
eprouver("C2.9/R03", "C2.9/R03", verifierR03, () => obs({
  fournisseur: [requete(0, [simple()]), requete(1, [simple(), patchMontee()]), requete(2, [simple(), patchMontee(), patchDescente()])],
  fichiers: { [MANIFESTE]: manifeste() },
}), [
  ["montée sans toolsAdded", (o) => { delete dernierSys(o, 1).toolsAdded; }, "violé"],
  ["montée sans section", (o) => { delete dernierSys(o, 1).sections.delegation; }, "violé"],
  ["descente sans toolsRemoved", (o) => { delete dernierSys(o, 2).toolsRemoved; }, "violé"],
  ["descente sans section null", (o) => { delete dernierSys(o, 2).sections.delegation; }, "violé"],
  ["première requête montée", (o) => { q(o, 0).systemes.push(patchMontee()); }, "violé"],
]);

const reprise4 = () => obs({
  fournisseur: [requete(0, [sousAgents()])],
  fichiers: { [MANIFESTE]: manifeste() },
  reprise: obs({ fournisseur: [requete(0, [simple()], [{ role: "user", texte: "un" }, { role: "assistant", texte: "r1" }, { role: "user", texte: "deux" }])] }),
} as Partial<ObservationsMesure>);
const repriseDe = (o: ObservationsMesure) => (o as unknown as { reprise: ObservationsMesure }).reprise;
eprouver("C2.9/R04", "C2.9/R04", verifierR04, reprise4, [
  ["histoire effacée", (o) => { q(repriseDe(o), 0).messages = [{ role: "user", texte: "deux" }]; }, "violé"],
  ["task déclaré à la reprise", (o) => { q(repriseDe(o), 0).systemes[0].toolsAdded.push("task"); }, "violé"],
  ["délégation à la reprise", (o) => { q(repriseDe(o), 0).systemes[0].sections.delegation = D; }, "violé"],
  ["première session simple", (o) => { q(o, 0).systemes = [simple()]; }, "violé"],
  ["reprise non observée", (o) => { delete (o as unknown as { reprise?: unknown }).reprise; }, "indéterminé"],
]);

const inventaire = () => ({ avant: [{ chemin: ".gitignore", type: "fichier" as const, sha256: "a" }], apres: [{ chemin: ".gitignore", type: "fichier" as const, sha256: "a" }] });
eprouver("C2.9/R05", "C2.9/R05", verifierR05, () => obs({ flux: [resultat("t1", REFUS_PREFLIGHT_R05)], inventaireCwd: inventaire(), fils: [{ commande: "/usr/bin/git" }] }), [
  ["refus différent", (o) => { o.flux[0].result.content[0].text = REFUS_PREFLIGHT_R05.replace("rien n'a été écrit", "rien n'a été lu"); }, "violé"],
  ["refus préfixé", (o) => { o.flux[0].result.content[0].text = `x${REFUS_PREFLIGHT_R05}`; }, "violé"],
  ["enfant lancé", (o) => { o.fils.push({ commande: "/opt/node/bin/node" }); }, "violé"],
  ["artefact", (o) => { o.inventaireCwd!.apres.push({ chemin: ".pi-subagent-runs", type: "dossier" }); }, "violé"],
  ["fichier modifié", (o) => { o.inventaireCwd!.apres[0] = { chemin: ".gitignore", type: "fichier", sha256: "b" }; }, "violé"],
  ["résultat absent", (o) => { o.flux = []; }, "indéterminé"],
  ["résultat double", (o) => { o.flux.push(resultat("t1", REFUS_PREFLIGHT_R05)); }, "indéterminé"],
]);

eprouver("C2.9/R06", "C2.9/R06", verifierR06, () => obs({ fournisseur: [requete(0, [simple()]), requete(1, [simple()])], flux: [resultat("t1", OUTIL_INTROUVABLE("task"))], inventaireCwd: inventaire() }), [
  ["task exécuté", (o) => { o.flux[0].result.content[0].text = "Refusé : ce dépôt n'est pas prêt pour un run."; }, "violé"],
  ["task déclaré", (o) => { q(o, 0).systemes[0].toolsAdded.push("task"); }, "violé"],
  ["enfant lancé", (o) => { o.fils.push({ commande: "/opt/node/bin/node" }); }, "violé"],
  ["résultat absent", (o) => { o.flux = []; }, "indéterminé"],
]);

const lectureSeule = (w: string, l: string) => [resultat(w, OUTIL_INTROUVABLE("write")), resultat(l, ".pi-subagent-runs/\n")];
eprouver("C2.9/R07", "C2.9/R07", verifierR07, () => obs({
  flux: lectureSeule("w1", "l1"),
  reprise: obs({ flux: lectureSeule("w2", "l2"), fichiers: { [MANIFESTE]: MANIFESTE_R07, "x.txt": null, "y.txt": null } }),
} as Partial<ObservationsMesure>), [
  ["write admis à la première", (o) => { o.flux[0].result.content[0].text = "Successfully wrote 2 bytes to x.txt"; }, "violé"],
  ["write admis à la reprise", (o) => { repriseDe(o).flux[0].result.content[0].text = "Successfully wrote 2 bytes to y.txt"; }, "violé"],
  ["lecture refusée", (o) => { repriseDe(o).flux[1].result.content[0].text = OUTIL_INTROUVABLE("read"); }, "violé"],
  ["fichier écrit", (o) => { repriseDe(o).fichiers!["y.txt"] = "y\n"; }, "violé"],
  ["manifeste changé", (o) => { repriseDe(o).fichiers![MANIFESTE] = MANIFESTE_R07.replace("planning", "active"); }, "violé"],
  ["reprise non observée", (o) => { delete (o as unknown as { reprise?: unknown }).reprise; }, "indéterminé"],
]);

// R08 : le prompt forcé du brief, dans les deux ordres. `rendu` est ce que pi rend des sections.
const rendu = (sections: Record<string, string>) => Object.values(sections).filter((x) => x.length > 0).join("\n\n");
const sectionsSousAgents = (runId: string) => ({ preamble: "P", tools: "<tools>\n- read\n- task\n</tools>", rules: regles(runId), delegation: D });
const sectionsGeneriques = () => ({ preamble: "P", tools: "<tools>\n- read\n- task\n</tools>", rules: regles("<runId>") });
const sectionsSimples = () => ({ preamble: "P", tools: "<tools>\n- read\n</tools>", rules: "<rules>\n- lire\n</rules>" });
/** Le prompt forcé : brief avant subagent, rendu générique + brief + complément ; sinon rendu complet + brief. */
const forceBrief = (ordre: OrdreR08, runId = RUN) =>
  ordre === "brief-avant"
    ? `${rendu(sectionsGeneriques())}${BLOC_BRIEF_R08}\n\n${D}\n\n<rules>\n- ${guidelinePlan(runId)}\n</rules>`
    : `${rendu(sectionsSousAgents(runId))}${BLOC_BRIEF_R08}`;
const forceBriefSimple = () => `${rendu(sectionsSimples())}${BLOC_BRIEF_R08}`;
const contenu0 = (o: ObservationsMesure) => q(o, 0).systemes[0];

for (const ordre of ["brief-avant", "subagent-avant"] as const) {
  const autre: OrdreR08 = ordre === "brief-avant" ? "subagent-avant" : "brief-avant";
  eprouver(`C2.9/R08-a (${ordre})`, "C2.9/R08-a", verifierR08A(ordre), () => obs({
    fournisseur: [requete(0, [force(forceBrief(ordre), [...LECTURE, "task"])]), requete(1, [sousAgents()])],
    fichiers: { [MANIFESTE]: manifeste() },
  }), [
    [`forme de l'autre ordre (${autre})`, (o) => { contenu0(o).content = forceBrief(autre); }, "violé"],
    ["complément dupliqué", (o) => { contenu0(o).content += `\n\n${D}`; }, "violé"],
    ["guideline du plan courant dupliquée", (o) => { contenu0(o).content += `\n- ${guidelinePlan(RUN)}`; }, "violé"],
    ["brief deux fois", (o) => { contenu0(o).content += BLOC_BRIEF_R08; }, "violé"],
    ["brief absent", (o) => { contenu0(o).content = contenu0(o).content.replace(BLOC_BRIEF_R08, ""); }, "violé"],
    ["préfixe altéré d'un octet", (o) => { contenu0(o).content = contenu0(o).content.replace("<tools>", "<tool>"); }, "violé"],
    ["guideline du plan d'un autre run", (o) => { contenu0(o).content = forceBrief(ordre, AUTRE_RUN); }, "violé"],
    ["task non déclaré", (o) => { contenu0(o).toolsAdded = [...LECTURE]; }, "violé"],
    ["seconde requête forcée", (o) => { q(o, 1).systemes[0].content = "forcé"; }, "violé"],
    ["deux contenus forcés", (o) => { q(o, 0).systemes.push(force("x", [])); }, "violé"],
    ["manifeste non relevé", (o) => { o.fichiers = {}; }, "indéterminé"],
  ]);
  eprouver(`C2.9/R08-b (${ordre})`, "C2.9/R08-b", verifierR08B(ordre), () => obs({
    fournisseur: [requete(0, [force(forceBriefSimple(), [...LECTURE])]), requete(1, [simple(), patchMontee()])],
    fichiers: { [MANIFESTE]: manifeste() },
  }), [
    ["délégation à la première requête", (o) => { contenu0(o).content += `\n\n${D}`; }, "violé"],
    ["guideline à la première requête", (o) => { contenu0(o).content += `\n- ${GUIDELINE_TASK}`; }, "violé"],
    ["task à la première requête", (o) => { contenu0(o).toolsAdded.push("task"); }, "violé"],
    ["préfixe altéré d'un octet", (o) => { contenu0(o).content = contenu0(o).content.replace("- lire", "- lir"); }, "violé"],
    ["seconde requête sans délégation", (o) => { delete dernierSys(o, 1).sections.delegation; }, "violé"],
    ["seconde requête forcée", (o) => { q(o, 1).systemes[0].content = "forcé"; }, "violé"],
  ]);
  eprouver(`C2.9/R08-c (${ordre})`, "C2.9/R08-c", verifierR08C(ordre), () => obs({
    fournisseur: [requete(0, [force(forceBrief(ordre), [...LECTURE, "task"])]), requete(1, [sousAgents(), patchDescente()])],
    fichiers: { [MANIFESTE]: manifeste() },
    reprise: obs({ fournisseur: [requete(0, [force(forceBriefSimple(), [...LECTURE])])] }),
  } as Partial<ObservationsMesure>), [
    ["complément dupliqué", (o) => { contenu0(o).content += `\n\n${D}`; }, "violé"],
    ["task après descente", (o) => { delete q(o, 1).systemes[1].toolsRemoved; }, "violé"],
    ["délégation à la reprise", (o) => { q(repriseDe(o), 0).systemes[0].content += `\n\n${D}`; }, "violé"],
    ["task à la reprise", (o) => { q(repriseDe(o), 0).systemes[0].toolsAdded.push("task"); }, "violé"],
    ["reprise non observée", (o) => { delete (o as unknown as { reprise?: unknown }).reprise; }, "indéterminé"],
  ]);
}

// R08-d : P0-C sur un plan terminal préparé, et son témoin non terminal.
const FIXTURE_D = fixtureR08D(RUN_ID_R08D, ["W01"], ["W01"]);
const FIXTURE_T = fixtureR08D(RUN_ID_R08D, ["W01", "W02"], ["W01"]);
const MARQUEUR = ".pi-subagent-runs/.git";
const inventaireRun = (fixture: Record<string, string>) => {
  const avant = [".gitignore", ".pi/BRIEF.md", ...Object.keys(fixture)].map((chemin) => ({ chemin, type: "fichier" as const, sha256: chemin }));
  return { avant, apres: [...avant, { chemin: MARQUEUR, type: "dossier" as const }, { chemin: `${MARQUEUR}/HEAD`, type: "fichier" as const, sha256: "h" }] };
};
const forceP0C = (ordre: OrdreR08) =>
  ordre === "brief-avant" ? `${rendu(sectionsSimples())}${BLOC_BRIEF_R08}\n\n${D}` : `${rendu({ ...sectionsSimples(), delegation: D })}${BLOC_BRIEF_R08}`;
const p0c = (ordre: OrdreR08) => () => obs({
  fournisseur: [0, 1, 2, 3].map((n) => requete(n, [force(forceP0C(ordre), [...LECTURE])])),
  flux: [resultat("t1", OUTIL_INTROUVABLE("task")), resultat("w1", OUTIL_INTROUVABLE("write")), resultat("l1", ".pi-subagent-runs/\n")],
  fichiers: { ...FIXTURE_D, "x.txt": null },
  inventaireCwd: inventaireRun(FIXTURE_D),
});
const registreD = `.pi-subagent-runs/${RUN_ID_R08D}-lanes.jsonl`;
for (const ordre of ["brief-avant", "subagent-avant"] as const) {
  const autre: OrdreR08 = ordre === "brief-avant" ? "subagent-avant" : "brief-avant";
  eprouver(`C2.9/R08-d (${ordre})`, "C2.9/R08-d", verifierR08D(ordre), p0c(ordre), [
    ["task déclaré", (o) => { contenu0(o).toolsAdded.push("task"); }, "violé"],
    ["task réactivé à un appel suivant", (o) => { q(o, 2).systemes.push(systeme({ toolsAdded: ["task"] })); }, "violé"],
    ["task réactivé puis retiré", (o) => { q(o, 1).systemes.push(systeme({ toolsAdded: ["task"] }), systeme({ toolsRemoved: ["task"] })); }, "violé"],
    ["guideline de task", (o) => { contenu0(o).content += `\n- ${GUIDELINE_TASK}`; }, "violé"],
    ["guideline générique du plan", (o) => { q(o, 3).systemes[0].content += `\n- ${guidelinePlan("<runId>")}`; }, "violé"],
    ["guideline du plan courant", (o) => { contenu0(o).content += `\n- ${guidelinePlan(RUN_ID_R08D)}`; }, "violé"],
    ["sans délégation (profil simple)", (o) => { for (const r of o.fournisseur) r.systemes[0].content = forceBriefSimple(); }, "violé"],
    [`forme de l'autre ordre (${autre})`, (o) => { contenu0(o).content = forceP0C(autre); }, "violé"],
    ["délégation dupliquée", (o) => { contenu0(o).content += `\n\n${D}`; }, "violé"],
    ["marqueur non posé", (o) => { o.inventaireCwd!.apres = o.inventaireCwd!.avant; }, "violé"],
    ["marqueur préexistant", (o) => { o.inventaireCwd!.avant = o.inventaireCwd!.apres; }, "violé"],
    ["autre run ouvert", (o) => { o.fichiers![MANIFESTE] = manifeste(AUTRE_RUN); }, "violé"],
    ["registre changé", (o) => { o.fichiers![registreD] += "{}\n"; }, "violé"],
    ["artefact", (o) => { o.inventaireCwd!.apres.push({ chemin: "x.txt", type: "fichier", sha256: "x" }); }, "violé"],
    ["entrée retirée", (o) => { o.inventaireCwd!.apres = o.inventaireCwd!.apres.filter((x) => x.chemin !== ".gitignore"); }, "violé"],
    ["entrée modifiée", (o) => { o.inventaireCwd!.apres = o.inventaireCwd!.apres.map((x) => x.chemin === ".pi/BRIEF.md" ? { ...x, sha256: "autre" } : x); }, "violé"],
    ["type changé", (o) => { o.inventaireCwd!.apres = o.inventaireCwd!.apres.map((x) => x.chemin === ".gitignore" ? { chemin: x.chemin, type: "lien" as const } : x); }, "violé"],
    ["fichier de session", (o) => { o.sessions.push({ fichier: "s.jsonl", entrees: [] }); }, "violé"],
    ["fichier écrit", (o) => { o.fichiers!["x.txt"] = "x\n"; }, "violé"],
    ["task exécuté", (o) => { o.flux[0].result.content[0].text = "Refusé : [run: plan terminal]"; }, "violé"],
    ["write admis", (o) => { o.flux[1].result.content[0].text = "Successfully wrote 2 bytes to x.txt"; }, "violé"],
    ["lecture refusée", (o) => { o.flux[2].result.content[0].text = OUTIL_INTROUVABLE("read"); }, "violé"],
    ["enfant lancé", (o) => { o.fils.push({ commande: "/opt/node/bin/node" }); }, "violé"],
    ["trois requêtes", (o) => { o.fournisseur.pop(); }, "indéterminé"],
    ["résultat absent", (o) => { o.flux.pop(); }, "indéterminé"],
    ["inventaires absents", (o) => { delete o.inventaireCwd; }, "indéterminé"],
  ]);
}
eprouver("C2.9/R08-d/temoin", "C2.9/R08-d/temoin", verifierR08DTemoin, () => obs({
  fournisseur: [requete(0, [sousAgents(RUN_ID_R08D)])],
  fichiers: { ...FIXTURE_T },
  inventaireCwd: inventaireRun(FIXTURE_T),
}), [
  ["task retiré", (o) => { contenu0(o).toolsAdded = [...LECTURE]; }, "violé"],
  ["guideline d'un autre run", (o) => { contenu0(o).sections.rules = regles(AUTRE_RUN); }, "violé"],
  ["sans délégation", (o) => { delete contenu0(o).sections.delegation; }, "violé"],
  ["marqueur non posé", (o) => { o.inventaireCwd!.apres = o.inventaireCwd!.avant; }, "violé"],
  ["plan changé", (o) => { o.fichiers![`.pi-subagent-runs/${RUN_ID_R08D}-plan.json`] = "{}\n"; }, "violé"],
  ["entrée retirée", (o) => { o.inventaireCwd!.apres = o.inventaireCwd!.apres.filter((x) => x.chemin !== ".gitignore"); }, "violé"],
  ["entrée modifiée", (o) => { o.inventaireCwd!.apres = o.inventaireCwd!.apres.map((x) => x.chemin === ".pi/BRIEF.md" ? { ...x, sha256: "autre" } : x); }, "violé"],
  ["fichier de session", (o) => { o.sessions.push({ fichier: "s.jsonl", entrees: [] }); }, "violé"],
]);
test("phase 2 — fixtureR08D : plan gelé d'empreinte vérifiable, registre v2, unités intégrées seules", () => {
  const plan = FIXTURE_D[`.pi-subagent-runs/${RUN_ID_R08D}-plan.json`];
  const m = JSON.parse(FIXTURE_D[MANIFESTE]);
  assert.equal(m.planHash, createHash("sha256").update(plan).digest("hex").slice(0, 16));
  assert.equal(m.status, "active");
  const lignes = FIXTURE_T[`.pi-subagent-runs/${RUN_ID_R08D}-lanes.jsonl`].trimEnd().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lignes[0], { ledger: 2 });
  assert.deepEqual(lignes.slice(1).map((e) => [e.event_seq, e.work_unit, e.event]), [[1, "W01", "OPENED"], [2, "W01", "INTEGRATED"]]);
  assert.deepEqual(JSON.parse(FIXTURE_T[`.pi-subagent-runs/${RUN_ID_R08D}-plan.json`]).work_units.map((u: { id: string }) => u.id), ["W01", "W02"]);
});

eprouver("C2.9/R09", "C2.9/R09", verifierR09, () => obs({
  fournisseur: [requete(0, [sousAgents()]), requete(1, [sousAgents(), patchDescente()])],
  fichiers: { [MANIFESTE]: manifeste() },
}), [
  ["prompt forcé en sous-agents", (o) => { contenu0(o).content = "forcé"; }, "violé"],
  ["prompt forcé en simple", (o) => { q(o, 1).systemPrompt = "forcé"; }, "violé"],
  ["ajout en simple", (o) => { delete dernierSys(o, 1).sections.delegation; }, "violé"],
  ["task en simple", (o) => { delete dernierSys(o, 1).toolsRemoved; }, "violé"],
  ["sans guideline du run en sous-agents", (o) => { contenu0(o).sections.rules = regles(AUTRE_RUN); }, "violé"],
]);
