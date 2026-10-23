import { describe, expect, it } from "vitest";
import { resolveCreatorRequest } from "./creatorRequest";

describe("video-only creator briefs", () => {
	it("keeps explicit direction authoritative", () => {
		expect(resolveCreatorRequest("  Show just the export workflow.  ", [{ kind: "video" }])).toBe(
			"Show just the export workflow.",
		);
	});

	it("accepts video without requiring a written brief", () => {
		const brief = resolveCreatorRequest(" \n", [{ kind: "video" }]);
		expect(brief).toContain("raw screen footage");
		expect(brief).toContain("editable scenes, headlines and motion graphics");
		expect(brief).toContain("Do not invent metrics");
	});

	it("rejects empty input and images alone", () => {
		expect(() => resolveCreatorRequest("", [])).toThrow("attach a video");
		expect(() => resolveCreatorRequest("", [{ kind: "image" }])).toThrow("attach a video");
	});
});
