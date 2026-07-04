import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const MAIN_JS = path.join(ROOT, "dist-electron/main.js");

const FIXTURE_DURATION_SEC = 20;
const FIXTURE_WIDTH = 1280;
const FIXTURE_HEIGHT = 720;
const FIXTURE_FPS = 30;

function findFfmpegTool(tool: "ffmpeg" | "ffprobe"): string | null {
	const result = spawnSync(process.platform === "win32" ? "where" : "which", [tool], {
		encoding: "utf8",
	});
	if (result.status === 0) {
		return result.stdout.trim().split("\n")[0];
	}
	return null;
}

const ffmpegBin = findFfmpegTool("ffmpeg");
const ffprobeBin = findFfmpegTool("ffprobe");

// A parent Electron-based process (e.g. an IDE terminal) may leak
// ELECTRON_RUN_AS_NODE=1, which makes the launched Electron run as plain Node
// and reject Chromium flags.
const launchEnv: Record<string, string> = Object.fromEntries(
	Object.entries({ ...process.env, HEADLESS: process.env["HEADLESS"] ?? "true" }).filter(
		(entry): entry is [string, string] =>
			entry[0] !== "ELECTRON_RUN_AS_NODE" && typeof entry[1] === "string",
	),
);

/**
 * The app takes a single-instance lock; a just-killed instance from a previous
 * test can briefly hold it, making the new instance quit before "ready" and
 * the launch hang. Retry a couple of times with a short launch timeout.
 */
async function launchApp() {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await electron.launch({
				args: [MAIN_JS, "--no-sandbox", "--enable-unsafe-swiftshader"],
				env: launchEnv,
				timeout: 60_000,
			});
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 5_000));
		}
	}
	throw lastError;
}

interface ProbeResult {
	codec: string;
	width: number;
	height: number;
	durationSec: number;
	sizeBytes: number;
	hasAudio: boolean;
}

function probe(filePath: string): ProbeResult {
	if (!ffprobeBin) throw new Error("ffprobe not available");
	const json = execFileSync(
		ffprobeBin,
		["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath],
		{ encoding: "utf8" },
	);
	const data = JSON.parse(json);
	const video = data.streams.find((s: { codec_type: string }) => s.codec_type === "video");
	const audio = data.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
	return {
		codec: video?.codec_name ?? "none",
		width: Number(video?.width ?? 0),
		height: Number(video?.height ?? 0),
		durationSec: Number(data.format?.duration ?? 0),
		sizeBytes: Number(data.format?.size ?? 0),
		hasAudio: Boolean(audio),
	};
}

/**
 * Generates a MediaRecorder-like screen recording fixture: VP9+Opus webm with
 * a sparse keyframe interval (10s GOP) so keyframe-only cutting would be
 * visibly wrong, proving the quick-trim path is frame-accurate.
 */
function generateFixture(outPath: string): void {
	if (!ffmpegBin) throw new Error("ffmpeg not available");
	execFileSync(
		ffmpegBin,
		[
			"-f",
			"lavfi",
			"-i",
			`testsrc2=size=${FIXTURE_WIDTH}x${FIXTURE_HEIGHT}:rate=${FIXTURE_FPS}`,
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000",
			"-t",
			String(FIXTURE_DURATION_SEC),
			"-c:v",
			"libvpx-vp9",
			"-deadline",
			"realtime",
			"-cpu-used",
			"8",
			"-b:v",
			"2M",
			"-g",
			String(FIXTURE_FPS * 10),
			"-c:a",
			"libopus",
			"-y",
			outPath,
		],
		{ timeout: 180_000 },
	);
}

test.describe("export performance and correctness", () => {
	test.skip(!ffmpegBin || !ffprobeBin, "ffmpeg/ffprobe not installed");

	let fixturePath: string;

	test.beforeAll(() => {
		fixturePath = path.join(os.tmpdir(), `export-perf-fixture-${process.pid}.webm`);
		generateFixture(fixturePath);
	});

	test.afterAll(() => {
		if (fixturePath && fs.existsSync(fixturePath)) fs.unlinkSync(fixturePath);
	});

	test("full-pipeline MP4 export is fast, valid, and reasonably sized", async () => {
		test.setTimeout(600_000);
		const outputPath = path.join(os.tmpdir(), `test-perf-export-${Date.now()}.mp4`);
		let testVideoInRecordings = "";

		const app = await launchApp();
		const electronProcess = app.process();
		app.process().stdout?.on("data", (d) => process.stdout.write(`[electron] ${d}`));
		app.process().stderr?.on("data", (d) => process.stderr.write(`[electron] ${d}`));

		try {
			const hudWindow = await app.firstWindow({ timeout: 60_000 });
			await hudWindow.waitForLoadState("domcontentloaded");

			await app.evaluate(({ ipcMain }, targetPath: string) => {
				ipcMain.removeHandler("pick-export-save-path");
				ipcMain.removeHandler("write-export-to-path");
				ipcMain.handle("pick-export-save-path", () => ({
					success: true,
					path: targetPath,
					canceled: false,
				}));
				ipcMain.handle(
					"write-export-to-path",
					(_event: Electron.IpcMainInvokeEvent, buffer: ArrayBuffer, filePath: string) => {
						// require() is unavailable in this evaluate context, so hand the
						// bytes back to the test process as base64.
						(globalThis as Record<string, unknown>)["__testExportData"] =
							Buffer.from(buffer).toString("base64");
						(globalThis as Record<string, unknown>)["__testExportDone"] = true;
						return { success: true, path: filePath };
					},
				);
			}, outputPath);

			const userDataDir = await app.evaluate(({ app: electronApp }) =>
				electronApp.getPath("userData"),
			);
			const recordingsDir = path.join(userDataDir, "recordings");
			testVideoInRecordings = path.join(recordingsDir, "perf-fixture.webm");
			fs.mkdirSync(recordingsDir, { recursive: true });
			fs.copyFileSync(fixturePath, testVideoInRecordings);

			await hudWindow.evaluate(
				(videoPath: string) => window.electronAPI.setCurrentVideoPath(videoPath),
				testVideoInRecordings,
			);
			try {
				await hudWindow.evaluate(() => window.electronAPI.switchToEditor());
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!/closed|destroyed|target page|target closed/i.test(error.message)
				) {
					throw error;
				}
			}

			const editorWindow = await app.waitForEvent("window", {
				predicate: (w) => w.url().includes("windowType=editor"),
				timeout: 15_000,
			});

			editorWindow.on("console", (msg) => {
				console.log(`[renderer:${msg.type()}] ${msg.text()}`);
			});
			editorWindow.on("pageerror", (err) => {
				console.log(`[renderer:pageerror] ${err.message}`);
			});

			await editorWindow.reload();
			await editorWindow.waitForLoadState("domcontentloaded");
			await expect(editorWindow.getByText("Loading video...")).not.toBeVisible({
				timeout: 30_000,
			});

			await editorWindow.getByTestId("testId-export-panel-button").click();
			await editorWindow.getByTestId("testId-mp4-format-button").click();

			const exportStartMs = Date.now();
			await editorWindow.getByTestId("testId-export-button").click();

			// The WebCodecs path saves via write-export-to-path (sets the flag);
			// the native path writes the file to disk directly via concatVideos.
			let lastProgressLogMs = 0;
			await expect
				.poll(
					async () => {
						if (fs.existsSync(outputPath)) return true;
						if (Date.now() - lastProgressLogMs > 15_000) {
							lastProgressLogMs = Date.now();
							const dialogText = await editorWindow
								.evaluate(() => {
									const dialog = document.querySelector("[role='dialog'], .export-dialog");
									return dialog?.textContent ?? document.body.innerText.slice(0, 400);
								})
								.catch(() => "(evaluate failed)");
							console.log(`[export-perf] progress: ${String(dialogText).slice(0, 300)}`);
						}
						return app.evaluate(() =>
							Boolean((globalThis as Record<string, unknown>)["__testExportDone"]),
						);
					},
					{ timeout: 480_000 },
				)
				.toBe(true);
			const exportElapsedSec = (Date.now() - exportStartMs) / 1000;
			// Give a just-written file a moment to finish flushing.
			await new Promise((resolve) => setTimeout(resolve, 1500));

			if (!fs.existsSync(outputPath)) {
				// WebCodecs blob path: bytes were handed back through globalThis.
				const base64 = await app.evaluate(
					() => (globalThis as Record<string, unknown>)["__testExportData"] as string,
				);
				fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
			}

			expect(fs.existsSync(outputPath)).toBe(true);
			const result = probe(outputPath);

			console.log(
				`[export-perf] full pipeline: ${exportElapsedSec.toFixed(1)}s wall for ` +
					`${FIXTURE_DURATION_SEC}s video (${(FIXTURE_DURATION_SEC / exportElapsedSec).toFixed(2)}x realtime), ` +
					`output ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB, codec=${result.codec}, ` +
					`${result.width}x${result.height}, duration=${result.durationSec.toFixed(2)}s`,
			);

			expect(result.codec).toBe("h264");
			expect(result.durationSec).toBeGreaterThan(FIXTURE_DURATION_SEC - 1);
			expect(result.durationSec).toBeLessThan(FIXTURE_DURATION_SEC + 1);
			// Size: 720p30 "good" targets ~1 Mbps video; allow audio + container
			// overhead but fail if the file balloons (>2.5 Mbps overall).
			expect(result.sizeBytes).toBeLessThan((2_500_000 / 8) * FIXTURE_DURATION_SEC);
			expect(result.sizeBytes).toBeGreaterThan(100 * 1024);
		} finally {
			await app
				.evaluate(({ app: electronApp }) => {
					electronApp.exit(0);
				})
				.catch(() => {});
			if (electronProcess.pid && !electronProcess.killed) {
				electronProcess.kill("SIGKILL");
			}
			if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
			if (testVideoInRecordings && fs.existsSync(testVideoInRecordings)) {
				fs.unlinkSync(testVideoInRecordings);
			}
		}
	});

	test("quick-trim export is frame-accurate and produces a valid MP4", async () => {
		test.setTimeout(300_000);
		const singleOut = path.join(os.tmpdir(), `test-quicktrim-single-${Date.now()}.mp4`);
		const multiOut = path.join(os.tmpdir(), `test-quicktrim-multi-${Date.now()}.mp4`);

		const app = await launchApp();
		const electronProcess = app.process();

		try {
			const hudWindow = await app.firstWindow({ timeout: 60_000 });
			await hudWindow.waitForLoadState("domcontentloaded");

			// Single segment: 3.5s cut starting mid-GOP (keyframes are 10s apart,
			// so a keyframe-aligned cut would be off by seconds).
			const startMs = Date.now();
			const singleResult = await hudWindow.evaluate(
				({ input, output }) =>
					window.electronAPI.quickTrimExport(input, output, [{ startMs: 3000, endMs: 6500 }]),
				{ input: fixturePath, output: singleOut },
			);
			const singleElapsedSec = (Date.now() - startMs) / 1000;
			expect(singleResult.success, `quick trim failed: ${singleResult.error}`).toBe(true);

			const single = probe(singleOut);
			console.log(
				`[export-perf] quick-trim single: ${singleElapsedSec.toFixed(1)}s wall, ` +
					`duration=${single.durationSec.toFixed(2)}s, size=${(single.sizeBytes / 1024).toFixed(0)} KB, codec=${single.codec}`,
			);
			expect(single.codec).toBe("h264");
			expect(single.hasAudio).toBe(true);
			expect(Math.abs(single.durationSec - 3.5)).toBeLessThan(0.2);

			// Multi segment: keep [2s,5s] + [8s,12s] => 7s total.
			const multiStartMs = Date.now();
			const multiResult = await hudWindow.evaluate(
				({ input, output }) =>
					window.electronAPI.quickTrimExport(input, output, [
						{ startMs: 2000, endMs: 5000 },
						{ startMs: 8000, endMs: 12000 },
					]),
				{ input: fixturePath, output: multiOut },
			);
			const multiElapsedSec = (Date.now() - multiStartMs) / 1000;
			expect(multiResult.success, `quick trim failed: ${multiResult.error}`).toBe(true);

			const multi = probe(multiOut);
			console.log(
				`[export-perf] quick-trim multi: ${multiElapsedSec.toFixed(1)}s wall, ` +
					`duration=${multi.durationSec.toFixed(2)}s, size=${(multi.sizeBytes / 1024).toFixed(0)} KB, codec=${multi.codec}`,
			);
			expect(multi.codec).toBe("h264");
			expect(multi.hasAudio).toBe(true);
			expect(Math.abs(multi.durationSec - 7)).toBeLessThan(0.3);
		} finally {
			await app
				.evaluate(({ app: electronApp }) => {
					electronApp.exit(0);
				})
				.catch(() => {});
			if (electronProcess.pid && !electronProcess.killed) {
				electronProcess.kill("SIGKILL");
			}
			for (const f of [singleOut, multiOut]) {
				if (fs.existsSync(f)) fs.unlinkSync(f);
			}
		}
	});
});
