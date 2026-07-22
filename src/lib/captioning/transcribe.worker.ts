/**
 * Web Worker running in-browser Whisper transcription off the renderer's main
 * thread so the editor UI never blocks during model load or transcription.
 *
 * Input:  { samples: Float32Array; trimRegions: TrimRegion[] }
 * Output (see `TranscribeWorkerResponse`): status / result / error messages.
 *
 * The caller terminates this worker to abort (model load and inference can't be
 * cooperatively cancelled), so there is no in-worker abort handling.
 */

import type { TranscribeWorkerRequest, TranscribeWorkerResponse } from "./transcribe";
import { runTranscription, type TranscriberFn } from "./transcribeCore";

function post(message: TranscribeWorkerResponse): void {
	(self as unknown as Worker).postMessage(message);
}

/**
 * ONNX Runtime's wasm bundle treats `process.versions.node` (which can leak into
 * an Electron worker) as Node and tries `require("fs")`, which Vite doesn't
 * support. Mask it only while Transformers/ORT run. No-op when `process` is
 * undefined (the usual case in a Web Worker).
 */
function withoutNodeVersion<T>(fn: () => Promise<T>): Promise<T> {
	const versions =
		typeof process !== "undefined" && process.versions && typeof process.versions === "object"
			? process.versions
			: null;
	const hadNode = versions !== null && "node" in versions;
	const savedNode = hadNode ? (versions as { node?: string }).node : undefined;
	if (hadNode && versions) {
		try {
			Reflect.deleteProperty(versions, "node");
		} catch {
			(versions as { node?: string }).node = undefined;
		}
	}
	return fn().finally(() => {
		if (hadNode && versions && savedNode !== undefined) {
			(versions as { node: string }).node = savedNode;
		}
	});
}

async function loadTranscriber(opts: {
	useLocalModels: boolean;
	assetBaseUrl?: string;
	modelBaseUrl?: string;
}): Promise<TranscriberFn> {
	return withoutNodeVersion(async () => {
		const { pipeline, env } = await import("@xenova/transformers");
		if (opts.useLocalModels && opts.assetBaseUrl) {
			// Packaged app: load the model and bundled ORT wasm from disk so transcription
			// needs no network and works under file:// (remote HuggingFace/CDN fetches fail there).
			// ORT wasm ships in caption-assets/ort; the model dir is resolved by the main process
			// (bundled or downloaded to userData) and passed as modelBaseUrl. Fall back to the old
			// bundled caption-assets/models layout when modelBaseUrl is absent.
			const base = new URL("caption-assets/", opts.assetBaseUrl).href;
			env.allowLocalModels = true;
			env.allowRemoteModels = false;
			env.localModelPath = opts.modelBaseUrl ?? new URL("models/", base).href;
			env.backends.onnx.wasm.wasmPaths = new URL("ort/", base).href;
			// Non-threaded wasm: SharedArrayBuffer isn't available under file:// (no cross-origin isolation).
			env.backends.onnx.wasm.numThreads = 1;
		} else {
			// Dev (http://localhost): fetch model weights from the remote hub, which works there.
			env.allowLocalModels = false;
			// Pin the ORT wasm to the CDN. Without an explicit wasmPaths, onnxruntime-web
			// resolves `ort-wasm-simd.wasm` relative to the page; the Vite dev server answers
			// unknown paths with index.html, so ORT tries to compile HTML and throws
			// "CompileError: expected magic word". The version must track the installed
			// @xenova/transformers (its dist ships matching ORT wasm binaries).
			env.backends.onnx.wasm.wasmPaths =
				"https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/";
			// No cross-origin isolation on the dev server (no SharedArrayBuffer), so force the
			// single-threaded wasm — the threaded variant would fail to instantiate.
			env.backends.onnx.wasm.numThreads = 1;
		}
		// Default tiny weights only: the `output_attentions` revision regresses inference in
		// some environments (empty chunks, thrown errors) while phrase mode works on this model.
		const transcriber = (await pipeline(
			"automatic-speech-recognition",
			"Xenova/whisper-tiny",
		)) as unknown as TranscriberFn;
		return transcriber;
	});
}

self.onmessage = async (event: MessageEvent<TranscribeWorkerRequest>) => {
	const { samples, trimRegions, useLocalModels, assetBaseUrl, modelBaseUrl } = event.data;
	try {
		post({ type: "status", phase: "model" });
		const transcriber = await loadTranscriber({ useLocalModels, assetBaseUrl, modelBaseUrl });

		post({ type: "status", phase: "transcribe" });
		const { segments, granularity } = await runTranscription(
			transcriber,
			samples,
			trimRegions ?? [],
		);

		post({ type: "result", segments, granularity });
	} catch (e) {
		post({ type: "error", message: e instanceof Error ? e.message : String(e) });
	}
};
