import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearSessionMedia, initializeCreatorStore, listSessions } from "./creator";

let temporaryRoot: string | undefined;

afterEach(() => {
	if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
	temporaryRoot = undefined;
});

describe("creator session recovery", () => {
	it("restores a review session and drops paths outside its workspace", () => {
		temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guide-studio-creator-"));
		const sessionId = "session-recovery-1";
		const sessionRoot = path.join(temporaryRoot, sessionId);
		const previewPath = path.join(sessionRoot, "output", "preview", "frame-1.jpg");
		fs.mkdirSync(path.dirname(previewPath), { recursive: true });
		fs.writeFileSync(previewPath, "preview");

		fs.writeFileSync(
			path.join(temporaryRoot, "sessions.json"),
			JSON.stringify({
				version: 1,
				sessions: [
					{
						id: sessionId,
						agent: "claude",
						request: "A product update",
						format: "landscape",
						targetSeconds: 30,
						model: "",
						look: "cards",
						visualSource: "stock",
						status: "planned",
						createdAt: 1,
						storyboard: {
							title: "A product update",
							accent: "indigo",
							frames: [],
						},
						previewPaths: [
							{ frameIndex: 0, path: previewPath },
							{ frameIndex: 1, path: path.join(temporaryRoot, "outside.jpg") },
						],
					},
				],
			}),
			"utf8",
		);

		initializeCreatorStore(temporaryRoot);

		expect(listSessions()).toHaveLength(1);
		expect(listSessions()[0]?.previewPaths).toEqual([{ frameIndex: 0, path: previewPath }]);
	});

	it("clears saved previews and the rendered MP4 without deleting the plan", () => {
		temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guide-studio-creator-"));
		const sessionId = "session-clear-media-1";
		const sessionRoot = path.join(temporaryRoot, sessionId);
		const previewDir = path.join(sessionRoot, "output", "preview");
		const renderDir = path.join(sessionRoot, "render");
		const previewPath = path.join(previewDir, "scene-0.png");
		const videoPath = path.join(renderDir, "product.mp4");
		fs.mkdirSync(previewDir, { recursive: true });
		fs.mkdirSync(renderDir, { recursive: true });
		fs.writeFileSync(previewPath, "preview");
		fs.writeFileSync(videoPath, "video");
		fs.writeFileSync(
			path.join(temporaryRoot, "sessions.json"),
			JSON.stringify({
				version: 1,
				sessions: [
					{
						id: sessionId,
						agent: "claude",
						request: "A product launch",
						format: "landscape",
						targetSeconds: 30,
						model: "",
						look: "motion",
						visualSource: "generated",
						status: "rendered",
						createdAt: 1,
						motion: {
							title: "A product launch",
							accent: "indigo",
							scenes: [{ id: "scene-1", kind: "image", durationSeconds: 4 }],
						},
						previewPaths: [{ frameIndex: 0, path: previewPath }],
						videoPath,
					},
				],
			}),
			"utf8",
		);

		initializeCreatorStore(temporaryRoot);
		const cleared = clearSessionMedia(sessionId);

		expect(cleared.status).toBe("planned");
		expect(cleared.previewPaths).toBeUndefined();
		expect(cleared.videoPath).toBeUndefined();
		expect(cleared.shotReviews).toEqual([{ shotIndex: 0, status: "pending" }]);
		expect(cleared.motion?.title).toBe("A product launch");
		expect(fs.readdirSync(previewDir)).toEqual([]);
		expect(fs.readdirSync(renderDir)).toEqual([]);
	});
});
