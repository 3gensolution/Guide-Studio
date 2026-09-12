/**
 * Piper voice catalog and language routing.
 *
 * Deliberately free of Electron and the filesystem: picking a voice for a piece
 * of narration is arithmetic on strings, and keeping it that way is what makes
 * it testable. The service in `piperTtsService.ts` does the downloading and the
 * spawning.
 *
 * Piper is a local neural TTS engine. Each voice is a pair of files — an ONNX
 * model and its JSON config — published per language at
 * huggingface.co/rhasspy/piper-voices. Nothing here reaches the network; the
 * service fetches the upstream index when it can and falls back to this list.
 */

export type PiperQuality = "x_low" | "low" | "medium" | "high";

export interface PiperVoice {
	/** Upstream key, e.g. "en_US-amy-medium". Also the local file stem. */
	id: string;
	/** Locale the voice speaks, e.g. "en_US". */
	locale: string;
	/** Language family of that locale, e.g. "en". */
	language: string;
	/** How it reads in a picker. */
	label: string;
	quality: PiperQuality;
	gender?: "male" | "female";
}

export const PIPER_VOICE_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
export const PIPER_VOICE_INDEX_URL = `${PIPER_VOICE_BASE_URL}/voices.json`;

/**
 * The curated list: one or two voices for each language Piper covers well.
 *
 * Piper publishes hundreds of voices; offering all of them is a worse picker,
 * not a better one. This is the shortlist the app ships knowing about, and the
 * upstream index is consulted at download time so a voice that has been renamed
 * or replaced can still be resolved.
 */
export const PIPER_VOICES: PiperVoice[] = [
	{
		id: "en_US-amy-medium",
		locale: "en_US",
		language: "en",
		label: "Amy — US English",
		quality: "medium",
		gender: "female",
	},
	{
		id: "en_US-ryan-high",
		locale: "en_US",
		language: "en",
		label: "Ryan — US English",
		quality: "high",
		gender: "male",
	},
	{
		id: "en_US-lessac-medium",
		locale: "en_US",
		language: "en",
		label: "Lessac — US English",
		quality: "medium",
		gender: "female",
	},
	{
		id: "en_GB-alba-medium",
		locale: "en_GB",
		language: "en",
		label: "Alba — British English",
		quality: "medium",
		gender: "female",
	},
	{
		id: "en_GB-northern_english_male-medium",
		locale: "en_GB",
		language: "en",
		label: "Northern — British English",
		quality: "medium",
		gender: "male",
	},
	{
		id: "es_ES-davefx-medium",
		locale: "es_ES",
		language: "es",
		label: "DaveFX — Spanish (Spain)",
		quality: "medium",
		gender: "male",
	},
	{
		id: "es_MX-ald-medium",
		locale: "es_MX",
		language: "es",
		label: "Ald — Spanish (Mexico)",
		quality: "medium",
		gender: "male",
	},
	{
		id: "fr_FR-siwis-medium",
		locale: "fr_FR",
		language: "fr",
		label: "Siwis — French",
		quality: "medium",
		gender: "female",
	},
	{
		id: "fr_FR-upmc-medium",
		locale: "fr_FR",
		language: "fr",
		label: "UPMC — French",
		quality: "medium",
	},
	{
		id: "de_DE-thorsten-medium",
		locale: "de_DE",
		language: "de",
		label: "Thorsten — German",
		quality: "medium",
		gender: "male",
	},
	{
		id: "de_DE-eva_k-x_low",
		locale: "de_DE",
		language: "de",
		label: "Eva K — German",
		quality: "x_low",
		gender: "female",
	},
	{
		id: "it_IT-paola-medium",
		locale: "it_IT",
		language: "it",
		label: "Paola — Italian",
		quality: "medium",
		gender: "female",
	},
	{
		id: "it_IT-riccardo-x_low",
		locale: "it_IT",
		language: "it",
		label: "Riccardo — Italian",
		quality: "x_low",
		gender: "male",
	},
	{
		id: "pt_BR-faber-medium",
		locale: "pt_BR",
		language: "pt",
		label: "Faber — Portuguese (Brazil)",
		quality: "medium",
		gender: "male",
	},
	{
		id: "pt_PT-tugao-medium",
		locale: "pt_PT",
		language: "pt",
		label: "Tugão — Portuguese (Portugal)",
		quality: "medium",
		gender: "male",
	},
	{
		id: "nl_NL-mls_5809-low",
		locale: "nl_NL",
		language: "nl",
		label: "MLS — Dutch",
		quality: "low",
	},
	{
		id: "nl_BE-nathalie-medium",
		locale: "nl_BE",
		language: "nl",
		label: "Nathalie — Dutch (Belgium)",
		quality: "medium",
		gender: "female",
	},
	{
		id: "pl_PL-darkman-medium",
		locale: "pl_PL",
		language: "pl",
		label: "Darkman — Polish",
		quality: "medium",
		gender: "male",
	},
	{
		id: "ru_RU-irina-medium",
		locale: "ru_RU",
		language: "ru",
		label: "Irina — Russian",
		quality: "medium",
		gender: "female",
	},
	{
		id: "ru_RU-dmitri-medium",
		locale: "ru_RU",
		language: "ru",
		label: "Dmitri — Russian",
		quality: "medium",
		gender: "male",
	},
	{
		id: "uk_UA-ukrainian_tts-medium",
		locale: "uk_UA",
		language: "uk",
		label: "Ukrainian TTS",
		quality: "medium",
	},
	{
		id: "zh_CN-huayan-medium",
		locale: "zh_CN",
		language: "zh",
		label: "Huayan — Mandarin Chinese",
		quality: "medium",
		gender: "female",
	},
	{
		id: "tr_TR-dfki-medium",
		locale: "tr_TR",
		language: "tr",
		label: "DFKI — Turkish",
		quality: "medium",
		gender: "male",
	},
	{
		id: "ar_JO-kareem-medium",
		locale: "ar_JO",
		language: "ar",
		label: "Kareem — Arabic",
		quality: "medium",
		gender: "male",
	},
	{
		id: "hi_IN-pratham-medium",
		locale: "hi_IN",
		language: "hi",
		label: "Pratham — Hindi",
		quality: "medium",
		gender: "male",
	},
	{
		id: "fa_IR-amir-medium",
		locale: "fa_IR",
		language: "fa",
		label: "Amir — Persian",
		quality: "medium",
		gender: "male",
	},
	{
		id: "sv_SE-nst-medium",
		locale: "sv_SE",
		language: "sv",
		label: "NST — Swedish",
		quality: "medium",
	},
	{
		id: "da_DK-talesyntese-medium",
		locale: "da_DK",
		language: "da",
		label: "Talesyntese — Danish",
		quality: "medium",
	},
	{
		id: "no_NO-talesyntese-medium",
		locale: "no_NO",
		language: "no",
		label: "Talesyntese — Norwegian",
		quality: "medium",
	},
	{
		id: "fi_FI-harri-medium",
		locale: "fi_FI",
		language: "fi",
		label: "Harri — Finnish",
		quality: "medium",
		gender: "male",
	},
	{
		id: "cs_CZ-jirka-medium",
		locale: "cs_CZ",
		language: "cs",
		label: "Jirka — Czech",
		quality: "medium",
		gender: "male",
	},
	{
		id: "sk_SK-lili-medium",
		locale: "sk_SK",
		language: "sk",
		label: "Lili — Slovak",
		quality: "medium",
		gender: "female",
	},
	{
		id: "ro_RO-mihai-medium",
		locale: "ro_RO",
		language: "ro",
		label: "Mihai — Romanian",
		quality: "medium",
		gender: "male",
	},
	{
		id: "hu_HU-anna-medium",
		locale: "hu_HU",
		language: "hu",
		label: "Anna — Hungarian",
		quality: "medium",
		gender: "female",
	},
	{
		id: "el_GR-rapunzelina-low",
		locale: "el_GR",
		language: "el",
		label: "Rapunzelina — Greek",
		quality: "low",
		gender: "female",
	},
	{
		id: "ca_ES-upc_ona-medium",
		locale: "ca_ES",
		language: "ca",
		label: "Ona — Catalan",
		quality: "medium",
		gender: "female",
	},
	{
		id: "vi_VN-vais1000-medium",
		locale: "vi_VN",
		language: "vi",
		label: "VAIS — Vietnamese",
		quality: "medium",
	},
	{
		id: "ka_GE-natia-medium",
		locale: "ka_GE",
		language: "ka",
		label: "Natia — Georgian",
		quality: "medium",
		gender: "female",
	},
	{
		id: "sr_RS-serbski_institut-medium",
		locale: "sr_RS",
		language: "sr",
		label: "Serbski Institut — Serbian",
		quality: "medium",
	},
];

/**
 * The voice each language gets when nothing more specific was asked for.
 * Where a language has several regions, this is the most widely understood one.
 */
export const PIPER_DEFAULT_BY_LANGUAGE: Record<string, string> = {
	en: "en_US-amy-medium",
	es: "es_ES-davefx-medium",
	fr: "fr_FR-siwis-medium",
	de: "de_DE-thorsten-medium",
	it: "it_IT-paola-medium",
	pt: "pt_BR-faber-medium",
	nl: "nl_NL-mls_5809-low",
	pl: "pl_PL-darkman-medium",
	ru: "ru_RU-irina-medium",
	uk: "uk_UA-ukrainian_tts-medium",
	zh: "zh_CN-huayan-medium",
	tr: "tr_TR-dfki-medium",
	ar: "ar_JO-kareem-medium",
	hi: "hi_IN-pratham-medium",
	fa: "fa_IR-amir-medium",
	sv: "sv_SE-nst-medium",
	da: "da_DK-talesyntese-medium",
	no: "no_NO-talesyntese-medium",
	fi: "fi_FI-harri-medium",
	cs: "cs_CZ-jirka-medium",
	sk: "sk_SK-lili-medium",
	ro: "ro_RO-mihai-medium",
	hu: "hu_HU-anna-medium",
	el: "el_GR-rapunzelina-low",
	ca: "ca_ES-upc_ona-medium",
	vi: "vi_VN-vais1000-medium",
	ka: "ka_GE-natia-medium",
	sr: "sr_RS-serbski_institut-medium",
};

/** The voice used when the language is unknown and nothing was configured. */
export const PIPER_FALLBACK_VOICE = "en_US-amy-medium";

const BY_ID = new Map(PIPER_VOICES.map((voice) => [voice.id, voice]));

export function getPiperVoice(id: string | undefined): PiperVoice | undefined {
	return id ? BY_ID.get(id) : undefined;
}

export interface ParsedVoiceId {
	locale: string;
	name: string;
	quality: string;
	/** Language family, i.e. the part of the locale before the underscore. */
	family: string;
}

/**
 * Splits an upstream voice key. The name may itself contain hyphens in theory,
 * so the locale is taken from the front and the quality from the back rather
 * than splitting the whole string into three.
 */
export function parseVoiceId(id: string): ParsedVoiceId | null {
	const parts = id.split("-");
	if (parts.length < 3) return null;
	const locale = parts[0] as string;
	const quality = parts[parts.length - 1] as string;
	const name = parts.slice(1, -1).join("-");
	if (!locale || !name || !quality) return null;
	return { locale, name, quality, family: locale.split("_")[0] as string };
}

/**
 * Where a voice's two files live upstream, derived from its key.
 *
 * This mirrors the repository's own `<family>/<locale>/<name>/<quality>/`
 * layout. The service prefers the paths listed in the fetched index and uses
 * these only when the index could not be read.
 */
export function voiceFileUrls(id: string): { model: string; config: string } | null {
	const parsed = parseVoiceId(id);
	if (!parsed) return null;
	const dir = `${PIPER_VOICE_BASE_URL}/${parsed.family}/${parsed.locale}/${parsed.name}/${parsed.quality}`;
	return { model: `${dir}/${id}.onnx`, config: `${dir}/${id}.onnx.json` };
}

// ── Language detection ───────────────────────────────────────────────────
//
// Narration arrives as plain text with no locale attached, and the point of a
// local engine with forty voices is that Spanish copy is read by a Spanish
// voice. An explicit language always wins; this is only what happens when
// nobody said.

/** Scripts that identify a language on sight. Checked before any word lists. */
const SCRIPTS: Array<{ language: string; pattern: RegExp }> = [
	{ language: "ja", pattern: /[぀-ヿ]/ },
	{ language: "ko", pattern: /[가-힯ᄀ-ᇿ]/ },
	{ language: "zh", pattern: /[一-鿿]/ },
	{ language: "el", pattern: /[Ͱ-Ͽ]/ },
	{ language: "he", pattern: /[֐-׿]/ },
	{ language: "hi", pattern: /[ऀ-ॿ]/ },
	{ language: "ka", pattern: /[Ⴀ-ჿ]/ },
	{ language: "hy", pattern: /[԰-֏]/ },
	{ language: "th", pattern: /[฀-๿]/ },
];

/** Letters that separate languages sharing a script. */
const FA_LETTERS = /[پچژگیک]/; // پ چ ژ گ ی ک
const UK_LETTERS = /[іїєґІЇЄҐ]/;
const SR_LETTERS = /[ђјљњћџЂЈЉЊЋЏ]/;

/**
 * Words common enough in a sentence or two of narration to separate the
 * Latin-script languages. Short function words only: content words would make
 * the score depend on the subject of the video rather than its language.
 */
const STOPWORDS: Record<string, string[]> = {
	en: ["the", "and", "is", "to", "of", "in", "for", "that", "with", "you", "this", "it"],
	es: [
		"el",
		"la",
		"los",
		"las",
		"de",
		"que",
		"y",
		"en",
		"un",
		"una",
		"por",
		"para",
		"con",
		"es",
		"se",
		"más",
	],
	fr: [
		"le",
		"la",
		"les",
		"des",
		"du",
		"et",
		"est",
		"une",
		"dans",
		"pour",
		"que",
		"qui",
		"pas",
		"vous",
		"avec",
		"sur",
	],
	de: [
		"der",
		"die",
		"das",
		"und",
		"ist",
		"nicht",
		"ein",
		"eine",
		"mit",
		"für",
		"auf",
		"von",
		"sich",
		"dass",
		"wir",
		"sie",
	],
	it: [
		"il",
		"lo",
		"la",
		"che",
		"di",
		"e",
		"per",
		"non",
		"con",
		"una",
		"del",
		"sono",
		"come",
		"più",
		"anche",
	],
	pt: [
		"o",
		"os",
		"as",
		"do",
		"da",
		"em",
		"para",
		"com",
		"não",
		"uma",
		"mais",
		"você",
		"são",
		"seu",
	],
	nl: [
		"de",
		"het",
		"een",
		"en",
		"van",
		"is",
		"niet",
		"met",
		"voor",
		"dat",
		"je",
		"op",
		"zijn",
		"aan",
	],
	pl: ["nie", "się", "jest", "że", "na", "do", "to", "jak", "przez", "oraz", "tego"],
	tr: ["bir", "ve", "bu", "için", "ile", "olarak", "çok", "daha", "var", "olan"],
	sv: ["och", "att", "det", "som", "en", "på", "är", "för", "med", "inte", "den"],
	da: ["og", "at", "det", "en", "som", "på", "er", "til", "med", "ikke", "den"],
	no: ["og", "er", "det", "en", "som", "på", "til", "med", "ikke", "for", "den"],
	fi: ["ja", "on", "ei", "se", "että", "kuin", "mutta", "sekä", "ovat"],
	cs: ["a", "je", "se", "na", "že", "to", "do", "pro", "není", "jsou"],
	sk: ["a", "je", "sa", "na", "že", "to", "do", "pre", "nie", "sú"],
	ro: ["și", "de", "la", "în", "cu", "este", "un", "pentru", "nu", "care"],
	hu: ["és", "az", "egy", "hogy", "nem", "van", "meg", "ez", "mint"],
	vi: ["và", "của", "là", "có", "không", "được", "những", "người", "cho"],
	ca: ["els", "les", "amb", "però", "aquest", "aquesta", "això", "què", "són"],
};

/**
 * How much a word is worth as evidence: one point split between every language
 * that claims it. "une" belongs to French alone and settles the question; "de"
 * is Spanish, French and Romanian at once and barely moves the score. Counting
 * raw hits instead makes two languages tie on the words they share, and the tie
 * is then broken by nothing better than the order of this object.
 */
const WORD_WEIGHTS = ((): Map<string, number> => {
	const claims = new Map<string, number>();
	for (const words of Object.values(STOPWORDS)) {
		for (const word of words) claims.set(word, (claims.get(word) ?? 0) + 1);
	}
	return new Map([...claims].map(([word, count]) => [word, 1 / count]));
})();

/** Evidence needed before a word-list guess is trusted over the default. */
const MIN_LANGUAGE_SCORE = 1;

/**
 * A best guess at what language a piece of narration is in.
 *
 * It is a guess: two languages that share a script and much of their function
 * words — Danish and Norwegian, Czech and Slovak — are not reliably told apart
 * by a sentence, and this returns the better-scoring one rather than refusing.
 * Every caller can override it, and the default is English, so the failure mode
 * is a voice with the wrong accent, not a crash or silence.
 */
export function detectLanguage(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "en";

	for (const { language, pattern } of SCRIPTS) {
		if (pattern.test(trimmed)) return language;
	}
	if (/[؀-ۿ]/.test(trimmed)) return FA_LETTERS.test(trimmed) ? "fa" : "ar";
	if (/[Ѐ-ӿ]/.test(trimmed)) {
		if (UK_LETTERS.test(trimmed)) return "uk";
		if (SR_LETTERS.test(trimmed)) return "sr";
		return "ru";
	}

	const words = trimmed.toLowerCase().match(/[\p{L}']+/gu) ?? [];
	if (!words.length) return "en";
	const seen = new Set(words);

	let best = "en";
	let bestScore = 0;
	for (const [language, stopwords] of Object.entries(STOPWORDS)) {
		let score = 0;
		for (const word of stopwords) if (seen.has(word)) score += WORD_WEIGHTS.get(word) ?? 1;
		// Ties go to whichever language was scored first, and English is first,
		// which is the right bias for a tool whose copy is usually English.
		if (score > bestScore) {
			best = language;
			bestScore = score;
		}
	}
	return bestScore >= MIN_LANGUAGE_SCORE ? best : "en";
}

export interface VoiceChoice {
	/** Explicit voice key; wins outright when it names a known voice. */
	voiceId?: string;
	/** Explicit language or locale, e.g. "de" or "de_DE" or "de-DE". */
	language?: string;
	/** Narration to guess from, when neither of the above was given. */
	text?: string;
}

/**
 * Resolves a request down to a single voice key.
 *
 * Precedence is explicit voice, then explicit language, then the language of
 * the text, then English — so a caller that knows the answer is never
 * second-guessed by the detector.
 */
export function pickVoiceId(choice: VoiceChoice): string {
	if (choice.voiceId && BY_ID.has(choice.voiceId)) return choice.voiceId;
	// An id we do not ship is still passed through: the index may know it, and
	// refusing a real upstream voice because it is not on our shortlist would
	// make the shortlist a limit rather than a convenience.
	if (choice.voiceId && parseVoiceId(choice.voiceId)) return choice.voiceId;

	const requested = choice.language?.trim().replace("-", "_");
	if (requested) {
		const exactLocale = PIPER_VOICES.find((voice) => voice.locale === requested);
		if (exactLocale) return exactLocale.id;
		const family = (requested.split("_")[0] as string).toLowerCase();
		const byLanguage = PIPER_DEFAULT_BY_LANGUAGE[family];
		if (byLanguage) return byLanguage;
	}

	if (choice.text) {
		const detected = PIPER_DEFAULT_BY_LANGUAGE[detectLanguage(choice.text)];
		if (detected) return detected;
	}
	return PIPER_FALLBACK_VOICE;
}

/** The voices on offer, optionally narrowed to one language or locale. */
export function listPiperVoices(language?: string): PiperVoice[] {
	if (!language) return PIPER_VOICES;
	const wanted = language.trim().replace("-", "_").toLowerCase();
	return PIPER_VOICES.filter(
		(voice) => voice.language === wanted || voice.locale.toLowerCase() === wanted,
	);
}

/** Every language the shipped shortlist can speak, in catalog order. */
export function piperLanguages(): string[] {
	return [...new Set(PIPER_VOICES.map((voice) => voice.language))];
}
