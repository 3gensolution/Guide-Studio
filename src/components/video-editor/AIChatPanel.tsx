/**
 * AIChatPanel — agentic AI assistant for the editor's AI panel.
 *
 * The assistant can *drive the editor* (open Auto Captions, run Magic Polish,
 * switch panels, export, …) by emitting a small JSON tool-call that this panel
 * parses and dispatches to the real editor handlers passed in via `editTools`.
 *
 * Model routing: the chat runs on whatever provider and model the user set up
 * in AI Settings, with their own API key (or a local Ollama). Nothing here
 * talks to a Guide Studio server — `aiService.chatCompletion` goes over IPC to
 * the local AI service, which calls the provider directly.
 *
 * The tool protocol is prompt-based (JSON in the text response) rather than
 * native function-calling, because the local chat call returns plain text
 * (`{ content }`) — this keeps every provider on the same path.
 */
import { Bot, CornerDownLeft, Key, Loader2, User, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AISettingsButton } from "@/components/ui/AISettingsDialog";
import { useAIPreflight } from "@/hooks/useAIPreflight";
import { openAISettings } from "@/lib/ai/aiSettingsBus";
import { aiService, type ChatMessage } from "@/lib/api/ai";

/** A single editor action the assistant is allowed to invoke. */
export interface EditTool {
	/** snake_case identifier the model emits as `action`. */
	name: string;
	/** One-line description of what the tool does (shown to the model). */
	description: string;
	/** Human-readable label shown in the chat when the tool runs. */
	label: string;
	/** Argument hints for the model: name → description. Omit for no-arg tools. */
	args?: Record<string, string>;
	/** Execute the tool. Return a short confirmation shown back to the user. */
	run: (args: Record<string, unknown>) => string | Promise<string>;
}

type DisplayMessage =
	| { role: "user" | "assistant"; content: string }
	| { role: "tool"; content: string };

interface ToolCall {
	action: string;
	args?: Record<string, unknown>;
	message?: string;
}

/** Qwen 3 (and other reasoning models) prepend a chain-of-thought in
 *  <think>…</think>. Strip it so it neither reaches the user nor confuses the
 *  JSON extractor (the reasoning often contains stray braces). */
function stripReasoning(text: string): string {
	return text
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/<\/?think>/gi, "")
		.trim();
}

/** Pull the first balanced JSON object out of a model response (it may wrap the
 *  JSON in prose or ```json fences). Returns null when there's no object. */
function extractToolCall(text: string): ToolCall | null {
	const cleaned = stripReasoning(text);
	const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1] : cleaned;
	const start = candidate.indexOf("{");
	if (start === -1) return null;
	// Walk braces to find the matching close so trailing prose doesn't break parse.
	let depth = 0;
	for (let i = start; i < candidate.length; i++) {
		if (candidate[i] === "{") depth++;
		else if (candidate[i] === "}") {
			depth--;
			if (depth === 0) {
				try {
					const obj = JSON.parse(candidate.slice(start, i + 1));
					if (obj && typeof obj === "object" && typeof obj.action === "string") {
						return obj as ToolCall;
					}
				} catch {
					return null;
				}
				return null;
			}
		}
	}
	return null;
}

function buildSystemPrompt(tools: EditTool[]): ChatMessage {
	const toolList = tools
		.map((t) => {
			const args = t.args
				? ` Args: ${Object.entries(t.args)
						.map(([k, v]) => `${k} (${v})`)
						.join(", ")}.`
				: " No args.";
			return `- ${t.name}: ${t.description}.${args}`;
		})
		.join("\n");

	return {
		role: "system",
		content:
			"You are the AI assistant inside Guide Studio, a screen-recording video editor. " +
			"You can control the editor by calling tools.\n\n" +
			"AVAILABLE TOOLS:\n" +
			toolList +
			"\n\nRESPONSE FORMAT — reply with a SINGLE JSON object and nothing else:\n" +
			'- To run a tool: {"action": "<tool_name>", "args": { ... }, "message": "<short note to the user>"}\n' +
			'- To just talk (no tool): {"action": "reply", "message": "<your answer>"}\n\n' +
			"Only use a tool when the user clearly asks for that action. When unsure, use " +
			'"reply" and ask a clarifying question. Keep messages concise. Never invent tools ' +
			"that are not in the list above.",
	};
}

export function AIChatPanel({ editTools = [] }: { editTools?: EditTool[] }) {
	const { requireChatProvider } = useAIPreflight();
	const [messages, setMessages] = useState<DisplayMessage[]>([]);
	const [input, setInput] = useState("");
	const [isSending, setIsSending] = useState(false);
	// Which provider the chat will use, so the panel can say "no key yet"
	// before the user types a message into a void.
	const [activeProvider, setActiveProvider] = useState<string | null | undefined>(undefined);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Re-check on mount and whenever the window regains focus — the settings
	// dialog may have added a key in between.
	useEffect(() => {
		let cancelled = false;
		const check = async () => {
			if (!window.electronAPI?.aiCheckAvailability) {
				if (!cancelled) setActiveProvider(null);
				return;
			}
			try {
				const availability = await window.electronAPI.aiCheckAvailability();
				if (!cancelled) setActiveProvider(availability?.activeProvider ?? null);
			} catch {
				if (!cancelled) setActiveProvider(null);
			}
		};
		void check();
		window.addEventListener("focus", check);
		return () => {
			cancelled = true;
			window.removeEventListener("focus", check);
		};
	}, []);

	const systemPrompt = useMemo(() => buildSystemPrompt(editTools), [editTools]);
	const toolByName = useMemo(() => new Map(editTools.map((t) => [t.name, t])), [editTools]);
	const lastMessage = messages[messages.length - 1];

	// Keep the newest message in view as the conversation grows.
	useEffect(() => {
		if (!lastMessage) return;
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
	}, [lastMessage]);

	const send = useCallback(async () => {
		const text = input.trim();
		if (!text || isSending) return;
		if (!(await requireChatProvider("AI Chat"))) return;

		const history: DisplayMessage[] = [...messages, { role: "user", content: text }];
		setMessages(history);
		setInput("");
		setIsSending(true);

		try {
			// Send only user/assistant turns as context (tool confirmations are UI-only).
			const convo: ChatMessage[] = history
				.filter((m): m is { role: "user" | "assistant"; content: string } => m.role !== "tool")
				.map((m) => ({ role: m.role, content: m.content }));

			// The model comes from AI Settings (the user's provider + key), so the
			// request carries no model of its own.
			const result = await aiService.chatCompletion({
				messages: [systemPrompt, ...convo],
				temperature: 0.2,
			});

			if (!result.success) {
				toast.error("AI chat failed", { description: result.error });
				setInput(text);
				setMessages(messages);
				return;
			}

			const raw = result.data.content.trim();
			const call = extractToolCall(raw);

			// Plain conversation, or a "reply" action.
			if (!call || call.action === "reply" || !toolByName.has(call.action)) {
				const reply = call?.message ?? stripReasoning(raw);
				setMessages((prev) => [...prev, { role: "assistant", content: reply || "(no response)" }]);
				return;
			}

			// A real tool call — acknowledge, then execute.
			const tool = toolByName.get(call.action)!;
			if (call.message) {
				setMessages((prev) => [...prev, { role: "assistant", content: call.message! }]);
			}
			try {
				const confirmation = await tool.run(call.args ?? {});
				setMessages((prev) => [
					...prev,
					{ role: "tool", content: confirmation || `Ran: ${tool.label}` },
				]);
			} catch (toolErr) {
				setMessages((prev) => [
					...prev,
					{
						role: "tool",
						content: `Couldn't run "${tool.label}": ${
							toolErr instanceof Error ? toolErr.message : String(toolErr)
						}`,
					},
				]);
			}
		} catch (err) {
			toast.error("AI chat failed", {
				description: err instanceof Error ? err.message : String(err),
			});
			setInput(text);
			setMessages(messages);
		} finally {
			setIsSending(false);
			inputRef.current?.focus();
		}
	}, [input, isSending, messages, requireChatProvider, systemPrompt, toolByName]);

	const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	};

	return (
		<div className="flex-1 min-h-0 flex flex-col">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
				<div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#6E6BFF]/10 border border-[#6E6BFF]/30">
					<Bot size={14} className="text-[#6E6BFF]" />
				</div>
				<span className="text-xs font-medium text-white/80">AI Chat</span>
				{messages.length > 0 && (
					<button
						type="button"
						onClick={() => setMessages([])}
						className="ml-auto text-[11px] text-white/40 hover:text-white/70 transition-colors"
					>
						Clear
					</button>
				)}
				<span className={messages.length > 0 ? "" : "ml-auto"}>
					<AISettingsButton size={13} />
				</span>
			</div>

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
				{messages.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#6E6BFF]/10 border border-[#6E6BFF]/30">
							<Bot size={22} className="text-[#6E6BFF]" />
						</div>
						<div className="text-sm font-medium text-white/90">
							{activeProvider === null ? "Connect your AI key" : "Ask the AI to edit for you"}
						</div>
						{activeProvider === null ? (
							<>
								<p className="max-w-[240px] text-xs leading-relaxed text-white/50">
									Chat runs on your own provider — OpenAI, Anthropic, Groq, MiniMax, Kimi, or a
									local Ollama. Add a key once and every AI feature uses it.
								</p>
								<button
									type="button"
									onClick={() => openAISettings("chat")}
									className="inline-flex items-center gap-1.5 rounded-lg bg-[#6E6BFF] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#6E6BFF]/90"
								>
									<Key size={12} />
									Add your API key
								</button>
							</>
						) : (
							<p className="max-w-[240px] text-xs leading-relaxed text-white/50">
								Try "add captions", "polish this recording", or "open the background panel". The
								assistant runs the tools for you.
							</p>
						)}
					</div>
				) : (
					messages.map((m, i) => {
						if (m.role === "tool") {
							return (
								<div
									key={`tool-${i}`}
									className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-3 py-2 text-xs text-emerald-300"
								>
									<Wrench size={12} className="flex-shrink-0" />
									<span className="leading-relaxed">{m.content}</span>
								</div>
							);
						}
						return (
							<div
								key={`${m.role}-${i}`}
								className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
							>
								<div
									className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border ${
										m.role === "user"
											? "bg-white/5 border-white/10 text-white/60"
											: "bg-[#6E6BFF]/10 border-[#6E6BFF]/30 text-[#6E6BFF]"
									}`}
								>
									{m.role === "user" ? <User size={12} /> : <Bot size={12} />}
								</div>
								<div
									className={`max-w-[240px] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
										m.role === "user"
											? "bg-[#6E6BFF]/15 border border-[#6E6BFF]/25 text-white/90"
											: "bg-white/5 border border-white/10 text-white/80"
									}`}
								>
									{m.content}
								</div>
							</div>
						);
					})
				)}
				{isSending && (
					<div className="flex gap-2">
						<div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[#6E6BFF]/10 border border-[#6E6BFF]/30 text-[#6E6BFF]">
							<Bot size={12} />
						</div>
						<div className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white/50">
							<Loader2 size={12} className="animate-spin" />
							Thinking…
						</div>
					</div>
				)}
			</div>

			{/* Composer */}
			<div className="border-t border-white/5 p-2.5">
				<div className="relative flex items-end gap-2 rounded-lg border border-white/10 bg-white/5 focus-within:border-[#6E6BFF]/50 transition-colors">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={onInputKeyDown}
						placeholder="Tell the AI what to edit…"
						rows={1}
						className="flex-1 resize-none bg-transparent px-3 py-2.5 text-xs text-white/90 placeholder:text-white/30 focus:outline-none max-h-28"
					/>
					<button
						type="button"
						onClick={() => void send()}
						disabled={!input.trim() || isSending}
						className="m-1.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[#6E6BFF] text-white transition-colors hover:bg-[#6E6BFF]/90 disabled:cursor-not-allowed disabled:opacity-40"
						aria-label="Send message"
					>
						{isSending ? (
							<Loader2 size={13} className="animate-spin" />
						) : (
							<CornerDownLeft size={13} />
						)}
					</button>
				</div>
				<p className="mt-1.5 px-1 text-[10px] text-white/30">
					Enter to send · Shift+Enter for a new line
				</p>
			</div>
		</div>
	);
}
