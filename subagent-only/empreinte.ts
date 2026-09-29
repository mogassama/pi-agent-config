/**
 * empreinte.ts — l'état du projet qu'aucun appel d'outil de l'orchestrateur n'a le droit de changer
 * (lot ITE, P0-B).
 *
 * sol/29 : après l'intégration de W01, l'orchestrateur a lui-même lancé `subagent-recover discard`,
 * `git restore`, `git worktree remove`, `git branch -d` et un `git apply` à la racine. Interdire ces
 * commandes par leur nom serait contournable par python, cp, sed, perl ; l'invariant se juge donc
 * par EFFET : une empreinte avant l'appel, une après, et tout écart est une mutation.
 *
 * Composantes (PLAN-LOT-ITE v2 § 4, Q-K) :
 *
 *   worktrees          `git worktree list --porcelain -z` : les lanes existantes, leur HEAD, leur branche
 *   refs               `git for-each-ref` : branches, tags, stash, toute ref
 *   config             la configuration git commune et par worktree, `info/exclude`, les hooks : ce
 *                      par quoi on désarme un hook ou un filtre sans toucher une ref
 *   status:<W>         pour chaque worktree W, `status --porcelain=v2 --branch -uall` (fichiers suivis
 *                      modifiés, non suivis non ignorés, HEAD) PLUS le contenu de chaque chemin qu'il
 *                      liste : un second changement d'un fichier déjà modifié ne change pas sa ligne
 *   index:<W>          `ls-files -s -v` : sémantique — un rafraîchissement stat n'est pas une mutation ;
 *                      les marques skip-worktree/assume-unchanged y figurent, et le contenu des
 *                      fichiers qu'elles masquent à `status` est relevé
 *   runs               tout `.pi-subagent-runs/` — registres, plan, manifeste, artefacts — hors bail et
 *                      battement (`*.lease/`), verrous (`*.guard`), temporaires atomiques (`*.tmp`) et
 *                      preuves de cette garde (`ite-p0b/`)
 *
 * Toute impossibilité de calculer une composante LÈVE : elle n'est jamais lue comme « rien n'a changé ».
 *
 * Les invocations git sont comptées (`recordGitInvocation`) : ce module vit dans la surface de
 * reconstruction que `tests/git-probe-counter.test.ts` inventorie. Il ne s'exécute jamais dans une
 * fenêtre de reconstruction — seulement autour des appels d'outil de l'orchestrateur —, et une fenêtre
 * se lit par différence : rien n'y est faussé.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readlinkSync, readSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { recordGitInvocation } from "./git-probe-counter.ts";

export class EmpreinteImpossible extends Error {}

/** Le répertoire, sous `.pi-subagent-runs/`, où cette garde conserve ses preuves. Hors empreinte. */
export const DOSSIER_PREUVES_P0B = "ite-p0b";

/**
 * Le contenu se hache par blocs : la mémoire reste bornée quelle que soit la taille, et AUCUN fichier
 * n'est identifié par ses seules métadonnées — taille, date et inode laissent passer une réécriture de
 * même taille suivie d'une restauration de `mtime` (adjudication ITE-1, E7).
 */
const BLOC = 1_048_576;

function hacherFichier(chemin: string): string {
  const h = createHash("sha256");
  const tampon = Buffer.allocUnsafe(BLOC);
  const fd = openSync(chemin, "r");
  try {
    for (;;) {
      const n = readSync(fd, tampon, 0, BLOC, null);
      if (n === 0) break;
      h.update(n === BLOC ? tampon : tampon.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

export interface Empreinte {
  /** composante → condensé. Deux empreintes se comparent composante par composante. */
  composantes: Record<string, string>;
  /** Ce qui permet de dire QUOI a changé : les lignes lisibles de chaque composante. */
  details: Record<string, string[]>;
}

const sha = (x: string | Buffer): string => createHash("sha256").update(x).digest("hex");

function git(cwd: string, args: string[]): Buffer {
  recordGitInvocation();
  const p = spawnSync("git", ["--no-optional-locks", ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (p.error || p.status !== 0) {
    throw new EmpreinteImpossible(
      `git ${args.join(" ")} (${cwd}) : ${p.error?.message ?? `code ${String(p.status)}`} ` +
        `${p.stderr?.toString("utf-8").trim().slice(0, 300) ?? ""}`,
    );
  }
  return p.stdout;
}

const champs = (b: Buffer): string[] => b.toString("utf-8").split("\0").filter((s) => s.length > 0);

/** Le contenu d'un chemin tel qu'il est sur le disque : fichier, lien ou absence. */
function contenu(chemin: string): string {
  let st;
  try {
    st = lstatSync(chemin);
  } catch {
    return "absent";
  }
  if (st.isSymbolicLink()) return `lien:${readlinkSync(chemin)}`;
  if (st.isDirectory()) return "dossier";
  if (!st.isFile()) return `autre:${st.mode}`;
  return `fichier:${st.mode & 0o777}:${hacherFichier(chemin)}`;
}

/** Les worktrees listés par git : chemin, et la ligne brute qui les décrit. */
function worktrees(root: string): { chemins: string[]; brut: string[] } {
  const brut = champs(git(root, ["worktree", "list", "--porcelain", "-z"]));
  const chemins = brut.filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length));
  return { chemins, brut };
}

/**
 * `status --porcelain=v2 -z` : les chemins que la ligne désigne. Une entrée `2` (renommage) porte
 * son chemin d'origine dans le champ suivant, qui est aussi rendu.
 */
function cheminsDuStatus(entrees: string[]): { lignes: string[]; chemins: string[] } {
  const lignes: string[] = [];
  const chemins: string[] = [];
  for (let i = 0; i < entrees.length; i++) {
    const e = entrees[i];
    lignes.push(e);
    if (e.startsWith("# ")) continue;
    if (e.startsWith("? ") || e.startsWith("! ")) {
      chemins.push(e.slice(2));
    } else if (e.startsWith("1 ")) {
      chemins.push(e.split(" ").slice(8).join(" "));
    } else if (e.startsWith("2 ")) {
      chemins.push(e.split(" ").slice(9).join(" "));
      const origine = entrees[i + 1];
      if (origine !== undefined) {
        lignes.push(origine);
        chemins.push(origine);
        i += 1;
      }
    } else if (e.startsWith("u ")) {
      chemins.push(e.split(" ").slice(10).join(" "));
    } else {
      throw new EmpreinteImpossible(`status : entrée illisible « ${e.slice(0, 120)} »`);
    }
  }
  return { lignes, chemins };
}

/** Les fichiers de configuration git qui changent un comportement sans changer une ref. */
function configuration(root: string, chemins: readonly string[]): { condense: string; lignes: string[] } {
  const commun = git(root, ["rev-parse", "--git-common-dir"]).toString("utf-8").trim();
  const gitCommun = isAbsolute(commun) ? commun : join(root, commun);
  const lignes: string[] = [];
  const voir = (p: string) => lignes.push(`${relative(gitCommun, p) || "."} ${contenu(p)}`);
  voir(join(gitCommun, "config"));
  voir(join(gitCommun, "info", "exclude"));
  const hooks = join(gitCommun, "hooks");
  if (existsSync(hooks)) for (const h of readdirSync(hooks).sort()) voir(join(hooks, h));
  for (const w of chemins) {
    const gd = git(w, ["rev-parse", "--git-dir"]).toString("utf-8").trim();
    voir(join(isAbsolute(gd) ? gd : join(w, gd), "config.worktree"));
  }
  return { condense: sha(lignes.join("\n")), lignes };
}

/** Un nom de `.pi-subagent-runs/` que l'empreinte ignore : bail, battement, verrou, temporaire, preuve. */
function horsEmpreinte(rel: string): boolean {
  const tete = rel.split("/")[0];
  return (
    tete.endsWith(".lease") ||
    tete.endsWith(".guard") ||
    tete === DOSSIER_PREUVES_P0B ||
    /\.tmp$/.test(rel) ||
    /\.migrate-[^/]*$/.test(rel)
  );
}

function espaceDesRuns(runDir: string): { condense: string; lignes: string[] } {
  const lignes: string[] = [];
  if (!existsSync(runDir)) return { condense: sha("absent"), lignes: ["absent"] };
  const parcourir = (dir: string) => {
    for (const nom of readdirSync(dir).sort()) {
      const p = join(dir, nom);
      const rel = relative(runDir, p);
      if (horsEmpreinte(rel)) continue;
      const st = lstatSync(p);
      if (st.isDirectory()) {
        lignes.push(`${rel}/`);
        parcourir(p);
      } else {
        lignes.push(`${rel} ${contenu(p)}`);
      }
    }
  };
  parcourir(runDir);
  return { condense: sha(lignes.join("\n")), lignes };
}

/** L'empreinte complète. Lève `EmpreinteImpossible` si une composante ne se calcule pas. */
export function prendreEmpreinte(root: string, runDir: string): Empreinte {
  const composantes: Record<string, string> = {};
  const details: Record<string, string[]> = {};
  const poser = (nom: string, lignes: string[], condense?: string) => {
    composantes[nom] = condense ?? sha(lignes.join("\n"));
    details[nom] = lignes;
  };
  try {
    const wt = worktrees(root);
    poser("worktrees", wt.brut);
    // Une ref ne contient jamais de fin de ligne : une ligne par ref (`-z` n'existe pas avant git 2.44).
    poser("refs", git(root, ["for-each-ref", "--format=%(refname) %(objectname) %(symref)"])
      .toString("utf-8").split("\n").filter((l) => l.length > 0));
    const cfg = configuration(root, wt.chemins);
    poser("config", cfg.lignes, cfg.condense);
    for (const w of wt.chemins) {
      if (!existsSync(w)) {
        poser(`status:${w}`, ["worktree absent du disque"]);
        continue;
      }
      const { lignes, chemins } = cheminsDuStatus(
        champs(git(w, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"])),
      );
      const contenus = chemins.map((c) => `${c} ${contenu(join(w, c))}`);
      poser(`status:${w}`, [...lignes, ...contenus]);
      /*
       * `-v` porte les marques `skip-worktree` (S) et `assume-unchanged` (minuscule) : un fichier
       * ainsi marqué disparaît de `status` même modifié. Son contenu est donc relevé ici.
       */
      const index = champs(git(w, ["ls-files", "-s", "-v", "-z"]));
      const masques = index
        .filter((l) => /^(S|[a-z]) /.test(l))
        .map((l) => l.slice(l.indexOf("\t") + 1))
        .map((c) => `masqué ${c} ${contenu(join(w, c))}`);
      poser(`index:${w}`, [sha(index.join("\0")), ...masques]);
    }
    const runs = espaceDesRuns(runDir);
    poser("runs", runs.lignes, runs.condense);
  } catch (err) {
    if (err instanceof EmpreinteImpossible) throw err;
    throw new EmpreinteImpossible(err instanceof Error ? err.message : String(err));
  }
  return { composantes, details };
}

export interface Ecart {
  composante: string;
  /** Lignes présentes seulement avant, seulement après — bornées. */
  retirees: string[];
  ajoutees: string[];
}

/** Les composantes qui diffèrent, et ce qui a changé dans chacune. */
export function comparerEmpreintes(avant: Empreinte, apres: Empreinte): Ecart[] {
  const noms = [...new Set([...Object.keys(avant.composantes), ...Object.keys(apres.composantes)])].sort();
  const ecarts: Ecart[] = [];
  for (const nom of noms) {
    if (avant.composantes[nom] === apres.composantes[nom]) continue;
    const a = new Set(avant.details[nom] ?? []);
    const b = new Set(apres.details[nom] ?? []);
    ecarts.push({
      composante: nom,
      retirees: [...a].filter((l) => !b.has(l)).slice(0, 40),
      ajoutees: [...b].filter((l) => !a.has(l)).slice(0, 40),
    });
  }
  return ecarts;
}

/**
 * L'unique écriture admise (PLAN-LOT-ITE v2 § 4) : le plan exact `<runId>-plan.json`, avant son
 * attachement. Un écart qui ne porte QUE sur l'apparition ou le changement de cette ligne de `runs`
 * est admis ; tout autre écart, y compris sur `runs`, ne l'est pas.
 */
export function seulementLePlan(ecarts: readonly Ecart[], nomDuPlan: string): boolean {
  if (ecarts.length !== 1 || ecarts[0].composante !== "runs") return false;
  const e = ecarts[0];
  const duPlan = (l: string) => l === nomDuPlan || l.startsWith(`${nomDuPlan} `);
  return e.retirees.every(duPlan) && e.ajoutees.every(duPlan) && e.ajoutees.length > 0;
}
