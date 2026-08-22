// ── Small JSON helpers ───────────────────────────────────────────────────
//
// The storyboard contract is the boundary between Claude's output and our
// renderer, so everything crossing it is treated as unknown until proven
// otherwise. These two helpers are all that boundary needs.

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The subset of JSON Schema the storyboard contract is expressed in. */
export interface JsonSchema {
	type: "object" | "array" | "string" | "number" | "boolean";
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	enum?: readonly (string | number | boolean)[];
	additionalProperties?: boolean;
}
