import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { applyStepTitles, buildStepTitlePrompt, detectGuideSteps } from "./guideSteps";
import type { CaptionTrack } from "./types";

function click(
	timeMs: number,
	cx: number,
	cy: number,
	clickType?: "left" | "double",
): CursorTelemetryPoint {
	return { timeMs, cx, cy, clickType: clickType ?? "left", interactionType: "click" };
}

function move(timeMs: number, cx: number, cy: number): CursorTelemetryPoint {
	return { timeMs, cx, cy, interactionType: "move" };
}

describe("detectGuideSteps", () => {
	it("returns one step per distinct click", () => {
		const telemetry = [
			move(0, 0.1, 0.1),
			click(1_000, 0.2, 0.2),
			move(2_000, 0.5, 0.5),
			click(5_000, 0.8, 0.8),
			click(9_000, 0.3, 0.6),
		];
		const steps = detectGuideSteps(telemetry, 10_000);
		expect(steps).toHaveLength(3);
		expect(steps.map((s) => s.index)).toEqual([1, 2, 3]);
		expect(steps[0].timeMs).toBe(1_000);
		expect(steps[2].cx).toBeCloseTo(0.3);
	});

	it("merges rapid same-spot clicks into a single step", () => {
		const telemetry = [
			click(1_000, 0.2, 0.2),
			click(1_200, 0.201, 0.2, "double"),
			click(8_000, 0.7, 0.7),
		];
		const steps = detectGuideSteps(telemetry, 10_000);
		expect(steps).toHaveLength(2);
		expect(steps[0].action).toBe("double-click");
	});

	it("keeps distant rapid clicks as separate steps", () => {
		const telemetry = [click(1_000, 0.1, 0.1), click(1_500, 0.9, 0.9)];
		const steps = detectGuideSteps(telemetry, 10_000);
		expect(steps).toHaveLength(2);
	});

	it("returns empty for empty telemetry or zero duration", () => {
		expect(detectGuideSteps([], 10_000)).toEqual([]);
		expect(detectGuideSteps([click(1_000, 0.5, 0.5)], 0)).toEqual([]);
	});

	it("attaches transcript context from the caption track", () => {
		const captionTrack: CaptionTrack = {
			id: "t1",
			language: "en",
			modelId: "base",
			createdAt: 0,
			lines: [
				{
					id: "l1",
					startMs: 500,
					endMs: 2_000,
					words: [
						{ text: "Open", startMs: 500, endMs: 900, confidence: 1 },
						{ text: "settings", startMs: 900, endMs: 1_400, confidence: 1 },
					],
				},
			],
		};
		const steps = detectGuideSteps([click(1_000, 0.5, 0.5)], 10_000, captionTrack);
		expect(steps[0].transcript).toBe("Open settings");
	});

	it("caps the number of steps at 40", () => {
		const telemetry = Array.from({ length: 200 }, (_, i) =>
			click(i * 2_000, (i % 10) / 10, ((i * 7) % 10) / 10),
		);
		const steps = detectGuideSteps(telemetry, 400_000);
		expect(steps.length).toBeLessThanOrEqual(40);
	});
});

describe("buildStepTitlePrompt", () => {
	it("returns null for no steps", () => {
		expect(buildStepTitlePrompt([])).toBeNull();
	});

	it("includes step context and narrator words", () => {
		const steps = detectGuideSteps([click(1_000, 0.5, 0.5)], 10_000).map((s) => ({
			...s,
			transcript: "click the export button",
		}));
		const prompt = buildStepTitlePrompt(steps, "Exporting a video");
		expect(prompt).toContain("Exporting a video");
		expect(prompt).toContain("click the export button");
		expect(prompt).toContain("JSON");
	});
});

describe("applyStepTitles", () => {
	const steps = detectGuideSteps([click(1_000, 0.5, 0.5), click(5_000, 0.2, 0.2)], 10_000);

	it("applies well-formed AI titles with step numbering", () => {
		const result = applyStepTitles(steps, [
			{ title: "Open the Settings menu", description: "Click the gear icon." },
			{ title: "Step 2: Choose Export", description: "" },
		]);
		expect(result[0].title).toBe("Step 1: Open the Settings menu");
		expect(result[0].description).toBe("Click the gear icon.");
		// Redundant "Step N" prefix from the model is stripped before re-numbering
		expect(result[1].title).toBe("Step 2: Choose Export");
	});

	it("keeps heuristic titles when AI output is malformed", () => {
		const result = applyStepTitles(steps, "not an array");
		expect(result[0].title).toBe(steps[0].title);
		const partial = applyStepTitles(steps, [{ nope: true }]);
		expect(partial[0].title).toBe(steps[0].title);
	});
});
