import type { WebcamLayoutPreset } from "@/lib/compositeLayout";
import type { IntroConfig } from "@/lib/intro/introTypes";

export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;
export type ZoomFocusMode = "manual" | "auto";
export type { WebcamLayoutPreset };
/** Webcam size as a percentage of the canvas reference dimension (10-50). */
export type WebcamSizePreset = number;

export const DEFAULT_WEBCAM_SIZE_PRESET: WebcamSizePreset = 25;

export const DEFAULT_WEBCAM_LAYOUT_PRESET: WebcamLayoutPreset = "picture-in-picture";

export type WebcamMaskShape = "rectangle" | "circle" | "square" | "rounded";

export const DEFAULT_WEBCAM_MASK_SHAPE: WebcamMaskShape = "rectangle";

export const DEFAULT_WEBCAM_MIRRORED = false;

/** When true, the picture-in-picture webcam scales inversely with zoom (shrinks as you zoom in). */
export const DEFAULT_WEBCAM_REACTIVE_ZOOM = true;

export interface WebcamPosition {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export const DEFAULT_WEBCAM_POSITION: WebcamPosition | null = null;

export interface ZoomFocus {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export interface Rotation3D {
	rotationX: number;
	rotationY: number;
	rotationZ: number;
}

export const DEFAULT_ROTATION_3D: Rotation3D = {
	rotationX: 0,
	rotationY: 0,
	rotationZ: 0,
};

export type Rotation3DPreset = "iso" | "left" | "right";

export const ROTATION_3D_PRESETS: Record<Rotation3DPreset, Rotation3D> = {
	iso: { rotationX: -10, rotationY: -16, rotationZ: 0 },
	left: { rotationX: 0, rotationY: -22, rotationZ: 0 },
	right: { rotationX: 0, rotationY: 22, rotationZ: 0 },
};

export const ROTATION_3D_PRESET_ORDER: Rotation3DPreset[] = ["iso", "left", "right"];

/** Perspective distance in CSS px is this factor times min(viewport w, h). Same
 * factor in preview and export so the look matches at any canvas resolution. */
export const ROTATION_3D_PERSPECTIVE_FACTOR = 2.6;

export function rotation3DPerspective(width: number, height: number): number {
	return Math.min(width, height) * ROTATION_3D_PERSPECTIVE_FACTOR;
}

/**
 * Origin of a zoom region. "auto" marks zooms from the magic-wand suggest pass;
 * toggling the wand off removes only these. Editing an auto zoom promotes it to
 * "manual" so it survives. Undefined is treated as "manual" for back-compat.
 */
export type ZoomRegionSource = "auto" | "manual";

export type ZoomMode = "auto" | "manual";

export interface ZoomRegion {
	id: string;
	startMs: number;
	endMs: number;
	depth: ZoomDepth;
	focus: ZoomFocus;
	focusMode?: ZoomFocusMode;
	mode?: ZoomMode;
	rotationPreset?: Rotation3DPreset;
	/** Custom scale overriding the preset depth (1.0-5.0, two decimal precision). */
	customScale?: number;
	source?: ZoomRegionSource;
}

export function getRotation3D(region: Pick<ZoomRegion, "rotationPreset">): Rotation3D {
	if (!region.rotationPreset) return DEFAULT_ROTATION_3D;
	return ROTATION_3D_PRESETS[region.rotationPreset];
}

export function isRotation3DIdentity(r: Rotation3D, eps = 0.01): boolean {
	return Math.abs(r.rotationX) < eps && Math.abs(r.rotationY) < eps && Math.abs(r.rotationZ) < eps;
}

export function lerpRotation3D(a: Rotation3D, b: Rotation3D, t: number): Rotation3D {
	return {
		rotationX: a.rotationX + (b.rotationX - a.rotationX) * t,
		rotationY: a.rotationY + (b.rotationY - a.rotationY) * t,
		rotationZ: a.rotationZ + (b.rotationZ - a.rotationZ) * t,
	};
}

/**
 * Max uniform scale that, with `rot` and a perspective of `perspective` CSS px, keeps
 * the projected bounding box of a width x height element inside its original rectangle.
 * Returns 1 when no scaling is needed. Projects each rotated corner (x' = x*P/(P-z)) and
 * returns the limiting half-extent ratio so the rotated recording stays inside the zoom window.
 */
export function computeRotation3DContainScale(
	rot: Rotation3D,
	width: number,
	height: number,
	perspective: number,
): number {
	const a = (rot.rotationX * Math.PI) / 180;
	const b = (rot.rotationY * Math.PI) / 180;
	const g = (rot.rotationZ * Math.PI) / 180;
	const ca = Math.cos(a);
	const sa = Math.sin(a);
	const cb = Math.cos(b);
	const sb = Math.sin(b);
	const cg = Math.cos(g);
	const sg = Math.sin(g);
	const halfW = width / 2;
	const halfH = height / 2;
	const corners: Array<[number, number]> = [
		[-halfW, -halfH],
		[halfW, -halfH],
		[halfW, halfH],
		[-halfW, halfH],
	];

	let maxAbsX = 0;
	let maxAbsY = 0;

	for (const [x0, y0] of corners) {
		// CSS "rotateX rotateY rotateZ" applies right-to-left: Z first, then Y, then X.
		let px = x0;
		let py = y0;
		let pz = 0;

		// rotateZ
		const zx = px * cg - py * sg;
		const zy = px * sg + py * cg;
		px = zx;
		py = zy;

		// rotateY
		const yx = px * cb + pz * sb;
		const yz = -px * sb + pz * cb;
		px = yx;
		pz = yz;

		// rotateX
		const xy = py * ca - pz * sa;
		const xz = py * sa + pz * ca;
		py = xy;
		pz = xz;

		// Viewer at (0, 0, P) looking toward -z; a point at z=pz scales by P/(P-pz).
		// perspective <= 0 means orthographic.
		if (perspective > 0) {
			const denom = perspective - pz;
			if (denom <= 0) return 1; // pathological, skip scaling rather than crash
			const f = perspective / denom;
			px *= f;
			py *= f;
		}

		if (Math.abs(px) > maxAbsX) maxAbsX = Math.abs(px);
		if (Math.abs(py) > maxAbsY) maxAbsY = Math.abs(py);
	}

	if (maxAbsX === 0 || maxAbsY === 0) return 1;
	const sx = halfW / maxAbsX;
	const sy = halfH / maxAbsY;
	return Math.min(sx, sy, 1);
}

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	clickType?: "left" | "right" | "double" | "middle";
	interactionType?: "move" | "click" | "double-click" | "right-click" | "middle-click" | "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

export interface CursorVisualSettings {
	size: number;
	smoothing: number;
	motionBlur: number;
	clickBounce: number;
	clipToBounds: boolean;
}

export const DEFAULT_CURSOR_SIZE = 3.0;
export const DEFAULT_CURSOR_SMOOTHING = 0.67;
export const DEFAULT_CURSOR_MOTION_BLUR = 0.35;
export const DEFAULT_CURSOR_CLICK_BOUNCE = 2.5;
// false lets the cursor overflow into the background; true clips it to the canvas bounds.
export const DEFAULT_CURSOR_CLIP_TO_BOUNDS = false;
export const DEFAULT_ZOOM_MOTION_BLUR = 0.35;

export interface TrimRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export type AnnotationType = "text" | "image" | "figure" | "blur";

export type ArrowDirection =
	| "up"
	| "down"
	| "left"
	| "right"
	| "up-right"
	| "up-left"
	| "down-right"
	| "down-left";

export interface FigureData {
	arrowDirection: ArrowDirection;
	color: string;
	strokeWidth: number;
}

export type BlurShape = "rectangle" | "oval" | "freehand";
export type BlurType = "blur" | "mosaic";
export type BlurColor = "white" | "black";

export const MIN_BLUR_INTENSITY = 2;
export const MAX_BLUR_INTENSITY = 40;
export const DEFAULT_BLUR_INTENSITY = 12;
export const MIN_BLUR_BLOCK_SIZE = 4;
export const MAX_BLUR_BLOCK_SIZE = 48;
export const DEFAULT_BLUR_BLOCK_SIZE = 12;

export interface BlurData {
	type: BlurType;
	shape: BlurShape;
	color: BlurColor;
	intensity: number;
	blockSize: number;
	// Points are normalized (0-100) within the annotation bounds.
	freehandPoints?: Array<{ x: number; y: number }>;
}

export interface AnnotationPosition {
	x: number;
	y: number;
}

export interface AnnotationSize {
	width: number;
	height: number;
}

export type AnnotationTextAnimation =
	| "none"
	| "fade"
	| "rise"
	| "pop"
	| "slide-left"
	| "typewriter"
	| "pulse";

export interface AnnotationTextStyle {
	color: string;
	backgroundColor: string;
	fontSize: number; // pixels
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline";
	textAlign: "left" | "center" | "right";
	textAnimation?: AnnotationTextAnimation;
	borderRadius?: number;
}

export interface AnnotationRegion {
	id: string;
	startMs: number;
	endMs: number;
	type: AnnotationType;
	content: string; // Legacy - still used for current type
	textContent?: string; // Separate storage for text
	imageContent?: string; // Separate storage for image data URL
	position: AnnotationPosition;
	size: AnnotationSize;
	style: AnnotationTextStyle;
	zIndex: number;
	/** When set, layout/style edits on one region can sync to all auto-caption siblings. */
	annotationSource?: "auto-caption";
	trackIndex?: number;
	figureData?: FigureData;
	blurData?: BlurData;
	blurIntensity?: number;
	blurColor?: string;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
	x: 50,
	y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
	width: 30,
	height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
	color: "#ffffff",
	backgroundColor: "transparent",
	fontSize: 32,
	fontFamily: "Inter",
	fontWeight: "bold",
	fontStyle: "normal",
	textDecoration: "none",
	textAlign: "center",
	textAnimation: "none",
};

export const DEFAULT_FIGURE_DATA: FigureData = {
	arrowDirection: "right",
	color: "#F59E0B",
	strokeWidth: 4,
};

export const DEFAULT_BLUR_FREEHAND_POINTS: Array<{ x: number; y: number }> = [
	{ x: 10, y: 30 },
	{ x: 25, y: 10 },
	{ x: 55, y: 8 },
	{ x: 82, y: 20 },
	{ x: 90, y: 45 },
	{ x: 78, y: 72 },
	{ x: 52, y: 90 },
	{ x: 22, y: 84 },
	{ x: 8, y: 58 },
];

export const DEFAULT_BLUR_DATA: BlurData = {
	type: "mosaic",
	shape: "rectangle",
	color: "white",
	intensity: DEFAULT_BLUR_INTENSITY,
	blockSize: DEFAULT_BLUR_BLOCK_SIZE,
	freehandPoints: DEFAULT_BLUR_FREEHAND_POINTS,
};

export interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_CROP_REGION: CropRegion = {
	x: 0,
	y: 0,
	width: 1,
	height: 1,
};

export type PlaybackSpeed = number;

export const MIN_PLAYBACK_SPEED = 0.1;
// Above 16x the decoder can't keep up and the playhead stalls during preview.
export const MAX_PLAYBACK_SPEED = 16;

export function clampPlaybackSpeed(speed: number): PlaybackSpeed {
	return Math.round(Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed)) * 100) / 100;
}

export interface SpeedRegion {
	id: string;
	startMs: number;
	endMs: number;
	speed: PlaybackSpeed;
}

export interface VideoClip {
	id: string;
	sourceVideoPath: string;
	startMs: number; // trim in-point within the source
	endMs: number; // trim out-point within the source
	offsetMs: number; // position on the master timeline
	durationMs: number; // effective duration on master timeline
	label?: string;
	sourceType?: "recording" | "imported" | "intro";
	introConfig?: {
		templateId?: string;
		fieldValues?: Record<string, string>;
		config?: IntroConfig;
	};
}

export const SPEED_OPTIONS: Array<{ speed: PlaybackSpeed; label: string }> = [
	{ speed: 0.25, label: "0.25×" },
	{ speed: 0.5, label: "0.5×" },
	{ speed: 0.75, label: "0.75×" },
	{ speed: 1.25, label: "1.25×" },
	{ speed: 1.5, label: "1.5×" },
	{ speed: 1.75, label: "1.75×" },
	{ speed: 2, label: "2×" },
	{ speed: 3, label: "3×" },
	{ speed: 4, label: "4×" },
	{ speed: 5, label: "5×" },
];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1.5;

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5.0,
};

export const MIN_ZOOM_SCALE = 1.0;
export const MAX_ZOOM_SCALE = 5.0;

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;

/** Returns the effective zoom scale for a region, preferring customScale over the preset. */
export function getZoomScale(region: ZoomRegion): number {
	if (region.customScale != null) {
		const clamped = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, region.customScale));
		if (Number.isFinite(clamped)) return clamped;
	}
	return ZOOM_DEPTH_SCALES[region.depth];
}

export function clampFocusToDepth(focus: ZoomFocus, _depth: ZoomDepth): ZoomFocus {
	return {
		cx: clamp(focus.cx, 0, 1),
		cy: clamp(focus.cy, 0, 1),
	};
}

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return (min + max) / 2;
	return Math.min(max, Math.max(min, value));
}

// ─── Types needed by the Recordly export pipeline ───

export type CursorStyle = "macos" | "tahoe" | "tahoe-inverted" | "dot" | "figma" | (string & {});
export const DEFAULT_CURSOR_STYLE: CursorStyle = "tahoe";

export type CursorClickEffectStyle = "none" | "spotlight" | "ripple" | "echo";
export const DEFAULT_CURSOR_CLICK_EFFECT: CursorClickEffectStyle = "none";
export const DEFAULT_CURSOR_CLICK_EFFECT_COLOR = "#2563EB";
export const DEFAULT_CURSOR_CLICK_EFFECT_SCALE = 1;
export const DEFAULT_CURSOR_CLICK_EFFECT_OPACITY = 1;
export const DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS = 600;
export const DEFAULT_CURSOR_CLICK_BOUNCE_DURATION = 350;
export const DEFAULT_CURSOR_SWAY = 0.4;
export const DEFAULT_ZOOM_SMOOTHNESS = 0.5;

export function normalizeCursorClickEffectColor(
	value: unknown,
	fallback: string = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return fallback;
	if (trimmed.length === 4) {
		const [r, g, b] = trimmed.slice(1).split("");
		return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}
	return trimmed.toUpperCase();
}

export type ZoomTransitionEasing = "recordly" | "glide" | "smooth" | "snappy" | "linear";

export const DEFAULT_ZOOM_IN_DURATION_MS = 1522.575;
export const DEFAULT_ZOOM_IN_OVERLAP_MS = 500;
export const DEFAULT_ZOOM_OUT_DURATION_MS = 1015.05;
export const DEFAULT_CONNECTED_ZOOM_GAP_MS = 1500;
export const DEFAULT_CONNECTED_ZOOM_DURATION_MS = 1000;
export const DEFAULT_ZOOM_IN_EASING: ZoomTransitionEasing = "recordly";
export const DEFAULT_ZOOM_OUT_EASING: ZoomTransitionEasing = "recordly";
export const DEFAULT_CONNECTED_ZOOM_EASING: ZoomTransitionEasing = "glide";

export interface ZoomMotionBlurTuning {
	panVelocityThreshold: number;
	zoomVelocityThreshold: number;
	maxDirectionalBlurPx: number;
	maxRadialBlurStrength: number;
	panResponsePerSecond: number;
	zoomResponsePerSecond: number;
	zoomSafeZoneRadiusPx: number;
}

export const DEFAULT_ZOOM_MOTION_BLUR_TUNING: ZoomMotionBlurTuning = {
	panVelocityThreshold: 0,
	zoomVelocityThreshold: 0,
	maxDirectionalBlurPx: 41.8,
	maxRadialBlurStrength: 1,
	panResponsePerSecond: 11,
	zoomResponsePerSecond: 9,
	zoomSafeZoneRadiusPx: 6,
};

export type WebcamCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WebcamPositionPreset =
	| WebcamCorner
	| "top-center"
	| "center-left"
	| "center"
	| "center-right"
	| "bottom-center"
	| "custom";

export interface WebcamOverlaySettings {
	enabled: boolean;
	sourcePath: string | null;
	timeOffsetMs: number;
	mirror: boolean;
	cropRegion: CropRegion;
	corner: WebcamCorner;
	positionPreset: WebcamPositionPreset;
	positionX: number;
	positionY: number;
	size: number;
	width: number;
	height: number;
	reactToZoom: boolean;
	cornerRadius: number;
	shadow: number;
	margin: number;
}

export const DEFAULT_WEBCAM_SIZE = 40;
export const DEFAULT_WEBCAM_REACT_TO_ZOOM = true;
export const DEFAULT_WEBCAM_CORNER_RADIUS = 90;
export const DEFAULT_WEBCAM_SHADOW = 0.67;
export const DEFAULT_WEBCAM_MARGIN = 24;
export const DEFAULT_WEBCAM_POSITION_PRESET: WebcamPositionPreset = "bottom-right";

export const DEFAULT_WEBCAM_OVERLAY: WebcamOverlaySettings = {
	enabled: false,
	sourcePath: null,
	timeOffsetMs: 0,
	mirror: true,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	corner: "bottom-right",
	positionPreset: DEFAULT_WEBCAM_POSITION_PRESET,
	positionX: 1,
	positionY: 1,
	size: DEFAULT_WEBCAM_SIZE,
	width: DEFAULT_WEBCAM_SIZE,
	height: DEFAULT_WEBCAM_SIZE,
	reactToZoom: DEFAULT_WEBCAM_REACT_TO_ZOOM,
	cornerRadius: DEFAULT_WEBCAM_CORNER_RADIUS,
	shadow: DEFAULT_WEBCAM_SHADOW,
	margin: DEFAULT_WEBCAM_MARGIN,
};

export const BLUR_ANNOTATION_STRENGTH = 20;
export const BASE_PREVIEW_WIDTH = 1920;
export const BASE_PREVIEW_HEIGHT = 1080;

export const ADVANCED_VERTICAL_PADDING_MAX = 250;

export interface Padding {
	top: number;
	bottom: number;
	left: number;
	right: number;
	linked?: boolean;
}

export const DEFAULT_PADDING: Padding = {
	top: 20,
	bottom: 20,
	left: 20,
	right: 20,
	linked: true,
};

export function getDefaultCaptionFontFamily() {
	return '"SF Pro Text", "SF Pro Display", Helvetica, sans-serif';
}

export interface ClipRegion {
	id: string;
	startMs: number;
	endMs: number;
	speed: number;
	muted?: boolean;
	showSourceAudio?: boolean;
}

export function getClipSourceEndMs(clip: ClipRegion): number {
	const displayDurationMs = Math.max(0, clip.endMs - clip.startMs);
	const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	return Math.round(clip.startMs + displayDurationMs * speed);
}

export function getTimelineDurationMs(clips: ClipRegion[], sourceDurationMs: number): number {
	const baseDurationMs = Math.max(0, Math.round(sourceDurationMs));
	if (clips.length === 0) return baseDurationMs;
	return clips.reduce(
		(durationMs, clip) => Math.max(durationMs, Math.max(0, Math.round(clip.endMs))),
		baseDurationMs,
	);
}

export function sortClipRegions(clips: ClipRegion[]): ClipRegion[] {
	return [...clips].sort((left, right) => left.startMs - right.startMs);
}

function getSafeClipSpeed(clip: ClipRegion) {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

export function mapTimelineTimeToSourceTime(timeMs: number, clips: ClipRegion[]): number {
	const roundedTimeMs = Math.round(timeMs);
	const sortedClips = sortClipRegions(clips);
	for (const clip of sortedClips) {
		if (roundedTimeMs < clip.startMs || roundedTimeMs > clip.endMs) continue;
		return Math.round(clip.startMs + (roundedTimeMs - clip.startMs) * getSafeClipSpeed(clip));
	}
	if (sortedClips.length === 0) return roundedTimeMs;
	return roundedTimeMs;
}

export function mapSourceTimeToTimelineTime(timeMs: number, clips: ClipRegion[]): number {
	const roundedTimeMs = Math.round(timeMs);
	const sortedClips = sortClipRegions(clips);
	for (const clip of sortedClips) {
		const sourceEndMs = getClipSourceEndMs(clip);
		if (roundedTimeMs < clip.startMs || roundedTimeMs > sourceEndMs) continue;
		return Math.round(clip.startMs + (roundedTimeMs - clip.startMs) / getSafeClipSpeed(clip));
	}
	if (sortedClips.length === 0) return roundedTimeMs;
	return roundedTimeMs;
}

export interface AudioRegion {
	id: string;
	startMs: number;
	endMs: number;
	audioPath: string;
	volume: number;
	normalize?: boolean;
	trackIndex?: number;
}

export interface CaptionCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: CaptionCueWord[];
}

export interface CaptionCueWord {
	text: string;
	startMs: number;
	endMs: number;
	leadingSpace?: boolean;
}

export type AutoCaptionAnimation = "none" | "fade" | "rise" | "pop";

export interface AutoCaptionSettings {
	enabled: boolean;
	language: string;
	fontFamily: string;
	fontSize: number;
	bottomOffset: number;
	maxWidth: number;
	maxRows: number;
	animationStyle: AutoCaptionAnimation;
	boxRadius: number;
	textColor: string;
	inactiveTextColor: string;
	backgroundOpacity: number;
}

export const DEFAULT_AUTO_CAPTION_SETTINGS: AutoCaptionSettings = {
	enabled: false,
	language: "auto",
	fontFamily: getDefaultCaptionFontFamily(),
	fontSize: 30,
	bottomOffset: 3,
	maxWidth: 62,
	maxRows: 1,
	animationStyle: "fade",
	boxRadius: 17.5,
	textColor: "#FFFFFF",
	inactiveTextColor: "#A3A3A3",
	backgroundOpacity: 0.9,
};

export type { SourceAudioTrackSettings } from "@/components/video-editor/audio/audioTypes";
export { type SourceAudioTrackSetting } from "@/components/video-editor/audio/audioTypes";
