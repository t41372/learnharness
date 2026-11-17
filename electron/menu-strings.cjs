/**
 * The desktop shell's own copy, per interface language (i18n wave,
 * 2026-10-25): the application menu labels and the update-check dialogs.
 * Role items (Undo, Copy, Quit, …) take their labels from macOS / Chromium
 * itself, which localizes them through the bundled locales
 * (electron-builder.yml electronLanguages).
 *
 * The languages mirror src/core/language.ts (LANGUAGES, languageOfTag) —
 * the shell is plain CommonJS outside the import law, so the narrowing
 * rule is restated here; keep the two in sync.
 */

const STRINGS = {
	en: {
		checkForUpdates: "Check for Updates…",
		edit: "Edit",
		view: "View",
		actualSize: "Actual Size",
		zoomIn: "Zoom In",
		zoomOut: "Zoom Out",
		upToDate: "You're up to date.",
		upToDateDetail: (version) => `LearnHarness ${version} is the latest version.`,
		checkFailed: "Couldn't check for updates.",
	},
	"zh-CN": {
		checkForUpdates: "检查更新…",
		edit: "编辑",
		view: "显示",
		actualSize: "实际大小",
		zoomIn: "放大",
		zoomOut: "缩小",
		upToDate: "已是最新版本。",
		upToDateDetail: (version) => `LearnHarness ${version} 是最新版本。`,
		checkFailed: "无法检查更新。",
	},
	"zh-TW": {
		checkForUpdates: "檢查更新…",
		edit: "編輯",
		view: "顯示方式",
		actualSize: "實際大小",
		zoomIn: "放大",
		zoomOut: "縮小",
		upToDate: "已是最新版本。",
		upToDateDetail: (version) => `LearnHarness ${version} 是最新版本。`,
		checkFailed: "無法檢查更新。",
	},
};

const LANGUAGES = Object.keys(STRINGS);

/** One BCP-47 tag → a shipped language, or null (src/core/language.ts). */
function languageOfTag(tag) {
	const t = String(tag ?? "").trim().toLowerCase().replace(/_/g, "-");
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

/** The language a stored setting runs ("system" → the OS preference list). */
function resolveLanguage(setting, preferred) {
	if (LANGUAGES.includes(setting)) return setting;
	for (const tag of preferred ?? []) {
		const lang = languageOfTag(tag);
		if (lang) return lang;
	}
	return "en";
}

function menuStrings(language) {
	return STRINGS[language] ?? STRINGS.en;
}

module.exports = { LANGUAGES, languageOfTag, resolveLanguage, menuStrings };
