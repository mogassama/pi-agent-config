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

/**
 * The shape pi hands a `tool_call` handler, read from pi itself rather than guessed.
 *
 * `edit` is `{ path, edits: [{ oldText, newText }] }` in pi 0.84.4, 0.85.1 and 0.86.0, and
 * a handler receives it after `prepareArguments` and validation — legacy forms (a JSON
 * string, a single object, top-level `oldText`/`newText`) arrive already normalised into
 * `edits[]`. There is no `new_str` in any version: reading it is how this gate used to let
 * every edit through unread.
 *
 * Anything else is refused rather than skipped. A gate that cannot tell what a call would
 * write has no ground for letting it through.
 */
type Written = { ok: true; parts: Array<{ label: string; text: string }> } | { ok: false; defect: string };

function whatIsWritten(isWrite: boolean, input: Record<string, unknown>): Written {
  if (isWrite) {
    return typeof input.content === "string"
      ? { ok: true, parts: [{ label: "", text: input.content }] }
      : { ok: false, defect: "content is not a string" };
  }
  const edits = input.edits;
  if (!Array.isArray(edits)) return { ok: false, defect: "edits is not an array" };
  const parts: Array<{ label: string; text: string }> = [];
  for (const [i, entry] of edits.entries()) {
    const n = i + 1;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, defect: `edit ${n} is not an object` };
    }
    const newText = (entry as { newText?: unknown }).newText;
    if (typeof newText !== "string") return { ok: false, defect: `edit ${n} has no string newText` };
    parts.push({ label: `edit ${n}, `, text: newText });
  }
  return { ok: true, parts };
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    const isWrite = isToolCallEventType("write", event);
    const isEdit = isToolCallEventType("edit", event);
    if (!isWrite && !isEdit) return undefined;

    const input = (event.input ?? {}) as Record<string, unknown>;

    // The shape first, and before the exemption: a malformed call is refused whatever its
    // path, because nothing here knows what it would write.
    const written = whatIsWritten(isWrite, input);
    if (!written.ok) {
      return {
        block: true,
        reason:
          `blocked by pi-secret-gate: unexpected ${isWrite ? "write" : "edit"} input shape — ` +
          `${written.defect}. This gate cannot tell what the call would write, so it refuses ` +
          "it rather than let it through unread.",
      };
    }

    const path = typeof input.path === "string" ? input.path : "";
    if (EXEMPT_PATH.test(path)) return undefined;

    // Only what is being written. Scanning the whole file would block an edit
    // for a secret that was already there and that this change did not add —
    // the same "introduced by this change" boundary the reviewer works under.
    // Each newText on its own, so the refusal names the entry that carries the hit.
    const lines: string[] = [];
    for (const part of written.parts) {
      for (const h of scan(part.text)) lines.push(`  ${part.label}line ${h.line} — ${h.label}: ${h.excerpt}`);
    }
    if (lines.length === 0) return undefined;

    return {
      block: true,
      reason:
        `blocked by pi-secret-gate: this write puts a credential-shaped literal in ${path}.\n` +
        lines.join("\n") +
        "\n\nSecrets are never written to source, not even temporarily and not even on a " +
        "feature branch: once it is in git history, deleting the line does not remove it. " +
        "Read the value from the environment or from a secret manager, and commit a " +
        "`.env.example` with a dummy value if the shape needs documenting. If this is a " +
        "false positive — a test fixture, a documented example — give the literal an " +
        "obvious placeholder form rather than working around this gate.",
    };
  });
}
