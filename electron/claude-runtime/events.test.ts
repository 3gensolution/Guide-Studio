import { describe, expect, it } from "vitest";
import { consumeChunk, describeToolInput, parseStreamLine } from "./events";

// Envelopes captured from a real `claude -p --output-format stream-json --verbose`
// run, trimmed to the fields the parser reads.
const INIT = JSON.stringify({
	type: "system",
	subtype: "init",
	cwd: "/tmp/session",
	session_id: "da2c7941-8c97-41cd-bc65-ad3fd955a176",
	tools: ["Read", "Write", "Glob"],
	model: "claude-opus-5",
	permissionMode: "acceptEdits",
});

const RESULT_OK = JSON.stringify({
	type: "result",
	subtype: "success",
	is_error: false,
	duration_ms: 4096,
	num_turns: 3,
	result: "Wrote a 6-frame storyboard totalling 38 seconds.",
	total_cost_usd: 0.108297,
});

describe("parseStreamLine", () => {
	it("reads the init envelope as the session start", () => {
		expect(parseStreamLine(INIT)).toEqual([
			{
				kind: "started",
				sessionId: "da2c7941-8c97-41cd-bc65-ad3fd955a176",
				model: "claude-opus-5",
				tools: ["Read", "Write", "Glob"],
			},
		]);
	});

	it("splits an assistant message into its text and tool calls", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "Planning the frames." },
					{
						type: "tool_use",
						name: "Write",
						input: { file_path: "/tmp/session/output/storyboard.json" },
					},
				],
			},
		});

		expect(parseStreamLine(line)).toEqual([
			{ kind: "text", text: "Planning the frames." },
			{ kind: "tool", tool: "Write", detail: "output/storyboard.json" },
		]);
	});

	it("marks a failed tool result", () => {
		const line = JSON.stringify({
			type: "user",
			message: {
				content: [{ type: "tool_result", is_error: true, content: "File not found\nmore detail" }],
			},
		});

		expect(parseStreamLine(line)).toEqual([
			{ kind: "tool-result", ok: false, detail: "File not found" },
		]);
	});

	it("reports the result envelope with cost and duration", () => {
		expect(parseStreamLine(RESULT_OK)).toEqual([
			{
				kind: "finished",
				ok: true,
				summary: "Wrote a 6-frame storyboard totalling 38 seconds.",
				costUsd: 0.108297,
				durationMs: 4096,
				turns: 3,
			},
		]);
	});

	it("treats an API error result as a failure", () => {
		const line = JSON.stringify({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "API Error: 404 model not found",
		});
		expect(parseStreamLine(line)).toEqual([
			{ kind: "finished", ok: false, summary: "API Error: 404 model not found" },
		]);
	});

	it("keeps non-JSON output as a log line instead of throwing", () => {
		expect(parseStreamLine("npm warn deprecated something")).toEqual([
			{ kind: "log", text: "npm warn deprecated something" },
		]);
	});

	it("ignores blank lines", () => {
		expect(parseStreamLine("   ")).toEqual([]);
	});
});

describe("consumeChunk", () => {
	it("holds a partial line back until its newline arrives", () => {
		const first = consumeChunk("", `${INIT}\n{"type":"resu`);
		expect(first.activities).toHaveLength(1);
		expect(first.buffer).toBe('{"type":"resu');

		const second = consumeChunk(first.buffer, `${RESULT_OK.slice(13)}\n`);
		expect(second.activities).toEqual([
			expect.objectContaining({ kind: "finished", ok: true, turns: 3 }),
		]);
		expect(second.buffer).toBe("");
	});

	it("parses several envelopes delivered in one chunk", () => {
		const { activities } = consumeChunk("", `${INIT}\n${RESULT_OK}\n`);
		expect(activities.map((activity) => activity.kind)).toEqual(["started", "finished"]);
	});
});

describe("describeToolInput", () => {
	it("prefers the tail of a file path", () => {
		expect(describeToolInput("Read", { file_path: "/a/b/c/BRIEF.md" })).toBe("c/BRIEF.md");
	});

	it("falls back to a pattern, then a description", () => {
		expect(describeToolInput("Grep", { pattern: "scene3d" })).toBe("scene3d");
		expect(describeToolInput("TodoWrite", { description: "Plan frames" })).toBe("Plan frames");
	});

	it("returns nothing it cannot summarise", () => {
		expect(describeToolInput("Read", "not an object")).toBeUndefined();
		expect(describeToolInput("Read", { offset: 3 })).toBeUndefined();
	});
});
