// ── Motion project contract ──────────────────────────────────────────────
//
// The same discipline as `storyboard.ts`, applied to the animated library.
// Claude picks a backdrop or typography animation by id and supplies copy;
// everything is clamped here before it reaches Remotion, so a malformed or
// over-ambitious plan degrades into a shorter, plainer video rather than a
// failed render.
//
// Two rules the planner is not trusted with, because they decide whether the
// output is watchable at all:
//   * an unknown id becomes a plain card rather than a blank scene
//   * copy is truncated to what the layout can actually show

import {
	buildMediaContextRetrievalPrompt,
	type MediaContextRole,
	type MediaContextShotSegment,
	type MediaContextTranscriptSegment,
} from "../../src/lib/ai/mediaContext";
import type {
	MotionAccent,
	MotionBrandPalette,
	MotionFormat,
	MotionImageMotion,
	MotionLayer,
	MotionLayerKind,
	MotionLayerMotion,
	MotionScene,
	MotionVideoMotion,
} from "../../src/lib/remotion/MotionGraphicsComposition";
import {
	BACKDROP_IDS,
	findBackdrop,
	findTextScene,
	TEXT_SCENE_IDS,
} from "../../src/lib/remotion/motion/catalog";
import { type CreativeSkillId, creativeSkillPrompt, getCreativeSkill } from "./creativeSkills";
import { isRecord } from "./json";
import {
	applyLaunchFilmMetadata,
	launchFilmReadinessWarnings,
	launchFilmStructureWarnings,
	launchFilmSystemPrompt,
} from "./launchFilm";

export const MOTION_ACCENTS = ["indigo", "emerald", "amber", "rose", "violet"] as const;

export const MOTION_LIMITS = {
	minScenes: 2,
	maxScenes: 12,
	minSceneSeconds: 1.5,
	maxSceneSeconds: 12,
	maxTotalSeconds: 180,
	maxBullets: 4,
	maxLayers: 12,
	eyebrow: 28,
	headline: 70,
	subhead: 130,
	bullet: 80,
	layerText: 180,
	title: 90,
} as const;

export interface MotionProject {
	creativeSkill: CreativeSkillId;
	title: string;
	accent: MotionAccent;
	scenes: MotionScene[];
	/** Art direction derived from supplied brand/product media. */
	brandPalette?: MotionBrandPalette;
	/** The supplied brand asset used by the closing logo reveal, when present. */
	logoAssetId?: string;
	/** Required source credit for stock visual assets. */
	attributionLine?: string;
}

export interface NormalizeMotionOptions {
	fallbackTitle: string;
	creativeSkill?: CreativeSkillId;
	targetSeconds?: number;
	/** Image asset ids that were actually staged for this session. */
	availableAssetIds?: string[];
	/** Video asset ids that were actually staged for this session. */
	availableVideoAssetIds?: string[];
	/** Probed source duration for each staged video asset. */
	videoDurations?: Record<string, number | undefined>;
	/** Coarse detected edit ranges for each staged video asset. */
	videoShotSegments?: Record<string, MediaContextShotSegment[] | undefined>;
	/** The best logo candidate inferred from the user's attached references. */
	defaultLogoAssetId?: string;
	/** Add a deterministic closing logo reveal when the request calls for one. */
	requireLogoReveal?: boolean;
	/** The best non-logo image candidate for a visual-first motion project. */
	defaultImageAssetId?: string;
	/** Additional approved image ids available for deterministic collages. */
	supportingImageAssetIds?: string[];
	/** Ensure an available image is actually used by at least one scene. */
	requireImageScene?: boolean;
	/** The best attached video for a visual-first motion project. */
	defaultVideoAssetId?: string;
	/** Ensure an available video is actually used by at least one scene. */
	requireVideoScene?: boolean;
	/** Ensure visual-first skills get at least one mixed-media scene. */
	requireLayeredScene?: boolean;
	/** Output format used by the editorial layout guard. */
	format?: MotionFormat;
}

export interface NormalizeMotionResult {
	project: MotionProject;
	warnings: string[];
}

export interface MotionAssetSummary {
	id: string;
	label: string;
	kind: "image" | "video";
	role?: MediaContextRole;
	fileName?: string;
	contactSheetFileName?: string;
	contactSheetTimesSeconds?: number[];
	shows?: string;
	shotSegments?: MediaContextShotSegment[];
	visualSummary?: string;
	ocrText?: string[];
	transcriptExcerpt?: string;
	transcriptSegments?: MediaContextTranscriptSegment[];
}

function clampText(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim().replace(/\s+/g, " ");
	if (!trimmed) return undefined;
	return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function clampSeconds(value: unknown, fallback: number): number {
	const seconds = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(
		MOTION_LIMITS.maxSceneSeconds,
		Math.max(MOTION_LIMITS.minSceneSeconds, Math.round(seconds * 10) / 10),
	);
}

function normalizeImageMotion(value: unknown): MotionImageMotion {
	return value === "parallax" || value === "float" ? value : "ken-burns";
}

function normalizeVideoMotion(value: unknown): MotionVideoMotion {
	return value === "push-in" || value === "drift" ? value : "steady";
}

function clampFraction(value: unknown, fallback: number): number {
	const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(1, Math.max(0, number));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.min(max, Math.max(min, number));
}

function normalizeLayerMotion(value: unknown): MotionLayerMotion {
	return value === "drift" ||
		value === "push-in" ||
		value === "rise" ||
		value === "scale-in" ||
		value === "wipe"
		? value
		: "none";
}

function normalizeLayerKind(value: unknown): MotionLayerKind | undefined {
	return value === "image" ||
		value === "video" ||
		value === "logo" ||
		value === "text" ||
		value === "shape"
		? value
		: undefined;
}

function normalizeLayerColor(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const color = value.trim();
	if (
		["background", "surface", "primary", "secondary", "highlight", "text", "mutedText"].includes(
			color,
		)
	) {
		return color;
	}
	return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color) ? color : undefined;
}

function normalizeMotionLayers(
	value: unknown,
	availableAssetIds: Set<string>,
	availableVideoAssetIds: Set<string>,
	videoDurations?: Record<string, number | undefined>,
): MotionLayer[] {
	if (!Array.isArray(value)) return [];
	const layers: MotionLayer[] = [];
	for (const [index, candidate] of value.slice(0, MOTION_LIMITS.maxLayers).entries()) {
		if (!isRecord(candidate)) continue;
		const kind = normalizeLayerKind(candidate.kind);
		if (!kind) continue;
		const assetId = typeof candidate.assetId === "string" ? candidate.assetId : undefined;
		if (kind === "image" || kind === "logo") {
			if (!assetId || !availableAssetIds.has(assetId)) continue;
		} else if (kind === "video") {
			if (!assetId || !availableVideoAssetIds.has(assetId)) continue;
		}
		const x = clampFraction(candidate.x, kind === "text" ? 0.08 : 0.1);
		const y = clampFraction(candidate.y, kind === "text" ? 0.76 : 0.1);
		const width = clampNumber(candidate.width, kind === "text" ? 0.84 : 0.8, 0.02, 1 - x);
		const height = clampNumber(candidate.height, kind === "text" ? 0.16 : 0.8, 0.02, 1 - y);
		const text = kind === "text" ? clampText(candidate.text, MOTION_LIMITS.layerText) : undefined;
		if (kind === "text" && !text) continue;
		const sourceLength = kind === "video" && assetId ? videoDurations?.[assetId] : undefined;
		const requestedSourceStart =
			kind === "video"
				? clampNumber(candidate.sourceStartSeconds, 0, 0, Number.MAX_SAFE_INTEGER)
				: undefined;
		const sourceStartSeconds =
			kind === "video" && requestedSourceStart !== undefined
				? sourceLength && sourceLength >= 0.5
					? Math.min(requestedSourceStart, Math.max(0, sourceLength - 0.5))
					: requestedSourceStart
				: undefined;
		const requestedSourceDuration =
			kind === "video"
				? clampNumber(candidate.sourceDurationSeconds, 4, 0.5, MOTION_LIMITS.maxSceneSeconds)
				: undefined;
		const sourceDurationSeconds =
			kind === "video" && requestedSourceDuration !== undefined
				? sourceLength && sourceLength - (sourceStartSeconds ?? 0) >= 0.5
					? Math.min(requestedSourceDuration, sourceLength - (sourceStartSeconds ?? 0))
					: requestedSourceDuration
				: undefined;
		const textAlign =
			candidate.textAlign === "center" || candidate.textAlign === "right"
				? candidate.textAlign
				: "left";
		const layer: MotionLayer = {
			id: clampText(candidate.id, 40) ?? `layer-${index + 1}`,
			kind,
			...(assetId ? { assetId } : {}),
			...(text ? { text } : {}),
			...(normalizeLayerColor(candidate.color)
				? { color: normalizeLayerColor(candidate.color) }
				: {}),
			x: Math.round(x * 1000) / 1000,
			y: Math.round(y * 1000) / 1000,
			width: Math.round(width * 1000) / 1000,
			height: Math.round(height * 1000) / 1000,
			opacity: Math.round(clampFraction(candidate.opacity, 1) * 1000) / 1000,
			rotation: Math.round(clampNumber(candidate.rotation, 0, -45, 45) * 10) / 10,
			zIndex: Math.round(clampNumber(candidate.zIndex, index, -100, 100)),
			borderRadius: Math.round(
				clampNumber(candidate.borderRadius, kind === "shape" ? 28 : 18, 0, 240),
			),
			...(kind === "text"
				? {
						fontSize: Math.round(clampNumber(candidate.fontSize, 64, 18, 240)),
						fontWeight: Math.round(clampNumber(candidate.fontWeight, 700, 400, 900)),
						textAlign,
					}
				: {}),
			...(kind === "image" || kind === "logo" || kind === "video"
				? { fit: candidate.fit === "contain" ? "contain" : "cover" }
				: {}),
			motion: normalizeLayerMotion(candidate.motion),
			...(sourceStartSeconds !== undefined ? { sourceStartSeconds } : {}),
			...(sourceDurationSeconds !== undefined ? { sourceDurationSeconds } : {}),
		};
		layers.push(layer);
	}
	return layers;
}

function snapVideoRangeToShotBoundaries(
	startSeconds: number,
	segmentDurationSeconds: number,
	sourceDuration: number,
	segments: MediaContextShotSegment[] | undefined,
): { startSeconds: number; durationSeconds: number } {
	if (!segments?.length) return { startSeconds, durationSeconds: segmentDurationSeconds };
	const boundaries = [
		0,
		...segments.flatMap((segment) => [segment.startSeconds, segment.endSeconds]),
		sourceDuration,
	]
		.filter((value) => Number.isFinite(value) && value >= 0 && value <= sourceDuration)
		.sort((a, b) => a - b)
		.filter((value, index, values) => index === 0 || value !== values[index - 1]);
	const nearest = (value: number) =>
		boundaries.reduce((best, candidate) =>
			Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
		);
	const snappedStart = nearest(startSeconds);
	const desiredEnd = Math.min(sourceDuration, snappedStart + segmentDurationSeconds);
	const endCandidates = boundaries.filter(
		(candidate) => candidate - snappedStart >= MOTION_LIMITS.minSceneSeconds,
	);
	const snappedEnd = endCandidates.length ? nearest(desiredEnd) : desiredEnd;
	if (snappedEnd - snappedStart < MOTION_LIMITS.minSceneSeconds) {
		return { startSeconds, durationSeconds: segmentDurationSeconds };
	}
	return {
		startSeconds: Math.round(snappedStart * 10) / 10,
		durationSeconds: Math.round((snappedEnd - snappedStart) * 10) / 10,
	};
}

function editorialVideoRange(
	index: number,
	durationSeconds: number,
	sourceDuration: number,
	segments?: MediaContextShotSegment[],
): { startSeconds: number; durationSeconds: number } {
	const usableSegments = (segments ?? []).filter(
		(segment) => segment.endSeconds - segment.startSeconds >= MOTION_LIMITS.minSceneSeconds,
	);
	const selected = usableSegments.length
		? usableSegments[index % usableSegments.length]
		: undefined;
	if (selected) {
		const selectedDuration = selected.endSeconds - selected.startSeconds;
		const beatDuration = Math.min(durationSeconds, selectedDuration);
		const availableOffset = Math.max(0, selectedDuration - beatDuration);
		// A detector often returns one long segment for a screen recording. Do
		// not reuse its first frame for every beat: subdivide that segment into
		// deterministic editorial windows before falling back to repetition.
		const windowsPerSegment = Math.max(
			1,
			Math.floor(selectedDuration / Math.max(beatDuration, MOTION_LIMITS.minSceneSeconds)),
		);
		const windowIndex = Math.floor(index / usableSegments.length) % windowsPerSegment;
		const windowProgress = windowsPerSegment > 1 ? windowIndex / (windowsPerSegment - 1) : 0;
		const startSeconds = selected.startSeconds + availableOffset * windowProgress;
		return {
			startSeconds: Math.round(startSeconds * 10) / 10,
			// Keep the editorial beat alive for its full duration. Crossing a shot
			// boundary is preferable to allowing a short detected segment to leave
			// the remaining beat on a frozen/blank frame.
			durationSeconds:
				Math.round(Math.min(durationSeconds, sourceDuration - startSeconds) * 10) / 10,
		};
	}

	const maxStart = Math.max(0, sourceDuration - durationSeconds);
	const startSeconds = maxStart > 0 ? Math.min(maxStart, (index * 3.7) % (maxStart + 0.1)) : 0;
	return {
		startSeconds: Math.round(startSeconds * 10) / 10,
		durationSeconds: Math.round(Math.min(durationSeconds, sourceDuration - startSeconds) * 10) / 10,
	};
}

/**
 * Explainers need the product on screen while the story is being told. A
 * text-only beat is still useful editorially, but when source footage exists
 * it is safer to turn that beat into a lower-third over the real product than
 * to let the render drift into a generic title card.
 */
function visualBackedEditorialScene(
	scene: MotionScene,
	index: number,
	videoAssetId: string,
	sourceDuration: number,
	segments?: MediaContextShotSegment[],
	format: MotionFormat = "landscape",
): MotionScene {
	const range = editorialVideoRange(index, scene.durationSeconds, sourceDuration, segments);
	const headline = clampText(
		scene.kind === "text" ? scene.text : scene.headline,
		MOTION_LIMITS.headline,
	);
	const subhead = clampText(
		scene.kind === "card" ? (scene.subhead ?? scene.bullets?.slice(0, 2).join("  •  ")) : undefined,
		MOTION_LIMITS.subhead,
	);
	const isLandscape = format === "landscape";
	const videoBox = isLandscape
		? { x: 0.39, y: 0.09, width: 0.55, height: 0.82 }
		: { x: 0.08, y: 0.06, width: 0.84, height: 0.46 };
	const copyBox = isLandscape
		? { x: 0.055, y: 0.12, width: 0.29, height: 0.76 }
		: { x: 0.08, y: 0.56, width: 0.84, height: 0.34 };
	const headlineY = copyBox.y + (isLandscape ? 0.15 : 0.13);
	const subheadY = copyBox.y + (isLandscape ? 0.56 : 0.23);
	const layers: MotionLayer[] = [
		{
			id: "editorial-field",
			kind: "shape",
			color: "background",
			x: 0,
			y: 0,
			width: 1,
			height: 1,
			opacity: 1,
			rotation: 0,
			zIndex: 0,
			borderRadius: 0,
			motion: "none",
		},
		{
			id: "source-footage",
			kind: "video",
			assetId: videoAssetId,
			x: videoBox.x,
			y: videoBox.y,
			width: videoBox.width,
			height: videoBox.height,
			opacity: 1,
			rotation: 0,
			zIndex: 1,
			borderRadius: 24,
			fit: "cover",
			motion: index % 2 === 0 ? "push-in" : "drift",
			sourceStartSeconds: range.startSeconds,
			sourceDurationSeconds: range.durationSeconds,
		},
		{
			id: "copy-surface",
			kind: "shape",
			color: "surface",
			x: copyBox.x,
			y: copyBox.y,
			width: copyBox.width,
			height: copyBox.height,
			// Copy lives on the brand field itself. Keeping this layer transparent
			// prevents a dark lower-third from appearing behind captions.
			opacity: 0,
			rotation: 0,
			zIndex: 2,
			borderRadius: 24,
			motion: "scale-in",
		},
		{
			id: "copy-accent",
			kind: "shape",
			color: "primary",
			x: copyBox.x + 0.03,
			y: copyBox.y + 0.08,
			width: 0.075,
			height: 0.012,
			opacity: 1,
			rotation: 0,
			zIndex: 3,
			borderRadius: 8,
			motion: "wipe",
		},
	];
	if (headline) {
		layers.push({
			id: "copy-headline",
			kind: "text",
			text: headline,
			color: "text",
			x: copyBox.x + 0.03,
			y: headlineY,
			width: copyBox.width - 0.06,
			height: isLandscape ? 0.17 : 0.12,
			opacity: 1,
			rotation: 0,
			zIndex: 4,
			borderRadius: 0,
			fontSize: isLandscape ? 48 : 54,
			fontWeight: 750,
			textAlign: "left",
			motion: "rise",
		});
	}
	if (subhead) {
		layers.push({
			id: "copy-subhead",
			kind: "text",
			text: subhead,
			color: "mutedText",
			x: copyBox.x + 0.03,
			y: subheadY,
			width: copyBox.width - 0.06,
			height: isLandscape ? 0.16 : 0.07,
			opacity: 1,
			rotation: 0,
			zIndex: 4,
			borderRadius: 0,
			fontSize: isLandscape ? 24 : 28,
			fontWeight: 550,
			textAlign: "left",
			motion: "rise",
		});
	}
	return {
		id: scene.id,
		kind: "layered",
		durationSeconds: scene.durationSeconds,
		layers,
	};
}

/** The instruction describing the catalog. Generated, so it cannot drift. */
export function motionSystemPrompt(options: {
	creativeSkill?: CreativeSkillId;
	format?: "landscape" | "vertical" | "square";
	targetSeconds?: number;
	assets?: MotionAssetSummary[];
	defaultLogoAssetId?: string;
	contextQuery?: string;
}): string {
	const backdrops = [
		'Backdrop ids for a "card" scene — an animated visual with your copy over it:',
		...BACKDROP_IDS.map((id) => `- "${id}": ${findBackdrop(id)?.description ?? ""}`),
	];
	const textScenes = [
		'Typography ids for a "text" scene — the animation renders your words itself:',
		...TEXT_SCENE_IDS.map((id) => {
			const entry = findTextScene(id);
			return `- "${id}": ${entry?.description ?? ""} (max ${entry?.maxChars ?? 24} characters)`;
		}),
	];

	const lines = [
		"You are a motion-graphics director for Guide Studio. Return valid compact JSON only, with no prose and no code fences.",
		creativeSkillPrompt(options.creativeSkill),
		'Shape: {"title":string,"accent":string,"logoAssetId":string|null,"scenes":[{"kind":"text"|"card"|"image"|"video"|"logo"|"layered","durationSeconds":number,...}]}',
		`accent is one of: ${MOTION_ACCENTS.join(", ")}.`,
		"",
		'A "text" scene sets: textScene (an id below) and text (the words it animates). Nothing else shows on that scene.',
		'A "card" scene sets: backdrop (an id below), and any of eyebrow, headline, subhead, bullets.',
		'A "image" scene sets: imageAssetId to a supplied image id, or imageQuery for a stock/generated visual, plus optional imageMotion ("ken-burns"|"parallax"|"float") and copy. Use image scenes for product truth, atmosphere, or visual breathing room; do not make a motion video text-only when suitable images exist.',
		'A "video" scene sets: videoAssetId to a supplied video id, sourceStartSeconds, sourceDurationSeconds, and optional videoMotion ("push-in"|"drift"|"steady") plus copy. Use attached product footage for proof and story beats; never redraw or invent product behavior when the footage already shows it.',
		'A "layered" scene sets: layers to an array of up to 12 objects. Each layer has kind ("image"|"video"|"logo"|"text"|"shape"), normalized x/y/width/height from 0 to 1, opacity, rotation, zIndex, borderRadius, and motion ("none"|"drift"|"push-in"|"rise"|"scale-in"|"wipe"). Asset layers must use an exact supplied assetId; video layers may also set sourceStartSeconds and sourceDurationSeconds. Text layers set text, fontSize, fontWeight, textAlign, and color. Shape layers set color. Use layered scenes for mixed-media explainers: put real footage or supplied imagery behind concise text and graphic accents. Never make a layered scene text-only when a supplied visual exists.',
		"Hard caption rule: captions are not a visual layer. If a skill, brief, or narration instruction asks for captions over an image, video, logo, or mixed-media scene containing those assets, ignore that instruction. Captions may only appear over text/card beats; keep supplied visual pixels clean.",
		'A "logo" scene sets: logoAssetId to one of the supplied image asset ids. It renders the actual supplied logo with a deterministic premium reveal; never spell a logo as ordinary text.',
		"A logo scene may also set tagline for one short closing line. Keep the tagline in the same logo scene, below the supplied logo, and reveal it only after the logo assembles. Never create a separate final text scene for the logo tagline.",
		...(options.creativeSkill === "product-launch" ? [launchFilmSystemPrompt()] : []),
		"",
		...backdrops,
		"",
		...textScenes,
		"",
		`Use ${MOTION_LIMITS.minScenes}-${MOTION_LIMITS.maxScenes} scenes. Each durationSeconds is ${MOTION_LIMITS.minSceneSeconds}-${MOTION_LIMITS.maxSceneSeconds}.`,
		`Keep headline under ${MOTION_LIMITS.headline} characters, subhead under ${MOTION_LIMITS.subhead}, each bullet under ${MOTION_LIMITS.bullet}, at most ${MOTION_LIMITS.maxBullets} bullets.`,
		"Text scenes are for short, punchy beats — a title, a turn, a closing line. Cards carry the explanation. Layered scenes carry the proof and editorial motion.",
		"Vary the backdrops; repeating one twice in a row reads as a stuck video.",
		"Write specific copy about the subject, never placeholder text, and do not invent prices, metrics, names, or URLs.",
	];

	if (options.assets?.length) {
		lines.push(
			"Supplied media assets (use ids exactly; an image is eligible for a logo reveal):",
			...options.assets.map((asset) =>
				[
					`- ${asset.id}: ${asset.kind}, ${asset.label}${asset.role ? `, role ${asset.role}` : ""}`,
					asset.fileName ? ` — inspect file: ${asset.fileName}` : "",
					asset.contactSheetFileName ? ` — video overview: ${asset.contactSheetFileName}` : "",
					asset.contactSheetTimesSeconds?.length
						? ` — overview times: ${asset.contactSheetTimesSeconds.map((time) => `${time.toFixed(1)}s`).join(", ")}`
						: "",
					asset.shotSegments?.length
						? ` — detected shot ranges: ${asset.shotSegments
								.slice(0, 24)
								.map(
									(segment) =>
										`${segment.startSeconds.toFixed(1)}-${segment.endSeconds.toFixed(1)}s`,
								)
								.join(", ")}`
						: "",
					asset.shows ? ` — shows: ${asset.shows}` : "",
					asset.visualSummary ? ` — visual summary: ${asset.visualSummary}` : "",
					asset.ocrText?.length ? ` — visible text: ${asset.ocrText.join(" / ")}` : "",
					asset.transcriptExcerpt ? ` — transcript: ${asset.transcriptExcerpt}` : "",
				].join(""),
			),
			"Inspect the listed session-local image files or video overview before planning; preserve supplied product truth and use attached footage as actual video scenes when it supports the story.",
			"For video scenes, prefer sourceStartSeconds and sourceDurationSeconds that align with the detected shot ranges; do not cut through the middle of a distinct shot unless the story requires it.",
		);
		if (options.defaultLogoAssetId) {
			lines.push(
				`The most likely logo asset is "${options.defaultLogoAssetId}". Use it for the final logo scene unless the supplied references clearly identify another image asset as the brand mark.`,
			);
		}
		const retrieval = options.contextQuery
			? buildMediaContextRetrievalPrompt(
					options.assets.map((asset) => ({
						id: asset.id,
						kind: asset.kind,
						role: asset.role ?? "supporting-media",
						label: asset.label,
						...(asset.visualSummary ? { visualSummary: asset.visualSummary } : {}),
						...(asset.ocrText ? { ocrText: asset.ocrText } : {}),
						...(asset.transcriptExcerpt ? { transcriptExcerpt: asset.transcriptExcerpt } : {}),
						...(asset.transcriptSegments ? { transcriptSegments: asset.transcriptSegments } : {}),
						...(asset.shotSegments ? { shotSegments: asset.shotSegments } : {}),
					})),
					options.contextQuery,
				)
			: "";
		if (retrieval) lines.push(retrieval);
	} else {
		lines.push("No supplied image assets are available, so do not invent a logo scene.");
	}

	if (options.format && options.format !== "landscape") {
		lines.push(
			options.format === "vertical"
				? "This renders vertically for a phone. Headlines of six words or fewer, at most three bullets per card."
				: "This renders square. Keep headlines short and use at most three bullets per card.",
		);
	}
	if (options.targetSeconds) {
		lines.push(`Aim for a total length near ${options.targetSeconds} seconds.`);
	}
	return lines.join("\n");
}

export function normalizeMotionProject(
	value: unknown,
	options: NormalizeMotionOptions,
): NormalizeMotionResult {
	const warnings: string[] = [];
	const creativeSkill = getCreativeSkill(options.creativeSkill);
	const root = isRecord(value) ? value : {};
	const availableAssetIds = new Set(options.availableAssetIds ?? []);
	const availableVideoAssetIds = new Set(options.availableVideoAssetIds ?? []);
	const defaultVideoAssetId =
		typeof options.defaultVideoAssetId === "string" &&
		availableVideoAssetIds.has(options.defaultVideoAssetId)
			? options.defaultVideoAssetId
			: undefined;
	const defaultVideoDuration = defaultVideoAssetId
		? options.videoDurations?.[defaultVideoAssetId]
		: undefined;
	const defaultVideoShotSegments = defaultVideoAssetId
		? options.videoShotSegments?.[defaultVideoAssetId]
		: undefined;
	const defaultImageAssetId =
		typeof options.defaultImageAssetId === "string" &&
		availableAssetIds.has(options.defaultImageAssetId)
			? options.defaultImageAssetId
			: undefined;
	const supportingImageAssetIds = (options.supportingImageAssetIds ?? []).filter((assetId) =>
		availableAssetIds.has(assetId),
	);
	if (!isRecord(value)) warnings.push("The plan was not a JSON object.");

	const rawScenes = Array.isArray(root.scenes) ? root.scenes : [];
	if (!Array.isArray(root.scenes)) warnings.push("The plan contained no scene list.");
	if (rawScenes.length > MOTION_LIMITS.maxScenes) {
		warnings.push(
			`Kept the first ${MOTION_LIMITS.maxScenes} of ${rawScenes.length} proposed scenes.`,
		);
	}

	const scenes: MotionScene[] = [];
	let totalSeconds = 0;
	let previousBackdrop: string | undefined;

	for (const [index, candidate] of rawScenes.slice(0, MOTION_LIMITS.maxScenes).entries()) {
		if (!isRecord(candidate)) {
			warnings.push(`Dropped scene ${index + 1}: it was not an object.`);
			continue;
		}
		if (totalSeconds >= MOTION_LIMITS.maxTotalSeconds) {
			warnings.push(`Stopped at ${MOTION_LIMITS.maxTotalSeconds}s of video.`);
			break;
		}

		const durationSeconds = clampSeconds(candidate.durationSeconds, 4);
		const requestedKind =
			candidate.kind === "text"
				? "text"
				: candidate.kind === "layered"
					? "layered"
					: candidate.kind === "logo"
						? "logo"
						: candidate.kind === "image"
							? "image"
							: candidate.kind === "video"
								? "video"
								: "card";

		if (requestedKind === "layered") {
			const layers = normalizeMotionLayers(
				candidate.layers,
				availableAssetIds,
				availableVideoAssetIds,
				options.videoDurations,
			);
			if (layers.length > 0) {
				const sourceLayer = layers.find((layer) => layer.kind === "video");
				const copyLayers = layers
					.filter((layer) => layer.kind === "text" && layer.text)
					.sort((a, b) => a.zIndex - b.zIndex);
				const sourceDuration = sourceLayer?.assetId
					? options.videoDurations?.[sourceLayer.assetId]
					: undefined;
				const isFullFrameFootage =
					sourceLayer && (sourceLayer.width >= 0.78 || sourceLayer.height >= 0.75);
				if (sourceLayer?.assetId && sourceDuration && copyLayers.length > 0 && isFullFrameFootage) {
					const editorialScene = visualBackedEditorialScene(
						{
							id: `motion-${index + 1}`,
							kind: "card",
							durationSeconds,
							headline: copyLayers[0]?.text,
							subhead: copyLayers
								.slice(1, 3)
								.map((layer) => layer.text)
								.filter((text): text is string => Boolean(text))
								.join("  •  "),
						},
						index,
						sourceLayer.assetId,
						sourceDuration,
						options.videoShotSegments?.[sourceLayer.assetId],
						options.format,
					);
					scenes.push(editorialScene);
					totalSeconds += durationSeconds;
					warnings.push(
						`Reframed layered source footage in scene ${index + 1} so captions do not sit on a dark lower-third.`,
					);
					continue;
				}
				scenes.push({
					id: `motion-${index + 1}`,
					kind: "layered",
					durationSeconds,
					layers,
				});
				totalSeconds += durationSeconds;
				continue;
			}
			warnings.push(
				`Scene ${index + 1} requested layered motion without any valid layers, so it became a card.`,
			);
		}

		if (requestedKind === "logo") {
			const logoAssetId =
				typeof candidate.logoAssetId === "string" && availableAssetIds.has(candidate.logoAssetId)
					? candidate.logoAssetId
					: undefined;
			if (logoAssetId) {
				const tagline = clampText(
					candidate.tagline ?? candidate.text ?? candidate.headline,
					MOTION_LIMITS.headline,
				);
				scenes.push({
					id: `motion-${index + 1}`,
					kind: "logo",
					durationSeconds,
					logoAssetId,
					...(tagline ? { tagline } : {}),
				});
				totalSeconds += durationSeconds;
				continue;
			}
			warnings.push(
				`Scene ${index + 1} requested a logo reveal without a valid supplied image asset, so it became a card.`,
			);
		}

		if (requestedKind === "image") {
			const imageAssetIdCandidate = candidate.imageAssetId ?? candidate.assetId;
			const imageAssetId =
				typeof imageAssetIdCandidate === "string" && availableAssetIds.has(imageAssetIdCandidate)
					? imageAssetIdCandidate
					: undefined;
			if (imageAssetId) {
				const headline = clampText(candidate.headline, MOTION_LIMITS.headline);
				const subhead = clampText(candidate.subhead, MOTION_LIMITS.subhead);
				const eyebrow = clampText(candidate.eyebrow, MOTION_LIMITS.eyebrow);
				const bullets = Array.isArray(candidate.bullets)
					? candidate.bullets
							.map((bullet) => clampText(bullet, MOTION_LIMITS.bullet))
							.filter((bullet): bullet is string => Boolean(bullet))
							.slice(0, MOTION_LIMITS.maxBullets)
					: undefined;
				scenes.push({
					id: `motion-${index + 1}`,
					kind: "image",
					durationSeconds,
					imageAssetId,
					imageMotion: normalizeImageMotion(candidate.imageMotion),
					...(eyebrow ? { eyebrow } : {}),
					...(headline ? { headline } : {}),
					...(subhead ? { subhead } : {}),
					...(bullets?.length ? { bullets } : {}),
				});
				totalSeconds += durationSeconds;
				continue;
			}
			warnings.push(
				`Scene ${index + 1} requested an image without a valid supplied or resolved image asset, so it became a card.`,
			);
		}

		if (requestedKind === "video") {
			const videoAssetIdCandidate = candidate.videoAssetId ?? candidate.assetId;
			const videoAssetId =
				typeof videoAssetIdCandidate === "string" &&
				availableVideoAssetIds.has(videoAssetIdCandidate)
					? videoAssetIdCandidate
					: undefined;
			const sourceDuration = videoAssetId ? options.videoDurations?.[videoAssetId] : undefined;
			const shotSegments = videoAssetId ? options.videoShotSegments?.[videoAssetId] : undefined;
			if (videoAssetId && (!sourceDuration || sourceDuration >= MOTION_LIMITS.minSceneSeconds)) {
				// A missing probe must not turn supplied footage into a text card. The
				// renderer will leave the source untrimmed when this metadata is absent.
				const safeSourceDuration =
					sourceDuration ?? Math.max(durationSeconds, MOTION_LIMITS.minSceneSeconds);
				const requestedStart =
					typeof candidate.sourceStartSeconds === "number" &&
					Number.isFinite(candidate.sourceStartSeconds)
						? candidate.sourceStartSeconds
						: 0;
				const start = Math.min(
					Math.max(0, requestedStart),
					Math.max(0, safeSourceDuration - MOTION_LIMITS.minSceneSeconds),
				);
				const maxSegment = safeSourceDuration - start;
				const requestedSegment =
					typeof candidate.sourceDurationSeconds === "number" &&
					Number.isFinite(candidate.sourceDurationSeconds)
						? candidate.sourceDurationSeconds
						: durationSeconds;
				const segmentDuration = Math.min(
					Math.max(MOTION_LIMITS.minSceneSeconds, requestedSegment),
					maxSegment,
				);
				const snapped = snapVideoRangeToShotBoundaries(
					start,
					segmentDuration,
					safeSourceDuration,
					shotSegments,
				);
				if (snapped.durationSeconds >= MOTION_LIMITS.minSceneSeconds) {
					scenes.push({
						id: `motion-${index + 1}`,
						kind: "video",
						durationSeconds: Math.min(durationSeconds, snapped.durationSeconds),
						videoAssetId,
						sourceStartSeconds: snapped.startSeconds,
						...(sourceDuration ? { sourceDurationSeconds: snapped.durationSeconds } : {}),
						videoMotion: normalizeVideoMotion(candidate.videoMotion),
						...(clampText(candidate.eyebrow, MOTION_LIMITS.eyebrow)
							? { eyebrow: clampText(candidate.eyebrow, MOTION_LIMITS.eyebrow) }
							: {}),
						...(clampText(candidate.headline, MOTION_LIMITS.headline)
							? { headline: clampText(candidate.headline, MOTION_LIMITS.headline) }
							: {}),
						...(clampText(candidate.subhead, MOTION_LIMITS.subhead)
							? { subhead: clampText(candidate.subhead, MOTION_LIMITS.subhead) }
							: {}),
					});
					totalSeconds += Math.min(durationSeconds, snapped.durationSeconds);
					continue;
				}
			}
			warnings.push(
				`Scene ${index + 1} requested a video range that was not valid for the supplied footage, so it became a card.`,
			);
		}

		if (requestedKind === "text") {
			const entry = findTextScene(
				typeof candidate.textScene === "string" ? candidate.textScene : undefined,
			);
			const text = clampText(candidate.text ?? candidate.headline, entry?.maxChars ?? 24);
			if (entry && text) {
				scenes.push({
					id: `motion-${index + 1}`,
					kind: "text",
					durationSeconds,
					textScene: entry.id,
					text,
				});
				totalSeconds += durationSeconds;
				continue;
			}
			warnings.push(
				entry
					? `Scene ${index + 1} had no text for the "${entry.id}" animation, so it became a card.`
					: `Scene ${index + 1} named an unknown typography animation, so it became a card.`,
			);
		}

		// Card scene — the fallback for anything that could not be a text scene.
		let backdropId = findBackdrop(
			typeof candidate.backdrop === "string" ? candidate.backdrop : undefined,
		)?.id;
		if (!backdropId) {
			// A card with no valid backdrop still renders, just flat; pick a safe
			// default rather than leaving it black.
			backdropId = "gradient-drift";
			if (candidate.backdrop !== undefined) {
				warnings.push(`Scene ${index + 1} named an unknown backdrop, so it uses "gradient-drift".`);
			}
		}
		if (backdropId === previousBackdrop) {
			const alternative = BACKDROP_IDS.find((id) => id !== backdropId);
			if (alternative) {
				warnings.push(
					`Scene ${index + 1} repeated the previous backdrop, so it uses "${alternative}".`,
				);
				backdropId = alternative;
			}
		}

		const bullets = Array.isArray(candidate.bullets)
			? candidate.bullets
					.map((bullet) => clampText(bullet, MOTION_LIMITS.bullet))
					.filter((bullet): bullet is string => Boolean(bullet))
					.slice(0, MOTION_LIMITS.maxBullets)
			: undefined;

		const headline = clampText(candidate.headline, MOTION_LIMITS.headline);
		const subhead = clampText(candidate.subhead, MOTION_LIMITS.subhead);
		const eyebrow = clampText(candidate.eyebrow, MOTION_LIMITS.eyebrow);

		if (!headline && !subhead && !bullets?.length) {
			warnings.push(`Dropped scene ${index + 1}: it had no copy to show.`);
			continue;
		}

		scenes.push({
			id: `motion-${index + 1}`,
			kind: "card",
			durationSeconds,
			backdrop: backdropId,
			...(eyebrow ? { eyebrow } : {}),
			...(headline ? { headline } : {}),
			...(subhead ? { subhead } : {}),
			...(bullets?.length ? { bullets } : {}),
		});
		previousBackdrop = backdropId;
		totalSeconds += durationSeconds;
	}

	if (
		options.requireLayeredScene &&
		(creativeSkill.id === "explainer-motion" || creativeSkill.id === "product-update") &&
		defaultVideoAssetId &&
		defaultVideoDuration &&
		defaultVideoDuration >= MOTION_LIMITS.minSceneSeconds
	) {
		let editorialIndex = 0;
		let visualBackedCount = 0;
		for (let index = 0; index < scenes.length; index += 1) {
			const scene = scenes[index];
			if (!scene || (scene.kind !== "text" && scene.kind !== "card")) continue;
			const visualScene = visualBackedEditorialScene(
				scene,
				editorialIndex,
				defaultVideoAssetId,
				defaultVideoDuration,
				defaultVideoShotSegments,
				options.format,
			);
			scenes[index] = visualScene;
			editorialIndex += 1;
			visualBackedCount += 1;
		}
		if (visualBackedCount > 0) {
			warnings.push(
				`Converted ${visualBackedCount} text/card beat${visualBackedCount === 1 ? "" : "s"} into source-footage-led editorial motion.`,
			);
		}
	}

	// A launch film can use a short title beat, but a long run of cards turns
	// supplied footage into decoration. Keep the hook and thesis copy, then
	// move excess middle beats onto real source footage.
	if (
		creativeSkill.id === "product-launch" &&
		defaultVideoAssetId &&
		defaultVideoDuration &&
		defaultVideoDuration >= MOTION_LIMITS.minSceneSeconds
	) {
		let copyBeatCount = 0;
		let visualBeatIndex = scenes.filter(
			(scene) =>
				scene.kind === "video" ||
				scene.kind === "image" ||
				scene.kind === "layered" ||
				scene.kind === "logo",
		).length;
		let convertedCount = 0;
		for (let index = 0; index < scenes.length; index += 1) {
			const scene = scenes[index];
			if (!scene || (scene.kind !== "text" && scene.kind !== "card")) continue;
			if (copyBeatCount < 2) {
				copyBeatCount += 1;
				continue;
			}
			scenes[index] = visualBackedEditorialScene(
				scene,
				visualBeatIndex,
				defaultVideoAssetId,
				defaultVideoDuration,
				defaultVideoShotSegments,
				options.format,
			);
			visualBeatIndex += 1;
			convertedCount += 1;
		}
		if (convertedCount > 0) {
			warnings.push(
				`Moved ${convertedCount} excess launch copy beat${convertedCount === 1 ? "" : "s"} onto distinct source-footage ranges.`,
			);
		}
	}

	if (scenes.length < MOTION_LIMITS.minScenes) {
		warnings.push("The plan had too few usable scenes, so a plain opening card was added.");
		scenes.unshift({
			id: "motion-fallback",
			kind: "card",
			durationSeconds: 4,
			backdrop: "gradient-drift",
			headline: options.fallbackTitle.slice(0, MOTION_LIMITS.headline),
		});
	}

	const requestedRootLogo =
		typeof root.logoAssetId === "string" && availableAssetIds.has(root.logoAssetId)
			? root.logoAssetId
			: undefined;
	const defaultLogoAssetId =
		typeof options.defaultLogoAssetId === "string" &&
		availableAssetIds.has(options.defaultLogoAssetId)
			? options.defaultLogoAssetId
			: undefined;
	const logoAssetId = requestedRootLogo ?? defaultLogoAssetId;
	if (options.requireLogoReveal && logoAssetId && !scenes.some((scene) => scene.kind === "logo")) {
		const logoScene: MotionScene = {
			id: "motion-logo-reveal",
			kind: "logo",
			durationSeconds: 4,
			logoAssetId,
		};
		const lastIndex = scenes.length - 1;
		const lastScene = scenes[lastIndex];
		if (
			lastScene &&
			(scenes.length >= MOTION_LIMITS.maxScenes ||
				totalSeconds + logoScene.durationSeconds > MOTION_LIMITS.maxTotalSeconds)
		) {
			scenes[lastIndex] = logoScene;
			totalSeconds = totalSeconds - lastScene.durationSeconds + logoScene.durationSeconds;
			warnings.push("Added the supplied logo as the closing reveal by replacing the final scene.");
		} else {
			scenes.push(logoScene);
			totalSeconds += logoScene.durationSeconds;
			warnings.push("Added the supplied logo as the closing reveal.");
		}
	}

	// A closing tagline belongs to the brand lockup, not to a second generic
	// title card. Merge the common agent output shape into one logo scene while
	// preserving the overall duration of the approved plan.
	const closingLogoIndex = scenes.findIndex((scene) => scene.kind === "logo");
	const closingLogo = closingLogoIndex >= 0 ? scenes[closingLogoIndex] : undefined;
	const followingScene = closingLogoIndex >= 0 ? scenes[closingLogoIndex + 1] : undefined;
	if (
		closingLogo?.kind === "logo" &&
		closingLogoIndex === scenes.length - 2 &&
		followingScene?.kind === "text" &&
		!closingLogo.tagline
	) {
		const tagline = clampText(
			followingScene.text ?? followingScene.headline,
			MOTION_LIMITS.headline,
		);
		if (tagline) {
			const mergedDuration = Math.min(
				MOTION_LIMITS.maxSceneSeconds,
				closingLogo.durationSeconds + followingScene.durationSeconds,
			);
			closingLogo.tagline = tagline;
			closingLogo.durationSeconds = mergedDuration;
			scenes.splice(closingLogoIndex + 1, 1);
			// Recompute it for the rare case where the per-scene cap truncated the
			// merge; otherwise the total is unchanged.
			totalSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
			warnings.push("Merged the closing tagline into the supplied logo reveal.");
		}
	}

	const defaultVideoSegment = defaultVideoAssetId
		? options.videoShotSegments?.[defaultVideoAssetId]?.find(
				(segment) => segment.endSeconds - segment.startSeconds >= MOTION_LIMITS.minSceneSeconds,
			)
		: undefined;
	if (
		options.requireVideoScene &&
		defaultVideoAssetId &&
		(!defaultVideoDuration || defaultVideoDuration >= MOTION_LIMITS.minSceneSeconds) &&
		!scenes.some(
			(scene) => scene.kind === "video" || scene.layers?.some((layer) => layer.kind === "video"),
		)
	) {
		const videoStart = defaultVideoSegment?.startSeconds ?? 0;
		const availableSegmentDuration = defaultVideoSegment
			? defaultVideoSegment.endSeconds - defaultVideoSegment.startSeconds
			: (defaultVideoDuration ?? 5);
		const videoDuration = Math.min(5, availableSegmentDuration);
		const videoScene: MotionScene = {
			id: "motion-reference-video",
			kind: "video",
			durationSeconds: Math.max(MOTION_LIMITS.minSceneSeconds, videoDuration),
			videoAssetId: defaultVideoAssetId,
			sourceStartSeconds: Math.round(videoStart * 10) / 10,
			...(defaultVideoDuration
				? { sourceDurationSeconds: Math.max(MOTION_LIMITS.minSceneSeconds, videoDuration) }
				: {}),
			videoMotion: "push-in",
		};
		const logoIndex = scenes.findIndex((scene) => scene.kind === "logo");
		const insertAt = logoIndex >= 0 ? logoIndex : Math.min(1, scenes.length);
		if (
			scenes.length < MOTION_LIMITS.maxScenes &&
			totalSeconds + videoScene.durationSeconds <= MOTION_LIMITS.maxTotalSeconds
		) {
			scenes.splice(insertAt, 0, videoScene);
			totalSeconds += videoScene.durationSeconds;
			warnings.push(
				"Added an attached source-video scene so the motion cut preserves product footage.",
			);
		} else {
			const replaceIndex = [...scenes]
				.map((scene, index) => ({ scene, index }))
				.reverse()
				.find(({ scene }) => scene.kind !== "logo")?.index;
			if (replaceIndex !== undefined) {
				const replaced = scenes[replaceIndex];
				scenes[replaceIndex] = videoScene;
				totalSeconds = totalSeconds - (replaced?.durationSeconds ?? 0) + videoScene.durationSeconds;
				warnings.push("Added an attached source-video scene by replacing a non-logo motion scene.");
			}
		}
	}

	if (
		options.requireImageScene &&
		defaultImageAssetId &&
		!scenes.some(
			(scene) =>
				scene.kind === "image" ||
				scene.layers?.some((layer) => layer.kind === "image" || layer.kind === "logo"),
		)
	) {
		const imageScene: MotionScene = {
			id: "motion-reference-image",
			kind: "image",
			durationSeconds: 5,
			imageAssetId: defaultImageAssetId,
			imageMotion: "ken-burns",
		};
		const logoIndex = scenes.findIndex((scene) => scene.kind === "logo");
		const insertAt = logoIndex >= 0 ? logoIndex : scenes.length;
		if (
			scenes.length < MOTION_LIMITS.maxScenes &&
			totalSeconds + imageScene.durationSeconds <= MOTION_LIMITS.maxTotalSeconds
		) {
			scenes.splice(insertAt, 0, imageScene);
			totalSeconds += imageScene.durationSeconds;
			warnings.push("Added a supplied visual scene so the motion cut is not text-only.");
		} else {
			const replaceIndex = [...scenes]
				.map((scene, index) => ({ scene, index }))
				.reverse()
				.find(({ scene }) => scene.kind !== "logo")?.index;
			if (replaceIndex !== undefined) {
				const replaced = scenes[replaceIndex];
				scenes[replaceIndex] = imageScene;
				totalSeconds = totalSeconds - (replaced?.durationSeconds ?? 0) + imageScene.durationSeconds;
				warnings.push("Added a supplied visual scene by replacing a non-logo motion scene.");
			}
		}
	}

	const layeredVideoDuration = defaultVideoAssetId
		? options.videoDurations?.[defaultVideoAssetId]
		: undefined;
	const layeredVideoSegment = defaultVideoAssetId
		? options.videoShotSegments?.[defaultVideoAssetId]?.find(
				(segment) => segment.endSeconds - segment.startSeconds >= MOTION_LIMITS.minSceneSeconds,
			)
		: undefined;
	if (
		options.requireLayeredScene &&
		!scenes.some((scene) => scene.kind === "layered") &&
		(defaultImageAssetId ||
			(defaultVideoAssetId &&
				(!layeredVideoDuration || layeredVideoDuration >= MOTION_LIMITS.minSceneSeconds)))
	) {
		const videoStart = layeredVideoSegment?.startSeconds ?? 0;
		const videoAvailableDuration = layeredVideoSegment
			? layeredVideoSegment.endSeconds - layeredVideoSegment.startSeconds
			: (layeredVideoDuration ?? 0);
		const layeredDuration = Math.max(
			MOTION_LIMITS.minSceneSeconds,
			Math.min(5, videoAvailableDuration || 5),
		);
		const layeredLayers: MotionLayer[] = [
			{
				id: "editorial-panel",
				kind: "shape",
				color: "primary",
				x: 0.04,
				y: 0.07,
				width: 0.92,
				height: 0.82,
				opacity: 0.12,
				rotation: 0,
				zIndex: 0,
				borderRadius: 28,
				motion: "scale-in",
			},
		];
		const collageImageIds = [...new Set(supportingImageAssetIds)].slice(0, 4);
		const useProductCollage = creativeSkill.id === "product-launch" && collageImageIds.length >= 2;
		if (useProductCollage) {
			const tilePositions = [
				{ x: 0.06, y: 0.11, width: 0.25, height: 0.29, rotation: -4 },
				{ x: 0.08, y: 0.48, width: 0.29, height: 0.3, rotation: 3 },
				{ x: 0.68, y: 0.56, width: 0.25, height: 0.24, rotation: -3 },
				{ x: 0.66, y: 0.12, width: 0.27, height: 0.27, rotation: 4 },
			];
			if (
				defaultVideoAssetId &&
				(!layeredVideoDuration || layeredVideoDuration >= MOTION_LIMITS.minSceneSeconds)
			) {
				layeredLayers.push({
					id: "source-footage",
					kind: "video",
					assetId: defaultVideoAssetId,
					x: 0.35,
					y: 0.12,
					width: 0.34,
					height: 0.62,
					opacity: 1,
					rotation: 0,
					zIndex: 1,
					borderRadius: 24,
					fit: "cover",
					motion: "push-in",
					sourceStartSeconds: Math.round(videoStart * 10) / 10,
					...(layeredVideoDuration
						? { sourceDurationSeconds: Math.max(MOTION_LIMITS.minSceneSeconds, layeredDuration) }
						: {}),
				});
			}
			collageImageIds.forEach((assetId, index) => {
				const tile = tilePositions[index] ?? tilePositions[0];
				layeredLayers.push({
					id: `collage-image-${index + 1}`,
					kind: "image",
					assetId,
					x: tile.x,
					y: tile.y,
					width: tile.width,
					height: tile.height,
					opacity: 1,
					rotation: tile.rotation,
					zIndex: 2,
					borderRadius: 20,
					fit: "cover",
					motion: index % 2 === 0 ? "drift" : "scale-in",
				});
			});
		} else if (
			defaultVideoAssetId &&
			(!layeredVideoDuration || layeredVideoDuration >= MOTION_LIMITS.minSceneSeconds)
		) {
			layeredLayers.push({
				id: "source-footage",
				kind: "video",
				assetId: defaultVideoAssetId,
				x: 0.08,
				y: 0.11,
				width: 0.84,
				height: 0.64,
				opacity: 1,
				rotation: 0,
				zIndex: 1,
				borderRadius: 22,
				fit: "cover",
				motion: "push-in",
				sourceStartSeconds: Math.round(videoStart * 10) / 10,
				...(layeredVideoDuration
					? { sourceDurationSeconds: Math.max(MOTION_LIMITS.minSceneSeconds, layeredDuration) }
					: {}),
			});
		} else if (defaultImageAssetId) {
			layeredLayers.push({
				id: "supplied-visual",
				kind: "image",
				assetId: defaultImageAssetId,
				x: 0.08,
				y: 0.11,
				width: 0.84,
				height: 0.64,
				opacity: 1,
				rotation: 0,
				zIndex: 1,
				borderRadius: 22,
				fit: "cover",
				motion: "push-in",
			});
		}
		layeredLayers.push({
			id: "editorial-headline",
			kind: "text",
			text: clampText(root.title, MOTION_LIMITS.headline) ?? options.fallbackTitle,
			color: "text",
			x: 0.08,
			y: 0.79,
			width: 0.84,
			height: 0.14,
			opacity: 1,
			rotation: 0,
			zIndex: useProductCollage ? 4 : 2,
			borderRadius: 0,
			fontSize: 54,
			fontWeight: 700,
			textAlign: "left",
			motion: "rise",
		});
		const layeredScene: MotionScene = {
			id: "motion-layered-proof",
			kind: "layered",
			durationSeconds: layeredDuration,
			motionPreset: creativeSkill.id === "product-launch" ? "collage" : undefined,
			layers: layeredLayers,
		};
		const logoIndex = scenes.findIndex((scene) => scene.kind === "logo");
		const insertAt = logoIndex >= 0 ? logoIndex : Math.min(1, scenes.length);
		if (
			scenes.length < MOTION_LIMITS.maxScenes &&
			totalSeconds + layeredScene.durationSeconds <= MOTION_LIMITS.maxTotalSeconds
		) {
			scenes.splice(insertAt, 0, layeredScene);
			totalSeconds += layeredScene.durationSeconds;
			warnings.push(
				"Added a mixed-media scene so the explainer uses supplied visuals with editorial motion.",
			);
		} else {
			const replaceIndex = [...scenes]
				.map((scene, index) => ({ scene, index }))
				.reverse()
				.find(({ scene }) => scene.kind !== "logo")?.index;
			if (replaceIndex !== undefined) {
				const replaced = scenes[replaceIndex];
				scenes[replaceIndex] = layeredScene;
				totalSeconds =
					totalSeconds - (replaced?.durationSeconds ?? 0) + layeredScene.durationSeconds;
				warnings.push("Added a mixed-media scene by replacing a non-logo motion scene.");
			}
		}
	}

	const editorialScenes =
		creativeSkill.id === "product-launch" ? applyLaunchFilmMetadata(scenes, rawScenes) : scenes;
	if (creativeSkill.id === "product-launch") {
		warnings.push(
			...launchFilmStructureWarnings(editorialScenes, {
				hasVisualAsset: Boolean(defaultImageAssetId || defaultVideoAssetId),
				requireLogo: Boolean(options.requireLogoReveal && logoAssetId),
			}),
		);
		warnings.push(
			...launchFilmReadinessWarnings(editorialScenes, {
				hasVisualAsset: Boolean(defaultImageAssetId || defaultVideoAssetId),
				hasVideoAsset: Boolean(defaultVideoAssetId),
				hasImageAsset: Boolean(defaultImageAssetId),
				requireLogo: Boolean(options.requireLogoReveal && logoAssetId),
				availableAssetIds: [...availableAssetIds],
				availableVideoAssetIds: [...availableVideoAssetIds],
			}),
		);
	}

	const accent =
		typeof root.accent === "string" && (MOTION_ACCENTS as readonly string[]).includes(root.accent)
			? (root.accent as MotionAccent)
			: "indigo";

	return {
		project: {
			creativeSkill: creativeSkill.id,
			title: clampText(root.title, MOTION_LIMITS.title) ?? options.fallbackTitle,
			accent,
			scenes: editorialScenes,
			...(logoAssetId ? { logoAssetId } : {}),
		},
		warnings,
	};
}

export function motionDurationSeconds(project: MotionProject): number {
	return project.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
}
