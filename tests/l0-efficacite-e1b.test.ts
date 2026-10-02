/**
 * l0-efficacite-e1b.test.ts — LOT-EFFICACITÉ, E1-bis : le kept des consommateurs est dérivé au gel,
 * publié avant le plan, puis seulement relu (plan des leviers v2 complétée, § 2.2 et § 2.4).
 *
 *   dérivation   un plan sans kept_consumers est accepté au premier contrôle ; kept = consommateurs
 *                statiques directs − scope, exactement ; ordre déterministe — E1b-derivation
 *   déclarés     forme, réservé, scope : refus inchangés, Python ou non ; non Python : suivi existant ;
 *                Python non trouvé : retiré et publié avec sa raison ; une entrée à la fois déclarée
 *                et dérivée : une seule occurrence ; une impossibilité d'analyse n'est jamais un
 *                retrait — E1b-declares
 *   durable      `<runId>-kept.json` : toutes les unités, kept vide compris ; absent, illisible, de
 *                schéma invalide, unité manquante ou planHash différent : inconnu, jamais vide —
 *                E1b-durable
 *   protocole    une seule prise de la garde ; bail et mutabilité avant toute publication ; kept
 *                publié avant le planHash ; plan déjà attaché : rien n'est réécrit ; kept orphelin :
 *                ARRÊT, sans réutilisation, remplacement ni attachement — E1b-protocole
 *
 * Sans harnais : la production est appelée directement. Le chemin complet, dans la vraie
 * extension, est dans tests/l0-efficacite-e1b-harness.test.ts.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  EXECUTEUR_REEL,
  PLAN_ANALYSE_IMPOSSIBLE,
  PLAN_KEPT_INVALIDE,
  validerConsommateurs,
  type Executeur,
} from "../subagent-only/consommateurs.ts";
import { ecrireKeptDurable, KEPT_SCHEMA, keptPath, lireKeptDurable, type KeptDurable } from "../subagent-only/kept-durable.ts";
import {
  acquireRunOwnership,
  attachPlanAvecKept,
  KeptInterrompuError,
  openRun,
  planHash,
  readManifest,
  type Lease,
} from "../subagent-only/run-manifest.ts";
import type { WorkUnit } from "../subagent-only/work-units.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

function depot(fichiers: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-e1b-")));
  jetables.push(root);
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(join(root, dirname(chemin)), { recursive: true });
    writeFileSync(join(root, chemin), contenu);
  }
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  git("add", "-A"); git("commit", "-qm", "base");
  return root;
}

const unite = (id: string, scope: string[]): WorkUnit => ({ id, goal: "g", dependsOn: [], expectedWriteScope: scope });
const plan = (u: Array<Record<string, unknown>>) => ({ version: 1, work_units: u });

/** La forme de Balance Âgée : un module extrait, ses importeurs, des tests qui ne l'importent pas. */
const PAQUET = {
  "src/pkg/__init__.py": "",
  "src/pkg/io.py": "def lire():\n    return 1\n",
  "src/pkg/run.py": "from pkg.io import lire\n",
  "src/pkg/export.py": "from . import io\n",
  "scripts/exporter.py": "from pkg import io\n",
  "tests/test_config.py": "import pkg.io as io_mod\n",
  "tests/test_resume.py": "import pkg.run\n",
  "tests/test_autre.py": "import os\n",
  "notes.txt": "n\n",
  "DESIGN.md": "# D\n",
};
const CONSO = ["scripts/exporter.py", "src/pkg/export.py", "src/pkg/run.py", "tests/test_config.py"];

regressionCorrigee("E1b-derivation", "un plan sans kept_consumers est accepté au premier contrôle, son kept dérivé exactement", () => {
  const root = depot(PAQUET);
  const scope = ["src/pkg/io.py", "src/pkg/fingerprints.py"];
  const v = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope }]), [unite("W01", scope)]);
  propriete(v.ok, `accepté au premier contrôle, sans refus (${JSON.stringify(v)})`);
  if (!v.ok) return;
  propriete(JSON.stringify(v.kept.W01) === JSON.stringify(CONSO), `kept = consommateurs − scope, triés (${JSON.stringify(v.kept.W01)})`);
  propriete(JSON.stringify(v.meta.W01) === JSON.stringify({ kept: CONSO, derived: CONSO, declared: [], dropped: [] }),
    `classement publié : derived seul (${JSON.stringify(v.meta.W01)})`);
  // Un consommateur placé dans le scope n'est pas kept : l'unité le modifie.
  const large = [...scope, "src/pkg/run.py"];
  const v2 = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: large }]), [unite("W01", large)]);
  propriete(v2.ok && !v2.kept.W01.includes("src/pkg/run.py") && v2.kept.W01.includes("tests/test_resume.py"),
    `un consommateur du scope n'est pas kept ; ceux du module ajouté au scope le deviennent (${JSON.stringify(v2)})`);
  // Deux unités : chacune son kept, une unité sans .py dans son scope a un kept vide connu.
  const u2 = [unite("W01", scope), unite("W02", ["notes.txt"])];
  const v3 = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope }, { id: "W02", expected_write_scope: ["notes.txt"] }]), u2);
  propriete(v3.ok && JSON.stringify(v3.kept.W02) === "[]" && JSON.stringify(v3.meta.W02?.kept) === "[]",
    `unité sans module Python écrit : kept vide, classement présent (${JSON.stringify(v3)})`);
  // Déterministe : deux tentatives rendent le même classement, octet pour octet.
  const v4 = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope }]), [unite("W01", scope)]);
  propriete(JSON.stringify(v4) === JSON.stringify(v), "deux tentatives : le même classement");
});

regressionCorrigee("E1b-declares", "les entrées déclarées gardent les contrôles communs ; une entrée Python non trouvée est retirée et publiée, sans refus", () => {
  const root = depot(PAQUET);
  const scope = ["src/pkg/io.py"];
  const u = [unite("W01", scope)];
  const avec = (k: unknown) => validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope, kept_consumers: k }]), u);
  const refusKept = (r: ReturnType<typeof avec>) => !r.ok && r.refus.code === PLAN_KEPT_INVALIDE;

  // Retraits : non directe, non suivie. (Un .py suivi mais absent rend l'analyse impossible : il
  // n'est retirable que lorsque l'analyse n'est pas nécessaire, plus bas.)
  const retraits = avec(["tests/test_resume.py", "tests/test_absent.py", "src/pkg/run.py"]);
  propriete(retraits.ok, `entrées Python non trouvées : aucun refus (${JSON.stringify(retraits)})`);
  if (retraits.ok) {
    const m = retraits.meta.W01;
    propriete(JSON.stringify(m.dropped) === JSON.stringify([
      { path: "tests/test_resume.py", reason: "non consommateur direct" },
      { path: "tests/test_absent.py", reason: "non suivi" },
    ]), `chaque retrait publié avec sa raison (${JSON.stringify(m.dropped)})`);
    propriete(JSON.stringify(m.kept) === JSON.stringify(CONSO) && !m.kept.some((k) => m.dropped.some((d) => d.path === k)),
      `aucun retiré dans le kept, tous les consommateurs dérivés (${JSON.stringify(m.kept)})`);
    // Une entrée présente à la fois dans declared et derived : une seule occurrence dans kept.
    propriete(m.declared.includes("src/pkg/run.py") && m.derived.includes("src/pkg/run.py") &&
      m.kept.filter((k) => k === "src/pkg/run.py").length === 1, "Entrée présente à la fois dans declared et derived : une seule occurrence dans kept.");
  }
  // Champ de forme invalide : refus inchangé.
  for (const forme of ["src/pkg/run.py", [""], [3], [" "]]) {
    propriete(refusKept(avec(forme)), `Champ de forme invalide : refus inchangé (${JSON.stringify(forme)})`);
  }
  // Entrée Python réservée ou dans le scope : refus inchangé.
  const large = ["src/pkg/io.py", "src/pkg/run.py"];
  const dansScope = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: large, kept_consumers: ["src/pkg/run.py"] }]), [unite("W01", large)]);
  propriete(!dansScope.ok && dansScope.refus.code === PLAN_KEPT_INVALIDE, `Entrée Python dans le scope : refus inchangé (${JSON.stringify(dansScope)})`);
  // Entrée Python réservée : aucun chemin Python n'est réservé dans cette configuration
  // (RESERVED_WRITE_PATHS = ["DESIGN.md"]) ; le contrôle « réservé » précède pourtant le contrôle
  // Python dans `classer`, comme le contrôle du scope, éprouvé ci-dessus et par le mutant (h).
  // Entrée non Python : réservée, dans le scope, non suivie → refus ; suivie et disjointe → gardée.
  propriete(refusKept(avec(["DESIGN.md"])), "entrée non Python réservée : refus");
  propriete(refusKept(avec(["docs/absent.md"])), "entrée non Python non suivie : refus");
  const largeNotes = ["src/pkg/io.py", "notes.txt"];
  const notesScope = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: largeNotes, kept_consumers: ["notes.txt"] }]), [unite("W01", largeNotes)]);
  propriete(!notesScope.ok && notesScope.refus.code === PLAN_KEPT_INVALIDE, "entrée non Python dans le scope : refus");
  const notes = avec(["notes.txt", "notes.txt"]);
  propriete(notes.ok && JSON.stringify(notes.meta.W01.declared) === JSON.stringify(["notes.txt"]) && notes.kept.W01.includes("notes.txt"),
    `entrée non Python suivie et disjointe : gardée, une fois (${JSON.stringify(notes)})`);
  // Les contrôles communs passent avant le contrôle « consommateur direct » : un retrait ne masque
  // jamais un refus, quel que soit l'ordre des entrées.
  propriete(refusKept(avec(["tests/test_resume.py", "DESIGN.md"])), "un retrait ne masque pas un chemin réservé qui le suit");
  propriete(refusKept(avec(["tests/test_resume.py", "src/pkg/io.py"])), "un retrait ne masque pas une entrée du scope qui le suit");

  // Analyse non nécessaire (aucun .py écrit) : une entrée Python déclarée est retirée, sans refus —
  // y compris un .py suivi mais absent du disque.
  rmSync(join(root, "tests", "test_autre.py"));
  const sansPy = validerConsommateurs(root, plan([{ id: "W02", expected_write_scope: ["notes.txt"], kept_consumers: ["src/pkg/run.py", "tests/test_autre.py"] }]), [unite("W02", ["notes.txt"])]);
  propriete(sansPy.ok && JSON.stringify(sansPy.meta.W02.dropped) === JSON.stringify([
    { path: "src/pkg/run.py", reason: "non consommateur direct" },
    { path: "tests/test_autre.py", reason: "inexistant" },
  ]), `analyse non nécessaire : retraits publiés avec leur raison (${JSON.stringify(sansPy)})`);
  // Une impossibilité d'analyse ne devient jamais un retrait.
  const absent: Executeur = { ...EXECUTEUR_REEL, interpreteur: () => { throw new Error("spawnSync python3 ENOENT"); } };
  const impossible = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope, kept_consumers: ["tests/test_resume.py"] }]), u, absent);
  propriete(!impossible.ok && impossible.refus.code === PLAN_ANALYSE_IMPOSSIBLE,
    `python3 absent, entrée Python déclarée : PLAN_PYTHON_ANALYSIS_IMPOSSIBLE, jamais un retrait (${JSON.stringify(impossible)})`);
});

const UNITE_VIDE = { kept: [], derived: [], declared: [], dropped: [] };
const UNITE_W01 = { kept: ["src/pkg/run.py"], derived: ["src/pkg/run.py"], declared: [], dropped: [{ path: "x.py", reason: "non suivi" }] };

regressionCorrigee("E1b-durable", "le kept durable se relit vérifié ; toute anomalie le rend inconnu, jamais vide", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-e1b-kept-")));
  jetables.push(dir);
  const doc: KeptDurable = { schema: KEPT_SCHEMA, planHash: "abc", units: { W01: UNITE_W01, W02: UNITE_VIDE } };
  ecrireKeptDurable(dir, "run1", doc);
  propriete(readdirSync(dir).every((f) => !f.endsWith(".tmp")), "aucun temporaire laissé");
  const lu = lireKeptDurable(dir, "run1", "abc", ["W01", "W02"]);
  propriete(lu.etat === "connu" && JSON.stringify(lu.units) === JSON.stringify(doc.units), `relu tel quel (${JSON.stringify(lu)})`);
  // Unité présente avec kept vide : état connu, distinct de kept inconnu.
  propriete(lu.etat === "connu" && JSON.stringify(lu.units.W02.kept) === "[]", "Unité présente avec kept vide : état connu, distinct de kept inconnu.");
  const inconnu = (r: ReturnType<typeof lireKeptDurable>) => r.etat === "inconnu";
  propriete(inconnu(lireKeptDurable(dir, "run1", "autre", ["W01", "W02"])), "planHash différent : inconnu");
  propriete(inconnu(lireKeptDurable(dir, "run1", "abc", ["W01", "W02", "W03"])), "unité manquante : inconnu");
  propriete(inconnu(lireKeptDurable(dir, "absent", "abc", ["W01"])), "fichier absent : inconnu");
  const poser = (contenu: string) => { writeFileSync(keptPath(dir, "run2"), contenu); return lireKeptDurable(dir, "run2", "abc", ["W01"]); };
  propriete(inconnu(poser("{illisible")), "fichier illisible : inconnu");
  propriete(inconnu(poser(JSON.stringify({ ...doc, schema: "pi-kept/0" }))), "schéma invalide : inconnu");
  propriete(inconnu(poser(JSON.stringify({ ...doc, units: { W01: { ...UNITE_W01, kept: [] } } }))), "kept qui n'est pas l'union declared ∪ derived : inconnu");
  propriete(inconnu(poser(JSON.stringify({ ...doc, units: { W01: { kept: ["a.py"] } } }))), "unité de forme incomplète : inconnu");
  propriete(inconnu(poser(JSON.stringify({ ...doc, units: [] }))), "units qui n'est pas un objet : inconnu");
});

function runLie(): { dir: string; runId: string; lease: Lease } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-e1b-run-")));
  jetables.push(dir);
  const { manifest } = openRun(dir);
  const r = acquireRunOwnership(dir, manifest.runId, "s-e1b");
  precondition(r.ok, `propriété (${JSON.stringify(r)})`);
  return { dir, runId: manifest.runId, lease: (r as { lease: Lease }).lease };
}
const TEXTE = JSON.stringify(plan([{ id: "W01", expected_write_scope: ["src/pkg/io.py"] }]));
const docKept = (hash: string): KeptDurable => ({ schema: KEPT_SCHEMA, planHash: hash, units: { W01: UNITE_W01 } });

regressionCorrigee("E1b-protocole", "le kept est publié avant le planHash, sous une seule prise de la garde, et jamais réécrit ni réutilisé orphelin", () => {
  // Gel normal : bail vérifié, garde tenue pendant la publication du kept, kept avant planHash.
  const { dir, runId, lease } = runLie();
  const ordre: string[] = [];
  const g = attachPlanAvecKept(dir, TEXTE, lease, {
    existe: () => existsSync(keptPath(dir, runId)),
    publier: (hash) => {
      ordre.push(`kept:garde=${existsSync(join(dir, `${runId}.guard`))}:planHash=${String(readManifest(dir)?.planHash)}`);
      ecrireKeptDurable(dir, runId, docKept(hash));
    },
  });
  propriete(g.publie && g.manifest.planHash === planHash(TEXTE), `gel publié (${JSON.stringify(g)})`);
  propriete(JSON.stringify(ordre) === JSON.stringify(["kept:garde=true:planHash=undefined"]),
    `le kept est publié sous la garde, AVANT le planHash (${JSON.stringify(ordre)})`);
  propriete(readManifest(dir)?.planHash === planHash(TEXTE), "le planHash est publié ensuite");
  const lu = lireKeptDurable(dir, runId, planHash(TEXTE), ["W01"]);
  propriete(lu.etat === "connu", "le kept durable correspond au planHash publié");

  // Plan déjà attaché au moment de la vérification sous garde : aucun écrasement du kept.
  const avant = readFileSync(keptPath(dir, runId), "utf-8");
  let republie = 0;
  const g2 = attachPlanAvecKept(dir, TEXTE, lease, { existe: () => true, publier: () => { republie += 1; } });
  propriete(!g2.publie && republie === 0 && readFileSync(keptPath(dir, runId), "utf-8") === avant,
    "Plan déjà attaché au moment de la vérification sous garde : aucun écrasement du kept ; chemin de reprise selon le manifeste.");

  // Crash après publication du kept et avant publication du planHash : ARRÊT.
  const b = runLie();
  ecrireKeptDurable(b.dir, b.runId, docKept(planHash(TEXTE)));
  const orphelin = readFileSync(keptPath(b.dir, b.runId), "utf-8");
  let publie = 0;
  let erreur: unknown;
  try {
    attachPlanAvecKept(b.dir, TEXTE, b.lease, { existe: () => existsSync(keptPath(b.dir, b.runId)), publier: () => { publie += 1; } });
  } catch (e) {
    erreur = e;
  }
  propriete(erreur instanceof KeptInterrompuError && String((erreur as Error).message).includes("KEPT_PUBLICATION_INTERROMPUE"),
    `kept orphelin : ARRÊT nommé (${String(erreur)})`);
  propriete(publie === 0 && readFileSync(keptPath(b.dir, b.runId), "utf-8") === orphelin && !readManifest(b.dir)?.planHash,
    "Crash après publication du kept et avant publication du planHash : ARRÊT de reprise, sans réutilisation, remplacement, nouvelle analyse, attachement, lane ni délégation.");

  // Bail et mutabilité avant toute publication : une capacité étrangère ne publie rien.
  const c = runLie();
  const etrangere: Lease = { ...c.lease, leaseId: "etranger" };
  let publieC = 0;
  let refus: unknown;
  try {
    attachPlanAvecKept(c.dir, TEXTE, etrangere, { existe: () => false, publier: () => { publieC += 1; } });
  } catch (e) {
    refus = e;
  }
  propriete(refus !== undefined && publieC === 0 && !existsSync(keptPath(c.dir, c.runId)) && !readManifest(c.dir)?.planHash,
    `Une seule acquisition de la garde ; les contrôles de bail et de mutabilité précèdent toute publication. (${String(refus)})`);

  // Une erreur de publication interrompt le chemin : aucun planHash.
  const d = runLie();
  let echec: unknown;
  try {
    attachPlanAvecKept(d.dir, TEXTE, d.lease, { existe: () => false, publier: () => { throw new Error("disque plein"); } });
  } catch (e) {
    echec = e;
  }
  propriete(String(echec).includes("disque plein") && !readManifest(d.dir)?.planHash, "publication en erreur : aucun planHash publié");
});
