export type TestId =
	| `gif-size-button-${string}`
	| "export-button"
	| "export-panel-button"
	| "gif-format-button"
	| "mp4-format-button";

export function getTestId(testId: TestId) {
	return `testId-${testId}`;
}
