// ── The Animated-look brief ──────────────────────────────────────────────
//
// The craft lives in HyperFrames' own skills (vendored into the session's
// .claude/skills); this brief only says what is different about running
// inside Guide Studio. Those skills are written for a person at a terminal
// with a network and a HeyGen account. Here there is no person to ask, no
// network, no account and no registry, and Guide Studio — not the agent —
// renders. Every one of those differences is stated, because a skill that
// says "ask the person" or "npx hyperframes add" would otherwise stall or
// fail the run.

import path from "node:path";
import type { AgentId } from "../claude-runtime/agents";
import { CUSTOM_SFX_DIR, MUSIC_BED_FILE } from "./audio";
import { AGENT_SUBCOMMANDS } from "./cli";
import { type AnimatedFormat, canvasSize, type SfxLibraryEntry } from "./project";

export interface AnimatedAssetBrief {
	id: string;
	kind: "image" | "video";
	label: string;
	/** Project-relative path of the staged file. */
	file: string;
	role?: string;
	shows?: string;
	visualSummary?: string;
	ocrText?: string[];
	transcriptExcerpt?: string;
	shotSegments?: Array<{ startSeconds: number; endSeconds: number }>;
	contactSheetFile?: string;
	contactSheetTimesSeconds?: number[];
	hasAudio?: boolean;
	isLogo?: boolean;
}

export interface AnimatedBriefInput {
	agent: AgentId;
	request: string;
	format: AnimatedFormat;
	targetSeconds: number;
	/** The user's creative-direction pick, as one line of direction. */
	direction?: string;
	assets: AnimatedAssetBrief[];
	sfxLibrary: SfxLibraryEntry[];
	/** ElevenLabs key present: custom SFX and a music bed can be requested. */
	canGenerateAudio: boolean;
	workspaceRoot: string;
}

function assetLine(asset: AnimatedAssetBrief): string {
	const parts = [
		`- \`${asset.file}\` — ${asset.kind}${asset.isLogo ? " (the brand logo)" : ""}: ${asset.label}`,
	];
	if (asset.role) parts.push(`role ${asset.role}`);
	if (asset.shows) parts.push(asset.shows);
	if (asset.visualSummary) parts.push(`shows: ${asset.visualSummary}`);
	if (asset.ocrText?.length) parts.push(`on-screen text: ${asset.ocrText.slice(0, 8).join(" / ")}`);
	if (asset.transcriptExcerpt) parts.push(`speech: "${asset.transcriptExcerpt}"`);
	if (asset.shotSegments?.length) {
		parts.push(
			`shots: ${asset.shotSegments
				.slice(0, 24)
				.map((segment) => `${segment.startSeconds.toFixed(1)}–${segment.endSeconds.toFixed(1)}s`)
				.join(", ")}`,
		);
	}
	if (asset.contactSheetFile) {
		parts.push(
			`overview sheet \`${asset.contactSheetFile}\`${asset.contactSheetTimesSeconds?.length ? ` (frames at ${asset.contactSheetTimesSeconds.map((time) => `${time.toFixed(1)}s`).join(", ")})` : ""}`,
		);
	}
	return parts.join("; ");
}

function toolsParagraph(agent: AgentId): string {
	const commands = AGENT_SUBCOMMANDS.join(", ");
	if (agent === "codex") {
		return [
			"You are in a sandbox whose writable root is this folder, with no network.",
			`Run the HyperFrames CLI only as \`./hf <command>\` (on Windows \`.\\hf.cmd <command>\`); it allows: ${commands}.`,
			"There is no `npx`, no package install and no registry. If `./hf check` cannot start a browser",
			"inside the sandbox, keep working from `./hf lint --json` — Guide Studio runs the full check",
			"after you finish and sends you anything that fails.",
		].join("\n");
	}
	return [
		"You have Read, Write, Edit, Glob and Grep inside this folder, and one shell command:",
		`\`./hf <command>\`, the pinned HyperFrames CLI, allowing: ${commands}.`,
		"There is no other shell, no `npx`, no network and no registry. Everything you need is here.",
	].join("\n");
}

export function buildAnimatedBrief(input: AnimatedBriefInput): string {
	const { width, height } = canvasSize(input.format);
	const skills = path.join(input.workspaceRoot, ".claude", "skills");
	const assets = input.assets.length
		? input.assets.map(assetLine)
		: [
				"- None. Draw everything (type, shapes, SVG, canvas); do not invent product screens or logos.",
			];
	const library = input.sfxLibrary.map(
		(entry) =>
			`- \`assets/sfx/${entry.file}\` (${entry.durationSeconds.toFixed(2)}s) — ${entry.description}`,
	);

	const sound = [
		"Follow the skill's `references/sound.md`: a film over ~15 s gets sound on its visible actions,",
		"few and exact, peak one frame after the picture, two or three takes of a repeated sound.",
		'Every `<audio>` has an `id`, `class="clip"`, `data-start`, a `data-duration` no longer than',
		"the file (durations are listed below), and `data-volume`.",
		"",
		"Bundled effects (licence-cleared, already in this folder):",
		...library,
	];
	if (input.canGenerateAudio) {
		sound.push(
			"",
			"Generated audio is available through Guide Studio after you finish:",
			`- A custom effect the library lacks: point the \`<audio>\` at \`${CUSTOM_SFX_DIR}/<slug>.mp3\` and list it in`,
			'  `output/sfx-requests.json` as `[{"file":"…","prompt":"…","durationSeconds":1.2,"fallback":"<library id>"}]`',
			"  (at most 8). The fallback library sound is used if generation fails, so time it to suit both.",
			`- A music bed: point one \`<audio id="music-bed">\` at \`${MUSIC_BED_FILE}\` and write`,
			'  `output/music-request.json` as `{"prompt":"<feel, instrumentation, tempo>","durationSeconds":<film length>}`.',
			"  Describe the feel and tempo, not the subject. Use `data-fade-in`/`data-fade-out`, and duck it",
			"  with `data-automation` volume points wherever footage speech plays (see media-use `references/mixing.md`).",
			"  Without footage speech, keep the bed near volume 0.5; under speech, near 0.14.",
		);
	} else {
		sound.push(
			"",
			"No music source is available in this session: deliver without a music bed (the user can add",
			"one afterwards) and make the effects and the picture carry the rhythm. Do not synthesise",
			"audio in code.",
		);
	}

	return [
		"# Guide Studio — Animated video brief",
		"",
		"## Your deliverable",
		"",
		`This folder (\`${input.workspaceRoot}\`) is a HyperFrames project. Build the video as`,
		"`index.html` plus one scene file per scene in `compositions/`. Guide Studio checks it,",
		"shows the user each scene, lets them edit the copy and colours, and renders it.",
		"You do not render.",
		"",
		"## The request",
		"",
		input.request.trim(),
		...(input.direction ? ["", `Creative direction: ${input.direction}`] : []),
		"",
		"## Output shape",
		"",
		`Canvas ${width}×${height} at 30 fps (${input.format}). Target length: about ${input.targetSeconds} seconds —`,
		"set the root `data-duration` to the film's real length.",
		"",
		"## Read the HyperFrames skills first",
		"",
		`Start with \`${path.join(skills, "hyperframes", "SKILL.md")}\` — it is the render contract and`,
		"the work loop. Then the type file that matches the request under its `references/types/`,",
		"`references/story.md`, `references/motion.md`, `references/format.md` and `references/sound.md`.",
		`For audio mixing, \`${path.join(skills, "media-use", "references", "mixing.md")}\`.`,
		`CLI reference: \`${path.join(skills, "hyperframes-cli", "SKILL.md")}\`.`,
		"",
		"## Where Guide Studio differs from the skills",
		"",
		"The skills assume a person at a terminal with a network and a HeyGen account. Here:",
		"",
		"- **No questions, no stops.** Nobody can answer. Weigh the storylines yourself, pick the strongest,",
		"  and write it down in `SPEC.md` (the skill's spec, kept short) before building.",
		"- **No network.** No CDN, no `npx`, no registry (`add`/`catalog`), no `capture`, no HeyGen,",
		"  no Gemini, no auth or usage checks. Build effects by hand with GSAP, CSS, SVG and canvas.",
		'- **GSAP is local.** Load it once in `index.html` as `<script src="assets/vendor/gsap.min.js"></script>`;',
		"  scene files use the global `gsap`. No other script libraries.",
		"- **You do not render, preview, publish or open anything,** and you never mention the",
		"  HyperFrames desktop app, Framey or Studio. Guide Studio is the editor here.",
		"- **Safety gate (enforced before anything plays):** every `src`, `href` and `url()` is a",
		"  project-relative path to a file that exists (`assets/...`); scripts contain no URLs and no",
		"  `fetch`, `XMLHttpRequest`, `WebSocket`, `import()`, workers, `eval`, `window.open` or",
		"  navigation; no `<iframe>`, `<object>`, `<embed>`, `<form>` or `on*=` attributes.",
		"- **Fonts:** only the bundled families listed in `references/format.md`.",
		"",
		"## Keep it editable — Guide Studio's editor depends on this",
		"",
		"- One scene per file in `compositions/`. The host element in `index.html`, the scene's root",
		"  `data-composition-id` and its `window.__timelines` key share one short readable id (`hook`,",
		"  `proof`, `payoff`). The root holds only scene hosts, full-bleed backgrounds, media and audio.",
		"- Every piece of on-screen copy is a `string` variable declared on that scene's root element in",
		"  `data-composition-variables` (with a human `label` and a `maxLength`), bound with",
		"  `data-var-text`, and written as the element's fallback text too.",
		"- Brand colours are `color` variables on `index.html`'s `<html>` element, used through",
		"  `var(--<id>)` with a literal fallback.",
		"- Layouts must survive copy of up to the `maxLength` you declare.",
		"",
		"## The user's media",
		"",
		...assets,
		"",
		"Open the image files and overview sheets with Read before planning — they are the product.",
		"Show real footage for proof; trim with `data-media-start` and land cuts on the listed shot",
		'boundaries. A clip whose speech carries the story keeps its sound (`data-has-audio="true"`);',
		"anything else is `muted`. Use the logo file itself for the brand mark — never retype a logo.",
		"",
		"## Sound",
		"",
		...sound,
		"",
		"## How to work",
		"",
		"1. Read the skills above and look at the user's media.",
		"2. Write `SPEC.md`: the storyline you chose, the scenes with timings, the motion language, the",
		"   sound plan.",
		"3. Build `index.html` and `compositions/*.html`.",
		"4. `./hf check --json` — fix every error, weigh every warning, repeat until it is clean.",
		"5. `./hf snapshot --review --json`, then Read the contact sheet it writes and fix what looks",
		"   wrong (overlaps, empty frames, unreadable text, motion that never lands).",
		"6. Write a short `REVIEW.md` saying what you checked and what you changed.",
		"7. Reply with one sentence naming the scenes and the total length.",
		"",
		toolsParagraph(input.agent),
		"",
	].join("\n");
}

export function buildAnimatedAgentsDoc(workspaceRoot: string): string {
	return [
		"# Guide Studio session",
		"",
		`Read \`${path.join(workspaceRoot, "BRIEF.md")}\` first. It is the whole task: the request, the`,
		"HyperFrames skills to follow, and the rules this environment adds to them.",
		"",
		"Build the video in this folder as `index.html` plus `compositions/*.html`. Do not render it.",
		"",
	].join("\n");
}

export function buildAnimatedPrompt(workspaceRoot: string): string {
	return [
		`Read \`${path.join(workspaceRoot, "BRIEF.md")}\` and build the HyperFrames video it asks for in that folder.`,
		"Follow the HyperFrames skills it points to and its rules for this environment, run `./hf check --json`",
		"until it is clean, review the snapshot, then reply with one sentence naming the scenes and the total length.",
	].join(" ");
}

export function buildRepairPrompt(workspaceRoot: string, problems: string[]): string {
	return [
		`You built the HyperFrames video in \`${workspaceRoot}\` (brief: \`${path.join(workspaceRoot, "BRIEF.md")}\`).`,
		"Guide Studio's gate rejected it:",
		...problems.slice(0, 30).map((problem) => `- ${problem}`),
		"Fix exactly these, keeping every scene id and variable id as they are, run `./hf check --json` until it",
		"is clean, then reply with one sentence saying what you changed.",
	].join("\n");
}

export function buildRevisionPrompt(input: {
	workspaceRoot: string;
	sceneId?: string;
	sceneFile?: string;
	instruction: string;
}): string {
	const scope =
		input.sceneId && input.sceneFile
			? `Change only the scene \`${input.sceneId}\` (\`${input.sceneFile}\`). Touch \`index.html\` only if its timing or audio must move, and then shift later scenes so nothing overlaps.`
			: "Change whatever the instruction needs, scene by scene.";
	return [
		`Read \`${path.join(input.workspaceRoot, "BRIEF.md")}\` — you built this HyperFrames video earlier, and the files in`,
		`\`${input.workspaceRoot}\` are its current state, including any edits the user made since.`,
		"",
		`The user asks: ${input.instruction.trim()}`,
		"",
		scope,
		"Keep the existing scene ids and variable ids, keep copy in variables, follow the brief's rules, run",
		"`./hf check --json` until it is clean and snapshot what you changed. Reply with one sentence saying what changed.",
	].join("\n");
}
