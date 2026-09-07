/**
 * Le nettoyage : un plan, puis des suppressions. Rien entre les deux.
 *
 * **Il ne prend aucune décision.** Ce qui est rangeable a été établi par la
 * réconciliation, qui croise les registres et le disque ; ce module traduit ces
 * ensembles en objets à retirer, et les retire. Il n'écrit aucun événement, ne
 * répare rien, et ne déduit rien qu'un registre ne dise déjà — un nettoyage qui
 * interprète est un nettoyage qui peut se tromper sur ce qu'il détruit.
 *
 * **Le plan est séparé de l'effet** parce qu'un plan se lit avant d'agir, se
 * teste sans rien détruire, et se rend tel quel dans un relevé. `planCleanup`
 * est pur ; `applyCleanup` ne fait que des appels git.
 *
 * L'invariant transversal du chantier vaut ici plus qu'ailleurs : **rien ne se
 * supprime qui porte du contenu qu'aucune autre référence ne désigne.** Un
 * worktree sale, une branche sans preuve durable, un contexte qui tient encore
 * `P2` — chacun est retenu, et le plan dit pourquoi.
 */

import type { Reconciliation } from "./lane-ledger.ts";
import type { IntegrationReconciliation } from "./integration-ledger.ts";
import { removeIntegration } from "./integration.ts";
import { laneBranch, removeLane, removeLaneBranch } from "./worktree.ts";

/** Un objet conservé, et la raison qui l'a retenu. */
export interface Retained {
  object: string;
  reason: string;
}

export interface CleanupPlan {
  /** Unités dont le worktree de lane est à retirer. */
  laneWorktrees: string[];
  /** Unités dont la branche de lane est à retirer, après leur worktree. */
  laneBranches: string[];
  /** Identifiants de contextes d'intégration à retirer. */
  integrationContexts: string[];
  retained: Retained[];
}

/**
 * Ce qu'il y a à retirer, et ce qui reste — sans toucher à rien.
 *
 * Les deux réconciliations sont les seules sources : leurs ensembles disent ce
 * qui est rangeable, leurs conflits et leurs états disent ce qui ne l'est pas.
 * Aucune règle n'est réécrite ici, sans quoi elle finirait par diverger de celle
 * qui ferme le run.
 */
export function planCleanup(
  lanes: Reconciliation,
  integrations?: IntegrationReconciliation,
): CleanupPlan {
  const retained: Retained[] = [];

  const laneWorktrees = [...lanes.cleanableWorktrees].sort();
  /*
   * Une branche ne se retire que si son worktree part dans le même plan, ou
   * qu'il n'y en a plus. `cleanableBranches` et `cleanableWorktrees` ne se
   * recouvrent pas nécessairement — une unité intégrée avec preuve durable et
   * dont le worktree est sale a une branche « rangeable » sur le papier et un
   * résidu qui l'utilise encore.
   */
  const laneBranches = [...lanes.cleanableBranches]
    .filter((u) => !lanes.conflicts.has(u))
    .sort();

  for (const unit of lanes.integrated) {
    if (lanes.cleanableBranches.has(unit)) continue;
    retained.push({
      object: laneBranch(unit),
      reason:
        `${unit} est intégrée sans commit d'intégration au registre : sa branche est ` +
        "la preuve de cette intégration.",
    });
  }
  for (const [unit, conflit] of lanes.conflicts) {
    retained.push({
      object: unit,
      reason: `contradiction non tranchée — ${conflit.kind} : ${conflit.detail}`,
    });
  }
  for (const [unit, etat] of lanes.states) {
    if (etat !== "abandoned") continue;
    retained.push({
      object: laneBranch(unit),
      reason: `${unit} est abandonnée : sa branche est la seule référence vers son travail.`,
    });
  }

  const integrationContexts = integrations ? [...integrations.residues].sort() : [];
  if (integrations) {
    for (const [unit, { id, phase }] of integrations.phases) {
      retained.push({
        object: id,
        reason: `tentative vivante pour ${unit} (${phase}) : son contexte n'est pas un résidu.`,
      });
    }
    for (const c of integrations.conflicts) {
      retained.push({
        object: c.attemptId ?? c.workUnitId ?? "registre des tentatives",
        reason: `contradiction non tranchée — ${c.kind} : ${c.detail}`,
      });
    }
  }

  return { laneWorktrees, laneBranches, integrationContexts, retained };
}

export interface CleanupOutcome {
  removedWorktrees: string[];
  removedBranches: string[];
  removedContexts: string[];
  /** Ce que le plan prévoyait et que git a refusé de retirer. */
  failures: Retained[];
}

/**
 * Exécuter le plan. Aucune décision, aucun événement.
 *
 * **Le worktree avant la branche, et la branche seulement si le worktree est
 * parti.** Retirer une branche dont un worktree dépend encore laisse git dans un
 * état qu'il refuse de toute façon, et surtout : tant que le worktree est là, il
 * peut porter quelque chose. L'ordre inverse échangerait une preuve contre un
 * résidu.
 *
 * Un échec n'interrompt rien et n'est pas une perte de vérité — pour une unité
 * intégrée, `M` reste la preuve. Il est rapporté comme un objet conservé, ce
 * qu'il est.
 */
export interface CleanupEffects {
  removeLane: (root: string, laneId: string) => boolean;
  removeLaneBranch: (root: string, laneId: string) => boolean;
  removeIntegration: (root: string, id: string) => boolean;
}

/** Les vraies suppressions. Remplaçables pour éprouver l'ordre sans détruire. */
export const REAL_EFFECTS: CleanupEffects = { removeLane, removeLaneBranch, removeIntegration };

export function applyCleanup(
  root: string,
  runId: string,
  plan: CleanupPlan,
  effets: CleanupEffects = REAL_EFFECTS,
): CleanupOutcome {
  const out: CleanupOutcome = {
    removedWorktrees: [],
    removedBranches: [],
    removedContexts: [],
    failures: [],
  };

  const retires = new Set<string>();
  for (const unit of plan.laneWorktrees) {
    const laneId = `${runId}-${unit}`;
    if (effets.removeLane(root, laneId)) {
      out.removedWorktrees.push(laneId);
      retires.add(unit);
    } else {
      out.failures.push({ object: laneId, reason: "git a refusé de retirer ce worktree" });
    }
  }

  for (const unit of plan.laneBranches) {
    const laneId = `${runId}-${unit}`;
    // Si son worktree devait partir et n'est pas parti, la branche reste.
    if (plan.laneWorktrees.includes(unit) && !retires.has(unit)) {
      out.failures.push({
        object: laneBranch(laneId),
        reason: "son worktree n'a pas pu être retiré : la branche reste avec lui",
      });
      continue;
    }
    if (effets.removeLaneBranch(root, laneId)) out.removedBranches.push(laneBranch(laneId));
    else out.failures.push({ object: laneBranch(laneId), reason: "git a refusé de retirer cette branche" });
  }

  for (const id of plan.integrationContexts) {
    if (effets.removeIntegration(root, id)) out.removedContexts.push(id);
    else out.failures.push({ object: id, reason: "git a refusé de retirer ce contexte" });
  }

  return out;
}
