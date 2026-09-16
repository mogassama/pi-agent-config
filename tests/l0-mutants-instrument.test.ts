/**
 * l0-mutants-instrument.test.ts — l'instrument des mutants, éprouvé sur un dépôt jouet.
 *
 * Un instrument échoue en affichant un résultat crédible. Chaque cas monte un dépôt git
 * minimal portant UNE régression corrigée et son fichier de mutants, lance le vrai
 * `tests/tools/l0-mutants --racine <jouet>`, et vérifie son code de sortie ET la raison
 * qu'il imprime. Un refus sans la bonne raison ne compte pas : un instrument qui refuse
 * tout passerait sinon chaque cas négatif.
 *
 * Aucune ligne de ce fichier ne commence par une fonction de déclaration L0 : le jouet
 * construit la sienne par concaténation, sans quoi `declarations()` la lirait ici.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUTIL = join(import.meta.dirname, "tools", "l0-mutants");
const NOM = "L0 REG D1 — la cible et l'autre valent 1";
const DECLARANT = "regression" + "Corrigee";

interface Edition { file: string; find: string; replace: string }
type Mutant = Record<string, unknown>;

const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): void {
  const p = spawnSync("git", args, { cwd, encoding: "utf-8" });
  assert.equal(p.status, 0, `git ${args.join(" ")} : ${p.stderr}`);
}

/** Un dépôt jouet : deux modules, une preuve, un fichier de mutants. */
function jouet(mutants: Mutant[] | ((root: string) => Mutant[])): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "l0-instrument-")));
  jetables.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "src", "cible.ts"), "export function valeur(): number { return 1; }\n");
  writeFileSync(join(root, "src", "autre.ts"), "export function autre(): number { return 1; }\n");
  writeFileSync(join(root, "src", "double.ts"), "export const a = () => 7;\nexport const b = () => 7;\n");
  writeFileSync(
    join(root, "tests", "l0-demo.test.ts"),
    [
      `import assert from "node:assert/strict";`,
      `import { test } from "node:test";`,
      `import { valeur } from "../src/cible.ts";`,
      `import { autre } from "../src/autre.ts";`,
      `function ${DECLARANT}(id: string, titre: string, fn: () => void): void { test(\`L0 REG \${id} — \${titre}\`, fn); }`,
      `${DECLARANT}("D1", "la cible et l'autre valent 1", () => {`,
      `  assert.ok(valeur() === 1 && autre() === 1, "PROPRIÉTÉ — les deux valent 1");`,
      `});`,
      "",
    ].join("\n"),
  );
  const liste = typeof mutants === "function" ? mutants(root) : mutants;
  writeFileSync(join(root, "tests", "l0-mutants.json"), `${JSON.stringify(liste, null, 2)}\n`);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "jouet");
  return root;
}

function lancer(root: string): { status: number | null; sortie: string } {
  const flags = Number(process.versions.node.split(".")[0]) < 23 ? ["--experimental-strip-types"] : [];
  /*
   * Sans NODE_TEST_CONTEXT : hérité du runner qui exécute ce fichier, il ferait parler les
   * `node --test` imbriqués de l'outil au protocole du parent, et non en TAP. L'outil ne
   * trouverait alors aucune preuve — un faux négatif qui ressemble à un vrai.
   */
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const p = spawnSync(process.execPath, [...flags, OUTIL, "--racine", root], { encoding: "utf-8", env });
  return { status: p.status, sortie: `${p.stdout}${p.stderr}` };
}

const casser: Edition = { file: "src/cible.ts", find: "return 1;", replace: "return 2;" };
/** Une « fenêtre élargie » inoffensive : change le texte, pas la valeur. */
const elargir: Edition = { file: "src/autre.ts", find: "return 1;", replace: "return 0 + 1;" };

function refuse(sortie: { status: number | null; sortie: string }, raison: RegExp, quoi: string): void {
  assert.notEqual(sortie.status, 0, `${quoi} : l'outil doit échouer\n${sortie.sortie}`);
  assert.match(sortie.sortie, raison, `${quoi} : l'outil doit échouer POUR CETTE RAISON\n${sortie.sortie}`);
}

test("forme historique : mutant mordant accepté", () => {
  const s = lancer(jouet([{ test: NOM, ...casser }]));
  assert.equal(s.status, 0, s.sortie);
  assert.match(s.sortie, /intacte verte · mutant rouge   L0 REG D1/);
  assert.match(s.sortie, /racine /, "une racine non canonique doit s'imprimer");
});

test("forme composée multi-fichiers, contrôle 20/20 et mutant 20/20 : acceptée", () => {
  const s = lancer(jouet([{ test: NOM, edits: [elargir, casser], control: [elargir], runs: 20 }]));
  assert.equal(s.status, 0, s.sortie);
  assert.match(s.sortie, /contrôle vert 20\/20 · mutant rouge 20\/20   L0 REG D1/);
});

test("cible absente : refus nommé", () => {
  refuse(
    lancer(jouet([{ test: NOM, file: "src/cible.ts", find: "return 9;", replace: "return 2;" }])),
    /cible trouvée 0 fois dans src\/cible\.ts/,
    "cible absente",
  );
});

test("cible dupliquée : refus nommé, même dans une forme composée", () => {
  refuse(
    lancer(jouet([{ test: NOM, edits: [casser, { file: "src/double.ts", find: "=> 7;", replace: "=> 8;" }] }])),
    /cible trouvée 2 fois dans src\/double\.ts/,
    "cible dupliquée",
  );
});

test("contrôle rouge : refus nommé, avant tout mutant", () => {
  refuse(
    lancer(jouet([{ test: NOM, edits: [casser], control: [casser], runs: 20 }])),
    /contrôle non vert à l'exécution 1\/20/,
    "contrôle rouge",
  );
});

test("mutant vert : refus nommé", () => {
  refuse(
    lancer(jouet([{ test: NOM, edits: [elargir] }])),
    /VERTE sur le mutant — la preuve ne tient pas sa porte/,
    "mutant vert",
  );
});

test("série incomplète : un mutant qui ne mord qu'une fois sur deux est refusé", () => {
  const compteur = join(realpathSync(mkdtempSync(join(tmpdir(), "l0-compteur-"))), "n");
  jetables.push(join(compteur, ".."));
  const intermittent: Edition = {
    file: "src/cible.ts",
    find: "return 1;",
    replace:
      `const fs = process.getBuiltinModule("node:fs"); const p = ${JSON.stringify(compteur)}; ` +
      `const n = fs.existsSync(p) ? Number(fs.readFileSync(p, "utf-8")) : 0; ` +
      `fs.writeFileSync(p, String(n + 1)); return n % 2 === 0 ? 2 : 1;`,
  };
  refuse(
    lancer(jouet([{ test: NOM, edits: [intermittent], control: [elargir], runs: 20 }])),
    /série incomplète : VERTE sur le mutant à l'exécution 2\/20/,
    "série incomplète",
  );
});

test("formes invalides : mélange, contrôle sans série, edits vide — refus nommés", () => {
  refuse(
    lancer(jouet([{ test: NOM, ...casser, edits: [casser] }])),
    /forme ni historique ni composée/,
    "forme mixte",
  );
  refuse(
    lancer(jouet([{ test: NOM, edits: [casser], control: [elargir], runs: 3 }])),
    /un contrôle impose runs ≥ 20 \(déclaré 3\)/,
    "contrôle sans série",
  );
  refuse(lancer(jouet([{ test: NOM, edits: [] }])), /edits vide ou absent/, "edits vide");
});

test("éditions enchaînées : chaque cible est comptée dans l'original ET au moment d'appliquer", () => {
  // La première édition CRÉE la cible de la seconde : absente de l'original.
  refuse(
    lancer(jouet([{ test: NOM, edits: [casser, { file: "src/cible.ts", find: "return 2;", replace: "return 3;" }] }])),
    /cible trouvée 0 fois dans src\/cible\.ts\n/,
    "cible créée par une édition antérieure",
  );
  // La première édition DUPLIQUE la cible de la seconde : unique dans l'original.
  refuse(
    lancer(jouet([{
      test: NOM,
      edits: [
        { file: "src/cible.ts", find: "{ return 1; }", replace: "{ return 2; /* number */ }" },
        { file: "src/cible.ts", find: "number", replace: "unknown" },
      ],
    }])),
    /cible trouvée 2 fois dans src\/cible\.ts au moment de l'appliquer/,
    "cible dupliquée par une édition antérieure",
  );
});

test("éditions qui s'annulent : la mutation nulle est refusée", () => {
  const ligne = "function valeur(): number { return 1; }";
  refuse(
    lancer(jouet([{
      test: NOM,
      edits: [
        { file: "src/cible.ts", find: "export ", replace: "" },
        { file: "src/cible.ts", find: ligne, replace: `export ${ligne}` },
      ],
    }])),
    /la mutation ne change pas src\/cible\.ts/,
    "mutation nulle",
  );
});

test("une épreuve qui écrit dans le dépôt source est refusée", () => {
  refuse(
    lancer(jouet((root) => [{
      test: NOM,
      edits: [{
        file: "src/cible.ts",
        find: "return 1;",
        replace:
          `process.getBuiltinModule("node:fs").appendFileSync(${JSON.stringify(join(root, "src", "autre.ts"))}, "// sali\\n"); ` +
          "return 2;",
      }],
    }])),
    /dépôt source modifié pendant l'épreuve : src\/autre\.ts/,
    "dépôt source sali hors de la cible mutée",
  );
});

/*
 * Les facettes de la garde « dépôt entier », une par cas. Le cas précédent n'atteint que
 * la modification du contenu d'un fichier suivi : sans ceux-ci, une empreinte qui
 * ignorerait le mode, les fichiers non suivis ou les liens passerait l'autotest.
 */
function salir(root: string, action: string): Mutant[] {
  return [{
    test: NOM,
    edits: [{
      file: "src/cible.ts",
      find: "return 1;",
      replace: `{ const fs = process.getBuiltinModule("node:fs"); const r = ${JSON.stringify(root)}; ${action} } return 2;`,
    }],
  }];
}

test("dépôt source : un changement de mode seul est refusé", () => {
  refuse(
    lancer(jouet((root) => salir(root, `fs.chmodSync(r + "/src/autre.ts", 0o755);`))),
    /dépôt source modifié pendant l'épreuve : src\/autre\.ts/,
    "mode",
  );
});

test("dépôt source : la création d'un fichier non suivi est refusée", () => {
  refuse(
    lancer(jouet((root) => salir(root, `fs.writeFileSync(r + "/src/nouveau.ts", "// cree\\n");`))),
    /dépôt source modifié pendant l'épreuve : src\/nouveau\.ts/,
    "création",
  );
});

test("dépôt source : la suppression d'un fichier suivi est refusée", () => {
  refuse(
    lancer(jouet((root) => salir(root, `fs.rmSync(r + "/src/double.ts");`))),
    /dépôt source modifié pendant l'épreuve : src\/double\.ts/,
    "suppression",
  );
});

test("dépôt source : un fichier remplacé par un lien vers un contenu identique est refusé", () => {
  // La cible du lien est hors du dépôt : seule la substitution par un lien change.
  const ailleurs = realpathSync(mkdtempSync(join(tmpdir(), "l0-lien-")));
  jetables.push(ailleurs);
  const copie = join(ailleurs, "autre.ts");
  writeFileSync(copie, "export function autre(): number { return 1; }\n");
  refuse(
    lancer(jouet((root) => salir(
      root,
      `fs.rmSync(r + "/src/autre.ts"); fs.symlinkSync(${JSON.stringify(copie)}, r + "/src/autre.ts");`,
    ))),
    /dépôt source modifié pendant l'épreuve : src\/autre\.ts/,
    "lien",
  );
});

test("un fichier de mutants qui n'est pas une liste est refusé sous ce nom", () => {
  const root = jouet([{ test: NOM, ...casser }]);
  writeFileSync(join(root, "tests", "l0-mutants.json"), "{}\n");
  refuse(lancer(root), /tests\/l0-mutants\.json n'est pas une liste/, "racine non-liste");
});

test("dépôt source : la suppression d'un fichier non suivi est refusée", () => {
  // Non suivi, il disparaît de l'inventaire après l'épreuve : seule la comparaison des
  // deux inventaires, et non la marque « absent », peut le voir.
  const root = jouet((r) => salir(r, `fs.rmSync(r + "/src/brouillon.ts");`));
  writeFileSync(join(root, "src", "brouillon.ts"), "// non suivi\n");
  refuse(lancer(root), /dépôt source modifié pendant l'épreuve : src\/brouillon\.ts/, "suppression non suivie");
});
