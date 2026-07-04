import { describe, expect, it } from "vitest";
import {
	estimateMp4ExportSizeBytes,
	formatEstimatedSize,
	getRecommendedMp4ExportSettings,
} from "./exportRecommendation";

describe("getRecommendedMp4ExportSettings", () => {
	it("recommends good quality, 30 fps, fast encoding for typical videos", () => {
		expect(getRecommendedMp4ExportSettings({ durationSec: 600 })).toEqual({
			quality: "good",
			frameRate: 30,
			encodingMode: "fast",
		});
	});

	it("recommends source quality for clips under a minute", () => {
		expect(getRecommendedMp4ExportSettings({ durationSec: 45 }).quality).toBe("source");
	});

	it("falls back to good quality when duration is unknown or invalid", () => {
		expect(getRecommendedMp4ExportSettings({}).quality).toBe("good");
		expect(getRecommendedMp4ExportSettings({ durationSec: Number.NaN }).quality).toBe("good");
		expect(getRecommendedMp4ExportSettings({ durationSec: 0 }).quality).toBe("good");
	});
});

describe("estimateMp4ExportSizeBytes", () => {
	const base = {
		sourceWidth: 1920,
		sourceHeight: 1080,
		frameRate: 30 as const,
		durationSec: 600,
	};

	it("matches the exporter bitrate formula plus audio", () => {
		// 1080p30 "good": 1920*1080*30*0.035 ≈ 2.18 Mbps video + 128 kbps audio.
		const bytes = estimateMp4ExportSizeBytes({ ...base, quality: "good" });
		const expected = Math.round(((Math.round(1920 * 1080 * 30 * 0.035) + 128_000) / 8) * 600);
		expect(bytes).toBe(expected);
	});

	it("scales with quality", () => {
		const good = estimateMp4ExportSizeBytes({ ...base, quality: "good" });
		const source = estimateMp4ExportSizeBytes({ ...base, quality: "source" });
		const medium = estimateMp4ExportSizeBytes({ ...base, quality: "medium" });
		expect(source).toBeGreaterThan(good);
		expect(good).toBeGreaterThan(medium);
	});

	it("omits audio when the source has none", () => {
		const withAudio = estimateMp4ExportSizeBytes({ ...base, quality: "good" });
		const withoutAudio = estimateMp4ExportSizeBytes({ ...base, quality: "good", hasAudio: false });
		expect(withAudio - withoutAudio).toBe(Math.round((128_000 / 8) * 600));
	});

	it("clamps negative durations to zero", () => {
		expect(estimateMp4ExportSizeBytes({ ...base, quality: "good", durationSec: -5 })).toBe(0);
	});
});

describe("formatEstimatedSize", () => {
	it("formats KB, MB, and GB ranges", () => {
		expect(formatEstimatedSize(512 * 1024)).toBe("512 KB");
		expect(formatEstimatedSize(1.5 * 1024 ** 2)).toBe("1.5 MB");
		expect(formatEstimatedSize(200 * 1024 ** 2)).toBe("200 MB");
		expect(formatEstimatedSize(2.4 * 1024 ** 3)).toBe("2.4 GB");
	});
});
