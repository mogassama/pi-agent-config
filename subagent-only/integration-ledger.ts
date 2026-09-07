/**
 * Le registre des tentatives d'intégration : sa vie sur disque, et sa
 * réconciliation avec ce que le dépôt montre.
 *
 * Les tentatives vivaient en mémoire pendant que leurs contextes vivaient sur
 * disque. Après un redémarrage, le runtime oubliait qu'une unité était bloquée
 * pendant que son worktree restait là : la politique ne savait plus qu'elle
 * devait refuser, et un contexte sans provenance passait inaperçu. C'est le seul
 * problème que ce module résout.
 *
 * **Un registre distinct de celui des lanes.** Une tentative d'intégration n'est
 * ni une lane ni une WorkUnit : elle naît d'une rencontre entre deux commits, en
 * meurt, et plusieurs peuvent se succéder pour une même unité. Mêler ses
 * événements à `OPENED / INTEGRATED / ABANDONED` donnerait au registre des lanes
 * deux vocabulaires et deux durées de vie sous le même en-tête.
 *
 * **Le fold lit les faits, la réconciliation diagnostique.** Comme depuis 3b.2 :
 * `foldIntegrations` dit ce que le registre affirme, `reconcileIntegrations`
 * confronte ces affirmations à ce que le dépôt montre. Aucun événement n'est
 * inventé pour décrire une contradiction — une contradiction découverte à la
 * reprise produit un état effectif, pas une ligne au registre.
 */

/**
 * `<runId>-<unité>-<seq>`.
 *
 * Le troisième terme est la séquence durable du run, celle qu'`allocateSeq`
 * distribue, et non un compteur de tentative tenu en mémoire — une reprise
 * ignorerait ce dernier et rouvrirait `-1` sur un contexte qui existe déjà. Les
 * trous sont déjà admis dans cette séquence, donc une tentative qui échoue
 * avant d'ouvrir n'en fabrique pas un second.
 *
 * Une tentative périmée reste ainsi observable sous son propre nom pendant que
 * la suivante s'ouvre sous le sien.
 */
export function attemptId(runId: string, workUnitId: string, seq: number): string {
  return `${runId}-${workUnitId}-${seq}`;
}

/** L'identité d'une tentative, telle que le registre la nomme. */
export type IntegrationEvent =
  | {
      event: "ATTEMPT_OPENED";
      id: string;
      work_unit: string;
      seq: number;
      /** La base d'intégration au moment de l'ouverture. Immuable. */
      p1: string;
      /** Le commit gelé de la lane. Immuable. */
      p2: string;
      conflicts: string[];
      at: string;
    }
  | {
      /**
       * Le commit d'intégration a été créé.
       *
       * Sans `p1` ni `p2` : ils sont immuables depuis l'ouverture, et les
       * répéter créerait deux sources durables capables de se contredire sans
       * apporter de preuve supplémentaire.
       */
      event: "COMMITTED";
      id: string;
      commit: string;
      tree: string;
      at: string;
    }
  | {
      /**
       * Le runtime a observé lui-même un état qu'il ne sait pas reprendre.
       *
       * Écrit au moment où l'effet se produit — un hook qui fabrique un `M` de
       * mauvaise forme, par exemple. Jamais au redémarrage : une contradiction
       * découverte par réconciliation produit l'état effectif correspondant, et
       * l'inventer comme un fait ferait passer un diagnostic pour une
       * observation.
       */
      event: "RECOVERY_REQUIRED";
      id: string;
      reason: string;
      observed_commit?: string;
      at: string;
    }
  | { event: "SUPERSEDED"; id: string; by: string; at: string }
  | { event: "CLOSED"; id: string; outcome: string; at: string };

/** Ce que le registre affirme d'une tentative. */
export interface AttemptFacts {
  id: string;
  workUnit: string;
  seq: number;
  p1: string;
  p2: string;
  conflicts: readonly string[];
  committed?: { commit: string; tree: string };
  recovery?: { reason: string; observedCommit?: string };
  supersededBy?: string;
  closed?: string;
}

/** Une tentative que rien n'a close ni remplacée. */
export function isActive(a: AttemptFacts): boolean {
  return a.supersededBy === undefined && a.closed === undefined;
}

export interface Fold {
  attempts: Map<string, AttemptFacts>;
  /** Ce que le journal raconte et qui ne peut pas s'être produit. */
  inconsistencies: string[];
}

/**
 * Les faits, par tentative, et ce que le journal a d'impossible.
 *
 * Une première version ignorait en silence un événement portant sur une
 * tentative jamais ouverte. C'était le mauvais choix pour un journal qui
 * constitue la provenance : `COMMITTED I7` sans son ouverture ne veut pas dire
 * « rien », il veut dire « ce journal contient un fait qu'on ne sait pas
 * rattacher » — et si aucun contexte `I7` n'existe sur le disque, l'anomalie
 * disparaissait complètement.
 *
 * Trois propriétés suffisent ici, et elles ne demandent pas un moteur
 * événementiel : l'identité d'une ouverture doit être celle que `attemptId`
 * calcule, un fait doit porter sur une tentative ouverte, et une tentative ne
 * s'ouvre qu'une fois. Le `runId` est optionnel parce que la première ne se
 * vérifie que là où on le connaît.
 */
export function foldIntegrations(events: readonly IntegrationEvent[], runId?: string): Fold {
  const attempts = new Map<string, AttemptFacts>();
  const inconsistencies: string[] = [];
  for (const e of events) {
    if (e.event === "ATTEMPT_OPENED") {
      if (attempts.has(e.id)) {
        inconsistencies.push(`${e.id} est ouverte deux fois`);
        continue;
      }
      if (runId !== undefined && e.id !== attemptId(runId, e.work_unit, e.seq)) {
        inconsistencies.push(
          `${e.id} ne correspond pas à (${runId}, ${e.work_unit}, ${e.seq}) : ` +
          "l'identité d'une tentative est calculée, pas déclarée",
        );
        continue;
      }
      attempts.set(e.id, {
        id: e.id,
        workUnit: e.work_unit,
        seq: e.seq,
        p1: e.p1,
        p2: e.p2,
        conflicts: e.conflicts,
      });
      continue;
    }
    const a = attempts.get(e.id);
    if (!a) {
      inconsistencies.push(`${e.event} porte sur ${e.id}, qu'aucune ouverture ne précède`);
      continue;
    }
    if (e.event === "COMMITTED") a.committed = { commit: e.commit, tree: e.tree };
    else if (e.event === "RECOVERY_REQUIRED") {
      a.recovery = { reason: e.reason, observedCommit: e.observed_commit };
    } else if (e.event === "SUPERSEDED") a.supersededBy = e.by;
    else if (e.event === "CLOSED") a.closed = e.outcome;
  }
  return { attempts, inconsistencies };
}

/**
 * Ce que le dépôt montre, rassemblé par l'appelant.
 *
 * Ce module ne parle à personne, comme `lane-ledger`. Les quatre vérités sont
 * croisées ici, pas interrogées ici.
 */
export interface IntegrationObservations {
  /** Les contextes présents sur le disque, par identifiant de tentative. */
  contexts: readonly string[];
  /** `HEAD` de chaque contexte présent. */
  head: Readonly<Record<string, string>>;
  /** `MERGE_HEAD` de chaque contexte présent, absent quand il n'y a pas de merge. */
  mergeHead: Readonly<Record<string, string>>;
  /** Pour un `M` enregistré : sa forme est-elle celle qu'on attend ? */
  mergeShapeOk: Readonly<Record<string, boolean>>;
  /** Les commits `M` que la racine contient. */
  landed: readonly string[];
  /** Le commit d'intégration que le registre des lanes prouve, par unité. */
  laneIntegrated: Readonly<Record<string, string>>;
}

export type AttemptPhase = "resolving" | "ready-to-land" | "recovery-required";

export interface IntegrationConflict {
  kind:
    | "contexte-sans-provenance"
    | "tentative-sans-contexte"
    | "contexte-deplace"
    | "merge-perdu"
    | "commit-de-mauvaise-forme"
    | "commit-absent-du-contexte"
    | "integration-non-enregistree"
    | "tentatives-concurrentes"
    | "journal-incoherent"
    | "journal-illisible";
  attemptId?: string;
  workUnitId?: string;
  detail: string;
}

export interface IntegrationReconciliation {
  /** La tentative vivante de chaque unité, et où elle en est. */
  phases: Map<string, { id: string; phase: AttemptPhase }>;
  /** Les unités dont l'intégration est déjà prouvée par le registre des lanes. */
  integrated: Set<string>;
  conflicts: IntegrationConflict[];
  warnings: string[];
  /** Contextes présents dont la tentative est close ou remplacée. */
  residues: string[];
}

/**
 * Croiser les quatre vérités : le registre, les contextes, leur état git, et le
 * registre des lanes.
 *
 * Pas « le registre, puis quelques vérifications » : un contexte présent que le
 * registre ignore est aussi grave qu'une tentative dont le contexte a disparu,
 * et une seule des deux directions serait une garde à moitié.
 */
export function reconcileIntegrations(
  events: readonly IntegrationEvent[],
  obs: IntegrationObservations,
  runId?: string,
): IntegrationReconciliation {
  const { attempts: facts, inconsistencies } = foldIntegrations(events, runId);
  const contexts = new Set(obs.contexts);
  const landed = new Set(obs.landed);
  const phases = new Map<string, { id: string; phase: AttemptPhase }>();
  const integrated = new Set<string>();
  const conflicts: IntegrationConflict[] = [];
  const warnings: string[] = [];
  const residues: string[] = [];
  const connus = new Set<string>();

  for (const detail of inconsistencies) {
    conflicts.push({ kind: "journal-incoherent", detail });
  }

  for (const a of facts.values()) {
    connus.add(a.id);

    if (!isActive(a)) {
      // Close ou remplacée : son contexte, s'il est encore là, est un résidu
      // connu — nommé, et jamais pris pour une tentative vivante.
      if (contexts.has(a.id)) residues.push(a.id);
      continue;
    }

    // Deux tentatives vivantes pour la même unité : c'est le crash entre
    // `ATTEMPT_OPENED(I2)` et `SUPERSEDED(I1)`. Choisir la plus récente serait
    // une heuristique là où il faut une décision.
    const deja = phases.get(a.workUnit);
    if (deja) {
      conflicts.push({
        kind: "tentatives-concurrentes",
        workUnitId: a.workUnit,
        detail:
          `${a.workUnit} a deux tentatives vivantes : ${deja.id} et ${a.id}. ` +
          "Une réouverture s'est interrompue entre l'ouverture de la seconde et " +
          "le remplacement de la première.",
      });
      continue;
    }

    /*
     * Le contexte doit exister, y compris — et surtout — pour une tentative en
     * attente de reprise.
     *
     * `recovery-required` était traité avant cette vérification, si bien qu'un
     * contexte supprimé sous une tentative bloquée produisait une phase et un
     * avertissement là où les quatre vérités disaient « registre : vivante,
     * disque : absente ». L'objet à diagnostiquer doit être là pour qu'on
     * puisse dire à quelqu'un de le diagnostiquer.
     */
    if (!contexts.has(a.id)) {
      conflicts.push({
        kind: "tentative-sans-contexte",
        attemptId: a.id,
        workUnitId: a.workUnit,
        detail: `${a.id} est ouverte au registre et son contexte n'est pas sur le disque`,
      });
      continue;
    }

    /*
     * Sa position, en revanche, n'est plus exigée : le commit qui a causé la
     * reprise a pu déplacer `HEAD` et faire disparaître `MERGE_HEAD`, et c'est
     * précisément ce qu'un opérateur vient regarder.
     */
    if (a.recovery) {
      phases.set(a.workUnit, { id: a.id, phase: "recovery-required" });
      warnings.push(`${a.id} attend une reprise : ${a.recovery.reason}`);
      continue;
    }

    if (!a.committed) {
      // Pas encore de commit : le contexte doit être exactement où on l'a laissé.
      if (obs.head[a.id] !== a.p1) {
        conflicts.push({
          kind: "contexte-deplace",
          attemptId: a.id,
          workUnitId: a.workUnit,
          detail:
            `${a.id} devrait être sur ${a.p1.slice(0, 12)}, son contexte est sur ` +
            `${(obs.head[a.id] ?? "rien").slice(0, 12)}`,
        });
        continue;
      }
      if (obs.mergeHead[a.id] !== a.p2) {
        /*
         * Le merge a disparu. C'est aussi le crash entre `git commit` et
         * `COMMITTED` : le contexte porterait alors `M` et plus aucun
         * `MERGE_HEAD`. On ne reconstitue pas un `COMMITTED` rétroactivement —
         * ce serait écrire un fait qu'on n'a pas observé.
         */
        conflicts.push({
          kind: "merge-perdu",
          attemptId: a.id,
          workUnitId: a.workUnit,
          detail: `${a.id} ne fusionne plus ${a.p2.slice(0, 12)}`,
        });
        continue;
      }
      phases.set(a.workUnit, { id: a.id, phase: "resolving" });
      continue;
    }

    const m = a.committed.commit;
    if (!obs.mergeShapeOk[m]) {
      conflicts.push({
        kind: "commit-de-mauvaise-forme",
        attemptId: a.id,
        workUnitId: a.workUnit,
        detail: `${m.slice(0, 12)} ne porte pas le tree revu ou les deux parents attendus`,
      });
      continue;
    }
    if (obs.head[a.id] !== m) {
      conflicts.push({
        kind: "commit-absent-du-contexte",
        attemptId: a.id,
        workUnitId: a.workUnit,
        detail: `${a.id} devrait porter ${m.slice(0, 12)} et porte ${(obs.head[a.id] ?? "rien").slice(0, 12)}`,
      });
      continue;
    }

    if (!landed.has(m)) {
      phases.set(a.workUnit, { id: a.id, phase: "ready-to-land" });
      continue;
    }

    /*
     * `M` est dans la racine. Le registre des lanes doit le dire aussi.
     *
     * S'il ne le dit pas, c'est le crash entre le `ff-only` et l'écriture de
     * `INTEGRATED` : le travail est intégré et rien ne le prouve. Surtout pas
     * une tentative périmée à rouvrir — `P1` × `P2` serait refait par-dessus un
     * merge déjà présent.
     */
    if (obs.laneIntegrated[a.workUnit] !== m) {
      conflicts.push({
        kind: "integration-non-enregistree",
        attemptId: a.id,
        workUnitId: a.workUnit,
        detail:
          `${m.slice(0, 12)} est dans la racine et le registre des lanes ne l'enregistre pas. ` +
          "L'intégration a eu lieu, sa preuve manque.",
      });
      continue;
    }

    /*
     * Intégrée, et la tentative n'a pas été close. La vérité métier est prouvée
     * par une source plus forte que ce bookkeeping : un `CLOSED` manquant ne
     * doit pas rebloquer une unité dont l'intégration est durablement démontrée.
     */
    integrated.add(a.workUnit);
    warnings.push(`${a.id} a intégré ${m.slice(0, 12)} sans être close`);
  }

  for (const id of obs.contexts) {
    if (connus.has(id)) continue;
    conflicts.push({
      kind: "contexte-sans-provenance",
      attemptId: id,
      detail: `le contexte ${id} est sur le disque et aucun événement ne l'a ouvert`,
    });
  }

  return { phases, integrated, conflicts, warnings, residues };
}

/** Un texte pour l'opérateur, sans inventer de remède. */
export function describeIntegrationConflicts(conflicts: readonly IntegrationConflict[]): string {
  return conflicts.map((c) => `  ${c.kind} — ${c.detail}`).join("\n");
}
