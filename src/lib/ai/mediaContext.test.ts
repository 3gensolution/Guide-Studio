import { describe, expect, it } from "vitest";
import {
	buildMediaContextPrompt,
	buildMediaContextRetrievalPrompt,
	buildShotSegments,
	contactSheetFrameTimes,
	getMediaContextFileType,
	MEDIA_CONTEXT_LIMITS,
	normalizeMediaContextAsset,
	normalizeMediaContextSemanticAnalysis,
	parseMediaContextProbe,
	parseShotChangeTimes,
	preferredContactSheetFrameTimes,
	searchMediaContext,
} from "./mediaContext";

describe("media context contract", () => {
	it("returns bounded, evenly spaced contact-sheet moments", () => {
		expect(contactSheetFrameTimes(10, 4)).toEqual([0, 3.25, 6.5, 9.75]);
		expect(contactSheetFrameTimes(10, 99)).toHaveLength(8);
		expect(contactSheetFrameTimes(undefined, 1)).toEqual([0]);
	});

	it("turns FFmpeg scene timestamps into bounded shot ranges", () => {
		const times = parseShotChangeTimes(
			"showinfo n:0 pts_time:2.04\nshowinfo n:1 pts_time:5.89\nshowinfo n:2 pts_time:5.89\nshowinfo n:3 pts_time:99",
			10,
		);
		expect(times).toEqual([2, 5.9, 10]);
		expect(buildShotSegments(10, times)).toEqual([
			{ startSeconds: 0, endSeconds: 2, midpointSeconds: 1 },
			{ startSeconds: 2, endSeconds: 5.9, midpointSeconds: 4 },
			{ startSeconds: 5.9, endSeconds: 10, midpointSeconds: 8 },
		]);
	});

	it("prefers representative frames from detected shots", () => {
		expect(
			preferredContactSheetFrameTimes(12, 4, [
				{ startSeconds: 0, endSeconds: 2, midpointSeconds: 1 },
				{ startSeconds: 2, endSeconds: 6, midpointSeconds: 4 },
				{ startSeconds: 6, endSeconds: 9, midpointSeconds: 7.5 },
				{ startSeconds: 9, endSeconds: 12, midpointSeconds: 10.5 },
			]),
		).toEqual([1, 4, 7.5, 10.5]);
		expect(preferredContactSheetFrameTimes(12, 4)).toEqual(contactSheetFrameTimes(12, 4));
	});

	it("allows approved image/video extensions and rejects executables", () => {
		expect(getMediaContextFileType("/tmp/SPACEMAIL-LOGO.SVG")).toEqual({
			kind: "image",
			mimeType: "image/svg+xml",
		});
		expect(getMediaContextFileType("/tmp/PRODUCT.MP4")).toEqual({
			kind: "video",
			mimeType: "video/mp4",
		});
		expect(getMediaContextFileType("/tmp/script.exe")).toBeUndefined();
		expect(getMediaContextFileType("/tmp/no-extension")).toBeUndefined();
	});

	it("parses bounded technical metadata from ffmpeg output", () => {
		const probe = parseMediaContextProbe(
			"Duration: 00:01:02.50, start: 0.000000, bitrate: 1200 kb/s\n" +
				"Stream #0:0: Video: h264, yuv420p, 1920x1080, 29.97 fps\n" +
				"Stream #0:1: Audio: aac, 48000 Hz",
		);
		expect(probe).toMatchObject({
			width: 1920,
			height: 1080,
			durationSeconds: 62.5,
			frameRate: 29.97,
			codec: "h264",
			hasAudio: true,
		});
	});

	it("normalizes a valid image asset", () => {
		expect(
			normalizeMediaContextAsset({
				id: "product-hero",
				kind: "image",
				role: "product-truth",
				label: "Product hero",
				mimeType: "image/png",
				sizeBytes: 1024,
				width: 2400,
				height: 1600,
			}),
		).toEqual({
			id: "product-hero",
			kind: "image",
			role: "product-truth",
			label: "Product hero",
			mimeType: "image/png",
			sizeBytes: 1024,
			width: 2400,
			height: 1600,
		});
	});

	it("rejects unsafe or incomplete asset metadata", () => {
		expect(
			normalizeMediaContextAsset({
				id: "../secret",
				kind: "image",
				role: "brand",
				label: "Logo",
				mimeType: "image/png",
				sizeBytes: 12,
			}),
		).toBeUndefined();
		expect(
			normalizeMediaContextAsset({
				id: "logo",
				kind: "document",
				role: "brand",
				label: "Logo",
				mimeType: "image/png",
				sizeBytes: 12,
			}),
		).toBeUndefined();
		expect(
			normalizeMediaContextAsset({
				id: "logo",
				kind: "image",
				role: "brand",
				label: "Logo",
				mimeType: "image/png",
				sizeBytes: MEDIA_CONTEXT_LIMITS.maxBytes + 1,
			}),
		).toBeUndefined();
	});

	it("builds a bounded prompt without paths", () => {
		const prompt = buildMediaContextPrompt([
			{
				id: "demo-video",
				kind: "video",
				role: "source-footage",
				label: "Product demo",
				width: 1920,
				height: 1080,
				durationSeconds: 18.5,
				frameRate: 30,
				codec: "h264",
				hasAudio: true,
				visualSummary: "The export flow is shown.",
				ocrText: ["Export"],
				shotSegments: [{ startSeconds: 0, endSeconds: 4, midpointSeconds: 2 }],
			},
		]);

		expect(prompt).toContain("demo-video");
		expect(prompt).toContain("The export flow is shown.");
		expect(prompt).toContain("Export");
		expect(prompt).toContain("30.00fps");
		expect(prompt).toContain("h264");
		expect(prompt).toContain("detected shot ranges: 0.0–4.0s");
		expect(prompt).not.toContain("/Users/");
	});

	it("keeps semantic analysis factual and bounded", () => {
		const semantic = normalizeMediaContextSemanticAnalysis({
			visualSummary: `  ${"a".repeat(500)}  `,
			ocrText: ["Export", "Export", " ", "a".repeat(200)],
		});
		expect(semantic.visualSummary).toHaveLength(MEDIA_CONTEXT_LIMITS.maxVisualSummaryChars);
		expect(semantic.ocrText).toEqual(["Export", "a".repeat(MEDIA_CONTEXT_LIMITS.maxOcrItemChars)]);
	});

	it("includes timecoded transcript phrases in the planner prompt", () => {
		const prompt = buildMediaContextPrompt([
			{
				id: "launch-video",
				kind: "video",
				role: "source-footage",
				label: "Launch video",
				transcriptSegments: [{ startSeconds: 1.2, endSeconds: 3.4, text: "Ship with confidence" }],
			},
		]);
		expect(prompt).toContain("timecoded transcript: [1.2–3.4s] Ship with confidence");
	});

	it("retrieves the strongest transcript and OCR matches with source ranges", () => {
		const assets = [
			{
				id: "demo-video",
				kind: "video" as const,
				role: "source-footage" as const,
				label: "Product demo",
				transcriptSegments: [{ startSeconds: 4, endSeconds: 6, text: "Export with one click" }],
			},
			{
				id: "ui-shot",
				kind: "image" as const,
				role: "ui-reference" as const,
				label: "Export screen",
				ocrText: ["Export"],
			},
		];
		const hits = searchMediaContext(assets, "Where is the export action?");
		expect(hits[0]).toMatchObject({
			assetId: "demo-video",
			source: "transcript",
			startSeconds: 4,
			endSeconds: 6,
		});
		expect(buildMediaContextRetrievalPrompt(assets, "Where is the export action?")).toContain(
			"4.0–6.0s",
		);
		expect(searchMediaContext(assets, "exporting")[0]).toMatchObject({
			assetId: "demo-video",
			source: "transcript",
		});
	});
});
