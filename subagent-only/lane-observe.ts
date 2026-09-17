/**
 * Ce que le runtime, la reprise, le nettoyage et le relevé voient des lanes — et
 * ils doivent voir la même chose.
 *
 * Pendant tout 3c.1, ils n'ont pas vu la même. Le runtime a appris à confirmer
 * les commits d'intégration ; `bin/subagent-recover` a gardé sa propre collecte
 * et n'a jamais reçu `confirmedCommits`, si bien qu'il tenait chaque unité
 * intégrée pour prouvée par sa seule branche. Plus prudent, donc invisible — et
 * différent, ce qui est la seule chose qui compte pour un outil censé trancher
 * ce que le runtime refuse. La divergence n'a été vue que le jour où un verbe a
 * dépendu de `cleanableBranches`.
 *
 * Le pendant exact d'`integration-observe.ts`, et pour la même raison.
 *
 * **Ce module ne lit pas le registre.** Il reçoit le snapshot que son appelant a
 * déjà lu, qui transmet ensuite le même à `observeIntegrations` : une
 * reconstruction ne doit pas mélanger deux lectures d'un fichier que quelqu'un
 * peut écrire entre les deux.
 *
 * **Et un registre partiel ne reconstruit rien.** Une version inconnue ou une
 * ligne illisible interdit tout bilan, ici comme pour les tentatives. Le
 * runtime le tenait déjà ; l'outil, lui, calculait un bilan sur les événements
 * lisibles et pouvait en tirer un plan de suppression.
 */

import { join } from "node:path";

import {
  reconcile,
  integrationCommits,
  projectLegacyGenerations,
  type LaneEvent,
  type Observations,
  type Reconciliation,
} from "./lane-ledger.ts";
import {
  LANE_LEDGER_VERSION,
  RUNS_DIR,
  laneLedgerState,
  ledgerFacts,
  ledgerObservation,
  readWitnesses,
  type LedgerObservation,
} from "./run-manifest.ts";
import {
  confirmIntegrations,
  isMerged,
  laneChanges,
  openLanes,
  runBranches,
} from "./worktree.ts";

/** Le snapshot du registre des lanes, tel que `readLaneEvents` le rend. */
export interface LaneRead {
  events: LaneEvent[];
  malformedLines: number[];
  version: number | undefined;
  /** Transporté tel que le lecteur l'a observé, jamais recalculé (C4.9). */
  present: boolean;
}

export interface LaneSnapshot {
  read: LaneRead;
  /** La base de chaque lane, telle que son ouverture l'a enregistrée. */
  bases: Map<string, string>;
  observations: Observations;
  reconciliation: Reconciliation;
}

export type ObservedLanes = LedgerObservation<LaneSnapshot>;

export function observeLanes(input: {
  root: string;
  runId: string;
  laneRead: LaneRead;
}): ObservedLanes {
  const { root, runId, laneRead } = input;

  /*
   * L'état d'abord, sur le manifeste relu MAINTENANT, après la lecture du registre que
   * l'appelant a faite (P3). Rien ne consomme un événement avant que `state` soit établi :
   * sous une version inconnue, les lignes que le lecteur a reconnues ne sont pas une
   * histoire, et un registre refusé ne rend aucun snapshot.
   */
  const temoins = readWitnesses(join(root, RUNS_DIR), runId);
  const state = laneLedgerState(temoins, laneRead);
  return ledgerObservation(
    state,
    () => construire(root, runId, laneRead),
    () =>
      `le registre des lanes est inexploitable (${state}) : ` +
      `${ledgerFacts(temoins, laneRead, "lanes", LANE_LEDGER_VERSION)}. Aucun état de lane n'est ` +
      "reconstruit depuis un registre partiel : les événements encore lisibles ne " +
      "disent pas ce que les autres disaient, et un bilan bâti sur eux affirmerait " +
      "que ce qu'on ne lit pas ne comptait pas.",
  );
}

/**
 * Le snapshot d'un registre exploitable. N'est appelé qu'une fois `state` établi.
 *
 * `read` est la lecture PROJETÉE : un registre v1 y porte ses générations synthétisées
 * (C4.9). Le lecteur a rendu le fichier tel quel ; tout ce qui suit consomme la projection.
 */
function construire(root: string, runId: string, lu: LaneRead): LaneSnapshot {
  const laneRead: LaneRead = { ...lu, events: projectLegacyGenerations(lu.events, lu.version) };

  const worktrees = openLanes(root)
    .filter((id) => id.startsWith(`${runId}-`))
    .map((id) => id.slice(runId.length + 1));

  /*
   * La base de chaque lane, telle que son ouverture l'a enregistrée.
   *
   * Sans elle, git ne distingue pas « intégrée » de « n'a rien produit » : une
   * lane ouverte après un premier merge part d'un HEAD déjà avancé, et compter
   * ses commits depuis la base du run y trouve ceux de l'unité précédente. Une
   * unité sans base enregistrée n'est donc jamais déclarée intégrée — on ne peut
   * pas le prouver, et affirmer serait pire que se taire.
   */
  const bases = new Map<string, string>();
  for (const e of laneRead.events) {
    if (e.event === "OPENED" && e.base && !bases.has(e.work_unit)) bases.set(e.work_unit, e.base);
  }

  const observations: Observations = {
    openWorktrees: worktrees,
    // Un worktree qui porte encore des changements n'est pas un résidu : c'est
    // du travail que le fait enregistré ne couvre pas.
    dirtyWorktrees: worktrees.filter((u) => laneChanges(root, `${runId}-${u}`).length > 0),
    // Une branche mergée dont le worktree a été retiré et que le registre ignore
    // n'apparaît ni dans les événements ni dans les worktrees. C'est pourtant le
    // cas même d'une intégration sans provenance.
    runBranches: runBranches(root, runId),
    // La seule source qui survive au nettoyage : les commits d'intégration que
    // le registre nomme, confirmés un par un contre le dépôt. Une unité qui en
    // porte un ne dépend plus de sa branche pour être prouvée.
    confirmedCommits: confirmIntegrations(root, [
      ...new Set(
        [...integrationCommits(laneRead.events).values()].filter(
          (c): c is string => typeof c === "string",
        ),
      ),
    ]),
    // La base propre à chaque lane situe ce qu'elle a produit : sans elle, une
    // lane fraîche passerait pour intégrée puisqu'elle pointe sur HEAD.
    mergedUnits: [...bases.entries()]
      .filter(([u, b]) => isMerged(root, `${runId}-${u}`, b))
      .map(([u]) => u),
  };

  return {
    read: laneRead,
    bases,
    observations,
    reconciliation: reconcile(laneRead.events, observations),
  };
}
