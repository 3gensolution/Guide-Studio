import type { EncodingMode, ExportQuality } from "./types";
import { ENCODING_MODE_PROFILES } from "./types";

export interface Mp4ExportSettings {
	width: number;
	height: number;
	bitrate: number;
}

interface SourceCropRegion {
	width: number;
	height: number;
}

const MEDIUM_SHORT_SIDE = 720;
const HIGH_SHORT_SIDE = 1080;

function even(value: number) {
	return Math.floor(value / 2) * 2;
}

function atLeastEven(value: number) {
	return Math.max(2, even(value));
}

export function calculateEffectiveSourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	cropRegion?: SourceCropRegion,
) {
	const cropWidth = cropRegion?.width ?? 1;
	const cropHeight = cropRegion?.height ?? 1;

	return {
		width: atLeastEven(Math.round(sourceWidth * cropWidth)),
		height: atLeastEven(Math.round(sourceHeight * cropHeight)),
	};
}

function calculateDimensionsForShortSide(targetShortSide: number, aspectRatioValue: number) {
	if (aspectRatioValue >= 1) {
		const height = even(targetShortSide);
		return {
			width: even(height * aspectRatioValue),
			height,
		};
	}

	const width = even(targetShortSide);
	return {
		width,
		height: even(width / aspectRatioValue),
	};
}

function calculateSourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatioValue: number,
) {
	const sourceLongDim = Math.max(sourceWidth, sourceHeight);

	if (aspectRatioValue === 1) {
		const baseDimension = even(Math.min(sourceWidth, sourceHeight));
		return {
			width: baseDimension,
			height: baseDimension,
		};
	}

	if (aspectRatioValue > 1) {
		const baseWidth = even(sourceLongDim);
		for (let width = baseWidth; width >= 100; width -= 2) {
			const height = Math.round(width / aspectRatioValue);
			if (height % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
				return { width, height };
			}
		}
		return {
			width: baseWidth,
			height: even(baseWidth / aspectRatioValue),
		};
	}

	const baseHeight = even(sourceLongDim);
	for (let height = baseHeight; height >= 100; height -= 2) {
		const width = Math.round(height * aspectRatioValue);
		if (width % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
			return { width, height };
		}
	}
	return {
		width: even(baseHeight * aspectRatioValue),
		height: baseHeight,
	};
}

function calculateBitrate(
	width: number,
	height: number,
	quality: ExportQuality,
	frameRate: number = 30,
	encodingMode: EncodingMode = "quality",
) {
	const totalPixels = width * height;

	let baseBitrate: number;
	if (quality === "source") {
		if (totalPixels > 2560 * 1440) baseBitrate = 80_000_000;
		else if (totalPixels > 1920 * 1080) baseBitrate = 50_000_000;
		else baseBitrate = 30_000_000;
	} else if (totalPixels <= 1280 * 720) {
		baseBitrate = 10_000_000;
	} else if (totalPixels <= 1920 * 1080) {
		baseBitrate = 20_000_000;
	} else {
		baseBitrate = 30_000_000;
	}

	// Scale by frame rate: higher frame rates need proportionally more bitrate.
	// sqrt scaling avoids linear explosion while reflecting increased data rate.
	const frameRateScale = Math.sqrt(frameRate / 30);

	// Apply encoding mode multiplier (fast=0.1x, balanced=0.75x, quality=1.0x).
	const modeMultiplier = ENCODING_MODE_PROFILES[encodingMode].bitrateMultiplier;

	return Math.max(2_000_000, Math.round(baseBitrate * frameRateScale * modeMultiplier));
}

export function calculateMp4ExportSettings({
	quality,
	sourceWidth,
	sourceHeight,
	aspectRatioValue,
	frameRate = 30,
	encodingMode = "quality",
}: {
	quality: ExportQuality;
	sourceWidth: number;
	sourceHeight: number;
	aspectRatioValue: number;
	frameRate?: number;
	encodingMode?: EncodingMode;
}): Mp4ExportSettings {
	if (quality === "medium") {
		const dimensions = calculateDimensionsForShortSide(MEDIUM_SHORT_SIDE, aspectRatioValue);
		return {
			...dimensions,
			bitrate: calculateBitrate(
				dimensions.width,
				dimensions.height,
				quality,
				frameRate,
				encodingMode,
			),
		};
	}

	if (quality === "good") {
		const dimensions = calculateDimensionsForShortSide(HIGH_SHORT_SIDE, aspectRatioValue);
		return {
			...dimensions,
			bitrate: calculateBitrate(
				dimensions.width,
				dimensions.height,
				quality,
				frameRate,
				encodingMode,
			),
		};
	}

	const sourceDimensions = calculateSourceDimensions(sourceWidth, sourceHeight, aspectRatioValue);
	return {
		...sourceDimensions,
		bitrate: calculateBitrate(
			sourceDimensions.width,
			sourceDimensions.height,
			quality,
			frameRate,
			encodingMode,
		),
	};
}
