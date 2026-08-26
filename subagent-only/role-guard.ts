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
import { basename } from "node:path";
import { bundleRoot, isBundleFile, refuseMutation } from "./role-rules.ts";

export default function (pi: ExtensionAPI): void {
  const role = process.env.PI_SUBAGENT_ROLE ?? "";
  const readOnly = process.env.PI_SUBAGENT_READONLY === "1";
  const root = bundleRoot(process.cwd());


  pi.on("tool_call", async (event) => {
    // --- The frozen bundle -------------------------------------------------
    if (root) {
      const path =
        isToolCallEventType("read", event) ||
        isToolCallEventType("write", event) ||
        isToolCallEventType("edit", event)
          ? (event.input as { path?: string })?.path
          : undefined;

      if (path && isBundleFile(path, root)) {
        const writing = !isToolCallEventType("read", event);
        const reason = writing
          ? `blocked by role-guard: ${basename(path)} is a frozen bundle file. Only the ` +
            "operator changes it, and the one field pi may write — the `Statut` line of a " +
            "DESIGN.md decision — belongs to the orchestrator, not to a delegation. If the " +
            "task cannot be done without changing it, say so in `deviations` and implement " +
            "what can be."
          : `blocked by role-guard: ${basename(path)} is a frozen bundle file, and whatever ` +
            "you need from it has been quoted into your task verbatim. Reading it returns " +
            "what you were already given and costs turns you will need for the work. If " +
            "something decisive is genuinely missing from the task text, name it in your " +
            "envelope rather than going to look for it.";
        return { block: true, reason };
      }
    }

    // --- Read-only means read-only through bash too ------------------------
    if (readOnly && isToolCallEventType("bash", event)) {
      const reason = refuseMutation(event.input.command);
      if (reason) {
        return {
          block: true,
          reason:
            `blocked by role-guard: ${reason}. \`${role || "this role"}\` is read-only — it ` +
            "has no `edit` and no `write` by design, and `bash` is not a way around that. " +
            "Use it to search and to read. If the answer requires changing something, that " +
            "is a different role and the orchestrator's call, not yours.",
        };
      }
    }

    return undefined;
  });
}
