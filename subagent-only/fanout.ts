/**
 * What a `task` call reports when it started more than one child.
 *
 * A leaf module with no pi import, for the same reason as `role-rules.ts` and
 * `pi-secret-gate/rules.ts`: the test has to call *this* function, not a copy of
 * it. The first version of these tests reimplemented the aggregation inside the
 * test file with a comment asking that the two be kept identical — a convention,
 * not a mechanism, and one that stays green while the production code drifts. It
 * would have reproduced the very failure it was written after: rules that are
 * right beside a wiring nobody exercises.
 */

export interface ChildResult {
  role: string;
  modelUsed: string;
  status: "ok" | "blocked" | "failed";
  turns: number;
  artifact: string;
  next: string;
  usage: Record<string, number>;
  failure?: string;
  verdict?: string;
  findings?: number;
  outOfScope?: number;
}

export interface FanoutDetails {
  role: string;
  model: string;
  status: "ok" | "blocked" | "failed";
  verdict: string | null;
  findings: number | null;
  outOfScope: number | null;
  next: string;
  turns: number;
  usage: Record<string, number>;
  artifact: string;
  failure: string | null;
  failures: string[];
  children: Array<{
    role: string;
    model: string;
    status: string;
    turns: number;
    artifact: string;
    failure: string | null;
  }>;
}

/**
 * Aggregate every child, never the first one.
 *
 * The field this exists for is `status`, and the one that was most quietly
 * wrong is `next`. A child that ends `ok` derives `done` and one that does not
 * derives `orchestrator`; taking the first child's meant a call could report
 * `status: failed` and `next: done` in the same breath, telling the
 * orchestrator that a batch containing a dead child needed nothing further.
 *
 * A single child comes out with exactly the shape it had before this function
 * existed, and `children` is a list of one.
 */
export function aggregateFanout(results: ChildResult[]): FanoutDetails {
  const first = results[0];
  const failures = results.flatMap((r) => (r.failure ? [r.failure] : []));
  const status: FanoutDetails["status"] = results.some((r) => r.status === "failed")
    ? "failed"
    : results.some((r) => r.status === "blocked")
      ? "blocked"
      : "ok";

  const usage = results.reduce<Record<string, number>>((acc, r) => {
    for (const [k, v] of Object.entries(r.usage ?? {})) {
      if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
    }
    return acc;
  }, {});

  return {
    role: first.role,
    // One model when they agree, the list when a fallback split them.
    model: [...new Set(results.map((r) => r.modelUsed))].join(", "),
    status,
    // Only the scout can fan out and its envelope carries none of these three,
    // so a single child's values are the only ones there are.
    verdict: first.verdict ?? null,
    findings: first.findings ?? null,
    outOfScope: first.outOfScope ?? null,
    // Anything short of every child succeeding comes back to the orchestrator.
    next: first.next,
    turns: results.reduce((n, r) => n + r.turns, 0),
    usage,
    artifact: results.map((r) => r.artifact).join(" "),
    // Kept for whoever reads a single string; `failures` is the truth.
    failure: failures[0] ?? null,
    failures,
    children: results.map((r) => ({
      role: r.role,
      model: r.modelUsed,
      status: r.status,
      turns: r.turns,
      artifact: r.artifact,
      failure: r.failure ?? null,
    })),
  };
}
