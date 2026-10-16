/**
 * l0-instruments.test.ts — phase 3, P2 : les instruments versionnés restent ceux qui ont été versés
 * (PLAN-PHASE3 v2, § 5.2 ; amendement A1 ; adjudication 9ec0aae9, D-P3-2 et R3).
 *
 * `instruments/` porte des copies exactes : la porte S4 et l'instrument externe de la qualification
 * Mac r4. Rien ici ne les exécute. Ce fichier contrôle leur intégrité contre
 * `instruments/MANIFESTE-INSTRUMENTS.sha256` et `instruments/MODES-ATTENDUS.tsv` :
 *
 *   - ensemble exact (seul le manifeste lui-même est exclu de sa couverture) ;
 *   - chemins canoniques ;
 *   - ni lien ni nœud spécial ;
 *   - empreintes ;
 *   - modes (classe exécutable 755 ou non 644, comme git) ;
 *   - compte examiné rapporté, compte nul refusé.
 *
 * Une propriété distincte, une preuve, un mutant : chaque preuve vérifie d'abord le répertoire du
 * dépôt, puis une copie altérée de la façon qu'elle vise, qui doit être refusée pour cette raison.
 * Ni ce contrôle ni ce versement ne requalifient les contrats de pi, ni ne lèvent O2-1.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}

const INSTRUMENTS = join(import.meta.dirname, "..", "instruments");
const MANIFESTE = "MANIFESTE-INSTRUMENTS.sha256";
const MODES = "MODES-ATTENDUS.tsv";
const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const octets = (a: string, b: string) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0);
const canonique = (p: string) =>
  p.length > 0 && !p.startsWith("/") && !p.endsWith("/") && !p.includes("//") && !/\s/.test(p)
  && !p.split("/").some((x) => x === "." || x === "..");

/** Le contrôle d'intégrité d'un répertoire d'instruments : anomalies et nombre de fichiers examinés. */
function verifier(dir: string): { anomalies: string[]; examines: number } {
  const anomalies: string[] = [];
  if (!existsSync(join(dir, MANIFESTE))) return { anomalies: [`manifeste absent : ${dir}`], examines: 0 };

  // Le réel : chaque entrée, sans suivre de lien.
  const reels: string[] = [];
  const parcourir = (rel: string) => {
    for (const nom of readdirSync(join(dir, rel)).sort(octets)) {
      const r = rel ? `${rel}/${nom}` : nom;
      const st = lstatSync(join(dir, r));
      if (st.isSymbolicLink()) anomalies.push(`lien : ${r}`);
      else if (st.isDirectory()) parcourir(r);
      else if (st.isFile()) reels.push(r);
      else anomalies.push(`nœud spécial : ${r}`);
    }
  };
  parcourir("");

  // Le manifeste : lignes lisibles, triées, uniques, chemins canoniques.
  const lignes = readFileSync(join(dir, MANIFESTE), "utf-8").split("\n").filter((l) => l !== "");
  const declares = new Map<string, string>();
  for (const l of lignes) {
    const m = /^([0-9a-f]{64})  (.+)$/.exec(l);
    if (!m) { anomalies.push(`ligne de manifeste illisible : ${l}`); continue; }
    if (!canonique(m[2])) anomalies.push(`chemin non canonique : ${m[2]}`);
    if (m[2] === MANIFESTE) anomalies.push("le manifeste se couvre lui-même");
    if (declares.has(m[2])) anomalies.push(`doublon : ${m[2]}`);
    declares.set(m[2], m[1]);
  }
  const ordre = [...declares.keys()];
  if (JSON.stringify(ordre) !== JSON.stringify([...ordre].sort(octets))) anomalies.push("manifeste non trié en LC_ALL=C");

  // Ensemble exact : seul le manifeste est hors de sa couverture.
  const couverts = reels.filter((r) => r !== MANIFESTE);
  for (const r of couverts) if (!declares.has(r)) anomalies.push(`en trop : ${r}`);
  for (const d of declares.keys()) if (!couverts.includes(d)) anomalies.push(`manquant : ${d}`);

  // Empreintes.
  for (const [d, h] of declares) {
    if (couverts.includes(d) && sha256(readFileSync(join(dir, d))) !== h) anomalies.push(`empreinte : ${d}`);
  }

  // Modes : chaque fichier réel, manifeste compris.
  const modes = new Map<string, string>();
  if (existsSync(join(dir, MODES))) {
    for (const l of readFileSync(join(dir, MODES), "utf-8").split("\n").filter((x) => x !== "")) {
      const m = /^([0-7]{3})\t(.+)$/.exec(l);
      if (m) modes.set(m[2], m[1]); else anomalies.push(`ligne de modes illisible : ${l}`);
    }
  } else anomalies.push("modes attendus absents");
  // La classe de mode, comme git la garde (exécutable 755 ou non 644), et non les bits exacts que
  // l'umask de l'extraction décide : sous umask 002, un 644 de git est un 664 sur disque.
  for (const r of reels) {
    const attendu = modes.get(r);
    const reel = statSync(join(dir, r)).mode & 0o100 ? "755" : "644";
    if (attendu === undefined) anomalies.push(`mode non déclaré : ${r}`);
    else if (attendu !== reel) anomalies.push(`mode : ${r} ${reel} au lieu de ${attendu}`);
  }

  if (couverts.length === 0) anomalies.push("aucun fichier examiné");
  return { anomalies, examines: couverts.length };
}

/** Une copie du répertoire du dépôt, modes compris, à altérer. */
function copie(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "pi-l0-p3i-")));
  jetables.push(d);
  cpSync(INSTRUMENTS, join(d, "i"), { recursive: true });
  const reporter = (rel: string) => {
    for (const nom of readdirSync(join(INSTRUMENTS, rel))) {
      const r = rel ? `${rel}/${nom}` : nom;
      const st = lstatSync(join(INSTRUMENTS, r));
      if (st.isDirectory()) reporter(r); else chmodSync(join(d, "i", r), st.mode & 0o777);
    }
  };
  reporter("");
  return join(d, "i");
}

/** Le répertoire du dépôt est conforme, et la copie altérée est refusée pour la raison visée. */
function epreuve(t: TestContext, alterer: (dir: string) => void, raison: RegExp, quoi: string): void {
  const depot = verifier(INSTRUMENTS);
  propriete(depot.anomalies.length === 0 && depot.examines > 0, `instruments/ du dépôt conforme (${depot.examines} fichiers) : ${JSON.stringify(depot.anomalies.slice(0, 5))}`);
  t.diagnostic(`instruments/ : ${depot.examines} fichiers examinés`);
  const d = copie();
  propriete(verifier(d).anomalies.length === 0, "la copie intacte est conforme");
  alterer(d);
  const a = verifier(d).anomalies;
  propriete(a.some((x) => raison.test(x)), `${quoi} : refusé pour sa raison (${JSON.stringify(a)})`);
}

regressionCorrigee("P3-I1", "un instrument altéré d'un octet est refusé", (t) => {
  epreuve(t, (d) => {
    const f = join(d, "s4", "mesurer-s4.sh");
    const b = readFileSync(f);
    b[b.length - 2] ^= 1;
    writeFileSync(f, b);
  }, /^empreinte : s4\/mesurer-s4\.sh$/, "altération");
});

regressionCorrigee("P3-I2", "un fichier ajouté à instruments/ est refusé", (t) => {
  epreuve(t, (d) => {
    writeFileSync(join(d, "s4", "ajout.sh"), "echo\n");
    chmodSync(join(d, "s4", "ajout.sh"), 0o644);
  }, /^en trop : s4\/ajout\.sh$/, "ajout");
});

regressionCorrigee("P3-I3", "un fichier retiré d'instruments/ est refusé", (t) => {
  epreuve(t, (d) => rmSync(join(d, "qualif-mac-r4", "tests", "pi-contrats", "modes.ts")), /^manquant : qualif-mac-r4\/tests\/pi-contrats\/modes\.ts$/, "retrait");
});

regressionCorrigee("P3-I4", "un mode changé est refusé", (t) => {
  epreuve(t, (d) => chmodSync(join(d, "s4", "mesurer-s4.sh"), 0o644), /^mode : s4\/mesurer-s4\.sh 644 au lieu de 755$/, "mode");
});

regressionCorrigee("P3-I5", "un lien à la place d'un instrument est refusé, même vers un contenu identique", (t) => {
  epreuve(t, (d) => {
    const f = join(d, "s4", "outillage.lock");
    const ailleurs = join(d, "..", "outillage.lock");
    writeFileSync(ailleurs, readFileSync(f));
    rmSync(f);
    symlinkSync(ailleurs, f);
  }, /^lien : s4\/outillage\.lock$/, "lien");
});

regressionCorrigee("P3-I6", "un répertoire d'instruments sans aucun fichier examiné est refusé", (t) => {
  epreuve(t, (d) => {
    for (const nom of readdirSync(d)) if (nom !== MANIFESTE) rmSync(join(d, nom), { recursive: true });
    writeFileSync(join(d, MANIFESTE), "");
    mkdirSync(join(d, "vide"));
  }, /^aucun fichier examiné$/, "compte nul");
});
