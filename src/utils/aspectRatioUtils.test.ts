import { describe, expect, it } from "vitest";
import { getNativeAspectRatioValue } from "./aspectRatioUtils";

const FALLBACK_RATIO = 16 / 9;

describe("getNativeAspectRatioValue", () => {
	it("returns the video ratio when no crop region is provided", () => {
		expect(getNativeAspectRatioValue(1920, 1080)).toBe(16 / 9);
	});

	it("applies crop width and height to the video ratio", () => {
		expect(getNativeAspectRatioValue(1920, 1080, { x: 0, y: 0, width: 0.5, height: 1 })).toBe(
			8 / 9,
		);
	});

	it("falls back when video metadata is zero or non-finite", () => {
		expect(getNativeAspectRatioValue(0, 1080)).toBe(FALLBACK_RATIO);
		expect(getNativeAspectRatioValue(1920, 0)).toBe(FALLBACK_RATIO);
		expect(getNativeAspectRatioValue(Number.NaN, 1080)).toBe(FALLBACK_RATIO);
		expect(getNativeAspectRatioValue(1920, Number.POSITIVE_INFINITY)).toBe(FALLBACK_RATIO);
	});

	it("falls back when crop dimensions are non-positive or non-finite", () => {
		expect(getNativeAspectRatioValue(1920, 1080, { x: 0, y: 0, width: 0, height: 1 })).toBe(
			FALLBACK_RATIO,
		);
		expect(getNativeAspectRatioValue(1920, 1080, { x: 0, y: 0, width: 1, height: -1 })).toBe(
			FALLBACK_RATIO,
		);
		expect(
			getNativeAspectRatioValue(1920, 1080, {
				x: 0,
				y: 0,
				width: Number.POSITIVE_INFINITY,
				height: 1,
			}),
		).toBe(FALLBACK_RATIO);
	});
});
