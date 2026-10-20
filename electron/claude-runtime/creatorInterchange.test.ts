import { describe, expect, it } from "vitest";
import type { CreatorSession } from "./creator";
import { buildCreatorFcpXml, buildCreatorProjectManifest } from "./creatorInterchange";

const SESSION = {
	id: "session-1",
	agent: "claude",
	request: "A launch film for <Guide>",
	format: "landscape",
	targetSeconds: 8,
	model: "opus",
	look: "motion",
	creativeSkill: "product-launch",
	visualSource: "generated",
	status: "rendered",
	createdAt: 1,
	videoPath: "/tmp/guide-launch.mp4",
	motion: {
		creativeSkill: "product-launch",
		title: "A launch film for <Guide>",
		accent: "indigo",
		scenes: [
			{ id: "one", kind: "image", durationSeconds: 3, headline: "The first step" },
			{ id: "two", kind: "logo", durationSeconds: 5, tagline: "Learn & ship" },
		],
	},
} as unknown as CreatorSession;

describe("creator interchange", () => {
	it("preserves the editable scene contract in the JSON companion", () => {
		const manifest = JSON.parse(buildCreatorProjectManifest(SESSION)) as {
			schema: string;
			scenes: Array<{ offsetSeconds: number; durationSeconds: number; kind: string }>;
		};
		expect(manifest.schema).toBe("guide-studio-creator-project");
		expect(manifest.scenes).toMatchObject([
			{ offsetSeconds: 0, durationSeconds: 3, kind: "image" },
			{ offsetSeconds: 3, durationSeconds: 5, kind: "logo" },
		]);
	});

	it("writes standards-shaped FCPXML with markers and safe XML escaping", () => {
		const xml = buildCreatorFcpXml(SESSION);
		expect(xml).toContain('<fcpxml version="1.9">');
		expect(xml).toContain("A launch film for &lt;Guide&gt;");
		expect(xml).toContain('<format id="r1"');
		expect(xml).toContain('<marker start="0s"');
		expect(xml).toContain('<marker start="3s"');
		expect(xml).toContain("Rec. 709");
	});
});
