// ── Remotion SSR Export ──────────────────────────────────────────────────
//
// Renders AI-generated compositions to H.264 MP4 via headless Chromium.
// Runs entirely in the Electron main process — no UI impact.
//
// Production: uses a pre-bundled webpack output shipped as an extraResource
//             (built by scripts/bundle-remotion.mjs during `npm run build`).
// Development: bundles on-the-fly via @remotion/bundler (cached after first run).
//
// Screenshots are written to temp files and served as static assets within the
// Remotion bundle. This avoids passing megabytes of base64 through inputProps.
//
// Post-processing: Remotion's ffmpeg output uses color metadata (full-range,
// bt470bg) that Windows Media Foundation can't decode. We re-encode with our
// own ffmpeg binary using known-good H.264 settings for universal playback.

import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { app } from "electron";
import type {
	HyperFrame,
	HyperFrameCompositionProps,
	HyperFrameFormat,
	HyperFrameImageAsset,
} from "../../src/lib/remotion/HyperFrameComposition";
import { hyperFrameFormatSpec } from "../../src/lib/remotion/HyperFrameComposition";
import type {
	MotionCompositionProps,
	MotionFormat,
	MotionScene,
} from "../../src/lib/remotion/MotionGraphicsComposition";
import { motionFormatSpec } from "../../src/lib/remotion/MotionGraphicsComposition";
import { getFfmpegEnv, getFfmpegPath } from "../ffmpeg";

/**
 * Resolve the directory containing Remotion's native binaries (remotion.exe,
 * ffmpeg.exe, ffprobe.exe). Remotion's internal resolution uses
 * require.resolve("@remotion/compositor-...") which returns the asar path
 * in a packaged Electron app — spawn() can't execute from inside asar.
 * electron-builder's asarUnpack copies them to app.asar.unpacked; we point
 * Remotion at that directory explicitly via the binariesDirectory option.
 */
function getRemotionBinariesDirectory(): string {
	const libcSuffix =
		process.platform === "win32" ? "-msvc" : process.platform === "linux" ? "-gnu" : "";
	const pkg = `compositor-${process.platform}-${process.arch}${libcSuffix}`;
	const projectRoot = resolveRuntimeProjectRoot();
	const base = app.isPackaged
		? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
		: path.join(projectRoot, "node_modules");
	return path.join(base, "@remotion", pkg);
}

const execFile = promisify(execFileCb);

/** Cached bundle location — reused across exports within a session. */
let cachedBundleLocation: string | null = null;

export interface RemotionExportOptions {
	code: string;
	screenshots: string[];
	outputPath: string;
	fps?: number;
	durationInFrames?: number;
	width?: number;
	height?: number;
	musicPath?: string;
	musicVolume?: number;
	onProgress?: (percent: number) => void;
}

// ── HyperFrame storyboard rendering ──────────────────────────────────────
//
// Trusted local render input for the fixed HyperFrame scene library. Claude
// contributes a validated storyboard — text, timings, and a scene id drawn
// from a closed set — and nothing else. No model-authored code is compiled
// or executed here; these functions only feed validated props into the
// compositions registered in `src/lib/remotion/Root.tsx`.

export interface HyperFrameRenderOptions {
	title: string;
	accent: HyperFrameCompositionProps["accent"];
	frames: HyperFrame[];
	/** Local image files the frames reference, staged into the bundle here. */
	imageAssets?: Array<{ assetId: string; src: string }>;
	outputPath: string;
	format?: HyperFrameFormat;
	fps?: number;
	onProgress?: (percent: number) => void;
	signal?: AbortSignal;
}

/**
 * A 3D frame needs a GL backend in headless Chromium. Hardware backends are
 * unreliable across the machines this ships to, so software rasterisation is
 * the default; `GUIDE_REMOTION_GL` overrides it for anyone whose machine does
 * better with a hardware backend.
 */
function hyperFrameGlMode() {
	const requested = process.env.GUIDE_REMOTION_GL;
	const allowed = ["angle", "egl", "swiftshader", "swangle", "vulkan", "angle-egl"] as const;
	return (allowed as readonly string[]).includes(requested ?? "")
		? (requested as (typeof allowed)[number])
		: "swangle";
}

/** Render an approved storyboard to an MP4 through the fixed composition. */
export async function renderHyperFrameDemo(opts: HyperFrameRenderOptions) {
	const fps = opts.fps ?? 30;
	const spec = hyperFrameFormatSpec(opts.format ?? "landscape");
	const serveUrl = await resolveServeUrl();
	const binariesDirectory = getRemotionBinariesDirectory();
	const staged = copyImageAssetsToBundle(serveUrl, opts.imageAssets);

	const inputProps: HyperFrameCompositionProps = {
		title: opts.title,
		accent: opts.accent,
		frames: opts.frames,
		...(staged.length ? { imageAssets: staged } : {}),
	};

	const composition = await selectComposition({
		serveUrl,
		id: spec.id,
		inputProps: inputProps as unknown as Record<string, unknown>,
		binariesDirectory,
	});

	const needsGl = opts.frames.some((frame) => frame.kind === "scene3d");
	const chromiumOptions = needsGl ? ({ gl: hyperFrameGlMode() } as const) : undefined;

	const { cancelSignal, cancel } = makeCancelSignal();
	const abortListener = () => cancel();
	opts.signal?.addEventListener("abort", abortListener, { once: true });

	try {
		if (opts.signal?.aborted) throw new Error("HyperFrame render cancelled");
		await renderMedia({
			composition: { ...composition, fps, durationInFrames: composition.durationInFrames },
			serveUrl,
			codec: "h264",
			outputLocation: opts.outputPath,
			inputProps: inputProps as unknown as Record<string, unknown>,
			binariesDirectory,
			cancelSignal,
			...(chromiumOptions ? { chromiumOptions } : {}),
			onProgress: ({ progress }) => opts.onProgress?.(Math.round(progress * 100)),
		});
	} finally {
		opts.signal?.removeEventListener("abort", abortListener);
	}

	return {
		outputPath: opts.outputPath,
		durationInFrames: composition.durationInFrames,
		fps,
		width: composition.width,
		height: composition.height,
	};
}

/**
 * Render one still per requested frame. The creator window shows these as a
 * storyboard preview so the user can judge the plan before paying for a full
 * render.
 */
export async function renderHyperFrameStills(opts: {
	title: string;
	accent: HyperFrameCompositionProps["accent"];
	frames: HyperFrame[];
	imageAssets?: Array<{ assetId: string; src: string }>;
	frameIndexes: number[];
	outputDirectory: string;
	format?: HyperFrameFormat;
	signal?: AbortSignal;
}) {
	const { renderStill } = await import("@remotion/renderer");
	const spec = hyperFrameFormatSpec(opts.format ?? "landscape");
	const serveUrl = await resolveServeUrl();
	const binariesDirectory = getRemotionBinariesDirectory();
	const staged = copyImageAssetsToBundle(serveUrl, opts.imageAssets);

	const inputProps: HyperFrameCompositionProps = {
		title: opts.title,
		accent: opts.accent,
		frames: opts.frames,
		...(staged.length ? { imageAssets: staged } : {}),
	};

	const composition = await selectComposition({
		serveUrl,
		id: spec.id,
		inputProps: inputProps as unknown as Record<string, unknown>,
		binariesDirectory,
	});

	const chromiumOptions = opts.frames.some((frame) => frame.kind === "scene3d")
		? ({ gl: hyperFrameGlMode() } as const)
		: undefined;

	fs.mkdirSync(opts.outputDirectory, { recursive: true });
	const fps = composition.fps || 30;
	const results: Array<{ frameIndex: number; path: string }> = [];

	for (const frameIndex of opts.frameIndexes) {
		if (opts.signal?.aborted) throw new Error("Storyboard preview cancelled");
		// Sample the middle of the frame's own span so the still shows the
		// scene settled rather than mid-entrance.
		const before = opts.frames
			.slice(0, frameIndex)
			.reduce((total, frame) => total + frame.durationSeconds, 0);
		const own = opts.frames[frameIndex]?.durationSeconds ?? 0;
		const middle = Math.round((before + own / 2) * fps);
		const output = path.join(opts.outputDirectory, `frame-${frameIndex}.png`);
		await renderStill({
			composition,
			serveUrl,
			output,
			frame: Math.max(0, Math.min(middle, composition.durationInFrames - 1)),
			inputProps: inputProps as unknown as Record<string, unknown>,
			binariesDirectory,
			...(chromiumOptions ? { chromiumOptions } : {}),
		});
		results.push({ frameIndex, path: output });
	}

	return results;
}

// ── Motion graphics rendering ────────────────────────────────────────────
//
// The animated counterpart to the HyperFrame functions above. Same contract:
// validated scene props in, MP4 or stills out, no model-authored code.

export interface MotionRenderOptions {
	title: string;
	accent: MotionCompositionProps["accent"];
	scenes: MotionScene[];
	outputPath: string;
	format?: MotionFormat;
	fps?: number;
	onProgress?: (percent: number) => void;
	signal?: AbortSignal;
}

export async function renderMotionDemo(opts: MotionRenderOptions) {
	const fps = opts.fps ?? 30;
	const spec = motionFormatSpec(opts.format ?? "landscape");
	const serveUrl = await resolveServeUrl();
	const binariesDirectory = getRemotionBinariesDirectory();

	const inputProps: MotionCompositionProps = {
		title: opts.title,
		accent: opts.accent,
		scenes: opts.scenes,
	};

	const composition = await selectComposition({
		serveUrl,
		id: spec.id,
		inputProps: inputProps as unknown as Record<string, unknown>,
		binariesDirectory,
	});

	const { cancelSignal, cancel } = makeCancelSignal();
	const abortListener = () => cancel();
	opts.signal?.addEventListener("abort", abortListener, { once: true });

	try {
		if (opts.signal?.aborted) throw new Error("Motion render cancelled");
		await renderMedia({
			composition: { ...composition, fps },
			serveUrl,
			codec: "h264",
			outputLocation: opts.outputPath,
			inputProps: inputProps as unknown as Record<string, unknown>,
			binariesDirectory,
			cancelSignal,
			onProgress: ({ progress }) => opts.onProgress?.(Math.round(progress * 100)),
		});
	} finally {
		opts.signal?.removeEventListener("abort", abortListener);
	}

	return {
		outputPath: opts.outputPath,
		durationInFrames: composition.durationInFrames,
		fps,
		width: composition.width,
		height: composition.height,
	};
}

export async function renderMotionStills(opts: {
	title: string;
	accent: MotionCompositionProps["accent"];
	scenes: MotionScene[];
	sceneIndexes: number[];
	outputDirectory: string;
	format?: MotionFormat;
	signal?: AbortSignal;
}) {
	const { renderStill } = await import("@remotion/renderer");
	const spec = motionFormatSpec(opts.format ?? "landscape");
	const serveUrl = await resolveServeUrl();
	const binariesDirectory = getRemotionBinariesDirectory();

	const inputProps: MotionCompositionProps = {
		title: opts.title,
		accent: opts.accent,
		scenes: opts.scenes,
	};

	const composition = await selectComposition({
		serveUrl,
		id: spec.id,
		inputProps: inputProps as unknown as Record<string, unknown>,
		binariesDirectory,
	});

	fs.mkdirSync(opts.outputDirectory, { recursive: true });
	const fps = composition.fps || 30;
	const results: Array<{ frameIndex: number; path: string }> = [];

	for (const sceneIndex of opts.sceneIndexes) {
		if (opts.signal?.aborted) throw new Error("Motion preview cancelled");
		// Sample two-thirds into the scene: entrance animations have landed by
		// then, and exits have not started.
		const before = opts.scenes
			.slice(0, sceneIndex)
			.reduce((total, scene) => total + scene.durationSeconds, 0);
		const own = opts.scenes[sceneIndex]?.durationSeconds ?? 0;
		const sample = Math.round((before + own * 0.66) * fps);
		const output = path.join(opts.outputDirectory, `scene-${sceneIndex}.png`);
		await renderStill({
			composition,
			serveUrl,
			output,
			frame: Math.max(0, Math.min(sample, composition.durationInFrames - 1)),
			inputProps: inputProps as unknown as Record<string, unknown>,
			binariesDirectory,
		});
		results.push({ frameIndex: sceneIndex, path: output });
	}

	return results;
}

export async function exportWithRemotion(opts: RemotionExportOptions) {
	const {
		code: rawCode,
		screenshots,
		outputPath,
		fps = 30,
		durationInFrames,
		musicPath,
		musicVolume = 0.25,
		onProgress,
	} = opts;

	// 1. Resolve the serve URL (pre-bundled in prod, on-the-fly in dev)
	const serveUrl = await resolveServeUrl();

	// 2. The studio:// custom protocol only exists in the renderer process
	//    where we registered it. The headless Chromium that Remotion's
	//    renderer spawns has no idea what studio:// is, AND it can't fetch
	//    arbitrary absolute paths either — Remotion prepends file:/// and
	//    routes everything through its HTTP downloader, which only accepts
	//    http/https. The pattern that DOES work is the same one we use for
	//    screenshots: copy the asset into the bundle directory (which
	//    Remotion serves as a static HTTP root) and reference it via a
	//    relative path. So we walk every studio://file/ URL in the code,
	//    copy each file into <bundle>/_external_assets/, and rewrite the
	//    URL to a relative path.
	const { code, copiedCount } = await copyExternalAssetsIntoBundle(rawCode, serveUrl);
	if (copiedCount > 0) {
		console.log(
			`[remotionExport] Copied ${copiedCount} external asset(s) into bundle and rewrote URLs`,
		);
	}

	// 3. Write screenshots to the bundle directory as static files. If any
	//    screenshot is a studio:// URL (rare but possible), rewrite it too.
	const screenshotUrls = (await writeScreenshotsToBundle(serveUrl, screenshots)).map((url) =>
		rewriteStudioUrls(url),
	);

	console.log(`[remotionExport] Code length: ${code.length}, screenshots: ${screenshots.length}`);

	// 4. Select the DynamicVideo composition
	const inputProps = { code, screenshots: screenshotUrls };

	const binariesDirectory = getRemotionBinariesDirectory();

	const composition = await selectComposition({
		serveUrl,
		id: "DynamicVideo",
		inputProps,
		binariesDirectory,
	});

	// 5. Override duration/resolution if explicitly provided
	if (durationInFrames && durationInFrames > 0) {
		composition.durationInFrames = durationInFrames;
	}
	composition.fps = fps;
	if (opts.width) composition.width = opts.width;
	if (opts.height) composition.height = opts.height;

	console.log(
		`[remotionExport] Rendering ${composition.durationInFrames} frames @ ${composition.fps}fps`,
	);

	// 6. Render to a temp file — Remotion's output may not be Windows-compatible
	const tempPath = outputPath.replace(/\.mp4$/i, "_raw.mp4");

	await renderMedia({
		composition,
		serveUrl,
		codec: "h264",
		pixelFormat: "yuv420p",
		outputLocation: tempPath,
		inputProps,
		binariesDirectory,
		onProgress: ({ progress }) => {
			// Scale to 0–0.9 so the post-process step gets 0.9–1.0
			onProgress?.(progress * 0.9);
		},
	});

	console.log("[remotionExport] Remotion render complete, post-processing for compatibility...");

	// 7. Re-encode with our ffmpeg for universal playback + mux music in one pass:
	//    - baseline profile (no B-frames, CAVLC — works on every device)
	//    - level 4.0 (safe for 1080p30)
	//    - yuv420p + limited/TV range + bt709 color space
	//    - faststart (moov atom at front)
	//    - CRF 18 (visually lossless quality)
	//    - Music mixed at 25% volume if provided
	await reencodeForCompatibility(tempPath, outputPath, musicPath, musicVolume);
	onProgress?.(1);

	// 8. Clean up temp files
	try {
		fs.unlinkSync(tempPath);
	} catch {
		/* best-effort */
	}
	cleanupScreenshots(serveUrl);
	cleanupExternalAssets(serveUrl);

	// 9. Log file details for diagnostics
	await logFileInfo(outputPath);

	console.log("[remotionExport] Export complete:", outputPath);
}

/** Invalidate the cached dev bundle (e.g. after source changes). */
export function invalidateRemotionBundle() {
	cachedBundleLocation = null;
}

const EXTERNAL_ASSETS_SUBDIR = "_external_assets";

/** Walk the AI-generated code, copy every asset referenced by a
 *  `studio://file/<abs-path>` URL into <bundlePath>/_external_assets/, and
 *  rewrite the URL to a relative path that Remotion's static server can
 *  resolve. This is the only path that actually works for arbitrary local
 *  files: Remotion's downloader can't handle bare absolute paths, can't
 *  handle file:// URLs, and obviously doesn't know about studio://. But
 *  files INSIDE the bundle directory are served as static HTTP assets
 *  during render, the same way we already do for screenshots. */
async function copyExternalAssetsIntoBundle(
	code: string,
	bundlePath: string,
): Promise<{ code: string; copiedCount: number }> {
	if (!code.includes("studio://file/")) return { code, copiedCount: 0 };

	const targetDir = path.join(bundlePath, EXTERNAL_ASSETS_SUBDIR);
	fs.mkdirSync(targetDir, { recursive: true });

	// Collect unique asset paths first so we don't copy the same file twice
	// when it's referenced by multiple <Audio> elements.
	const uniquePaths = new Set<string>();
	for (const match of code.matchAll(/studio:\/\/file\/([^"'\s)]+)/g)) {
		uniquePaths.add(match[1]);
	}

	const replacements = new Map<string, string>();
	let copiedCount = 0;
	let nextIndex = 0;

	for (const rawPath of uniquePaths) {
		// Strip any leading slashes from "/C:/..." → "C:/..."
		const absPath = rawPath.replace(/^\/+/, "");

		if (!fs.existsSync(absPath)) {
			console.warn(`[remotionExport] external asset not found, skipping: ${absPath}`);
			continue;
		}

		// Generate a collision-free filename. Narration mp3s already have
		// timestamps but we add an index suffix anyway as a guarantee.
		const ext = path.extname(absPath);
		const base = path.basename(absPath, ext);
		const uniqueName = `${base}-${nextIndex++}${ext}`;
		const destPath = path.join(targetDir, uniqueName);

		try {
			fs.copyFileSync(absPath, destPath);
			copiedCount++;
			replacements.set(rawPath, `${EXTERNAL_ASSETS_SUBDIR}/${uniqueName}`);
		} catch (err) {
			console.warn(`[remotionExport] failed to copy ${absPath}:`, err);
		}
	}

	// Single-pass replacement using the captured map. Anything that wasn't
	// successfully copied falls back to the bare path (best effort — it'll
	// still fail in Remotion but the diagnostics group will tell us which
	// file was missing).
	const rewritten = code.replace(/studio:\/\/file\/([^"'\s)]+)/g, (_match, p1) => {
		const replacement = replacements.get(p1);
		return replacement ?? p1.replace(/^\/+/, "");
	});

	return { code: rewritten, copiedCount };
}

function cleanupExternalAssets(bundlePath: string) {
	const dir = path.join(bundlePath, EXTERNAL_ASSETS_SUBDIR);
	try {
		if (fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true });
		}
	} catch {
		/* best-effort */
	}
}

/** Fallback rewrite for screenshot URLs that may have come in as
 *  `studio://file/...`. Strips the scheme and any leading slashes so the
 *  bare path can be used. Used only for screenshots — code references go
 *  through `copyExternalAssetsIntoBundle` instead. */
function rewriteStudioUrls(input: string): string {
	if (!input.includes("studio://file/")) return input;
	return input.replace(/studio:\/\/file\/([^"'\s)]+)/g, (_match, p1) => {
		return p1.replace(/^\/+/, "");
	});
}

// ── Post-processing ─────────────────────────────────────────────────────

async function reencodeForCompatibility(
	inputPath: string,
	outputPath: string,
	musicPath?: string,
	musicVolume = 0.25,
) {
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) {
		console.warn("[remotionExport] ffmpeg not found, skipping post-process");
		fs.renameSync(inputPath, outputPath);
		return;
	}

	// The Remotion output (input 0) always contains an audio stream — even
	// when the composition has no <Audio> elements, Remotion emits a silent
	// track. When the scene plan has narration + SFX, those are in [0:a].
	// When music is also provided, we amix Remotion audio with music.
	const env = getFfmpegEnv(ffmpegPath);
	const hasRemotionAudio = await checkForAudioStream(inputPath, ffmpegPath, env);
	const args: string[] = ["-i", inputPath];

	if (musicPath) {
		args.push("-i", musicPath);
	}

	args.push(
		"-map_metadata",
		"-1",
		"-c:v",
		"libx264",
		"-profile:v",
		"baseline",
		"-level",
		"4.0",
		"-pix_fmt",
		"yuv420p",
		"-crf",
		"18",
		"-preset",
		"fast",
	);

	// Audio handling — 4 cases:
	// 1. Remotion audio + music → amix both (narration/SFX at 1.0, music ducked)
	// 2. Remotion audio only → map through
	// 3. Music only → use music as the audio track
	// 4. Neither → silent output (-an)
	if (hasRemotionAudio && musicPath) {
		args.push(
			"-filter_complex",
			`[0:a]volume=1.0[narr];[1:a]volume=${musicVolume}[mus];[narr][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
			"-map",
			"0:v",
			"-map",
			"[aout]",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-shortest",
		);
	} else if (hasRemotionAudio) {
		args.push("-map", "0:v", "-map", "0:a", "-c:a", "aac", "-b:a", "192k");
	} else if (musicPath) {
		args.push(
			"-filter_complex",
			`[1:a]volume=${musicVolume}[aout]`,
			"-map",
			"0:v",
			"-map",
			"[aout]",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-shortest",
		);
	} else {
		args.push("-an");
	}

	args.push("-movflags", "+faststart", "-y", outputPath);

	console.log(
		`[remotionExport] Post-processing (remotion-audio=${hasRemotionAudio}, music=${!!musicPath}): ffmpeg ${args.join(" ")}`,
	);

	await execFile(ffmpegPath, args, { timeout: 600_000, env });
}

/** Probe a file with ffmpeg -i to detect whether it has an audio stream.
 *  ffmpeg prints stream info to stderr and always exits with code 1 when
 *  given no output file, so we parse stderr instead of checking exit code. */
async function checkForAudioStream(
	filePath: string,
	ffmpegPath: string,
	env?: NodeJS.ProcessEnv,
): Promise<boolean> {
	try {
		await execFile(ffmpegPath, ["-i", filePath, "-hide_banner"], { timeout: 10_000, env });
		return false;
	} catch (err: unknown) {
		const stderr = String((err as { stderr?: string })?.stderr || "");
		// Match "Stream #0:1(und): Audio: aac" or similar
		return /Stream #\d+:\d+[^:]*: Audio:/i.test(stderr);
	}
}

async function logFileInfo(filePath: string) {
	try {
		const stat = fs.statSync(filePath);
		console.log(
			`[remotionExport] Output: ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`,
		);

		const ffmpegPath = await getFfmpegPath();
		if (!ffmpegPath) return;

		// Use ffmpeg -i to get stream info (ffprobe may not be bundled)
		const env = getFfmpegEnv(ffmpegPath);
		try {
			await execFile(ffmpegPath, ["-i", filePath, "-hide_banner"], { timeout: 10_000, env });
		} catch (probeErr: unknown) {
			// ffmpeg -i always exits with code 1 but prints stream info to stderr
			const probeStderr = (probeErr as { stderr?: string })?.stderr;
			if (probeStderr) {
				console.log("[remotionExport] File info:\n" + probeStderr);
			}
		}
	} catch (err) {
		console.warn("[remotionExport] Diagnostics failed:", err);
	}
}

// ── Screenshot handling ─────────────────────────────────────────────────

async function writeScreenshotsToBundle(
	bundlePath: string,
	screenshots: string[],
): Promise<string[]> {
	const screenshotDir = path.join(bundlePath, "_screenshots");
	fs.mkdirSync(screenshotDir, { recursive: true });

	const urls: string[] = [];

	for (let i = 0; i < screenshots.length; i++) {
		const dataUrl = screenshots[i];
		if (!dataUrl || !dataUrl.startsWith("data:")) {
			urls.push(dataUrl || "");
			continue;
		}

		const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
		if (!match) {
			urls.push(dataUrl);
			continue;
		}

		const ext = match[1] === "jpeg" ? "jpg" : match[1];
		const buffer = Buffer.from(match[2], "base64");
		const fileName = `screenshot-${i}.${ext}`;
		const filePath = path.join(screenshotDir, fileName);

		fs.writeFileSync(filePath, buffer);
		urls.push(`_screenshots/${fileName}`);
	}

	console.log(`[remotionExport] Wrote ${urls.length} screenshots to ${screenshotDir}`);
	return urls;
}

/**
 * Copy fetched images into the served bundle and hand back bundle-relative
 * sources.
 *
 * Headless Chromium loads the composition over http, and a `file://` image on
 * such a page is blocked — so the file has to live under the bundle to be
 * fetchable at all. This mirrors how screenshots are staged, and the names are
 * the validated asset ids, so nothing a planner wrote reaches the filesystem.
 */
function copyImageAssetsToBundle(
	bundlePath: string,
	assets: Array<{ assetId: string; src: string }> | undefined,
): HyperFrameImageAsset[] {
	if (!assets?.length) return [];
	const assetDir = path.join(bundlePath, "_assets");
	fs.mkdirSync(assetDir, { recursive: true });

	const staged: HyperFrameImageAsset[] = [];
	for (const asset of assets) {
		// An id that is not a plain slug never becomes a path segment.
		if (!/^[a-z0-9-]{1,64}$/i.test(asset.assetId)) continue;
		try {
			const extension = path.extname(asset.src).replace(/[^a-z0-9.]/gi, "") || ".png";
			const fileName = `${asset.assetId}${extension}`;
			fs.copyFileSync(asset.src, path.join(assetDir, fileName));
			staged.push({ assetId: asset.assetId, src: `_assets/${fileName}` });
		} catch (error) {
			// A missing file is a text frame, not a failed render: the storyboard
			// only ever references ids the resolver confirmed it downloaded, so
			// this is the disk changing under us rather than a planning error.
			console.warn(`[remotionExport] Could not stage image ${asset.assetId}:`, error);
		}
	}
	return staged;
}

function cleanupScreenshots(bundlePath: string) {
	const screenshotDir = path.join(bundlePath, "_screenshots");
	try {
		if (fs.existsSync(screenshotDir)) {
			fs.rmSync(screenshotDir, { recursive: true });
		}
	} catch {
		/* best-effort */
	}
}

// ── Bundle resolution ───────────────────────────────────────────────────

async function resolveServeUrl(): Promise<string> {
	if (cachedBundleLocation) return cachedBundleLocation;

	if (app.isPackaged) {
		const preBundledPath = path.join(process.resourcesPath, "remotion-bundle");
		if (fs.existsSync(preBundledPath)) {
			console.log("[remotionExport] Using pre-bundled Remotion project:", preBundledPath);
			cachedBundleLocation = preBundledPath;
			return preBundledPath;
		}
		throw new Error(
			"Pre-bundled Remotion project not found at " +
				preBundledPath +
				". Ensure scripts/bundle-remotion.mjs ran during the build.",
		);
	}

	const entryPoint = path.resolve(resolveRuntimeProjectRoot(), "src/lib/remotion/index.ts");
	console.log("[remotionExport] Bundling Remotion project from:", entryPoint);

	const { bundle } = await import("@remotion/bundler");

	cachedBundleLocation = await bundle({
		entryPoint,
		webpackOverride: (config) => {
			config.resolve = config.resolve || {};
			config.resolve.alias = {
				...(config.resolve.alias || {}),
				"@": path.resolve(app.getAppPath(), "src"),
			};
			return config;
		},
	});

	console.log("[remotionExport] Bundle ready at:", cachedBundleLocation);
	return cachedBundleLocation;
}

/**
 * `app.getAppPath()` is the app directory in production but the generated
 * `dist-electron` directory in Playwright/direct-main development launches.
 * Resolve the checked-out project root in both cases without trusting input
 * from the renderer.
 */
function resolveRuntimeProjectRoot() {
	const appPath = app.getAppPath();
	const candidates = [appPath, process.env.APP_ROOT, path.resolve(appPath, "..")].filter(
		(candidate): candidate is string => Boolean(candidate),
	);
	return (
		candidates.find((candidate) =>
			fs.existsSync(path.join(candidate, "src", "lib", "remotion", "index.ts")),
		) ?? appPath
	);
}
