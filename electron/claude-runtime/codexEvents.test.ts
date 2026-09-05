import { describe, expect, it } from "vitest";
import { consumeCodexChunk, explainCodexError, parseCodexStreamLine } from "./codexEvents";

// Every envelope below is copied from a real `codex exec --json` run against
// codex-cli 0.153.4, so a change in the CLI's output breaks these first.
const THREAD_STARTED =
	'{"type":"thread.started","thread_id":"01a072e6-d6da-7be1-a54e-1c2f7c825e27"}';
const AGENT_MESSAGE =
	'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Created `hello.json`."}}';
const COMMAND_STARTED =
	'{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \\"printf %s > hello.json\\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}';
const COMMAND_DONE =
	'{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \\"printf %s > hello.json\\"","aggregated_output":"","exit_code":0,"status":"completed"}}';
const TURN_COMPLETED =
	'{"type":"turn.completed","usage":{"input_tokens":34847,"cached_input_tokens":30080,"output_tokens":72}}';

describe("parseCodexStreamLine", () => {
	it("reads a thread id off thread.started", () => {
		expect(parseCodexStreamLine(THREAD_STARTED)).toEqual([
			{ kind: "started", sessionId: "01a072e6-d6da-7be1-a54e-1c2f7c825e27" },
		]);
	});

	it("turns a completed agent message into text", () => {
		expect(parseCodexStreamLine(AGENT_MESSAGE)).toEqual([
			{ kind: "text", text: "Created `hello.json`." },
		]);
	});

	it("reports a command on the way in and its result on the way out", () => {
		// The started edge is what keeps the feed moving during a long step.
		expect(parseCodexStreamLine(COMMAND_STARTED)).toEqual([
			{ kind: "tool", tool: "Shell", detail: "printf %s > hello.json" },
		]);
		expect(parseCodexStreamLine(COMMAND_DONE)).toEqual([
			{ kind: "tool-result", ok: true, detail: "printf %s > hello.json" },
		]);
	});

	it("marks a non-zero exit as a failed tool result", () => {
		const line =
			'{"type":"item.completed","item":{"type":"command_execution","command":"false","exit_code":1,"status":"completed"}}';
		const [activity] = parseCodexStreamLine(line);
		expect(activity).toMatchObject({ kind: "tool-result", ok: false });
		expect(activity).toHaveProperty("detail", expect.stringContaining("exit 1"));
	});

	it("does not emit a half-streamed message twice", () => {
		const updated = '{"type":"item.updated","item":{"type":"agent_message","text":"partial"}}';
		expect(parseCodexStreamLine(updated)).toEqual([]);
	});

	it("finishes on turn.completed and turn.failed", () => {
		expect(parseCodexStreamLine(TURN_COMPLETED)).toEqual([{ kind: "finished", ok: true }]);
		expect(parseCodexStreamLine('{"type":"turn.failed","error":{"message":"boom"}}')).toEqual([
			{ kind: "finished", ok: false, summary: "boom" },
		]);
	});

	it("keeps a non-JSON notice as a log line rather than throwing", () => {
		expect(parseCodexStreamLine("Reading additional input from stdin...")).toEqual([
			{ kind: "log", text: "Reading additional input from stdin..." },
		]);
	});

	it("ignores envelope types it does not model", () => {
		expect(parseCodexStreamLine('{"type":"turn.started"}')).toEqual([]);
	});
});

describe("consumeCodexChunk", () => {
	it("holds a partial line back until its newline arrives", () => {
		const first = consumeCodexChunk("", `${THREAD_STARTED}\n${AGENT_MESSAGE.slice(0, 30)}`);
		expect(first.activities).toHaveLength(1);
		expect(first.buffer).toBe(AGENT_MESSAGE.slice(0, 30));

		const second = consumeCodexChunk(first.buffer, `${AGENT_MESSAGE.slice(30)}\n`);
		expect(second.activities).toEqual([{ kind: "text", text: "Created `hello.json`." }]);
		expect(second.buffer).toBe("");
	});
});

describe("explainCodexError", () => {
	// Both of these were returned by the real API on a real machine; the raw
	// 400 body gives the user nothing to act on.
	it("turns an outdated-CLI 400 into an upgrade instruction", () => {
		const message = explainCodexError(
			`unexpected status 400 Bad Request: {"detail":"The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}`,
		);
		expect(message).toContain("npm install -g @openai/codex");
	});

	it("explains a model the signed-in plan does not carry", () => {
		const message = explainCodexError(
			`unexpected status 400 Bad Request: {"detail":"The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account."}`,
		);
		expect(message).toContain("Auto");
	});

	it("passes anything else through untouched", () => {
		expect(explainCodexError("Cancelled.")).toBe("Cancelled.");
		expect(explainCodexError(undefined)).toBeUndefined();
	});
});
