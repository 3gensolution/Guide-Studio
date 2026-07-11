import { describe, expect, it } from "vitest";
import {
	findFillerWordKeys,
	flattenTranscriptWords,
	wordsToTrimRegions,
} from "./transcriptEditing";
import type { CaptionTrack, CaptionWord } from "./types";

function word(text: string, startMs: number, endMs: number): CaptionWord {
	return { text, startMs, endMs, confidence: 1 };
}

const track: CaptionTrack = {
	id: "t1",
	language: "en",
	modelId: "base",
	createdAt: 0,
	lines: [
		{
			id: "l1",
			startMs: 0,
			endMs: 2_000,
			words: [word("Um,", 0, 300), word("open", 400, 800), word("the", 850, 1_000)],
		},
		{
			id: "l2",
			startMs: 2_000,
			endMs: 4_000,
			words: [word("settings", 2_000, 2_600), word("uh", 2_700, 2_900), word("menu", 3_000, 3_500)],
		},
	],
};

describe("flattenTranscriptWords", () => {
	it("flattens all lines into time-ordered addressable words", () => {
		const words = flattenTranscriptWords(track);
		expect(words).toHaveLength(6);
		expect(words[0].key).toBe("l1:0");
		expect(words.map((w) => w.text)).toEqual(["Um,", "open", "the", "settings", "uh", "menu"]);
	});

	it("returns empty for a null track", () => {
		expect(flattenTranscriptWords(null)).toEqual([]);
	});
});

describe("findFillerWordKeys", () => {
	it("matches fillers case-insensitively and ignores punctuation", () => {
		const keys = findFillerWordKeys(flattenTranscriptWords(track));
		expect(keys).toEqual(new Set(["l1:0", "l2:1"]));
	});

	it("does not flag real words", () => {
		const keys = findFillerWordKeys(flattenTranscriptWords(track));
		expect(keys.has("l1:1")).toBe(false);
	});
});

describe("wordsToTrimRegions", () => {
	const words = flattenTranscriptWords(track);

	it("pads cuts and clamps to video bounds", () => {
		const um = words.filter((w) => w.key === "l1:0");
		const [region] = wordsToTrimRegions(um, 10_000);
		expect(region.startMs).toBe(0); // 0 - 30 clamps to 0
		expect(region.endMs).toBe(330); // 300 + 30 padding
	});

	it("merges consecutive selected words into one region", () => {
		const consecutive = words.filter((w) => w.key === "l1:1" || w.key === "l1:2");
		const regions = wordsToTrimRegions(consecutive, 10_000);
		expect(regions).toHaveLength(1);
		expect(regions[0].startMs).toBe(370);
		expect(regions[0].endMs).toBe(1_030);
	});

	it("keeps distant words as separate regions", () => {
		const distant = words.filter((w) => w.key === "l1:0" || w.key === "l2:1");
		const regions = wordsToTrimRegions(distant, 10_000);
		expect(regions).toHaveLength(2);
	});

	it("returns empty for no selection", () => {
		expect(wordsToTrimRegions([], 10_000)).toEqual([]);
	});
});
