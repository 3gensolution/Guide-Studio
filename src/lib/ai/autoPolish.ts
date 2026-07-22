/**
 * Auto-Polish — the Guidde-style one-click production pass.
 *
 * Composes the existing visual polish with backend-generated narration, a music
 * bed, smooth cursor settings, and a branded intro card into a single
 * `Partial<EditorState>` that is applied in one undoable step.
 *
 * All AI generation is routed through the backend account (chat / TTS / music);
 * the caller must be authenticated (see `apiClient.isAuthenticated()`). Each
 * generation stage fails soft: if narration or music can't be produced, that
 * part is skipped with a warning and the rest of the polish still applies.
 */

import type { CursorTelemetryPoint, VideoClip } from "@/components/video-editor/types";
import type { EditorState } from "@/hooks/useEditorHistory";
import { aiService, type ChatMessage } from "@/lib/api/ai";
import { apiClient } from "@/lib/api/client";
import type { IntroConfig } from "@/lib/intro/introTypes";
import { detectGuideSteps } from "./guideSteps";
import { generatePolishEdits } from "./oneClickPolish";
import {
	applyIntroStyle,
	musicPromptForStyle,
	type PolishOptions,
	type PolishTemplate,
	resolveIntroConfig,
} from "./polishTemplates";
import type { CaptionTrack, GuideStep, NarrationSegment, NarrationTrack } from "./types";

/** Stages emitted through `onProgress`, in execution order. */
export type AutoPolishStage = "visual" | "narration" | "music" | "intro" | "done";

/** Renders an intro config to a video file and returns its clip. Injected so
 *  this module stays free of `window`/DOM coupling and remains unit-testable. */
export type IntroClipFactory = (config: IntroConfig) => Promise<VideoClip | null>;

export interface AutoPolishInput {
	cursorTelemetry: CursorTelemetryPoint[];
	videoDurationMs: number;
	currentState: EditorState;
	/** Used for the intro title and to seed narration. */
	projectTitle: string;
	/** Optional transcript, used to enrich narration with spoken context. */
	captionTrack: CaptionTrack | null;
	/** The polish recipe (from the server or built-in defaults). */
	template: PolishTemplate;
	/** User-selected configuration: which stages run + music/intro/voice choices. */
	options: PolishOptions;
	/** Builds the intro clip. If omitted, the intro stage is skipped. */
	introClipFactory?: IntroClipFactory;
	onProgress?: (stage: AutoPolishStage, message: string) => void;
	signal?: AbortSignal;
}

export interface AutoPolishSummary {
	zoomCount: number;
	trimCount: number;
	speedRampCount: number;
	narrationLineCount: number;
	musicAdded: boolean;
	introAdded: boolean;
	cursorSmoothed: boolean;
}

export interface AutoPolishResult {
	/** Applied atomically via a single `pushState`. */
	edits: Partial<EditorState>;
	/** Cursor smoothing value the caller must also push to its local render
	 *  state (the render path reads local state, not EditorState). Null when the
	 *  smooth-cursor option was disabled. */
	cursorSmoothing: number | null;
	summary: AutoPolishSummary;
	/** Non-fatal problems (e.g. narration generation failed). */
	warnings: string[];
}

/** Thrown when Auto-Polish is invoked without an authenticated backend session. */
export class AutoPolishAuthError extends Error {
	constructor() {
		super("Auto-Polish requires you to be signed in to your account.");
		this.name = "AutoPolishAuthError";
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("Auto-Polish cancelled", "AbortError");
}

function formatMs(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

/** Build the user prompt describing detected steps for the narration writer. */
function buildNarrationUserPrompt(steps: GuideStep[], projectTitle: string): string {
	const lines = steps.map((step, i) => {
		const pos = `(${Math.round(step.cx * 100)}%, ${Math.round(step.cy * 100)}%)`;
		const heard = step.transcript ? ` — heard: "${step.transcript}"` : "";
		return `${i + 1}. [${formatMs(step.timeMs)}] ${step.action} at ${pos}${heard}`;
	});
	return `Guide title: ${projectTitle || "Untitled guide"}\n\nSteps:\n${lines.join("\n")}\n\nWrite exactly ${steps.length} narration line(s), one per step, in order.`;
}

/** Parse the model's reply into one line per step. Tolerates JSON arrays or
 *  newline/numbered lists. Returns [] if nothing usable came back.
 *  Also used by the Video Guide voiceover (videoGuide.ts). */
/**
 * Download a remote audio URL and persist it as a local file via the main
 * process. Returns the local path, or null when unavailable (non-Electron,
 * fetch failure) — callers keep the remote URL for preview-only use.
 */
export async function localizeAudioUrl(url: string, timeoutMs = 60_000): Promise<string | null> {
	if (!/^https?:/.test(url)) return url; // already local
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		if (!response.ok) return null;
		const data = await response.arrayBuffer();
		if (data.byteLength === 0 || !window.electronAPI?.saveNarrationAudio) return null;
		const saved = await window.electronAPI.saveNarrationAudio(data);
		return saved.success && saved.path ? saved.path : null;
	} catch {
		return null;
	}
}

export function parseNarrationLines(content: string, expected: number): string[] {
	const trimmed = content.trim();

	// Preferred: a JSON array of strings.
	const jsonStart = trimmed.indexOf("[");
	const jsonEnd = trimmed.lastIndexOf("]");
	if (jsonStart !== -1 && jsonEnd > jsonStart) {
		try {
			const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
			if (Array.isArray(parsed)) {
				const lines = parsed.map((v) => String(v).trim()).filter(Boolean);
				if (lines.length > 0) return lines.slice(0, expected);
			}
		} catch {
			// fall through to line parsing
		}
	}

	// Fallback: split into lines, strip leading numbering/bullets.
	const lines = trimmed
		.split("\n")
		.map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
		.filter(Boolean);
	return lines.slice(0, expected);
}

/**
 * Generate narration segments: detect steps, write a script via the backend
 * chat model, then synthesize each line with backend TTS. Returns null if no
 * steps were detected or the script could not be written.
 */
async function generateNarration(input: AutoPolishInput): Promise<NarrationTrack | null> {
	const {
		cursorTelemetry,
		videoDurationMs,
		captionTrack,
		template,
		projectTitle,
		options,
		signal,
	} = input;
	const voiceId = options.voiceId || template.narration.voiceId;

	const steps = detectGuideSteps(cursorTelemetry, videoDurationMs, captionTrack);
	if (steps.length === 0) return null;

	const messages: ChatMessage[] = [
		{ role: "system", content: template.narration.systemPrompt },
		{ role: "user", content: buildNarrationUserPrompt(steps, projectTitle) },
	];

	throwIfAborted(signal);
	const chat = await aiService.chatCompletion({ messages, temperature: 0.7 });
	if (!chat.success) throw new Error(`Narration script failed: ${chat.error}`);

	const lines = parseNarrationLines(chat.data.content, steps.length);
	if (lines.length === 0) return null;

	// Synthesize each line. Segment timing follows the step window so narration
	// plays from each interaction onward.
	const segments: NarrationSegment[] = await Promise.all(
		lines.map(async (text, i): Promise<NarrationSegment> => {
			const startMs = steps[i]?.timeMs ?? 0;
			const endMs = steps[i + 1]?.timeMs ?? videoDurationMs;
			throwIfAborted(signal);
			const tts = await aiService.generateSpeech({
				text,
				voice: voiceId,
				model: "edge-tts",
			});
			return {
				id: `polish-narration-${i + 1}`,
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
		language: template.narration.language,
		audioPath: null,
	};
}

/** Generate a background music bed via the backend. Returns its URL or null. */
async function generateMusic(input: AutoPolishInput): Promise<string | null> {
	const { videoDurationMs, options, signal } = input;
	// Backend MusicGen supports 5–30s clips; the editor loops the bed.
	const duration = Math.min(30, Math.max(5, Math.ceil(videoDurationMs / 1000)));
	throwIfAborted(signal);
	const result = await aiService.generateMusic({
		prompt: musicPromptForStyle(options.musicStyleId),
		duration,
	});
	return result.success ? result.data.audioUrl : null;
}

/**
 * Run the full Auto-Polish pass. Requires an authenticated backend session.
 */
export async function runAutoPolish(input: AutoPolishInput): Promise<AutoPolishResult> {
	const { currentState, template, options, onProgress, signal } = input;

	// Only the AI stages (narration/music) need the backend account.
	const needsBackend = options.narration || options.music;
	if (needsBackend && !apiClient.isAuthenticated()) throw new AutoPolishAuthError();

	const { style } = template;
	const warnings: string[] = [];
	const edits: Partial<EditorState> = {};
	let cursorSmoothing: number | null = null;

	// ── 1. Smart framing (zoom / trim / speed) + template look ──
	if (options.framing) {
		onProgress?.("visual", "Enhancing framing and pacing…");
		throwIfAborted(signal);
		const framingEdits = generatePolishEdits({
			cursorTelemetry: input.cursorTelemetry,
			videoDurationMs: input.videoDurationMs,
			currentState,
		});
		Object.assign(edits, framingEdits.edits);

		// Apply the template's visual style where the user hasn't set their own.
		if (!currentState.wallpaper && style.wallpaper) edits.wallpaper = style.wallpaper;
		if (currentState.borderRadius === 0) edits.borderRadius = style.borderRadius;
		if (currentState.padding === 0) edits.padding = style.padding;
		edits.shadowIntensity = style.shadowIntensity;
	}

	// Framing preview counts (for the summary), computed regardless of gating so
	// the summary reflects what was actually added.
	const zoomCount = edits.zoomRegions?.length ?? 0;
	const trimCount = edits.trimRegions?.length ?? 0;
	const speedRampCount = edits.speedRegions?.length ?? 0;

	// ── 2. Smooth cursor ──
	if (options.smoothCursor) {
		edits.cursorSmoothing = style.cursorSmoothing;
		edits.cursorSway = style.cursorSway;
		edits.showClickRings = style.showClickRings;
		cursorSmoothing = style.cursorSmoothing;
	}

	// ── 3. Narration ──
	if (options.narration) {
		onProgress?.("narration", "Writing and voicing narration…");
		try {
			const narrationTrack = await generateNarration(input);
			if (narrationTrack) edits.narrationTrack = narrationTrack;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			warnings.push(err instanceof Error ? err.message : "Narration generation failed.");
		}
	}

	// ── 4. Background music ──
	if (options.music) {
		onProgress?.("music", "Composing background music…");
		try {
			const musicUrl = await generateMusic(input);
			if (musicUrl) {
				// Music comes back as a remote delivery URL. Persist it locally so
				// the export mux (FFmpeg) can read it; preview handles both forms.
				edits.backgroundMusic = (await localizeAudioUrl(musicUrl)) ?? musicUrl;
				edits.backgroundMusicVolume = template.music.volume;
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			warnings.push(err instanceof Error ? err.message : "Music generation failed.");
		}
	}

	// ── 5. Intro card ──
	if (options.intro && input.introClipFactory && !currentState.introClip) {
		onProgress?.("intro", "Building intro card…");
		try {
			const baseConfig = resolveIntroConfig(template, {
				title: options.introTitle || input.projectTitle || "Untitled guide",
				subtitle: options.introSubtitle,
			});
			const introConfig = applyIntroStyle(baseConfig, options.introStyleId);
			throwIfAborted(signal);
			const introClip = await input.introClipFactory(introConfig);
			if (introClip) edits.introClip = introClip;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			warnings.push(err instanceof Error ? err.message : "Intro generation failed.");
		}
	}

	onProgress?.("done", "Finishing up…");

	const summary: AutoPolishSummary = {
		zoomCount,
		trimCount,
		speedRampCount,
		narrationLineCount: edits.narrationTrack?.segments.length ?? 0,
		musicAdded: Boolean(edits.backgroundMusic),
		introAdded: Boolean(edits.introClip),
		cursorSmoothed: options.smoothCursor,
	};

	return { edits, cursorSmoothing, summary, warnings };
}
