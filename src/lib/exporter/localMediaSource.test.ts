import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	resolveMediaElementSource,
	resolveMediaResourceUrl,
	toStudioMediaUrl,
} from "./localMediaSource";

describe("resolveMediaElementSource", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		Object.assign(globalThis, {
			window: {
				electronAPI: {
					readLocalFile: vi.fn(),
					getLocalMediaUrl: vi.fn(async (filePath: string) => ({
						success: true,
						url: `http://127.0.0.1:4321/video?path=${encodeURIComponent(filePath)}`,
					})),
				},
			},
		});
	});

	it("resolves file URLs through the local media server for media elements", async () => {
		const result = await resolveMediaElementSource("file:///tmp/example.mp4");

		expect((window as any).electronAPI.readLocalFile).not.toHaveBeenCalled();
		expect((window as any).electronAPI.getLocalMediaUrl).toHaveBeenCalledWith("/tmp/example.mp4");
		expect(result.src).toBe("http://127.0.0.1:4321/video?path=%2Ftmp%2Fexample.mp4");
	});

	it("resolves absolute local paths through the local media server without copying them into blobs", async () => {
		const result = await resolveMediaElementSource("/tmp/example.wav");

		expect((window as any).electronAPI.readLocalFile).not.toHaveBeenCalled();
		expect((window as any).electronAPI.getLocalMediaUrl).toHaveBeenCalledWith("/tmp/example.wav");
		expect(result.src).toBe("http://127.0.0.1:4321/video?path=%2Ftmp%2Fexample.wav");
	});

	it("preserves loopback media-server URLs instead of materializing them through IPC", async () => {
		const result = await resolveMediaElementSource(
			"http://127.0.0.1:43123/video?path=%2Ftmp%2Fexample%20clip.mp4",
		);

		expect((window as any).electronAPI.readLocalFile).not.toHaveBeenCalled();
		expect((window as any).electronAPI.getLocalMediaUrl).not.toHaveBeenCalled();
		expect(result.src).toBe("http://127.0.0.1:43123/video?path=%2Ftmp%2Fexample%20clip.mp4");
	});

	it("leaves remote URLs untouched", async () => {
		const readLocalFile = vi.fn();
		(window as any).electronAPI.readLocalFile = readLocalFile;

		const result = await resolveMediaElementSource("https://example.com/video.mp4");

		expect(result.src).toBe("https://example.com/video.mp4");
		expect(readLocalFile).not.toHaveBeenCalled();
	});
});

describe("resolveMediaResourceUrl", () => {
	beforeEach(() => {
		Object.assign(globalThis, { window: { electronAPI: { readLocalFile: vi.fn() } } });
	});

	it("serves local files through the range-capable studio:// protocol inside Electron", async () => {
		// file:// ignores Range, so the export demuxer would re-read the whole
		// recording on every small read.
		const url = await resolveMediaResourceUrl("file:///Users/me/rec%20one.mp4");

		expect(url).toBe(toStudioMediaUrl("/Users/me/rec one.mp4"));
		expect(decodeURIComponent(url.replace("studio://file/", ""))).toBe("/Users/me/rec one.mp4");
	});
});
