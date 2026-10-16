/**
 * Ce que le dépôt doit être avant que le runtime écrive quoi que ce soit.
 *
 * Un seul point pour l'instant, et il est décisif depuis 3c.1c : la racine doit
 * être propre pour ouvrir un contexte d'intégration et pour intégrer. Si le
 * dépôt n'ignore pas `.pi-subagent-runs/`, l'instrumentation du run le salit
 * lui-même, définitivement, et plus aucune intégration ne part. Le défaut est
 * silencieux jusqu'au premier conflit, c'est-à-dire jusqu'au moment le plus
 * coûteux pour le découvrir.
 *
 * **La propriété, pas le mécanisme.** git ignore par `.gitignore`, par
 * `.git/info/exclude` ou par une configuration globale, et exiger une ligne dans
 * un fichier précis imposerait l'un des trois sans raison. `check-ignore`
 * répond sur les règles effectives, quelle qu'en soit l'origine, et sur un
 * chemin qui n'a pas besoin d'exister — donc sans rien créer pour le demander.
 *
 * Et « ignoré » ne suffit pas seul : un fichier déjà suivi le reste malgré une
 * règle d'exclusion. Les deux questions vont ensemble.
 *
 * Une troisième, sans git (phase 3, P1) : si l'espace des runs porte déjà un
 * marqueur de dépôt imbriqué, ce marqueur doit être valide. Ignoré, l'espace
 * reste à la merci de `git clean -xfd` ; le marqueur l'en protège, mais un
 * marqueur partiel ou contradictoire ne protège rien et se refuse ici, avant
 * toute écriture, sans réparation.
 */

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { recordGitInvocation } from "./git-probe-counter.ts";

function tryGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    recordGitInvocation();
    return {
      ok: true,
      out: execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 30_000 }),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` };
  }
}

export type Preflight = { ok: true } | { ok: false; reason: string };

export function instrumentationIgnored(root: string, runsDir: string): Preflight {
  const suivis = tryGit(root, ["ls-files", "--", `${runsDir}/`]);
  if (!suivis.ok) {
    // Pas un dépôt git, ou git absent. Ce n'est pas au préflight d'en décider :
    // il répond sur ce qu'il sait, et le reste du runtime a ses propres refus.
    return { ok: true };
  }
  const traques = suivis.out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (traques.length > 0) {
    return {
      ok: false,
      reason:
        `${traques.length} fichier(s) de ${runsDir}/ sont suivis par git ` +
        `(${traques.slice(0, 3).join(", ")}${traques.length > 3 ? " …" : ""}). ` +
        "Une règle d'exclusion ne les délivre pas : `git rm --cached` d'abord.",
    };
  }

  /*
   * Le répertoire lui-même, pas un fichier dedans.
   *
   * Une première version interrogeait un chemin sonde sous ce répertoire. Une
   * règle qui ne couvre que ce chemin — `.pi-subagent-runs/.pi-runtime-probe`
   * dans un `.gitignore` — répondait alors oui, pendant que le manifeste, le
   * plan gelé et le registre des lanes restaient suivis. La garde était plus
   * faible que la propriété qu'elle annonçait.
   *
   * Interroger le répertoire couvre aussi ce qui n'existe pas encore : un
   * artefact ajouté sous ce nom plus tard est ignoré sans que ce fichier ait à
   * le savoir. `check-ignore` répond sur un chemin qui n'a pas besoin
   * d'exister, donc rien n'est créé pour poser la question — ce qu'on veut
   * d'une vérification qui doit précéder la première écriture.
   */
  const ignore = tryGit(root, ["check-ignore", "-q", "--", `${runsDir}/`]);
  if (!ignore.ok) {
    return {
      ok: false,
      reason:
        `${runsDir}/ n'est pas ignoré par ce dépôt. Le runtime y écrit le ` +
        "manifeste, le plan gelé et le registre des lanes ; sans exclusion, la " +
        "racine reste sale en permanence et aucune intégration ne peut partir — " +
        "elles exigent une racine dont chaque état est dans un commit. " +
        `Ajouter \`${runsDir}/\` au \`.gitignore\` du dépôt, ou à ` +
        "`.git/info/exclude` pour ne pas toucher au dépôt partagé.",
    };
  }

  const marqueur = etatMarqueur(join(root, runsDir));
  if (marqueur.etat === "invalide") {
    return {
      ok: false,
      reason:
        `${runsDir}/ porte un marqueur de protection invalide : ${marqueur.raison}. ` +
        "Le runtime ne le répare pas et n'écrit rien : un marqueur partiel ne protège " +
        "pas les registres de `git clean`. Examiner le répertoire, puis redémarrer pi.",
    };
  }
  return { ok: true };
}

/*
 * Le marqueur de dépôt imbriqué (phase 3, P1).
 *
 * `git clean -xfd` — et `-X`, et `git stash --all` — ne retire pas un dépôt
 * imbriqué sans double force. Un `.git` minimal dans l'espace des runs le soustrait
 * donc à l'hygiène git ordinaire. Il ne le soustrait ni à `git clean -ff`, ni à une
 * suppression explicite, ni au retrait du marqueur lui-même : c'est une garde contre
 * la panne ordinaire, pas une preuve d'indestructibilité.
 *
 * La forme reconnue est stricte, parce que git décide sur elle : un `.git` réel (ni
 * lien, ni fichier `gitdir:`), un `HEAD` ordinaire au contenu valide, `objects/` et
 * `refs/` réels. Un `HEAD` seulement lisible ne suffit pas. Tout se lit par le
 * système de fichiers : aucun processus git, les compteurs d'invocations restent ceux
 * d'avant.
 */

/** Le nom du marqueur, et le préfixe de sa préparation — jamais pris pour un marqueur. */
export const MARQUEUR = ".git";
export const MARQUEUR_PREPARATION = ".git.preparation-";
/** Le HEAD que le runtime pose. */
export const HEAD_MARQUEUR = "ref: refs/heads/registres\n";
const HEAD_MAX = 4096;

export type EtatMarqueur =
  | { etat: "absent" }
  | { etat: "valide" }
  | { etat: "invalide"; raison: string };

function typeDe(chemin: string): "absent" | "repertoire" | "fichier" | "lien" | "autre" {
  let st;
  try {
    st = lstatSync(chemin);
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") return "absent";
    throw err;
  }
  if (st.isSymbolicLink()) return "lien";
  if (st.isDirectory()) return "repertoire";
  if (st.isFile()) return "fichier";
  return "autre";
}

/**
 * Un contenu de HEAD reconnu : référence symbolique `ref: refs/<nom>`, où `<nom>` est fait de
 * `[A-Za-z0-9._/-]`, sans `..`, sans `//`, sans `/` final ni composant `.` ; ou identifiant d'objet.
 */
export function headValide(contenu: string): boolean {
  if (/^[0-9a-f]{40}\n$/.test(contenu) || /^[0-9a-f]{64}\n$/.test(contenu)) return true;
  const m = /^ref: refs\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)\n$/.exec(contenu);
  return m !== null && !m[1].includes("..") && !m[1].split("/").some((p) => p === ".");
}

/**
 * L'état du marqueur de `dir`, sans rien écrire et sans git.
 *
 * Absent si `dir` ou son `.git` n'existent pas. Invalide si `dir` existe sans être un
 * répertoire réel, ou si `.git` existe sous une autre forme que la forme reconnue.
 */
export function etatMarqueur(dir: string): EtatMarqueur {
  const tDir = typeDe(dir);
  if (tDir === "absent") return { etat: "absent" };
  if (tDir !== "repertoire") return { etat: "invalide", raison: `l'espace des runs n'est pas un répertoire réel (${tDir})` };
  const git = join(dir, MARQUEUR);
  const tGit = typeDe(git);
  if (tGit === "absent") return { etat: "absent" };
  if (tGit !== "repertoire") return { etat: "invalide", raison: `${MARQUEUR} n'est pas un répertoire réel (${tGit})` };
  const head = join(git, "HEAD");
  const tHead = typeDe(head);
  if (tHead !== "fichier") return { etat: "invalide", raison: `${MARQUEUR}/HEAD absent ou non ordinaire (${tHead})` };
  if (lstatSync(head).size > HEAD_MAX) return { etat: "invalide", raison: `${MARQUEUR}/HEAD trop long` };
  if (!headValide(readFileSync(head, "utf-8"))) return { etat: "invalide", raison: `${MARQUEUR}/HEAD au contenu invalide` };
  for (const sous of ["objects", "refs"]) {
    const t = typeDe(join(git, sous));
    if (t !== "repertoire") return { etat: "invalide", raison: `${MARQUEUR}/${sous} absent ou non répertoire (${t})` };
  }
  return { etat: "valide" };
}
