import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildArgs, childEnv, DENIED_TOOLS } from "./session";
import { VIDEO_SKILLS } from "./skills";
import {
	buildAgentsDoc,
	buildBrief,
	createWorkspace,
	removeWorkspace,
	workspacePaths,
} from "./workspace";

const created: string[] = [];

function tempBase() {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "guide-claude-"));
	created.push(base);
	return base;
}

afterEach(() => {
	while (created.length) removeWorkspace(created.pop() as string);
});

const BRIEF = {
	request: "A 30 second explainer about our new export pipeline",
	contract: "CONTRACT BODY",
	format: "landscape",
	targetSeconds: 30,
} as const;

describe("createWorkspace", () => {
	it("lays out the session tree and writes every bundled skill", () => {
		const base = tempBase();
		const paths = createWorkspace({ ...BRIEF, baseDir: base, sessionId: "s1" });

		expect(fs.existsSync(paths.outputDir)).toBe(true);
		expect(fs.existsSync(paths.previewDir)).toBe(true);
		expect(fs.existsSync(paths.renderDir)).toBe(true);
		// Codex discovers AGENTS.md on its own; it must be on disk, not only
		// referenced from the prompt.
		expect(fs.existsSync(paths.agentsDocPath)).toBe(true);
		for (const skill of VIDEO_SKILLS) {
			const file = path.join(paths.skillsDir, skill.id, "SKILL.md");
			expect(fs.existsSync(file)).toBe(true);
			// Frontmatter is what Claude Code's skills loader reads.
			expect(fs.readFileSync(file, "utf8")).toMatch(
				new RegExp(`^---\\nname: ${skill.name}\\ndescription: `),
			);
		}
	});

	it("keeps each session in its own folder", () => {
		const base = tempBase();
		const first = createWorkspace({ ...BRIEF, baseDir: base, sessionId: "s1" });
		const second = createWorkspace({ ...BRIEF, baseDir: base, sessionId: "s2" });
		expect(first.root).not.toBe(second.root);
		expect(path.dirname(first.root)).toBe(base);
	});

	it("writes a brief carrying the request, the contract and the skill index", () => {
		const base = tempBase();
		const paths = createWorkspace({ ...BRIEF, baseDir: base, sessionId: "s1" });
		const brief = fs.readFileSync(paths.briefPath, "utf8");

		expect(brief).toContain(BRIEF.request);
		expect(brief).toContain("CONTRACT BODY");
		expect(brief).toContain("output/storyboard.json");
		expect(brief).toContain(".claude/skills/scene-composition/SKILL.md");
	});
});

describe("buildBrief", () => {
	it("states the deliverable before anything else", () => {
		const brief = buildBrief(BRIEF);
		expect(brief.indexOf("output/storyboard.json")).toBeLessThan(brief.indexOf("## The request"));
	});

	it("carries the requested format and length", () => {
		const brief = buildBrief({ ...BRIEF, format: "vertical", targetSeconds: 15 });
		expect(brief).toContain("Format: vertical");
		expect(brief).toContain("about 15 seconds");
	});
});

describe("workspacePaths", () => {
	it("puts the storyboard where the brief promises it", () => {
		const paths = workspacePaths("/sessions/s1");
		expect(paths.storyboardPath).toBe(path.join("/sessions/s1", "output", "storyboard.json"));
	});
});

describe("buildArgs", () => {
	const args = buildArgs("do the thing", "/sessions/s1", "claude-opus-5");

	it("runs headless with the streaming envelope format", () => {
		expect(args.slice(0, 2)).toEqual(["-p", "do the thing"]);
		expect(args).toContain("--output-format");
		expect(args).toContain("stream-json");
		// stream-json only emits the full envelope stream alongside --verbose.
		expect(args).toContain("--verbose");
	});

	it("always pins the model explicitly", () => {
		// An unpinned old CLI defaults to a retired model id and 404s.
		expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5");
	});

	it("confines the run to the session folder", () => {
		expect(args[args.indexOf("--add-dir") + 1]).toBe("/sessions/s1");
	});

	it("denies shell and network tools", () => {
		const denied = args.slice(args.indexOf("--disallowedTools") + 1);
		for (const tool of DENIED_TOOLS) expect(denied).toContain(tool);
	});
});

describe("childEnv", () => {
	it("strips ELECTRON_RUN_AS_NODE so the CLI resolves its own runtime", () => {
		const env = childEnv({ ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin" });
		expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
	});

	it("widens PATH for a GUI launch", () => {
		const env = childEnv({ PATH: "/usr/bin" });
		expect(env.PATH?.split(path.delimiter)).toContain("/usr/local/bin");
	});
});

describe("agent-aware briefing", () => {
	it("tells Claude it has file tools and no shell", () => {
		const brief = buildBrief({
			agent: "claude",
			request: "a video",
			contract: "contract",
			format: "landscape",
			targetSeconds: 30,
		});
		expect(brief).toContain("Read, Write, Edit, Glob, and Grep");
		expect(brief).toContain("There is no");
	});

	it("tells Codex the truth about its sandbox instead", () => {
		// Codex works through a shell, so describing Claude's file-tool
		// restriction to it would be a restriction it can see is false.
		const brief = buildBrief({
			agent: "codex",
			request: "a video",
			contract: "contract",
			format: "landscape",
			targetSeconds: 30,
		});
		expect(brief).toContain("Shell commands are available and confined to it");
		expect(brief).not.toContain("Read, Write, Edit, Glob, and Grep");
	});

	it("keeps both agents pointed at the same deliverable", () => {
		for (const agent of ["claude", "codex"] as const) {
			const brief = buildBrief({
				agent,
				request: "a video",
				contract: "contract",
				format: "landscape",
				targetSeconds: 30,
			});
			expect(brief).toContain("output/storyboard.json");
			expect(brief).toContain("assetQuery");
		}
	});

	it("writes an AGENTS.md that points at the brief rather than copying it", () => {
		const doc = buildAgentsDoc("codex");
		expect(doc).toContain("BRIEF.md");
		expect(doc).toContain("output/storyboard.json");
		expect(doc).toContain("Codex");
		// A copy would be a second source of truth for the contract.
		expect(doc).not.toContain("## The frame contract");
	});
});
