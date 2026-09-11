/**
 * l0-lib.ts — ce que tests/tools/l0-check et tests/tools/l0-mutants lisent de la
 * même façon.
 *
 * Pas un test : le nom ne finit pas par `.test.ts`, la suite ne le lance pas.
 *
 * Un instrument échoue en affichant un résultat crédible. Les défenses ici :
 * le TAP est demandé explicitement (le rapporteur par défaut change de forme
 * entre node 22 et 26) ; l'ensemble des preuves déclarées dans les sources doit
 * ÉGALER l'ensemble des preuves L0 rapportées par le TAP, dans les deux sens ;
 * et toute ligne qui commence par une fonction de déclaration sans se laisser
 * lire est une anomalie.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const MARQUE = "PROPRIÉTÉ";

export interface Declaration {
  espece: "REG" | "COUV" | "PRES";
  /** Pour une régression : `regressionCorrigee(` plutôt que `regression(`. */
  corrigee: boolean;
  id: string;
  titre: string;
  nom: string;
  fichier: string;
}

export interface Resultat {
  ok: boolean;
  directive?: "TODO" | "SKIP";
  bloc: string;
}

const DECLARANTS = /^(regression|regressionCorrigee|couverture|preservation)\(/;

export function fichiersL0(root: string): string[] {
  return readdirSync(join(root, "tests"))
    .filter((f) => /^l0-.*\.test\.ts$/.test(f))
    .sort()
    .map((f) => join("tests", f));
}

/** Les déclarations, et tout ce qui empêche de s'y fier : illisibles, doublons, absence. */
export function declarations(root: string): { liste: Declaration[]; anomalies: string[] } {
  const liste: Declaration[] = [];
  const anomalies: string[] = [];
  for (const fichier of fichiersL0(root)) {
    readFileSync(join(root, fichier), "utf-8").split("\n").forEach((brute, i) => {
      const ligne = brute.trim();
      if (!DECLARANTS.test(ligne)) return;
      // Ni guillemet échappé ni barre oblique inverse, et une virgule après le titre :
      // le nom doit se lire tel qu'il s'affichera.
      const m = /^(regression|regressionCorrigee|couverture|preservation)\("([^"\\]+)", "([^"\\]+)", /.exec(ligne);
      if (!m) {
        anomalies.push(`déclaration illisible : ${fichier}:${i + 1}`);
        return;
      }
      const espece = m[1] === "couverture" ? "COUV" : m[1] === "preservation" ? "PRES" : "REG";
      liste.push({
        espece, corrigee: m[1] === "regressionCorrigee", id: m[2], titre: m[3],
        nom: `L0 ${espece} ${m[2]} — ${m[3]}`, fichier,
      });
    });
  }
  if (liste.length === 0) anomalies.push("aucune déclaration L0 trouvée dans tests/l0-*.test.ts");
  const vus = new Set<string>();
  for (const d of liste) {
    if (vus.has(d.nom)) anomalies.push(`nom en double : ${d.nom}`);
    vus.add(d.nom);
  }
  return { liste, anomalies };
}

export function lancer(root: string, fichiers: string[], extra: string[] = []): { code: number | null; tap: string } {
  const [majeur, mineur] = process.versions.node.split(".").map(Number);
  if (majeur < 22 || (majeur === 22 && mineur < 6)) throw new Error(`node ${process.version} trop ancien`);
  const harnais = fichiers.every((f) => f.endsWith("-harness.test.ts"));
  if (!harnais && fichiers.some((f) => f.endsWith("-harness.test.ts"))) {
    throw new Error("un lancement mélange harnais et tests simples : le chargeur ne s'applique pas aux deux");
  }
  const args = [
    ...(majeur < 23 ? ["--experimental-strip-types"] : []),
    ...(harnais ? ["--import", "./tests/stubs/loader.mjs"] : []),
    "--test",
    "--test-reporter=tap",
    ...extra,
    ...fichiers,
  ];
  const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  return { code: p.status, tap: p.stdout };
}

/** Les lignes de premier niveau `ok N - L0 …`, avec leur bloc YAML. */
export function lireTap(tap: string): Map<string, Resultat[]> {
  const resultats = new Map<string, Resultat[]>();
  const lignes = tap.split("\n");
  for (let i = 0; i < lignes.length; i++) {
    const m = /^(not ok|ok) \d+ - (L0 (?:REG|COUV|PRES) .+?)(?: # (TODO|SKIP)\b.*)?$/.exec(lignes[i]);
    if (!m) continue;
    const bloc: string[] = [];
    if (lignes[i + 1]?.trim() === "---") {
      for (let j = i + 2; j < lignes.length && lignes[j].trim() !== "..."; j++) bloc.push(lignes[j]);
    }
    const r: Resultat = { ok: m[1] === "ok", directive: m[3] as Resultat["directive"], bloc: bloc.join("\n") };
    resultats.set(m[2], [...(resultats.get(m[2]) ?? []), r]);
  }
  return resultats;
}

export const echapper = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Les fichiers L0 pas encore commités, seuls fichiers non suivis admis dans une copie. */
const L0_NON_SUIVI = /^tests\/(l0-[^/]+|tools\/l0-[^/]+)$/;   // préfixes réservés à L0 (Sol, CP2)

/**
 * Une copie jetable : les fichiers suivis, plus les fichiers L0 non suivis.
 *
 * Pas les autres fichiers non suivis du dépôt, qui n'ont rien à faire dans une
 * preuve. Les liens symboliques restent des liens, et les modes sont reportés :
 * un script qui perd son bit d'exécution échouerait pour une raison sans rapport.
 *
 * Le lanceur git est ici, sous tests/, avec les instruments qui l'appellent :
 * rien de l'outillage L0 ne vit dans bin/, la surface de reconstruction où
 * tests/git-probe-counter.test.ts exige que tout lanceur soit compté.
 */
export function copieJetable(root: string): string {
  const ls = (...args: string[]) => {
    // git-launch: outside-recovery
    const p = spawnSync("git", ["ls-files", "-z", ...args], { cwd: root, encoding: "utf-8" });
    if (p.status !== 0) throw new Error(`git ls-files ${args.join(" ")} a échoué : ${p.stderr}`);
    return p.stdout.split("\0").filter(Boolean);
  };
  const fichiers = [...ls("--cached"), ...ls("--others", "--exclude-standard").filter((f) => L0_NON_SUIVI.test(f))];
  const copie = mkdtempSync(join(tmpdir(), "pi-l0-copie-"));
  let n = 0;
  for (const rel of new Set(fichiers)) {
    const src = join(root, rel);
    const dst = join(copie, rel);
    let st;
    try { st = lstatSync(src); } catch { continue; } // suivi mais supprimé de l'arbre de travail
    mkdirSync(dirname(dst), { recursive: true });
    if (st.isSymbolicLink()) symlinkSync(readlinkSync(src), dst);
    else { copyFileSync(src, dst); chmodSync(dst, st.mode & 0o7777); }
    n++;
  }
  if (n === 0) throw new Error("copie jetable vide : git ls-files n'a rien rendu");
  return copie;
}
