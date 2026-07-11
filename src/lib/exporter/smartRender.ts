import type { AnnotationRegion, TrimRegion, ZoomRegion } from "@/components/video-editor/types";
import type { ClipFlattenPlan, FlattenSegment } from "./clipFlatten";

/**
 * Smart render: when no setting touches every frame (cursor overlay, padding,
 * shadow, crop, webcam, captions…), the only frames that differ from the
 * source are the ones inside effect regions. Those spans go through the full
 * decode→composite→encode renderer; everything else is cut straight from the
 * source with FFmpeg (hardware re-encode, no canvas work) and the segments are
 * joined losslessly. This module plans the segmentation; it assumes the caller
 * already checked the global-effect eligibility.
 */

export interface Span {
	startMs: number;
	endMs: number;
}

export interface SmartRenderSegment extends Span {
	kind: "render" | "copy";
}

export interface SmartRenderPlan {
	/** Ordered timeline segments (master time, trims already removed). */
	segments: SmartRenderSegment[];
	/**
	 * Trim regions to feed the renderer so it renders ONLY the render spans
	 * (the original trims plus every copy span).
	 */
	renderTrimRegions: Span[];
	/**
	 * Each render span's position within the rendered output file, in output
	 * time. Split points for cutting the rendered file back apart.
	 */
	renderOutputSpans: Span[];
	/** Fraction of kept timeline that must be fully rendered. */
	renderCoverage: number;
}

// Zoom regions animate outside their bounds: lead-in starts
// ZOOM_IN_TRANSITION_WINDOW_MS (~1523ms) before startMs+overlap, lead-out ends
// TRANSITION_WINDOW_MS (~1015ms) after endMs. Rounded up generously — margin
// frames render identical-to-source content, so extra margin only costs time.
const ZOOM_LEAD_IN_MS = 2100;
const ZOOM_LEAD_OUT_MS = 1600;
// Annotations may animate in/out (text animations).
const ANNOTATION_MARGIN_MS = 700;
// Copy spans shorter than this get absorbed into neighbouring render spans:
// tiny FFmpeg cuts cost more than they save, and zooms within ~1.5s of each
// other pan through the gap (connected zooms), so the gap isn't source-clean.
const MIN_COPY_SPAN_MS = 3000;
// Above this coverage the full renderer is simpler and barely slower.
const MAX_RENDER_COVERAGE = 0.7;
// Below this total copy time the win isn't worth the extra moving parts.
const MIN_TOTAL_COPY_MS = 5000;

function mergeSpans(spans: Span[]): Span[] {
	const sorted = spans
		.filter((span) => span.endMs > span.startMs)
		.sort((a, b) => a.startMs - b.startMs);
	const merged: Span[] = [];
	for (const span of sorted) {
		const prev = merged[merged.length - 1];
		if (prev && span.startMs <= prev.endMs) {
			prev.endMs = Math.max(prev.endMs, span.endMs);
		} else {
			merged.push({ ...span });
		}
	}
	return merged;
}

function subtractSpans(base: Span[], remove: Span[]): Span[] {
	let result = base.map((span) => ({ ...span }));
	for (const cut of remove) {
		const next: Span[] = [];
		for (const span of result) {
			if (cut.endMs <= span.startMs || cut.startMs >= span.endMs) {
				next.push(span);
				continue;
			}
			if (cut.startMs > span.startMs) {
				next.push({ startMs: span.startMs, endMs: cut.startMs });
			}
			if (cut.endMs < span.endMs) {
				next.push({ startMs: cut.endMs, endMs: span.endMs });
			}
		}
		result = next;
	}
	return result.filter((span) => span.endMs - span.startMs > 1);
}

function intersectSpans(a: Span[], b: Span[]): Span[] {
	const result: Span[] = [];
	for (const spanA of a) {
		for (const spanB of b) {
			const startMs = Math.max(spanA.startMs, spanB.startMs);
			const endMs = Math.min(spanA.endMs, spanB.endMs);
			if (endMs - startMs > 1) {
				result.push({ startMs, endMs });
			}
		}
	}
	return mergeSpans(result);
}

/**
 * Speed regions are NOT handled here — they change the rendered output's
 * duration, which breaks the split math, and the bundled ffmpeg cannot
 * time-warp (no setpts/atempo). Callers must skip smart render when speed
 * regions exist.
 */
export function buildEffectSpans(options: {
	durationMs: number;
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
}): Span[] {
	const { durationMs, zoomRegions, annotationRegions } = options;
	const clamp = (ms: number) => Math.max(0, Math.min(durationMs, ms));
	const spans: Span[] = [];
	for (const region of zoomRegions) {
		spans.push({
			startMs: clamp(region.startMs - ZOOM_LEAD_IN_MS),
			endMs: clamp(region.endMs + ZOOM_LEAD_OUT_MS),
		});
	}
	for (const region of annotationRegions) {
		spans.push({
			startMs: clamp(region.startMs - ANNOTATION_MARGIN_MS),
			endMs: clamp(region.endMs + ANNOTATION_MARGIN_MS),
		});
	}
	return mergeSpans(spans);
}

/**
 * Returns null when smart rendering isn't worth it (no effects, effects cover
 * nearly everything, or too little copyable time).
 */
export function buildSmartRenderPlan(options: {
	durationMs: number;
	effectSpans: Span[];
	trimRegions: TrimRegion[];
}): SmartRenderPlan | null {
	const { durationMs, effectSpans, trimRegions } = options;
	if (durationMs <= 0 || effectSpans.length === 0) return null;

	const keptSpans = subtractSpans([{ startMs: 0, endMs: durationMs }], mergeSpans(trimRegions));
	const keptTotalMs = keptSpans.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
	if (keptTotalMs <= 0) return null;

	let renderSpans = intersectSpans(effectSpans, keptSpans);
	if (renderSpans.length === 0) return null;

	// Absorb copy spans too small to be worth a separate FFmpeg cut.
	let copySpans = subtractSpans(keptSpans, renderSpans);
	const shortCopies = copySpans.filter((span) => span.endMs - span.startMs < MIN_COPY_SPAN_MS);
	if (shortCopies.length > 0) {
		renderSpans = mergeSpans([...renderSpans, ...shortCopies]);
		// Re-intersect with kept content: merging can bridge across trims.
		renderSpans = intersectSpans(renderSpans, keptSpans);
		copySpans = subtractSpans(keptSpans, renderSpans);
	}

	const renderTotalMs = renderSpans.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
	const copyTotalMs = keptTotalMs - renderTotalMs;
	const renderCoverage = renderTotalMs / keptTotalMs;
	if (renderCoverage > MAX_RENDER_COVERAGE || copyTotalMs < MIN_TOTAL_COPY_MS) {
		return null;
	}

	const segments: SmartRenderSegment[] = [
		...renderSpans.map((span) => ({ ...span, kind: "render" as const })),
		...copySpans.map((span) => ({ ...span, kind: "copy" as const })),
	].sort((a, b) => a.startMs - b.startMs);

	// The renderer is driven by trims: everything except the render spans is
	// trimmed away, so its output is exactly the render spans back to back.
	const renderTrimRegions = subtractSpans([{ startMs: 0, endMs: durationMs }], renderSpans);

	const renderOutputSpans: Span[] = [];
	let outputCursorMs = 0;
	for (const span of renderSpans) {
		const lengthMs = span.endMs - span.startMs;
		renderOutputSpans.push({ startMs: outputCursorMs, endMs: outputCursorMs + lengthMs });
		outputCursorMs += lengthMs;
	}

	return { segments, renderTrimRegions, renderOutputSpans, renderCoverage };
}

/**
 * Restrict a clip flatten plan to spans expressed in the plan's FLATTENED
 * time (the axis all export effect data lives on after multi-clip remapping).
 * Returns a new plan whose segments cut the same source ranges; its
 * master coordinates carry the sliced axis so remapSpanRegions() can project
 * regions from that axis into the sliced (mini) timeline. Used to cut copy
 * spans straight from the original clip sources and to build the
 * effect-spans-only mini flatten the renderer consumes.
 */
export function sliceFlattenPlanFlat(plan: ClipFlattenPlan, spans: Span[]): ClipFlattenPlan {
	const segments: FlattenSegment[] = [];
	let flatCursor = 0;
	for (const span of mergeSpans(spans)) {
		for (const segment of plan.segments) {
			const segmentFlatStart = segment.flatStartMs;
			const segmentFlatEnd = segment.flatStartMs + (segment.masterEndMs - segment.masterStartMs);
			const startMs = Math.max(span.startMs, segmentFlatStart);
			const endMs = Math.min(span.endMs, segmentFlatEnd);
			if (endMs - startMs <= 1) continue;
			const intoSegment = startMs - segmentFlatStart;
			segments.push({
				sourcePath: segment.sourcePath,
				sourceStartMs: segment.sourceStartMs + intoSegment,
				sourceEndMs: segment.sourceStartMs + intoSegment + (endMs - startMs),
				masterStartMs: startMs,
				masterEndMs: endMs,
				flatStartMs: flatCursor,
			});
			flatCursor += endMs - startMs;
		}
	}
	return { segments, flattenedDurationMs: flatCursor };
}
