export interface ExportConfig {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	codec?: string;
	encodingMode?: ExportEncodingMode;
	backendPreference?: ExportBackendPreference;
	preferredRenderBackend?: ExportRenderBackend;
	experimentalNativeExport?: boolean;
	experimentalNvidiaCudaExport?: boolean;
	maxEncodeQueue?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	maxInFlightNativeWrites?: number;
	sourceAudioFallbackStartDelayMsByPath?: Record<string, number>;
}

export type ExportRenderBackend = "webgpu" | "webgl";
export type ExportEncodeBackend = "ffmpeg" | "webcodecs";
export type ExportBackendPreference = "auto" | "webcodecs" | "breeze";
export type ExportPipelineModel = "modern" | "legacy";

export interface ExportProgress {
	currentFrame: number;
	totalFrames: number;
	percentage: number;
	estimatedTimeRemaining: number; // in seconds
	renderFps?: number;
	renderBackend?: ExportRenderBackend;
	encodeBackend?: ExportEncodeBackend;
	encoderName?: string;
	nativeStaticLayoutSkipReason?: string;
	nativeStaticLayoutSkipReasons?: string[];
	phase?: "preparing" | "extracting" | "finalizing" | "saving"; // Phase of export
	renderProgress?: number; // 0-100, progress of GIF rendering phase
	audioProgress?: number; // 0-1, progress of real-time audio rendering (speed/audio regions)
}

export interface ExportFinalizationStageMetrics {
	encoderFlushMs?: number;
	queuedMuxingMs?: number;
	audioProcessingMs?: number;
	muxerFinalizeMs?: number;
	editedAudioRenderMs?: number;
	ffmpegAudioMuxMs?: number;
	nativeExportFinalizeMs?: number;
	nativeEncoderFlushMs?: number;
	ffmpegAudioMuxBreakdown?: ExportFfmpegAudioMuxBreakdown;
}

export interface ExportFfmpegAudioMuxBreakdown {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
	chunkCount?: number;
	chunkDurationSec?: number;
	chunkExecMs?: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount?: number;
	videoOnlyBytes?: number;
	chunks?: Array<{
		index: number;
		startSec: number;
		durationSec: number;
		backend: string;
		elapsedMs: number;
		outputBytes: number;
		fallbackReason?: string;
		windowsGpuSummary?: {
			success?: boolean;
			width?: number;
			height?: number;
			fps?: number;
			seconds?: number;
			mediaMs?: number;
			frames?: number;
			gpuDecodeSurface?: boolean;
			webcamOverlay?: boolean;
			cursorOverlay?: boolean;
			zoomOverlay?: boolean;
			surfacePoolSize?: number;
			adapterIndex?: number;
			adapterVendorId?: number;
			adapterDeviceId?: number;
			adapterDedicatedVideoMemoryMB?: number;
			encoderBackend?: string;
			encoderTuningApplied?: boolean;
			nvencOutputBytes?: number;
			initializeMs?: number;
			initCoInitializeMs?: number;
			initMfStartupMs?: number;
			initD3DDeviceMs?: number;
			initSourceReaderMs?: number;
			initWebcamReaderMs?: number;
			initVideoProcessorMs?: number;
			initTexturesMs?: number;
			initShaderPipelineMs?: number;
			initSinkWriterMs?: number;
			totalMs?: number;
			readMs?: number;
			clearMs?: number;
			videoProcessMs?: number;
			writeSampleMs?: number;
			finalizeMs?: number;
			realtimeMultiplier?: number;
		};
	}>;
}

export interface ExportMetrics {
	totalElapsedMs: number;
	metadataLoadMs?: number;
	rendererInitMs?: number;
	nativeSessionStartMs?: number;
	decodeLoopMs?: number;
	frameCallbackMs?: number;
	renderFrameMs?: number;
	encodeWaitMs?: number;
	encodeWaitEvents?: number;
	peakEncodeQueueSize?: number;
	peakNativeWriteInFlight?: number;
	nativeCaptureMs?: number;
	nativeWriteMs?: number;
	finalizationMs?: number;
	frameCount?: number;
	renderBackend?: ExportRenderBackend;
	encodeBackend?: ExportEncodeBackend;
	encoderName?: string;
	backpressureProfile?: string;
	nativeStaticLayoutSkipReason?: string;
	nativeStaticLayoutSkipReasons?: string[];
	averageFrameCallbackMs?: number;
	averageRenderFrameMs?: number;
	averageEncodeWaitMs?: number;
	averageNativeCaptureMs?: number;
	averageNativeWriteMs?: number;
	effectiveDurationSec?: number;
	finalizationStageMs?: ExportFinalizationStageMetrics;
}

export interface ExportResult {
	success: boolean;
	/**
	 * Absolute path to a main-process temp file containing the finished export.
	 * Preferred for MP4 output because it avoids loading multi-gigabyte files
	 * into the renderer's ArrayBuffer heap. The renderer should move the temp
	 * file to its final destination via `finalize-exported-video`.
	 */
	tempFilePath?: string;
	/**
	 * In-renderer Blob for exports that fit in memory (GIF, smoke tests, legacy
	 * fallback). Mutually exclusive with `tempFilePath` — consumers should
	 * prefer the temp path when both are set.
	 */
	blob?: Blob;
	filePath?: string;
	error?: string;
	metrics?: ExportMetrics;
	warnings?: string[];
}

export interface VideoFrameData {
	frame: VideoFrame;
	timestamp: number; // in microseconds
	duration: number; // in microseconds
}

export type ExportEncodingMode = "fast" | "balanced" | "quality";

export type ExportQuality = "medium" | "good" | "high" | "source";

export type ExportMp4FrameRate = 24 | 30 | 60;

// GIF Export Types
export type ExportFormat = "mp4" | "gif";

export type GifFrameRate = 10 | 15 | 20 | 25 | 30;

export type GifSizePreset = "small" | "medium" | "large" | "original";

export interface GifExportConfig {
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	width: number;
	height: number;
}

export interface ExportSettings {
	format: ExportFormat;
	includeCaptionSidecar?: boolean;
	// MP4 settings
	quality?: ExportQuality;
	encodingMode?: ExportEncodingMode;
	mp4FrameRate?: ExportMp4FrameRate;
	backendPreference?: ExportBackendPreference;
	pipelineModel?: ExportPipelineModel;
	// GIF settings
	gifConfig?: GifExportConfig;
}

export const MP4_FRAME_RATES: readonly ExportMp4FrameRate[] = [24, 30, 60] as const;

export function isValidMp4FrameRate(rate: number): rate is ExportMp4FrameRate {
	return MP4_FRAME_RATES.includes(rate as ExportMp4FrameRate);
}

export const GIF_SIZE_PRESETS: Record<GifSizePreset, { maxHeight: number; label: string }> = {
	small: { maxHeight: 480, label: "Small (480p)" },
	medium: { maxHeight: 720, label: "Medium (720p)" },
	large: { maxHeight: 1080, label: "Large (1080p)" },
	original: { maxHeight: Infinity, label: "Original" },
};

export const GIF_FRAME_RATES: { value: GifFrameRate; label: string }[] = [
	{ value: 10, label: "10 FPS - Smallest file" },
	{ value: 15, label: "15 FPS - Balanced" },
	{ value: 20, label: "20 FPS - Smooth" },
	{ value: 25, label: "25 FPS - Very smooth" },
	{ value: 30, label: "30 FPS - Maximum" },
];

// Valid frame rates for validation
export const VALID_GIF_FRAME_RATES: readonly GifFrameRate[] = [10, 15, 20, 25, 30] as const;

export function isValidGifFrameRate(rate: number): rate is GifFrameRate {
	return VALID_GIF_FRAME_RATES.includes(rate as GifFrameRate);
}

// ─── Compatibility aliases for pre-Recordly code ───

/** @deprecated Use ExportEncodingMode */
export type EncodingMode = ExportEncodingMode;

/** @deprecated Use ExportMp4FrameRate */
export type Mp4FrameRate = ExportMp4FrameRate;

export const ENCODING_MODES: { value: ExportEncodingMode; label: string; description: string }[] = [
	{ value: "fast", label: "Fast", description: "Prioritizes speed over quality" },
	{ value: "balanced", label: "Balanced", description: "Balance of speed and quality" },
	{ value: "quality", label: "Quality", description: "Prioritizes quality over speed" },
];

export function calculateEffectiveSourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	cropRegion?: { x: number; y: number; width: number; height: number },
): { width: number; height: number } {
	if (!cropRegion) return { width: sourceWidth, height: sourceHeight };
	return {
		width: Math.round(sourceWidth * cropRegion.width),
		height: Math.round(sourceHeight * cropRegion.height),
	};
}

export function calculateMp4ExportSettings(options: {
	sourceWidth: number;
	sourceHeight: number;
	cropRegion?: { x: number; y: number; width: number; height: number };
	quality?: ExportQuality;
	frameRate?: ExportMp4FrameRate;
	encodingMode?: ExportEncodingMode;
}): {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
} {
	const { sourceWidth, sourceHeight, cropRegion, quality, frameRate } = options;
	const dims = calculateEffectiveSourceDimensions(sourceWidth, sourceHeight, cropRegion);

	// Round to even numbers for codec compatibility
	const width = dims.width % 2 === 0 ? dims.width : dims.width + 1;
	const height = dims.height % 2 === 0 ? dims.height : dims.height + 1;

	const fr = frameRate ?? 30;

	// Bitrate based on quality and resolution.
	// Base rate targets ~2 Mbps at 1080p30 for good screen recording quality
	// while keeping file sizes reasonable. The formula scales with resolution
	// and frame rate, clamped so degenerate crops can't starve the encoder and
	// large/high-fps exports can't balloon the file.
	const pixels = width * height;
	const baseBitrate = pixels * fr * 0.035;
	const qualityMultiplier =
		quality === "source" ? 2.0 : quality === "high" ? 1.4 : quality === "good" ? 1.0 : 0.5;

	const bitrate = Math.min(
		MAX_MP4_EXPORT_BITRATE,
		Math.max(MIN_MP4_EXPORT_BITRATE, Math.round(baseBitrate * qualityMultiplier)),
	);

	return {
		width,
		height,
		frameRate: fr,
		bitrate,
	};
}

const MIN_MP4_EXPORT_BITRATE = 1_000_000;
const MAX_MP4_EXPORT_BITRATE = 16_000_000;
