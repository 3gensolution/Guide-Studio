// ── Session workspace ────────────────────────────────────────────────────
//
// Every run gets its own directory under userData, and that directory is the
// only place Claude can touch: it is the process cwd, the only path passed to
// `--add-dir`, and the sandbox the allowed file tools are scoped to.
//
//   <userData>/claude-runtime/<sessionId>/
//     .claude/skills/<id>/SKILL.md   the bundled skill pack
//     BRIEF.md                       the request, the contract, the skills index
//     output/storyboard.json         the deliverable Claude writes
//     output/preview/                stills we render from it afterwards
//     assets/                        stock images Guide Studio fetched for it
//     render/<title>.mp4             the finished video
//
// Keeping the brief on disk rather than only in the prompt matters for older
// Claude Code builds: they have no skills loader, but they can always read a
// file in their own working directory.

import fs from "node:fs";
import path from "node:path";
import { skillFileContents, skillIndex, VIDEO_SKILLS, type VideoSkill } from "./skills";

export interface WorkspacePaths {
	root: string;
	briefPath: string;
	outputDir: string;
	storyboardPath: string;
	previewDir: string;
	renderDir: string;
	skillsDir: string;
	/** Where fetched stock images land. Inside the session, so nothing leaks out. */
	assetsDir: string;
}

export function workspacePaths(root: string): WorkspacePaths {
	return {
		root,
		briefPath: path.join(root, "BRIEF.md"),
		outputDir: path.join(root, "output"),
		storyboardPath: path.join(root, "output", "storyboard.json"),
		previewDir: path.join(root, "output", "preview"),
		renderDir: path.join(root, "render"),
		skillsDir: path.join(root, ".claude", "skills"),
		assetsDir: path.join(root, "assets"),
	};
}

export interface BriefInput {
	/** What the user typed in the creator window. */
	request: string;
	/** The generated contract describing the frame library and its limits. */
	contract: string;
	format: "landscape" | "vertical" | "square";
	targetSeconds: number;
	skills?: VideoSkill[];
}

/**
 * The single document Claude is pointed at. It leads with the deliverable,
 * because a model that reads only the first paragraph should still write the
 * right file to the right path.
 */
export function buildBrief(input: BriefInput): string {
	const skills = input.skills ?? VIDEO_SKILLS;
	return [
		"# Guide Studio — video brief",
		"",
		"## Your deliverable",
		"",
		"Write a single file at `output/storyboard.json` containing one JSON object",
		"and nothing else — no prose, no markdown fence, no commentary in the file.",
		"That file is the entire deliverable. Guide Studio validates it, renders it",
		"locally, and shows the result to the user.",
		"",
		"## The request",
		"",
		input.request.trim(),
		"",
		"## Output shape",
		"",
		`Format: ${input.format}. Target length: about ${input.targetSeconds} seconds.`,
		"",
		"## The frame contract",
		"",
		input.contract,
		"",
		"## Craft skills",
		"",
		"These skills are the house style for this renderer. Read the ones relevant",
		"to the request before you plan, and follow them:",
		"",
		skillIndex(skills),
		"",
		"## How to work",
		"",
		"1. Read the skills above that apply to this request.",
		"2. Plan the frame sequence before writing any file.",
		"3. Write `output/storyboard.json`.",
		"4. Read it back and confirm it parses and obeys the contract limits.",
		"",
		"You have Read, Write, Edit, Glob, and Grep inside this folder. There is no",
		"shell and no network access. You do not need either: when a frame should",
		"show a photograph, name what you want with `assetQuery` as the frame",
		"contract describes, and Guide Studio finds it, downloads it, and credits",
		"the photographer for you after this run finishes.",
		"",
	].join("\n");
}

/** The prompt handed to `claude -p`. Short by design: the brief holds the detail. */
export function buildPrompt(): string {
	return [
		"Read BRIEF.md in this directory and produce the storyboard it asks for.",
		"Follow the craft skills it points you at, then write output/storyboard.json.",
		"When the file is written and verified, reply with one short sentence naming",
		"the number of frames and the total duration. Do not paste the JSON.",
	].join(" ");
}

export interface CreateWorkspaceOptions extends BriefInput {
	/** `<userData>/claude-runtime` — the parent every session lives under. */
	baseDir: string;
	sessionId: string;
}

/** Create the session directory tree and write the brief and skill pack into it. */
export function createWorkspace(options: CreateWorkspaceOptions): WorkspacePaths {
	const root = path.join(options.baseDir, options.sessionId);
	const paths = workspacePaths(root);

	fs.mkdirSync(paths.outputDir, { recursive: true });
	fs.mkdirSync(paths.previewDir, { recursive: true });
	fs.mkdirSync(paths.renderDir, { recursive: true });
	fs.mkdirSync(paths.skillsDir, { recursive: true });
	fs.mkdirSync(paths.assetsDir, { recursive: true });

	for (const skill of options.skills ?? VIDEO_SKILLS) {
		const skillDir = path.join(paths.skillsDir, skill.id);
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillFileContents(skill), "utf8");
	}

	fs.writeFileSync(paths.briefPath, buildBrief(options), "utf8");
	return paths;
}

/** Remove a session's workspace. Best-effort: a locked file must not throw. */
export function removeWorkspace(root: string): void {
	try {
		fs.rmSync(root, { recursive: true, force: true });
	} catch {
		/* the next launch's cleanup will get it */
	}
}
