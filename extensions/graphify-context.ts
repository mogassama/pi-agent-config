/**
 * graphify-context — Auto-inject graphify-out/GRAPH_REPORT.md at session start.
 *
 * Mirrors the PreToolUse hook behaviour of Claude Code / OpenCode:
 * the graph report is read once from disk on session_start and injected
 * into the system prompt on the FIRST agent turn. The file is never
 * re-read on subsequent tool calls or turns within the same session.
 *
 * No-op in projects without graphify-out/GRAPH_REPORT.md.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function graphifyContext(pi: ExtensionAPI) {
	// Cached from disk once per session. null = no report / not yet loaded.
	let graphReportContent: string | null = null;
	// Flipped to true after the first before_agent_start injection this session.
	let injected = false;

	pi.on("session_start", async (_event, ctx) => {
		graphReportContent = null;
		injected = false;

		const reportPath = path.join(ctx.cwd, "graphify-out", "GRAPH_REPORT.md");
		try {
			graphReportContent = await readFile(reportPath, "utf-8");
			if (ctx.hasUI) {
				ctx.ui.notify("graphify: knowledge graph loaded", "info");
			}
		} catch {
			// File absent or unreadable — extension is inert for this session.
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (!graphReportContent || injected) return undefined;

		injected = true;

		return {
			systemPrompt:
				event.systemPrompt +
				"\n\n## Graphify Knowledge Graph\n\n" +
				"The following is the pre-built knowledge graph for this codebase. " +
				"Use it to orient yourself before reading files or answering architecture questions.\n\n" +
				graphReportContent,
		};
	});
}
