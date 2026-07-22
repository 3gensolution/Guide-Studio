import type { TrimRegion } from "@/components/video-editor/types";

export interface CaptionSegment {
	startSec: number;
	endSec: number;
	text: string;
}

/** How caption layout should interpret `CaptionSegment` times from `transcribeMono16kToSegments`. */
export type CaptionTimestampGranularity = "word" | "phrase";

export interface TranscribeMono16kResult {
	segments: CaptionSegment[];
	granularity: CaptionTimestampGranularity;
}

/** Request payload posted from the renderer to the transcription worker. */
export interface TranscribeWorkerRequest {
	samples: Float32Array;
	trimRegions: TrimRegion[];
	/**
	 * Load the Whisper model + ORT wasm from bundled `caption-assets` instead of remote CDNs.
	 * Required in the packaged app (runs from `file://` where remote fetches fail). The worker
	 * can't read `window.electronAPI`, so the renderer resolves this here.
	 */
	useLocalModels: boolean;
	/** Base URL of bundled resources (packaged: resourcesPath file:// URL); used when `useLocalModels`. */
	assetBaseUrl?: string;
	/**
	 * Base file:// URL (trailing slash) whose `Xenova/whisper-tiny/...` holds the model weights.
	 * Resolved by the main process (bundled or downloaded to userData on first use). Used as
	 * transformers.js `env.localModelPath` when `useLocalModels`. ORT wasm still comes from
	 * `assetBaseUrl` (bundled caption-assets/ort).
	 */
	modelBaseUrl?: string;
}

/** Messages the transcription worker posts back to the renderer. */
export type TranscribeWorkerResponse =
	| { type: "status"; phase: "model" | "transcribe" }
	| { type: "result"; segments: CaptionSegment[]; granularity: CaptionTimestampGranularity }
	| { type: "error"; message: string };

/**
 * Transcribes mono 16 kHz audio into timed caption segments using in-browser Whisper.
 *
 * Runs in a Web Worker so the editor's main thread stays responsive (WASM inference
 * doesn't yield). First run downloads model weights. Aborting via `options.signal`
 * terminates the worker, since load/inference can't be cooperatively cancelled.
 */
export function transcribeMono16kToSegments(
	samples: Float32Array,
	options?: {
		trimRegions?: TrimRegion[];
		onStatus?: (phase: "model" | "transcribe") => void;
		signal?: AbortSignal;
	},
): Promise<TranscribeMono16kResult> {
	if (options?.signal?.aborted) {
		return Promise.reject(new DOMException("Aborted", "AbortError"));
	}

	return new Promise<TranscribeMono16kResult>((resolve, reject) => {
		const worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), {
			type: "module",
		});

		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			options?.signal?.removeEventListener("abort", onAbort);
			worker.terminate();
			fn();
		};

		const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
		options?.signal?.addEventListener("abort", onAbort, { once: true });

		worker.onmessage = (e: MessageEvent<TranscribeWorkerResponse>) => {
			const msg = e.data;
			if (msg.type === "status") {
				options?.onStatus?.(msg.phase);
				return;
			}
			if (msg.type === "result") {
				finish(() => resolve({ segments: msg.segments, granularity: msg.granularity }));
				return;
			}
			finish(() => reject(new Error(msg.message)));
		};

		worker.onerror = (e) => {
			finish(() => reject(new Error(e.message || "Caption transcription worker failed")));
		};

		// Packaged app runs from file:// (remote fetches fail), so load bundled assets.
		// Dev runs from http://localhost where the remote path works.
		const useLocalModels = typeof window !== "undefined" && window.location?.protocol === "file:";
		const assetBaseUrl =
			typeof window !== "undefined" ? window.electronAPI?.assetBaseUrl : undefined;

		// The model weights are no longer bundled; the main process ensures they exist locally
		// (downloading ~45MB to userData on first use) and returns the base URL. ORT wasm stays
		// bundled (assetBaseUrl). Surface this as the "model" phase so existing UI shows progress.
		const start = async () => {
			let modelBaseUrl: string | undefined;
			if (
				useLocalModels &&
				typeof window !== "undefined" &&
				window.electronAPI?.ensureCaptionModel
			) {
				options?.onStatus?.("model");
				modelBaseUrl = await window.electronAPI.ensureCaptionModel();
			}
			// Structured-clone copy, not a transfer: the caller may reuse `samples` for the
			// full-buffer retry pass, so the buffer must stay valid here.
			const request: TranscribeWorkerRequest = {
				samples,
				trimRegions: options?.trimRegions ?? [],
				useLocalModels,
				assetBaseUrl,
				modelBaseUrl,
			};
			worker.postMessage(request);
		};
		start().catch((err) =>
			finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
		);
	});
}
