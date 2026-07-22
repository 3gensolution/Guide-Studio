/**
 * Persistence for the first-run editor onboarding tour.
 *
 * Mirrors the "seen once" localStorage pattern used elsewhere in the app
 * (see SYSTEM_LANGUAGE_PROMPT_SEEN_KEY in I18nContext). All keys are prefixed
 * with `guide-studio-` to match the established convention.
 */

const TOUR_SEEN_KEY = "guide-studio-tour-seen";

/** Whether the user has already been shown (or dismissed) the editor tour. */
export function hasSeenEditorTour(): boolean {
	try {
		return window.localStorage.getItem(TOUR_SEEN_KEY) === "1";
	} catch {
		// Storage can throw in private mode / sandboxed contexts — treat as seen
		// so we never trap the user in a tour that keeps reappearing.
		return true;
	}
}

/** Record that the tour has been shown so it never auto-starts again. */
export function markEditorTourSeen(): void {
	try {
		window.localStorage.setItem(TOUR_SEEN_KEY, "1");
	} catch {
		// Non-fatal: worst case the tour offers itself again next launch.
	}
}

/** Clear the flag (used for "show the tour again" / debugging). */
export function resetEditorTourSeen(): void {
	try {
		window.localStorage.removeItem(TOUR_SEEN_KEY);
	} catch {
		// Non-fatal.
	}
}
