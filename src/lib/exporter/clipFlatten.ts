import type { CursorTelemetryPoint, VideoClip } from "@/components/video-editor/types";

/**
 * Multi-clip export support. The export pipeline decodes exactly one source
 * file, so a multi-clip timeline is first "flattened": every clip's kept
 * source range is cut and concatenated (via FFmpeg in the main process) into
 * one intermediate video whose timeline the exporter can consume directly.
 *
 * This module builds the flatten plan and remaps master-timeline data (effect
 * regions, cursor telemetry) into the flattened timeline. Semantics mirror
 * preview playback (resolveClipAtTime): at any master time the first clip in
 * array order covering that time wins; time inside a clip maps to
 * `clip.startMs + (master - clip.offsetMs)` in its source. Timeline ranges no
 * clip covers (gaps) are compressed out.
 */

export interface FlattenSegment {
	sourcePath: string;
	/** Cut range within the source file */
	sourceStartMs: number;
	sourceEndMs: number;
	/** Range this segment covers on the master timeline */
	masterStartMs: number;
	masterEndMs: number;
	/** Where this segment begins in the flattened output */
	flatStartMs: number;
}

export interface ClipFlattenPlan {
	segments: FlattenSegment[];
	flattenedDurationMs: number;
}

export function buildClipFlattenPlan(clips: VideoClip[]): ClipFlattenPlan {
	const usable = clips.filter((clip) => clip.durationMs > 0 && clip.sourceType !== "intro");
	const boundaries = [
		...new Set(usable.flatMap((clip) => [clip.offsetMs, clip.offsetMs + clip.durationMs])),
	].sort((a, b) => a - b);

	const segments: FlattenSegment[] = [];
	let flatCursor = 0;

	for (let i = 0; i < boundaries.length - 1; i++) {
		const intervalStart = boundaries[i];
		const intervalEnd = boundaries[i + 1];
		if (intervalEnd - intervalStart <= 0) continue;

		const mid = (intervalStart + intervalEnd) / 2;
		const clip = usable.find(
			(candidate) => mid >= candidate.offsetMs && mid < candidate.offsetMs + candidate.durationMs,
		);
		if (!clip) continue; // gap — compressed out of the flattened timeline

		const sourceStartMs = clip.startMs + (intervalStart - clip.offsetMs);
		const sourceEndMs = clip.startMs + (intervalEnd - clip.offsetMs);

		const prev = segments[segments.length - 1];
		if (
			prev &&
			prev.sourcePath === clip.sourceVideoPath &&
			prev.masterEndMs === intervalStart &&
			Math.abs(prev.sourceEndMs - sourceStartMs) < 0.001
		) {
			prev.masterEndMs = intervalEnd;
			prev.sourceEndMs = sourceEndMs;
		} else {
			segments.push({
				sourcePath: clip.sourceVideoPath,
				sourceStartMs,
				sourceEndMs,
				masterStartMs: intervalStart,
				masterEndMs: intervalEnd,
				flatStartMs: flatCursor,
			});
		}
		flatCursor += intervalEnd - intervalStart;
	}

	return { segments, flattenedDurationMs: flatCursor };
}

/**
 * Map a master-timeline time to the flattened timeline. Times inside a gap
 * snap to where the gap was compressed to.
 */
export function mapMasterMsToFlat(plan: ClipFlattenPlan, masterMs: number): number {
	for (const segment of plan.segments) {
		if (masterMs < segment.masterStartMs) return segment.flatStartMs;
		if (masterMs < segment.masterEndMs) {
			return segment.flatStartMs + (masterMs - segment.masterStartMs);
		}
	}
	return plan.flattenedDurationMs;
}

/**
 * Remap master-time regions (zoom, trim, speed, annotation, caption spans)
 * onto the flattened timeline. Regions that collapse inside gaps are dropped.
 */
export function remapSpanRegions<T extends { startMs: number; endMs: number }>(
	regions: T[],
	plan: ClipFlattenPlan,
): T[] {
	return regions
		.map((region) => ({
			...region,
			startMs: mapMasterMsToFlat(plan, region.startMs),
			endMs: mapMasterMsToFlat(plan, region.endMs),
		}))
		.filter((region) => region.endMs - region.startMs >= 1);
}

/**
 * Cursor telemetry is recorded in the primary recording's own time. Project it
 * onto the flattened timeline through every segment cut from that recording;
 * samples that fall inside imported clips' segments simply don't exist, so the
 * cursor only renders where the recording is on screen — matching the preview.
 */
export function remapPrimaryCursorTelemetry<T extends CursorTelemetryPoint>(
	points: T[],
	primarySourcePath: string,
	plan: ClipFlattenPlan,
): T[] {
	const remapped: T[] = [];
	for (const segment of plan.segments) {
		if (segment.sourcePath !== primarySourcePath) continue;
		for (const point of points) {
			if (point.timeMs >= segment.sourceStartMs && point.timeMs < segment.sourceEndMs) {
				remapped.push({
					...point,
					timeMs: segment.flatStartMs + (point.timeMs - segment.sourceStartMs),
				});
			}
		}
	}
	return remapped.sort((a, b) => a.timeMs - b.timeMs);
}

/** Segments in the shape the flatten IPC handler expects. */
export function toFlattenIpcSegments(
	plan: ClipFlattenPlan,
): Array<{ sourcePath: string; startMs: number; endMs: number }> {
	return plan.segments.map((segment) => ({
		sourcePath: segment.sourcePath,
		startMs: segment.sourceStartMs,
		endMs: segment.sourceEndMs,
	}));
}
