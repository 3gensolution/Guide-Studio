// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({
	BrowserWindow: {},
	dialog: { showOpenDialog: picker },
	ipcMain: { handle: vi.fn() },
}));
vi.mock("../ffmpeg", () => ({
	getFfmpegPath: async () => "ffmpeg",
	getFfmpegEnv: () => process.env,
}));
vi.mock("./aiService", () => ({
	analyzeImage: vi.fn(),
	loadAIConfig: vi.fn(),
	supportsVision: vi.fn(),
}));

import {
	getMediaContextContactSheet,
	pickMediaContextAssets,
	releaseMediaContextAssets,
} from "./mediaContextService";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe("video contact sheets", () => {
	it.skipIf(!hasFfmpeg)(
		"composites distinct moments in chronological reading order",
		async () => {
			const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-sheet-test-"));
			let ids: string[] = [];
			try {
				const source = path.join(root, "sequence.mp4");
				execFileSync(
					"ffmpeg",
					[
						"-v",
						"error",
						...["red", "green", "blue"].flatMap((color) => [
							"-f",
							"lavfi",
							"-i",
							`color=c=${color}:s=160x90:r=10:d=1`,
						]),
						"-filter_complex",
						"[0:v][1:v][2:v]concat=n=3:v=1:a=0",
						"-c:v",
						"libx264",
						"-pix_fmt",
						"yuv420p",
						source,
					],
					{ timeout: 20_000 },
				);
				picker.mockResolvedValueOnce({ canceled: false, filePaths: [source] });
				const picked = await pickMediaContextAssets();
				ids = picked.assets?.map((asset) => asset.id) ?? [];
				expect(ids).toHaveLength(1);
				const result = await getMediaContextContactSheet(ids[0], 3, 3);
				expect(result.success, result.error).toBe(true);
				expect(result.frameTimesSeconds).toHaveLength(3);
				const data = Buffer.from(result.dataUrl!.split(",")[1], "base64");
				const { data: pixels, info } = await sharp(data)
					.removeAlpha()
					.raw()
					.toBuffer({ resolveWithObject: true });
				const sample = (x: number, y: number) => {
					const offset = (y * info.width + x) * info.channels;
					return Array.from(pixels.subarray(offset, offset + 3));
				};
				const red = sample(328, 188);
				const green = sample(976, 188);
				const blue = sample(328, 556);
				expect(red[0]).toBeGreaterThan(200);
				expect(red[1]).toBeLessThan(30);
				expect(green[1]).toBeGreaterThan(90);
				expect(green[0]).toBeLessThan(30);
				expect(blue[2]).toBeGreaterThan(200);
				expect(blue[0]).toBeLessThan(30);
			} finally {
				releaseMediaContextAssets(ids);
				await fs.rm(root, { recursive: true, force: true });
			}
		},
		30_000,
	);
});
