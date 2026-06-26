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

class ApiClient {
	private config: ApiConfig;
	private tokens: AuthTokens | null = null;

	constructor(config: ApiConfig) {
		this.config = {
			timeout: 30000,
			...config,
		};
		this.loadTokensFromStorage();
	}

	private loadTokensFromStorage() {
		try {
			const stored = localStorage.getItem("guide_studio_auth");
			if (stored) {
				this.tokens = JSON.parse(stored);
				// Check if token is expired
				if (this.tokens && this.tokens.expiresAt < Date.now()) {
					this.tokens = null;
					localStorage.removeItem("guide_studio_auth");
				}
			}
		} catch (error) {
			console.error("[ApiClient] Failed to load tokens:", error);
		}
	}

	private saveTokensToStorage() {
		if (this.tokens) {
			localStorage.setItem("guide_studio_auth", JSON.stringify(this.tokens));
		} else {
			localStorage.removeItem("guide_studio_auth");
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
		return this.tokens !== null && this.tokens.expiresAt > Date.now();
	}

	getAccessToken(): string | null {
		return this.tokens?.accessToken || null;
	}

	async request<T = unknown>(
		endpoint: string,
		options: RequestInit = {},
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
			const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

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
						return this.request(endpoint, options);
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

	post<T>(endpoint: string, data: unknown) {
		return this.request<T>(endpoint, {
			method: "POST",
			body: JSON.stringify(data),
		});
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
