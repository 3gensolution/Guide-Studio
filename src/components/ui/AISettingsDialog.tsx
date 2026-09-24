/**
 * AI Settings — where the user brings their own AI key.
 *
 * Guide Studio runs local-only: every AI request (chat, narration scripts,
 * publish kit, polish, image/music generation) goes out from this machine with
 * the key entered here. Keys live in the app's settings.json under the user's
 * app-data directory and are only ever sent to the provider they belong to.
 *
 * The main process keeps a key *per provider* (`aiApiKey_<provider>`), so the
 * user can fill in several and switch between them without losing any.
 */

import {
	Check,
	ExternalLink,
	Eye,
	EyeOff,
	Key,
	Loader2,
	Music,
	Settings,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type AISettingsTab, onOpenAISettings, openAISettings } from "@/lib/ai/aiSettingsBus";
import { AI_PROVIDERS, type AIProvider } from "@/lib/ai/types";

/** Where each provider hands out keys, plus what a key looks like. */
const PROVIDER_HELP: Record<AIProvider, { keyUrl: string; placeholder: string }> = {
	openai: { keyUrl: "https://platform.openai.com/api-keys", placeholder: "sk-…" },
	anthropic: {
		keyUrl: "https://console.anthropic.com/settings/keys",
		placeholder: "sk-ant-…",
	},
	groq: { keyUrl: "https://console.groq.com/keys", placeholder: "gsk_…" },
	minimax: {
		keyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
		placeholder: "eyJ…",
	},
	kimi: { keyUrl: "https://platform.moonshot.ai/console/api-keys", placeholder: "sk-…" },
	deepseek: { keyUrl: "https://platform.deepseek.com/api_keys", placeholder: "sk-…" },
	glm: { keyUrl: "https://z.ai/manage-apikey/apikey-list", placeholder: "…" },
	qwen: {
		keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=api#/api-key",
		placeholder: "sk-…",
	},
	ollama: { keyUrl: "https://ollama.com/download", placeholder: "" },
};

/** Shown under the endpoint override so the field is useful without the docs. */
const BASE_URL_HINTS: Partial<Record<AIProvider, string>> = {
	glm: "Leave empty for api.z.ai. China accounts: https://open.bigmodel.cn/api/paas/v4",
	qwen: "Leave empty for the shared Singapore host. Model Studio workspace domains go here.",
	deepseek: "Leave empty for api.deepseek.com.",
};

const ELEVENLABS_KEY_URL = "https://elevenlabs.io/app/settings/api-keys";

function openLink(url: string) {
	void window.electronAPI?.openExternalUrl?.(url);
}

/** Key field with a show/hide toggle — keys are secrets, but typos are common. */
function KeyInput({
	value,
	onChange,
	placeholder,
	label,
	hint,
	keyUrl,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	label: string;
	hint?: string;
	keyUrl: string;
}) {
	const [revealed, setRevealed] = useState(false);
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<span className="text-[11px] font-medium text-white/70">{label}</span>
				<button
					type="button"
					onClick={() => openLink(keyUrl)}
					className="ml-auto inline-flex items-center gap-1 text-[10px] text-[#6E6BFF] hover:text-[#8b89ff] transition-colors"
				>
					Get a key
					<ExternalLink size={10} />
				</button>
			</div>
			<div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 focus-within:border-[#6E6BFF]/50 transition-colors">
				<Key size={12} className="ml-2.5 flex-shrink-0 text-white/30" />
				<input
					type={revealed ? "text" : "password"}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					spellCheck={false}
					autoComplete="off"
					className="flex-1 bg-transparent py-2 text-xs text-white/90 placeholder:text-white/25 focus:outline-none"
				/>
				<button
					type="button"
					onClick={() => setRevealed((r) => !r)}
					className="mr-1.5 rounded-md p-1.5 text-white/30 hover:text-white/70 transition-colors"
					aria-label={revealed ? "Hide key" : "Show key"}
				>
					{revealed ? <EyeOff size={12} /> : <Eye size={12} />}
				</button>
			</div>
			{hint && <p className="text-[10px] leading-relaxed text-white/35">{hint}</p>}
		</div>
	);
}

interface AISettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialTab?: AISettingsTab;
	preflightMessage?: string | null;
}

export function AISettingsDialog({
	open,
	onOpenChange,
	initialTab = "chat",
	preflightMessage,
}: AISettingsDialogProps) {
	const [tab, setTab] = useState<AISettingsTab>(initialTab);
	const [provider, setProvider] = useState<AIProvider>("openai");
	// Keys and models are kept per provider so switching the picker below
	// doesn't discard what was typed for another one.
	const [keys, setKeys] = useState<Record<string, string>>({});
	const [models, setModels] = useState<Record<string, string>>({});
	// Optional endpoint override per provider (regional host, workspace domain, proxy).
	const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
	const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
	const [elevenLabsKey, setElevenLabsKey] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

	useEffect(() => {
		setTab(initialTab);
	}, [initialTab]);

	// Load what's already stored every time the dialog opens — another window
	// may have changed it.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		setTestResult(null);
		void (async () => {
			try {
				const [config, all, elevenLabs] = await Promise.all([
					window.electronAPI?.aiGetConfig?.(),
					window.electronAPI?.aiGetAllKeys?.(),
					window.electronAPI?.aiGetServiceKey?.("elevenlabs"),
				]);
				if (cancelled) return;
				if (config?.provider) setProvider(config.provider);
				if (config?.ollamaUrl) setOllamaUrl(config.ollamaUrl);
				setKeys(all?.keys ?? {});
				setModels(all?.models ?? {});
				setBaseUrls(all?.baseUrls ?? {});
				setElevenLabsKey(elevenLabs?.apiKey ?? "");
			} catch (error) {
				if (!cancelled) {
					toast.error("Couldn't read AI settings", {
						description: error instanceof Error ? error.message : String(error),
					});
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open]);

	const info = AI_PROVIDERS.find((p) => p.id === provider) ?? AI_PROVIDERS[0];
	const currentKey = keys[provider] ?? "";
	const currentModel = models[provider] ?? "";

	/** Write everything to the main process. Returns false when it failed. */
	const persist = useCallback(async (): Promise<boolean> => {
		try {
			// Per-provider keys first — these never change which provider is active.
			for (const p of AI_PROVIDERS) {
				await window.electronAPI?.aiSaveProviderKey?.(p.id, {
					// Ollama needs no key; only its model and endpoint.
					apiKey: p.requiresApiKey ? (keys[p.id] ?? "") : undefined,
					model: models[p.id] ?? "",
					baseUrl: p.supportsBaseUrl ? (baseUrls[p.id] ?? "") : undefined,
				});
			}
			// Then the active provider and the Ollama endpoint.
			await window.electronAPI?.aiSaveConfig?.({
				provider,
				model: models[provider] || info.defaultModel,
				apiKey: info.requiresApiKey ? (keys[provider] ?? "") : undefined,
				baseUrl: info.supportsBaseUrl ? (baseUrls[provider] ?? "") : undefined,
				ollamaUrl: ollamaUrl.trim() || "http://localhost:11434",
			});
			await window.electronAPI?.aiSaveServiceKey?.("elevenlabs", elevenLabsKey.trim());
			return true;
		} catch (error) {
			toast.error("Couldn't save AI settings", {
				description: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	}, [
		keys,
		models,
		baseUrls,
		provider,
		info.defaultModel,
		info.requiresApiKey,
		info.supportsBaseUrl,
		ollamaUrl,
		elevenLabsKey,
	]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		const ok = await persist();
		setSaving(false);
		if (!ok) return;
		toast.success(`AI is set up with ${info.name}`, {
			description: "Chat and every other AI feature now run on your key.",
		});
		onOpenChange(false);
	}, [persist, info.name, onOpenChange]);

	// Test uses the same path a real request takes: save, then send one tiny
	// prompt to the selected provider with its own key.
	const handleTest = useCallback(async () => {
		setTesting(true);
		setTestResult(null);
		const saved = await persist();
		if (!saved) {
			setTesting(false);
			return;
		}
		try {
			const result = await window.electronAPI?.aiAnalyze?.(
				"Reply with the single word: OK",
				undefined,
				{ provider, model: models[provider] || info.defaultModel },
			);
			if (result?.success) {
				setTestResult({
					ok: true,
					message: `${info.name} replied — you're good to go.`,
				});
			} else {
				setTestResult({ ok: false, message: result?.error ?? "No response from the provider." });
			}
		} catch (error) {
			setTestResult({
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setTesting(false);
		}
	}, [persist, provider, models, info.defaultModel, info.name]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl gap-0 border-white/10 bg-[#1C1917] p-0 text-white">
				{/* Header */}
				<div className="flex items-center gap-2.5 border-b border-white/5 px-5 py-4">
					<div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#6E6BFF]/30 bg-[#6E6BFF]/10">
						<Sparkles size={14} className="text-[#6E6BFF]" />
					</div>
					<div className="min-w-0">
						<DialogTitle className="text-sm font-medium text-white/90">AI settings</DialogTitle>
						<DialogDescription className="text-[11px] text-white/40">
							Bring your own key — it stays on this machine.
						</DialogDescription>
					</div>
				</div>

				{preflightMessage && (
					<div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
						<TriangleAlert size={12} className="mt-0.5 flex-shrink-0" />
						<span>{preflightMessage}</span>
					</div>
				)}

				{/* Tabs */}
				<div className="flex items-center gap-1 px-5 pt-4">
					{(
						[
							{ id: "chat" as const, label: "Chat & text", icon: Sparkles },
							{ id: "media" as const, label: "Voice & media", icon: Music },
						] satisfies Array<{ id: AISettingsTab; label: string; icon: typeof Sparkles }>
					).map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => setTab(id)}
							className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
								tab === id
									? "bg-[#6E6BFF]/15 text-[#6E6BFF]"
									: "text-white/45 hover:bg-white/5 hover:text-white/70"
							}`}
						>
							<Icon size={12} />
							{label}
						</button>
					))}
				</div>

				<div className="max-h-[52vh] overflow-y-auto px-5 py-4">
					{loading ? (
						<div className="flex items-center justify-center gap-2 py-10 text-xs text-white/40">
							<Loader2 size={13} className="animate-spin" />
							Reading your settings…
						</div>
					) : tab === "chat" ? (
						<div className="flex flex-col gap-4">
							{/* Provider picker */}
							<div className="flex flex-col gap-1.5">
								<span className="text-[11px] font-medium text-white/70">Provider</span>
								<div className="grid grid-cols-3 gap-1.5">
									{AI_PROVIDERS.map((p) => {
										const configured = p.id === "ollama" ? true : Boolean(keys[p.id]?.trim());
										return (
											<button
												key={p.id}
												type="button"
												onClick={() => {
													setProvider(p.id);
													setTestResult(null);
												}}
												className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium transition-all ${
													provider === p.id
														? "border-[#6E6BFF]/50 bg-[#6E6BFF]/15 text-white"
														: "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white/80"
												}`}
											>
												<span
													className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
														configured ? "bg-emerald-400" : "bg-white/20"
													}`}
												/>
												<span className="truncate">{p.name}</span>
											</button>
										);
									})}
								</div>
								<p className="text-[10px] leading-relaxed text-white/35">{info.description}</p>
							</div>

							{/* Key (cloud providers) or endpoint (Ollama) */}
							{info.requiresApiKey ? (
								<KeyInput
									label={`${info.name} API key`}
									value={currentKey}
									onChange={(value) => setKeys((prev) => ({ ...prev, [provider]: value }))}
									placeholder={PROVIDER_HELP[provider].placeholder}
									keyUrl={PROVIDER_HELP[provider].keyUrl}
									hint="Stored locally in settings.json and sent only to this provider. Usage is billed by them."
								/>
							) : (
								<div className="flex flex-col gap-1.5">
									<div className="flex items-center gap-2">
										<span className="text-[11px] font-medium text-white/70">Ollama endpoint</span>
										<button
											type="button"
											onClick={() => openLink(PROVIDER_HELP.ollama.keyUrl)}
											className="ml-auto inline-flex items-center gap-1 text-[10px] text-[#6E6BFF] hover:text-[#8b89ff] transition-colors"
										>
											Install Ollama
											<ExternalLink size={10} />
										</button>
									</div>
									<input
										value={ollamaUrl}
										onChange={(e) => setOllamaUrl(e.target.value)}
										spellCheck={false}
										className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/90 placeholder:text-white/25 focus:border-[#6E6BFF]/50 focus:outline-none"
										placeholder="http://localhost:11434"
									/>
									<p className="text-[10px] leading-relaxed text-white/35">
										No key needed — run <code className="text-white/50">ollama serve</code> and pull
										the model below.
									</p>
								</div>
							)}

							{/* Model */}
							<div className="flex flex-col gap-1.5">
								<span className="text-[11px] font-medium text-white/70">Model</span>
								<input
									list={`ai-models-${provider}`}
									value={currentModel}
									onChange={(e) => setModels((prev) => ({ ...prev, [provider]: e.target.value }))}
									spellCheck={false}
									placeholder={info.defaultModel}
									className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/90 placeholder:text-white/25 focus:border-[#6E6BFF]/50 focus:outline-none"
								/>
								<datalist id={`ai-models-${provider}`}>
									{info.models.map((model) => (
										<option key={model} value={model} />
									))}
								</datalist>
								<p className="text-[10px] leading-relaxed text-white/35">
									Leave empty for {info.defaultModel}. Any model id this provider accepts works.
								</p>
							</div>

							{/* Endpoint override — regional hosts (GLM in China), Model Studio
							    workspace domains, or a company proxy. */}
							{info.supportsBaseUrl && (
								<div className="flex flex-col gap-1.5">
									<span className="text-[11px] font-medium text-white/70">
										API base URL <span className="text-white/30">(optional)</span>
									</span>
									<input
										value={baseUrls[provider] ?? ""}
										onChange={(e) =>
											setBaseUrls((prev) => ({ ...prev, [provider]: e.target.value }))
										}
										spellCheck={false}
										placeholder="Provider default"
										className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/90 placeholder:text-white/25 focus:border-[#6E6BFF]/50 focus:outline-none"
									/>
									<p className="text-[10px] leading-relaxed text-white/35">
										{BASE_URL_HINTS[provider] ??
											"Point at a different host — a regional endpoint or a proxy that speaks the OpenAI API."}
									</p>
								</div>
							)}
						</div>
					) : (
						<div className="flex flex-col gap-4">
							<p className="text-[11px] leading-relaxed text-white/45">
								Narration, music, sound effects and generated images use your keys too. Each one is
								optional — skip it and that feature stays off.
							</p>

							<KeyInput
								label="ElevenLabs API key"
								value={elevenLabsKey}
								onChange={setElevenLabsKey}
								placeholder="sk_…"
								keyUrl={ELEVENLABS_KEY_URL}
								hint="Music beds and sound effects."
							/>

							<KeyInput
								label="MiniMax API key"
								value={keys.minimax ?? ""}
								onChange={(value) => setKeys((prev) => ({ ...prev, minimax: value }))}
								placeholder={PROVIDER_HELP.minimax.placeholder}
								keyUrl={PROVIDER_HELP.minimax.keyUrl}
								hint="Narration voices, generated images and music. Same key as the MiniMax chat provider."
							/>

							<KeyInput
								label="OpenAI API key"
								value={keys.openai ?? ""}
								onChange={(value) => setKeys((prev) => ({ ...prev, openai: value }))}
								placeholder={PROVIDER_HELP.openai.placeholder}
								keyUrl={PROVIDER_HELP.openai.keyUrl}
								hint="Doubles as the narration voice when MiniMax isn't set. Same key as the OpenAI chat provider."
							/>

							<div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-[10px] leading-relaxed text-white/40">
								No keys at all? Narration still works offline through local Piper voices, and
								captions are transcribed on-device by Whisper.
							</div>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center gap-2 border-t border-white/5 px-5 py-3.5">
					{testResult && (
						<span
							className={`flex min-w-0 items-center gap-1.5 text-[11px] ${
								testResult.ok ? "text-emerald-400" : "text-red-400"
							}`}
						>
							{testResult.ok ? (
								<Check size={12} className="flex-shrink-0" />
							) : (
								<TriangleAlert size={12} className="flex-shrink-0" />
							)}
							<span className="truncate">{testResult.message}</span>
						</span>
					)}
					<button
						type="button"
						onClick={() => void handleTest()}
						disabled={testing || saving || loading}
						className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{testing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
						Test connection
					</button>
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={saving || loading}
						className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#6E6BFF] px-3.5 py-2 text-[11px] font-medium text-white transition-colors hover:bg-[#6E6BFF]/90 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
						Save
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Mounts the dialog once per window and opens it whenever anything calls
 * `openAISettings()` — including the preflight guard in front of AI features.
 */
export function AISettingsHost() {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<AISettingsTab>("chat");
	const [message, setMessage] = useState<string | null>(null);

	useEffect(
		() =>
			onOpenAISettings(({ tab: nextTab, message: nextMessage }) => {
				setTab(nextTab);
				setMessage(nextMessage ?? null);
				setOpen(true);
			}),
		[],
	);

	// App menu → AI Settings… (⌘, on macOS).
	useEffect(() => {
		return window.electronAPI?.onMenuAISettings?.(() => {
			setMessage(null);
			setTab("chat");
			setOpen(true);
		});
	}, []);

	return (
		<AISettingsDialog
			open={open}
			onOpenChange={setOpen}
			initialTab={tab}
			preflightMessage={message}
		/>
	);
}

/** Gear that opens AI settings. */
interface AISettingsButtonProps {
	className?: string;
	size?: number;
	tab?: AISettingsTab;
}

export function AISettingsButton({ className, size = 14, tab = "chat" }: AISettingsButtonProps) {
	return (
		<button
			type="button"
			onClick={() => openAISettings(tab)}
			className={
				className ??
				"rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
			}
			title="AI settings — use your own API key"
			aria-label="AI settings"
		>
			<Settings size={size} />
		</button>
	);
}
