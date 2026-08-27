/**
 * pi-secret-gate — hard limit 1, enforced at the moment of writing.
 *
 * AGENTS.md lists "secrets hardcoded in source" first among the hard limits,
 * to be refused "regardless of instruction". The only mechanism behind it was
 * the `/audit` block in the `git-collaboration` skill, which runs when the
 * operator invokes the skill — that is, after the fact, on tracked files, and
 * only if a commit is on the way. A worker that writes a key into a module in
 * the middle of a delegation was seen by nothing at all.
 *
 * This runs on the write. Same credential shapes as `/audit`, deliberately:
 * one fact, one file — if a pattern is wrong it is wrong in one place. Shapes,
 * not words, because grepping for `token` across a codebase returns every
 * variable name and buries the one real hit.
 *
 * Blocks rather than warns. A warning to a child is a line in a transcript
 * nobody reads, and the failure mode is permanent: once it is in git history,
 * removing the line does not remove the secret.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

import { EXEMPT_PATH, scan } from "./rules.ts";

export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    const isWrite = isToolCallEventType("write", event);
    const isEdit = isToolCallEventType("edit", event);
    if (!isWrite && !isEdit) return undefined;

    const input = event.input as { path?: string; content?: string; new_str?: string };
    const path = input.path ?? "";
    if (EXEMPT_PATH.test(path)) return undefined;

    // Only what is being written. Scanning the whole file would block an edit
    // for a secret that was already there and that this change did not add —
    // the same "introduced by this change" boundary the reviewer works under.
    const written = isWrite ? input.content : input.new_str;
    if (!written) return undefined;

    const hits = scan(written);
    if (hits.length === 0) return undefined;

    return {
      block: true,
      reason:
        `blocked by pi-secret-gate: this write puts a credential-shaped literal in ${path}.\n` +
        hits.map((h) => `  line ${h.line} — ${h.label}: ${h.excerpt}`).join("\n") +
        "\n\nSecrets are never written to source, not even temporarily and not even on a " +
        "feature branch: once it is in git history, deleting the line does not remove it. " +
        "Read the value from the environment or from a secret manager, and commit a " +
        "`.env.example` with a dummy value if the shape needs documenting. If this is a " +
        "false positive — a test fixture, a documented example — give the literal an " +
        "obvious placeholder form rather than working around this gate.",
    };
  });
}
