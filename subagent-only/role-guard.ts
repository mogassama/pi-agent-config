/**
 * role-guard — the child-side half of two rules that were prompt-only.
 *
 * Loaded into every child by `buildSpawnPlan`, not listed in any frontmatter:
 * a guarantee one can forget to declare on a new role is not a guarantee. It
 * enforces exactly two things, both of them stated identically in three role
 * prompts and both of them measured as not holding.
 *
 *   1. The four bundle files are frozen and already quoted into the task.
 *      Prompt: "Do not open the project's instruction files." Measured on run
 *      `8c88c5` — a worker spent six turns reading before its first write, four
 *      of them on bundle files whose relevant content was already in its task.
 *      Writing them is worse: AGENTS.md reserves the whole bundle to the
 *      operator, with the `Statut` line of a DESIGN.md decision as the single
 *      exception, and that exception belongs to the orchestrator, not here.
 *
 *   2. A read-only role is read-only through `bash` too. The scout's tool list
 *      denies `edit` and `write`; `bash` hands them straight back. Its prompt
 *      says "`bash` is for reading. Never mutate" and lists `rm`, `mv`, `>`,
 *      git-that-writes and package installs — of which bash-guard patterns
 *      catch only `rm -rf`. The rest passed silently.
 *
 * Nothing here is a judgement call, which is why it can live in code. What is
 * a judgement call — whether a search is worth delegating, whether a fork is
 * durable — stays in the prompts.
 *
 * The predicates themselves are in `role-rules.ts`, which imports nothing from
 * pi and is therefore unit-testable. This file is the wiring.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { bundleRoot, decideRoleGuard } from "./role-rules.ts";

export default function (pi: ExtensionAPI): void {
  const role = process.env.PI_SUBAGENT_ROLE ?? "";
  const readOnly = process.env.PI_SUBAGENT_READONLY === "1";
  const root = bundleRoot(process.cwd());

  pi.on("tool_call", async (event) => {
    /*
     * Translation, and nothing else.
     *
     * Everything decidable from a kind, an input and a role lives in
     * `role-rules.ts`, where it is tested without pi. What stays here is the
     * one thing that cannot: turning a pi event into a tool kind. When this
     * file grows a rule again, the rule has left the reach of the suite.
     */
    const kind = isToolCallEventType("read", event)
      ? "read"
      : isToolCallEventType("write", event)
        ? "write"
        : isToolCallEventType("edit", event)
          ? "edit"
          : isToolCallEventType("bash", event)
            ? "bash"
            : "other";

    const reason = decideRoleGuard(kind, (event.input ?? {}) as Record<string, string>, {
      root,
      readOnly,
      role,
    });
    return reason ? { block: true, reason } : undefined;
  });
}
