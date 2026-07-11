import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const MAIN_JS = path.join(ROOT, "dist-electron/main.js");
const TEST_VIDEO = path.join(ROOT, "tests/fixtures/sample.webm");

function probeDurationSec(filePath: string): number {
	const compositorDir = path.join(
		ROOT,
		"node_modules/@remotion",
		`compositor-${process.platform}-${process.arch}${process.platform === "win32" ? "-msvc" : process.platform === "linux" ? "-gnu" : ""}`,
	);
	const ffprobe = path.join(
		compositorDir,
		process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
	);
	const result = spawnSync(
		ffprobe,
		["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
		{
			encoding: "utf-8",
			env: { ...process.env, DYLD_LIBRARY_PATH: compositorDir, LD_LIBRARY_PATH: compositorDir },
		},
	);
	return Number.parseFloat(result.stdout.trim());
}

// A multi-clip timeline (primary recording + one added clip) must export ALL
// clips, not just the primary recording. The 2s fixture is added to itself,
// so anything meaningfully shorter than 4s means added clips were dropped.
test("exports both clips of a multi-clip timeline", async () => {
	test.setTimeout(300_000);
	const outputPath = path.join(os.tmpdir(), `test-multiclip-export-${Date.now()}.mp4`);
	let testVideoInRecordings = "";
	let secondClipPath = "";

	// Isolated userData so this test can run alongside an open dev instance.
	const e2eUserData = fs.mkdtempSync(path.join(os.tmpdir(), "guide-studio-e2e-"));

	const app = await electron.launch({
		args: [MAIN_JS, "--no-sandbox", "--enable-unsafe-swiftshader"],
		env: {
			...process.env,
			HEADLESS: process.env["HEADLESS"] ?? "true",
			GUIDE_STUDIO_E2E_USER_DATA: e2eUserData,
		},
	});
	const electronProcess = app.process();

	app.process().stdout?.on("data", (d) => process.stdout.write(`[electron] ${d}`));
	app.process().stderr?.on("data", (d) => process.stderr.write(`[electron] ${d}`));

	try {
		const hudWindow = await app.firstWindow({ timeout: 60_000 });
		await hudWindow.waitForLoadState("domcontentloaded");

		const userDataDir = await app.evaluate(({ app: electronApp }) => {
			return electronApp.getPath("userData");
		});
		const recordingsDir = path.join(userDataDir, "recordings");
		fs.mkdirSync(recordingsDir, { recursive: true });
		testVideoInRecordings = path.join(recordingsDir, "test-multiclip-primary.webm");
		secondClipPath = path.join(recordingsDir, "test-multiclip-added.webm");
		fs.copyFileSync(TEST_VIDEO, testVideoInRecordings);
		fs.copyFileSync(TEST_VIDEO, secondClipPath);

		await app.evaluate(
			({ ipcMain }, stubs: { targetPath: string; clipPath: string }) => {
				ipcMain.removeHandler("pick-export-save-path");
				ipcMain.handle("pick-export-save-path", () => ({
					success: true,
					path: stubs.targetPath,
					canceled: false,
				}));
				ipcMain.removeHandler("open-video-file-picker");
				ipcMain.handle("open-video-file-picker", () => ({
					success: true,
					path: stubs.clipPath,
				}));
				ipcMain.removeHandler("write-export-to-path");
				ipcMain.handle(
					"write-export-to-path",
					(_event: Electron.IpcMainInvokeEvent, buffer: ArrayBuffer, filePath: string) => {
						(globalThis as Record<string, unknown>)["__testExportData"] =
							Buffer.from(buffer).toString("base64");
						return { success: true, path: filePath };
					},
				);
			},
			{ targetPath: outputPath, clipPath: secondClipPath },
		);

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

		editorWindow.on("console", (msg) => console.log(`[renderer:${msg.type()}] ${msg.text()}`));
		editorWindow.on("pageerror", (err) => console.log(`[renderer:pageerror] ${err.message}`));

		// WebCodecs may not be registered in the renderer on first load.
		await editorWindow.reload();
		await editorWindow.waitForLoadState("domcontentloaded");
		await expect(editorWindow.getByText("Loading video...")).not.toBeVisible({
			timeout: 15_000,
		});
		console.log("[spec] editor loaded");

		// Add the second clip through the real UI flow (picker is stubbed).
		await editorWindow.getByTitle("Add Video Clip").click();
		await expect(editorWindow.getByText("Video clip added to timeline")).toBeVisible({
			timeout: 15_000,
		});
		console.log("[spec] clip added");

		await editorWindow.getByTestId("testId-export-panel-button").click();
		await editorWindow.getByTestId("testId-mp4-format-button").click();
		console.log("[spec] export panel open, mp4 selected");
		await editorWindow.getByTestId("testId-export-button").click();
		console.log("[spec] export clicked");

		// The export lands either directly at outputPath (FFmpeg fast path /
		// stream-mode move) or as a blob through the write-export-to-path stub.
		await expect
			.poll(
				async () => {
					if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) return true;
					return app.evaluate(() =>
						Boolean((globalThis as Record<string, unknown>)["__testExportData"]),
					);
				},
				{ timeout: 120_000 },
			)
			.toBe(true);

		if (!fs.existsSync(outputPath)) {
			const base64 = await app.evaluate(
				() => (globalThis as Record<string, unknown>)["__testExportData"] as string,
			);
			fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
		}

		const stats = fs.statSync(outputPath);
		expect(stats.size).toBeGreaterThan(1024);

		// 2s primary + 2s added clip: a ~2s file means added clips were dropped.
		const durationSec = probeDurationSec(outputPath);
		expect(durationSec).toBeGreaterThan(3.4);
		expect(durationSec).toBeLessThan(5.0);
	} finally {
		await app
			.evaluate(({ app: electronApp }) => {
				electronApp.exit(0);
			})
			.catch(() => {
				// The process may already be gone after export completes.
			});
		if (electronProcess.pid) {
			if (process.platform === "win32") {
				spawnSync("taskkill", ["/PID", String(electronProcess.pid), "/T", "/F"], {
					stdio: "ignore",
				});
			} else if (!electronProcess.killed) {
				electronProcess.kill("SIGKILL");
			}
		}
		for (const p of [outputPath, testVideoInRecordings, secondClipPath]) {
			if (p && fs.existsSync(p)) {
				fs.unlinkSync(p);
			}
		}
		fs.rmSync(e2eUserData, { recursive: true, force: true });
	}
});
