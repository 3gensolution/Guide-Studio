/**
 * Video Guide — turns detected guide steps into a produced video, in one
 * of two presentation styles:
 *
 * - "tutorial" (Guidde-style): each detected click is highlighted — a
 *   circle ring around the click with an arrow pointing at it (plus
 *   animated click rings) — with per-step zooms, and the voiceover is an
 *   instructional second-person walkthrough.
 * - "loom" (Loom-style): the screen stays natural — no arrows or zooms by
 *   default — and the voiceover reads like a real person talking a
 *   teammate through their screen in a quick async video: casual
 *   first-person opener, conversational lines, friendly sign-off.
 *
 * In both styles, long idle stretches (loading, dead time) between
 * interactions are trimmed, and the narration is one continuous story —
 * never "step 1 / step 2". Produces a Partial<EditorState> so the whole
 * pass applies as one undoable edit; regenerating replaces the previous
 * pass instead of stacking on top of it.
 *
 * Voiceover is the only stage that needs the backend account (chat + TTS,
 * same route as Auto-Polish); everything else runs locally. Like
 * Auto-Polish, a failed voiceover degrades to a warning — the visual pass
 * still applies.
 */
import type {
	AnnotationRegion,
	TrimRegion,
	ZoomDepth,
	ZoomRegion,
} from "@/components/video-editor/types";
import {
	clampFocusToDepth,
	DEFAULT_ANNOTATION_STYLE,
	ZOOM_DEPTH_SCALES,
} from "@/components/video-editor/types";
import type { EditorState } from "@/hooks/useEditorHistory";
import { aiService, type ChatMessage } from "@/lib/api/ai";
import { apiClient } from "@/lib/api/client";
import { parseNarrationLines } from "./autoPolish";
import { VOICE_OPTIONS } from "./polishTemplates";
import type { CaptionTrack, GuideStep, NarrationSegment, NarrationTrack } from "./types";

/** Everything this pass creates carries this id prefix so a rerun can find and replace it */
const GUIDE_ID_PREFIX = "vguide";

/** Guide zooms go deeper than the editor default so the click area fills the
 *  view — depth 4 (2.2×) reads as a real close-up where 3 (1.8×) felt distant. */
const GUIDE_ZOOM_DEPTH: ZoomDepth = 4;

/** Zoom begins slightly before the click so the move-in reads as intentional */
const ZOOM_LEAD_IN_MS = 500;
/** Minimum time a step stays zoomed and labeled */
const STEP_MIN_DURATION_MS = 1_600;
/** Maximum hold after the click before the zoom releases */
const STEP_MAX_DURATION_MS = 3_500;
/** Breathing room between consecutive step windows */
const STEP_GAP_MS = 350;
/** Steps whose window collapses below this are skipped (the next step covers them) */
const STEP_SKIP_BELOW_MS = 500;

/** Idle gaps between steps longer than this get trimmed */
const IDLE_TRIM_THRESHOLD_MS = 5_000;
/** Context kept on each side of a trimmed gap */
const IDLE_TRIM_PADDING_MS = 1_500;
const MIN_TRIM_DURATION_MS = 800;

/**
 * How the guide is presented: "tutorial" is the produced Guidde look
 * (zooms + click arrows, instructional narration); "loom" is a Loom-style
 * async video message (natural screen, casual first-person narration).
 */
export type VideoGuideStyle = "tutorial" | "loom";

export interface VideoGuideOptions {
	/** Presentation style — drives the narration voice and the visual defaults */
	style: VideoGuideStyle;
	/** Highlight each detected click: circle ring + arrow + click rings (default true) */
	highlights: boolean;
	/** Zoom into each click so the highlight is seen up close (default true) */
	zooms: boolean;
	/** Trim idle/loading stretches between interactions (default true) */
	trimIdle: boolean;
	/** AI voiceover narrating the whole flow; needs the backend account (default true) */
	voiceover: boolean;
	/** Backend TTS voice id for the voiceover */
	voiceId: string;
}

export const DEFAULT_VIDEO_GUIDE_OPTIONS: VideoGuideOptions = {
	style: "tutorial",
	highlights: true,
	// Zoom and highlight work together, Guidde-style: the zoom brings the
	// click area up close and the ring + arrow pin-point the exact target.
	zooms: true,
	trimIdle: true,
	voiceover: true,
	voiceId: VOICE_OPTIONS[0].id,
};

/**
 * Loom-style defaults: the screen stays as recorded — no tutorial arrows
 * or zooms — with idle time still trimmed (Loom's "easy trimming") and a
 * conversational voiceover carrying the video. Each visual is still a
 * toggle; this is just the starting point when the style is picked.
 */
export const LOOM_VIDEO_GUIDE_OPTIONS: VideoGuideOptions = {
	style: "loom",
	highlights: false,
	zooms: false,
	trimIdle: true,
	voiceover: true,
	voiceId: VOICE_OPTIONS[0].id,
};

export interface VideoGuideSummary {
	stepCount: number;
	zoomCount: number;
	highlightCount: number;
	trimCount: number;
	trimmedMs: number;
	narrationLineCount: number;
}

/** Thrown when voiceover is requested without an authenticated backend session. */
export class VideoGuideAuthError extends Error {
	constructor() {
		super("Voiceover requires you to be signed in to your account.");
		this.name = "VideoGuideAuthError";
	}
}

export interface VideoGuideInput {
	/** Steps in recording time, as returned by detectGuideSteps (+ AI titles) */
	steps: GuideStep[];
	/** Master timeline duration */
	timelineDurationMs: number;
	currentState: EditorState;
	/** Used to avoid trimming over narration; times are in recording time */
	captionTrack: CaptionTrack | null;
	options?: Partial<VideoGuideOptions>;
}

export interface VideoGuideResult {
	edits: Partial<EditorState>;
	summary: VideoGuideSummary;
	/** Per-step timeline windows — voiceover segments align to these */
	windows: StepWindow[];
}

export interface StepWindow {
	step: GuideStep;
	/** Timeline time */
	startMs: number;
	endMs: number;
}

let nextGuideRegionId = 1;

/**
 * Telemetry (and therefore each step) is in the primary recording's own
 * time. With clips on the timeline the recording may sit at an offset and
 * be trimmed, so steps are projected onto the master timeline through the
 * primary clip and clamped to it — same mapping as auto-zoom suggestions.
 */
function timelineMapping(state: EditorState, timelineDurationMs: number) {
	const primary = state.videoClips.find((clip) => clip.sourceType === "recording");
	return {
		shiftMs: primary ? primary.offsetMs - primary.startMs : 0,
		clampStartMs: primary ? primary.offsetMs : 0,
		clampEndMs: primary ? primary.offsetMs + primary.durationMs : timelineDurationMs,
	};
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/** Non-overlapping per-step windows on the master timeline */
function buildStepWindows(
	steps: GuideStep[],
	shiftMs: number,
	clampStartMs: number,
	clampEndMs: number,
): StepWindow[] {
	const windows: StepWindow[] = [];

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const clickMs = step.timeMs + shiftMs;
		if (clickMs < clampStartMs || clickMs > clampEndMs) continue;

		const start = Math.max(clampStartMs, clickMs - ZOOM_LEAD_IN_MS);
		let end = Math.min(clampEndMs, clickMs + STEP_MAX_DURATION_MS);

		// Never run into the next step's window
		const next = steps[i + 1];
		if (next) {
			const nextStart = next.timeMs + shiftMs - ZOOM_LEAD_IN_MS;
			end = Math.min(end, nextStart - STEP_GAP_MS);
		} else {
			end = Math.min(clampEndMs, Math.max(end, start + STEP_MIN_DURATION_MS));
		}

		if (end - start < STEP_SKIP_BELOW_MS) continue;
		windows.push({ step, startMs: Math.round(start), endMs: Math.round(end) });
	}

	return windows;
}

/** True when any spoken word (recording time) falls inside the timeline range */
function hasSpeech(
	captionTrack: CaptionTrack | null,
	timelineStartMs: number,
	timelineEndMs: number,
	shiftMs: number,
): boolean {
	if (!captionTrack) return false;
	const startMs = timelineStartMs - shiftMs;
	const endMs = timelineEndMs - shiftMs;
	return captionTrack.lines.some((line) => line.endMs >= startMs && line.startMs <= endMs);
}

function buildGuideZooms(windows: StepWindow[], keptZooms: ZoomRegion[]): ZoomRegion[] {
	const zooms: ZoomRegion[] = [];
	for (const window of windows) {
		// Leave user-made zooms alone rather than fighting them
		if (keptZooms.some((z) => overlaps(window.startMs, window.endMs, z.startMs, z.endMs))) {
			continue;
		}
		zooms.push({
			id: `${GUIDE_ID_PREFIX}-zoom-${nextGuideRegionId++}`,
			startMs: window.startMs,
			endMs: window.endMs,
			depth: GUIDE_ZOOM_DEPTH,
			customScale: ZOOM_DEPTH_SCALES[GUIDE_ZOOM_DEPTH],
			focus: clampFocusToDepth({ cx: window.step.cx, cy: window.step.cy }, GUIDE_ZOOM_DEPTH),
			// "auto" would let the wand toggle silently delete guide zooms
			source: "manual",
		});
	}
	return zooms;
}

/** Guidde-style amber accent for the click highlight ring and arrow */
const HIGHLIGHT_COLOR = "#F5A623";
/** Circle box size in percent of the canvas (image renderer keeps it round) */
const CIRCLE_WIDTH = 7;
const CIRCLE_HEIGHT = 12.5;
/** Arrow box size in percent of the canvas — kept comparable to the ring so
 *  the arrow accents the target instead of dwarfing it */
const ARROW_WIDTH = 8.5;
const ARROW_HEIGHT = 13;
/** Gap between the circle's edge and the arrow, percent */
const ARROW_GAP = 0.2;

function svgDataUrl(body: string, width: number, height: number): string {
	return (
		"data:image/svg+xml;utf8," +
		encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
		)
	);
}

/** Guidde's marks are hand-drawn: thin amber strokes, sketchy double pass,
 *  open arrowheads — not solid shapes. The ring is two overlapping arcs whose
 *  ends don't quite meet (the "sketched twice" look), over a faint white
 *  underlay so it stays readable on busy content. The image renderer
 *  letterboxes to the SVG's aspect, so the ring stays circular. */
const RING_SVG = svgDataUrl(
	`<g fill="none" stroke-linecap="round">` +
		`<circle cx="60" cy="60" r="46" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="16"/>` +
		`<path d="M62 14 A 46 47 0 1 1 46 17" stroke="${HIGHLIGHT_COLOR}" stroke-width="6.5"/>` +
		`<path d="M52 16 A 44 43 0 1 0 68 16.5" stroke="${HIGHLIGHT_COLOR}" stroke-width="3.5" stroke-opacity="0.55"/>` +
		`</g>`,
	120,
	120,
);

/** Hand-drawn curved arrow, Guidde-style: a thin tail sweeping up from
 *  below-right with an OPEN V head at the tip (no filled triangle). Drawn
 *  pointing LEFT; the right-pointing variant is a mirror. */
const ARROW_BODY =
	`<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
	`<path d="M106 102 C 98 54, 70 36, 30 31" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="16"/>` +
	`<path d="M46 14 L 27 30.5 L 49 41" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="16"/>` +
	`<path d="M106 102 C 98 54, 70 36, 30 31" stroke="${HIGHLIGHT_COLOR}" stroke-width="6.5"/>` +
	`<path d="M46 14 L 27 30.5 L 49 41" stroke="${HIGHLIGHT_COLOR}" stroke-width="6.5"/>` +
	`</g>`;
const ARROW_LEFT_SVG = svgDataUrl(ARROW_BODY, 120, 120);
const ARROW_RIGHT_SVG = svgDataUrl(
	`<g transform="scale(-1,1) translate(-120,0)">${ARROW_BODY}</g>`,
	120,
	120,
);

function clampPct(value: number, size: number): number {
	return Math.min(Math.max(value, 0), 100 - size);
}

/**
 * The click highlight: a circle ring centered on the click and a curved
 * arrow sweeping up to point at it — the Guidde look. No text; the
 * voiceover carries the explanation. The arrow sits on whichever side of
 * the click has room, below the target so it never covers what's clicked.
 */
function buildHighlight(window: StepWindow, zIndex: number): AnnotationRegion[] {
	const clickX = window.step.cx * 100;
	const clickY = window.step.cy * 100;

	const circle: AnnotationRegion = {
		id: `${GUIDE_ID_PREFIX}-circle-${nextGuideRegionId++}`,
		startMs: window.startMs,
		endMs: window.endMs,
		type: "image",
		content: RING_SVG,
		imageContent: RING_SVG,
		position: {
			x: clampPct(clickX - CIRCLE_WIDTH / 2, CIRCLE_WIDTH),
			y: clampPct(clickY - CIRCLE_HEIGHT / 2, CIRCLE_HEIGHT),
		},
		size: { width: CIRCLE_WIDTH, height: CIRCLE_HEIGHT },
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex,
	};

	// The arrow head points at the ring's edge; the tail sweeps down-and-out
	// to whichever side of the click has room.
	const arrowOnRight = clickX < 50;
	const arrowSvg = arrowOnRight ? ARROW_LEFT_SVG : ARROW_RIGHT_SVG;
	const arrow: AnnotationRegion = {
		id: `${GUIDE_ID_PREFIX}-arrow-${nextGuideRegionId++}`,
		startMs: window.startMs,
		endMs: window.endMs,
		type: "image",
		content: arrowSvg,
		imageContent: arrowSvg,
		position: {
			x: clampPct(
				arrowOnRight
					? clickX + CIRCLE_WIDTH / 2 + ARROW_GAP
					: clickX - CIRCLE_WIDTH / 2 - ARROW_GAP - ARROW_WIDTH,
				ARROW_WIDTH,
			),
			// Head (≈27% from the box top in the SVG) level with the click,
			// tail sweeping below it
			y: clampPct(clickY - ARROW_HEIGHT * 0.27, ARROW_HEIGHT),
		},
		size: { width: ARROW_WIDTH, height: ARROW_HEIGHT },
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex: zIndex + 1,
	};

	return [circle, arrow];
}

function buildIdleTrims(
	windows: StepWindow[],
	input: {
		clampStartMs: number;
		clampEndMs: number;
		shiftMs: number;
		captionTrack: CaptionTrack | null;
		keptTrims: TrimRegion[];
	},
): TrimRegion[] {
	const { clampStartMs, clampEndMs, shiftMs, captionTrack, keptTrims } = input;
	if (windows.length === 0) return [];

	// Idle gaps: before the first step, between steps, after the last step
	const gaps: Array<{ startMs: number; endMs: number }> = [];
	gaps.push({ startMs: clampStartMs, endMs: windows[0].startMs });
	for (let i = 0; i < windows.length - 1; i++) {
		gaps.push({ startMs: windows[i].endMs, endMs: windows[i + 1].startMs });
	}
	gaps.push({ startMs: windows[windows.length - 1].endMs, endMs: clampEndMs });

	const trims: TrimRegion[] = [];
	for (const gap of gaps) {
		if (gap.endMs - gap.startMs < IDLE_TRIM_THRESHOLD_MS) continue;

		const startMs = gap.startMs + IDLE_TRIM_PADDING_MS;
		const endMs = gap.endMs - IDLE_TRIM_PADDING_MS;
		if (endMs - startMs < MIN_TRIM_DURATION_MS) continue;

		// Never cut over narration or an existing user trim
		if (hasSpeech(captionTrack, startMs, endMs, shiftMs)) continue;
		if (keptTrims.some((t) => overlaps(startMs, endMs, t.startMs, t.endMs))) continue;

		trims.push({ id: `${GUIDE_ID_PREFIX}-trim-${nextGuideRegionId++}`, startMs, endMs });
	}
	return trims;
}

/**
 * Build the video-guide edits for the given steps. Regenerating is safe:
 * regions from a previous pass (matched by id prefix) are replaced, while
 * everything user-made is preserved.
 */
export function buildVideoGuideEdits(input: VideoGuideInput): VideoGuideResult {
	const { steps, timelineDurationMs, currentState, captionTrack } = input;
	const options = { ...DEFAULT_VIDEO_GUIDE_OPTIONS, ...input.options };

	const { shiftMs, clampStartMs, clampEndMs } = timelineMapping(currentState, timelineDurationMs);
	const windows = buildStepWindows(steps, shiftMs, clampStartMs, clampEndMs);

	const isFromPreviousPass = (id: string) => id.startsWith(`${GUIDE_ID_PREFIX}-`);
	// Auto-suggested zooms are superseded by the per-step zooms
	const keptZooms = currentState.zoomRegions.filter(
		(z) => !isFromPreviousPass(z.id) && z.source !== "auto",
	);
	const keptAnnotations = currentState.annotationRegions.filter((a) => !isFromPreviousPass(a.id));
	const keptTrims = currentState.trimRegions.filter((t) => !isFromPreviousPass(t.id));

	const guideZooms = options.zooms ? buildGuideZooms(windows, keptZooms) : [];

	let highlights: AnnotationRegion[] = [];
	if (options.highlights) {
		const baseZIndex = keptAnnotations.reduce((max, a) => Math.max(max, a.zIndex), 0) + 1;
		highlights = windows.flatMap((window, i) => buildHighlight(window, baseZIndex + i * 2));
	}

	const idleTrims = options.trimIdle
		? buildIdleTrims(windows, { clampStartMs, clampEndMs, shiftMs, captionTrack, keptTrims })
		: [];

	const edits: Partial<EditorState> = {};
	// The produced guide presents the screen big. The editor's default
	// padding floats a small video in a sea of wallpaper — the opposite of
	// what a walkthrough needs. Tutorial keeps a slim wallpaper frame,
	// Guidde-style; Loom-style is the raw full-bleed screen. Undo reverts.
	if (options.style === "loom") {
		edits.padding = 0;
		edits.borderRadius = 0;
	} else {
		edits.padding = 16;
		edits.borderRadius = 12;
	}
	// Always rewritten: highlights replace zooming as the attention cue, so
	// auto-suggested zooms are cleared even when the pass adds no zooms of
	// its own. User-made zooms survive.
	edits.zoomRegions = [...keptZooms, ...guideZooms];
	if (options.highlights) {
		edits.annotationRegions = [...keptAnnotations, ...highlights];
		edits.showClickRings = true;
	}
	if (options.trimIdle) edits.trimRegions = [...keptTrims, ...idleTrims];

	return {
		edits,
		summary: {
			stepCount: windows.length,
			zoomCount: guideZooms.length,
			highlightCount: options.highlights ? windows.length : 0,
			trimCount: idleTrims.length,
			trimmedMs: idleTrims.reduce((sum, t) => sum + (t.endMs - t.startMs), 0),
			narrationLineCount: 0,
		},
		windows,
	};
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("Video guide cancelled", "AbortError");
}

/**
 * The narration is one continuous story, not a numbered step list: an
 * overview line saying what the walkthrough covers, then flowing lines
 * that follow the person's actions from start to finish.
 */
const TUTORIAL_VOICEOVER_SYSTEM_PROMPT = [
	"You are the voiceover writer for a produced product video — an EXPLAINER that narrates what is going on, not a step-by-step tutorial.",
	"You are given the moments where a person interacted with the screen during a recording, in order.",
	"Narrate what is happening as one continuous, natural explanation that follows the action.",
	"Rules:",
	"- The FIRST line is a short overview of what the video shows (max ~15 words).",
	"- Then one short sentence per moment (max ~18 words) that flows from the previous one.",
	'- NEVER enumerate: no "step", no "first/next/then/finally", no numbering. Just describe what happens and why.',
	"- Present tense, plain language. No filler like 'in this video' or 'as you can see'.",
	"- Use the on-screen titles and anything the narrator was heard saying to name real buttons and menus — never say 'click here' or describe screen coordinates.",
	"- Return ONLY a JSON array of strings: the overview line first, then one line per moment, in order. No prose, no markdown.",
	"",
	"Example — given 3 moments about enabling voice capture, a good answer is:",
	'["Setting up voice capture so recordings pick up narration.",' +
		'"Settings opens from the sidebar, straight into the Audio section.",' +
		'"The microphone toggle switches on, allowing the app to record.",' +
		'"A quick test confirms the voice comes through clearly."]',
].join("\n");

/**
 * Loom-style narration: what a real person would say while recording a
 * quick async video message for a teammate — first person, casual,
 * talking through their own screen, with a friendly opener and sign-off.
 */
const LOOM_VOICEOVER_SYSTEM_PROMPT = [
	"You are writing the spoken script for a quick Loom-style screen recording — a casual async video message from one teammate to another.",
	"You are given the moments where the person interacted with the screen during the recording, in order.",
	"Write what they would naturally say while talking through their screen, as one continuous take.",
	"Rules:",
	"- The FIRST line is a quick, friendly opener saying what the video shows (max ~16 words).",
	"- Then one short conversational sentence per moment (max ~18 words) that continues the take.",
	'- Speak in FIRST person, present tense, as if sharing your screen: "I\'ll open Settings here", "then I just switch this on".',
	'- Sound human: use contractions and casual connectors ("so", "then", "okay", "and that\'s it"). NEVER number anything or say "step".',
	"- Weave a brief friendly sign-off into the LAST line.",
	"- Use the on-screen titles and anything the narrator was heard saying to name real buttons and menus — never say 'click here' or describe screen coordinates.",
	"- Return ONLY a JSON array of strings: the opener first, then one line per moment, in order. No prose, no markdown.",
	"",
	"Example — given 3 moments about enabling voice capture, a good answer is:",
	'["Hey! Quick video to show you how I set up voice capture in the app.",' +
		'"So first I\'ll open Settings from the sidebar and head over to Audio.",' +
		'"Then I just flip on the microphone toggle so it can record.",' +
		"\"And I'll run a quick test to make sure it picks me up — that's it, ping me with any questions!\"]",
].join("\n");

const VOICEOVER_SYSTEM_PROMPTS: Record<VideoGuideStyle, string> = {
	tutorial: TUTORIAL_VOICEOVER_SYSTEM_PROMPT,
	loom: LOOM_VOICEOVER_SYSTEM_PROMPT,
};

function buildVoiceoverPrompt(windows: StepWindow[], guideTitle: string): string {
	const lines = windows.map(({ step }, i) => {
		const heard = step.transcript ? ` — heard: "${step.transcript.slice(0, 200)}"` : "";
		const desc = step.description ? ` (${step.description})` : "";
		return `${i + 1}. ${step.title}${desc}${heard}`;
	});
	return `Walkthrough title: ${guideTitle || "Untitled walkthrough"}\n\nMoments:\n${lines.join("\n")}\n\nWrite exactly ${windows.length + 1} lines: the overview first, then one per moment, in order.`;
}

/**
 * Write and voice the flowing narration via the backend (chat + TTS): the
 * overview plays from the start of the recording, each following line from
 * its interaction onward. Returns null when no usable script came back.
 * Individual TTS failures leave that segment text-only rather than failing
 * the track.
 */
async function generateVoiceover(
	windows: StepWindow[],
	guideTitle: string,
	style: VideoGuideStyle,
	voiceId: string,
	clampStartMs: number,
	clampEndMs: number,
	signal?: AbortSignal,
): Promise<NarrationTrack | null> {
	if (windows.length === 0) return null;

	const messages: ChatMessage[] = [
		{ role: "system", content: VOICEOVER_SYSTEM_PROMPTS[style] },
		{ role: "user", content: buildVoiceoverPrompt(windows, guideTitle) },
	];

	throwIfAborted(signal);
	const chat = await aiService.chatCompletion({ messages, temperature: 0.7 });
	if (!chat.success) throw new Error(`Voiceover script failed: ${chat.error}`);

	const lines = parseNarrationLines(chat.data.content, windows.length + 1);
	if (lines.length === 0) return null;

	// Overview line (when present) plays from the start of the recording;
	// each following line plays from its interaction until the next one.
	const hasOverview = lines.length > windows.length;
	const timed = lines.map((text, i) => {
		if (hasOverview && i === 0) {
			return { text, startMs: clampStartMs, endMs: windows[0].startMs };
		}
		const w = windows[hasOverview ? i - 1 : i];
		const next = windows[hasOverview ? i : i + 1];
		return {
			text,
			startMs: w.startMs,
			endMs: next?.startMs ?? Math.max(w.endMs, clampEndMs),
		};
	});

	const segments: NarrationSegment[] = await Promise.all(
		timed.map(async ({ text, startMs, endMs }, i): Promise<NarrationSegment> => {
			throwIfAborted(signal);
			const tts = await aiService.generateSpeech({
				text,
				voice: voiceId,
				model: "edge-tts",
			});
			return {
				id: `${GUIDE_ID_PREFIX}-narration-${i + 1}`,
				text,
				startMs,
				endMs,
				audioPath: tts.success ? tts.data.audioUrl : undefined,
			};
		}),
	);

	return {
		segments,
		voiceId,
		language: "en",
		audioPath: null,
	};
}

export interface CreateVideoGuideInput extends VideoGuideInput {
	/** Used to give the voiceover writer context */
	guideTitle: string;
	onProgress?: (message: string) => void;
	signal?: AbortSignal;
}

export interface CreateVideoGuideResult extends VideoGuideResult {
	/** Non-fatal problems (e.g. voiceover failed — visual pass still applied) */
	warnings: string[];
}

/**
 * The full pass in the chosen style: optional click highlights (circle +
 * arrow + rings) and zooms, idle trims, plus a flowing AI voiceover —
 * instructional for "tutorial", conversational first-person for "loom".
 * Everything lands in one Partial<EditorState> so a single pushState
 * applies — and a single undo reverts — the whole guide.
 */
export async function createVideoGuide(
	input: CreateVideoGuideInput,
): Promise<CreateVideoGuideResult> {
	const options = { ...DEFAULT_VIDEO_GUIDE_OPTIONS, ...input.options };
	if (options.voiceover && !apiClient.isAuthenticated()) throw new VideoGuideAuthError();

	input.onProgress?.("Building click highlights and trims…");
	const base = buildVideoGuideEdits(input);
	const warnings: string[] = [];

	if (options.voiceover && base.windows.length > 0) {
		input.onProgress?.("Writing and voicing narration…");
		const { clampStartMs, clampEndMs } = timelineMapping(
			input.currentState,
			input.timelineDurationMs,
		);
		try {
			const track = await generateVoiceover(
				base.windows,
				input.guideTitle,
				options.style,
				options.voiceId,
				clampStartMs,
				clampEndMs,
				input.signal,
			);
			if (track) {
				base.edits.narrationTrack = track;
				base.summary.narrationLineCount = track.segments.length;
			} else {
				warnings.push("Voiceover script came back empty — guide applied without narration.");
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			warnings.push(err instanceof Error ? err.message : "Voiceover generation failed.");
		}
	}

	return { ...base, warnings };
}
