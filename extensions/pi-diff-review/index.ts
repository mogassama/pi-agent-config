/**
 * pi-diff-review — Sends the current git diff to the agent for code review.
 *
 * Usage: /diff-review
 *
 * Behaviour:
 *   1. Runs `git diff HEAD~1 -- . ':(exclude)*.lock'` (last commit vs. working tree).
 *   2. Falls back to `git diff` (unstaged changes) if the first command yields nothing.
 *   3. Notifies the user and returns early if no diff is found.
 *   4. Injects the diff as a user message, asking the agent to review it with the
 *      code-review skill.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("diff-review", {
    description: "Review the current git diff using the code-review skill",
    handler: async (_args, ctx) => {
      // 1. Try last-commit diff, excluding lock files
      let result = await pi.exec("git", ["diff", "HEAD~1", "--", ".", ":(exclude)*.lock"]);
      let diff = result.stdout.trim();

      // 2. Fall back to unstaged changes
      if (!diff) {
        result = await pi.exec("git", ["diff"]);
        diff = result.stdout.trim();
      }

      // 3. Nothing to review
      if (!diff) {
        ctx.ui.notify("No diff found", "info");
        return;
      }

      // 4. Delegate to reviewer subagent via orchestrator
      const prompt =
        "Delegate to /reviewer: review the following git diff using the code-review skill. " +
        "Focus on: bugs, style violations, security issues, missing tests. Be concise." +
        `\n\n<diff>\n${diff}\n</diff>`;

      pi.sendUserMessage(prompt);
    },
  });
}
