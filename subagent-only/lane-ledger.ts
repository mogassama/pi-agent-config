/**
 * Ce que le run a réellement fait de ses lanes, et ce que le disque en dit.
 *
 * Deux vérités durables coexistent après un crash : le registre, qui est notre
 * provenance, et git, qui est l'état des choses. Elles ne participent pas à une
 * même transaction — un JSONL et un `git worktree add` ne s'écrivent pas
 * ensemble — donc des fenêtres existent, et ce module sert à les rendre
 * **visibles et nommées** plutôt qu'à prétendre qu'elles n'existent pas.
 *
 * **Le registre enregistre des faits accomplis, jamais des intentions.**
 * L'effet réel d'abord, l'événement ensuite. L'ordre inverse produirait un
 * `INTEGRATED` sur un merge qui n'a jamais eu lieu, c'est-à-dire un registre
 * qui affirme faux — alors que l'ordre retenu produit au pire un registre en
 * retard sur la réalité, ce qui se diagnostique. On préfère toujours la réalité
 * en avance sur le registre à l'inverse.
 *
 * **`reconcile` ne modifie rien.** Il lit, plie, compare, classe. Une réparation
 * éventuelle — adopter un orphelin, confirmer une intégration, nettoyer un
 * résidu — est une opération explicite de `bin/subagent-recover`, jamais une
 * branche cachée d'une fonction qui prétend seulement observer.
 */

export type LaneEventKind = "OPENED" | "INTEGRATED" | "ABANDONED";

/**
 * Un événement, dont la forme dépend de sa nature.
 *
 * `base` n'est pas optionnelle sur une ouverture. Elle décide si une unité peut
 * être prouvée intégrée, donc si ses dépendantes sont admissibles : la laisser
 * facultative laissait passer une ouverture sans base, run utilisable, et
 * l'impasse ne se découvrait qu'après le merge — au moment où le run se
 * rebloquait sans qu'on sache pourquoi.
 *
 * Aucun run parallèle réel n'a encore écrit dans ce registre. C'est le moment
 * de rendre le contrat strict.
 */
export type LaneEventV1 =
  | {
      event: "OPENED";
      work_unit: string;
      at: string;
      /** Le commit d'où cette lane est partie. Obligatoire. */
      base: string;
    }
  | {
      event: "INTEGRATED";
      work_unit: string;
      at: string;
      /**
       * Le commit qui porte l'intégration. Optionnel, et c'est délibéré.
       *
       * Symétrique de `base` sur l'ouverture : sans lui, l'intégration cesse
       * d'être prouvable dès que la branche de lane disparaît. La preuve
       * utilisée jusqu'ici était `isMerged(branche, base)`, qui interroge une
       * ref — donc supprimer la branche d'une lane correctement intégrée
       * transformait, à la reprise suivante, un fait juste en
       * `integration-non-confirmee`, c'est-à-dire en contradiction bloquante.
       * Le nettoyage devenait impossible sans casser la réconciliation.
       *
       * Optionnel parce que les registres déjà écrits sous `ledger: 1` n'en
       * portent pas et restent lisibles : leur intégration continue de se
       * prouver par la branche, et leur branche n'est donc pas supprimable.
       * Dégradation honnête plutôt que migration — une unité sans preuve
       * durable est nommée comme telle, pas traitée comme si elle en avait une.
       */
      integration_commit?: string;
    }
  | { event: "ABANDONED"; work_unit: string; at: string; reason?: string };

/**
 * Ce qu'une lecture du registre des lanes peut rendre : un événement v1, ou un événement v2.
 *
 * L'écrivain, lui, reste borné à `LaneEventV1` jusqu'au lot des identités g1 (C4.9) :
 * élargir la lecture ne lui ouvre pas les natures qu'il n'a pas le droit d'écrire. Les
 * membres v1 restent en tête de l'union.
 */
export type LaneEvent = LaneEventV1 | LaneEventV2;

// ============================================================ registre v2 (C0 § F)

/**
 * L'enveloppe commune d'un événement du registre v2.
 *
 * `event_seq` est la séquence du REGISTRE, pas celle des délégations : les confondre
 * mêlerait deux ordres. `lane` est l'identifiant complet de la lane ; sa cohérence avec
 * `(R, work_unit, generation)` demande plusieurs lignes, et se contrôle à la projection,
 * pas ici.
 */
export interface LaneEnvelope {
  event_seq: number;
  work_unit: string;
  lane: string;
  at: string;
}

export type ProofMode = "diff" | "reading-list" | "none";
export type ViolationKind = "reserved-violation" | "bundle-violation";
export type RiskTransition = "opened" | "routed" | "resolved";

/** Le traitement du Statut d'une intégration : trois issues, aucune autre (C0 § F). */
export type IntegrationStatus =
  | { outcome: "not-applicable" }
  | { outcome: "unchanged"; decision_id: string; target_status: string }
  | { outcome: "committed"; decision_id: string; target_status: string; status_commit: string };

/**
 * Les huit natures du registre v2, enveloppe comprise.
 *
 * Aucun producteur n'écrit encore les cinq nouvelles : ce type existe pour qu'une
 * lecture les nomme au lieu de les compter comme des lignes abîmées.
 */
export type LaneEventV2 =
  | (LaneEnvelope & { event: "OPENED"; base: string; generation: number })
  | (LaneEnvelope & {
      event: "REVIEWED";
      from_tree: string;
      tree: string;
      verdict: string;
      reviewer: { delegation_seq: number; agent: string; role: string };
      proof: { mode: ProofMode; paths?: string[] };
    })
  | (LaneEnvelope & {
      event: "VIOLATION";
      kind: ViolationKind;
      paths: string[];
      source: { delegation_seq: number; agent: string };
      observed_tree: string;
    })
  | (LaneEnvelope & { event: "RISK"; id: string; transition: RiskTransition; by?: string; to?: string })
  | (LaneEnvelope & { event: "FROZEN"; commit: string; parent: string; tree: string; reviewed_event_seq: number })
  | (LaneEnvelope & { event: "MERGED"; integration_commit: string; frozen_event_seq: number })
  | (LaneEnvelope & { event: "INTEGRATED"; integration_commit: string; status: IntegrationStatus })
  | (LaneEnvelope & { event: "ABANDONED"; by: string; reason: string; generation: number });

const texte = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const rang = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const objet = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Un chemin canonique de dépôt : relatif, séparé par `/`, sans segment vide, `.` ni `..`.
 *
 * Deux écritures d'un même chemin feraient deux violations là où il n'y en a qu'une, et
 * un chemin qui sort du dépôt n'en est pas un. Un chemin absolu commence par un segment
 * vide : la règle des segments le refuse déjà, sans test séparé.
 */
function cheminCanonique(p: unknown): p is string {
  if (!texte(p) || p.includes("\\")) return false;
  return p.split("/").every((s) => s.length > 0 && s !== "." && s !== "..");
}

/** Une liste de chemins canoniques, triée lexicalement et sans doublon. */
function cheminsCanoniques(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length === 0 || !v.every(cheminCanonique)) return false;
  for (let i = 1; i < v.length; i++) if (!(v[i - 1] < v[i])) return false;
  return true;
}

/**
 * Les clés exactes de chaque issue du Statut. Une clé de plus rendrait deux issues
 * indistinguables — `not-applicable` portant un `status_commit`, par exemple.
 */
function statutValide(v: unknown): v is IntegrationStatus {
  if (!objet(v)) return false;
  const cles = Object.keys(v).sort().join(",");
  switch (v.outcome) {
    case "not-applicable":
      return cles === "outcome";
    case "unchanged":
      return cles === "decision_id,outcome,target_status" && texte(v.decision_id) && texte(v.target_status);
    case "committed":
      return cles === "decision_id,outcome,status_commit,target_status"
        && texte(v.decision_id) && texte(v.target_status) && texte(v.status_commit);
    default:
      return false;
  }
}

/**
 * Une ligne du registre v2, ou `null` si elle n'en est pas une.
 *
 * Seule la forme d'UNE ligne se juge ici : enveloppe, nature, champs obligatoires et leur
 * type exact. Ce qui demande plusieurs lignes — ordre des `event_seq`, cohérence de
 * `lane`, chaîne des revues, renvois vers REVIEWED et FROZEN — appartient à la
 * projection. Une ligne rendue `null` n'est jamais ignorée : l'appelant la compte abîmée.
 *
 * Les champs non nommés par § F sont tolérés sur un événement ; ils ne le sont pas dans
 * `status`, dont les trois issues se distinguent par leurs clés.
 */
export function parseLaneEventV2(doc: unknown): LaneEventV2 | null {
  if (!objet(doc)) return null;
  if (!rang(doc.event_seq) || !texte(doc.work_unit) || !texte(doc.lane) || !texte(doc.at)) return null;
  const ok = ((): boolean => {
    switch (doc.event) {
      case "OPENED":
        return texte(doc.base) && rang(doc.generation);
      case "REVIEWED": {
        const r = doc.reviewer;
        const p = doc.proof;
        if (!texte(doc.from_tree) || !texte(doc.tree) || !texte(doc.verdict)) return false;
        if (!objet(r) || !rang(r.delegation_seq) || !texte(r.agent) || !texte(r.role)) return false;
        if (!objet(p) || (p.mode !== "diff" && p.mode !== "reading-list" && p.mode !== "none")) return false;
        if (p.mode === "reading-list") return cheminsCanoniques(p.paths);
        return p.paths === undefined || cheminsCanoniques(p.paths);
      }
      case "VIOLATION": {
        const s = doc.source;
        return (doc.kind === "reserved-violation" || doc.kind === "bundle-violation")
          && cheminsCanoniques(doc.paths)
          && objet(s) && rang(s.delegation_seq) && texte(s.agent)
          && texte(doc.observed_tree);
      }
      case "RISK": {
        const transition = doc.transition;
        if (!texte(doc.id)) return false;
        if (transition !== "opened" && transition !== "routed" && transition !== "resolved") return false;
        // Exactement un des deux : qui agit, ou à qui c'est confié.
        const par = doc.by !== undefined;
        const vers = doc.to !== undefined;
        return par !== vers && (par ? texte(doc.by) : texte(doc.to));
      }
      case "FROZEN":
        return texte(doc.commit) && texte(doc.parent) && texte(doc.tree) && rang(doc.reviewed_event_seq);
      case "MERGED":
        return texte(doc.integration_commit) && rang(doc.frozen_event_seq);
      case "INTEGRATED":
        return texte(doc.integration_commit) && statutValide(doc.status);
      case "ABANDONED":
        return texte(doc.by) && texte(doc.reason) && rang(doc.generation);
      default:
        return false;
    }
  })();
  return ok ? (doc as unknown as LaneEventV2) : null;
}

/**
 * L'histoire confirmée d'une unité, telle que le registre la raconte.
 *
 * `never-started` n'est pas un état écrit : c'est l'absence d'événement. Une
 * unité que le plan prévoit et dont rien n'a commencé est dans ce cas, et une
 * unité inconnue du plan aussi — la différence relève du plan, pas d'ici.
 */
export type LaneStatus = "never-started" | "open" | "integrated" | "abandoned";

export function foldLedger(events: readonly LaneEvent[]): Map<string, LaneStatus> {
  const etats = new Map<string, LaneStatus>();
  for (const e of events) {
    switch (e.event) {
      case "OPENED":
        // Une lane rouverte pour un rework ne réécrit pas son ouverture, mais
        // si l'événement apparaît deux fois on ne régresse pas un état plus
        // avancé : le registre est append-only et se lit dans l'ordre.
        if (!etats.has(e.work_unit)) etats.set(e.work_unit, "open");
        break;
      case "INTEGRATED":
        etats.set(e.work_unit, "integrated");
        break;
      case "ABANDONED":
        etats.set(e.work_unit, "abandoned");
        break;
    }
  }
  return etats;
}

/**
 * Le commit d'intégration retenu pour chaque unité, quand le registre en porte un.
 *
 * Le dernier gagne, comme pour le statut : le registre est append-only et se lit
 * dans l'ordre. Une unité intégrée deux fois — un rework réintégré — est prouvée
 * par la dernière intégration, pas par la première, et une seconde ligne sans
 * commit efface la preuve durable au lieu de conserver une valeur périmée.
 */
export function integrationCommits(events: readonly LaneEvent[]): Map<string, string | undefined> {
  const commits = new Map<string, string | undefined>();
  for (const e of events) {
    if (e.event === "INTEGRATED") commits.set(e.work_unit, e.integration_commit);
  }
  return commits;
}

/** Ce que le disque montre, rassemblé par l'appelant. */
export interface Observations {
  /** Unités dont le worktree existe encore. */
  openWorktrees: readonly string[];
  /**
   * Unités dont la branche est prouvée intégrée, base de lane à l'appui.
   *
   * Seules celles dont le registre porte une base peuvent y figurer : sans base,
   * git ne distingue pas « intégrée » de « n'a rien produit ».
   */
  mergedUnits: readonly string[];
  /** Unités ayant une branche de lane dans ce run, prouvée intégrée ou non. */
  runBranches?: readonly string[];
  /**
   * Les commits d'intégration que le dépôt confirme, par SHA.
   *
   * Confirmer veut dire deux choses, et les deux sont nécessaires : l'objet
   * existe, et il est dans l'histoire de l'intégration courante. Un SHA inconnu
   * du dépôt ne prouve rien ; un SHA connu mais hors de HEAD dit qu'on a intégré
   * ailleurs, ou qu'on est revenu en arrière — dans les deux cas la lane n'est
   * pas dans l'intégration, et l'y compter serait la réparation silencieuse
   * qu'on refuse.
   *
   * Par SHA et non par unité : c'est le commit nommé au registre qui doit être
   * confirmé, pas « une intégration quelconque de cette unité ».
   */
  confirmedCommits?: readonly string[];
  /**
   * Unités dont le worktree porte encore des changements non intégrés.
   *
   * C'est ce qui distingue un résidu d'une contradiction. Un worktree propre
   * survivant à une intégration est un ménage à faire ; un worktree sale
   * contient du travail postérieur ou extérieur au fait enregistré, et l'unité
   * ne peut pas être tenue pour terminée.
   */
  dirtyWorktrees?: readonly string[];
}

export type ConflictKind =
  /** Le registre dit ouverte, le disque n'a ni worktree ni intégration. */
  | "lane-disparue"
  /** Un worktree du run courant sans aucune provenance dans le registre. */
  | "worktree-orphelin"
  /** Le changement est intégré, le registre ne l'a pas enregistré. */
  | "integration-non-enregistree"
  /** Le registre dit abandonnée, le worktree est toujours là. */
  | "residu-d-abandon"
  /** L'unité est intégrée, mais son worktree porte encore du travail. */
  | "residu-sale"
  /** Le registre dit intégrée, git ne montre aucune intégration. */
  | "integration-non-confirmee"
  /** Le registre dit abandonnée, git montre pourtant l'intégration. */
  | "abandon-contredit-par-git"
  /**
   * Une branche de ce run existe, sans provenance au registre.
   *
   * On ne dit pas « intégration sans provenance » : sans la base de la lane, git
   * ne permet pas d'établir que cette branche a produit quelque chose, encore
   * moins que ce quelque chose est intégré. Ce qu'on sait est plus étroit, et le
   * nom le dit.
   */
  | "branche-sans-provenance";

export interface Conflict {
  kind: ConflictKind;
  workUnitId: string;
  /** Ce qu'il faudrait regarder, dit en une phrase. */
  detail: string;
}

/**
 * Ce qui mérite d'être dit sans fermer le run.
 *
 * Un worktree propre survivant à une intégration est du ménage : le fait est
 * enregistré, git le confirme, et rien d'inconnu ne dort dedans. Le traiter
 * comme une contradiction bloquerait un run pour une raison qui ne met rien en
 * doute.
 */
export interface Warning {
  workUnitId: string;
  detail: string;
}

export interface Reconciliation {
  /** L'histoire confirmée, unité par unité. */
  states: Map<string, LaneStatus>;
  /** Les unités qui possèdent encore leur scope : ouvertes et cohérentes. */
  openUnits: Set<string>;
  /** Les unités intégrées, donc dont les dépendantes sont admissibles. */
  integrated: Set<string>;
  /**
   * Les unités dont l'intégration est prouvée sans leur branche.
   *
   * C'est-à-dire : intégrées, confirmées par leur commit d'intégration, sans
   * résidu. Leur branche de lane ne porte plus aucune preuve, donc la supprimer
   * ne peut pas fabriquer de contradiction à la reprise suivante.
   *
   * Rendu ici et consommé ailleurs : ce module observe, il ne nettoie pas. Une
   * unité prouvée par sa seule branche n'y figure jamais — pas parce qu'elle est
   * douteuse, mais parce que sa branche est ce qui la prouve.
   */
  cleanableBranches: Set<string>;
  /**
   * Les worktrees qu'on peut retirer sans rien perdre.
   *
   * Une unité terminale — intégrée ou abandonnée — dont le worktree est présent
   * et propre. Le contenu est ailleurs : dans l'intégration pour l'une, sur la
   * branche pour l'autre. Un worktree sale n'y figure jamais, quel que soit le
   * fait enregistré : il porte du travail que ce fait ne couvre pas.
   *
   * Rendu ici pour que le nettoyage n'ait aucune règle à réimplémenter. Il ne
   * décide de rien ; il matérialise ce que la réconciliation a déjà établi.
   */
  cleanableWorktrees: Set<string>;
  /** Ce qui ne s'accorde pas, par unité. Nommé, jamais réparé. */
  conflicts: Map<string, Conflict>;
  /** Ce qui est à ranger, sans rien remettre en cause. */
  warnings: Warning[];
  /**
   * Les unités dont le scope est réservé sans que personne ne le possède.
   *
   * Une unité en contradiction peut porter un worktree aux modifications
   * inconnues, une intégration non enregistrée, un abandon incomplet. Dire
   * qu'elle ne possède rien laisserait une unité chevauchante démarrer sur un
   * scope où du travail non résolu existe. Elle le réserve donc — contre les
   * autres **et contre elle-même** : reprendre une lane et résoudre une
   * contradiction ne sont pas la même opération, et l'exception d'auto-collision
   * du lot 3a ne vaut pas ici.
   */
  reserved: Set<string>;
}

/**
 * Confronte le registre au disque, sans rien écrire.
 *
 * Les ensembles rendus ne contiennent que ce sur quoi les deux sources
 * s'accordent. Une unité en conflit n'entre ni dans `openUnits` ni dans
 * `integrated` : la traiter comme propriétaire ou comme dépendance satisfaite
 * reviendrait à choisir une des deux versions, ce qui est exactement la
 * réparation silencieuse qu'on refuse.
 */
export function reconcile(
  events: readonly LaneEvent[],
  obs: Observations,
): Reconciliation {
  const states = foldLedger(events);
  const commits = integrationCommits(events);
  const worktrees = new Set(obs.openWorktrees);
  const merged = new Set(obs.mergedUnits);
  const confirmed = new Set(obs.confirmedCommits ?? []);
  const sales = new Set(obs.dirtyWorktrees ?? []);
  const warnings: Warning[] = [];
  const conflicts = new Map<string, Conflict>();
  const openUnits = new Set<string>();
  const integrated = new Set<string>();
  const cleanableBranches = new Set<string>();
  const cleanableWorktrees = new Set<string>();
  const ajouter = (c: Conflict) => {
    // Le premier constaté fait foi : le nommer deux fois n'ajoute rien, et
    // l'ordre des cas est déterministe.
    if (!conflicts.has(c.workUnitId)) conflicts.set(c.workUnitId, c);
  };

  for (const [unit, statut] of states) {
    switch (statut) {
      case "open":
        if (merged.has(unit)) {
          // La réalité a devancé le registre : le merge a eu lieu, le processus
          // est mort avant de l'enregistrer. Honnête, et diagnosticable.
          ajouter({
            kind: "integration-non-enregistree",
            workUnitId: unit,
            detail: `la branche de ${unit} est dans l'intégration, le registre la dit ouverte`,
          });
        } else if (worktrees.has(unit)) {
          openUnits.add(unit);
        } else {
          ajouter({
            kind: "lane-disparue",
            workUnitId: unit,
            detail: `${unit} est ouverte au registre, sans worktree ni intégration`,
          });
        }
        break;
      case "integrated":
        /*
         * L'événement ne suffit pas : git doit le confirmer.
         *
         * La première version ajoutait l'unité aux intégrées dès que le
         * registre le disait, avec un commentaire affirmant « git le confirme »
         * — sans jamais interroger git. Une ligne `INTEGRATED` fausse ou
         * prématurée satisfaisait donc les dépendances de toute une branche du
         * plan. C'est exactement ce que ce module existe pour empêcher : ce
         * qu'il rend ne doit contenir que ce sur quoi les deux sources
         * s'accordent.
         */
        /*
         * Deux preuves possibles, et une seule s'applique.
         *
         * Le registre porte un commit d'intégration : c'est lui qui prouve, et
         * la branche ne compte pas. Il n'en porte pas — registre écrit avant ce
         * champ : on retombe sur la branche, comme avant. Jamais les deux en
         * disjonction : accepter « le commit ou la branche » laisserait une
         * unité dont le commit nommé est introuvable passer pour intégrée parce
         * qu'une branche traîne, ce qui est précisément le mensonge que nommer
         * le commit devait supprimer.
         */
        const integrationCommit = commits.get(unit);
        const prouvee = integrationCommit ? confirmed.has(integrationCommit) : merged.has(unit);
        if (!prouvee) {
          ajouter({
            kind: "integration-non-confirmee",
            workUnitId: unit,
            detail: integrationCommit
              ? `${unit} est intégrée au registre par ${integrationCommit.slice(0, 12)}, ` +
                `que le dépôt ne confirme pas`
              : `${unit} est intégrée au registre, git ne montre aucune intégration`,
          });
          break;
        }
        /*
         * Deux résidus que rien ne distingue de l'extérieur, et qui n'ont pas la
         * même conséquence. Un worktree propre est du ménage ; un worktree sale
         * porte du travail que le fait enregistré ne couvre pas, et tenir
         * l'unité pour terminée libérerait son scope pendant qu'il y dort.
         */
        if (worktrees.has(unit) && sales.has(unit)) {
          ajouter({
            kind: "residu-sale",
            workUnitId: unit,
            detail:
              `${unit} est intégrée, mais son worktree porte encore des changements. ` +
              `« discard » retire ce surplus définitivement et conserve l'intégration ; ` +
              `pour le garder, l'intégrer à la main d'abord — cet outil ne merge pas`,
          });
          break;
        }
        integrated.add(unit);
        // La branche ne prouve plus rien pour cette unité. Le worktree propre
        // qui traîne encore ne change pas ça : il est du ménage, pas une preuve.
        if (integrationCommit) cleanableBranches.add(unit);
        if (worktrees.has(unit)) {
          cleanableWorktrees.add(unit);
          warnings.push({
            workUnitId: unit,
            detail: `${unit} est intégrée, son worktree propre est à retirer`,
          });
        }
        break;
      case "abandoned":
        // Abandonnée au registre et pourtant dans l'intégration : les deux
        // sources se contredisent sur le sort du travail lui-même, ce qui est
        // plus grave qu'un worktree en trop.
        if (merged.has(unit)) {
          ajouter({
            kind: "abandon-contredit-par-git",
            workUnitId: unit,
            detail: `${unit} est abandonnée au registre, git montre pourtant son intégration`,
          });
          break;
        }
        if (worktrees.has(unit)) {
          /*
           * Le résidu reste une contradiction — une lane abandonnée ne devrait
           * plus avoir de worktree — mais un résidu **propre** est rangeable
           * mécaniquement : son contenu est sur la branche, qu'on ne touche
           * jamais. Sale, il porte du travail que l'abandon ne couvre pas, et
           * rien ne le retire.
           */
          if (!sales.has(unit)) cleanableWorktrees.add(unit);
          ajouter({
            kind: "residu-d-abandon",
            workUnitId: unit,
            detail: `${unit} est abandonnée, son worktree est toujours là`,
          });
        }
        break;
      case "never-started":
        break;
    }
  }

  /*
   * Un worktree sans provenance.
   *
   * C'est la fenêtre entre `git worktree add` et l'écriture de `OPENED`, et
   * c'est la contrepartie assumée de l'ordre choisi : plutôt qu'un registre qui
   * annonce une ouverture ratée, un worktree que le registre ne connaît pas.
   * `openLanes()` le voit, donc il n'est pas perdu — il est à adopter ou à
   * nettoyer, explicitement.
   */
  for (const unit of worktrees) {
    if (!states.has(unit)) {
      ajouter({
        kind: "worktree-orphelin",
        workUnitId: unit,
        detail: `un worktree existe pour ${unit}, sans provenance au registre`,
      });
    }
  }

  /*
   * Une intégration que rien n'explique.
   *
   * La recherche des unités sans provenance ne parcourait que les worktrees.
   * Un changement présent dans l'intégration sans aucun événement pour le
   * raconter passait donc inaperçu — alors que c'est la contradiction la plus
   * gênante : le dépôt porte du travail dont le run ne sait rien.
   */
  for (const unit of obs.runBranches ?? []) {
    if (!states.has(unit) && !worktrees.has(unit)) {
      ajouter({
        kind: "branche-sans-provenance",
        workUnitId: unit,
        detail:
          `une branche de lane existe pour ${unit}, sans provenance au registre` +
          (merged.has(unit) ? " ; git montre son intégration" : ""),
      });
    }
  }

  /*
   * Une unité intégrée dont le worktree traîne reste intégrée : le fait est
   * enregistré et git le confirme, c'est le résidu qui est en trop. Les autres
   * contradictions réservent leur scope.
   */
  const reserved = new Set<string>();
  for (const [unit, c] of conflicts) {
    // Toute contradiction réserve : y compris le résidu sale, dont c'est
    // précisément la raison d'être.
    void c;
    reserved.add(unit);
  }
  return {
    states, openUnits, integrated, cleanableBranches, cleanableWorktrees,
    conflicts, reserved, warnings,
  };
}

/** Le relevé des conflits, pour qu'une session reprise sache quoi regarder. */
export function describeConflicts(conflicts: ReadonlyMap<string, Conflict>): string {
  if (conflicts.size === 0) return "";
  return [
    `${conflicts.size} contradiction(s) entre le registre et le dépôt :`,
    ...[...conflicts.values()].map((c) => `  ${c.workUnitId}  ${c.kind} — ${c.detail}`),
    "  aucune n'est réparée automatiquement. Tant qu'elles subsistent, le run",
    "  n'accepte aucune délégation : on ne construit pas sur une histoire dont",
    "  les sources se contredisent.",
    "  Résoudre avec : bin/subagent-recover <unité> <adopt|integrated|abandoned|discard>",
  ].join("\n");
}
