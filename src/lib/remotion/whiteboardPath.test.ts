import { describe, expect, it } from "vitest";
import { pointAt, samplePath } from "./whiteboardPath";

describe("samplePath", () => {
	it("measures a straight line", () => {
		expect(samplePath("M 0 0 L 30 40").length).toBeCloseTo(50, 5);
	});

	it("follows a polyline through every corner", () => {
		const path = samplePath("M 0 0 L 10 0 L 10 10");
		expect(path.length).toBeCloseTo(20, 5);
		expect(pointAt(path, 0.5)).toEqual({ x: 10, y: 0 });
	});

	it("draws the closing edge of a closed subpath", () => {
		// Three sides of a 10×10 square, closed: the fourth side is the Z.
		const path = samplePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
		expect(path.length).toBeCloseTo(40, 5);
		expect(pointAt(path, 1)).toEqual({ x: 0, y: 0 });
	});

	it("reads relative commands", () => {
		const absolute = samplePath("M 5 5 L 15 5 L 15 15");
		const relative = samplePath("m 5 5 l 10 0 l 0 10");
		expect(relative.length).toBeCloseTo(absolute.length, 5);
		expect(pointAt(relative, 1)).toEqual({ x: 15, y: 15 });
	});

	it("treats an extra coordinate pair after a moveto as a lineto", () => {
		expect(samplePath("M 0 0 10 0").length).toBeCloseTo(10, 5);
	});

	it("approximates a curve as longer than its chord and shorter than its hull", () => {
		const curve = samplePath("M 0 0 C 0 20 20 20 20 0");
		expect(curve.length).toBeGreaterThan(20);
		expect(curve.length).toBeLessThan(60);
		expect(pointAt(curve, 1)).toEqual({ x: 20, y: 0 });
	});

	it("refuses a command it cannot flatten, rather than drawing a broken figure", () => {
		// Arcs are the one shape the catalog helpers never emit.
		expect(() => samplePath("M 0 0 A 10 10 0 0 1 20 0")).toThrow(/unsupported command/);
	});
});

describe("pointAt", () => {
	const path = samplePath("M 0 0 L 100 0");

	it("pins to the ends outside the unit range", () => {
		expect(pointAt(path, -1)).toEqual({ x: 0, y: 0 });
		expect(pointAt(path, 4)).toEqual({ x: 100, y: 0 });
	});

	it("walks the path in proportion to length", () => {
		expect(pointAt(path, 0.25).x).toBeCloseTo(25, 5);
		expect(pointAt(path, 0.9).x).toBeCloseTo(90, 5);
	});

	it("does not divide by zero on a path of no length", () => {
		expect(pointAt(samplePath("M 7 9 L 7 9"), 0.5)).toEqual({ x: 7, y: 9 });
	});
});
