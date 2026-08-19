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
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadAgents } from "../../subagent-only/agents.js";
import { dispatch } from "../../subagent-only/dispatch.js";
import { serialize, STATUS_KEY } from "../../subagent-only/run-state.js";

const AGENT_DIR = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const SELF_DIR = join(AGENT_DIR, "subagent-only");

/**
 * One runId per orchestrator session, not per call.
 *
 * It scopes the child session ids, so a worker called twice in one task keeps
 * its provider cache affinity across both calls. It dies with the session.
 */
const RUN_ID = randomBytes(3).toString("hex");

/**
 * Call counter, so successive artefacts of the same role do not overwrite each
 * other. Session-scoped like RUN_ID; only the artefact filename uses it.
 */
let CALL_SEQ = 0;

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
  /** False when the child returned no envelope. A delegation that answered nothing must not block its own retry. */
  produced: boolean;
  readOnly: boolean;
  /** Paths the delegation wrote. Empty for a read-only role, and for a writer that changed nothing. */
  changedFiles: string[];
}
const HISTORY: Delegation[] = [];

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
    if (between.every((d) => d.produced && d.changedFiles.length === 0)) {
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
  const streak = HISTORY.reduce(
    (n, d) => (d.agent === agentName ? n + 1 : 0),
    0,
  );
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
const DIFF_MAX_CHARS = 32_000; // ≈ 8k tokens, the whole frozen bundle's worth
const DIFF_MAX_FILES = 15;

function gitDiffFor(paths: string[]): string {
  const run = (args: string[]): string => {
    try {
      return execFileSync("git", args, {
        cwd: process.cwd(),
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
      execFileSync("git", ["ls-files", "--error-unmatch", "--", path], {
        cwd: process.cwd(),
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
function changedSinceLastReview(): string[] {
  const paths: string[] = [];
  for (let i = HISTORY.length - 1; i >= 0; i--) {
    if (HISTORY[i].agent === "reviewer") break;
    paths.unshift(...HISTORY[i].changedFiles);
  }
  return [...new Set(paths)];
}

function diffSection(paths: string[]): string {
  const files = paths.filter(Boolean);
  if (files.length === 0) return "";

  if (files.length > DIFF_MAX_FILES) {
    return (
      `Changed files (${files.length}, too many to inline):\n` +
      files.map((f) => `  - ${f}`).join("\n") +
      "\n\nRead these files to see the change. Judge only what this change introduced.\n\n"
    );
  }

  const diff = gitDiffFor(files);
  if (!diff.trim()) return "";

  if (diff.length > DIFF_MAX_CHARS) {
    return (
      `Changed files (${files.length}, diff too large to inline at ${Math.round(diff.length / 1000)}kB):\n` +
      files.map((f) => `  - ${f}`).join("\n") +
      "\n\nRead these files to see the change. Judge only what this change introduced.\n\n"
    );
  }

  return (
    "The change under review, as a diff. Do not reconstruct it — it is here.\n" +
    "You may read any file for context, including files this diff does not touch;\n" +
    "judge only what the diff introduced.\n\n" +
    `<diff>\n${diff}\n</diff>\n\n`
  );
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
    const dir = join(process.cwd(), ".pi-subagent-runs");
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

export default function (pi: ExtensionAPI) {
  const agents = loadAgents(join(SELF_DIR, "agents"));

  // The UI context is only handed out with an event or a call. Capture it at
  // session_start so the dispatch loop can publish progress without one.
  let ui: { setStatus?: (k: string, v: string) => void } | undefined;
  pi.on("session_start", async (_event, ctx) => {
    ui = ctx.ui;
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
  pi.on("tool_call", async (event) => {
    const path =
      isToolCallEventType("write", event) || isToolCallEventType("edit", event)
        ? (event.input as { path?: string })?.path
        : undefined;
    if (!path) return undefined;

    const last = HISTORY[HISTORY.length - 1];
    if (last?.agent === "orchestrator") {
      if (!last.changedFiles.includes(path)) last.changedFiles.push(path);
    } else {
      HISTORY.push({ agent: "orchestrator", produced: true, readOnly: false, changedFiles: [path] });
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
          "query wants sql-engineering or bigquery-engineering. Omit to use the " +
          "agent's declared default.",
      }),
    ),
    task: Type.String({
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
        "conversation, from a bundle file, or from .pi/BRIEF.md must be pasted " +
        "verbatim, not referred to.",
    }),
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
        "Searching across files is scout work: the moment the question is *where* rather than *what*, delegate it instead of grepping.",
        "Asking whether something just written is consistent, or reached every caller, is a where-question — scout it first and name the locations. Not a question you can already answer: scouting a tree you have just read yourself returns what you gave it.",
        "Delegate when the task needs a different model, a context this session should not carry, or parallel read-only work.",
        "Do not delegate a one-line edit or a scratch file you could write inline. This never applies to a scout, nor to the code of a backlog deliverable: both are delegated for what they are, not for how large they are.",
        "The child sees only the task text. Anything implicit here is absent there.",
      ],
      parameters,

      async execute(_id, params: Static<typeof parameters>, { signal }: { signal?: AbortSignal } = {}) {
        const agent = agents.get(params.agent);
        if (!agent) {
          return { content: [{ type: "text" as const, text: `unknown agent: ${params.agent}` }], isError: true };
        }

        // Before anything is spawned. A refusal costs one tool result; the
        // delegation it replaces cost between 28k and 306k tokens on the
        // measured run.
        const blocked = refuse(params.agent, agent.tools);
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
        const changed = changedSinceLastReview();
        const task =
          params.agent === "reviewer" && changed.length > 0
            ? `${diffSection(changed)}${params.task}`
            : params.task;

        // Publish run state for the footer. getExtensionStatuses() is the
        // documented channel between extensions; a shared module import would
        // depend on how pi isolates them.
        const publish = () => ui?.setStatus?.(STATUS_KEY, serialize());

        // The task decides which domain applies, not the role. A static list on
        // the definition hands a Terraform change python-engineering and
        // nothing useful; the definition's list is a default, not a constraint.
        const effective =
          params.skills && params.skills.length > 0 ? { ...agent, skills: params.skills } : agent;

        const result = await dispatch(effective, task, {
          ctx: { agentDir: AGENT_DIR, selfDir: SELF_DIR, runId: RUN_ID },
          seq: ++CALL_SEQ,
          signal,
          onProgress: publish,
        });
        publish();

        HISTORY.push({
          agent: params.agent,
          produced: !result.failure,
          readOnly: isReadOnly(agent.tools),
          changedFiles: result.changedFiles ?? [],
        });

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
        const counts = [
          result.findings ? `${result.findings} finding${result.findings > 1 ? "s" : ""}` : "",
          result.outOfScope ? `${result.outOfScope} out-of-scope` : "",
        ]
          .filter(Boolean)
          .join(", ");

        const head = result.failure
          ? `[${result.role}: ${result.failure}${via}]`
          : `[${result.role}: ${outcome}${counts ? `, ${counts}` : ""}${via}]`;

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
        if (params.agent === "scout") SCOUT_CALLS++;

        return {
          content: [
            {
              type: "text" as const,
              text: `${head} ${result.summary}${note}${scoutHint}\n${result.artifact}`,
            },
          ],
          details: {
            role: result.role,
            model: result.modelUsed,
            status: result.status,
            verdict: result.verdict ?? null,
            findings: result.findings ?? null,
            outOfScope: result.outOfScope ?? null,
            next: result.next,
            turns: result.turns,
            usage: result.usage,
            artifact: result.artifact,
            failure: result.failure ?? null,
          },
          isError: result.status === "failed",
        };
      },
    }),
  );
}

/** Descriptions come from the definitions, so the menu cannot drift from them. */
function agentMenu(agents: Map<string, { description: string; model: string }>): string {
  return [...agents.entries()].map(([n, a]) => `${n}: ${a.description}`).join(" | ");
}
