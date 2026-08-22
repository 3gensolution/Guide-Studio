import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attributionLineFor,
	collectAssetQueries,
	downloadImage,
	resolveAssetQueries,
	searchStockImage,
} from "./assets";

const dirs: string[] = [];

function tempDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guide-assets-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	vi.unstubAllGlobals();
	while (dirs.length) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** A stand-in for one Openverse search result. */
function searchResponse(results: unknown[]) {
	return new Response(JSON.stringify({ results }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function imageResponse(bytes: Buffer, type = "image/jpeg") {
	return new Response(bytes, { status: 200, headers: { "content-type": type } });
}

const HIT = {
	url: "https://example.test/roof.jpg",
	title: "Solar panels",
	creator: "Ada",
	license: "by",
	license_version: "4.0",
	attribution: '"Solar panels" by Ada is licensed under CC BY 4.0.',
	foreign_landing_url: "https://example.test/photo/1",
};

describe("collectAssetQueries", () => {
	it("reads every query in frame order and ignores frames without one", () => {
		expect(
			collectAssetQueries([
				{ kind: "title" },
				{ kind: "image", assetQuery: "  solar panels  " },
				{ kind: "bullets" },
				{ kind: "imageSplit", assetQuery: "a nurse at a ward desk" },
			]),
		).toEqual([
			{ index: 1, query: "solar panels" },
			{ index: 3, query: "a nurse at a ward desk" },
		]);
	});

	it("survives a planner response that is not a frame list", () => {
		expect(collectAssetQueries(undefined)).toEqual([]);
		expect(collectAssetQueries(["not an object", 7])).toEqual([]);
	});
});

describe("searchStockImage", () => {
	it("asks only for commercially reusable, modifiable, non-mature images", async () => {
		const fetchMock = vi.fn(async () => searchResponse([HIT]));
		vi.stubGlobal("fetch", fetchMock);

		await searchStockImage("solar panels");

		const url = new URL(String(fetchMock.mock.calls[0][0]));
		expect(url.searchParams.get("license_type")).toBe("commercial,modification");
		expect(url.searchParams.get("mature")).toBe("false");
		expect(url.searchParams.get("q")).toBe("solar panels");
	});

	it("skips results without an https source", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => searchResponse([{ ...HIT, url: "http://insecure.test/a.jpg" }, HIT])),
		);
		await expect(searchStockImage("panels")).resolves.toMatchObject({ url: HIT.url });
	});

	it("names a rate limit as itself, so the warning explains the missing image", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 429 })),
		);
		await expect(searchStockImage("panels")).rejects.toThrow(/rate limiting/);
	});
});

describe("downloadImage", () => {
	it("refuses a response that is not an image type we render", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
			),
		);
		await expect(downloadImage("https://x.test/a", tempDir(), "asset-1")).rejects.toThrow(
			/text\/html/,
		);
	});

	it("refuses a body larger than the cap even when the headers understate it", async () => {
		const huge = Buffer.alloc(13 * 1024 * 1024, 1);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => imageResponse(huge)),
		);
		await expect(downloadImage("https://x.test/a", tempDir(), "asset-1")).rejects.toThrow(
			/too large/,
		);
	});

	it("writes the file under the session folder, named by asset id", async () => {
		const dir = tempDir();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => imageResponse(Buffer.from([1, 2, 3]))),
		);
		const written = await downloadImage("https://x.test/a", dir, "asset-2");
		expect(written).toBe(path.join(dir, "asset-2.jpg"));
		expect(fs.readFileSync(written)).toEqual(Buffer.from([1, 2, 3]));
	});
});

describe("attributionLineFor", () => {
	it("owes nothing when nothing was fetched", () => {
		expect(attributionLineFor([])).toBeUndefined();
	});

	it("summarises rather than overflowing the outro once there are many credits", () => {
		const many = Array.from({ length: 5 }, (_, index) => ({
			id: `asset-${index}`,
			query: "q",
			path: "/tmp/a.jpg",
			label: "L",
			attribution: `credit ${index}`,
			sourceUrl: "https://x.test",
		}));
		expect(attributionLineFor(many)).toMatch(/Creative Commons/);
		expect(attributionLineFor(many.slice(0, 2))).toBe("Images: credit 0; credit 1");
	});
});

describe("resolveAssetQueries", () => {
	it("annotates the frame with an assetId the validator will accept", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) =>
				String(input).includes("openverse")
					? searchResponse([HIT])
					: imageResponse(Buffer.from([9])),
			),
		);
		const parsed = { frames: [{ kind: "image", assetQuery: "solar panels" }] };
		const result = await resolveAssetQueries({ parsed, destDir: tempDir() });

		expect(result.assets).toHaveLength(1);
		expect(parsed.frames[0]).toMatchObject({ assetId: "asset-1" });
		expect(result.attributionLine).toContain("Ada");
	});

	it("downloads one file when two frames ask for the same picture", async () => {
		const fetchMock = vi.fn(async (input: unknown) =>
			String(input).includes("openverse") ? searchResponse([HIT]) : imageResponse(Buffer.from([9])),
		);
		vi.stubGlobal("fetch", fetchMock);
		const parsed = {
			frames: [
				{ kind: "image", assetQuery: "solar panels" },
				{ kind: "imageSplit", assetQuery: "Solar Panels" },
			],
		};
		const result = await resolveAssetQueries({ parsed, destDir: tempDir() });

		expect(result.assets).toHaveLength(1);
		expect(parsed.frames[1]).toMatchObject({ assetId: "asset-1" });
	});

	it("turns a failed fetch into a warning, never a failed plan", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => searchResponse([])),
		);
		const parsed = { frames: [{ kind: "image", assetQuery: "a thing that does not exist" }] };
		const result = await resolveAssetQueries({ parsed, destDir: tempDir() });

		expect(result.assets).toEqual([]);
		expect(result.warnings[0]).toMatch(/No openly-licensed image/);
		expect(parsed.frames[0]).not.toHaveProperty("assetId");
	});
});
