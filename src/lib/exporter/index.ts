export type { BackpressureLimits, BackpressureProfile } from "./backpressure";
export { getBackpressureLimits, selectBackpressureProfile } from "./backpressure";
export { renderCaptions } from "./captionRenderer";
export { FrameRenderer } from "./frameRenderer";
export { calculateOutputDimensions, GifExporter } from "./gifExporter";
export {
	calculateEffectiveSourceDimensions,
	calculateMp4ExportSettings,
	type Mp4ExportSettings,
} from "./mp4ExportSettings";
export { VideoMuxer } from "./muxer";
export type {
	RenderHookContext,
	RenderHookFn,
	RenderPhase,
} from "./renderHooks";
export {
	buildRenderHookContext,
	RenderHookRegistry,
} from "./renderHooks";
export { StreamingVideoDecoder } from "./streamingDecoder";
export type {
	AudioStrategy,
	EncodingMode,
	EncodingModeProfile,
	ExportConfig,
	ExportFormat,
	ExportMetrics,
	ExportProgress,
	ExportQuality,
	ExportResult,
	ExportSettings,
	GifExportConfig,
	GifFrameRate,
	GifSizePreset,
	Mp4FrameRate,
	VideoFrameData,
} from "./types";
export {
	ENCODING_MODE_PROFILES,
	ENCODING_MODES,
	GIF_FRAME_RATES,
	GIF_SIZE_PRESETS,
	isValidGifFrameRate,
	MP4_FRAME_RATES,
	VALID_GIF_FRAME_RATES,
} from "./types";
export { VideoFileDecoder } from "./videoDecoder";
export { VideoExporter } from "./videoExporter";
