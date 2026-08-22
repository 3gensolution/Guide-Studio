// ── Stock image resolution ───────────────────────────────────────────────
//
// Claude plans without a network. When a frame wants a photograph it writes
// an `assetQuery` — a plain-English description of the picture — and Guide
// Studio does the fetching here, after the run and before validation.
//
// Keeping the network on our side of the line is what makes the result
// shippable: we choose the source, we enforce the licence filter, we cap what
// gets downloaded, and we carry the credit the licence obliges into the
// storyboard. A model that decides those things itself decides them
// invisibly, and a course built on it is a licence problem waiting to happen.
//
// Nothing here can fail the plan. A query that finds nothing, a source that
// times out, a rate limit — each ends as a warning and a frame that degrades
// to text, exactly as an unsupplied image already did.

import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./json";
import { ASSET_QUERY_LIMITS } from "./storyboard";

/** Openverse indexes openly-licensed media and needs no API key. */
const SEARCH_ENDPOINT = "https://api.openverse.org/v1/images/";

/** Ceilings. A storyboard is short; a runaway download budget is not useful. */
const LIMITS = {
	/** Images fetched per video, however many frames ask. Quoted to the planner. */
	maxAssets: ASSET_QUERY_LIMITS.maxAssets,
	/** Per-request wall clock, search and download alike. */
	requestMs: 12_000,
	/** Refuse anything larger rather than stalling a render on a 40MB TIFF. */
	maxBytes: 12 * 1024 * 1024,
	/** Creators named on the closing card before the credit is summarised. */
	maxCredits: 4,
} as const;

/** Extensions we will hand to the renderer, keyed by what the server claims. */
const EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
};

export interface ResolvedAsset {
	/** The id the storyboard references, e.g. "asset-1". */
	id: string;
	/** What the planner asked for, kept so the UI can explain the picture. */
	query: string;
	/** Absolute path inside the session workspace. */
	path: string;
	label: string;
	/** Ready-made credit line from the source, already licence-correct. */
	attribution: string;
	sourceUrl: string;
}

export interface ResolveResult {
	assets: ResolvedAsset[];
	warnings: string[];
	/** The credit the finished video has to show, or undefined when none is owed. */
	attributionLine?: string;
}

interface SearchHit {
	url: string;
	title: string;
	attribution: string;
	sourceUrl: string;
}

/** One fetch with a deadline, so a hung host cannot hold the plan open. */
async function withTimeout<T>(
	run: (signal: AbortSignal) => Promise<T>,
	outer: AbortSignal | undefined,
	ms: number,
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	const relay = () => controller.abort();
	outer?.addEventListener("abort", relay, { once: true });
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
		outer?.removeEventListener("abort", relay);
	}
}

/**
 * Ask the index for one usable picture.
 *
 * The licence filter is not a preference: these videos are published, often
 * commercially, so anything that forbids commercial use or modification is
 * excluded at the query rather than sorted out afterwards.
 */
export async function searchStockImage(
	query: string,
	signal?: AbortSignal,
): Promise<SearchHit | undefined> {
	const url = new URL(SEARCH_ENDPOINT);
	url.searchParams.set("q", query);
	url.searchParams.set("license_type", "commercial,modification");
	url.searchParams.set("page_size", "5");
	// Mature content has no place in a product demo or a course module.
	url.searchParams.set("mature", "false");

	const response = await withTimeout(
		(inner) =>
			fetch(url, {
				signal: inner,
				headers: { Accept: "application/json", "User-Agent": "GuideStudio/1.0" },
			}),
		signal,
		LIMITS.requestMs,
	);
	if (!response.ok) {
		throw new Error(
			response.status === 429
				? "the image search is rate limiting this machine"
				: `the image search answered ${response.status}`,
		);
	}

	const body: unknown = await response.json();
	const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
	for (const result of results) {
		if (!isRecord(result)) continue;
		const source = typeof result.url === "string" ? result.url : undefined;
		if (!source || !/^https:\/\//i.test(source)) continue;
		const title = typeof result.title === "string" ? result.title : query;
		const creator = typeof result.creator === "string" ? result.creator : "";
		const licence =
			typeof result.license === "string"
				? `CC ${result.license.toUpperCase()}${typeof result.license_version === "string" ? ` ${result.license_version}` : ""}`
				: "an open licence";
		return {
			url: source,
			title,
			// The index ships a formatted credit; ours is the fallback.
			attribution:
				typeof result.attribution === "string" && result.attribution
					? result.attribution
					: `"${title}"${creator ? ` by ${creator}` : ""} (${licence})`,
			sourceUrl:
				typeof result.foreign_landing_url === "string" ? result.foreign_landing_url : source,
		};
	}
	return undefined;
}

/** Download to the session folder. Rejects anything that is not a bounded image. */
export async function downloadImage(
	url: string,
	destDir: string,
	id: string,
	signal?: AbortSignal,
): Promise<string> {
	const response = await withTimeout(
		(inner) => fetch(url, { signal: inner, headers: { "User-Agent": "GuideStudio/1.0" } }),
		signal,
		LIMITS.requestMs,
	);
	if (!response.ok) throw new Error(`the image host answered ${response.status}`);

	const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
	const extension = EXTENSIONS[contentType.toLowerCase()];
	if (!extension) throw new Error(`the image host returned ${contentType || "an unknown type"}`);

	const declared = Number(response.headers.get("content-length") ?? "0");
	if (declared > LIMITS.maxBytes) throw new Error("the image was too large to use");

	const bytes = Buffer.from(await response.arrayBuffer());
	// Content-Length is a claim, not a guarantee, so the real size is checked too.
	if (bytes.byteLength > LIMITS.maxBytes) throw new Error("the image was too large to use");
	if (bytes.byteLength === 0) throw new Error("the image was empty");

	fs.mkdirSync(destDir, { recursive: true });
	const filePath = path.join(destDir, `${id}.${extension}`);
	fs.writeFileSync(filePath, bytes);
	return filePath;
}

/** Every `assetQuery` in the planner's raw frame list, in frame order. */
export function collectAssetQueries(frames: unknown): Array<{ index: number; query: string }> {
	if (!Array.isArray(frames)) return [];
	const found: Array<{ index: number; query: string }> = [];
	for (const [index, frame] of frames.entries()) {
		if (!isRecord(frame)) continue;
		const query = typeof frame.assetQuery === "string" ? frame.assetQuery.trim().slice(0, 120) : "";
		if (query) found.push({ index, query });
	}
	return found;
}

/** The credit the video owes, folded into one line the outro can carry. */
export function attributionLineFor(assets: ResolvedAsset[]): string | undefined {
	if (!assets.length) return undefined;
	const credits = assets.map((asset) => asset.attribution);
	if (credits.length > LIMITS.maxCredits) {
		return `Images via Openverse under Creative Commons licences (${credits.length} sources).`;
	}
	return `Images: ${credits.join("; ")}`;
}

export interface ResolveOptions {
	/** The parsed planner response; its frames are annotated in place. */
	parsed: unknown;
	destDir: string;
	signal?: AbortSignal;
	/** Progress for the creator's activity feed. */
	onNote?: (note: string) => void;
}

/**
 * Turn every `assetQuery` into a downloaded file and an `assetId` the
 * validator will accept. Frames are mutated in place, because the caller
 * hands the same object straight to `normalizeStoryboard` afterwards.
 */
export async function resolveAssetQueries(options: ResolveOptions): Promise<ResolveResult> {
	const root = isRecord(options.parsed) ? options.parsed : {};
	const frames = Array.isArray(root.frames) ? root.frames : [];
	const requests = collectAssetQueries(frames);
	if (!requests.length) return { assets: [], warnings: [] };

	const assets: ResolvedAsset[] = [];
	const warnings: string[] = [];
	// One picture per distinct query: two frames asking for the same thing get
	// the same file rather than two downloads and two credits.
	const byQuery = new Map<string, ResolvedAsset>();

	for (const request of requests) {
		if (options.signal?.aborted) break;
		const frame = frames[request.index];
		if (!isRecord(frame)) continue;

		const cached = byQuery.get(request.query.toLowerCase());
		if (cached) {
			frame.assetId = cached.id;
			continue;
		}
		if (assets.length >= LIMITS.maxAssets) {
			warnings.push(
				`Frame ${request.index + 1} asked for a ${request.query} image, but the video already uses the ${LIMITS.maxAssets} it is allowed.`,
			);
			continue;
		}

		const id = `asset-${assets.length + 1}`;
		try {
			options.onNote?.(`Looking for an image: ${request.query}`);
			const hit = await searchStockImage(request.query, options.signal);
			if (!hit) {
				warnings.push(
					`No openly-licensed image was found for "${request.query}", so frame ${request.index + 1} became a text frame.`,
				);
				continue;
			}
			const filePath = await downloadImage(hit.url, options.destDir, id, options.signal);
			const asset: ResolvedAsset = {
				id,
				query: request.query,
				path: filePath,
				label: hit.title,
				attribution: hit.attribution,
				sourceUrl: hit.sourceUrl,
			};
			assets.push(asset);
			byQuery.set(request.query.toLowerCase(), asset);
			frame.assetId = id;
			options.onNote?.(`Found "${hit.title}" for ${request.query}`);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warnings.push(
				`Could not fetch an image for "${request.query}" — ${reason}. Frame ${request.index + 1} became a text frame.`,
			);
		}
	}

	const result: ResolveResult = { assets, warnings };
	const line = attributionLineFor(assets);
	if (line) result.attributionLine = line;
	return result;
}
