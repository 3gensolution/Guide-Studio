import { describe, expect, it } from "vitest";
import { parseMediaContextProbe } from "../../src/lib/ai/mediaContext";
import { parseIntegratedLufs, validateRenderedVideoMetadata } from "./renderValidation";

const EXPECTED = {
	width: 1920,
	height: 1080,
	fps: 30,
	durationSeconds: 10,
};

const PROBE = parseMediaContextProbe(
	"Duration: 00:00:10.00, start: 0.000000, bitrate: 1200 kb/s\n" +
		"Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps\n" +
		"Stream #0:1: Audio: aac, 48000 Hz",
);

describe("render validation", () => {
	it("accepts a matching, playable video probe", () => {
		expect(validateRenderedVideoMetadata(PROBE, EXPECTED)).toBeUndefined();
	});

	it("rejects wrong dimensions", () => {
		expect(validateRenderedVideoMetadata(PROBE, { ...EXPECTED, width: 1080 })).toContain(
			"expected 1080×1080",
		);
	});

	it("rejects a truncated render", () => {
		expect(validateRenderedVideoMetadata({ ...PROBE, durationSeconds: 3 }, EXPECTED)).toContain(
			"expected approximately 10.00s",
		);
	});

	it("rejects a render with no video stream metadata", () => {
		expect(
			validateRenderedVideoMetadata(
				{ durationSeconds: 10, frameRate: 30, hasAudio: true },
				EXPECTED,
			),
		).toContain("no readable video dimensions");
	});

	it("parses integrated loudness emitted by FFmpeg loudness filters", () => {
		expect(parseIntegratedLufs("I: -18.4 LUFS\nLRA: 4.2 LU")).toBe(-18.4);
		expect(
			parseIntegratedLufs("Input Integrated:     -16.7 LUFS\nInput True Peak: -1.2 dBTP"),
		).toBe(-16.7);
		expect(parseIntegratedLufs("no loudness report")).toBeUndefined();
	});
});
