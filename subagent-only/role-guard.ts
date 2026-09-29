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
 *      A write is a write whatever carries it: the bundle rule reads the
 *      destinations of a `bash` command too, for every role, read-only or not,
 *      resolved from the directory the child is in (`cwd`, read at each event).
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
 * One reminder, and only a reminder (lot ITE, P1-B): grouping independent edits IS
 * a judgement call, so it lives in the worker prompt. What is detectable is the
 * shape that contradicts it — the same file edited alone turn after turn — and
 * there a note is appended to the call's result. Never a block: a refusal costs a
 * turn.
 *
 * The predicates themselves are in `role-rules.ts`, which imports nothing from
 * pi and is therefore unit-testable. This file is the wiring.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { bundleRoot, decideRoleGuard, noteDeRegroupement, type TourObserve } from "./role-rules.ts";

export default function (pi: ExtensionAPI): void {
  const role = process.env.PI_SUBAGENT_ROLE ?? "";
  const readOnly = process.env.PI_SUBAGENT_READONLY === "1";
  const root = bundleRoot(process.cwd());
  // P1-B : les tours clos, le tour en cours, et une note au plus par tour.
  const historique: TourObserve[] = [];
  let courant: TourObserve = { appels: [] };
  let noteDonnee = false;
  const appelsParId = new Map<string, { outil: string; chemin?: string }>();

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

    // `cwd` is read here, at each event, never frozen at load: it is the directory a
    // relative destination is written from, and the only value that says so is the
    // process's own.
    const input = (event.input ?? {}) as Record<string, string>;
    const vu = {
      outil: typeof (event as { toolName?: unknown }).toolName === "string" ? (event as { toolName: string }).toolName : kind,
      chemin: typeof input.path === "string" ? input.path : undefined,
    };
    courant.appels.push(vu);
    const id = (event as { toolCallId?: unknown }).toolCallId;
    if (typeof id === "string") appelsParId.set(id, vu);
    const reason = decideRoleGuard(kind, input, {
      root,
      cwd: process.cwd(),
      readOnly,
      role,
    });
    return reason ? { block: true, reason } : undefined;
  });

  pi.on("tool_result", async (event) => {
    const e = event as { toolCallId?: unknown; content?: Array<{ type: string; text?: string }> };
    const vu = typeof e.toolCallId === "string" ? appelsParId.get(e.toolCallId) : undefined;
    if (!vu) return undefined;
    const contenu = e.content ?? [];
    if (vu.outil === "edit" && contenu.some((c) => typeof c.text === "string" && c.text.includes("--- ruff ("))) {
      courant.ruff = true;
    }
    const note = noteDeRegroupement({ role, readOnly }, historique, courant, vu, noteDonnee);
    if (!note) return undefined;
    noteDonnee = true;
    return { content: [...contenu, { type: "text" as const, text: `\n\n${note}` }] };
  });

  pi.on("turn_end", async () => {
    historique.push(courant);
    courant = { appels: [] };
    noteDonnee = false;
    appelsParId.clear();
  });
}
