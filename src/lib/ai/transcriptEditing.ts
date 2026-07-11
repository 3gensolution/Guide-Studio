/**
 * Text-based editing — edit the video by editing the transcript.
 * Whisper captions carry word-level timestamps, so removing words from the
 * transcript maps directly to trim regions on the timeline. Filler-word
 * detection is a plain lexicon match; no AI call needed.
 */
import type { TrimRegion } from "@/components/video-editor/types";
import type { CaptionTrack } from "./types";

/** A word in the transcript, addressable for selection in the UI */
export interface TranscriptWordRef {
	/** `${lineId}:${wordIndex}` — stable selection key */
	key: string;
	lineId: string;
	wordIndex: number;
	text: string;
	startMs: number;
	endMs: number;
}

/**
 * Conservative filler lexicon — only sounds that are never real words.
 * Deliberately excludes "like", "so", "well": cutting those breaks sentences.
 */
const FILLER_WORDS = new Set([
	"um",
	"umm",
	"ummm",
	"uhm",
	"uh",
	"uhh",
	"uhhh",
	"er",
	"err",
	"erm",
	"ehm",
	"hmm",
	"hm",
	"mmm",
	"mm",
]);

/** Breathing room kept around each cut so speech doesn't clip */
const CUT_PADDING_MS = 30;
/** Cuts closer than this merge into one region (avoids stutter cuts) */
const MERGE_GAP_MS = 200;

function normalizeWord(text: string): string {
	return text.toLowerCase().replace(/[^a-z]/g, "");
}

/** Flatten a caption track into addressable words, in time order */
export function flattenTranscriptWords(captionTrack: CaptionTrack | null): TranscriptWordRef[] {
	if (!captionTrack) return [];
	const words: TranscriptWordRef[] = [];
	for (const line of captionTrack.lines) {
		line.words.forEach((word, wordIndex) => {
			words.push({
				key: `${line.id}:${wordIndex}`,
				lineId: line.id,
				wordIndex,
				text: word.text,
				startMs: word.startMs,
				endMs: word.endMs,
			});
		});
	}
	return words.sort((a, b) => a.startMs - b.startMs);
}

/** Return the selection keys of all filler words in the transcript */
export function findFillerWordKeys(words: TranscriptWordRef[]): Set<string> {
	const keys = new Set<string>();
	for (const word of words) {
		if (FILLER_WORDS.has(normalizeWord(word.text))) {
			keys.add(word.key);
		}
	}
	return keys;
}

let nextCutId = 1;

/**
 * Convert selected words into trim regions: pad each word slightly, then
 * merge overlapping/adjacent cuts so consecutive removed words become one
 * clean cut instead of a stutter of tiny ones.
 */
export function wordsToTrimRegions(
	selected: TranscriptWordRef[],
	videoDurationMs: number,
): TrimRegion[] {
	if (selected.length === 0) return [];

	const padded = [...selected]
		.sort((a, b) => a.startMs - b.startMs)
		.map((word) => ({
			startMs: Math.max(0, word.startMs - CUT_PADDING_MS),
			endMs: Math.min(videoDurationMs, word.endMs + CUT_PADDING_MS),
		}))
		.filter((r) => r.endMs > r.startMs);

	const merged: Array<{ startMs: number; endMs: number }> = [];
	for (const region of padded) {
		const last = merged[merged.length - 1];
		if (last && region.startMs - last.endMs <= MERGE_GAP_MS) {
			last.endMs = Math.max(last.endMs, region.endMs);
		} else {
			merged.push({ ...region });
		}
	}

	return merged.map((region) => ({
		id: `transcript-cut-${nextCutId++}`,
		startMs: Math.round(region.startMs),
		endMs: Math.round(region.endMs),
	}));
}
