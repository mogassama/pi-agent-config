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
}

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
