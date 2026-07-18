import { Application, Graphics, Sprite } from "pixi.js";
import {
	computeCompositeLayout,
	getWebcamLayoutPresetDefinition,
	type WebcamLayoutPreset,
	type WebcamSizePreset,
} from "@/lib/compositeLayout";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import {
	ADVANCED_VERTICAL_PADDING_MAX,
	type CropRegion,
	type Padding,
	type WebcamMaskShape,
} from "../types";

export const PADDING_SCALE_FACTOR = 0.2;
export const BASE_PREVIEW_WIDTH = 1920;
export const BASE_PREVIEW_HEIGHT = 1080;

export function scalePreviewBorderRadius(width: number, height: number, borderRadius = 0): number {
	if (width <= 0 || height <= 0) {
		return 0;
	}

	const canvasScaleFactor = Math.min(width / BASE_PREVIEW_WIDTH, height / BASE_PREVIEW_HEIGHT);
	return Math.max(0, borderRadius * canvasScaleFactor);
}

export function isZeroPadding(padding: Padding | number): boolean {
	if (typeof padding === "number") {
		return padding === 0;
	}
	return padding.top === 0 && padding.bottom === 0 && padding.left === 0 && padding.right === 0;
}

export interface PaddedLayoutResult {
	scale: number;
	centerOffsetX: number;
	centerOffsetY: number;
	spriteX: number;
	spriteY: number;
	fullFrameDisplayW: number;
	fullFrameDisplayH: number;
	fullVideoDisplayWidth: number;
	fullVideoDisplayHeight: number;
	croppedDisplayWidth: number;
	croppedDisplayHeight: number;
	cropStartX: number;
	cropStartY: number;
}

export function computePaddedLayout(params: {
	width: number;
	height: number;
	padding: Padding | number;
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
	cropRegion: CropRegion;
	videoWidth: number;
	videoHeight: number;
}): PaddedLayoutResult {
	const { width, height, padding, frameInsets, cropRegion, videoWidth, videoHeight } = params;

	// Apply asymmetrical padding
	const p =
		typeof padding === "number"
			? { top: padding, bottom: padding, left: padding, right: padding }
			: padding;

	// Padding is a percentage. Linked padding keeps the original 0-100 scaling
	// behavior; advanced vertical padding gets extra range for positioning.
	const isAdvancedPadding = typeof padding !== "number" && padding.linked === false;
	const clampPercent = (v: number, max = 100) => Math.min(max, Math.max(0, v));
	const leftPercent = clampPercent(p.left);
	const rightPercent = clampPercent(p.right);
	const topPercent = clampPercent(p.top, isAdvancedPadding ? ADVANCED_VERTICAL_PADDING_MAX : 100);
	const bottomPercent = clampPercent(
		p.bottom,
		isAdvancedPadding ? ADVANCED_VERTICAL_PADDING_MAX : 100,
	);
	const leftPadFrac = (leftPercent / 100) * PADDING_SCALE_FACTOR;
	const rightPadFrac = (rightPercent / 100) * PADDING_SCALE_FACTOR;
	const topPadFrac = (Math.min(topPercent, 100) / 100) * PADDING_SCALE_FACTOR;
	const bottomPadFrac = (Math.min(bottomPercent, 100) / 100) * PADDING_SCALE_FACTOR;

	const availableFracW = Math.max(0, 1.0 - leftPadFrac - rightPadFrac);
	const availableFracH = Math.max(0, 1.0 - topPadFrac - bottomPadFrac);

	const maxDisplayWidth = width * availableFracW;
	const maxDisplayHeight = height * availableFracH;

	const crop = cropRegion;
	const croppedVideoWidth = videoWidth * crop.width;
	const croppedVideoHeight = videoHeight * crop.height;

	const insets = frameInsets;
	const screenFracW = insets ? 1 - insets.left - insets.right : 1;
	const screenFracH = insets ? 1 - insets.top - insets.bottom : 1;

	const fullFrameVideoW = croppedVideoWidth / screenFracW;
	const fullFrameVideoH = croppedVideoHeight / screenFracH;

	const scale = Math.min(
		fullFrameVideoW > 0 ? maxDisplayWidth / fullFrameVideoW : 0,
		fullFrameVideoH > 0 ? maxDisplayHeight / fullFrameVideoH : 0,
	);

	const fullVideoDisplayWidth = videoWidth * scale;
	const fullVideoDisplayHeight = videoHeight * scale;
	const croppedDisplayWidth = croppedVideoWidth * scale;
	const croppedDisplayHeight = croppedVideoHeight * scale;

	const fullFrameDisplayW = fullFrameVideoW * scale;
	const fullFrameDisplayH = fullFrameVideoH * scale;

	const availableCenterX = leftPadFrac * width + maxDisplayWidth / 2;
	const availableCenterY = isAdvancedPadding
		? (() => {
				const verticalTravel = Math.max(0, height - fullFrameDisplayH);
				const centeredOffsetY = verticalTravel / 2;
				const directionalOffsetY =
					centeredOffsetY +
					((topPercent - bottomPercent) / ADVANCED_VERTICAL_PADDING_MAX) * centeredOffsetY;
				const frameOffsetY = Math.min(verticalTravel, Math.max(0, directionalOffsetY));
				return frameOffsetY + fullFrameDisplayH / 2;
			})()
		: topPadFrac * height + maxDisplayHeight / 2;

	const frameCenterX = availableCenterX - fullFrameDisplayW / 2;
	const frameCenterY = availableCenterY - fullFrameDisplayH / 2;

	const centerOffsetX = insets ? frameCenterX + insets.left * fullFrameDisplayW : frameCenterX;
	const centerOffsetY = insets ? frameCenterY + insets.top * fullFrameDisplayH : frameCenterY;

	const spriteX = centerOffsetX - crop.x * fullVideoDisplayWidth;
	const spriteY = centerOffsetY - crop.y * fullVideoDisplayHeight;

	return {
		scale,
		centerOffsetX,
		centerOffsetY,
		spriteX,
		spriteY,
		fullFrameDisplayW,
		fullFrameDisplayH,
		fullVideoDisplayWidth,
		fullVideoDisplayHeight,
		croppedDisplayWidth,
		croppedDisplayHeight,
		cropStartX: crop.x * videoWidth,
		cropStartY: crop.y * videoHeight,
	};
}

interface LayoutParams {
	container: HTMLDivElement;
	app: Application;
	videoSprite: Sprite;
	maskGraphics: Graphics;
	videoElement: HTMLVideoElement;
	cropRegion?: CropRegion;
	lockedVideoDimensions?: { width: number; height: number } | null;
	borderRadius?: number;
	padding?: Padding | number;
	webcamDimensions?: { width: number; height: number } | null;
	webcamLayoutPreset?: WebcamLayoutPreset;
	webcamSizePreset?: WebcamSizePreset;
	webcamPosition?: { cx: number; cy: number } | null;
	webcamMaskShape?: WebcamMaskShape;
	/** Screen insets from the active device frame, used to scale/center the full frame */
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
}

interface LayoutResult {
	stageSize: { width: number; height: number };
	videoSize: { width: number; height: number };
	baseScale: number;
	baseOffset: { x: number; y: number };
	maskRect: {
		x: number;
		y: number;
		width: number;
		height: number;
		sourceCrop?: CropRegion;
	};
	maskBorderRadius?: number;
	webcamRect?: {
		x: number;
		y: number;
		width: number;
		height: number;
		borderRadius?: number;
		maskShape?: WebcamMaskShape;
	} | null;
	cropBounds: { startX: number; endX: number; startY: number; endY: number };
}

export function layoutVideoContent(params: LayoutParams): LayoutResult | null {
	const {
		container,
		app,
		videoSprite,
		maskGraphics,
		videoElement,
		cropRegion,
		lockedVideoDimensions,
		borderRadius = 0,
		padding = 0,
		frameInsets,
		webcamDimensions,
		webcamLayoutPreset,
		webcamSizePreset,
		webcamPosition,
		webcamMaskShape,
	} = params;

	const videoWidth = lockedVideoDimensions?.width || videoElement.videoWidth;
	const videoHeight = lockedVideoDimensions?.height || videoElement.videoHeight;

	if (!videoWidth || !videoHeight) {
		return null;
	}

	const width = container.clientWidth;
	const height = container.clientHeight;

	if (!width || !height) {
		return null;
	}

	app.renderer.resize(width, height);
	app.canvas.style.width = "100%";
	app.canvas.style.height = "100%";

	const crop = cropRegion || { x: 0, y: 0, width: 1, height: 1 };

	const hasWebcamFeed = Boolean(
		webcamDimensions && webcamDimensions.width > 0 && webcamDimensions.height > 0,
	);
	const presetDefinition = getWebcamLayoutPresetDefinition(webcamLayoutPreset);
	// Stack/split presets reposition the screen itself, so they take over the whole
	// geometry; overlay presets (picture-in-picture) keep the padded screen layout
	// and just add a floating webcam rect on top.
	if (
		hasWebcamFeed &&
		webcamLayoutPreset &&
		webcamLayoutPreset !== "no-webcam" &&
		presetDefinition.transform.type !== "overlay"
	) {
		return layoutCompositeVideoContent({
			videoSprite,
			maskGraphics,
			width,
			height,
			videoWidth,
			videoHeight,
			crop,
			padding,
			webcamDimensions: webcamDimensions as { width: number; height: number },
			webcamLayoutPreset,
			webcamSizePreset,
			webcamPosition,
			webcamMaskShape,
		});
	}

	const layout = computePaddedLayout({
		width,
		height,
		padding,
		frameInsets,
		cropRegion: crop,
		videoWidth,
		videoHeight,
	});

	videoSprite.scale.set(layout.scale);
	videoSprite.position.set(layout.spriteX, layout.spriteY);

	maskGraphics.clear();
	drawSquircleOnGraphics(maskGraphics, {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
		radius: scalePreviewBorderRadius(width, height, borderRadius),
	});
	maskGraphics.fill({ color: 0xffffff });

	// Floating webcam overlay (picture-in-picture) in canvas coordinates,
	// independent of screen padding.
	let webcamRect: LayoutResult["webcamRect"] = null;
	if (hasWebcamFeed && webcamLayoutPreset !== "no-webcam") {
		const composite = computeCompositeLayout({
			canvasSize: { width, height },
			screenSize: { width: videoWidth * crop.width, height: videoHeight * crop.height },
			webcamSize: webcamDimensions,
			layoutPreset: webcamLayoutPreset ?? "picture-in-picture",
			webcamSizePreset,
			webcamPosition,
			webcamMaskShape,
		});
		webcamRect = composite?.webcamRect ?? null;
	}

	return {
		stageSize: { width, height },
		videoSize: { width: videoWidth * crop.width, height: videoHeight * crop.height },
		baseScale: layout.scale,
		baseOffset: { x: layout.spriteX, y: layout.spriteY },
		maskRect: {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			sourceCrop: crop,
		},
		webcamRect,
		cropBounds: {
			startX: layout.cropStartX,
			endX: layout.cropStartX + videoWidth * crop.width,
			startY: layout.cropStartY,
			endY: layout.cropStartY + videoHeight * crop.height,
		},
	};
}

/**
 * Layout for presets where the webcam reshapes the screen itself
 * (vertical-stack, dual-frame). Mirrors the export compositor's
 * computeCompositeLayout geometry so the preview matches the rendered output.
 * Vertical stack is full-bleed and ignores padding, matching export.
 */
function layoutCompositeVideoContent(params: {
	videoSprite: Sprite;
	maskGraphics: Graphics;
	width: number;
	height: number;
	videoWidth: number;
	videoHeight: number;
	crop: CropRegion;
	padding: Padding | number;
	webcamDimensions: { width: number; height: number };
	webcamLayoutPreset: WebcamLayoutPreset;
	webcamSizePreset?: WebcamSizePreset;
	webcamPosition?: { cx: number; cy: number } | null;
	webcamMaskShape?: WebcamMaskShape;
}): LayoutResult | null {
	const {
		videoSprite,
		maskGraphics,
		width,
		height,
		videoWidth,
		videoHeight,
		crop,
		padding,
		webcamDimensions,
		webcamLayoutPreset,
		webcamSizePreset,
		webcamPosition,
		webcamMaskShape,
	} = params;

	const croppedVideoWidth = videoWidth * crop.width;
	const croppedVideoHeight = videoHeight * crop.height;

	const isStack = getWebcamLayoutPresetDefinition(webcamLayoutPreset).transform.type === "stack";
	const p =
		typeof padding === "number"
			? { top: padding, bottom: padding, left: padding, right: padding }
			: padding;
	const clampPercent = (v: number) => Math.min(100, Math.max(0, v));
	const padFrac = (percent: number) => (clampPercent(percent) / 100) * PADDING_SCALE_FACTOR;
	const availableFracW = isStack ? 1 : Math.max(0, 1 - padFrac(p.left) - padFrac(p.right));
	const availableFracH = isStack ? 1 : Math.max(0, 1 - padFrac(p.top) - padFrac(p.bottom));

	const composite = computeCompositeLayout({
		canvasSize: { width, height },
		maxContentSize: { width: width * availableFracW, height: height * availableFracH },
		screenSize: { width: croppedVideoWidth, height: croppedVideoHeight },
		webcamSize: webcamDimensions,
		layoutPreset: webcamLayoutPreset,
		webcamSizePreset,
		webcamPosition,
		webcamMaskShape,
	});

	if (!composite) {
		return null;
	}

	const screenRect = composite.screenRect;
	// Cover mode scales to fill the rect (cropping overflow); fit mode letterboxes.
	const scale = composite.screenCover
		? Math.max(screenRect.width / croppedVideoWidth, screenRect.height / croppedVideoHeight)
		: Math.min(screenRect.width / croppedVideoWidth, screenRect.height / croppedVideoHeight);

	videoSprite.scale.set(scale);

	const fullVideoDisplayWidth = videoWidth * scale;
	const fullVideoDisplayHeight = videoHeight * scale;
	const croppedDisplayWidth = croppedVideoWidth * scale;
	const croppedDisplayHeight = croppedVideoHeight * scale;
	// Center the cropped region within screenRect.
	const offsetX = screenRect.x + (screenRect.width - croppedDisplayWidth) / 2;
	const offsetY = screenRect.y + (screenRect.height - croppedDisplayHeight) / 2;
	const spriteX = offsetX - crop.x * fullVideoDisplayWidth;
	const spriteY = offsetY - crop.y * fullVideoDisplayHeight;

	videoSprite.position.set(spriteX, spriteY);

	const maskBorderRadius = composite.screenBorderRadius ?? 0;
	maskGraphics.clear();
	drawSquircleOnGraphics(maskGraphics, {
		x: screenRect.x,
		y: screenRect.y,
		width: screenRect.width,
		height: screenRect.height,
		radius: maskBorderRadius,
	});
	maskGraphics.fill({ color: 0xffffff });

	const cropStartX = crop.x * videoWidth;
	const cropStartY = crop.y * videoHeight;

	return {
		stageSize: { width, height },
		videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
		baseScale: scale,
		baseOffset: { x: spriteX, y: spriteY },
		maskRect: {
			x: screenRect.x,
			y: screenRect.y,
			width: screenRect.width,
			height: screenRect.height,
			sourceCrop: crop,
		},
		maskBorderRadius,
		webcamRect: composite.webcamRect,
		cropBounds: {
			startX: cropStartX,
			endX: cropStartX + croppedVideoWidth,
			startY: cropStartY,
			endY: cropStartY + croppedVideoHeight,
		},
	};
}
