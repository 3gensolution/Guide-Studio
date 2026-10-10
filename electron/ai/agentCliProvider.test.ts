import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp/guide-studio-test" },
}));

const {
	buildClaudeTextArgs,
	buildCodexTextArgs,
	codexPrompt,
	parseClaudeResult,
	parseCodexResult,
} = await import("./agentCliProvider");

describe("buildClaudeTextArgs", () => {
	it("always pins the model and denies every tool for a text answer", () => {
		const args = buildClaudeTextArgs({ prompt: "hi", model: "" });
		expect(args.slice(0, 5)).toEqual([
			"-p",
			"--output-format",
			"json",
			"--model",
			"claude-sonnet-5",
		]);
		const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
		expect(denied).toEqual(expect.arrayContaining(["Bash", "Write", "Edit", "WebFetch", "Read"]));
		expect(args).not.toContain("--allowedTools");
		// The prompt itself never rides in argv.
		expect(args).not.toContain("hi");
	});

	it("allows only Read when there is an image to look at", () => {
		const args = buildClaudeTextArgs({ prompt: "x", model: "claude-opus-5" }, "/tmp/a/image.png");
		const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
		expect(denied).not.toContain("Read");
		expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read");
	});

	it("passes the system prompt as an appended system prompt", () => {
		const args = buildClaudeTextArgs({ prompt: "x", systemPrompt: "Be terse." });
		expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("Be terse.");
	});
});

describe("buildCodexTextArgs", () => {
	it("runs read-only, reads the prompt from stdin, and never pins an unasked model", () => {
		const args = buildCodexTextArgs("/tmp/w");
		expect(args[0]).toBe("exec");
		expect(args).toContain("--json");
		expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
		expect(args[args.indexOf("--cd") + 1]).toBe("/tmp/w");
		expect(args).not.toContain("--model");
		expect(args.at(-1)).toBe("-");
	});

	it("pins a model and attaches an image only when given", () => {
		const args = buildCodexTextArgs("/tmp/w", "gpt-5.5", "/tmp/w/image.png");
		expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.5");
		expect(args[args.indexOf("--image") + 1]).toBe("/tmp/w/image.png");
	});

	it("folds the system prompt into the prompt", () => {
		const prompt = codexPrompt("Write a title", "Return JSON");
		expect(prompt).toContain("<instructions>\nReturn JSON\n</instructions>");
		expect(prompt.endsWith("Write a title")).toBe(true);
	});
});

describe("parseClaudeResult", () => {
	it("reads the answer and counts cached input as input", () => {
		const out = JSON.stringify({
			type: "result",
			subtype: "success",
			is_error: false,
			result: " OK ",
			usage: { input_tokens: 2, cache_creation_input_tokens: 100, output_tokens: 8 },
		});
		expect(parseClaudeResult(`${out}\n`)).toEqual({
			text: "OK",
			inputTokens: 102,
			outputTokens: 8,
		});
	});

	it("surfaces an error envelope", () => {
		const out = JSON.stringify({ subtype: "success", is_error: true, result: "Invalid API key" });
		expect(parseClaudeResult(out).error).toBe("Invalid API key");
	});

	it("treats non-JSON output as the error", () => {
		expect(parseClaudeResult("Please run /login").error).toBe("Please run /login");
	});
});

describe("parseCodexResult", () => {
	const line = (event: unknown) => JSON.stringify(event);

	it("returns the last agent message and the turn's usage", () => {
		const out = [
			line({ type: "thread.started", thread_id: "t" }),
			line({ type: "item.completed", item: { type: "error", message: "metadata warning" } }),
			line({ type: "item.completed", item: { type: "reasoning", text: "thinking" } }),
			line({ type: "item.completed", item: { type: "agent_message", text: "OK" } }),
			line({ type: "turn.completed", usage: { input_tokens: 50, output_tokens: 3 } }),
		].join("\n");
		expect(parseCodexResult(out)).toEqual({ text: "OK", inputTokens: 50, outputTokens: 3 });
	});

	it("turns a plan-model rejection into an action", () => {
		const body = JSON.stringify({
			error: {
				message: "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.",
			},
		});
		const out = [
			line({ type: "error", message: body }),
			line({ type: "turn.failed", error: { message: body } }),
		].join("\n");
		expect(parseCodexResult(out).error).toMatch(/ChatGPT plan does not offer that model/);
	});
});
