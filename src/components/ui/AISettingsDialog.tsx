/**
 * AI Settings Dialog — stub.
 *
 * AI providers and API keys are managed by the Docker backend.
 * This file keeps the export signatures so existing imports don't break,
 * but the dialog itself is a no-op (all AI config lives server-side).
 */

import { Settings } from "lucide-react";

interface AISettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialTab?: string;
	preflightMessage?: string | null;
}

export function AISettingsDialog({ open, onOpenChange }: AISettingsDialogProps) {
	// No-op: AI configuration is handled by the backend
	if (open) onOpenChange(false);
	return null;
}

// Trigger button — kept for backwards compat but hidden
interface AISettingsButtonProps {
	className?: string;
	size?: number;
}

export function AISettingsButton({ className, size = 14 }: AISettingsButtonProps) {
	return (
		<button
			type="button"
			className={
				className ??
				"p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-md hover:bg-white/5"
			}
			title="AI Settings"
			style={{ display: "none" }}
		>
			<Settings size={size} />
		</button>
	);
}
