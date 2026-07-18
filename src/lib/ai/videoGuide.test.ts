import { describe, expect, it } from "vitest";
import type { EditorState } from "@/hooks/useEditorHistory";
import { INITIAL_EDITOR_STATE } from "@/hooks/useEditorHistory";
import type { CaptionTrack, GuideStep } from "./types";
import {
	buildVideoGuideEdits,
	DEFAULT_VIDEO_GUIDE_OPTIONS,
	LOOM_VIDEO_GUIDE_OPTIONS,
} from "./videoGuide";

function step(index: number, timeMs: number, cx = 0.5, cy = 0.5): GuideStep {
	return {
		id: `step-${index}`,
		index,
		timeMs,
		cx,
		cy,
		action: "click",
		title: `Step ${index}: Click here`,
		description: "",
		transcript: "",
	};
}

function state(overrides: Partial<EditorState> = {}): EditorState {
	return { ...INITIAL_EDITOR_STATE, ...overrides };
}

describe("buildVideoGuideEdits", () => {
	it("highlights each click with a ring + curved arrow, zooms in, and trims idle gaps", () => {
		const steps = [step(1, 2_000, 0.2, 0.3), step(2, 20_000, 0.8, 0.7)];
		const { edits, summary } = buildVideoGuideEdits({
			steps,
			timelineDurationMs: 30_000,
			currentState: state(),
			captionTrack: null,
		});

		expect(summary.stepCount).toBe(2);
		expect(summary.highlightCount).toBe(2);
		// Two annotations per click: circle ring + pointing arrow
		expect(edits.annotationRegions).toHaveLength(4);
		expect(edits.showClickRings).toBe(true);
		// Zoom + highlight work together by default
		expect(summary.zoomCount).toBe(2);
		expect(edits.zoomRegions).toHaveLength(2);
		expect(summary.trimCount).toBeGreaterThanOrEqual(1);

		const circle = edits.annotationRegions?.find((a) => a.id.includes("circle"));
		expect(circle?.type).toBe("image");
		expect(circle?.imageContent).toContain("data:image/svg+xml");
		// Centered on the click at (20%, 30%)
		expect((circle?.position.x ?? 0) + (circle?.size.width ?? 0) / 2).toBeCloseTo(20, 0);

		const arrow = edits.annotationRegions?.find((a) => a.id.includes("arrow"));
		expect(arrow?.type).toBe("image");
		expect(arrow?.imageContent).toContain("data:image/svg+xml");
		// Click on the left half → arrow sits to the right of the ring
		expect(arrow?.position.x ?? 0).toBeGreaterThan(20);
	});

	it("never creates overlapping zooms across close steps", () => {
		const steps = [step(1, 2_000), step(2, 3_800, 0.6, 0.6), step(3, 6_000, 0.7, 0.2)];
		const { edits } = buildVideoGuideEdits({
			steps,
			timelineDurationMs: 12_000,
			currentState: state(),
			captionTrack: null,
		});
		const zooms = [...(edits.zoomRegions ?? [])].sort((a, b) => a.startMs - b.startMs);
		expect(zooms.length).toBeGreaterThan(0);
		for (let i = 0; i < zooms.length - 1; i++) {
			expect(zooms[i].endMs).toBeLessThanOrEqual(zooms[i + 1].startMs);
		}
	});

	it("replaces regions from a previous pass but keeps user-made ones", () => {
		const previous = buildVideoGuideEdits({
			steps: [step(1, 2_000)],
			timelineDurationMs: 30_000,
			currentState: state(),
			captionTrack: null,
		});
		const userZoom = {
			id: "zoom-7",
			startMs: 25_000,
			endMs: 27_000,
			depth: 3 as const,
			focus: { cx: 0.5, cy: 0.5 },
		};
		const withPrevious = state({
			zoomRegions: [userZoom],
			annotationRegions: previous.edits.annotationRegions ?? [],
			trimRegions: previous.edits.trimRegions ?? [],
		});

		const rerun = buildVideoGuideEdits({
			steps: [step(1, 2_000), step(2, 10_000)],
			timelineDurationMs: 30_000,
			currentState: withPrevious,
			captionTrack: null,
		});

		// User zoom kept; old vguide zooms replaced by fresh ones per click
		expect(rerun.edits.zoomRegions?.filter((z) => z.id === "zoom-7")).toHaveLength(1);
		expect(rerun.edits.zoomRegions).toHaveLength(3);
		// Old vguide annotations replaced, not stacked: 2 clicks × (circle + arrow)
		expect(rerun.edits.annotationRegions).toHaveLength(4);
	});

	it("clears auto-suggested zooms even when adding no zooms of its own", () => {
		const autoZoom = {
			id: "zoom-1",
			startMs: 1_000,
			endMs: 3_000,
			depth: 3 as const,
			focus: { cx: 0.5, cy: 0.5 },
			source: "auto" as const,
		};
		const { edits } = buildVideoGuideEdits({
			steps: [step(1, 2_000)],
			timelineDurationMs: 10_000,
			currentState: state({ zoomRegions: [autoZoom] }),
			captionTrack: null,
			options: { zooms: false },
		});
		expect(edits.zoomRegions).toEqual([]);
	});

	it("skips a step zoom that would overlap a user-made zoom", () => {
		const userZoom = {
			id: "zoom-9",
			startMs: 1_000,
			endMs: 4_000,
			depth: 3 as const,
			focus: { cx: 0.1, cy: 0.1 },
		};
		const { edits, summary } = buildVideoGuideEdits({
			steps: [step(1, 2_000)],
			timelineDurationMs: 10_000,
			currentState: state({ zoomRegions: [userZoom] }),
			captionTrack: null,
			options: { zooms: true },
		});
		expect(summary.zoomCount).toBe(0);
		expect(edits.zoomRegions).toEqual([userZoom]);
	});

	it("never trims over narration", () => {
		const captionTrack: CaptionTrack = {
			id: "t1",
			language: "en",
			lines: [
				{
					id: "l1",
					startMs: 6_000,
					endMs: 16_000,
					text: "now we wait for the deploy",
					words: [{ text: "now", startMs: 6_000, endMs: 16_000 }],
				},
			],
		} as CaptionTrack;

		const steps = [step(1, 2_000), step(2, 20_000)];
		const silent = buildVideoGuideEdits({
			steps,
			timelineDurationMs: 24_000,
			currentState: state(),
			captionTrack: null,
		});
		const spoken = buildVideoGuideEdits({
			steps,
			timelineDurationMs: 24_000,
			currentState: state(),
			captionTrack,
		});
		expect(spoken.summary.trimCount).toBeLessThan(silent.summary.trimCount);
	});

	it("projects steps through an offset recording clip", () => {
		const currentState = state({
			videoClips: [
				{
					id: "clip-1",
					sourceVideoPath: "/tmp/rec.mp4",
					startMs: 1_000, // first second of the recording trimmed away
					endMs: 21_000,
					offsetMs: 5_000, // intro sits before the recording
					durationMs: 20_000,
					sourceType: "recording",
				},
			],
		});
		const { summary, windows } = buildVideoGuideEdits({
			steps: [step(1, 500), step(2, 10_000)],
			timelineDurationMs: 25_000,
			currentState,
			captionTrack: null,
		});
		// Step at 500ms in recording time lands before the clip's in-point → dropped
		expect(summary.stepCount).toBe(1);
		// Step at 10s maps to 10_000 + (5_000 - 1_000) = 14_000 on the timeline
		expect(windows[0].startMs).toBe(13_500);
	});

	it("respects disabled options", () => {
		const { edits } = buildVideoGuideEdits({
			steps: [step(1, 2_000)],
			timelineDurationMs: 10_000,
			currentState: state(),
			captionTrack: null,
			options: { highlights: false, trimIdle: false, zooms: false },
		});
		expect(edits.annotationRegions).toBeUndefined();
		expect(edits.showClickRings).toBeUndefined();
		expect(edits.trimRegions).toBeUndefined();
		expect(edits.zoomRegions).toEqual([]);
	});

	it("loom style keeps the screen natural: no highlights or zooms, idle still trimmed", () => {
		expect(DEFAULT_VIDEO_GUIDE_OPTIONS.style).toBe("tutorial");
		expect(LOOM_VIDEO_GUIDE_OPTIONS.style).toBe("loom");

		const steps = [step(1, 2_000), step(2, 20_000)];
		const { edits, summary } = buildVideoGuideEdits({
			steps,
			timelineDurationMs: 30_000,
			currentState: state(),
			captionTrack: null,
			options: LOOM_VIDEO_GUIDE_OPTIONS,
		});

		expect(edits.annotationRegions).toBeUndefined();
		expect(edits.showClickRings).toBeUndefined();
		expect(edits.zoomRegions).toEqual([]);
		expect(summary.trimCount).toBeGreaterThanOrEqual(1);
		// Voiceover still rides on the per-step windows
		expect(summary.stepCount).toBe(2);
		// Loom is the raw full-bleed screen; tutorial keeps a slim frame
		expect(edits.padding).toBe(0);
		expect(edits.borderRadius).toBe(0);
	});

	it("presents the screen big: slim frame and close-up zooms in tutorial style", () => {
		const { edits } = buildVideoGuideEdits({
			steps: [step(1, 2_000)],
			timelineDurationMs: 10_000,
			currentState: state(),
			captionTrack: null,
		});
		expect(edits.padding).toBe(16);
		expect(edits.borderRadius).toBe(12);
		// Depth 4 = 2.2× close-up (editor default 3 = 1.8× reads too distant)
		expect(edits.zoomRegions?.[0]?.depth).toBe(4);
	});

	it("exposes per-step windows for voiceover timing", () => {
		const { windows } = buildVideoGuideEdits({
			steps: [step(1, 2_000), step(2, 10_000)],
			timelineDurationMs: 20_000,
			currentState: state(),
			captionTrack: null,
		});
		expect(windows).toHaveLength(2);
		expect(windows[0].step.index).toBe(1);
		expect(windows[0].startMs).toBe(1_500);
	});
});
