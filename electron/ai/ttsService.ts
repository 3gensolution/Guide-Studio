/**
 * TTS Service — the entry point every narration path goes through.
 *
 * Two engines sit behind it: OpenAI's cloud voices, and Piper running locally.
 * Which one speaks is the user's setting, and "auto" means the cloud when a key
 * is configured and Piper otherwise — with Piper also catching a cloud failure,
 * so a quota error or a flight with no wifi costs quality rather than silence.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { loadSettings } from "../settings";
import { loadAIConfig } from "./aiService";
import { synthesizePiper } from "./piperTtsService";

const TTS_OUTPUT_DIR = "tts-output";

function getTTSOutputDir(): string {
	return path.join(app.getPath("userData"), TTS_OUTPUT_DIR);
}

async function ensureTTSDir(): Promise<string> {
	const dir = getTTSOutputDir();
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

export type TTSVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

export interface TTSResult {
	success: boolean;
	audioPath?: string;
	error?: string;
}

export interface TTSOptions {
	/** Overrides the language Piper would otherwise detect from the text. */
	language?: string;
	/** A specific Piper voice, when the caller has one in mind. */
	piperVoiceId?: string;
}

/**
 * Synthesize text to speech.
 *
 * On success the path is to an audio file in the user's TTS output directory.
 * The engines write different formats — MP3 from the cloud, MP3 or WAV from
 * Piper depending on whether FFmpeg is around — and every consumer either plays
 * the file or hands it to FFmpeg, both of which take either.
 */
export async function synthesize(
	text: string,
	voice: TTSVoice = "nova",
	options: TTSOptions = {},
): Promise<TTSResult> {
	const config = await loadAIConfig();
	const settings = await loadSettings().catch(() => null);
	const engine = settings?.ttsEngine ?? "auto";

	const speakLocally = () =>
		synthesizePiper(text, {
			language: options.language ?? settings?.narrationLanguage,
			voiceId: options.piperVoiceId ?? settings?.piperVoiceId,
		});

	// Asked for local: stay local. Falling back to a paid API from a setting
	// that says "local" would send the user's script somewhere they told us not
	// to send it.
	if (engine === "piper") return speakLocally();

	if (config.apiKey) {
		try {
			return await synthesizeOpenAI(text, voice, config.apiKey);
		} catch (err) {
			// Surface the ACTUAL error so the user can see why TTS failed (quota,
			// invalid key, network, etc.) rather than the misleading
			// "TTS not available" message that suggests no key is configured.
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("[OpenAI TTS] failed:", msg);
			if (engine !== "cloud") {
				const local = await speakLocally();
				if (local.success) {
					console.warn("[TTS] Spoke with local Piper instead:", local.voiceId);
					return { success: true, audioPath: local.audioPath };
				}
			}
			if (/quota|429|billing|insufficient/i.test(msg)) {
				return {
					success: false,
					error: `OpenAI TTS quota exceeded — top up your OpenAI billing, configure a MiniMax API key (settings.aiApiKey_minimax), or install Piper for local narration.`,
				};
			}
			return {
				success: false,
				error: `OpenAI TTS failed: ${msg.slice(0, 200)}`,
			};
		}
	}

	// No cloud key at all. Piper needs neither key nor account, so this is the
	// case it exists for rather than an error to report.
	if (engine === "cloud") {
		return {
			success: false,
			error:
				"Cloud TTS is selected but no API key is configured. Add an OpenAI or MiniMax key, or switch narration to local Piper.",
		};
	}
	const local = await speakLocally();
	if (local.success) return { success: true, audioPath: local.audioPath };
	return {
		success: false,
		error:
			local.error ??
			"TTS not available. Configure an OpenAI or MiniMax API key, or install Piper for local narration.",
	};
}

async function synthesizeOpenAI(text: string, voice: TTSVoice, apiKey: string): Promise<TTSResult> {
	const response = await fetch("https://api.openai.com/v1/audio/speech", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: "tts-1",
			input: text,
			voice,
			response_format: "mp3",
		}),
		signal: AbortSignal.timeout(120_000),
	});

	if (!response.ok) {
		throw new Error(`OpenAI TTS responded with ${response.status}: ${response.statusText}`);
	}

	const outputDir = await ensureTTSDir();
	const fileName = `tts-${Date.now()}.mp3`;
	const audioPath = path.join(outputDir, fileName);

	const arrayBuffer = await response.arrayBuffer();
	await fs.writeFile(audioPath, Buffer.from(arrayBuffer));

	return { success: true, audioPath };
}
