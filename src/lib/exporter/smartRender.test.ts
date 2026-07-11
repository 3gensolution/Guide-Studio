import { describe, expect, it } from "vitest";
import type { VideoClip } from "@/components/video-editor/types";
import { buildClipFlattenPlan } from "./clipFlatten";
import { buildEffectSpans, buildSmartRenderPlan, sliceFlattenPlanFlat } from "./smartRender";

const zoom = (startMs: number, endMs: number) =>
	({ id: `z-${startMs}`, startMs, endMs, depth: 1 }) as never;
const annotation = (startMs: number, endMs: number) =>
	({ id: `a-${startMs}`, startMs, endMs, type: "text" }) as never;

describe("buildEffectSpans", () => {
	it("pads zooms by their transition windows and clamps to the timeline", () => {
		const spans = buildEffectSpans({
			durationMs: 60_000,
			zoomRegions: [zoom(1000, 5000), zoom(30_000, 34_000)],
			annotationRegions: [],
		});
		expect(spans).toEqual([
			{ startMs: 0, endMs: 6600 },
			{ startMs: 27_900, endMs: 35_600 },
		]);
	});

	it("merges overlapping padded regions", () => {
		const spans = buildEffectSpans({
			durationMs: 60_000,
			zoomRegions: [zoom(10_000, 14_000)],
			annotationRegions: [annotation(15_000, 18_000)],
		});
		expect(spans).toEqual([{ startMs: 7900, endMs: 18_700 }]);
	});
});

describe("buildSmartRenderPlan", () => {
	it("splits the timeline into alternating copy and render segments", () => {
		const plan = buildSmartRenderPlan({
			durationMs: 120_000,
			effectSpans: [{ startMs: 30_000, endMs: 40_000 }],
			trimRegions: [],
		});
		expect(plan).not.toBeNull();
		expect(plan?.segments).toEqual([
			{ kind: "copy", startMs: 0, endMs: 30_000 },
			{ kind: "render", startMs: 30_000, endMs: 40_000 },
			{ kind: "copy", startMs: 40_000, endMs: 120_000 },
		]);
		expect(plan?.renderTrimRegions).toEqual([
			{ startMs: 0, endMs: 30_000 },
			{ startMs: 40_000, endMs: 120_000 },
		]);
		expect(plan?.renderOutputSpans).toEqual([{ startMs: 0, endMs: 10_000 }]);
	});

	it("removes trimmed ranges before segmenting", () => {
		const plan = buildSmartRenderPlan({
			durationMs: 120_000,
			effectSpans: [{ startMs: 30_000, endMs: 40_000 }],
			trimRegions: [{ id: "t1", startMs: 0, endMs: 20_000 } as never],
		});
		expect(plan?.segments[0]).toEqual({ kind: "copy", startMs: 20_000, endMs: 30_000 });
	});

	it("absorbs copy spans shorter than the minimum into render spans", () => {
		const plan = buildSmartRenderPlan({
			durationMs: 120_000,
			effectSpans: [
				{ startMs: 10_000, endMs: 20_000 },
				{ startMs: 21_000, endMs: 30_000 }, // 1s gap → absorbed
			],
			trimRegions: [],
		});
		const renderSegments = plan?.segments.filter((segment) => segment.kind === "render");
		expect(renderSegments).toEqual([{ kind: "render", startMs: 10_000, endMs: 30_000 }]);
	});

	it("bails out when effects cover most of the timeline", () => {
		const plan = buildSmartRenderPlan({
			durationMs: 60_000,
			effectSpans: [{ startMs: 0, endMs: 50_000 }],
			trimRegions: [],
		});
		expect(plan).toBeNull();
	});

	it("bails out when there is nothing to render or too little to copy", () => {
		expect(
			buildSmartRenderPlan({ durationMs: 60_000, effectSpans: [], trimRegions: [] }),
		).toBeNull();
		expect(
			buildSmartRenderPlan({
				durationMs: 12_000,
				effectSpans: [{ startMs: 0, endMs: 8000 }],
				trimRegions: [],
			}),
		).toBeNull();
	});

	it("cumulates render output spans across multiple render segments", () => {
		const plan = buildSmartRenderPlan({
			durationMs: 200_000,
			effectSpans: [
				{ startMs: 20_000, endMs: 30_000 },
				{ startMs: 100_000, endMs: 105_000 },
			],
			trimRegions: [],
		});
		expect(plan?.renderOutputSpans).toEqual([
			{ startMs: 0, endMs: 10_000 },
			{ startMs: 10_000, endMs: 15_000 },
		]);
	});
});

describe("sliceFlattenPlanFlat", () => {
	const clip = (id: string, offsetMs: number, durationMs: number, startMs = 0): VideoClip => ({
		id,
		sourceVideoPath: `/videos/${id}.mp4`,
		startMs,
		endMs: startMs + durationMs,
		offsetMs,
		durationMs,
	});

	it("cuts spans out of the right sources with source-space offsets", () => {
		const plan = buildClipFlattenPlan([clip("a", 0, 10_000), clip("b", 10_000, 10_000, 2000)]);
		const sliced = sliceFlattenPlanFlat(plan, [{ startMs: 8000, endMs: 13_000 }]);

		expect(sliced.segments).toEqual([
			expect.objectContaining({
				sourcePath: "/videos/a.mp4",
				sourceStartMs: 8000,
				sourceEndMs: 10_000,
				flatStartMs: 0,
			}),
			expect.objectContaining({
				sourcePath: "/videos/b.mp4",
				// clip b is trimmed to start at source 2000ms
				sourceStartMs: 2000,
				sourceEndMs: 5000,
				flatStartMs: 2000,
			}),
		]);
		expect(sliced.flattenedDurationMs).toBe(5000);
	});

	it("handles multiple disjoint spans with cumulative flat offsets", () => {
		const plan = buildClipFlattenPlan([clip("a", 0, 30_000)]);
		const sliced = sliceFlattenPlanFlat(plan, [
			{ startMs: 0, endMs: 5000 },
			{ startMs: 20_000, endMs: 22_000 },
		]);
		expect(sliced.segments.map((s) => s.flatStartMs)).toEqual([0, 5000]);
		expect(sliced.flattenedDurationMs).toBe(7000);
	});

	it("slices in flattened time when the plan compresses gaps", () => {
		// clip a covers master [0,10s]; clip b covers master [15s,25s] — the
		// 5s gap is compressed, so flat time 12s falls inside clip b.
		const plan = buildClipFlattenPlan([clip("a", 0, 10_000), clip("b", 15_000, 10_000)]);
		const sliced = sliceFlattenPlanFlat(plan, [{ startMs: 12_000, endMs: 14_000 }]);
		expect(sliced.segments).toEqual([
			expect.objectContaining({
				sourcePath: "/videos/b.mp4",
				sourceStartMs: 2000,
				sourceEndMs: 4000,
				flatStartMs: 0,
			}),
		]);
	});
});
