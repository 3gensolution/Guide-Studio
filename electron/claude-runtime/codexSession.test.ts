import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "./codexSession";

describe("buildCodexArgs", () => {
	const args = buildCodexArgs("do the thing", "/tmp/session");

	it("runs headless with the JSON event stream", () => {
		expect(args[0]).toBe("exec");
		expect(args).toContain("--json");
	});

	it("confines the run to the session folder", () => {
		// Codex has no tool allowlist — the sandbox is the tool policy, so
		// these two flags are the whole containment story.
		expect(args).toContain("--sandbox");
		expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace-write");
		expect(args[args.indexOf("--cd") + 1]).toBe("/tmp/session");
	});

	it("allows a workspace that is not a git repo", () => {
		expect(args).toContain("--skip-git-repo-check");
	});

	it("passes the prompt last, as a positional argument", () => {
		expect(args.at(-1)).toBe("do the thing");
	});

	// The opposite of the Claude rule, and deliberately so: a Codex model id
	// the CLI or the signed-in plan does not carry fails the run with a 400,
	// so an unspecified model must reach the CLI as "you choose".
	it("omits --model unless one was explicitly chosen", () => {
		expect(buildCodexArgs("p", "/tmp/s")).not.toContain("--model");
		expect(buildCodexArgs("p", "/tmp/s", "")).not.toContain("--model");
	});

	it("passes an explicit model through", () => {
		const pinned = buildCodexArgs("p", "/tmp/s", "gpt-5.1-codex");
		expect(pinned[pinned.indexOf("--model") + 1]).toBe("gpt-5.1-codex");
	});
});
