import { describe, expect, it } from "vitest";
import {
	deriveChapters,
	formatChapterTimestamp,
	parsePublishKitResponse,
	renderDescriptionWithChapters,
} from "./publishKit";
import type { GuideStep } from "./types";

function step(index: number, timeMs: number, title: string): GuideStep {
	return {
		id: `step-${index}`,
		index,
		timeMs,
		cx: 0.5,
		cy: 0.5,
		action: "click",
		title,
		description: "",
		transcript: "",
	};
}

describe("formatChapterTimestamp", () => {
	it("formats mm:ss and h:mm:ss", () => {
		expect(formatChapterTimestamp(0)).toBe("0:00");
		expect(formatChapterTimestamp(65_000)).toBe("1:05");
		expect(formatChapterTimestamp(3_725_000)).toBe("1:02:05");
	});
});

describe("deriveChapters", () => {
	it("starts at 0:00 and enforces the 10s YouTube minimum gap", () => {
		const steps = [
			step(1, 5_000, "Step 1: Too close to intro"),
			step(2, 15_000, "Step 2: Open settings"),
			step(3, 18_000, "Step 3: Too close to previous"),
			step(4, 40_000, "Step 4: Export the video"),
		];
		const chapters = deriveChapters(steps, 120_000);
		expect(chapters[0]).toEqual({ timeMs: 0, title: "Intro" });
		expect(chapters.map((c) => c.timeMs)).toEqual([0, 15_000, 40_000]);
		// "Step N:" prefixes are stripped for chapter titles
		expect(chapters[1].title).toBe("Open settings");
	});

	it("drops chapters too close to the end of the video", () => {
		const steps = [step(1, 55_000, "Step 1: Near the end")];
		const chapters = deriveChapters(steps, 60_000);
		expect(chapters).toHaveLength(1);
	});
});

describe("parsePublishKitResponse", () => {
	const chapters = [
		{ timeMs: 0, title: "Intro" },
		{ timeMs: 30_000, title: "Open settings" },
	];

	it("parses a complete response and applies improved chapter titles", () => {
		const kit = parsePublishKitResponse(
			{
				titles: ["How to Export in Guide Studio", "Guide Studio Export Tutorial"],
				description: "Learn how to export.",
				tags: ["tutorial", "export"],
				chapterTitles: ["Welcome", "Settings Deep-Dive"],
			},
			chapters,
		);
		expect(kit.titles).toHaveLength(2);
		expect(kit.chapters[1].title).toBe("Settings Deep-Dive");
		expect(kit.tags).toEqual(["tutorial", "export"]);
	});

	it("tolerates malformed output and keeps original chapters", () => {
		const kit = parsePublishKitResponse({ titles: "nope", chapterTitles: [42] }, chapters);
		expect(kit.titles).toEqual([]);
		expect(kit.description).toBe("");
		expect(kit.chapters).toEqual(chapters);
	});
});

describe("renderDescriptionWithChapters", () => {
	it("appends the chapter list after the prose", () => {
		const text = renderDescriptionWithChapters({
			titles: [],
			description: "A quick tutorial.",
			tags: [],
			chapters: [
				{ timeMs: 0, title: "Intro" },
				{ timeMs: 90_000, title: "Export" },
			],
		});
		expect(text).toBe("A quick tutorial.\n\n0:00 Intro\n1:30 Export");
	});
});
