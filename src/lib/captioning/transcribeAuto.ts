/**
 * transcribeAuto — engine routing for auto-captions.
 *
 * Guide Studio transcribes locally: the in-browser WASM Whisper path
 * (`transcribeMono16kToSegments`) is the only engine. The WAV encoder and the
 * trim-region helper stay here because callers still use them to prepare the
 * sample buffer.
 */
import type { TrimRegion } from "@/components/video-editor/types";
import type { CaptionTrack, CaptionWord } from "@/lib/ai/types";
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

export interface TranscribeAutoOptions {
	trimRegions?: TrimRegion[];
	onStatus?: (phase: "model" | "transcribe") => void;
	signal?: AbortSignal;
	/** Ignored; kept so existing callers compile. Transcription is always local. */
	preferServer?: boolean;
	/** Optional language hint (e.g. "en"). */
	language?: string;
}

/** Transcribe mono/16 kHz samples with the local WASM Whisper engine. */
export async function transcribeSegmentsAuto(
	samples: Float32Array,
	options?: TranscribeAutoOptions,
): Promise<TranscribeMono16kResult> {
	if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

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
