import { useCallback } from "react";
import { toast } from "sonner";
import { openAISettings } from "@/lib/ai/aiSettingsBus";

// ── AI preflight ─────────────────────────────────────────────────────────
//
// Guard in front of AI-powered features. Guide Studio is local-only and runs
// on the user's own key: there is no account to check, but there *is* a
// provider to configure. When none is set up the feature would fail with a
// provider error deep inside the call, so check first and send the user
// straight to AI Settings instead.

export function useAIPreflight() {
	const requireChatProvider = useCallback(async (featureLabel: string): Promise<boolean> => {
		// Outside Electron (tests, storybook) there is nothing to check.
		if (!window.electronAPI?.aiCheckAvailability) return true;

		try {
			const availability = await window.electronAPI.aiCheckAvailability();
			if (availability?.activeProvider) return true;
		} catch {
			// Fall through to the prompt — a failed check is as good as no provider.
		}

		const message = `${featureLabel} needs an AI provider. Add your own API key — OpenAI, Anthropic, Groq, MiniMax or Kimi — or point Guide Studio at a local Ollama.`;
		toast.error(`${featureLabel} needs an AI provider`, {
			description: "Add your own API key in AI settings, or run a local Ollama.",
			action: {
				label: "Set up",
				onClick: () => openAISettings("chat", message),
			},
		});
		return false;
	}, []);

	return {
		requireChatProvider,
	};
}
