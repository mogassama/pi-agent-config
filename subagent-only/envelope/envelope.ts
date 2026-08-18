/**
 * Subagent envelope — one terminating `submit` tool per role.
 *
 * Loaded into a child `pi` process with `-e`. The role is selected by the
 * PI_SUBAGENT_ROLE environment variable, set by the parent at spawn time.
 * Each child therefore sees exactly one schema: its own.
 *
 * Why a tool and not a JSON block in the final message:
 *   - validation happens on tool arguments, enforced by pi against TypeBox,
 *     instead of a regex over markdown fences;
 *   - `terminate: true` ends the child on the tool call, saving one LLM turn;
 *   - measured: across 10 reviewer runs in anime-etl, the envelope appeared in
 *     5/5 runs whose task prompt named it and 0/3 that only described the work.
 *     A loaded skill never imposes its own output format; asking in the prompt
 *     works only when someone remembers to ask. The schema removes the choice.
 *
 * Vocabulary is taken from skills/code-review/SKILL.md and from the 8 observed
 * outputs. Do not invent a parallel scale here — one fact, one file.
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

// ---------------------------------------------------------------- envelope

/*
 * There is no `next` field, and there was one.
 *
 * It asked a role that has just been told it holds no orchestration authority
 * to decide what runs next. Measured on run 3ed33e: three of the four reviews
 * that returned `needs_rework` returned `next: "done"` with it, and every
 * other role returned `done` unconditionally — a field wrong where it could be
 * wrong and constant everywhere else. It also carried a `"advisor"` literal
 * for a role that has no definition and cannot be spawned.
 *
 * It is now derived in dispatch.ts from the verdict, where the same fact is
 * already known. Removing it removes half of the validation failures below.
 */

/** Fields every role must supply, whatever its payload. */
const envelopeFields = {
  status: Type.Union([Type.Literal("ok"), Type.Literal("blocked"), Type.Literal("failed")], {
    description: "ok = task completed; blocked = could not proceed; failed = errored out.",
  }),
  summary: Type.String({
    description: "One line, human readable. This is the only field that reaches the parent context.",
  }),
};

// ------------------------------------------------------------ role payloads

/**
 * A source location as reviewers actually write them: `src/load.py:121-131`,
 * or several ranges at once. A number cannot hold this — observed in the
 * anime-etl corpus, where a single finding spanned four disjoint ranges.
 */
const Location = Type.String({
  description: "file:line, file:start-end, or several ranges. Never bare integers.",
});

/**
 * Tooling that ran, or did not. `unavailable_reason` is the legal empty form
 * required by rule 5 — a mandatory field with no way to say "nothing" produces
 * decorative verification. One reviewer in the corpus produced this shape on
 * its own: "flake8 -> unavailable: module not installed in .venv".
 */
const ToolingEntry = Type.Object({
  command: Type.String({ description: "As invoked, e.g. `uv run ruff check src/load.py`." }),
  outcome: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unavailable")]),
  detail: Type.String({ description: "Result line, or the reason it could not run." }),
});

/*
 * An array, not the object-with-named-keys shape the corpus used (`ruff`, `mypy`,
 * `bq_dry_run`, `sqlfluff`). Named keys cannot express a tool that was never
 * relevant, cannot carry an arbitrary command, and have no empty form. Verified
 * in practice: a reviewer with no `bash` in its allowlist returned [] rather
 * than inventing commands.
 */

const payloads = {
  scout: Type.Object({
    hits: Type.Array(
      Type.Object({
        path: Type.String(),
        lines: Type.String({ description: "e.g. 12-40" }),
        why: Type.String({ description: "Why this location answers the question." }),
      }),
    ),
    gaps: Type.Array(Type.String(), {
      description: "What was looked for and not found. Empty array is legal and expected.",
    }),
  }),

  worker: Type.Object({
    changed_files: Type.Array(Type.String()),
    validation: Type.String({
      description:
        "What actually ran, or the exact word `none` with a reason. Do not re-run what pi-lint-gate already runs.",
    }),
    deviations: Type.Array(Type.String(), {
      description: "Deliberate departures from the instruction. Empty array is legal.",
    }),
  }),

  reviewer: Type.Object({
    findings: Type.Array(
      Type.Object({
        severity: Type.Union(
          [Type.Literal("HIGH"), Type.Literal("MEDIUM"), Type.Literal("LOW")],
          { description: "Vocabulary from code-review SKILL.md. HIGH = data loss, security, cost, correctness." },
        ),
        confidence: Type.Union([
          Type.Literal("certain"),
          Type.Literal("probable"),
          Type.Literal("possible"),
        ]),
        location: Location,
        issue: Type.String({ description: "The defect itself." }),
        impact: Type.String({ description: "What breaks, concretely." }),
        fix: Type.String({ description: "Actionable remedy." }),
      }),
    ),
    verdict: Type.Union(
      [Type.Literal("approved"), Type.Literal("needs_rework"), Type.Literal("blocked")],
      {
        description:
          "blocked = at least one HIGH at certain or probable confidence. A HIGH at possible confidence downgrades to needs_rework and must be named in top_priority.",
      },
    ),
    files_reviewed: Type.Array(Type.String(), {
      description: "Exactly the files judged. Anything read only for context belongs in out_of_scope.",
    }),
    open_risks: Type.Array(Type.String(), {
      description:
        "What could not be settled within scope, and why. Empty array is legal — say nothing rather than padding.",
    }),
    top_priority: Type.Union([Type.String(), Type.Null()], {
      description: "The single thing to fix first, or null when there is nothing to fix.",
    }),
    tooling: Type.Array(ToolingEntry, {
      description: "Empty array is legal — say so rather than claiming checks that did not run.",
    }),
    /*
     * Optional, and it was required.
     *
     * Required, it was the single largest cost in the reviewer. Measured on
     * run 3ed33e: five of seven reviews failed their first `submit` on a
     * missing required field, `out_of_scope` in four of them — 203k tokens of
     * re-read context and re-emitted envelope, 25% of the reviewer's total.
     *
     * The forcing bought nothing. Of the four envelopes that emitted it only
     * after being rejected, two were empty and two were scope disclaimers
     * ("__main__.py and README.md were not reviewed here"). The one
     * substantive entry of the whole run — a staging identifier built two
     * different ways in two modules — came from a reviewer that emitted the
     * field unprompted. A model with something to say here says it; a model
     * forced to fill the array pads it.
     */
    out_of_scope: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Anything noticed outside the reviewed file. Keeps findings honest about scope. Omit rather than pad.",
      }),
    ),
  }),

  advisor: Type.Object({
    concerns: Type.Array(
      Type.Object({
        level: Type.Union([Type.Literal("note"), Type.Literal("concern"), Type.Literal("blocker")]),
        what: Type.String(),
        why: Type.String(),
      }),
    ),
    recommendation: Type.String({
      description: "One option, with the criterion that selects it. Not a menu.",
    }),
  }),
} as const;

type RoleName = keyof typeof payloads;

// ------------------------------------------------------------------- tool

function buildSubmitTool(role: RoleName) {
  // Flat, not { ...envelope, payload: {...} }.
  //
  // Each child sees exactly one role's schema, so the wrapper separated nothing
  // — and it was a measured failure mode: on three scout runs out of three the
  // model called submit with the payload fields at the top level, failed
  // validation, and retried with the wrapper. A turn and a full context re-read,
  // every time, for a nesting nobody needed. The envelope/payload split still
  // exists on disk; dispatch rebuilds it when it writes the artefact.
  const parameters = Type.Object({
    ...envelopeFields,
    ...payloads[role].properties,
  });

  return defineTool({
    name: "submit",
    label: `Submit ${role} result`,
    description:
      `Return the final ${role} result. This is your last action — call it exactly once, ` +
      `and do not write a further assistant message afterwards.`,
    promptSnippet: `End the turn by calling submit with the ${role} envelope`,
    promptGuidelines: [
      "Call submit as the final action of the task.",
      "Every array field has a legal empty form: return [] rather than inventing entries.",
      "Do not restate the payload in prose before or after the call.",
    ],
    parameters,

    async execute(_toolCallId, params: Static<typeof parameters>) {
      return {
        content: [{ type: "text" as const, text: params.summary }],
        details: { role, ...params },
        terminate: true,
      };
    },
  });
}

// -------------------------------------------------------------- extension

export default function (pi: ExtensionAPI) {
  const role = process.env.PI_SUBAGENT_ROLE as RoleName | undefined;

  if (!role || !(role in payloads)) {
    // Fail loudly at load time. A child that silently loses its envelope tool
    // degrades into free-form prose, which is exactly the observed failure.
    throw new Error(
      `envelope: PI_SUBAGENT_ROLE must be one of ${Object.keys(payloads).join(", ")}, got ${role ?? "<unset>"}`,
    );
  }

  pi.registerTool(buildSubmitTool(role));
}
