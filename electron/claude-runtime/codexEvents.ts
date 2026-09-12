// ── Codex CLI stream parsing ─────────────────────────────────────────────
//
// `codex exec --json` writes one JSON envelope per line, in a vocabulary
// unrelated to Claude Code's. Verified against a real run and the event enum
// compiled into codex-cli 0.153.4:
//
//   {"type":"thread.started","thread_id":…}
//   {"type":"turn.started"}
//   {"type":"item.started"|"item.updated"|"item.completed","item":{…}}
//   {"type":"turn.completed","usage":{input_tokens,output_tokens,…}}
//   {"type":"turn.failed","error":{"message":…}}
//   {"type":"error","message":…}
//
// and `item.type` is one of: agent_message, reasoning, command_execution,
// file_change, mcp_tool_call, web_search, todo_list.
//
// It is normalised into the same `ClaudeActivity` union the Claude parser
// produces, so the activity feed, the session runner, and the renderer stay
// agent-agnostic. Two shapes have no counterpart and are mapped rather than
// invented: Codex reports token usage but never a dollar figure, so a
// finished run carries no `costUsd`, and its work happens through shell
// commands, which surface as `tool` entries named after the command.

import type { ClaudeActivity } from "./events";
import { isRecord } from "./json";

/** First line of a shell command, trimmed to something a feed row can hold. */
function summariseCommand(command: string): string {
	const firstLine = command.split("\n")[0] ?? "";
	// Codex wraps commands as `/bin/zsh -lc "…"`; the payload is what matters.
	const unwrapped = /^\S*(?:sh|zsh|bash)\s+-l?c\s+(.*)$/.exec(firstLine.trim())?.[1] ?? firstLine;
	return unwrapped
		.replace(/^["']|["']$/g, "")
		.trim()
		.slice(0, 160);
}

/** The paths a file_change item touched, as one short gloss. */
function summariseChanges(changes: unknown): string | undefined {
	if (!Array.isArray(changes)) return undefined;
	const paths = changes
		.map((change) =>
			isRecord(change) && typeof change.path === "string" ? change.path : undefined,
		)
		.filter((value): value is string => Boolean(value))
		.map((value) => value.split("/").slice(-2).join("/"));
	if (!paths.length) return undefined;
	return paths.length > 2
		? `${paths.slice(0, 2).join(", ")} +${paths.length - 2}`
		: paths.join(", ");
}

/**
 * Turn one `item` payload into activities.
 *
 * `started` is the interesting edge for a command — it is what makes the feed
 * move while a long step runs — and `completed` is where the exit code lives,
 * so a command yields a `tool` on the way in and a `tool-result` on the way
 * out. Everything else is only reported once it has completed, because a
 * half-streamed message reads as noise.
 */
export function fromCodexItem(
	item: unknown,
	phase: "started" | "updated" | "completed",
): ClaudeActivity[] {
	if (!isRecord(item) || typeof item.type !== "string") return [];

	switch (item.type) {
		case "agent_message": {
			if (phase !== "completed") return [];
			const text = typeof item.text === "string" ? item.text.trim() : "";
			return text ? [{ kind: "text", text }] : [];
		}
		case "message": {
			if (phase !== "completed") return [];
			const text = typeof item.text === "string" ? item.text.trim() : "";
			return text ? [{ kind: "text", text }] : [];
		}
		case "reasoning": {
			if (phase !== "completed") return [];
			const text = typeof item.text === "string" ? item.text.trim() : "";
			// Dimmed like a log line: it is context for the user, not the answer.
			return text ? [{ kind: "log", text: text.slice(0, 500) }] : [];
		}
		case "command_execution": {
			const command = typeof item.command === "string" ? summariseCommand(item.command) : undefined;
			if (phase === "started") {
				return [{ kind: "tool", tool: "Shell", ...(command ? { detail: command } : {}) }];
			}
			if (phase !== "completed") return [];
			const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
			const ok = item.status === "completed" && (exitCode === undefined || exitCode === 0);
			const detail = ok ? command : `exit ${exitCode ?? "?"}${command ? ` · ${command}` : ""}`;
			return [{ kind: "tool-result", ok, ...(detail ? { detail } : {}) }];
		}
		case "command": {
			const command = typeof item.command === "string" ? summariseCommand(item.command) : undefined;
			if (phase === "started") {
				return [{ kind: "tool", tool: "Shell", ...(command ? { detail: command } : {}) }];
			}
			if (phase !== "completed") return [];
			const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
			const ok = exitCode === undefined || exitCode === 0;
			const detail = ok ? command : `exit ${exitCode ?? "?"}${command ? ` · ${command}` : ""}`;
			return [{ kind: "tool-result", ok, ...(detail ? { detail } : {}) }];
		}
		case "file_change": {
			if (phase !== "completed") return [];
			const detail = summariseChanges(item.changes);
			return [{ kind: "tool", tool: "Write", ...(detail ? { detail } : {}) }];
		}
		case "mcp_tool_call": {
			if (phase !== "completed") return [];
			const tool = typeof item.tool === "string" ? item.tool : "MCP";
			const server = typeof item.server === "string" ? item.server : undefined;
			return [{ kind: "tool", tool, ...(server ? { detail: server } : {}) }];
		}
		case "web_search": {
			if (phase !== "completed") return [];
			const query = typeof item.query === "string" ? item.query : undefined;
			return [{ kind: "tool", tool: "WebSearch", ...(query ? { detail: query } : {}) }];
		}
		case "todo_list": {
			if (phase !== "completed") return [];
			return [{ kind: "tool", tool: "TodoWrite" }];
		}
		default:
			return [];
	}
}

/** Parse one line of `codex exec --json` output. */
export function parseCodexStreamLine(line: string): ClaudeActivity[] {
	const trimmed = line.trim();
	if (!trimmed) return [];

	let envelope: unknown;
	try {
		envelope = JSON.parse(trimmed);
	} catch {
		// Codex prints human notices on stdout too ("Reading additional input
		// from stdin…"). They are information, not a reason to fail the run.
		return [{ kind: "log", text: trimmed.slice(0, 500) }];
	}
	if (!isRecord(envelope) || typeof envelope.type !== "string") {
		return [{ kind: "log", text: trimmed.slice(0, 500) }];
	}

	switch (envelope.type) {
		case "thread.started":
			return [
				{
					kind: "started",
					sessionId: typeof envelope.thread_id === "string" ? envelope.thread_id : "",
				},
			];
		case "item.started":
			return fromCodexItem(envelope.item, "started");
		case "item.updated":
			return fromCodexItem(envelope.item, "updated");
		case "item.completed":
			return fromCodexItem(envelope.item, "completed");
		case "response_item":
			return fromCodexItem(envelope.item ?? envelope.response_item, "completed");
		case "turn.completed":
			return [{ kind: "finished", ok: true }];
		case "turn.failed": {
			const error = isRecord(envelope.error) ? envelope.error : undefined;
			const summary = typeof error?.message === "string" ? error.message : undefined;
			return [{ kind: "finished", ok: false, ...(summary ? { summary } : {}) }];
		}
		case "error": {
			const text = typeof envelope.message === "string" ? envelope.message : trimmed;
			return [{ kind: "log", text: text.slice(0, 500) }];
		}
		default:
			return [];
	}
}

/**
 * Split a growing stdout buffer into whole lines, returning the parsed
 * activities and whatever partial line is left over for the next chunk.
 */
export function consumeCodexChunk(
	buffer: string,
	chunk: string,
): { activities: ClaudeActivity[]; buffer: string } {
	const combined = buffer + chunk;
	const lines = combined.split("\n");
	const remainder = lines.pop() ?? "";
	const activities = lines.flatMap((line) => parseCodexStreamLine(line));
	return { activities, buffer: remainder };
}

/**
 * Translate the Codex failures that are not really failures of the *plan*.
 *
 * Both of these were hit on a real machine: a Codex CLI old enough that the
 * server refuses its default model, and a model id the signed-in ChatGPT plan
 * does not carry. Neither says anything about the brief, and the raw 400 body
 * gives the user nothing to act on, so they are rewritten into the one action
 * that fixes them.
 */
export function explainCodexError(message: string | undefined): string | undefined {
	if (!message) return message;
	if (/requires a newer version of Codex/i.test(message)) {
		return "Your Codex CLI is too old for the model your ChatGPT account uses. Update it with `npm install -g @openai/codex` and try again.";
	}
	if (/not supported when using Codex with a ChatGPT account/i.test(message)) {
		return "Your ChatGPT plan does not offer that model. Leave the model on Auto, or set one your plan carries in ~/.codex/config.toml.";
	}
	return message;
}
