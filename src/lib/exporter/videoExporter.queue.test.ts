import { describe, expect, it } from "vitest";
import { getDefaultMaxEncodeQueue } from "./videoExporter";

describe("getDefaultMaxEncodeQueue", () => {
	it("keeps queued frames within a memory budget at high resolutions", () => {
		const queue = getDefaultMaxEncodeQueue(3840, 2160);
		expect(queue * 3840 * 2160 * 4).toBeLessThanOrEqual(256 * 1024 * 1024);
		expect(queue).toBeGreaterThanOrEqual(4);
	});

	it("caps small exports at a modest depth", () => {
		expect(getDefaultMaxEncodeQueue(640, 360)).toBe(32);
	});
});
