import { beforeEach, describe, expect, it, vi } from "vitest";

// aiService pulls in settings.ts, which needs Electron's app for the userData path.
vi.mock("electron", () => ({
	app: { getPath: () => "/tmp/guide-studio-test" },
}));

const { resolveEndpoint } = await import("./aiService");

beforeEach(() => {
	vi.clearAllMocks();
});

describe("resolveEndpoint", () => {
	it("uses each provider's own endpoint when nothing is overridden", () => {
		expect(resolveEndpoint("deepseek")).toBe("https://api.deepseek.com/v1/chat/completions");
		expect(resolveEndpoint("glm")).toBe("https://api.z.ai/api/paas/v4/chat/completions");
		expect(resolveEndpoint("qwen")).toBe(
			"https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
		);
	});

	it("completes a base URL copied from the provider's docs", () => {
		// Alibaba hands out a workspace domain as a base, not a full route.
		expect(
			resolveEndpoint("qwen", "https://ws-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"),
		).toBe("https://ws-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
		// Z.ai's China platform, with a stray trailing slash.
		expect(resolveEndpoint("glm", "https://open.bigmodel.cn/api/paas/v4/")).toBe(
			"https://open.bigmodel.cn/api/paas/v4/chat/completions",
		);
	});

	it("leaves a full chat-completions URL alone", () => {
		expect(resolveEndpoint("deepseek", "https://proxy.internal/v1/chat/completions")).toBe(
			"https://proxy.internal/v1/chat/completions",
		);
	});

	it("ignores anything that isn't an http(s) URL", () => {
		for (const bad of ["", "   ", "not a url", "file:///etc/passwd", "javascript:alert(1)"]) {
			expect(resolveEndpoint("glm", bad)).toBe("https://api.z.ai/api/paas/v4/chat/completions");
		}
	});
});
