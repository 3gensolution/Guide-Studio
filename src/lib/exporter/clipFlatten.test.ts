import { describe, expect, it } from "vitest";
import type { VideoClip } from "@/components/video-editor/types";
import {
	buildClipFlattenPlan,
	mapMasterMsToFlat,
	remapPrimaryCursorTelemetry,
	remapSpanRegions,
	toFlattenIpcSegments,
} from "./clipFlatten";

function clip(overrides: Partial<VideoClip> & { id: string }): VideoClip {
	return {
		sourceVideoPath: `/videos/${overrides.id}.mp4`,
		startMs: 0,
		endMs: overrides.durationMs ?? 1000,
		offsetMs: 0,
		durationMs: 1000,
		...overrides,
	};
}

describe("buildClipFlattenPlan", () => {
	it("lays out sequential clips end to end", () => {
		const plan = buildClipFlattenPlan([
			clip({ id: "primary", offsetMs: 0, durationMs: 5000, sourceType: "recording" }),
			clip({ id: "b", offsetMs: 5000, durationMs: 3000, sourceType: "imported" }),
		]);

		expect(plan.segments).toHaveLength(2);
		expect(plan.flattenedDurationMs).toBe(8000);
		expect(plan.segments[0]).toMatchObject({
			sourcePath: "/videos/primary.mp4",
			sourceStartMs: 0,
			sourceEndMs: 5000,
			masterStartMs: 0,
			masterEndMs: 5000,
			flatStartMs: 0,
		});
		expect(plan.segments[1]).toMatchObject({
			sourcePath: "/videos/b.mp4",
			masterStartMs: 5000,
			masterEndMs: 8000,
			flatStartMs: 5000,
		});
	});

	it("respects a trimmed clip's source in-point", () => {
		const plan = buildClipFlattenPlan([
			clip({ id: "a", offsetMs: 0, startMs: 2000, endMs: 6000, durationMs: 4000 }),
		]);
		expect(plan.segments[0]).toMatchObject({ sourceStartMs: 2000, sourceEndMs: 6000 });
	});

	it("compresses gaps out of the flattened timeline", () => {
		const plan = buildClipFlattenPlan([
			clip({ id: "a", offsetMs: 0, durationMs: 2000 }),
			clip({ id: "b", offsetMs: 3000, durationMs: 1000 }),
		]);
		expect(plan.flattenedDurationMs).toBe(3000);
		expect(plan.segments[1].flatStartMs).toBe(2000);
	});

	it("gives overlap to the first clip in array order, like preview playback", () => {
		const plan = buildClipFlattenPlan([
			clip({ id: "top", offsetMs: 1000, durationMs: 2000 }),
			clip({ id: "under", offsetMs: 0, durationMs: 4000 }),
		]);

		// under: [0,1000) → top: [1000,3000) → under: [3000,4000)
		expect(plan.segments).toHaveLength(3);
		expect(plan.segments[0]).toMatchObject({
			sourcePath: "/videos/under.mp4",
			sourceStartMs: 0,
			sourceEndMs: 1000,
		});
		expect(plan.segments[1]).toMatchObject({
			sourcePath: "/videos/top.mp4",
			sourceStartMs: 0,
			sourceEndMs: 2000,
			flatStartMs: 1000,
		});
		expect(plan.segments[2]).toMatchObject({
			sourcePath: "/videos/under.mp4",
			sourceStartMs: 3000,
			sourceEndMs: 4000,
			flatStartMs: 3000,
		});
		expect(plan.flattenedDurationMs).toBe(4000);
	});

	it("excludes intro clips and empty clips", () => {
		const plan = buildClipFlattenPlan([
			clip({ id: "intro", offsetMs: 0, durationMs: 2000, sourceType: "intro" }),
			clip({ id: "empty", offsetMs: 0, durationMs: 0 }),
			clip({ id: "a", offsetMs: 2000, durationMs: 1000 }),
		]);
		expect(plan.segments).toHaveLength(1);
		expect(plan.segments[0].sourcePath).toBe("/videos/a.mp4");
	});
});

describe("mapMasterMsToFlat", () => {
	const plan = buildClipFlattenPlan([
		clip({ id: "a", offsetMs: 0, durationMs: 2000 }),
		clip({ id: "b", offsetMs: 3000, durationMs: 1000 }),
	]);

	it("maps times inside segments", () => {
		expect(mapMasterMsToFlat(plan, 500)).toBe(500);
		expect(mapMasterMsToFlat(plan, 3500)).toBe(2500);
	});

	it("snaps gap times to the compressed position", () => {
		expect(mapMasterMsToFlat(plan, 2500)).toBe(2000);
	});

	it("clamps times past the end", () => {
		expect(mapMasterMsToFlat(plan, 99999)).toBe(3000);
	});
});

describe("remapSpanRegions", () => {
	const plan = buildClipFlattenPlan([
		clip({ id: "a", offsetMs: 0, durationMs: 2000 }),
		clip({ id: "b", offsetMs: 3000, durationMs: 1000 }),
	]);

	it("shifts regions across compressed gaps", () => {
		const [region] = remapSpanRegions([{ id: "z1", startMs: 3200, endMs: 3800 }], plan);
		expect(region).toMatchObject({ id: "z1", startMs: 2200, endMs: 2800 });
	});

	it("drops regions that collapse inside a gap", () => {
		expect(remapSpanRegions([{ startMs: 2100, endMs: 2900 }], plan)).toHaveLength(0);
	});

	it("clips regions spanning a gap boundary", () => {
		const [region] = remapSpanRegions([{ startMs: 1500, endMs: 3500 }], plan);
		expect(region).toMatchObject({ startMs: 1500, endMs: 2500 });
	});
});

describe("remapPrimaryCursorTelemetry", () => {
	it("projects samples through the primary clip's segments and drops the rest", () => {
		const plan = buildClipFlattenPlan([
			clip({
				id: "primary",
				sourceVideoPath: "/videos/rec.mp4",
				offsetMs: 4000,
				startMs: 1000,
				endMs: 3000,
				durationMs: 2000,
				sourceType: "recording",
			}),
			clip({ id: "b", offsetMs: 0, durationMs: 4000, sourceType: "imported" }),
		]);

		const points = remapPrimaryCursorTelemetry(
			[
				{ timeMs: 500, cx: 0.1, cy: 0.1 }, // trimmed off the primary's in-point
				{ timeMs: 1500, cx: 0.5, cy: 0.5 },
				{ timeMs: 3500, cx: 0.9, cy: 0.9 }, // past the primary's out-point
			],
			"/videos/rec.mp4",
			plan,
		);

		expect(points).toHaveLength(1);
		// Sample at source 1500ms → 500ms into the primary segment, which starts
		// at flat 4000ms (after the 4s imported clip).
		expect(points[0]).toMatchObject({ timeMs: 4500, cx: 0.5, cy: 0.5 });
	});
});

describe("toFlattenIpcSegments", () => {
	it("emits source-space cut ranges", () => {
		const plan = buildClipFlattenPlan([
			clip({ id: "a", offsetMs: 0, startMs: 100, endMs: 2100, durationMs: 2000 }),
		]);
		expect(toFlattenIpcSegments(plan)).toEqual([
			{ sourcePath: "/videos/a.mp4", startMs: 100, endMs: 2100 },
		]);
	});
});
