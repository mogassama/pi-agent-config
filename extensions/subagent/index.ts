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
import { dispatch, type RunResult } from "../../subagent-only/dispatch.js";
import { aggregateFanout, streakOf } from "../../subagent-only/fanout.js";
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

function changedSinceLastReview(): string[] {
  const paths: string[] = [];
  for (let i = HISTORY.length - 1; i >= 0; i--) {
    if (HISTORY[i].agent === "reviewer") break;
    paths.unshift(...HISTORY[i].changedFiles);
  }
  return [...new Set(paths)];
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

function diffSection(paths: string[]): DiffPackage {
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

  const diff = gitDiffFor(files);
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
          "**Before sending a scout, collect the reconnaissance questions you " +
          "already know you need before you can act.** Those that share a " +
          "`scope` go in one call — they run at once, each returning its own " +
          "envelope, and nothing is merged.\n\n" +
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
        "conversation, from a bundle file, from .pi/BRIEF.md, or stated anywhere " +
        "in the repository about the paths this task touches — AGENTS.md, " +
        "SECURITY.md, an ADR — must be pasted verbatim, not referred to.",
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
        "A scout task asking for every occurrence, a full inventory, or a comparison of two states is an audit wearing a scout costume: it reaches the ceiling and returns nothing. Split it into questions that each locate one thing — how to send them is in the `find` parameter of task.",
        "Delegate when the task needs a different model, a context this session should not carry, or parallel read-only work.",
        "Do not delegate a one-line edit or a scratch file you could write inline. This never applies to a scout, nor to the code of an implementation deliverable — any code asked for as a result of the session, backlog item or not: both are delegated for what they are, not for how large they are.",
        "The child sees only the task text. Anything implicit here is absent there — a project AGENTS.md, a SECURITY.md, a CONTRIBUTING.md, an ADR, a comment in a config file. Not a list to check off: any constraint the repository states about the paths this task touches, quoted, because the child cannot read any of them.",
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
        const changed = changedSinceLastReview();
        const pkg =
          params.agent === "reviewer" && changed.length > 0
            ? diffSection(changed)
            : { text: "", degraded: false, diffChars: 0 };

        // For a scout, the contract is also the head of its task text: the child
        // reads the same one question and the same paths the schema enforced.
        // One task text per question, so a fan-out spawns children that differ
        // in exactly one line and nothing else.
        const questions = params.agent === "scout" ? scoutQuestions(params.find) : [];
        const scoutHeader = (q: string) =>
          `Find: ${q}\nScope: ${(params.scope ?? []).join(", ")}\n\n`;
        const tasks = questions.length
          ? questions.map((q) => `${pkg.text}${scoutHeader(q)}${params.task}`)
          : [`${pkg.text}${params.task}`];

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
         * `allSettled`, not `all`.
         *
         * `Promise.all` rejects on the first child that throws, and the three
         * others keep running — with nothing left to publish their state, record
         * them in HISTORY or close the tool call. The batch would return while
         * its own processes were still working, and the footer would hold
         * whatever the last publish said. Waiting for every child costs the
         * duration of the slowest, which is what a fan-out costs anyway.
         */
        const settled =
          tasks.length > 1
            ? await Promise.allSettled(
                tasks.map((t) =>
                  dispatch(effective, t, {
                    ctx: { agentDir: AGENT_DIR, selfDir: SELF_DIR, runId: RUN_ID },
                    seq: ++CALL_SEQ,
                    signal,
                    onProgress: publish,
                  }),
                ),
              )
            : null;
        if (settled) {
          const rejected = settled.find((r) => r.status === "rejected");
          if (rejected && rejected.status === "rejected") {
            // Every child has finished, so the state is settled and publishable
            // before the error leaves. Nothing is recorded in HISTORY: a batch
            // that did not complete did not happen, and the guard must not count
            // it as a reconnaissance the orchestrator can act on.
            publish();
            throw rejected.reason;
          }
        }
        const results =
          settled
            ? settled.map((r) => (r as PromiseFulfilledResult<RunResult>).value)
            : [
                await dispatch(effective, tasks[0], {
                  ctx: { agentDir: AGENT_DIR, selfDir: SELF_DIR, runId: RUN_ID },
                  seq: ++CALL_SEQ,
                  signal,
                  onProgress: publish,
                }),
              ];
        publish();

        // One HISTORY entry per child, which is what ran. The guard counts the
        // calls behind them — see `streakOf`, and the `batch` field they share.
        const batch = randomBytes(4).toString("hex");
        for (const r of results) {
          HISTORY.push({
            agent: params.agent,
            batch,
            produced: !r.failure,
            readOnly: isReadOnly(agent.tools),
            changedFiles: r.changedFiles ?? [],
          });
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
        const counts = [
          result.findings ? `${result.findings} finding${result.findings > 1 ? "s" : ""}` : "",
          result.outOfScope ? `${result.outOfScope} out-of-scope` : "",
        ]
          .filter(Boolean)
          .join(", ");

        const head = result.failure
          ? `[${result.role}: ${result.failure}${result.fromTree ? `, ${result.changedFiles?.length} file(s) on disk` : ""}${via}]`
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
