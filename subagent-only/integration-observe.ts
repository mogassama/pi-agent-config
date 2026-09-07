/**
 * Ce que le runtime et l'outil opérateur voient d'une tentative — et ils doivent
 * voir la même chose.
 *
 * Les deux rassemblaient les quatre vérités séparément : le runtime dans son
 * extension, `bin/subagent-recover` dans son propre coin. Ce n'était pas une
 * duplication décorative. Le runtime avait appris en 3c.2a à réutiliser le
 * snapshot validé du registre des lanes, l'outil en faisait une seconde lecture
 * sans en regarder ni la version ni les lignes abîmées — si bien qu'un registre
 * de lanes corrompu fermait le run pendant que l'outil, lui, calculait
 * tranquillement `laneIntegrated` et acceptait de trancher.
 *
 * Un opérateur et un runtime qui regardent le même disque et concluent deux
 * états différents, c'est exactement ce qu'un outil de reprise ne doit jamais
 * produire.
 *
 * **Ce module ne lit pas le registre des lanes.** Il reçoit le snapshot que son
 * appelant a déjà lu, pour la raison qui a motivé la correction de 3c.2a : deux
 * lectures peuvent tomber de part et d'autre d'une écriture. Il lit en revanche
 * le registre des tentatives lui-même, parce qu'il en est le seul lecteur.
 */

import {
  INTEGRATION_LEDGER_VERSION,
  LANE_LEDGER_VERSION,
  readIntegrationEvents,
  type IntegrationLedgerRead,
} from "./run-manifest.ts";
import { integrationCommits, type LaneEvent } from "./lane-ledger.ts";
import {
  foldIntegrations,
  reconcileIntegrations,
  type AttemptFacts,
  type IntegrationObservations,
  type IntegrationReconciliation,
} from "./integration-ledger.ts";
import {
  integrationsDir,
  mergeShapeError,
  openIntegrations,
} from "./integration.ts";
import { confirmIntegrations } from "./worktree.ts";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { recordGitInvocation } from "./git-probe-counter.ts";

/** Le snapshot du registre des lanes, tel que `readLaneEvents` le rend. */
export interface LaneRead {
  events: LaneEvent[];
  malformedLines: number[];
  version: number | undefined;
}

export interface IntegrationSnapshot {
  read: IntegrationLedgerRead;
  facts: Map<string, AttemptFacts>;
  /** Les contextes du run présents sur le disque. */
  contexts: string[];
  observations: IntegrationObservations;
  reconciliation: IntegrationReconciliation;
}

export type Observed =
  | { usable: true; snapshot: IntegrationSnapshot }
  | { usable: false; reason: string };

/** `HEAD` ou `MERGE_HEAD` d'un contexte, ou undefined. */
function ref(cwd: string, name: string): string | undefined {
  try {
    recordGitInvocation();
    return execFileSync("git", ["rev-parse", name], { cwd, encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Les quatre vérités, rassemblées une fois pour tout le monde.
 *
 * Le refus est commun lui aussi : un registre — l'un **ou** l'autre — dont la
 * version est inconnue ou dont une ligne est illisible interdit toute
 * reconstruction, ici comme dans le runtime. Reconstruire à partir de ce qu'on
 * arrive encore à lire, c'est décider que ce qu'on ne lit pas ne comptait pas.
 */
export function observeIntegrations(input: {
  root: string;
  runDir: string;
  runId: string;
  laneRead: LaneRead;
}): Observed {
  const { root, runDir, runId, laneRead } = input;

  if (laneRead.version !== LANE_LEDGER_VERSION || laneRead.malformedLines.length > 0) {
    const cause =
      laneRead.version !== LANE_LEDGER_VERSION
        ? `version ${laneRead.version ?? "absente"} au lieu de ${LANE_LEDGER_VERSION}`
        : `ligne(s) ${laneRead.malformedLines.join(", ")} illisible(s)`;
    return {
      usable: false,
      reason:
        `le registre des lanes est inexploitable : ${cause}. Aucune tentative n'en est ` +
        "reconstruite : leur intégration se prouve par ce registre, et une preuve qu'on " +
        "ne sait pas lire en entier ne se lit pas en partie.",
    };
  }

  const read = readIntegrationEvents(runDir, runId);
  if (read.version !== INTEGRATION_LEDGER_VERSION || read.malformedLines.length > 0) {
    const cause =
      read.version !== INTEGRATION_LEDGER_VERSION
        ? `version ${read.version ?? "absente"} au lieu de ${INTEGRATION_LEDGER_VERSION}`
        : `ligne(s) ${read.malformedLines.join(", ")} illisible(s)`;
    return {
      usable: false,
      reason:
        `le registre des tentatives est inexploitable : ${cause}. Aucune tentative n'en est ` +
        "reconstruite, et les contextes présents sous .git/pi-integrations/ n'ont donc plus " +
        "de provenance lisible.",
    };
  }

  const prefixe = `${runId}-`;
  const contexts = openIntegrations(root).filter((id) => id.startsWith(prefixe));

  const head: Record<string, string> = {};
  const mergeHead: Record<string, string> = {};
  for (const id of contexts) {
    const dir = join(integrationsDir(root), id);
    const h = ref(dir, "HEAD");
    if (h) head[id] = h;
    const m = ref(dir, "MERGE_HEAD");
    if (m) mergeHead[id] = m;
  }

  const { attempts: facts } = foldIntegrations(read.events, runId);
  const mergeShapeOk: Record<string, boolean> = {};
  const commits: string[] = [];
  for (const a of facts.values()) {
    if (!a.committed) continue;
    commits.push(a.committed.commit);
    mergeShapeOk[a.committed.commit] =
      mergeShapeError(root, a.committed.commit, a.committed.tree, a.p1, a.p2) === null;
  }

  const laneIntegrated: Record<string, string> = {};
  for (const [unit, commit] of integrationCommits(laneRead.events)) {
    if (commit) laneIntegrated[unit] = commit;
  }

  const observations: IntegrationObservations = {
    contexts,
    head,
    mergeHead,
    mergeShapeOk,
    landed: confirmIntegrations(root, commits),
    laneIntegrated,
  };

  return {
    usable: true,
    snapshot: {
      read,
      facts,
      contexts,
      observations,
      reconciliation: reconcileIntegrations(read.events, observations, runId),
    },
  };
}
