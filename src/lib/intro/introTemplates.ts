import type { IntroTemplate } from "./introTypes";

export const INTRO_TEMPLATES: IntroTemplate[] = [
	{
		id: "product-launch",
		name: "Product Launch",
		description: "Bold product reveal with animated text and logo",
		category: "product-launch",
		defaultDurationMs: 5000,
		editableFields: [
			{
				key: "productName",
				label: "Product Name",
				type: "text",
				defaultValue: "Your Product",
			},
			{
				key: "tagline",
				label: "Tagline",
				type: "text",
				defaultValue: "The tagline goes here",
			},
			{
				key: "accentColor",
				label: "Brand Color",
				type: "color",
				defaultValue: "#2563eb",
			},
			{
				key: "background",
				label: "Background",
				type: "select",
				defaultValue: "brand-dark",
				options: ["brand-dark", "navy", "deep-purple", "charcoal"],
			},
		],
	},
	{
		id: "tutorial-intro",
		name: "Tutorial Intro",
		description: "Clean educational intro with title and topic",
		category: "tutorial",
		defaultDurationMs: 4000,
		editableFields: [
			{
				key: "title",
				label: "Tutorial Title",
				type: "text",
				defaultValue: "How to Get Started",
			},
			{
				key: "subtitle",
				label: "Subtitle",
				type: "text",
				defaultValue: "A step-by-step guide",
			},
			{
				key: "accentColor",
				label: "Accent Color",
				type: "color",
				defaultValue: "#10b981",
			},
			{
				key: "background",
				label: "Background",
				type: "select",
				defaultValue: "navy",
				options: ["navy", "slate", "gradient-blue", "gradient-green"],
			},
		],
	},
	{
		id: "demo-opening",
		name: "Demo Opening",
		description: "Dynamic cinematic opening for product demos",
		category: "demo",
		defaultDurationMs: 3000,
		editableFields: [
			{
				key: "headline",
				label: "Headline",
				type: "text",
				defaultValue: "Watch It in Action",
			},
			{
				key: "companyName",
				label: "Company Name",
				type: "text",
				defaultValue: "Your Company",
			},
			{
				key: "accentColor",
				label: "Accent Color",
				type: "color",
				defaultValue: "#8b5cf6",
			},
			{
				key: "background",
				label: "Background",
				type: "select",
				defaultValue: "deep-purple",
				options: ["deep-purple", "brand-dark", "charcoal", "gradient-purple"],
			},
		],
	},
	{
		id: "brand-reveal",
		name: "Brand Reveal",
		description: "Logo reveal with particle effects and brand colors",
		category: "brand-reveal",
		defaultDurationMs: 4000,
		editableFields: [
			{
				key: "brandName",
				label: "Brand Name",
				type: "text",
				defaultValue: "Your Brand",
			},
			{
				key: "slogan",
				label: "Slogan",
				type: "text",
				defaultValue: "Innovation starts here",
			},
			{
				key: "primaryColor",
				label: "Primary Color",
				type: "color",
				defaultValue: "#f59e0b",
			},
			{
				key: "background",
				label: "Background",
				type: "select",
				defaultValue: "charcoal",
				options: ["charcoal", "brand-dark", "navy", "deep-purple"],
			},
		],
	},
];
