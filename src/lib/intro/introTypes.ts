export interface IntroTemplate {
	id: string;
	name: string;
	description: string;
	category: "product-launch" | "tutorial" | "demo" | "brand-reveal" | "custom";
	defaultDurationMs: number;
	editableFields: IntroEditableField[];
}

export interface IntroEditableField {
	key: string;
	label: string;
	type: "text" | "color" | "select";
	defaultValue: string;
	options?: string[];
}

export interface IntroProjectConfig {
	templateId: string;
	fieldValues: Record<string, string>;
	durationMs: number;
}

export interface HyperframeConnection {
	status: "disconnected" | "connecting" | "connected";
	endpoint?: string;
	apiKey?: string;
}
