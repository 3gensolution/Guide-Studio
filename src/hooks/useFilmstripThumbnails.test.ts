import { describe, expect, it } from "vitest";
import { type Filmstrip, pickFilmstripTiles } from "./useFilmstripThumbnails";

function makeFilmstrip(timesMs: number[]): Filmstrip {
	return {
		aspect: 16 / 9,
		frames: timesMs.map((timeMs) => ({ timeMs, dataUrl: `frame-${timeMs}` })),
	};
}

describe("pickFilmstripTiles", () => {
	const filmstrip = makeFilmstrip([500, 1_500, 2_500, 3_500]); // 4s video, 4 pooled frames

	it("fills the width with tiles showing the nearest pooled frame", () => {
		// 400px wide, 100px tiles → 4 tiles, centers at 0.5s/1.5s/2.5s/3.5s
		const tiles = pickFilmstripTiles(filmstrip, 0, 4_000, 400, 100);
		expect(tiles.map((t) => t.timeMs)).toEqual([500, 1_500, 2_500, 3_500]);
	});

	it("repeats frames when zoomed in (fewer ms per tile than pool spacing)", () => {
		// Same 4s span across 1600px → 16 tiles, each pooled frame reused ~4×
		const tiles = pickFilmstripTiles(filmstrip, 0, 4_000, 1_600, 100);
		expect(tiles).toHaveLength(16);
		expect(new Set(tiles.map((t) => t.timeMs)).size).toBe(4);
		// Time-ordered left to right
		const times = tiles.map((t) => t.timeMs);
		expect([...times].sort((a, b) => a - b)).toEqual(times);
	});

	it("rounds tile count up so the band has no gap at the right edge", () => {
		const tiles = pickFilmstripTiles(filmstrip, 0, 4_000, 250, 100);
		expect(tiles).toHaveLength(3); // ceil(250/100)
	});

	it("returns empty for degenerate inputs", () => {
		expect(pickFilmstripTiles(filmstrip, 0, 0, 400, 100)).toEqual([]);
		expect(pickFilmstripTiles(filmstrip, 0, 4_000, 0, 100)).toEqual([]);
		expect(pickFilmstripTiles(makeFilmstrip([]), 0, 4_000, 400, 100)).toEqual([]);
	});
});
