import { describe, expect, it } from "vitest";
import { filterCaptionsForMotionScenes } from "./creator";

describe("filterCaptionsForMotionScenes", () => {
	it("suppresses captions for image, video, logo, and mixed-media scenes", () => {
		const lines = [
			{ text: "Card copy", startMs: 0, endMs: 2000 },
			{ text: "Image copy", startMs: 2000, endMs: 4000 },
			{ text: "Video copy", startMs: 4000, endMs: 6000 },
			{ text: "Logo copy", startMs: 6000, endMs: 8000 },
			{ text: "Final card copy", startMs: 8000, endMs: 10000 },
		];
		const scenes = [
			{ id: "card", kind: "card" as const, durationSeconds: 2 },
			{ id: "image", kind: "image" as const, durationSeconds: 2, imageAssetId: "hero" },
			{ id: "video", kind: "video" as const, durationSeconds: 2, videoAssetId: "footage" },
			{ id: "logo", kind: "logo" as const, durationSeconds: 2, logoAssetId: "logo" },
			{
				id: "final-card",
				kind: "card" as const,
				durationSeconds: 2,
			},
		];

		expect(filterCaptionsForMotionScenes(scenes, lines)).toEqual([lines[0], lines[4]]);
	});

	it("suppresses captions for a layered scene containing supplied footage", () => {
		const scenes = [
			{
				id: "proof",
				kind: "layered" as const,
				durationSeconds: 3,
				layers: [
					{
						id: "video",
						kind: "video" as const,
						assetId: "footage",
						x: 0,
						y: 0,
						width: 1,
						height: 1,
						opacity: 1,
						rotation: 0,
						zIndex: 0,
						borderRadius: 0,
					},
				],
			},
			{ id: "card", kind: "card" as const, durationSeconds: 2 },
		];

		expect(
			filterCaptionsForMotionScenes(scenes, [
				{ text: "Proof", startMs: 0, endMs: 3000 },
				{ text: "Outcome", startMs: 3000, endMs: 5000 },
			]),
		).toEqual([{ text: "Outcome", startMs: 3000, endMs: 5000 }]);
	});
});
