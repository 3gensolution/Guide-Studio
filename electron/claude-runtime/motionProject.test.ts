import { describe, expect, it } from "vitest";
import {
	MOTION_LIMITS,
	motionDurationSeconds,
	motionSystemPrompt,
	normalizeMotionProject,
} from "./motionProject";

const OPTIONS = { fallbackTitle: "Export pipeline" };

const GOOD = {
	title: "Ship it faster",
	accent: "violet",
	scenes: [
		{ kind: "text", durationSeconds: 3, textScene: "kinetic", text: "Ship it faster" },
		{
			kind: "card",
			durationSeconds: 5,
			backdrop: "soft-grid",
			eyebrow: "The problem",
			headline: "Every walkthrough costs a morning",
			bullets: ["Record", "Trim", "Export"],
		},
	],
};

describe("normalizeMotionProject", () => {
	it("keeps a well-formed plan intact", () => {
		const { project, warnings } = normalizeMotionProject(GOOD, OPTIONS);
		expect(warnings).toEqual([]);
		expect(project.creativeSkill).toBe("explainer-motion");
		expect(project.title).toBe("Ship it faster");
		expect(project.accent).toBe("violet");
		expect(project.scenes).toHaveLength(2);
		expect(project.scenes[0]).toMatchObject({ kind: "text", textScene: "kinetic" });
		expect(project.scenes[1]).toMatchObject({ kind: "card", backdrop: "soft-grid" });
	});

	it("preserves an explicit creative skill profile", () => {
		const { project } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			creativeSkill: "product-launch",
		});
		expect(project.creativeSkill).toBe("product-launch");
		expect(motionSystemPrompt({ creativeSkill: "product-launch" })).toContain("Product launch");
	});

	it("falls back to indigo for an unknown accent", () => {
		const { project } = normalizeMotionProject({ ...GOOD, accent: "chartreuse" }, OPTIONS);
		expect(project.accent).toBe("indigo");
	});

	it("turns an unknown typography id into a card rather than a blank scene", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{ kind: "text", durationSeconds: 3, textScene: "hologram", headline: "Ship faster" },
					GOOD.scenes[1],
				],
			},
			OPTIONS,
		);
		expect(project.scenes[0].kind).toBe("card");
		expect(warnings.some((warning) => warning.includes("unknown typography"))).toBe(true);
	});

	it("substitutes a default for an unknown backdrop", () => {
		const { project, warnings } = normalizeMotionProject(
			{ ...GOOD, scenes: [{ kind: "card", durationSeconds: 4, backdrop: "lava", headline: "Hi" }] },
			OPTIONS,
		);
		expect(project.scenes.at(-1)?.backdrop).toBe("gradient-drift");
		expect(warnings.some((warning) => warning.includes("unknown backdrop"))).toBe(true);
	});

	it("breaks up a repeated backdrop on consecutive scenes", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{ kind: "card", durationSeconds: 4, backdrop: "ripples", headline: "One" },
					{ kind: "card", durationSeconds: 4, backdrop: "ripples", headline: "Two" },
				],
			},
			OPTIONS,
		);
		expect(project.scenes[0].backdrop).toBe("ripples");
		expect(project.scenes[1].backdrop).not.toBe("ripples");
		expect(warnings.some((warning) => warning.includes("repeated the previous backdrop"))).toBe(
			true,
		);
	});

	it("clamps durations into the renderable range", () => {
		const { project } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{ kind: "card", durationSeconds: 900, backdrop: "ripples", headline: "Long" },
					{ kind: "card", durationSeconds: 0.1, backdrop: "sparks", headline: "Short" },
				],
			},
			OPTIONS,
		);
		expect(project.scenes[0].durationSeconds).toBe(MOTION_LIMITS.maxSceneSeconds);
		expect(project.scenes[1].durationSeconds).toBe(MOTION_LIMITS.minSceneSeconds);
	});

	it("truncates copy that would overflow the layout", () => {
		const long = "x".repeat(400);
		const { project } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [{ kind: "card", durationSeconds: 4, backdrop: "ripples", headline: long }],
			},
			OPTIONS,
		);
		const headline = project.scenes.at(-1)?.headline ?? "";
		expect(headline.length).toBeLessThanOrEqual(MOTION_LIMITS.headline);
		expect(headline.endsWith("…")).toBe(true);
	});

	it("caps the scene count", () => {
		const many = Array.from({ length: 30 }, (_, index) => ({
			kind: "card",
			durationSeconds: 2,
			backdrop: index % 2 ? "ripples" : "sparks",
			headline: `Scene ${index}`,
		}));
		const { project, warnings } = normalizeMotionProject({ ...GOOD, scenes: many }, OPTIONS);
		expect(project.scenes.length).toBeLessThanOrEqual(MOTION_LIMITS.maxScenes);
		expect(warnings.some((warning) => warning.includes("Kept the first"))).toBe(true);
	});

	it("drops a card with no copy at all", () => {
		const { warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [...GOOD.scenes, { kind: "card", durationSeconds: 3, backdrop: "sparks" }],
			},
			OPTIONS,
		);
		expect(warnings.some((warning) => warning.includes("no copy to show"))).toBe(true);
	});

	it("still produces a renderable project from garbage", () => {
		const { project, warnings } = normalizeMotionProject("not json at all", OPTIONS);
		expect(project.scenes.length).toBeGreaterThanOrEqual(1);
		expect(project.title).toBe("Export pipeline");
		expect(warnings.length).toBeGreaterThan(0);
	});

	it("keeps a valid supplied logo as a first-class reveal scene", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					...GOOD.scenes,
					{ kind: "logo", durationSeconds: 4, logoAssetId: "spacemail-logo" },
				],
			},
			{
				...OPTIONS,
				availableAssetIds: ["spacemail-logo"],
			},
		);
		expect(warnings).toEqual([]);
		expect(project.scenes.at(-1)).toMatchObject({
			kind: "logo",
			logoAssetId: "spacemail-logo",
		});
	});

	it("merges a closing tagline into the supplied logo scene", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					GOOD.scenes[0],
					{ kind: "logo", durationSeconds: 3, logoAssetId: "guide-logo" },
					{ kind: "text", durationSeconds: 3, textScene: "gradient", text: "Learn By Doing" },
				],
			},
			{
				...OPTIONS,
				availableAssetIds: ["guide-logo"],
			},
		);
		expect(project.scenes).toHaveLength(2);
		expect(project.scenes.at(-1)).toMatchObject({
			kind: "logo",
			tagline: "Learn By Doing",
			durationSeconds: 6,
		});
		expect(warnings).toContain("Merged the closing tagline into the supplied logo reveal.");
	});

	it("adds the supplied logo as the closing reveal when the request requires it", () => {
		const { project, warnings } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			availableAssetIds: ["spacemail-logo"],
			defaultLogoAssetId: "spacemail-logo",
			requireLogoReveal: true,
		});
		expect(project.logoAssetId).toBe("spacemail-logo");
		expect(project.scenes.at(-1)).toMatchObject({
			kind: "logo",
			logoAssetId: "spacemail-logo",
		});
		expect(warnings).toContain("Added the supplied logo as the closing reveal.");
	});

	it("normalizes image scenes and can prevent a text-only motion cut", () => {
		const { project, warnings } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			availableAssetIds: ["product-hero"],
			defaultImageAssetId: "product-hero",
			requireImageScene: true,
		});
		expect(project.scenes.some((scene) => scene.kind === "image")).toBe(true);
		expect(project.scenes.find((scene) => scene.kind === "image")).toMatchObject({
			imageAssetId: "product-hero",
			imageMotion: "ken-burns",
		});
		expect(warnings).toContain("Added a supplied visual scene so the motion cut is not text-only.");

		const explicit = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{
						kind: "image",
						durationSeconds: 4,
						imageAssetId: "product-hero",
						imageMotion: "parallax",
					},
					GOOD.scenes[1],
				],
			},
			{ ...OPTIONS, availableAssetIds: ["product-hero"] },
		);
		expect(explicit.project.scenes[0]).toMatchObject({
			kind: "image",
			imageAssetId: "product-hero",
			imageMotion: "parallax",
		});
	});

	it("normalizes attached video ranges against probed source duration", () => {
		const { project } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{
						kind: "video",
						durationSeconds: 6,
						videoAssetId: "launch-footage",
						sourceStartSeconds: 18,
						sourceDurationSeconds: 12,
						videoMotion: "push-in",
					},
					GOOD.scenes[1],
				],
			},
			{
				...OPTIONS,
				availableVideoAssetIds: ["launch-footage"],
				videoDurations: { "launch-footage": 24 },
			},
		);

		expect(project.scenes[0]).toMatchObject({
			kind: "video",
			videoAssetId: "launch-footage",
			sourceStartSeconds: 18,
			sourceDurationSeconds: 6,
			videoMotion: "push-in",
		});
		expect(project.scenes[0]?.durationSeconds).toBe(6);
	});

	it("snaps an attached video scene to detected shot boundaries", () => {
		const { project } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{
						kind: "video",
						durationSeconds: 4,
						videoAssetId: "launch-footage",
						sourceStartSeconds: 2.2,
						sourceDurationSeconds: 3.2,
					},
					GOOD.scenes[1],
				],
			},
			{
				...OPTIONS,
				availableVideoAssetIds: ["launch-footage"],
				videoDurations: { "launch-footage": 10 },
				videoShotSegments: {
					"launch-footage": [
						{ startSeconds: 0, endSeconds: 2, midpointSeconds: 1 },
						{ startSeconds: 2, endSeconds: 5.5, midpointSeconds: 3.8 },
					],
				},
			},
		);

		expect(project.scenes[0]).toMatchObject({
			kind: "video",
			sourceStartSeconds: 2,
			sourceDurationSeconds: 3.5,
		});
	});

	it("injects an attached video scene when a video reference is available", () => {
		const { project, warnings } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			availableVideoAssetIds: ["source-footage"],
			videoDurations: { "source-footage": 10 },
			videoShotSegments: {
				"source-footage": [{ startSeconds: 2, endSeconds: 6, midpointSeconds: 4 }],
			},
			defaultVideoAssetId: "source-footage",
			requireVideoScene: true,
		});

		expect(project.scenes.some((scene) => scene.kind === "video")).toBe(true);
		expect(project.scenes.find((scene) => scene.kind === "video")).toMatchObject({
			videoAssetId: "source-footage",
			sourceStartSeconds: 2,
			sourceDurationSeconds: 4,
			videoMotion: "push-in",
		});
		expect(warnings).toContain(
			"Added an attached source-video scene so the motion cut preserves product footage.",
		);
	});

	it("does not discard attached footage when probing has no duration metadata", () => {
		const { project } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			availableVideoAssetIds: ["source-footage"],
			defaultVideoAssetId: "source-footage",
			requireVideoScene: true,
		});
		const video = project.scenes.find((scene) => scene.kind === "video");
		expect(video).toMatchObject({ kind: "video", videoAssetId: "source-footage" });
		expect(video?.sourceDurationSeconds).toBeUndefined();
	});

	it("normalizes a mixed-media layered scene with valid image, video, and text layers", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{
						kind: "layered",
						durationSeconds: 5,
						layers: [
							{
								id: "footage",
								kind: "video",
								assetId: "launch-footage",
								x: 0.1,
								y: 0.1,
								width: 0.8,
								height: 0.6,
								motion: "push-in",
							},
							{
								id: "hero",
								kind: "image",
								assetId: "product-hero",
								x: -0.2,
								y: 0.2,
								width: 1.5,
								height: 0.5,
								motion: "drift",
							},
							{
								id: "headline",
								kind: "text",
								text: "See the workflow",
								x: 0.1,
								y: 0.75,
								width: 0.8,
								height: 0.15,
								color: "primary",
							},
						],
					},
					GOOD.scenes[1],
				],
			},
			{
				...OPTIONS,
				availableAssetIds: ["product-hero"],
				availableVideoAssetIds: ["launch-footage"],
			},
		);
		const layered = project.scenes[0];
		expect(warnings).toEqual([]);
		expect(layered.kind).toBe("layered");
		expect(layered.layers).toHaveLength(3);
		expect(layered.layers?.[0]).toMatchObject({ kind: "video", assetId: "launch-footage" });
		expect(layered.layers?.[1]?.x).toBe(0);
		expect(layered.layers?.[1]?.width).toBe(1);
		expect(layered.layers?.[2]).toMatchObject({ kind: "text", text: "See the workflow" });
	});

	it("drops layered asset layers that do not belong to the staged session", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{
						kind: "layered",
						durationSeconds: 4,
						layers: [
							{
								kind: "video",
								assetId: "not-staged",
								x: 0,
								y: 0,
								width: 1,
								height: 1,
							},
							{ kind: "text", text: "Still useful", x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
						],
					},
					GOOD.scenes[1],
				],
			},
			OPTIONS,
		);
		expect(project.scenes[0]).toMatchObject({ kind: "layered" });
		expect(project.scenes[0].layers).toHaveLength(1);
		expect(project.scenes[0].layers?.[0]).toMatchObject({ kind: "text", text: "Still useful" });
		expect(warnings).toEqual([]);
	});

	it("builds a source-footage-led layered explainer when footage is attached", () => {
		const { project, warnings } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			creativeSkill: "explainer-motion",
			availableVideoAssetIds: ["source-footage"],
			videoDurations: { "source-footage": 10 },
			defaultVideoAssetId: "source-footage",
			requireLayeredScene: true,
		});
		const layered = project.scenes.find((scene) => scene.kind === "layered");
		expect(layered?.layers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "video", assetId: "source-footage" }),
			]),
		);
		expect(warnings).toContain(
			"Converted 2 text/card beats into source-footage-led editorial motion.",
		);
	});

	it("builds a collage proof beat for a product launch with supplied footage", () => {
		const { project } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			creativeSkill: "product-launch",
			availableVideoAssetIds: ["launch-footage"],
			videoDurations: { "launch-footage": 10 },
			defaultVideoAssetId: "launch-footage",
			requireLayeredScene: true,
		});
		const layered = project.scenes.find((scene) => scene.kind === "layered");
		expect(layered).toMatchObject({ motionPreset: "collage" });
		expect(layered?.layers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "video", assetId: "launch-footage" }),
			]),
		);
	});

	it("keeps a product launch footage-led instead of allowing text-only beats", () => {
		const { project, warnings } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			creativeSkill: "product-launch",
			availableVideoAssetIds: ["launch-footage"],
			videoDurations: { "launch-footage": 10 },
			defaultVideoAssetId: "launch-footage",
			requireVideoScene: true,
			requireLayeredScene: true,
		});
		const visualScenes = project.scenes.filter(
			(scene) =>
				scene.kind === "video" ||
				scene.kind === "layered" ||
				scene.layers?.some((layer) => layer.kind === "video"),
		);
		expect(visualScenes.length).toBeGreaterThan(0);
		expect(
			visualScenes.some(
				(scene) =>
					scene.kind === "video" ||
					scene.layers?.some(
						(layer) => layer.kind === "video" && layer.assetId === "launch-footage",
					),
			),
		).toBe(true);
		expect(warnings).not.toContain("Attached source video is available, but no scene uses it.");
	});

	it("subdivides a long source segment and moves excess launch copy onto footage", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{ kind: "text", durationSeconds: 3, textScene: "kinetic", text: "Hook" },
					{ kind: "card", durationSeconds: 4, backdrop: "soft-grid", headline: "Problem" },
					{ kind: "card", durationSeconds: 4, backdrop: "ripples", headline: "Proof" },
					{ kind: "card", durationSeconds: 4, backdrop: "sparks", headline: "Outcome" },
				],
			},
			{
				...OPTIONS,
				creativeSkill: "product-launch",
				availableVideoAssetIds: ["launch-footage"],
				videoDurations: { "launch-footage": 30 },
				videoShotSegments: {
					"launch-footage": [{ startSeconds: 0, endSeconds: 30, midpointSeconds: 15 }],
				},
				defaultVideoAssetId: "launch-footage",
				requireVideoScene: true,
				requireLayeredScene: true,
			},
		);
		const footageScenes = project.scenes.filter(
			(scene) => scene.kind === "video" || scene.layers?.some((layer) => layer.kind === "video"),
		);
		const ranges = footageScenes
			.map((scene) =>
				scene.kind === "video"
					? scene.sourceStartSeconds
					: scene.layers?.find((layer) => layer.kind === "video")?.sourceStartSeconds,
			)
			.filter((value): value is number => value !== undefined);
		expect(new Set(ranges).size).toBe(ranges.length);
		expect(
			project.scenes.filter((scene) => scene.kind === "text" || scene.kind === "card"),
		).toHaveLength(2);
		expect(warnings).toContain(
			"Moved 2 excess launch copy beats onto distinct source-footage ranges.",
		);
	});

	it("uses multiple approved images in the product launch collage", () => {
		const { project } = normalizeMotionProject(GOOD, {
			...OPTIONS,
			creativeSkill: "product-launch",
			availableAssetIds: ["image-1", "image-2"],
			availableVideoAssetIds: ["launch-footage"],
			videoDurations: { "launch-footage": 10 },
			defaultImageAssetId: "image-1",
			defaultVideoAssetId: "launch-footage",
			supportingImageAssetIds: ["image-1", "image-2"],
			requireLayeredScene: true,
		});
		const layered = project.scenes.find((scene) => scene.kind === "layered");
		expect(layered?.layers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "image", assetId: "image-1" }),
				expect.objectContaining({ kind: "image", assetId: "image-2" }),
				expect.objectContaining({ kind: "video", assetId: "launch-footage" }),
			]),
		);
	});

	it("keeps explainer copy on real footage instead of rendering isolated text cards", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{
						kind: "text",
						durationSeconds: 2.5,
						textScene: "kinetic",
						text: "Make help feel instant",
					},
					{
						kind: "card",
						durationSeconds: 4,
						backdrop: "soft-grid",
						headline: "Guidance appears in context",
						subhead: "Show the next step on the screen where work happens.",
					},
				],
			},
			{
				...OPTIONS,
				creativeSkill: "explainer-motion",
				availableVideoAssetIds: ["source-footage"],
				videoDurations: { "source-footage": 20 },
				videoShotSegments: {
					"source-footage": [
						{ startSeconds: 0, endSeconds: 5, midpointSeconds: 2.5 },
						{ startSeconds: 8, endSeconds: 14, midpointSeconds: 11 },
					],
				},
				defaultVideoAssetId: "source-footage",
				requireLayeredScene: true,
			},
		);

		expect(project.scenes.every((scene) => scene.kind !== "text" && scene.kind !== "card")).toBe(
			true,
		);
		expect(project.scenes[0]).toMatchObject({ kind: "layered" });
		expect(project.scenes[0]?.layers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "video", assetId: "source-footage" }),
				expect.objectContaining({ kind: "text", text: "Make help feel instant" }),
			]),
		);
		const videoLayer = project.scenes[0]?.layers?.find((layer) => layer.kind === "video");
		const copySurface = project.scenes[0]?.layers?.find((layer) => layer.id === "copy-surface");
		expect(videoLayer).toMatchObject({ x: 0.39, width: 0.55, height: 0.82 });
		expect(copySurface).toMatchObject({ x: 0.055, width: 0.29, zIndex: 2 });
		expect(warnings).toContain(
			"Converted 2 text/card beats into source-footage-led editorial motion.",
		);
	});

	it("reframes full-frame layered footage instead of keeping a dark caption panel", () => {
		const { project, warnings } = normalizeMotionProject(
			{
				...GOOD,
				scenes: [
					{
						kind: "layered",
						durationSeconds: 4,
						layers: [
							{ kind: "video", assetId: "source-footage", x: 0, y: 0, width: 1, height: 1 },
							{ kind: "shape", color: "surface", x: 0, y: 0.7, width: 1, height: 0.3 },
							{ kind: "text", text: "Your customer just signed up.", x: 0.08, y: 0.78 },
						],
					},
					GOOD.scenes[1],
				],
			},
			{
				...OPTIONS,
				availableVideoAssetIds: ["source-footage"],
				videoDurations: { "source-footage": 20 },
				defaultVideoAssetId: "source-footage",
				creativeSkill: "explainer-motion",
				requireLayeredScene: true,
			},
		);
		expect(project.scenes[0]?.kind).toBe("layered");
		expect(project.scenes[0]?.layers?.find((layer) => layer.kind === "video")).toMatchObject({
			x: 0.39,
			width: 0.55,
		});
		expect(warnings).toContain(
			"Reframed layered source footage in scene 1 so captions do not sit on a dark lower-third.",
		);
	});
});

describe("motionSystemPrompt", () => {
	it("lists every catalog id the validator accepts", () => {
		const prompt = motionSystemPrompt({ targetSeconds: 30 });
		expect(prompt).toContain('"gradient-drift"');
		expect(prompt).toContain('"kinetic"');
		expect(prompt).toContain("30 seconds");
	});

	it("gives the planner the supplied asset id and logo-scene contract", () => {
		const prompt = motionSystemPrompt({
			assets: [
				{
					id: "spacemail-logo",
					label: "Spacemail logo.svg",
					kind: "image",
					role: "brand",
					fileName: "assets/spacemail-logo.svg",
				},
			],
			defaultLogoAssetId: "spacemail-logo",
		});
		expect(prompt).toContain('"spacemail-logo"');
		expect(prompt).toContain('"kind":"text"|"card"|"image"|"video"|"logo"|"layered"');
		expect(prompt).toContain("assets/spacemail-logo.svg");
		expect(prompt).toContain('"image" scene');
		expect(prompt).toContain('"video" scene');
		expect(prompt).toContain("never spell a logo as ordinary text");
		expect(prompt).toContain("Never create a separate final text scene");
	});

	it("tightens the guidance for vertical output", () => {
		expect(motionSystemPrompt({ format: "vertical" })).toContain("vertically for a phone");
	});
});

describe("motionDurationSeconds", () => {
	it("sums the scene durations", () => {
		const { project } = normalizeMotionProject(GOOD, OPTIONS);
		expect(motionDurationSeconds(project)).toBe(8);
	});
});
