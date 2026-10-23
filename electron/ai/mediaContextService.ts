/**
 * Privileged media-context registry.
 *
 * The renderer can ask the native picker for files, but it cannot nominate an
 * arbitrary filesystem path for an AI session. The picker registers a random
 * asset id; later planning accepts ids only and stages fresh, validated copies
 * into the isolated session workspace.
 */
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import {
	buildShotSegments,
	buildTranscriptExcerpt,
	getMediaContextFileType,
	isMediaContextAssetId,
	MEDIA_CONTEXT_FILE_TYPES,
	MEDIA_CONTEXT_LIMITS,
	type MediaContextAsset,
	type MediaContextKind,
	type MediaContextRole,
	type MediaContextSemanticAnalysis,
	type MediaContextShotSegment,
	normalizeMediaContextSemanticAnalysis,
	parseMediaContextProbe,
	parseShotChangeTimes,
	preferredContactSheetFrameTimes,
} from "../../src/lib/ai/mediaContext";
import { getFfmpegEnv, getFfmpegPath } from "../ffmpeg";
import { analyzeImage, loadAIConfig, supportsVision } from "./aiService";

const EXTENSION_INFO = MEDIA_CONTEXT_FILE_TYPES;
const execFile = promisify(execFileCallback);
const MAX_VISION_BYTES = 8 * 1024 * 1024;
const SHOT_DETECTION_THRESHOLD = 0.32;

export interface MediaContextAnalysisOptions {
	/** Use local Whisper when the binary/model is installed and the clip is bounded. */
	includeTranscript?: boolean;
	/** Use the configured vision-capable AI provider for a factual visual/OCR pass. */
	includeVision?: boolean;
}

interface RegisteredAsset {
	asset: MediaContextAsset;
	sourcePath: string;
	deviceSizeBytes: number;
	modifiedTimeMs: number;
}

const registeredAssets = new Map<string, RegisteredAsset>();

function extensionInfo(filePath: string) {
	return getMediaContextFileType(filePath);
}

function safeLabel(filePath: string): string {
	const label = Array.from(path.basename(filePath).trim(), (character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127 ? " " : character;
	}).join("");
	return label.slice(0, MEDIA_CONTEXT_LIMITS.maxLabelLength) || "Untitled media";
}

function defaultRole(kind: MediaContextKind): MediaContextRole {
	return kind === "video" ? "source-footage" : "product-truth";
}

async function probeMediaFile(
	filePath: string,
): Promise<ReturnType<typeof parseMediaContextProbe>> {
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) return {};

	let output = "";
	try {
		const result = await execFile(ffmpegPath, ["-hide_banner", "-i", filePath], {
			env: getFfmpegEnv(ffmpegPath),
			timeout: 10_000,
			maxBuffer: 2 * 1024 * 1024,
		});
		output = `${result.stdout}\n${result.stderr}`;
	} catch (error) {
		const processError = error as { stdout?: string; stderr?: string };
		output = `${processError.stdout ?? ""}\n${processError.stderr ?? ""}`;
	}

	return parseMediaContextProbe(output);
}

/**
 * Detect coarse edit points from a validated staged video. This is advisory:
 * the planner gets useful source ranges, while the render contract still
 * clamps every selection against the probed source duration.
 */
async function detectVideoShotSegments(
	filePath: string,
	durationSeconds?: number,
): Promise<ReturnType<typeof buildShotSegments>> {
	if (
		typeof durationSeconds !== "number" ||
		!Number.isFinite(durationSeconds) ||
		durationSeconds < MEDIA_CONTEXT_LIMITS.minShotSegmentSeconds
	) {
		return [];
	}
	const ffmpegPath = await getFfmpegPath();
	if (!ffmpegPath) return [];

	let output = "";
	try {
		const result = await execFile(
			ffmpegPath,
			[
				"-hide_banner",
				"-loglevel",
				"info",
				"-i",
				filePath,
				"-vf",
				`select='gt(scene,${SHOT_DETECTION_THRESHOLD})',showinfo`,
				"-an",
				"-f",
				"null",
				"-",
			],
			{
				env: getFfmpegEnv(ffmpegPath),
				timeout: 45_000,
				maxBuffer: 8 * 1024 * 1024,
			},
		);
		output = `${result.stdout}\n${result.stderr}`;
	} catch (error) {
		const processError = error as { stdout?: string; stderr?: string };
		output = `${processError.stdout ?? ""}\n${processError.stderr ?? ""}`;
	}

	return buildShotSegments(durationSeconds, parseShotChangeTimes(output, durationSeconds));
}

export async function analyzeMediaContextAssets(
	assets: MediaContextAsset[],
	options: MediaContextAnalysisOptions = {},
): Promise<MediaContextAsset[]> {
	const includeTranscript = options.includeTranscript ?? true;
	const includeVision = options.includeVision ?? true;
	const analyzed: MediaContextAsset[] = [];
	for (const asset of assets.slice(0, MEDIA_CONTEXT_LIMITS.maxAssets)) {
		if (!asset.previewPath) {
			analyzed.push(asset);
			continue;
		}
		const fileStats = await fs.lstat(asset.previewPath).catch(() => null);
		if (!fileStats?.isFile() || fileStats.isSymbolicLink()) {
			// A renderer-provided path is never an authority. If an internal
			// caller hands us an invalid or symlinked preview, remove the path
			// before returning the metadata to the planner.
			const { previewPath: _previewPath, ...safeAsset } = asset;
			analyzed.push(safeAsset);
			continue;
		}
		const probe = await probeMediaFile(asset.previewPath);
		const merged = { ...asset, ...probe };
		const shotSegments =
			asset.kind === "video"
				? await detectVideoShotSegments(asset.previewPath, merged.durationSeconds)
				: [];

		let transcriptSegments = asset.transcriptSegments;
		if (
			includeTranscript &&
			asset.kind === "video" &&
			merged.hasAudio !== false &&
			(typeof merged.durationSeconds !== "number" ||
				merged.durationSeconds <= MEDIA_CONTEXT_LIMITS.maxTranscriptDurationSeconds)
		) {
			try {
				// Keep Electron/model-manager initialization out of renderer-style
				// tests and startup. Whisper is loaded only for an actual video
				// analysis request.
				const { transcribeMediaContext } = await import("./whisper");
				const transcript = await transcribeMediaContext(asset.previewPath, merged.durationSeconds);
				if (transcript.length) transcriptSegments = transcript;
			} catch (error) {
				// Whisper is an enhancement. Missing binaries/models and silent or
				// unsupported media must never prevent planning from continuing.
				console.warn(
					`[media context] Transcript unavailable for ${asset.id}:`,
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		let semantic: MediaContextSemanticAnalysis = {};
		if (includeVision) {
			semantic = await analyzeMediaContextVision(asset, asset.previewPath, merged, shotSegments);
		}
		analyzed.push({
			...merged,
			...(shotSegments.length ? { shotSegments } : {}),
			...(semantic.visualSummary ? { visualSummary: semantic.visualSummary } : {}),
			...(semantic.ocrText?.length ? { ocrText: semantic.ocrText } : {}),
			...(transcriptSegments?.length
				? {
						transcriptSegments,
						transcriptExcerpt: buildTranscriptExcerpt(transcriptSegments),
					}
				: {}),
		});
	}
	return analyzed;
}

function parseVisionJson(text: string): MediaContextSemanticAnalysis {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
	const candidate = (() => {
		try {
			return JSON.parse(trimmed);
		} catch {
			const start = trimmed.indexOf("{");
			const end = trimmed.lastIndexOf("}");
			if (start < 0 || end <= start) return undefined;
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return undefined;
			}
		}
	})();
	return normalizeMediaContextSemanticAnalysis(candidate);
}

async function getSemanticVisionData(
	asset: MediaContextAsset,
	filePath: string,
	merged: MediaContextAsset,
	shotSegments: MediaContextAsset["shotSegments"],
): Promise<string | undefined> {
	if (asset.kind === "image") {
		if (asset.mimeType === "image/svg+xml") return undefined;
		const bytes = await fs.readFile(filePath);
		if (!bytes.length || bytes.length > MAX_VISION_BYTES) return undefined;
		return `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
	}

	// Registered references can use the existing shot-aware contact sheet. This
	// keeps the planner's visual context representative instead of sampling only
	// the first frame of a long clip.
	if (isMediaContextAssetId(asset.id)) {
		const contactSheet = await getMediaContextContactSheet(
			asset.id,
			6,
			merged.durationSeconds,
			shotSegments,
		);
		if (contactSheet.success && contactSheet.dataUrl) return contactSheet.dataUrl;
	}
	return undefined;
}

async function analyzeMediaContextVision(
	asset: MediaContextAsset,
	filePath: string,
	merged: MediaContextAsset,
	shotSegments: MediaContextAsset["shotSegments"],
): Promise<MediaContextSemanticAnalysis> {
	try {
		const config = await loadAIConfig();
		if (!supportsVision(config.provider)) return {};
		if (!config.apiKey && config.provider !== "claude-code" && config.provider !== "codex")
			return {};
		const dataUrl = await getSemanticVisionData(asset, filePath, merged, shotSegments);
		if (!dataUrl) return {};
		const base64 = dataUrl.split(",", 2)[1];
		if (!base64 || base64.length > MAX_VISION_BYTES * 2) return {};
		const result = await analyzeImage(
			[
				"Analyze only what is visibly present in this supplied media reference.",
				'Return JSON only: {"visualSummary":"one factual sentence, maximum 320 characters","ocrText":["each clearly readable visible text item"]}.',
				"For a video contact sheet, describe the useful visual sequence from left to right and transcribe only clearly readable text.",
				"Do not infer product claims, brand names, UI behavior, people identities, or details that cannot be seen.",
			].join(" "),
			base64,
			"You are a conservative media analyst. Follow the requested JSON schema exactly and never invent missing visual details.",
		);
		return result.success && result.text ? parseVisionJson(result.text) : {};
	} catch (error) {
		console.warn(
			`[media context] Visual/OCR analysis unavailable for ${asset.id}:`,
			error instanceof Error ? error.message : String(error),
		);
		return {};
	}
}

async function getCurrentRegisteredAsset(id: string): Promise<RegisteredAsset | undefined> {
	const registered = registeredAssets.get(id);
	if (!registered) return undefined;
	const current = await fs.lstat(registered.sourcePath).catch(() => null);
	if (
		!current?.isFile() ||
		current.isSymbolicLink() ||
		current.size !== registered.deviceSizeBytes ||
		current.mtimeMs !== registered.modifiedTimeMs
	) {
		return undefined;
	}
	return registered;
}

export async function getMediaContextVisionData(
	assetId: string,
	timeSeconds = 0,
): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
	if (!isMediaContextAssetId(assetId)) return { success: false, error: "Invalid media asset id." };
	const registered = await getCurrentRegisteredAsset(assetId);
	if (!registered) return { success: false, error: "The media reference is no longer available." };

	try {
		if (registered.asset.kind === "image") {
			if (registered.deviceSizeBytes > MAX_VISION_BYTES) {
				return { success: false, error: "The image is too large for vision context." };
			}
			const bytes = await fs.readFile(registered.sourcePath);
			return {
				success: true,
				dataUrl: `data:${registered.asset.mimeType};base64,${bytes.toString("base64")}`,
			};
		}

		const ffmpegPath = await getFfmpegPath();
		if (!ffmpegPath) return { success: false, error: "FFmpeg is not available for video context." };
		const result = await execFile(
			ffmpegPath,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-ss",
				String(Math.max(0, Math.min(timeSeconds, registered.asset.durationSeconds ?? timeSeconds))),
				"-i",
				registered.sourcePath,
				"-frames:v",
				"1",
				"-vf",
				"scale=1280:-2",
				"-f",
				"image2pipe",
				"-vcodec",
				"mjpeg",
				"pipe:1",
			],
			{
				env: getFfmpegEnv(ffmpegPath),
				timeout: 20_000,
				maxBuffer: MAX_VISION_BYTES,
				encoding: "buffer",
			},
		);
		const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
		if (bytes.length === 0 || bytes.length > MAX_VISION_BYTES) {
			return { success: false, error: "The video frame was empty or too large." };
		}
		return { success: true, dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Could not prepare media for vision context.",
		};
	}
}

/**
 * Build one bounded overview image for a video. The model receives several
 * evenly spaced moments in one vision request, while the renderer still gets
 * only a data URL and never a filesystem path.
 */
export async function getMediaContextContactSheet(
	assetId: string,
	frameCount = 6,
	durationSeconds?: number,
	shotSegments?: MediaContextShotSegment[],
): Promise<{ success: boolean; dataUrl?: string; frameTimesSeconds?: number[]; error?: string }> {
	if (!isMediaContextAssetId(assetId)) return { success: false, error: "Invalid media asset id." };
	const registered = await getCurrentRegisteredAsset(assetId);
	if (!registered) return { success: false, error: "The media reference is no longer available." };
	if (registered.asset.kind !== "video") {
		return { success: false, error: "Contact sheets are only available for video references." };
	}

	try {
		const ffmpegPath = await getFfmpegPath();
		if (!ffmpegPath) return { success: false, error: "FFmpeg is not available for video context." };
		const requestedCount = Number.isFinite(frameCount) ? Math.floor(frameCount) : 6;
		const count = Math.max(2, Math.min(MEDIA_CONTEXT_LIMITS.maxContactSheetFrames, requestedCount));
		const duration = durationSeconds ?? registered.asset.durationSeconds ?? 60;
		const frameTimesSeconds = preferredContactSheetFrameTimes(
			duration,
			count,
			shotSegments ?? registered.asset.shotSegments ?? [],
		);
		const columns = Math.min(4, Math.ceil(Math.sqrt(count)));
		const perFrameWidth = 640;
		const perFrameHeight = 360;
		const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "guide-contact-sheet-"));
		let bytes: Buffer;
		try {
			const framePaths: string[] = [];
			const capturedTimes: number[] = [];
			for (const [index, timeSeconds] of frameTimesSeconds.entries()) {
				const result = await execFile(
					ffmpegPath,
					[
						"-hide_banner",
						"-loglevel",
						"error",
						"-ss",
						String(Math.max(0, Math.min(timeSeconds, Math.max(0, duration - 0.05)))),
						"-i",
						registered.sourcePath,
						"-frames:v",
						"1",
						"-vf",
						[
							`scale=${perFrameWidth}:${perFrameHeight}:force_original_aspect_ratio=decrease`,
							`pad=${perFrameWidth}:${perFrameHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
						].join(","),
						"-an",
						"-f",
						"image2",
						"-vcodec",
						"mjpeg",
						"pipe:1",
					],
					{
						env: getFfmpegEnv(ffmpegPath),
						timeout: 20_000,
						maxBuffer: 2 * 1024 * 1024,
						encoding: "buffer",
					},
				);
				const frame = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
				if (!frame.length || frame.length > 2 * 1024 * 1024) continue;
				const framePath = path.join(temporaryDirectory, `frame-${index}.jpg`);
				await fs.writeFile(framePath, frame, { mode: 0o600 });
				framePaths.push(framePath);
				capturedTimes.push(timeSeconds);
			}
			if (framePaths.length === 0) {
				return { success: false, error: "The video contact sheet frames were empty." };
			}
			const inputs = framePaths.flatMap((framePath) => ["-i", framePath]);
			const labels = framePaths.map((_, index) => `[${index}:v]`).join("");
			const layout = framePaths
				.map(
					(_, index) =>
						`${8 + (index % columns) * (perFrameWidth + 8)}_${8 + Math.floor(index / columns) * (perFrameHeight + 8)}`,
				)
				.join("|");
			const result = await execFile(
				ffmpegPath,
				[
					"-hide_banner",
					"-loglevel",
					"error",
					...inputs,
					"-filter_complex",
					framePaths.length === 1
						? "[0:v]pad=iw+16:ih+16:8:8:color=black"
						: `${labels}xstack=inputs=${framePaths.length}:layout=${layout}:fill=black`,
					"-frames:v",
					"1",
					"-f",
					"image2pipe",
					"-vcodec",
					"mjpeg",
					"pipe:1",
				],
				{
					env: getFfmpegEnv(ffmpegPath),
					timeout: 20_000,
					maxBuffer: MEDIA_CONTEXT_LIMITS.maxContactSheetBytes,
					encoding: "buffer",
				},
			);
			bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
			// Keep the time labels aligned if a decoder skipped an empty frame.
			frameTimesSeconds.splice(0, frameTimesSeconds.length, ...capturedTimes);
		} finally {
			await fs.rm(temporaryDirectory, { recursive: true, force: true });
		}
		if (bytes.length === 0 || bytes.length > MEDIA_CONTEXT_LIMITS.maxContactSheetBytes) {
			return { success: false, error: "The video contact sheet was empty or too large." };
		}
		return {
			success: true,
			dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
			frameTimesSeconds,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Could not prepare the video contact sheet.",
		};
	}
}

export async function analyzeRegisteredMediaContextAssets(
	assetIds: unknown,
): Promise<MediaContextAsset[]> {
	const ids = assetIdsFromInput(assetIds);
	const assets = ids
		.map((id) => registeredAssets.get(id)?.asset)
		.filter((asset): asset is MediaContextAsset => Boolean(asset));
	const analyzed = await Promise.all(
		assets.map(async (asset) => {
			const registered = await getCurrentRegisteredAsset(asset.id);
			if (!registered) return undefined;
			const analyzedAsset = (await analyzeMediaContextAssets([registered.asset]))[0];
			if (analyzedAsset) registeredAssets.set(asset.id, { ...registered, asset: analyzedAsset });
			return analyzedAsset;
		}),
	);
	return analyzed.filter((asset): asset is MediaContextAsset => Boolean(asset));
}

async function validatePickedFile(filePath: string): Promise<RegisteredAsset | undefined> {
	const absolutePath = path.resolve(filePath);
	const info = extensionInfo(absolutePath);
	if (!info) return undefined;

	const linkStats = await fs.lstat(absolutePath).catch(() => null);
	if (!linkStats?.isFile() || linkStats.isSymbolicLink()) return undefined;
	if (linkStats.size <= 0 || linkStats.size > MEDIA_CONTEXT_LIMITS.maxBytes) return undefined;

	const id = `media-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
	const asset: MediaContextAsset = {
		id,
		kind: info.kind,
		role: defaultRole(info.kind),
		label: safeLabel(absolutePath),
		mimeType: info.mimeType,
		sizeBytes: linkStats.size,
		previewPath: absolutePath,
	};
	const registered: RegisteredAsset = {
		asset,
		sourcePath: absolutePath,
		deviceSizeBytes: linkStats.size,
		modifiedTimeMs: linkStats.mtimeMs,
	};
	registeredAssets.set(id, registered);
	return registered;
}

export async function pickMediaContextAssets(
	parentWindow?: BrowserWindow | null,
): Promise<{ success: boolean; canceled?: boolean; assets?: MediaContextAsset[]; error?: string }> {
	const dialogOptions: OpenDialogOptions = {
		title: "Add media references",
		filters: [
			{
				name: "Images and videos",
				extensions: Object.keys(EXTENSION_INFO).map((extension) => extension.slice(1)),
			},
		],
		properties: ["openFile", "multiSelections"],
	};
	const result = parentWindow
		? await dialog.showOpenDialog(parentWindow, dialogOptions)
		: await dialog.showOpenDialog(dialogOptions);
	if (result.canceled || result.filePaths.length === 0) {
		return { success: false, canceled: true };
	}

	const assets: MediaContextAsset[] = [];
	for (const filePath of result.filePaths.slice(0, MEDIA_CONTEXT_LIMITS.maxAssets)) {
		const registered = await validatePickedFile(filePath);
		if (registered) assets.push(registered.asset);
	}

	if (assets.length === 0) {
		return { success: false, error: "No supported, readable media was selected." };
	}
	return { success: true, assets };
}

function assetIdsFromInput(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((id): id is string => typeof id === "string"))].slice(
		0,
		MEDIA_CONTEXT_LIMITS.maxAssets,
	);
}

/**
 * Turn a common white-paper/JPEG logo into a transparent PNG before it reaches
 * Remotion. The original is kept registered and untouched; only the isolated
 * session copy is derived. This prevents the accidental white square that
 * otherwise appears when a supplied logo is placed over a branded field.
 */
async function writeMatteFreeLogo(sourcePath: string, destinationPath: string): Promise<void> {
	const sharpModule = await import("sharp");
	const sharp = sharpModule.default;
	const source = sharp(sourcePath);
	const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	if (info.channels !== 4) throw new Error("Logo raster did not decode to RGBA.");

	for (let offset = 0; offset + 3 < data.length; offset += 4) {
		const red = data[offset] ?? 0;
		const green = data[offset + 1] ?? 0;
		const blue = data[offset + 2] ?? 0;
		const minimum = Math.min(red, green, blue);
		const chroma = Math.max(red, green, blue) - minimum;
		// Only neutral near-white pixels are matte candidates. Saturated white
		// highlights in the actual mark remain opaque.
		if (chroma < 22 && minimum > 208) {
			const matteAlpha = Math.round(Math.max(0, Math.min(255, ((248 - minimum) / 40) * 255)));
			data[offset + 3] = Math.min(data[offset + 3] ?? 255, matteAlpha);
		}
	}

	await sharp(data, {
		raw: { width: info.width, height: info.height, channels: 4 },
	})
		.png()
		.toFile(destinationPath);
}

export async function stageMediaContextAssets(
	assetIds: unknown,
	destinationDirectory: string,
	logoAssetIds: Iterable<string> = [],
): Promise<MediaContextAsset[]> {
	const staged: MediaContextAsset[] = [];
	const logoIds = new Set(logoAssetIds);
	await fs.mkdir(destinationDirectory, { recursive: true });

	for (const assetId of assetIdsFromInput(assetIds)) {
		const registered = registeredAssets.get(assetId);
		if (!registered) continue;

		const current = await fs.lstat(registered.sourcePath).catch(() => null);
		if (
			!current?.isFile() ||
			current.isSymbolicLink() ||
			current.size !== registered.deviceSizeBytes ||
			current.mtimeMs !== registered.modifiedTimeMs
		) {
			continue;
		}

		const isLogo = logoIds.has(assetId) && registered.asset.kind === "image";
		const extension = isLogo ? ".png" : path.extname(registered.sourcePath).toLowerCase();
		const stagedPath = path.join(destinationDirectory, `${assetId}${extension}`);
		const alreadyStaged = await fs.lstat(stagedPath).catch(() => null);
		if (alreadyStaged && (!alreadyStaged.isFile() || alreadyStaged.isSymbolicLink())) {
			throw new Error(`The staged media destination is not a regular file: ${assetId}`);
		}
		if (!alreadyStaged) {
			if (isLogo) {
				await writeMatteFreeLogo(registered.sourcePath, stagedPath);
			} else {
				await fs.copyFile(registered.sourcePath, stagedPath, fsConstants.COPYFILE_EXCL);
			}
		}
		staged.push({
			...registered.asset,
			...(isLogo ? { mimeType: "image/png" } : {}),
			previewPath: stagedPath,
		});
	}

	return staged;
}

export function getRegisteredMediaContextAsset(id: string): MediaContextAsset | undefined {
	return registeredAssets.get(id)?.asset;
}

export function releaseMediaContextAssets(ids: unknown): void {
	for (const id of assetIdsFromInput(ids)) registeredAssets.delete(id);
}

export function registerMediaContextHandlers(): void {
	ipcMain.handle("open-ai-reference-file-picker", async (event) => {
		try {
			return await pickMediaContextAssets(BrowserWindow.fromWebContents(event.sender));
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Could not open the media picker.",
			};
		}
	});

	ipcMain.handle("release-ai-reference-assets", (_event, ids: unknown) => {
		releaseMediaContextAssets(ids);
		return { success: true };
	});

	ipcMain.handle("analyze-ai-reference-assets", async (_event, ids: unknown) => {
		try {
			return { success: true, assets: await analyzeRegisteredMediaContextAssets(ids) };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Could not analyze the media references.",
			};
		}
	});

	ipcMain.handle(
		"get-ai-reference-vision-data",
		async (_event, assetId: unknown, timeSeconds: unknown) =>
			getMediaContextVisionData(
				typeof assetId === "string" ? assetId : "",
				typeof timeSeconds === "number" ? timeSeconds : 0,
			),
	);
	ipcMain.handle(
		"get-ai-reference-contact-sheet",
		async (_event, assetId: unknown, frameCount: unknown) =>
			getMediaContextContactSheet(
				typeof assetId === "string" ? assetId : "",
				typeof frameCount === "number" ? frameCount : 6,
			),
	);
}
