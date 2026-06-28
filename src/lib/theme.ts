// ── Guide Studio Design System ──────────────────────────────────────────
//
// Brand colors: Warm & Modern palette (Amber → Coral → Red)

export const theme = {
	// Primary gradient colors (warm spectrum)
	colors: {
		primary: {
			amber: "#F59E0B",
			orange: "#F97316",
			coral: "#FB923C",
			red: "#EF4444",
			rose: "#F43F5E",
		},
		// Gradient definitions
		gradients: {
			primary: "linear-gradient(135deg, #FBBF24 0%, #EF4444 100%)",
			primaryHover: "linear-gradient(135deg, #F59E0B 0%, #DC2626 100%)",
			subtle: "linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(239, 68, 68, 0.1) 100%)",
			border: "linear-gradient(135deg, rgba(245, 158, 11, 0.3) 0%, rgba(239, 68, 68, 0.3) 100%)",
		},
		// Semantic colors
		success: "#22C55E",
		warning: "#F59E0B",
		error: "#EF4444",
		info: "#F97316",
		// Neutral colors (warm stone family)
		dark: {
			bg: "#1C1917",
			surface: "#292524",
			elevated: "#44403C",
			border: "#57534E",
		},
		light: {
			text: "#FAFAF9",
			textMuted: "#A8A29E",
			textSubtle: "#78716C",
		},
	},
	// Shadows (warm amber tints)
	shadows: {
		primary: "0 0 20px rgba(245, 158, 11, 0.2), 0 0 40px rgba(249, 115, 22, 0.1)",
		primaryLg: "0 0 30px rgba(245, 158, 11, 0.3), 0 0 60px rgba(249, 115, 22, 0.2)",
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
			sans: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
			mono: '"Fira Code", "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
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
	root.style.setProperty("--color-primary-amber", theme.colors.primary.amber);
	root.style.setProperty("--color-primary-orange", theme.colors.primary.orange);
	root.style.setProperty("--color-primary-coral", theme.colors.primary.coral);
	root.style.setProperty("--color-primary-red", theme.colors.primary.red);
	root.style.setProperty("--color-primary-rose", theme.colors.primary.rose);

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
	return "bg-gradient-to-r from-[#FBBF24] to-[#EF4444] bg-clip-text text-transparent";
}

// Helper function to get gradient background classes
export function getGradientBgClass() {
	return "bg-gradient-to-r from-[#FBBF24] to-[#EF4444]";
}

// Helper function to get gradient border classes
export function getGradientBorderClass() {
	return "border border-transparent bg-gradient-to-r from-[#FBBF24]/30 to-[#EF4444]/30 bg-clip-padding";
}
