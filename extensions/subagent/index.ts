/**
 * subagent — delegation for pi, one tool.
 *
 * Loaded by the ORCHESTRATOR (unlike subagent-only/envelope.ts, which is
 * passed to children with -e). Its tool definition is therefore paid for in
 * every orchestrator session, which is why there is exactly one tool with the
 * role as a parameter, rather than one tool per role: pi-subagents exposes six
 * and costs 5468 tokens of the orchestrator's 14528.
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { homedir } from "node:os";
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

export default function (pi: ExtensionAPI) {
  const agents = loadAgents(join(SELF_DIR, "agents"));

  // The UI context is only handed out with an event or a call. Capture it at
  // session_start so the dispatch loop can publish progress without one.
  let ui: { setStatus?: (k: string, v: string) => void } | undefined;
  pi.on("session_start", async (_event, ctx) => {
    ui = ctx.ui;
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
        "Delegate when the task needs a different model, a context this session should not carry, or parallel read-only work.",
        "Do not delegate a change you could make inline in fewer turns than composing the instruction would take.",
        "The child sees only the task text. Anything implicit here is absent there.",
      ],
      parameters,

      async execute(_id, params: Static<typeof parameters>, { signal }: { signal?: AbortSignal } = {}) {
        const agent = agents.get(params.agent);
        if (!agent) {
          return { content: [{ type: "text" as const, text: `unknown agent: ${params.agent}` }], isError: true };
        }

        // Publish run state for the footer. getExtensionStatuses() is the
        // documented channel between extensions; a shared module import would
        // depend on how pi isolates them.
        const publish = () => ui?.setStatus?.(STATUS_KEY, serialize());

        // The task decides which domain applies, not the role. A static list on
        // the definition hands a Terraform change python-engineering and
        // nothing useful; the definition's list is a default, not a constraint.
        const effective =
          params.skills && params.skills.length > 0 ? { ...agent, skills: params.skills } : agent;

        const result = await dispatch(effective, params.task, {
          ctx: { agentDir: AGENT_DIR, selfDir: SELF_DIR, runId: RUN_ID },
          seq: ++CALL_SEQ,
          signal,
          onProgress: publish,
        });
        publish();

        // Only the summary crosses back. The envelope stays on disk; the
        // orchestrator reads the artifact when it actually needs the findings.
        // The model is named only when it is not the declared one: a fallback
        // took over, and the orchestrator should know which answer it is reading.
        const via = result.modelUsed === agent.model ? "" : ` via ${result.modelUsed}`;
        const head = result.failure
          ? `[${result.role}: ${result.failure}${via}]`
          : `[${result.role}: ${result.status}, next=${result.next}${via}]`;

        // Say which skills came without a severity table. The review still
        // ran; the operator should know one domain was judged on the generic
        // definitions alone rather than discover it from an odd verdict.
        const note = result.withoutDelta.length
          ? `\n(no severity table for: ${result.withoutDelta.join(", ")})`
          : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `${head} ${result.summary}${note}\n${result.artifact}`,
            },
          ],
          details: {
            role: result.role,
            model: result.modelUsed,
            status: result.status,
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
