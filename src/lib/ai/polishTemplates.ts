/**
 * Polish Templates — the server-driven recipe that Auto-Polish follows.
 *
 * A PolishTemplate is a fully serializable JSON object describing how to turn a
 * raw recording into a finished, Guidde-style video: the intro card, the
 * voiceover writing style + voice, the background music bed, and the visual
 * look. The backend serves branded/account-specific templates from
 * `GET /studio/ai/templates/polish` (see `src/lib/api/templates.ts`); the
 * defaults below are the built-in fallback used when the endpoint is
 * unavailable so Auto-Polish always has something to run.
 */

import type { IntroConfig } from "@/lib/intro/introTypes";
import { DEFAULT_INTRO_CONFIG } from "@/lib/intro/introTypes";

/** How Auto-Polish should write and voice the narration. */
export interface PolishNarrationTemplate {
	/** System prompt handed to the backend chat model that writes the voiceover. */
	systemPrompt: string;
	/** Backend TTS voice id (see `GET /studio/ai/tts/voices`). */
	voiceId: string;
	/** BCP-47 language code, e.g. "en". */
	language: string;
	/** Target speaking pace, used to fit script length to segment durations. */
	wordsPerMinute: number;
}

/** How Auto-Polish should generate the background music bed. */
export interface PolishMusicTemplate {
	/** Prompt for backend music generation (`POST /studio/ai/music/generate`). */
	prompt: string;
	/** Background volume 0–100, ducked under narration. */
	volume: number;
}

/** The visual look Auto-Polish applies (mapped onto EditorState). */
export interface PolishStyleTemplate {
	/** 0–1 cursor path smoothing. */
	cursorSmoothing: number;
	/** 0–1 idle cursor sway. */
	cursorSway: number;
	/** Whether to draw click rings on interactions. */
	showClickRings: boolean;
	/** Background wallpaper path (empty string = leave untouched). */
	wallpaper: string;
	/** Rounded-corner radius for the screen frame. */
	borderRadius: number;
	/** Padding between frame and wallpaper. */
	padding: number;
	/** Drop-shadow intensity 0–1. */
	shadowIntensity: number;
}

/** A complete Auto-Polish recipe. Serializable — this is the backend payload. */
export interface PolishTemplate {
	id: string;
	name: string;
	description: string;
	/**
	 * Intro card config. `title`/`subtitle` may contain `{{title}}` /
	 * `{{subtitle}}` placeholders that are substituted at apply time via
	 * {@link resolveIntroConfig}.
	 */
	intro: IntroConfig;
	narration: PolishNarrationTemplate;
	music: PolishMusicTemplate;
	style: PolishStyleTemplate;
}

/** Variables available for placeholder substitution in a template's intro. */
export interface PolishTemplateVars {
	title: string;
	subtitle: string;
}

/** Where a resolved set of templates came from. */
export type PolishTemplateSource = "server" | "local";

const PLACEHOLDER_RE = /\{\{\s*(title|subtitle)\s*\}\}/g;

function substitute(text: string, vars: PolishTemplateVars): string {
	return text.replace(PLACEHOLDER_RE, (_match, key: "title" | "subtitle") => vars[key] ?? "");
}

/**
 * Produce a concrete IntroConfig from a template's intro by substituting
 * `{{title}}` / `{{subtitle}}` placeholders with real project values.
 */
export function resolveIntroConfig(
	template: PolishTemplate,
	vars: PolishTemplateVars,
): IntroConfig {
	return {
		...template.intro,
		title: substitute(template.intro.title, vars),
		subtitle: substitute(template.intro.subtitle, vars),
	};
}

const NARRATION_SYSTEM_PROMPT = [
	"You are the voiceover writer for a polished product video — an EXPLAINER, not a tutorial.",
	"You are given the moments where things happen in a screen recording, in order.",
	"Narrate what is going on as one continuous, natural explanation — like a person",
	"talking over the video about what's happening on screen.",
	"Rules:",
	"- One short sentence per moment (max ~18 words) that flows from the previous one.",
	'- NEVER enumerate: no "step", no "first/next/then/finally", no numbering of any kind.',
	"- Describe the action and its purpose in plain language, present tense.",
	"- No filler like 'in this video', 'as you can see', 'now we will'.",
	"- Return ONLY a JSON array of strings, one per moment, in order. No prose, no markdown.",
].join("\n");

/** The built-in default template — a clean, neutral, professional look. */
export const DEFAULT_POLISH_TEMPLATE: PolishTemplate = {
	id: "builtin-clean",
	name: "Clean Professional",
	description: "Neutral title card, calm voiceover, soft ambient music.",
	intro: {
		...DEFAULT_INTRO_CONFIG,
		title: "{{title}}",
		subtitle: "{{subtitle}}",
		accentColor: "#6366f1",
		backgroundColor: "brand-dark",
		titleAnimation: "slide-up",
		subtitleAnimation: "fade",
		durationMs: 3200,
	},
	narration: {
		systemPrompt: NARRATION_SYSTEM_PROMPT,
		voiceId: "en-US-AriaNeural",
		language: "en",
		wordsPerMinute: 150,
	},
	music: {
		prompt:
			"calm minimal ambient background music, soft piano and pads, no drums, loopable, unobtrusive",
		volume: 18,
	},
	style: {
		cursorSmoothing: 0.7,
		cursorSway: 0.3,
		showClickRings: true,
		wallpaper: "/wallpapers/wallpaper1.jpg",
		borderRadius: 12,
		padding: 8,
		shadowIntensity: 0.4,
	},
};

/** All built-in templates. Index 0 is the default. */
export const DEFAULT_POLISH_TEMPLATES: PolishTemplate[] = [DEFAULT_POLISH_TEMPLATE];

// ── Selectable catalogs (user-facing choices in the Polish setup dialog) ──

/** A background-music choice. The prompt drives backend music generation. */
export interface MusicStyle {
	id: string;
	name: string;
	/** Music-generation prompt; empty for "none". */
	prompt: string;
}

export const MUSIC_STYLES: MusicStyle[] = [
	{
		id: "calm",
		name: "Calm ambient",
		prompt:
			"calm minimal ambient background music, soft piano and pads, no drums, loopable, unobtrusive",
	},
	{
		id: "upbeat",
		name: "Upbeat corporate",
		prompt:
			"upbeat corporate background music, light electronic beat, positive and motivating, loopable",
	},
	{
		id: "cinematic",
		name: "Cinematic",
		prompt:
			"cinematic ambient background music, warm strings and subtle swells, inspiring, loopable",
	},
	{
		id: "lofi",
		name: "Lo-fi",
		prompt: "chill lo-fi hip hop background music, mellow beat, relaxed, loopable, unobtrusive",
	},
];

/** A selectable narration voice (backend TTS voice id + label). */
export interface VoiceOption {
	id: string;
	name: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
	{ id: "en-US-AriaNeural", name: "Aria (US, warm)" },
	{ id: "en-US-GuyNeural", name: "Guy (US, confident)" },
	{ id: "en-GB-SoniaNeural", name: "Sonia (UK, clear)" },
	{ id: "en-US-JennyNeural", name: "Jenny (US, friendly)" },
];

/** An intro-card look preset — a partial IntroConfig patched over the base. */
export interface IntroStyle {
	id: string;
	name: string;
	patch: Partial<IntroConfig>;
}

export const INTRO_STYLES: IntroStyle[] = [
	{
		id: "clean",
		name: "Clean",
		patch: {
			accentColor: "#6366f1",
			backgroundColor: "brand-dark",
			titleAnimation: "slide-up",
			subtitleAnimation: "fade",
		},
	},
	{
		id: "bold",
		name: "Bold",
		patch: {
			accentColor: "#f43f5e",
			backgroundColor: "#111114",
			titleAnimation: "scale",
			subtitleAnimation: "slide-up",
			titleSize: 1.2,
		},
	},
	{
		id: "gradient",
		name: "Gradient",
		patch: {
			accentColor: "#22d3ee",
			backgroundColor: "#0b1220",
			titleAnimation: "blur",
			subtitleAnimation: "fade",
		},
	},
];

/**
 * User-selected Auto-Polish configuration. Which stages run, plus the music /
 * intro / voice choices. Overrides the base template at run time.
 */
export interface PolishOptions {
	/** Smart framing: zoom / trim / speed / wallpaper. */
	framing: boolean;
	smoothCursor: boolean;
	narration: boolean;
	voiceId: string;
	music: boolean;
	musicStyleId: string;
	intro: boolean;
	introTitle: string;
	introSubtitle: string;
	introStyleId: string;
}

/** Default selections — everything on, using the first catalog entries. */
export const DEFAULT_POLISH_OPTIONS: PolishOptions = {
	framing: true,
	smoothCursor: true,
	narration: true,
	voiceId: VOICE_OPTIONS[0].id,
	music: true,
	musicStyleId: MUSIC_STYLES[0].id,
	intro: true,
	introTitle: "",
	introSubtitle: "A quick walkthrough",
	introStyleId: INTRO_STYLES[0].id,
};

/** Merge the user's saved options over the defaults, tolerating missing keys. */
export function normalizePolishOptions(
	saved: Partial<PolishOptions> | null | undefined,
): PolishOptions {
	return { ...DEFAULT_POLISH_OPTIONS, ...(saved ?? {}) };
}

/** Resolve the music prompt for a chosen style id (empty string if unknown). */
export function musicPromptForStyle(styleId: string): string {
	return MUSIC_STYLES.find((s) => s.id === styleId)?.prompt ?? MUSIC_STYLES[0].prompt;
}

/** Apply an intro style patch on top of a resolved intro config. */
export function applyIntroStyle(config: IntroConfig, styleId: string): IntroConfig {
	const style = INTRO_STYLES.find((s) => s.id === styleId);
	return style ? { ...config, ...style.patch } : config;
}
