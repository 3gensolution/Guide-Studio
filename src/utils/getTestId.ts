export type TestId =
	| `gif-size-button-${string}`
	| "export-button"
	| "export-panel-button"
	| "gif-format-button"
	| "gif-video-only-switch"
	| "mp4-format-button"
	| "return-to-welcome-button";

export function getTestId(testId: TestId) {
	return `testId-${testId}`;
}
