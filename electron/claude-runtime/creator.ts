// ── AI Video Creator orchestration ───────────────────────────────────────
//
// Guide Studio's side of the loop. It owns everything except the thinking:
//
//   plan()    build the workspace, brief the agent, validate what it wrote
//   preview() render stills so the user can judge the plan cheaply
//   render()  render the approved storyboard to an MP4
//
// The stages are separate because they cost different things. Planning spends
// the user's agent quota; rendering spends minutes of CPU. Neither should be
// triggered by the other without the user seeing what happened in between.
//
// Which agent does the thinking — Claude Code or Codex — is chosen per
// session and changes nothing after `plan()` returns: both write the same
// validated storyboard, and preview and render never learn which one ran.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { HyperFrameFormat } from "../../src/lib/remotion/HyperFrameComposition";
import {
	renderHyperFrameDemo,
	renderHyperFrameStills,
	renderMotionDemo,
	renderMotionStills,
} from "../export/remotionExport";
import { AGENTS, type AgentId } from "./agents";
import { type ResolvedAsset, resolveAssetQueries } from "./assets";
import { runCodex } from "./codexSession";
import { detectAgent, notInstalledMessage } from "./detect";
import type { ClaudeActivity } from "./events";
import {
	type MotionProject,
	motionDurationSeconds,
	motionSystemPrompt,
	normalizeMotionProject,
} from "./motionProject";
import { readStoryboardFile, runClaude } from "./session";
import {
	type HyperFrameStoryboard,
	normalizeStoryboard,
	parseStoryboardResponse,
	storyboardDurationSeconds,
	storyboardSystemPrompt,
} from "./storyboard";
import { buildPrompt, createWorkspace, removeWorkspace, type WorkspacePaths } from "./workspace";

/** How many frames get a preview still. Enough to judge, cheap enough to wait for. */
const MAX_PREVIEW_STILLS = 6;

export type CreatorStatus = "planning" | "planned" | "rendering" | "rendered" | "failed";

/**
 * Which visual library the agent plans against.
 *
 *   motion     — animated backdrops and kinetic typography (`MotionGraphics`)
 *   cards      — clean HyperFrame layout cards
 *   whiteboard — every frame hand-written on a board by an animated hand
 */
export type CreatorLook = "motion" | "cards" | "whiteboard";

/**
 * A whiteboard video is whiteboard frames and nothing else. Letting a title or
 * outro card through would drop the studio's dark layout into the middle of a
 * white board, which reads as a rendering fault rather than as variety.
 */
const WHITEBOARD_KINDS = ["whiteboard"] as const;

/** Extra direction for the scribe look, on top of the shared contract. */
const WHITEBOARD_DIRECTION = [
	"Every frame in this video is a whiteboard frame, including the opening and closing ones: there are no title or outro cards.",
	"Open with a frame that states the subject and close with one that states the takeaway, both written on the board.",
	"The hand writes at a steady pace, so copy has to be short. Prefer a headline plus two or three bullets over a long headline.",
].join(" ");

export interface CreatorSession {
	id: string;
	/** Which CLI planned this session. */
	agent: AgentId;
	request: string;
	format: HyperFrameFormat;
	targetSeconds: number;
	model: string;
	look: CreatorLook;
	status: CreatorStatus;
	createdAt: number;
	/** Set when look is "cards" or "whiteboard". */
	storyboard?: HyperFrameStoryboard;
	/** Set when look is "motion". */
	motion?: MotionProject;
	/** Stock images fetched for the frames that asked for one. */
	assets?: ResolvedAsset[];
	/** What the validator had to correct in the agent's storyboard. */
	warnings?: string[];
	durationSeconds?: number;
	previewPaths?: Array<{ frameIndex: number; path: string }>;
	videoPath?: string;
	costUsd?: number;
	error?: string;
}

export interface PlanInput {
	request: string;
	agent?: AgentId;
	format?: HyperFrameFormat;
	targetSeconds?: number;
	model?: string;
	look?: CreatorLook;
}

const sessions = new Map<string, CreatorSession>();
const workspaces = new Map<string, WorkspacePaths>();
const running = new Map<string, AbortController>();

export function getSession(id: string): CreatorSession | undefined {
	return sessions.get(id);
}

export function listSessions(): CreatorSession[] {
	return [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function cancelSession(id: string): boolean {
	const controller = running.get(id);
	if (!controller) return false;
	controller.abort();
	return true;
}

/** Drop a session and its workspace once the user is done with it. */
export function discardSession(id: string): void {
	cancelSession(id);
	const workspace = workspaces.get(id);
	if (workspace) removeWorkspace(workspace.root);
	workspaces.delete(id);
	sessions.delete(id);
}

/**
 * Stage 1 — brief the chosen agent and validate what comes back.
 *
 * The storyboard is normalized before it is stored, so every later stage works
 * on frames that are known to render: out-of-range values are clamped, unknown
 * frame kinds degrade to their text equivalent, and anything referencing media
 * this session does not have becomes text rather than a broken frame. That
 * normalization is also what lets a second agent be added without trusting it
 * any further than the first: whatever it writes goes through the same gate.
 */
export async function planStoryboard(
	baseDir: string,
	input: PlanInput,
	onActivity?: (activity: ClaudeActivity) => void,
): Promise<CreatorSession> {
	const agent: AgentId = input.agent ?? "claude";
	const installation = await detectAgent(agent);
	if (!installation.installed || !installation.binaryPath) {
		throw new Error(installation.error ?? notInstalledMessage(agent));
	}
	if (installation.error) {
		throw new Error(installation.error);
	}

	const id = randomUUID();
	const format = input.format ?? "landscape";
	const targetSeconds = input.targetSeconds ?? 45;
	// An empty model is meaningful for Codex — it means "whatever the CLI
	// defaults to" — so only an absent one falls back to the agent's default.
	const model = input.model ?? AGENTS[agent].defaultModel;
	const look: CreatorLook = input.look ?? "motion";

	const session: CreatorSession = {
		id,
		agent,
		request: input.request,
		format,
		targetSeconds,
		model,
		look,
		status: "planning",
		createdAt: Date.now(),
	};
	sessions.set(id, session);

	// The contract is generated from the same constants the validator enforces,
	// so what the agent is told and what is accepted can never drift apart.
	const whiteboard = look === "whiteboard";
	const contract =
		look === "motion"
			? motionSystemPrompt({ format, targetSeconds })
			: storyboardSystemPrompt({
					hasRecording: false,
					assets: [],
					// A scribe video draws its own illustration, so it never goes
					// looking for a photograph.
					canFetchImages: !whiteboard,
					format,
					targetSeconds,
					...(whiteboard
						? {
								allowedKinds: [...WHITEBOARD_KINDS],
								skillDirection: WHITEBOARD_DIRECTION,
							}
						: {}),
				});

	const workspace = createWorkspace({
		baseDir,
		sessionId: id,
		agent,
		request: input.request,
		contract,
		format,
		targetSeconds,
	});
	workspaces.set(id, workspace);

	const controller = new AbortController();
	running.set(id, controller);

	try {
		const runOptions = {
			binaryPath: installation.binaryPath,
			workspace,
			prompt: buildPrompt(),
			model,
			signal: controller.signal,
			...(onActivity ? { onActivity } : {}),
		};
		const run = agent === "codex" ? await runCodex(runOptions) : await runClaude(runOptions);

		// Codex reports tokens, not dollars, so this stays undefined there.
		session.costUsd = run.costUsd;

		const file = readStoryboardFile(workspace, agent);
		if (file.error) {
			// A failed run explains itself better than the missing file does.
			session.status = "failed";
			session.error = run.ok ? file.error : (run.error ?? file.error);
			return session;
		}

		const parsed = parseStoryboardResponse(String(file.raw));
		const fallbackTitle = input.request.slice(0, 80);

		if (look === "motion") {
			const { project, warnings } = normalizeMotionProject(parsed, { fallbackTitle });
			session.motion = project;
			session.warnings = warnings;
			session.durationSeconds = motionDurationSeconds(project);
		} else {
			// The agent planned without a network, naming the pictures it wanted.
			// They are fetched here, before validation, so a query that found
			// nothing degrades through the same path an unsupplied image always
			// did — and the licence credit reaches the storyboard as a term the
			// validator applies rather than something the planner chose to honour.
			const resolved = whiteboard
				? { assets: [], warnings: [], attributionLine: undefined }
				: await resolveAssetQueries({
						parsed,
						destDir: workspace.assetsDir,
						signal: controller.signal,
						onNote: (text) => onActivity?.({ kind: "log", text }),
					});
			const { storyboard, warnings } = normalizeStoryboard(parsed, {
				hasRecording: false,
				fallbackTitle,
				availableAssetIds: resolved.assets.map((asset) => asset.id),
				...(whiteboard ? { allowedKinds: [...WHITEBOARD_KINDS] } : {}),
				...(resolved.attributionLine ? { attributionLine: resolved.attributionLine } : {}),
			});
			session.storyboard = storyboard;
			session.assets = resolved.assets;
			session.warnings = [...resolved.warnings, ...warnings];
			session.durationSeconds = storyboardDurationSeconds(storyboard);
		}
		session.status = "planned";
		return session;
	} catch (error) {
		session.status = "failed";
		session.error = error instanceof Error ? error.message : String(error);
		return session;
	} finally {
		running.delete(id);
	}
}

/** The fetched images as the renderer wants them: an id and a local file. */
function imageAssetsFor(session: CreatorSession) {
	return (session.assets ?? []).map((asset) => ({ assetId: asset.id, src: asset.path }));
}

/** Stage 2 — render stills of the planned frames for the preview grid. */
export async function previewStoryboard(id: string): Promise<CreatorSession> {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session || !workspace) throw new Error("That session is no longer available.");

	const sample = (length: number) => {
		const step = Math.max(1, Math.ceil(length / MAX_PREVIEW_STILLS));
		return Array.from({ length }, (_, index) => index).filter((index) => index % step === 0);
	};

	if (session.motion) {
		session.previewPaths = await renderMotionStills({
			title: session.motion.title,
			accent: session.motion.accent,
			scenes: session.motion.scenes,
			sceneIndexes: sample(session.motion.scenes.length),
			outputDirectory: workspace.previewDir,
			format: session.format,
		});
		return session;
	}

	if (!session.storyboard) throw new Error("This session has nothing to preview.");
	session.previewPaths = await renderHyperFrameStills({
		title: session.storyboard.title,
		accent: session.storyboard.accent,
		frames: session.storyboard.frames,
		frameIndexes: sample(session.storyboard.frames.length),
		outputDirectory: workspace.previewDir,
		format: session.format,
		imageAssets: imageAssetsFor(session),
	});
	return session;
}

/** Stage 3 — render the approved storyboard to an MP4 in the session folder. */
export async function renderStoryboard(
	id: string,
	onProgress?: (percent: number) => void,
): Promise<CreatorSession> {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session || !workspace) throw new Error("That session is no longer available.");
	const plan = session.motion ?? session.storyboard;
	if (!plan) throw new Error("This session has nothing to render.");

	const controller = new AbortController();
	running.set(id, controller);
	session.status = "rendering";

	const safeName =
		plan.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 60) || "guide-video";
	const outputPath = path.join(workspace.renderDir, `${safeName}.mp4`);

	try {
		fs.mkdirSync(workspace.renderDir, { recursive: true });
		if (session.motion) {
			await renderMotionDemo({
				title: session.motion.title,
				accent: session.motion.accent,
				scenes: session.motion.scenes,
				outputPath,
				format: session.format,
				signal: controller.signal,
				...(onProgress ? { onProgress } : {}),
			});
		} else if (session.storyboard) {
			await renderHyperFrameDemo({
				title: session.storyboard.title,
				accent: session.storyboard.accent,
				frames: session.storyboard.frames,
				imageAssets: imageAssetsFor(session),
				outputPath,
				format: session.format,
				signal: controller.signal,
				...(onProgress ? { onProgress } : {}),
			});
		}
		session.videoPath = outputPath;
		session.status = "rendered";
		return session;
	} catch (error) {
		session.status = "failed";
		session.error = error instanceof Error ? error.message : String(error);
		return session;
	} finally {
		running.delete(id);
	}
}
