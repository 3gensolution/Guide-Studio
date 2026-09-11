import { describe, expect, it } from "vitest";
import { buildWhiteboardLines, type MeasureText, schedule, wrapLine } from "./WhiteboardFrame";

/**
 * A stand-in for real text measurement: every glyph is half the font size wide.
 * The real measurer needs a laid-out DOM and reports zero under jsdom, and these
 * tests are about the wrap and the timing, not about font metrics.
 */
const measure: MeasureText = (text, size) => text.length * size * 0.5;

const FPS = 30;

describe("wrapLine", () => {
	it("keeps a line that fits on one line", () => {
		expect(wrapLine("four short words here", 40, 500, 1000, measure)).toEqual([
			"four short words here",
		]);
	});

	it("breaks after the last word that fits", () => {
		// Each character is 20px wide, so "aaa bbb ccc" is exactly 220px.
		expect(wrapLine("aaa bbb ccc ddd", 40, 500, 220, measure)).toEqual(["aaa bbb ccc", "ddd"]);
	});

	it("treats a line of exactly the maximum width as fitting", () => {
		expect(wrapLine("aaa bbb ccc", 40, 500, 220, measure)).toEqual(["aaa bbb ccc"]);
		expect(wrapLine("aaa bbb ccc", 40, 500, 219, measure)).toEqual(["aaa bbb", "ccc"]);
	});

	it("never drops a word that is wider than the line", () => {
		const [first] = wrapLine("supercalifragilistic", 40, 500, 50, measure);
		expect(first).toBe("supercalifragilistic");
	});

	it("returns nothing for empty or whitespace-only copy", () => {
		expect(wrapLine("", 40, 500, 800, measure)).toEqual([]);
		expect(wrapLine("   \n  ", 40, 500, 800, measure)).toEqual([]);
	});
});

describe("buildWhiteboardLines", () => {
	it("writes the headline first, then the bullets in order", () => {
		const lines = buildWhiteboardLines("Title", ["one", "two"], 1500, measure);
		expect(lines.map((line) => line.text)).toEqual(["Title", "one", "two"]);
	});

	it("marks only the first visual line of a wrapped bullet with a dot", () => {
		// 320px of usable width at 23px per character holds ~13 characters.
		const lines = buildWhiteboardLines(undefined, ["aaa bbb ccc ddd eee"], 390, measure);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.map((line) => line.bulleted)).toEqual([true, ...lines.slice(1).map(() => false)]);
	});

	it("produces nothing to write when the frame has no copy", () => {
		expect(buildWhiteboardLines(undefined, undefined, 1500, measure)).toEqual([]);
	});
});

/**
 * The pen has to reach the end of the last word before the frame cuts, and it
 * has to travel at one speed throughout. Both are invisible in a still and only
 * show up as a hand still writing when the next frame starts.
 */
describe("schedule", () => {
	const lines = buildWhiteboardLines(
		"A longer headline here",
		["short", "a good deal longer"],
		1500,
		measure,
	);

	it("finishes writing before the frame ends", () => {
		const duration = FPS * 8;
		const timed = schedule(lines, duration, FPS, 70, measure);
		const last = timed[timed.length - 1];
		expect(last).toBeDefined();
		expect(last?.endFrame).toBeLessThanOrEqual(duration);
	});

	it("writes at a constant speed, so a wider line gets proportionally longer", () => {
		const timed = schedule(lines, FPS * 8, FPS, 70, measure);
		const speeds = timed.map((line) => line.width / (line.endFrame - line.startFrame));
		const slowest = Math.min(...speeds);
		const fastest = Math.max(...speeds);
		// Rounding to whole frames is the only permitted variation.
		expect(fastest - slowest).toBeLessThan(fastest * 0.06);
	});

	it("leaves a pen-lift gap between consecutive lines", () => {
		const timed = schedule(lines, FPS * 8, FPS, 70, measure);
		for (let i = 1; i < timed.length; i += 1) {
			const previous = timed[i - 1];
			const current = timed[i];
			expect(current?.startFrame).toBeGreaterThan(previous?.endFrame ?? 0);
		}
	});

	it("stacks lines down the frame and indents the bullets", () => {
		const timed = schedule(lines, FPS * 8, FPS, 70, measure);
		for (let i = 1; i < timed.length; i += 1) {
			expect(timed[i]?.y).toBeGreaterThan(timed[i - 1]?.y ?? 0);
		}
		expect(timed.find((line) => line.bulleted)?.x).toBe(70);
	});

	it("still gives every line a frame to be written in when the duration is tiny", () => {
		// A frame shorter than its own settle time would otherwise hand out
		// zero-length or negative spans, and nothing would be drawn at all.
		const timed = schedule(lines, 6, FPS, 70, measure);
		for (const line of timed) {
			expect(line.endFrame).toBeGreaterThan(line.startFrame);
		}
	});

	it("divides the time evenly when nothing can be measured", () => {
		// The real measurer returns zero for every line if the font never loads.
		const timed = schedule(lines, FPS * 8, FPS, 70, () => 0);
		const spans = timed.map((line) => line.endFrame - line.startFrame);
		expect(new Set(spans).size).toBe(1);
	});
});
