/**
 * Le plan gelé côté runtime, et ce qu'une lane possède.
 *
 * Les cas de validité reprennent un par un ceux de `tests/test_shadow.py` :
 * les deux implémentations doivent refuser la même chose, et c'est ici que la
 * dérive deviendra visible si l'une des deux bouge sans l'autre.
 *
 * Les cas réservés viennent d'une mesure. La sonde S énonçait en toutes lettres
 * « DESIGN.md is yours to write and never a delegation's » et deux plans sur
 * trois l'ont déclaré quand même, dans huit et neuf unités. Le contrat ne peut
 * donc pas vivre dans la guideline seule.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RESERVED_WRITE_PATHS,
  cycles,
  inScope,
  isReserved,
  parsePlan,
  reservedTouched,
  validatePlan,
  type WorkUnit,
} from "../subagent-only/work-units.ts";

const unit = (id: string, deps: string[] = [], scope?: string[]) => ({
  id,
  goal: `goal of ${id}`,
  depends_on: deps,
  expected_write_scope: scope ?? [`src/${id.toLowerCase()}.py`],
});
const plan = (units: unknown[], version: unknown = 1) => ({ version, work_units: units });

// ------------------------------------------------------------- validité

test("un plan bien formé est exploitable", () => {
  const r = validatePlan(plan([unit("W01"), unit("W02", ["W01"])]));
  assert.equal(r.status, "usable");
  assert.equal(r.reason, "");
  assert.deepEqual(r.units.map((u) => u.id), ["W01", "W02"]);
  assert.deepEqual(r.units[1].dependsOn, ["W01"]);
});

test("absent est une réponse à part entière", () => {
  assert.equal(validatePlan(undefined).status, "absent");
  assert.equal(validatePlan(null).status, "absent");
});

test("une mauvaise version invalide", () => {
  const r = validatePlan(plan([unit("W01")], 999));
  assert.equal(r.status, "invalid");
  assert.match(r.reason, /version/);
});

test("un id dupliqué invalide", () => {
  assert.match(validatePlan(plan([unit("W01"), unit("W01")])).reason, /duplicate/);
});

// Le cas dangereux : une dépendance mal tapée, écartée en silence, élargirait
// le DAG — le seul chiffre pour lequel tout ce chantier existe.
test("une dépendance vers une unité inexistante invalide", () => {
  const r = validatePlan(plan([unit("W01"), unit("W02", ["NOPE"])]));
  assert.equal(r.status, "invalid");
  assert.match(r.reason, /NOPE/);
});

test("un cycle invalide", () => {
  const r = validatePlan(plan([unit("W01", ["W02"]), unit("W02", ["W01"])]));
  assert.equal(r.status, "invalid");
  assert.match(r.reason, /cycle/);
});

test("une auto-dépendance invalide", () => {
  assert.equal(validatePlan(plan([unit("W01", ["W01"])])).status, "invalid");
});

test("un scope manquant ou vide invalide", () => {
  assert.equal(validatePlan(plan([{ id: "W01", goal: "g", depends_on: [] }])).status, "invalid");
  assert.equal(validatePlan(plan([unit("W01", [], [])])).status, "invalid");
});

test("un depends_on manquant invalide", () => {
  assert.equal(
    validatePlan(plan([{ id: "W01", goal: "g", expected_write_scope: ["a.py"] }])).status,
    "invalid",
  );
});

// Aucune acceptation partielle : une unité malformée invalide le plan, elle
// n'est pas écartée de l'ensemble sur lequel on calcule ensuite.
test("une seule unité malformée invalide tout le plan", () => {
  const r = validatePlan(plan([unit("W01"), { id: "", depends_on: [], expected_write_scope: ["x"] }]));
  assert.equal(r.status, "invalid");
});

test("un plan vide invalide", () => {
  assert.equal(validatePlan({ version: 1, work_units: [] }).status, "invalid");
  assert.equal(validatePlan({ version: 1 }).status, "invalid");
});

test("un plan qui n'est pas un objet invalide", () => {
  assert.equal(validatePlan([1, 2]).status, "invalid");
  assert.equal(validatePlan("plan").status, "invalid");
});

// Le goal ne nourrit aucun calcul : il est signalé, jamais bloquant.
test("un goal absent est signalé sans invalider", () => {
  const doc = plan([unit("W01"), unit("W02", ["W01"])]);
  delete (doc.work_units[0] as Record<string, unknown>).goal;
  const r = validatePlan(doc);
  assert.equal(r.status, "usable");
  assert.deepEqual(r.goalGaps, ["W01"]);
});

test("une lacune de goal ne rattrape pas une faute structurelle", () => {
  const doc = plan([unit("W01"), unit("W02", ["NOPE"])]);
  delete (doc.work_units[0] as Record<string, unknown>).goal;
  assert.equal(validatePlan(doc).status, "invalid");
});

test("un plan complet ne signale aucune lacune", () => {
  assert.deepEqual(validatePlan(plan([unit("W01")])).goalGaps, []);
});

// ------------------------------------------------------- lecture du texte

/*
 * Un plan corrompu et un plan jamais écrit appellent des réponses opposées :
 * l'absence est normale, la corruption est un défaut à corriger avant
 * d'exécuter. La première version les confondait — `JSON.parse` échouait et le
 * plan devenait « absent ».
 */
test("un JSON illisible est invalide, pas absent", () => {
  const r = parsePlan('{"version": 1, "work_un');
  assert.equal(r.status, "invalid");
  assert.match(r.reason, /not JSON/);
});

test("un fichier absent est absent", () => {
  assert.equal(parsePlan(undefined).status, "absent");
});

test("un plan lisible et valide passe par le même chemin", () => {
  assert.equal(parsePlan(JSON.stringify(plan([unit("W01")]))).status, "usable");
});

// ------------------------------------------------------------- cycles

test("une chaîne n'a aucun cycle", () => {
  const units = validatePlan(plan([unit("W1"), unit("W2", ["W1"]), unit("W3", ["W2"])])).units;
  assert.deepEqual(cycles(units), []);
});

test("un cycle et ce qui le suit ne s'étagent pas", () => {
  const units: WorkUnit[] = [
    { id: "A", goal: "", dependsOn: ["B"], expectedWriteScope: ["a"] },
    { id: "B", goal: "", dependsOn: ["A"], expectedWriteScope: ["b"] },
    { id: "C", goal: "", dependsOn: ["A"], expectedWriteScope: ["c"] },
  ];
  assert.deepEqual(cycles(units), ["A", "B", "C"]);
});

// --------------------------------------------------------- chemins réservés

test("DESIGN.md est réservé", () => {
  assert.ok(isReserved("DESIGN.md"));
  assert.ok(isReserved("./DESIGN.md"));
});

test("un fichier voisin ne l'est pas", () => {
  assert.equal(isReserved("DESIGN.md.bak"), false);
  assert.equal(isReserved("docs/DESIGN.md"), false);
  assert.equal(isReserved("src/balance_agee/io.py"), false);
});

// Déclaré dans un scope : signalé, jamais bloquant. Le plan reste exploitable —
// deux plans sur trois de la sonde S l'auraient sinon rendu invalide, et on
// aurait perdu la mesure pour une faute de prose.
test("un chemin réservé déclaré dans un scope est signalé sans invalider", () => {
  const r = validatePlan(plan([
    unit("W01", [], ["src/io.py", "DESIGN.md"]),
    unit("W02", [], ["src/run.py", "DESIGN.md"]),
  ]));
  assert.equal(r.status, "usable");
  assert.deepEqual(r.reservedDeclarations, [
    { unit: "W01", path: "DESIGN.md" },
    { unit: "W02", path: "DESIGN.md" },
  ]);
});

// Écrit pour de vrai : c'est la troisième règle, et sans elle les deux
// premières seraient dangereuses — on déclarerait deux workers indépendants
// tout en les laissant écrire au même endroit.
test("un chemin réservé réellement écrit est relevé", () => {
  assert.deepEqual(reservedTouched(["src/io.py", "DESIGN.md", "README.md"]), ["DESIGN.md"]);
  assert.deepEqual(reservedTouched(["src/io.py"]), []);
});

test("la liste des chemins réservés est explicite et courte", () => {
  assert.deepEqual([...RESERVED_WRITE_PATHS], ["DESIGN.md"]);
});

// ------------------------------------------------- corpus de conformité

/*
 * Les mêmes entrées que le validateur python, pas seulement les mêmes
 * catégories. La dette de duplication s'était déjà matérialisée sans qu'on la
 * voie : le TypeScript rognait les chaînes, le python gardait la valeur
 * d'origine, donc `" W01 "` et `"W01"` étaient un doublon d'un côté et deux
 * unités de l'autre. Des tests parallèles écrits séparément ne l'auraient
 * jamais montré — seul un corpus partagé le fait.
 */
interface Corpus {
  documents: Array<{ name: string; doc: unknown; status: string; reason?: string; goalGaps?: string[] }>;
  texts: Array<{ name: string; text: string; status: string; reason?: string }>;
}
const corpus: Corpus = JSON.parse(
  readFileSync(join(import.meta.dirname, "plan-corpus.json"), "utf-8"),
);

for (const c of corpus.documents) {
  test(`corpus · ${c.name}`, () => {
    const r = validatePlan(c.doc);
    assert.equal(r.status, c.status, r.reason);
    if (c.reason) assert.ok(r.reason.includes(c.reason), `${r.reason} ne contient pas ${c.reason}`);
    if (c.goalGaps) assert.deepEqual(r.goalGaps, c.goalGaps);
  });
}

for (const c of corpus.texts) {
  test(`corpus texte · ${c.name}`, () => {
    const r = parsePlan(c.text);
    assert.equal(r.status, c.status, r.reason);
    if (c.reason) assert.ok(r.reason.includes(c.reason), `${r.reason} ne contient pas ${c.reason}`);
  });
}

// ------------------------------------- corpus de correspondance de scope

/*
 * Les mêmes entrées que `in_scope` en python, et surtout la sémantique voulue
 * et pas seulement l'accord des deux. Deux divergences trouvées en l'écrivant :
 * `.` était refusé des deux côtés — d'accord et faux — et `src/*.py` attrapait
 * `src/x/a.py` en python parce que `fnmatch` laisse `*` franchir les barres.
 */
interface ScopeCorpus {
  cases: Array<{ path: string; scope: string[]; in: boolean; why: string }>;
}
const scopeCorpus: ScopeCorpus = JSON.parse(
  readFileSync(join(import.meta.dirname, "scope-corpus.json"), "utf-8"),
);

for (const c of scopeCorpus.cases) {
  test(`scope · ${c.path} dans ${JSON.stringify(c.scope)} — ${c.why}`, () => {
    assert.equal(inScope(c.path, c.scope), c.in);
  });
}
