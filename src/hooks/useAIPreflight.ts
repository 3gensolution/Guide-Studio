import { useCallback, useEffect, useState } from "react";
import type { AIAvailability } from "@/lib/ai/types";
import { useBackend } from "@/contexts/BackendContext";

// ── AI preflight ─────────────────────────────────────────────────────────
//
// Reusable guard for AI-powered features. When a backend is available,
// checks backend authentication instead of local provider config.
// Consumers call `requireChatProvider("feature name")` before invoking an
// AI-dependent action — if it returns false, the feature MUST not proceed.

export function useAIPreflight() {
	const { isBackendAvailable, isAuthenticated, showLogin } = useBackend();
	const [availability, setAvailability] = useState<AIAvailability | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogMessage, setDialogMessage] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const a = await window.electronAPI.aiCheckAvailability();
			setAvailability(a);
			return a;
		} catch {
			return null;
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const requireChatProvider = useCallback(
		async (featureLabel: string): Promise<boolean> => {
			// When backend is available, use backend auth instead of local config
			if (isBackendAvailable) {
				if (isAuthenticated) return true;
				// Not logged in — show the login dialog
				showLogin();
				return false;
			}

			// Fallback: check local provider config (no backend)
			const current = availability ?? (await refresh());
			if (current?.activeProvider) return true;
			setDialogMessage(
				`${featureLabel} needs an AI provider. Add your OpenAI, Anthropic, Groq, or MiniMax API key to continue.`,
			);
			setDialogOpen(true);
			return false;
		},
		[isBackendAvailable, isAuthenticated, showLogin, availability, refresh],
	);

	const closeDialog = useCallback(() => {
		setDialogOpen(false);
		setDialogMessage(null);
		// After the user closes, refresh so the UI reflects any keys they saved.
		refresh();
	}, [refresh]);

	return {
		availability,
		refresh,
		requireChatProvider,
		dialogOpen,
		dialogMessage,
		closeDialog,
	};
}
