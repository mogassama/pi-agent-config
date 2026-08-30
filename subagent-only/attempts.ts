/**
 * The attempt machine: primary, optional retry, optional fallbacks.
 *
 * Extracted from `dispatch` so a test can watch what it calls. Every defect in
 * this sequence so far has been of one kind — the primitive could represent the
 * right thing and the wiring did something else — and each was found by review
 * rather than by a test, because no test could reach the wiring. `dispatch.ts`
 * imports pi and cannot be loaded from `node --test`; this can.
 *
 * It knows nothing about run-state, artefacts or spawning. It receives an
 * `attempt` to call and two callbacks to report what it did, and it decides only
 * which model to try next and when to stop.
 */

export interface AttemptOutcome {
  /** Undefined when the attempt produced an envelope. */
  failure?: string;
  /** Paths the attempt wrote, undefined when it wrote nothing. */
  changedFiles?: string[];
}

export interface AttemptPlan<R extends AttemptOutcome> {
  /** Declared model first, then fallbacks, in order. */
  chain: string[];
  /** Whether the role can write. A writer is retried only when it wrote nothing. */
  mutates: boolean;
  /** Failures worth trying the next model for. */
  retryable: ReadonlySet<string>;
  /** True once the operator has interrupted. Checked between attempts. */
  aborted: () => boolean;
  /** Run one attempt on one model. */
  attempt: (model: string) => Promise<R>;
  /** A child is moving to the next model in the chain. */
  onFallback?: (from: string, to: string) => void;
  /** Called once, on the result the caller will receive. */
  finish: (r: R) => R;
  /** Wraps the last result when the whole chain refused. */
  exhausted: (last: R) => R;
}

/**
 * Run the chain and return the result the caller gets.
 *
 * Exactly one `finish` on every path, which is what makes the batch slot close
 * once per delegation rather than once per attempt.
 */
export async function runAttempts<R extends AttemptOutcome>(plan: AttemptPlan<R>): Promise<R> {
  let last: R | null = null;

  for (const model of plan.chain) {
    let result = await plan.attempt(model);

    /*
     * One retry on `no_submit`, for a role that wrote nothing.
     *
     * A model that produces a turn of pure reasoning and stops is stochastic, so
     * a fresh process on the same input is worth one try. Never for a writer
     * that changed the tree: re-running it would replay edits against a tree it
     * already changed. When the before/after snapshots are identical there is no
     * such tree, and the condition is mechanical rather than a judgement.
     */
    const wroteNothing = plan.mutates && result.changedFiles === undefined;
    if (result.failure === "no_submit" && (!plan.mutates || wroteNothing) && !plan.aborted()) {
      const retry = await plan.attempt(model);
      if (!retry.failure) return plan.finish(retry);
      result = retry;
    }

    if (!result.failure || !plan.retryable.has(result.failure)) return plan.finish(result);

    last = result;

    // An abort is not an exhaustion. The check comes before announcing the next
    // model — a signal already raised means the fallback will never run, and
    // saying it had taken this child's place left a model in the batch's count
    // that nothing was running on — and it returns the last result as it stands
    // rather than falling through to `exhausted`, which would claim every model
    // in the chain had refused when the later ones were never tried.
    if (plan.aborted()) return plan.finish(last);

    const next = plan.chain[plan.chain.indexOf(model) + 1];
    if (next) plan.onFallback?.(model, next);
  }

  return plan.finish(plan.exhausted(last!));
}
