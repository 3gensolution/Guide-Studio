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
		expect(project.title).toBe("Ship it faster");
		expect(project.accent).toBe("violet");
		expect(project.scenes).toHaveLength(2);
		expect(project.scenes[0]).toMatchObject({ kind: "text", textScene: "kinetic" });
		expect(project.scenes[1]).toMatchObject({ kind: "card", backdrop: "soft-grid" });
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
});

describe("motionSystemPrompt", () => {
	it("lists every catalog id the validator accepts", () => {
		const prompt = motionSystemPrompt({ targetSeconds: 30 });
		expect(prompt).toContain('"gradient-drift"');
		expect(prompt).toContain('"kinetic"');
		expect(prompt).toContain("30 seconds");
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
