// ── Encoding Mode (Recordly-inspired) ────────────────────────────────────────

export type EncodingMode = "fast" | "balanced" | "quality";

export interface EncodingModeProfile {
	bitrateMultiplier: number;
	keyframeIntervalSec: number;
	latencyMode: "realtime" | "quality";
	label: string;
}

export const ENCODING_MODE_PROFILES: Record<EncodingMode, EncodingModeProfile> = {
	fast: {
		bitrateMultiplier: 0.1,
		keyframeIntervalSec: 4,
		latencyMode: "realtime",
		label: "Fast",
	},
	balanced: {
		bitrateMultiplier: 0.75,
		keyframeIntervalSec: 3,
		latencyMode: "realtime",
		label: "Balanced",
	},
	quality: {
		bitrateMultiplier: 1.0,
		keyframeIntervalSec: 2.5,
		latencyMode: "quality",
		label: "Quality",
	},
};

export const ENCODING_MODES: { value: EncodingMode; label: string; description: string }[] = [
	{ value: "fast", label: "Fast", description: "Smaller file, quicker export" },
	{ value: "balanced", label: "Balanced", description: "Good quality, reasonable speed" },
	{ value: "quality", label: "Quality", description: "Best quality, larger file" },
];

// ── Export Metrics ────────────────────────────────────────────────────────────

export interface ExportMetrics {
	metadataLoadTimeMs: number;
	rendererInitTimeMs: number;
	encodeLoopTimeMs: number;
	audioProcessTimeMs: number;
	finalizationTimeMs: number;
	peakEncodeQueueSize: number;
	peakDecodeQueueSize: number;
	totalExportTimeMs: number;
	backpressureProfile?: string;
	audioStrategy?: string;
	encodingMode?: string;
	framesPerSecond?: number;
}

// ── Core Export Types ─────────────────────────────────────────────────────────

export interface ExportConfig {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	codec?: string;
	encodingMode?: EncodingMode;
}

export interface ExportProgress {
	currentFrame: number;
	totalFrames: number;
	percentage: number;
	estimatedTimeRemaining: number; // seconds
	phase?: "extracting" | "finalizing" | "metadata" | "init" | "encoding" | "audio" | "muxing";
	renderProgress?: number; // 0-100, GIF render phase
	metrics?: Partial<ExportMetrics>;
	framesPerSecond?: number;
}

export interface ExportResult {
	success: boolean;
	blob?: Blob;
	error?: string;
	warnings?: string[];
	metrics?: ExportMetrics;
}

export interface VideoFrameData {
	frame: VideoFrame;
	timestamp: number; // in microseconds
	duration: number; // in microseconds
}

export type ExportQuality = "medium" | "good" | "source";

export type Mp4FrameRate = 24 | 30 | 60;

// GIF Export Types
export type ExportFormat = "mp4" | "gif";

export type GifFrameRate = 15 | 20 | 25 | 30;

export type GifSizePreset = "medium" | "large" | "original";

export interface GifExportConfig {
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	width: number;
	height: number;
}

export interface ExportSettings {
	format: ExportFormat;
	// MP4 settings
	quality?: ExportQuality;
	frameRate?: Mp4FrameRate;
	encodingMode?: EncodingMode;
	// GIF settings
	gifConfig?: GifExportConfig;
}

export const GIF_SIZE_PRESETS: Record<GifSizePreset, { maxHeight: number; label: string }> = {
	medium: { maxHeight: 720, label: "Medium (720p)" },
	large: { maxHeight: 1080, label: "Large (1080p)" },
	original: { maxHeight: Infinity, label: "Original" },
};

export const GIF_FRAME_RATES: { value: GifFrameRate; label: string }[] = [
	{ value: 15, label: "15 FPS - Balanced" },
	{ value: 20, label: "20 FPS - Smooth" },
	{ value: 25, label: "25 FPS - Very smooth" },
	{ value: 30, label: "30 FPS - Maximum" },
];

export const MP4_FRAME_RATES: { value: Mp4FrameRate; label: string }[] = [
	{ value: 24, label: "24 FPS - Cinematic" },
	{ value: 30, label: "30 FPS - Standard (Recommended)" },
	{ value: 60, label: "60 FPS - Smooth" },
];

// Valid frame rates for validation
export const VALID_GIF_FRAME_RATES: readonly GifFrameRate[] = [15, 20, 25, 30] as const;

export function isValidGifFrameRate(rate: number): rate is GifFrameRate {
	return VALID_GIF_FRAME_RATES.includes(rate as GifFrameRate);
}

// ── Audio Strategy ────────────────────────────────────────────────────────────

export type AudioStrategy = "copy-source" | "trim-source" | "speed-render" | "reencode";
