/**
 * What a review result counts, what it carries, and how it says so.
 *
 * The head line exists so the artefact is opened when there is something in it,
 * rather than on every review to find out. That only works if every field the
 * orchestrator has to act on is counted — and run 12 measured what happens when
 * one is not. Sixteen reviews wrote twenty-seven `open_risks`, several naming a
 * term the reviewer could not search for; the orchestrator was handed
 * `[reviewer: approved, 2 findings]` and had no signal that anything waited.
 * One of those questions reached a scout.
 *
 * Run 14 then measured the cost of counting without carrying. The count did its
 * job — every risk was seen — but the strings were not there, so the
 * orchestrator opened the artefact to read them: fourteen times, five of them
 * through a python heredoc because the `read` offset it guessed was too small.
 * This process had already parsed `envelope.open_risks` to produce the count and
 * then dropped the value. The head now carries the text, and the artefact goes
 * back to being the full diagnostic rather than a bus for two sentences.
 *
 * The producer and the consumer of the same contract live here, and `RunResult`
 * extends `EnvelopeCounts` rather than restating it, so a fourth field is one
 * edit in one place. That last part is not stylistic: every field is optional,
 * so a `RunResult` that redeclared them would stay structurally assignable to
 * `EnvelopeCounts` after a field was added to only one of the two — the compiler
 * would report nothing, which is how the first drift went unnoticed.
 */

/**
 * One risk, with the identity the rest of the run refers to it by.
 *
 * The id is a coordinate, not a counter: `<runId>-<seq>-<position>`, where the
 * first two are the artefact the risk came from and the third is its index in
 * that envelope's `open_risks`. So it is derivable from the artefact and needs
 * no shared state to hand out, it cannot collide across runs, it survives a
 * lost ledger, and it says where to look. A global counter would have none of
 * those properties and would have to be threaded through every call.
 *
 * The reviewer never chooses it. It is assigned here, from where the envelope
 * was written.
 */
export interface ReviewRisk {
  id: string;
  text: string;
}

export interface EnvelopeCounts {
  findings?: number;
  outOfScope?: number;
  openRisks?: number;
  /**
   * The open risks themselves, identified. Absent when the envelope has none.
   *
   * `openRisks` counts these and not the raw array. The two used to be allowed
   * to disagree — a blank entry among three counted three and carried two —
   * which produced a head announcing `3 open-risks` above two lines and an
   * orchestrator with good reason to open the artefact looking for the third.
   * That is the exact cost this transport exists to remove. The id keeps its
   * source position so it still points at the right line of the artefact; the
   * count reports what is actionable.
   */
  openRiskItems?: ReviewRisk[];
}

/**
 * The three lengths the head line reports, and the risks it now carries.
 *
 * `idPrefix` is `<runId>-<seq>` — the artefact this envelope was written to,
 * minus the role. Required rather than optional: there is one production caller
 * and an unidentified risk cannot be routed, resolved or recorded, so a default
 * would only make the failure quiet.
 */
export function envelopeCounts(
  envelope: Record<string, unknown>,
  idPrefix: string,
): EnvelopeCounts {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : undefined);
  const items = reviewRisks(envelope.open_risks, idPrefix);
  return {
    findings: len(envelope.findings),
    outOfScope: len(envelope.out_of_scope),
    // What is carried, so the head line and the block beneath it agree, and so
    // the count matches what the ledger will open. `findings` and `out_of_scope`
    // stay raw lengths: they are not carried, so there is nothing to disagree
    // with.
    openRisks: items?.length,
    openRiskItems: items,
  };
}

/**
 * Identifies each risk by its position in the envelope that raised it.
 *
 * The position is the one in the submitted array, not in the result: a blank
 * entry is dropped and the entries after it keep their own index, so an id
 * always points at the same line of the artefact it came from.
 */
export function reviewRisks(raw: unknown, idPrefix: string): ReviewRisk[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((text, i) => ({ i, text: typeof text === "string" ? text.trim() : "" }))
    .filter((e) => e.text.length > 0)
    .map((e): ReviewRisk => ({ id: `${idPrefix}-${e.i + 1}`, text: e.text }));
  return items.length > 0 ? items : undefined;
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

/** One finding, as the envelope schema shapes it. No id: nothing refers to it. */
export interface ReviewFinding {
  severity: string;
  confidence: string;
  location: string;
  issue: string;
  fix: string;
}

/**
 * What a review that demands work carries, beyond its counts.
 *
 * Run 15 measured the boundary and it is a verdict, not a volume. `top_priority`
 * appeared on 3 of 3 `needs_rework` and on 0 of 17 `approved`: it is already an
 * action field in everything but name. Findings travel with it, because a
 * rework formulated from the top priority alone leaves the second defect for a
 * second round trip — the orchestrator opened artefact 29 three times, and it
 * held two findings.
 *
 * An approved review carries neither. Its count stays on the head line and its
 * detail stays in the artefact: run 15 shows the orchestrator paying an access
 * on two approved reviews to decide, both times, to do nothing now. A finding
 * worth surviving as debt belongs in a backlog, not in a context the
 * orchestrator is not meant to act on.
 *
 * Findings get no identity. Nothing references them the way `for_risks` and
 * `resolved_risks` reference a risk, so an id would be a contract with no
 * consumer — and a second small ledger to keep honest.
 */
export interface ReviewAction {
  topPriority?: string;
  findings?: ReviewFinding[];
}

/**
 * The action payload, or nothing when the verdict asks for none.
 *
 * Keyed on `verdict !== "approved"` rather than on `needs_rework` alone: a
 * `blocked` review demands more work, not less, and listing verdicts one by one
 * is how a fourth one gets forgotten later.
 */
export function reviewAction(
  envelope: Record<string, unknown>,
  verdict: string | undefined,
): ReviewAction | undefined {
  if (verdict === undefined || verdict === "approved") return undefined;
  const top = typeof envelope.top_priority === "string" ? envelope.top_priority.trim() : "";
  const findings = Array.isArray(envelope.findings)
    ? envelope.findings
        .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
        .map((f): ReviewFinding => ({
          severity: str(f.severity),
          confidence: str(f.confidence),
          location: str(f.location),
          issue: str(f.issue),
          fix: str(f.fix),
        }))
        .filter((f) => f.issue || f.fix)
    : [];
  if (!top && findings.length === 0) return undefined;
  return { topPriority: top || undefined, findings: findings.length ? findings : undefined };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The action payload under the head line: the instruction first, then the
 * diagnostic it was drawn from.
 *
 * One line per finding, whitespace collapsed for the same reason as the risks —
 * a newline inside an issue would produce a second line indistinguishable from
 * the next finding's. Nothing is truncated.
 */
export function actionLines(action: ReviewAction | undefined): string {
  if (!action) return "";
  const lines: string[] = [];
  if (action.topPriority) lines.push(`  → ${flat(action.topPriority)}`);
  for (const f of action.findings ?? []) {
    const head = [f.severity, f.confidence].filter(Boolean).join(" ");
    const body = [f.issue, f.fix].filter(Boolean).map(flat).join(" — ");
    lines.push(`  ${[head, f.location, body].filter(Boolean).join("  ")}`);
  }
  return lines.join("\n");
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * The risks as they appear under the head line, one per line, indented so the
 * block reads as belonging to the line above rather than as a second result.
 *
 * Nothing is truncated. A limit was proposed at 300 characters and refused: the
 * clause a reviewer uses to say what it could *not* establish tends to come
 * last, and it is exactly the clause that decides whether the concern is a
 * bounded lookup or an inventory nobody can conclude. Cutting there would send
 * the orchestrator back to the artefact for the only sentence that mattered,
 * which is the cost this transport exists to remove. The volume does not
 * justify it either: run 14's twenty-seven risks came to about 3k characters
 * against a 175k orchestrator context, and the longest single risk was 340.
 * Run 15 measures total and maximum; a ceiling, if one is ever needed, belongs
 * with an explicit marker telling the orchestrator the text is incomplete, not
 * as a silent default.
 *
 * Internal newlines are collapsed, which is not truncation: the head is a
 * line-per-risk block, and a risk containing a newline would otherwise produce
 * a second line indistinguishable from the next risk's.
 */
export function riskLines(items: ReviewRisk[] | undefined): string {
  if (!items || items.length === 0) return "";
  return items.map((r) => `  ${r.id}  ${r.text.replace(/\s+/g, " ")}`).join("\n");
}
