import type { ExportEncodingMode, ExportMp4FrameRate, ExportQuality } from "./types";
import { calculateMp4ExportSettings } from "./types";

// AAC track muxed alongside the video; close enough for a size estimate.
const ESTIMATED_AUDIO_BITRATE = 128_000;

const SHORT_CLIP_MAX_DURATION_SEC = 60;

export interface Mp4ExportRecommendation {
	quality: ExportQuality;
	frameRate: ExportMp4FrameRate;
	encodingMode: ExportEncodingMode;
}

/**
 * Recommended MP4 export settings for a given source. The defaults favor
 * small files and fast exports ("good" quality, 30 fps, fast encoding);
 * clips under a minute get "source" quality since their size is tiny anyway.
 */
export function getRecommendedMp4ExportSettings(options: {
	durationSec?: number;
}): Mp4ExportRecommendation {
	const durationSec = options.durationSec;
	const isShortClip =
		typeof durationSec === "number" &&
		Number.isFinite(durationSec) &&
		durationSec > 0 &&
		durationSec <= SHORT_CLIP_MAX_DURATION_SEC;

	return {
		quality: isShortClip ? "source" : "good",
		frameRate: 30,
		encodingMode: "fast",
	};
}

/**
 * Estimated output size using the same bitrate formula the exporter uses.
 * Deterministic (VBR will usually land below this), so it's a safe ceiling
 * to show in the export panel.
 */
export function estimateMp4ExportSizeBytes(options: {
	sourceWidth: number;
	sourceHeight: number;
	cropRegion?: { x: number; y: number; width: number; height: number };
	quality: ExportQuality;
	frameRate: ExportMp4FrameRate;
	durationSec: number;
	hasAudio?: boolean;
}): number {
	const { bitrate } = calculateMp4ExportSettings({
		sourceWidth: options.sourceWidth,
		sourceHeight: options.sourceHeight,
		cropRegion: options.cropRegion,
		quality: options.quality,
		frameRate: options.frameRate,
	});
	const audioBitrate = options.hasAudio === false ? 0 : ESTIMATED_AUDIO_BITRATE;
	const durationSec = Math.max(0, options.durationSec);
	return Math.round(((bitrate + audioBitrate) / 8) * durationSec);
}

export function formatEstimatedSize(bytes: number): string {
	const GIB = 1024 ** 3;
	const MIB = 1024 ** 2;
	if (bytes >= GIB) {
		return `${(bytes / GIB).toFixed(1)} GB`;
	}
	if (bytes >= 10 * MIB) {
		return `${Math.round(bytes / MIB)} MB`;
	}
	if (bytes >= MIB) {
		return `${(bytes / MIB).toFixed(1)} MB`;
	}
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
