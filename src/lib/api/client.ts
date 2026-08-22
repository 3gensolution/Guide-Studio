// DORMANT — Guide Studio runs local-only. Nothing in the app constructs a
// request through this module any more: AI goes over Electron IPC to the
// local provider (see `src/lib/api/ai.ts`), and there is no account session.
// Kept for reference only.
// ── Guide Studio API Client ──────────────────────────────────────────────
//
// Backend API integration for Guide Studio
// Connects to your Docker backend for AI services and user management

export interface ApiConfig {
	baseUrl: string;
	apiKey?: string;
	timeout?: number;
}

export interface AuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

const AUTH_STORAGE_KEY = "guide_studio_auth";

class ApiClient {
	private config: ApiConfig;
	private tokens: AuthTokens | null = null;

	constructor(config: ApiConfig) {
		this.config = {
			timeout: 30000,
			...config,
		};
		this.loadTokensFromStorage();

		// Separate Electron windows each have their own ApiClient instance. Listen
		// for changes made by another window, such as a sign-in in the editor.
		if (typeof window !== "undefined") {
			window.addEventListener("storage", (event) => {
				if (event.key === AUTH_STORAGE_KEY) this.loadTokensFromStorage();
			});
		}
	}

	private loadTokensFromStorage() {
		try {
			const stored = localStorage.getItem(AUTH_STORAGE_KEY);
			if (stored) {
				this.tokens = JSON.parse(stored);
				// Check if token is expired
				if (this.tokens && this.tokens.expiresAt < Date.now()) {
					this.tokens = null;
					localStorage.removeItem(AUTH_STORAGE_KEY);
				}
			} else {
				this.tokens = null;
			}
		} catch (error) {
			this.tokens = null;
			console.error("[ApiClient] Failed to load tokens:", error);
		}
	}

	private saveTokensToStorage() {
		if (this.tokens) {
			localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.tokens));
		} else {
			localStorage.removeItem(AUTH_STORAGE_KEY);
		}
	}

	setTokens(tokens: AuthTokens) {
		this.tokens = tokens;
		this.saveTokensToStorage();
	}

	clearTokens() {
		this.tokens = null;
		this.saveTokensToStorage();
	}

	isAuthenticated(): boolean {
		this.loadTokensFromStorage();
		return this.tokens !== null && this.tokens.expiresAt > Date.now();
	}

	getAccessToken(): string | null {
		this.loadTokensFromStorage();
		return this.tokens?.accessToken || null;
	}

	getBaseUrl(): string {
		return this.config.baseUrl;
	}

	async request<T = unknown>(
		endpoint: string,
		options: RequestInit = {},
		timeoutMs?: number,
	): Promise<{ success: true; data: T } | { success: false; error: string }> {
		const url = `${this.config.baseUrl}${endpoint}`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...((options.headers as Record<string, string>) || {}),
		};

		// Add authentication
		if (this.tokens?.accessToken) {
			headers.Authorization = `Bearer ${this.tokens.accessToken}`;
		}

		// Add API key if configured
		if (this.config.apiKey) {
			headers["X-API-Key"] = this.config.apiKey;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? this.config.timeout);

			const response = await fetch(url, {
				...options,
				headers,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				// Handle token refresh on 401
				if (response.status === 401 && this.tokens?.refreshToken) {
					const refreshed = await this.refreshAccessToken();
					if (refreshed) {
						// Retry with new token
						return this.request(endpoint, options, timeoutMs);
					}
				}

				const error = await response.json().catch(() => ({ message: response.statusText }));
				return {
					success: false,
					error: error.message || `HTTP ${response.status}: ${response.statusText}`,
				};
			}

			const data = await response.json();
			return { success: true, data };
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "AbortError") {
					return { success: false, error: "Request timeout" };
				}
				return { success: false, error: error.message };
			}
			return { success: false, error: "Unknown error occurred" };
		}
	}

	async refreshAccessToken(): Promise<boolean> {
		if (!this.tokens?.refreshToken) return false;

		try {
			const response = await fetch(`${this.config.baseUrl}/auth/refresh`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refresh_token: this.tokens.refreshToken }),
			});

			if (!response.ok) {
				this.clearTokens();
				return false;
			}

			const data = await response.json();
			this.setTokens({
				accessToken: data.access_token,
				refreshToken: data.refresh_token || this.tokens.refreshToken,
				expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
			});

			return true;
		} catch (error) {
			console.error("[ApiClient] Token refresh failed:", error);
			this.clearTokens();
			return false;
		}
	}

	// Convenience methods
	get<T>(endpoint: string) {
		return this.request<T>(endpoint, { method: "GET" });
	}

	post<T>(endpoint: string, data: unknown, timeoutMs?: number) {
		return this.request<T>(
			endpoint,
			{
				method: "POST",
				body: JSON.stringify(data),
			},
			timeoutMs,
		);
	}

	put<T>(endpoint: string, data: unknown) {
		return this.request<T>(endpoint, {
			method: "PUT",
			body: JSON.stringify(data),
		});
	}

	patch<T>(endpoint: string, data: unknown) {
		return this.request<T>(endpoint, {
			method: "PATCH",
			body: JSON.stringify(data),
		});
	}

	delete<T>(endpoint: string) {
		return this.request<T>(endpoint, { method: "DELETE" });
	}
}

// Default API client instance
// Update baseUrl to your Docker backend URL
const defaultConfig: ApiConfig = {
	baseUrl: import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1",
	apiKey: import.meta.env.VITE_API_KEY,
};

export const apiClient = new ApiClient(defaultConfig);

// Export for custom instances
export { ApiClient };
