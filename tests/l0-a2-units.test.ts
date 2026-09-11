/**
 * l0-a2-units.test.ts — L0, vague A2 : les preuves qui n'ont pas besoin d'`execute()`.
 *
 * Trois espèces ; les deux premières sont celles de A1.
 *
 *   régression     rouge sur l'objet sur une assertion PROPRIÉTÉ, sous todo, sans mutant
 *   couverture     verte ici, rouge sur son mutant
 *   preservation   verte ici, et elle doit le rester après la correction voisine. Elle
 *                  n'a pas de mutant tant que le code qui pourrait l'emporter n'existe
 *                  pas ; le lot qui l'écrit lui en donne un (Sol, D2).
 *
 * Rien de pi n'est chargé ici : `role-rules`, `tree`, `worktree`, `run-manifest` et
 * `spawn-args` s'importent seuls. Ce fichier tourne donc sans le chargeur de
 * substitution, contrairement au harnais.
 *
 * Contrats : C0-CONTRATS.md v1.2, adjudication de Sol du 2026-09-11.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decideRoleGuard } from "../subagent-only/role-rules.ts";
import { acquireRunOwnership, openRun, startHeartbeat } from "../subagent-only/run-manifest.ts";
import { treeState } from "../subagent-only/tree.ts";
import { ensureLane, laneChanges } from "../subagent-only/worktree.ts";

// ------------------------------------------------------------------ espèces

type Preuve = (t: TestContext) => Promise<void> | void;

function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function couverture(id: string, titre: string, fn: Preuve): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}
void regressionCorrigee; // employée par les lots de correction, pas encore ici

// ------------------------------------------------------------------ outillage

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}
function depot(prefixe: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefixe)));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.py"), "a = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return root;
}
type Issue = { kind: "returned"; value: unknown } | { kind: "threw"; error: string };
/**
 * Ce qu'une fonction a fait, valeur rendue ou erreur jetée, sous une forme comparable.
 *
 * Les preuves d'observation disent « ces deux situations ne doivent pas se ressembler »
 * sans imposer la forme de la distinction : lever, rendre un état, rendre un drapeau
 * conviennent également. Comparer des issues plutôt que des valeurs laisse ce choix
 * au correctif — et empêche une preuve de rougir parce que la correction a choisi de
 * lever là où elle rendait. La précondition n'exige donc pas une valeur précise, mais
 * seulement que l'observation valide en soit une.
 */
function issue(fn: () => unknown): Issue {
  try {
    // La valeur telle quelle : un aller-retour JSON ferait d'un retour valide —
    // `undefined`, un BigInt — un faux `threw`, et l'issue comparée ne serait plus
    // celle que la fonction a rendue.
    return { kind: "returned", value: fn() };
  } catch (e) {
    return { kind: "threw", error: (e as Error).constructor.name };
  }
}
const memeIssue = (a: Issue, b: Issue): boolean => {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
};
const montrer = (i: Issue): string =>
  JSON.stringify(i, (_, v) => (v instanceof Map ? { Map: [...v] } : v));
const jetable: string[] = [];
const neuf = (prefixe: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixe)));
  jetable.push(d);
  return d;
};
const suivre = (d: string): string => (jetable.push(d), d);
test.after(() => { for (const d of jetable) rmSync(d, { recursive: true, force: true }); });

// ============================================================ C-P1-F08 · F5 — T1

regression("C-P1-F08", "treeState distingue un arbre vide d'une observation impossible", () => {
  const propre = suivre(depot("l0-f08-"));
  const sansGit = neuf("l0-f08-nongit-");
  const observable = issue(() => treeState(propre));
  const impossible = issue(() => treeState(sansGit));
  precondition(observable.kind === "returned", `un dépôt propre doit s'observer, vu : ${montrer(observable)}`);
  propriete(
    !memeIssue(observable, impossible),
    `git en échec doit se distinguer d'un arbre observable ; les deux rendent ${montrer(impossible)}`,
  );
});

regression("F5", "laneChanges distingue une lane sans changement d'une observation impossible", () => {
  const root = suivre(depot("l0-f5-"));
  ensureLane(root, "R-W03");
  ensureLane(root, "R-W09");
  const sansChangement = issue(() => laneChanges(root, "R-W03"));
  precondition(sansChangement.kind === "returned", `une lane saine doit s'observer, vu : ${montrer(sansChangement)}`);
  // Le worktree existe toujours ; c'est git qui ne peut plus répondre.
  writeFileSync(join(root, ".git", "pi-lanes", "R-W09", ".git"), "gitdir: /inexistant\n");
  const impossible = issue(() => laneChanges(root, "R-W09"));
  propriete(
    !memeIssue(sansChangement, impossible),
    `git en échec doit se distinguer d'une lane observable ; les deux rendent ${montrer(impossible)}`,
  );
});

// ============================================================ C-P1-F07 — chemins réels

regression("C-P1-F07", "laneChanges rend les chemins réels, accents et espaces compris", () => {
  const root = suivre(depot("l0-f07-"));
  const { cwd } = ensureLane(root, "R-W03");
  writeFileSync(join(cwd, "src", "ascii.py"), "c = 1\n");
  writeFileSync(join(cwd, "src", "été.py"), "e = 1\n");
  writeFileSync(join(cwd, "src", "with space.py"), "s = 1\n");
  // Un saut de ligne dans le nom : c'est lui qui exige des records NUL. Le quoting
  // se répare aussi avec `core.quotePath=false` ; le découpage par lignes, non.
  const saut = "src/deux\nlignes.py";
  writeFileSync(join(cwd, saut), "n = 1\n");
  const vus = laneChanges(root, "R-W03");
  precondition(vus.includes("src/ascii.py"), `le témoin ASCII doit être vu tel quel, vus : ${JSON.stringify(vus)}`);
  propriete(
    vus.includes("src/été.py") && vus.includes("src/with space.py") && vus.includes(saut),
    `les chemins doivent être lus en records NUL, pas sous leur forme citée ni découpés par ` +
      `lignes ; vus : ${JSON.stringify(vus)}`,
  );
});

// ============================================================ F9 — base d'une lane reprise

regression("F9", "ensureLane sur une branche connue rend la base de la branche, pas HEAD de la racine", () => {
  const root = suivre(depot("l0-f9-"));
  const premiere = ensureLane(root, "R-W03");
  const teteBranche = git(root, "rev-parse", "pi-lane/R-W03").trim();
  precondition(premiere.base === teteBranche, "la première ouverture doit partir de la tête de sa branche");
  // La racine avance, puis le worktree disparaît — la branche, elle, survit par contrat.
  writeFileSync(join(root, "src", "b.py"), "b = 1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "la racine avance");
  git(root, "worktree", "remove", "--force", join(root, ".git", "pi-lanes", "R-W03"));
  const reprise = ensureLane(root, "R-W03");
  const base = reprise.base ?? "(aucune base rendue)";
  precondition(
    git(root, "rev-parse", "pi-lane/R-W03").trim() === teteBranche,
    "la branche de lane ne doit pas avoir bougé",
  );
  propriete(
    base === teteBranche && reprise.created === false,
    `base rendue ${base.slice(0, 7)}, attendue ${teteBranche.slice(0, 7)} ; ` +
      `created rendu ${reprise.created}, attendu false — un OPENED écrit ici porterait une ` +
      "base que la branche n'a jamais eue, et `created` est ce qui commande de l'écrire",
  );
});

// ============================================================ A-P1-F04 · A-P1-F05 — gardes immédiates

const WORKER = { root: "", readOnly: false, role: "worker" };

function bundle(prefixe: string): string {
  const root = neuf(prefixe);
  for (const f of ["INSTRUCTIONS.md", "ARCHITECTURE.md", "DESIGN.md", "CONVENTIONS.md"]) {
    writeFileSync(join(root, f), `# ${f}\n`);
  }
  return root;
}

regression("A-P1-F04", "un fichier du bundle est protégé de bash comme il l'est de write", () => {
  const root = bundle("l0-f04-");
  const ctx = { ...WORKER, root };
  precondition(decideRoleGuard("write", { path: "DESIGN.md" }, ctx) !== null, "write sur DESIGN.md doit être bloqué");
  const ecrivains = [
    "echo bidon > DESIGN.md",
    "echo bidon >> DESIGN.md",
    "sed -i '' 's/a/b/' DESIGN.md",
    "cp /dev/null DESIGN.md",
    `cat /etc/hostname > ${join(root, "ARCHITECTURE.md")}`,
  ];
  const passes = ecrivains.filter((c) => decideRoleGuard("bash", { command: c }, ctx) === null);
  propriete(
    passes.length === 0,
    `ces commandes écrivent un fichier gelé et ne sont pas bloquées : ${JSON.stringify(passes)}`,
  );
});

regression("A-P1-F05", "la destination réelle décide, pas sa forme lexicale", () => {
  const root = bundle("l0-f05-");
  const ctx = { ...WORKER, root };
  symlinkSync(".", join(root, "alias-root"));
  precondition(
    existsSync(join(root, "alias-root", "DESIGN.md")),
    "le lien doit rendre le fichier gelé atteignable par un second chemin",
  );
  propriete(
    decideRoleGuard("write", { path: "alias-root/DESIGN.md" }, ctx) !== null,
    "écrire le fichier gelé à travers un lien doit être bloqué comme le chemin direct",
  );
});

preservation("A-P1-F04", "lire, et nommer un fichier du bundle sans l'écrire, reste permis", () => {
  const root = bundle("l0-pres-04-");
  const ctx = { ...WORKER, root };
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "DESIGN.md"), "# homonyme\n");
  const permis: Array<[string, string | null]> = [
    ["grep -rn DESIGN.md .", decideRoleGuard("bash", { command: "grep -rn DESIGN.md ." }, ctx)],
    ["echo DESIGN.md", decideRoleGuard("bash", { command: "echo DESIGN.md" }, ctx)],
    ["cat DESIGN.md", decideRoleGuard("bash", { command: "cat DESIGN.md" }, ctx)],
    ["grep x DESIGN.md > /dev/null", decideRoleGuard("bash", { command: "grep x DESIGN.md > /dev/null" }, ctx)],
    ["write docs/DESIGN.md", decideRoleGuard("write", { path: "docs/DESIGN.md" }, ctx)],
  ];
  const bloques = permis.filter(([, r]) => r !== null).map(([c]) => c);
  propriete(
    bloques.length === 0,
    "une garde qui bloque une lecture, un nom cité ou un homonyme de sous-répertoire est " +
      `trop large : ${JSON.stringify(bloques)}`,
  );
});

preservation("A-P1-F04", "hors bundle, aucune de ces commandes n'est bloquée", () => {
  const libre = { ...WORKER, root: null };
  const commandes = ["echo bidon > DESIGN.md", "sed -i '' 's/a/b/' DESIGN.md", "cp /dev/null DESIGN.md"];
  const bloques = commandes.filter((c) => decideRoleGuard("bash", { command: c }, libre) !== null);
  propriete(
    bloques.length === 0,
    `sans bundle l'ensemble des fichiers gelés est vide, et rien n'est à bloquer : ${JSON.stringify(bloques)}`,
  );
});
// ============================================================ C-P1-F09 — panne de battement

regression("C-P1-F09", "une panne d'écriture du battement signale la perte au lieu de tuer le processus", (t) => {
  const root = neuf("l0-f09-");
  const dir = join(root, ".pi-subagent-runs");
  const { manifest } = openRun(dir, undefined);
  const pris = acquireRunOwnership(dir, manifest.runId, "session-l0");
  precondition(pris.ok, "le bail doit être acquis");
  if (!pris.ok) return;

  // Le fichier de battement devient un répertoire : la prochaine écriture rend EISDIR.
  // Panne de maintien du bail, pas libération — le répertoire du bail reste en place.
  const hb = join(dir, `${manifest.runId}.lease`, `hb-${pris.lease.leaseId}`);
  precondition(existsSync(hb), "le battement initial doit exister");
  unlinkSync(hb);
  mkdirSync(hb);

  const ownerAvant = readFileSync(join(dir, `${manifest.runId}.lease`, "owner.json"), "utf-8");
  const perdus: string[] = [];
  t.mock.timers.enable({ apis: ["setInterval"] });
  const battement = startHeartbeat(dir, pris.lease, (runId) => perdus.push(runId), 10);
  let jete: string | undefined;
  try {
    t.mock.timers.tick(35);
  } catch (e) {
    jete = `${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
  battement.stop();

  const bailIntact =
    existsSync(join(dir, `${manifest.runId}.lease`)) &&
    readFileSync(join(dir, `${manifest.runId}.lease`, "owner.json"), "utf-8") === ownerAvant;
  propriete(
    jete === undefined && perdus.length === 1 && bailIntact,
    "une panne de maintien doit signaler la perte une fois, sans propager d'erreur hors du " +
      `timer — sans gestionnaire, node meurt — et sans toucher au bail ; jeté : ${jete}, ` +
      `signalé ${perdus.length} fois, bail intact : ${bailIntact}`,
  );
});
