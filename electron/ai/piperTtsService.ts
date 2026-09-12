/**
 * Piper TTS — local, offline neural narration.
 *
 * Piper runs a small ONNX voice model on the CPU and needs no account, no key,
 * and no network once its voice is on disk, which is what makes it the right
 * engine for a studio that renders locally. It is also the only engine here
 * that covers forty-odd languages without a per-language contract: the voice is
 * chosen from the narration's own language (see `piperVoices.ts`).
 *
 * Two things have to be present before it can speak: the `piper` executable,
 * which the user installs or the build bundles, and the voice's two files,
 * which are downloaded on first use and then kept. Neither is bundled into the
 * app — the voices alone run to gigabytes — so every entry point here reports
 * precisely which of the two is missing rather than failing as "unavailable".
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { getFfmpegPath } from "../ffmpeg";
import { loadSettings } from "../settings";
import {
	getPiperVoice,
	PIPER_VOICE_INDEX_URL,
	parseVoiceId,
	pickVoiceId,
	type VoiceChoice,
	voiceFileUrls,
} from "./piperVoices";

const VOICES_DIR = "piper-voices";
const TTS_OUTPUT_DIR = "tts-output";
const USER_AGENT = "GuideStudio/1.0";

export interface PiperResult {
	success: boolean;
	audioPath?: string;
	/** The voice that actually spoke, so a caller can show or cache it. */
	voiceId?: string;
	error?: string;
}

export interface PiperVoiceProgress {
	voiceId: string;
	downloadedBytes: number;
	totalBytes: number;
	percent: number;
}

function voicesDir(): string {
	return path.join(app.getPath("userData"), VOICES_DIR);
}

function voicePaths(voiceId: string): { model: string; config: string } {
	const dir = voicesDir();
	return {
		model: path.join(dir, `${voiceId}.onnx`),
		config: path.join(dir, `${voiceId}.onnx.json`),
	};
}

/**
 * Cleanup failures are not worth reporting: every use below is deleting a file
 * that may already be gone, on the way to reporting the error that got us here.
 */
function swallow(): void {
	// Deliberately nothing.
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

// ── The executable ───────────────────────────────────────────────────────

let cachedBinary: string | null | undefined;

/**
 * Finds the Piper executable.
 *
 * An explicit setting wins, then the environment (which is how the e2e driver
 * points at a build), then a copy shipped beside the app, then whatever is on
 * PATH. Resolution is cached for the session: this runs once per narration
 * line, and a user who installs Piper mid-session can be asked to restart far
 * more cheaply than every caller can pay for a PATH scan.
 */
export async function resolvePiperBinary(): Promise<string | null> {
	if (cachedBinary !== undefined) return cachedBinary;
	cachedBinary = await findPiperBinary();
	return cachedBinary;
}

/** Forgets the cached lookup, after the user sets a path or installs Piper. */
export function forgetPiperBinary(): void {
	cachedBinary = undefined;
}

async function findPiperBinary(): Promise<string | null> {
	const executable = process.platform === "win32" ? "piper.exe" : "piper";

	const settings = await loadSettings().catch(() => null);
	const configured = settings?.piperPath?.trim();
	if (configured && (await exists(configured))) return configured;

	const fromEnv = process.env.PIPER_PATH?.trim();
	if (fromEnv && (await exists(fromEnv))) return fromEnv;

	const bundled = app.isPackaged
		? path.join(process.resourcesPath, "piper", executable)
		: path.join(app.getAppPath(), "native", "piper", executable);
	if (await exists(bundled)) return bundled;

	return findOnPath(executable);
}

function findOnPath(executable: string): Promise<string | null> {
	return new Promise((resolve) => {
		const finder = process.platform === "win32" ? "where" : "which";
		const child = spawn(finder, [executable]);
		let out = "";
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString();
		});
		child.on("error", () => resolve(null));
		child.on("close", (code) => {
			const first = out.split(/\r?\n/).find((line) => line.trim());
			resolve(code === 0 && first ? first.trim() : null);
		});
	});
}

// ── Voices on disk ───────────────────────────────────────────────────────

export async function isVoiceInstalled(voiceId: string): Promise<boolean> {
	const files = voicePaths(voiceId);
	return (await exists(files.model)) && (await exists(files.config));
}

/** The voice ids already downloaded, newest first is not meaningful — sorted. */
export async function installedVoices(): Promise<string[]> {
	try {
		const entries = await fs.readdir(voicesDir());
		return entries
			.filter((name) => name.endsWith(".onnx"))
			.map((name) => name.slice(0, -".onnx".length))
			.sort();
	} catch {
		return [];
	}
}

export interface PiperStatus {
	/** True when Piper could speak right now for at least one voice. */
	ready: boolean;
	binaryPath: string | null;
	installedVoices: string[];
	/** Present when Piper cannot be used, saying what to do about it. */
	error?: string;
}

export async function getPiperStatus(): Promise<PiperStatus> {
	const binaryPath = await resolvePiperBinary();
	const voices = await installedVoices();
	if (!binaryPath) {
		return {
			ready: false,
			binaryPath: null,
			installedVoices: voices,
			error:
				"Piper is not installed. Download a release from github.com/rhasspy/piper, then set its path in Settings (or put it on your PATH).",
		};
	}
	return { ready: true, binaryPath, installedVoices: voices };
}

// ── Downloading a voice ──────────────────────────────────────────────────

interface VoiceIndexEntry {
	key?: string;
	files?: Record<string, unknown>;
}

let cachedIndex: Record<string, VoiceIndexEntry> | null | undefined;

/**
 * The upstream voice index, which lists every published voice and the exact
 * path of each of its files.
 *
 * Consulted so that a voice key this app ships in its shortlist but which has
 * since moved can still be downloaded, and so a key the app has never heard of
 * — one the user typed, or a new release — resolves without a code change. A
 * failure here is not fatal: the paths are derivable from the key, and
 * `voiceFileUrls` does exactly that.
 */
async function fetchVoiceIndex(): Promise<Record<string, VoiceIndexEntry> | null> {
	if (cachedIndex !== undefined) return cachedIndex;
	try {
		const response = await fetch(PIPER_VOICE_INDEX_URL, {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		cachedIndex = (await response.json()) as Record<string, VoiceIndexEntry>;
	} catch (err) {
		console.warn("[Piper] voice index unavailable, deriving paths from the key:", err);
		cachedIndex = null;
	}
	return cachedIndex;
}

async function resolveDownloadUrls(
	voiceId: string,
): Promise<{ model: string; config: string } | null> {
	const index = await fetchVoiceIndex();
	const entry = index?.[voiceId];
	if (entry?.files) {
		const base = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
		const paths = Object.keys(entry.files);
		const model = paths.find((file) => file.endsWith(".onnx"));
		const config = paths.find((file) => file.endsWith(".onnx.json"));
		if (model && config) {
			return { model: `${base}/${model}`, config: `${base}/${config}` };
		}
	}
	return voiceFileUrls(voiceId);
}

/**
 * Downloads a voice's model and config, streaming the model to disk.
 *
 * The model is tens to hundreds of megabytes, so it is streamed through to a
 * temporary file and renamed on completion — buffering it whole would hold the
 * entire voice in the main process's heap, and a half-written file left behind
 * by an interrupted download would look installed forever after.
 */
export async function downloadPiperVoice(
	voiceId: string,
	onProgress?: (progress: PiperVoiceProgress) => void,
): Promise<{ success: boolean; error?: string }> {
	if (!parseVoiceId(voiceId)) {
		return { success: false, error: `"${voiceId}" is not a Piper voice name.` };
	}
	if (await isVoiceInstalled(voiceId)) return { success: true };

	const urls = await resolveDownloadUrls(voiceId);
	if (!urls) return { success: false, error: `Could not work out where to get ${voiceId}.` };

	const files = voicePaths(voiceId);
	await fs.mkdir(voicesDir(), { recursive: true });
	try {
		await download(urls.model, files.model, (downloadedBytes, totalBytes) =>
			onProgress?.({
				voiceId,
				downloadedBytes,
				totalBytes,
				percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
			}),
		);
		await download(urls.config, files.config);
		return { success: true };
	} catch (err) {
		// Leave nothing half-installed: the next run must either find a whole
		// voice or none at all.
		await fs.rm(files.model, { force: true }).catch(swallow);
		await fs.rm(files.config, { force: true }).catch(swallow);
		const message = err instanceof Error ? err.message : String(err);
		return { success: false, error: `Downloading ${voiceId} failed: ${message}` };
	}
}

/** Streams one URL to one file, following the redirects HuggingFace serves. */
function download(
	url: string,
	destination: string,
	onProgress?: (downloadedBytes: number, totalBytes: number) => void,
	redirectsLeft = 5,
): Promise<void> {
	const temporary = `${destination}.download`;
	return new Promise((resolve, reject) => {
		const get = url.startsWith("http:") ? http.get : https.get;
		const request = get(url, { headers: { "User-Agent": USER_AGENT } }, (response) => {
			const status = response.statusCode ?? 0;
			if (status >= 300 && status < 400 && response.headers.location) {
				response.resume();
				if (redirectsLeft <= 0) {
					reject(new Error("too many redirects"));
					return;
				}
				const next = new URL(response.headers.location, url).toString();
				download(next, destination, onProgress, redirectsLeft - 1).then(resolve, reject);
				return;
			}
			if (status !== 200) {
				response.resume();
				reject(new Error(`HTTP ${status} for ${url}`));
				return;
			}

			const totalBytes = Number(response.headers["content-length"]) || 0;
			let downloadedBytes = 0;
			if (onProgress) {
				response.on("data", (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					onProgress(downloadedBytes, totalBytes);
				});
			}
			pipeline(response, createWriteStream(temporary))
				.then(() => fs.rename(temporary, destination))
				.then(resolve)
				.catch(async (err) => {
					await fs.rm(temporary, { force: true }).catch(swallow);
					reject(err);
				});
		});
		request.on("error", reject);
		request.setTimeout(120_000, () => request.destroy(new Error("download timed out")));
	});
}

// ── Speaking ─────────────────────────────────────────────────────────────

export interface PiperOptions extends VoiceChoice {
	/** 1 is the voice's own pace; 1.2 is a fifth faster. */
	speed?: number;
	/** Seconds of silence between sentences. Piper's own default is 0.2. */
	sentenceSilence?: number;
	/** Download the voice if it is missing. On by default. */
	autoDownload?: boolean;
}

/**
 * Speaks `text` with a local Piper voice and returns a path to the audio.
 *
 * The result is MP3 where FFmpeg is available and WAV otherwise, which is what
 * Piper writes: both play in the editor and both mux into an export, and
 * failing a narration line because the transcoder is missing would be worse
 * than handing back the larger file.
 */
export async function synthesizePiper(
	text: string,
	options: PiperOptions = {},
): Promise<PiperResult> {
	const spoken = text.trim();
	if (!spoken) return { success: false, error: "Nothing to say." };

	const binary = await resolvePiperBinary();
	if (!binary) {
		const status = await getPiperStatus();
		return { success: false, error: status.error };
	}

	const settings = await loadSettings().catch(() => null);
	const voiceId = pickVoiceId({
		voiceId: options.voiceId ?? settings?.piperVoiceId,
		language: options.language ?? settings?.narrationLanguage,
		text: options.text ?? spoken,
	});

	if (!(await isVoiceInstalled(voiceId))) {
		if (options.autoDownload === false) {
			return { success: false, error: `The ${voiceId} voice is not downloaded yet.` };
		}
		const downloaded = await downloadPiperVoice(voiceId);
		if (!downloaded.success) return { success: false, error: downloaded.error };
	}

	const files = voicePaths(voiceId);
	const outputDir = path.join(app.getPath("userData"), TTS_OUTPUT_DIR);
	await fs.mkdir(outputDir, { recursive: true });
	const wavPath = path.join(outputDir, `piper-${Date.now()}-${process.hrtime.bigint()}.wav`);

	const args = [
		"--model",
		files.model,
		"--config",
		files.config,
		"--output_file",
		wavPath,
		// Piper measures pace as the length of the output, so it is the
		// reciprocal of speed: a higher length scale is a slower reading.
		"--length_scale",
		String(1 / Math.min(2, Math.max(0.5, options.speed ?? 1))),
		"--sentence_silence",
		String(options.sentenceSilence ?? 0.25),
	];

	try {
		await runPiper(binary, args, spoken);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { success: false, error: `Piper failed: ${message}` };
	}

	if (!(await exists(wavPath))) {
		return { success: false, error: "Piper ran but produced no audio." };
	}

	const mp3Path = await toMp3(wavPath).catch(() => null);
	return { success: true, audioPath: mp3Path ?? wavPath, voiceId };
}

function runPiper(binary: string, args: string[], text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			// espeak-ng phonemisation data sits beside the executable in an
			// official release, and Piper looks for it relative to the working
			// directory, so the binary's own folder is the only safe one.
			cwd: path.dirname(binary),
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			// Piper's own diagnostics are the useful part; its exit code is not.
			else reject(new Error(stderr.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`));
		});
		child.stdin.on("error", () => {
			// A crash on startup closes stdin before the text lands; the close
			// handler above reports why, so this must not become an unhandled
			// error event that takes the main process down with it.
		});
		child.stdin.end(text);
	});
}

async function toMp3(wavPath: string): Promise<string | null> {
	const ffmpeg = await getFfmpegPath();
	if (!ffmpeg) return null;
	const mp3Path = wavPath.replace(/\.wav$/, ".mp3");
	await new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpeg, [
			"-y",
			"-i",
			wavPath,
			"-codec:a",
			"libmp3lame",
			"-q:a",
			"2",
			mp3Path,
		]);
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)),
		);
	});
	await fs.rm(wavPath, { force: true }).catch(swallow);
	return mp3Path;
}

/** Whether Piper could speak this text right now without downloading anything. */
export async function isPiperReadyFor(choice: VoiceChoice): Promise<boolean> {
	if (!(await resolvePiperBinary())) return false;
	return isVoiceInstalled(pickVoiceId(choice));
}

/** The label for a voice key, for logs and pickers. */
export function describeVoice(voiceId: string): string {
	return getPiperVoice(voiceId)?.label ?? voiceId;
}
