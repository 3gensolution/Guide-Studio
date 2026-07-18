// ── Backend Context ──────────────────────────────────────────────────────
//
// Provides backend connectivity and authentication state to the app.
// The backend is the "AI brain" — only AI features (chat, image, whisper)
// go through it. Everything else stays local in Electron.

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LoginDialog } from "@/components/auth/LoginDialog";
import { authService, type User } from "@/lib/api/auth";

interface BackendContextValue {
	/** Whether the Docker backend is reachable */
	isBackendAvailable: boolean;
	/** Whether the user is authenticated with the backend */
	isAuthenticated: boolean;
	/** The authenticated user (null if not logged in) */
	user: User | null;
	/** Trigger the login dialog */
	showLogin: () => void;
	/** Log the user out */
	logout: () => Promise<void>;
}

const BackendContext = createContext<BackendContextValue>({
	isBackendAvailable: false,
	isAuthenticated: false,
	user: null,
	showLogin: () => {
		/* noop default */
	},
	logout: async () => {
		/* noop default */
	},
});

const HEALTH_URL = import.meta.env.VITE_HEALTH_URL || "http://localhost:8000/health";

export function BackendProvider({ children }: { children: ReactNode }) {
	const [isBackendAvailable, setIsBackendAvailable] = useState(false);
	const [user, setUser] = useState<User | null>(null);
	const [loginOpen, setLoginOpen] = useState(false);

	// Check backend health on mount
	useEffect(() => {
		let cancelled = false;

		async function checkHealth(): Promise<boolean> {
			let usable = false;
			try {
				const res = await fetch(HEALTH_URL, {
					method: "GET",
					signal: AbortSignal.timeout(5000),
				});
				// The gateway answers 503 "degraded" when ANY upstream is down,
				// including services the studio never calls (e.g. video-renderer).
				// Treat the backend as available as long as the gateway answers
				// and the services we actually use aren't reported unhealthy.
				if (res.ok) {
					usable = true;
				} else if (res.status === 503) {
					const body = await res.json().catch(() => null);
					const services = body?.services as
						| Record<string, { status?: string } | undefined>
						| undefined;
					const needed = ["core", "studio"];
					usable =
						body?.service === "gateway" &&
						needed.every((name) => services?.[name]?.status === "healthy");
				}
			} catch {
				usable = false;
			}
			if (!cancelled) setIsBackendAvailable(usable);
			return usable;
		}

		// The first probe often races editor startup (video decode, PIXI init)
		// and can miss its 5s timeout. Don't leave the UI "Offline" for the
		// whole 30s interval — retry quickly a few times until the first
		// success, then let the 30s cadence take over.
		let quickRetry: ReturnType<typeof setTimeout> | null = null;
		async function initialCheck(attemptsLeft: number) {
			const usable = await checkHealth();
			if (!cancelled && !usable && attemptsLeft > 0) {
				quickRetry = setTimeout(() => {
					quickRetry = null;
					void initialCheck(attemptsLeft - 1);
				}, 3_000);
			}
		}

		void initialCheck(5);
		// Re-check every 30s
		const interval = setInterval(checkHealth, 30_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
			if (quickRetry) clearTimeout(quickRetry);
		};
	}, []);

	// If backend is available and we have stored tokens, fetch the current user
	useEffect(() => {
		if (!isBackendAvailable) return;
		if (!authService.isAuthenticated()) return;

		authService.getCurrentUser().then((result) => {
			if (result.success) {
				setUser(result.user);
			} else {
				// Token expired or invalid
				setUser(null);
			}
		});
	}, [isBackendAvailable]);

	const showLogin = useCallback(() => {
		setLoginOpen(true);
	}, []);

	const logout = useCallback(async () => {
		try {
			await authService.logout();
		} catch {
			// Ignore logout errors
		}
		setUser(null);
	}, []);

	const handleLoginSuccess = useCallback((loggedInUser: User) => {
		setUser(loggedInUser);
		setLoginOpen(false);
	}, []);

	const value = useMemo<BackendContextValue>(
		() => ({
			isBackendAvailable,
			isAuthenticated: user !== null,
			user,
			showLogin,
			logout,
		}),
		[isBackendAvailable, user, showLogin, logout],
	);

	return (
		<BackendContext.Provider value={value}>
			{children}
			<LoginDialog
				isOpen={loginOpen}
				onClose={() => setLoginOpen(false)}
				onLoginSuccess={handleLoginSuccess}
			/>
		</BackendContext.Provider>
	);
}

export function useBackend() {
	return useContext(BackendContext);
}
