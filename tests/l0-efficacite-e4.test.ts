/**
 * l0-efficacite-e4.test.ts — LOT-EFFICACITÉ, E4 : une sonde git qui échoue normalement n'écrit
 * rien sur la sortie d'erreur du processus (PLAN-LOT-EFFICACITE-LEVIERS v2 complétée, § 5).
 *
 * Le constat (D6, cause établie) : après `cleanup --apply`, `observeLanes` appelle `isMerged`, qui
 * lance `git rev-parse --verify pi-lane/<lane>` sur une branche retirée. L'échec est attendu et
 * rattrapé (`false`), mais `execFileSync` sans `stdio` recopiait la sortie d'erreur de git sur
 * celle du processus : deux `fatal: Needed a single revision` par fin de run.
 *
 * La preuve tourne dans un processus Node enfant : la sortie d'erreur observée est celle du
 * processus qui appelle la production, pas une capture interne au test.
 *
 *   E4-stderr   branche de lane absente : `isMerged` rend `false`, sortie d'erreur vide ;
 *               branche présente et intégrée : la réponse reste juste
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });

function depot(): { root: string; base: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-e4-")));
  jetables.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return { root, base: git(root, "rev-parse", "HEAD").trim() };
}

/** `isMerged(root, lane, base)` dans un processus Node enfant : sa réponse, et sa sortie d'erreur. */
function isMergedEnfant(root: string, lane: string, base: string): { reponse: string; stderr: string; code: number | null } {
  const module = pathToFileURL(join(import.meta.dirname, "..", "subagent-only", "worktree.ts")).href;
  const [majeur] = process.versions.node.split(".").map(Number);
  const script =
    `import { isMerged } from ${JSON.stringify(module)};\n` +
    `process.stdout.write(String(isMerged(${JSON.stringify(root)}, ${JSON.stringify(lane)}, ${JSON.stringify(base)})));\n`;
  const p = spawnSync(process.execPath, [
    ...(majeur < 23 ? ["--experimental-strip-types"] : []),
    "--no-warnings", "--input-type=module", "-e", script,
  ], { encoding: "utf-8" });
  return { reponse: p.stdout, stderr: p.stderr, code: p.status };
}

regressionCorrigee("E4-stderr", "une sonde git qui échoue normalement n'écrit rien sur la sortie d'erreur du processus", () => {
  const { root, base } = depot();
  const absente = isMergedEnfant(root, "run-W01-g1", base);
  propriete(absente.code === 0 && absente.reponse === "false", `branche de lane absente : false (${JSON.stringify(absente)})`);
  propriete(absente.stderr === "", `branche de lane absente : sortie d'erreur vide (reçu ${JSON.stringify(absente.stderr)})`);

  // Réponse juste quand la branche existe et qu'elle est intégrée : seul le canal d'erreur a changé.
  git(root, "checkout", "-q", "-b", "pi-lane/run-W02-g1");
  writeFileSync(join(root, "b.txt"), "b\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "lane");
  git(root, "checkout", "-q", "-");
  git(root, "merge", "-q", "--ff-only", "pi-lane/run-W02-g1");
  const integree = isMergedEnfant(root, "run-W02-g1", base);
  propriete(integree.code === 0 && integree.reponse === "true" && integree.stderr === "",
    `branche intégrée : true, sans sortie d'erreur (${JSON.stringify(integree)})`);
});
