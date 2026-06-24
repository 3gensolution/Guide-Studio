// ── Guide Studio Design System ──────────────────────────────────────────
//
// Brand colors matching the Guide Studio logo gradient (Blue → Purple)

export const theme = {
	// Primary gradient colors (from logo)
	colors: {
		primary: {
			cyan: "#00B8FF",
			blue: "#0EA5E9",
			indigo: "#6366F1",
			purple: "#A855F7",
			violet: "#8B5CF6",
		},
		// Gradient definitions
		gradients: {
			primary: "linear-gradient(135deg, #00B8FF 0%, #A855F7 100%)",
			primaryHover: "linear-gradient(135deg, #0EA5E9 0%, #8B5CF6 100%)",
			subtle: "linear-gradient(135deg, rgba(0, 184, 255, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%)",
			border: "linear-gradient(135deg, rgba(0, 184, 255, 0.3) 0%, rgba(168, 85, 247, 0.3) 100%)",
		},
		// Semantic colors
		success: "#00B8FF",
		warning: "#F59E0B",
		error: "#EF4444",
		info: "#0EA5E9",
		// Neutral colors
		dark: {
			bg: "#09090b",
			surface: "#18181b",
			elevated: "#27272a",
			border: "#3f3f46",
		},
		light: {
			text: "#fafafa",
			textMuted: "#a1a1aa",
			textSubtle: "#71717a",
		},
	},
	// Shadows
	shadows: {
		primary: "0 0 20px rgba(0, 184, 255, 0.2), 0 0 40px rgba(168, 85, 247, 0.1)",
		primaryLg: "0 0 30px rgba(0, 184, 255, 0.3), 0 0 60px rgba(168, 85, 247, 0.2)",
		card: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
		cardHover: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
	},
	// Border radius
	radius: {
		sm: "0.5rem",
		md: "0.75rem",
		lg: "1rem",
		xl: "1.5rem",
		"2xl": "2rem",
		full: "9999px",
	},
	// Spacing
	spacing: {
		xs: "0.25rem",
		sm: "0.5rem",
		md: "1rem",
		lg: "1.5rem",
		xl: "2rem",
		"2xl": "3rem",
	},
	// Typography
	typography: {
		fontFamily: {
			sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
			mono: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
		},
		fontSize: {
			xs: "0.75rem",
			sm: "0.875rem",
			base: "1rem",
			lg: "1.125rem",
			xl: "1.25rem",
			"2xl": "1.5rem",
			"3xl": "1.875rem",
			"4xl": "2.25rem",
		},
		fontWeight: {
			normal: 400,
			medium: 500,
			semibold: 600,
			bold: 700,
		},
	},
} as const;

// CSS Custom Properties for global usage
export function applyThemeVariables() {
	if (typeof document === "undefined") return;

	const root = document.documentElement;

	// Colors
	root.style.setProperty("--color-primary-cyan", theme.colors.primary.cyan);
	root.style.setProperty("--color-primary-blue", theme.colors.primary.blue);
	root.style.setProperty("--color-primary-indigo", theme.colors.primary.indigo);
	root.style.setProperty("--color-primary-purple", theme.colors.primary.purple);
	root.style.setProperty("--color-primary-violet", theme.colors.primary.violet);

	// Gradients
	root.style.setProperty("--gradient-primary", theme.colors.gradients.primary);
	root.style.setProperty("--gradient-primary-hover", theme.colors.gradients.primaryHover);
	root.style.setProperty("--gradient-subtle", theme.colors.gradients.subtle);
	root.style.setProperty("--gradient-border", theme.colors.gradients.border);

	// Shadows
	root.style.setProperty("--shadow-primary", theme.shadows.primary);
	root.style.setProperty("--shadow-primary-lg", theme.shadows.primaryLg);
}

// Helper function to get gradient text classes
export function getGradientTextClass() {
	return "bg-gradient-to-r from-[#00B8FF] to-[#A855F7] bg-clip-text text-transparent";
}

// Helper function to get gradient background classes
export function getGradientBgClass() {
	return "bg-gradient-to-r from-[#00B8FF] to-[#A855F7]";
}

// Helper function to get gradient border classes
export function getGradientBorderClass() {
	return "border border-transparent bg-gradient-to-r from-[#00B8FF]/30 to-[#A855F7]/30 bg-clip-padding";
}
