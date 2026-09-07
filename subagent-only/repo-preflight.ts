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
 */

import { execFileSync } from "node:child_process";

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
  return { ok: true };
}
