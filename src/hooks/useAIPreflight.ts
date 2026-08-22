import { useCallback } from "react";

// ── AI preflight ─────────────────────────────────────────────────────────
//
// Guard for AI-powered features. Guide Studio is local-only: AI runs through
// the Electron AI service (Ollama or the user's own provider key), so there
// is no account to check before a feature runs. The hook is kept so callers
// keep their "check before invoking" shape — a provider that is missing or
// misconfigured surfaces its own error from the IPC call itself.

export function useAIPreflight() {
	const requireChatProvider = useCallback(async (_featureLabel: string): Promise<boolean> => {
		return true;
	}, []);

	return {
		requireChatProvider,
	};
}
