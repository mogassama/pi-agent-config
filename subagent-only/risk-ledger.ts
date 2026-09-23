/**
 * What became of every risk a review left open.
 *
 * Run 14 finished eleven deliverables carrying fourteen open risks and reported
 * the same thing as a run with none: `approved` meant both "what I could
 * examine is sound" and "nothing is left", and only the first is a claim a
 * reviewer can make. This records which of the two happened, per risk.
 *
 * It records facts, not judgement. There is no `kind`, no `where`, no
 * `exhaustive`, no `scoutable`, no `severity`. The moment the ledger held an
 * interpretation it would become the authority on routing, which belongs to the
 * orchestrator, and the reviewer would have become its source — the one thing
 * every version of this contract has refused. What is stored is the text as
 * written and the transitions that happened to it.
 *
 * An open risk blocks the integration of its own unit and the completion of the
 * run (C3.4, `open-risks`; `run completed`). What decides is never this module
 * nor the extension's memory: it is the durable RISK events of the lane ledger,
 * folded by the LOT 2 projection under `(R, work_unit, id)`. The functions here
 * compute which transitions a delegation produces; the ledger they are handed is
 * built from that projection, and only its texts come from memory
 * (PLAN-LOT7 Q5).
 *
 * A risk is identified by its unit AND its id: the same id raised on two units is
 * two risks, and settling one leaves the other open (B2-risque-cle).
 *
 * Pure over a plain array, on the pattern of `review-boundary.ts`: the
 * transitions are testable without a process, and the events are appended to a
 * best-effort JSONL (T4) beside the authoritative ledger. `still-open` and
 * `ignored` only ever reach that journal.
 */
import type { ReviewRisk } from "./counts.js";

export interface RiskRecord {
  id: string;
  text: string;
  /** Artefact of the review that opened it. */
  openedBy: string;
  /**
   * L'unité de travail de la review qui l'a ouvert, quand elle en avait une.
   *
   * C'est ce champ qui permet à un scout de continuation de retrouver sa lane
   * sans que l'orchestrateur la répète : le risque sait d'où il vient, donc le
   * runtime aussi. Absent quand la review n'appartenait à aucune unité — un
   * scout global reste global, il n'est pas rattaché de force.
   */
  workUnitId?: string;
  status: "open" | "routed" | "resolved";
  /**
   * The task call a continuation was engaged on, not the child that answered.
   *
   * A batched scout call carrying three risks spawns three children, and
   * pairing risk to child by position would be a guess: the orchestrator
   * reformulates each question, it does not copy the risk. What the ledger
   * needs to know is that the risks were sent; which answer came back to which
   * is in the artefacts.
   *
   * Kept when a continuation returns without settling the risk, so the last
   * attempt stays legible. The status is the state; this is provenance.
   */
  routedTo?: string;
  /** Artefact of the follow-up review that closed it. */
  resolvedBy?: string;
}

export type IgnoredReason = "unknown" | "not-entrusted" | "already-resolved";

/**
 * One line of `<runId>-risks.jsonl`, appended at each transition.
 *
 * `still-open` is the fact that a continuation came back and did not settle the
 * risk it was handed. It is not a measure of a reviewer forgetting the field.
 * The runtime cannot distinguish "examined and still cannot conclude" from
 * "omitted the array", and no extra field would let it: both produce the same
 * envelope. So the contract decides what the omission means — not resolved —
 * and the event is named for what is observable. The metric this supports is
 * *continuation risks not resolved*, and calling it anything else would be
 * claiming a cause the data does not carry.
 */
export type LedgerEvent =
  | { event: "opened"; id: string; by: string; chars: number }
  | { event: "routed"; id: string; to: string }
  | { event: "resolved"; id: string; by: string }
  | { event: "still-open"; id: string; by: string }
  | { event: "ignored"; id: string; reason: IgnoredReason; by: string };

export interface Applied {
  ledger: RiskRecord[];
  events: LedgerEvent[];
}

/**
 * What `for_risks` is allowed to do to the ledger, per role.
 *
 * The field carries two different meanings and neither belongs to a worker or
 * an advisor: on a scout it routes, on a reviewer it hands concerns back and
 * the runtime pastes their texts ahead of the diff. The first version keyed the
 * routing branch on `forRisks.length > 0` alone, so any non-reviewer arriving
 * with the field marked its risks `routed` — turning a mistake in the
 * orchestrator's prose into a fact the ledger asserts.
 *
 * A named function rather than a condition inside the extension, because the
 * rule is the kind that is quietly widened by the next edit and there was no
 * test that could see it while it lived inline.
 */
export function riskChannel(agent: string): "route" | "continuation" | "none" {
  if (agent === "reviewer") return "continuation";
  if (agent === "scout") return "route";
  return "none";
}

/** The key of a risk within a run: its unit and its id, never the id alone. */
function cle(workUnitId: string | undefined, id: string): string {
  return JSON.stringify([workUnitId ?? null, id]);
}

/** Records the risks a review just opened. Ids are assigned upstream, in `counts.ts`. */
export function openRisks(
  ledger: readonly RiskRecord[],
  items: readonly ReviewRisk[] | undefined,
  openedBy: string,
  workUnitId?: string,
): Applied {
  const next = ledger.map((r) => ({ ...r }));
  const events: LedgerEvent[] = [];
  if (!items || items.length === 0) return { ledger: next, events };

  const known = new Set(next.map((r) => cle(r.workUnitId, r.id)));
  for (const item of items) {
    // An id is a coordinate within its unit, so a repeat is the same risk seen
    // twice, not a second one. Nothing is compared textually anywhere in this module.
    if (known.has(cle(workUnitId, item.id))) continue;
    known.add(cle(workUnitId, item.id));
    next.push({ id: item.id, text: item.text, openedBy, status: "open", ...(workUnitId ? { workUnitId } : {}) });
    events.push({ event: "opened", id: item.id, by: openedBy, chars: item.text.length });
  }
  return { ledger: next, events };
}

/**
 * Marks risks as having a continuation engaged on them.
 *
 * Called when a scout is sent for them, and when a follow-up review is sent for
 * them and returns nothing at all — a review that produced no envelope examined
 * nothing, so treating its silence as "not resolved" would confuse a failed
 * process with a considered answer.
 */
export function routeRisks(
  ledger: readonly RiskRecord[],
  ids: readonly string[],
  routedTo: string,
  workUnitId?: string,
): Applied {
  const next = ledger.map((r) => ({ ...r }));
  const events: LedgerEvent[] = [];
  for (const id of ids) {
    const rec = next.find((r) => r.id === id && r.workUnitId === workUnitId);
    if (!rec) {
      events.push({ event: "ignored", id, reason: "unknown", by: routedTo });
      continue;
    }
    if (rec.status === "resolved") {
      events.push({ event: "ignored", id, reason: "already-resolved", by: routedTo });
      continue;
    }
    rec.status = "routed";
    rec.routedTo = routedTo;
    events.push({ event: "routed", id, to: routedTo });
  }
  return { ledger: next, events };
}

/**
 * A follow-up review came back. Applies what it settled, and what it did not.
 *
 * `entrusted` is the `for_risks` of that review's own task call; `resolved` is
 * the `resolved_risks` of its envelope. Two rules, and both were corrected by
 * an external review of the first version.
 *
 * *Provenance.* A review closes what was put in front of it and nothing else. An
 * id outside `entrusted` is ignored even when it names a real, open risk:
 * without the check, one review could clear a concern raised about another
 * change on the strength of a matching id. This is provenance, not
 * classification — the ledger does not weigh the claim, it only checks who was
 * asked.
 *
 * *An unsettled risk goes back to `open`, it does not stay `routed`.* The first
 * version left it `routed` for the rest of the run, which made the state mean
 * "was sent somewhere once" — true of almost everything by the end, and useless.
 * With the return, the three states carry their own weight: `open` is a concern
 * currently unresolved, `routed` is a continuation engaged from which no usable
 * review has come back, and `resolved` is closed by a review. A `routed` still
 * standing at the end of a run is then a real observation: the
 * `scout → follow-up review` chain was started and no envelope ever closed it.
 * The process may well have returned — what did not is a review that could be
 * read.
 */
export function continuationReturned(
  ledger: readonly RiskRecord[],
  entrusted: readonly string[],
  resolved: readonly string[],
  by: string,
  workUnitId?: string,
): Applied {
  const next = ledger.map((r) => ({ ...r }));
  const events: LedgerEvent[] = [];
  const claimed = new Set(resolved);

  for (const id of entrusted) {
    const rec = next.find((r) => r.id === id && r.workUnitId === workUnitId);
    if (!rec) {
      events.push({ event: "ignored", id, reason: "unknown", by });
      continue;
    }
    // Closed first, before anything else is asked of the record. A risk that is
    // already resolved is not reopened by a later review that was handed it and
    // did not claim it: an orchestrator repeating an id in `for_risks` is a
    // mistake in prose, and the ledger must not turn it into a reopened concern.
    // The contract says a new concern gets a new id, and this is the code that
    // holds the other half of it.
    if (rec.status === "resolved") {
      events.push({ event: "ignored", id, reason: "already-resolved", by });
      continue;
    }
    if (!claimed.has(id)) {
      // Back to open, and said out loud. The risk is not lost and not closed.
      rec.status = "open";
      events.push({ event: "still-open", id, by });
      continue;
    }
    rec.status = "resolved";
    rec.resolvedBy = by;
    events.push({ event: "resolved", id, by });
  }

  for (const id of resolved) {
    if (!entrusted.includes(id)) {
      events.push({ event: "ignored", id, reason: "not-entrusted", by });
    }
  }

  return { ledger: next, events };
}
