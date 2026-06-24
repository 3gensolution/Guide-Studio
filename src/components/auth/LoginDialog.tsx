import { LogIn, Mail, Lock, User, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { authService, type User as UserType } from "@/lib/api/auth";
import { toast } from "sonner";

interface LoginDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onLoginSuccess: (user: UserType) => void;
}

export function LoginDialog({ isOpen, onClose, onLoginSuccess }: LoginDialogProps) {
	const [mode, setMode] = useState<"login" | "signup">("login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);

		try {
			if (mode === "login") {
				const result = await authService.login({ email, password });
				if (result.success) {
					toast.success("Welcome back!");
					onLoginSuccess(result.user);
					onClose();
				} else {
					toast.error(result.error);
				}
			} else {
				const result = await authService.signup({ email, password, name });
				if (result.success) {
					toast.success("Account created successfully!");
					onLoginSuccess(result.user);
					onClose();
				} else {
					toast.error(result.error);
				}
			}
		} catch (error) {
			toast.error("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="sm:max-w-md bg-gradient-to-b from-[#0a0a0f] to-[#070809] border border-white/10">
				<DialogHeader>
					<div className="flex items-center gap-3 mb-2">
						<div className="w-12 h-12 rounded-xl bg-gradient-to-r from-[#00B8FF]/20 to-[#A855F7]/20 border border-[#00B8FF]/30 flex items-center justify-center">
							<Sparkles className="w-6 h-6 text-[#00B8FF]" />
						</div>
						<div>
							<DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#00B8FF] to-[#A855F7] bg-clip-text text-transparent">
								{mode === "login" ? "Welcome Back" : "Create Account"}
							</DialogTitle>
							<DialogDescription className="text-white/60">
								{mode === "login"
									? "Sign in to access AI features"
									: "Get started with Guide Studio"}
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4 mt-4">
					{mode === "signup" && (
						<div className="space-y-2">
							<label className="text-sm font-medium text-white/80 flex items-center gap-2">
								<User size={14} />
								Full Name
							</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#00B8FF]/50 focus:ring-2 focus:ring-[#00B8FF]/20 transition-all"
								placeholder="John Doe"
								required
							/>
						</div>
					)}

					<div className="space-y-2">
						<label className="text-sm font-medium text-white/80 flex items-center gap-2">
							<Mail size={14} />
							Email
						</label>
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#00B8FF]/50 focus:ring-2 focus:ring-[#00B8FF]/20 transition-all"
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
							className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#00B8FF]/50 focus:ring-2 focus:ring-[#00B8FF]/20 transition-all"
							placeholder="••••••••"
							required
							minLength={8}
						/>
					</div>

					<Button
						type="submit"
						disabled={isLoading}
						className="w-full py-6 text-base font-semibold bg-gradient-to-r from-[#00B8FF] to-[#A855F7] hover:shadow-[0_0_30px_rgba(0,184,255,0.3)] transition-all duration-200"
					>
						<LogIn size={18} className="mr-2" />
						{isLoading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
					</Button>

					<div className="relative">
						<div className="absolute inset-0 flex items-center">
							<div className="w-full border-t border-white/10" />
						</div>
						<div className="relative flex justify-center text-xs">
							<span className="bg-[#070809] px-3 text-white/50">or</span>
						</div>
					</div>

					<button
						type="button"
						onClick={() => setMode(mode === "login" ? "signup" : "login")}
						className="w-full text-sm text-white/60 hover:text-white/90 transition-colors"
					>
						{mode === "login" ? (
							<>
								Don't have an account?{" "}
								<span className="text-[#00B8FF] font-medium">Sign up</span>
							</>
						) : (
							<>
								Already have an account?{" "}
								<span className="text-[#00B8FF] font-medium">Sign in</span>
							</>
						)}
					</button>
				</form>

				{/* Features list */}
				<div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
					<h4 className="text-sm font-semibold text-white/90 mb-3">With your account:</h4>
					<ul className="space-y-2 text-xs text-white/60">
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#00B8FF] to-[#A855F7]" />
							AI-powered video editing & narration
						</li>
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#00B8FF] to-[#A855F7]" />
							Auto-captions with speech-to-text
						</li>
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#00B8FF] to-[#A855F7]" />
							Music & sound effects generation
						</li>
						<li className="flex items-center gap-2">
							<div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#00B8FF] to-[#A855F7]" />
							Cloud sync & project backup
						</li>
					</ul>
				</div>
			</DialogContent>
		</Dialog>
	);
}
