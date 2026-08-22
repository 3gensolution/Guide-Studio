// DORMANT — Guide Studio runs local-only. Nothing in the app constructs a
// request through this module any more: AI goes over Electron IPC to the
// local provider (see `src/lib/api/ai.ts`), and there is no account session.
// Kept for reference only.
// ── Authentication Service ──────────────────────────────────────────────
//
// Handles user authentication and session management
// Adapted to match the Docker backend (GuideAI) API contracts

import { apiClient } from "./client";

export interface User {
	id: string;
	email: string;
	name: string;
	role: string;
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
	company_name: string;
}

// Backend response types (snake_case)
interface BackendTokenResponse {
	access_token: string;
	refresh_token: string;
	token_type: string;
}

interface BackendUserResponse {
	id: string;
	email: string;
	name: string;
	role: string;
	organization_id: string | null;
	is_active: boolean;
	created_at: string;
}

function mapBackendUser(data: BackendUserResponse): User {
	return {
		id: data.id,
		email: data.email,
		name: data.name,
		role: data.role,
		plan: data.role === "super_admin" ? "enterprise" : "free",
		createdAt: data.created_at,
	};
}

export class AuthService {
	async login(
		credentials: LoginCredentials,
	): Promise<{ success: true; user: User } | { success: false; error: string }> {
		// Backend returns { access_token, refresh_token, token_type } — no user object
		const result = await apiClient.post<BackendTokenResponse>("/auth/login", credentials);

		if (!result.success) {
			return result;
		}

		// Save tokens from snake_case response
		apiClient.setTokens({
			accessToken: result.data.access_token,
			refreshToken: result.data.refresh_token,
			expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
		});

		// Fetch the user profile separately
		const userResult = await this.getCurrentUser();
		if (!userResult.success) {
			return userResult;
		}

		return {
			success: true,
			user: userResult.user,
		};
	}

	async signup(
		data: SignupData,
	): Promise<{ success: true; message: string } | { success: false; error: string }> {
		// Backend register returns { message, email, requires_approval } — no tokens
		const result = await apiClient.post<{
			message: string;
			email: string;
			requires_approval: boolean;
		}>("/auth/register", {
			email: data.email,
			password: data.password,
			name: data.name,
			company_name: data.company_name,
		});

		if (!result.success) {
			return result;
		}

		return {
			success: true,
			message: result.data.message,
		};
	}

	async logout(): Promise<void> {
		// Backend doesn't have a logout endpoint — just clear local tokens
		apiClient.clearTokens();
	}

	async getCurrentUser(): Promise<
		{ success: true; user: User } | { success: false; error: string }
	> {
		const result = await apiClient.get<BackendUserResponse>("/auth/me");
		if (!result.success) return result;
		return { success: true, user: mapBackendUser(result.data) };
	}

	async updateProfile(
		data: Partial<Pick<User, "name" | "email">>,
	): Promise<{ success: true; user: User } | { success: false; error: string }> {
		const result = await apiClient.patch<BackendUserResponse>("/auth/me", data);
		if (!result.success) return result;
		return { success: true, user: mapBackendUser(result.data) };
	}

	async changePassword(
		currentPassword: string,
		newPassword: string,
	): Promise<{ success: true } | { success: false; error: string }> {
		return apiClient.post("/auth/me/password", {
			current_password: currentPassword,
			new_password: newPassword,
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
