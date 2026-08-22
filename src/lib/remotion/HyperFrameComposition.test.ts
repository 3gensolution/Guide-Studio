import { describe, expect, it } from "vitest";
import { mapFocusToBox, recordingBox } from "./HyperFrameComposition";

const COMPOSITION = { width: 1920, height: 1080 };
const focus = (cx: number, cy: number) => ({ cx, cy, scale: 2 });

/**
 * The zoom origin and the callout ring both come from this mapping. If it is
 * wrong, a demo zooms into the wrong pixel and the ring marks a third one — the
 * failure is silent because the render still succeeds.
 */
describe("mapFocusToBox", () => {
	it("is the identity when the recording matches the box aspect", () => {
		const box = { width: 1600, height: 900 };
		expect(mapFocusToBox(focus(0.25, 0.75), box, { width: 1920, height: 1080 })).toEqual({
			fx: 0.25,
			fy: 0.75,
		});
	});

	it("is the identity when the recording size is unknown", () => {
		const box = recordingBox("screen", COMPOSITION);
		expect(mapFocusToBox(focus(0.25, 0.75), box, undefined)).toEqual({ fx: 0.25, fy: 0.75 });
	});

	it("undoes the vertical crop for a recording narrower than its box", () => {
		// The real case: a 16:9 recording in the padded 1752x912 device frame.
		const box = recordingBox("screen", COMPOSITION);
		expect(box).toEqual({ width: 1752, height: 912 });
		const { fx, fy } = mapFocusToBox(focus(0.25, 0.75), box, { width: 1920, height: 1080 });
		expect(fx).toBe(0.25);

		// Derive the expectation from the cover geometry rather than restating
		// the implementation: cover matches the box width, so the recording is
		// drawn 1752x985.5 and 36.75px is cropped off each end.
		const drawnHeight = (box.width * 1080) / 1920;
		const crop = (drawnHeight - box.height) / 2;
		expect(fy).toBeCloseTo((0.75 * drawnHeight - crop) / box.height, 6);

		// Cross-check against a measured render: the marker was found at
		// y≈785.5px of the 1080 canvas, within a pixel of this mapping.
		const predictedCanvasY = 84 + fy * box.height;
		expect(Math.abs(predictedCanvasY - 785.5)).toBeLessThan(1.5);
	});

	it("undoes the horizontal crop for a recording wider than its box", () => {
		const box = { width: 1000, height: 1000 };
		const { fx, fy } = mapFocusToBox(focus(0.25, 0.75), box, { width: 2000, height: 1000 });
		// Cover scales to height, so half the recording's width is cropped away.
		expect(fx).toBeCloseTo(0.0, 5);
		expect(fy).toBe(0.75);
	});

	it("keeps the centre fixed regardless of aspect mismatch", () => {
		for (const recording of [
			{ width: 640, height: 480 },
			{ width: 1920, height: 1080 },
			{ width: 1080, height: 1920 },
		]) {
			const mapped = mapFocusToBox(focus(0.5, 0.5), recordingBox("screen", COMPOSITION), recording);
			expect(mapped.fx).toBeCloseTo(0.5, 6);
			expect(mapped.fy).toBeCloseTo(0.5, 6);
		}
	});

	it("clamps a point that the crop pushes outside the visible box", () => {
		// A 4:3 recording loses a lot of height, so its extremes are not on screen.
		const box = recordingBox("screen", COMPOSITION);
		const { fy } = mapFocusToBox(focus(0.5, 0.02), box, { width: 640, height: 480 });
		expect(fy).toBeGreaterThanOrEqual(0);
		expect(fy).toBeLessThanOrEqual(1);
	});

	it("accounts for the narrower box a split frame draws into", () => {
		const split = recordingBox("split", COMPOSITION);
		expect(split.width).toBeLessThan(recordingBox("screen", COMPOSITION).width);
		const mapped = mapFocusToBox(focus(0.25, 0.75), split, { width: 1920, height: 1080 });
		// The split box is portrait-ish, so the crop moves to the horizontal axis.
		expect(mapped.fy).toBe(0.75);
		expect(mapped.fx).not.toBe(0.25);
	});
});
