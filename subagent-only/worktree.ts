/**
 * Un worktree git par lane, et ce qu'on a le droit d'en intégrer.
 *
 * Deux WorkUnits qui écrivent le même fichier ne peuvent pas partager un arbre
 * de travail, et deux reviews qui se suivent ne doivent pas voir le diff l'une
 * de l'autre. Le worktree règle les deux d'un coup : chaque lane a son
 * répertoire, sa branche, et son `git status` à elle.
 *
 * **Où ils vivent.** Sous le répertoire git commun, pas dans l'arbre de travail.
 * `treeState` interroge `git status --porcelain --untracked-files=all` et on
 * vient d'en faire l'autorité sur ce qu'une délégation a écrit : un worktree
 * posé dans le dépôt apparaîtrait dans chaque observation, de chaque lane. Sous
 * `.git/` il est invisible au statut, sur le même système de fichiers, et il
 * disparaît avec le dépôt de test.
 *
 * **Ce qui n'est pas ici.** Aucune file de merge, aucun ordonnancement, aucune
 * concurrence. Une lane est créée, travaillée, revue, puis intégrée ou non. Le
 * lot 3 décidera qui tourne en même temps ; ce module décide seulement qu'une
 * lane est isolée et sous quelles conditions elle rejoint l'intégration.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Ce qui interdit d'intégrer une lane, quoi que dise la review. */
export type MergeBlock =
  | "reserved-violation"
  | "scope-breach"
  | "not-approved"
  /**
   * Une review approuvée qui laisse un risque ouvert n'est pas terminée.
   *
   * `approved` + `open_risks` est le cas que tout le pont reviewer → scout →
   * follow-up review existe pour traiter. Intégrer là-dessus retirerait le
   * worktree, et la continuation repartirait d'une base qui contient déjà le
   * changement : le diff de la lane serait vide alors que la frontière de review
   * croit encore avoir quelque chose à poursuivre.
   */
  | "open-risks";

export interface LaneMerge {
  ok: boolean;
  /** Fichiers en conflit, quand git a refusé. */
  conflicts: string[];
  reason: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function tryGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(cwd, args) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` };
  }
}

/**
 * Le répertoire où poser les worktrees d'un dépôt.
 *
 * `--git-common-dir` et non `--git-dir` : depuis un worktree, le second désigne
 * le sous-répertoire de ce worktree, et les lanes se retrouveraient imbriquées.
 */
export function lanesDir(root: string): string {
  const { ok, out } = tryGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const gitDir = ok ? out.trim() : join(root, ".git");
  return join(gitDir, "pi-lanes");
}

/** `pi-lane/<laneId>`. Préfixé pour qu'aucune branche du dépôt ne puisse collisionner. */
export function laneBranch(laneId: string): string {
  return `pi-lane/${laneId}`;
}

/**
 * Le worktree d'une lane, créé s'il n'existe pas, réutilisé sinon.
 *
 * Réutilisé, parce qu'un rework appartient à la même unité que la tentative
 * qu'il reprend : même worktree, même branche, même état. C'est tout l'intérêt
 * de la lane — le worker de reprise retrouve ce que le premier a laissé, et le
 * reviewer voit le changement complet et non le seul correctif.
 */
export function ensureLane(
  root: string,
  laneId: string,
  base = "HEAD",
): { cwd: string; branch: string; created: boolean } {
  const cwd = join(lanesDir(root), laneId);
  const branch = laneBranch(laneId);
  if (existsSync(cwd)) return { cwd, branch, created: false };

  const known = tryGit(root, ["rev-parse", "--verify", branch]).ok;
  const args = known
    ? ["worktree", "add", cwd, branch]
    : ["worktree", "add", "-b", branch, cwd, base];
  const added = tryGit(root, args);
  if (!added.ok) throw new Error(`worktree ${laneId}: ${added.out.trim()}`);
  return { cwd, branch, created: true };
}

/** Les lanes ouvertes sur ce dépôt, par identifiant. */
export function openLanes(root: string): string[] {
  const { ok, out } = tryGit(root, ["worktree", "list", "--porcelain"]);
  if (!ok) return [];
  const dir = lanesDir(root);
  return out
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter((p) => p.startsWith(`${dir}/`))
    .map((p) => p.slice(dir.length + 1));
}

/**
 * Ce qu'une lane a écrit, du point de vue de sa branche.
 *
 * Le diff de la lane contre sa base, pas contre l'intégration : une lane
 * intégrée entre-temps ne doit pas grossir la review de la suivante. C'est la
 * propriété de review locale que `review-boundary.ts` prépare depuis le début,
 * et la perdre ici l'annulerait partout.
 */
export function laneChanges(root: string, laneId: string, base = "HEAD"): string[] {
  const cwd = join(lanesDir(root), laneId);
  if (!existsSync(cwd)) return [];
  const { ok, out } = tryGit(cwd, ["diff", "--name-only", base]);
  const committed = ok ? out.split("\n").filter(Boolean) : [];
  const dirty = tryGit(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  const working = dirty.ok
    ? dirty.out.split("\n").filter(Boolean).map((l) => l.slice(3)).filter(Boolean)
    : [];
  return [...new Set([...committed, ...working])].sort();
}

/**
 * Intègre une lane, ou dit pourquoi elle n'est pas intégrable.
 *
 * Les blocages sont vérifiés avant git, et ils ne sont pas des conflits :
 * une lane qui a écrit sur un chemin réservé ou débordé de son scope peut très
 * bien merger proprement. C'est précisément le danger — le merge propre
 * laisserait passer une hypothèse devenue fausse. Git est le dernier filet,
 * jamais la preuve d'indépendance.
 */
/**
 * Fige ce que la lane a écrit, sur sa branche.
 *
 * Un worker écrit dans le worktree et ne commite pas : sans ceci, `git merge`
 * intégrerait une branche identique à sa base et le travail resterait dans un
 * répertoire que le retrait du worktree effacerait. Le commit est donc une
 * étape de l'intégration, pas une commodité.
 *
 * Rien à figer n'est pas une erreur : une lane dont la review approuve sans
 * qu'aucun fichier n'ait changé est légitime.
 */
export interface CommitResult {
  status: "clean" | "committed" | "failed";
  reason: string;
  /**
   * Le HEAD de la lane avant le gel, quand il y a eu gel.
   *
   * Sert à défaire ce commit si l'intégration échoue ensuite. Sans lui, un
   * conflit laisserait la lane avec un HEAD avancé et un arbre propre : son
   * changement deviendrait invisible à `laneChanges`, donc au dépassement de
   * scope et à la review de reprise. La lane survivrait sans que le runtime
   * voie ce qu'elle contient.
   */
  previousHead?: string;
}

export function commitLane(root: string, laneId: string, message: string): CommitResult {
  const cwd = join(lanesDir(root), laneId);
  if (!existsSync(cwd)) return { status: "failed", reason: "aucun worktree" };
  const dirty = tryGit(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  if (!dirty.ok) return { status: "failed", reason: `git status: ${dirty.out.trim()}` };
  if (dirty.out.trim() === "") return { status: "clean", reason: "" };
  const head = tryGit(cwd, ["rev-parse", "HEAD"]);
  const staged = tryGit(cwd, ["add", "-A"]);
  if (!staged.ok) return { status: "failed", reason: `git add: ${staged.out.trim()}` };
  const done = tryGit(cwd, ["commit", "-q", "-m", message]);
  if (!done.ok) {
    /*
     * Rendre son index à la lane. Le `git add` a réussi, le commit non : sans
     * ceci, une tentative d'intégration ratée laisse la lane dans un état
     * qu'elle n'avait pas avant — les fichiers indexés au lieu de simplement
     * modifiés.
     *
     * Le travail ne serait pas perdu, mais toute la correction du rollback
     * après conflit repose sur la même propriété : une intégration qui échoue
     * doit rendre la lane exploitable exactement comme avant la tentative. Le
     * runtime est le seul propriétaire mécanique du gel, donc le seul à devoir
     * le défaire entièrement.
     *
     * `reset --mixed HEAD` ne touche pas aux fichiers.
     */
    tryGit(cwd, ["reset", "--mixed", "HEAD"]);
    return { status: "failed", reason: `git commit: ${done.out.trim()}` };
  }
  return { status: "committed", reason: "", previousHead: head.ok ? head.out.trim() : undefined };
}

export function mergeLane(
  root: string,
  laneId: string,
  blocks: readonly MergeBlock[],
  message?: string,
): LaneMerge {
  if (blocks.length > 0) {
    return { ok: false, conflicts: [], reason: `non intégrable : ${blocks.join(", ")}` };
  }
  /*
   * Figer avant d'intégrer, et refuser si le gel échoue.
   *
   * Ignorer l'échec rouvrait exactement le trou que ce commit devait fermer :
   * la branche reste à sa base, le merge réussit en n'apportant rien, le
   * worktree est retiré, et le travail disparaît. Une lane sale dont le commit
   * échoue n'est pas intégrable — et surtout, elle garde son arbre.
   */
  const frozen = commitLane(root, laneId, message ?? `subagent: lane ${laneId}`);
  if (frozen.status === "failed") {
    return { ok: false, conflicts: [], reason: `gel impossible : ${frozen.reason}` };
  }

  const branch = laneBranch(laneId);
  const merged = tryGit(root, [
    "merge",
    "--no-ff",
    "-m",
    message ?? `subagent: integrate lane ${laneId}`,
    branch,
  ]);
  if (merged.ok) return { ok: true, conflicts: [], reason: "" };

  const conflicts = tryGit(root, ["diff", "--name-only", "--diff-filter=U"]);
  const files = conflicts.ok ? conflicts.out.split("\n").filter(Boolean) : [];
  // Laisser un merge en cours derrière soi rendrait le dépôt inutilisable pour
  // la lane suivante ; l'échec est une information, pas un état à conserver.
  tryGit(root, ["merge", "--abort"]);

  /*
   * Défaire le gel que cette tentative vient de créer, sans toucher aux fichiers.
   *
   * Le commit a fait avancer le HEAD de la lane. L'intégration ayant échoué, le
   * laisser rendrait la lane propre et son changement invisible : `laneChanges`
   * comparerait à un HEAD qui contient déjà tout, le dépassement de scope
   * porterait sur une liste vide, et la review de reprise n'aurait rien à lire.
   * La lane survivrait sans que le runtime voie ce qu'elle contient — la
   * variante exacte du problème que le gel devait supprimer.
   *
   * `reset --mixed` remet le HEAD et l'index où ils étaient et laisse l'arbre de
   * travail intact : la lane redevient sale, comme avant la tentative.
   */
  if (frozen.status === "committed" && frozen.previousHead) {
    tryGit(join(lanesDir(root), laneId), ["reset", "--mixed", frozen.previousHead]);
  }
  return { ok: false, conflicts: files, reason: `conflit git sur ${files.length} fichier(s)` };
}

/** Retire le worktree d'une lane. La branche survit : elle porte le travail. */
export function removeLane(root: string, laneId: string): boolean {
  const cwd = join(lanesDir(root), laneId);
  if (!existsSync(cwd)) return false;
  return tryGit(root, ["worktree", "remove", "--force", cwd]).ok;
}
