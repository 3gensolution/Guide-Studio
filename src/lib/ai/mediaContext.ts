/**
 * Shared contract for media that gives AI Chat and AI Video Creator context.
 *
 * This module is renderer-safe: it contains no filesystem access and never
 * accepts a path as an authority. The main process owns path validation and
 * staging; the renderer and planner work with stable asset ids and bounded
 * metadata.
 */

export const MEDIA_CONTEXT_LIMITS = {
	maxAssets: 12,
	maxLabelLength: 160,
	maxRoleLength: 40,
	maxMimeTypeLength: 80,
	maxBytes: 1_073_741_824,
	maxDurationSeconds: 24 * 60 * 60,
	maxDimension: 32_768,
	maxContactSheetFrames: 8,
	maxContactSheetBytes: 8 * 1024 * 1024,
	maxShotSegments: 24,
	minShotSegmentSeconds: 0.8,
	maxTranscriptDurationSeconds: 20 * 60,
	maxTranscriptSegments: 48,
	maxTranscriptSegmentChars: 220,
	maxTranscriptExcerptChars: 1_200,
	maxOcrItems: 12,
	maxOcrItemChars: 120,
	maxVisualSummaryChars: 320,
	maxRetrievalQueryChars: 240,
	maxRetrievalHits: 8,
	maxRetrievalHitChars: 260,
	retrievalVectorDimensions: 192,
} as const;

export const MEDIA_CONTEXT_KINDS = ["image", "video"] as const;
export type MediaContextKind = (typeof MEDIA_CONTEXT_KINDS)[number];

export const MEDIA_CONTEXT_FILE_TYPES: Record<
	string,
	{ kind: MediaContextKind; mimeType: string }
> = {
	".svg": { kind: "image", mimeType: "image/svg+xml" },
	".png": { kind: "image", mimeType: "image/png" },
	".jpg": { kind: "image", mimeType: "image/jpeg" },
	".jpeg": { kind: "image", mimeType: "image/jpeg" },
	".webp": { kind: "image", mimeType: "image/webp" },
	".gif": { kind: "image", mimeType: "image/gif" },
	".mp4": { kind: "video", mimeType: "video/mp4" },
	".mov": { kind: "video", mimeType: "video/quicktime" },
	".m4v": { kind: "video", mimeType: "video/x-m4v" },
	".webm": { kind: "video", mimeType: "video/webm" },
	".mkv": { kind: "video", mimeType: "video/x-matroska" },
	".avi": { kind: "video", mimeType: "video/x-msvideo" },
};

export function getMediaContextFileType(
	fileName: string,
): { kind: MediaContextKind; mimeType: string } | undefined {
	const lastSeparator = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
	const baseName = fileName.slice(lastSeparator + 1);
	const extensionStart = baseName.lastIndexOf(".");
	if (extensionStart <= 0) return undefined;
	return MEDIA_CONTEXT_FILE_TYPES[baseName.slice(extensionStart).toLowerCase()];
}

export const MEDIA_CONTEXT_ROLES = [
	"product-truth",
	"source-footage",
	"brand",
	"style-reference",
	"ui-reference",
	"person-reference",
	"supporting-media",
] as const;
export type MediaContextRole = (typeof MEDIA_CONTEXT_ROLES)[number];

export interface MediaContextAsset {
	id: string;
	kind: MediaContextKind;
	role: MediaContextRole;
	label: string;
	mimeType: string;
	sizeBytes: number;
	width?: number;
	height?: number;
	durationSeconds?: number;
	frameRate?: number;
	codec?: string;
	hasAudio?: boolean;
	/** Coarse, bounded edit points detected from the source video. */
	shotSegments?: MediaContextShotSegment[];
	/** Bounded semantic analysis from user media, with timecoded speech when available. */
	visualSummary?: string;
	ocrText?: string[];
	transcriptExcerpt?: string;
	transcriptSegments?: MediaContextTranscriptSegment[];
	/** Renderer-only preview path. Never used as an authority by the planner. */
	previewPath?: string;
}

export interface MediaContextAssetSummary {
	id: string;
	kind: MediaContextKind;
	role: MediaContextRole;
	label: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
	frameRate?: number;
	codec?: string;
	hasAudio?: boolean;
	/** Optional analysis produced by the main process or an explicit vision call. */
	visualSummary?: string;
	ocrText?: string[];
	transcriptExcerpt?: string;
	transcriptSegments?: MediaContextTranscriptSegment[];
	shotSegments?: MediaContextShotSegment[];
}

export interface MediaContextShotSegment {
	startSeconds: number;
	endSeconds: number;
	midpointSeconds: number;
}

export interface MediaContextTranscriptSegment {
	startSeconds: number;
	endSeconds: number;
	text: string;
}

export interface MediaContextSemanticAnalysis {
	visualSummary?: string;
	ocrText?: string[];
}

export type MediaContextRetrievalSource = "transcript" | "ocr" | "visual" | "metadata";

export interface MediaContextRetrievalHit {
	assetId: string;
	label: string;
	kind: MediaContextKind;
	source: MediaContextRetrievalSource;
	score: number;
	text: string;
	startSeconds?: number;
	endSeconds?: number;
}

export interface MediaContextProbe {
	width?: number;
	height?: number;
	durationSeconds?: number;
	frameRate?: number;
	codec?: string;
	hasAudio?: boolean;
}

/**
 * Parse the timestamps emitted by FFmpeg's `showinfo` filter after a scene
 * change selection. The input is untrusted process output, so malformed,
 * duplicate, and out-of-range values are discarded before they can reach the
 * planner or renderer.
 */
export function parseShotChangeTimes(output: string, durationSeconds?: number): number[] {
	const duration =
		typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
			? durationSeconds
			: undefined;
	const values = [...output.matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/g)]
		.map((match) => Number(match[1]))
		.filter((value) => Number.isFinite(value) && value >= 0)
		.map((value) => (duration === undefined ? value : Math.min(value, duration)));
	return [...new Set(values.map((value) => Math.round(value * 10) / 10))].sort((a, b) => a - b);
}

/** Convert coarse edit points into bounded ranges that are safe to preview. */
export function buildShotSegments(
	durationSeconds: number | undefined,
	changeTimesSeconds: number[],
): MediaContextShotSegment[] {
	if (
		typeof durationSeconds !== "number" ||
		!Number.isFinite(durationSeconds) ||
		durationSeconds < MEDIA_CONTEXT_LIMITS.minShotSegmentSeconds
	) {
		return [];
	}
	const duration = Math.max(0, durationSeconds);
	const boundaries = [
		0,
		...changeTimesSeconds.filter(
			(value) =>
				typeof value === "number" && Number.isFinite(value) && value > 0 && value < duration,
		),
		duration,
	]
		.map((value) => Math.round(value * 10) / 10)
		.sort((a, b) => a - b)
		.filter((value, index, values) => index === 0 || value !== values[index - 1]);

	const segments: MediaContextShotSegment[] = [];
	for (let index = 0; index < boundaries.length - 1; index += 1) {
		const startSeconds = boundaries[index] ?? 0;
		const endSeconds = boundaries[index + 1] ?? duration;
		if (endSeconds - startSeconds < MEDIA_CONTEXT_LIMITS.minShotSegmentSeconds) continue;
		segments.push({
			startSeconds,
			endSeconds,
			midpointSeconds: Math.round(((startSeconds + endSeconds) / 2) * 10) / 10,
		});
	}
	return segments.slice(0, MEDIA_CONTEXT_LIMITS.maxShotSegments);
}

/** Evenly spaced moments used to build a bounded visual overview of a video. */
export function contactSheetFrameTimes(
	durationSeconds: number | undefined,
	frameCount = 6,
): number[] {
	const requestedCount = Number.isFinite(frameCount) ? Math.floor(frameCount) : 6;
	const count = Math.max(1, Math.min(MEDIA_CONTEXT_LIMITS.maxContactSheetFrames, requestedCount));
	const duration =
		typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
			? durationSeconds
			: 1;
	if (count === 1) return [0];
	// Avoid sampling the final encoded frame, which is often black or incomplete.
	const end = Math.max(0, duration - Math.min(0.25, duration / 20));
	return Array.from({ length: count }, (_, index) => (end * index) / (count - 1));
}

/** Prefer one representative moment from each detected shot when available. */
export function preferredContactSheetFrameTimes(
	durationSeconds: number | undefined,
	frameCount = 6,
	shotSegments: MediaContextShotSegment[] = [],
): number[] {
	const evenlySpaced = contactSheetFrameTimes(durationSeconds, frameCount);
	const safeSegments = shotSegments.filter(
		(segment) =>
			typeof segment.midpointSeconds === "number" &&
			Number.isFinite(segment.midpointSeconds) &&
			segment.midpointSeconds >= 0 &&
			(typeof durationSeconds !== "number" || segment.midpointSeconds <= durationSeconds),
	);
	if (!safeSegments.length) return evenlySpaced;

	const count = evenlySpaced.length;
	const selected = Array.from({ length: Math.min(count, safeSegments.length) }, (_, index) => {
		const segmentIndex = Math.round((index * (safeSegments.length - 1)) / Math.max(1, count - 1));
		return safeSegments[segmentIndex]?.midpointSeconds ?? 0;
	});
	if (selected.length >= count) return selected;

	const used = new Set(selected.map((value) => Math.round(value * 10) / 10));
	for (const value of evenlySpaced) {
		const rounded = Math.round(value * 10) / 10;
		if (used.has(rounded)) continue;
		selected.push(value);
		used.add(rounded);
		if (selected.length >= count) break;
	}
	return selected.sort((a, b) => a - b).slice(0, count);
}

export function parseMediaContextProbe(output: string): MediaContextProbe {
	const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/i);
	const durationSeconds = durationMatch
		? Number(durationMatch[1]) * 3_600 +
			Number(durationMatch[2]) * 60 +
			Number(durationMatch[3]) +
			Number(`0.${durationMatch[4]}`)
		: undefined;
	const videoStream = output.match(/Stream #\d+:\d+[^:]*: Video:\s*([^,\s]+)/i);
	const dimensions = output.match(/(?:,|\s)(\d{2,6})x(\d{2,6})(?:[,\s])/i);
	const frameRate = output.match(/(\d+(?:\.\d+)?)\s+(?:fps|tbr)\b/i);
	const bounded = (value: number | undefined, maximum: number) =>
		value !== undefined && Number.isFinite(value) && value >= 0 && value <= maximum
			? value
			: undefined;
	const width = dimensions
		? bounded(Number(dimensions[1]), MEDIA_CONTEXT_LIMITS.maxDimension)
		: undefined;
	const height = dimensions
		? bounded(Number(dimensions[2]), MEDIA_CONTEXT_LIMITS.maxDimension)
		: undefined;
	const safeDuration = bounded(durationSeconds, MEDIA_CONTEXT_LIMITS.maxDurationSeconds);
	const safeFrameRate = frameRate ? bounded(Number(frameRate[1]), 240) : undefined;

	return {
		...(width !== undefined ? { width } : {}),
		...(height !== undefined ? { height } : {}),
		...(safeDuration !== undefined ? { durationSeconds: safeDuration } : {}),
		...(safeFrameRate !== undefined ? { frameRate: safeFrameRate } : {}),
		...(videoStream ? { codec: videoStream[1].toLowerCase().slice(0, 40) } : {}),
		hasAudio: /Stream #\d+:\d+[^:]*: Audio:/i.test(output),
	};
}

const ASSET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function boundedText(value: unknown, maximum: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim().replace(/\s+/g, " ");
	return text ? text.slice(0, maximum) : undefined;
}

function promptSafeText(value: unknown, maximum: number): string | undefined {
	return boundedText(value, maximum)?.replace(
		/(?:[A-Za-z]:[\\/]|\/(?:Users|private|tmp|home|var)\/)[^\s]+/g,
		"[redacted path]",
	);
}

function boundedPositiveNumber(value: unknown, maximum: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
	return value <= maximum ? value : undefined;
}

function normalizeTranscriptSegments(
	value: unknown,
	durationSeconds?: number,
): MediaContextTranscriptSegment[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const maxEnd =
		typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
			? Math.min(durationSeconds, MEDIA_CONTEXT_LIMITS.maxTranscriptDurationSeconds)
			: MEDIA_CONTEXT_LIMITS.maxTranscriptDurationSeconds;
	const segments = value
		.map((segment) => {
			if (!segment || typeof segment !== "object" || Array.isArray(segment)) return undefined;
			const candidate = segment as Record<string, unknown>;
			const startSeconds = boundedPositiveNumber(candidate.startSeconds, maxEnd);
			const endSeconds = boundedPositiveNumber(candidate.endSeconds, maxEnd);
			const text = boundedText(candidate.text, MEDIA_CONTEXT_LIMITS.maxTranscriptSegmentChars);
			if (
				startSeconds === undefined ||
				endSeconds === undefined ||
				endSeconds <= startSeconds ||
				!text
			) {
				return undefined;
			}
			return { startSeconds, endSeconds, text } satisfies MediaContextTranscriptSegment;
		})
		.filter((segment): segment is MediaContextTranscriptSegment => Boolean(segment))
		.slice(0, MEDIA_CONTEXT_LIMITS.maxTranscriptSegments);
	return segments.length ? segments : undefined;
}

function normalizeOcrText(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value
		.map((item) => boundedText(item, MEDIA_CONTEXT_LIMITS.maxOcrItemChars))
		.filter((item): item is string => Boolean(item))
		.filter((item, index, values) => values.indexOf(item) === index)
		.slice(0, MEDIA_CONTEXT_LIMITS.maxOcrItems);
	return items.length ? items : undefined;
}

export function normalizeMediaContextSemanticAnalysis(
	value: unknown,
): MediaContextSemanticAnalysis {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const candidate = value as Record<string, unknown>;
	const visualSummary = boundedText(
		candidate.visualSummary,
		MEDIA_CONTEXT_LIMITS.maxVisualSummaryChars,
	);
	const ocrText = normalizeOcrText(candidate.ocrText);
	return {
		...(visualSummary ? { visualSummary } : {}),
		...(ocrText ? { ocrText } : {}),
	};
}

export function buildTranscriptExcerpt(
	segments: MediaContextTranscriptSegment[] | undefined,
): string | undefined {
	if (!segments?.length) return undefined;
	const excerpt = segments
		.slice(0, MEDIA_CONTEXT_LIMITS.maxTranscriptSegments)
		.map(
			(segment) =>
				`[${segment.startSeconds.toFixed(1)}–${segment.endSeconds.toFixed(1)}s] ${segment.text}`,
		)
		.join(" ");
	return excerpt.slice(0, MEDIA_CONTEXT_LIMITS.maxTranscriptExcerptChars);
}

const RETRIEVAL_STOP_WORDS = new Set([
	"a",
	"about",
	"and",
	"are",
	"at",
	"for",
	"from",
	"how",
	"into",
	"is",
	"it",
	"of",
	"on",
	"or",
	"the",
	"this",
	"to",
	"what",
	"when",
	"where",
	"with",
	"your",
]);

function retrievalTokens(value: unknown): string[] {
	if (typeof value !== "string") return [];
	return [
		...new Set(
			value
				.toLowerCase()
				.replace(/[^\p{L}\p{N}]+/gu, " ")
				.split(/\s+/)
				.filter((token) => token.length >= 2 && !RETRIEVAL_STOP_WORDS.has(token)),
		),
	];
}

function retrievalScore(queryTokens: string[], value: string | undefined): number {
	if (!value) return 0;
	const haystack = ` ${value.toLowerCase()} `;
	return queryTokens.reduce((score, token) => {
		const exact = haystack.includes(` ${token} `);
		const partial = !exact && haystack.includes(token);
		return score + (exact ? 3 : partial ? 1 : 0);
	}, 0);
}

function semanticVector(value: string | undefined): number[] {
	const vector = Array.from({ length: MEDIA_CONTEXT_LIMITS.retrievalVectorDimensions }, () => 0);
	if (!value) return vector;
	const normalized = value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
	if (!normalized) return vector;

	const addFeature = (feature: string, weight: number) => {
		let hash = 2_166_136_261;
		for (const character of feature) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
		const bucket = (hash >>> 0) % MEDIA_CONTEXT_LIMITS.retrievalVectorDimensions;
		vector[bucket] = (vector[bucket] ?? 0) + (hash & 1 ? weight : -weight);
	};

	for (const token of normalized.split(/\s+/)) {
		addFeature(`w:${token}`, 2);
		for (let index = 0; index < token.length - 2; index += 1) {
			addFeature(`n:${token.slice(index, index + 3)}`, 1);
		}
	}
	const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
	return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}

function vectorSimilarity(left: number[], right: number[]): number {
	return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

/**
 * Search the bounded media manifest without embeddings, network calls, or
 * filesystem access. The weighted lexical pass is deterministic and gives
 * the model exact source ranges it can use with the editor's seek tool.
 */
export function searchMediaContext(
	assets: MediaContextAssetSummary[],
	query: string,
	limit = MEDIA_CONTEXT_LIMITS.maxRetrievalHits,
): MediaContextRetrievalHit[] {
	const queryText = query.trim().slice(0, MEDIA_CONTEXT_LIMITS.maxRetrievalQueryChars);
	const queryTokens = retrievalTokens(queryText);
	if (!queryTokens.length) return [];
	const queryVector = semanticVector(queryText);
	const hits: MediaContextRetrievalHit[] = [];

	for (const asset of assets.slice(0, MEDIA_CONTEXT_LIMITS.maxAssets)) {
		const metadataScore = retrievalScore(queryTokens, `${asset.label} ${asset.role} ${asset.kind}`);
		const visualScore = retrievalScore(queryTokens, asset.visualSummary);
		const visualSimilarity = vectorSimilarity(queryVector, semanticVector(asset.visualSummary));
		if (visualScore > 0 || visualSimilarity >= 0.22) {
			hits.push({
				assetId: asset.id,
				label: asset.label,
				kind: asset.kind,
				source: "visual",
				score: visualScore + 2 + visualSimilarity * 4,
				text: promptSafeText(asset.visualSummary, MEDIA_CONTEXT_LIMITS.maxRetrievalHitChars) ?? "",
			});
		}

		for (const text of asset.ocrText ?? []) {
			const score = retrievalScore(queryTokens, text);
			const similarity = vectorSimilarity(queryVector, semanticVector(text));
			if (score > 0 || similarity >= 0.32) {
				hits.push({
					assetId: asset.id,
					label: asset.label,
					kind: asset.kind,
					source: "ocr",
					score: score + 5 + similarity * 4,
					text: promptSafeText(text, MEDIA_CONTEXT_LIMITS.maxRetrievalHitChars) ?? "",
				});
			}
		}

		for (const segment of asset.transcriptSegments ?? []) {
			const score = retrievalScore(queryTokens, segment.text);
			const similarity = vectorSimilarity(queryVector, semanticVector(segment.text));
			if (score > 0 || similarity >= 0.22) {
				hits.push({
					assetId: asset.id,
					label: asset.label,
					kind: asset.kind,
					source: "transcript",
					score: score + 7 + similarity * 4,
					text: promptSafeText(segment.text, MEDIA_CONTEXT_LIMITS.maxRetrievalHitChars) ?? "",
					startSeconds: segment.startSeconds,
					endSeconds: segment.endSeconds,
				});
			}
		}

		const metadataSimilarity = vectorSimilarity(
			queryVector,
			semanticVector(`${asset.label} ${asset.role} ${asset.kind}`),
		);
		if (
			(metadataScore > 0 || metadataSimilarity >= 0.32) &&
			!asset.visualSummary &&
			!asset.ocrText?.length &&
			!asset.transcriptSegments?.length
		) {
			hits.push({
				assetId: asset.id,
				label: asset.label,
				kind: asset.kind,
				source: "metadata",
				score: metadataScore + metadataSimilarity * 4,
				text: `${asset.kind} reference: ${promptSafeText(asset.label, MEDIA_CONTEXT_LIMITS.maxRetrievalHitChars) ?? "media"}`,
			});
		}
	}

	return hits
		.sort((left, right) => right.score - left.score || left.assetId.localeCompare(right.assetId))
		.slice(0, Math.max(1, Math.min(MEDIA_CONTEXT_LIMITS.maxRetrievalHits, limit)));
}

export function buildMediaContextRetrievalPrompt(
	assets: MediaContextAssetSummary[],
	query: string,
	limit = MEDIA_CONTEXT_LIMITS.maxRetrievalHits,
): string {
	const hits = searchMediaContext(assets, query, limit);
	if (!hits.length) return "";
	return [
		"## Relevant supplied-media matches",
		"These are deterministic matches from the attached media manifest. Treat them as evidence, not as invented facts.",
		...hits.map((hit) => {
			const range =
				hit.startSeconds !== undefined && hit.endSeconds !== undefined
					? ` at ${hit.startSeconds.toFixed(1)}–${hit.endSeconds.toFixed(1)}s`
					: "";
			return `- ${hit.assetId} (${hit.kind}, ${hit.source})${range}: ${hit.text}`;
		}),
		"If the user asks to inspect a matched source moment, use the seek tool with the supplied timestamp before answering.",
	].join("\n");
}

export function isMediaContextKind(value: unknown): value is MediaContextKind {
	return typeof value === "string" && (MEDIA_CONTEXT_KINDS as readonly string[]).includes(value);
}

export function isMediaContextRole(value: unknown): value is MediaContextRole {
	return typeof value === "string" && (MEDIA_CONTEXT_ROLES as readonly string[]).includes(value);
}

export function isMediaContextAssetId(value: unknown): value is string {
	return typeof value === "string" && ASSET_ID_RE.test(value);
}

/**
 * Normalize untrusted metadata from IPC/UI boundaries. Invalid assets are
 * rejected rather than partially accepted, because a partial reference can
 * cause the planner and renderer to disagree about what exists.
 */
export function normalizeMediaContextAsset(value: unknown): MediaContextAsset | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, unknown>;
	if (!isMediaContextAssetId(candidate.id)) return undefined;
	if (!isMediaContextKind(candidate.kind) || !isMediaContextRole(candidate.role)) return undefined;

	const label = boundedText(candidate.label, MEDIA_CONTEXT_LIMITS.maxLabelLength);
	const mimeType = boundedText(candidate.mimeType, MEDIA_CONTEXT_LIMITS.maxMimeTypeLength);
	const sizeBytes = boundedPositiveNumber(candidate.sizeBytes, MEDIA_CONTEXT_LIMITS.maxBytes);
	if (!label || !mimeType || sizeBytes === undefined) return undefined;

	const width = boundedPositiveNumber(candidate.width, MEDIA_CONTEXT_LIMITS.maxDimension);
	const height = boundedPositiveNumber(candidate.height, MEDIA_CONTEXT_LIMITS.maxDimension);
	const durationSeconds = boundedPositiveNumber(
		candidate.durationSeconds,
		MEDIA_CONTEXT_LIMITS.maxDurationSeconds,
	);
	const frameRate = boundedPositiveNumber(candidate.frameRate, 240);
	const codec = boundedText(candidate.codec, 40);
	const hasAudio = typeof candidate.hasAudio === "boolean" ? candidate.hasAudio : undefined;
	const shotSegments = Array.isArray(candidate.shotSegments)
		? candidate.shotSegments
				.map((segment) => {
					if (!segment || typeof segment !== "object" || Array.isArray(segment)) return undefined;
					const value = segment as Record<string, unknown>;
					const startSeconds = boundedPositiveNumber(
						value.startSeconds,
						MEDIA_CONTEXT_LIMITS.maxDurationSeconds,
					);
					const endSeconds = boundedPositiveNumber(
						value.endSeconds,
						MEDIA_CONTEXT_LIMITS.maxDurationSeconds,
					);
					const midpointSeconds = boundedPositiveNumber(
						value.midpointSeconds,
						MEDIA_CONTEXT_LIMITS.maxDurationSeconds,
					);
					if (
						startSeconds === undefined ||
						endSeconds === undefined ||
						midpointSeconds === undefined ||
						endSeconds <= startSeconds ||
						midpointSeconds < startSeconds ||
						midpointSeconds > endSeconds
					) {
						return undefined;
					}
					return { startSeconds, endSeconds, midpointSeconds } satisfies MediaContextShotSegment;
				})
				.filter((segment): segment is MediaContextShotSegment => Boolean(segment))
				.slice(0, MEDIA_CONTEXT_LIMITS.maxShotSegments)
		: undefined;
	const transcriptSegments = normalizeTranscriptSegments(
		candidate.transcriptSegments,
		durationSeconds,
	);
	const transcriptExcerpt = boundedText(
		candidate.transcriptExcerpt,
		MEDIA_CONTEXT_LIMITS.maxTranscriptExcerptChars,
	);
	const visualSummary = boundedText(
		candidate.visualSummary,
		MEDIA_CONTEXT_LIMITS.maxVisualSummaryChars,
	);
	const ocrText = normalizeOcrText(candidate.ocrText);
	const previewPath = boundedText(candidate.previewPath, 2_048);

	return {
		id: candidate.id,
		kind: candidate.kind,
		role: candidate.role,
		label,
		mimeType,
		sizeBytes,
		...(width !== undefined ? { width } : {}),
		...(height !== undefined ? { height } : {}),
		...(durationSeconds !== undefined ? { durationSeconds } : {}),
		...(frameRate !== undefined ? { frameRate } : {}),
		...(codec ? { codec } : {}),
		...(hasAudio !== undefined ? { hasAudio } : {}),
		...(shotSegments?.length ? { shotSegments } : {}),
		...(visualSummary ? { visualSummary } : {}),
		...(ocrText ? { ocrText } : {}),
		...(transcriptExcerpt ? { transcriptExcerpt } : {}),
		...(transcriptSegments ? { transcriptSegments } : {}),
		...(previewPath ? { previewPath } : {}),
	};
}

/**
 * Keep the planner prompt factual and bounded. Paths, raw OCR blobs, and file
 * contents never belong in this string; only stable ids and compact summaries
 * do. The staged file is accessed by the privileged renderer later.
 */
export function buildMediaContextPrompt(assets: MediaContextAssetSummary[]): string {
	const safe = assets
		.slice(0, MEDIA_CONTEXT_LIMITS.maxAssets)
		.map((asset) => {
			const dimensions = asset.width && asset.height ? `, ${asset.width}×${asset.height}` : "";
			const duration = asset.durationSeconds ? `, ${asset.durationSeconds.toFixed(1)}s` : "";
			const frameRate = asset.frameRate ? `, ${asset.frameRate.toFixed(2)}fps` : "";
			const codec = asset.codec ? `, ${asset.codec}` : "";
			const audio = asset.hasAudio === undefined ? "" : asset.hasAudio ? ", audio" : ", silent";
			const visual = promptSafeText(asset.visualSummary, 240);
			const ocr = Array.isArray(asset.ocrText)
				? asset.ocrText
						.map((text) => promptSafeText(text, 80))
						.filter((text): text is string => Boolean(text))
						.slice(0, 8)
						.join(" / ")
				: "";
			const transcript = promptSafeText(asset.transcriptExcerpt, 600);
			const transcriptSegments = Array.isArray(asset.transcriptSegments)
				? asset.transcriptSegments
						.slice(0, MEDIA_CONTEXT_LIMITS.maxTranscriptSegments)
						.map(
							(segment) =>
								`[${segment.startSeconds.toFixed(1)}–${segment.endSeconds.toFixed(1)}s] ${promptSafeText(segment.text, MEDIA_CONTEXT_LIMITS.maxTranscriptSegmentChars) ?? ""}`,
						)
						.filter((segment) => !segment.endsWith("] "))
						.join(" ")
				: "";
			const shotSegments = Array.isArray(asset.shotSegments)
				? asset.shotSegments
						.slice(0, MEDIA_CONTEXT_LIMITS.maxShotSegments)
						.map(
							(segment) => `${segment.startSeconds.toFixed(1)}–${segment.endSeconds.toFixed(1)}s`,
						)
						.join(", ")
				: "";
			return [
				`- ${asset.id} (${asset.kind}, ${asset.role}): ${asset.label}${dimensions}${duration}${frameRate}${codec}${audio}`,
				visual ? `  visual summary: ${visual}` : "",
				ocr ? `  visible text: ${ocr}` : "",
				transcript ? `  transcript excerpt: ${transcript}` : "",
				transcriptSegments ? `  timecoded transcript: ${transcriptSegments}` : "",
				shotSegments ? `  detected shot ranges: ${shotSegments}` : "",
			]
				.filter(Boolean)
				.join("\n");
		})
		.join("\n");

	return safe
		? [
				"## Supplied media context",
				"Use only the supplied asset ids when referring to user media.",
				"Treat product-truth and UI-reference assets as factual sources. Do not invent details that are not visible or stated in the brief.",
				safe,
			].join("\n")
		: "## Supplied media context\nNo user media is attached.";
}
