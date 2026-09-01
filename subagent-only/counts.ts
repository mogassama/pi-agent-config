/**
 * What a review result counts, and how it says so.
 *
 * The head line exists so the artefact is opened when there is something in it,
 * rather than on every review to find out. That only works if every field the
 * orchestrator has to act on is counted — and run 12 measured what happens when
 * one is not. Sixteen reviews wrote twenty-seven `open_risks`, several naming a
 * term the reviewer could not search for; the orchestrator was handed
 * `[reviewer: approved, 2 findings]` and had no signal that anything waited.
 * One of those questions reached a scout.
 *
 * The field was read from the envelope in `dispatch.ts` and rendered in
 * `index.ts` — two files, three lines each, no test between them. Producer and
 * consumer of the same contract live here now, and `RunResult` extends
 * `EnvelopeCounts` rather than restating it, so a fourth count is one edit in
 * one place.
 *
 * That last part is not stylistic. Every count is optional, so a `RunResult`
 * that redeclared them would stay structurally assignable to `EnvelopeCounts`
 * after a field was added to only one of the two — the compiler would report
 * nothing, which is how the first drift went unnoticed.
 */

export interface EnvelopeCounts {
  findings?: number;
  outOfScope?: number;
  openRisks?: number;
}

/** Lengths of the three arrays the head line reports, absent when the envelope has none. */
export function envelopeCounts(envelope: Record<string, unknown>): EnvelopeCounts {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : undefined);
  return {
    findings: len(envelope.findings),
    outOfScope: len(envelope.out_of_scope),
    openRisks: len(envelope.open_risks),
  };
}

/**
 * The counts as they appear after the verdict, or an empty string when there is
 * nothing to report. Zero is nothing: a review with no finding says so by
 * saying nothing, and always did.
 */
export function countsLine(counts: EnvelopeCounts): string {
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
  return [
    counts.findings ? plural(counts.findings, "finding") : "",
    counts.outOfScope ? `${counts.outOfScope} out-of-scope` : "",
    counts.openRisks ? plural(counts.openRisks, "open-risk") : "",
  ]
    .filter(Boolean)
    .join(", ");
}
