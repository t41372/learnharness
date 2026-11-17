/**
 * THE INTERFACE LANGUAGE (i18n wave, 2026-10-25): which languages the app
 * ships, how a stored setting resolves to one of them, and how a browser /
 * OS locale tag narrows to a shipped language.
 *
 * The setting lives in the settings record (general.language). "system"
 * (the factory default) follows the platform's preference: the root layout
 * resolves it from the request's Accept-Language header (Electron's
 * Chromium sends the OS language), the client from navigator.languages.
 *
 * Browser-safe: pure logic + types only.
 */

/** The shipped interface languages — English is the reference (every key
 *  exists in English first; the Chinese files must match it key for key). */
export const LANGUAGES = ["en", "zh-CN", "zh-TW"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The stored choice: a shipped language, or "system" (follow the platform). */
export type LanguageSetting = "system" | Language;

export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["system", ...LANGUAGES];

/** Each language's name written in that language (the picker shows these
 *  verbatim in every interface language, so a user who can't read the
 *  current one still finds their own). */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
	en: "English",
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
};

export function isLanguage(value: unknown): value is Language {
	return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return value === "system" || isLanguage(value);
}

/**
 * Narrow one BCP-47 tag to a shipped language, or null when the tag names
 * none of them. Chinese splits by script: an explicit Hant script or a
 * Taiwan / Hong Kong / Macau region reads Traditional, every other Chinese
 * tag (zh, zh-CN, zh-SG, zh-Hans-*) reads Simplified.
 */
export function languageOfTag(tag: string): Language | null {
	const t = tag.trim().toLowerCase().replace(/_/g, "-");
	if (!t) return null;
	if (t === "en" || t.startsWith("en-")) return "en";
	if (t === "zh" || t.startsWith("zh-")) {
		const parts = t.split("-");
		if (parts.includes("hant")) return "zh-TW";
		if (parts.includes("hans")) return "zh-CN";
		if (parts.includes("tw") || parts.includes("hk") || parts.includes("mo")) return "zh-TW";
		return "zh-CN";
	}
	return null;
}

/** The first preferred tag that names a shipped language; English when
 *  none does (the reference language is the fallback). */
export function languageOfPreferences(preferred: readonly string[]): Language {
	for (const tag of preferred) {
		const lang = languageOfTag(tag);
		if (lang) return lang;
	}
	return "en";
}

/** Parse an Accept-Language header into tags, highest quality first
 *  (q=0 entries dropped; ties keep header order). */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
	if (!header) return [];
	return header
		.split(",")
		.map((part, index) => {
			const [tag = "", ...params] = part.trim().split(";");
			const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
			const quality = q ? Number(q.slice(2)) : 1;
			return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
		})
		.filter((entry) => entry.tag && entry.tag !== "*" && entry.quality > 0)
		.sort((a, b) => b.quality - a.quality || a.index - b.index)
		.map((entry) => entry.tag);
}

/** The language a setting runs: an explicit choice wins; "system" follows
 *  the platform's preference list. */
export function resolveLanguage(setting: LanguageSetting, preferred: readonly string[]): Language {
	return setting === "system" ? languageOfPreferences(preferred) : setting;
}
