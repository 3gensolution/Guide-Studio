import { describe, expect, it } from "vitest";
import { renderGuideHtml, renderGuideMarkdown } from "./guideDocExporter";
import type { GuideDoc } from "./types";

const doc: GuideDoc = {
	title: 'Export a video <with> "quotes"',
	intro: "How to export from Guide Studio.",
	createdAt: 1_750_000_000_000,
	durationMs: 95_000,
	steps: [
		{
			id: "step-1",
			index: 1,
			timeMs: 12_000,
			cx: 0.5,
			cy: 0.5,
			action: "click",
			title: "Step 1: Open the Export dialog",
			description: "Click the Export button in the toolbar.",
			transcript: "",
			screenshotDataUrl: "data:image/jpeg;base64,abc123",
		},
		{
			id: "step-2",
			index: 2,
			timeMs: 40_000,
			cx: 0.2,
			cy: 0.8,
			action: "click",
			title: "Step 2: Choose MP4",
			description: "",
			transcript: "",
			// no screenshot — capture failed for this step
		},
	],
};

describe("renderGuideHtml", () => {
	it("produces a self-contained document with escaped title and all steps", () => {
		const html = renderGuideHtml(doc);
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("Export a video &lt;with&gt; &quot;quotes&quot;");
		expect(html).toContain("Step 1: Open the Export dialog");
		expect(html).toContain("data:image/jpeg;base64,abc123");
		expect(html).toContain("2 steps");
		expect(html).toContain("1:35"); // duration
		// No external asset references — must open offline
		expect(html).not.toMatch(/src="https?:/);
		expect(html).not.toMatch(/href="https?:/);
	});

	it("omits the img tag for steps without screenshots", () => {
		const html = renderGuideHtml(doc);
		const imgCount = (html.match(/<img/g) ?? []).length;
		expect(imgCount).toBe(1);
	});
});

describe("renderGuideMarkdown", () => {
	it("renders headings, timestamps, and embedded screenshots", () => {
		const md = renderGuideMarkdown(doc);
		expect(md).toContain('# Export a video <with> "quotes"');
		expect(md).toContain("## Step 1: Open the Export dialog");
		expect(md).toContain("*At 0:12*");
		expect(md).toContain("![Step 1](data:image/jpeg;base64,abc123)");
		expect(md).toContain("Click the Export button in the toolbar.");
	});
});
