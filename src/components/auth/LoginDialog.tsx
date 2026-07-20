import { Lock, LogIn, Mail, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { authService, type User as UserType } from "@/lib/api/auth";

interface LoginDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onLoginSuccess: (user: UserType) => void;
}

export function LoginDialog({ isOpen, onClose, onLoginSuccess }: LoginDialogProps) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);

		try {
			const result = await authService.login({ email, password });
			if (result.success) {
				toast.success("Welcome back!");
				onLoginSuccess(result.user);
				onClose();
			} else {
				toast.error(result.error);
			}
		} catch (_error) {
			toast.error("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="sm:max-w-md bg-gradient-to-b from-[#1C1917] to-[#070809] border border-white/10">
				<DialogHeader>
					<div className="flex items-center gap-3 mb-2">
						<div className="w-12 h-12 rounded-xl bg-gradient-to-r from-[#6E6BFF]/20 to-[#22D3EE]/20 border border-[#6E6BFF]/30 flex items-center justify-center">
							<Sparkles className="w-6 h-6 text-[#6E6BFF]" />
						</div>
						<div>
							<DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#6E6BFF] to-[#22D3EE] bg-clip-text text-transparent">
								Welcome Back
							</DialogTitle>
							<DialogDescription className="text-white/60">
								Sign in to access AI features
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4 mt-4">
					<div className="space-y-2">
						<label className="text-sm font-medium text-white/80 flex items-center gap-2">
							<Mail size={14} />
							Email
						</label>
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#6E6BFF]/50 focus:ring-2 focus:ring-[#6E6BFF]/20 transition-all"
							placeholder="you@example.com"
							required
						/>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium text-white/80 flex items-center gap-2">
							<Lock size={14} />
							Password
						</label>
						<input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#6E6BFF]/50 focus:ring-2 focus:ring-[#6E6BFF]/20 transition-all"
							placeholder="••••••••"
							required
							minLength={8}
						/>
					</div>

					<Button
						type="submit"
						disabled={isLoading}
						className="w-full py-6 text-base font-semibold bg-gradient-to-r from-[#6E6BFF] to-[#22D3EE] hover:shadow-[0_0_30px_rgba(168,85,247,0.3)] transition-all duration-200"
					>
						<LogIn size={18} className="mr-2" />
						{isLoading ? "Please wait..." : "Sign In"}
					</Button>
				</form>

				{/* Features list */}
				<div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
					<h4 className="text-sm font-semibold text-white/90 mb-3">With your account:</h4>
					<ul className="space-y-2 text-xs text-white/60">
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#6E6BFF] to-[#22D3EE]" />
							AI-powered video editing & narration
						</li>
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#6E6BFF] to-[#22D3EE]" />
							Auto-captions with speech-to-text
						</li>
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#6E6BFF] to-[#22D3EE]" />
							Music & sound effects generation
						</li>
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#6E6BFF] to-[#22D3EE]" />
							Cloud sync & project backup
						</li>
					</ul>
				</div>
			</DialogContent>
		</Dialog>
	);
}
