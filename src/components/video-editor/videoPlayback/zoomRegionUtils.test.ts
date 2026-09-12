import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { TRANSITION_WINDOW_MS, ZOOM_IN_TRANSITION_WINDOW_MS } from "./constants";
import { computeRegionStrength, findDominantRegion } from "./zoomRegionUtils";

function region(startMs: number, endMs: number, id = "z1"): ZoomRegion {
	return {
		id,
		startMs,
		endMs,
		depth: "medium",
		focus: { cx: 0.44, cy: 0.73 },
	};
}

describe("computeRegionStrength lead-in clamping", () => {
	it("leaves the first frame unzoomed for a region that starts inside the lead-in window", () => {
		// Auto-generated zooms routinely land a few hundred ms in; the lead-in used to
		// begin at a negative time, so t=0 was already ~94% zoomed and panned off-centre.
		expect(computeRegionStrength(region(420, 1400), 0)).toBe(0);
	});

	it("leaves the first frame unzoomed even for a region that starts at 0", () => {
		expect(computeRegionStrength(region(0, 1200), 0)).toBe(0);
	});

	it("still reaches full strength by the time the region is under way", () => {
		const early = region(420, 1400);
		expect(computeRegionStrength(early, 420 + 500)).toBe(1);
		expect(computeRegionStrength(early, 1000)).toBe(1);
	});

	it("ramps monotonically from the timeline start", () => {
		const early = region(420, 1400);
		const samples = [0, 100, 200, 400, 600, 800, 920].map((t) => computeRegionStrength(early, t));
		for (let i = 1; i < samples.length; i += 1) {
			expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
		}
		expect(samples.at(-1)).toBe(1);
	});

	it("keeps the full lead-in for regions with room before them", () => {
		const later = region(5000, 7000);
		const leadInStart = 5000 + 500 - ZOOM_IN_TRANSITION_WINDOW_MS;
		expect(computeRegionStrength(later, leadInStart - 1)).toBe(0);
		expect(computeRegionStrength(later, leadInStart + 1)).toBeGreaterThan(0);
		expect(computeRegionStrength(later, 5500)).toBe(1);
		expect(computeRegionStrength(later, 7000 + TRANSITION_WINDOW_MS + 1)).toBe(0);
	});
});

describe("findDominantRegion at the timeline start", () => {
	it("reports no active zoom on the opening frame", () => {
		const result = findDominantRegion([region(420, 1400), region(2850, 3840, "z2")], 0, {
			connectZooms: true,
		});
		expect(result.region).toBeNull();
		expect(result.strength).toBe(0);
	});
});
