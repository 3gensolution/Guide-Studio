import { describe, expect, it } from "vitest";
import { DOODLE_GRID, DOODLES, describeDoodles, getDoodle, isDoodleId } from "./whiteboardDoodles";
import { samplePath } from "./whiteboardPath";

/**
 * Nobody can eyeball forty drawings on every change, and a doodle that has
 * drifted off its grid does not fail a render — it renders a picture with a leg
 * cut off. These are the checks that catch that without a screenshot.
 */
describe("the doodle catalog", () => {
	it("has unique ids", () => {
		expect(new Set(DOODLES.map((doodle) => doodle.id)).size).toBe(DOODLES.length);
	});

	it("gives every doodle something to draw", () => {
		for (const doodle of DOODLES) {
			expect(doodle.strokes.length, doodle.id).toBeGreaterThan(0);
		}
	});

	it.each(
		DOODLES.map((doodle) => [doodle.id, doodle] as const),
	)("%s is drawable, and stays inside its grid", (id, doodle) => {
		for (const [index, stroke] of doodle.strokes.entries()) {
			const path = samplePath(stroke.d);
			expect(path.length, `${id} stroke ${index} has no length`).toBeGreaterThan(0);
			for (const point of path.points) {
				// A little slack: a stroke is drawn with a round cap a few pixels
				// wide, so touching the very edge of the grid is fine.
				expect(point.x, `${id} stroke ${index} runs off the side`).toBeGreaterThanOrEqual(-6);
				expect(point.x, `${id} stroke ${index} runs off the side`).toBeLessThanOrEqual(
					DOODLE_GRID + 6,
				);
				expect(point.y, `${id} stroke ${index} runs off the top or bottom`).toBeGreaterThanOrEqual(
					-6,
				);
				expect(point.y, `${id} stroke ${index} runs off the top or bottom`).toBeLessThanOrEqual(
					DOODLE_GRID + 6,
				);
			}
		}
	});

	it("fills only closed shapes, so a wash cannot leak out of an open line", () => {
		for (const doodle of DOODLES) {
			for (const stroke of doodle.strokes.filter((candidate) => candidate.fill)) {
				expect(stroke.d.trim().endsWith("Z"), `${doodle.id} fills an open path`).toBe(true);
			}
		}
	});

	it("covers something from every category a request is likely to name", () => {
		for (const id of ["person", "team", "growth", "briefcase", "cat", "arrowRight"]) {
			expect(isDoodleId(id), id).toBe(true);
		}
	});
});

describe("lookup", () => {
	it("finds a catalog drawing by id", () => {
		expect(getDoodle("cat")?.category).toBe("animals");
	});

	it("returns nothing for an id the planner invented", () => {
		expect(getDoodle("unicorn-riding-a-skateboard")).toBeUndefined();
		expect(getDoodle(undefined)).toBeUndefined();
		expect(isDoodleId("unicorn-riding-a-skateboard")).toBe(false);
	});
});

describe("describeDoodles", () => {
	it("offers the planner every id exactly once", () => {
		// Parsed back out of the menu rather than string-searched: "phone" is a
		// substring of "megaphone", and a naive search reports it twice.
		const offered = describeDoodles().flatMap((line) =>
			line
				.replace(/^- \w+: /, "")
				.split(/\), /)
				.map((entry) => entry.split(" (")[0]),
		);
		expect(offered.sort()).toEqual(DOODLES.map((doodle) => doodle.id).sort());
	});
});
