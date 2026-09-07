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
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadAgents } from "../../subagent-only/agents.js";
import { dispatch, type RunResult } from "../../subagent-only/dispatch.js";
import { actionLines, countsLine, riskLines } from "../../subagent-only/counts.js";
import {
  continuationReturned,
  openRisks,
  riskChannel,
  routeRisks,
  type LedgerEvent,
  type RiskRecord,
} from "../../subagent-only/risk-ledger.js";
import { openLane, targetWorkUnit, type LaneContext } from "../../subagent-only/lane-context.js";
import { anySignal } from "../../subagent-only/signals.js";
import { RUN_STATUS_KEY, type RunSnapshot } from "../../subagent-only/run-state.js";
import {
  RecoveryError,
  RunBusyError,
  LANE_LEDGER_VERSION,
  acquireRunOwnership,
  appendIntegrationEvent,
  appendLaneEvent,
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
import {
  SchedulerInputError,
  runLanes,
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
  confirmIntegrations, ensureLane, integrateLane, isMerged, laneChanges, laneTip,
  mergeMessage, openLanes, runBranches, type MergeBlock,
} from "../../subagent-only/worktree.js";
import {
  describeConflicts, integrationCommits, reconcile, type Conflict,
} from "../../subagent-only/lane-ledger.js";
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
  const pris = acquireRunOwnership(RUN_DIR, RUN_ID, SESSION_ID);
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
 * Ce qui empêche une lane d'être intégrée, et que l'orchestrateur ne peut pas
 * oublier de signaler.
 *
 * Accumulé par le runtime au fil des délégations. Une violation ou un
 * dépassement constaté une fois ne s'efface pas parce qu'une review ultérieure
 * approuve : ce n'est pas le reviewer qui juge si une hypothèse de concurrence
 * tient encore.
 */
const LANE_BLOCKS = new Map<string, Set<MergeBlock>>();

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

function blockLane(laneId: string, block: MergeBlock): void {
  const set = LANE_BLOCKS.get(laneId) ?? new Set<MergeBlock>();
  set.add(block);
  LANE_BLOCKS.set(laneId, set);
}

/**
 * Every risk a review left open in this session, and what became of it.
 *
 * Reassigned rather than mutated: the transitions in `risk-ledger.ts` are pure,
 * so the state cannot be half-applied by a throw between two writes. Nothing
 * reads this to allow or refuse anything — see the module header. It exists to
 * be written down.
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
 * Gardé pour le relevé, et pour lui seul : aucune décision ne le lit. Le relevé
 * ne doit pas reconstruire de son côté — il consommerait `observeLanes` et
 * `observeIntegrations` une seconde fois, à un autre instant, et publierait un
 * état que le runtime n'a jamais eu. C'est la divergence de 3c.1, transposée
 * d'un outil à un rapport.
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
 * Enregistre l'ouverture d'une lane, une fois qu'elle existe.
 *
 * Après `openLane`, jamais avant : le registre enregistre des faits accomplis.
 * Un `OPENED` écrit d'abord pourrait décrire une ouverture qui n'a jamais eu
 * lieu, et un registre qui affirme faux falsifie la provenance de tout le run.
 * L'ordre retenu laisse au pire un worktree sans provenance — visible, nommé
 * « orphelin », et adoptable explicitement.
 *
 * Seulement à la création : un rework rouvre la même lane, et le registre décrit
 * sa vie, pas chacune de ses utilisations.
 */
function noterOuverture(unit: string, lease: Lease, base: string | undefined): void {
  const nouvelle = !OPEN_UNITS.has(unit);
  OPEN_UNITS.add(unit);
  if (!nouvelle) return;
  if (!base) {
    // Sans base, l'ouverture ne serait pas prouvable et le registre la
    // refuserait comme malformée. Mieux vaut ne pas ouvrir du tout : un
    // worktree sans provenance se voit et se tranche, une ouverture bancale se
    // découvre après le merge.
    throw new RecoveryError(
      `impossible de déterminer la base de ${unit} : la lane n'est pas ouvrable`,
    );
  }
  appendLaneEvent(
    RUN_DIR,
    { event: "OPENED", work_unit: unit, at: new Date().toISOString(), base },
    lease,
  );
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

function refuse(agentName: string, tools: readonly string[]): string | null {
  const last = HISTORY[HISTORY.length - 1];
  const before = HISTORY[HISTORY.length - 2];

  // Unconditional on the verdict: no worker has run, so not one line of code
  // differs. Reading the verdict would make the guard depend on an envelope
  // field being parsed correctly; this does not. The exception is a review
  // that returned nothing — refusing its replacement would trap the session —
  // and two failures in a row still stop, so the retry is bounded at one.
  if (
    agentName === "reviewer" &&
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
  const sinceReview = [...HISTORY].reverse().findIndex((d) => d.agent === "reviewer");
  if (agentName === "reviewer" && sinceReview > 0) {
    const between = HISTORY.slice(HISTORY.length - sinceReview);
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
  const streak = streakOf(HISTORY, agentName);
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
}

function diffSection(paths: string[], cwd: string): DiffPackage {
  const all = paths.filter(Boolean);
  if (all.length === 0) return { text: "", degraded: false };

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
  });

  if (files.length === 0) return { text: alsoChanged, degraded: false };
  if (files.length > DIFF_MAX_FILES) return readingList("too many to inline");

  const diff = gitDiffFor(files, cwd);
  if (!diff.trim()) return { text: alsoChanged, degraded: false };
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

      async execute(_id, params: Static<typeof parameters>, { signal }: { signal?: AbortSignal } = {}) {
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
        const blocked =
          (params.agent === "scout" ? checkScoutInput(params) : null) ??
          refuse(params.agent, agent.tools);
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
        const forRisks = params.for_risks ?? [];
        const cont =
          params.agent === "reviewer" ? continuationSection(forRisks, RISKS) : "";

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
        const target = targetWorkUnit(params.work_unit, forRisks, RISKS);
        if (target.kind === "conflict") {
          return {
            content: [{ type: "text" as const, text: `Refused: lane provenance conflict — ${target.reason}` }],
            isError: true,
          };
        }
        const unit = target.kind === "unit" ? target.workUnitId : undefined;

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

        if (RECOVERY_LEDGER_VERSION !== LANE_LEDGER_VERSION) {
          const trouve = RECOVERY_LEDGER_VERSION === undefined
            ? "aucune version déclarée"
            : `version ${RECOVERY_LEDGER_VERSION}`;
          return {
            content: [{
              type: "text" as const,
              text:
                `[run: registre d'une autre version] ${RUN_ID}-lanes.jsonl : ${trouve}, ` +
                `ce runtime lit la version ${LANE_LEDGER_VERSION}.\n` +
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
          let baseLane: string | undefined;
          try {
            lane = openLane(unit, { runId: RUN_ID, root: process.cwd() }, (r, id) => {
              const l = ensureLane(r, id);
              baseLane = l.base;
              return l;
            });
          } catch (err) {
            return {
              content: [{
                type: "text" as const,
                text: `Refused: cannot open lane for ${unit} — ${err instanceof Error ? err.message : String(err)}`,
              }],
              isError: true,
            };
          }

          /*
           * L'ouverture a eu lieu ; c'est son enregistrement qui peut refuser.
           *
           * Les deux échecs étaient sous le même `catch`, avec le même message
           * « cannot open lane » — alors que le worktree existe déjà et que le
           * problème est ailleurs. Dire lequel des deux a échoué décide de ce que
           * l'opérateur doit faire : rien, ou trancher un orphelin.
           */
          try {
            noterOuverture(unit, lease, baseLane);
          } catch (err) {
            const quoi = err instanceof Error ? err.message : String(err);
            return {
              content: [{
                type: "text" as const,
                text:
                  `[run: ouverture non enregistrée] le worktree de ${unit} existe, ` +
                  `son ouverture n'a pas pu être écrite au registre — ${quoi}\n` +
                  `Il apparaîtra comme « worktree-orphelin » à la prochaine lecture : ` +
                  `l'adopter ou le retirer avec bin/subagent-recover.`,
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

        const pkg = integrationPkg
          ? { text: integrationPkg.text, degraded: false, diffChars: integrationPkg.text.length }
          : params.agent === "reviewer" && changed.length > 0
            ? diffSection(changed, lane?.cwd ?? process.cwd())
            : { text: "", degraded: false, diffChars: 0 };

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
          let outcomes;
          try {
            outcomes = await runLanes(
              candidates,
              {
                units: plan().units,
                integrated: INTEGRATED,
                collide: scopesCollide,
                // Toute lane ouverte et non intégrée possède encore ses fichiers,
                // y compris celles d'un appel précédent : le scheduler ne les
                // verrait pas autrement.
                owners: plan().units.filter((u) => OPEN_UNITS.has(u.id)),
              },
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
                let baseLane: string | undefined;
                const lane = openLane(workUnit.id, { runId: RUN_ID, root: process.cwd() }, (r, id) => {
                  const l = ensureLane(r, id);
                  baseLane = l.base;
                  return l;
                });
                noterOuverture(workUnit.id, lease, baseLane);
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
                if (reservedTouched(result.changedFiles ?? []).length > 0) {
                  blockLane(lane.laneId, "reserved-violation");
                }
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
        if (lane) {
          for (const r of results) {
            // Une violation de chemin réservé est un événement : la lane n'a
            // jamais eu le droit d'écrire là, et aucune reprise ne l'annule.
            if (reservedTouched(r.changedFiles ?? []).length > 0) {
              blockLane(lane.laneId, "reserved-violation");
            }
          }
        }

        const events: LedgerEvent[] = [];
        const channel = riskChannel(params.agent);
        if (channel === "continuation") {
          for (const r of results) {
            const back = r.failure
              ? routeRisks(RISKS, forRisks, `call:${batch}`)
              : continuationReturned(RISKS, forRisks, r.resolvedRisks ?? [], r.artifact);
            RISKS = back.ledger;
            events.push(...back.events);

            // New concerns after old ones, so a follow-up review that closes one
            // and raises another reads in that order in the journal.
            const fresh = openRisks(RISKS, r.openRiskItems, r.artifact, unit);
            RISKS = fresh.ledger;
            events.push(...fresh.events);
          }
        } else if (channel === "route" && forRisks.length > 0) {
          // Once per call, outside the loop over children. `routedTo` names the
          // call and not a child, so a fan-out of three scouts carrying two
          // risks is two transitions, not six — the same child-versus-call
          // ambiguity the streak guard and the scout counter both had to lose.
          const out = routeRisks(RISKS, forRisks, `call:${batch}`);
          RISKS = out.ledger;
          events.push(...out.events);
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
                  LANE_BLOCKS.delete(lane?.laneId ?? "");
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
        } else if (lane && !attempt && params.agent === "reviewer" && !results[0]?.failure) {
          const blocks = [...(LANE_BLOCKS.get(lane.laneId) ?? [])];
          if (results[0]?.verdict !== "approved") blocks.push("not-approved");

          /*
           * Une review approuvée qui laisse un risque ouvert n'est pas terminée.
           *
           * C'est le cas que tout le pont reviewer → scout → follow-up review
           * existe pour traiter. Intégrer là-dessus retirerait le worktree, et
           * la continuation repartirait d'une base contenant déjà le changement :
           * son diff serait vide pendant que la frontière de review croit encore
           * avoir quelque chose à poursuivre.
           */
          const pending = RISKS.filter(
            (r) => r.workUnitId === lane.workUnitId && r.status !== "resolved",
          );
          if (pending.length > 0) blocks.push("open-risks");

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
          const finalFiles = laneChanges(process.cwd(), lane.laneId);
          if (scopeBreach(unitDef, finalFiles).length > 0) blocks.push("scope-breach");
          /*
           * L'ordre — merge, puis preuve, puis nettoyage — est tenu par
           * `integrateLane`, pas par la disposition des lignes ci-dessous.
           * C'est ici, et seulement ici, qu'une unité devient une dépendance
           * satisfaite : intégrée, pas terminée.
           */
          const merged = integrateLane(
            process.cwd(),
            lane.laneId,
            blocks,
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
          );
          if (merged.ok) {
            LANE_BLOCKS.delete(lane.laneId);
            INTEGRATED.add(lane.workUnitId);
            OPEN_UNITS.delete(lane.workUnitId);
            integration = `  intégrée : ${lane.workUnitId}`;
          } else if (blocks.length > 0) {
            integration = `  NON INTÉGRABLE  ${lane.workUnitId} : ${blocks.join(", ")}`;
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
            const seqTentative = p2 ? allocateSeq(RUN_DIR, lease).seq : 0;
            const ouverture = p2
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
          details,
          isError: details.status === "failed",
        };
      },
    }),
  );
}

/** Descriptions come from the definitions, so the menu cannot drift from them. */
function agentMenu(agents: Map<string, { description: string; model: string }>): string {
  return [...agents.entries()].map(([n, a]) => `${n}: ${a.description}`).join(" | ");
}
