// ── Caption types for Whisper auto-captions ──

/** A single word with precise timing from Whisper transcription */
export interface CaptionWord {
	/** The word text */
	text: string;
	/** Start time in milliseconds */
	startMs: number;
	/** End time in milliseconds */
	endMs: number;
	/** Confidence score from Whisper (0-1) */
	confidence: number;
}

/** A line of caption text (group of words displayed together) */
export interface CaptionLine {
	/** Unique identifier */
	id: string;
	/** Words in this line */
	words: CaptionWord[];
	/** Start time in milliseconds (derived from first word) */
	startMs: number;
	/** End time in milliseconds (derived from last word) */
	endMs: number;
}

/** Full caption track for a video */
export interface CaptionTrack {
	/** Unique identifier */
	id: string;
	/** Detected language code (e.g. "en", "es") */
	language: string;
	/** All caption lines */
	lines: CaptionLine[];
	/** Whisper model used for transcription */
	modelId: string;
	/** Timestamp when transcription was created */
	createdAt: number;
}

/** Vertical position of captions on screen */
export type CaptionPosition = "top" | "center" | "bottom";

/** Animation style for caption display */
export type CaptionAnimation = "none" | "word-highlight" | "fade-in";

/** Style configuration for caption rendering */
export interface CaptionStyle {
	/** Font family name */
	fontFamily: string;
	/** Font size in pixels (at 1080p reference; scaled proportionally) */
	fontSize: number;
	/** Font color */
	fontColor: string;
	/** Background color (with alpha for opacity) */
	backgroundColor: string;
	/** Background opacity (0-1) */
	backgroundOpacity: number;
	/** Vertical position on screen */
	position: CaptionPosition;
	/** Animation style */
	animation: CaptionAnimation;
	/** Active word highlight color (used with word-highlight animation) */
	activeWordColor: string;
}

/** Default caption style */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
	fontFamily: "Inter",
	fontSize: 48,
	fontColor: "#FFFFFF",
	backgroundColor: "#000000",
	backgroundOpacity: 0.7,
	position: "bottom",
	animation: "word-highlight",
	activeWordColor: "#2563eb",
};

/** Supported Whisper model definitions */
export interface WhisperModel {
	id: string;
	name: string;
	sizeBytes: number;
	sizeLabel: string;
	url: string;
}

/** Available whisper models */
export const WHISPER_MODELS: WhisperModel[] = [
	{
		id: "tiny",
		name: "Tiny",
		sizeBytes: 75_000_000,
		sizeLabel: "~75 MB",
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
	},
	{
		id: "base",
		name: "Base",
		sizeBytes: 142_000_000,
		sizeLabel: "~142 MB",
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
	},
	{
		id: "small",
		name: "Small",
		sizeBytes: 466_000_000,
		sizeLabel: "~466 MB",
		url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
	},
];

/** Model download/status information */
export interface WhisperModelStatus {
	modelId: string;
	downloaded: boolean;
	path?: string;
	sizeBytes?: number;
}

/** Progress callback for model downloads */
export interface ModelDownloadProgress {
	modelId: string;
	downloadedBytes: number;
	totalBytes: number;
	percent: number;
}

// ── Recording analysis types ──

export interface RecordingProfile {
	silentSegments: TimeSegment[];
	idleSegments: TimeSegment[];
	activeSegments: TimeSegment[];
	clickClusters: ClickCluster[];
}

export interface TimeSegment {
	startMs: number;
	endMs: number;
	/** Optional metadata describing why this segment was flagged */
	reason?: string;
}

export interface ClickCluster {
	startMs: number;
	endMs: number;
	cx: number;
	cy: number;
	clickCount: number;
}

// ── Smart trim types ──

export type TrimReason = "idle-cursor" | "dead-air" | "low-activity" | "loading-screen";

export interface TrimSuggestion {
	id: string;
	startMs: number;
	endMs: number;
	reason: TrimReason;
	confidence: number;
	description?: string;
}

// ── Clip extraction ──

export interface ExtractedClip {
	id: string;
	startMs: number;
	endMs: number;
	score: number;
	reason?: string;
	title: string;
}

// ── Guide doc types (recording → written step-by-step guide) ──

/** One documented interaction step detected from cursor telemetry */
export interface GuideStep {
	id: string;
	/** 1-based step number */
	index: number;
	/** When the interaction happened */
	timeMs: number;
	/** Normalized click position (0-1) */
	cx: number;
	cy: number;
	action: "click" | "double-click" | "right-click";
	title: string;
	description: string;
	/** Words spoken around this step (from the caption track), for AI titling */
	transcript: string;
	/** Data-URL screenshot captured at the step timestamp */
	screenshotDataUrl?: string;
}

/** A complete generated guide document */
export interface GuideDoc {
	title: string;
	intro: string;
	steps: GuideStep[];
	createdAt: number;
	durationMs: number;
}

// ── Publish kit types (chapters + YouTube metadata) ──

export interface VideoChapter {
	timeMs: number;
	title: string;
}

export interface PublishKit {
	titles: string[];
	description: string;
	tags: string[];
	chapters: VideoChapter[];
}

// ── AI service types ──

export type AIProvider =
	| "ollama"
	| "openai"
	| "anthropic"
	| "groq"
	| "minimax"
	| "kimi"
	| "deepseek"
	| "glm"
	| "qwen";

export interface AIServiceConfig {
	provider: AIProvider;
	model?: string;
	apiKey?: string;
	ollamaUrl?: string;
	/** Endpoint override for OpenAI-compatible providers. Empty = provider default. */
	baseUrl?: string;
}

export interface AIProviderInfo {
	id: AIProvider;
	name: string;
	description: string;
	requiresApiKey: boolean;
	defaultModel: string;
	models: string[];
	hasTTS: boolean;
	/**
	 * The provider speaks the OpenAI chat-completions dialect, so its endpoint
	 * can be repointed at a regional or workspace-specific host (Z.ai's China
	 * domain, an Alibaba workspace domain, a corporate proxy).
	 */
	supportsBaseUrl?: boolean;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT-5.4, GPT-5, GPT-4.1. Best all-in-one with TTS.",
		requiresApiKey: true,
		defaultModel: "gpt-5.4-mini",
		models: [
			"gpt-5.4",
			"gpt-5.4-pro",
			"gpt-5.4-mini",
			"gpt-5.4-nano",
			"gpt-5-mini",
			"gpt-5-nano",
			"gpt-5",
			"gpt-4.1",
		],
		hasTTS: true,
		supportsBaseUrl: true,
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Claude Opus, Sonnet, Haiku. Excellent for narration scripts.",
		requiresApiKey: true,
		defaultModel: "claude-sonnet-4-6",
		models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
		hasTTS: false,
	},
	{
		id: "groq",
		name: "Groq",
		description: "Extremely fast inference. Free tier available.",
		requiresApiKey: true,
		defaultModel: "llama-3.3-70b-versatile",
		// Mixtral-8x7b dropped 2026-04-11: its 32k context was the only reason
		// the Reviewer Agent had to cap code at 2.5k chars, which was causing
		// false-positive "truncation" strips on all long scenes. Llama-3.3-70b
		// has 128k context and strictly better quality — no reason to keep
		// Mixtral in the rotation.
		models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
		hasTTS: false,
		supportsBaseUrl: true,
	},
	{
		id: "minimax",
		name: "MiniMax",
		description: "MiniMax M2.7. Competitive quality, affordable. Has TTS.",
		requiresApiKey: true,
		defaultModel: "MiniMax-M2.7",
		models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed"],
		hasTTS: true,
		supportsBaseUrl: true,
	},
	{
		// Moonshot AI's Kimi family. K2.6 is the current flagship — 256k
		// context, vision-capable, OpenAI-compatible API. Positioned as a
		// Sonnet alternative at substantially lower cost. K2 preview models
		// (kimi-k2-*-preview) are scheduled for end-of-life on 2026-05-25 —
		// keep them off the default list.
		id: "kimi",
		name: "Kimi",
		description:
			"Kimi K2.6 by Moonshot. 256k context, vision-capable, Sonnet-class quality at lower cost.",
		requiresApiKey: true,
		defaultModel: "kimi-k2.6",
		models: [
			"kimi-k2.6",
			"kimi-k2.5",
			"kimi-k2-thinking",
			"kimi-k2-thinking-turbo",
			"moonshot-v1-128k",
			"moonshot-v1-32k",
			"moonshot-v1-8k",
		],
		hasTTS: false,
		supportsBaseUrl: true,
	},
	{
		// DeepSeek's own platform. OpenAI-compatible; `deepseek-flash` is the
		// V4.1-Flash tier (1M context, vision-capable, very cheap) and
		// `deepseek-v4-pro` the heavier thinking model. The old
		// `deepseek-chat` / `deepseek-reasoner` aliases were retired in
		// July 2026 — don't put them back on the list.
		id: "deepseek",
		name: "DeepSeek",
		description: "DeepSeek V4. 1M context at a very low price — the cheapest capable option.",
		requiresApiKey: true,
		defaultModel: "deepseek-flash",
		models: ["deepseek-flash", "deepseek-v4-pro"],
		hasTTS: false,
		supportsBaseUrl: true,
	},
	{
		// Zhipu's GLM, through Z.ai's international API. The China platform
		// (open.bigmodel.cn) serves the same models on the same path — point
		// the base URL there if that's where the key was issued.
		id: "glm",
		name: "GLM (Z.ai)",
		description: "Zhipu GLM. Strong agentic and coding work; GLM-5 series for the heavy jobs.",
		requiresApiKey: true,
		defaultModel: "glm-4.7",
		models: ["glm-4.7", "glm-4.7-flash", "glm-5.3", "glm-5.1", "glm-5", "glm-4.6"],
		hasTTS: false,
		supportsBaseUrl: true,
	},
	{
		// Alibaba's Qwen through Model Studio (DashScope) in OpenAI-compatible
		// mode. Accounts issued a workspace domain should paste it as the base
		// URL — the shared international host stays the default.
		id: "qwen",
		name: "Qwen",
		description: "Alibaba Qwen on Model Studio. Long context, strong multilingual output.",
		requiresApiKey: true,
		defaultModel: "qwen3.7-plus",
		models: ["qwen3.7-plus", "qwen3.8-max", "qwen3.8-flash", "qwen3-coder-plus"],
		hasTTS: false,
		supportsBaseUrl: true,
	},
	{
		id: "ollama",
		name: "Ollama (Local)",
		description: "Run models locally. Free and private. Requires Ollama installed.",
		requiresApiKey: false,
		defaultModel: "llama3.2",
		models: ["llama3.2", "llama3.1", "mistral", "phi3"],
		hasTTS: false,
	},
];

export interface AIServiceResult {
	success: boolean;
	text?: string;
	error?: string;
}

export interface AIAvailability {
	providers: Array<{ id: AIProvider; available: boolean; reason?: string }>;
	activeProvider: AIProvider | null;
}

// ── Narration types ──

export interface NarrationSegment {
	id?: string;
	text: string;
	startMs: number;
	endMs: number;
	audioPath?: string;
}

export interface NarrationTrack {
	segments: NarrationSegment[];
	voiceId?: string;
	language?: string;
	audioPath?: string | null;
}

// ── Polish types ──

export interface PolishPreview {
	zoomCount: number;
	trimCount: number;
	speedRampCount: number;
	wallpaperChanged: boolean;
	borderRadiusChanged: boolean;
	paddingChanged: boolean;
	description?: string;
}
