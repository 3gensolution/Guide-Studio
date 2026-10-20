import { describe, expect, it } from "vitest";
import {
	applyLaunchFilmMetadata,
	launchFilmReadinessWarnings,
	launchFilmStructureWarnings,
	launchFilmSystemPrompt,
} from "./launchFilm";

describe("launch-film editorial contract", () => {
	it("describes an arc and keeps captions off visual proof", () => {
		const prompt = launchFilmSystemPrompt();
		expect(prompt).toContain("hook → problem or tension → product proof");
		expect(prompt).toContain("Keep captions off image, video, logo");
	});

	it("adds deterministic editorial metadata to a launch sequence", () => {
		const scenes = applyLaunchFilmMetadata([
			{ id: "hook", kind: "text", durationSeconds: 2 },
			{ id: "proof", kind: "video", durationSeconds: 4 },
			{ id: "logo", kind: "logo", durationSeconds: 4 },
		]);
		expect(scenes[0]).toMatchObject({ beatRole: "hook", captionsAllowed: true });
		expect(scenes[1]).toMatchObject({ beatRole: "product-proof", captionsAllowed: false });
		expect(scenes[2]).toMatchObject({ beatRole: "logo-lockup", captionsAllowed: false });
		expect(scenes.map((scene) => scene.transitionIn)).toEqual(["cut", "crossfade", "match-cut"]);
	});

	it("keeps explicit editorial choices while enforcing visual caption safety", () => {
		const [scene] = applyLaunchFilmMetadata(
			[{ id: "motion-1", kind: "video", durationSeconds: 4 }],
			[
				{
					kind: "video",
					beatRole: "feature-reveal",
					motionPreset: "match-cut",
					transitionIn: "wipe",
					captionsAllowed: true,
				},
			],
		);
		expect(scene).toMatchObject({
			beatRole: "feature-reveal",
			motionPreset: "match-cut",
			transitionIn: "wipe",
			captionsAllowed: false,
		});
	});

	it("breaks up consecutive identical typography reveals", () => {
		const scenes = applyLaunchFilmMetadata([
			{ id: "one", kind: "text", durationSeconds: 2, textScene: "kinetic" },
			{ id: "two", kind: "text", durationSeconds: 2, textScene: "kinetic" },
			{ id: "three", kind: "text", durationSeconds: 2, textScene: "kinetic" },
		]);
		expect(scenes.map((scene) => scene.textScene)).toEqual(["kinetic", "mask-reveal", "kinetic"]);
	});

	it("uses match-cut continuity between adjacent visual beats", () => {
		const scenes = applyLaunchFilmMetadata([
			{ id: "image", kind: "image", durationSeconds: 3 },
			{ id: "video", kind: "video", durationSeconds: 3 },
			{ id: "copy", kind: "text", durationSeconds: 2 },
		]);
		expect(scenes[1]?.transitionIn).toBe("match-cut");
		expect(scenes[2]?.transitionIn).toBe("crossfade");
	});

	it("flags weak launch structure without making it a hard render failure", () => {
		const scenes = applyLaunchFilmMetadata([
			{ id: "one", kind: "text", durationSeconds: 2 },
			{ id: "two", kind: "card", durationSeconds: 2 },
			{ id: "three", kind: "card", durationSeconds: 2 },
		]);
		const warnings = launchFilmStructureWarnings(scenes, {
			hasVisualAsset: true,
			requireLogo: true,
		});
		expect(warnings).toEqual(
			expect.arrayContaining([
				"Launch-film opening is text-led; prefer a visual hook when supplied media exists.",
				"Launch film has fewer than two visual-proof beats despite available media.",
				"Launch film does not end with the supplied logo lockup.",
			]),
		);
	});

	it("flags plans that ignore supplied media or weaken the closing lockup", () => {
		const scenes = applyLaunchFilmMetadata([
			{ id: "one", kind: "card", durationSeconds: 3 },
			{ id: "two", kind: "text", durationSeconds: 3 },
			{ id: "three", kind: "logo", durationSeconds: 3 },
		]);
		const warnings = launchFilmReadinessWarnings(scenes, {
			hasVisualAsset: true,
			hasVideoAsset: true,
			hasImageAsset: true,
			requireLogo: true,
			availableAssetIds: ["brand-logo"],
			availableVideoAssetIds: ["source-video"],
		});
		expect(warnings).toEqual(
			expect.arrayContaining([
				"Attached source video is available, but no scene uses it.",
				"Scene 3 is a logo scene without a validated asset.",
				"The closing logo lockup has no supplied logo asset.",
			]),
		);
	});

	it("accepts an asset-backed visual launch sequence", () => {
		const scenes = applyLaunchFilmMetadata([
			{ id: "one", kind: "image", durationSeconds: 3, imageAssetId: "product-image" },
			{ id: "two", kind: "video", durationSeconds: 4, videoAssetId: "source-video" },
			{ id: "three", kind: "logo", durationSeconds: 4, logoAssetId: "brand-logo" },
		]);
		expect(
			launchFilmReadinessWarnings(scenes, {
				hasVisualAsset: true,
				hasVideoAsset: true,
				hasImageAsset: true,
				requireLogo: true,
				availableAssetIds: ["product-image", "brand-logo"],
				availableVideoAssetIds: ["source-video"],
			}),
		).toEqual([]);
	});
});
