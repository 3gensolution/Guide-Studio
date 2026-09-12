import { describe, expect, it } from "vitest";
import {
	detectLanguage,
	getPiperVoice,
	listPiperVoices,
	PIPER_DEFAULT_BY_LANGUAGE,
	PIPER_VOICES,
	parseVoiceId,
	pickVoiceId,
	piperLanguages,
	voiceFileUrls,
} from "./piperVoices";

describe("the voice catalog", () => {
	it("has unique ids", () => {
		expect(new Set(PIPER_VOICES.map((voice) => voice.id)).size).toBe(PIPER_VOICES.length);
	});

	it("keeps every id parseable, since the download path is derived from it", () => {
		for (const voice of PIPER_VOICES) {
			const parsed = parseVoiceId(voice.id);
			expect(parsed, voice.id).not.toBeNull();
			expect(parsed?.locale, voice.id).toBe(voice.locale);
			expect(parsed?.family, voice.id).toBe(voice.language);
			expect(parsed?.quality, voice.id).toBe(voice.quality);
		}
	});

	it("points every language default at a voice it actually ships", () => {
		for (const [language, voiceId] of Object.entries(PIPER_DEFAULT_BY_LANGUAGE)) {
			const voice = getPiperVoice(voiceId);
			expect(voice, `${language} defaults to a voice that is not in the catalog`).toBeDefined();
			expect(voice?.language, voiceId).toBe(language);
		}
	});

	it("gives every language in the catalog a default", () => {
		for (const language of piperLanguages()) {
			expect(PIPER_DEFAULT_BY_LANGUAGE[language], language).toBeDefined();
		}
	});

	it("narrows by language or by locale", () => {
		expect(listPiperVoices("en").every((voice) => voice.language === "en")).toBe(true);
		expect(listPiperVoices("pt_BR").map((voice) => voice.id)).toEqual(["pt_BR-faber-medium"]);
		expect(listPiperVoices("pt-BR").map((voice) => voice.id)).toEqual(["pt_BR-faber-medium"]);
		expect(listPiperVoices("tlh")).toEqual([]);
	});
});

describe("voiceFileUrls", () => {
	it("builds the upstream layout from the key", () => {
		expect(voiceFileUrls("en_US-amy-medium")).toEqual({
			model:
				"https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx",
			config:
				"https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json",
		});
	});

	it("keeps a hyphenated voice name whole", () => {
		expect(parseVoiceId("nl_NL-mls_5809-low")?.name).toBe("mls_5809");
		expect(voiceFileUrls("en_GB-northern_english_male-medium")?.model).toContain(
			"/en/en_GB/northern_english_male/medium/",
		);
	});

	it("refuses a name that is not a voice key", () => {
		expect(voiceFileUrls("amy")).toBeNull();
		expect(parseVoiceId("en_US-amy")).toBeNull();
	});
});

describe("detectLanguage", () => {
	it("reads a language off its script", () => {
		expect(detectLanguage("这是一个产品演示视频")).toBe("zh");
		expect(detectLanguage("Это демонстрация продукта")).toBe("ru");
		expect(detectLanguage("Це демонстрація продукту")).toBe("uk");
		expect(detectLanguage("هذا عرض توضيحي للمنتج")).toBe("ar");
		expect(detectLanguage("این یک نمایش محصول است")).toBe("fa");
		expect(detectLanguage("यह एक उत्पाद डेमो है")).toBe("hi");
		expect(detectLanguage("Αυτή είναι μια επίδειξη")).toBe("el");
	});

	it("separates the Latin-script languages by their function words", () => {
		expect(detectLanguage("Esta es la forma más rápida de crear un vídeo")).toBe("es");
		expect(detectLanguage("Voici la façon la plus rapide de créer une vidéo")).toBe("fr");
		expect(detectLanguage("Das ist der schnellste Weg, ein Video zu erstellen")).toBe("de");
		expect(detectLanguage("Questo è il modo più veloce per creare un video")).toBe("it");
		expect(detectLanguage("Esta é a forma mais rápida de criar um vídeo")).toBe("pt");
		expect(detectLanguage("Dit is de snelste manier om een video te maken")).toBe("nl");
		expect(detectLanguage("The fastest way to make a video with your team")).toBe("en");
	});

	it("falls back to English rather than guessing from too little", () => {
		expect(detectLanguage("")).toBe("en");
		expect(detectLanguage("   ")).toBe("en");
		expect(detectLanguage("Guide Studio")).toBe("en");
		expect(detectLanguage("2026")).toBe("en");
	});
});

describe("pickVoiceId", () => {
	it("honours an explicit voice above everything else", () => {
		expect(pickVoiceId({ voiceId: "de_DE-thorsten-medium", text: "hello there" })).toBe(
			"de_DE-thorsten-medium",
		);
	});

	it("passes through a real upstream voice the shortlist does not carry", () => {
		// The catalog is a convenience, not a whitelist: the index knows more
		// voices than we ship, and typing one in should work.
		expect(pickVoiceId({ voiceId: "en_US-kathleen-low" })).toBe("en_US-kathleen-low");
	});

	it("ignores a voice name that is not a voice name", () => {
		expect(pickVoiceId({ voiceId: "sounds-nice" })).toBe("en_US-amy-medium");
	});

	it("takes an explicit language over the language of the text", () => {
		expect(pickVoiceId({ language: "de", text: "This narration is in English" })).toBe(
			"de_DE-thorsten-medium",
		);
		expect(pickVoiceId({ language: "pt-BR" })).toBe("pt_BR-faber-medium");
		expect(pickVoiceId({ language: "es_MX" })).toBe("es_MX-ald-medium");
	});

	it("reads the language off the narration when nothing was specified", () => {
		expect(pickVoiceId({ text: "Das ist der schnellste Weg, ein Video zu erstellen" })).toBe(
			"de_DE-thorsten-medium",
		);
		expect(pickVoiceId({ text: "这是一个产品演示视频" })).toBe("zh_CN-huayan-medium");
	});

	it("speaks English when it has nothing at all to go on", () => {
		expect(pickVoiceId({})).toBe("en_US-amy-medium");
		// Japanese is detectable but Piper publishes no voice for it, so the
		// request has to land somewhere rather than resolve to nothing.
		expect(pickVoiceId({ text: "これは製品のデモです" })).toBe("en_US-amy-medium");
	});
});
