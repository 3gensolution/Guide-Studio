import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));

import {
	MUSIC_BED_FILE,
	parseMusicRequest,
	parseSfxRequests,
	removeAudioElements,
	resolveAudioRequests,
} from "./audio";

const VENDOR = path.join(process.cwd(), "vendor", "hyperframes");
const created: string[] = [];
afterEach(() => {
	while (created.length) fs.rmSync(created.pop() as string, { recursive: true, force: true });
});

function project(index: string, extra: Record<string, string> = {}): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "hf-audio-"));
	created.push(root);
	fs.writeFileSync(path.join(root, "index.html"), index);
	for (const [name, body] of Object.entries(extra)) {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		fs.writeFileSync(path.join(root, name), body);
	}
	return root;
}

describe("audio requests", () => {
	const library = new Set(["whoosh", "pop"]);

	it("keeps only well-formed custom effect requests, capped at eight", () => {
		const requests = parseSfxRequests(
			[
				{
					file: "assets/sfx/custom/swoosh-1.mp3",
					prompt: "airy swoosh",
					durationSeconds: 99,
					fallback: "pop",
				},
				{ file: "../escape.mp3", prompt: "x" },
				{ file: "assets/sfx/custom/ok.mp3", prompt: "" },
				{ file: "assets/sfx/custom/no-fallback.mp3", prompt: "thud", fallback: "nope" },
				...Array.from({ length: 10 }, (_, index) => ({
					file: `assets/sfx/custom/extra-${index}.mp3`,
					prompt: "tick",
				})),
			],
			library,
		);
		expect(requests[0]).toEqual({
			file: "assets/sfx/custom/swoosh-1.mp3",
			prompt: "airy swoosh",
			durationSeconds: 22,
			fallback: "pop",
		});
		expect(requests[1]?.fallback).toBe("whoosh");
		expect(requests.every((request) => request.file.startsWith("assets/sfx/custom/"))).toBe(true);
		expect(requests.length).toBeLessThanOrEqual(8);
	});

	it("clamps the music request", () => {
		expect(parseMusicRequest({ prompt: "warm pulse, 110 bpm", durationSeconds: 900 })).toEqual({
			prompt: "warm pulse, 110 bpm",
			durationSeconds: 300,
		});
		expect(parseMusicRequest({ prompt: "  " })).toBeUndefined();
	});

	it("removes every audio element for a source, leaving other tags alone", () => {
		const html = `<div>\n  <audio id="music-bed" class="clip" data-start="0" src="assets/music/bed.mp3"></audio>\n  <audio id="pop" src="assets/sfx/pop.mp3"></audio>\n</div>`;
		const next = removeAudioElements(html, MUSIC_BED_FILE);
		expect(next).not.toContain("music-bed");
		expect(next).toContain(`<audio id="pop" src="assets/sfx/pop.mp3"></audio>`);
	});
});

describe("resolveAudioRequests", () => {
	it("generates when it can and falls back to the library when it cannot", async () => {
		const generated = path.join(os.tmpdir(), `hf-generated-${Date.now()}.mp3`);
		fs.writeFileSync(generated, "generated");
		created.push(generated);
		const root = project(`<audio id="a" src="assets/sfx/custom/one.mp3"></audio>`, {
			"output/sfx-requests.json": JSON.stringify([
				{ file: "assets/sfx/custom/one.mp3", prompt: "first", fallback: "pop" },
				{ file: "assets/sfx/custom/two.mp3", prompt: "second", fallback: "pop" },
			]),
		});
		let calls = 0;
		const result = await resolveAudioRequests(
			root,
			{ sfx: async () => (calls++ === 0 ? generated : undefined) },
			VENDOR,
		);
		expect(fs.readFileSync(path.join(root, "assets/sfx/custom/one.mp3"), "utf8")).toBe("generated");
		// The second request fell back to the bundled "pop" file.
		expect(fs.statSync(path.join(root, "assets/sfx/custom/two.mp3")).size).toBeGreaterThan(1000);
		expect(result.notes).toHaveLength(2);
	});

	it("drops an unfillable music bed from the composition and says why", async () => {
		const root = project(
			`<div id="root">\n<audio id="music-bed" src="${MUSIC_BED_FILE}"></audio>\n</div>`,
			{ "output/music-request.json": JSON.stringify({ prompt: "calm", durationSeconds: 20 }) },
		);
		const result = await resolveAudioRequests(root, {}, VENDOR);
		expect(fs.readFileSync(path.join(root, "index.html"), "utf8")).not.toContain("music-bed");
		expect(result.warnings[0]).toContain("no music bed");
	});

	it("writes a generated bed where the composition expects it", async () => {
		const bed = path.join(os.tmpdir(), `hf-bed-${Date.now()}.mp3`);
		fs.writeFileSync(bed, "music");
		created.push(bed);
		const root = project(`<audio id="music-bed" src="${MUSIC_BED_FILE}"></audio>`, {
			"output/music-request.json": JSON.stringify({ prompt: "calm", durationSeconds: 20 }),
		});
		const seen: Array<[string, number]> = [];
		await resolveAudioRequests(
			root,
			{
				music: async (prompt, duration) => {
					seen.push([prompt, duration]);
					return bed;
				},
			},
			VENDOR,
		);
		expect(seen).toEqual([["calm", 20]]);
		expect(fs.readFileSync(path.join(root, MUSIC_BED_FILE), "utf8")).toBe("music");
	});
});
