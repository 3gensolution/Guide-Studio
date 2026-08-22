import { describe, expect, it } from "vitest";
import {
	buildDeterministicStoryboard,
	LIMITS,
	normalizeStoryboard,
	parseStoryboardResponse,
	storyboardDurationSeconds,
	storyboardSystemPrompt,
} from "./storyboard";

const WITH_RECORDING = {
	hasRecording: true,
	recordingSeconds: 60,
	fallbackTitle: "Onboarding demo",
} as const;

/** A minimal draft that survives normalization, so tests can vary one field. */
function draft(overrides: Record<string, unknown> = {}) {
	return {
		title: "Onboarding demo",
		accent: "emerald",
		frames: [
			{ kind: "title", durationSeconds: 4, headline: "Set up your workspace" },
			{ kind: "screen", durationSeconds: 6, headline: "Create a project" },
			{ kind: "outro", durationSeconds: 3, headline: "Start recording" },
		],
		...overrides,
	};
}

describe("normalizeStoryboard", () => {
	it("keeps a well-formed planner storyboard intact", () => {
		const { storyboard, warnings } = normalizeStoryboard(draft(), WITH_RECORDING);
		expect(warnings).toEqual([]);
		expect(storyboard.title).toBe("Onboarding demo");
		expect(storyboard.accent).toBe("emerald");
		expect(storyboard.frames.map((frame) => frame.kind)).toEqual(["title", "screen", "outro"]);
		expect(storyboardDurationSeconds(storyboard)).toBe(13);
	});

	it("clamps frame durations into the renderable range", () => {
		const { storyboard } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 900, headline: "Too long" },
					{ kind: "statement", durationSeconds: 0.01, headline: "Too short" },
					{ kind: "outro", durationSeconds: "nonsense", headline: "Not a number" },
				],
			}),
			WITH_RECORDING,
		);
		expect(storyboard.frames.map((frame) => frame.durationSeconds)).toEqual([
			LIMITS.maxFrameSeconds,
			LIMITS.minFrameSeconds,
			5,
		]);
	});

	it("drops frames with an unknown kind rather than guessing one", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Real frame" },
					{ kind: "particle_explosion", durationSeconds: 4, headline: "Invented frame" },
					{ kind: "outro", durationSeconds: 3, headline: "Real frame" },
				],
			}),
			WITH_RECORDING,
		);
		expect(storyboard.frames).toHaveLength(2);
		expect(warnings.some((warning) => warning.includes("unknown frame kind"))).toBe(true);
	});

	it("caps the frame count and reports the truncation", () => {
		const frames = Array.from({ length: 40 }, (_, index) => ({
			kind: "statement",
			durationSeconds: 2,
			headline: `Point ${index + 1}`,
		}));
		const { storyboard, warnings } = normalizeStoryboard(draft({ frames }), WITH_RECORDING);
		expect(storyboard.frames.length).toBeLessThanOrEqual(LIMITS.maxFrames);
		expect(warnings.some((warning) => warning.includes("Kept the first"))).toBe(true);
	});

	it("substitutes text frames when no recording is attached", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "screen", durationSeconds: 5, headline: "Show the app" },
					{ kind: "split", durationSeconds: 5, headline: "Beside the app", bullets: ["One"] },
					{ kind: "outro", durationSeconds: 3, headline: "Done" },
				],
			}),
			{ hasRecording: false, fallbackTitle: "Demo" },
		);
		expect(storyboard.frames.map((frame) => frame.kind)).toEqual(["statement", "bullets", "outro"]);
		expect(warnings.filter((warning) => warning.includes("not attached"))).toHaveLength(2);
	});

	it("keeps an image frame whose asset was supplied", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{ kind: "image", durationSeconds: 5, headline: "Our logo", assetId: "asset-1" },
				],
			}),
			{ ...WITH_RECORDING, availableAssetIds: ["asset-1"] },
		);
		expect(storyboard.frames[1]).toMatchObject({ kind: "image", assetId: "asset-1" });
		expect(warnings).toEqual([]);
	});

	// A frame pointing at a file that never arrived would render an empty card,
	// so it becomes its text equivalent instead.
	it("degrades an image frame to text when the asset was never supplied", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{ kind: "image", durationSeconds: 5, headline: "Our logo", assetId: "asset-1" },
					{
						kind: "imageSplit",
						durationSeconds: 5,
						headline: "Beside it",
						bullets: ["A point"],
						assetId: "asset-2",
					},
				],
			}),
			{ ...WITH_RECORDING, availableAssetIds: [] },
		);
		expect(storyboard.frames.map((frame) => frame.kind)).toEqual(["title", "statement", "bullets"]);
		expect(storyboard.frames.every((frame) => frame.assetId === undefined)).toBe(true);
		expect(warnings.filter((warning) => warning.includes("not supplied"))).toHaveLength(2);
	});

	it("refuses an assetId the planner invented", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{ kind: "image", durationSeconds: 5, headline: "Chart", assetId: "../secret.png" },
				],
			}),
			{ ...WITH_RECORDING, availableAssetIds: ["asset-1"] },
		);
		expect(storyboard.frames[1]?.kind).toBe("statement");
		expect(storyboard.frames[1]?.assetId).toBeUndefined();
		expect(warnings.some((warning) => warning.includes("not supplied"))).toBe(true);
	});

	it("strips an assetId from a frame kind that cannot show one", () => {
		const { storyboard } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro", assetId: "asset-1" },
					{ kind: "outro", durationSeconds: 4, headline: "Done" },
				],
			}),
			{ ...WITH_RECORDING, availableAssetIds: ["asset-1"] },
		);
		expect(storyboard.frames[0]?.assetId).toBeUndefined();
	});

	it("clamps focus to a motion-safe, in-frame region", () => {
		const { storyboard } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{
						kind: "callout",
						durationSeconds: 5,
						headline: "Here",
						focus: { cx: 4.2, cy: -1, scale: 40 },
					},
				],
			}),
			WITH_RECORDING,
		);
		expect(storyboard.frames[1]?.focus).toEqual({
			cx: 1,
			cy: 0,
			scale: LIMITS.maxFocusScale,
		});
	});

	it("gives a callout without a target a centred default", () => {
		const { storyboard } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{ kind: "callout", durationSeconds: 5, headline: "Look here" },
				],
			}),
			WITH_RECORDING,
		);
		expect(storyboard.frames[1]?.focus).toEqual({ cx: 0.5, cy: 0.5, scale: 1.6 });
	});

	it("keeps recording playback moving forward", () => {
		const { storyboard } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "screen", durationSeconds: 4, headline: "A", sourceStartSeconds: 20 },
					{ kind: "screen", durationSeconds: 4, headline: "B", sourceStartSeconds: 5 },
					{ kind: "screen", durationSeconds: 4, headline: "C", sourceStartSeconds: 900 },
				],
			}),
			WITH_RECORDING,
		);
		const starts = storyboard.frames.map((frame) => frame.sourceStartSeconds);
		expect(starts).toEqual([20, 20, 60]);
	});

	it("drops a text frame that carries no words", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{ kind: "bullets", durationSeconds: 5 },
					{ kind: "outro", durationSeconds: 3, headline: "Done" },
				],
			}),
			WITH_RECORDING,
		);
		expect(storyboard.frames).toHaveLength(2);
		expect(warnings.some((warning) => warning.includes("needs a headline or bullets"))).toBe(true);
	});

	it("strips control characters and truncates overlong copy", () => {
		const { storyboard } = normalizeStoryboard(
			draft({
				frames: [
					{
						kind: "title",
						durationSeconds: 4,
						headline: "Clean\u0000this\u001bup   now",
						subhead: "x".repeat(500),
					},
					{ kind: "outro", durationSeconds: 3, headline: "Done" },
				],
			}),
			WITH_RECORDING,
		);
		expect(storyboard.frames[0]?.headline).toBe("Clean this up now");
		expect(storyboard.frames[0]?.subhead).toHaveLength(LIMITS.subhead);
	});

	it("falls back to indigo for an unknown accent", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			draft({ accent: "chartreuse" }),
			WITH_RECORDING,
		);
		expect(storyboard.accent).toBe("indigo");
		expect(warnings.some((warning) => warning.includes("chartreuse"))).toBe(true);
	});

	it("falls back to a deterministic storyboard when nothing is renderable", () => {
		const { storyboard, warnings } = normalizeStoryboard(
			{ title: "Broken", accent: "indigo", frames: [{ kind: "nope", durationSeconds: 3 }] },
			WITH_RECORDING,
		);
		expect(storyboard.frames.length).toBeGreaterThanOrEqual(LIMITS.minFrames);
		expect(warnings.some((warning) => warning.includes("unusable"))).toBe(true);
	});

	it("survives a response that is not an object at all", () => {
		const { storyboard, warnings } = normalizeStoryboard("I cannot help with that", {
			hasRecording: false,
			fallbackTitle: "Demo",
		});
		expect(storyboard.frames.length).toBeGreaterThanOrEqual(LIMITS.minFrames);
		expect(warnings.some((warning) => warning.includes("not a JSON object"))).toBe(true);
	});

	// The revision loop keys off warnings.length, so a clamp that stays silent
	// is a clamp the planner never gets a chance to fix.
	it("reports an out-of-range duration instead of clamping silently", () => {
		const { warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 900, headline: "Far too long" },
					{ kind: "outro", durationSeconds: 3, headline: "Done" },
				],
			}),
			WITH_RECORDING,
		);
		expect(warnings.some((warning) => warning.includes("durationSeconds was 900"))).toBe(true);
	});

	it("reports an out-of-range focus instead of clamping silently", () => {
		const { warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{
						kind: "callout",
						durationSeconds: 5,
						headline: "Here",
						focus: { cx: 3, cy: 0.5, scale: 9 },
					},
				],
			}),
			WITH_RECORDING,
		);
		expect(warnings.some((warning) => warning.includes("focus.scale was 9"))).toBe(true);
		expect(warnings.some((warning) => warning.includes("focus.cx was 3"))).toBe(true);
	});

	it("reports a backwards seek through the recording", () => {
		const { warnings } = normalizeStoryboard(
			draft({
				frames: [
					{ kind: "screen", durationSeconds: 4, headline: "A", sourceStartSeconds: 20 },
					{ kind: "screen", durationSeconds: 4, headline: "B", sourceStartSeconds: 5 },
				],
			}),
			WITH_RECORDING,
		);
		expect(warnings.some((warning) => warning.includes("went backwards"))).toBe(true);
	});

	it("does not warn about values the planner never supplied", () => {
		const { warnings } = normalizeStoryboard(
			{
				title: "Minimal",
				accent: "indigo",
				frames: [
					{ kind: "title", durationSeconds: 4, headline: "Intro" },
					{ kind: "outro", durationSeconds: 4, headline: "Done" },
				],
			},
			WITH_RECORDING,
		);
		expect(warnings).toEqual([]);
	});

	it("never exceeds the total length budget", () => {
		const frames = Array.from({ length: LIMITS.maxFrames }, () => ({
			kind: "statement",
			durationSeconds: LIMITS.maxFrameSeconds,
			headline: "Long frame",
		}));
		const { storyboard } = normalizeStoryboard(draft({ frames }), WITH_RECORDING);
		expect(storyboardDurationSeconds(storyboard)).toBeLessThanOrEqual(LIMITS.maxTotalSeconds);
	});
});

describe("parseStoryboardResponse", () => {
	it("reads plain JSON", () => {
		expect(parseStoryboardResponse('{"title":"A"}')).toEqual({ title: "A" });
	});

	it("reads fenced JSON", () => {
		expect(parseStoryboardResponse('```json\n{"title":"A"}\n```')).toEqual({ title: "A" });
	});

	it("recovers JSON wrapped in prose", () => {
		expect(parseStoryboardResponse('Sure! Here you go: {"title":"A"} Hope that helps.')).toEqual({
			title: "A",
		});
	});

	it("returns undefined when there is no JSON to read", () => {
		expect(parseStoryboardResponse("I cannot do that.")).toBeUndefined();
	});
});

describe("buildDeterministicStoryboard", () => {
	it("builds a walkthrough that fits inside the recording", () => {
		const storyboard = buildDeterministicStoryboard({
			request: "Show how to export a video",
			title: "Export demo",
			hasRecording: true,
			recordingSeconds: 24,
		});
		expect(storyboard.frames[0]?.kind).toBe("title");
		expect(storyboard.frames.at(-1)?.kind).toBe("outro");
		const lastStart = storyboard.frames
			.map((frame) => frame.sourceStartSeconds ?? 0)
			.reduce((maximum, value) => Math.max(maximum, value), 0);
		expect(lastStart).toBeLessThan(24);
	});

	// The planner needs an account, so an offline or signed-out run always gets
	// this storyboard. If it holds one framing throughout it reads as a static
	// screen capture, and a zoom centred at exactly (0.5, 0.5) is invisible
	// because it crops symmetrically.
	it("varies the framing so the offline demo is not static", () => {
		const storyboard = buildDeterministicStoryboard({
			request: "Show the export flow",
			title: "Export demo",
			hasRecording: true,
			recordingSeconds: 45,
		});
		const zoomed = storyboard.frames.filter((frame) => frame.focus);
		expect(zoomed.length).toBeGreaterThanOrEqual(2);

		for (const frame of zoomed) {
			const focus = frame.focus;
			if (!focus) throw new Error("expected focus");
			expect(focus.scale).toBeGreaterThan(1.5);
			expect(focus.scale).toBeLessThanOrEqual(LIMITS.maxFocusScale);
			// Off-centre, or the push reads as nothing happening.
			expect(Math.abs(focus.cx - 0.5) + Math.abs(focus.cy - 0.5)).toBeGreaterThan(0.05);
		}

		// Still opens wide, so the viewer sees the whole screen before a push.
		const firstRecordingFrame = storyboard.frames.find((frame) => frame.kind === "screen");
		expect(firstRecordingFrame?.focus).toBeUndefined();
	});

	it("uses only text frames when there is no recording", () => {
		const storyboard = buildDeterministicStoryboard({
			request: "Explain the pricing tiers",
			title: "Pricing",
			hasRecording: false,
		});
		expect(storyboard.frames.some((frame) => frame.kind === "screen")).toBe(false);
		expect(storyboard.frames.length).toBeGreaterThanOrEqual(LIMITS.minFrames);
	});
});

describe("storyboardSystemPrompt", () => {
	it("tells the planner what each supplied image actually contains", () => {
		const prompt = storyboardSystemPrompt({
			hasRecording: false,
			assets: [
				{
					id: "asset-1",
					label: "Company logo",
					kind: "logo",
					shows: "A blue wordmark on a transparent background.",
					text: ["Acme"],
				},
			],
		});
		expect(prompt).toContain('assetId "asset-1" (logo): Company logo');
		expect(prompt).toContain("shows: A blue wordmark on a transparent background.");
		expect(prompt).toContain("text in image: Acme");
	});

	it("omits the reading for an asset that has not been looked at", () => {
		const prompt = storyboardSystemPrompt({
			hasRecording: false,
			assets: [{ id: "asset-1", label: "Company logo", kind: "logo" }],
		});
		expect(prompt).toContain('assetId "asset-1" (logo): Company logo');
		expect(prompt).not.toContain("shows:");
	});

	it("forbids image frames outright when nothing was supplied", () => {
		const prompt = storyboardSystemPrompt({ hasRecording: true, assets: [] });
		expect(prompt).toContain("do not use image or imageSplit frames");
	});
});
