// ── Polish Templates API ─────────────────────────────────────────────────
//
// Fetches the account's Auto-Polish templates (intro card, narration voice +
// prompt, music, visual style) from the backend. Falls back to the built-in
// defaults when the user is signed out, offline, or the endpoint is not yet
// available — so Auto-Polish always has a recipe to run.

import {
	DEFAULT_POLISH_TEMPLATES,
	type PolishTemplate,
	type PolishTemplateSource,
} from "@/lib/ai/polishTemplates";
import { apiClient } from "./client";

export interface ResolvedPolishTemplates {
	templates: PolishTemplate[];
	/** Whether these came from the server or the built-in fallback. */
	source: PolishTemplateSource;
}

const POLISH_TEMPLATES_ENDPOINT = "/studio/ai/templates/polish";

/**
 * Resolve the polish templates to use. Attempts the server (which serves
 * branded/account templates) when authenticated; otherwise returns the
 * built-in defaults.
 */
export async function fetchPolishTemplates(): Promise<ResolvedPolishTemplates> {
	if (!apiClient.isAuthenticated()) {
		return { templates: DEFAULT_POLISH_TEMPLATES, source: "local" };
	}

	const result = await apiClient.get<{ templates: PolishTemplate[] }>(POLISH_TEMPLATES_ENDPOINT);

	if (result.success && Array.isArray(result.data?.templates) && result.data.templates.length > 0) {
		return { templates: result.data.templates, source: "server" };
	}

	// Endpoint missing / errored / empty — degrade gracefully to defaults.
	return { templates: DEFAULT_POLISH_TEMPLATES, source: "local" };
}
