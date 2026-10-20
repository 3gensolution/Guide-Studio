import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "./client";

const AUTH_STORAGE_KEY = "guide_studio_auth";

beforeEach(() => {
	const store = new Map<string, string>();
	const stub = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, String(value)),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
	Object.defineProperty(globalThis, "localStorage", {
		value: stub,
		configurable: true,
	});
});

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
