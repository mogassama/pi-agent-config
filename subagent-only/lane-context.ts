/**
 * Le contexte d'exécution d'une WorkUnit, dérivé et non déclaré.
 *
 * La distinction qui compte, et qu'il est facile de perdre : l'orchestrateur
 * **choisit** la WorkUnit, le runtime **dérive** tout le reste. Il désigne W06 ;
 * il ne redonne ni `cwd`, ni branche, ni identifiant de lane, ni frontière de
 * review. Une fois l'unité ciblée, son identité et son contexte sont résolus
 * ici.
 *
 * C'est ce qui règle les 38 % de temps de délégation non attribués au run 15.
 * L'annotation `work_unit` valait 14/14 sur les workers et 0 sur les vingt
 * reviewers et onze scouts, parce que la guideline ne la demandait qu'aux
 * premiers. Une phrase de plus dans le prompt aurait déplacé le problème :
 * l'orchestrateur aurait eu une chose de plus à ne pas oublier, et la sonde S a
 * mesuré ce que vaut une consigne en prose — une fois sur trois.
 *
 * Deux chemins de résolution, et le second est le plus utile :
 *
 *     work_unit déclaré      → LaneContext directement
 *     for_risks sans unité   → risque → l'unité qui l'a ouvert → LaneContext
 *
 * Le second vaut parce qu'un scout de continuation n'a aucune raison de répéter
 * l'unité : le risque qu'il porte sait déjà d'où il vient. Aucune heuristique,
 * aucune déduction par l'ordre — la provenance est déjà dans le registre.
 *
 * Au lot 1 il n'y a pas encore de worktree : `cwd` est la racine du dépôt et
 * `branch` est vide. La forme est complète pour que le lot 2 substitue le
 * worktree sans changer un seul appelant.
 */
import type { RiskRecord } from "./risk-ledger.js";

export interface LaneContext {
  laneId: string;
  workUnitId: string;
  /** Là où la délégation travaille. Racine du dépôt tant qu'il n'y a pas de worktree. */
  cwd: string;
  /** Branche de la lane. Vide tant qu'il n'y a pas de worktree. */
  branch: string;
}

export interface LaneRoots {
  runId: string;
  root: string;
}

/**
 * La lane d'une WorkUnit. Le laneId porte le run, comme les identifiants de
 * risque : deux runs ne se marchent pas dessus et la provenance se lit sans
 * table de correspondance.
 */
export function deriveLane(workUnitId: string, roots: LaneRoots): LaneContext {
  return {
    laneId: `${roots.runId}-${workUnitId}`,
    workUnitId,
    cwd: roots.root,
    branch: "",
  };
}

/**
 * L'unité d'où viennent des risques confiés, quand l'orchestrateur ne la nomme pas.
 *
 * Renvoie l'unité seulement si tous les risques nommés viennent de la même :
 * un appel qui mélange des risques de deux unités n'a pas de lane, et deviner
 * laquelle en prendrait une au hasard. Un identifiant inconnu du registre ne
 * compte pas — il est déjà journalisé comme tel par les transitions.
 */
export function laneOfRisks(
  riskIds: readonly string[],
  ledger: readonly RiskRecord[],
): string | undefined {
  const units = new Set<string>();
  for (const id of riskIds) {
    const rec = ledger.find((r) => r.id === id);
    if (rec?.workUnitId) units.add(rec.workUnitId);
  }
  return units.size === 1 ? [...units][0] : undefined;
}

export type Target =
  | { kind: "none" }
  | { kind: "unit"; workUnitId: string; from: "declared" | "provenance" }
  | { kind: "conflict"; reason: string };

/**
 * L'unité que cette délégation vise, déclarée ou dérivée — ou un refus.
 *
 * La première version laissait une déclaration explicite écraser la provenance
 * des risques. C'était faux, et dangereux dès qu'il y a des worktrees.
 * `for_risks` ne veut pas dire « je pars de cette unité » : il veut dire « je
 * poursuis une review restée ouverte sur ce risque », et ce risque a une
 * provenance factuelle, écrite dans le registre au moment où il a été ouvert.
 *
 * Un `work_unit` qui la contredit enverrait la continuation dans le mauvais
 * arbre :
 *
 *     r1 ouvert par le reviewer de W06
 *     scout(for_risks=[r1], work_unit=W08)
 *     → cwd = worktree de W08, alors que r1 vit dans W06
 *
 * Donc conflit, et refus. Le cas « scout parti de W06 pour préparer W08 » reste
 * possible ; il se fait sans porter les risques de W06.
 *
 * Deux risques venant de deux unités différentes ne donnent pas non plus une
 * lane : une continuation appartient à une unité, pas à deux.
 */
export function targetWorkUnit(
  declared: string | undefined,
  riskIds: readonly string[],
  ledger: readonly RiskRecord[],
): Target {
  const named = declared?.trim() || undefined;
  const known = riskIds
    .map((id) => ledger.find((r) => r.id === id)?.workUnitId)
    .filter((u): u is string => u !== undefined);
  const units = [...new Set(known)];

  if (units.length > 1) {
    return {
      kind: "conflict",
      reason: `les risques confiés viennent de ${units.join(" et ")} : une continuation appartient à une seule unité`,
    };
  }
  const fromRisks = units[0];
  if (fromRisks && named && named !== fromRisks) {
    return {
      kind: "conflict",
      reason: `work_unit ${named} contredit la provenance des risques confiés (${fromRisks})`,
    };
  }
  if (fromRisks) return { kind: "unit", workUnitId: fromRisks, from: named ? "declared" : "provenance" };
  if (named) return { kind: "unit", workUnitId: named, from: "declared" };
  return { kind: "none" };
}
