// ── Claude Code stream parsing ───────────────────────────────────────────
//
// `claude -p --output-format stream-json --verbose` writes one JSON envelope
// per line. The shapes we care about, taken from a real run:
//
//   {"type":"system","subtype":"init","session_id":…,"model":…,"tools":[…]}
//   {"type":"assistant","message":{"content":[{"type":"text"|"tool_use",…}]}}
//   {"type":"user","message":{"content":[{"type":"tool_result",…}]}}
//   {"type":"result","subtype":"success","is_error":…,"result":…,"usage":…}
//
// A line can also be plain text — a warning or a stack trace — because the
// CLI does not guarantee that every byte on stdout is JSON. Anything that
// does not parse is surfaced as a log line rather than throwing, so one odd
// line never kills a run that is otherwise producing a storyboard.

import { isRecord } from "./json";

export type ClaudeActivity =
	| { kind: "started"; sessionId: string; model?: string; tools?: string[] }
	| { kind: "text"; text: string }
	| { kind: "tool"; tool: string; detail?: string }
	| { kind: "tool-result"; ok: boolean; detail?: string }
	| { kind: "log"; text: string }
	| {
			kind: "finished";
			ok: boolean;
			summary?: string;
			costUsd?: number;
			durationMs?: number;
			turns?: number;
	  };

/** A short, human-readable gloss of a tool call for the activity feed. */
export function describeToolInput(_tool: string, input: unknown): string | undefined {
	if (!isRecord(input)) return undefined;
	const filePath = typeof input.file_path === "string" ? input.file_path : undefined;
	if (filePath) return filePath.split("/").slice(-2).join("/");
	const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
	if (pattern) return pattern;
	const description = typeof input.description === "string" ? input.description : undefined;
	if (description) return description;
	return undefined;
}

/** Collapse a content block list into the activities it represents. */
function fromContent(content: unknown): ClaudeActivity[] {
	if (!Array.isArray(content)) return [];
	const activities: ClaudeActivity[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (block.type === "text" && typeof block.text === "string") {
			const text = block.text.trim();
			if (text) activities.push({ kind: "text", text });
		}
		if (block.type === "tool_use" && typeof block.name === "string") {
			const detail = describeToolInput(block.name, block.input);
			activities.push({ kind: "tool", tool: block.name, ...(detail ? { detail } : {}) });
		}
		if (block.type === "tool_result") {
			const ok = block.is_error !== true;
			const raw = typeof block.content === "string" ? block.content : undefined;
			const detail = raw ? raw.split("\n")[0]?.slice(0, 160) : undefined;
			activities.push({ kind: "tool-result", ok, ...(detail ? { detail } : {}) });
		}
	}
	return activities;
}

/**
 * Parse one line of the stream. Returns every activity that line represents —
 * an assistant message carrying two tool calls yields two.
 */
export function parseStreamLine(line: string): ClaudeActivity[] {
	const trimmed = line.trim();
	if (!trimmed) return [];

	let envelope: unknown;
	try {
		envelope = JSON.parse(trimmed);
	} catch {
		return [{ kind: "log", text: trimmed.slice(0, 500) }];
	}
	if (!isRecord(envelope)) return [{ kind: "log", text: trimmed.slice(0, 500) }];

	if (envelope.type === "system" && envelope.subtype === "init") {
		return [
			{
				kind: "started",
				sessionId: typeof envelope.session_id === "string" ? envelope.session_id : "",
				...(typeof envelope.model === "string" ? { model: envelope.model } : {}),
				...(Array.isArray(envelope.tools)
					? { tools: envelope.tools.filter((tool): tool is string => typeof tool === "string") }
					: {}),
			},
		];
	}

	if (envelope.type === "assistant" || envelope.type === "user") {
		const message = isRecord(envelope.message) ? envelope.message : undefined;
		return fromContent(message?.content);
	}

	if (envelope.type === "result") {
		const summary = typeof envelope.result === "string" ? envelope.result : undefined;
		return [
			{
				kind: "finished",
				ok: envelope.is_error !== true,
				...(summary ? { summary } : {}),
				...(typeof envelope.total_cost_usd === "number"
					? { costUsd: envelope.total_cost_usd }
					: {}),
				...(typeof envelope.duration_ms === "number" ? { durationMs: envelope.duration_ms } : {}),
				...(typeof envelope.num_turns === "number" ? { turns: envelope.num_turns } : {}),
			},
		];
	}

	return [];
}

/**
 * Split a growing stdout buffer into whole lines, returning the parsed
 * activities and whatever partial line is left over for the next chunk.
 */
export function consumeChunk(
	buffer: string,
	chunk: string,
): { activities: ClaudeActivity[]; buffer: string } {
	const combined = buffer + chunk;
	const lines = combined.split("\n");
	// The last element is either "" (chunk ended on a newline) or a partial line.
	const remainder = lines.pop() ?? "";
	const activities = lines.flatMap((line) => parseStreamLine(line));
	return { activities, buffer: remainder };
}
