/**
 * l0-reprises-r1a.test.ts — LOT-REPRISES, R1-a : le validateur pré-gel des consommateurs Python
 * (PLAN-LOT-REPRISES v2 gelé, `1a840043`, § 2, Q2 et Q6).
 *
 *   consommateurs   l'`ast` du vrai python3, sur un vrai dépôt git : formes absolue,
 *                   `from pkg import mod`, relatives à un et deux niveaux, import dans une
 *                   fonction ; un import dynamique n'est jamais compté — R1A-consommateurs
 *   classement      consommateur non classé → refus structuré avec la liste ; classé dans le
 *                   scope ou dans kept_consumers → accepté ; kept_consumers dans le scope, non
 *                   suivi, réservé ou non détecté → refusé — R1A-classement
 *   impossible      fichier refusé par l'ast, python3 absent, sortie illisible : refus nommé,
 *                   sans repli ni « non couvert » — R1A-analyse-impossible
 *   interpréteur    résolu une fois par tentative, et c'est CET exécutable qui analyse — R1A-interpreteur
 *   non Python      aucune unité n'écrit de .py suivi : aucun interpréteur requis — R1A-non-python
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  EXECUTEUR_REEL,
  PLAN_ANALYSE_IMPOSSIBLE,
  PLAN_KEPT_INVALIDE,
  PLAN_NON_CLASSES,
  validerConsommateurs,
  type Executeur,
} from "../subagent-only/consommateurs.ts";
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

/** Un dépôt git dont les fichiers donnés sont suivis. */
function depot(fichiers: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-r1a-")));
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

/** Le paquet de Balance Âgée, réduit à ses formes d'import. */
const PAQUET = {
  "src/pkg/__init__.py": "",
  "src/pkg/io.py": "def lire():\n    return 1\n",
  "src/pkg/run.py": "from pkg.io import lire\n",
  "src/pkg/entries.py": "from . import io\n",
  "src/pkg/sous/__init__.py": "",
  "src/pkg/sous/profond.py": "from ..io import lire\n",
  "src/pkg/tardif.py": "def f():\n    import pkg.io\n    return pkg.io\n",
  "src/pkg/dynamique.py": "import importlib\nm = importlib.import_module('pkg.io')\n",
  "src/pkg/voisin.py": "import os\n",
  "tests/test_io.py": "from pkg import io\n",
};

regressionCorrigee("R1A-consommateurs", "les consommateurs statiques directs d'un module écrit sont trouvés sous toutes leurs formes, et un import dynamique n'est jamais compté", () => {
  const root = depot(PAQUET);
  const u = unite("W01", ["src/pkg/io.py", "src/pkg/fingerprints.py"]);
  const v = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: u.expectedWriteScope }]), [u]);
  precondition(!v.ok, `un plan sans classement doit être refusé (${JSON.stringify(v)})`);
  if (v.ok) return;
  propriete(v.refus.code === PLAN_NON_CLASSES, `code ${v.refus.code}`);
  const manque = v.refus.code === PLAN_NON_CLASSES ? v.refus.missing.W01 ?? [] : [];
  for (const f of ["src/pkg/run.py", "src/pkg/entries.py", "src/pkg/sous/profond.py", "src/pkg/tardif.py", "tests/test_io.py"]) {
    propriete(manque.includes(f), `${f} est un consommateur statique direct (${manque.join(", ")})`);
  }
  propriete(!manque.includes("src/pkg/dynamique.py"), "un import dynamique n'est pas compté comme couvert");
  propriete(!manque.includes("src/pkg/voisin.py"), "un fichier qui n'importe pas le module n'est pas compté");
  propriete(!manque.includes("src/pkg/io.py"), "le module écrit n'est pas son propre consommateur");
  propriete(v.reason.includes("src/pkg/run.py") && v.reason.includes("kept_consumers"), "la raison porte la liste et dit où classer");
});

regressionCorrigee("R1A-classement", "chaque consommateur se classe dans le scope ou dans kept_consumers ; kept_consumers est disjoint, suivi, non réservé, et détecté", () => {
  const root = depot({ ...PAQUET, "DESIGN.md": "# D\n", "notes.txt": "n\n" });
  const scope = ["src/pkg/io.py"];
  const conso = ["src/pkg/entries.py", "src/pkg/run.py", "src/pkg/sous/profond.py", "src/pkg/tardif.py", "tests/test_io.py"];
  const u = [unite("W01", scope)];
  const ok = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope, kept_consumers: conso }]), u);
  propriete(ok.ok, `tous classés dans kept_consumers : accepté (${JSON.stringify(ok)})`);
  const mixte = [unite("W01", [...scope, "src/pkg/run.py"])];
  const ok2 = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: [...scope, "src/pkg/run.py"], kept_consumers: conso.filter((c) => c !== "src/pkg/run.py") }]), mixte);
  propriete(ok2.ok, `classés pour partie dans le scope : accepté (${JSON.stringify(ok2)})`);
  const partiel = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope, kept_consumers: conso.slice(1) }]), u);
  propriete(!partiel.ok && partiel.refus.code === PLAN_NON_CLASSES &&
    JSON.stringify(partiel.refus).includes("src/pkg/entries.py"), "un seul oubli suffit à refuser, et il est nommé");

  const kept = (k: unknown) => validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: scope, kept_consumers: k }]), u);
  // Dans le scope : une entrée qui passerait toutes les autres règles (suivie, non Python).
  const large = ["src/pkg/io.py", "notes.txt"];
  const recouvre = validerConsommateurs(root, plan([{ id: "W01", expected_write_scope: large, kept_consumers: [...conso, "notes.txt"] }]), [unite("W01", large)]);
  propriete(!recouvre.ok && recouvre.refus.code === PLAN_KEPT_INVALIDE, `kept_consumers dans le scope : refusé (${JSON.stringify(recouvre)})`);
  for (const [cas, k] of [
    ["non suivi", [...conso, "src/pkg/absent.py"]],
    ["réservé", [...conso, "DESIGN.md"]],
    ["Python non détecté", [...conso, "src/pkg/voisin.py"]],
    ["pas une liste", "src/pkg/run.py"],
  ] as const) {
    const r = kept(k);
    propriete(!r.ok && r.refus.code === PLAN_KEPT_INVALIDE, `kept_consumers ${cas} : refusé (${JSON.stringify(r)})`);
  }
  propriete(kept([...conso, "notes.txt"]).ok, "une entrée non Python suivie et disjointe est admise");
});

/** Un exécuteur dont chaque étape est observable, et que chaque preuve peut faire échouer. */
function espion(base: Executeur, surcharge: Partial<Executeur>) {
  const journal: string[] = [];
  const ex: Executeur = {
    suivis: (r) => { journal.push("suivis"); return (surcharge.suivis ?? base.suivis)(r); },
    interpreteur: () => { journal.push("interpreteur"); return (surcharge.interpreteur ?? base.interpreteur)(); },
    analyser: (e, r, f) => { journal.push(`analyser:${e}`); return (surcharge.analyser ?? base.analyser)(e, r, f); },
  };
  return { ex, journal };
}

regressionCorrigee("R1A-analyse-impossible", "une analyse Python impossible refuse le gel, nommée, sans repli ni « non couvert »", () => {
  const root = depot({ ...PAQUET, "src/pkg/casse.py": "def (:\n" });
  const u = [unite("W01", ["src/pkg/io.py"])];
  const doc = plan([{ id: "W01", expected_write_scope: ["src/pkg/io.py"] }]);
  const r = validerConsommateurs(root, doc, u);
  propriete(!r.ok && r.refus.code === PLAN_ANALYSE_IMPOSSIBLE, `un fichier refusé par l'ast refuse le gel (${JSON.stringify(r)})`);
  if (!r.ok && r.refus.code === PLAN_ANALYSE_IMPOSSIBLE) {
    propriete(r.refus.file === "src/pkg/casse.py", `le fichier est nommé (${r.refus.file})`);
    propriete(!!r.refus.interpreter?.executable && !!r.refus.interpreter?.version, "l'interpréteur et sa version sont nommés");
  }

  const sain = depot(PAQUET);
  const absent = espion(EXECUTEUR_REEL, { interpreteur: () => { throw new Error("spawnSync python3 ENOENT"); } });
  const r2 = validerConsommateurs(sain, doc, u, absent.ex);
  propriete(!r2.ok && r2.refus.code === PLAN_ANALYSE_IMPOSSIBLE, `python3 absent : refus (${JSON.stringify(r2)})`);
  if (!r2.ok && r2.refus.code === PLAN_ANALYSE_IMPOSSIBLE) propriete(r2.refus.file === undefined, "sans fichier incriminé");
  propriete(!absent.journal.some((j) => j.startsWith("analyser")), "aucun repli : rien n'analyse sans l'interpréteur résolu");

  const illisible = espion(EXECUTEUR_REEL, { analyser: () => "pas du json" });
  const r3 = validerConsommateurs(sain, doc, u, illisible.ex);
  propriete(!r3.ok && r3.refus.code === PLAN_ANALYSE_IMPOSSIBLE, "une sortie illisible n'est jamais lue comme « aucun consommateur »");
});

regressionCorrigee("R1A-interpreteur", "l'interpréteur est résolu une fois par tentative, et c'est cet exécutable-là qui analyse", () => {
  const root = depot(PAQUET);
  const u = [unite("W01", ["src/pkg/io.py"])];
  const doc = plan([{ id: "W01", expected_write_scope: ["src/pkg/io.py"] }]);
  const reel = EXECUTEUR_REEL.interpreteur();
  precondition(!!reel.executable, "python3 doit être présent pour cette preuve");
  const s = espion(EXECUTEUR_REEL, { interpreteur: () => ({ executable: reel.executable, version: "9.9.9-identite" }) });
  const v = validerConsommateurs(root, doc, u, s.ex);
  propriete(s.journal.filter((j) => j === "interpreteur").length === 1, `une seule résolution (${s.journal.join(", ")})`);
  propriete(s.journal.filter((j) => j.startsWith("analyser")).length === 1 &&
    s.journal.includes(`analyser:${reel.executable}`), "l'analyse tourne avec l'exécutable résolu");
  propriete(!v.ok && v.refus.code === PLAN_NON_CLASSES, "le verdict vient de cette analyse");
});

regressionCorrigee("R1A-non-python", "une unité qui n'écrit aucun .py suivi ne requiert aucun interpréteur", () => {
  const root = depot({ ...PAQUET, "docs/guide.md": "g\n" });
  const s = espion(EXECUTEUR_REEL, { interpreteur: () => { throw new Error("ne doit pas être appelé"); } });
  const u = [unite("W02", ["docs/guide.md", "src/pkg/neuf.py"])];
  const v = validerConsommateurs(root, plan([{ id: "W02", expected_write_scope: ["docs/guide.md", "src/pkg/neuf.py"] }]), u, s.ex);
  propriete(v.ok, `accepté sans analyse (${JSON.stringify(v)})`);
  propriete(!s.journal.includes("interpreteur"), "aucun interpréteur résolu");
});
