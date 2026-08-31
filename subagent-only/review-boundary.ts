/**
 * The set of files a review is currently open over.
 *
 * The old rule was one line — walk back and stop at the last reviewer — and it
 * read the boundary as consumed by the review that saw it. Measured on run 12:
 * `reviewer.md` promises a where-question put in `open_risks` "comes back to you
 * as named files in the next task", and `index.ts` refuses to block the
 * `reviewer → scout → reviewer` sequence so that promise can be kept. But the
 * second reviewer arrived with nothing. The walk stopped at the first reviewer,
 * the scout in between had changed no file, and the package built from an empty
 * list is an empty package — a fresh process, no conversation history, asked to
 * adjudicate a diff it was never handed.
 *
 * A successful review leaves its boundary available for read-only continuation;
 * the next material change starts a new one.
 *
 * Two words in that sentence are load-bearing, and an external review caught
 * both being wrong in the first version.
 *
 * *Successful.* A reviewer that returned no envelope reviewed nothing. It is
 * recorded in `HISTORY` like any other delegation, with `produced: false`, and
 * the streak guard already lets such a review be replaced. Letting it mark the
 * boundary as seen would let the next writer discard files no review ever read.
 *
 * *Material.* The event is `changedFiles`, not the role that could have
 * produced it. A worker that crashed before writing anything has not replaced
 * the open boundary — and it escapes the `wroteNothing` guard precisely when it
 * failed, since that guard only fires on delegations that produced. Keying on
 * `readOnly` implemented "a role capable of mutation closes the boundary",
 * which is not the same claim. Once the test is `changedFiles`, `readOnly` is
 * not needed here at all: a role that cannot write reports none.
 *
 * Written as a forward fold rather than a backward scan for a specific shape.
 * `R → S → R` is not a case to detect; it is one path through a state machine
 * that also has to answer `R → S1 → S2 → R`, `W R R`, `W R W_crashed R`, and
 * whatever sequence the orchestrator produces next. Recomputed from history on
 * every call, so it cannot drift from the record the guards read.
 */

/** The fields this needs. Structural, so `Delegation` stays where it is. */
export interface BoundaryEntry {
  agent: string;
  /** Whether the child returned a usable envelope. Independent of salvaged disk changes. */
  produced: boolean;
  changedFiles: readonly string[];
}

/**
 * Files pending review, in order of first appearance, deduplicated.
 *
 * - a review that produced marks the boundary as seen, and clears nothing;
 * - a delegation that changed no file changes nothing here, whatever its role;
 * - the first material change after a review opens a new boundary;
 * - material changes before any review accumulate into the one being built.
 *
 * The verdict is deliberately not read. An `approved` can carry an `open_risk`
 * that needs a continuation — run 12 measured twenty-seven of them across
 * eleven approvals — and a `needs_rework` is normally followed by a mutation
 * that opens a new boundary on its own. What the boundary follows is what
 * happened on disk, never what a model concluded.
 */
export function openReviewBoundary(history: readonly BoundaryEntry[]): string[] {
  let boundary: string[] = [];
  let seenByAReview = false;

  for (const d of history) {
    // Checked before anything else: a reviewer has no `edit` and no `write`, so
    // it reports no changed file and would otherwise be indistinguishable from
    // a scout.
    if (d.agent === "reviewer") {
      if (d.produced) seenByAReview = true;
      continue;
    }
    if (d.changedFiles.length === 0) continue;

    if (seenByAReview) {
      boundary = [...d.changedFiles];
      seenByAReview = false;
    } else {
      boundary.push(...d.changedFiles);
    }
  }

  return [...new Set(boundary)];
}
