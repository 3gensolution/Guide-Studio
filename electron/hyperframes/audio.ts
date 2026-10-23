// ── Sound the agent asked for but could not make ─────────────────────────
//
// The agent works offline, so it cannot generate audio. It places `<audio>`
// tags pointing at files that do not exist yet and lists what each should be:
//
//   output/sfx-requests.json   [{ "file": "assets/sfx/custom/<slug>.mp3",
//                                 "prompt": "...", "durationSeconds": 1.2,
//                                 "fallback": "whoosh" }]
//   output/music-request.json  { "prompt": "...", "durationSeconds": 30 }
//                              → always written to assets/music/bed.mp3
//
// Guide Studio fills them after the run, before the safety gate: ElevenLabs
// when the user has a key, otherwise the named library effect. A music bed
// with no source is removed from the composition rather than left pointing
// at nothing, and the user is told why there is no music.

import fs from "node:fs";
import path from "node:path";
import { readSfxLibrary, sfxLibraryDir } from "./project";

export const MUSIC_BED_FILE = "assets/music/bed.mp3";
export const CUSTOM_SFX_DIR = "assets/sfx/custom";
const MAX_SFX_REQUESTS = 8;

export interface SfxRequest {
	file: string;
	prompt: string;
	durationSeconds?: number;
	fallback: string;
}

export interface MusicRequest {
	prompt: string;
	durationSeconds: number;
}

export interface AudioGenerators {
	/** Resolve to a local mp3 path, or undefined when generation is unavailable or failed. */
	sfx?: (prompt: string, durationSeconds?: number) => Promise<string | undefined>;
	music?: (prompt: string, durationSeconds: number) => Promise<string | undefined>;
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

/** Validate the agent's SFX request list. Anything off-contract is dropped. */
export function parseSfxRequests(value: unknown, libraryIds: Set<string>): SfxRequest[] {
	if (!Array.isArray(value)) return [];
	const requests: SfxRequest[] = [];
	for (const entry of value.slice(0, MAX_SFX_REQUESTS)) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		const file = typeof record.file === "string" ? record.file.trim() : "";
		if (!new RegExp(`^${CUSTOM_SFX_DIR}/[a-z0-9][a-z0-9-]{0,40}\\.mp3$`).test(file)) continue;
		const prompt = typeof record.prompt === "string" ? record.prompt.trim().slice(0, 300) : "";
		if (!prompt) continue;
		const fallback =
			typeof record.fallback === "string" && libraryIds.has(record.fallback)
				? record.fallback
				: libraryIds.has("whoosh")
					? "whoosh"
					: ([...libraryIds][0] ?? "");
		const duration =
			typeof record.durationSeconds === "number" && Number.isFinite(record.durationSeconds)
				? Math.min(22, Math.max(0.5, record.durationSeconds))
				: undefined;
		requests.push({ file, prompt, fallback, ...(duration ? { durationSeconds: duration } : {}) });
	}
	return requests;
}

export function parseMusicRequest(value: unknown): MusicRequest | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const prompt = typeof record.prompt === "string" ? record.prompt.trim().slice(0, 600) : "";
	if (!prompt) return undefined;
	const duration =
		typeof record.durationSeconds === "number" && Number.isFinite(record.durationSeconds)
			? record.durationSeconds
			: 30;
	return { prompt, durationSeconds: Math.min(300, Math.max(5, Math.round(duration))) };
}

/** Remove every `<audio>` element whose src is the given project file. */
export function removeAudioElements(html: string, src: string): string {
	const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`[ \\t]*<audio\\b[^>]*\\ssrc\\s*=\\s*["']${escaped}["'][^>]*>\\s*(?:</audio\\s*>)?[ \\t]*\\r?\\n?`,
		"gi",
	);
	return html.replace(pattern, "");
}

function htmlFiles(root: string): string[] {
	const files = [path.join(root, "index.html")];
	const compositions = path.join(root, "compositions");
	if (fs.existsSync(compositions)) {
		for (const name of fs.readdirSync(compositions)) {
			if (name.endsWith(".html")) files.push(path.join(compositions, name));
		}
	}
	return files.filter((file) => fs.existsSync(file));
}

export interface ResolveAudioResult {
	notes: string[];
	warnings: string[];
}

export async function resolveAudioRequests(
	root: string,
	generators: AudioGenerators,
	vendorDir?: string,
): Promise<ResolveAudioResult> {
	const notes: string[] = [];
	const warnings: string[] = [];
	const library = readSfxLibrary(vendorDir);
	const libraryById = new Map(library.map((entry) => [entry.id, entry]));
	const libraryDir = sfxLibraryDir(vendorDir);

	const sfxRequests = parseSfxRequests(
		readJson(path.join(root, "output", "sfx-requests.json")),
		new Set(libraryById.keys()),
	);
	for (const request of sfxRequests) {
		const destination = path.join(root, request.file);
		if (fs.existsSync(destination)) continue;
		fs.mkdirSync(path.dirname(destination), { recursive: true });
		const generated = generators.sfx
			? await generators.sfx(request.prompt, request.durationSeconds).catch(() => undefined)
			: undefined;
		if (generated && fs.existsSync(generated)) {
			fs.copyFileSync(generated, destination);
			notes.push(`Generated sound effect "${request.prompt.slice(0, 60)}".`);
			continue;
		}
		const fallback = libraryById.get(request.fallback);
		if (fallback) {
			fs.copyFileSync(path.join(libraryDir, fallback.file), destination);
			notes.push(
				`Used the library "${fallback.id}" sound for "${request.prompt.slice(0, 60)}"${generators.sfx ? " (generation failed)" : ""}.`,
			);
		}
	}

	const musicPath = path.join(root, MUSIC_BED_FILE);
	const musicReferenced = htmlFiles(root).some((file) =>
		fs.readFileSync(file, "utf8").includes(MUSIC_BED_FILE),
	);
	if (musicReferenced && !fs.existsSync(musicPath)) {
		const request = parseMusicRequest(readJson(path.join(root, "output", "music-request.json")));
		const generated =
			request && generators.music
				? await generators.music(request.prompt, request.durationSeconds).catch(() => undefined)
				: undefined;
		if (generated && fs.existsSync(generated)) {
			fs.mkdirSync(path.dirname(musicPath), { recursive: true });
			fs.copyFileSync(generated, musicPath);
			notes.push("Generated a music bed with ElevenLabs.");
		} else {
			for (const file of htmlFiles(root)) {
				const html = fs.readFileSync(file, "utf8");
				const next = removeAudioElements(html, MUSIC_BED_FILE);
				if (next !== html) fs.writeFileSync(file, next, "utf8");
			}
			warnings.push(
				generators.music
					? "The music bed could not be generated, so this cut has no music. You can add a track under Finishing."
					: "No music source is set up, so this cut has no music bed. Add an ElevenLabs key in AI Settings, or add your own track under Finishing.",
			);
		}
	}
	return { notes, warnings };
}
