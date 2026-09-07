/**
 * Le contexte d'intégration : où se résout la rencontre entre une lane et la
 * base courante, et comment on prouve que ce qui est intégré est ce qui a été
 * revu.
 *
 * **Un troisième lieu, ni la lane ni la racine.** Une résolution de conflit
 * n'existe dans aucune lane : par construction, elle porte sur la rencontre de
 * deux histoires. La faire dans le worktree de la lane demanderait au worker de
 * réparer quelque chose qui n'apparaît qu'au merge ; la faire dans la racine y
 * laisserait un merge en cours pendant qu'une autre voie travaille. Le contexte
 * d'intégration est donc un worktree jetable, détaché, sous
 * `.git/pi-integrations/`.
 *
 * **Détaché, et pas une branche.** Une branche serait une identité durable
 * parallèle aux lanes, avec sa provenance à tenir et son entrée dans
 * `runBranches`. Ce n'est pas ce qu'on construit : c'est un espace de travail
 * pour fabriquer un seul commit, `M`, et disparaître. Aucune branche durable
 * n'est créée ; seul le `HEAD` détaché du contexte avance, ce qui rend `M`
 * observable dans le contexte tant qu'il n'a pas atterri.
 *
 * **Le tree, pas le commit, est l'objet de la review.** L'agent résout des
 * fichiers ; il ne touche jamais à git. Le runtime stage le résultat et en tire
 * un tree `T`. La review porte sur `T` par deux vues :
 *
 * ```text
 * P1 → T                    ce qui entrerait réellement dans la base
 * P2 → T sur les conflits   le résultat sur les seuls fichiers qu'il a fallu résoudre
 * ```
 *
 * La seconde vue est restreinte, et la restriction est le fruit d'une erreur.
 * `P2 → T` non filtré porte aussi tout ce que la base a acquis depuis que la
 * lane est partie : une unité intégrée entre-temps est absente de `P2` et
 * présente dans `T`, donc elle apparaît dans ce diff sans que personne l'ait
 * touchée. Filtrer sur les fichiers en conflit garde ce que la vue promet — le
 * résultat de la résolution — et laisse tomber ce qu'elle ne promettait pas.
 *
 * `laneChanges` ne conviendrait pour aucune des deux : il compare la lane à
 * HEAD, donc il bouge quand la base bouge, pendant la tentative.
 *
 * **Ce qui est intégré est exactement ce qui a été revu.** `T` est recalculé
 * après l'approbation et doit être identique ; `M` est créé par le runtime avec
 * `git commit`, comme le gel d'une lane — un dépôt dont les hooks refusent
 * certains commits ne doit pas voir pi les contourner précisément lors des
 * conflits. Ses postconditions sont ensuite vérifiées sur le dépôt : « le commit
 * a réussi » est une affirmation plus faible que « il a créé exactement le merge
 * demandé », et un hook peut toucher à l'index avant de laisser passer.
 *
 * **La racine est un point d'intégration, pas un espace de travail.** Elle doit
 * être propre à l'ouverture — sinon `P1` ne représente pas toute sa réalité — et
 * encore propre au moment d'avancer. Et elle n'avance que si elle est toujours
 * exactement sur `P1` : si elle a bougé, la tentative est périmée et on
 * recommence depuis la nouvelle réalité, sans réconciliation opportuniste.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { recordGitInvocation } from "./git-probe-counter.ts";


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
 * Le répertoire des contextes d'intégration.
 *
 * `--git-common-dir` pour la même raison que `lanesDir` : depuis un worktree,
 * `--git-dir` désigne le sous-répertoire de ce worktree, et les contextes se
 * retrouveraient imbriqués dans une lane.
 */
export function integrationsDir(root: string): string {
  const { ok, out } = tryGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const gitDir = ok ? out.trim() : join(root, ".git");
  return join(gitDir, "pi-integrations");
}

/**
 * Ce que la racine porte et qu'aucun commit ne représente.
 *
 * `--untracked-files=all` : un fichier non suivi compte. Il ne bloque pas un
 * `merge --ff-only` — vérifié : un fichier sale sans chevauchement laisse le ff
 * réussir et reste là — donc l'échec de git ne suffit pas à tenir l'invariant.
 * La racine est un point d'intégration, pas un espace de travail : ce qu'elle
 * porte doit être dans son histoire.
 *
 * Les fichiers ignorés ne comptent pas, ce qui suppose que le dépôt cible ignore
 * `.pi-subagent-runs/`. Sans cette entrée, l'instrumentation du run rendrait la
 * racine perpétuellement sale et aucune intégration ne partirait.
 */
export function dirtyRoot(root: string): string[] {
  const { ok, out } = tryGit(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (!ok) return ["statut illisible"];
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}


export interface IntegrationAttempt {
  /** Le worktree jetable, détaché sur `P1`. */
  dir: string;
  id: string;
  /** La base d'intégration au moment de l'ouverture. Immuable pour la tentative. */
  p1: string;
  /** Le commit gelé de la lane. Immuable pour la tentative. */
  p2: string;
  /** Vrai quand git a fusionné sans rien demander à personne. */
  clean: boolean;
  /**
   * Les fichiers que git n'a pas su fusionner, tels qu'ils étaient à
   * l'ouverture.
   *
   * Relevés ici et pas plus tard : une fois la résolution faite et stagée, plus
   * rien ne dit lesquels ont posé problème, et c'est ce que la review a besoin
   * de savoir pour juger la résolution plutôt que le diff entier.
   */
  conflicts: string[];
}

export type OpenResult =
  | { ok: true; attempt: IntegrationAttempt }
  | { ok: false; reason: string };

/**
 * Ouvrir une tentative d'intégration : un worktree détaché sur `P1`, avec le
 * merge de `P2` en cours dedans.
 *
 * `--no-ff --no-commit` : on veut l'état de merge, pas le commit. `--no-ff`
 * parce qu'un ff produirait un commit à un seul parent, et la postcondition qui
 * suit — deux parents, exactement `P1` et `P2` — ne serait plus vérifiable ;
 * `--no-commit` parce que créer le commit est la dernière étape, après la
 * review, et par `git commit` — donc soumis aux hooks du dépôt.
 *
 * Le merge propre est un cas normal, pas une erreur : il rend `clean: true` et
 * la suite est identique. Ce qui distingue les deux, c'est qu'aucun agent n'a à
 * être appelé.
 */
export function openIntegration(
  root: string,
  id: string,
  laneTipSha: string,
): OpenResult {
  const sale = dirtyRoot(root);
  if (sale.length > 0) {
    return {
      ok: false,
      reason:
        `la racine porte ${sale.length} entrée(s) qu'aucun commit ne représente : ` +
        `${sale.slice(0, 3).join(", ")}${sale.length > 3 ? " …" : ""}. ` +
        "P1 ne décrirait pas toute sa réalité.",
    };
  }

  const tete = tryGit(root, ["rev-parse", "HEAD"]);
  if (!tete.ok) return { ok: false, reason: `HEAD illisible : ${tete.out.trim()}` };
  const p1 = tete.out.trim();

  const cible = tryGit(root, ["rev-parse", `${laneTipSha}^{commit}`]);
  if (!cible.ok) return { ok: false, reason: `${laneTipSha} n'est pas un commit de ce dépôt` };
  const p2 = cible.out.trim();

  const dir = join(integrationsDir(root), id);
  if (existsSync(dir)) return { ok: false, reason: `la tentative ${id} existe déjà` };

  // Détaché : le contexte n'a pas d'identité durable et n'entre dans aucune
  // observation de branches.
  const cree = tryGit(root, ["worktree", "add", "--detach", dir, p1]);
  if (!cree.ok) return { ok: false, reason: `worktree refusé : ${cree.out.trim()}` };

  const merge = tryGit(dir, ["merge", "--no-ff", "--no-commit", p2]);
  if (merge.ok) {
    return { ok: true, attempt: { dir, id, p1, p2, clean: true, conflicts: [] } };
  }

  const nonFusionnes = tryGit(dir, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = nonFusionnes.ok
    ? nonFusionnes.out.split("\n").map((l) => l.trim()).filter(Boolean)
    : [];
  if (conflicts.length === 0) {
    // Un merge qui échoue sans conflit de contenu — un `.gitattributes` hostile,
    // un merge refusé pour une autre raison. On ne laisse pas un worktree dans
    // un état qu'on ne sait pas décrire.
    removeIntegration(root, id);
    return { ok: false, reason: `merge refusé sans conflit nommé : ${merge.out.trim()}` };
  }
  return { ok: true, attempt: { dir, id, p1, p2, clean: false, conflicts } };
}

export type TreeResult = { ok: true; tree: string } | { ok: false; reason: string };

/**
 * Le tree candidat, après résolution.
 *
 * Le staging est du runtime : l'agent n'a pas `git add`, donc l'index reste en
 * conflit jusqu'ici par construction. Vérifier « l'index ne contient plus
 * d'entrée non résolue » *avant* de stager refuserait donc toutes les
 * résolutions, y compris les bonnes — la garde utile est ailleurs.
 *
 * Elle est dans le contenu : `git diff --cached --check` relève les marqueurs de
 * conflit oubliés. Sans elle, un fichier contenant encore `<<<<<<<` se stage
 * proprement, produit un tree valide, et passe pour une résolution. Seuls les
 * marqueurs comptent — `--check` signale aussi les espaces en fin de ligne, et
 * refuser une intégration pour un espace serait un refus que personne ne
 * comprendrait.
 */
export function integrationTree(dir: string): TreeResult {
  const stage = tryGit(dir, ["add", "-A"]);
  if (!stage.ok) return { ok: false, reason: `staging refusé : ${stage.out.trim()}` };

  const restants = tryGit(dir, ["ls-files", "-u"]);
  if (restants.ok && restants.out.trim()) {
    return { ok: false, reason: "l'index porte encore des entrées non résolues" };
  }

  const check = tryGit(dir, ["diff", "--cached", "--check"]);
  const marqueurs = check.out
    .split("\n")
    .filter((l) => l.includes("leftover conflict marker"))
    .map((l) => l.trim());
  if (marqueurs.length > 0) {
    return {
      ok: false,
      reason: `marqueurs de conflit laissés dans la résolution :\n  ${marqueurs.join("\n  ")}`,
    };
  }

  const tree = tryGit(dir, ["write-tree"]);
  if (!tree.ok) return { ok: false, reason: `write-tree refusé : ${tree.out.trim()}` };
  return { ok: true, tree: tree.out.trim() };
}

export interface IntegrationReview {
  /** `P1 → T` : ce qui entrerait réellement dans la base. */
  fromBase: string;
  /**
   * `P2 → T`, restreint aux fichiers que l'intégration a dû résoudre.
   *
   * Non restreint, ce diff porte aussi tout ce que la base a acquis depuis le
   * départ de la lane : une unité intégrée entre-temps est absente de `P2`,
   * présente dans `T`, et apparaîtrait donc ici sans que personne l'ait touchée.
   * Le nom dit la restriction, parce que « ce que la résolution a changé » ne se
   * reconstruit pas exactement à partir de `P1`, `P2` et `T` seuls.
   */
  fromLaneOnConflicts: string;
  /** Les fichiers en conflit à l'ouverture, tels quels. */
  conflicts: readonly string[];
}

export type ReviewResult =
  | { ok: true; review: IntegrationReview }
  | { ok: false; reason: string };

/**
 * Les deux vues que la review reçoit, et rien d'autre.
 *
 * Échoue plutôt que de rendre une vue vide. Un `git diff` qui échoue produisait
 * `""`, indistinguable d'un diff légitimement vide — et le reviewer recevait
 * alors « rien à signaler » pour une intégration qu'on n'a pas su décrire. Le
 * contrat est que le reviewer reçoit l'objet exact : s'il n'est pas calculable,
 * personne n'est lancé.
 */
export function integrationReview(
  dir: string,
  attempt: Pick<IntegrationAttempt, "p1" | "p2" | "conflicts">,
  tree: string,
): ReviewResult {
  const base = tryGit(dir, ["diff", attempt.p1, tree]);
  if (!base.ok) return { ok: false, reason: `diff ${attempt.p1.slice(0, 12)}→T refusé` };

  // Sans conflit, il n'y a rien à montrer de la résolution : la vue est vide
  // parce qu'elle n'a pas d'objet, et non parce qu'un diff a échoué. Le passage
  // à git avec une liste de chemins vide rendrait au contraire le diff entier.
  if (attempt.conflicts.length === 0) {
    return {
      ok: true,
      review: { fromBase: base.out, fromLaneOnConflicts: "", conflicts: attempt.conflicts },
    };
  }

  const lane = tryGit(dir, ["diff", attempt.p2, tree, "--", ...attempt.conflicts]);
  if (!lane.ok) return { ok: false, reason: `diff ${attempt.p2.slice(0, 12)}→T refusé` };
  return {
    ok: true,
    review: { fromBase: base.out, fromLaneOnConflicts: lane.out, conflicts: attempt.conflicts },
  };
}

/**
 * `M` a-t-il exactement la forme demandée ? Null si oui, la raison sinon.
 *
 * Extraite pour être falsifiable. Dans le trajet nominal, `commit-tree` reçoit
 * le tree et les deux parents qu'on lui donne, donc la vérification ne peut pas
 * échouer et la retirer ne casse aucun test — une garde qu'on croit avoir. Elle
 * se teste ici sur un commit délibérément mal formé, ce qui est la seule façon
 * de savoir qu'elle attrape.
 *
 * Ce qu'elle protège n'est pas le bug d'aujourd'hui mais la construction de
 * demain : le jour où `M` sera fabriqué autrement — un octopus, un parent tiré
 * d'un autre endroit, un tree recalculé entre-temps — « `commit-tree` a réussi »
 * ne dira toujours rien de ce qu'il a créé.
 */
export function mergeShapeError(
  dir: string,
  m: string,
  tree: string,
  p1: string,
  p2: string,
): string | null {
  const treeDeM = tryGit(dir, ["rev-parse", `${m}^{tree}`]);
  if (!treeDeM.ok || treeDeM.out.trim() !== tree) {
    return `${m.slice(0, 12)} ne porte pas le tree revu`;
  }
  const parents = tryGit(dir, ["rev-list", "--parents", "-n", "1", m]);
  if (!parents.ok) return `${m.slice(0, 12)} est illisible`;
  const [, parent1, parent2, ...surplus] = parents.out.trim().split(/\s+/);
  if (parent1 !== p1 || parent2 !== p2 || surplus.length > 0) {
    return (
      `${m.slice(0, 12)} n'a pas exactement les deux parents attendus ` +
      `(${parent1?.slice(0, 12)}, ${parent2?.slice(0, 12)})`
    );
  }
  return null;
}

/**
 * `M`, avec ce qu'il faut pour le revalider avant de l'intégrer.
 *
 * Les quatre voyagent ensemble parce qu'ils se vérifient ensemble : un SHA seul
 * ne dit pas de quel tree ni de quels parents il devait être fait, et l'appelant
 * qui les rapprocherait à la main peut se tromper de rapprochement.
 */
export interface IntegrationCommit {
  commit: string;
  tree: string;
  p1: string;
  p2: string;
}

export type CommitIntegrationResult =
  | { ok: true; integration: IntegrationCommit }
  /**
   * `committed` dit si le commit a eu lieu avant l'échec.
   *
   * Depuis que `M` est créé par `git commit`, un échec de postcondition arrive
   * **après** que le contexte a avancé : son `HEAD` n'est plus `P1` et son
   * `MERGE_HEAD` a disparu. Un appelant qui traiterait les deux échecs de la
   * même façon renverrait un agent résoudre un conflit dans un contexte qui n'en
   * a plus, sans que rien puisse le reprendre.
   */
  | { ok: false; reason: string; committed: boolean };

/** Le message d'un commit d'intégration, fabriqué par le runtime. */
export function integrationMessage(workUnitId: string): string {
  return `chore(subagent): integrate ${workUnitId}`;
}

/**
 * Créer `M` : le merge que la review a approuvé, et lui seul.
 *
 * Trois vérifications avant, sur l'état du contexte : le tree recalculé doit
 * être celui qui a été revu, le HEAD du contexte doit être encore `P1`, et
 * `MERGE_HEAD` doit être encore `P2`. La première seule ne suffirait pas — un
 * contexte dont le merge a été défait puis refait autrement peut produire le
 * même tree pour une autre paire de parents.
 *
 * `git commit`, et non `commit-tree`. Le gel d'une lane passe déjà par
 * `git commit` : faire autrement ici voudrait dire qu'un dépôt peut avoir une
 * politique de commit que pi respecte partout sauf au moment des conflits.
 * `commit-tree` ne déclenche aucun hook, ce qui est précisément ce qu'on ne
 * veut pas. En échange, `M` devient le `HEAD` détaché du contexte, donc un
 * crash avant l'atterrissage le laisse observable là où il a été fait.
 *
 * Le message vient du runtime, pas de l'appelant : il est déductible de l'unité,
 * et le dépôt cible reste libre de le refuser par ses hooks.
 *
 * Les postconditions restent indispensables — un hook peut toucher à l'index
 * avant de laisser passer le commit, et « le commit a réussi » ne dirait alors
 * rien de ce qu'il contient.
 */
export function commitIntegration(
  attempt: Pick<IntegrationAttempt, "dir" | "p1" | "p2">,
  reviewedTree: string,
  workUnitId: string,
): CommitIntegrationResult {
  const recalcule = integrationTree(attempt.dir);
  if (!recalcule.ok) return { ok: false, committed: false, reason: recalcule.reason };
  if (recalcule.tree !== reviewedTree) {
    return {
      ok: false,
      committed: false,
      reason:
        `le contexte a changé depuis la review : tree revu ${reviewedTree.slice(0, 12)}, ` +
        `tree courant ${recalcule.tree.slice(0, 12)}`,
    };
  }

  const tete = tryGit(attempt.dir, ["rev-parse", "HEAD"]);
  if (!tete.ok || tete.out.trim() !== attempt.p1) {
    return { ok: false, committed: false, reason: "le contexte n'est plus sur sa base d'intégration" };
  }
  const mergeHead = tryGit(attempt.dir, ["rev-parse", "MERGE_HEAD"]);
  if (!mergeHead.ok || mergeHead.out.trim() !== attempt.p2) {
    return { ok: false, committed: false, reason: "le contexte ne fusionne plus le commit de la lane" };
  }

  const cree = tryGit(attempt.dir, ["commit", "-m", integrationMessage(workUnitId)]);
  // Un hook qui refuse laisse le contexte intact : rien n'a été créé.
  if (!cree.ok) return { ok: false, committed: false, reason: `commit refusé : ${cree.out.trim()}` };

  const apres = tryGit(attempt.dir, ["rev-parse", "HEAD"]);
  if (!apres.ok) return { ok: false, committed: true, reason: "HEAD du contexte illisible après le commit" };
  const m = apres.out.trim();

  const mauvaiseForme = mergeShapeError(attempt.dir, m, reviewedTree, attempt.p1, attempt.p2);
  if (mauvaiseForme) return { ok: false, committed: true, reason: mauvaiseForme };
  return { ok: true, integration: { commit: m, tree: reviewedTree, p1: attempt.p1, p2: attempt.p2 } };
}

export type LandResult =
  | { ok: true; commit: string }
  | { ok: false; stale: boolean; reason: string };

/**
 * Avancer la racine sur `M`, et seulement si tout est encore vrai.
 *
 * **La primitive d'effet revalide elle-même.** Elle recevait `P1` et `M` et
 * faisait confiance à l'appelant pour les avoir rapprochés correctement — or un
 * commit simple descendant de `P1` passe un `merge --ff-only` sans rien dire.
 * Une erreur de câblage suffisait donc à avancer la racine sur un commit qui
 * n'est ni le tree revu ni le merge attendu. Ce qui touche la racine ne dépend
 * plus d'une bonne association d'arguments en amont.
 *
 * La racine doit aussi être encore propre : elle a pu se salir pendant la
 * review, et un `ff-only` réussit très bien par-dessus un fichier sale sans
 * chevauchement, qu'il laisse ensuite là, hors de toute histoire.
 *
 * Aucune réconciliation opportuniste. Si la racine a bougé, la tentative est
 * périmée : même si le nouveau HEAD contient déjà une partie du travail, ce qui
 * a été revu n'est plus ce qui serait intégré. On refait depuis la nouvelle
 * réalité.
 *
 * L'enregistrement est passé en argument, comme pour `integrateLane`, et pour la
 * même raison : l'effet d'abord, l'événement ensuite. Il ne s'écrit qu'une fois
 * `M` réellement dans la racine. S'il échoue alors, `M` est intégré sans être
 * enregistré — une intégration non enregistrée, qui se diagnostique à la reprise
 * — et non un fait durable qui affirme faux.
 */
export function landIntegration(
  root: string,
  integration: IntegrationCommit,
  enregistrer: (commit: string) => void,
): LandResult {
  const { commit: m, tree, p1, p2 } = integration;

  const tete = tryGit(root, ["rev-parse", "HEAD"]);
  if (!tete.ok) return { ok: false, stale: false, reason: "HEAD de la racine illisible" };
  if (tete.out.trim() !== p1) {
    return {
      ok: false,
      stale: true,
      reason:
        `la base d'intégration a bougé : revue sur ${p1.slice(0, 12)}, ` +
        `racine sur ${tete.out.trim().slice(0, 12)}`,
    };
  }

  const sale = dirtyRoot(root);
  if (sale.length > 0) {
    return {
      ok: false,
      stale: false,
      reason:
        `la racine porte ${sale.length} entrée(s) qu'aucun commit ne représente : ` +
        `${sale.slice(0, 3).join(", ")}${sale.length > 3 ? " …" : ""}`,
    };
  }

  const mauvaiseForme = mergeShapeError(root, m, tree, p1, p2);
  if (mauvaiseForme) return { ok: false, stale: false, reason: mauvaiseForme };

  const ff = tryGit(root, ["merge", "--ff-only", m]);
  if (!ff.ok) return { ok: false, stale: false, reason: `avance refusée : ${ff.out.trim()}` };

  enregistrer(m);
  return { ok: true, commit: m };
}

/**
 * Remplacer une tentative par une autre : enregistrer, puis nettoyer.
 *
 * L'ordre est l'invariant, et il ne tenait que dans la disposition des lignes de
 * l'appelant. Ce lot existe pour donner un sens déterministe aux fenêtres de
 * crash ; laisser la plus importante d'entre elles sous forme de commentaire
 * serait la même faute qu'`integrateLane` corrigeait en 1a.
 *
 * ```text
 * ordre retenu    ATTEMPT_OPENED(I2) → SUPERSEDED(I1) → retrait de I1
 *                 crash au retrait → I1 remplacée, contexte présent : un résidu nommé
 * ordre inverse   retrait de I1 → SUPERSEDED(I1)
 *                 crash entre les deux → deux tentatives vivantes dont une sans
 *                 contexte : deux contradictions au lieu d'un résidu
 * ```
 *
 * Le nettoyage est passé en argument pour la même raison que l'enregistrement
 * l'était dans `integrateLane` : c'est ce qui rend l'ordre vérifiable sans
 * monter un run ni provoquer une vraie panne.
 */
export function supersedeAttempt(
  ancienneId: string,
  enregistrer: (etape: "opened" | "superseded") => void,
  nettoyer: (id: string) => void,
): void {
  enregistrer("opened");
  enregistrer("superseded");
  nettoyer(ancienneId);
}

/**
 * Clore une tentative : enregistrer, puis nettoyer.
 *
 * Même motif que `supersedeAttempt`, et pour la même raison. Un crash après
 * l'enregistrement laisse un contexte que le registre dit terminé : un résidu
 * nommé, que la reconstruction reconnaît et qu'un opérateur peut retirer. Un
 * crash dans l'autre ordre laisserait un contexte absent sous une tentative que
 * le registre croit vivante — une contradiction qui ferme le run, pour une
 * décision qui s'était pourtant bien passée.
 */
export function closeAttempt(
  ancienneId: string,
  enregistrer: () => void,
  nettoyer: (id: string) => void,
): void {
  enregistrer();
  nettoyer(ancienneId);
}

/**
 * Retirer un contexte d'intégration.
 *
 * Symétrique de l'ouverture, pas un nettoyage de fin de run : ce qui reste à
 * décider quand un run se termine — les lanes survivantes, les branches, les
 * contextes abandonnés — n'est pas ici.
 */
export function removeIntegration(root: string, id: string): boolean {
  const dir = join(integrationsDir(root), id);
  if (!existsSync(dir)) return false;
  return tryGit(root, ["worktree", "remove", "--force", dir]).ok;
}

/** Les tentatives d'intégration présentes sur le disque. */
export function openIntegrations(root: string): string[] {
  const { ok, out } = tryGit(root, ["worktree", "list", "--porcelain"]);
  if (!ok) return [];
  const base = integrationsDir(root);
  return out
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim())
    .filter((p) => p.startsWith(`${base}/`))
    .map((p) => p.slice(base.length + 1));
}
