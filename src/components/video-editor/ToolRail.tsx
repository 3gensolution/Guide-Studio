import {
	Crop,
	Layers,
	MessageSquare,
	MousePointerClick,
	Paintbrush,
	Settings2,
	Sparkles,
	Timer,
	Wand2,
} from "lucide-react";
import type { ComponentType } from "react";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import type { SettingsPanelMode } from "./SettingsPanel";

export type ToolRailTool = SettingsPanelMode | "crop" | "polish" | "ai" | "chat";

interface ToolRailProps {
	/** Currently open inspector tool, or null when the inspector is collapsed. */
	activeTool: ToolRailTool | null;
	onToolClick: (tool: ToolRailTool) => void;
	hasWebcam: boolean;
	showCursorTool: boolean;
	polishDisabled: boolean;
}

interface RailItem {
	id: ToolRailTool;
	label: string;
	icon: ComponentType<{ className?: string }>;
	disabled?: boolean;
	accent?: boolean;
}

export function ToolRail({
	activeTool,
	onToolClick,
	hasWebcam,
	showCursorTool,
	polishDisabled,
}: ToolRailProps) {
	const t = useScopedT("settings");

	const settingsItems: RailItem[] = [
		{ id: "background", label: t("background.title"), icon: Paintbrush },
		{ id: "effects", label: t("effects.title"), icon: Settings2 },
		{ id: "layout", label: t("layout.title"), icon: Layers, disabled: !hasWebcam },
		{ id: "timeline", label: t("timeline.title"), icon: Timer },
		...(showCursorTool
			? [{ id: "cursor" as const, label: "Cursor", icon: MousePointerClick }]
			: []),
		{ id: "crop", label: t("crop.cropVideo"), icon: Crop },
	];

	const aiItems: RailItem[] = [
		{ id: "polish", label: "Magic Polish", icon: Wand2, disabled: polishDisabled, accent: true },
		{ id: "ai", label: "AI Tools", icon: Sparkles, accent: true },
		{ id: "chat", label: "AI Chat", icon: MessageSquare, accent: true },
	];

	const renderItem = (item: RailItem) => {
		const Icon = item.icon;
		const isActive = activeTool === item.id;
		return (
			<Tooltip key={item.id} content={item.label} side="right">
				<button
					type="button"
					data-tour={`tool-${item.id}`}
					disabled={item.disabled}
					onClick={() => {
						if (item.disabled) return;
						onToolClick(item.id);
					}}
					className={cn(
						"flex h-9 w-9 items-center justify-center rounded-lg border transition-all",
						item.disabled
							? "cursor-not-allowed border-transparent text-white/15"
							: isActive
								? "border-[#6E6BFF]/50 bg-[#6E6BFF]/15 text-[#8B89FF]"
								: cn(
										"border-transparent hover:border-white/10 hover:bg-white/[0.06]",
										item.accent
											? "text-[#8B89FF]/70 hover:text-[#8B89FF]"
											: "text-white/45 hover:text-white/85",
									),
					)}
				>
					<Icon className="h-4 w-4" />
				</button>
			</Tooltip>
		);
	};

	return (
		<TooltipProvider delayDuration={150}>
			<div
				data-tour="tool-rail"
				className="editor-tool-rail flex h-full w-12 flex-shrink-0 flex-col items-center gap-1.5 py-3"
			>
				{settingsItems.map(renderItem)}
				<div className="my-1.5 h-px w-6 bg-white/[0.08]" />
				{aiItems.map(renderItem)}
			</div>
		</TooltipProvider>
	);
}
