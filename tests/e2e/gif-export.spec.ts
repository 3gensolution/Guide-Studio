import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const MAIN_JS = path.join(ROOT, "dist-electron/main.js");
const TEST_VIDEO = path.join(__dirname, "../fixtures/sample.webm");

async function exportFromLoadedVideo(format: "gif" | "mp4"): Promise<Buffer> {
	const outputPath = path.join(os.tmpdir(), `test-${format}-export-${Date.now()}.${format}`);
	let testVideoInRecordings = "";

	const app = await electron.launch({
		args: [
			MAIN_JS,
			// Required in CI sandbox environments (GitHub Actions, Docker, etc.)
			"--no-sandbox",
			// Force software WebGL in headless CI to avoid GPU framebuffer errors.
			"--enable-unsafe-swiftshader",
		],
		env: {
			...process.env,
			// Set HEADLESS=false to show windows while debugging.
			HEADLESS: process.env["HEADLESS"] ?? "true",
		},
	});
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
					if (filePath !== targetPath) {
						return {
							success: false,
							error: `Unexpected export path: ${filePath}`,
						};
					}
					(globalThis as Record<string, unknown>)["__testExportData"] =
						Buffer.from(buffer).toString("base64");
					return { success: true, path: filePath };
				},
			);
		}, outputPath);

		const userDataDir = await app.evaluate(({ app: electronApp }) => {
			return electronApp.getPath("userData");
		});
		const recordingsDir = path.join(userDataDir, "recordings");
		testVideoInRecordings = path.join(recordingsDir, "test-sample.webm");
		fs.mkdirSync(recordingsDir, { recursive: true });
		fs.copyFileSync(TEST_VIDEO, testVideoInRecordings);

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

		// WebCodecs may not be registered in the renderer on first load.
		await editorWindow.reload();
		await editorWindow.waitForLoadState("domcontentloaded");
		await expect(editorWindow.getByText("Loading video...")).not.toBeVisible({
			timeout: 15_000,
		});

		await editorWindow.getByTestId("testId-export-panel-button").click();
		await editorWindow.getByTestId(`testId-${format}-format-button`).click();
		await editorWindow.getByTestId("testId-export-button").click();

		await expect
			.poll(
				() =>
					app.evaluate(() => Boolean((globalThis as Record<string, unknown>)["__testExportData"])),
				{ timeout: 90_000 },
			)
			.toBe(true);

		const base64 = await app.evaluate(
			() => (globalThis as Record<string, unknown>)["__testExportData"] as string,
		);
		fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));

		expect(fs.existsSync(outputPath), `${format.toUpperCase()} not found at ${outputPath}`).toBe(
			true,
		);
		const stats = fs.statSync(outputPath);
		expect(stats.size).toBeGreaterThan(1024);
		return fs.readFileSync(outputPath);
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
		if (fs.existsSync(outputPath)) {
			fs.unlinkSync(outputPath);
		}
		if (testVideoInRecordings && fs.existsSync(testVideoInRecordings)) {
			fs.unlinkSync(testVideoInRecordings);
		}
	}
}

test("exports an MP4 from a loaded video", async () => {
	const exported = await exportFromLoadedVideo("mp4");

	expect(exported.subarray(4, 8).toString("ascii")).toBe("ftyp");
});

test("exports a GIF from a loaded video", async () => {
	const exported = await exportFromLoadedVideo("gif");

	expect(exported.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a/);
});
