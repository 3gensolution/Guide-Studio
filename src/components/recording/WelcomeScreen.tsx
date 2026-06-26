import { Bot, Clapperboard, Film, FolderOpen, LogIn, PlayCircle } from "lucide-react";
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
		<div className="relative flex flex-col items-center justify-center h-screen gap-8 bg-[#09090b]">
			{gateDialog}

			<div className="flex flex-col items-center gap-3">
				<h1 className="text-2xl font-semibold text-white">Guide Studio</h1>
				<p className="text-sm text-white/40">AI-powered screen recording and editing</p>
			</div>
			<div className="flex flex-col gap-3 w-64">
				<button
					onClick={onNewRecording}
					className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#2563eb] hover:bg-[#2563eb]/90 text-white font-medium transition-colors"
				>
					<PlayCircle size={18} />
					New Recording
				</button>
				{onCreateVideo && (
					<button
						onClick={() => {
							if (checkFeature("scene-builder")) onCreateVideo();
						}}
						className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 font-medium transition-colors border border-[#2563eb]/30 hover:border-[#2563eb]/50"
					>
						<Clapperboard size={18} />
						Create Video
						{!isPro && <ProBadge />}
					</button>
				)}
				{onAiDemo && (
					<button
						onClick={async () => {
							if (!checkFeature("ai-demo-recorder")) return;
							if (!(await requireChatProvider("Generate AI Video"))) return;
							onAiDemo();
						}}
						className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 font-medium transition-colors border border-[#2563eb]/30 hover:border-[#2563eb]/50"
					>
						<Bot size={18} />
						Generate AI Video
						{!isPro && <ProBadge />}
					</button>
				)}
				<button
					onClick={onOpenVideo}
					className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 font-medium transition-colors border border-white/10"
				>
					<Film size={18} />
					Open Video File
				</button>
				<button
					onClick={onOpenProject}
					className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 font-medium transition-colors border border-white/10"
				>
					<FolderOpen size={18} />
					Open Project
				</button>
			</div>

			{/* Login nudge — shown when backend is available but user not authenticated */}
			{isBackendAvailable && !isAuthenticated && (
				<button
					onClick={showLogin}
					className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#2563eb]/10 hover:bg-[#2563eb]/20 border border-[#2563eb]/30 hover:border-[#2563eb]/50 text-xs text-white/80 transition-colors"
				>
					<LogIn size={12} className="text-[#2563eb]" />
					Sign in to unlock AI features
				</button>
			)}

			{/* Attribution */}
			<div className="absolute bottom-6 right-6 px-3 py-1 text-[10px] text-white/30">
				Guide Studio
			</div>
		</div>
	);
}
