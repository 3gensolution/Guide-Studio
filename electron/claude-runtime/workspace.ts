// ── Session workspace ────────────────────────────────────────────────────
//
// Every run gets its own directory under userData, and that directory is the
// only place the agent can touch: it is the process cwd, the only path passed
// to `--add-dir` (Claude) or `--cd` under a write sandbox (Codex).
//
//   <userData>/claude-runtime/<sessionId>/
//     .claude/skills/<id>/SKILL.md   the bundled skill pack
//     AGENTS.md                      pointer to the brief, for agents that read it
//     BRIEF.md                       the request, the contract, the skills index
//     output/storyboard.json         the deliverable the agent writes
//     output/preview/                stills we render from it afterwards
//     assets/                        stock images Guide Studio fetched for it
//     render/<title>.mp4             the finished video
//
// Keeping the brief on disk rather than only in the prompt is what makes the
// workspace agent-agnostic. Older Claude Code builds have no skills loader and
// Codex does not read `.claude/` at all, but both can always read a file in
// their own working directory — so the skill pack is written once, in Claude's
// layout, and every agent is pointed at those paths by the brief.

import fs from "node:fs";
import path from "node:path";
import { type AgentId, agentLabel } from "./agents";
import { skillFileContents, skillIndex, VIDEO_SKILLS, type VideoSkill } from "./skills";

export interface WorkspacePaths {
	root: string;
	briefPath: string;
	/** Codex reads this automatically; it just points at the brief. */
	agentsDocPath: string;
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
		agentsDocPath: path.join(root, "AGENTS.md"),
		outputDir: path.join(root, "output"),
		storyboardPath: path.join(root, "output", "storyboard.json"),
		previewDir: path.join(root, "output", "preview"),
		renderDir: path.join(root, "render"),
		skillsDir: path.join(root, ".claude", "skills"),
		assetsDir: path.join(root, "assets"),
	};
}

export interface BriefInput {
	/** Which CLI will read this. Only the tools paragraph depends on it. */
	agent?: AgentId;
	/** What the user typed in the creator window. */
	request: string;
	/** The generated contract describing the frame library and its limits. */
	contract: string;
	format: "landscape" | "vertical" | "square";
	targetSeconds: number;
	skills?: VideoSkill[];
}

/**
 * What the agent is allowed to do, in its own terms. The two agents reach the
 * same place — nothing outside this folder is reachable — but describing
 * Claude's file tools to Codex, which works through a shell, would just read
 * as a false restriction and invite it to work around one.
 */
function toolsParagraph(agent: AgentId): string {
	if (agent === "codex") {
		return [
			"You are running in a sandbox whose writable root is this folder, with no",
			"network access. Shell commands are available and confined to it. You do",
			"not need the network: when a frame should show a photograph, name what",
			"you want with `assetQuery` as the frame contract describes, and Guide",
			"Studio finds it, downloads it, and credits the photographer for you",
			"after this run finishes.",
		].join("\n");
	}
	return [
		"You have Read, Write, Edit, Glob, and Grep inside this folder. There is no",
		"shell and no network access. You do not need either: when a frame should",
		"show a photograph, name what you want with `assetQuery` as the frame",
		"contract describes, and Guide Studio finds it, downloads it, and credits",
		"the photographer for you after this run finishes.",
	].join("\n");
}

/**
 * The single document the agent is pointed at. It leads with the deliverable,
 * because a model that reads only the first paragraph should still write the
 * right file to the right path.
 */
export function buildBrief(input: BriefInput): string {
	const skills = input.skills ?? VIDEO_SKILLS;
	const agent = input.agent ?? "claude";
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
		toolsParagraph(agent),
		"",
	].join("\n");
}

/**
 * `AGENTS.md` is picked up automatically by Codex from its working directory,
 * so the brief is reached even if the prompt is truncated or ignored. It stays
 * a pointer rather than a copy: one brief, no chance of the two drifting.
 */
export function buildAgentsDoc(agent: AgentId): string {
	return [
		"# Guide Studio session",
		"",
		`Read \`BRIEF.md\` in this directory first. It is the whole task: it names the`,
		"deliverable, the request, the frame contract you must obey, and the craft",
		"skills to follow.",
		"",
		"Write exactly one file — `output/storyboard.json` — containing one JSON",
		"object and nothing else. Do not create extra files, and do not reply with",
		"the JSON.",
		"",
		`(This session is being run by Guide Studio through ${agentLabel(agent)}.)`,
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
	fs.writeFileSync(paths.agentsDocPath, buildAgentsDoc(options.agent ?? "claude"), "utf8");
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
