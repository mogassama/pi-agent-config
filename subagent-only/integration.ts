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
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { planifierStatut, transformationExacte, type DesignUpdate } from "./design-update.ts";
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

// ================================================================== LOT 9 — preuves de la chaîne
//
// Les preuves git de la transition FROZEN → MERGED → Statut → INTEGRATED (C0 v2.0 § F, C6.2,
// C6.3 ; PLAN-LOT9 L9-Q6 à L9-Q9). Primitives seulement : ce module ne connaît ni le registre, ni
// le bail, ni le plan. Chacune rend « établi » ou la raison nommée, et aucune ne fait de reset :
// seule la phase Statut défait un effet, sur DESIGN.md seul, et seulement celui qu'elle a
// elle-même produit. Ce qu'elles ne savent pas établir, elles le refusent.

/** Le DESIGN.md canonique, relatif à la racine : le seul fichier que la phase Statut écrit. */
export const DESIGN_MD = "DESIGN.md";

/** Le message du commit de Statut, fabriqué par le runtime. */
export function statusMessage(du: DesignUpdate): string {
  return `chore(subagent): status ${du.decision_id} ${du.from_status} -> ${du.to_status}`;
}

/** Le contenu d'un fichier dans un commit, ou `undefined` s'il n'y est pas. */
function contenuDans(root: string, commit: string, chemin: string): string | undefined {
  const r = tryGit(root, ["show", `${commit}:${chemin}`]);
  return r.ok ? r.out : undefined;
}

/** Les parents d'un commit, tels que git les donne ; `undefined` s'il est illisible. */
function parentsDe(root: string, commit: string): string[] | undefined {
  const r = tryGit(root, ["rev-list", "--parents", "-n", "1", commit]);
  if (!r.ok) return undefined;
  const [soi, ...parents] = r.out.trim().split(/\s+/);
  return soi ? parents : undefined;
}

function teteDeRacine(root: string): string | undefined {
  const r = tryGit(root, ["rev-parse", "--verify", "HEAD"]);
  return r.ok ? r.out.trim() : undefined;
}

/**
 * Ce qu'on attend du merge déjà effectué (PLAN-LOT9 L9-Q6 ; adjudication de B, B-3).
 *
 *   ordinaire   preuve STRUCTURELLE, à partir du FROZEN et du HEAD courant : ni commit ni
 *               message attendus. Le message d'un commit n'est pas une autorité d'identité.
 *   tentative   preuve à partir du commit d'intégration attendu (`COMMITTED`), de son premier
 *               parent attendu (`p1`), du FROZEN et du `T_I` approuvé.
 *
 * Un appel sans mode explicite est refusé.
 */
export type MergeAttendu =
  | {
    mode: "ordinaire";
    /** Le commit du FROZEN consommé : second parent exact du commit d'intégration. */
    gel: string;
  }
  | {
    mode: "tentative";
    gel: string;
    /** Le commit d'intégration connu d'avance : `COMMITTED` du chemin tentative. */
    commit: string;
    /** La base d'intégration connue d'avance : `p1` de la tentative. */
    p1: string;
    /** `T_I` approuvé. */
    tree: string;
  };

export type PreuveMerge =
  | { ok: true; commit: string; p1: string; tree: string }
  | { ok: false; raison: string };

/**
 * Le HEAD de la racine est-il EXACTEMENT le merge du gel (L9-Q6, B-3) ?
 *
 * La fenêtre « après merge, avant MERGED » ne s'adopte que sur cette preuve. Ensemble :
 * racine propre ; HEAD est le candidat (en mode tentative, le commit attendu) ; exactement deux
 * parents ; le second est exactement le commit du FROZEN ; en mode tentative, le premier est
 * `p1` et le tree est `T_I` ; en mode ordinaire, le tree est le merge propre recalculé depuis
 * les deux parents que le candidat porte effectivement. Aucun message n'intervient : une
 * différence de message, à parents et tree identiques, n'est pas une contradiction. Jamais par
 * l'ascendance — un gel ancêtre de HEAD dit que son travail est quelque part dans l'histoire,
 * pas que HEAD est son intégration. Qu'aucun MERGED ne consomme déjà ce FROZEN, l'appelant
 * l'établit sur le registre (`classerGel`, écrivain de MERGED).
 */
export function preuveMergeEffectue(root: string, attendu: MergeAttendu): PreuveMerge {
  const mode = (attendu as { mode?: unknown } | undefined)?.mode;
  if (mode !== "ordinaire" && mode !== "tentative") {
    return { ok: false, raison: "preuve de merge sans mode explicite (ordinaire ou tentative) : aucun merge ne s'identifie" };
  }
  const sale = dirtyRoot(root);
  if (sale.length > 0) return { ok: false, raison: `racine sale : ${sale.slice(0, 3).join(", ")}` };
  const tete = teteDeRacine(root);
  if (tete === undefined) return { ok: false, raison: "HEAD de la racine illisible" };
  if (attendu.mode === "tentative" && tete !== attendu.commit) {
    return {
      ok: false,
      raison: `HEAD ${tete.slice(0, 12)} n'est pas le commit d'intégration attendu ${attendu.commit.slice(0, 12)}`,
    };
  }
  const parents = parentsDe(root, tete);
  if (parents === undefined) return { ok: false, raison: `${tete.slice(0, 12)} illisible` };
  if (parents.length !== 2 || parents[1] !== attendu.gel) {
    return {
      ok: false,
      raison: `${tete.slice(0, 12)} n'est pas un merge à deux parents dont le second est le gel ` +
        `${attendu.gel.slice(0, 12)} (parents ${parents.map((p) => p.slice(0, 12)).join(",") || "aucun"})`,
    };
  }
  if (attendu.mode === "tentative" && parents[0] !== attendu.p1) {
    return { ok: false, raison: `premier parent ${parents[0].slice(0, 12)} au lieu de p1 ${attendu.p1.slice(0, 12)}` };
  }
  const tree = tryGit(root, ["rev-parse", `${tete}^{tree}`]);
  if (!tree.ok) return { ok: false, raison: `tree de ${tete.slice(0, 12)} illisible` };
  let attenduTree: string;
  if (attendu.mode === "tentative") {
    attenduTree = attendu.tree;
  } else {
    // Le merge propre des deux parents, recalculé : un merge qui porterait autre chose que la
    // rencontre de la base et du gel — un fichier ajouté, une résolution — n'est pas celui-là.
    const recalcule = tryGit(root, ["merge-tree", "--write-tree", parents[0], parents[1]]);
    if (!recalcule.ok) {
      return { ok: false, raison: `le merge des parents de ${tete.slice(0, 12)} ne se recalcule pas proprement` };
    }
    attenduTree = recalcule.out.split("\n")[0].trim();
  }
  if (tree.out.trim() !== attenduTree) {
    return {
      ok: false,
      raison: `tree ${tree.out.trim().slice(0, 12)} de ${tete.slice(0, 12)} au lieu de ${attenduTree.slice(0, 12)}`,
    };
  }
  return { ok: true, commit: tete, p1: parents[0], tree: tree.out.trim() };
}

/**
 * DESIGN.md sur disque et dans l'index est-il EXACTEMENT celui de `commit` ? Octets (sans
 * filtre), mode, fichier ordinaire, entrée d'index normale — un drapeau `skip-worktree` ou
 * `assume-unchanged` rendrait `git status` aveugle, un lien symbolique n'est jamais conforme.
 */
export function designConforme(root: string, commit: string): boolean {
  const arbre = tryGit(root, ["ls-tree", commit, "--", DESIGN_MD]);
  const index = tryGit(root, ["ls-files", "-s", "-v", "--", DESIGN_MD]);
  if (!arbre.ok || !index.ok) return false;
  let fichier: ReturnType<typeof lstatSync> | undefined;
  try {
    fichier = lstatSync(join(root, DESIGN_MD));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  const ligne = arbre.out.trim();
  if (ligne === "") return index.out.trim() === "" && fichier === undefined;
  const m = /^(100644|100755) blob ([0-9a-f]+)\t/.exec(ligne);
  const i = /^H (\d{6}) ([0-9a-f]+) 0\t[^\n]*$/.exec(index.out.trim());
  if (m === null || i === null || i[1] !== m[1] || i[2] !== m[2]) return false;
  if (fichier === undefined || !fichier.isFile()) return false;
  if (((Number(fichier.mode) & 0o111) !== 0) !== (m[1] === "100755")) return false;
  const h = tryGit(root, ["hash-object", "--no-filters", "--", DESIGN_MD]);
  return h.ok && h.out.trim() === m[2];
}

/** L'entrée DESIGN.md (mode et blob) d'un tree ou d'un commit ; "" si absente, `undefined` si illisible. */
function entreeDesign(root: string, arbre: string): string | undefined {
  const r = tryGit(root, ["ls-tree", arbre, "--", DESIGN_MD]);
  return r.ok ? r.out.trim() : undefined;
}

/**
 * Le DESIGN.md d'un commit à deux parents est-il celui que la rencontre de ses parents donne ?
 * Merge propre : l'entrée du merge recalculé. Merge en conflit (atterrissage) : celle de l'un
 * des deux parents — une résolution n'invente pas de DESIGN.md.
 */
function designDeMerge(root: string, commit: string, parents: string[]): boolean {
  const propre = entreeDesign(root, commit);
  if (propre === undefined) return false;
  const recalcule = tryGit(root, ["merge-tree", "--write-tree", parents[0], parents[1]]);
  if (recalcule.ok) return entreeDesign(root, recalcule.out.split("\n")[0].trim()) === propre;
  return entreeDesign(root, parents[0]) === propre || entreeDesign(root, parents[1]) === propre;
}

/**
 * C6.4 concurrent (adjudication de B, point 3) : l'instantané de la racine avant un appel
 * observé — HEAD, et DESIGN.md (fichier et index) conforme ou non à HEAD.
 */
export interface InstantaneDesign {
  tete?: string;
  propre: boolean;
}

export function instantaneDesign(root: string): InstantaneDesign {
  const tete = teteDeRacine(root);
  return { tete, propre: tete !== undefined && designConforme(root, tete) };
}

/** Les faits autoritaires du registre que l'attribution consulte. */
export interface FaitsDesign {
  /** Commits produits par une transition du runtime, attestés depuis l'instantané. */
  autorite: ReadonlySet<string>;
  /** Le gel VIVANT de chaque lane (le dernier, classé vivant) : second parent d'un merge sans MERGED. */
  gelsVivants: ReadonlySet<string>;
}

export type AttributionDesign =
  | { verdict: "explique" }
  | { verdict: "en-attente" }
  | { verdict: "non-explique"; raison: string };

/**
 * Une variation de DESIGN.md entre `tool_call` et `tool_result` est-elle entièrement due au
 * runtime ? (C6.4, point 3 de l'adjudication de B.) Appelée seulement quand DESIGN.md a varié.
 *
 * HEAD immobile : rien ne l'explique. HEAD avancé : elle l'est si, depuis un instantané
 * conforme, chaque commit de la chaîne des premiers parents jusqu'à l'ancien HEAD est attesté
 * par le registre (et, s'il est un merge, porte le DESIGN.md de la rencontre de ses parents),
 * ou ne touche pas DESIGN.md ; et si DESIGN.md sur disque et dans l'index est exactement celui
 * de HEAD. Une transition réelle ne couvre jamais un delta en plus.
 *
 * Un merge du gel vivant dont MERGED n'est pas encore écrit, et dont DESIGN.md est celui du
 * merge recalculé, n'est ni une écriture certaine ni un changement expliqué : l'attribution est
 * EN ATTENTE. Seule l'ambiguïté pure attend : dès qu'une partie du delta est déjà prouvée non
 * expliquée, le blocage est immédiat — une attente tenue en mémoire ne survit pas à un
 * redémarrage (adjudication de B, correction 1).
 */
export function attribuerDesign(
  root: string,
  avant: InstantaneDesign,
  faits: FaitsDesign,
  apresReprise: boolean,
): AttributionDesign {
  if (!avant.propre || avant.tete === undefined) {
    return { verdict: "non-explique", raison: "DESIGN.md différait déjà de HEAD avant l'appel" };
  }
  const tete = teteDeRacine(root);
  if (tete === undefined) return { verdict: "non-explique", raison: "HEAD de la racine illisible" };
  if (tete === avant.tete) {
    return { verdict: "non-explique", raison: "DESIGN.md a varié sans aucune transition : HEAD n'a pas bougé" };
  }
  if (!tryGit(root, ["merge-base", "--is-ancestor", avant.tete, tete]).ok) {
    return { verdict: "non-explique", raison: `HEAD ${tete.slice(0, 12)} ne descend pas de ${avant.tete.slice(0, 12)}` };
  }
  const liste = tryGit(root, ["rev-list", "--first-parent", "--parents", `${avant.tete}..${tete}`]);
  const lignes = liste.ok ? liste.out.split("\n").filter(Boolean).map((l) => l.trim().split(/\s+/)) : [];
  if (lignes.length === 0 || lignes[lignes.length - 1][1] !== avant.tete) {
    return { verdict: "non-explique", raison: `la chaîne des premiers parents de ${tete.slice(0, 12)} n'atteint pas ${avant.tete.slice(0, 12)}` };
  }
  let fenetre = false;
  let raison: string | undefined;
  for (const [commit, ...parents] of lignes) {
    const merge = parents.length === 2;
    if (faits.autorite.has(commit) && (!merge || designDeMerge(root, commit, parents))) continue;
    if (merge && faits.gelsVivants.has(parents[1]) && designDeMerge(root, commit, parents)) {
      fenetre = true;
      continue;
    }
    if (!tryGit(root, ["diff", "--quiet", parents[0], commit, "--", DESIGN_MD]).ok) {
      raison ??= `${commit.slice(0, 12)} modifie DESIGN.md sans transition du runtime`;
    }
  }
  if (!designConforme(root, tete)) raison ??= "DESIGN.md diffère de HEAD (fichier, mode ou index)";
  if (fenetre && !apresReprise && raison === undefined) {
    return { verdict: "en-attente" };
  }
  if (raison !== undefined) return { verdict: "non-explique", raison };
  return fenetre ? { verdict: "en-attente" } : { verdict: "explique" };
}

export type PreuveStatut = { ok: true; commit: string } | { ok: false; raison: string };

/**
 * Le HEAD de la racine est-il EXACTEMENT le commit de Statut attendu (C6.3, L9-Q8) ?
 *
 * Racine propre ; HEAD à un seul parent, `integration_commit` ; un seul chemin modifié,
 * `DESIGN.md`, modifié et non créé, renommé ou changé de mode ; et son contenu est la
 * transformation exacte `from_status → to_status` de celui d'`integration_commit`.
 */
export function preuveCommitStatut(root: string, integrationCommit: string, du: DesignUpdate): PreuveStatut {
  const sale = dirtyRoot(root);
  if (sale.length > 0) return { ok: false, raison: `racine sale : ${sale.slice(0, 3).join(", ")}` };
  const tete = teteDeRacine(root);
  if (tete === undefined) return { ok: false, raison: "HEAD de la racine illisible" };
  const parents = parentsDe(root, tete);
  if (parents === undefined || parents.length !== 1 || parents[0] !== integrationCommit) {
    return {
      ok: false,
      raison: `${tete.slice(0, 12)} n'a pas pour seul parent le commit d'intégration ${integrationCommit.slice(0, 12)}`,
    };
  }
  const diff = tryGit(root, ["diff", "--no-renames", "--raw", "--no-abbrev", integrationCommit, tete]);
  if (!diff.ok) return { ok: false, raison: "diff du commit de Statut illisible" };
  const lignes = diff.out.split("\n").filter(Boolean);
  const seule = lignes.length === 1 ? /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ M\t(.*)$/.exec(lignes[0]) : null;
  if (seule === null || seule[3] !== DESIGN_MD || seule[1] !== seule[2]) {
    return { ok: false, raison: `le commit de Statut ne modifie pas ${DESIGN_MD} seul : ${lignes.join(" · ") || "rien"}` };
  }
  const avant = contenuDans(root, integrationCommit, DESIGN_MD);
  const apres = contenuDans(root, tete, DESIGN_MD);
  if (avant === undefined || apres === undefined || !transformationExacte(avant, apres, du)) {
    return {
      ok: false,
      raison: `${DESIGN_MD} n'est pas exactement la transition ${du.decision_id} ${du.from_status} → ${du.to_status}`,
    };
  }
  return { ok: true, commit: tete };
}

export type IssueStatutGit =
  | { ok: true; outcome: "unchanged" }
  | { ok: true; outcome: "committed"; commit: string }
  | {
      ok: false;
      raison: string;
      /**
       * La racine est-elle revenue propre sur `integration_commit` ? Faux quand un commit a
       * été créé et ne se prouve pas, ou quand la restauration n'a pas pu s'établir.
       */
      restauree: boolean;
    };

/**
 * La phase Statut sur la racine (C6.2, L9-Q7, L9-Q9), par la capacité interne du runtime.
 *
 * Précondition : HEAD = `integration_commit`. Le statut courant se lit dans le DESIGN.md de ce
 * commit ; `planifierStatut` décide :
 *
 *   inchangé        racine propre exigée, rien n'est écrit              → unchanged
 *   refus           rien n'est écrit
 *   appliquer       la racine doit être propre, ou ne porter que l'effet partiel EXACT de
 *                   cette phase sur DESIGN.md (fichier et index, chacun avant ou après la
 *                   transition) : il est alors restauré sur `integration_commit`. Toute autre
 *                   saleté refuse, sans reset. Puis écriture, `git add`, `git commit` — les
 *                   hooks du dépôt restent souverains — et le commit créé doit se prouver.
 *
 * Un commit refusé : seul l'effet produit est défait (DESIGN.md, fichier et index, restauré
 * sur `integration_commit`). Un commit créé qui ne se prouve pas n'est pas corrigé : il reste,
 * et l'issue le dit.
 */
export function commitStatut(root: string, integrationCommit: string, du: DesignUpdate): IssueStatutGit {
  const tete = teteDeRacine(root);
  if (tete !== integrationCommit) {
    return {
      ok: false,
      restauree: false,
      raison: `HEAD ${String(tete).slice(0, 12)} n'est pas le commit d'intégration ${integrationCommit.slice(0, 12)}`,
    };
  }
  const avant = contenuDans(root, integrationCommit, DESIGN_MD);
  if (avant === undefined) {
    return { ok: false, restauree: dirtyRoot(root).length === 0, raison: `${DESIGN_MD} absent de ${integrationCommit.slice(0, 12)}` };
  }
  const plan = planifierStatut(avant, du);
  if (plan.issue === "refus") return { ok: false, restauree: dirtyRoot(root).length === 0, raison: plan.raison };

  const sale = dirtyRoot(root);
  if (plan.issue === "inchange") {
    if (sale.length > 0) return { ok: false, restauree: false, raison: `racine sale : ${sale.slice(0, 3).join(", ")}` };
    return { ok: true, outcome: "unchanged" };
  }
  const restaurer = (): boolean =>
    tryGit(root, ["checkout", integrationCommit, "--", DESIGN_MD]).ok && dirtyRoot(root).length === 0;
  if (sale.length > 0) {
    // Seul l'effet partiel exact de cette phase se reprend ; il se défait, puis se refait.
    let fichier: string | undefined;
    try {
      fichier = readFileSync(join(root, DESIGN_MD), "utf-8");
    } catch {
      fichier = undefined;
    }
    const index = tryGit(root, ["show", `:${DESIGN_MD}`]);
    const connus = [avant, plan.contenu];
    const partiel = sale.every((l) => l.slice(2).trim() === DESIGN_MD) &&
      fichier !== undefined && connus.includes(fichier) && index.ok && connus.includes(index.out);
    if (!partiel) {
      return { ok: false, restauree: false, raison: `racine sale hors de l'effet de la phase Statut : ${sale.slice(0, 3).join(", ")}` };
    }
    if (!restaurer()) return { ok: false, restauree: false, raison: `l'effet partiel sur ${DESIGN_MD} n'a pas pu être restauré` };
  }

  writeFileSync(join(root, DESIGN_MD), plan.contenu);
  const indexe = tryGit(root, ["add", "--", DESIGN_MD]);
  const cree = indexe.ok ? tryGit(root, ["commit", "-q", "-m", statusMessage(du)]) : indexe;
  if (!cree.ok) {
    return {
      ok: false,
      restauree: teteDeRacine(root) === integrationCommit && restaurer(),
      raison: `commit de Statut refusé : ${cree.out.trim()}`,
    };
  }
  const preuve = preuveCommitStatut(root, integrationCommit, du);
  if (!preuve.ok) return { ok: false, restauree: false, raison: `commit de Statut créé et non conforme : ${preuve.raison}` };
  return { ok: true, outcome: "committed", commit: preuve.commit };
}

/**
 * La fenêtre de crash qu'une transition inachevée occupe, selon git (L9-Q6 à L9-Q8).
 *
 *   gel vivant (sans MERGED)
 *     le gel n'est pas dans l'histoire de HEAD      aucune : aucun merge n'a eu lieu
 *     il y est                                      après merge : la preuve EXACTE décide
 *   MERGED sans INTEGRATED
 *     HEAD = integration_commit                     après MERGED : le Statut reste à faire
 *     HEAD à un seul parent, integration_commit     après commit de Statut : à prouver
 *     toute autre tête                              contradiction : rien ne s'adopte
 *
 * Classer n'est pas adopter : chaque fenêtre garde sa preuve exacte (`preuveMergeEffectue`,
 * `commitStatut`, `preuveCommitStatut`). L'ascendance ne sert qu'à savoir qu'un merge a eu
 * lieu, jamais à dire lequel.
 */
export type FenetreDeReprise =
  | { fenetre: "aucune" }
  | { fenetre: "apres-merge" }
  | { fenetre: "apres-merged" }
  | { fenetre: "apres-statut" }
  | { fenetre: "contradiction"; raison: string };

export function fenetreDeReprise(
  root: string,
  transition: { gel: string; integrationCommit?: string },
): FenetreDeReprise {
  const tete = teteDeRacine(root);
  if (tete === undefined) return { fenetre: "contradiction", raison: "HEAD de la racine illisible" };
  if (transition.integrationCommit === undefined) {
    // Un gel que git ne sait pas lire n'est pas un gel « non mergé » : ne pas savoir n'est pas
    // savoir qu'aucun merge n'a eu lieu.
    if (!tryGit(root, ["rev-parse", "--verify", "--quiet", `${transition.gel}^{commit}`]).ok) {
      return { fenetre: "contradiction", raison: `le gel ${transition.gel.slice(0, 12)} est illisible` };
    }
    return tryGit(root, ["merge-base", "--is-ancestor", transition.gel, tete]).ok
      ? { fenetre: "apres-merge" }
      : { fenetre: "aucune" };
  }
  if (tete === transition.integrationCommit) return { fenetre: "apres-merged" };
  const parents = parentsDe(root, tete);
  if (parents !== undefined && parents.length === 1 && parents[0] === transition.integrationCommit) {
    return { fenetre: "apres-statut" };
  }
  return {
    fenetre: "contradiction",
    raison: `HEAD ${tete.slice(0, 12)} n'est ni le commit d'intégration ${transition.integrationCommit.slice(0, 12)} ` +
      "ni un commit posé directement sur lui",
  };
}
