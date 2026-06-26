import { useCallback } from "react";
import { useBackend } from "@/contexts/BackendContext";

// ── AI preflight ─────────────────────────────────────────────────────────
//
// Guard for AI-powered features. Checks backend authentication —
// all AI services run through the Docker backend.
// Consumers call `requireChatProvider("feature name")` before invoking an
// AI-dependent action — if it returns false, the feature MUST not proceed.

export function useAIPreflight() {
	const { isBackendAvailable, isAuthenticated, showLogin } = useBackend();

	const requireChatProvider = useCallback(
		async (_featureLabel: string): Promise<boolean> => {
			if (isBackendAvailable && isAuthenticated) return true;

			// Not logged in or backend unavailable — show the login dialog
			showLogin();
			return false;
		},
		[isBackendAvailable, isAuthenticated, showLogin],
	);

	return {
		requireChatProvider,
	};
}
