/**
 * AIChatPanel — agentic AI assistant for the editor's AI panel.
 *
 * The assistant can *drive the editor* (open Auto Captions, run Magic Polish,
 * switch panels, export, …) by emitting a small JSON tool-call that this panel
 * parses and dispatches to the real editor handlers passed in via `editTools`.
 *
 * Model routing: the request asks the studio backend for the OpenRouter Qwen 3
 * small model (EDIT_TOOLS_MODEL) — a compact model dedicated to edit-tool
 * intent. Whether that model is actually used is decided server-side; the studio
 * `/studio/ai/chat/completion` endpoint must honor the `model` param and route
 * it to OpenRouter. If it doesn't, chat still works via the backend default.
 *
 * The tool protocol is prompt-based (JSON in the text response) rather than
 * native function-calling, because the chat endpoint returns plain text
 * (`{ content }`) — this keeps everything working over the existing route.
 */
import { Bot, CornerDownLeft, Loader2, User, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAIPreflight } from "@/hooks/useAIPreflight";
import { aiService, type ChatMessage } from "@/lib/api/ai";

/** OpenRouter slug for the small Gemma model dedicated to edit-tool chat.
 *  Any "vendor/model" id makes the studio backend route to OpenRouter (bare ids
 *  stay on DeepSeek), so this keeps AI Chat on Gemma while the other AI features
 *  use the backend default. Adjust to the exact slug your OpenRouter account
 *  exposes; matches the backend STUDIO_CHAT_MODEL default. */
export const EDIT_TOOLS_MODEL = "google/gemma-4-26b-a4b-it";

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
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

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

			const payload = { messages: [systemPrompt, ...convo], temperature: 0.2 };
			// Prefer the small edit-tools model. The studio backend currently returns
			// 502 "Chat service error" whenever an explicit model is routed to
			// OpenRouter, so fall back to the backend default (which works) to keep chat
			// usable. Once the backend's model routing is fixed this automatically
			// starts using EDIT_TOOLS_MODEL with no client change.
			let result = await aiService.chatCompletion({ ...payload, model: EDIT_TOOLS_MODEL });
			if (!result.success) {
				result = await aiService.chatCompletion(payload);
			}

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
			</div>

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
				{messages.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#6E6BFF]/10 border border-[#6E6BFF]/30">
							<Bot size={22} className="text-[#6E6BFF]" />
						</div>
						<div className="text-sm font-medium text-white/90">Ask the AI to edit for you</div>
						<p className="max-w-[240px] text-xs leading-relaxed text-white/50">
							Try "add captions", "polish this recording", or "open the background panel". The
							assistant runs the tools for you.
						</p>
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
