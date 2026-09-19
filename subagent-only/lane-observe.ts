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
  laneLedgerIncoherences,
  openLaneIdentities,
  projectIntegrated,
  projectLegacyGenerations,
  projectReviews,
  projectRisks,
  projectViolations,
  type IntegratedFact,
  type ReviewFact,
  type RiskFact,
  type ViolationFact,
  type LaneEvent,
  type Observations,
  type Reconciliation,
} from "./lane-ledger.ts";
import {
  LANE_LEDGER_VERSION,
  LANE_LEDGER_V2,
  RUNS_DIR,
  laneState,
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
  /** Les vues communes du registre (P4, § 4.3). Seules sources des décisions à venir. */
  projections: LaneProjections;
}

export interface LaneProjections {
  reviews: Map<string, ReviewFact[]>;
  violations: ViolationFact[];
  /** Sous la clé `riskKey(R, work_unit, id)`. */
  risks: Map<string, RiskFact>;
  integrated: Map<string, IntegratedFact>;
  /** Les identités de lane encore ouvertes au registre, triées (`openLaneIdentities`). */
  openLanes: string[];
}

export type ObservedLanes = LedgerObservation<LaneSnapshot>;

/**
 * La grammaire des identités de lane d'un run, lue sur le snapshot du registre.
 *
 * Un registre absent est celui d'un run neuf, que l'écrivain créera en v2 : ses
 * artefacts — un worktree posé avant son `OPENED`, par exemple — portent déjà `-g<n>`.
 * Le lire en v1 transformerait `R-W03-g1` en une unité « W03-g1 ».
 */
export function laneGrammar(read: { present: boolean; version?: number | undefined }): number | undefined {
  return read.present ? read.version : LANE_LEDGER_V2;
}

/**
 * La lane autoritaire d'une unité : celle de sa DERNIÈRE ouverture au registre.
 *
 * Sous v2, la lane que l'`OPENED` nomme — jamais `${runId}-${unit}`, qui dès g1 ne
 * désigne plus aucune lane. Sous v1, l'identité legacy `<R>-<unit>`, la seule que ce
 * registre connaisse (C4.9, génération 1 synthétisée). Sans ouverture : `undefined` —
 * une unité jamais ouverte n'a pas de lane, et en fabriquer une serait l'inventer.
 *
 * Le runtime, la reprise et le nettoyage passent tous par ici : deux constructions
 * d'identité divergeraient à la première génération suivante.
 */
export function laneOfUnit(
  events: readonly LaneEvent[],
  version: number | undefined,
  runId: string,
  unit: string,
): { laneId: string; generation: number } | undefined {
  let trouvee: { laneId: string; generation: number } | undefined;
  for (const e of events) {
    if (e.event !== "OPENED" || e.work_unit !== unit) continue;
    trouvee = version === LANE_LEDGER_V2 && "lane" in e
      ? { laneId: e.lane, generation: e.generation }
      : { laneId: `${runId}-${unit}`, generation: 1 };
  }
  return trouvee;
}

/**
 * L'unité qu'un artefact de lane (worktree, branche) désigne, à partir de son identifiant.
 *
 * L'`OPENED` fait foi quand il existe. Sinon l'artefact est sans provenance, et son nom
 * est la seule chose qu'on sache de lui : on le lit dans la grammaire de la version du
 * registre, pour que la contradiction nomme l'unité que l'opérateur tranchera. Un nom
 * qui n'appartient pas à ce run ne désigne rien.
 */
export function unitOfLane(
  laneId: string,
  events: readonly LaneEvent[],
  version: number | undefined,
  runId: string,
): string | undefined {
  if (!laneId.startsWith(`${runId}-`)) return undefined;
  if (version === LANE_LEDGER_V2) {
    for (const e of events) if (e.event === "OPENED" && "lane" in e && e.lane === laneId) return e.work_unit;
  }
  const reste = laneId.slice(runId.length + 1);
  const g = version === LANE_LEDGER_V2 ? /^(.+)-g[1-9][0-9]*$/.exec(reste) : null;
  return g ? g[1] : reste;
}

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
  const state = laneState(temoins, laneRead, runId);
  return ledgerObservation(
    state,
    () => construire(root, runId, laneRead),
    () =>
      `le registre des lanes est inexploitable (${state}) : ` +
      `${ledgerFacts(temoins, laneRead, "lanes", laneRead.version === LANE_LEDGER_VERSION ? LANE_LEDGER_VERSION : LANE_LEDGER_V2, incoherencesV2(laneRead, runId))}. ` +
      "Aucun état de lane n'est " +
      "reconstruit depuis un registre partiel : les événements encore lisibles ne " +
      "disent pas ce que les autres disaient, et un bilan bâti sur eux affirmerait " +
      "que ce qu'on ne lit pas ne comptait pas.",
  );
}

/**
 * Les événements de la génération courante de chaque unité, dans l'ordre du registre.
 *
 * Sous v2, la courante est celle du dernier `OPENED` de l'unité ; les lignes des
 * générations précédentes sont écartées du bilan. Sous v1 il n'y en a qu'une.
 */
function evenementsCourants(events: readonly LaneEvent[], version: number | undefined): LaneEvent[] {
  if (version !== LANE_LEDGER_V2) return [...events];
  const derniere = new Map<string, string>();
  for (const e of events) if (e.event === "OPENED" && "lane" in e) derniere.set(e.work_unit, e.lane);
  return events.filter((e) => !("lane" in e) || derniere.get(e.work_unit) === e.lane);
}

/** Les incohérences de P4, pour la prose d'un refus — la décision est déjà prise sur `state`. */
function incoherencesV2(lu: LaneRead, runId: string): string[] {
  return lu.version === LANE_LEDGER_V2 && lu.malformedLines.length === 0 ? laneLedgerIncoherences(lu.events, runId) : [];
}

/**
 * Le snapshot d'un registre exploitable. N'est appelé qu'une fois `state` établi.
 *
 * `read` est la lecture PROJETÉE : un registre v1 y porte ses générations synthétisées
 * (C4.9). Le lecteur a rendu le fichier tel quel ; tout ce qui suit consomme la projection.
 */
function construire(root: string, runId: string, lu: LaneRead): LaneSnapshot {
  const laneRead: LaneRead = { ...lu, events: projectLegacyGenerations(lu.events, lu.version) };

  const v = laneGrammar(laneRead);
  const evts = laneRead.events;
  // Les artefacts, rapportés à leur unité par l'identité que le registre leur donne.
  const worktreeIds = openLanes(root).filter((id) => unitOfLane(id, evts, v, runId) !== undefined);
  const worktrees = [...new Set(worktreeIds.map((id) => unitOfLane(id, evts, v, runId)!))];

  /*
   * La base de chaque lane, telle que son ouverture l'a enregistrée.
   *
   * Sans elle, git ne distingue pas « intégrée » de « n'a rien produit » : une
   * lane ouverte après un premier merge part d'un HEAD déjà avancé, et compter
   * ses commits depuis la base du run y trouve ceux de l'unité précédente. Une
   * unité sans base enregistrée n'est donc jamais déclarée intégrée — on ne peut
   * pas le prouver, et affirmer serait pire que se taire.
   */
  /*
   * La vie COURANTE de chaque unité : sa dernière génération.
   *
   * Le bilan se fait par unité, et une génération abandonnée n'est plus la vie de
   * l'unité dès qu'une suivante est ouverte : relue en entier, elle ferait passer g2
   * ouverte pour le résidu de g1 abandonnée. Les projections, elles, gardent toute
   * l'histoire — un risque, notamment, ne se perd pas en changeant de génération.
   */
  const courants = evenementsCourants(evts, v);
  const bases = new Map<string, string>();
  for (const e of courants) {
    if (e.event === "OPENED" && e.base && !bases.has(e.work_unit)) bases.set(e.work_unit, e.base);
  }

  const observations: Observations = {
    openWorktrees: worktrees,
    // Un worktree qui porte encore des changements n'est pas un résidu : c'est
    // du travail que le fait enregistré ne couvre pas.
    dirtyWorktrees: [
      ...new Set(
        worktreeIds
          .filter((id) => laneChanges(root, id).length > 0)
          .map((id) => unitOfLane(id, evts, v, runId)!),
      ),
    ],
    // Une branche mergée dont le worktree a été retiré et que le registre ignore
    // n'apparaît ni dans les événements ni dans les worktrees. C'est pourtant le
    // cas même d'une intégration sans provenance.
    runBranches: [
      ...new Set(
        runBranches(root, runId)
          .map((id) => unitOfLane(`${runId}-${id}`, evts, v, runId))
          .filter((u): u is string => u !== undefined),
      ),
    ].sort(),
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
      .filter(([u, b]) => {
        const lane = laneOfUnit(evts, v, runId, u);
        return lane !== undefined && isMerged(root, lane.laneId, b);
      })
      .map(([u]) => u),
  };

  return {
    read: laneRead,
    bases,
    observations,
    reconciliation: reconcile(courants, observations),
    projections: {
      reviews: projectReviews(laneRead.events),
      violations: projectViolations(laneRead.events),
      risks: projectRisks(laneRead.events, runId),
      integrated: projectIntegrated(laneRead.events, laneRead.version),
      openLanes: openLaneIdentities(laneRead.events, laneRead.version),
    },
  };
}
