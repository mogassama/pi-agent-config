/**
 * Ce qu'un appel à `task` a le droit de demander.
 *
 * Trois règles d'admission vivaient dans `execute()`, où rien ne pouvait les
 * éprouver. Un `grep` d'installation peut montrer qu'un symbole est câblé ; il
 * ne peut pas démontrer que « plan exploitable + worker sans lane » refuse et
 * que « plan exploitable + scout sans lane » passe. Ce sont des propriétés, et
 * une propriété se teste.
 *
 * Ce module ne fait que juger une forme d'appel. Il ne résout pas l'unité de
 * travail, ne valide pas le plan, ne détecte pas les doublons d'un lot et ne
 * compare aucun scope : ces questions appartiennent déjà à `lane-context.ts`,
 * `work-units.ts` et `scheduler.ts`, et les rejouer ici en ferait deux vérités.
 *
 * Il reçoit donc l'unité **déjà résolue**, déclarée ou dérivée de la provenance
 * des risques. C'est ce qui évite de réintroduire par la porte de derrière une
 * obligation de déclaration que tout le lot 1 a construite pour la supprimer :
 * un reviewer de continuation qui n'a nommé aucune unité en a bien une, et il
 * doit passer.
 */

export interface CallShape {
  agent: string;
  /** Un plan exploitable existe pour ce run. */
  plannedMode: boolean;
  /** L'unité visée, déclarée ou dérivée. Absente quand la délégation n'en vise aucune. */
  resolvedWorkUnit?: string;
  hasBatch: boolean;
  hasTask: boolean;
  /** `work_unit` tel que l'orchestrateur l'a écrit, pour le distinguer du dérivé. */
  declaredWorkUnit?: string;
  /**
   * La phase de la tentative d'intégration ouverte pour l'unité, s'il y en a une.
   *
   * L'état est celui du runtime, pas une déclaration : l'orchestrateur ne
   * fournit jamais l'identifiant d'une tentative ni sa phase, il constate qu'on
   * lui en annonce une.
   *
   * Une phase, et pas un booléen, parce que ce qui est admissible n'est pas le
   * même selon l'endroit où la tentative se trouve. `resolving` attend une
   * résolution puis sa review ; les deux autres ont déjà un commit derrière
   * elles et n'attendent plus personne.
   */
  integrationPhase?: IntegrationPhase;
}

/**
 * Où en est une tentative d'intégration.
 *
 * ```text
 * resolving          le conflit est ouvert : integration-worker, puis reviewer
 * ready-to-land      M existe et vaut ; seul son atterrissage a échoué
 * recovery-required  un commit a eu lieu et sa forme est fausse : personne ne continue
 * ```
 *
 * Les deux dernières existent parce que `commit-tree` est devenu `git commit` :
 * dès que le commit a un effet, le contexte n'est plus sur `P1` et n'a plus de
 * `MERGE_HEAD`. Y renvoyer un integration-worker le ferait travailler dans un
 * état qu'aucune suite ne peut reprendre, pendant que le worker de la lane
 * reste interdit — un blocage dont rien ne sortirait.
 */
export type IntegrationPhase = "resolving" | "ready-to-land" | "recovery-required";

export type CallPolicy = { ok: true } | { ok: false; reason: string };

/**
 * Les rôles qui écrivent ou qui jugent, et qui appartiennent donc à une lane
 * dès qu'un plan existe.
 *
 * Un worker sans lane écrirait à la racine pendant que des lanes travaillent
 * dans leurs worktrees ; un reviewer sans lane lirait un diff qui n'est celui
 * de personne. Un scout et un advisor ne possèdent rien et ne modifient rien :
 * ils restent globaux, et c'est une capacité qu'on veut garder.
 */
const LANE_BOUND = new Set(["worker", "reviewer"]);

/**
 * Le rôle qui ne travaille que dans un contexte d'intégration.
 *
 * Ce n'est pas un worker avec un autre répertoire : c'est un autre mandat.
 * Un worker implémente son unité dans sa lane ; celui-ci résout la rencontre
 * entre deux états déjà approuvés, sur les seuls fichiers que git n'a pas su
 * fusionner. Router silencieusement un `worker` vers le contexte d'intégration
 * ferait changer de sens au même appel d'outil sans changer son contrat, ce qui
 * est l'inverse exact de ce que les rôles stricts servent à obtenir.
 */
const INTEGRATION_ROLE = "integration-worker";

/**
 * Ce rôle travaille-t-il dans un répertoire qui appartient à une unité ?
 *
 * Trois le font : le worker et le reviewer dans la lane, l'integration-worker
 * dans le contexte d'intégration. Les autres — scout, advisor — répondent sur le
 * dépôt, et porter une unité ne change pas ce qu'ils sont : elle peut leur venir
 * de la provenance de leurs risques sans qu'ils l'aient nommée.
 *
 * `isReadOnly(tools)` serait le mauvais critère et l'a été : le reviewer n'a ni
 * `edit` ni `write`, donc il passait pour global alors qu'il juge le travail
 * d'une lane et doit le voir depuis cette lane.
 *
 * Sur le rôle joué, pas sur le nom de l'agent : une variante de reviewer sur un
 * autre modèle déclare `envelopeRole: reviewer` et hérite de la décision sans
 * avoir à être inscrite ici.
 */
export function isLaneBound(role: string): boolean {
  return LANE_BOUND.has(role) || role === INTEGRATION_ROLE;
}

/** Le lot n'est ouvert qu'au worker. Les reviews restent unitaires — voir §3a. */
const BATCH_ROLES = new Set(["worker"]);

export function validateTaskCall(call: CallShape): CallPolicy {
  // La forme d'abord : un appel qui n'a pas de sens n'a pas de mode.
  if (call.hasTask && call.hasBatch) {
    return { ok: false, reason: "`task` et `batch` sont exclusifs : l'un ou l'autre." };
  }
  if (!call.hasTask && !call.hasBatch) {
    return { ok: false, reason: "il faut `task`, ou `batch` pour plusieurs unités." };
  }
  if (call.hasBatch && !BATCH_ROLES.has(call.agent)) {
    return {
      ok: false,
      reason: `\`batch\` n'est ouvert qu'au worker ; ${call.agent} se délègue une unité à la fois.`,
    };
  }
  if (call.hasBatch && call.declaredWorkUnit) {
    return { ok: false, reason: "chaque entrée de `batch` porte son unité ; `work_unit` est en trop." };
  }

  /*
   * Le rôle d'intégration, qui n'existe que là où une tentative existe.
   *
   * Vérifié avant le régime libre, contrairement à tout le reste de ce fichier.
   * Les autres rôles gardent un sens sans plan — c'est l'invariant du chantier,
   * pi fonctionne à l'identique sans bundle. Celui-ci n'en a aucun : sans lane,
   * sans gel et sans contexte, il n'y a pas de rencontre entre deux états à
   * résoudre, et l'appel n'aurait ni répertoire ni objet.
   */
  if (call.agent === INTEGRATION_ROLE) {
    if (call.hasBatch) {
      return {
        ok: false,
        reason: "une intégration se résout une tentative à la fois : `batch` ne s'applique pas.",
      };
    }
    /*
     * Déclarée, pas dérivée.
     *
     * `resolvedWorkUnit` peut venir de la provenance des risques : un appel qui
     * porte `for_risks` rattachés à W03 en hérite sans l'avoir nommée. Cette
     * dérivation existe pour le reviewer de continuation, qui a bien une unité
     * sans avoir eu à la déclarer. Une résolution de conflit n'est jamais une
     * continuation : elle vise un contexte précis, et laisser l'unité être
     * devinée ferait résoudre le conflit de quelqu'un d'autre.
     */
    if (!call.declaredWorkUnit) {
      return {
        ok: false,
        reason: `${INTEGRATION_ROLE} doit déclarer son \`work_unit\` : elle ne se dérive pas.`,
      };
    }
    if (!call.resolvedWorkUnit) {
      return { ok: false, reason: `${INTEGRATION_ROLE} doit nommer l'unité dont il intègre la lane.` };
    }
    if (call.integrationPhase !== "resolving") {
      return {
        ok: false,
        reason: call.integrationPhase
          ? `la tentative de ${call.resolvedWorkUnit} est en \`${call.integrationPhase}\` : ` +
            "son commit d'intégration existe déjà, il n'y a plus de conflit à résoudre."
          : `aucune tentative d'intégration n'est ouverte pour ${call.resolvedWorkUnit}. ` +
            `${INTEGRATION_ROLE} ne s'appelle qu'après un conflit annoncé par le runtime — ` +
            "il ne l'ouvre pas lui-même.",
      };
    }
    return { ok: true };
  }

  /*
   * `recovery-required` seul, et pas `ready-to-land`.
   *
   * Les deux ont un commit derrière elles, mais elles ne se reprennent pas de
   * la même façon. `ready-to-land` se reprend par le runtime, qui réessaie
   * l'atterrissage à la délégation suivante — donc après le bail, donc après ce
   * jugement. La refuser ici empêcherait la seule chose qui la débloque.
   *
   * `recovery-required` attend un opérateur : aucun enfant n'a de raison de
   * travailler sur un contexte dont le HEAD n'est plus `P1` et qui n'a plus de
   * `MERGE_HEAD`.
   */
  if (call.integrationPhase === "recovery-required") {
    return {
      ok: false,
      reason:
        `la tentative de ${call.resolvedWorkUnit} est en \`${call.integrationPhase}\` : ` +
        "aucune délégation sur cette unité tant qu'elle n'est pas reprise.",
    };
  }

  /*
   * Une unité en cours d'intégration n'est pas en cours de développement.
   *
   * Son travail est gelé et approuvé ; ce qui reste à faire est la résolution
   * d'un conflit, dans le contexte d'intégration et sur ses seuls fichiers. Un
   * worker relancé dans la lane pendant ce temps modifierait un état dont une
   * tentative détient déjà l'image, et l'intégration se ferait sur ce que
   * personne n'a revu.
   *
   * **Le worker seul.** Une première version refusait aussi le reviewer, au
   * motif qu'il est également lié à la lane. Elle rendait le flux impossible :
   * la résolution doit être revue, et c'est le reviewer qui la revoit — le
   * runtime lui donne alors le contexte d'intégration au lieu de la lane. Il
   * change d'objet, pas de droit. Cohérente en isolation, la règle interdisait
   * la seule suite légale ; seul le harnais pouvait le montrer.
   */
  if (call.integrationPhase === "resolving" && call.agent === "worker") {
    return {
      ok: false,
      reason:
        `une tentative d'intégration est ouverte pour ${call.resolvedWorkUnit} : ` +
        "le worker y est refusé tant qu'elle vit, son travail est gelé et approuvé. " +
        `Déléguer à ${INTEGRATION_ROLE}, ou laisser le runtime retirer la tentative.`,
    };
  }

  /*
   * En régime libre — aucun plan exploitable — tout reste possible. C'est
   * l'invariant du chantier : pi doit fonctionner à l'identique sans bundle et
   * sans plan, et les lanes ne doivent pas devenir la condition de son
   * fonctionnement.
   */
  if (!call.plannedMode) return { ok: true };

  // Un lot porte ses unités dans ses entrées ; le scheduler les admet une par une.
  if (call.hasBatch) return { ok: true };

  if (LANE_BOUND.has(call.agent) && !call.resolvedWorkUnit) {
    return {
      ok: false,
      reason: `un plan est en place : ${call.agent} doit nommer son \`work_unit\`.`,
    };
  }
  return { ok: true };
}
