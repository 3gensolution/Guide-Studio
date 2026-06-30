/**
 * Extension Render Hooks — Integration Layer
 *
 * Provides utility functions to call extension render hooks from
 * preview and export canvas pipelines. This is the bridge between
 * app renderers and extension-registered hooks.
 */

import type { CursorEffectContext, RenderHookContext, RenderHookPhase } from "@/lib/extensions";
import { extensionHost } from "@/lib/extensions";

// ---------------------------------------------------------------------------
// Scene pixel helpers — created per-context (capture ctx + videoLayout)
// ---------------------------------------------------------------------------

function makePixelHelpers(
	ctx: CanvasRenderingContext2D,
	videoLayout?: RenderHookContext["videoLayout"],
) {
	const getPixelColor = (x: number, y: number) => {
		const px = Math.round(x);
		const py = Math.round(y);
		const d = ctx.getImageData(px, py, 1, 1).data;
		return { r: d[0], g: d[1], b: d[2], a: d[3] };
	};

	const sampleGrid = (sx: number, sy: number, sw: number, sh: number, step: number) => {
		let rSum = 0,
			gSum = 0,
			bSum = 0,
			aSum = 0,
			count = 0;
		const clampedW = Math.max(1, Math.round(sw));
		const clampedH = Math.max(1, Math.round(sh));
		const data = ctx.getImageData(Math.round(sx), Math.round(sy), clampedW, clampedH).data;
		for (let y = 0; y < clampedH; y += step) {
			for (let x = 0; x < clampedW; x += step) {
				const i = (y * clampedW + x) * 4;
				rSum += data[i];
				gSum += data[i + 1];
				bSum += data[i + 2];
				aSum += data[i + 3];
				count++;
			}
		}
		if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };
		return {
			r: Math.round(rSum / count),
			g: Math.round(gSum / count),
			b: Math.round(bSum / count),
			a: Math.round(aSum / count),
		};
	};

	const getMaskRect = () => {
		if (videoLayout) return videoLayout.maskRect;
		return { x: 0, y: 0, width: ctx.canvas.width, height: ctx.canvas.height };
	};

	const getAverageSceneColor = () => {
		const m = getMaskRect();
		const step = Math.max(1, Math.round(Math.min(m.width, m.height) / 32));
		return sampleGrid(m.x, m.y, m.width, m.height, step);
	};

	const getEdgeAverageColor = (edgeWidth = 4) => {
		const m = getMaskRect();
		const ew = Math.max(1, edgeWidth);
		let rSum = 0,
			gSum = 0,
			bSum = 0,
			aSum = 0,
			count = 0;

		const bands = [
			{ x: m.x, y: m.y, w: m.width, h: ew }, // top
			{ x: m.x, y: m.y + m.height - ew, w: m.width, h: ew }, // bottom
			{ x: m.x, y: m.y + ew, w: ew, h: m.height - ew * 2 }, // left
			{ x: m.x + m.width - ew, y: m.y + ew, w: ew, h: m.height - ew * 2 }, // right
		];
		const step = Math.max(1, Math.round(Math.min(m.width, m.height) / 64));
		for (const b of bands) {
			if (b.w <= 0 || b.h <= 0) continue;
			const avg = sampleGrid(b.x, b.y, b.w, b.h, step);
			const bandSamples = Math.ceil(b.w / step) * Math.ceil(b.h / step);
			rSum += avg.r * bandSamples;
			gSum += avg.g * bandSamples;
			bSum += avg.b * bandSamples;
			aSum += avg.a * bandSamples;
			count += bandSamples;
		}
		if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };
		return {
			r: Math.round(rSum / count),
			g: Math.round(gSum / count),
			b: Math.round(bSum / count),
			a: Math.round(aSum / count),
		};
	};

	const getDominantColors = (maxColors = 5) => {
		const m = getMaskRect();
		const step = Math.max(1, Math.round(Math.min(m.width, m.height) / 24));
		const clampedW = Math.max(1, Math.round(m.width));
		const clampedH = Math.max(1, Math.round(m.height));
		const data = ctx.getImageData(Math.round(m.x), Math.round(m.y), clampedW, clampedH).data;
		// Quantize to 5-bit per channel
		const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
		for (let y = 0; y < clampedH; y += step) {
			for (let x = 0; x < clampedW; x += step) {
				const i = (y * clampedW + x) * 4;
				const qr = data[i] >> 3;
				const qg = data[i + 1] >> 3;
				const qb = data[i + 2] >> 3;
				const key = (qr << 10) | (qg << 5) | qb;
				const existing = buckets.get(key);
				if (existing) {
					existing.r += data[i];
					existing.g += data[i + 1];
					existing.b += data[i + 2];
					existing.count++;
				} else {
					buckets.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], count: 1 });
				}
			}
		}
		const totalSamples = Array.from(buckets.values()).reduce((s, b) => s + b.count, 0) || 1;
		return Array.from(buckets.values())
			.sort((a, b) => b.count - a.count)
			.slice(0, maxColors)
			.map((b) => ({
				r: Math.round(b.r / b.count),
				g: Math.round(b.g / b.count),
				b: Math.round(b.b / b.count),
				frequency: b.count / totalSamples,
			}));
	};

	return { getPixelColor, getAverageSceneColor, getEdgeAverageColor, getDominantColors };
}

/**
 * Execute all extension render hooks for a phase against a canvas context.
 *
 * Call this from FrameRenderer at the appropriate point in the pipeline.
 * The context is saved/restored around each hook call.
 */
export function executeExtensionRenderHooks(
	phase: RenderHookPhase,
	ctx: CanvasRenderingContext2D,
	params: {
		width: number;
		height: number;
		timeMs: number;
		durationMs: number;
		cursor?: { cx: number; cy: number; interactionType?: string } | null;
		smoothedCursor?: RenderHookContext["smoothedCursor"];
		videoLayout?: RenderHookContext["videoLayout"];
		zoom?: RenderHookContext["zoom"];
		shadow?: RenderHookContext["shadow"];
		sceneTransform?: RenderHookContext["sceneTransform"];
	},
): void {
	if (!extensionHost.hasRenderHooks(phase)) return;

	const helpers = makePixelHelpers(ctx, params.videoLayout);

	const context: RenderHookContext = {
		width: params.width,
		height: params.height,
		timeMs: params.timeMs,
		durationMs: params.durationMs,
		cursor: params.cursor ?? null,
		smoothedCursor: params.smoothedCursor ?? null,
		ctx,
		videoLayout: params.videoLayout,
		zoom: params.zoom,
		shadow: params.shadow,
		sceneTransform: params.sceneTransform,
		getPixelColor: helpers.getPixelColor,
		getAverageSceneColor: helpers.getAverageSceneColor,
		getEdgeAverageColor: helpers.getEdgeAverageColor,
		getDominantColors: helpers.getDominantColors,
	};

	extensionHost.executeRenderHooks(phase, context);
}

/**
 * Track active cursor effects (animations that persist across frames).
 */
interface ActiveCursorEffectInstance {
	interactionTimeMs: number;
	cx: number;
	cy: number;
	interactionType: "click" | "double-click" | "right-click" | "mouseup";
}

const activeCursorInteractions: ActiveCursorEffectInstance[] = [];
const MAX_EFFECT_DURATION_MS = 2000;

/**
 * Notify that a cursor interaction occurred (call from cursor telemetry handler).
 */
export function notifyCursorInteraction(
	timeMs: number,
	cx: number,
	cy: number,
	interactionType: string,
): void {
	if (!extensionHost.hasCursorEffects()) return;

	const validTypes = new Set(["click", "double-click", "right-click", "mouseup"]);
	if (!validTypes.has(interactionType)) return;

	activeCursorInteractions.push({
		interactionTimeMs: timeMs,
		cx,
		cy,
		interactionType: interactionType as ActiveCursorEffectInstance["interactionType"],
	});
}

/**
 * Execute cursor effects for the current frame.
 * Called after the cursor is drawn in the render pipeline.
 */
export function executeExtensionCursorEffects(
	ctx: CanvasRenderingContext2D,
	timeMs: number,
	width: number,
	height: number,
	extra?: {
		zoom?: CursorEffectContext["zoom"];
		sceneTransform?: CursorEffectContext["sceneTransform"];
		videoLayout?: CursorEffectContext["videoLayout"];
	},
): void {
	if (!extensionHost.hasCursorEffects() || activeCursorInteractions.length === 0) return;

	// Process all active interactions, removing expired ones
	for (let i = activeCursorInteractions.length - 1; i >= 0; i--) {
		const interaction = activeCursorInteractions[i];
		const elapsedMs = timeMs - interaction.interactionTimeMs;

		// Remove if too old
		if (elapsedMs > MAX_EFFECT_DURATION_MS || elapsedMs < 0) {
			activeCursorInteractions.splice(i, 1);
			continue;
		}

		const effectCtx: CursorEffectContext = {
			timeMs,
			cx: interaction.cx,
			cy: interaction.cy,
			interactionType: interaction.interactionType,
			width,
			height,
			ctx,
			elapsedMs,
			zoom: extra?.zoom,
			sceneTransform: extra?.sceneTransform,
			videoLayout: extra?.videoLayout,
		};

		const stillActive = extensionHost.executeCursorEffects(effectCtx);
		if (!stillActive) {
			activeCursorInteractions.splice(i, 1);
		}
	}
}

/**
 * Clear all active cursor effect animations (e.g., on seek).
 */
export function clearCursorEffects(): void {
	activeCursorInteractions.length = 0;
}
