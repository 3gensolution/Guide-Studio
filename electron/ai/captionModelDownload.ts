// Downloads the Whisper caption model (Xenova/whisper-tiny) to userData on first use,
// so the installer no longer ships the ~45MB ONNX weights. The ORT wasm runtime is still
// bundled (caption-assets/ort). Idempotent: existing non-empty files are reused, so this is
// a no-op after the first successful download and captioning works fully offline afterwards.
//
// Mirrors scripts/fetch-caption-model.mjs (the build-time fetcher) but runs in the packaged
// main process. Dev (http://localhost) never calls this — the worker fetches from the HF hub.

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { app } from "electron";

const MODEL_ID = "Xenova/whisper-tiny";
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;

// Metadata/tokenizer files + the quantized ONNX weights the ASR pipeline loads by default.
// Keep in sync with scripts/fetch-caption-model.mjs.
const MODEL_FILES = [
	"config.json",
	"generation_config.json",
	"preprocessor_config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"added_tokens.json",
	"special_tokens_map.json",
	"normalizer.json",
	"merges.txt",
	"vocab.json",
	"quantize_config.json",
	"onnx/encoder_model_quantized.onnx",
	"onnx/decoder_model_merged_quantized.onnx",
];

const MAX_ATTEMPTS = 5;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function fileExists(filePath: string): Promise<boolean> {
	try {
		const s = await stat(filePath);
		return s.isFile() && s.size > 0;
	} catch {
		return false;
	}
}

export async function isCaptionModelInstalled(): Promise<boolean> {
	const baseDir = path.join(app.getPath("userData"), "caption-models");
	const modelDir = path.join(baseDir, ...MODEL_ID.split("/"));
	return Promise.all([
		fileExists(path.join(modelDir, "config.json")),
		fileExists(path.join(modelDir, "onnx", "encoder_model_quantized.onnx")),
		fileExists(path.join(modelDir, "onnx", "decoder_model_merged_quantized.onnx")),
	]).then((files) => files.every(Boolean));
}

export async function removeCaptionModel(): Promise<void> {
	const baseDir = path.join(app.getPath("userData"), "caption-models");
	await rm(baseDir, { recursive: true, force: true });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const res = await fetch(url, { headers: { "user-agent": "guide-studio" } });
			if (res.ok && res.body) return res;
			if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
				await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
				continue;
			}
			throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
		} catch (err) {
			lastErr = err;
			if (attempt >= MAX_ATTEMPTS) break;
			await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(`Failed to download ${url}`);
}

async function download(url: string, dest: string): Promise<void> {
	if (await fileExists(dest)) return;
	await mkdir(path.dirname(dest), { recursive: true });
	const res = await fetchWithRetry(url);
	const tmp = `${dest}.partial`;
	// biome-ignore lint/suspicious/noExplicitAny: Node's Readable.fromWeb typing vs DOM ReadableStream.
	await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp));
	await rename(tmp, dest);
}

let inFlight: Promise<string> | null = null;

/**
 * Ensures the Whisper caption model exists locally and returns a file:// URL to the directory
 * that should be used as transformers.js `env.localModelPath` (the parent of `Xenova/...`),
 * with a trailing slash.
 *
 * Concurrent callers share a single download. Throws (with a user-facing message) if the model
 * is missing and can't be fetched — e.g. the user is offline on first caption run.
 */
export function ensureCaptionModelDir(): Promise<string> {
	if (inFlight) return inFlight;
	inFlight = (async () => {
		const baseDir = path.join(app.getPath("userData"), "caption-models");
		const modelDir = path.join(baseDir, ...MODEL_ID.split("/"));
		try {
			for (const rel of MODEL_FILES) {
				await download(`${HF_BASE}/${rel}`, path.join(modelDir, rel));
			}
		} catch (err) {
			inFlight = null;
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Couldn't download the caption model. Connect to the internet and try again (one-time ~45MB download). Details: ${reason}`,
			);
		}
		// Trailing slash so transformers.js appends "Xenova/whisper-tiny/..." correctly.
		return pathToFileURL(`${baseDir}${path.sep}`).toString();
	})();
	return inFlight;
}
