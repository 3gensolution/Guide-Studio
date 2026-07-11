/**
 * Publish Kit — generates YouTube-ready metadata from a recording in one
 * cheap LLM call: title options, description with chapter timestamps, tags.
 * Chapters come from detected guide steps; the transcript (when captions
 * exist) gives the model real content to write from.
 */
import type { CaptionTrack, GuideStep, PublishKit, VideoChapter } from "./types";

/** YouTube requires the first chapter at 0:00 and ≥10s between chapters */
const MIN_CHAPTER_GAP_MS = 10_000;
const MAX_CHAPTERS = 15;
const MAX_TRANSCRIPT_CHARS = 6_000;

export function formatChapterTimestamp(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const mmss = `${minutes}:${String(seconds).padStart(2, "0")}`;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
		: mmss;
}

/** Derive YouTube-valid chapters from guide steps (first at 0:00, ≥10s apart) */
export function deriveChapters(steps: GuideStep[], videoDurationMs: number): VideoChapter[] {
	const chapters: VideoChapter[] = [{ timeMs: 0, title: "Intro" }];
	for (const step of steps) {
		if (chapters.length >= MAX_CHAPTERS) break;
		const last = chapters[chapters.length - 1];
		if (step.timeMs - last.timeMs < MIN_CHAPTER_GAP_MS) continue;
		if (videoDurationMs - step.timeMs < MIN_CHAPTER_GAP_MS) break;
		chapters.push({
			timeMs: step.timeMs,
			title: step.title.replace(/^step\s*\d+[:.)]?\s*/i, "") || `Part ${chapters.length + 1}`,
		});
	}
	return chapters;
}

export function flattenTranscript(captionTrack: CaptionTrack | null): string {
	if (!captionTrack) return "";
	const text = captionTrack.lines
		.map((line) => line.words.map((w) => w.text).join(" "))
		.join(" ")
		.trim();
	return text.length > MAX_TRANSCRIPT_CHARS ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}…` : text;
}

/** Build the single LLM prompt for the whole publish kit */
export function buildPublishKitPrompt(
	chapters: VideoChapter[],
	transcript: string,
	videoDurationMs: number,
): string {
	const chapterList = chapters
		.map((c) => `${formatChapterTimestamp(c.timeMs)} ${c.title}`)
		.join("\n");

	return (
		"You are a YouTube growth expert helping publish a screen-recorded tutorial " +
		`(${formatChapterTimestamp(videoDurationMs)} long).\n` +
		(transcript
			? `Transcript (may be truncated):\n"""\n${transcript}\n"""\n`
			: "No transcript is available — infer the topic from the chapter outline.\n") +
		`Chapter outline:\n${chapterList}\n\n` +
		"Respond ONLY with JSON matching exactly this shape:\n" +
		"{\n" +
		'  "titles": ["3 title options, max 70 chars each, specific not clickbait"],\n' +
		'  "description": "2-3 paragraph YouTube description. Do NOT include chapter timestamps — they are appended separately.",\n' +
		'  "tags": ["10-15 relevant tags"],\n' +
		'  "chapterTitles": ["improved short title for each chapter, same order and count as the outline"]\n' +
		"}"
	);
}

/** Parse the LLM response into a PublishKit (tolerant of partial output) */
export function parsePublishKitResponse(response: unknown, chapters: VideoChapter[]): PublishKit {
	const obj = (response ?? {}) as Record<string, unknown>;

	const titles = Array.isArray(obj.titles)
		? obj.titles.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
		: [];
	const tags = Array.isArray(obj.tags)
		? obj.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
		: [];
	const description = typeof obj.description === "string" ? obj.description.trim() : "";

	const chapterTitles = Array.isArray(obj.chapterTitles) ? obj.chapterTitles : [];
	const finalChapters = chapters.map((chapter, i) => {
		const improved = chapterTitles[i];
		return typeof improved === "string" && improved.trim()
			? { ...chapter, title: improved.trim() }
			: chapter;
	});

	return { titles, description, tags, chapters: finalChapters };
}

/** The copy-pasteable description block: prose + blank line + chapter list */
export function renderDescriptionWithChapters(kit: PublishKit): string {
	const chapterBlock = kit.chapters
		.map((c) => `${formatChapterTimestamp(c.timeMs)} ${c.title}`)
		.join("\n");
	const parts = [kit.description, chapterBlock].filter(Boolean);
	return parts.join("\n\n");
}
