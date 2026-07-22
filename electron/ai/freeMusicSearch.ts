/**
 * Free Music Search — search and download openly-licensed music directly from
 * the desktop app, with no backend/account in between.
 *
 * Uses the Openverse API (https://api.openverse.org), an open catalog of
 * CC-licensed and public-domain audio aggregated from Freesound, Wikimedia,
 * Jamendo and others. Anonymous access needs no API key (it is rate-limited).
 * Requests run in the main process so there are no browser CORS restrictions.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

const API_BASE = "https://api.openverse.org/v1";
const MUSIC_DIR = "music-library";

function getMusicDir(): string {
	return path.join(app.getPath("userData"), MUSIC_DIR);
}

async function ensureMusicDir(): Promise<string> {
	const dir = getMusicDir();
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

export interface FreeMusicResult {
	id: string;
	title: string;
	creator: string;
	/** Direct URL to the audio file. */
	audioUrl: string;
	/** License short code, e.g. "by", "cc0", "pdm". */
	license: string;
	licenseUrl: string;
	/** Track length in milliseconds (0 when unknown). */
	durationMs: number;
	/** Page a human can open to view attribution/details. */
	sourceUrl: string;
}

// biome-ignore lint/suspicious/noExplicitAny: external API payload
function mapResult(a: any): FreeMusicResult | null {
	const audioUrl = a?.url || "";
	if (!audioUrl) return null;
	return {
		id: String(a.id || ""),
		title: a.title || "Untitled",
		creator: a.creator || "Unknown",
		audioUrl,
		license: String(a.license || "").toLowerCase(),
		licenseUrl: a.license_url || "",
		durationMs: Number.isFinite(a.duration) ? Number(a.duration) : 0,
		sourceUrl: a.foreign_landing_url || "",
	};
}

/**
 * Search Openverse for openly-licensed audio by keyword.
 */
export async function searchFreeMusic(
	query: string,
	page = 1,
	pageSize = 20,
): Promise<{ results: FreeMusicResult[]; error?: string }> {
	try {
		const q = query.trim() || "background music";
		const url = `${API_BASE}/audio/?q=${encodeURIComponent(q)}&page=${page}&page_size=${pageSize}&mature=false`;
		const response = await fetch(url, {
			headers: {
				"User-Agent": "GuideStudio/1.0 (desktop app)",
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(15_000),
		});

		if (!response.ok) {
			console.warn(`[free-music] search returned ${response.status} for query="${q}"`);
			return { results: [], error: `Music search returned ${response.status}` };
		}

		const data = await response.json();
		const items = Array.isArray(data?.results) ? data.results : [];
		const results = items
			.map(mapResult)
			.filter((r: FreeMusicResult | null): r is FreeMusicResult => r !== null);

		return { results };
	} catch (err) {
		return { results: [], error: `Search failed: ${err}` };
	}
}

/**
 * Download a track to the local music library and return its file path.
 */
export async function downloadFreeMusic(
	audioUrl: string,
	name: string,
): Promise<{ success: boolean; filePath?: string; error?: string }> {
	try {
		const response = await fetch(audioUrl, {
			headers: { "User-Agent": "GuideStudio/1.0 (desktop app)" },
			signal: AbortSignal.timeout(60_000),
		});

		if (!response.ok) {
			return { success: false, error: `Download failed: ${response.status}` };
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		if (buffer.byteLength === 0) return { success: false, error: "Downloaded file was empty." };

		// Keep the file's own extension where possible; default to mp3.
		const urlExt = path.extname(new URL(audioUrl).pathname).replace(/[^a-z0-9.]/gi, "");
		const ext = urlExt && urlExt.length <= 5 ? urlExt : ".mp3";
		const safeName = (name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase() || "track").slice(0, 60);
		const dir = await ensureMusicDir();
		const filePath = path.join(dir, `${safeName}-${buffer.byteLength}${ext}`);
		await fs.writeFile(filePath, buffer);

		return { success: true, filePath };
	} catch (err) {
		return { success: false, error: `Download failed: ${err}` };
	}
}
