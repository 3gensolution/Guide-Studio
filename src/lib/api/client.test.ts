import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "./client";

const AUTH_STORAGE_KEY = "guide_studio_auth";

afterEach(() => {
	localStorage.removeItem(AUTH_STORAGE_KEY);
});

describe("ApiClient authentication storage", () => {
	it("reads a session written by another renderer window", () => {
		const editorClient = new ApiClient({ baseUrl: "https://api.example.test" });
		const creatorClient = new ApiClient({ baseUrl: "https://api.example.test" });

		editorClient.setTokens({
			accessToken: "account-token",
			refreshToken: "refresh-token",
			expiresAt: Date.now() + 60_000,
		});

		expect(creatorClient.isAuthenticated()).toBe(true);
		expect(creatorClient.getAccessToken()).toBe("account-token");
	});

	it("clears a session when another renderer signs out", () => {
		const editorClient = new ApiClient({ baseUrl: "https://api.example.test" });
		const creatorClient = new ApiClient({ baseUrl: "https://api.example.test" });

		editorClient.setTokens({
			accessToken: "account-token",
			refreshToken: "refresh-token",
			expiresAt: Date.now() + 60_000,
		});
		expect(creatorClient.isAuthenticated()).toBe(true);

		editorClient.clearTokens();

		expect(creatorClient.isAuthenticated()).toBe(false);
		expect(creatorClient.getAccessToken()).toBeNull();
	});
});
