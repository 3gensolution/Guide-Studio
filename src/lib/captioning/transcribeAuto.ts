/**
 * transcribeAuto — engine routing for auto-captions.
 *
 * The in-browser WASM Whisper path (`transcribeMono16kToSegments`) is correct but
 * slow: single-threaded ONNX under `file://` with several retry passes. When the
 * user is signed in to their account we can transcribe far faster via the backend
 * speech-to-text endpoint (server-side Whisper). This module encodes the same
 * mono/16 kHz sample buffer the WASM path uses into a small WAV blob, sends it to
 * the account endpoint, and falls back to the local WASM engine on any failure so
 * offline use keeps working.
 */
import type { TrimRegion } from "@/components/video-editor/types";
import type { CaptionTrack, CaptionWord } from "@/lib/ai/types";
import { aiService } from "@/lib/api/ai";
import type { CaptionSegment, TranscribeMono16kResult } from "./transcribe";
import { transcribeMono16kToSegments } from "./transcribe";

const SAMPLE_RATE = 16_000;

/** Encode a mono Float32 buffer (already at 16 kHz) into a 16-bit PCM WAV Blob. */
export function encodeMono16kWav(samples: Float32Array): Blob {
	const numSamples = samples.length;
	const dataBytes = numSamples * 2; // 16-bit
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);

	const writeString = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
	};

	writeString(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	writeString(8, "WAVE");
	writeString(12, "fmt ");
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeString(36, "data");
	view.setUint32(40, dataBytes, true);

	let offset = 44;
	for (let i = 0; i < numSamples; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		offset += 2;
	}

	return new Blob([buffer], { type: "audio/wav" });
}

/** Drop samples that fall inside trimmed-out regions before sending to the server. */
function applyTrimRegions(samples: Float32Array, trimRegions: TrimRegion[]): Float32Array {
	if (!trimRegions || trimRegions.length === 0) return samples;
	const keep: Array<[number, number]> = [];
	const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
	let cursor = 0;
	const totalMs = (samples.length / SAMPLE_RATE) * 1000;
	for (const region of sorted) {
		const start = Math.max(cursor, region.startMs);
		if (start > cursor) keep.push([cursor, start]);
		cursor = Math.max(cursor, region.endMs);
	}
	if (cursor < totalMs) keep.push([cursor, totalMs]);
	if (keep.length === 0) return samples;

	const msToIdx = (ms: number) =>
		Math.max(0, Math.min(samples.length, Math.round((ms / 1000) * SAMPLE_RATE)));
	const chunks = keep.map(([a, b]) => samples.subarray(msToIdx(a), msToIdx(b)));
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Float32Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

export interface TranscribeAutoOptions {
	trimRegions?: TrimRegion[];
	onStatus?: (phase: "model" | "transcribe") => void;
	signal?: AbortSignal;
	/** When true and the account is reachable, prefer the fast server engine. */
	preferServer?: boolean;
	/** Optional forced language hint for the server engine (e.g. "en"). */
	language?: string;
}

/**
 * Transcribe mono/16 kHz samples, preferring the fast account (server) engine when
 * available and falling back to the local WASM engine otherwise.
 */
export async function transcribeSegmentsAuto(
	samples: Float32Array,
	options?: TranscribeAutoOptions,
): Promise<TranscribeMono16kResult> {
	if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

	if (options?.preferServer) {
		try {
			options.onStatus?.("transcribe");
			const trimmed = applyTrimRegions(samples, options.trimRegions ?? []);
			if (trimmed.length >= 800) {
				const wav = encodeMono16kWav(trimmed);
				const result = await aiService.transcribe(wav, options.language);
				if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
				if (result.success && result.data.segments.length > 0) {
					const segments: CaptionSegment[] = result.data.segments.map((s) => ({
						startSec: s.start,
						endSec: Math.max(s.end, s.start + 0.001),
						text: s.text.trim(),
					}));
					// Server segments are phrase-level (start/end per utterance).
					return { segments, granularity: "phrase" };
				}
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") throw err;
			// Fall through to the local engine on any server failure.
			console.warn("[transcribeAuto] server transcription failed, using local engine:", err);
		}
	}

	// Local WASM fallback (offline / not signed in / server error).
	return transcribeMono16kToSegments(samples, {
		trimRegions: options?.trimRegions,
		onStatus: options?.onStatus,
		signal: options?.signal,
	});
}

/**
 * Build a `CaptionTrack` from finalized caption segments so the transcript can be
 * shown and word-edited in the editor's Transcript panel. Phrase-level segments are
 * split into evenly-timed words; word-level segments become one word each.
 */
export function captionSegmentsToTrack(
	segments: CaptionSegment[],
	granularity: "word" | "phrase",
	modelId: string,
	language = "en",
	createdAt = 0,
): CaptionTrack {
	const lines = segments
		.map((seg, lineIdx) => {
			const text = seg.text.trim();
			if (!text) return null;
			const startMs = Math.round(seg.startSec * 1000);
			const endMs = Math.max(Math.round(seg.endSec * 1000), startMs + 1);

			let words: CaptionWord[];
			if (granularity === "word") {
				words = [{ text, startMs, endMs, confidence: 1 }];
			} else {
				const tokens = text.split(/\s+/).filter(Boolean);
				const span = endMs - startMs;
				const per = span / Math.max(tokens.length, 1);
				words = tokens.map((tk, i) => ({
					text: tk,
					startMs: Math.round(startMs + per * i),
					endMs: Math.round(startMs + per * (i + 1)),
					confidence: 1,
				}));
			}

			return {
				id: `caption-line-${lineIdx}`,
				words,
				startMs,
				endMs,
			};
		})
		.filter((l): l is NonNullable<typeof l> => l !== null);

	return {
		id: `caption-track-${createdAt}`,
		language,
		lines,
		modelId,
		createdAt,
	};
}
