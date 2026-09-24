// ── AI settings bus ──────────────────────────────────────────────────────
//
// Anything that needs an AI provider (chat, narration, publish kit, …) can ask
// for the settings dialog without threading props through the editor tree, and
// without a provider/context wrapper — the dialog host subscribes here and every
// window that mounts <AISettingsHost /> gets it.

export type AISettingsTab = "chat" | "media";

export interface AISettingsRequest {
	tab: AISettingsTab;
	/** Why the dialog opened, e.g. "AI Chat needs a provider." Shown as a banner. */
	message?: string;
}

type Listener = (request: AISettingsRequest) => void;

const listeners = new Set<Listener>();

/** Open the AI settings dialog. No-op when no host is mounted. */
export function openAISettings(tab: AISettingsTab = "chat", message?: string): void {
	for (const listener of listeners) listener({ tab, message });
}

/** Subscribe a dialog host. Returns the unsubscribe function. */
export function onOpenAISettings(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
