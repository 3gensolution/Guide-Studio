import { describe, expect, it } from "vitest";

import { resolveSourceAudioFallbackPaths } from "./sourceAudioFallback";

describe("resolveSourceAudioFallbackPaths", () => {
	it("treats the video file path as embedded source audio when present in the fallback list", () => {
		const videoPath = "/tmp/recording.mp4";

		expect(
			resolveSourceAudioFallbackPaths(videoPath, [videoPath, "/tmp/recording.mic.wav"]),
		).toEqual({
			hasEmbeddedSourceAudio: true,
			externalAudioPaths: ["/tmp/recording.mic.wav"],
		});
	});

	it("keeps all fallback paths external when the video has no embedded source audio", () => {
		expect(
			resolveSourceAudioFallbackPaths("/tmp/recording.mp4", [
				"/tmp/recording.system.wav",
				"/tmp/recording.mic.wav",
			]),
		).toEqual({
			hasEmbeddedSourceAudio: false,
			externalAudioPaths: ["/tmp/recording.system.wav", "/tmp/recording.mic.wav"],
		});
	});

	it("matches embedded source audio when the video resource is a file URL", () => {
		expect(
			resolveSourceAudioFallbackPaths("file:///tmp/recording.mp4", [
				"/tmp/recording.mp4",
				"/tmp/recording.mic.wav",
			]),
		).toEqual({
			hasEmbeddedSourceAudio: true,
			externalAudioPaths: ["/tmp/recording.mic.wav"],
		});
	});

	it("normalizes Windows file URLs and local paths when checking embedded audio", () => {
		expect(
			resolveSourceAudioFallbackPaths("file:///C:/Users/Egg/Videos/recording.mp4", [
				"C:\\Users\\Egg\\Videos\\recording.mp4",
				"C:\\Users\\Egg\\Videos\\recording.mic.wav",
			]),
		).toEqual({
			hasEmbeddedSourceAudio: true,
			externalAudioPaths: ["C:\\Users\\Egg\\Videos\\recording.mic.wav"],
		});
	});

	it("matches Windows paths case-insensitively for embedded audio detection", () => {
		expect(
			resolveSourceAudioFallbackPaths("file:///C:/Users/Egg/Videos/recording.mp4", [
				"c:\\users\\egg\\videos\\recording.mp4",
				"c:\\users\\egg\\videos\\recording.mic.wav",
			]),
		).toEqual({
			hasEmbeddedSourceAudio: true,
			externalAudioPaths: ["c:\\users\\egg\\videos\\recording.mic.wav"],
		});
	});
});
