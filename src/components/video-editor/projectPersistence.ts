import {
	type CaptionStyle,
	type CaptionTrack,
	DEFAULT_CAPTION_STYLE,
	type NarrationTrack,
} from "@/lib/ai/types";
import { normalizeTextAnimation } from "@/lib/annotationTextAnimation";
import { normalizeBlurColor, normalizeBlurType } from "@/lib/blurEffects";
import { normalizeCursorThemeId } from "@/lib/cursor/cursorThemes";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import type { ProjectMedia } from "@/lib/recordingSession";
import { normalizeProjectMedia } from "@/lib/recordingSession";
import { DEFAULT_WALLPAPER, WALLPAPER_PATHS } from "@/lib/wallpaper";
import { ASPECT_RATIOS, type AspectRatio, isPortraitAspectRatio } from "@/utils/aspectRatioUtils";
import {
	DEFAULT_EDITOR_APPEARANCE_SETTINGS,
	DEFAULT_EDITOR_LAYOUT_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
	DEFAULT_GIF_SETTINGS,
	DEFAULT_WEBCAM_SETTINGS,
} from "./editorDefaults";
import {
	type AnnotationRegion,
	type CropRegion,
	clampPlaybackSpeed,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_BLUR_BLOCK_SIZE,
	DEFAULT_BLUR_DATA,
	DEFAULT_BLUR_FREEHAND_POINTS,
	DEFAULT_BLUR_INTENSITY,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_WEBCAM_MIRRORED,
	DEFAULT_WEBCAM_REACTIVE_ZOOM,
	DEFAULT_ZOOM_DEPTH,
	DEFAULT_ZOOM_MOTION_BLUR,
	MAX_BLUR_BLOCK_SIZE,
	MAX_BLUR_INTENSITY,
	MAX_PLAYBACK_SPEED,
	MIN_BLUR_BLOCK_SIZE,
	MIN_BLUR_INTENSITY,
	MIN_PLAYBACK_SPEED,
	type SpeedRegion,
	type TrimRegion,
	type VideoClip,
	type WebcamLayoutPreset,
	type WebcamMaskShape,
	type WebcamPosition,
	type WebcamSizePreset,
	type ZoomRegion,
} from "./types";

const VALID_BLUR_SHAPES = new Set(["rectangle", "oval", "freehand"] as const);

// Old projects persisted machine-specific file:// URLs for bundled wallpapers.
// Match only the known install layouts (packaged resources/[assets/]wallpapers,
// dev public/wallpapers) so a user's own file under some "wallpapers" folder isn't
// silently replaced.
const LEGACY_FILE_WALLPAPER_RE =
	/^file:\/\/.*?\/(?:resources\/(?:assets\/)?|public\/)wallpapers\/(wallpaper\d+\.jpg)$/i;
const CANONICAL_WALLPAPERS = new Set(WALLPAPER_PATHS);

function normalizeWallpaperValue(value: string): string {
	const match = LEGACY_FILE_WALLPAPER_RE.exec(value);
	if (!match) return value;
	const canonical = `/wallpapers/${match[1]}`;
	return CANONICAL_WALLPAPERS.has(canonical) ? canonical : DEFAULT_WALLPAPER;
}

export const PROJECT_VERSION = 2;

export interface ProjectEditorState {
	wallpaper: string;
	shadowIntensity: number;
	showBlur: boolean;
	showTrimWaveform: boolean;
	motionBlurAmount: number;
	borderRadius: number;
	padding: number;
	cropRegion: CropRegion;
	zoomRegions: ZoomRegion[];
	autoZoomEnabled: boolean;
	autoFocusAll: boolean;
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	aspectRatio: AspectRatio;
	webcamLayoutPreset: WebcamLayoutPreset;
	webcamMaskShape: WebcamMaskShape;
	webcamMirrored: boolean;
	webcamReactiveZoom: boolean;
	webcamSizePreset: WebcamSizePreset;
	webcamPosition: WebcamPosition | null;
	exportQuality: ExportQuality;
	exportFormat: ExportFormat;
	encodingMode?: import("@/lib/exporter").EncodingMode;
	pipelineModel?: import("@/lib/exporter").ExportPipelineModel;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
	gifVideoOnly?: boolean;
	cursorTheme: string;
	// Cursor overlay settings
	cursorSmoothing?: number;
	cursorSway?: number;
	cursorStyle?: string;
	showClickRings?: boolean;
	showCursor?: boolean;
	// Local-first production data. These use the editor's existing caption and
	// narration lanes, so agent-created projects stay fully editable after reload.
	captionTrack: CaptionTrack | null;
	captionStyle: CaptionStyle;
	narrationTrack: NarrationTrack | null;
	muteOriginalAudio: boolean;
	backgroundMusic: string;
	backgroundMusicVolume: number;
	animatedBgSpeed: number;
	// Multi-clip
	videoClips: VideoClip[];
	// Isolated intro clip
	introClip: VideoClip | null;
}

export interface EditorProjectData {
	version: number;
	media?: ProjectMedia;
	editor: ProjectEditorState;
	videoPath?: string;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function computeNormalizedWebcamLayoutPreset(
	webcamLayoutPreset: Partial<ProjectEditorState>["webcamLayoutPreset"],
	normalizedAspectRatio: AspectRatio,
): WebcamLayoutPreset {
	switch (webcamLayoutPreset) {
		case "picture-in-picture":
		case "no-webcam":
			return webcamLayoutPreset;
		case "vertical-stack":
			return isPortraitAspectRatio(normalizedAspectRatio)
				? webcamLayoutPreset
				: DEFAULT_WEBCAM_SETTINGS.layoutPreset;
		case "dual-frame":
			return isPortraitAspectRatio(normalizedAspectRatio)
				? DEFAULT_WEBCAM_SETTINGS.layoutPreset
				: webcamLayoutPreset;
		default:
			return DEFAULT_WEBCAM_SETTINGS.layoutPreset;
	}
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maximum: number) {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function localAudioPath(value: unknown) {
	if (typeof value !== "string") return undefined;
	const path = value.trim();
	if (!path || path.length > 4_096 || /^(https?|blob|data):/i.test(path)) return undefined;
	return path;
}

function normalizeCaptionTrack(value: unknown): CaptionTrack | null {
	if (!isRecord(value) || !Array.isArray(value.lines)) return null;
	const lines = value.lines.slice(0, 1_500).flatMap((line, index) => {
		if (!isRecord(line)) return [];
		const startMs = isFiniteNumber(line.startMs) ? Math.max(0, Math.round(line.startMs)) : 0;
		const endMs = isFiniteNumber(line.endMs)
			? Math.max(startMs + 1, Math.round(line.endMs))
			: startMs + 1;
		const words = Array.isArray(line.words)
			? line.words.slice(0, 40).flatMap((word) => {
					if (!isRecord(word)) return [];
					const wordText = text(word.text, 160);
					if (!wordText) return [];
					const wordStart = isFiniteNumber(word.startMs)
						? Math.max(startMs, Math.min(endMs - 1, Math.round(word.startMs)))
						: startMs;
					const wordEnd = isFiniteNumber(word.endMs)
						? Math.max(wordStart + 1, Math.min(endMs, Math.round(word.endMs)))
						: endMs;
					return [
						{
							text: wordText,
							startMs: wordStart,
							endMs: wordEnd,
							confidence: isFiniteNumber(word.confidence) ? clamp(word.confidence, 0, 1) : 0.65,
						},
					];
				})
			: [];
		if (!words.length) return [];
		return [
			{
				id: text(line.id, 120) || `caption-line-${index + 1}`,
				startMs,
				endMs,
				words,
			},
		];
	});
	if (!lines.length) return null;
	return {
		id: text(value.id, 120) || "caption-track",
		language: text(value.language, 24) || "en",
		modelId: text(value.modelId, 120) || "local-guide-production",
		createdAt: isFiniteNumber(value.createdAt) ? Math.max(0, Math.round(value.createdAt)) : 0,
		lines,
	};
}

function normalizeNarrationTrack(value: unknown): NarrationTrack | null {
	if (!isRecord(value) || !Array.isArray(value.segments)) return null;
	const segments = value.segments.slice(0, 200).flatMap((segment, index) => {
		if (!isRecord(segment)) return [];
		const narrationText = text(segment.text, 3_000);
		if (!narrationText) return [];
		const startMs = isFiniteNumber(segment.startMs) ? Math.max(0, Math.round(segment.startMs)) : 0;
		const endMs = isFiniteNumber(segment.endMs)
			? Math.max(startMs + 1, Math.round(segment.endMs))
			: startMs + 1;
		return [
			{
				id: text(segment.id, 120) || `narration-${index + 1}`,
				text: narrationText,
				startMs,
				endMs,
				...(localAudioPath(segment.audioPath)
					? { audioPath: localAudioPath(segment.audioPath) }
					: {}),
			},
		];
	});
	if (!segments.length) return null;
	return {
		segments,
		...(text(value.voiceId, 120) ? { voiceId: text(value.voiceId, 120) } : {}),
		...(text(value.language, 24) ? { language: text(value.language, 24) } : {}),
		...(localAudioPath(value.audioPath) ? { audioPath: localAudioPath(value.audioPath) } : {}),
	};
}

function normalizeCaptionStyle(value: unknown): CaptionStyle {
	const style = isRecord(value) ? value : {};
	return {
		fontFamily: text(style.fontFamily, 160) || DEFAULT_CAPTION_STYLE.fontFamily,
		fontSize: isFiniteNumber(style.fontSize)
			? clamp(Math.round(style.fontSize), 12, 144)
			: DEFAULT_CAPTION_STYLE.fontSize,
		fontColor: text(style.fontColor, 32) || DEFAULT_CAPTION_STYLE.fontColor,
		backgroundColor: text(style.backgroundColor, 32) || DEFAULT_CAPTION_STYLE.backgroundColor,
		backgroundOpacity: isFiniteNumber(style.backgroundOpacity)
			? clamp(style.backgroundOpacity, 0, 1)
			: DEFAULT_CAPTION_STYLE.backgroundOpacity,
		position:
			style.position === "top" || style.position === "center" || style.position === "bottom"
				? style.position
				: DEFAULT_CAPTION_STYLE.position,
		animation:
			style.animation === "none" ||
			style.animation === "word-highlight" ||
			style.animation === "fade-in"
				? style.animation
				: DEFAULT_CAPTION_STYLE.animation,
		activeWordColor: text(style.activeWordColor, 32) || DEFAULT_CAPTION_STYLE.activeWordColor,
	};
}

function encodePathSegments(pathname: string, keepWindowsDrive = false): string {
	return pathname
		.split("/")
		.map((segment, index) => {
			if (!segment) {
				return segment;
			}
			if (keepWindowsDrive && index === 0 && /^[a-zA-Z]:$/.test(segment)) {
				return segment;
			}
			return encodeURIComponent(segment);
		})
		.join("/");
}

export function toFileUrl(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	if (normalized.match(/^[a-zA-Z]:/)) {
		return `file:///${encodePathSegments(normalized, true)}`;
	}
	if (normalized.startsWith("//")) {
		const withoutPrefix = normalized.slice(2);
		const [host = "", ...segments] = withoutPrefix.split("/");
		return `file://${host}/${encodePathSegments(segments.join("/"))}`;
	}
	const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return `file://${encodePathSegments(absolutePath)}`;
}

export function fromFileUrl(fileUrl: string): string {
	if (!fileUrl.startsWith("file://")) {
		return fileUrl;
	}

	try {
		const url = new URL(fileUrl);
		const pathname = decodeURIComponent(url.pathname);

		if (url.host && url.host !== "localhost") {
			return `//${url.host}${pathname}`;
		}

		if (/^\/[a-zA-Z]:/.test(pathname)) {
			return pathname.slice(1);
		}

		return pathname;
	} catch {
		const fallbackPath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ""));
		return fallbackPath.replace(/^\/([a-zA-Z]:)/, "$1");
	}
}

export function deriveNextId(prefix: string, ids: string[]): number {
	const max = ids.reduce((acc, id) => {
		const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
		if (!match) return acc;
		const value = Number(match[1]);
		return Number.isFinite(value) ? Math.max(acc, value) : acc;
	}, 0);
	return max + 1;
}

export function validateProjectData(candidate: unknown): candidate is EditorProjectData {
	if (!candidate || typeof candidate !== "object") return false;
	const project = candidate as Partial<EditorProjectData>;
	if (typeof project.version !== "number") return false;
	if (!resolveProjectMedia(project)) return false;
	if (!project.editor || typeof project.editor !== "object") return false;
	return true;
}

export function resolveProjectMedia(
	candidate: Partial<EditorProjectData> | { media?: unknown; videoPath?: unknown },
): ProjectMedia | null {
	const media = normalizeProjectMedia(candidate.media);
	if (media) {
		return media;
	}

	if (typeof candidate.videoPath === "string" && candidate.videoPath.trim()) {
		return { screenVideoPath: candidate.videoPath };
	}

	return null;
}

function normalizeClipIntroConfig(raw: unknown): VideoClip["introConfig"] | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;

	// New format: has config object
	if (obj.config && typeof obj.config === "object") {
		return {
			config: obj.config as VideoClip["introConfig"] extends { config?: infer C } ? C : never,
		};
	}

	// Old format: templateId + fieldValues
	if (typeof obj.templateId === "string" && typeof obj.fieldValues === "object") {
		return {
			templateId: obj.templateId,
			fieldValues: obj.fieldValues as Record<string, string>,
		};
	}

	return undefined;
}

/**
 * Repair the first generation of local-production overlays. Those projects
 * stored their x coordinate as a centre point, while editor annotations have
 * always used the top-left corner. The migration is deliberately limited to
 * agent-owned ids so user-positioned annotations are never moved.
 */
function normalizeLegacyAgentAnnotation(region: AnnotationRegion): AnnotationRegion {
	if (
		region.id.startsWith("agent-caption-") &&
		region.position.x === 50 &&
		region.size.width === 84
	) {
		return {
			...region,
			position: { x: 8, y: region.position.y === 86 ? 82 : region.position.y },
			size: { ...region.size, height: region.size.height === 12 ? 16 : region.size.height },
			style: {
				...region.style,
				fontSize: region.style.fontSize === 42 ? 36 : region.style.fontSize,
			},
		};
	}

	if (region.id.startsWith("agent-overlay-") && region.position.x === 50) {
		const deduplicateTitle = (value: string | undefined) => {
			if (!value) return value;
			const lines = value.split("\n");
			return lines.length === 2 && lines[0]?.trim() === lines[1]?.trim() ? lines[0] : value;
		};
		const content = deduplicateTitle(region.content) ?? "";
		const textContent = deduplicateTitle(region.textContent) ?? content;
		const isWideOverlay = region.size.width >= 70;
		const height = isWideOverlay && region.size.height === 18 ? 20 : region.size.height;
		const y =
			isWideOverlay && region.position.y === 50
				? (100 - height) / 2
				: isWideOverlay && region.position.y === 16
					? 12
					: region.position.y;

		return {
			...region,
			content,
			textContent,
			position: { x: (100 - region.size.width) / 2, y },
			size: { ...region.size, height },
			style: {
				...region.style,
				fontSize:
					region.style.fontSize === 52
						? content.length > 42
							? 36
							: 48
						: region.style.fontSize === 34
							? 32
							: region.style.fontSize,
			},
		};
	}

	return region;
}

export function normalizeProjectEditor(editor: Partial<ProjectEditorState>): ProjectEditorState {
	const validAspectRatios = new Set<AspectRatio>(ASPECT_RATIOS);
	const normalizedAspectRatio: AspectRatio = validAspectRatios.has(
		editor.aspectRatio as AspectRatio,
	)
		? (editor.aspectRatio as AspectRatio)
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.aspectRatio;
	const normalizedWebcamLayoutPreset = computeNormalizedWebcamLayoutPreset(
		editor.webcamLayoutPreset,
		normalizedAspectRatio,
	);
	const normalizedWebcamPosition: WebcamPosition | null =
		normalizedWebcamLayoutPreset === "picture-in-picture" &&
		editor.webcamPosition &&
		typeof editor.webcamPosition === "object" &&
		isFiniteNumber((editor.webcamPosition as WebcamPosition).cx) &&
		isFiniteNumber((editor.webcamPosition as WebcamPosition).cy)
			? {
					cx: clamp((editor.webcamPosition as WebcamPosition).cx, 0, 1),
					cy: clamp((editor.webcamPosition as WebcamPosition).cy, 0, 1),
				}
			: DEFAULT_WEBCAM_SETTINGS.position;

	const normalizedZoomRegions: ZoomRegion[] = Array.isArray(editor.zoomRegions)
		? editor.zoomRegions
				.filter((region): region is ZoomRegion => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					const validPreset =
						region.rotationPreset === "iso" ||
						region.rotationPreset === "left" ||
						region.rotationPreset === "right"
							? region.rotationPreset
							: undefined;
					return {
						id: region.id,
						startMs,
						endMs,
						depth: [1, 2, 3, 4, 5, 6].includes(region.depth) ? region.depth : DEFAULT_ZOOM_DEPTH,
						focus: {
							cx: clamp(isFiniteNumber(region.focus?.cx) ? region.focus.cx : 0.5, 0, 1),
							cy: clamp(isFiniteNumber(region.focus?.cy) ? region.focus.cy : 0.5, 0, 1),
						},
						focusMode: region.focusMode === "auto" ? "auto" : "manual",
						source: region.source === "auto" ? "auto" : "manual",
						...(validPreset ? { rotationPreset: validPreset } : {}),
					};
				})
		: [];

	const normalizedTrimRegions: TrimRegion[] = Array.isArray(editor.trimRegions)
		? editor.trimRegions
				.filter((region): region is TrimRegion => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					return {
						id: region.id,
						startMs,
						endMs,
					};
				})
		: [];

	const normalizedSpeedRegions: SpeedRegion[] = Array.isArray(editor.speedRegions)
		? editor.speedRegions
				.filter((region): region is SpeedRegion => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					const speed =
						isFiniteNumber(region.speed) &&
						region.speed >= MIN_PLAYBACK_SPEED &&
						region.speed <= MAX_PLAYBACK_SPEED
							? clampPlaybackSpeed(region.speed)
							: DEFAULT_PLAYBACK_SPEED;

					return {
						id: region.id,
						startMs,
						endMs,
						speed,
					};
				})
		: [];

	const normalizedAnnotationRegions: AnnotationRegion[] = Array.isArray(editor.annotationRegions)
		? editor.annotationRegions
				.filter((region): region is AnnotationRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region, index) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					const blurShape =
						typeof region.blurData?.shape === "string" &&
						VALID_BLUR_SHAPES.has(region.blurData.shape)
							? region.blurData.shape
							: DEFAULT_BLUR_DATA.shape;
					const blurType = normalizeBlurType(region.blurData?.type);
					const blurColor = normalizeBlurColor(region.blurData?.color);

					const normalizedRegion: AnnotationRegion = {
						id: region.id,
						startMs,
						endMs,
						type:
							region.type === "image" || region.type === "figure" || region.type === "blur"
								? region.type
								: "text",
						content: typeof region.content === "string" ? region.content : "",
						textContent: typeof region.textContent === "string" ? region.textContent : undefined,
						imageContent: typeof region.imageContent === "string" ? region.imageContent : undefined,
						annotationSource:
							region.annotationSource === "auto-caption" ? ("auto-caption" as const) : undefined,
						position: {
							x: clamp(
								isFiniteNumber(region.position?.x)
									? region.position.x
									: DEFAULT_ANNOTATION_POSITION.x,
								0,
								100,
							),
							y: clamp(
								isFiniteNumber(region.position?.y)
									? region.position.y
									: DEFAULT_ANNOTATION_POSITION.y,
								0,
								100,
							),
						},
						size: {
							width: clamp(
								isFiniteNumber(region.size?.width)
									? region.size.width
									: DEFAULT_ANNOTATION_SIZE.width,
								1,
								200,
							),
							height: clamp(
								isFiniteNumber(region.size?.height)
									? region.size.height
									: DEFAULT_ANNOTATION_SIZE.height,
								1,
								200,
							),
						},
						style: {
							...DEFAULT_ANNOTATION_STYLE,
							...(region.style && typeof region.style === "object" ? region.style : {}),
							textAnimation: normalizeTextAnimation(region.style?.textAnimation),
						},
						zIndex: isFiniteNumber(region.zIndex) ? region.zIndex : index + 1,
						figureData: region.figureData
							? {
									...DEFAULT_FIGURE_DATA,
									...region.figureData,
								}
							: undefined,
						blurData:
							region.blurData && typeof region.blurData === "object"
								? {
										...DEFAULT_BLUR_DATA,
										...region.blurData,
										type: blurType,
										shape: blurShape,
										color: blurColor,
										intensity: isFiniteNumber(region.blurData.intensity)
											? clamp(region.blurData.intensity, MIN_BLUR_INTENSITY, MAX_BLUR_INTENSITY)
											: DEFAULT_BLUR_INTENSITY,
										blockSize: isFiniteNumber(region.blurData.blockSize)
											? clamp(region.blurData.blockSize, MIN_BLUR_BLOCK_SIZE, MAX_BLUR_BLOCK_SIZE)
											: DEFAULT_BLUR_BLOCK_SIZE,
										freehandPoints: Array.isArray(region.blurData.freehandPoints)
											? region.blurData.freehandPoints
													.filter(
														(
															point,
														): point is {
															x: number;
															y: number;
														} =>
															Boolean(
																point &&
																	isFiniteNumber((point as { x?: unknown }).x) &&
																	isFiniteNumber((point as { y?: unknown }).y),
															),
													)
													.map((point) => ({
														x: clamp(point.x, 0, 100),
														y: clamp(point.y, 0, 100),
													}))
											: DEFAULT_BLUR_FREEHAND_POINTS,
									}
								: undefined,
					};
					return normalizeLegacyAgentAnnotation(normalizedRegion);
				})
		: [];

	const rawCropX = isFiniteNumber(editor.cropRegion?.x)
		? editor.cropRegion.x
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.x;
	const rawCropY = isFiniteNumber(editor.cropRegion?.y)
		? editor.cropRegion.y
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.y;
	const rawCropWidth = isFiniteNumber(editor.cropRegion?.width)
		? editor.cropRegion.width
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.width;
	const rawCropHeight = isFiniteNumber(editor.cropRegion?.height)
		? editor.cropRegion.height
		: DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.height;

	const cropX = clamp(rawCropX, 0, 1);
	const cropY = clamp(rawCropY, 0, 1);
	const cropWidth = clamp(rawCropWidth, 0.01, 1 - cropX);
	const cropHeight = clamp(rawCropHeight, 0.01, 1 - cropY);

	return {
		cursorTheme: normalizeCursorThemeId(editor.cursorTheme),
		wallpaper:
			typeof editor.wallpaper === "string"
				? normalizeWallpaperValue(editor.wallpaper)
				: DEFAULT_EDITOR_LAYOUT_SETTINGS.wallpaper,
		shadowIntensity:
			typeof editor.shadowIntensity === "number"
				? editor.shadowIntensity
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.shadowIntensity,
		showBlur:
			typeof editor.showBlur === "boolean"
				? editor.showBlur
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.showBlur,
		showTrimWaveform:
			typeof editor.showTrimWaveform === "boolean"
				? editor.showTrimWaveform
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.showTrimWaveform,
		motionBlurAmount: isFiniteNumber(editor.motionBlurAmount)
			? clamp(editor.motionBlurAmount, 0, 1)
			: typeof (editor as { motionBlurEnabled?: unknown }).motionBlurEnabled === "boolean"
				? (editor as { motionBlurEnabled?: boolean }).motionBlurEnabled
					? DEFAULT_ZOOM_MOTION_BLUR
					: DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount,
		borderRadius:
			typeof editor.borderRadius === "number"
				? editor.borderRadius
				: DEFAULT_EDITOR_APPEARANCE_SETTINGS.borderRadius,
		padding: isFiniteNumber(editor.padding)
			? clamp(editor.padding, 0, 100)
			: DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
		cropRegion: {
			x: cropX,
			y: cropY,
			width: cropWidth,
			height: cropHeight,
		},
		zoomRegions: normalizedZoomRegions,
		// Default on for legacy projects so re-opens match the new default. The
		// on-load auto-suggest pass is gated separately, so this won't add zooms.
		autoZoomEnabled: typeof editor.autoZoomEnabled === "boolean" ? editor.autoZoomEnabled : true,
		autoFocusAll: typeof editor.autoFocusAll === "boolean" ? editor.autoFocusAll : false,
		trimRegions: normalizedTrimRegions,
		speedRegions: normalizedSpeedRegions,
		annotationRegions: normalizedAnnotationRegions,
		aspectRatio: normalizedAspectRatio,
		webcamLayoutPreset: normalizedWebcamLayoutPreset,
		webcamMaskShape:
			editor.webcamMaskShape === "rectangle" ||
			editor.webcamMaskShape === "circle" ||
			editor.webcamMaskShape === "square" ||
			editor.webcamMaskShape === "rounded"
				? editor.webcamMaskShape
				: DEFAULT_WEBCAM_SETTINGS.maskShape,
		webcamMirrored:
			typeof editor.webcamMirrored === "boolean" ? editor.webcamMirrored : DEFAULT_WEBCAM_MIRRORED,
		webcamReactiveZoom:
			typeof editor.webcamReactiveZoom === "boolean"
				? editor.webcamReactiveZoom
				: DEFAULT_WEBCAM_REACTIVE_ZOOM,
		webcamSizePreset:
			typeof editor.webcamSizePreset === "number" && isFiniteNumber(editor.webcamSizePreset)
				? Math.max(10, Math.min(50, editor.webcamSizePreset))
				: DEFAULT_WEBCAM_SETTINGS.sizePreset,
		webcamPosition: normalizedWebcamPosition,
		exportQuality:
			editor.exportQuality === "medium" || editor.exportQuality === "source"
				? editor.exportQuality
				: DEFAULT_EXPORT_SETTINGS.quality,
		exportFormat: editor.exportFormat === "gif" ? "gif" : DEFAULT_EXPORT_SETTINGS.format,
		encodingMode:
			editor.encodingMode === "fast" ||
			editor.encodingMode === "balanced" ||
			editor.encodingMode === "quality"
				? editor.encodingMode
				: DEFAULT_EXPORT_SETTINGS.encodingMode,
		pipelineModel:
			editor.pipelineModel === "legacy" || editor.pipelineModel === "modern"
				? editor.pipelineModel
				: DEFAULT_EXPORT_SETTINGS.pipelineModel,
		gifFrameRate:
			editor.gifFrameRate === 10 ||
			editor.gifFrameRate === 15 ||
			editor.gifFrameRate === 20 ||
			editor.gifFrameRate === 25 ||
			editor.gifFrameRate === 30
				? editor.gifFrameRate
				: DEFAULT_GIF_SETTINGS.frameRate,
		gifLoop: typeof editor.gifLoop === "boolean" ? editor.gifLoop : DEFAULT_GIF_SETTINGS.loop,
		gifSizePreset:
			editor.gifSizePreset === "small" ||
			editor.gifSizePreset === "medium" ||
			editor.gifSizePreset === "large" ||
			editor.gifSizePreset === "original"
				? editor.gifSizePreset
				: DEFAULT_GIF_SETTINGS.sizePreset,
		gifVideoOnly:
			typeof editor.gifVideoOnly === "boolean"
				? editor.gifVideoOnly
				: DEFAULT_GIF_SETTINGS.videoOnly,
		// Cursor overlay settings
		cursorSmoothing: isFiniteNumber(editor.cursorSmoothing)
			? clamp(editor.cursorSmoothing, 0, 1)
			: 0.5,
		cursorSway: isFiniteNumber(editor.cursorSway) ? clamp(editor.cursorSway, 0, 1) : 0.3,
		cursorStyle:
			typeof editor.cursorStyle === "string" && editor.cursorStyle.length > 0
				? editor.cursorStyle
				: "default",
		showClickRings: typeof editor.showClickRings === "boolean" ? editor.showClickRings : true,
		showCursor: typeof editor.showCursor === "boolean" ? editor.showCursor : true,
		captionTrack: normalizeCaptionTrack(editor.captionTrack),
		captionStyle: normalizeCaptionStyle(editor.captionStyle),
		narrationTrack: normalizeNarrationTrack(editor.narrationTrack),
		muteOriginalAudio:
			typeof editor.muteOriginalAudio === "boolean" ? editor.muteOriginalAudio : false,
		backgroundMusic: localAudioPath(editor.backgroundMusic) ?? "none",
		backgroundMusicVolume: isFiniteNumber(editor.backgroundMusicVolume)
			? clamp(Math.round(editor.backgroundMusicVolume), 0, 100)
			: 50,
		animatedBgSpeed: isFiniteNumber(editor.animatedBgSpeed)
			? clamp(editor.animatedBgSpeed, 0.1, 4)
			: 1,
		// Multi-clip
		videoClips: (() => {
			const clips = Array.isArray(editor.videoClips)
				? editor.videoClips
						.filter((clip): clip is VideoClip => Boolean(clip && typeof clip.id === "string"))
						.map((clip) => ({
							id: clip.id,
							sourceVideoPath: typeof clip.sourceVideoPath === "string" ? clip.sourceVideoPath : "",
							startMs: Math.max(0, isFiniteNumber(clip.startMs) ? Math.round(clip.startMs) : 0),
							endMs: isFiniteNumber(clip.endMs) ? Math.round(clip.endMs) : 0,
							offsetMs: Math.max(0, isFiniteNumber(clip.offsetMs) ? Math.round(clip.offsetMs) : 0),
							durationMs: Math.max(
								1,
								isFiniteNumber(clip.durationMs) ? Math.round(clip.durationMs) : 1000,
							),
							label: typeof clip.label === "string" ? clip.label : undefined,
							sourceType:
								clip.sourceType === "recording" ||
								clip.sourceType === "imported" ||
								clip.sourceType === "intro"
									? clip.sourceType
									: undefined,
							introConfig: normalizeClipIntroConfig(clip.introConfig),
						}))
				: [];
			// Migration: remove intro clips from videoClips (they belong in introClip now)
			return clips.filter((c) => c.sourceType !== "intro");
		})(),
		// Isolated intro clip
		introClip: (() => {
			// Prefer the dedicated introClip field
			const raw = editor.introClip as VideoClip | undefined;
			if (raw && typeof raw === "object" && typeof raw.id === "string") {
				return {
					id: raw.id,
					sourceVideoPath: typeof raw.sourceVideoPath === "string" ? raw.sourceVideoPath : "",
					startMs: Math.max(0, isFiniteNumber(raw.startMs) ? Math.round(raw.startMs) : 0),
					endMs: isFiniteNumber(raw.endMs) ? Math.round(raw.endMs) : 0,
					offsetMs: 0,
					durationMs: Math.max(
						1,
						isFiniteNumber(raw.durationMs) ? Math.round(raw.durationMs) : 1000,
					),
					label: typeof raw.label === "string" ? raw.label : "Intro",
					sourceType: "intro" as const,
					introConfig: normalizeClipIntroConfig(raw.introConfig),
				};
			}
			// Migration: extract intro from legacy videoClips array
			if (Array.isArray(editor.videoClips)) {
				const legacy = editor.videoClips.find((c): c is VideoClip =>
					Boolean(c && typeof c === "object" && (c as VideoClip).sourceType === "intro"),
				);
				if (legacy) {
					return {
						id: legacy.id,
						sourceVideoPath:
							typeof legacy.sourceVideoPath === "string" ? legacy.sourceVideoPath : "",
						startMs: Math.max(0, isFiniteNumber(legacy.startMs) ? Math.round(legacy.startMs) : 0),
						endMs: isFiniteNumber(legacy.endMs) ? Math.round(legacy.endMs) : 0,
						offsetMs: 0,
						durationMs: Math.max(
							1,
							isFiniteNumber(legacy.durationMs) ? Math.round(legacy.durationMs) : 1000,
						),
						label: typeof legacy.label === "string" ? legacy.label : "Intro",
						sourceType: "intro" as const,
						introConfig: normalizeClipIntroConfig(legacy.introConfig),
					};
				}
			}
			return null;
		})(),
	};
}

export function createProjectData(
	media: ProjectMedia,
	editor: ProjectEditorState,
): EditorProjectData {
	return {
		version: PROJECT_VERSION,
		media,
		editor,
	};
}

export function createProjectSnapshot(
	media: ProjectMedia,
	editor: Partial<ProjectEditorState>,
): string {
	return JSON.stringify(createProjectData(media, normalizeProjectEditor(editor)));
}

export function hasProjectUnsavedChanges(
	currentSnapshot: string | null,
	baselineSnapshot: string | null,
): boolean {
	return Boolean(
		currentSnapshot !== null && baselineSnapshot !== null && currentSnapshot !== baselineSnapshot,
	);
}
