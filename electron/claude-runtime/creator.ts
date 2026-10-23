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
import { resolveCreatorRequest } from "../../src/lib/ai/creatorRequest";
import type { MediaContextAsset } from "../../src/lib/ai/mediaContext";
import type { HyperFrameFormat } from "../../src/lib/remotion/HyperFrameComposition";
import type {
	MotionBrandPalette,
	MotionScene,
} from "../../src/lib/remotion/MotionGraphicsComposition";
import type { RenderCaptionLine } from "../../src/lib/remotion/RenderCaptionOverlay";
import { defaultBrandPalette, extractBrandPaletteFromFile } from "../ai/brandPalette";
import {
	analyzeMediaContextAssets,
	getMediaContextContactSheet,
	getRegisteredMediaContextAsset,
	stageMediaContextAssets,
} from "../ai/mediaContextService";
import {
	createProResMaster,
	renderHyperFrameDemo,
	renderHyperFrameStills,
	renderMotionDemo,
	renderMotionStills,
} from "../export/remotionExport";
import { validateRenderedVideo } from "../export/renderValidation";
import {
	type MusicMuxBed,
	muxNarrationAudio,
	type NarrationMuxSegment,
	type SfxMuxCue,
} from "../ffmpeg";
import {
	type AnimatedAssetBrief,
	buildAnimatedAgentsDoc,
	buildAnimatedBrief,
	buildAnimatedPrompt,
	buildRepairPrompt,
	buildRevisionPrompt,
} from "../hyperframes/brief";
import { ensureHyperframesBrowser } from "../hyperframes/cli";
import {
	canGenerateAudio,
	renderAnimatedProject,
	runGate,
	snapshotScenes,
	summarizeAnimatedProject,
} from "../hyperframes/pipeline";
import { readSfxLibrary, scaffoldAnimatedProject } from "../hyperframes/project";
import {
	type AnimatedProjectSummary,
	applyVariableValues,
	coerceVariableValue,
} from "../hyperframes/scenes";
import { AGENTS, type AgentId, agentLabel } from "./agents";
import { type ResolvedAsset, resolveAssetQueries, resolveGeneratedAssetQueries } from "./assets";
import { runCodex } from "./codexSession";
import { type CreativeSkillId, getCreativeSkill } from "./creativeSkills";
import { writeCreatorInterchange } from "./creatorInterchange";
import { detectAgent, notInstalledMessage } from "./detect";
import type { ClaudeActivity } from "./events";
import {
	type MotionAssetSummary,
	type MotionProject,
	motionDurationSeconds,
	motionSystemPrompt,
	normalizeMotionProject,
} from "./motionProject";
import { readStoryboardFile, runClaude } from "./session";
import {
	applyShotDurationOverrides,
	applyShotReviewUpdates,
	areAllShotsApproved,
	createPendingShotReviews,
	evaluateShotCraft,
	type ReviewableShot,
	type ShotReview,
	type ShotReviewDurationLimits,
} from "./shotReview";
import {
	type HyperFrameStoryboard,
	normalizeStoryboard,
	parseStoryboardResponse,
	storyboardDurationSeconds,
	storyboardSystemPrompt,
} from "./storyboard";
import {
	buildBrief,
	buildPrompt,
	createWorkspace,
	removeWorkspace,
	type WorkspacePaths,
	workspacePaths,
} from "./workspace";

/** Every renderable shot gets a still: approval without seeing the shot is not approval. */
const MAX_PREVIEW_STILLS = 14;

async function deriveBrandPalette(
	stagedReferences: MediaContextAsset[],
	resolvedAssets: ResolvedAsset[],
): Promise<MotionBrandPalette> {
	const sources = [
		...stagedReferences
			.filter((asset) => asset.kind === "image" && asset.role === "brand")
			.map((asset) => ({ path: asset.previewPath, kind: asset.kind })),
		// Source footage is the visual truth for a product story. It must outrank
		// a fetched stock/generated image when choosing the art direction.
		...stagedReferences
			.filter((asset) => asset.kind === "video")
			.map((asset) => ({ path: asset.previewPath, kind: asset.kind })),
		...stagedReferences
			.filter((asset) => asset.kind === "image" && asset.role !== "brand")
			.map((asset) => ({ path: asset.previewPath, kind: asset.kind })),
		...resolvedAssets.map((asset) => ({ path: asset.path, kind: "image" as const })),
	].filter((source): source is { path: string; kind: "image" | "video" } => Boolean(source.path));

	const seen = new Set<string>();
	for (const source of sources) {
		if (seen.has(source.path)) continue;
		seen.add(source.path);
		const palette = await extractBrandPaletteFromFile(source.path, source.kind);
		if (palette) return palette;
	}
	return defaultBrandPalette();
}

async function ensureMotionBrandPalette(session: CreatorSession): Promise<MotionBrandPalette> {
	if (!session.motion) return defaultBrandPalette();
	if (session.motion.brandPalette) return session.motion.brandPalette;
	const brandPalette = await deriveBrandPalette(
		session.referenceAssets ?? [],
		session.assets ?? [],
	);
	session.motion.brandPalette = brandPalette;
	persistSessions();
	return brandPalette;
}

export type CreatorStatus = "planning" | "planned" | "rendering" | "rendered" | "failed";

/**
 * Which visual library the agent plans against.
 *
 *   animated   — the agent writes a HyperFrames project (HTML + GSAP), which
 *                Guide Studio gates, snapshots and renders (`../hyperframes`)
 *   motion     — animated backdrops and kinetic typography (`MotionGraphics`)
 *   cards      — clean HyperFrame layout cards
 *   whiteboard — every frame hand-written on a board by an animated hand
 */
export type CreatorLook = "animated" | "motion" | "cards" | "whiteboard";

/** What Guide Studio knows about an agent-built HyperFrames project. */
export interface AnimatedSessionState {
	summary: AnimatedProjectSummary;
	/** Non-blocking findings from the last gate run. */
	warnings: string[];
	/** Audio Guide Studio filled in for the agent. */
	notes: string[];
	/** The user's chat edits, newest last. */
	revisions: Array<{ instruction: string; sceneId?: string; at: number }>;
}
export type CreatorVisualSource = "stock" | "generated";

function requestCallsForLogo(request: string): boolean {
	return /\b(?:logo|wordmark|brand\s+mark|brand\s+identity)\b/i.test(request);
}

/**
 * Pick a logo candidate only from user-supplied image references. The model
 * may choose among these ids, but it can never cause a new filesystem path to
 * be treated as a brand asset.
 */
function inferLogoReference(
	assets: MediaContextAsset[],
	request: string,
): MediaContextAsset | undefined {
	const images = assets.filter((asset) => asset.kind === "image");
	if (!images.length || !requestCallsForLogo(request)) return undefined;
	return (
		images.find((asset) => asset.role === "brand") ??
		images.find((asset) => /\b(?:logo|wordmark|brand[- ]?mark)\b/i.test(asset.label)) ??
		(images.length === 1 ? images[0] : undefined)
	);
}

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
	/** Creative story profile shared by all motion skills. */
	creativeSkill?: CreativeSkillId;
	visualSource: CreatorVisualSource;
	status: CreatorStatus;
	createdAt: number;
	/** Set when look is "cards" or "whiteboard". */
	storyboard?: HyperFrameStoryboard;
	/** Set when look is "motion". */
	motion?: MotionProject;
	/** Set when look is "animated"; the project itself lives in the workspace. */
	animated?: AnimatedSessionState;
	/** Stock images fetched for the frames that asked for one. */
	assets?: ResolvedAsset[];
	/** User-supplied references staged into this session workspace. */
	referenceAssets?: MediaContextAsset[];
	/** What the validator had to correct in the agent's storyboard. */
	warnings?: string[];
	durationSeconds?: number;
	previewPaths?: Array<{ frameIndex: number; path: string }>;
	/** Explicit human decision for every renderable shot. */
	shotReviews?: ShotReview[];
	/** Advisory pacing and storytelling checks; never a substitute for human review. */
	craftWarnings?: string[];
	videoPath?: string;
	masterPath?: string;
	/** Editable companion files for timeline/interchange handoff. */
	interchange?: { manifestPath: string; fcpxmlPath: string };
	costUsd?: number;
	error?: string;
	/** Optional, validated finishing data staged inside this session workspace. */
	finishing?: CreatorFinishing;
}

export interface CreatorFinishing {
	narration?: {
		segments: Array<{
			id?: string;
			text: string;
			startMs: number;
			endMs: number;
			audioPath: string;
		}>;
		voiceId?: string;
		language?: string;
		fullAudioPath?: string;
		captions?: RenderCaptionLine[];
	};
	musicPath?: string;
	musicVolume: number;
	muteOriginalAudio: boolean;
	sfx?: SfxMuxCue[];
}

export interface CreatorFinishingInput {
	narration?: {
		segments: Array<{
			id?: string;
			text: string;
			startMs: number;
			endMs: number;
			audioPath: string;
		}>;
		voiceId?: string;
		language?: string;
		fullAudioPath?: string;
		captions?: RenderCaptionLine[];
	};
	musicPath?: string;
	musicVolume?: number;
	muteOriginalAudio?: boolean;
	sfx?: Array<{ audioPath: string; offsetMs: number; volume?: number }>;
}

export interface PlanInput {
	request: string;
	agent?: AgentId;
	format?: HyperFrameFormat;
	targetSeconds?: number;
	model?: string;
	look?: CreatorLook;
	creativeSkill?: CreativeSkillId;
	visualSource?: CreatorVisualSource;
	/** Ids returned by the privileged media picker. */
	referenceAssetIds?: string[];
}

const sessions = new Map<string, CreatorSession>();
const workspaces = new Map<string, WorkspacePaths>();
const running = new Map<string, AbortController>();
let sessionStorePath: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathInside(root: string, candidate: unknown): string | undefined {
	if (typeof candidate !== "string" || !candidate) return undefined;
	const resolvedRoot = path.resolve(root);
	const resolvedCandidate = path.resolve(candidate);
	const relative = path.relative(resolvedRoot, resolvedCandidate);
	if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
	return fs.existsSync(resolvedCandidate) ? resolvedCandidate : undefined;
}

const FINISHING_AUDIO_EXTENSIONS = new Set([
	".aac",
	".flac",
	".m4a",
	".mp3",
	".ogg",
	".wav",
	".webm",
]);
const MAX_FINISHING_AUDIO_BYTES = 250 * 1024 * 1024;

function stageFinishingAudio(workspace: WorkspacePaths, source: unknown, label: string): string {
	const userDataRoot = path.dirname(path.dirname(workspace.root));
	const safeSource = pathInside(userDataRoot, source);
	if (!safeSource) throw new Error(`${label} is not a valid local user-data file.`);
	const extension = path.extname(safeSource).toLowerCase();
	if (!FINISHING_AUDIO_EXTENSIONS.has(extension)) {
		throw new Error(
			`${label} must be an audio file (${[...FINISHING_AUDIO_EXTENSIONS].join(", ")}).`,
		);
	}
	const stat = fs.statSync(safeSource);
	if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FINISHING_AUDIO_BYTES) {
		throw new Error(`${label} is empty or larger than 250 MB.`);
	}
	fs.mkdirSync(workspace.assetsDir, { recursive: true });
	const destination = path.join(workspace.assetsDir, `finishing-${randomUUID()}${extension}`);
	fs.copyFileSync(safeSource, destination);
	return destination;
}

function normalizeFinishing(
	workspace: WorkspacePaths,
	input: CreatorFinishingInput,
	maxDurationMs: number,
): CreatorFinishing {
	if (!isRecord(input)) throw new Error("Finishing options are invalid.");
	const rawNarration = isRecord(input.narration) ? input.narration : undefined;
	const rawSegments =
		rawNarration && Array.isArray(rawNarration.segments) ? rawNarration.segments : [];
	const segments = rawSegments.slice(0, 32).map((raw, index) => {
		if (!isRecord(raw)) throw new Error(`Narration segment ${index + 1} is invalid.`);
		const text = typeof raw.text === "string" ? raw.text.trim().slice(0, 3000) : "";
		const startMs = typeof raw.startMs === "number" ? Math.max(0, Math.round(raw.startMs)) : 0;
		const endMs =
			typeof raw.endMs === "number" ? Math.max(startMs + 1, Math.round(raw.endMs)) : startMs + 1;
		if (!text) throw new Error(`Narration segment ${index + 1} has no text.`);
		if (endMs > maxDurationMs + 1500)
			throw new Error(`Narration segment ${index + 1} exceeds the video duration.`);
		return {
			...(typeof raw.id === "string" ? { id: raw.id.slice(0, 120) } : {}),
			text,
			startMs,
			endMs,
			audioPath: stageFinishingAudio(workspace, raw.audioPath, `Narration segment ${index + 1}`),
		};
	});
	const fullAudioPath = rawNarration?.fullAudioPath
		? stageFinishingAudio(workspace, rawNarration.fullAudioPath, "Voiceover")
		: undefined;
	const captions =
		rawNarration && Array.isArray(rawNarration.captions)
			? rawNarration.captions.slice(0, 64).flatMap((raw) => {
					if (!isRecord(raw) || typeof raw.text !== "string") return [];
					const startMs =
						typeof raw.startMs === "number" ? Math.max(0, Math.round(raw.startMs)) : 0;
					const endMs =
						typeof raw.endMs === "number"
							? Math.max(startMs + 1, Math.round(raw.endMs))
							: startMs + 1;
					if (endMs > maxDurationMs + 1500) return [];
					return [{ text: raw.text.trim().slice(0, 3000), startMs, endMs }];
				})
			: [];

	const musicPath = input.musicPath
		? stageFinishingAudio(workspace, input.musicPath, "Background music")
		: undefined;
	const sfx = Array.isArray(input.sfx)
		? input.sfx.slice(0, 64).flatMap((raw, index) => {
				if (!isRecord(raw) || typeof raw.audioPath !== "string") return [];
				const offsetMs =
					typeof raw.offsetMs === "number" ? Math.max(0, Math.round(raw.offsetMs)) : 0;
				if (offsetMs > maxDurationMs + 1000) return [];
				return [
					{
						audioPath: stageFinishingAudio(workspace, raw.audioPath, `Sound effect ${index + 1}`),
						offsetMs,
						volume: typeof raw.volume === "number" ? Math.min(1, Math.max(0, raw.volume)) : 1,
					},
				];
			})
		: [];
	const musicVolume =
		typeof input.musicVolume === "number" ? Math.min(1, Math.max(0, input.musicVolume)) : 0.18;
	return {
		...(segments.length || fullAudioPath
			? {
					narration: {
						segments,
						...(fullAudioPath ? { fullAudioPath } : {}),
						...(captions.length ? { captions } : {}),
						...(typeof rawNarration?.voiceId === "string"
							? { voiceId: rawNarration.voiceId.slice(0, 120) }
							: {}),
						...(typeof rawNarration?.language === "string"
							? { language: rawNarration.language.slice(0, 20) }
							: {}),
					},
				}
			: {}),
		...(musicPath ? { musicPath } : {}),
		musicVolume,
		muteOriginalAudio: input.muteOriginalAudio !== false,
		...(sfx.length ? { sfx } : {}),
	};
}

function restoreFinishing(root: string, value: unknown): CreatorFinishing | undefined {
	if (!isRecord(value)) return undefined;
	const narrationValue = isRecord(value.narration) ? value.narration : undefined;
	const rawSegments =
		narrationValue && Array.isArray(narrationValue.segments) ? narrationValue.segments : [];
	const segments = rawSegments.flatMap((raw) => {
		if (!isRecord(raw)) return [];
		const audioPath = pathInside(root, raw.audioPath);
		if (!audioPath || typeof raw.text !== "string") return [];
		const startMs = typeof raw.startMs === "number" ? Math.max(0, Math.round(raw.startMs)) : 0;
		const endMs =
			typeof raw.endMs === "number" ? Math.max(startMs + 1, Math.round(raw.endMs)) : startMs + 1;
		return [
			{
				...(typeof raw.id === "string" ? { id: raw.id.slice(0, 120) } : {}),
				text: raw.text.slice(0, 3000),
				startMs,
				endMs,
				audioPath,
			},
		];
	});
	const fullAudioPath = pathInside(root, narrationValue?.fullAudioPath);
	const captions =
		narrationValue && Array.isArray(narrationValue.captions)
			? narrationValue.captions.flatMap((raw) => {
					if (!isRecord(raw) || typeof raw.text !== "string") return [];
					const startMs =
						typeof raw.startMs === "number" ? Math.max(0, Math.round(raw.startMs)) : 0;
					const endMs =
						typeof raw.endMs === "number"
							? Math.max(startMs + 1, Math.round(raw.endMs))
							: startMs + 1;
					return [{ text: raw.text.slice(0, 3000), startMs, endMs }];
				})
			: [];
	const musicPath = pathInside(root, value.musicPath);
	const sfx = Array.isArray(value.sfx)
		? value.sfx.flatMap((raw) => {
				if (!isRecord(raw)) return [];
				const audioPath = pathInside(root, raw.audioPath);
				if (!audioPath) return [];
				return [
					{
						audioPath,
						offsetMs: typeof raw.offsetMs === "number" ? Math.max(0, Math.round(raw.offsetMs)) : 0,
						volume: typeof raw.volume === "number" ? Math.min(1, Math.max(0, raw.volume)) : 1,
					},
				];
			})
		: [];
	return {
		...(segments.length || fullAudioPath
			? {
					narration: {
						segments,
						...(fullAudioPath ? { fullAudioPath } : {}),
						...(captions.length ? { captions } : {}),
						...(typeof narrationValue?.voiceId === "string"
							? { voiceId: narrationValue.voiceId.slice(0, 120) }
							: {}),
						...(typeof narrationValue?.language === "string"
							? { language: narrationValue.language.slice(0, 20) }
							: {}),
					},
				}
			: {}),
		...(musicPath ? { musicPath } : {}),
		musicVolume:
			typeof value.musicVolume === "number" ? Math.min(1, Math.max(0, value.musicVolume)) : 0.18,
		muteOriginalAudio: value.muteOriginalAudio !== false,
		...(sfx.length ? { sfx } : {}),
	};
}

function restoreSession(rootDir: string, value: unknown): CreatorSession | undefined {
	if (!isRecord(value) || typeof value.id !== "string") return undefined;
	if (!/^[a-zA-Z0-9-]{1,100}$/.test(value.id)) return undefined;
	const root = path.join(rootDir, value.id);
	if (
		!fs.existsSync(root) ||
		(!isRecord(value.storyboard) && !isRecord(value.motion) && !isRecord(value.animated))
	)
		return undefined;
	if (
		value.status !== "planning" &&
		value.status !== "planned" &&
		value.status !== "rendering" &&
		value.status !== "rendered" &&
		value.status !== "failed"
	)
		return undefined;

	const session = value as unknown as CreatorSession;
	if (session.status === "planning" || session.status === "rendering") {
		session.status = "failed";
		session.error = "The previous run was interrupted. Start a new render from this plan.";
	}
	if (session.previewPaths) {
		session.previewPaths = session.previewPaths.filter((still) => {
			if (!isRecord(still) || !Number.isInteger(still.frameIndex)) return false;
			const safePath = pathInside(root, still.path);
			if (!safePath) return false;
			still.path = safePath;
			return true;
		});
	}
	if (session.videoPath) session.videoPath = pathInside(root, session.videoPath);
	if (session.masterPath) session.masterPath = pathInside(root, session.masterPath);
	if (session.interchange) {
		const manifestPath = pathInside(root, session.interchange.manifestPath);
		const fcpxmlPath = pathInside(root, session.interchange.fcpxmlPath);
		session.interchange = manifestPath && fcpxmlPath ? { manifestPath, fcpxmlPath } : undefined;
	}
	if (session.assets) {
		session.assets = session.assets.filter((asset) => {
			if (!isRecord(asset)) return false;
			const safePath = pathInside(root, asset.path);
			if (!safePath) return false;
			asset.path = safePath;
			return true;
		});
	}
	if (session.referenceAssets) {
		session.referenceAssets = session.referenceAssets.map((asset) => ({
			...asset,
			...(asset.previewPath ? { previewPath: pathInside(root, asset.previewPath) } : {}),
		}));
	}
	if (session.finishing) session.finishing = restoreFinishing(root, session.finishing);
	if (session.status === "rendered" && !session.videoPath) {
		session.status = "planned";
		session.error = "The previous MP4 was not found. Review the plan and render it again.";
	}
	return session;
}

/** Render the optional edit-friendly ProRes master from the validated MP4. */
export async function createSessionMaster(id: string): Promise<CreatorSession> {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session?.videoPath || !workspace)
		throw new Error("Render the MP4 before creating a master.");
	const baseName = path.basename(session.videoPath, path.extname(session.videoPath));
	const masterPath = path.join(workspace.renderDir, `${baseName}.master.mov`);
	await createProResMaster(session.videoPath, masterPath);
	await validateRenderedVideo(masterPath, {
		width: session.format === "landscape" ? 1920 : 1080,
		height: session.format === "landscape" ? 1080 : session.format === "vertical" ? 1920 : 1080,
		fps: 30,
		durationSeconds: durationWithReviews(session),
		...(session.finishing?.narration?.segments.length ||
		session.finishing?.narration?.fullAudioPath ||
		session.finishing?.musicPath ||
		session.finishing?.sfx?.length
			? { requireAudio: true }
			: {}),
	});
	session.masterPath = masterPath;
	persistSessions();
	return session;
}

/** Export a JSON scene manifest plus conservative FCPXML interchange package. */
export function createSessionInterchange(id: string): CreatorSession {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session?.videoPath || !workspace) {
		throw new Error("Render the MP4 before exporting an interchange package.");
	}
	session.interchange = writeCreatorInterchange(workspace.renderDir, session);
	persistSessions();
	return session;
}

function persistSessions(): void {
	if (!sessionStorePath) return;
	const temporaryPath = `${sessionStorePath}.${process.pid}.tmp`;
	try {
		fs.mkdirSync(path.dirname(sessionStorePath), { recursive: true });
		fs.writeFileSync(
			temporaryPath,
			JSON.stringify({ version: 1, sessions: [...sessions.values()] }, null, 2),
			{ encoding: "utf8", mode: 0o600 },
		);
		fs.renameSync(temporaryPath, sessionStorePath);
		fs.chmodSync(sessionStorePath, 0o600);
	} catch (error) {
		try {
			fs.rmSync(temporaryPath, { force: true });
		} catch {
			// Preserve the original persistence error without masking the user action.
		}
		console.error("[Creator] Could not persist session state:", error);
	}
}

/** Rehydrate reviewable sessions after a renderer reload or app restart. */
export function initializeCreatorStore(baseDir: string): void {
	const storePath = path.join(path.resolve(baseDir), "sessions.json");
	if (sessionStorePath === storePath) return;
	sessionStorePath = storePath;
	sessions.clear();
	workspaces.clear();

	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(storePath, "utf8"));
		if (!isRecord(parsed) || !Array.isArray(parsed.sessions)) return;
		for (const value of parsed.sessions) {
			const session = restoreSession(path.resolve(baseDir), value);
			if (!session) continue;
			sessions.set(session.id, session);
			workspaces.set(session.id, workspacePaths(path.join(path.resolve(baseDir), session.id)));
		}
		persistSessions();
	} catch {
		// A missing or partially written store should not prevent a new session.
	}
}

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
	persistSessions();
}

/**
 * Remove only derived preview/render media while keeping the validated plan,
 * references, and shot decisions available for another review or render.
 */
export function clearSessionMedia(id: string): CreatorSession {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session || !workspace) throw new Error("That session is no longer available.");
	if (session.status === "planning" || session.status === "rendering") {
		throw new Error("Saved media cannot be cleared while this session is running.");
	}

	for (const directory of [workspace.previewDir, workspace.renderDir]) {
		fs.rmSync(directory, { recursive: true, force: true });
		fs.mkdirSync(directory, { recursive: true });
	}
	const previousReviews = session.shotReviews;
	const shotCount = reviewableShots(session).length;
	session.shotReviews = createPendingShotReviews(shotCount).map((review, index) => {
		const previousDuration = previousReviews?.[index]?.durationSeconds;
		return previousDuration === undefined
			? review
			: { ...review, durationSeconds: previousDuration };
	});
	session.previewPaths = undefined;
	session.videoPath = undefined;
	session.masterPath = undefined;
	session.interchange = undefined;
	if (session.status === "rendered") session.status = "planned";
	persistSessions();
	return session;
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
	const referenceAssets = (input.referenceAssetIds ?? [])
		.map((id) => getRegisteredMediaContextAsset(id))
		.filter((asset): asset is MediaContextAsset => Boolean(asset))
		.slice(0, 12);
	input = { ...input, request: resolveCreatorRequest(input.request, referenceAssets) };
	initializeCreatorStore(baseDir);
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
	const creativeSkill = getCreativeSkill(input.creativeSkill);
	const visualSource: CreatorVisualSource =
		input.visualSource === "generated" ? "generated" : "stock";
	const inferredLogoReference = inferLogoReference(referenceAssets, input.request);
	let hasReferenceVideo = referenceAssets.some((asset) => asset.kind === "video");
	let referenceSummaries: MotionAssetSummary[] = referenceAssets.map((asset) => ({
		id: asset.id,
		label: asset.label,
		kind: asset.kind,
		role: asset.role,
		...(asset.shotSegments?.length ? { shotSegments: asset.shotSegments } : {}),
	}));

	const session: CreatorSession = {
		id,
		agent,
		request: input.request,
		format,
		targetSeconds,
		model,
		look,
		creativeSkill: creativeSkill.id,
		visualSource,
		status: "planning",
		createdAt: Date.now(),
	};
	sessions.set(id, session);

	// The contract is generated from the same constants the validator enforces,
	// so what the agent is told and what is accepted can never drift apart.
	const whiteboard = look === "whiteboard";
	const animated = look === "animated";
	const contract = animated
		? ""
		: look === "motion"
			? motionSystemPrompt({
					creativeSkill: creativeSkill.id,
					format,
					targetSeconds,
					assets: referenceSummaries,
					contextQuery: input.request,
					...(inferredLogoReference ? { defaultLogoAssetId: inferredLogoReference.id } : {}),
				})
			: storyboardSystemPrompt({
					hasRecording: hasReferenceVideo,
					assets: referenceSummaries,
					contextQuery: input.request,
					imageSource: visualSource,
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
		// The Animated look brings HyperFrames' own skills instead of ours.
		...(animated ? { skills: [] } : {}),
	});
	workspaces.set(id, workspace);
	persistSessions();

	const controller = new AbortController();
	running.set(id, controller);
	const referenceWarnings: string[] = [];

	try {
		const stagedReferences = await stageMediaContextAssets(
			referenceAssets.map((asset) => asset.id),
			workspace.assetsDir,
			inferredLogoReference ? [inferredLogoReference.id] : [],
		);
		if (stagedReferences.length !== referenceAssets.length) {
			throw new Error(
				"One or more media references changed before staging. Please attach them again.",
			);
		}
		const analyzedReferenceAssets = await analyzeMediaContextAssets(stagedReferences);
		hasReferenceVideo = analyzedReferenceAssets.some((asset) => asset.kind === "video");
		session.referenceAssets = analyzedReferenceAssets;
		referenceSummaries = await Promise.all(
			analyzedReferenceAssets.map(async (asset) => {
				const fileName = asset.previewPath
					? `assets/${path.basename(asset.previewPath)}`
					: undefined;
				let contactSheetFileName: string | undefined;
				let contactSheetTimesSeconds: number[] | undefined;
				if (asset.kind === "video") {
					const contactSheet = await getMediaContextContactSheet(
						asset.id,
						6,
						asset.durationSeconds,
						asset.shotSegments,
					);
					if (contactSheet.success && contactSheet.dataUrl) {
						const encoded = contactSheet.dataUrl.split(",", 2)[1];
						if (encoded) {
							const contactSheetPath = path.join(
								workspace.assetsDir,
								`${asset.id}-contact-sheet.jpg`,
							);
							fs.writeFileSync(contactSheetPath, Buffer.from(encoded, "base64"));
							contactSheetFileName = `assets/${path.basename(contactSheetPath)}`;
							contactSheetTimesSeconds = contactSheet.frameTimesSeconds;
						}
					} else {
						referenceWarnings.push(
							`Could not prepare a visual overview for ${asset.label}; the planner will use its technical metadata and staged video only.`,
						);
					}
				}
				return {
					id: asset.id,
					label: asset.label,
					kind: asset.kind,
					role: asset.role,
					...(fileName ? { fileName } : {}),
					...(contactSheetFileName ? { contactSheetFileName } : {}),
					...(contactSheetTimesSeconds ? { contactSheetTimesSeconds } : {}),
					...(asset.shotSegments?.length ? { shotSegments: asset.shotSegments } : {}),
					...(asset.visualSummary ? { visualSummary: asset.visualSummary } : {}),
					...(asset.ocrText?.length ? { ocrText: asset.ocrText } : {}),
					...(asset.transcriptExcerpt ? { transcriptExcerpt: asset.transcriptExcerpt } : {}),
					...(asset.transcriptSegments?.length
						? { transcriptSegments: asset.transcriptSegments }
						: {}),
					shows: [
						asset.width && asset.height ? `${asset.width}×${asset.height}` : "",
						asset.durationSeconds !== undefined
							? `${asset.durationSeconds.toFixed(1)} seconds`
							: "",
						asset.frameRate !== undefined ? `${asset.frameRate.toFixed(2)} fps` : "",
						asset.codec ?? "",
						asset.hasAudio === undefined ? "" : asset.hasAudio ? "audio" : "silent",
					]
						.filter(Boolean)
						.join(", "),
				};
			}),
		);

		if (animated) {
			const assetBriefs: AnimatedAssetBrief[] = analyzedReferenceAssets.flatMap((asset) => {
				if (!asset.previewPath) return [];
				const summary = referenceSummaries.find((candidate) => candidate.id === asset.id);
				return [
					{
						id: asset.id,
						kind: asset.kind,
						label: asset.label,
						file: `assets/${path.basename(asset.previewPath)}`,
						role: asset.role,
						...(summary?.shows ? { shows: summary.shows } : {}),
						...(asset.visualSummary ? { visualSummary: asset.visualSummary } : {}),
						...(asset.ocrText?.length ? { ocrText: asset.ocrText } : {}),
						...(asset.transcriptExcerpt ? { transcriptExcerpt: asset.transcriptExcerpt } : {}),
						...(asset.shotSegments?.length ? { shotSegments: asset.shotSegments } : {}),
						...(summary?.contactSheetFileName
							? { contactSheetFile: summary.contactSheetFileName }
							: {}),
						...(summary?.contactSheetTimesSeconds
							? { contactSheetTimesSeconds: summary.contactSheetTimesSeconds }
							: {}),
						...(asset.hasAudio !== undefined ? { hasAudio: asset.hasAudio } : {}),
						...(asset.id === inferredLogoReference?.id ? { isLogo: true } : {}),
					},
				];
			});
			scaffoldAnimatedProject({
				root: workspace.root,
				sessionId: id,
				title: input.request,
				format,
				targetSeconds,
			});
			fs.writeFileSync(
				workspace.briefPath,
				buildAnimatedBrief({
					agent,
					request: input.request,
					format,
					targetSeconds,
					direction: `${creativeSkill.name} — ${creativeSkill.opening} ${creativeSkill.middle} ${creativeSkill.closing}`,
					assets: assetBriefs,
					sfxLibrary: readSfxLibrary(),
					canGenerateAudio: await canGenerateAudio(),
					workspaceRoot: workspace.root,
				}),
				"utf8",
			);
			fs.writeFileSync(workspace.agentsDocPath, buildAnimatedAgentsDoc(workspace.root), "utf8");
			onActivity?.({ kind: "log", text: "Preparing the HyperFrames renderer…" });
			await ensureHyperframesBrowser(workspace.root, controller.signal);
			await buildAnimatedProject(session, workspace, {
				binaryPath: installation.binaryPath,
				prompt: buildAnimatedPrompt(workspace.root),
				signal: controller.signal,
				...(onActivity ? { onActivity } : {}),
			});
			session.shotReviews = createPendingShotReviews(session.animated?.summary.scenes.length ?? 0);
			session.warnings = [...referenceWarnings, ...(session.animated?.warnings ?? [])];
			session.status = "planned";
			return session;
		}

		const analyzedContract =
			look === "motion"
				? motionSystemPrompt({
						creativeSkill: creativeSkill.id,
						format,
						targetSeconds,
						assets: referenceSummaries,
						contextQuery: input.request,
						...(inferredLogoReference ? { defaultLogoAssetId: inferredLogoReference.id } : {}),
					})
				: storyboardSystemPrompt({
						hasRecording: hasReferenceVideo,
						assets: referenceSummaries,
						contextQuery: input.request,
						imageSource: visualSource,
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
		fs.writeFileSync(
			workspace.briefPath,
			buildBrief({
				agent,
				request: input.request,
				contract: analyzedContract,
				format,
				targetSeconds,
				workspaceRoot: workspace.root,
			}),
			"utf8",
		);

		const runOptions = {
			binaryPath: installation.binaryPath,
			workspace,
			prompt: buildPrompt(workspace.root),
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
			const resolvedMotionAssets =
				visualSource === "generated"
					? await resolveGeneratedAssetQueries({
							parsed,
							destDir: workspace.assetsDir,
							aspectRatio: format === "vertical" ? "9:16" : format === "square" ? "1:1" : "16:9",
							signal: controller.signal,
							onNote: (text) => onActivity?.({ kind: "log", text }),
						})
					: await resolveAssetQueries({
							parsed,
							destDir: workspace.assetsDir,
							signal: controller.signal,
							onNote: (text) => onActivity?.({ kind: "log", text }),
						});
			const stagedImageIds = stagedReferences
				.filter((asset) => asset.kind === "image")
				.map((asset) => asset.id);
			const stagedVideoReferences = stagedReferences.filter((asset) => asset.kind === "video");
			const stagedVideoIds = stagedVideoReferences.map((asset) => asset.id);
			const videoDurations = Object.fromEntries(
				stagedVideoReferences.map((asset) => [asset.id, asset.durationSeconds]),
			);
			const videoShotSegments = Object.fromEntries(
				stagedVideoReferences.map((asset) => [asset.id, asset.shotSegments]),
			);
			const resolvedImageIds = resolvedMotionAssets.assets.map((asset) => asset.id);
			const defaultImageAsset =
				resolvedMotionAssets.assets[0] ??
				stagedReferences.find(
					(asset) =>
						asset.kind === "image" &&
						asset.role !== "brand" &&
						!/\b(?:logo|wordmark|brand[- ]?mark)\b/i.test(asset.label),
				);
			const supportingImageAssetIds = [
				...stagedReferences
					.filter(
						(asset) =>
							asset.kind === "image" &&
							asset.role !== "brand" &&
							asset.id !== inferredLogoReference?.id &&
							!/\b(?:logo|wordmark|brand[- ]?mark)\b/i.test(asset.label),
					)
					.map((asset) => asset.id),
				...resolvedMotionAssets.assets.map((asset) => asset.id),
			];
			const { project, warnings } = normalizeMotionProject(parsed, {
				fallbackTitle,
				creativeSkill: creativeSkill.id,
				availableAssetIds: [...stagedImageIds, ...resolvedImageIds],
				availableVideoAssetIds: stagedVideoIds,
				videoDurations,
				videoShotSegments,
				format,
				...(inferredLogoReference ? { defaultLogoAssetId: inferredLogoReference.id } : {}),
				...(defaultImageAsset ? { defaultImageAssetId: defaultImageAsset.id } : {}),
				supportingImageAssetIds,
				...(stagedVideoReferences[0] ? { defaultVideoAssetId: stagedVideoReferences[0].id } : {}),
				requireLogoReveal: requestCallsForLogo(input.request),
				requireImageScene: Boolean(defaultImageAsset),
				requireVideoScene: stagedVideoReferences.length > 0,
				requireLayeredScene:
					creativeSkill.id === "explainer-motion" ||
					creativeSkill.id === "product-update" ||
					creativeSkill.id === "product-launch",
			});
			if (creativeSkill.requireSourceVideo && stagedVideoReferences.length === 0) {
				warnings.push(
					`The ${creativeSkill.name} skill is source-footage-first, but no video reference was attached. Attach the real product recording before approving this cut.`,
				);
			}
			const brandPalette = await deriveBrandPalette(stagedReferences, resolvedMotionAssets.assets);
			session.motion = {
				...project,
				brandPalette,
				...(resolvedMotionAssets.attributionLine
					? { attributionLine: resolvedMotionAssets.attributionLine }
					: {}),
			};
			session.assets = resolvedMotionAssets.assets;
			session.warnings = [...referenceWarnings, ...resolvedMotionAssets.warnings, ...warnings];
			session.durationSeconds = motionDurationSeconds(project);
			session.shotReviews = createPendingShotReviews(project.scenes.length);
			session.craftWarnings = evaluateShotCraft(project.scenes);
		} else {
			// The agent planned without a network, naming the pictures it wanted.
			// They are fetched here, before validation, so a query that found
			// nothing degrades through the same path an unsupplied image always
			// did — and the licence credit reaches the storyboard as a term the
			// validator applies rather than something the planner chose to honour.
			const resolved = whiteboard
				? { assets: [], warnings: [], attributionLine: undefined }
				: visualSource === "generated"
					? await resolveGeneratedAssetQueries({
							parsed,
							destDir: workspace.assetsDir,
							aspectRatio: format === "vertical" ? "9:16" : format === "square" ? "1:1" : "16:9",
							signal: controller.signal,
							onNote: (text) => onActivity?.({ kind: "log", text }),
						})
					: await resolveAssetQueries({
							parsed,
							destDir: workspace.assetsDir,
							signal: controller.signal,
							onNote: (text) => onActivity?.({ kind: "log", text }),
						});
			const { storyboard, warnings } = normalizeStoryboard(parsed, {
				hasRecording: hasReferenceVideo,
				recordingShotSegments: stagedReferences.find((asset) => asset.kind === "video")
					?.shotSegments,
				fallbackTitle,
				availableAssetIds: [
					...resolved.assets.map((asset) => asset.id),
					...stagedReferences.filter((asset) => asset.kind === "image").map((asset) => asset.id),
				],
				...(whiteboard ? { allowedKinds: [...WHITEBOARD_KINDS] } : {}),
				...(resolved.attributionLine ? { attributionLine: resolved.attributionLine } : {}),
			});
			session.storyboard = storyboard;
			session.assets = resolved.assets;
			session.warnings = [...referenceWarnings, ...resolved.warnings, ...warnings];
			session.durationSeconds = storyboardDurationSeconds(storyboard);
			session.shotReviews = createPendingShotReviews(storyboard.frames.length);
			session.craftWarnings = evaluateShotCraft(storyboard.frames);
		}
		session.status = "planned";
		return session;
	} catch (error) {
		session.status = "failed";
		session.error = error instanceof Error ? error.message : String(error);
		return session;
	} finally {
		running.delete(id);
		persistSessions();
	}
}

/** HyperFrames authoring runs a check/snapshot loop, so it gets longer than a JSON plan. */
const ANIMATED_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
/** Gate failures handed back to the agent before the session is failed. */
const MAX_ANIMATED_REPAIR_ROUNDS = 2;

interface AnimatedRunOptions {
	binaryPath: string;
	prompt: string;
	signal: AbortSignal;
	onActivity?: (activity: ClaudeActivity) => void;
}

async function runAnimatedAgent(
	session: CreatorSession,
	workspace: WorkspacePaths,
	options: AnimatedRunOptions,
) {
	const runOptions = {
		binaryPath: options.binaryPath,
		workspace,
		prompt: options.prompt,
		model: session.model,
		signal: options.signal,
		timeoutMs: ANIMATED_AGENT_TIMEOUT_MS,
		...(options.onActivity ? { onActivity: options.onActivity } : {}),
	};
	const run =
		session.agent === "codex"
			? await runCodex(runOptions)
			: await runClaude({ ...runOptions, extraAllowedTools: ["Bash(./hf:*)"] });
	if (run.costUsd !== undefined) session.costUsd = (session.costUsd ?? 0) + run.costUsd;
	if (run.cancelled) throw new Error("Cancelled.");
	return run;
}

/**
 * One agent turn plus Guide Studio's gate, with up to two repair turns. The
 * agent's own exit status is advisory: a run that timed out after writing a
 * clean project is still a clean project, and one that "succeeded" without
 * passing the gate is not.
 */
async function buildAnimatedProject(
	session: CreatorSession,
	workspace: WorkspacePaths,
	options: AnimatedRunOptions,
): Promise<void> {
	const run = await runAnimatedAgent(session, workspace, options);
	if (!run.ok && !fs.existsSync(path.join(workspace.root, "compositions"))) {
		throw new Error(run.error ?? `${agentLabel(session.agent)} did not build the video.`);
	}
	let gate = await runGate(workspace.root, options.signal);
	for (let round = 0; !gate.ok && round < MAX_ANIMATED_REPAIR_ROUNDS; round += 1) {
		options.onActivity?.({
			kind: "log",
			text: `Guide Studio's check found ${gate.problems.length} problem${gate.problems.length === 1 ? "" : "s"}; asking ${agentLabel(session.agent)} to fix ${gate.problems.length === 1 ? "it" : "them"}.`,
		});
		await runAnimatedAgent(session, workspace, {
			...options,
			prompt: buildRepairPrompt(workspace.root, gate.problems),
		});
		gate = await runGate(workspace.root, options.signal);
	}
	if (!gate.ok) {
		throw new Error(
			`The video did not pass Guide Studio's checks:\n${gate.problems.slice(0, 8).join("\n")}`,
		);
	}
	const summary = await summarizeAnimatedProject(workspace.root, options.signal);
	if (!summary.scenes.length) {
		throw new Error(
			"The video has no scenes Guide Studio can edit: each scene must be its own file in compositions/.",
		);
	}
	session.animated = {
		summary,
		warnings: gate.warnings,
		notes: gate.notes,
		revisions: session.animated?.revisions ?? [],
	};
	session.durationSeconds = summary.durationSeconds;
	session.craftWarnings = [];
}

/** Anything that changes the project makes every rendered artifact stale. */
function invalidateRenders(session: CreatorSession): void {
	session.videoPath = undefined;
	session.masterPath = undefined;
	session.interchange = undefined;
	session.previewPaths = undefined;
}

/**
 * Re-approve only what could have changed: the revised scene, or every scene
 * when the request was not scoped to one or the scene list itself changed.
 */
function resetAnimatedReviews(
	session: CreatorSession,
	previousSceneIds: string[],
	changedSceneId?: string,
): void {
	const scenes = session.animated?.summary.scenes ?? [];
	const sameScenes =
		scenes.length === previousSceneIds.length &&
		scenes.every((scene, index) => scene.id === previousSceneIds[index]);
	const pending = createPendingShotReviews(scenes.length);
	session.shotReviews =
		sameScenes && changedSceneId
			? pending.map((review, index) =>
					scenes[index]?.id === changedSceneId ? review : (session.shotReviews?.[index] ?? review),
				)
			: pending;
}

/** Ask the agent to change the video, optionally one scene only, then gate it again. */
export async function reviseAnimatedSession(
	id: string,
	input: { instruction: unknown; sceneId?: unknown },
	onActivity?: (activity: ClaudeActivity) => void,
): Promise<CreatorSession> {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session || !workspace || !session.animated) {
		throw new Error("That animated session is no longer available.");
	}
	if (session.status === "planning" || session.status === "rendering") {
		throw new Error("Wait for the current run to finish before asking for changes.");
	}
	const instruction =
		typeof input.instruction === "string" ? input.instruction.trim().slice(0, 2000) : "";
	if (!instruction) throw new Error("Say what should change.");
	const scene =
		typeof input.sceneId === "string"
			? session.animated.summary.scenes.find((candidate) => candidate.id === input.sceneId)
			: undefined;
	if (input.sceneId !== undefined && !scene) throw new Error("That scene no longer exists.");

	const installation = await detectAgent(session.agent);
	if (!installation.installed || !installation.binaryPath || installation.error) {
		throw new Error(installation.error ?? notInstalledMessage(session.agent));
	}
	const previousSceneIds = session.animated.summary.scenes.map((candidate) => candidate.id);
	const controller = new AbortController();
	running.set(id, controller);
	session.status = "planning";
	session.error = undefined;
	persistSessions();
	try {
		await buildAnimatedProject(session, workspace, {
			binaryPath: installation.binaryPath,
			prompt: buildRevisionPrompt({
				workspaceRoot: workspace.root,
				instruction,
				...(scene ? { sceneId: scene.id, sceneFile: scene.file } : {}),
			}),
			signal: controller.signal,
			...(onActivity ? { onActivity } : {}),
		});
		session.animated.revisions.push({
			instruction,
			...(scene ? { sceneId: scene.id } : {}),
			at: Date.now(),
		});
		session.warnings = session.animated.warnings;
		resetAnimatedReviews(session, previousSceneIds, scene?.id);
		invalidateRenders(session);
		session.status = "planned";
	} catch (error) {
		// The previous project may be half-edited; it is still on disk for the
		// next revision to fix, but it must not be rendered as approved.
		session.status = "failed";
		session.error = error instanceof Error ? error.message : String(error);
		invalidateRenders(session);
	} finally {
		running.delete(id);
		persistSessions();
	}
	return session;
}

/**
 * Apply the user's direct edits to copy and colours. Values are coerced to
 * each variable's declared type before they touch a file, then the project
 * is gated again — long copy can push text off the frame.
 */
export async function updateAnimatedVariables(
	id: string,
	input: { sceneId?: unknown; values?: unknown },
): Promise<CreatorSession> {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session || !workspace || !session.animated) {
		throw new Error("That animated session is no longer available.");
	}
	if (session.status === "planning" || session.status === "rendering") {
		throw new Error("Wait for the current run to finish before editing.");
	}
	if (!isRecord(input.values)) throw new Error("No values to apply.");
	const scene =
		typeof input.sceneId === "string"
			? session.animated.summary.scenes.find((candidate) => candidate.id === input.sceneId)
			: undefined;
	if (input.sceneId !== undefined && !scene) throw new Error("That scene no longer exists.");
	const declarations = scene ? scene.variables : session.animated.summary.globalVariables;
	const file = path.join(workspace.root, scene ? scene.file : "index.html");
	const values: Record<string, string | number | boolean> = {};
	for (const [key, raw] of Object.entries(input.values)) {
		const declaration = declarations.find((variable) => variable.id === key);
		if (!declaration) throw new Error(`"${key}" is not an editable value of this scene.`);
		values[key] = coerceVariableValue(declaration, raw);
	}

	const before = fs.readFileSync(file, "utf8");
	fs.writeFileSync(file, applyVariableValues(before, values), "utf8");
	const gate = await runGate(workspace.root);
	if (!gate.ok) {
		fs.writeFileSync(file, before, "utf8");
		throw new Error(
			`That edit would break the video, so it was not applied:\n${gate.problems.slice(0, 4).join("\n")}`,
		);
	}
	const previousSceneIds = session.animated.summary.scenes.map((candidate) => candidate.id);
	session.animated.summary = await summarizeAnimatedProject(workspace.root);
	session.animated.warnings = gate.warnings;
	session.warnings = gate.warnings;
	// A brand colour touches every scene; a scene's copy touches only that scene.
	resetAnimatedReviews(session, previousSceneIds, scene?.id);
	invalidateRenders(session);
	session.status = "planned";
	persistSessions();
	return session;
}

/** The fetched images as the renderer wants them: an id and a local file. */
function imageAssetsFor(session: CreatorSession) {
	return [
		...(session.assets ?? []).map((asset) => ({ assetId: asset.id, src: asset.path })),
		...(session.referenceAssets ?? [])
			.filter((asset) => asset.kind === "image" && asset.previewPath)
			.map((asset) => ({ assetId: asset.id, src: asset.previewPath! })),
	];
}

function videoAssetsFor(session: CreatorSession) {
	return (session.referenceAssets ?? [])
		.filter((asset) => asset.kind === "video" && asset.previewPath)
		.map((asset) => ({ assetId: asset.id, src: asset.previewPath! }));
}

function videoAssetFor(session: CreatorSession) {
	return session.referenceAssets?.find((asset) => asset.kind === "video")?.previewPath;
}

/**
 * Never let a missing staged media file degrade into a believable-looking text
 * card. That fallback is useful for an intentionally text-only scene, but it
 * is unacceptable when the editor supplied footage or an exact logo asset.
 */
function assertMotionAssetsResolvable(session: CreatorSession, scenes: MotionScene[]): void {
	const imageIds = new Set(imageAssetsFor(session).map((asset) => asset.assetId));
	const videoIds = new Set(videoAssetsFor(session).map((asset) => asset.assetId));
	const attachedVideo = (session.referenceAssets ?? []).some((asset) => asset.kind === "video");
	const usedVideo = scenes.some(
		(scene) =>
			(scene.kind === "video" && Boolean(scene.videoAssetId)) ||
			scene.layers?.some((layer) => layer.kind === "video" && Boolean(layer.assetId)),
	);
	if (attachedVideo && !usedVideo) {
		throw new Error(
			"Attached source video was not used by the approved motion plan. Re-plan this video before rendering.",
		);
	}

	for (const scene of scenes) {
		if (scene.kind === "image" && scene.imageAssetId && !imageIds.has(scene.imageAssetId)) {
			throw new Error(`Image asset ${scene.imageAssetId} is not staged for rendering.`);
		}
		if (scene.kind === "logo" && scene.logoAssetId && !imageIds.has(scene.logoAssetId)) {
			throw new Error(`Logo asset ${scene.logoAssetId} is not staged for rendering.`);
		}
		if (scene.kind === "video" && scene.videoAssetId && !videoIds.has(scene.videoAssetId)) {
			throw new Error(`Video asset ${scene.videoAssetId} is not staged for rendering.`);
		}
		for (const layer of scene.layers ?? []) {
			if (
				(layer.kind === "image" || layer.kind === "logo") &&
				layer.assetId &&
				!imageIds.has(layer.assetId)
			) {
				throw new Error(`Layer image asset ${layer.assetId} is not staged for rendering.`);
			}
			if (layer.kind === "video" && layer.assetId && !videoIds.has(layer.assetId)) {
				throw new Error(`Layer video asset ${layer.assetId} is not staged for rendering.`);
			}
		}
	}
}

function reviewableShots(session: CreatorSession): ReviewableShot[] {
	if (session.animated) {
		return session.animated.summary.scenes.map((scene) => ({
			kind: "animated",
			durationSeconds: scene.durationSeconds,
		}));
	}
	return session.motion ? session.motion.scenes : (session.storyboard?.frames ?? []);
}

function reviewLimits(session: CreatorSession): ShotReviewDurationLimits {
	return session.motion ? { minSeconds: 1.5, maxSeconds: 12 } : { minSeconds: 1.5, maxSeconds: 20 };
}

function durationWithReviews(session: CreatorSession): number {
	// An animated scene's timing lives in its composition, not in a review
	// override, so the project's own length is the truth.
	if (session.animated) return session.animated.summary.durationSeconds;
	return applyShotDurationOverrides(reviewableShots(session), session.shotReviews).reduce(
		(total, shot) => total + shot.durationSeconds,
		0,
	);
}

function assertReviewComplete(session: CreatorSession): void {
	const shots = reviewableShots(session);
	if (!areAllShotsApproved(session.shotReviews, shots.length)) {
		const pending = (session.shotReviews ?? []).filter(
			(review) => review.status !== "approved",
		).length;
		throw new Error(
			`Review every shot before rendering. ${pending || shots.length} shot${(pending || shots.length) === 1 ? "" : "s"} still need approval.`,
		);
	}
}

/** Update human review decisions without allowing the renderer to see invalid timing. */
export function reviewSessionShots(id: string, updates: unknown): CreatorSession {
	const session = sessions.get(id);
	if (!session) throw new Error("That session is no longer available.");
	if (session.status !== "planned" && session.status !== "rendered") {
		throw new Error("Shots can only be reviewed after planning has finished.");
	}

	const shots = reviewableShots(session);
	const nextReviews = applyShotReviewUpdates(
		session.shotReviews,
		// Retiming an animated scene is an edit to its composition (ask the
		// agent), never a review override the renderer would not honour.
		session.animated && Array.isArray(updates)
			? updates.map((update) =>
					isRecord(update) ? { ...update, durationSeconds: undefined } : update,
				)
			: updates,
		shots.length,
		reviewLimits(session),
	);
	const nextDuration = applyShotDurationOverrides(shots, nextReviews).reduce(
		(total, shot) => total + shot.durationSeconds,
		0,
	);
	const maxTotalSeconds = session.motion ? 180 : 240;
	if (nextDuration > maxTotalSeconds) {
		throw new Error(
			`Timing changes cannot make this video longer than ${maxTotalSeconds} seconds.`,
		);
	}
	session.shotReviews = nextReviews;
	session.durationSeconds = durationWithReviews(session);
	// A timing or approval change makes any previous MP4 stale. It must not be
	// mistaken for the newly approved cut.
	session.videoPath = undefined;
	session.masterPath = undefined;
	session.interchange = undefined;
	// Narration timings are authored against the approved shot rhythm. A timing
	// edit makes that finishing pass stale, so it must be regenerated rather
	// than silently drifting away from the visuals.
	session.finishing = undefined;
	session.status = "planned";
	persistSessions();
	return session;
}

/** Attach validated local narration/music to the approved visual plan. */
export function setSessionFinishing(id: string, input: CreatorFinishingInput): CreatorSession {
	const session = sessions.get(id);
	const workspace = workspaces.get(id);
	if (!session || !workspace) throw new Error("That session is no longer available.");
	if (session.status !== "planned" && session.status !== "rendered") {
		throw new Error("Finishing can only be added after planning has finished.");
	}
	const maxDurationMs = Math.round(durationWithReviews(session) * 1000);
	session.finishing = normalizeFinishing(workspace, input, maxDurationMs);
	session.videoPath = undefined;
	session.masterPath = undefined;
	session.interchange = undefined;
	session.status = "planned";
	persistSessions();
	return session;
}

function isVisualCaptionSuppressedScene(scene: MotionScene): boolean {
	return (
		scene.kind === "image" ||
		scene.kind === "video" ||
		scene.kind === "logo" ||
		(scene.kind === "layered" &&
			Boolean(
				scene.layers?.some(
					(layer) => layer.kind === "image" || layer.kind === "video" || layer.kind === "logo",
				),
			))
	);
}

/** Keep narration timing intact, but never burn captions over visual proof. */
export function filterCaptionsForMotionScenes(
	scenes: MotionScene[],
	lines: RenderCaptionLine[],
	reviews?: ShotReview[],
): RenderCaptionLine[] {
	const reviewedScenes = applyShotDurationOverrides(scenes, reviews);
	const eligibleRanges: Array<{ startMs: number; endMs: number }> = [];
	let cursorMs = 0;
	for (const scene of reviewedScenes) {
		const durationMs = Math.max(1, Math.round(scene.durationSeconds * 1000));
		if (!isVisualCaptionSuppressedScene(scene)) {
			eligibleRanges.push({ startMs: cursorMs, endMs: cursorMs + durationMs });
		}
		cursorMs += durationMs;
	}

	return lines.flatMap((line) =>
		eligibleRanges.flatMap((range) => {
			const startMs = Math.max(line.startMs, range.startMs);
			const endMs = Math.min(line.endMs, range.endMs);
			return endMs > startMs ? [{ ...line, startMs, endMs }] : [];
		}),
	);
}

function captionsFor(session: CreatorSession): RenderCaptionLine[] {
	const lines = session.finishing?.narration?.captions?.length
		? session.finishing.narration.captions
		: (session.finishing?.narration?.segments ?? []).map((segment) => ({
				text: segment.text,
				startMs: segment.startMs,
				endMs: segment.endMs,
			}));
	return session.motion
		? filterCaptionsForMotionScenes(session.motion.scenes, lines, session.shotReviews)
		: lines;
}

function hyperFrameThemeFor(session: CreatorSession) {
	const palette = session.motion?.brandPalette;
	if (!palette) return undefined;
	return {
		accentHex: palette.primary,
		softHex: palette.highlight,
		glowRgba: `rgba(${Number.parseInt(palette.primary.slice(1, 3), 16)},${Number.parseInt(palette.primary.slice(3, 5), 16)},${Number.parseInt(palette.primary.slice(5, 7), 16)},0.35)`,
	};
}

async function finishRenderedVideo(session: CreatorSession, outputPath: string): Promise<void> {
	const finishing = session.finishing;
	if (
		!finishing?.narration?.segments.length &&
		!finishing?.narration?.fullAudioPath &&
		!finishing?.musicPath &&
		!finishing?.sfx?.length
	)
		return;

	const narration: NarrationMuxSegment[] = finishing.narration?.fullAudioPath
		? [{ audioPath: finishing.narration.fullAudioPath, offsetMs: 0 }]
		: (finishing.narration?.segments ?? []).map((segment) => ({
				audioPath: segment.audioPath,
				offsetMs: segment.startMs,
			}));
	const music: MusicMuxBed | null = finishing.musicPath
		? {
				audioPath: finishing.musicPath,
				volume: finishing.musicVolume,
				duckWindows: (finishing.narration?.captions?.length
					? finishing.narration.captions
					: (finishing.narration?.segments ?? [])
				).map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs })),
			}
		: null;
	const sfx: SfxMuxCue[] = finishing.sfx ?? [];
	const temporaryPath = `${outputPath}.finishing.tmp.mp4`;
	const result = await muxNarrationAudio(
		outputPath,
		narration,
		temporaryPath,
		music,
		// An animated cut's own audio is designed sound (effects, ducked bed,
		// footage speech), not a scratch track to replace.
		session.animated ? false : finishing.muteOriginalAudio,
		sfx,
	);
	if (!result.success) {
		fs.rmSync(temporaryPath, { force: true });
		throw new Error(result.error ?? "Audio finishing failed.");
	}
	fs.renameSync(temporaryPath, outputPath);
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

	if (session.animated) {
		const stills = await snapshotScenes(
			workspace.root,
			session.animated.summary,
			path.join(workspace.previewDir, "animated"),
		);
		session.previewPaths = stills.flatMap((stillPath, frameIndex) =>
			stillPath ? [{ frameIndex, path: stillPath }] : [],
		);
		persistSessions();
		return session;
	}

	if (session.motion) {
		const scenes = applyShotDurationOverrides(session.motion.scenes, session.shotReviews);
		assertMotionAssetsResolvable(session, scenes);
		const brandPalette = await ensureMotionBrandPalette(session);
		const captions = captionsFor(session);
		session.previewPaths = await renderMotionStills({
			title: session.motion.title,
			accent: session.motion.accent,
			scenes,
			brandPalette,
			imageAssets: imageAssetsFor(session),
			videoAssets: videoAssetsFor(session),
			...(captions.length ? { captions } : {}),
			...(session.motion.attributionLine
				? { attributionLine: session.motion.attributionLine }
				: {}),
			sceneIndexes: sample(scenes.length),
			outputDirectory: workspace.previewDir,
			format: session.format,
		});
		persistSessions();
		return session;
	}

	if (!session.storyboard) throw new Error("This session has nothing to preview.");
	const frames = applyShotDurationOverrides(session.storyboard.frames, session.shotReviews);
	const captions = captionsFor(session);
	const theme = hyperFrameThemeFor(session);
	session.previewPaths = await renderHyperFrameStills({
		title: session.storyboard.title,
		accent: session.storyboard.accent,
		frames,
		frameIndexes: sample(frames.length),
		outputDirectory: workspace.previewDir,
		format: session.format,
		imageAssets: imageAssetsFor(session),
		screenSrc: videoAssetFor(session),
		...(captions.length ? { captions } : {}),
		...(theme ? { theme } : {}),
	});
	persistSessions();
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
	const title = plan?.title ?? (session.animated ? session.request.slice(0, 80) : undefined);
	if (title === undefined) throw new Error("This session has nothing to render.");
	assertReviewComplete(session);

	const controller = new AbortController();
	running.set(id, controller);
	session.status = "rendering";
	session.masterPath = undefined;
	session.interchange = undefined;

	const safeName =
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 60) || "guide-video";
	const outputPath = path.join(workspace.renderDir, `${safeName}.mp4`);
	persistSessions();

	try {
		fs.mkdirSync(workspace.renderDir, { recursive: true });
		if (session.animated) {
			// The user may have edited files since the last gate; render only
			// what passes it now.
			const gate = await runGate(workspace.root, controller.signal);
			if (!gate.ok) {
				throw new Error(
					`The video no longer passes Guide Studio's checks:\n${gate.problems.slice(0, 6).join("\n")}`,
				);
			}
			await renderAnimatedProject({
				root: workspace.root,
				outputPath,
				signal: controller.signal,
				...(onProgress ? { onProgress } : {}),
			});
		} else if (session.motion) {
			const scenes = applyShotDurationOverrides(session.motion.scenes, session.shotReviews);
			assertMotionAssetsResolvable(session, scenes);
			const brandPalette = await ensureMotionBrandPalette(session);
			const captions = captionsFor(session);
			await renderMotionDemo({
				title: session.motion.title,
				accent: session.motion.accent,
				scenes,
				brandPalette,
				imageAssets: imageAssetsFor(session),
				videoAssets: videoAssetsFor(session),
				...(captions.length ? { captions } : {}),
				...(session.motion.attributionLine
					? { attributionLine: session.motion.attributionLine }
					: {}),
				outputPath,
				format: session.format,
				signal: controller.signal,
				...(onProgress ? { onProgress } : {}),
			});
		} else if (session.storyboard) {
			const frames = applyShotDurationOverrides(session.storyboard.frames, session.shotReviews);
			const captions = captionsFor(session);
			const theme = hyperFrameThemeFor(session);
			await renderHyperFrameDemo({
				title: session.storyboard.title,
				accent: session.storyboard.accent,
				frames,
				imageAssets: imageAssetsFor(session),
				screenSrc: videoAssetFor(session),
				...(captions.length ? { captions } : {}),
				...(theme ? { theme } : {}),
				outputPath,
				format: session.format,
				signal: controller.signal,
				...(onProgress ? { onProgress } : {}),
			});
		}
		await finishRenderedVideo(session, outputPath);
		// Audio muxing copies the video stream, so validate the finished artifact
		// again rather than trusting the pre-finish Remotion output.
		await validateRenderedVideo(outputPath, {
			width: session.format === "landscape" ? 1920 : 1080,
			height: session.format === "landscape" ? 1080 : session.format === "vertical" ? 1920 : 1080,
			fps: 30,
			durationSeconds: durationWithReviews(session),
			...(session.finishing?.narration?.segments.length ||
			session.finishing?.narration?.fullAudioPath ||
			session.finishing?.musicPath ||
			session.finishing?.sfx?.length
				? { requireAudio: true, integratedLufsRange: [-23, -12] as const }
				: session.animated?.summary.audio.length
					? { requireAudio: true }
					: {}),
		});
		session.videoPath = outputPath;
		session.status = "rendered";
		return session;
	} catch (error) {
		session.status = "failed";
		session.error = error instanceof Error ? error.message : String(error);
		return session;
	} finally {
		running.delete(id);
		persistSessions();
	}
}
