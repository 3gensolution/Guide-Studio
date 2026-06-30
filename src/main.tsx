import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { I18nProvider } from "./contexts/I18nContext";
import "./index.css";

// ── Error boundary to surface runtime crashes instead of a blank screen ──
class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[RootErrorBoundary] Uncaught error:", error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return (
				<div
					style={{
						padding: 32,
						color: "#f87171",
						background: "#1C1917",
						fontFamily: "monospace",
						minHeight: "100vh",
					}}
				>
					<h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
					<pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#fbbf24" }}>
						{this.state.error.message}
					</pre>
					<pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#a1a1aa", marginTop: 8 }}>
						{this.state.error.stack}
					</pre>
				</div>
			);
		}
		return this.props.children;
	}
}

const windowType = new URLSearchParams(window.location.search).get("windowType") || "";
if (
	windowType === "hud-overlay" ||
	windowType === "source-selector" ||
	windowType === "countdown-overlay"
) {
	document.body.style.background = "transparent";
	document.documentElement.style.background = "transparent";
	document.getElementById("root")?.style.setProperty("background", "transparent");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<RootErrorBoundary>
			<I18nProvider>
				<App />
			</I18nProvider>
		</RootErrorBoundary>
	</React.StrictMode>,
);
