// ── Authentication Service ──────────────────────────────────────────────
//
// Handles user authentication and session management

import { apiClient, type AuthTokens } from "./client";

export interface User {
	id: string;
	email: string;
	name: string;
	avatarUrl?: string;
	plan: "free" | "pro" | "enterprise";
	createdAt: string;
}

export interface LoginCredentials {
	email: string;
	password: string;
}

export interface SignupData extends LoginCredentials {
	name: string;
}

export class AuthService {
	async login(
		credentials: LoginCredentials,
	): Promise<{ success: true; user: User } | { success: false; error: string }> {
		const result = await apiClient.post<{ user: User; tokens: AuthTokens }>("/auth/login", credentials);

		if (!result.success) {
			return result;
		}

		// Save tokens
		apiClient.setTokens(result.data.tokens);

		return {
			success: true,
			user: result.data.user,
		};
	}

	async signup(
		data: SignupData,
	): Promise<{ success: true; user: User } | { success: false; error: string }> {
		const result = await apiClient.post<{ user: User; tokens: AuthTokens }>("/auth/signup", data);

		if (!result.success) {
			return result;
		}

		// Save tokens
		apiClient.setTokens(result.data.tokens);

		return {
			success: true,
			user: result.data.user,
		};
	}

	async logout(): Promise<void> {
		await apiClient.post("/auth/logout", {});
		apiClient.clearTokens();
	}

	async getCurrentUser(): Promise<{ success: true; user: User } | { success: false; error: string }> {
		const result = await apiClient.get<User>("/auth/me");
		if (!result.success) return result;
		return { success: true, user: result.data };
	}

	async updateProfile(
		data: Partial<Pick<User, "name" | "avatarUrl">>,
	): Promise<{ success: true; user: User } | { success: false; error: string }> {
		const result = await apiClient.put<User>("/auth/profile", data);
		if (!result.success) return result;
		return { success: true, user: result.data };
	}

	async changePassword(
		currentPassword: string,
		newPassword: string,
	): Promise<{ success: true } | { success: false; error: string }> {
		return apiClient.post("/auth/change-password", {
			currentPassword,
			newPassword,
		});
	}

	isAuthenticated(): boolean {
		return apiClient.isAuthenticated();
	}

	getAccessToken(): string | null {
		return apiClient.getAccessToken();
	}
}

export const authService = new AuthService();
