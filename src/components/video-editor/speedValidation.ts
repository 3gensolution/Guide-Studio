/**
 * Speed change validation.
 *
 * Validates that changing the speed of a region does not cause zoom regions to
 * overlap or clips to overflow the total duration. Optionally rescales zoom
 * regions proportionally when speed changes.
 */

import type { SpeedRegion, ZoomRegion } from "./types";

export type SpeedValidationErrorType = "zoom-overlap" | "clip-overflow";

export interface SpeedValidationError {
	type: SpeedValidationErrorType;
	message: string;
	regionA?: string;
	regionB?: string;
	overflowMs?: number;
}

export interface SpeedChangeValidation {
	valid: boolean;
	errors: SpeedValidationError[];
}

/**
 * Check whether the zoom regions within a speed region's bounds would overlap
 * after rescaling for the new speed. Also checks if the speed region would
 * extend past the total duration.
 */
export function validateSpeedChange(
	speedRegion: SpeedRegion,
	existingZoomRegions: ZoomRegion[],
	totalDurationMs: number,
): SpeedChangeValidation {
	const errors: SpeedValidationError[] = [];

	// Check clip overflow: at the new speed, does the region exceed duration?
	if (speedRegion.endMs > totalDurationMs) {
		const overflow = speedRegion.endMs - totalDurationMs;
		errors.push({
			type: "clip-overflow",
			message: `Speed change causes region to extend ${Math.round(overflow)}ms past the end`,
			overflowMs: overflow,
		});
	}

	// Find zoom regions that overlap with the speed region
	const affectedZooms = existingZoomRegions.filter(
		(z) => z.endMs > speedRegion.startMs && z.startMs < speedRegion.endMs,
	);

	// After rescaling, check if any zoom regions would overlap each other
	if (affectedZooms.length > 1) {
		const sorted = [...affectedZooms].sort((a, b) => a.startMs - b.startMs);
		for (let i = 0; i < sorted.length - 1; i++) {
			if (sorted[i].endMs > sorted[i + 1].startMs) {
				errors.push({
					type: "zoom-overlap",
					message: "Speed change causes zoom regions to overlap",
					regionA: sorted[i].id,
					regionB: sorted[i + 1].id,
				});
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Rescale zoom regions proportionally when a speed region changes speed.
 * Zoom regions within the speed region's bounds have their start/end times
 * adjusted to reflect the new effective duration.
 */
export function rescaleZoomRegionsProportionally(
	speedRegion: SpeedRegion,
	oldSpeed: number,
	zoomRegions: ZoomRegion[],
): ZoomRegion[] {
	if (Math.abs(oldSpeed - speedRegion.speed) < 0.0001) {
		return zoomRegions;
	}

	const scaleFactor = oldSpeed / speedRegion.speed;

	return zoomRegions.map((zoom) => {
		// Only rescale zooms that fall within the speed region's bounds
		const isWithin = zoom.startMs >= speedRegion.startMs && zoom.endMs <= speedRegion.endMs;
		if (!isWithin) return zoom;

		const relativeStart = zoom.startMs - speedRegion.startMs;
		const relativeEnd = zoom.endMs - speedRegion.startMs;

		return {
			...zoom,
			startMs: speedRegion.startMs + Math.round(relativeStart * scaleFactor),
			endMs: speedRegion.startMs + Math.round(relativeEnd * scaleFactor),
		};
	});
}
