/**
 * subagent — delegation for pi, one tool.
 *
 * Loaded by the ORCHESTRATOR (unlike subagent-only/envelope.ts, which is
 * passed to children with -e). Its tool definition is therefore paid for in
 * every orchestrator session, which is why there is exactly one tool with the
 * role as a parameter, rather than one tool per role: pi-subagents exposes six
 * and costs 5468 tokens of the orchestrator's 14528.
 */

import { defineTool, isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadAgents } from "../../subagent-only/agents.js";
import { dispatch, type RunResult } from "../../subagent-only/dispatch.js";
import { actionLines, countsLine, reviewRisks, riskLines } from "../../subagent-only/counts.js";
import {
  continuationReturned,
  openRisks,
  riskChannel,
  routeRisks,
  type LedgerEvent,
  type RiskRecord,
} from "../../subagent-only/risk-ledger.js";
import { openLane, targetWorkUnit, type LaneContext, type Target } from "../../subagent-only/lane-context.js";
import { anySignal } from "../../subagent-only/signals.js";
import { RUN_STATUS_KEY, type RunSnapshot } from "../../subagent-only/run-state.js";
import {
  RecoveryError,
  TransitionLockedError,
  RunBusyError,
  LANE_LEDGER_VERSION,
  LANE_LEDGER_V2,
  LaneOpeningNotRecordedError,
  acquireRunOwnership,
  allocateLanes,
  type LaneAllocation,
  type LedgerRead,
  appendIntegrationEvent,
  appendLaneEvent,
  appendViolationEvent,
  appendFrozenEvent,
  FrozenNotRecordedError,
  FrozenRefusedError,
  NotOwnerError,
  RiskNotRecordedError,
  ViolationNotRecordedError,
  appendRiskEvents,
  type CalculDesRisques,
  type EtatDesRisques,
  type RiskWrite,
  readManifest,
  readLaneEvents,
  allocateSeq,
  attachPlan,
  describeAccess,
  inspectRun,
  openRun,
  ownsRun,
  releaseRunOwnership,
  startHeartbeat,
  type Heartbeat,
  type Lease,
} from "../../subagent-only/run-manifest.js";
import { instrumentationIgnored } from "../../subagent-only/repo-preflight.js";
import { validerDesignUpdates } from "../../subagent-only/design-update.js";
import {
  SchedulerInputError,
  admettre,
  runLanes,
  type Admission,
  type Candidate,
} from "../../subagent-only/scheduler.js";
import {
  isLaneBound, validateTaskCall, type IntegrationPhase,
} from "../../subagent-only/task-policy.js";
import {
  attemptId,
  describeIntegrationConflicts,
  type IntegrationConflict,
  type IntegrationEvent,
} from "../../subagent-only/integration-ledger.js";
import {
  observeIntegrations,
  type IntegrationSnapshot,
} from "../../subagent-only/integration-observe.js";
import {
  laneGrammar,
  laneOfUnit,
  observeLanes,
  type LaneRead,
  type LaneSnapshot,
} from "../../subagent-only/lane-observe.js";
import {
  readGitInvocationCount,
  recordGitInvocation,
} from "../../subagent-only/git-probe-counter.js";
import { planCleanup } from "../../subagent-only/cleanup.js";
import {
  buildRunReport,
  formatRunReport,
  type RunMetrics,
} from "../../subagent-only/run-report.js";
import {
  commitFacts, commitLane, confirmIntegrations, ensureLane, freezeMessage, integrateLane, isMerged,
  laneChanges, laneIsClean, laneTip, mergeMessage, openLanes, resetLaneTo, runBranches,
} from "../../subagent-only/worktree.js";
import {
  describeConflicts, foldLedger, integrationCommits, reconcile, type Conflict,
  type LaneEvent, type ProofMode, type ReviewFact, type RiskFact, type ViolationFact, type ViolationKind,
} from "../../subagent-only/lane-ledger.js";
import {
  deltaBetweenTrees, pathIdenticalBetweenTrees, pathsBetweenTrees, treeOfCommit, workingTree,
} from "../../subagent-only/tree.js";
import {
  commitIntegration,
  integrationReview,
  integrationTree,
  integrationsDir,
  landIntegration,
  openIntegration,
  removeIntegration,
  supersedeAttempt,
  type IntegrationAttempt,
  type IntegrationCommit,
} from "../../subagent-only/integration.js";
import {
  parsePlan,
  reservedTouched,
  scopeBreach,
  scopesCollide,
  type PlanResult,
} from "../../subagent-only/work-units.js";
import { aggregateFanout, streakOf } from "../../subagent-only/fanout.js";
import { openReviewBoundary } from "../../subagent-only/review-boundary.js";
import { BUNDLE_FILES, bundleRoot } from "../../subagent-only/role-rules.js";
import { serialize, STATUS_KEY } from "../../subagent-only/run-state.js";

const AGENT_DIR = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const SELF_DIR = join(AGENT_DIR, "subagent-only");

/**
 * One session id per orchestrator session, not per call.
 *
 * It identifies this process as the current lease owner when the run is acquired.
 * Unlike `RUN_ID`, it is intentionally ephemeral and dies with the session.
 */
const SESSION_ID = `s-${randomBytes(4).toString("hex")}`;

/**
 * Le run durable de cette session, découvert et non créé au hasard.
 *
 * `RUN_ID` valait `randomBytes(3)` avec le commentaire « it dies with the
 * session ». C'était vrai, et faux dès que les worktrees ont survécu : le plan
 * gelé s'appelle `<runId>-plan.json`, les lanes `<runId>-<workUnitId>`, et une
 * session redémarrée ne retrouvait ni l'un ni les autres.
 *
 * Connaître l'identité ne donne aucun droit. Le chargement découvre le run et
 * l'affiche ; la propriété se prend à la première mutation, pas ici.
 */
const RUNS_DIR = ".pi-subagent-runs";
const RUN_DIR = join(process.cwd(), RUNS_DIR);

/*
 * Le préflight du dépôt, avant la toute première écriture.
 *
 * Il devait aller « à l'activation du premier run mutateur, avant la première
 * écriture dans .pi-subagent-runs/ ». Ces deux moments ne sont pas le même :
 * `openRun` crée le répertoire et le manifeste **au chargement du module**, bien
 * avant qu'une délégation soit demandée. Le placer plus tard voudrait donc dire
 * découvrir la mauvaise configuration après l'avoir causée.
 *
 * Vérifier tôt, refuser tard. Si le dépôt n'ignore pas son instrumentation, le
 * run n'est pas ouvert du tout — rien n'est écrit, rien n'est sali — et la
 * raison est gardée pour la première délégation, qui la rendra. Une session qui
 * ne délègue jamais ne voit rien et n'a rien à voir : le chargement d'une
 * extension n'a pas à échouer pour une propriété qui ne concerne que les runs.
 */
const PREFLIGHT = instrumentationIgnored(process.cwd(), RUNS_DIR);
const RUN = PREFLIGHT.ok ? openRun(RUN_DIR, baseCommit()) : undefined;
const RUN_ID = RUN?.manifest.runId ?? "";

/*
 * L'état durable est reconstruit au chargement, pas à l'ouverture d'une session.
 *
 * Une session reprise doit repartir de ce que le run a réellement fait, et elle
 * doit le savoir avant toute décision d'admission — pas au premier événement de
 * cycle de vie. Purement en lecture : la propriété ne se prend qu'à la première
 * mutation, et `reconcile` ne répare rien.
 */

/** Le bail courant : il autorise, là où `RUN_ID` se contente d'identifier. */
let LEASE: Lease | undefined;
let HEARTBEAT: Heartbeat | undefined;

/**
 * Annulation propre à la perte de propriété, distincte du signal de l'appelant.
 *
 * Un Ctrl-C et une perte de bail arrêtent tous deux les enfants, mais pour des
 * raisons opposées : l'un est une décision, l'autre un incident. Les confondre
 * rendrait un run interrompu illisible — on ne saurait pas si l'opérateur a
 * arrêté ou si une autre session a repris le run.
 */
let LEASE_ABORT = new AbortController();

function baseCommit(): string | undefined {
  try {
    recordGitInvocation();
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * La propriété du run, prise à la première mutation et pas avant.
 *
 * Rend `undefined` quand cette session ne peut pas l'obtenir : le run est tenu
 * par une autre, ou son bail est périmé et demande une réconciliation. Dans les
 * deux cas rien n'a été réservé, écrit ni ouvert.
 */
function ensureOwnership(): { lease: Lease } | { refus: string } {
  if (LEASE && ownsRun(RUN_DIR, LEASE)) return { lease: LEASE };
  /*
   * Un vestige de transition sort d'ici en EXCEPTION, et une exception nue traverse
   * l'outil : l'orchestrateur reçoit une pile au lieu d'un refus, et ne sait pas quoi
   * faire. Le jeton est pourtant ce qui permet à un humain ET à un script de décider.
   *
   * Le refus est donc structuré comme les autres, et il ne lève rien — le vestige reste
   * sur le disque, et sa levée appartient à une réconciliation explicite (C1.10).
   */
  let pris;
  try {
    pris = acquireRunOwnership(RUN_DIR, RUN_ID, SESSION_ID);
  } catch (err) {
    if (err instanceof TransitionLockedError) {
      LEASE = undefined;
      publishRun();
      return {
        refus:
          `[run: réconciliation requise] ${err.message}\n` +
          `Rien n'a été réservé, ouvert ni lancé, et le vestige n'a pas été levé.`,
      };
    }
    throw err;
  }
  if (!pris.ok) {
    LEASE = undefined;
    publishRun();
    return { refus: describeAccess(inspectRun(RUN_DIR, RUN_ID, SESSION_ID), RUN_ID) };
  }
  LEASE = pris.lease;
  LEASE_ABORT = new AbortController();
  HEARTBEAT?.stop();
  HEARTBEAT = startHeartbeat(RUN_DIR, LEASE, () => {
    // La propriété est perdue : arrêter ce qui tourne, ne rien muter de plus.
    // Les gardes de capacité refuseront les nouvelles mutations de toute façon ;
    // ceci arrête celles qui sont déjà en vol.
    LEASE = undefined;
    HEARTBEAT?.stop();
    HEARTBEAT = undefined;
    LEASE_ABORT.abort(new Error(`propriété du run ${RUN_ID} perdue`));
    publishRun();
  });
  publishRun();
  return { lease: LEASE };
}

let RUN_UI: { setStatus?: (k: string, v: string) => void } | undefined;

/** Le footer lit l'état du manifeste ; il n'en tient aucune copie décisionnelle. */
function publishRun(): void {
  const snapshot: RunSnapshot = {
    runId: RUN_ID,
    access: inspectRun(RUN_DIR, RUN_ID, SESSION_ID).kind,
  };
  RUN_UI?.setStatus?.(RUN_STATUS_KEY, JSON.stringify(snapshot));
}

/**
 * Cette session possède-t-elle encore le run ?
 *
 * Posée après le retour d'un enfant, avant toute mutation qui en découle.
 * L'annulation est au mieux rapide : un worker peut revenir normalement juste
 * après la perte du bail, et intégrer son travail à ce moment-là écrirait dans
 * un dépôt qu'une autre session a repris.
 */
/**
 * Cette capacité possède-t-elle encore le run ?
 *
 * Le bail **capturé avant le spawn**, pas le bail courant de la session. Sans
 * ça, un enfant lancé sous L1 passerait la barrière parce que la session a
 * depuis acquis L2 — et toute la protection de capacité tomberait au moment
 * précis où elle doit tenir.
 */
function stillOwns(lease: Lease): boolean {
  return ownsRun(RUN_DIR, lease);
}

/**
 * Call counter, so successive artefacts of the same role do not overwrite each
 * other. Durable now: see `allocateSeq` in run-manifest.ts — a counter that
 * restarted at zero after a crash would make two risks share an id.
 */


/**
 * Scout calls so far in this session.
 *
 * Not for accounting — for one nudge. Measured on run `3ed33e`: 15 delegations,
 * 0 scouts, while the only repo-wide search of the run happened inside a
 * reviewer. A routing rule read at turn 1 does not fire at turn 40; a line
 * attached to the result that proves the rule was needed does.
 */
let SCOUT_CALLS = 0;

/**
 * Delegations so far in this session, oldest first.
 *
 * Measured on run `ac451a`: the sequence ended `reviewer, reviewer, reviewer,
 * reviewer, scout, scout, scout` — four reviews with no worker between them,
 * then three completeness inventories of the same backlog. Seventeen
 * delegations, and nobody decided it was finished. `INSTRUCTIONS.md` already
 * said the session ends when every item has passed its end criterion; the rule
 * was prose and did not fire.
 */
interface Delegation {
  agent: string;
  /**
   * La lane à laquelle cette délégation appartient, quand elle en a une.
   *
   * Absent pour ce qui n'appartient à aucune lane : une écriture inline de
   * l'orchestrateur, un scout global. La frontière de review filtre dessus, les
   * gardes globaux l'ignorent.
   */
  laneId?: string;
  /**
   * The `task` call this entry came from. Four scouts of one fan-out share it.
   *
   * The journal counts children, which is honest — four really ran. The streak
   * guard counts calls, because what it exists to stop is three unread
   * inventories in a row, and a fan-out is one decision. Without this, a
   * two-question fan-out put the counter at two and the next scout was refused,
   * including one asking about a `gaps` that same fan-out had reported.
   */
  batch: string;
  /** False when the child returned no envelope. A delegation that answered nothing must not block its own retry. */
  produced: boolean;
  readOnly: boolean;
  /** Paths the delegation wrote. Empty for a read-only role, and for a writer that changed nothing. */
  changedFiles: string[];
}
const HISTORY: Delegation[] = [];

/**
 * La vue d'une lane sur l'historique.
 *
 * `HISTORY` reste une séquence unique — les gardes globaux, le journal et les
 * refus en dépendent, et l'écriture inline de l'orchestrateur n'appartient à
 * aucune lane. Ce qui est local, c'est le raisonnement : la frontière de review
 * reçoit la vue filtrée plutôt que d'apprendre à ignorer les autres lanes.
 * `review-boundary.ts` reste une machine d'état sur une séquence, sans rien
 * savoir des worktrees.
 */
/**
 * Un appel qui n'a pas de sens : rien n'a été admis, rien n'a démarré.
 *
 * Étiqueté sur l'outil et non sur le lot : la même fonction répond à un worker
 * simple sans unité, et « [batch: invalid] » l'aurait envoyé chercher un lot
 * qu'il n'avait pas écrit.
 */
function invalidCall(reason: string) {
  return {
    content: [{ type: "text" as const, text: `[task: invalid] ${reason}` }],
    isError: true,
  };
}

/**
 * Le signal de l'appelant et celui du bail, réunis.
 *
 * Un enfant s'arrête pour deux raisons sans rapport : l'opérateur annule, ou la
 * session perd la propriété du run. Les joindre évite que la seconde ait à
 * détourner l'annulation globale, et `signal.reason` garde la trace de celle
 * qui a tranché.
 */
function bothSignals(externe: AbortSignal | undefined): AbortSignal {
  return externe ? anySignal([externe, LEASE_ABORT.signal]) : LEASE_ABORT.signal;
}

function laneView(laneId: string | undefined): Delegation[] {
  return laneId === undefined ? HISTORY : HISTORY.filter((d) => d.laneId === laneId);
}

/**
 * La vue de C1 pour le garde de revue d'un rôle lié à une lane (C1.7, PLAN-LOT4 § 4).
 *
 * Les délégations de la lane courante de l'unité, plus les délégations globales
 * explicitement readOnly — un scout qui rapporte les fichiers qu'une revue a demandés.
 * Jamais les écritures inline de l'orchestrateur : elles n'appartiennent à aucune lane et
 * ne changent rien à ce que la revue d'une lane lira. Sans lane connue, l'historique
 * entier (C1).
 *
 * L'identité vient du snapshot que la reconstruction de CET appel a posé
 * (`LAST_LANES.read`), jamais d'une relecture du registre. Une lane courante abandonnée ne
 * sera pas rejointe — l'appel en ouvrira la génération suivante, qui n'a encore aucune
 * délégation : sa vue ne garde que les globales readOnly.
 */
function vueDeRevue(unit: string): Delegation[] {
  const read = LAST_LANES?.read;
  if (!read) return HISTORY;
  const connue = laneOfUnit(read.events, laneGrammar(read), RUN_ID, unit);
  if (!connue) return HISTORY;
  const abandonnee = read.events.some((e) =>
    e.event === "ABANDONED" && "lane" in e && e.lane === connue.laneId);
  const laneId = abandonnee ? undefined : connue.laneId;
  return HISTORY.filter((d) =>
    (laneId !== undefined && d.laneId === laneId) ||
    (d.laneId === undefined && d.readOnly && d.agent !== "orchestrator"));
}


/**
 * Le cache mémoire de l'état reconstruit, par unité.
 *
 * La source de vérité est le registre `<runId>-integrations.jsonl` croisé aux
 * contextes git, pas cette Map : elle est recalculée au chargement puis à chaque
 * reconstruction, et un redémarrage la retrouve identique parce que rien
 * d'important n'y vit.
 *
 * Une seule entrée par unité : une tentative périmée est remplacée, jamais
 * accumulée — et deux tentatives vivantes pour une même unité sont une
 * contradiction que la réconciliation nomme.
 */
/** Un événement de tentative, horodaté à l'écriture. */
function noteAttempt(
  event: Omit<IntegrationEvent, "at"> & { at?: string },
  lease: Lease,
): void {
  appendIntegrationEvent(RUN_DIR, { ...event, at: new Date().toISOString() } as IntegrationEvent, lease);
}

interface AttemptState {
  attempt: IntegrationAttempt;
  phase: IntegrationPhase;
  /** `M` et ses bornes, dès que le commit existe. */
  landing?: IntegrationCommit;
}

const ATTEMPTS = new Map<string, AttemptState>();

/**
 * Rouvrir une tentative périmée sur le même `P2` et la base courante.
 *
 * Partagée entre les deux endroits où un atterrissage peut se découvrir périmé :
 * la première tentative, et la reprise d'un `ready-to-land`. Elles avaient deux
 * machines différentes, et la seconde n'en avait aucune — elle rendait le motif
 * du refus et laissait la phase inchangée, si bien que toutes les reprises
 * suivantes repartaient de l'ancien `P1`. Une boucle dont rien ne sortait.
 *
 * Ce n'est pas tenir l'approbation pour valide contre une autre base : la review
 * de lane approuve `P2` lui-même, et c'est la review d'intégration qui juge la
 * rencontre. Si le nouveau `P1` exige un troisième fichier, le mécanisme de
 * dépassement renverra l'unité dans sa lane.
 */
function reopenStaleAttempt(
  unit: string,
  ancienne: IntegrationAttempt,
  lease: Lease,
  motif: string,
): string {
  /*
   * L'ordre, et il n'est pas indifférent.
   *
   * Ouvrir le nouveau contexte, l'enregistrer, enregistrer le remplacement de
   * l'ancien, et seulement ensuite le retirer. Une version antérieure retirait
   * l'ancien même quand l'ouverture échouait : le travail restait dans `P2`,
   * mais la seule chose qui le désignait disparaissait avec le contexte.
   *
   * Si l'ouverture échoue, l'ancien reste — avec sa provenance — et la reprise
   * est explicite. Si le retrait échoue après `SUPERSEDED`, c'est un résidu
   * connu, pas une seconde tentative vivante.
   */
  const seq = allocateSeq(RUN_DIR, lease).seq;
  const suivante = openIntegration(process.cwd(), attemptId(RUN_ID, unit, seq), ancienne.p2);
  if (!suivante.ok) {
    return (
      `  TENTATIVE PÉRIMÉE  ${unit} : ${motif}\n` +
      `    et la rouvrir a échoué : ${suivante.reason}\n` +
      `    ${ancienne.id} est conservée : son travail est dans ${ancienne.p2.slice(0, 12)}.`
    );
  }
  supersedeAttempt(
    ancienne.id,
    (etape) =>
      etape === "opened"
        ? noteAttempt({
            event: "ATTEMPT_OPENED",
            id: suivante.attempt.id,
            work_unit: unit,
            seq,
            p1: suivante.attempt.p1,
            p2: suivante.attempt.p2,
            conflicts: [...suivante.attempt.conflicts],
          }, lease)
        : noteAttempt({ event: "SUPERSEDED", id: ancienne.id, by: suivante.attempt.id }, lease),
    (id) => removeIntegration(process.cwd(), id),
  );
  ATTEMPTS.set(unit, { attempt: suivante.attempt, phase: "resolving" });
  return suivante.attempt.clean
    ? `  TENTATIVE PÉRIMÉE, ROUVERTE  ${unit} : ${suivante.attempt.id}\n` +
      `    ${motif}\n` +
      "    la nouvelle base ne conflicte pas : rien à résoudre.\n" +
      `    déléguer : agent=reviewer work_unit=${unit}`
    : `  TENTATIVE PÉRIMÉE, ROUVERTE  ${unit} : ${suivante.attempt.id}\n` +
      `    ${motif}\n` +
      `    fichiers  : ${suivante.attempt.conflicts.join(", ")}\n` +
      `    déléguer : agent=integration-worker work_unit=${unit}`;
}

type LandingRetry =
  | { done: true; text: string }
  | { blocked: true; text: string };

/**
 * Reprendre une tentative dont seul l'atterrissage a échoué.
 *
 * `M` existe et vaut ; ce qui a échoué est réparable hors du runtime — une
 * racine salie, un `ff-only` refusé. La reprise est donc un nouvel essai,
 * tenté avant toute délégation qui poursuit le cycle de l'unité, plutôt
 * qu'annoncé comme une consigne que personne n'exécuterait.
 *
 * **Elle rend toujours, et l'appelant retourne toujours.** Laisser l'appel
 * suivre son cours après un atterrissage réussi lançait un worker sur une unité
 * qui venait d'être intégrée — le travail qu'il aurait produit n'aurait plus eu
 * ni lane ni review qui l'attende.
 */
function retryLanding(unit: string, etat: AttemptState, lease: Lease): LandingRetry {
  /*
   * Une tentative peut avoir été ouverte par le runtime antérieur à C0 v1.8.
   * Dans ce cas, elle atteint directement cette reprise et contourne le chemin
   * ordinaire qui vérifie `design_update`. La compatibilité transitoire reste
   * pourtant la même : le refus précède CHAQUE merge, y compris celui d'un M
   * déjà construit. La tentative et son commit sont conservés pour le LOT 9.
   */
  const statutFerme = refusDesignUpdate(unit);
  if (statutFerme) {
    return {
      blocked: true,
      text:
        `  NON INTÉGRABLE  ${unit} : ${statutFerme}\n` +
        `    ${etat.landing!.commit.slice(0, 12)} reste prêt à atterrir ; aucun merge, ` +
        "aucun INTEGRATED.",
    };
  }
  const atterri = landIntegration(process.cwd(), etat.landing!, (commit) =>
    appendLaneEvent(
      RUN_DIR,
      { event: "INTEGRATED", work_unit: unit, at: new Date().toISOString(), integration_commit: commit },
      lease,
    ),
  );
  if (atterri.ok) {
    noteAttempt({ event: "CLOSED", id: etat.attempt.id, outcome: "integrated" }, lease);
    ATTEMPTS.delete(unit);
    INTEGRATED.add(unit);
    OPEN_UNITS.delete(unit);
    return { done: true, text: `  intégrée : ${unit} par ${atterri.commit.slice(0, 12)}` };
  }
  if (atterri.stale) {
    return { blocked: true, text: reopenStaleAttempt(unit, etat.attempt, lease, atterri.reason) };
  }
  return {
    blocked: true,
    text:
      `  ATTERRISSAGE BLOQUÉ  ${unit} : ${atterri.reason}\n` +
      `    ${etat.landing!.commit.slice(0, 12)} est construit et vérifié ; il attend une\n` +
      "    racine propre et sur sa base. Corriger l'obstacle, puis reprendre l'unité\n" +
      "    avec worker ou reviewer : le runtime réessaiera avant toute délégation.",
  };
}


/**
 * What this session knows of the risks beyond the ledger: their texts, and the
 * risks that belong to no unit.
 *
 * Not a source of decision (PLAN-LOT7 Q5). A risk of a unit is open, routed or
 * resolved because the lane ledger says so, under `(R, work_unit, id)`; the
 * gate, the routing and the continuation read that projection. This array is
 * updated only after the durable write succeeded, so it is never ahead of the
 * ledger. A risk raised with no unit — free regime, global reviewer — has no
 * lane and no gate: it lives here and in the journal, and nowhere else.
 */
let RISKS: RiskRecord[] = [];

/** Where the instrumentation of a run is written. */

/**
 * Deux lanes au premier run parallèle, et pas quatre.
 *
 * La médiane de largeur utilisable mesurée sur la campagne de sondes tourne
 * autour de quatre, donc il y a de la marge. Mais ce run doit d'abord prouver
 * que l'isolation, la review locale, le rework local, l'ownership et
 * l'intégration tiennent en production ; monter ensuite ne demandera aucune
 * architecture nouvelle.
 */
function readMaxParallelLanes(): number {
  const raw = process.env.PI_SUBAGENT_MAX_PARALLEL_LANES;
  if (raw === undefined || raw.trim() === "") return 2;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    // Configuration opérateur et non faute de l'orchestrateur : il n'a pas
    // choisi cette valeur et ne peut pas la corriger. Une correction
    // silencieuse fabriquerait une concurrence que personne n'a demandée.
    throw new Error(
      `PI_SUBAGENT_MAX_PARALLEL_LANES doit être un entier >= 1, reçu ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

const MAX_PARALLEL_LANES = readMaxParallelLanes();

/**
 * Les unités déjà intégrées, ce qui rend leurs dépendantes admissibles.
 *
 * Intégrée et non terminée : une dépendance dont le travail existe mais n'est
 * pas dans l'intégration laisserait la lane suivante partir d'une base qui ne
 * contient pas ce dont elle dépend.
 */
const INTEGRATED = new Set<string>();

/**
 * Les unités dont la lane est ouverte : démarrées, pas encore intégrées.
 *
 * Elles possèdent leurs fichiers tant qu'elles ne sont pas dans la base, même
 * quand plus aucun worker n'y tourne — la lane existe, elle n'est pas revue, et
 * une candidate qui écrirait les mêmes fichiers partirait d'un état qui ne la
 * contient pas.
 */
const OPEN_UNITS = new Set<string>();

/**
 * Ce que la réconciliation a trouvé au démarrage, gardé pour être dit une fois.
 *
 * Une session reprise doit savoir sur quoi elle repart. Les contradictions ne
 * sont pas réparées : la porte globale du run les bloque avant toute admission
 * jusqu'à ce qu'elles soient tranchées.
 */
let RECOVERY_NOTE = "";

/**
 * Les contradictions non tranchées, par unité.
 *
 * Tant qu'il en reste une, le run n'accepte aucune délégation. Ce n'est pas un
 * état faible d'une WorkUnit : c'est une porte de reprise du run entier. Laisser
 * W09 travailler parce qu'elle semble indépendante ajouterait des faits à un run
 * dont l'état précédent n'est pas compris, et rendrait la récupération plus
 * difficile qu'elle ne l'est déjà.
 */
let RECOVERY_CONFLICTS = new Map<string, Conflict>();

/**
 * Ce que la dernière reconstruction a vu, et ce qu'elle a coûté.
 *
 * Gardé pour le relevé, et pour une seule décision : la vue de revue d'un rôle lié à
 * une lane (`vueDeRevue`, PLAN-LOT4 § 4) lit dans `LAST_LANES.read` l'identité de la
 * lane courante, sur le snapshot que la reconstruction de l'appel vient de poser —
 * jamais par une relecture du registre. Le relevé ne doit pas reconstruire de son côté
 * — il consommerait `observeLanes` et `observeIntegrations` une seconde fois, à un
 * autre instant, et publierait un état que le runtime n'a jamais eu. C'est la
 * divergence de 3c.1, transposée d'un outil à un rapport.
 *
 * `undefined` quand le registre correspondant était inexploitable : on ne garde
 * pas la vue précédente, qui décrirait un disque qu'on vient de renoncer à lire.
 */
let LAST_LANES: LaneSnapshot | undefined;
let LAST_INTEGRATIONS: IntegrationSnapshot | undefined;
let LAST_SCAN: RunMetrics = { recovery_scan_ms: 0, git_probe_count: 0 };

/**
 * Les lignes du registre qu'on n'a pas su lire.
 *
 * Elles ferment le run au même titre qu'une contradiction. Les compter sans
 * bloquer revenait à les sauter : la réconciliation qui « ne trouve aucun
 * conflit » sur un registre amputé n'a rien vérifié, elle a seulement regardé
 * ce qui restait lisible.
 */
let RECOVERY_MALFORMED: number[] = [];

/**
 * Le registre déclare-t-il une version qu'on sait lire ?
 *
 * Distinct de l'illisibilité : un registre d'une autre version n'est pas abîmé,
 * il est écrit dans un protocole qu'on ne connaît pas. Confondre les deux ferait
 * proposer de « corriger des lignes » là où il faut migrer, et l'opérateur
 * réécrirait de la provenance qu'il ne comprend pas.
 */
let RECOVERY_LEDGER_VERSION: number | undefined = LANE_LEDGER_VERSION;

/** Les contradictions du registre des tentatives, pour la porte de reprise. */
let INTEGRATION_CONFLICTS: readonly IntegrationConflict[] = [];

/**
 * Reconstruit l'état durable du run à partir du registre et du disque.
 *
 * Ni l'un ni l'autre seul ne suffit. Le registre dit ce que le run a fait, git
 * dit où en sont les choses, et `INTEGRATED = plan − openLanes()` serait faux
 * dans le sens dangereux : une unité sans worktree est soit intégrée, soit
 * jamais commencée, et rien dans le disque ne les distingue.
 *
 * Purement en lecture. Une réparation reste une opération opérateur explicite.
 */

/**
 * La file de chaque unité : la dernière délégation entrée, dont la suivante attend la fin.
 *
 * Un tour ne se rejette jamais — il se résout quand sa délégation se termine, erreur
 * comprise : un échec ne bloque pas celle qui suit. L'entrée n'est retirée que par le
 * dernier tour de la file ; un tour plus ancien qui se libère ne la supprime pas sous
 * les pieds d'un successeur. Plusieurs unités (un lot) s'acquièrent dans l'ordre trié :
 * deux lots qui partagent des unités ne s'attendent pas en croix.
 */
const FILES_UNITES = new Map<string, Promise<void>>();

async function entrerFileUnites(unites: readonly string[]): Promise<() => void> {
  const liberations: Array<() => void> = [];
  for (const u of [...new Set(unites)].sort()) {
    const precedente = FILES_UNITES.get(u) ?? Promise.resolve();
    let terminer: () => void = () => {};
    const tour = new Promise<void>((r) => { terminer = r; });
    const queue = precedente.then(() => tour);
    FILES_UNITES.set(u, queue);
    await precedente;
    liberations.push(() => {
      terminer();
      if (FILES_UNITES.get(u) === queue) FILES_UNITES.delete(u);
    });
  }
  return () => {
    for (const l of liberations.reverse()) l();
  };
}

/** Une lane rendue par `deciderLane`, et ce qu'il faut pour enregistrer son ouverture. */
interface OuvertureDeLane {
  lane: LaneContext;
  base: string | undefined;
  generation: number;
  /** Aucune ouverture de cette unité au registre : c'est une lane neuve. */
  nouvelle: boolean;
}

/**
 * La lane d'une unité, telle que le registre relu SOUS R la nomme — ou la suivante.
 *
 * L'identité vient de l'`OPENED` autoritaire (`laneOfUnit`), jamais de l'unité seule :
 * dès g1, `${RUN_ID}-${unit}` ne désigne plus aucune lane. Une unité ouverte ou intégrée
 * rejoint sa lane — rework, revue, reprise après intégration — sans nouvelle ouverture.
 * Une lane abandonnée ne se rejoint pas : C0 § F alloue g(n+1) après l'ABANDONED de g(n),
 * et ne réutilise ni génération ni branche. Une unité inconnue du registre reçoit g1.
 *
 * Appelée seulement depuis `ouvrirLanes`, donc sous R : la décision et l'artefact
 * qu'elle crée précèdent l'`OPENED` dans la même section critique.
 */
function deciderLane(unit: string, lu: LedgerRead): LaneAllocation<OuvertureDeLane> {
  const root = process.cwd();
  const connue = laneOfUnit(lu.events, laneGrammar(lu), RUN_ID, unit);
  const abandonnee = connue !== undefined && lu.events.some((e) =>
    e.event === "ABANDONED" && "lane" in e && e.lane === connue.laneId);
  if (connue && !abandonnee) {
    const l = ensureLane(root, connue.laneId);
    const lane = { laneId: connue.laneId, workUnitId: unit, cwd: l.cwd, branch: l.branch };
    return { value: { lane, base: l.base, generation: connue.generation, nouvelle: false } };
  }
  const generation = connue ? connue.generation + 1 : 1;
  let base: string | undefined;
  const lane = openLane(unit, { runId: RUN_ID, root }, (r, id) => {
    const l = ensureLane(r, id);
    base = l.base;
    return l;
  }, generation);
  if (!base) {
    // Sans base, l'ouverture ne serait pas prouvable et le registre la refuserait comme
    // malformée. Le worktree existe déjà : c'est un artefact sans preuve, que la lecture
    // suivante nommera, et non une ouverture bancale découverte après le merge.
    throw new LaneOpeningNotRecordedError(
      `impossible de déterminer la base de ${unit} : la lane n'est pas ouvrable`,
    );
  }
  return {
    opened: {
      event: "OPENED", work_unit: unit, at: new Date().toISOString(),
      base, lane: lane.laneId, generation,
    },
    value: { lane, base, generation, nouvelle: true },
  };
}

/**
 * Ouvrir les lanes de ces unités — une pour le chemin simple, toutes celles d'un lot —
 * en UNE section critique sous R (`allocateLanes`).
 *
 * Deux échecs distincts, et l'appelant les dit différemment : la création a échoué, rien
 * n'existe ; ou l'artefact existe et son ouverture n'a pas pu être écrite
 * (`LaneOpeningNotRecordedError`), ce qu'un opérateur tranche.
 */
function ouvrirLanes(unites: readonly string[], lease: Lease): Map<string, OuvertureDeLane> {
  const ouvertes = allocateLanes(RUN_DIR, lease, (lu) => unites.map((u) => deciderLane(u, lu)));
  for (const o of ouvertes) OPEN_UNITS.add(o.lane.workUnitId);
  return new Map(ouvertes.map((o) => [o.lane.workUnitId, o]));
}

/**
 * Le contexte d'admission de l'appel, sur les projections que la reconstruction vient de
 * poser (PLAN-LOT4 § 4, L4-Q3) — jamais sur le registre brut.
 *
 * `joins` est la décision ouvre/rejoint de l'appel, prise une fois par l'appelant et
 * transmise telle quelle au chemin simple, au pré-filtre du lot et à `runLanes`.
 * `owners` est une copie : l'ouverture des lanes d'un lot ajoute ses unités à `OPEN_UNITS`
 * après la décision, et ne doit pas la réécrire en cours de route.
 */
function contexteAdmission(joins: ReadonlySet<string>): Admission {
  const planifie = plan();
  const units = planifie.status === "usable" ? planifie.units : [];
  return {
    units,
    integrated: INTEGRATED,
    collide: scopesCollide,
    owners: units.filter((u) => OPEN_UNITS.has(u.id)),
    joins,
  };
}

/**
 * Les unités qu'un run legacy devrait ouvrir, s'il en est un (PLAN-LOT3 § 1, lecture (b)).
 *
 * Un registre v1 reste lisible et ses lanes déjà ouvertes se rejoignent, se ferment ou
 * s'abandonnent ; aucune nouvelle n'y naît, parce qu'elle y naîtrait sous une grammaire
 * que C0 ne crée plus. Le refus précède tout effet durable et toute séquence.
 */
function refusLegacy(unites: readonly string[]): string[] {
  const lu = readLaneEvents(RUN_DIR, RUN_ID);
  if (!lu.present || lu.version !== LANE_LEDGER_VERSION) return [];
  // Jamais ouverte, ou abandonnée : dans les deux cas il faudrait une ouverture neuve.
  const etats = foldLedger(lu.events);
  return unites.filter((u) => !etats.has(u) || etats.get(u) === "abandoned");
}

/**
 * Ce qui ferme l'intégration d'une unité avant le merge jusqu'au traitement du Statut
 * (C0 v1.8, compatibilité transitoire).
 *
 * Seule l'ABSENCE de `design_update` autorise l'`INTEGRATED` historique. Présent — quelle
 * que soit sa valeur —, ou impossible à établir parce que l'unité ne se retrouve pas dans
 * le texte du plan : refus. Le plan validé ne garde pas ce champ, d'où la relecture du
 * texte brut ; ne pas savoir n'est pas savoir qu'il est absent.
 */
function refusDesignUpdate(unit: string): string | undefined {
  let doc: unknown;
  try {
    doc = PLAN_TEXT === undefined ? undefined : JSON.parse(PLAN_TEXT);
  } catch {
    doc = undefined;
  }
  const unites = (doc as { work_units?: unknown } | undefined)?.work_units;
  const entree = Array.isArray(unites)
    ? unites.find((u) =>
      typeof u === "object" && u !== null && !Array.isArray(u) &&
      typeof (u as { id?: unknown }).id === "string" && (u as { id: string }).id.trim() === unit)
    : undefined;
  if (entree === undefined) {
    return `design_update de ${unit} impossible à établir dans le plan ; ` +
      "l'intégration reste fermée tant que le traitement du Statut n'existe pas";
  }
  if ("design_update" in (entree as object)) {
    return `${unit} porte un design_update ; son Statut n'est pas encore traité par ce ` +
      "runtime, l'intégration est fermée avant le merge";
  }
  return undefined;
}

/**
 * Le gel d'une lane est-il consommé sans intégration (PLAN-LOT8 Q5, adjudication L8-A1) ?
 *
 * Oui seulement si une tentative de l'unité, ouverte sur ce commit exact, a été close
 * `returned-to-lane`, et qu'aucune autre tentative sur ce même gel n'est vivante ni
 * intégrée. Le même jugement que l'écrivain refait sous R ; ici, il choisit seulement
 * entre réutiliser le gel et en demander un nouveau.
 */
function gelConsomme(events: readonly IntegrationEvent[], unit: string, commit: string): boolean {
  const tentatives = new Map<string, { p2: string; ferme?: string; remplacee: boolean }>();
  for (const e of events) {
    if (e.event === "ATTEMPT_OPENED") {
      if (e.work_unit === unit) tentatives.set(e.id, { p2: e.p2, remplacee: false });
    } else if (e.event === "CLOSED") {
      const t = tentatives.get(e.id);
      if (t) t.ferme = e.outcome;
    } else if (e.event === "SUPERSEDED") {
      const t = tentatives.get(e.id);
      if (t) t.remplacee = true;
    }
  }
  const surCeGel = [...tentatives.values()].filter((t) => t.p2 === commit);
  return surCeGel.some((t) => t.ferme === "returned-to-lane") &&
    !surCeGel.some((t) => (t.ferme === undefined && !t.remplacee) || t.ferme === "integrated");
}

/**
 * L'issue du gel : le commit gelé et son tree, ou la raison nommée qui ferme la porte.
 * `commit` absent : lane sans aucun changement, qui garde le chemin d'entrée (PLAN-LOT8 Q7).
 */
type IssueDuGel = { ok: true; commit?: string; parent?: string; tree?: string } | { ok: false; raison: string };

/**
 * Geler une lane v2 approuvée, avant tout merge (C2.4, C2.6, PLAN-LOT8 Q3 à Q7).
 *
 *   gel vivant exact          réutilisé : ni commit, ni second FROZEN
 *   gel vivant non exact      refus : un gel vivant ne se remplace pas
 *   gel consommé              la branche revient sur OPENED.base (reset --mixed), puis
 *                             nouveau gel fondé sur l'approbation plus récente
 *   commit de gel             parent et tree relus par git ; non conformes → reset
 *                             --mixed previousHead tant que l'appel possède le run, puis
 *                             classement sur l'arbre de travail : transformé → nouvelle
 *                             revue ; inchangé → index seul, refus sans nouvelle revue
 *   FROZEN                    écrit sous R ; refusé avant octet → gel défait ; bail perdu
 *                             ou issue incertaine → aucun reset (C2.5, vestige)
 */
function gelerLane(lane: LaneContext, lease: Lease): IssueDuGel {
  const root = process.cwd();
  let lu: LedgerRead;
  let vu: ReturnType<typeof observeLanes>;
  try {
    lu = readLaneEvents(RUN_DIR, RUN_ID);
    vu = observeLanes({ root, runId: RUN_ID, laneRead: { ...lu, version: lu.version } });
  } catch (err) {
    return { ok: false, raison: `état de la lane inconnu avant le gel : ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!vu.usable) return { ok: false, raison: `état de la lane inconnu avant le gel : ${vu.reason}` };
  if (!vu.snapshot.read.present || vu.snapshot.read.version !== LANE_LEDGER_V2) {
    return { ok: false, raison: "le gel durable n'existe qu'en registre v2 ; aucun gel" };
  }
  const events = vu.snapshot.read.events;
  const base = baseDeLane(events, lane.laneId);
  if (base === undefined) return { ok: false, raison: `aucune ouverture enregistrée pour ${lane.laneId} ; aucun gel` };
  const derniere = (vu.snapshot.projections.reviews.get(lane.laneId) ?? []).at(-1);
  if (derniere === undefined || derniere.verdict !== "approved") {
    return { ok: false, raison: "aucune approbation durable à geler" };
  }
  const approuve = derniere.tree;
  let precedent: { commit: string; parent: string; tree: string } | undefined;
  for (const e of events) {
    if (e.event === "FROZEN" && e.lane === lane.laneId) precedent = { commit: e.commit, parent: e.parent, tree: e.tree };
  }
  let consomme = false;
  if (precedent !== undefined) {
    /*
     * Q5 : la consommation d'un gel antérieur ne se prouve que par l'observation autoritaire
     * des intégrations, sur le même snapshot des lanes. Un registre qui n'est ni KNOWN ni EMPTY
     * refuse ici, avant toute mutation git ; sa liste brute ne fonde aucune décision. EMPTY est
     * un constat d'absence : aucune tentative, donc aucun gel consommé.
     */
    let integ: ReturnType<typeof observeIntegrations>;
    try {
      integ = observeIntegrations({ root, runDir: RUN_DIR, runId: RUN_ID, laneRead: { ...lu, version: lu.version } });
    } catch (err) {
      return { ok: false, raison: `état des intégrations inexploitable avant le gel : ${err instanceof Error ? err.message : String(err)} ; aucun gel` };
    }
    if (!integ.usable) {
      return { ok: false, raison: `état des intégrations inexploitable avant le gel (${integ.state}) : ${integ.reason} ; aucun gel` };
    }
    consomme = gelConsomme(integ.snapshot.read.events, lane.workUnitId, precedent.commit);
  }
  const tete = laneTip(root, lane.laneId);

  if (precedent !== undefined && !consomme) {
    // Le gel vivant se réutilise tel quel, ou ne se remplace pas.
    const propre = laneIsClean(root, lane.laneId);
    const faits = commitFacts(root, precedent.commit);
    const exact = tete === precedent.commit && propre === true && faits.ok &&
      faits.parents.length === 1 && faits.parents[0] === base && faits.tree === precedent.tree &&
      precedent.parent === base && approuve === precedent.tree;
    if (exact) return { ok: true, commit: precedent.commit, parent: precedent.parent, tree: precedent.tree };
    return {
      ok: false,
      raison: `le gel vivant ${precedent.commit.slice(0, 12)} de ${lane.laneId} ne se réutilise pas ` +
        `(tête ${String(tete).slice(0, 12)}, lane propre ${String(propre)}, tree approuvé ` +
        `${approuve.slice(0, 12)}, tree gelé ${precedent.tree.slice(0, 12)}${faits.ok ? "" : `, ${faits.reason}`}) ; ` +
        "aucun second gel tant qu'il n'est pas consommé",
    };
  }
  if (tete !== base) {
    // Seule une tête posée sur un gel consommé revient à la base ; toute autre est inconnue.
    if (!(precedent !== undefined && consomme && tete === precedent.commit)) {
      return { ok: false, raison: `tête ${String(tete).slice(0, 12)} de ${lane.laneId} inattendue avant le gel ; aucun gel` };
    }
    if (!ownsRun(RUN_DIR, lease) || !resetLaneTo(root, lane.laneId, base)) {
      return { ok: false, raison: `la lane ${lane.laneId} n'a pas pu revenir sur sa base avant un nouveau gel` };
    }
  }

  const gel = commitLane(root, lane.laneId, freezeMessage(lane.laneId));
  if (gel.status === "failed") return { ok: false, raison: `gel impossible : ${gel.reason}` };
  // Lane sans aucun changement : pas de FROZEN synthétique au LOT 8 (Q7) ; chemin d'entrée.
  if (gel.status === "clean") return { ok: true };
  const commit = gel.commit;
  const avant = gel.previousHead;
  if (commit === undefined || avant === undefined) {
    return { ok: false, raison: "commit de gel sans identité observable ; aucun FROZEN, aucun merge" };
  }

  const faits = commitFacts(root, commit);
  const conforme = faits.ok && faits.parents.length === 1 && faits.parents[0] === base && faits.tree === approuve;
  if (!conforme) {
    const detail = faits.ok
      ? `parent ${faits.parents.join(",").slice(0, 40)} pour la base ${base.slice(0, 12)}, tree ` +
        `${faits.tree.slice(0, 12)} pour l'approuvé ${approuve.slice(0, 12)}`
      : faits.reason;
    // Tant que l'appel possède le run, et seulement alors, le gel se défait.
    if (!ownsRun(RUN_DIR, lease)) {
      return { ok: false, raison: `commit de gel non conforme (${detail}) et propriété du run perdue : aucun reset (C2.5)` };
    }
    if (!resetLaneTo(root, lane.laneId, avant)) {
      return { ok: false, raison: `commit de gel non conforme (${detail}) ; le gel n'a pas pu être défait` };
    }
    let apres: string;
    try {
      apres = workingTree(lane.cwd);
    } catch (err) {
      return { ok: false, raison: `commit de gel non conforme (${detail}) ; arbre de travail inobservable : ${err instanceof Error ? err.message : String(err)}` };
    }
    if (apres !== approuve) {
      return {
        ok: false,
        raison: `le commit de gel ne porte pas l'arbre approuvé (${detail}) : un hook a transformé ` +
          `les fichiers de la lane (${approuve.slice(0, 12)} → ${apres.slice(0, 12)}). Le gel est ` +
          "défait, l'approbation est caduque ; une nouvelle revue de l'arbre transformé est requise (C2.4)",
      };
    }
    return {
      ok: false,
      raison: `le commit de gel ne porte pas l'arbre approuvé (${detail}), alors que l'arbre de ` +
        "travail est resté celui de l'approbation : la transformation n'existait que dans l'index. " +
        "Le gel est défait ; refus, sans nouvelle revue (C2.4)",
    };
  }

  try {
    appendFrozenEvent(RUN_DIR, {
      event: "FROZEN",
      work_unit: lane.workUnitId,
      at: new Date().toISOString(),
      lane: lane.laneId,
      commit,
      parent: base,
      tree: approuve,
      reviewed_event_seq: derniere.event_seq,
    }, lease);
  } catch (err) {
    const quoi = err instanceof Error ? err.message : String(err);
    if (err instanceof FrozenRefusedError) {
      if (ownsRun(RUN_DIR, lease) && resetLaneTo(root, lane.laneId, avant)) {
        return { ok: false, raison: `${quoi} ; le gel est défait, rien n'est mergé` };
      }
      return { ok: false, raison: `${quoi} ; le gel n'a pas pu être défait, rien n'est mergé (C2.5)` };
    }
    if (err instanceof FrozenNotRecordedError) return { ok: false, raison: `${quoi} ; rien n'est mergé` };
    // Bail perdu, garde de transition, tout le reste : l'appel ne mute plus la lane.
    return {
      ok: false,
      raison: `FROZEN non enregistré : ${quoi}. Le commit de gel ${commit.slice(0, 12)} reste sans ` +
        "FROZEN : provenance inconnue, aucun reset, aucun merge (C2.5)",
    };
  }
  return { ok: true, commit, parent: base, tree: approuve };
}

/**
 * L'arbre d'une lane a-t-il changé depuis sa dernière revue durable (C2.1, PLAN-LOT8 Q8) ?
 *
 * Lu sur la vue autoritaire v2 — jamais sur un marqueur de session — : le `tree` du dernier
 * `REVIEWED` de la lane courante de l'unité, contre le `T_L` recalculé maintenant. Tout ce
 * qui n'est pas établi rend `false` : la garde de revue reste alors ce qu'elle était.
 */
function arbreChangeDepuisRevue(unit: string): boolean {
  try {
    const lu = readLaneEvents(RUN_DIR, RUN_ID);
    const vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead: { ...lu, version: lu.version } });
    if (!vu.usable || !vu.snapshot.read.present || vu.snapshot.read.version !== LANE_LEDGER_V2) return false;
    let lane: string | undefined;
    for (const e of vu.snapshot.read.events) {
      if (e.event === "OPENED" && e.work_unit === unit && "lane" in e) lane = e.lane;
    }
    if (lane === undefined) return false;
    const derniere = (vu.snapshot.projections.reviews.get(lane) ?? []).at(-1);
    const cwd = join(process.cwd(), ".git", "pi-lanes", lane);
    if (derniere === undefined || !existsSync(cwd)) return false;
    return workingTree(cwd) !== derniere.tree;
  } catch {
    return false;
  }
}

/**
 * La lane a-t-elle avancé hors de sa provenance enregistrée ?
 *
 * Un worker écrit dans son worktree et ne commite pas : figer est une étape de
 * l'intégration, pas une commodité du worker. Une lane dont la tête a bougé sans
 * `FROZEN` exact ni intégration confirmée a donc une histoire que le registre ne raconte
 * pas — et la reviewer à qui on la donnerait jugerait un changement dont personne ne
 * sait d'où il part. Le diff se compte depuis la base ouverte ; si la tête n'est plus
 * dessus et qu'aucune preuve exacte ne l'explique, la frontière de revue est fausse
 * avant même d'être calculée.
 *
 * Le refus est un refus, pas une réparation : `git reset` remettrait la branche sur sa
 * base et **détruirait** le commit de l'enfant. Ce qu'on ne sait pas situer se tranche
 * par un opérateur, jamais par un rollback silencieux.
 *
 * Le registre est relu ICI plutôt que pris d'un instantané : entre la reconstruction et
 * cet appel, une autre session a pu figer la lane, et refuser sur une vue périmée
 * bloquerait une revue légitime.
 */
function laneHorsProvenance(unit: string, laneId: string): string | undefined {
  const lu = readLaneEvents(RUN_DIR, RUN_ID);
  /*
   * La boucle, et non `.find()`.
   *
   * `LaneEvent` est l'union v1|v2, et `base` n'appartient qu'à `OPENED`. Le prédicat
   * d'un `.find()` ne restreint pas le type de ce qu'il rend : `ouverture.base` y est un
   * accès à une propriété que l'union ne porte pas, et S4 l'a refusé — deux diagnostics
   * nouveaux. La comparaison du discriminant DANS la boucle, elle, restreint ; c'est la
   * forme qu'emploie déjà `lane-observe.ts` pour lire exactement la même chose.
  */
  let base: string | undefined;
  for (const e of lu.events) {
    if (e.event === "OPENED" && e.work_unit === unit && typeof e.base === "string") {
      // Sous v2, l'unité peut avoir plusieurs générations : seule l'ouverture de
      // cette lane fait autorité. Sous v1 il n'existe pas de champ `lane` et l'unité
      // reste l'identité legacy unique.
      if ("lane" in e && e.lane !== laneId) continue;
      base = e.base;
      break;
    }
  }
  // Sans ouverture enregistrée, il n'y a pas de provenance à contredire : ce cas-là est
  // celui des orphelines, que la porte de reprise nomme déjà.
  if (base === undefined) return undefined;
  const root = process.cwd();
  // Branche absente : rien n'a avancé, donc rien à refuser.
  const tete = laneTip(root, laneId);
  if (tete === undefined || tete === base) return undefined;

  /*
   * Un événement ne suffit pas par son seul nom : il doit expliquer CETTE tête.
   *
   * Sous v1, `INTEGRATED` ne porte pas l'identité de lane. Git complète alors la
   * preuve : la branche doit avoir produit au moins un commit depuis sa base ET sa tête
   * courante doit être ancêtre de HEAD. Une intégration ancienne n'excuse donc jamais
   * un commit ajouté ensuite sur la branche. Sous v2, l'enveloppe doit en plus nommer la
   * lane courante.
   *
   * `FROZEN`, quand le LOT 9 l'écrira, porte déjà les deux éléments exacts : la lane et
   * le commit gelé. Accepter seulement leur égalité évite qu'un gel ancien dispense
   * toutes les têtes futures de provenance.
   */
  let integrated = false;
  let frozenExact = false;
  for (const e of lu.events) {
    if (e.work_unit !== unit) continue;
    if (e.event === "INTEGRATED") {
      if (!("lane" in e) || e.lane === laneId) integrated = true;
    } else if (e.event === "FROZEN" && e.lane === laneId && e.commit === tete) {
      frozenExact = true;
    }
  }
  if (frozenExact || (integrated && isMerged(root, laneId, base))) return undefined;

  return (
    `la lane de ${unit} est en ${tete.slice(0, 7)}, sa base enregistrée est ` +
    `${base.slice(0, 7)}, et aucun FROZEN exact ni INTEGRATED confirmé n'explique l'écart`
  );
}

/**
 * La base enregistrée d'une lane, et son tree. Lue dans des événements déjà relus.
 *
 * La boucle et non `.find()`, pour la même raison que `laneHorsProvenance` : seule la
 * comparaison du discriminant restreint l'union v1|v2 jusqu'à `base`.
 */
function baseDeLane(events: readonly LaneEvent[], laneId: string): string | undefined {
  for (const e of events) {
    if (e.event === "OPENED" && "lane" in e && e.lane === laneId) return e.base;
  }
  return undefined;
}

/**
 * Enregistre la revue d'une lane (C2.2, PLAN-LOT6 Q5). Rend la raison d'un refus, ou rien.
 *
 * Le runtime écrit tout, et il écrit LES TREES DU PAQUET : `from_tree` et `tree` sont ceux
 * que `paquetDeLane` a observés pour construire la preuve, jamais un recalcul d'après la
 * revue. Les recalculer ici décrirait un arbre que le reviewer n'a pas vu : une écriture
 * arrivée pendant la délégation serait couverte par un `proof` qui ne la contient pas
 * (B1). Si la lane a changé pendant la revue, l'approbation porte l'ancien snapshot et la
 * porte la refuse sur « l'arbre de la lane a changé depuis la revue ».
 *
 * L'identité est celle de la délégation réelle ; la preuve est ce que le paquet contenait.
 * Le reviewer ne choisit rien de tout cela. L'écrivain revérifie la chaîne sous R.
 *
 * `risques` : les transitions RISK de la même enveloppe, calculées et écrites AVANT ce
 * REVIEWED sous la même acquisition de R (PLAN-LOT7 § 3.3). Leur échec n'est pas une revue
 * non enregistrée qu'on referme à la porte : il remonte, et l'appel s'arrête sur un refus
 * nommé — avec vestige si une ligne a pu être écrite.
 */
function enregistrerRevue(
  lane: LaneContext,
  resultat: RunResult | undefined,
  seq: number,
  identite: { agent: string; role: string },
  snapshot: { fromTree: string; tree: string; proof: DiffPackage["proof"] },
  lease: Lease,
  risques?: CalculDesRisques,
): string | undefined {
  const verdict = resultat?.verdict;
  if (typeof verdict !== "string" || verdict === "") {
    return "la revue n'a rendu aucun verdict exploitable ; aucune revue n'est enregistrée";
  }
  try {
    appendLaneEvent(
      RUN_DIR,
      {
        event: "REVIEWED",
        work_unit: lane.workUnitId,
        at: new Date().toISOString(),
        lane: lane.laneId,
        from_tree: snapshot.fromTree,
        tree: snapshot.tree,
        verdict,
        reviewer: { delegation_seq: seq, agent: identite.agent, role: identite.role },
        proof: snapshot.proof,
      },
      lease,
      risques,
    );
    return undefined;
  } catch (err) {
    if (risques !== undefined) throw err;
    return `revue non enregistrée : ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * L'état autoritaire d'une lane, relu à la porte (PLAN-LOT6 Q8).
 *
 * Par l'observation commune — la même que la reconstruction et que
 * `bin/subagent-recover` —, jamais par le cache de l'appel : un registre inexploitable,
 * une chaîne rompue ou une observation git en échec rendent la lane inconnue.
 */
type EtatDeLane =
  | {
      connu: true;
      baseTree: string;
      reviews: ReviewFact[];
      violations: ViolationFact[];
      /** Les risques ouverts de l'unité, toutes générations confondues (C3.4, PLAN-LOT7 Q7). */
      risques: RiskFact[];
    }
  | { connu: false; raison: string };

function etatAutoritaire(laneId: string, workUnit: string): EtatDeLane {
  try {
    const lu = readLaneEvents(RUN_DIR, RUN_ID);
    const laneRead = { ...lu, version: lu.version };
    const vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead });
    if (!vu.usable) return { connu: false, raison: vu.reason };
    if (vu.snapshot.read.version !== LANE_LEDGER_V2) {
      return { connu: false, raison: "le registre legacy ne porte aucune revue durable (C2.2)" };
    }
    const base = baseDeLane(vu.snapshot.read.events, laneId);
    if (base === undefined) return { connu: false, raison: `aucune ouverture enregistrée pour ${laneId}` };
    return {
      connu: true,
      baseTree: treeOfCommit(process.cwd(), base),
      reviews: vu.snapshot.projections.reviews.get(laneId) ?? [],
      violations: vu.snapshot.projections.violations.filter((v) => v.lane === laneId),
      risques: [...vu.snapshot.projections.risks.values()].filter((f) => f.work_unit === workUnit && f.open),
    };
  } catch (err) {
    return { connu: false, raison: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Les risques du run, tels que le registre autoritaire les porte (PLAN-LOT7 Q5).
 *
 * `observeLanes` → `vu.usable` → `projections.risks`, sous `(R, work_unit, id)`. Un registre
 * inexploitable n'est jamais lu comme « aucun risque » (T1).
 */
type RisquesDuRun = { connu: true; faits: RiskFact[] } | { connu: false; raison: string };
function risquesAutoritaires(): RisquesDuRun {
  try {
    const lu = readLaneEvents(RUN_DIR, RUN_ID);
    const vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead: { ...lu, version: lu.version } });
    if (!vu.usable) return { connu: false, raison: vu.reason };
    return { connu: true, faits: [...vu.snapshot.projections.risks.values()] };
  } catch (err) {
    return { connu: false, raison: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Le grand livre que reçoivent les transitions pures : les FAITS autoritaires, et de la
 * mémoire seulement les textes (PLAN-LOT7 Q5). Connu, ouvert, routé, résolu, l'unité d'un
 * risque : tout vient du registre. Un risque sans unité n'a ni lane ni registre ; il reste
 * tel que la session le connaît.
 */
function grandLivre(faits: Iterable<RiskFact>): RiskRecord[] {
  const livre: RiskRecord[] = [];
  for (const f of faits) {
    const memo = RISKS.find((r) => r.workUnitId === f.work_unit && r.id === f.id);
    livre.push({
      id: f.id,
      text: memo?.text ?? texteRelu(f.id),
      openedBy: memo?.openedBy ?? "",
      workUnitId: f.work_unit,
      status: !f.open ? "resolved" : f.transition === "routed" ? "routed" : "open",
      ...(memo?.routedTo !== undefined ? { routedTo: memo.routedTo } : {}),
      ...(memo?.resolvedBy !== undefined ? { resolvedBy: memo.resolvedBy } : {}),
    });
  }
  for (const r of RISKS) if (r.workUnitId === undefined) livre.push({ ...r });
  return livre;
}

/**
 * Le texte d'un risque ouvert dans une session précédente, relu dans l'artefact de la revue
 * qui l'a ouvert. Best-effort : aucune décision n'en dépend (PLAN-LOT7 Q8).
 *
 * Un identifiant de production est `<runId>-<seq>-<n>` (`reviewRisks`) : il désigne
 * l'artefact `<runId>-<seq>-<agent>.json` et la position `n` de ses `open_risks`. Les ids
 * sont recalculés par la même fonction que celle qui les a émis ; rien d'autre n'est lu.
 */
function texteRelu(id: string): string {
  try {
    const m = /^(.+)-[1-9][0-9]*$/.exec(id);
    if (m) {
      for (const nom of readdirSync(RUN_DIR)) {
        if (!nom.startsWith(`${m[1]}-`) || !nom.endsWith(".json")) continue;
        const doc = JSON.parse(readFileSync(join(RUN_DIR, nom), "utf-8")) as {
          runId?: unknown;
          envelope?: Record<string, unknown> | null;
        };
        if (doc.runId !== RUN_ID || !doc.envelope) continue;
        const payload = doc.envelope.payload as Record<string, unknown> | undefined;
        const trouve = reviewRisks(doc.envelope.open_risks ?? payload?.open_risks, m[1])?.find((r) => r.id === id);
        if (trouve) return trouve.text;
      }
    }
  } catch {
    // Best-effort : un artefact absent ou illisible laisse la mention ci-dessous.
  }
  return `(texte non relu — risque ${id} ouvert dans une session précédente ; voir les artefacts de revue sous ${RUNS_DIR}/)`;
}

/**
 * L'unité d'un appel qui porte `for_risks`, lue sur la projection autoritaire (PLAN-LOT7
 * § 3.4). Sans `for_risks`, rien n'est lu : seule la déclaration compte. Un état des risques
 * inexploitable refuse l'appel plutôt que de le rattacher au hasard.
 */
function cibleDesRisques(
  declared: string | undefined,
  forRisks: readonly string[],
): { cible: Target; livre: RiskRecord[] } {
  if (forRisks.length === 0) return { cible: targetWorkUnit(declared, [], []), livre: [] };
  const vu = risquesAutoritaires();
  if (!vu.connu) {
    return { cible: { kind: "conflict", reason: `état des risques inconnu : ${vu.raison}` }, livre: [] };
  }
  const livre = grandLivre(vu.faits);
  return { cible: targetWorkUnit(declared, forRisks, livre), livre };
}

/**
 * Ce qui interdit d'intégrer une tentative (C3.4, PLAN-LOT7 Q10, § 3.1/F5), ou rien.
 *
 * Seul un snapshot v2 autoritaire et utilisable, sans risque ouvert pour l'unité, laisse la
 * tentative aller jusqu'à `M` :
 *
 *   v2 KNOWN, aucun risque ouvert   → passage (undefined)
 *   v2 KNOWN, risque ouvert         → open-risks (C3.7)
 *   v1 legacy                        → fermé : l'absence de RISK v1 n'autorise rien
 *   inexploitable, autre version     → fermé sur état inconnu, sans liste
 *
 * Le legacy s'identifie par la seule lecture `present && version === LANE_LEDGER_VERSION` ;
 * tout le reste passe par la lecture autoritaire.
 */
function barriereDesRisques(
  unit: string,
  resultat: RunResult | undefined,
): { ouverts: boolean; raison: string } | undefined {
  let lu: LedgerRead;
  try {
    lu = readLaneEvents(RUN_DIR, RUN_ID);
  } catch (err) {
    return { ouverts: false, raison: `état des risques inconnu : ${err instanceof Error ? err.message : String(err)}` };
  }
  if (lu.present && lu.version === LANE_LEDGER_VERSION) {
    if ((resultat?.openRiskItems?.length ?? 0) > 0) {
      return { ouverts: true, raison: "open-risks (registre legacy : le risque ouvert par cette revue n'a pas pu s'écrire)" };
    }
    return {
      ouverts: false,
      raison: "état durable des risques indisponible : le registre legacy (v1) ne porte aucun RISK, " +
        "et leur absence n'autorise aucune intégration",
    };
  }
  let vu: ReturnType<typeof observeLanes>;
  try {
    vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead: { ...lu, version: lu.version } });
  } catch (err) {
    return { ouverts: false, raison: `état des risques inconnu : ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!vu.usable) return { ouverts: false, raison: `état des risques inconnu : ${vu.reason}` };
  if (!vu.snapshot.read.present || vu.snapshot.read.version !== LANE_LEDGER_V2) {
    return {
      ouverts: false,
      raison: `état des risques inconnu : registre des lanes ${vu.snapshot.read.present ? `en version ${String(vu.snapshot.read.version)}` : "absent"}`,
    };
  }
  const ouverts = [...vu.snapshot.projections.risks.values()]
    .filter((f) => f.work_unit === unit && f.open).map((f) => f.id).sort();
  return ouverts.length > 0 ? { ouverts: true, raison: `open-risks ${ouverts.join(", ")}` } : undefined;
}

/**
 * Le régime des risques d'un appel, relu APRÈS le retour de l'enfant (PLAN-LOT7 § 3.1, Q5).
 *
 * La reconstruction faite avant le départ ne suffit pas : l'état a pu changer pendant la
 * délégation. Pour un appel qui porte une unité et peut produire une transition, la
 * lecture autoritaire (`observeLanes` → `vu.usable` → `vu.snapshot.read`) décide :
 *
 *   v2 présent et utilisable   → durable : l'écrivain relit et revalide sous R
 *   v1 présent et utilisable   → mémoire et journal, compatibilité legacy
 *   tout autre état            → refus nommé : ni transition calculée depuis RISKS,
 *                                ni REVIEWED, ni décision partielle
 *
 * Sans unité ou sans transition possible, il n'y a rien d'autoritaire à écrire : mémoire.
 */
function regimeDesRisques(
  unit: string | undefined,
  transitionPossible: boolean,
): "durable" | "memoire" | { refus: string } {
  if (unit === undefined || !transitionPossible) return "memoire";
  let vu: ReturnType<typeof observeLanes>;
  try {
    const lu = readLaneEvents(RUN_DIR, RUN_ID);
    vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead: { ...lu, version: lu.version } });
  } catch (err) {
    return { refus: `lecture autoritaire impossible : ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!vu.usable) return { refus: `registre des lanes ${vu.state} : ${vu.reason}` };
  const lu = vu.snapshot.read;
  if (lu.present && lu.version === LANE_LEDGER_V2) return "durable";
  if (lu.present && lu.version === LANE_LEDGER_VERSION) return "memoire";
  return {
    refus: `registre des lanes ${lu.present ? `en version ${String(lu.version)}` : "absent"} pour ${unit} : ` +
      "aucun état des risques n'y est établi",
  };
}

/** Le refus d'un appel dont l'état des risques est inconnu après le retour de l'enfant. */
function refusEtatDesRisques(raison: string) {
  return {
    content: [{
      type: "text" as const,
      text:
        `[run: état des risques inconnu] ${raison}\n` +
        "Rien n'est écrit ni retenu : ni risque, ni revue, ni intégration. Un état inconnu n'est " +
        "jamais lu comme un registre legacy.",
    }],
    isError: true,
  };
}

/** La mémoire après une écriture durable réussie : textes et observabilité, jamais en avance. */
function retenirRisques(ledger: readonly RiskRecord[]): void {
  const cle = (r: RiskRecord) => JSON.stringify([r.workUnitId ?? null, r.id]);
  const nouveaux = new Set(ledger.map(cle));
  RISKS = [...RISKS.filter((r) => !nouveaux.has(cle(r))), ...ledger.map((r) => ({ ...r }))];
}

/** Le refus d'une transition de risque non enregistrée (PLAN-LOT7 Q6). */
function refusRisqueNonEnregistre(err: unknown) {
  const vestige = err instanceof RiskNotRecordedError;
  return {
    content: [{
      type: "text" as const,
      text:
        `[run: risque non enregistré] ${err instanceof Error ? err.message : String(err)}\n` +
        (vestige
          ? "Une séquence de risques a commencé sans s'achever : le verrou du run est conservé, et " +
            "les appels suivants rencontreront RUN_TRANSITION_LOCKED jusqu'à la réconciliation."
          : "Rien n'a été écrit : ni risque, ni revue. Aucune suite n'est donnée à cet appel."),
    }],
    isError: true,
  };
}

/**
 * C2.3, sur la chaîne continue des revues durables de la lane (PLAN-LOT6 Q3).
 *
 * Intégrable seulement si : la chaîne part de la base ; la dernière revue est approuvée
 * et porte le T_L recalculé maintenant ; et chaque maillon qui change le tree a reçu un
 * diff ou une liste de lecture. Un maillon `none` sur un tree inchangé n'ajoute rien à
 * couvrir ; un maillon `none` qui change le tree laisse ce changement non couvert, et
 * aucune revue ultérieure sans preuve ne le couvre.
 */
function refusDeCouverture(lane: LaneContext, etat: EtatDeLane): string | undefined {
  if (!etat.connu) return `état de la lane inconnu : ${etat.raison}`;
  let tl: string;
  try {
    tl = workingTree(lane.cwd);
  } catch (err) {
    return `état de la lane inconnu : ${err instanceof Error ? err.message : String(err)}`;
  }
  const revues = etat.reviews;
  const derniere = revues.at(-1);
  if (!derniere) return "aucune revue durable de cette lane";
  if (revues[0].from_tree !== etat.baseTree) {
    return `la chaîne des revues part de ${revues[0].from_tree.slice(0, 12)}, pas de la base ` +
      `${etat.baseTree.slice(0, 12)}`;
  }
  if (derniere.verdict !== "approved") return `la dernière revue est ${derniere.verdict}`;
  if (derniere.tree !== tl) {
    return `l'arbre de la lane a changé depuis la revue (${derniere.tree.slice(0, 12)} → ${tl.slice(0, 12)})`;
  }
  const nue = revues.find((r) => r.from_tree !== r.tree && r.proof.mode === "none");
  if (nue) {
    return `la revue ${nue.event_seq} n'a reçu aucune preuve du changement ` +
      `${nue.from_tree.slice(0, 12)} → ${nue.tree.slice(0, 12)}, et aucune revue ne le couvre (C2.3)`;
  }
  return undefined;
}

/**
 * R et B (C3.6, PLAN-LOT6 Q6) : deux ensembles, deux étiquettes, aucune intersection.
 *
 * R = les chemins réservés du plan ; B = les fichiers du bundle gelé moins R, et vide hors
 * régime bundle. `DESIGN.md` appartient aux deux listes sources : il reçoit une seule
 * nature, `reserved-violation`. `RESERVED_WRITE_PATHS` n'est pas étendu.
 */
function naturesViolees(paths: readonly string[]): { reserved: string[]; bundle: string[] } {
  const reserved = trierChemins(reservedTouched(paths));
  const bundle = bundleRoot(process.cwd()) === null
    ? []
    : trierChemins(paths.filter((p) => BUNDLE_FILES.includes(p) && !reserved.includes(p)));
  return { reserved, bundle };
}

/**
 * La violation historique, rendue durable après une délégation writer (C3.1, C3.2, Q7).
 *
 * Observée par git sur la lane — jamais sur `changedFiles`, ni sur le journal — et écrite
 * sous le bail, au plus une par nature. Une observation qui échoue — T_L, delta ou lecture
 * autoritaire du registre — lève `ObservationViolationInconnueError` : l'appel s'arrête sur
 * un refus nommé. Un bail perdu n'écrit rien : le nouveau propriétaire recalcule. Une écriture en échec sous bail valide lève
 * `ViolationNotRecordedError` et garde le verrou R : l'appelant ne revient pas au flot.
 * Une violation déjà enregistrée à l'identique pour cette lane n'est pas répétée.
 */
function enregistrerViolations(
  lane: LaneContext,
  seq: number,
  agentName: string,
  lease: Lease,
  tlAvant: string,
): void {
  // Seule la perte de bail garde la règle « rien n'est écrit, le nouveau propriétaire
  // recalcule » (C3.2). Tout le reste se regarde, ou s'arrête.
  if (!stillOwns(lease)) return;
  let observe: { reserved: string[]; bundle: string[] };
  let tl: string;
  let deja: ViolationFact[];
  try {
    // Ce que CETTE délégation a changé, lu entre deux trees : un chemin interdit écrit par
    // une autre — sous un bail perdu, par exemple — n'est pas mis à son compte ; le
    // recalcul de la porte le verra (C3.1, C3.2).
    tl = workingTree(lane.cwd);
    observe = naturesViolees(pathsBetweenTrees(process.cwd(), tlAvant, tl));
    // La lecture autoritaire, jugée comme à la porte : un registre présent mais
    // inexploitable (ligne illisible, version inconnue) n'est jamais projeté en partie.
    const lu = readLaneEvents(RUN_DIR, RUN_ID);
    const laneRead = { ...lu, version: lu.version };
    const vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead });
    if (!vu.usable) {
      throw new Error(`registre des lanes inexploitable : ${vu.reason}`);
    }
    deja = vu.snapshot.projections.violations
      .filter((v) => v.lane === lane.laneId);
  } catch (err) {
    throw new ObservationViolationInconnueError(
      `observation de violation inconnue après la délégation ${seq} sur ${lane.laneId} — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (observe.reserved.length === 0 && observe.bundle.length === 0) return;
  const natures: Array<[ViolationKind, string[]]> = [
    ["reserved-violation", observe.reserved],
    ["bundle-violation", observe.bundle],
  ];
  for (const [kind, paths] of natures) {
    if (paths.length === 0) continue;
    if (deja.some((v) => v.kind === kind && JSON.stringify(v.paths) === JSON.stringify(paths))) continue;
    try {
      appendViolationEvent(
        RUN_DIR,
        {
          event: "VIOLATION",
          work_unit: lane.workUnitId,
          at: new Date().toISOString(),
          lane: lane.laneId,
          kind,
          paths,
          source: { delegation_seq: seq, agent: agentName },
          observed_tree: tl,
        },
        lease,
      );
    } catch (err) {
      if (err instanceof NotOwnerError) return;
      throw err;
    }
  }
}

/**
 * Une observation du producteur de violations qui n'a pas pu être faite (B2, C3.3).
 *
 * Ni un constat d'absence, ni une raison d'écrire : ce qu'on n'a pas su regarder ferme
 * l'appel. Avant la délégation, aucun enfant ne part ; après, rien ne continue — ni
 * journal, ni risque, ni revue, ni intégration.
 */
class ObservationViolationInconnueError extends Error {}

/** T_L avant une délégation writer. Inobservable : l'appel s'arrête, l'enfant ne part pas. */
function arbreAvant(cwd: string): string {
  try {
    return workingTree(cwd);
  } catch (err) {
    throw new ObservationViolationInconnueError(
      `observation de violation inconnue : le T_L de ${cwd} est inobservable avant la ` +
        `délégation — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Le refus d'une observation de violation impossible. */
function refusObservationInconnue(err: ObservationViolationInconnueError) {
  return {
    content: [{
      type: "text" as const,
      text:
        `[run: observation de violation inconnue] ${err.message}\n` +
        "Rien n'est journalisé, revu ni intégré : une observation impossible n'est pas un constat " +
        "d'absence de violation.",
    }],
    isError: true,
  };
}

/** Le refus d'une violation constatée et non écrite : aucun retour au flot de `task`. */
function refusViolationNonEnregistree(err: ViolationNotRecordedError) {
  return {
    content: [{
      type: "text" as const,
      text:
        `[run: violation non enregistrée] ${err.message}\n` +
        "Aucune suite n'est donnée à cet appel : la violation existe et le registre ne la porte pas.",
    }],
    isError: true,
  };
}

function reconstruire(): void {
  /*
   * La fenêtre de mesure : avant la première lecture, après la seconde
   * réconciliation.
   *
   * Le corps est une fonction à part parce qu'il sort tôt sur un registre
   * partiel, et que ce refus a coûté son scan comme un autre — la forme linéaire
   * mesure les deux issues sans avoir à les distinguer.
   *
   * Pas de `try/finally` : il n'y en avait un que pour le cas où la
   * reconstruction jette, et ce cas-là ne rend `LAST_SCAN` observable nulle part
   * — l'exception traverse `releveDuRun` avant qu'on le lise. Une garde dont le
   * retrait ne change rien est décorative, et celle-ci l'était.
   *
   * Le compte de sondes se lit par différence, jamais par remise à zéro. Il est
   * exact parce que cette reconstruction et ses appels git sont séquentiels dans
   * le même processus, sans autre producteur git en vol pendant la fenêtre. Le bail dit qu'aucune autre session n'agit sur ce run ; il ne dit
   * rien de ce processus-ci, et c'est la synchronie qui tient la mesure.
   */
  const debut = performance.now();
  const sondesAvant = readGitInvocationCount();
  reconstruireSousMesure();
  LAST_SCAN = {
    recovery_scan_ms: performance.now() - debut,
    git_probe_count: readGitInvocationCount() - sondesAvant,
  };
}

function reconstruireSousMesure(): void {
  const laneRead = readLaneEvents(RUN_DIR, RUN_ID);
  /*
   * L'observation est partagée avec `bin/subagent-recover` : un opérateur et un
   * runtime qui regardent le même disque doivent en conclure le même état. Ils
   * ne le faisaient pas — l'outil n'a jamais reçu `confirmedCommits`, et la
   * divergence a vécu tout 3c.1 sans être visible.
   *
   * Le même `laneRead` part ensuite aux tentatives : une reconstruction ne
   * mélange pas deux lectures d'un fichier que quelqu'un peut écrire entre les
   * deux.
   */
  const vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead });

  RECOVERY_MALFORMED = laneRead.malformedLines;
  RECOVERY_LEDGER_VERSION = laneRead.version;

  if (!vu.usable) {
    // Registre partiel : aucun bilan. Les caches sont vidés plutôt que laissés
    // sur une vue périmée, et la porte se ferme sur la raison.
    OPEN_UNITS.clear();
    INTEGRATED.clear();
    ATTEMPTS.clear();
    RECOVERY_CONFLICTS = new Map();
    INTEGRATION_CONFLICTS = [];
    RECOVERY_NOTE = vu.reason;
    // Les snapshots aussi : un relevé bâti sur la vue précédente parlerait d'un
    // disque qu'on vient justement de renoncer à lire.
    LAST_LANES = undefined;
    LAST_INTEGRATIONS = undefined;
    return;
  }

  LAST_LANES = vu.snapshot;
  const bilan = vu.snapshot.reconciliation;
  OPEN_UNITS.clear();
  for (const u of bilan.openUnits) OPEN_UNITS.add(u);
  INTEGRATED.clear();
  for (const u of bilan.integrated) INTEGRATED.add(u);
  RECOVERY_CONFLICTS = bilan.conflicts;

  const lignes = [describeConflicts(bilan.conflicts)];
  // Le ménage se dit sans fermer le run : le signaler évite qu'il s'accumule
  // sans que personne ne sache qu'il est là.
  for (const w of bilan.warnings) lignes.push(`à ranger : ${w.detail}`);
  reconstruireTentatives(lignes, laneRead);
  RECOVERY_NOTE = lignes.filter(Boolean).join("\n");
}

/**
 * Reconstruit les tentatives d'intégration : le registre croisé au disque.
 *
 * Sans elle, tout ce qui précède serait un excellent registre que `ATTEMPTS`
 * continuerait de ne jamais relire. Une session reprise oubliait qu'une unité
 * était bloquée pendant que son contexte restait là : la politique ne savait
 * plus qu'elle devait refuser, et un contexte sans provenance passait inaperçu.
 *
 * La collecte elle-même est dans `integration-observe.ts`, partagée avec
 * `bin/subagent-recover` : un opérateur et un runtime qui regardent le même
 * disque doivent en conclure le même état. Le snapshot du registre des lanes lui
 * est passé, jamais relu — deux lectures peuvent tomber de part et d'autre d'une
 * écriture.
 */
function reconstruireTentatives(lignes: string[], laneRead: LaneRead): void {
  const vu = observeIntegrations({
    root: process.cwd(),
    runDir: RUN_DIR,
    runId: RUN_ID,
    laneRead,
  });

  if (!vu.usable) {
    ATTEMPTS.clear();
    INTEGRATION_CONFLICTS = [{ kind: "journal-illisible", detail: vu.reason }];
    lignes.push(describeIntegrationConflicts(INTEGRATION_CONFLICTS));
    LAST_INTEGRATIONS = undefined;
    return;
  }

  LAST_INTEGRATIONS = vu.snapshot;
  const { facts, reconciliation: bilan } = vu.snapshot;
  ATTEMPTS.clear();
  for (const [unit, { id, phase }] of bilan.phases) {
    const a = facts.get(id);
    if (!a) continue;
    ATTEMPTS.set(unit, {
      attempt: {
        dir: join(integrationsDir(process.cwd()), id),
        id,
        p1: a.p1,
        p2: a.p2,
        clean: a.conflicts.length === 0,
        conflicts: [...a.conflicts],
      },
      phase,
      landing: a.committed
        ? { commit: a.committed.commit, tree: a.committed.tree, p1: a.p1, p2: a.p2 }
        : undefined,
    });
  }
  for (const u of bilan.integrated) INTEGRATED.add(u);

  INTEGRATION_CONFLICTS = bilan.conflicts;
  if (bilan.conflicts.length > 0) lignes.push(describeIntegrationConflicts(bilan.conflicts));
  for (const w of bilan.warnings) lignes.push(`à ranger : ${w}`);
  for (const id of bilan.residues) lignes.push(`à ranger : contexte ${id} terminé mais présent`);
}


/**
 * Le plan gelé, relu depuis le disque à la première délégation qui en a besoin.
 *
 * Relu et non mémorisé au chargement de l'extension : l'orchestrateur écrit son
 * plan pendant la session, donc il n'existe pas encore quand l'extension
 * démarre. Mémorisé après la première lecture réussie, parce que le plan est
 * gelé — le relire à chaque appel inviterait à le corriger en cours de route,
 * et une prédiction réécrite après coup ne mesure plus rien.
 */
let PLAN: PlanResult | undefined;
/** Le texte du plan, gardé pour l'attacher au run une fois la propriété prise. */
let PLAN_TEXT: string | undefined;

function plan(): PlanResult {
  if (PLAN?.status === "usable") return PLAN;
  const path = join(process.cwd(), RUNS_DIR, `${RUN_ID}-plan.json`);
  let text: string | undefined;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    text = undefined;
  }
  PLAN = parsePlan(text);
  PLAN_TEXT = text;
  /*
   * C6.1 au gel du plan (PLAN-LOT8 Q11) : chaque `design_update` se juge ici, avant tout
   * `attachPlan` et avant tout spawn lié à une unité, contre la grammaire de C0 v1.9.
   * Invalide, le plan entier l'est : il se corrige tant que rien n'a commencé, comme tout
   * plan invalide, et rien n'est écrit — ni événement, ni lane, ni commit, ni DESIGN.md.
   */
  if (PLAN.status === "usable" && text !== undefined) {
    const racineBundle = bundleRoot(process.cwd());
    let design: string | undefined;
    if (racineBundle !== null) {
      try {
        design = readFileSync(join(racineBundle, "DESIGN.md"), "utf-8");
      } catch {
        design = undefined;
      }
    }
    const verdict = validerDesignUpdates(JSON.parse(text), { bundle: racineBundle !== null, design });
    if (!verdict.ok) {
      PLAN = { ...PLAN, status: "invalid", reason: `design_update : ${verdict.reason}`, units: [] };
    }
  }
  // Le signal « chemin réservé déclaré dans un scope » appartient au plan et non
  // au registre de risques : le relevé lit le même plan avec les mêmes règles et
  // le rend visible lui-même. Le journaliser ici l'aurait rangé dans un fichier
  // dont ce n'est pas le sujet, sous un type d'événement qui ne le décrit pas.
  return PLAN;
}

/**
 * The ledger's transitions, on disk, one JSON object per line.
 *
 * Append-only at each transition rather than a final snapshot, because the
 * interesting states are the ones a snapshot cannot show: a risk that went
 * `open → routed → open` was worked on and not settled, and the record of the
 * attempt is the point. The external reading folds the file back.
 */
function logLedger(runId: string, events: readonly LedgerEvent[]): void {
  if (events.length === 0) return;
  try {
    mkdirSync(join(process.cwd(), RUNS_DIR), { recursive: true });
    appendFileSync(
      join(process.cwd(), RUNS_DIR, `${runId}-risks.jsonl`),
      events.map((e) => JSON.stringify({ at: new Date().toISOString(), ...e })).join("\n") + "\n",
      "utf-8",
    );
  } catch {
    // A ledger that cannot journal still holds its state for this session.
  }
}

/**
 * One line per child, joining what the plan predicted to what actually ran.
 *
 * Nothing else on disk can answer that. The artefact holds the role, the task
 * text and the changed files, but not the `work_unit` the orchestrator declared
 * — that lives in the tool call, and reconstructing it from the orchestrator's
 * own session log means parsing a transcript to recover a field this process
 * had in hand. `HISTORY` holds it in memory and dies with the session.
 *
 * The shape is deliberately flat and the file is deliberately per-run: the
 * external reading joins it to `<runId>-plan.json` on `work_unit` and to the
 * artefacts on `artifact`.
 */
interface DelegationRecord {
  seq: number;
  batch: string;
  role: string;
  /** L'unité visée, déclarée ou dérivée des risques confiés. */
  work_unit: string | null;
  /**
   * Ce que l'orchestrateur avait déclaré, quand il l'a fait.
   *
   * Gardé à côté de l'unité résolue pour que le relevé distingue une annotation
   * portée d'une annotation dérivée. Les 38 % non attribués du run 15 étaient
   * des reviewers et des scouts ; savoir combien le runtime a rattachés seul
   * est la mesure de ce que ce lot corrige.
   */
  work_unit_declared: string | null;
  lane_id: string | null;
  cwd: string;
  /** Chemins réservés réellement écrits. Violation, pas dépassement de scope. */
  reserved_touched: string[];
  /** Unité visée mais absente du plan gelé. */
  unplanned: boolean;
  for_risks: string[];
  produced: boolean;
  read_only: boolean;
  changed_files: string[];
  artifact: string;
  failure: string | null;
}

function logDelegations(runId: string, rows: readonly DelegationRecord[]): void {
  if (rows.length === 0) return;
  try {
    mkdirSync(join(process.cwd(), RUNS_DIR), { recursive: true });
    appendFileSync(
      join(process.cwd(), RUNS_DIR, `${runId}-delegations.jsonl`),
      rows.map((r) => JSON.stringify({ at: new Date().toISOString(), ...r })).join("\n") + "\n",
      "utf-8",
    );
  } catch {
    // Losing the join table costs the shadow metrics, not the run.
  }
}

/**
 * The continuation risks, injected ahead of the diff.
 *
 * `for_risks` is a carrier, not a declaration: the orchestrator names the ids
 * and the runtime pastes the texts it already holds, so the concerns cannot be
 * paraphrased on the way through and the orchestrator does not spend a turn
 * retyping them. An id the ledger does not know is dropped here and journalled
 * by the transition — the review is not told about a risk nobody can produce.
 */
function continuationSection(ids: readonly string[], ledger: readonly RiskRecord[]): string {
  const known = ids
    .map((id) => ledger.find((r) => r.id === id))
    .filter((r): r is RiskRecord => r !== undefined);
  if (known.length === 0) return "";
  return (
    "Continuation risks — raised by an earlier review of this same change and\n" +
    "handed back to you to settle. These, and only these:\n\n" +
    known.map((r) => `${r.id}  ${r.text}`).join("\n") +
    "\n\nCopy into `resolved_risks` the ids you can now settle. Leave out the ones you\n" +
    "cannot: they stay open under these ids, and restating them in `open_risks`\n" +
    "would open a second record of the same concern.\n\n"
  );
}

/**
 * A role that cannot change a file.
 *
 * Derived from the tool list rather than named, so a role added later is
 * classified by what it can do rather than by having been remembered here.
 * `bash` does not count as mutation: the scout has it, and what stops it
 * mutating is its prompt, not this function.
 */
function isReadOnly(tools: readonly string[]): boolean {
  return !tools.includes("edit") && !tools.includes("write");
}

/**
 * The scout's input contract, checked before anything is spawned.
 *
 * Every role has had a validated output contract since `submit` became a tool,
 * and the output side has not failed since — the one problem it did have,
 * required fields the model omitted, was found and fixed in the schema. The
 * input side was one free string, and every measured defect of six runs landed
 * there: a data file never named and a schema invented against it; a "final
 * completeness inventory" that cost 112,683 tokens and returned nothing; a scout
 * sent to inventory a repository containing only its bundle; four
 * reconciliations that reached the ceiling across two Balance Agee runs. Each
 * was corrected with prose, and prose is read or it is not.
 *
 * `find` takes one question, `scope` takes the paths. That is the whole
 * contract, and it is enough for the failure it addresses: "check that every .py
 * file appears in the modules section" has no single question to put in `find`,
 * so it has to be written as two lookups or as one named location — which is
 * what it should have been. The scout first, because five of the six defects are
 * its own and it is the cheapest role to be wrong about.
 */
const WHOLE_REPO = new Set([".", "./", "/", "*", "**", "**/*", ""]);

const MAX_PARALLEL_SCOUTS = 4;

/** One question, or several to run at once. Always an array from here on. */
function scoutQuestions(find: string | string[] | undefined): string[] {
  return (Array.isArray(find) ? find : [find ?? ""]).map((q) => q.trim()).filter(Boolean);
}

function checkScoutInput(params: { find?: string | string[]; scope?: string[] }): string | null {
  const questions = scoutQuestions(params.find);
  const find = questions[0] ?? "";
  const scope = (params.scope ?? []).map((p) => p.trim()).filter(Boolean);

  if (questions.length > MAX_PARALLEL_SCOUTS) {
    return (
      `Refused: ${questions.length} questions at once. Four is the ceiling — past that the ` +
      "answers arrive faster than they can be read, and a fan-out nobody reads is a fan-out " +
      "nobody needed. Ask the four that matter."
    );
  }

  /*
   * The bootstrap, which the contract created and did not answer.
   *
   * `scope` is required and the repository as a whole is not one, so on a
   * project nobody has described — the free regime, which no run has yet
   * exercised — the first reconnaissance needs to know a subtree before doing
   * the search meant to find it. The contract made that a silent refusal loop.
   * It is now a named step: list the root inline, scope to what comes back. An
   * `ls` on a path you name is yours to make and costs one call.
   */
  if (find && scope.length > 0 && scope.every((p) => WHOLE_REPO.has(p))) {
    return (
      "Refused: the repository as a whole is not a scope. If you do not yet know where to " +
      "look, that is not a scout question — list the root yourself with `ls`, then scope " +
      "this call to the directories it returns. One inline call, and the scout gets a " +
      "territory instead of a tree."
    );
  }

  if (find && scope.length > 0) return null;

  const missing = [!find ? "`find`" : "", scope.length === 0 ? "`scope`" : ""].filter(Boolean);
  return (
    `Refused: a scout call needs ${missing.join(" and ")}. \`find\` is the single thing to ` +
    "locate, as one question — where X is defined, who calls Y, which module owns Z. " +
    "`scope` is the paths to search — if you do not know them yet, list the root inline " +
    "first. If the question is a comparison between two sets, it is two scouts and a " +
    "subtraction you do yourself: ask for each list, compare them here."
  );
}

/**
 * `view` est la séquence que les trois règles lisent : `HISTORY` entier pour les rôles
 * globaux et le régime libre, la vue de C1 (`vueDeRevue`) pour un rôle lié à une lane en
 * régime planifié (C1.7). Dans cette vue, une globale readOnly ne compte pas comme une
 * écriture et ne crée ni ne prolonge le streak d'un reviewer de la lane.
 */
function refuse(
  agentName: string,
  tools: readonly string[],
  view: readonly Delegation[] = HISTORY,
  arbreChange = false,
): string | null {
  const last = view[view.length - 1];
  const before = view[view.length - 2];

  // Unconditional on the verdict: no worker has run, so not one line of code
  // differs. Reading the verdict would make the guard depend on an envelope
  // field being parsed correctly; this does not. The exception is a review
  // that returned nothing — refusing its replacement would trap the session —
  // and two failures in a row still stop, so the retry is bounded at one.
  //
  // One exception, and it is not the orchestrator's to claim: the lane's own tree has
  // changed since its last durable review (C2.1, PLAN-LOT8 Q8) — a commit hook rewrote
  // the files the approval was about. The approval is void and C2.4 calls for a new
  // review of the transformed tree. Read from the authoritative ledger, never from
  // memory; an unchanged tree keeps both rules below.
  if (
    agentName === "reviewer" &&
    !arbreChange &&
    last?.agent === "reviewer" &&
    (last.produced || before?.agent === "reviewer")
  ) {
    return (
      "Refused: a review already ran and no worker has run since. The code is " +
      "unchanged, so this review would read the same files and reach the same verdict. " +
      "If an item still needs work, delegate it to the worker. If every item has passed " +
      "its end criterion, the session is finished — say so and stop."
    );
  }

  // The same rule, one step further out: a worker that wrote nothing leaves the
  // tree exactly as the last review found it, so the review that follows it is
  // the same review. pi-subagents states the criterion as "run another review
  // round only when it made material changes"; changed_files is what makes it
  // computable rather than a judgement call.
  const sinceReview = [...view].reverse().findIndex((d) => d.agent === "reviewer");
  if (agentName === "reviewer" && !arbreChange && sinceReview > 0) {
    const between = view.slice(view.length - sinceReview);
    // A writer that wrote nothing leaves the tree as the last review found it.
    // A scout does too, and that is not the same thing: reviewer.md tells a
    // reviewer to put a where-question in `open_risks` and promises it "comes
    // back to you as named files in the next task", which is the sequence
    // reviewer → scout → reviewer. Refusing it on the grounds that no file
    // moved made that promise unkeepable — the scout changes what the next task
    // can name, which is the whole point of running it.
    const wroteNothing = between.some((d) => !d.readOnly) && between.every((d) => d.produced && d.changedFiles.length === 0);
    if (wroteNothing) {
      const roles = between.map((d) => d.agent).join(", ");
      return (
        `Refused: nothing has changed on disk since the last review (${roles} ran and ` +
        "reported no changed files). The review would read the same tree and reach the same " +
        "verdict. Act on the last review's findings, or declare the item done."
      );
    }
  }

  // Same role, not merely same innocuousness. "Cannot mutate" groups two things
  // that share only their harmlessness: a reviewer runs after work and a second
  // one reads the same code, while a scout runs before it and three scouts can
  // be three different questions. What ac451a actually showed was three
  // *identical* inventories — same role, back to back — and that is what this
  // counts. A scout following a reviewer is not a streak.
  //
  // Counted in *calls*, not children. A fan-out of four scouts writes four
  // HISTORY entries — which is honest, four children really ran — but it is one
  // decision by the orchestrator, and one reconnaissance turn. Counting the
  // children made the guard refuse the very next scout after a two-question
  // fan-out, including one whose question came out of a `gaps` the fan-out
  // itself reported. The mechanism meant to stop three unread inventories would
  // have punished the batching this batch exists to encourage.
  const streak = streakOf([...view], agentName);
  if (isReadOnly(tools) && streak >= 2) {
    return (
      `Refused: ${streak} ${agentName} delegations already ran back to back, and the role ` +
      "cannot change a file. A third gathers information that nothing has acted on. Act on " +
      "what you have — delegate to the worker, answer the operator, or declare the backlog " +
      "complete."
    );
  }

  return null;
}

/**
 * The change a review is about to judge, as a diff.
 *
 * A reviewer that receives paths has no definition of "the change": it cannot
 * tell what was just written from what was already there, so it reads
 * everything and re-judges everything. Measured across three runs — 22k tokens
 * ingested per review on a 271-line project — and it is the reason the six
 * admission criteria in reviewer.md are worth writing at all: "introduced in
 * patch" has no meaning without a patch boundary.
 *
 * `git diff HEAD~1` is not usable here. Workers never commit, and a bundle repo
 * has a single commit, so HEAD~1 fails and the fallback returns everything since
 * the bundle — growing with each deliverable. The boundary that is actually
 * correct is the previous worker's own `changed_files`.
 */
/*
 * The inline threshold, and why it moved.
 *
 * It was 32,000 characters — about 8k tokens, the weight of csv-to-bq's whole
 * frozen bundle, which is what it was calibrated against. On an eleven-module
 * project it is the most expensive number in the chain. Measured across two
 * Balance Agee runs, the four reviews that crossed it ran 7, 5, 7 and 11 turns
 * against a median of four, and the two of run 4 order monotonically with size:
 * 38 kB gave seven turns, 71 kB gave eleven.
 *
 * The arithmetic is not close. A reviewer runs at 48,328 tokens per turn, so the
 * 11-turn review cost about 531,000 tokens; inlining its diff would have added
 * 17,750 written once. Reading twelve whole files to reconstruct 71 kB of
 * changes necessarily costs more than the 71 kB.
 *
 * 80,000 rather than 64,000 because 64,000 converts only one of the two observed
 * cases, and a threshold that leaves the worst one degraded fixes the cheaper
 * half of the problem. 20k tokens of diff still sits well under what a review
 * already carries per turn.
 */
const DIFF_MAX_CHARS = 80_000;
const DIFF_MAX_FILES = 15;

function gitDiffFor(paths: string[], cwd: string): string {
  const run = (args: string[]): string => {
    try {
      recordGitInvocation();
      return execFileSync("git", args, {
        cwd,
        encoding: "utf-8",
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (err) {
      // `git diff --no-index` exits 1 when the files differ, which is the
      // normal case for a new file. The output is on stdout either way.
      const out = (err as { stdout?: string })?.stdout;
      return typeof out === "string" ? out : "";
    }
  };

  const chunks: string[] = [];
  for (const path of paths) {
    let tracked = true;
    try {
      recordGitInvocation();
      execFileSync("git", ["ls-files", "--error-unmatch", "--", path], {
        cwd,
        stdio: "ignore",
      });
    } catch {
      tracked = false;
    }
    // An untracked file has no diff against HEAD. --no-index against /dev/null
    // produces the new-file diff git would have produced, without touching the
    // index — `git add -N` would work too and would mutate state the worker owns.
    const out = tracked ? run(["diff", "HEAD", "--", path]) : run(["diff", "--no-index", "--", "/dev/null", path]);
    if (out.trim()) chunks.push(out.trimEnd());
  }
  return chunks.join("\n");
}

/**
 * Every path written since the last review, oldest first.
 *
 * Not "whatever wrote last". `f0797e` ran `worker, worker, reviewer`, where the
 * last-writer rule would have shown the review only the second worker's files;
 * and since inline writes are recorded, an orchestrator marking `DESIGN.md`
 * implemented between a worker and its review would have shadowed the code
 * entirely, handing the reviewer a diff of a status field. Neither had bitten
 * yet, which is the only reason this is a correction and not an incident.
 */
/**
 * `\uXXXX` sequences that survived as literal text, turned back into characters.
 *
 * A child writing JSON sometimes escapes a character its own encoder would have
 * passed through, and that escape is then embedded as a string value in the
 * envelope: parsing yields the six characters rather than the one. Measured on
 * the advisor's first invocation, where every em-dash of the recommendation
 * reached the operator as `\u2014` — in the one field written to be read by a
 * human, which is the one place it matters.
 */
function decodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Files the open review covers.
 *
 * The state machine lives in `subagent-only/review-boundary.ts`, a leaf module
 * the tests call directly. Kept as a wrapper here so the call sites read the
 * same as before and `HISTORY` stays the single source.
 */
function changedSinceLastReview(view: Delegation[]): string[] {
  return openReviewBoundary(view);
}

/**
 * Files a machine wrote and no reviewer can read.
 *
 * Measured on the first Balance Agee run: a review was handed "diff too large to
 * inline at 179kB" over four files, one of which was `uv.lock`. Nearly all of
 * that weight was the lockfile; without it the diff would have fitted, and the
 * review would have had the change in hand instead of a reading list. A
 * generated file still deserves to be named — a dependency bump is a change —
 * but naming it costs a line where diffing it costs the budget.
 */
const GENERATED =
  /(^|\/)(uv\.lock|poetry\.lock|Cargo\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|composer\.lock|Gemfile\.lock)$|\.min\.(js|css)$|\.(snap|lock)$/i;

export interface DiffPackage {
  /** What goes into the task text. Empty when there is nothing to show. */
  text: string;
  /** True when the reviewer must find the change itself. */
  degraded: boolean;
  /** Size of the inlined diff, when one was inlined. The budget follows it. */
  diffChars?: number;
  /**
   * Ce que le reviewer a réellement reçu (C2.3) : un diff, une liste de lecture, ou rien.
   * Lu de la construction du paquet, jamais de la réponse du reviewer. Une liste de
   * fichiers générés seuls n'est pas une preuve : leur contenu n'a été ni montré ni
   * désigné à la lecture.
   */
  proof: { mode: ProofMode; paths?: string[] };
}

const SANS_PREUVE = { mode: "none" as const };

/** Des chemins canoniques de § F : triés, uniques. */
const trierChemins = (paths: readonly string[]): string[] => [...new Set(paths)].sort();

function diffSection(paths: string[], cwd: string): DiffPackage {
  const all = paths.filter(Boolean);
  if (all.length === 0) return { text: "", degraded: false, proof: SANS_PREUVE };

  const files = all.filter((f) => !GENERATED.test(f));
  const generated = all.filter((f) => GENERATED.test(f));
  const alsoChanged = generated.length
    ? `Also changed, generated, not diffed: ${generated.join(", ")}.\n\n`
    : "";

  const readingList = (why: string): DiffPackage => ({
    text:
      `Changed files (${files.length}, ${why}):\n` +
      files.map((f) => `  - ${f}`).join("\n") +
      "\n\nNo diff is inlined for this review: read these files and find the change " +
      "yourself. You have grep and find for this delegation, and more turns than usual.\n\n" +
      alsoChanged,
    degraded: true,
    proof: { mode: "reading-list", paths: trierChemins(files) },
  });

  if (files.length === 0) return { text: alsoChanged, degraded: false, proof: SANS_PREUVE };
  if (files.length > DIFF_MAX_FILES) return readingList("too many to inline");

  const diff = gitDiffFor(files, cwd);
  if (!diff.trim()) return { text: alsoChanged, degraded: false, proof: SANS_PREUVE };
  if (diff.length > DIFF_MAX_CHARS) {
    return readingList(`diff too large to inline at ${Math.round(diff.length / 1000)}kB`);
  }

  return {
    text:
      "The change under review, as a diff. Do not reconstruct it — it is here.\n" +
      "You may read any file for context, including files this diff does not touch;\n" +
      "judge only what the diff introduced.\n\n" +
      `<diff>\n${diff}\n</diff>\n\n` +
      alsoChanged,
    degraded: false,
    diffChars: diff.length,
    proof: { mode: "diff", paths: trierChemins(files) },
  };
}

/**
 * Le paquet d'une revue de lane (D3 et D1, PLAN-LOT6 § 3).
 *
 * La frontière `HISTORY` est un contexte, pas une borne de preuve. Un worker dont le bail
 * s'est perdu a pu écrire dans la lane sans laisser de trace en mémoire, et une revue
 * rechargée n'a plus de mémoire du tout. Ce que le reviewer doit recevoir est donc le
 * delta Git ENTIER du dernier tree revu durablement (sinon la base) jusqu'au T_L observé
 * maintenant : ajouts, modifications, suppressions, modes, types et liens. Il se lit de
 * deux trees, jamais du registre ni de la mémoire, et jamais contre la base à la place
 * du dernier tree revu.
 *
 * Toute panne git, tout résultat incohérent — des chemins sans patch, des trees
 * différents sans chemin — est une observation inconnue : refus avant la délégation,
 * jamais un paquet partiel étiqueté `diff`. Un fichier généré dans le delta rend ce
 * maillon `none` : la politique actuelle ne le montre pas et n'en fournit aucune lecture.
 *
 * Un chemin revenu à la base (D1) est vérifié par l'entrée de tree exacte, et annoncé ;
 * sa preuve est le patch inverse qui figure dans le delta, pas l'annonce.
 */
type PaquetDeLane =
  | { ok: true; pkg: DiffPackage; fromTree: string; tree: string }
  | { ok: false; raison: string };

function paquetDeLane(frontiere: readonly string[], lane: LaneContext): PaquetDeLane {
  let tl: string;
  let fromTree: string;
  let cheminsDuDelta: string[];
  const restaures: string[] = [];
  try {
    // Un seul snapshot autoritaire : la lecture, sa qualification et ses projections. Un
    // registre lisible mais UNKNOWN refuse ici, avant que le reviewer ne parte (D3).
    const lu = readLaneEvents(RUN_DIR, RUN_ID);
    const laneRead = { ...lu, version: lu.version };
    const vu = observeLanes({ root: process.cwd(), runId: RUN_ID, laneRead });
    if (!vu.usable) {
      throw new Error(
        `le registre des lanes est inexploitable (${vu.state}) : ${vu.reason}`,
      );
    }
    const base = baseDeLane(vu.snapshot.read.events, lane.laneId);
    if (base === undefined) {
      throw new Error(`aucune ouverture enregistrée pour ${lane.laneId}`);
    }
    const baseTree = treeOfCommit(process.cwd(), base);
    fromTree =
      vu.snapshot.projections.reviews.get(lane.laneId)?.at(-1)?.tree ??
      baseTree;
    tl = workingTree(lane.cwd);
    cheminsDuDelta = pathsBetweenTrees(process.cwd(), fromTree, tl);
    for (const f of cheminsDuDelta) {
      if (pathIdenticalBetweenTrees(process.cwd(), baseTree, tl, f)) restaures.push(f);
    }
  } catch (err) {
    return { ok: false, raison: err instanceof Error ? err.message : String(err) };
  }
  if (cheminsDuDelta.length === 0) {
    if (fromTree === tl) {
      return { ok: true, fromTree, tree: tl, pkg: { text: "", degraded: false, proof: SANS_PREUVE } };
    }
    return {
      ok: false,
      raison: `les trees ${fromTree.slice(0, 12)} et ${tl.slice(0, 12)} diffèrent sans aucun chemin de delta`,
    };
  }

  // D3 : tout le delta, jamais la seule frontière en mémoire.
  const delta = cheminsDuDelta;
  // D1 : les chemins rétablis en font partie ; leur patch inverse est leur preuve.
  const montres = [...delta];
  const generes = montres.filter((f) => GENERATED.test(f));
  const lisibles = montres.filter((f) => !GENERATED.test(f));
  if (lisibles.length === 0) {
    return {
      ok: true,
      fromTree,
      tree: tl,
      pkg: { text: `Changed, generated, not diffed: ${generes.join(", ")}.\n\n`, degraded: false, proof: SANS_PREUVE },
    };
  }

  let patch: string;
  try {
    patch = deltaBetweenTrees(process.cwd(), fromTree, tl, lisibles);
  } catch (err) {
    return { ok: false, raison: err instanceof Error ? err.message : String(err) };
  }
  if (!patch.trim()) {
    return {
      ok: false,
      raison: `les chemins ${lisibles.join(", ")} diffèrent entre ${fromTree.slice(0, 12)} et ` +
        `${tl.slice(0, 12)}, et leur patch est vide`,
    };
  }

  const annonce = restaures.length > 0
    ? `Changed since the last review and now identical to the base: ${restaures.join(", ")}.\n\n`
    : "";
  const aussi = generes.length > 0 ? `Also changed, generated, not diffed: ${generes.join(", ")}.\n\n` : "";
  // La frontière n'est qu'un contexte : ce qu'elle ne nomme pas est montré quand même, et
  // signalé, parce qu'aucune délégation de cette session n'en rend compte.
  const horsFrontiere = delta.filter((f) => !frontiere.includes(f));
  const aussiHors = horsFrontiere.length > 0 && frontiere.length > 0
    ? `Changed outside the delegations recorded in this session: ${horsFrontiere.join(", ")}.\n\n`
    : "";
  // Un fichier généré n'est ni montré ni lu : ce maillon n'a pas de preuve complète.
  const preuveComplete = generes.length === 0;

  if (lisibles.length > DIFF_MAX_FILES || patch.length > DIFF_MAX_CHARS) {
    const pourquoi = lisibles.length > DIFF_MAX_FILES
      ? "too many to inline"
      : `diff too large to inline at ${Math.round(patch.length / 1000)}kB`;
    return {
      ok: true,
      fromTree,
      tree: tl,
      pkg: {
        text:
          `Changed files since the last review (${lisibles.length}, ${pourquoi}):\n` +
          lisibles.map((f) => `  - ${f}`).join("\n") + "\n\n" + annonce + aussiHors + aussi +
          "No diff is inlined for this review. Every file above changed between the last " +
          `reviewed tree ${fromTree} and the tree under review ${tl}; both are git objects. ` +
          `Read each change with \`git diff ${fromTree} ${tl} -- <path>\`, and a previous ` +
          `version, deleted files included, with \`git show ${fromTree}:<path>\`. You have grep ` +
          "and find for this delegation, and more turns than usual.\n\n",
        degraded: true,
        proof: preuveComplete ? { mode: "reading-list", paths: trierChemins(lisibles) } : SANS_PREUVE,
      },
    };
  }
  return {
    ok: true,
    fromTree,
    tree: tl,
    pkg: {
      text:
        "The change under review, as a diff from the last reviewed tree. Do not reconstruct it — " +
        "it is here.\nYou may read any file for context, including files this diff does not " +
        "touch;\njudge only what the diff introduced.\n\n" + annonce + aussiHors +
        `<diff>\n${patch.trimEnd()}\n</diff>\n\n` + aussi,
      degraded: false,
      diffChars: patch.length,
      proof: preuveComplete ? { mode: "diff", paths: trierChemins(lisibles) } : SANS_PREUVE,
    },
  };
}

/**
 * Refusals, on disk, next to the artefacts.
 *
 * A refusal returns and does not write, so after run `f0797e` there was no way
 * to tell whether the guard had fired or simply never needed to. An empty file
 * is a measurement; a missing file is a supposition.
 */
function logRefusal(runId: string, agentName: string, reason: string): void {
  try {
    const dir = join(process.cwd(), RUNS_DIR);
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, `${runId}-refusals.jsonl`),
      JSON.stringify({
        at: new Date().toISOString(),
        refused: agentName,
        reason,
        history: HISTORY.map((d) => ({ agent: d.agent, changed: d.changedFiles.length })),
      }) + "\n",
      "utf-8",
    );
  } catch {
    // A guard that cannot journal still guards.
  }
}

reconstruire();

/**
 * Le relevé, depuis la session.
 *
 * Il commence par reconstruire — mais par le chemin partagé, celui-là même que
 * la reprise emprunte, pas par une collecte à lui. La contrainte n'est pas « ne
 * rien relire », c'est « ne rien reconstruire d'indépendant » : un relevé bâti
 * sur des snapshots vieux de vingt délégations dirait un disque qui n'existe
 * plus, et un relevé bâti sur sa propre collecte dirait un état que le runtime
 * n'a jamais eu. Reconstruire par `reconstruire()` évite les deux.
 *
 * Il ne mute rien et ne prend pas le bail : observer n'exige pas la propriété,
 * ici comme pour `bin/subagent-recover cleanup` sans `--apply`.
 */
function releveDuRun(): { ok: true; texte: string } | { ok: false; raison: string } {
  reconstruire();
  const manifeste = readManifest(RUN_DIR);
  if (!manifeste) return { ok: false, raison: `aucun run dans ${RUNS_DIR}/` };
  if (!LAST_LANES) {
    return {
      ok: false,
      raison: RECOVERY_NOTE || "le registre des lanes est inexploitable : aucun relevé.",
    };
  }
  const plan = planCleanup(LAST_LANES.reconciliation, LAST_INTEGRATIONS?.reconciliation);
  return {
    ok: true,
    texte: formatRunReport(
      buildRunReport(
        { runId: manifeste.runId, status: manifeste.status },
        LAST_LANES,
        LAST_INTEGRATIONS,
        plan,
        LAST_SCAN,
      ),
    ),
  };
}

export default function (pi: ExtensionAPI) {
  const agents = loadAgents(join(SELF_DIR, "agents"));

  pi.registerCommand("subagent-report", {
    description: "Relevé terminal du run : unités, résidus, ce qui est rangeable, coût du scan",
    handler: async (_args: unknown, ctx: { ui: { notify: (t: string, k?: string) => void } }) => {
      const releve = releveDuRun();
      ctx.ui.notify(releve.ok ? releve.texte : releve.raison, releve.ok ? "info" : "error");
    },
  });

  // The UI context is only handed out with an event or a call. Capture it at
  // session_start so the dispatch loop can publish progress without one.
  let ui: { setStatus?: (k: string, v: string) => void } | undefined;
  pi.on("session_start", async (_event, ctx) => {
    ui = ctx.ui;
    RUN_UI = ctx.ui;
    // L'état du run est visible dès le chargement : une session qui découvre un
    // dépôt occupé doit le savoir sans avoir à provoquer un refus.
    publishRun();
  });

  /**
   * The orchestrator's own writes, recorded as if they were a delegation.
   *
   * Measured on run `adee82`: the orchestrator wrote seven modules and made two
   * edits itself, then delegated one worker and one review. The review returned
   * `needs_rework`, the fix was made inline, and no second review ran — it could
   * not have. `HISTORY` only ever saw delegations, so after that review the
   * guard's first rule fired unconditionally, and a review that had run would
   * have been handed no diff, `lastWrite` finding no delegation with changed
   * files. The guard was rewarding the bypass: the more the orchestrator wrote
   * itself, the less its work could be reviewed.
   *
   * This does not forbid anything. It makes an inline write count as what it is
   * — a material change to the tree — so the material-change rule stays true,
   * the next review gets its diff, and the refusal log shows who wrote what.
   */
  /*
   * La sortie propre : le bail disparaît, le run reste ce qu'il est.
   *
   * `session_shutdown` et non `agent_end` : le second se produit à la fin de
   * chaque prompt, et relâcher le bail entre deux interactions laisserait le run
   * ouvert à une autre session alors que celle-ci travaille encore. Il couvre
   * aussi `/new`, `/resume` et `/fork`, où la session change sans que le
   * processus s'arrête.
   *
   * Aucun écouteur `process` ajouté ici : ils interféreraient avec le cycle de
   * vie de pi. Une sortie qui ne passerait pas par cet événement laisse un bail
   * qui deviendra périmé, ce qui est le comportement prévu pour les sorties non
   * propres.
   */
  pi.on("session_shutdown", async () => {
    // Abandonner d'abord, libérer ensuite. Pi appelle normalement ce hook dans
    // un état au repos, mais l'invariant ne doit pas dépendre de cette
    // hypothèse : on ne relâche jamais volontairement la capacité en laissant
    // un enfant qui s'en sert continuer.
    LEASE_ABORT.abort(new Error("session_shutdown"));
    HEARTBEAT?.stop();
    HEARTBEAT = undefined;
    if (LEASE) releaseRunOwnership(RUN_DIR, LEASE);
    LEASE = undefined;
    publishRun();
  });

  pi.on("tool_call", async (event) => {
    const path =
      isToolCallEventType("write", event) || isToolCallEventType("edit", event)
        ? (event.input as { path?: string })?.path
        : undefined;
    if (!path) return undefined;

    /*
     * Instrumentation is not a material change.
     *
     * `HISTORY` has to reflect the orchestrator's own inline writes, or the
     * guards that read it stop being true. Two of them do: the free regime
     * reviews against `HISTORY` itself, and the refusal of a second review with
     * no work between — "a review already ran and no worker has run since" —
     * keys on its last entry. The shadow plan is written by the orchestrator's
     * own `write` into `.pi-subagent-runs/`, so without this filter it would
     * enter as a delegation that changed a file, and the plan itself would be
     * listed as part of the change under review. The directory is
     * instrumentation of the run, never its subject.
     *
     * An earlier version of this note also said such a write would open a new
     * boundary and discard the files the next review was owed. That was true of
     * a single global boundary and is no longer the whole picture: a planned
     * review reads `laneView(laneId)`, which filters on the lane, and an inline
     * write carries no `laneId` — so it does not reach a lane's diff. The
     * consequence stands for the free regime and for the guards that read
     * `HISTORY` whole, which is reason enough for the filter.
     */
    if (path.split(/[\\/]/).includes(RUNS_DIR)) return undefined;

    const last = HISTORY[HISTORY.length - 1];
    if (last?.agent === "orchestrator") {
      if (!last.changedFiles.includes(path)) last.changedFiles.push(path);
    } else {
      HISTORY.push({ agent: "orchestrator", batch: randomBytes(4).toString("hex"), produced: true, readOnly: false, changedFiles: [path] });
    }
    return undefined;
  });

  if (agents.size === 0) {
    // Loud, and only in the orchestrator's console: a delegation primitive
    // that registers nothing would look like a model refusing to delegate.
    console.error(`subagent: no agent definitions found in ${join(SELF_DIR, "agents")}`);
    return;
  }

  const names = [...agents.keys()];

  const parameters = Type.Object({
    agent: Type.Union(
      names.map((n) => Type.Literal(n)),
      { description: agentMenu(agents) },
    ),
    skills: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Domain skills to inject, by name — the domains the task touches, not " +
          "the ones the role usually needs. A .tf change wants iac-terraform, a " +
          "query wants sql-engineering or bigquery-engineering. Omit to give the " +
          "child none: no role declares a default today.",
      }),
    ),
    find: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
          "Scout only, and required for it. Holds one to four narrow " +
          "reconnaissance questions, each locating one thing — where X is " +
          "defined, who calls Y, which module owns Z. Never an exhaustive " +
          "inventory, never \"check that A matches B\": a comparison of two " +
          "states is two questions here and a subtraction you do yourself.\n\n" +
          "**Scout only when you cannot name a concrete location required to " +
          "formulate the next delegation.** Ask only for the missing location " +
          "that blocks that delegation. If several independently blocking " +
          "locations are already known to be missing, batch those that share a " +
          "`scope` — they run at once, each returning its own envelope, and " +
          "nothing is merged. Stop as soon as the next delegation can be " +
          "written. Do not scout for confirmation, completeness, possible " +
          "callers, or context that the next delegation does not require.\n\n" +
          "  find: [\n" +
          "    \"Where are the output roots defined?\",\n" +
          "    \"Where is each business cutoff date defined?\",\n" +
          "    \"Where are the checkpoint files written?\"\n" +
          "  ]\n" +
          "  scope: [\"src/\", \"conf/\"]\n\n" +
          "A bare string is accepted as shorthand when a single question is " +
          "all you know.",
      }),
    ),
    scope: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Scout only, and required for it: the paths to search, by directory or " +
          "file. The whole repository is not a scope. On a repository you have " +
          "not seen, list the root yourself first — one inline `ls`, which is a " +
          "named read and yours to make — and scope the scout to the directories " +
          "it returns.",
      }),
    ),
    for_risks: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Ids of open risks this call is meant to settle, copied exactly as they " +
          "appeared under a reviewer's head line — `9a6766-04-2`. On a scout it " +
          "records which risk the lookup was sent for. On a follow-up reviewer it " +
          "also carries: the runtime pastes each risk's text ahead of the diff, so " +
          "do not restate the concerns in `task`. A reviewer may only resolve ids " +
          "it was given here.",
      }),
    ),
    work_unit: Type.Optional(
      Type.String({
        description:
          `The id of the work unit this delegation belongs to, from ${RUNS_DIR}/${RUN_ID}-plan.json — ` +
          "`W03`. Name it on every delegation that belongs to one — worker, " +
          "reviewer, scout alike — and a rework carries the same id as the " +
          "attempt it repeats; the runtime derives the working directory and the " +
          "rest from it. A scout carrying `for_risks` may omit it: the risks " +
          "already say which unit they came from. If the work matches no unit in " +
          "the plan, give it a new id rather than the nearest one: the plan is " +
          "frozen, and work it did not predict is a result, not an error to tidy " +
          "away.",
      }),
    ),
    batch: Type.Optional(
      Type.Array(
        Type.Object({
          work_unit: Type.String({ description: "L'unité, comme dans `work_unit`." }),
          task: Type.String({ description: "L'instruction de cette unité, comme dans `task`." }),
        }),
        {
          description:
            "Plusieurs unités en un appel, chacune avec sa propre instruction — trois " +
            "unités ont trois tâches. Réservé au worker, et exclusif de `task`. Le " +
            "runtime vérifie l'admission de chaque candidate, ouvre une lane par unité " +
            "et en fait tourner au plus deux à la fois : une candidate dont les fichiers " +
            "recouvrent ceux d'une lane en cours attend son tour, elle n'est pas refusée. " +
            "Une candidate absente du plan, ou dont une dépendance n'est pas encore " +
            "intégrée, est refusée — c'est à toi de ne proposer que des unités prêtes. " +
            "Préfère des unités dont les fichiers ne se recouvrent pas : le runtime met " +
            "les autres en file sans risque, mais elles te coûteront un aller-retour. " +
            "N'envoie pas de scout pour le vérifier — le plan le dit déjà.",
        },
      ),
    ),
    task: Type.Optional(Type.String({
      description:
        "The complete instruction. The child inherits nothing: no AGENTS.md, no " +
        "conversation history, no prior tool calls. Describe the work, not the " +
        "output format — the envelope is imposed by the tool schema and does not " +
        "need to be requested.\n\n" +
        "Name every file the work depends on, by path. A child cannot see what " +
        "you have not named: asked to write a schema without being told which " +
        "data file it describes, it will invent one that is internally " +
        "consistent, passes its own tests, and does not match reality. That has " +
        "happened. Input data, configuration, fixtures, an existing module whose " +
        "interface must be honoured — name them.\n\n" +
        "Quote what the child cannot reach at all: anything from this " +
        "conversation, from a bundle file, from .pi/BRIEF.md, or stated anywhere " +
        "in the repository about the paths this task touches — AGENTS.md, " +
        "SECURITY.md, an ADR — must be pasted verbatim, not referred to.",
    })),
  });

  pi.registerTool(
    defineTool({
      name: "task",
      label: "Delegate to a subagent",
      description:
        "Run one scoped task in a fresh pi process with its own model, tools and " +
        "conventions. Returns a one-line summary; the full result is written to disk.",
      promptGuidelines: [
        "Before delegating, list the files the work depends on and name them in the task text. A schema written without the data file named will be invented.",
        "Searching across files for a bounded location is scout work: when the question is *where* rather than *what* and a bounded lookup can answer it, delegate it instead of grepping.",
        "Consistency within the change is reviewer work, not preflight scout work. Whether the change reached an unknown caller or pattern is scouted only when the reviewer returns that specific where-question in `open_risks`; do not scout it speculatively before the worker. And a question you can already answer is not scout work either — scouting a tree you have just read yourself returns what you gave it.",
        "When a reviewer result reports one or more `open-risks`, their text is printed under the head line, identified. Route an entry to scout only when a bounded lookup would settle it — a term, a file, a caller of a named symbol, a definition — and route it before any further mutation of the same change. An inventory, a completeness check, or a proof of absence that no exact bounded search can settle is not scoutable: leave that risk open rather than send someone to a ceiling. An absence with an exact target — a named symbol, a module path, a precise string — is scoutable, because one search concludes it. Preserve the reviewer's concern; do not broaden it and do not invent new ones. If its search target is too broad, narrow it only when the narrower lookup still settles the same review question; otherwise leave it open. If several routable risks from that review share a scope, batch them in one call. The scout's locations go into a follow-up review of the same open change, not to a worker: it is the review that was left open, and only a confirmed defect sends a worker. Carry the ids in `for_risks` on both calls — the follow-up review is handed the risk texts from them, and it can only close what it was handed.",
        "A scout locates facts answerable by an exact bounded search; it does not prove semantic completeness or repository-wide consistency. Do not turn an audit into several scout calls merely to fit the scout contract: an inventory split into three lookups is still an inventory, and three partial answers do not establish the concern they came from.",
        ...(PREFLIGHT.ok
          ? [
              `Before the first delegation of a session that will produce code, write a decomposition to ${RUNS_DIR}/${RUN_ID}-plan.json: {"version":1,"work_units":[{"id":"W01","goal":"...","depends_on":[],"expected_write_scope":["path",...]}]}. Decompose into the smallest set of coherent, independently reviewable execution units justified by the task and the context you already have. Correct dependency structure matters more than parallelism — do not decompose to maximise it. Declare a dependency conservatively when you are unsure. Writing this plan is not a reason to read or search anything you would not otherwise read, and it is never a reason to scout: a lookup made to decide whether one unit depends on another is the failure this plan is being measured for. Then leave it alone. It is a prediction, and rewriting it after seeing the execution measures nothing.`,
            ]
          : [
              /*
               * Le préflight a échoué, et la guideline normale dirait d'écrire
               * un plan sous le répertoire qui est précisément le problème —
               * avec un `runId` vide, puisque aucun run n'a été ouvert. Le
               * runtime n'écrit rien ; l'orchestrateur, lui, suit ses
               * instructions, et celle-là créerait `.pi-subagent-runs/-plan.json`
               * avant même le premier `task`. Refuser dans `execute` arrive
               * après.
               *
               * « Redémarrer » n'est pas une politesse : `PREFLIGHT` et `RUN`
               * sont établis au chargement, donc corriger l'exclusion en cours
               * de session ne réveille pas ce runtime.
               */
              `This repository is not ready for a run: ${RUNS_DIR}/ is not ignored by git, or files under it are tracked. Do not write anything under ${RUNS_DIR}/ — no plan, no scratch file. Delegation is refused until this is fixed. Add ${RUNS_DIR}/ to the repository's .gitignore, or to .git/info/exclude, then restart pi: this run's state was decided at load time and does not re-evaluate mid-session.`,
            ]),
        "Delegate when the task needs a different model, a context this session should not carry, or parallel read-only work.",
        "Do not delegate a one-line edit or a scratch file you could write inline. This never applies to a scout, nor to the code of an implementation deliverable — any code asked for as a result of the session, backlog item or not: both are delegated for what they are, not for how large they are.",
        "The child sees only the task text. Anything implicit here is absent there — a project AGENTS.md, a SECURITY.md, a CONTRIBUTING.md, an ADR, a comment in a config file. Not a list to check off: any constraint the repository states about the paths this task touches, quoted, because the child cannot read any of them.",
      ],
      parameters,

      async execute(_id, params: Static<typeof parameters>, options: { signal?: AbortSignal } = {}) {
        /*
         * Deux délégations sur la même unité se suivent ; elles ne se croisent pas.
         *
         * L'attente précède tout : la reconstruction, la porte, la séquence, R. Celle qui
         * suit relit donc le registre que la précédente a laissé, au lieu d'allouer sur un
         * instantané que l'autre est en train de rendre faux. Deux unités distinctes ne
         * s'attendent jamais.
         */
        const liberer = await entrerFileUnites(unitesDeLAppel(params));
        try {
          return await delegation(_id, params, options);
        } finally {
          liberer();
        }

        async function delegation(
          _id: string,
          params: Static<typeof parameters>,
          { signal }: { signal?: AbortSignal } = {},
        ) {
        /*
         * Le préflight du dépôt, rendu ici parce que c'est ici qu'il coûte
         * quelque chose. Le run n'a pas été ouvert, donc rien n'a été écrit :
         * il n'y a rien à défaire, seulement une configuration à corriger.
         */
        if (!PREFLIGHT.ok) {
          return {
            content: [{
              type: "text" as const,
              text:
                `Refusé : ce dépôt n'est pas prêt pour un run.\n${PREFLIGHT.reason}\n` +
                "Aucun run n'a été ouvert et rien n'a été écrit.",
            }],
            isError: true,
          };
        }

        const agent = agents.get(params.agent);
        if (!agent) {
          return { content: [{ type: "text" as const, text: `unknown agent: ${params.agent}` }], isError: true };
        }

        // Before anything is spawned. A refusal costs one tool result; the
        // delegation it replaces cost between 28k and 306k tokens on the
        // measured run.
        //
        // Pour un rôle lié à une lane en régime planifié, les trois issues de la désignation
        // décident du garde (C1.7, L4-Q5, PLAN-LOT4 § 4) :
        //   none      aucune lane : garde immédiat, ici, sur l'historique entier (C1)
        //   unit      garde différé, après la reconstruction, sur la vue de cette lane
        //   conflict  aucun garde de revue : l'appel est invalide, et la résolution de
        //             l'unité rendra son refus de provenance avant toute politique de revue
        // Les rôles globaux et le régime libre gardent le garde global, ici. La désignation
        // se lit comme la file la lit (`unitesDeLAppel`) : `targetWorkUnit` est pur, rien
        // n'est résolu deux fois différemment.
        //
        // `for_risks` se résout une fois, sur la projection autoritaire (PLAN-LOT7 § 3.4) : la
        // désignation, l'unité de l'appel et le texte de continuation lisent le même état.
        const forRisks = params.for_risks ?? [];
        const { cible: target, livre: livreDesRisques } = cibleDesRisques(params.work_unit, forRisks);
        const designation = isLaneBound(agent.envelopeRole ?? agent.name) && plan().status === "usable"
          ? target.kind
          : "none";
        const gardeDiffere = designation === "unit";
        const blocked =
          (params.agent === "scout" ? checkScoutInput(params) : null) ??
          (designation === "none" ? refuse(params.agent, agent.tools) : null);
        if (blocked) {
          logRefusal(RUN_ID, params.agent, blocked);
          return { content: [{ type: "text" as const, text: blocked }], isError: true };
        }

        // The reviewer judges a change, so it is handed the change: everything
        // written since the last review, not merely whatever wrote last.
        //
        // Two ways the old "last writer wins" was wrong, neither of which had
        // bitten yet. `f0797e` ran `worker, worker, reviewer` — the review would
        // have seen only the second worker's files. And since inline writes
        // started being recorded, an orchestrator marking `DESIGN.md` as
        // implemented between a worker and its review would have shadowed the
        // code entirely, handing the reviewer a diff of a status field.

        // L'orchestrateur choisit l'unité ; le runtime dérive tout le reste.
        // Il ne redonne ni cwd, ni branche, ni identifiant de lane. Un scout de
        // continuation n'a même pas à nommer l'unité : ses risques savent d'où
        // ils viennent.
        /*
         * La présence, pas la valeur. `batch: []` avec un `task` rempli était
         * lu comme un appel simple valide, alors que le contrat dit l'un ou
         * l'autre : un lot vide est un lot, et il est vide.
         */
        const hasBatch = params.batch !== undefined;
        const hasTask = params.task !== undefined;
        if (hasBatch) {
          const entries = params.batch ?? [];
          if (entries.length === 0) {
            return invalidCall("`batch` est vide : donne au moins une unité, ou utilise `task`.");
          }
          const creux = entries.findIndex((b) => !b.work_unit?.trim() || !b.task?.trim());
          if (creux !== -1) {
            return invalidCall(
              `l'entrée ${creux + 1} de \`batch\` a une unité ou une tâche vide.`,
            );
          }
        }
        if (hasTask && !params.task?.trim()) {
          return invalidCall("`task` est vide.");
        }

        /*
         * L'unité est résolue avant d'être jugée : elle peut venir d'une
         * déclaration ou de la provenance des risques, et la politique doit
         * porter sur celle que `execute` utilisera réellement. Juger sur
         * `params.work_unit` seul réintroduirait l'obligation de déclarer que
         * le lot 1 a construite pour la supprimer.
         */
        if (target.kind === "conflict") {
          return {
            content: [{ type: "text" as const, text: `Refused: lane provenance conflict — ${target.reason}` }],
            isError: true,
          };
        }
        const unit = target.kind === "unit" ? target.workUnitId : undefined;
        // Les textes des risques confiés, de CETTE unité : le même id sous une autre unité est
        // un autre risque.
        const cont = params.agent === "reviewer"
          ? continuationSection(forRisks, livreDesRisques.filter((r) => r.workUnitId === unit))
          : "";

        const policy = validateTaskCall({
          agent: params.agent,
          plannedMode: plan().status === "usable",
          resolvedWorkUnit: unit,
          hasBatch,
          hasTask,
          declaredWorkUnit: params.work_unit,
          integrationPhase: unit ? ATTEMPTS.get(unit)?.phase : undefined,
        });
        if (!policy.ok) return invalidCall(policy.reason);

        /*
         * Un lot exige un plan exploitable, et le dit.
         *
         * Sans cette porte, `plan().units` serait vide et le scheduler
         * refuserait chaque candidate avec « ne figure pas dans le plan » —
         * exact, et trompeur : le défaut n'est pas dans les candidates mais dans
         * l'absence de plan. Même raison que la porte du chemin simple : un plan
         * invalide se corrige tant que rien n'a démarré.
         */
        if (hasBatch) {
          const p = plan();
          if (p.status !== "usable") {
            return invalidCall(
              `un lot exige un plan exploitable ; il est ${p.status}${p.reason ? ` — ${p.reason}` : ""}.`,
            );
          }
        }

        /*
         * Le plan est une porte, pas une annotation lue après coup.
         *
         * Il était consulté pour calculer `unplanned` au moment d'écrire le
         * journal, donc après que l'enfant avait tourné : un plan corrompu
         * laissait s'exécuter tout un run avant qu'on le sache. Une délégation
         * qui vise une unité exige maintenant un plan exploitable avant le
         * spawn. Un plan invalide se corrige tant que rien n'a commencé ; une
         * fois accepté, il est gelé.
         *
         * Une délégation qui ne vise aucune unité — un scout global — n'a pas
         * besoin de plan et n'en demande pas.
         */
        if (unit) {
          const p = plan();
          if (p.status !== "usable") {
            return {
              content: [{
                type: "text" as const,
                text:
                  `Refused: plan ${p.status}${p.reason ? ` — ${p.reason}` : ""}. ` +
                  `Fix ${RUNS_DIR}/${RUN_ID}-plan.json before delegating on a work unit; ` +
                  `nothing has run.`,
              }],
              isError: true,
            };
          }
        }
        /*
         * La propriété, après les validations pures et avant la première mutation.
         *
         * Tout ce qui précède — forme de l'appel, provenance, politique,
         * lecture du plan — ne touche à rien de durable. Acquérir avant aurait
         * fait prendre le bail et démarrer le battement à un appel mal formé,
         * puis l'aurait refusé sans qu'il ait jamais demandé de travail valide.
         *
         * Tout ce qui suit mute : ouvrir une lane, réserver une séquence,
         * écrire un artefact, journaliser. Un scout ne fait pas exception.
         */
        /*
         * La porte de reprise, avant même de prendre le bail.
         *
         * Une contradiction entre le registre et le dépôt veut dire que la
         * vérité durable n'est pas établie. Continuer sur une unité qui semble
         * indépendante ajouterait des faits à un run qu'on ne comprend pas
         * encore, et la porte est donc celle du run entier — pas un état faible
         * d'une WorkUnit.
         *
         * Ici, rien n'a été réservé ni ouvert, et le bail n'est même pas pris :
         * une session peut inspecter un run contradictoire sans en devenir
         * propriétaire.
         */
        /*
         * Recalculé à chaque délégation, pas une fois au chargement.
         *
         * `bin/subagent-recover` est un processus externe : une résolution faite
         * au terminal pendant que pi tourne serait restée invisible jusqu'au
         * redémarrage, et le run aurait continué de refuser sans raison. Un
         * worktree supprimé à la main pose le problème inverse.
         *
         * Le coût est de quelques commandes git par appel, devant des
         * délégations qui durent des secondes ou des minutes. Un recalcul
         * périodique aurait rouvert une fenêtre temporelle pour rien.
         */
        reconstruire();

        if (RECOVERY_LEDGER_VERSION !== LANE_LEDGER_VERSION && RECOVERY_LEDGER_VERSION !== LANE_LEDGER_V2) {
          const trouve = RECOVERY_LEDGER_VERSION === undefined
            ? "aucune version déclarée"
            : `version ${RECOVERY_LEDGER_VERSION}`;
          return {
            content: [{
              type: "text" as const,
              text:
                `[run: registre d'une autre version] ${RUN_ID}-lanes.jsonl : ${trouve}, ` +
                `ce runtime lit les versions ${LANE_LEDGER_VERSION} et ${LANE_LEDGER_V2}.\n` +
                `Ce n'est pas une corruption : le registre a été écrit sous un autre ` +
                `protocole, et ses lignes ne doivent pas être « corrigées » à la main.\n` +
                `Examiner avec bin/subagent-recover, migrer avec ` +
                `bin/subagent-recover --migrate-ledger.\n` +
                `Aucune délégation n'a été lancée.`,
            }],
            isError: true,
          };
        }

        if (RECOVERY_MALFORMED.length > 0) {
          return {
            content: [{
              type: "text" as const,
              text:
                `[run: registre illisible] ligne(s) ${RECOVERY_MALFORMED.join(", ")} de ` +
                `${RUN_ID}-lanes.jsonl n'ont pas pu être lues.\n` +
                `Le bilan de reprise porte donc sur un registre amputé, et ne prouve rien : ` +
                `corriger ces lignes avant de continuer. Aucune n'est supprimée automatiquement.\n` +
                `Aucune délégation n'a été lancée.`,
            }],
            isError: true,
          };
        }

        /*
         * Les tentatives ferment la même porte que les lanes.
         *
         * Un contexte que le registre ignore, une tentative dont le contexte a
         * disparu, deux tentatives vivantes pour une unité : dans tous les cas,
         * le runtime ne sait pas ce qu'il a devant lui. Continuer sur une autre
         * unité ajouterait des faits à un run qu'il ne comprend pas — c'est la
         * règle du registre des lanes, et il n'y a pas de raison qu'elle
         * s'applique à moitié.
         */
        if (INTEGRATION_CONFLICTS.length > 0) {
          return {
            content: [{
              type: "text" as const,
              text:
                `[run: tentatives d'intégration à trancher]\n` +
                `${describeIntegrationConflicts(INTEGRATION_CONFLICTS)}\n` +
                "Aucune délégation n'a été lancée. Ces contextes vivent sous " +
                ".git/pi-integrations/ ; leur provenance est dans " +
                `${RUN_ID}-integrations.jsonl.`,
            }],
            isError: true,
          };
        }

        if (RECOVERY_CONFLICTS.size > 0) {
          return {
            content: [{
              type: "text" as const,
              text:
                `[run: reprise à trancher]\n${describeConflicts(RECOVERY_CONFLICTS)}\n` +
                `Aucune délégation n'a été lancée, aucune séquence réservée, ` +
                `aucun worktree ouvert.`,
            }],
            isError: true,
          };
        }

        /*
         * Le garde de revue d'un rôle lié à une lane (C1.7, L4-Q5).
         *
         * Après les validations de l'appel, après la reconstruction et ses refus
         * fail-closed ; sur l'unité résolue par `targetWorkUnit`, `for_risks` compris, et
         * sur le snapshot que la reconstruction vient de poser ; avant la prise du bail,
         * toute reprise d'atterrissage, séquence, ouverture ou lancement — un refus ne
         * prend ni ne laisse rien, comme le garde global. Sans unité résolue,
         * l'historique entier (C1).
         */
        if (gardeDiffere) {
          const refusRevue = refuse(
            agent.name,
            agent.tools,
            unit ? vueDeRevue(unit) : HISTORY,
            unit !== undefined && agent.name === "reviewer" && arbreChangeDepuisRevue(unit),
          );
          if (refusRevue) {
            logRefusal(RUN_ID, agent.name, refusRevue);
            return { content: [{ type: "text" as const, text: refusRevue }], isError: true };
          }
        }

        const propriete = ensureOwnership();
        if ("refus" in propriete) {
          return { content: [{ type: "text" as const, text: propriete.refus }], isError: true };
        }
        const lease = propriete.lease;

        /*
         * Une tentative dont seul l'atterrissage a échoué se reprend ici.
         *
         * Après le bail, et pas avant la politique comme d'abord écrit : faire
         * atterrir un commit est une mutation, et une mutation ne se tente pas
         * sans la capacité qui l'autorise.
         *
         * `M` existe et vaut ; l'obstacle est hors du runtime — une racine
         * salie, un `ff-only` refusé. Annoncer « corrigez puis relancez » sans
         * réessayer laisserait l'unité bloquée : le worker est interdit, le
         * reviewer n'a plus d'objet, et rien ne rouvrirait la porte. On réessaie
         * donc à chaque délégation qui touche l'unité, et si ça passe la
         * tentative se ferme et l'appel suit son cours normal.
         */
        /*
         * Seuls les rôles qui poursuivent le cycle de l'unité déclenchent la
         * reprise. Un scout est global et en lecture seule ; il peut se
         * retrouver rattaché à W03 par la provenance de ses risques, et il n'a
         * aucune raison de devenir la cause d'un `ff-only`. Une mutation ne se
         * déclenche pas depuis un rôle qui n'en fait aucune.
         */
        const roleJoue = agent.envelopeRole ?? agent.name;
        if (unit && (roleJoue === "worker" || roleJoue === "reviewer")) {
          const enAttente = ATTEMPTS.get(unit);
          if (enAttente?.phase === "ready-to-land" && enAttente.landing) {
            /*
             * On retourne dans les deux cas, sans lancer personne.
             *
             * Sur succès parce que l'unité vient d'être intégrée : le worker
             * demandé produirait un travail qu'aucune lane ni review n'attend
             * plus. Sur échec parce que la tentative n'est pas reprise, et la
             * délégation ne peut pas la précéder.
             */
            const reprise = retryLanding(unit, enAttente, lease);
            return {
              content: [{ type: "text" as const, text: reprise.text.trim() }],
              isError: !("done" in reprise),
            };
          }
        }


        /*
         * Un run legacy n'ouvre plus de lane (PLAN-LOT3 § 1, lecture (b)).
         *
         * Ici, avant la séquence, le worktree et la branche : le refus ne laisse rien
         * derrière lui. Les lanes legacy déjà ouvertes continuent d'être rejointes.
         */
        if (isLaneBound(roleJoue)) {
          const lot = (params.batch as unknown as ReadonlyArray<{ work_unit: string }> | undefined) ?? [];
          const legacy = refusLegacy(hasBatch ? lot.map((b) => b.work_unit) : unit ? [unit] : []);
          if (legacy.length > 0) {
            return {
              content: [{
                type: "text" as const,
                text:
                  `[run: registre legacy] ${RUN_ID}-lanes.jsonl est en version ${LANE_LEDGER_VERSION} : ` +
                  `aucune nouvelle lane ne s'y ouvre (${legacy.join(", ")}).\n` +
                  `Terminer ou abandonner ce run avec bin/subagent-recover, puis en ouvrir un ` +
                  `nouveau. Aucune délégation n'a été lancée.`,
              }],
              isError: true,
            };
          }
        }

        /*
         * Ouvre ou rejoint : décidé ICI, une fois, pour toutes les unités de l'appel
         * (PLAN-LOT4 § 4).
         *
         * Après la reconstruction et ses portes fail-closed : `OPEN_UNITS` et `INTEGRATED`
         * sont les projections réconciliées de cet appel. Une unité qui n'est dans aucune
         * des deux ouvrira une lane — jamais ouverte, ou génération suivant un ABANDONED —
         * et c'est exactement ce que `deciderLane` conclura : une unité ouverte au registre
         * sans worktree, ou l'inverse, est un conflit qui a déjà fermé le run plus haut.
         * Une lane ouverte, ou la lane historique d'une unité intégrée, se rejoint sans
         * admission (C1.5).
         */
        const unitesLiees = !isLaneBound(roleJoue)
          ? []
          : hasBatch
            ? (params.batch as unknown as ReadonlyArray<{ work_unit: string }>).map((b) => b.work_unit)
            : unit ? [unit] : [];
        const jonctions: ReadonlySet<string> = new Set(
          unitesLiees.filter((u) => OPEN_UNITS.has(u) || INTEGRATED.has(u)),
        );

        /*
         * L'admission du chemin simple (C1.5, C-P1-F02), sur la décision commune.
         *
         * Avant la séquence, la lane, l'OPENED et toute délégation : un refus ne laisse
         * rien derrière lui. Aucun `await` d'ici à `ouvrirLanes` : la décision et
         * l'ouverture tiennent dans le même tour du processus, et le bail exclut les autres.
         * Un appel simple ne met rien en file : « EN FILE » dit l'issue d'admission, et
         * « rien n'est parti » ce qu'il en a été.
         */
        if (!hasBatch && unit && unitesLiees.length > 0 && plan().status === "usable") {
          const admission = contexteAdmission(jonctions);
          const tache = (params as unknown as { task?: string }).task ?? "";
          const decision = admettre({ workUnitId: unit, task: tache }, admission, admission.owners ?? []);
          if (decision.issue !== "admise") {
            const texte = decision.issue === "refusee"
              ? `REFUSÉE : ${decision.reason}`
              : `EN FILE : ${decision.reason} — rien n'est parti`;
            logRefusal(RUN_ID, agent.name, texte);
            return { content: [{ type: "text" as const, text: texte }], isError: true };
          }
        }

        /*
         * Le bilan de reprise, dit une seule fois.
         *
         * Une session qui reprend un run interrompu doit savoir sur quoi elle
         * repart avant de déléguer. Les contradictions ne sont pas réparées :
         * elles ont déjà fermé la porte globale plus haut ; ce bilan ne traverse
         * jusqu'ici que lorsque l'état est cohérent (ou porte de simples warnings).
         */
        const bilan = RECOVERY_NOTE;
        RECOVERY_NOTE = "";

        /*
         * Les séquences avant le worktree, comme dans le lot.
         *
         * Le chemin simple ouvrait la lane d'abord, et ce n'était pas qu'une
         * asymétrie : `allocateSeq` est gardée par la capacité et par la clôture
         * des transitions, `openLane` ne l'est pas. Un verrou périmé apparu
         * entre les deux laissait donc un worktree derrière lui sans qu'aucune
         * séquence n'ait été réservée ni aucun enfant lancé — exactement ce que
         * cet ordre existe pour empêcher.
         *
         * Le nombre de tâches ne dépend que des paramètres : un scout en a une
         * par question, tout le reste en a une. Il est donc connu avant qu'on
         * ait besoin de la lane.
         */
        const questions = params.agent === "scout" ? scoutQuestions(params.find) : [];

        /*
         * Geler le plan et réserver les séquences, ou dire pourquoi c'est
         * impossible.
         *
         * Ces deux mutations traversent la clôture des transitions, qui refuse
         * sur deux motifs opposés : un vestige de crash demande une
         * réconciliation, une transition en cours demande seulement de
         * réessayer. Sans ce filet, la première remontait brute hors de
         * l'outil — le harnais l'a trouvée ainsi, et une exception nue ne dit
         * pas quoi faire.
         */
        let seqs: number[];
        try {
          if (PLAN?.status === "usable" && PLAN_TEXT !== undefined) {
            attachPlan(RUN_DIR, PLAN_TEXT, lease);
          }
          seqs = Array.from({ length: Math.max(1, questions.length) }, () =>
            allocateSeq(RUN_DIR, lease).seq,
          );
        } catch (err) {
          if (err instanceof RunBusyError) {
            return {
              content: [{ type: "text" as const, text: `[run: occupé] ${err.message}` }],
              isError: true,
            };
          }
          if (err instanceof RecoveryError) {
            return {
              content: [{
                type: "text" as const,
                text:
                  `[run: reprise requise] ${err.message}\n` +
                  `Rien n'a été réservé, ouvert ni lancé.`,
              }],
              isError: true,
            };
          }
          throw err;
        }

        /*
         * Les rôles globaux le sont jusqu'au bout : ni lane, ni contexte.
         *
         * Un scout ou un advisor peut porter une unité — déclarée, ou héritée de
         * la provenance de ses risques — sans que cela change ce qu'il est : un
         * lecteur qui répond sur le dépôt. Le laisser ouvrir une lane lui ferait
         * créer un worktree et un `OPENED` au registre pour une unité que
         * personne n'a commencée ; le laisser hériter du contexte d'intégration
         * lui ferait lire des marqueurs de conflit et un état intermédiaire que
         * son contrat ne mentionne pas.
         *
         * Sur le rôle joué, et surtout pas sur `isReadOnly(agent.tools)` : le
         * reviewer n'a ni `edit` ni `write`, donc ce critère l'aurait rendu
         * global alors qu'il juge le travail d'une lane et doit le voir depuis
         * cette lane. Une variante sur un autre modèle déclare son
         * `envelopeRole` et hérite de la décision sans être inscrite nulle part.
         */
        const roleGlobal = !isLaneBound(roleJoue);

        let lane: LaneContext | undefined;
        if (unit && !roleGlobal) {
          try {
            lane = ouvrirLanes([unit], lease).get(unit)!.lane;
          } catch (err) {
            if (err instanceof LaneOpeningNotRecordedError) {
              return {
                content: [{
                  type: "text" as const,
                  text:
                    `[run: ouverture non enregistrée] le worktree de ${unit} existe, ` +
                    `son ouverture n'a pas pu être écrite au registre — ${err.message}\n` +
                    `Il apparaîtra comme « worktree-orphelin » à la prochaine lecture : ` +
                    `l'adopter ou le retirer avec bin/subagent-recover.`,
                }],
                isError: true,
              };
            }
            return {
              content: [{
                type: "text" as const,
                text: `Refused: cannot open lane for ${unit} — ${err instanceof Error ? err.message : String(err)}`,
              }],
              isError: true,
            };
          }

        }

        /*
         * Avant de calculer quoi que ce soit : la lane est-elle encore là où son
         * ouverture la situe ?
         *
         * La frontière de revue se compte depuis la base ouverte. Une tête qui a bougé
         * sans gel la rend fausse, et la calculer d'abord reviendrait à mesurer un
         * changement depuis un point qui n'est plus. Le refus précède donc le calcul,
         * la délégation, et toute écriture — la lane et sa branche sont conservées
         * telles quelles.
         */
        if (unit && !roleGlobal && params.agent === "reviewer" && lane?.laneId) {
          const ecart = laneHorsProvenance(unit, lane.laneId);
          if (ecart) {
            return {
              content: [{
                type: "text" as const,
                text:
                  `Refused: ${ecart}.\n` +
                  `Rien n'a été modifié : la branche et le worktree sont conservés. Un commit ` +
                  `que le registre n'explique pas se tranche avec bin/subagent-recover, pas par ` +
                  `un rollback.`,
              }],
              isError: true,
            };
          }
        }

        // Lane-local des deux côtés : la frontière ne voit que l'historique de
        // cette lane, et le diff est lu dans son worktree. Une lane intégrée
        // entre-temps ne grossit donc pas cette review, ce qui est la propriété
        // que `review-boundary.ts` prépare depuis le début.
        const changed = changedSinceLastReview(laneView(lane?.laneId));

        /*
         * La tentative d'intégration déplace tout : le répertoire, le paquet, et
         * ce que les outils de l'enfant voient.
         *
         * Le diff seul ne suffirait pas. Un reviewer à qui l'on donne le bon
         * texte mais qui tourne encore dans la lane lira `src/a.py` de la lane
         * quand il l'ouvrira, c'est-à-dire un fichier que la résolution a
         * changé. La correctness porte sur ce que ses outils voient autant que
         * sur ce qu'on lui écrit.
         */
        const etatAttempt = unit && !roleGlobal ? ATTEMPTS.get(unit) : undefined;
        const attempt = etatAttempt?.attempt;
        const cwdEnfant = attempt?.dir ?? lane?.cwd ?? process.cwd();

        let integrationPkg: { text: string; tree?: string } | undefined;
        if (attempt && (params.agent === "reviewer" || params.agent === "integration-worker")) {
          if (params.agent === "reviewer") {
            const t = integrationTree(attempt.dir);
            if (!t.ok) {
              return {
                content: [{
                  type: "text" as const,
                  text:
                    `Refused: la résolution de ${unit} n'est pas revisable — ${t.reason}\n` +
                    `Déléguer à nouveau agent=integration-worker work_unit=${unit}.`,
                }],
                isError: true,
              };
            }
            const rv = integrationReview(attempt.dir, attempt, t.tree);
            if (!rv.ok) {
              return {
                content: [{
                  type: "text" as const,
                  text: `Refused: paquet d'intégration incalculable pour ${unit} — ${rv.reason}`,
                }],
                isError: true,
              };
            }
            integrationPkg = {
              tree: t.tree,
              text:
                `## Integration review — ${unit}\n\n` +
                `Two approved states are being combined. Conflicted files: ` +
                `${rv.review.conflicts.join(", ")}\n\n` +
                "### What this integration would add to the base (P1 → T)\n\n" +
                `\`\`\`diff\n${rv.review.fromBase}\n\`\`\`\n\n` +
                "### What the resolution changed, on the conflicted files only (P2 → T)\n\n" +
                `\`\`\`diff\n${rv.review.fromLaneOnConflicts}\n\`\`\`\n\n`,
            };
          } else {
            integrationPkg = {
              text:
                `## Merge conflict — ${unit}\n\n` +
                `Base: ${attempt.p1.slice(0, 12)}   Lane: ${attempt.p2.slice(0, 12)}\n` +
                `Conflicted files, and your entire scope:\n` +
                `${attempt.conflicts.map((f) => `  ${f}`).join("\n")}\n\n` +
                "Editing anything else ends this attempt without a merge commit.\n\n",
            };
          }
        }

        let paquetDeRevue: DiffPackage = { text: "", degraded: false, proof: SANS_PREUVE };
        // Les deux trees du paquet, tels qu'observés pour le construire : ce sont eux que
        // REVIEWED portera (B1), jamais un recalcul d'après la revue.
        let snapshotDeRevue: { fromTree: string; tree: string } | undefined;
        if (!integrationPkg && params.agent === "reviewer" && lane && !attempt) {
          {
            const p = paquetDeLane(changed, lane);
            if (!p.ok) {
              return {
                content: [{
                  type: "text" as const,
                  text:
                    `Refused: le paquet de revue de ${lane.workUnitId} est inobservable — ${p.raison}\n` +
                    "Aucune revue n'est lancée : une observation inconnue n'est jamais une preuve vide.",
                }],
                isError: true,
              };
            }
            paquetDeRevue = p.pkg;
            snapshotDeRevue = { fromTree: p.fromTree, tree: p.tree };
          }
        } else if (!integrationPkg && params.agent === "reviewer" && changed.length > 0) {
          paquetDeRevue = diffSection(changed, lane?.cwd ?? process.cwd());
        }
        const pkg: DiffPackage = integrationPkg
          ? { text: integrationPkg.text, degraded: false, diffChars: integrationPkg.text.length, proof: SANS_PREUVE }
          : params.agent === "reviewer"
            ? paquetDeRevue
            : { text: "", degraded: false, diffChars: 0, proof: SANS_PREUVE };

        // For a scout, the contract is also the head of its task text: the child
        // reads the same one question and the same paths the schema enforced.
        // One task text per question, so a fan-out spawns children that differ
        // in exactly one line and nothing else.
        // Ahead of the diff, so the review reads what it must settle before what
        // it must judge. Only a reviewer gets it: a scout is given one bounded
        // question and would treat a pasted concern as a second one.
        const scoutHeader = (q: string) =>
          `Find: ${q}\nScope: ${(params.scope ?? []).join(", ")}\n\n`;
        const tasks = questions.length
          ? questions.map((q) => `${pkg.text}${scoutHeader(q)}${params.task}`)
          : [`${cont}${pkg.text}${params.task}`];

        // Publish run state for the footer. getExtensionStatuses() is the
        // documented channel between extensions; a shared module import would
        // depend on how pi isolates them.
        const publish = () => ui?.setStatus?.(STATUS_KEY, serialize());

        // The task decides which domain applies, not the role. A static list on
        // the definition hands a Terraform change python-engineering and
        // nothing useful; the definition's list is a default, not a constraint.
        // Tools follow the input package, not the role.
        //
        // The ceiling used to follow it too, and that produced an inverted
        // ladder: a degraded package bought twelve turns while an inlined diff,
        // however large, kept the nominal eight. Raising DIFF_MAX_CHARS then
        // moved the biggest changes out of the twelve and into the eight —
        // measured on run 5, three reviews died at eight, all three holding
        // their diff, and they were among the largest tasks of the run. The
        // ceiling is twelve everywhere now, so the ladder cannot invert again.
        // A ceiling only ever binds the tail: the median review still concludes
        // in four turns and pays nothing for the headroom.
        //
        // Removing grep and find from the reviewer was paid for by handing it the
        // diff: it does not need to find a change it has been given. When the
        // diff does not fit, that payment is not made and the removal stands —
        // which put the reviewer in its narrowest configuration exactly where the
        // change was largest. Measured on the first Balance Agee run: four
        // reviews of fifteen died at the six-turn ceiling. And a diff that does
        // fit can still be large: on the second run, 47-reviewer died at six
        // turns holding its diff, 285,449 tokens at 47,574 per turn, where the
        // other thirteen concluded in 4.1 turns each. Six is a number calibrated
        // on a 360-line project's diffs, with nothing about it that scales.
        const effective =
          params.skills && params.skills.length > 0 ? { ...agent, skills: params.skills } : { ...agent };
        if (pkg.degraded) {
          effective.tools = [...new Set([...agent.tools, "grep", "find"])];
        }

        /*
         * Le lot : plusieurs unités, chacune dans sa lane, au plus deux à la fois.
         *
         * Chemin séparé et non variante du chemin simple, parce que ce qui
         * change n'est pas le nombre d'enfants mais leur contexte : chaque
         * candidate a son worktree, donc son `cwd`, et le fan-out existant
         * envoyait le même à tous. Une délégation simple continue de passer par
         * le chemin qu'elle a toujours pris.
         *
         * Ni review ni intégration ici : un lot est fait de workers. Les
         * reviews restent unitaires, ce qui garde les intégrations
         * naturellement ordonnées sans file de merge.
         */
        if (hasBatch) {
          const batchId = randomBytes(4).toString("hex");
          const candidates: Candidate[] = params.batch!.map((b) => ({
            workUnitId: b.work_unit,
            task: b.task,
          }));
          const rows: DelegationRecord[] = [];
          // Toute lane ouverte et non intégrée possède encore ses fichiers, y compris
          // celles d'un appel précédent : le scheduler ne les verrait pas autrement.
          // `jonctions` est la décision ouvre/rejoint prise plus haut, transmise telle quelle.
          const admission = contexteAdmission(jonctions);
          /*
           * Les lanes du lot, allouées en UNE section critique sous R (PLAN-LOT3 § 4).
           *
           * Avant le premier départ, et seulement pour les candidates qui partiront dans cet
           * appel : admises, et qu'aucune lane déjà ouverte hors du lot ne bloque. Une
           * refusée n'a pas de lane (C1.5) ; une candidate bloquée par une lane extérieure
           * ne partira pas avant la fin de l'appel, et n'en reçoit pas non plus. Un lot
           * invalide — une unité deux fois — n'alloue rien : le scheduler le refuse.
           */
          let lanesDuLot = new Map<string, OuvertureDeLane>();
          if (new Set(candidates.map((c) => c.workUnitId)).size === candidates.length) {
            const partantes = candidates.flatMap((c) =>
              admettre(c, admission, admission.owners ?? []).issue === "admise" ? [c.workUnitId] : []);
            try {
              lanesDuLot = ouvrirLanes(partantes, lease);
            } catch (err) {
              const quoi = err instanceof Error ? err.message : String(err);
              return {
                content: [{
                  type: "text" as const,
                  text: err instanceof LaneOpeningNotRecordedError
                    ? `[run: ouverture non enregistrée] ${quoi}\nUn worktree existe sans son ouverture : ` +
                      `l'adopter ou le retirer avec bin/subagent-recover. Aucune délégation n'a été lancée.`
                    : `Refused: cannot open the batch lanes — ${quoi}`,
                }],
                isError: true,
              };
            }
          }
          let outcomes;
          try {
            outcomes = await runLanes(
              candidates,
              admission,
              MAX_PARALLEL_LANES,
              async (candidate, workUnit) => {
                /*
                 * La séquence avant le worktree, et pas l'inverse.
                 *
                 * Réservée au moment où la tentative démarre réellement : une
                 * candidate refusée ou mise en file n'en consomme aucune. Mais
                 * elle passe d'abord, parce qu'elle est gardée par la capacité :
                 * un numéro perdu si l'ouverture échoue ne coûte rien, un
                 * worktree créé après la perte de propriété coûte cher.
                 */
                const seq = allocateSeq(RUN_DIR, lease).seq;
                const ouverture = lanesDuLot.get(workUnit.id);
                if (!ouverture) throw new Error(`${workUnit.id} n'a pas de lane allouée pour ce lot`);
                const lane = ouverture.lane;
                const tlAvant = arbreAvant(lane.cwd);
                const result = await dispatch(effective, `${pkg.text}${candidate.task}`, {
                  ctx: { agentDir: AGENT_DIR, selfDir: SELF_DIR, runId: RUN_ID, cwd: lane.cwd },
                  seq,
                  signal: bothSignals(signal),
                  onProgress: publish,
                });
                /*
                 * La barrière, ici et non après le retour du lot.
                 *
                 * `HISTORY`, le journal et l'état de lane sont écrits par ce
                 * rappel, donc une barrière posée après `runLanes` arriverait
                 * trop tard : les mutations auraient déjà eu lieu. Elle porte
                 * sur la capacité capturée avant le spawn.
                 */
                if (!stillOwns(lease)) return result;

                HISTORY.push({
                  laneId: lane.laneId,
                  agent: params.agent,
                  batch: batchId,
                  produced: !result.failure,
                  changedFiles: result.changedFiles ?? [],
                  readOnly: isReadOnly(agent.tools),
                });
                // La violation, observée et durable avant toute porte (C3.1, Q7).
                enregistrerViolations(lane, seq, agent.name, lease, tlAvant);
                rows.push({
                  seq,
                  batch: batchId,
                  role: params.agent,
                  work_unit: workUnit.id,
                  work_unit_declared: workUnit.id,
                  lane_id: lane.laneId,
                  cwd: lane.cwd,
                  reserved_touched: reservedTouched(result.changedFiles ?? []),
                  unplanned: false,
                  for_risks: [],
                  produced: !result.failure,
                  read_only: isReadOnly(agent.tools),
                  changed_files: result.changedFiles ?? [],
                  artifact: result.artifact,
                  failure: result.failure ?? null,
                });
                return result;
              },
            );
          } catch (err) {
            // Un appel mal formé revient à l'orchestrateur, qui peut le
            // corriger. Un invariant rompu du scheduler est un défaut du
            // runtime : le maquiller en conseil l'enverrait réparer un plan
            // qui n'a rien.
            if (err instanceof SchedulerInputError) {
              return {
                content: [{ type: "text" as const, text: `[worker batch: invalid] ${err.message}` }],
                isError: true,
              };
            }
            throw err;
          }
          // Une violation constatée et non écrite arrête l'appel entier (Q7) : le verrou R est
          // resté en place, et rien ne doit continuer comme si le registre la portait.
          const nonEnregistree = outcomes.find((o) => o.error instanceof ViolationNotRecordedError);
          if (nonEnregistree) {
            return refusViolationNonEnregistree(nonEnregistree.error as ViolationNotRecordedError);
          }
          const inobservable = outcomes.find((o) => o.error instanceof ObservationViolationInconnueError);
          if (inobservable) {
            return refusObservationInconnue(inobservable.error as ObservationViolationInconnueError);
          }
          // `rows` s'accumule dans l'ordre des fins ; `seq` est l'ordre des
          // démarrages. Laisser le journal physique contredire son propre ordre
          // logique serait une ambiguïté gratuite, et cette branche en a déjà
          // coûté assez.
          if (!stillOwns(lease)) {
            return {
              content: [{
                type: "text" as const,
                text:
                  `[run: propriété perdue] le lot est revenu, mais ${RUN_ID} ne nous appartient ` +
                  `plus. Les worktrees et ce qu'ils contiennent restent ; rien n'a été journalisé.`,
              }],
              isError: true,
            };
          }
          rows.sort((a, b) => a.seq - b.seq);
          logDelegations(RUN_ID, rows);

          const lines = outcomes.map((o) => {
            if (o.state === "refused") return `  ${o.workUnitId}  REFUSÉ : ${o.reason}`;
            if (o.state === "queued") return `  ${o.workUnitId}  EN FILE : ${o.reason}`;
            const r = o.value as RunResult | undefined;
            if (o.error) return `  ${o.workUnitId}  échec : ${String((o.error as Error)?.message ?? o.error)}`;
            const files = r?.changedFiles?.length ?? 0;
            const reserved = reservedTouched(r?.changedFiles ?? []);
            return `  ${o.workUnitId}  ${r?.failure ?? "ok"}, ${files} fichier(s)` +
              `${reserved.length ? `, RESERVED VIOLATION ${reserved.join(", ")}` : ""}` +
              `\n     ${r?.artifact ?? ""}`;
          });
          const ran = outcomes.filter((o) => o.state === "done").length;
          /*
           * Toutes refusées est une faute d'admission que l'orchestrateur peut
           * corriger, et un `0/3` absorbé comme un succès d'outil la lui
           * cacherait. Une mise en file, elle, n'est pas une faute : les
           * candidates sont légales et bloquées par l'état du runtime, il n'y a
           * rien à corriger — seulement à intégrer le propriétaire et
           * reproposer.
           */
          const allRefused = outcomes.every((o) => o.state === "refused");
          return {
            content: [{
              type: "text" as const,
              text:
                `[worker batch: ${ran}/${outcomes.length} exécutée(s), ` +
                `max_parallel_lanes=${MAX_PARALLEL_LANES}]\n` + lines.join("\n"),
            }],
            ...(allRefused ? { isError: true } : {}),
          };
        }
        // There was a second branch here raising the ceiling for a large inlined
        // diff. Measured on run b9baad, ten reviews: turns were 1, 3, 3, 4, 5, 5,
        // 5, 7, 7, 7 and did not follow diff size at all — 27,615 characters
        // concluded in one turn, 2,214 took seven. What the tail showed is
        // simpler: six was too tight for a review that needs seven, whatever it
        // was handed. The ceiling is eight now, flat, and the conditional is
        // gone rather than kept as insurance for a correlation that is not there.
        // The degraded branch above stays: both reviews given no diff ran five
        // and seven turns, against a median of four.

        /*
         * Several scouts at once, one writer at a time.
         *
         * A scout holds `read`, `grep`, `find`, `ls` and `bash` under bash-guard:
         * it cannot change the tree. So running four of them together cannot
         * produce the failure that makes parallel writers dangerous — two
         * processes disagreeing about what is on disk. Everything the
         * configuration says about state stays true, because none of them
         * touches state: `changedSinceLastReview`, the material-change guard and
         * the tree snapshots all read a tree nobody is writing.
         *
         * The measured reason: eighteen scouts cost 13.8 minutes of a 119-minute
         * run, 12% of wall time, serialised for no reason. Four at once brings
         * that to the longest of the four.
         *
         * Writers are deliberately excluded, and the exclusion is structural
         * rather than a setting. Two workers in one tree would make "since the
         * last review" ambiguous, hand the reviewer a union no worker authored,
         * and let a killed worker claim another's files as salvage. That is the
         * `3ed33e` failure — a schema nobody wrote, every test green — rebuilt
         * by the harness instead of merely suffered.
         */
        /*
         * One path, one exit, published whatever happens.
         *
         * `Promise.all` rejected on the first child that threw while the three
         * others kept running, with nothing left to publish their state, record
         * them in HISTORY or close the call. `allSettled` waits for every child,
         * which costs the duration of the slowest — what a fan-out costs anyway.
         *
         * The singleton branch used to await `dispatch` directly, and a
         * rejection there skipped the publish below: `run-state` closed in
         * memory while the footer kept a snapshot showing the role still
         * running. Two exceptional paths, one of them handled — the same
         * singleton/fan-out asymmetry this whole series has been removing. So a
         * lone child goes through `tasks[]` and `allSettled` like any other, and
         * `finally` gives the nominal and the exceptional path the same final
         * publish.
         *
         * Nothing enters HISTORY for a batch that did not complete: the guard
         * must not count a reconnaissance the orchestrator cannot act on.
         */
        // Allocated before the spawn rather than inside the map: the sequence
        // number is the artefact's name and half of every risk id built from it,
        // and the delegation journal has to record the same one this child was
        // given. Reading it back off the artefact path would work and would tie
        // the journal to a filename format.

        // Le T_L d'avant la délégation writer : ce qu'elle aura changé se lira contre lui.
        // Inobservable : l'appel s'arrête ici, aucun enfant ne part (B2).
        let tlAvant: string | undefined;
        if (lane && !attempt && !isReadOnly(agent.tools)) {
          try {
            tlAvant = arbreAvant(lane.cwd);
          } catch (err) {
            if (err instanceof ObservationViolationInconnueError) return refusObservationInconnue(err);
            throw err;
          }
        }
        let results: RunResult[];
        try {
          const settled = await Promise.allSettled(
            tasks.map((t, i) =>
              dispatch(effective, t, {
                ctx: {
                  agentDir: AGENT_DIR,
                  selfDir: SELF_DIR,
                  runId: RUN_ID,
                  /*
                   * Explicite, et une seule source.
                   *
                   * Le contexte d'intégration s'il y en a un, sinon la lane,
                   * sinon la racine. C'était `lane?.cwd`, donc `undefined` pour
                   * un rôle sans lane, et `dispatch` retombait sur son propre
                   * `process.cwd()` — juste, mais illisible : rien ne disait où
                   * un scout tourne, et rien ne pouvait l'affirmer.
                   */
                  cwd: cwdEnfant,
                },
                seq: seqs[i],
                signal: bothSignals(signal),
                onProgress: publish,
              }),
            ),
          );
          const rejected = settled.find((r) => r.status === "rejected");
          if (rejected && rejected.status === "rejected") throw rejected.reason;
          // Safe: any rejection has thrown above.
          results = settled.map((r) => (r as PromiseFulfilledResult<RunResult>).value);
        } finally {
          publish();
        }

        /*
         * La barrière de propriété, avant la première mutation issue des enfants.
         *
         * Elle était plus bas, juste avant l'intégration — donc après `HISTORY`,
         * après le journal des délégations et après le registre de risques. Le
         * commentaire promettait que rien n'avancerait après la perte du bail
         * alors que trois choses avaient déjà avancé. Trouvé par le harnais, et
         * invisible aux tests de module : c'est un ordre d'instructions, pas un
         * contrat.
         *
         * Elle porte sur la capacité capturée avant le spawn, pas sur le bail
         * courant de la session.
         */
        if (!stillOwns(lease)) {
          return {
            content: [{
              type: "text" as const,
              text:
                `[run: propriété perdue] la délégation est revenue, mais ${RUN_ID} ne nous ` +
                `appartient plus. Ce que l'enfant a écrit reste sur le disque ; rien n'a été ` +
                `journalisé, intégré ni fermé.\n` +
                describeAccess(inspectRun(RUN_DIR, RUN_ID, SESSION_ID), RUN_ID),
            }],
            isError: true,
          };
        }

        // One HISTORY entry per child, which is what ran. The guard counts the
        // calls behind them — see `streakOf`, and the `batch` field they share.
        const batch = randomBytes(4).toString("hex");
        for (const r of results) {
          HISTORY.push({
            laneId: lane?.laneId,
            agent: params.agent,
            batch,
            produced: !r.failure,
            readOnly: isReadOnly(agent.tools),
            changedFiles: r.changedFiles ?? [],
          });
        }
        /*
         * The ledger, and the join table, once the call is closed.
         *
         * Recorded after the children return rather than before they spawn, for
         * the same reason nothing enters `HISTORY` for a batch that threw: a
         * call that did not complete is not a continuation the orchestrator can
         * act on, and a ledger claiming otherwise would be describing work that
         * never happened.
         *
         * A reviewer that came back with an envelope has examined what it was
         * handed, so its silence on a risk means the risk is not settled. A
         * reviewer that came back with nothing examined nothing — a `max_turns`
         * or a `no_submit` is not a considered answer — so its risks are
         * recorded as a continuation engaged and not returned, which is exactly
         * what a `routed` still standing at the end of a run means.
         */
        /*
         * Ce qui rend la lane non intégrable, constaté et retenu.
         *
         * Le worktree empêche la corruption immédiate ; ces états empêchent
         * d'intégrer une hypothèse devenue fausse. Un dépassement ne tue pas la
         * délégation — le run 15 a mesuré 6 écritures hors scope sur 46, donc
         * tuer sur une prédiction imparfaite confondrait une erreur de planning
         * avec une erreur de code — mais il ferme la porte du merge jusqu'à ce
         * qu'il soit traité.
         */
        if (lane && !attempt && tlAvant !== undefined) {
          // Une violation de chemin réservé ou du bundle est un événement : la lane n'a
          // jamais eu le droit d'écrire là, et aucune reprise ne l'annule (C3.1, Q7).
          try {
            for (let i = 0; i < results.length; i++) {
              enregistrerViolations(lane, seqs[i], agent.name, lease, tlAvant);
            }
          } catch (err) {
            if (err instanceof ViolationNotRecordedError) return refusViolationNonEnregistree(err);
            if (err instanceof ObservationViolationInconnueError) return refusObservationInconnue(err);
            throw err;
          }
        }

        /*
         * Les risques de cette délégation (C3.4, PLAN-LOT7 §§ 3.1–3.7).
         *
         * Registre v2 et unité connue : les transitions se calculent SOUS R, sur l'état relu
         * sous R, s'écrivent avant le REVIEWED de la même enveloppe et sous la même
         * acquisition ; la mémoire ne suit qu'après. Rien à transiter — ni `for_risks`, ni
         * risque ouvert par l'enveloppe — : rien n'est pris. Registre v1, ou risque sans
         * unité : mémoire et journal seulement, et rien n'en fait une autorisation.
         */
        const events: LedgerEvent[] = [];
        const channel = riskChannel(params.agent);
        const roleRisque = agent.envelopeRole ?? agent.name;
        /*
         * Les transitions de cette délégation, sur un grand livre donné.
         *
         * Les fonctions de `risk-ledger.ts` décident ; elles rendent le livre suivant, le
         * journal best-effort, et ce que le registre autoritaire reçoit. `still-open` et
         * `ignored` ne vont qu'au journal. Sans unité ou sans lane courante, rien n'est
         * écrit. `by`/`to` : `<rôle>#<delegation_seq>`, provenance opaque (PLAN-LOT7 Q3).
         */
        const transiter = (livre: RiskRecord[], laneDuRisque: string | undefined) => {
          let ledger = livre;
          const journal: LedgerEvent[] = [];
          const writes: RiskWrite[] = [];
          const at = new Date().toISOString();
          const durable = (evts: readonly LedgerEvent[], qui: string): void => {
            if (unit === undefined || laneDuRisque === undefined) return;
            const risque = (id: string, transition: RiskWrite["transition"], p: { by: string } | { to: string }): RiskWrite =>
              ({ event: "RISK", work_unit: unit, at, lane: laneDuRisque, id, transition, ...p });
            for (const e of evts) {
              if (e.event === "opened") writes.push(risque(e.id, "opened", { by: qui }));
              else if (e.event === "routed") writes.push(risque(e.id, "routed", { to: qui }));
              else if (e.event === "resolved") writes.push(risque(e.id, "resolved", { by: qui }));
            }
          };
          if (channel === "continuation") {
            results.forEach((r, i) => {
              const qui = `${roleRisque}#${seqs[i]}`;
              const back = r.failure
                ? routeRisks(ledger, forRisks, `call:${batch}`, unit)
                : continuationReturned(ledger, forRisks, r.resolvedRisks ?? [], r.artifact, unit);
              ledger = back.ledger;
              journal.push(...back.events);
              durable(back.events, qui);

              // New concerns after old ones, so a follow-up review that closes one
              // and raises another reads in that order in the journal and the ledger.
              const fresh = openRisks(ledger, r.openRiskItems, r.artifact, unit);
              ledger = fresh.ledger;
              journal.push(...fresh.events);
              durable(fresh.events, qui);
            });
          } else if (channel === "route") {
            // Once per call, outside the loop over children. `routedTo` names the
            // call and not a child, so a fan-out of three scouts carrying two
            // risks is two transitions, not six — the same child-versus-call
            // ambiguity the streak guard and the scout counter both had to lose.
            const out = routeRisks(ledger, forRisks, `call:${batch}`, unit);
            ledger = out.ledger;
            journal.push(...out.events);
            durable(out.events, `${roleRisque}#${Math.min(...seqs)}`);
          }
          return { ledger, events: journal, writes };
        };
        const peutTransiter = forRisks.length > 0 || results.some((r) => (r.openRiskItems?.length ?? 0) > 0);
        const regime = regimeDesRisques(unit, channel !== "none" && peutTransiter);
        if (typeof regime !== "string") return refusEtatDesRisques(regime.refus);
        const risquesDurables = regime === "durable";
        // La revue de lane dont le REVIEWED s'écrit ICI, derrière ses risques ; sinon à la porte.
        let revueTraitee: { refus: string | undefined } | undefined;
        if (risquesDurables && unit !== undefined) {
          const uniteDuRisque = unit;
          let calcul: ReturnType<typeof transiter> | undefined;
          const produire: CalculDesRisques = (etat: EtatDesRisques) => {
            const livre = grandLivre(etat.faits.values());
            calcul = transiter(livre, lane?.laneId ?? etat.laneCourante(uniteDuRisque));
            return calcul.writes;
          };
          const revueDeLane = lane && !attempt && params.agent === "reviewer" && !results[0]?.failure &&
            snapshotDeRevue !== undefined && typeof results[0]?.verdict === "string" && results[0].verdict !== "";
          try {
            if (revueDeLane) {
              revueTraitee = {
                refus: enregistrerRevue(
                  lane!,
                  results[0],
                  seqs[0],
                  { agent: String(params.agent), role: roleRisque },
                  { fromTree: snapshotDeRevue!.fromTree, tree: snapshotDeRevue!.tree, proof: pkg.proof },
                  lease,
                  produire,
                ),
              };
            } else {
              appendRiskEvents(RUN_DIR, uniteDuRisque, produire, lease);
            }
          } catch (err) {
            return refusRisqueNonEnregistre(err);
          }
          if (calcul) {
            retenirRisques(calcul.ledger);
            events.push(...calcul.events);
          }
        } else {
          const calcul = transiter(RISKS, undefined);
          RISKS = calcul.ledger;
          events.push(...calcul.events);
        }
        logLedger(RUN_ID, events);

        logDelegations(
          RUN_ID,
          results.map((r, i) => ({
            seq: seqs[i],
            batch,
            role: params.agent,
            work_unit: unit ?? null,
            work_unit_declared: params.work_unit ?? null,
            /*
             * Pas de `laneId` sur une délégation d'intégration.
             *
             * Elle appartient à l'unité, mais elle ne s'est pas exécutée dans sa
             * lane. La lui attribuer ferait entrer dans `laneView(W03)` des
             * changements faits dans un autre worktree — exactement la confusion
             * que le contexte d'intégration existe pour supprimer. Le reviewer
             * d'intégration ne reconstruit d'ailleurs pas son objet depuis
             * `HISTORY` : il le reçoit d'`integrationReview`.
             */
            lane_id: attempt ? null : lane?.laneId ?? null,
            cwd: attempt?.dir ?? lane?.cwd ?? process.cwd(),
            reserved_touched: reservedTouched(r.changedFiles ?? []),
            // Une unité que le plan gelé ne connaît pas est un résultat, pas une
            // faute d'instrument : le plan n'avait pas prévu ce travail. Le plan
            // reste gelé, on ne l'y ajoute pas.
            unplanned:
              unit !== undefined &&
              plan().status === "usable" &&
              !plan().units.some((u) => u.id === unit),
            for_risks: forRisks,
            produced: !r.failure,
            read_only: isReadOnly(agent.tools),
            changed_files: r.changedFiles ?? [],
            artifact: r.artifact,
            failure: r.failure ?? null,
          })),
        );

        /*
         * L'intégration d'une lane approuvée, décidée par le runtime.
         *
         * Mécanique et non déclarative : l'orchestrateur ne peut pas oublier de
         * signaler une violation ni décider qu'un dépassement est acceptable.
         * Les portes d'intégration sont vérifiées ici et non ailleurs — chemin
         * réservé, dépassement de scope, verdict, risques encore ouverts, et
         * git en dernier. Nommées plutôt que comptées : une porte de plus ne
         * doit pas laisser un commentaire faux derrière elle.
         *
         * Le worktree n'est retiré qu'après une intégration réussie. Une lane
         * revue mais non intégrable garde son arbre : c'est là que le rework
         * reprendra, et l'effacer sur une review perdrait le travail.
         */
        let integration = "";
        let porteIntegration: { outcome: "blocked"; policy_blockers: string[] } | undefined;

        /*
         * Le cycle d'une tentative d'intégration, décidé par le runtime.
         *
         * Il précède l'intégration de lane et l'exclut : tant qu'une tentative
         * vit, ce qui doit entrer dans la base est son résultat, pas la branche
         * de la lane. Les deux chemins ne se rencontrent jamais.
         */
        if (attempt && unit && !results[0]?.failure) {
          if (params.agent === "integration-worker") {
            /*
             * Le scope, mécanique et non déclaratif.
             *
             * `changedFiles` vient de `dispatch`, qui compare l'arbre avant et
             * après l'enfant : ce n'est pas ce que l'agent dit avoir touché.
             *
             * Un dépassement ne s'absorbe pas. Le signal « il faut aussi
             * modifier foo.ts » veut dire que le contenu de l'unité doit
             * évoluer, et une unité évolue dans sa lane, sous sa propre review.
             * L'absorber ici transformerait progressivement « résoudre P1 × P2 »
             * en « continuer à développer W03 pendant le merge ».
             */
            const horsScope = (results[0]?.changedFiles ?? []).filter(
              (f) => !attempt.conflicts.includes(f),
            );
            /*
             * Le chemin sûr que son mandat lui prescrit compte autant que le
             * dépassement mécanique.
             *
             * On lui dit : si un fichier hors conflits semble nécessaire, ne le
             * touche pas, mets-le dans `deviations`. Un agent qui obéit
             * parfaitement produisait donc `horsScope = []` et une résolution
             * annoncée prête — qui pouvait finir intégrée en emportant le
             * problème signalé. La récompense de l'obéissance était de rendre le
             * signal invisible.
             *
             * Le contrôle mécanique reste souverain sur ce qu'il a écrit ; la
             * déclaration s'y ajoute, elle ne le remplace pas.
             */
            const signale = (results[0]?.deviations ?? []).filter(Boolean);
            if (horsScope.length > 0 || signale.length > 0) {
              /*
               * La tentative se termine ; l'unité, non.
               *
               * Rien n'est enregistré au registre **des lanes** : `W03` y reste
               * `OPEN`, et c'est la distinction qui compte — une tentative
               * abandonnée n'est pas une unité abandonnée. Le registre des
               * tentatives, lui, enregistre bien sa clôture juste en dessous. Le contexte est retiré, sans quoi notre
               * propre règle « worker refusé si une tentative est ouverte »
               * interdirait le retour en lane qu'on demande.
               *
               * Et rien n'est recopié du contexte vers la lane. Une correction
               * qui semble bonne n'a pas été revue pour ce qu'elle est ; la
               * transporter serait une porte dérobée autour du cycle worker →
               * reviewer de l'unité.
               */
              // La vérité d'abord : un crash après `CLOSED` ne laisse qu'un
              // résidu connu, là où l'ordre inverse laisserait un contexte que
              // rien ne dit terminé.
              noteAttempt({ event: "CLOSED", id: attempt.id, outcome: "returned-to-lane" }, lease);
              removeIntegration(process.cwd(), attempt.id);
              ATTEMPTS.delete(unit);
              const motif = horsScope.length > 0
                ? `    hors des fichiers en conflit : ${horsScope.join(", ")}\n`
                : `    signalé hors résolution : ${signale.join(" ; ")}\n`;
              integration =
                `  TENTATIVE ABANDONNÉE  ${unit} : ${attempt.id}\n` +
                motif +
                "    aucune intégration, aucun commit, le registre est inchangé et l'unité\n" +
                "    reste ouverte. Sa lane n'a pas été touchée : ces changements ne sont pas\n" +
                "    transportés, ils sont à refaire là où ils seront revus.\n" +
                `    déléguer : agent=worker work_unit=${unit}, en lui disant ce que la\n` +
                `    résolution d'intégration a révélé : ${[...horsScope, ...signale].join(" ; ")}.`;
            } else {
              integration =
                `  RÉSOLUTION PRÊTE  ${unit} : ${attempt.id}\n` +
                `    déléguer : agent=reviewer work_unit=${unit}`;
            }
          } else if (params.agent === "reviewer") {
            if (results[0]?.verdict !== "approved") {
              integration =
                `  RÉSOLUTION NON APPROUVÉE  ${unit} : la tentative ${attempt.id} reste ouverte.\n` +
                `    déléguer : agent=integration-worker work_unit=${unit}`;
            } else {
              /*
               * Approuvée : le runtime crée `M` et l'intègre, dans cet ordre, et
               * n'enregistre qu'après. `commitIntegration` recalcule le tree et
               * refuse s'il a changé depuis la review ; `landIntegration`
               * revalide `M` avant de toucher la racine.
               */
              /*
               * Une tentative peut venir d'un runtime antérieur à C0 v1.8 : elle existe
               * alors malgré le `design_update` que la version courante doit fermer.
               * La garde du chemin ordinaire ne sera jamais revisitée ici. On la rejoue
               * donc avant même de construire M, et a fortiori avant son atterrissage.
               */
              /*
               * La barrière des risques, avant toute construction de `M` (C3.4, PLAN-LOT7 Q10).
               *
               * Le reviewer de tentative a écrit ses transitions RISK plus haut, sans REVIEWED ;
               * la projection autoritaire de l'unité est relue ici. Un risque ouvert ferme la
               * tentative par la cause C3.7 `open-risks` ; un état inconnu la ferme sans liste.
               * LOT 9 reste propriétaire de la transition d'intégration complète.
               */
              const barriere = barriereDesRisques(unit, results[0]);
              const statutFerme = refusDesignUpdate(unit);
              if (barriere) {
                if (barriere.ouverts) porteIntegration = { outcome: "blocked", policy_blockers: ["open-risks"] };
                integration =
                  `  NON INTÉGRABLE  ${unit} : ${barriere.raison}\n` +
                  `    la tentative ${attempt.id} reste ouverte ; aucun commit d'intégration, ` +
                  "aucun merge, aucun INTEGRATED.";
              } else if (statutFerme) {
                integration =
                  `  NON INTÉGRABLE  ${unit} : ${statutFerme}\n` +
                  `    la tentative ${attempt.id} reste ouverte ; aucun commit d'intégration, ` +
                  "aucun merge, aucun INTEGRATED.";
              } else {
                const m = commitIntegration(attempt, integrationPkg?.tree ?? "", unit);
                if (!m.ok && m.committed) {
                  /*
                   * Le commit a eu lieu et sa forme est fausse. Le contexte n'est
                   * plus sur `P1`, n'a plus de `MERGE_HEAD`, et porte un objet
                   * qu'on refuse d'intégrer : personne ne peut continuer dessus.
                   * Y renvoyer un integration-worker le ferait travailler dans un
                   * état qu'aucune suite ne reprend, pendant que le worker de la
                   * lane reste interdit — un blocage sans sortie.
                   */
                  noteAttempt({ event: "RECOVERY_REQUIRED", id: attempt.id, reason: m.reason }, lease);
                  ATTEMPTS.set(unit, { attempt, phase: "recovery-required" });
                  integration =
                    `  REPRISE REQUISE  ${unit} : ${m.reason}\n` +
                    `    le contexte ${attempt.id} porte un commit dont la forme est fausse.\n` +
                    "    aucune délégation sur cette unité tant qu'un opérateur ne l'a pas tranché ;\n" +
                    "    le contexte est conservé pour ça.";
                } else if (!m.ok) {
                  integration = `  INTÉGRATION REFUSÉE  ${unit} : ${m.reason}`;
                } else {
                  /*
                   * `M` existe : le registre le dit avant qu'on tente de le faire
                   * atterrir. Un crash entre les deux laisserait sinon un contexte
                   * portant un commit dont aucune provenance ne parle.
                   */
                  noteAttempt({
                    event: "COMMITTED",
                    id: attempt.id,
                    commit: m.integration.commit,
                    tree: m.integration.tree,
                  }, lease);
                  const atterri = landIntegration(process.cwd(), m.integration, (commit) =>
                    appendLaneEvent(
                      RUN_DIR,
                      {
                        event: "INTEGRATED",
                        work_unit: unit,
                        at: new Date().toISOString(),
                        integration_commit: commit,
                      },
                      lease,
                    ),
                  );
                  if (atterri.ok) {
                    noteAttempt({ event: "CLOSED", id: attempt.id, outcome: "integrated" }, lease);
                    ATTEMPTS.delete(unit);
                    INTEGRATED.add(unit);
                    OPEN_UNITS.delete(unit);
                    integration = `  intégrée : ${unit} par ${atterri.commit.slice(0, 12)}`;
                  } else if (atterri.stale) {
                    /*
                     * La base a bougé pendant la review : on rouvre sur le même
                     * `P2` et le nouveau `P1`. La même transition sert à la
                     * reprise d'un `ready-to-land` — deux machines séparées en
                     * avaient produit une qui ne rouvrait jamais.
                     *
                     * Renvoyer vers une review de lane était inexécutable : le
                     * dernier agent est le reviewer d'intégration, et la garde
                     * globale refuse une review qu'aucun worker ne sépare de la
                     * précédente.
                     */
                    integration = reopenStaleAttempt(unit, attempt, lease, atterri.reason);
                  } else {
                    /*
                     * `M` existe et vaut ; seul son atterrissage a échoué, pour une
                     * raison hors du runtime. La tentative attend une reprise, elle
                     * ne retourne pas à la résolution.
                     */
                    ATTEMPTS.set(unit, { attempt, phase: "ready-to-land", landing: m.integration });
                    integration =
                      `  ATTERRISSAGE BLOQUÉ  ${unit} : ${atterri.reason}\n` +
                      `    ${m.integration.commit.slice(0, 12)} est construit et vérifié ; il attend\n` +
                      "    une racine propre. La prochaine délégation sur cette unité réessaiera.";
                  }
                }
              }
            }
          }
        } else if (lane && !attempt && params.agent === "reviewer" && !results[0]?.failure) {
          /*
           * La revue, rendue durable avant que la porte ne la lise (C2.2).
           *
           * Écrite quel que soit le verdict : une revue défavorable déplace aussi la
           * frontière, elle n'approuve pas. Sans enveloppe exploitable, sous bail perdu,
           * ou si l'écriture échoue, rien n'est enregistré et la porte se ferme : une
           * approbation qu'aucune relecture ne retrouverait n'autorise rien.
           */
          const revueNonEnregistree = revueTraitee !== undefined
            ? revueTraitee.refus
            : snapshotDeRevue === undefined
            ? "le paquet de revue n'a pas été observé ; aucune revue n'est enregistrée"
            : enregistrerRevue(
              lane,
              results[0],
              seqs[0],
              // L'agent réellement délégué, et son rôle d'enveloppe : une variante de modèle
              // (`reviewer-gemini`) revoit sous le rôle `reviewer`.
              { agent: params.agent, role: agent.envelopeRole ?? agent.name },
              { fromTree: snapshotDeRevue.fromTree, tree: snapshotDeRevue.tree, proof: pkg.proof },
              lease,
            );
          /*
           * L'état autoritaire de la lane, relu APRÈS l'écriture de la revue et avant toute
           * décision (Q8) : chaîne des revues, violations historiques, base. La porte ne lit
           * aucun cache de l'appel.
           */
          const etat = etatAutoritaire(lane.laneId, lane.workUnitId);
          const fermeC2 = revueNonEnregistree ?? refusDeCouverture(lane, etat);
          /*
           * Les causes C3 (C3.1, C3.7), toutes calculées ici et seulement ici : la décision
           * et la sortie structurée dérivent du même ensemble. `inconnu` dit qu'on n'a pas pu
           * les établir : la porte se ferme alors sans présenter une liste partielle.
           */
          const blocks: string[] = [];
          let inconnu: string | undefined = etat.connu ? undefined : etat.raison;

          /*
           * Une review approuvée qui laisse un risque ouvert n'est pas terminée.
           *
           * C'est le cas que tout le pont reviewer → scout → follow-up review
           * existe pour traiter. Intégrer là-dessus retirerait le worktree, et
           * la continuation repartirait d'une base contenant déjà le changement :
           * son diff serait vide pendant que la frontière de review croit encore
           * avoir quelque chose à poursuivre.
           *
           * Lu au registre autoritaire, sous `(R, work_unit, id)`, toutes générations
           * confondues (C3.4, PLAN-LOT7 Q7) ; jamais dans la mémoire de la session.
           */
          if (etat.connu && etat.risques.length > 0) blocks.push("open-risks");

          /*
           * Le dépassement de scope est recalculé sur l'état final de la lane,
           * il n'est pas retenu depuis la délégation qui l'a produit.
           *
           * Un rework qui annule le fichier hors périmètre doit rendre la lane
           * intégrable : le run 15 a mesuré 6 dépassements sur 46 écritures, et
           * un blocage définitif y aurait produit des lanes irrécupérables
           * autrement qu'à la main. Ce qui compte pour intégrer est ce que la
           * lane contient, pas ce qu'elle a traversé.
           */
          const unitDef = plan().units.find((u) => u.id === lane.workUnitId);
          let finalFiles: string[] = [];
          try {
            finalFiles = laneChanges(process.cwd(), lane.laneId);
          } catch (err) {
            inconnu ??= `observation de la lane impossible : ${err instanceof Error ? err.message : String(err)}`;
          }
          if (scopeBreach(unitDef, finalFiles).length > 0) blocks.push("scope-breach");
          /*
           * Les violations historiques (C3.1) : vraies si le recalcul sur l'état final
           * contre la base est non vide, OU si un VIOLATION existe pour la lane. Ni une
           * restauration, ni une revue ne les lèvent ; seul l'abandon de la lane (C3.5).
           */
          const recalcul = naturesViolees(finalFiles);
          const histoire = etat.connu ? etat.violations : [];
          if (recalcul.reserved.length > 0 || histoire.some((v) => v.kind === "reserved-violation")) {
            blocks.push("reserved-violation");
          }
          if (recalcul.bundle.length > 0 || histoire.some((v) => v.kind === "bundle-violation")) {
            blocks.push("bundle-violation");
          }
          const causesC3 = [...new Set(blocks)].sort();
          if (!inconnu && causesC3.length > 0) {
            porteIntegration = { outcome: "blocked", policy_blockers: causesC3 };
          }
          /*
           * L'ordre — merge, puis preuve, puis nettoyage — est tenu par
           * `integrateLane`, pas par la disposition des lignes ci-dessous.
           * C'est ici, et seulement ici, qu'une unité devient une dépendance
           * satisfaite : intégrée, pas terminée.
           */
          /*
           * C0 v1.8 : sans traitement du Statut, seule une unité SANS design_update
           * s'intègre, par la forme historique d'INTEGRATED. Le refus précède le merge ;
           * il ne touche ni la lane ni la racine, et un rework ne le lève pas — seul le
           * plan le peut.
           */
          const fermeInconnu = inconnu ? `état de la lane inconnu : ${inconnu}` : undefined;
          const statutFerme = causesC3.length === 0 && !fermeC2 && !fermeInconnu
            ? refusDesignUpdate(lane.workUnitId)
            : undefined;
          const fermeAvantGel = fermeInconnu ?? (causesC3.length === 0 ? fermeC2 ?? statutFerme : undefined);
          /*
           * Le gel (C2.4, PLAN-LOT8 Q3) : seulement quand plus rien d'autre ne ferme la porte.
           * Commit, relecture par git du parent et du tree, `FROZEN` durable — et seulement
           * ensuite le merge. Un gel non conforme se défait et se classe ; un `FROZEN` non
           * écrit ferme sans merge.
           */
          const gel = fermeAvantGel || causesC3.length > 0 ? undefined : gelerLane(lane, lease);
          const ferme = fermeAvantGel ?? (gel !== undefined && !gel.ok ? gel.raison : undefined);
          const merged: ReturnType<typeof integrateLane> = ferme || causesC3.length > 0
            ? { ok: false, conflicts: [], reason: ferme ?? causesC3.join(", ") }
            : integrateLane(
            process.cwd(),
            lane.laneId,
            [],
            mergeMessage(lane.workUnitId),
            (commit) =>
              appendLaneEvent(
                RUN_DIR,
                {
                  event: "INTEGRATED",
                  work_unit: lane.workUnitId,
                  at: new Date().toISOString(),
                  integration_commit: commit,
                },
                lease,
              ),
            // R2 : un FROZEN durable fait de son commit le seul candidat au merge.
            gel?.ok && gel.commit !== undefined && gel.parent !== undefined && gel.tree !== undefined
              ? { commit: gel.commit, parent: gel.parent, tree: gel.tree }
              : undefined,
          );
          if (merged.ok) {
            INTEGRATED.add(lane.workUnitId);
            OPEN_UNITS.delete(lane.workUnitId);
            integration = `  intégrée : ${lane.workUnitId}`;
          } else if (ferme) {
            integration = `  NON INTÉGRABLE  ${lane.workUnitId} : ${ferme}`;
          } else if (causesC3.length > 0) {
            integration = `  NON INTÉGRABLE  ${lane.workUnitId} : ${causesC3.join(", ")}` +
              (fermeC2 ? ` ; ${fermeC2}` : "");
          } else if (merged.conflicts.length > 0) {
            /*
             * Le conflit ouvre un contexte, il ne se contente plus de l'annoncer.
             *
             * `P2` vient de `frozenCommit` et jamais de `laneTip` : le rollback
             * a ramené la branche à `previousHead` pour que la lane redevienne
             * sale et son travail visible, donc la branche ne porte plus le
             * commit que git vient d'essayer d'intégrer. Partir de la branche
             * ouvrirait la tentative sur l'état que le reviewer n'a pas approuvé.
             *
             * Une lane déjà propre n'a pas eu de gel à faire : `laneTip` est
             * alors le bon `P2`, et c'est le seul cas où on le lit.
             */
            const p2 = merged.frozenCommit ?? laneTip(process.cwd(), lane.laneId);
            /*
             * C2.6, PLAN-LOT8 Q4 : `p2` est le gel vivant de la lane, et rien d'autre. Son
             * commit est celui du `FROZEN`, son tree celui que ce `FROZEN` porte ; sinon aucune
             * tentative ne s'ouvre.
             */
            const horsGel = gel?.ok && gel.commit !== undefined
              ? p2 !== gel.commit
                ? `p2 ${String(p2).slice(0, 12)} n'est pas le gel ${gel.commit.slice(0, 12)}`
                : (() => {
                  try {
                    const t2 = treeOfCommit(process.cwd(), p2);
                    return t2 === gel.tree ? undefined : `tree(p2) ${t2.slice(0, 12)} n'est pas le tree gelé`;
                  } catch (err) {
                    return err instanceof Error ? err.message : String(err);
                  }
                })()
              : undefined;
            const seqTentative = p2 && !horsGel ? allocateSeq(RUN_DIR, lease).seq : 0;
            const ouverture = horsGel
              ? { ok: false as const, reason: `aucune tentative sur un commit hors gel : ${horsGel}` }
              : p2
              ? openIntegration(
                  process.cwd(),
                  attemptId(RUN_ID, lane.workUnitId, seqTentative),
                  p2,
                )
              : { ok: false as const, reason: "aucun commit de lane à intégrer" };

            if (ouverture.ok) {
              /*
               * Le contexte existe, puis le registre le dit, puis la mémoire le
               * sait. L'inverse laisserait une tentative que le disque ignore.
               */
              noteAttempt({
                event: "ATTEMPT_OPENED",
                id: ouverture.attempt.id,
                work_unit: lane.workUnitId,
                seq: seqTentative,
                p1: ouverture.attempt.p1,
                p2: ouverture.attempt.p2,
                conflicts: [...ouverture.attempt.conflicts],
              }, lease);
              ATTEMPTS.set(lane.workUnitId, { attempt: ouverture.attempt, phase: "resolving" });
              integration =
                `  CONFLIT D'INTÉGRATION  ${lane.workUnitId}\n` +
                `    tentative : ${ouverture.attempt.id}\n` +
                `    fichiers  : ${ouverture.attempt.conflicts.join(", ")}\n` +
                `    déléguer  : agent=integration-worker work_unit=${lane.workUnitId}\n` +
                "    la lane garde son travail ; le contexte est ailleurs et le runtime en\n" +
                "    tient les clés. Ne pas relancer worker ni reviewer sur cette unité.";
            } else {
              // Le conflit reste vrai même si le contexte n'a pas pu s'ouvrir :
              // le dire autrement laisserait croire que l'intégration a échoué
              // pour une autre raison.
              integration =
                `  CONFLIT  ${lane.workUnitId} : ${merged.conflicts.join(", ")}\n` +
                `    contexte d'intégration impossible : ${ouverture.reason}`;
            }
          } else {
            // Un échec sans fichier en conflit n'est pas un conflit : un gel
            // impossible, par exemple. Le rendre comme « CONFLIT : » vide
            // laissait le travail intact et perdait la cause.
            integration = `  ÉCHEC INTÉGRATION  ${lane.workUnitId} : ${merged.reason}`;
          }
        }

        const result = results[0];

        // Only the summary crosses back. The envelope stays on disk; the
        // orchestrator reads the artifact when it actually needs the findings.
        // The model is named only when it is not the declared one: a fallback
        // took over, and the orchestrator should know which answer it is reading.
        const via = result.modelUsed === agent.model ? "" : ` via ${result.modelUsed}`;

        // The outcome, not the completion. `status` is `ok` on every run that
        // reached submit, a rejected review included — measured on run 3ed33e,
        // four reviews returned `needs_rework` and all four arrived here as
        // `ok`. The counts follow so the artefact is opened when there is
        // something in it, rather than on every review to find out.
        const outcome = result.verdict ?? result.status;
        const counts = countsLine(result);

        // The risks themselves, under the count that announces them. The count
        // alone sent the orchestrator back to the artefact fourteen times on run
        // 14, five of those through a python heredoc, to read strings this
        // process had already parsed to produce the count.
        // L'instruction d'abord, le diagnostic qui la fonde ensuite, les
        // questions ouvertes en dernier. Sur `approved`, `action` est absent et
        // seul le compte reste : run 15 montre l'orchestrateur payer un accès
        // sur deux reviews approuvées pour décider, les deux fois, de ne rien
        // faire maintenant.
        const action = actionLines(result.action);
        const risks = riskLines(result.openRiskItems);
        // Une écriture sur un chemin réservé n'est pas un dépassement de scope :
        // la délégation n'en a jamais eu la propriété. Constatée après coup —
        // le runtime n'intercepte pas les écritures d'un enfant — mais dite là
        // où l'orchestrateur la verra, et non seulement dans un journal.
        const reserved = results
          .flatMap((r) => reservedTouched(r.changedFiles ?? []))
          .filter((p, i, all) => all.indexOf(p) === i);
        // Dans la ligne de tête et pas seulement en dessous : une délégation qui
        // a écrit sur un chemin dont elle n'est pas propriétaire ne doit pas
        // pouvoir passer pour un `ok` ordinaire. Le travail reste sur le disque
        // — le jeter pour une écriture annulable coûterait plus qu'il ne
        // protège — mais la lane cesse d'être intégrable, et la porte de merge
        // ci-dessus en fait la conséquence.
        const violation = reserved.length
          ? `  ${reserved.join(", ")} — la lane n'en est pas propriétaire, non intégrable`
          : "";
        const under = [bilan, violation, integration, action, risks].filter(Boolean).join("\n");

        const head = result.failure
          ? `[${result.role}: ${result.failure}${result.fromTree ? `, ${result.changedFiles?.length} file(s) on disk` : ""}${via}]`
          : `[${result.role}: ${outcome}${counts ? `, ${counts}` : ""}${via}${reserved.length ? ", RESERVED VIOLATION" : ""}]${under ? `\n${under}` : ""}`;

        // Say which skills came without a severity table. The review still
        // ran; the operator should know one domain was judged on the generic
        // definitions alone rather than discover it from an odd verdict.
        const note = result.withoutDelta.length
          ? `\n(no severity table for: ${result.withoutDelta.join(", ")})`
          : "";

        // One nudge per session, fired only on evidence: a reviewer reporting
        // something outside the file it was given has answered a where-question
        // the expensive way, in the one role forbidden from weighing the answer.
        const scoutHint =
          SCOUT_CALLS === 0 && result.role === "reviewer" && (result.outOfScope ?? 0) > 0
            ? "\n(out_of_scope is a where-question answered inside a review. A scout resolves it for a fraction of the cost, and the locations it returns are files the next review may weigh.)"
            : "";
        // One call, not one per child: the counter is named for calls and its only
        // use is "has a scout ever run", so a fan-out of four is one. The same
        // child-versus-call ambiguity the streak guard just lost.
        if (params.agent === "scout") SCOUT_CALLS += 1;

        // A fan-out returns one block per scout, in the order the questions were
        // asked. Nothing is merged: four answers to four questions are four
        // answers, and the subtraction between two of them is the
        // orchestrator's — it is the only party holding both.
        const body =
          results.length > 1
            ? results
                .map((r, i) => {
                  const rVia = r.modelUsed === agent.model ? "" : ` via ${r.modelUsed}`;
                  const rHead = r.failure
                    ? `[${r.role}: ${r.failure}${rVia}]`
                    : `[${r.role}: ${r.verdict ?? r.status}${rVia}]`;
                  return `${i + 1}. Find: ${questions[i]}\n${rHead} ${r.summary}\n${r.artifact}`;
                })
                .join("\n\n")
            : `${head} ${result.summary}${note}${scoutHint}` +
              // The advisor's recommendation crosses with the summary. Every
              // other role's payload waits on disk because a head plus a count
              // says whether opening it is worth a turn; an advice has no such
              // signal — the sentence is the deliverable.
              (result.recommendation ? `\nRecommendation: ${decodeEscapes(result.recommendation)}` : "") +
              `\n${result.artifact}`;

        // `details` describes the whole call, not its first child — see
        // subagent-only/fanout.ts, which the tests import rather than copy.
        const details = aggregateFanout(results);

        return {
          content: [{ type: "text" as const, text: body }],
          // C3.7 : les causes de politique, structurées, seulement quand la porte les a établies.
          details: porteIntegration ? { ...details, integration_gate: porteIntegration } : details,
          isError: details.status === "failed",
        };
        }
      },
    }),
  );

  /**
   * Les unités qu'un appel fera avancer : celle du chemin simple, telle que `execute` la
   * résoudra (`targetWorkUnit`), ou celles du lot. Un rôle global n'en fait avancer aucune.
   */
  function unitesDeLAppel(params: Static<typeof parameters>): string[] {
    // Les champs lus ici, sous leur forme de schéma ; rien d'autre de l'appel n'est consulté.
    const p = params as unknown as {
      agent: string;
      work_unit?: string;
      for_risks?: string[];
      batch?: ReadonlyArray<{ work_unit?: string }>;
    };
    const agent = agents.get(p.agent);
    if (!agent || !isLaneBound(agent.envelopeRole ?? agent.name)) return [];
    if (p.batch !== undefined) return p.batch.map((b) => b.work_unit?.trim() ?? "").filter(Boolean);
    const cible = cibleDesRisques(p.work_unit, p.for_risks ?? []).cible;
    return cible.kind === "unit" ? [cible.workUnitId] : [];
  }
}

/** Descriptions come from the definitions, so the menu cannot drift from them. */
function agentMenu(agents: Map<string, { description: string; model: string }>): string {
  return [...agents.entries()].map(([n, a]) => `${n}: ${a.description}`).join(" | ");
}
