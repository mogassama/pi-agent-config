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
 * **Ce qui n'est pas ici.** Aucune file de merge ni décision d'ordonnancement.
 * Le scheduler décide qui tourne en même temps ; ce module décide seulement
 * qu'une lane est isolée et sous quelles conditions elle rejoint l'intégration.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { recordGitInvocation } from "./git-probe-counter.ts";

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
  /**
   * Le commit qui porte l'intégration, sur un merge réussi.
   *
   * C'est la preuve que le registre enregistre. Sans elle, l'appelant devrait
   * relire HEAD lui-même après coup — donc entre le merge et la lecture, et une
   * lane suivante intégrée dans cet intervalle lui donnerait le mauvais commit.
   * Le rendre ici lie le SHA à l'opération qui l'a créé.
   */
  commit?: string;
  /**
   * Le commit gelé de la lane, quand un conflit a empêché son intégration.
   *
   * C'est `P2`, et il ne se retrouve pas après coup. Le rollback ramène la
   * branche à `previousHead` pour que la lane redevienne sale et son travail
   * visible — donc `laneTip` rend, après un conflit, le commit d'**avant** le
   * gel. Chercher `P2` là ouvrirait le contexte d'intégration sur l'état que le
   * reviewer n'a pas approuvé.
   *
   * L'objet est brièvement sans référence, et son contenu existe : le contexte
   * d'intégration le référence dès son ouverture. Si le processus meurt avant,
   * la lane sale est intacte et un nouveau gel le refera — rien n'est perdu.
   */
  frozenCommit?: string;
}

function git(cwd: string, args: string[]): string {
  // La feuille qui lance : `tryGit` passe par ici et n'incrémente pas lui-même.
  recordGitInvocation();
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
): { cwd: string; branch: string; created: boolean; base?: string } {
  const cwd = join(lanesDir(root), laneId);
  const branch = laneBranch(laneId);
  if (existsSync(cwd)) return { cwd, branch, created: false };

  const known = tryGit(root, ["rev-parse", "--verify", branch]).ok;
  const args = known
    ? ["worktree", "add", cwd, branch]
    : ["worktree", "add", "-b", branch, cwd, base];
  /*
   * Le commit d'où **cette lane** part, résolu avant de la créer.
   *
   * La base du run ne suffit pas. Une lane ouverte après l'intégration d'une
   * autre unité part d'un HEAD déjà avancé : compter ses commits depuis la base
   * du run y trouve ceux de l'unité précédente, et une lane qui n'a rien fait
   * passe pour intégrée. Le défaut d'origine, simplement retardé jusqu'au
   * premier merge.
   */
  const resolu = tryGit(root, ["rev-parse", "--verify", base]);
  const added = tryGit(root, args);
  if (!added.ok) throw new Error(`worktree ${laneId}: ${added.out.trim()}`);
  return { cwd, branch, created: true, base: resolu.ok ? resolu.out.trim() : undefined };
}

/**
 * Les unités qui ont une branche de lane dans ce run.
 *
 * Troisième source d'observation, à côté du registre et des worktrees. Sans
 * elle, une branche mergée dont le worktree a été retiré et que le registre
 * ignore reste invisible : ni événement, ni worktree, donc aucun candidat à
 * examiner. C'est pourtant le cas même d'une intégration sans provenance.
 */
export function runBranches(root: string, runId: string): string[] {
  const prefixe = laneBranch(`${runId}-`);
  const { ok, out } = tryGit(root, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefixe}*`]);
  if (!ok) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((b) => b.slice(prefixe.length))
    .filter(Boolean)
    .sort();
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
/**
 * Les messages que le runtime écrit, conventionnels.
 *
 * Ils ne l'étaient pas : `subagent: lane <id>` et `subagent: integrate lane
 * <id>` échouent tous deux sur un hook `commit-msg` qui exige des Conventional
 * Commits — celui de ce dépôt, par exemple. Une session qui installe ce hook
 * voyait donc le gel de ses lanes refusé, ce qui n'a été découvert qu'en
 * faisant passer le commit d'intégration par `git commit` plutôt que par
 * `commit-tree`.
 *
 * Ce n'est pas une garantie que tout hook les acceptera, et ce n'en est pas
 * l'objet : les hooks restent souverains, et leur refus est respecté. C'est une
 * valeur par défaut cohérente avec le dépôt qui développe pi lui-même.
 */
export function freezeMessage(laneId: string): string {
  return `chore(subagent): freeze ${laneId}`;
}

export function mergeMessage(laneId: string): string {
  return `chore(subagent): integrate ${laneId}`;
}

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
  /**
   * Le commit que le gel vient de créer.
   *
   * Il survit à son propre rollback : quand l'intégration échoue, `mergeLane`
   * ramène la branche à `previousHead`, mais l'objet reste dans le dépôt et
   * c'est lui — et jamais la branche après rollback — qui porte le travail que
   * le reviewer a approuvé.
   */
  commit?: string;
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
  const apres = tryGit(cwd, ["rev-parse", "HEAD"]);
  return {
    status: "committed",
    reason: "",
    previousHead: head.ok ? head.out.trim() : undefined,
    commit: apres.ok ? apres.out.trim() : undefined,
  };
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
  /*
   * Le gel porte son propre message, jamais celui du merge.
   *
   * Le message de l'appelant servait aux deux, si bien qu'un seul texte
   * racontait deux événements différents : « voici l'état figé de la lane » et
   * « voici son intégration dans la base ». Un journal qui les confond ne
   * distingue plus la lane de son entrée.
   */
  const frozen = commitLane(root, laneId, freezeMessage(laneId));
  if (frozen.status === "failed") {
    return { ok: false, conflicts: [], reason: `gel impossible : ${frozen.reason}` };
  }

  const branch = laneBranch(laneId);
  const merged = tryGit(root, [
    "merge",
    "--no-ff",
    "-m",
    message ?? mergeMessage(laneId),
    branch,
  ]);
  if (merged.ok) {
    /*
     * Le HEAD lu immédiatement après le merge, dans la même fonction.
     *
     * Si la lecture échoue, l'intégration a bien eu lieu mais n'a pas de preuve
     * durable : on rend le succès sans commit, et le registre retombera sur la
     * preuve par branche. Inventer un SHA ou traiter le merge comme un échec
     * seraient tous deux faux — le travail est dans l'intégration.
     */
    const tete = tryGit(root, ["rev-parse", "HEAD"]);
    const sha = tete.ok ? tete.out.trim() : "";
    return { ok: true, conflicts: [], reason: "", commit: sha || undefined };
  }

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
  return {
    ok: false,
    conflicts: files,
    reason: `conflit git sur ${files.length} fichier(s)`,
    frozenCommit: frozen.commit,
  };
}

/**
 * Intégrer une lane, enregistrer la preuve, puis seulement nettoyer.
 *
 * L'ordre est l'invariant, et il ne tenait jusqu'ici que dans un commentaire de
 * l'appelant : `removeLane` passait avant l'écriture de l'événement, si bien
 * qu'un crash entre les deux laissait un worktree retiré, une lane ouverte au
 * registre, et une intégration à deviner. La fenêtre est petite, mais elle
 * s'ouvre exactement au moment où le run est le plus difficile à reconstruire.
 *
 * L'enregistrement est passé en argument plutôt qu'appelé depuis ici : ce module
 * ne connaît ni le manifeste, ni le bail, ni le registre. Ce qui rend aussi
 * l'ordre vérifiable en une ligne, sans monter un run.
 *
 * Si l'enregistrement échoue, le nettoyage n'a pas lieu et l'erreur remonte : le
 * worktree survit, et la reprise nomme « intégration non enregistrée » — le
 * registre en retard sur la réalité, jamais l'inverse.
 */
export function integrateLane(
  root: string,
  laneId: string,
  blocks: readonly MergeBlock[],
  message: string | undefined,
  enregistrer: (commit?: string) => void,
): LaneMerge {
  const merge = mergeLane(root, laneId, blocks, message);
  if (!merge.ok) return merge;
  enregistrer(merge.commit);
  removeLane(root, laneId);
  return merge;
}

/**
 * Parmi ces commits d'intégration, lesquels le dépôt confirme-t-il ?
 *
 * Une seule question posée à git : ce commit est-il dans l'histoire de HEAD ?
 * Elle couvre tout ce qu'il y a à couvrir — un SHA inconnu du dépôt, un objet
 * qui n'est pas un commit, un commit défait par un retour en arrière : dans les
 * trois cas `merge-base --is-ancestor` échoue, et la réponse juste est « non ».
 *
 * Une première version vérifiait d'abord l'existence de l'objet par
 * `cat-file -e <sha>^{commit}`. La contre-épreuve ne tombait pas : le retirer
 * ne changeait aucun résultat, parce que la condition suivante rejetait déjà
 * les mêmes entrées. C'était donc du code qui décrivait une garde sans en être
 * une — et une garde qu'on croit avoir est pire que pas de garde.
 *
 * Si un jour le relevé doit distinguer « commit inconnu du dépôt » de « commit
 * défait », c'est un diagnostic à rendre, pas une condition à rajouter ici.
 */
export function confirmIntegrations(root: string, shas: readonly string[]): string[] {
  const confirmes: string[] = [];
  for (const sha of new Set(shas)) {
    if (!sha) continue;
    if (!tryGit(root, ["merge-base", "--is-ancestor", sha, "HEAD"]).ok) continue;
    confirmes.push(sha);
  }
  return confirmes;
}

/**
 * Abandonner une lane : enregistrer la décision, puis retirer son worktree.
 *
 * L'abandon est une décision, pas un effet — il n'y a rien à produire dans git
 * avant de l'écrire. L'ordre est donc celui de `closeAttempt` : le fait d'abord,
 * le rangement ensuite. Un crash entre les deux laisse `residu-d-abandon`, que
 * la réconciliation nomme et que l'opérateur range ; l'ordre inverse laisserait
 * un worktree disparu sous une unité que le registre croit vivante.
 *
 * **La branche survit, et c'est le point.** `removeLane` ne retire que le
 * worktree : la branche porte le travail abandonné, et c'est la seule chose qui
 * le désigne encore. Abandonner une unité n'est pas détruire ce qu'elle a
 * produit — quelqu'un peut vouloir le relire, ou s'apercevoir que l'abandon
 * était une erreur.
 *
 * **Et une lane sale ne s'abandonne pas.** Retirer son worktree détruirait des
 * changements que sa branche ne contient pas — ce qui est exactement l'inverse
 * de ce que l'abandon promet. Le cas n'a rien de théorique : le rollback après
 * un conflit ramène volontairement la branche à son ancien sommet en laissant le
 * travail sous forme non commitée, et une unité déclarée intégrée sans preuve
 * git est classée `integration-non-confirmee` sans que le contrôle de saleté ait
 * eu l'occasion de dire quoi que ce soit.
 *
 * On ne commite pas non plus à la place de quelqu'un : cela transformerait du
 * contenu que personne n'a revu en histoire git. Abandonner préserve ce qui
 * existe ; détruire un surplus physique est une autre décision, qui a son propre
 * verbe.
 *
 * Le nettoyage est passé en argument pour la même raison qu'ailleurs : c'est ce
 * qui rend l'ordre vérifiable sans provoquer une vraie panne.
 */
export function abandonLane(
  root: string,
  laneId: string,
  enregistrer: () => void,
  nettoyer: (root: string, laneId: string) => boolean,
): void {
  if (openLanes(root).includes(laneId)) {
    const sales = laneChanges(root, laneId);
    if (sales.length > 0) {
      throw new Error(
        `${laneId} porte encore ${sales.length} changement(s) hors de sa branche : ` +
        `${sales.slice(0, 3).join(", ")}${sales.length > 3 ? " …" : ""}. ` +
        "Abandonner conserve le travail existant ; retirer ce worktree le détruirait. " +
        "Conserver ou résoudre ces changements d'abord — ou choisir `discard` si leur " +
        "destruction est bien la décision voulue.",
      );
    }
  }
  enregistrer();
  if (!nettoyer(root, laneId)) {
    throw new Error(
      `${laneId} est abandonnée au registre, mais son worktree n'a pas pu être retiré. ` +
      "C'est un résidu d'abandon : la décision tient, le rangement reste à faire.",
    );
  }
}

/**
 * Le travail de cette lane est-il déjà dans l'intégration ?
 *
 * Ce que git sait, indépendamment de ce que le registre a eu le temps
 * d'enregistrer. Un merge réussi suivi d'un crash laisse précisément cet écart,
 * et c'est cette question qui permet de le nommer plutôt que de le deviner.
 */
export function isMerged(root: string, laneId: string, base: string): boolean {
  const branch = laneBranch(laneId);
  if (!tryGit(root, ["rev-parse", "--verify", branch]).ok) return false;

  /*
   * Deux conditions, et la première est celle qui manquait.
   *
   * « Ancêtre de HEAD » ne suffit pas : une lane fraîche pointe sur HEAD, donc
   * elle en est trivialement l'ancêtre et passait pour intégrée. Toute lane
   * ouverte produisait alors une fausse contradiction « intégration non
   * enregistrée » à la reprise suivante.
   *
   * Une lane est intégrée si elle a produit quelque chose depuis sa base propre
   * **et** que ce quelque chose est dans l'intégration. Sans commit propre il
   * n'y a rien à intégrer, et « pas intégrée » est la réponse juste.
   */
  const propres = tryGit(root, ["rev-list", "--count", `${base}..${branch}`]);
  if (!propres.ok || Number(propres.out.trim()) === 0) return false;
  return tryGit(root, ["merge-base", "--is-ancestor", branch, "HEAD"]).ok;
}

/**
 * Le sommet de la branche d'une lane, ou rien si elle n'existe pas.
 *
 * Sert à décider si une branche orpheline peut être adoptée sans mentir : si
 * elle n'apporte rien à l'intégration, son sommet est une base honnête ; si
 * elle a divergé, on ne sait pas d'où elle est partie.
 */
export function laneTip(root: string, laneId: string): string | undefined {
  const r = tryGit(root, ["rev-parse", "--verify", laneBranch(laneId)]);
  return r.ok ? r.out.trim() : undefined;
}

/**
 * La branche apporte-t-elle quelque chose que l'intégration n'a pas ?
 *
 * Une branche qui n'a pas divergé n'a pas de commit propre : son sommet est
 * alors un point de départ défendable. Une branche divergée a une histoire
 * qu'on ne sait pas situer.
 */
export function laneHasDiverged(root: string, laneId: string): boolean {
  const branch = laneBranch(laneId);
  if (!tryGit(root, ["rev-parse", "--verify", branch]).ok) return false;
  return !tryGit(root, ["merge-base", "--is-ancestor", branch, "HEAD"]).ok;
}

/** Nombre de commits de lane qui ne sont pas dans l'intégration courante. */
export function laneUnmergedCommitCount(root: string, laneId: string): number | undefined {
  const branch = laneBranch(laneId);
  if (!tryGit(root, ["rev-parse", "--verify", branch]).ok) return undefined;
  const r = tryGit(root, ["rev-list", "--count", `HEAD..${branch}`]);
  if (!r.ok) return undefined;
  const n = Number(r.out.trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Supprime la branche d'une lane.
 *
 * Séparé du retrait du worktree, parce que ce n'est pas la même décision : la
 * branche porte le travail et la preuve d'intégration. On ne la supprime que
 * pour une branche parasite, dont on a établi qu'elle n'a aucune provenance.
 */
export function removeLaneBranch(root: string, laneId: string, force = false): boolean {
  // `-d` par défaut : `-D` n'est utilisé qu'après confirmation explicite quand
  // des commits non intégrés seraient détruits.
  return tryGit(root, ["branch", force ? "-D" : "-d", laneBranch(laneId)]).ok;
}

/** Retire le worktree d'une lane. La branche survit : elle porte le travail. */
export function removeLane(root: string, laneId: string): boolean {
  const cwd = join(lanesDir(root), laneId);
  if (!existsSync(cwd)) return false;
  return tryGit(root, ["worktree", "remove", "--force", cwd]).ok;
}
