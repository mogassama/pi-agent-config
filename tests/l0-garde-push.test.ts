/**
 * l0-garde-push.test.ts — phase 3, P3 : le push de ce dépôt de configuration est gardé en machine
 * (PLAN-PHASE3 v3, § 5.3 ; amendement A1 ; adjudications 9ec0aae9, D-P3-3 et R2, et 4c73ccb7, § 2 et § 5).
 *
 * Une adjudication « commit oui, push non » ne vivait que dans un message, et c'est ce qui a permis
 * l'écart PUSH-B. `git-hooks/pre-push` exige désormais une autorisation exacte, liée au dépôt, au
 * distant, à la destination de push, à l'objet, à la ref et à la tête distante attendue, et la
 * consomme exclusivement avant d'accepter.
 *
 * Chaque monde est jetable : un distant nu, un clone dont les crochets sont ceux de ce dépôt (le
 * vrai répertoire `git-hooks/`, pas une copie), un HOME à lui. **Chaque refus est vérifié sur
 * l'état du distant, pas seulement sur le code ou le message du crochet.** Le témoin nominal est
 * un vrai push vers le distant nu.
 *
 * La consommation n'est pas crue sur parole : les épreuves substituent `mkdir` et `mv` dans le PATH
 * du monde (jamais dans le crochet) pour montrer qu'une destination préexistante, un déplacement
 * non effectué, une copie, un nom recréé ou un contenu altéré font refuser. La concurrence compte
 * les acceptations du crochet et les consommations, pas les seuls pushes réussis.
 *
 * K-P19 et K-P20 chargent le vrai `bash-guard` dans un processus enfant, avec un substitut de l'API
 * de pi écrit par ce fichier dans un temporaire.
 *
 * Sur l'arbre d'avant P3, il n'y a ni `pre-push` ni ces refus de `bash-guard` : les pushes passent,
 * les commandes passent, et les refus attendus échouent sur leur PROPRIÉTÉ.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
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

const HOOKS = join(import.meta.dirname, "..", "git-hooks");
const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

function tmp(prefixe: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixe)));
  jetables.push(d);
  return d;
}

interface Monde { racine: string; nu: string; clone: string; home: string; env: NodeJS.ProcessEnv }

function sansRole(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const e = { ...env };
  delete e.PI_SUBAGENT_ROLE;
  for (const k of Object.keys(e)) if (k.startsWith("GIT_")) delete e[k];
  return e;
}

function g(m: Monde, args: string[], env: NodeJS.ProcessEnv = m.env, cwd = m.clone) {
  return spawnSync("git", args, { cwd, env, encoding: "utf-8" });
}
function gok(m: Monde, args: string[], cwd = m.clone): string {
  const p = g(m, args, m.env, cwd);
  assert.equal(p.status, 0, `PRÉCONDITION — git ${args.join(" ")} : ${p.stderr}`);
  return p.stdout.trim();
}

/** Distant nu avec `main` et `dev`, clone aux crochets du dépôt, un commit local d'avance sur main. */
function monde(): Monde {
  const racine = tmp("pi-l0-p3p-");
  const home = join(racine, "home");
  mkdirSync(join(home, ".pi"), { recursive: true });
  const nu = join(racine, "distant.git");
  const clone = join(racine, "clone");
  const env = { ...sansRole(process.env), HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const m: Monde = { racine, nu, clone, home, env };
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", nu], { env });
  execFileSync("git", ["init", "-q", "-b", "main", clone], { env });
  gok(m, ["config", "user.email", "t@t"]);
  gok(m, ["config", "user.name", "t"]);
  gok(m, ["remote", "add", "origin", nu]);
  writeFileSync(join(clone, "a.txt"), "a\n");
  gok(m, ["add", "-A"]);
  gok(m, ["-c", "core.hooksPath=/nonexistent", "commit", "-qm", "test: base"]);
  gok(m, ["-c", "core.hooksPath=/nonexistent", "push", "-q", "origin", "main", "main:dev"]);
  gok(m, ["config", "core.hooksPath", HOOKS]);
  writeFileSync(join(clone, "a.txt"), "b\n");
  gok(m, ["add", "-A"]);
  gok(m, ["commit", "-qm", "test: avance"]);
  return m;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function teteDistante(m: Monde, ref = "refs/heads/main"): string {
  const p = spawnSync("git", ["--git-dir", m.nu, "rev-parse", "--verify", "-q", ref], { encoding: "utf-8", env: m.env });
  return p.status === 0 ? p.stdout.trim() : "(absente)";
}
function etatDistant(m: Monde): string {
  return spawnSync("git", ["--git-dir", m.nu, "for-each-ref", "--format=%(refname) %(objectname)"], { encoding: "utf-8", env: m.env }).stdout;
}

interface Champs { depot: string; distant: string; destination: string; source: string; ref: string; avant: string }
function champs(m: Monde, rref = "refs/heads/main"): Champs {
  return {
    depot: realpathSync(gok(m, ["rev-parse", "--absolute-git-dir"])),
    distant: "origin",
    destination: sha256(gok(m, ["remote", "get-url", "--push", "origin"])),
    source: gok(m, ["rev-parse", "HEAD"]),
    ref: rref,
    avant: teteDistante(m, rref),
  };
}
function texte(c: Champs): string {
  return `pi-push-autorisation v1\ndepot ${c.depot}\ndistant ${c.distant}\ndestination ${c.destination}\nsource ${c.source}\nref ${c.ref}\navant ${c.avant}\n`;
}
const fichierAutorisation = (m: Monde) => join(m.home, ".pi", ".allow-push");
function autoriser(m: Monde, contenu: string): void {
  writeFileSync(fichierAutorisation(m), contenu, { mode: 0o600 });
}
function consommes(m: Monde): string[] {
  return readdirSync(join(m.home, ".pi")).filter((n) => n.startsWith(".allow-push.consomme.")).sort();
}

/**
 * Un push refusé : code non nul, distant inchangé, (sauf mention) autorisation non consommée, et refus
 * par LA garde visée : le message du crochet est celui de cette garde. Une autre garde qui refuserait
 * à sa place ne prouve pas la première.
 */
function refuse(m: Monde, args: string[], quoi: string, motif: string, opts: { env?: NodeJS.ProcessEnv; consommeeAdmise?: boolean } = {}): void {
  const avant = etatDistant(m);
  const autorisationAvant = existsSync(fichierAutorisation(m));
  const p = g(m, ["push", ...args], opts.env ?? m.env);
  const apres = etatDistant(m);
  propriete(p.status !== 0, `${quoi} : le push est refusé (rc ${p.status})`);
  propriete(apres === avant, `${quoi} : le distant est inchangé`);
  if (!opts.consommeeAdmise) {
    propriete(existsSync(fichierAutorisation(m)) === autorisationAvant && consommes(m).length === 0, `${quoi} : rien n'est consommé`);
  }
  propriete(p.stderr.includes(`refused by pre-push: ${motif}`), `${quoi} : refus du crochet par la garde visée (« ${motif} ») : ${p.stderr.split("\n")[0]}`);
}

// ── K-P1 : sans autorisation ────────────────────────────────────────────────────────────────────

regressionCorrigee("P3-P1", "sans autorisation, un push de ce dépôt est refusé et le distant reste inchangé", () => {
  const m = monde();
  refuse(m, ["origin", "main"], "sans autorisation", "no authorisation");
});

// ── K-P2 à K-P7 : chaque liaison de l'autorisation ──────────────────────────────────────────────

regressionCorrigee("P3-P2", "une autorisation pour une autre ref est refusée", () => {
  const m = monde();
  autoriser(m, texte({ ...champs(m), ref: "refs/heads/dev" }));
  refuse(m, ["origin", "main"], "autre ref", "the authorisation is for another ref");
});

regressionCorrigee("P3-P3", "une autorisation pour un autre objet est refusée", () => {
  const m = monde();
  autoriser(m, texte({ ...champs(m), source: gok(m, ["rev-parse", "HEAD~1"]) }));
  refuse(m, ["origin", "main"], "autre objet", "the authorisation is for another commit");
});

regressionCorrigee("P3-P4", "une autorisation qui attend une autre tête distante est refusée", () => {
  const m = monde();
  autoriser(m, texte({ ...champs(m), avant: gok(m, ["rev-parse", "HEAD"]) }));
  refuse(m, ["origin", "main"], "autre tête distante attendue", "the remote head is not the one the authorisation expects");
});

regressionCorrigee("P3-P5", "une autorisation écrite pour un autre dépôt local, avec les mêmes objets, est refusée", () => {
  const m = monde();
  const autre = join(m.racine, "autre-clone");
  execFileSync("git", ["clone", "-q", m.nu, autre], { env: m.env });
  autoriser(m, texte({ ...champs(m), depot: realpathSync(join(autre, ".git")) }));
  refuse(m, ["origin", "main"], "autre dépôt", "the authorisation is for another repository");
});

regressionCorrigee("P3-P6", "une adresse de push changée sous le même nom de distant est refusée", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  const second = join(m.racine, "second.git");
  execFileSync("git", ["clone", "-q", "--bare", m.nu, second], { env: m.env });
  gok(m, ["remote", "set-url", "--push", "origin", second]);
  const avantSecond = spawnSync("git", ["--git-dir", second, "rev-parse", "refs/heads/main"], { encoding: "utf-8" }).stdout;
  refuse(m, ["origin", "main"], "destination changée", "the authorisation is for another push destination");
  propriete(spawnSync("git", ["--git-dir", second, "rev-parse", "refs/heads/main"], { encoding: "utf-8" }).stdout === avantSecond, "la seconde destination est inchangée");
});

regressionCorrigee("P3-P7", "une autorisation pour un autre nom de distant est refusée", () => {
  const m = monde();
  gok(m, ["remote", "add", "secours", m.nu]);
  autoriser(m, texte(champs(m)));
  refuse(m, ["secours", "main"], "autre distant", "the authorisation is for another remote");
});

// ── K-P8 : format strict ────────────────────────────────────────────────────────────────────────

regressionCorrigee("P3-P8a", "une autorisation à l'en-tête faux est refusée", () => {
  const m = monde();
  autoriser(m, texte(champs(m)).replace("pi-push-autorisation v1", "pi-push-autorisation v2"));
  refuse(m, ["origin", "main"], "en-tête", "malformed authorisation (header)");
});

regressionCorrigee("P3-P8b", "une autorisation portant un CR est refusée", () => {
  const m = monde();
  autoriser(m, texte(champs(m)).replace("\nref ", "\r\nref "));
  refuse(m, ["origin", "main"], "CR", "malformed authorisation (CR)");
});

regressionCorrigee("P3-P8c", "une autorisation sans saut de ligne final est refusée", () => {
  const m = monde();
  autoriser(m, texte(champs(m)).replace(/\n$/, ""));
  refuse(m, ["origin", "main"], "sans saut final", "malformed authorisation (no final newline)");
});

regressionCorrigee("P3-P8d", "une autorisation de huit lignes est refusée", () => {
  const m = monde();
  autoriser(m, texte(champs(m)) + "note de trop\n");
  refuse(m, ["origin", "main"], "huit lignes", "malformed authorisation (7 lines expected)");
});

regressionCorrigee("P3-P8e", "une autorisation dont une clé est inconnue est refusée, même avec la bonne valeur", () => {
  const m = monde();
  autoriser(m, texte(champs(m)).replace("\ndepot ", "\nrepo "));
  refuse(m, ["origin", "main"], "clé inconnue", "malformed authorisation (line 2 must be 'depot <value>')");
});

regressionCorrigee("P3-P8f", "une autorisation à l'empreinte de destination illisible est refusée", () => {
  const m = monde();
  autoriser(m, texte({ ...champs(m), destination: "abc" }));
  refuse(m, ["origin", "main"], "empreinte illisible", "malformed authorisation (destination digest)");
});

regressionCorrigee("P3-P8g", "une autorisation à l'identifiant d'objet illisible est refusée", () => {
  const m = monde();
  autoriser(m, texte({ ...champs(m), source: "objet-illisible" }));
  refuse(m, ["origin", "main"], "identifiant illisible", "malformed authorisation (object id)");
});

regressionCorrigee("P3-P8h", "une autorisation portant un octet NUL est refusée avant toute consommation", () => {
  const m = monde();
  autoriser(m, texte(champs(m)).replace("pi-push-autorisation v1\n", "pi-push-autorisation v1\u0000\n"));
  refuse(m, ["origin", "main"], "NUL", "malformed authorisation (bytes not readable as text)");
});

// ── K-P9 : le fichier lui-même ──────────────────────────────────────────────────────────────────

regressionCorrigee("P3-P9a", "une autorisation lien symbolique est refusée, même vers un contenu exact", () => {
  const m = monde();
  const ailleurs = join(m.racine, "ailleurs");
  writeFileSync(ailleurs, texte(champs(m)), { mode: 0o600 });
  symlinkSync(ailleurs, fichierAutorisation(m));
  refuse(m, ["origin", "main"], "lien", "the authorisation is a symbolic link");
});

regressionCorrigee("P3-P9b", "une autorisation qui n'est pas un fichier ordinaire est refusée", () => {
  const m = monde();
  mkdirSync(fichierAutorisation(m));
  refuse(m, ["origin", "main"], "répertoire", "the authorisation is not a regular file");
});

regressionCorrigee("P3-P9c", "une autorisation à plusieurs liens physiques est refusée", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  linkSync(fichierAutorisation(m), join(m.racine, "second-lien"));
  refuse(m, ["origin", "main"], "deux liens", "the authorisation must have a single hard link");
});

regressionCorrigee("P3-P9d", "une autorisation inscriptible par le groupe ou les autres est refusée", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  chmodSync(fichierAutorisation(m), 0o620);
  refuse(m, ["origin", "main"], "groupe", "the authorisation must not be group- or other-writable");
  chmodSync(fichierAutorisation(m), 0o602);
  refuse(m, ["origin", "main"], "autres", "the authorisation must not be group- or other-writable");
});

regressionCorrigee("P3-P9e", "une autorisation remplacée pendant sa lecture est refusée avant toute consommation", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  // Le `cat` substitué rend le contenu, puis remplace le fichier par une copie identique (autre inode).
  const env = substituer(m, "cat", 'for f; do :; done\n"$REEL" "$@" && "$REEL" "$f" > "$f.n" && chmod 600 "$f.n" && mv "$f.n" "$f"');
  refuse(m, ["origin", "main"], "remplacée pendant la lecture", "the authorisation changed while it was read", { env });
  propriete(existsSync(fichierAutorisation(m)), "l'autorisation reste disponible");
});

// ── K-P10 à K-P13 : la mise à jour elle-même ────────────────────────────────────────────────────

regressionCorrigee("P3-P10", "zéro ou deux mises à jour dans un même push sont refusées", () => {
  const m = monde();
  gok(m, ["branch", "-f", "dev", "HEAD"]);
  autoriser(m, texte(champs(m)));
  refuse(m, ["origin", "main", "dev"], "deux mises à jour", "exactly one ref update is authorised per push, got 2");
  // Zéro mise à jour : git n'appelle pas le crochet sans mise à jour, d'où l'invocation directe.
  const z = spawnSync("bash", [join(HOOKS, "pre-push"), "origin", gok(m, ["remote", "get-url", "--push", "origin"])], { cwd: m.clone, env: m.env, input: "", encoding: "utf-8" });
  propriete(z.status !== 0 && z.stderr.includes("refused by pre-push: exactly one ref update is authorised per push, got 0"), `zéro mise à jour refusée par la garde d'unicité : ${z.stderr.split("\n")[0]}`);
  propriete(existsSync(fichierAutorisation(m)) && consommes(m).length === 0, "zéro mise à jour : rien n'est consommé");
});

regressionCorrigee("P3-P11a", "une suppression de branche distante est refusée", () => {
  const m = monde();
  autoriser(m, texte({ ...champs(m, "refs/heads/dev"), source: "0".repeat(40) }));
  refuse(m, ["origin", ":dev"], "suppression", "a deletion is never authorised");
});

regressionCorrigee("P3-P11b", "la création d'une branche distante est refusée", () => {
  const m = monde();
  autoriser(m, texte({ ...champs(m), ref: "refs/heads/nouvelle", avant: "0".repeat(40) }));
  refuse(m, ["origin", "HEAD:refs/heads/nouvelle"], "création", "creating a remote branch is not authorised");
});

regressionCorrigee("P3-P11c", "la mise à jour d'une étiquette distante est refusée, même en avance rapide", () => {
  const m = monde();
  gok(m, ["-c", "core.hooksPath=/nonexistent", "tag", "v1", "HEAD~1"]);
  gok(m, ["-c", "core.hooksPath=/nonexistent", "push", "-q", "origin", "refs/tags/v1"]);
  gok(m, ["tag", "-f", "v1", "HEAD"]);
  const c = champs(m, "refs/tags/v1");
  precondition(c.avant === gok(m, ["rev-parse", "HEAD~1"]), "l'étiquette distante existe et précède l'objet poussé");
  autoriser(m, texte(c));
  refuse(m, ["--force", "origin", "refs/tags/v1"], "étiquette", "only an existing branch under refs/heads/ can be updated");
});

regressionCorrigee("P3-P12", "une mise à jour qui n'est pas une avance rapide est refusée, même forcée", () => {
  const m = monde();
  gok(m, ["reset", "-q", "--hard", "HEAD~1"]);
  writeFileSync(join(m.clone, "a.txt"), "c\n");
  gok(m, ["add", "-A"]);
  gok(m, ["commit", "-qm", "test: divergente"]);
  // Le distant avance d'un commit que la branche locale n'a pas.
  const autre = join(m.racine, "autre");
  execFileSync("git", ["clone", "-q", m.nu, autre], { env: m.env });
  writeFileSync(join(autre, "z.txt"), "z\n");
  execFileSync("git", ["add", "-A"], { cwd: autre, env: m.env });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "core.hooksPath=/nonexistent", "commit", "-qm", "test: ailleurs"], { cwd: autre, env: m.env });
  execFileSync("git", ["-c", "core.hooksPath=/nonexistent", "push", "-q", "origin", "main"], { cwd: autre, env: m.env });
  gok(m, ["fetch", "-q", "origin"]);
  autoriser(m, texte(champs(m)));
  refuse(m, ["--force", "origin", "main"], "non avance rapide forcée", "not a fast-forward of the remote head");
});

regressionCorrigee("P3-P13", "une tête distante absente localement est refusée, sans présomption d'ascendance", () => {
  const m = monde();
  const autre = join(m.racine, "autre");
  execFileSync("git", ["clone", "-q", m.nu, autre], { env: m.env });
  writeFileSync(join(autre, "z.txt"), "z\n");
  execFileSync("git", ["add", "-A"], { cwd: autre, env: m.env });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "core.hooksPath=/nonexistent", "commit", "-qm", "test: ailleurs"], { cwd: autre, env: m.env });
  execFileSync("git", ["-c", "core.hooksPath=/nonexistent", "push", "-q", "origin", "main"], { cwd: autre, env: m.env });
  // Pas de fetch : la tête distante est inconnue du clone.
  const c = champs(m);
  precondition(spawnSync("git", ["cat-file", "-e", `${c.avant}^{commit}`], { cwd: m.clone, env: m.env }).status !== 0, "la tête distante est absente du clone");
  autoriser(m, texte(c));
  refuse(m, ["--force", "origin", "main"], "tête distante inconnue", "the remote head is not available locally; ancestry cannot be proven");
});

// ── K-P14 à K-P16, K-P21, K-P22 : consommation exclusive, prouvée ─────────────────────────────────

/** Le chemin réel d'un outil dans le PATH du test (avant toute substitution). */
function outilReel(nom: string): string {
  const p = spawnSync("sh", ["-c", `command -v ${nom}`], { encoding: "utf-8" });
  precondition(p.status === 0 && p.stdout.trim().startsWith("/"), `${nom} introuvable dans le PATH`);
  return p.stdout.trim();
}
/** Un PATH où `nom` est remplacé par un script, qui peut appeler l'outil réel par `$REEL`. */
function substituer(m: Monde, nom: string, corps: string): NodeJS.ProcessEnv {
  const bin = join(m.racine, `bin-${nom}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(bin);
  writeFileSync(join(bin, nom), `#!/bin/sh\nREEL='${outilReel(nom)}'\n${corps}\n`, { mode: 0o755 });
  return { ...m.env, PATH: `${bin}:${m.env.PATH ?? "/usr/bin:/bin"}` };
}
/** Noms consommés qui contiennent effectivement une autorisation. */
function consommations(m: Monde): string[] {
  return consommes(m).filter((n) => existsSync(join(m.home, ".pi", n, "allow-push")));
}
const inode = (f: string) => statSync(f).ino;

regressionCorrigee("P3-P14", "une autorisation sert une fois : consommée par le push, elle n'en autorise pas un second", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  const p1 = g(m, ["push", "-q", "origin", "main"]);
  precondition(p1.status === 0, `le premier push passe : ${p1.stderr}`);
  propriete(!existsSync(fichierAutorisation(m)) && consommations(m).length === 1, "l'autorisation est consommée par le premier push");
  gok(m, ["commit", "-q", "--allow-empty", "-m", "test: encore"]);
  refuse(m, ["origin", "main"], "second push sans nouvelle autorisation", "no authorisation", { consommeeAdmise: true });
  propriete(consommations(m).length === 1, "une seule consommation");
});

/**
 * Invocations directes et simultanées du vrai crochet, sur une même autorisation, derrière une
 * barrière. On compte ce que le crochet accepte (code 0) et ce qui est consommé, pas les pushes :
 * un serveur peut refuser un second push que deux crochets auraient accepté.
 */
async function invocationsSimultanees(m: Monde, n: number): Promise<number[]> {
  const c = champs(m);
  const ligne = `refs/heads/main ${c.source} refs/heads/main ${c.avant}\n`;
  const adresse = gok(m, ["remote", "get-url", "--push", "origin"]);
  const top = join(m.racine, `top-${Math.random().toString(16).slice(2)}`);
  const une = () => new Promise<number>((resolve) => {
    const p = spawn("sh", ["-c", 'while [ ! -e "$1" ]; do :; done; exec bash "$2" origin "$3"', "barriere", top, join(HOOKS, "pre-push"), adresse], { cwd: m.clone, env: m.env, stdio: ["pipe", "ignore", "ignore"] });
    p.stdin.end(ligne);
    p.on("close", (code) => resolve(code ?? -1));
  });
  const attentes = Array.from({ length: n }, une);
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(top, "");
  return Promise.all(attentes);
}

regressionCorrigee("P3-P15", "invocations concurrentes sur une même autorisation : au plus une acceptation, autant de consommations que d'acceptations", async () => {
  for (let tour = 0; tour < 3; tour++) {
    const m = monde();
    autoriser(m, texte(champs(m)));
    const codes = await invocationsSimultanees(m, 4);
    const acceptations = codes.filter((x) => x === 0).length;
    const pris = consommations(m).length;
    propriete(acceptations <= 1, `tour ${tour} : au plus une acceptation du crochet (codes ${codes.join(",")})`);
    propriete(acceptations === pris, `tour ${tour} : acceptations ${acceptations}, consommations ${pris}`);
    propriete(acceptations === 1 && !existsSync(fichierAutorisation(m)), `tour ${tour} : une acceptation, et l'autorisation n'est plus disponible`);
  }
});

regressionCorrigee("P3-P16", "un déplacement en échec fait refuser, sans push, même si le fichier a bougé", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  refuse(m, ["origin", "main"], "mv déplace puis échoue", "the authorisation could not be consumed (already taken?)", { env: substituer(m, "mv", '"$REEL" "$@"; exit 1'), consommeeAdmise: true });
  const m2 = monde();
  autoriser(m2, texte(champs(m2)));
  refuse(m2, ["origin", "main"], "mv échoue sans rien déplacer", "the authorisation could not be consumed (already taken?)", { env: substituer(m2, "mv", "exit 1") });
  propriete(existsSync(fichierAutorisation(m2)), "l'autorisation non déplacée reste disponible");
});

regressionCorrigee("P3-P21", "une destination de consommation préexistante, même de mêmes octets, fait refuser sans rien écraser", () => {
  const m = monde();
  const contenu = texte(champs(m));
  autoriser(m, contenu);
  const ino = inode(fichierAutorisation(m));
  // Le `mkdir` substitué pose la destination, avec les mêmes octets, juste avant le vrai.
  const env = substituer(m, "mkdir", `for d; do :; done\n"$REEL" -p "$d" && cp "$HOME/.pi/.allow-push" "$d/allow-push" && echo intrus >> "$d/temoin"\nexec "$REEL" "$@"`);
  refuse(m, ["origin", "main"], "destination préexistante", "the consumption name already exists; nothing was consumed", { env, consommeeAdmise: true });
  const pris = consommes(m);
  propriete(existsSync(fichierAutorisation(m)) && inode(fichierAutorisation(m)) === ino && readFileSync(fichierAutorisation(m), "utf-8") === contenu, "l'autorisation reste disponible, intacte");
  propriete(pris.length === 1 && readFileSync(join(m.home, ".pi", pris[0], "allow-push"), "utf-8") === contenu && inode(join(m.home, ".pi", pris[0], "allow-push")) !== ino, "la destination préexistante n'est pas écrasée");
  propriete(readFileSync(join(m.home, ".pi", pris[0], "temoin"), "utf-8") === "intrus\n", "rien d'autre n'est touché dans la destination");
});

regressionCorrigee("P3-P22a", "un déplacement annoncé réussi mais non effectué fait refuser", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  refuse(m, ["origin", "main"], "mv sans effet", "the authorisation is still available after the move", { env: substituer(m, "mv", "exit 0"), consommeeAdmise: true });
  propriete(existsSync(fichierAutorisation(m)), "l'autorisation est toujours disponible");
});

regressionCorrigee("P3-P22b", "une copie suivie d'une suppression (autre inode) n'est pas une réclamation : refus", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  const env = substituer(m, "mv", 'for d; do :; done\nfor s; do case "$s" in -*) ;; *) break ;; esac; done\ncp -p "$s" "$d" && rm -f "$s"');
  refuse(m, ["origin", "main"], "copie puis suppression", "the consumed file is not the validated authorisation", { env, consommeeAdmise: true });
});

regressionCorrigee("P3-P22c", "un nom disponible recréé après le déplacement fait refuser", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  const env = substituer(m, "mv", 'for d; do :; done\n"$REEL" "$@" && cp -p "$d" "$HOME/.pi/.allow-push"');
  refuse(m, ["origin", "main"], "nom recréé", "the authorisation is still available after the move", { env, consommeeAdmise: true });
});

regressionCorrigee("P3-P22d", "une autorisation altérée après sa validation fait refuser", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  const env = substituer(m, "mv", 'for d; do :; done\n"$REEL" "$@" && printf x >> "$d"');
  refuse(m, ["origin", "main"], "contenu altéré", "the consumed authorisation differs from the validated one", { env, consommeeAdmise: true });
});

regressionCorrigee("P3-P22e", "une autorisation consommée qui n'est plus privée et à lien unique fait refuser", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  refuse(m, ["origin", "main"], "consommée rendue inscriptible", "the consumed authorisation is not a private, single-link regular file",
    { env: substituer(m, "mv", 'for d; do :; done\n"$REEL" "$@" && chmod 620 "$d"'), consommeeAdmise: true });
  const m2 = monde();
  autoriser(m2, texte(champs(m2)));
  refuse(m2, ["origin", "main"], "consommée avec un second lien", "the consumed authorisation is not a private, single-link regular file",
    { env: substituer(m2, "mv", 'for d; do :; done\n"$REEL" "$@" && ln "$d" "$d.second"'), consommeeAdmise: true });
});

// ── K-P19, K-P20 : bash-guard réel, refus sans dialogue avant la whitelist ─────────────────────────

const BASH_GUARD = join(import.meta.dirname, "..", "extensions", "bash-guard");
const RAISON_PUSH =
  "blocked by bash-guard: the push authorisation is the operator's and cannot be created, copied, read or restored by an agent. If a push is refused for want of one, report it and stop — do not work around it.";
const RAISON_CONTOURNEMENT =
  "blocked by bash-guard: --no-verify (or commit -n) bypasses this repository's hooks, which an agent never bypasses. Report the refusal and stop.";

interface Decision { commande: string; block: boolean | null; reason: string | null }
interface Garde { decisions: Decision[]; dialogues: number; jetonAvant: boolean; jetonApres: boolean; journal: string[] }

/**
 * Le vrai `extensions/bash-guard/index.ts`, chargé dans un processus enfant avec un substitut de
 * l'API de pi propre à ce fichier (écrit ici, dans un temporaire : `tests/stubs/` n'est pas touché).
 * `ctx.hasUI` est vrai : un dialogue, s'il était proposé, serait compté. La whitelist est `.*` et
 * le jeton de commit est présent : ni l'une ni l'autre ne doit ouvrir ces refus, ni être consommé.
 */
function bashGuard(commandes: string[]): Garde {
  const d = tmp("pi-l0-p3bg-");
  const home = join(d, "home");
  const agent = join(d, "agent");
  mkdirSync(join(home, ".pi"), { recursive: true });
  mkdirSync(agent);
  writeFileSync(join(home, ".pi", ".allow-commit"), "");
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ bashGuard: { whitelistPatterns: [".*"] } }));
  writeFileSync(join(d, "pi.mjs"), [
    "export function getAgentDir() { return process.env.BG_AGENT_DIR; }",
    "export function isToolCallEventType(kind, e) { return typeof e === 'object' && e !== null && e.toolName === kind; }",
    "export async function withFileMutationQueue(_p, fn) { return fn(); }",
  ].join("\n") + "\n");
  writeFileSync(join(d, "crochets.mjs"), [
    `const PI = ${JSON.stringify(pathToFileURL(join(d, "pi.mjs")).href)};`,
    "export function resolve(spec, ctx, next) {",
    "  if (spec === '@earendil-works/pi-coding-agent') return { url: PI, shortCircuit: true };",
    "  if (spec === './patterns' && ctx.parentURL && ctx.parentURL.endsWith('/bash-guard/index.ts')) return { url: new URL('./patterns.ts', ctx.parentURL).href, shortCircuit: true };",
    "  return next(spec, ctx);",
    "}",
  ].join("\n") + "\n");
  writeFileSync(join(d, "enregistrer.mjs"), `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(join(d, "crochets.mjs")).href)});\n`);
  writeFileSync(join(d, "scenario.mjs"), [
    "import { existsSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `const garde = (await import(${JSON.stringify(pathToFileURL(join(BASH_GUARD, "index.ts")).href)})).default;`,
    "let handler = null; let dialogues = 0;",
    "garde({ on(evt, h) { if (evt === 'tool_call') handler = h; } });",
    "const ctx = { hasUI: true, ui: { select: async () => { dialogues++; return 'Confirm'; } } };",
    "const jeton = join(process.env.HOME, '.pi', '.allow-commit');",
    "const jetonAvant = existsSync(jeton);",
    "const decisions = [];",
    "for (const commande of JSON.parse(process.env.BG_COMMANDES)) {",
    "  const r = await handler({ toolName: 'bash', toolCallId: 't', input: { command: commande } }, ctx);",
    "  decisions.push({ commande, block: r ? r.block ?? null : null, reason: r ? r.reason ?? null : null });",
    "}",
    "const log = join(process.env.BG_AGENT_DIR, 'bash-guard.log');",
    "const journal = existsSync(log) ? readFileSync(log, 'utf-8').split('\\n').filter(Boolean) : [];",
    "process.stdout.write(JSON.stringify({ decisions, dialogues, jetonAvant, jetonApres: existsSync(jeton), journal }));",
  ].join("\n") + "\n");
  const [majeur] = process.versions.node.split(".").map(Number);
  const p = spawnSync(process.execPath, [...(majeur < 23 ? ["--experimental-strip-types"] : []), "--no-warnings", "--import", pathToFileURL(join(d, "enregistrer.mjs")).href, join(d, "scenario.mjs")], {
    encoding: "utf-8",
    env: { ...sansRole(process.env), HOME: home, BG_AGENT_DIR: agent, BG_COMMANDES: JSON.stringify(commandes) },
  });
  precondition(p.status === 0, `bash-guard chargé et appelé : rc ${p.status}, ${p.stderr.slice(0, 600)}`);
  return JSON.parse(p.stdout) as Garde;
}

/** Chaque commande est refusée par le bon bloc, avec sa raison et son libellé exacts. */
function refusesPar(r: Garde, commandes: string[], raison: string, libelle: string): void {
  for (const c of commandes) {
    const x = r.decisions.find((y) => y.commande === c);
    propriete(x?.block === true && x.reason === raison, `refusée par bash-guard avec la raison exacte : ${c} → ${JSON.stringify(x)}`);
    const cmd = c.replace(/[\t\n\r]/g, " ");
    propriete(r.journal.some((l) => l.split("\t").slice(1).join("\t") === `token\tdeclined\t${libelle}\t${cmd}`), `journalisée « ${libelle} » : ${c}`);
  }
  propriete(r.dialogues === 0, `aucun dialogue (${r.dialogues})`);
  propriete(r.jetonAvant && r.jetonApres, "le jeton de commit présent n'est pas consommé");
}

const ACCES_PUSH = [
  "touch ~/.pi/.allow-push",
  "cp /tmp/autorisation ~/.pi/.allow-push",
  "cat ~/.pi/.allow-push",
  "mv ~/.pi/.allow-push.consomme.20261015T000000Z.1.2/allow-push ~/.pi/.allow-push",
  "ls ~/.pi/.allow-push.consomme.20261015T000000Z.1.2",
  "cat ~/.pi/*/allow-push",
];

regressionCorrigee("P3-P19", "bash-guard refuse à un agent tout accès au fichier d'autorisation de push, sans dialogue, avant la whitelist", () => {
  const r = bashGuard([...ACCES_PUSH, "touch ~/.pi/.allow-commit", "ls -la", "git status"]);
  refusesPar(r, ACCES_PUSH, RAISON_PUSH, "allow-push authorisation file");
  const jeton = r.decisions.find((y) => y.commande === "touch ~/.pi/.allow-commit");
  propriete(jeton?.block === true && /commit token is the operator's authorisation/.test(jeton.reason ?? ""), "le refus antérieur du jeton .allow-commit est intact");
  for (const c of ["ls -la", "git status"]) propriete(r.decisions.find((y) => y.commande === c)?.block === null, `commande ordinaire non bloquée : ${c}`);
});

const CONTOURNEMENTS = [
  "git commit --no-verify -m x",
  "git -C /srv/depot -c user.name=x push --no-verify origin main",
  "git push --no-veri origin main",
  "git merge --no-verif feature",
  "cd /srv/depot && git rebase --no-verify main",
  "git commit -n -m x",
  "git commit -an -m x",
  "echo ok; git commit -m x -nv",
  "git commit -nm x",
  "git commit -anm x",
  "git -P commit -n -m x",
  "git commit \"--no-verify\" -m x",
  "bash -c \"git push --no-verify origin main\"",
];

regressionCorrigee("P3-P20", "bash-guard refuse à un agent --no-verify et commit -n, sans dialogue, avant la whitelist et le jeton", async () => {
  const r = bashGuard([...CONTOURNEMENTS, "git push -n origin main"]);
  refusesPar(r, CONTOURNEMENTS, RAISON_CONTOURNEMENT, "hook bypass");
  propriete(r.decisions.find((y) => y.commande === "git push -n origin main")?.block === null, "git push -n (essai à blanc) n'est pas un contournement");
  // Les motifs exportés, sur les cas qu'ils ne doivent pas prendre (limites déclarées).
  const motifs = (await import(pathToFileURL(join(BASH_GUARD, "patterns.ts")).href)) as { HOOK_BYPASS_PATTERNS?: RegExp[] };
  const pris = (c: string) => (motifs.HOOK_BYPASS_PATTERNS ?? []).some((x) => x.test(c));
  propriete(Array.isArray(motifs.HOOK_BYPASS_PATTERNS) && CONTOURNEMENTS.every(pris), "les motifs exportés prennent chaque contournement");
  for (const c of ["git commit -amn", "git commit -mn", "git commit -m x", "git commit -Sn -m x", "git commit -N -m x", "git commit-tree -n x",
    "git push --no-ver origin", "npm publish --no-verify", "git merge --no-verify-signatures x", "git log --grep=no-verify"]) {
    propriete(!pris(c), `non pris : ${c}`);
  }
  // Aucune explosion du retour arrière sur une longue suite d'options globales.
  const longue = `git ${"-c a ".repeat(40)}x`;
  const t0 = performance.now();
  for (const x of motifs.HOOK_BYPASS_PATTERNS ?? []) x.test(longue);
  propriete(performance.now() - t0 < 1000, `40 options -c évaluées en ${Math.round(performance.now() - t0)} ms`);
});

regressionCorrigee("P3-P17", "un enfant (PI_SUBAGENT_ROLE) ne pousse pas, même avec une autorisation exacte", () => {
  const m = monde();
  autoriser(m, texte(champs(m)));
  refuse(m, ["origin", "main"], "rôle worker", "child agents never push (role: worker)", { env: { ...m.env, PI_SUBAGENT_ROLE: "worker" } });
});

// ── K-P18 : le témoin nominal ───────────────────────────────────────────────────────────────────

preservation("P3-P18", "avec l'autorisation exacte, le push passe, le distant avance et l'autorisation est consommée et conservée", () => {
  const m = monde();
  const c = champs(m);
  const contenu = texte(c);
  autoriser(m, contenu);
  const p = g(m, ["push", "-q", "origin", "main"]);
  propriete(p.status === 0, `le push autorisé passe : ${p.stderr}`);
  propriete(teteDistante(m) === c.source, "le distant porte l'objet autorisé");
  propriete(!existsSync(fichierAutorisation(m)), "l'autorisation n'existe plus sous son nom");
  const pris = consommes(m);
  propriete(pris.length === 1 && readFileSync(join(m.home, ".pi", pris[0], "allow-push"), "utf-8") === contenu && readdirSync(join(m.home, ".pi", pris[0])).join() === "allow-push", "elle est conservée, intacte, seule sous son nom de consommation");
});
