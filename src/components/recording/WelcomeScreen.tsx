import type { LucideIcon } from "lucide-react";
import { Bot, Clapperboard, Film, FolderOpen, LogIn, PlayCircle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import guideLogo from "@/assets/guide-logo.svg";
import { ProBadge, useProGate } from "@/components/ui/ProGate";
import { useBackend } from "@/contexts/BackendContext";
import { useAIPreflight } from "@/hooks/useAIPreflight";

interface WelcomeScreenProps {
	onNewRecording: () => void;
	onOpenVideo: () => void;
	onOpenProject: () => void;
	onCreateVideo?: () => void;
	onAiDemo?: () => void;
}

function SidebarItem({
	icon: Icon,
	label,
	onClick,
}: {
	icon: LucideIcon;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white/80 hover:bg-white/[0.06] transition-colors w-full text-left"
		>
			<Icon size={16} />
			{label}
		</button>
	);
}

function ActionCard({
	icon: Icon,
	title,
	description,
	onClick,
	primary,
	badge,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	onClick: () => void;
	primary?: boolean;
	badge?: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex flex-col gap-2 p-5 rounded-2xl border transition-all text-left w-full ${
				primary
					? "bg-[#F59E0B]/10 border-[#F59E0B]/30 hover:bg-[#F59E0B]/20 hover:border-[#F59E0B]/50"
					: "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.12]"
			}`}
		>
			<div className="flex items-center gap-2">
				<Icon size={18} className={primary ? "text-[#F59E0B]" : "text-white/50"} />
				<span className={`font-medium ${primary ? "text-white" : "text-white/70"}`}>{title}</span>
				{badge}
			</div>
			{description && <p className="text-xs text-white/40">{description}</p>}
		</button>
	);
}

export function WelcomeScreen({
	onNewRecording,
	onOpenVideo,
	onOpenProject,
	onCreateVideo,
	onAiDemo,
}: WelcomeScreenProps) {
	const { isPro, checkFeature, gateDialog } = useProGate();
	const { requireChatProvider } = useAIPreflight();
	const { isBackendAvailable, isAuthenticated, showLogin } = useBackend();

	return (
		<div className="flex h-screen bg-[#1C1917]">
			{gateDialog}

			{/* Left Sidebar */}
			<aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-white/[0.06]">
				{/* Logo + Brand */}
				<div
					className="p-5 flex items-center gap-2.5"
					style={{ WebkitAppRegion: "drag" } as CSSProperties}
				>
					<img src={guideLogo} alt="Guide" className="w-8 h-8" />
					<span className="text-sm font-bold tracking-wider uppercase bg-gradient-to-r from-[#F59E0B] to-[#F97316] bg-clip-text text-transparent">
						Guide
					</span>
				</div>

				{/* Navigation items */}
				<nav className="flex flex-col gap-1 px-3 mt-2">
					<SidebarItem icon={Film} label="Open Video File" onClick={onOpenVideo} />
					<SidebarItem icon={FolderOpen} label="Open Project" onClick={onOpenProject} />
				</nav>

				{/* Spacer */}
				<div className="flex-1" />

				{/* Login nudge */}
				{isBackendAvailable && !isAuthenticated && (
					<div className="px-3 pb-3">
						<button
							type="button"
							onClick={showLogin}
							className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 border border-[#F59E0B]/30 hover:border-[#F59E0B]/50 text-xs text-white/80 transition-colors"
						>
							<LogIn size={12} className="text-[#F59E0B]" />
							Sign in to unlock AI features
						</button>
					</div>
				)}

				{/* Attribution */}
				<div className="px-4 pb-3 text-[10px] text-white/30">Guide Studio</div>
			</aside>

			{/* Main Content */}
			<main className="flex-1 flex flex-col items-center justify-center p-8">
				<div className="max-w-lg w-full">
					<h1 className="text-2xl font-semibold text-white mb-2">Welcome</h1>
					<p className="text-sm text-white/40 mb-8">AI-powered screen recording and editing</p>

					{/* Action cards grid */}
					<div className="grid grid-cols-2 gap-4">
						{/* Primary action — full width */}
						<div className="col-span-2">
							<ActionCard
								icon={PlayCircle}
								title="New Recording"
								description="Start a new screen recording"
								onClick={onNewRecording}
								primary
							/>
						</div>

						{/* Secondary actions */}
						{onCreateVideo && (
							<ActionCard
								icon={Clapperboard}
								title="Create Video"
								description="Build from scenes"
								onClick={() => {
									if (checkFeature("scene-builder")) onCreateVideo();
								}}
								badge={!isPro ? <ProBadge /> : undefined}
							/>
						)}

						{onAiDemo && (
							<ActionCard
								icon={Bot}
								title="AI Video"
								description="Generate with AI"
								onClick={async () => {
									if (!checkFeature("ai-demo-recorder")) return;
									if (!(await requireChatProvider("Generate AI Video"))) return;
									onAiDemo();
								}}
								badge={!isPro ? <ProBadge /> : undefined}
							/>
						)}
					</div>
				</div>
			</main>
		</div>
	);
}
