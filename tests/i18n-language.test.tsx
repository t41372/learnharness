/**
 * The interface language (i18n wave, 2026-10-25): tag narrowing, the
 * Accept-Language reading, the setting's resolution, its settings-record
 * round trip, and the provider rendering a surface in the chosen language
 * (render tests without a provider stay in English — the reference).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	languageOfPreferences,
	languageOfTag,
	parseAcceptLanguage,
	resolveLanguage,
} from "../src/core/language.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { parseGeneralSettingsBody } from "../src/server/settings-body.ts";
import { I18nProvider } from "../components/i18n/index.ts";
import { LanguageRow } from "../components/settings/settings-dialog.tsx";

describe("languageOfTag", () => {
	it("English tags", () => {
		assert.equal(languageOfTag("en"), "en");
		assert.equal(languageOfTag("en-GB"), "en");
	});
	it("Chinese splits by script, then by region", () => {
		assert.equal(languageOfTag("zh"), "zh-CN");
		assert.equal(languageOfTag("zh-CN"), "zh-CN");
		assert.equal(languageOfTag("zh-SG"), "zh-CN");
		assert.equal(languageOfTag("zh-Hans-HK"), "zh-CN", "an explicit script wins over the region");
		assert.equal(languageOfTag("zh-TW"), "zh-TW");
		assert.equal(languageOfTag("zh-HK"), "zh-TW");
		assert.equal(languageOfTag("zh_MO"), "zh-TW");
		assert.equal(languageOfTag("zh-Hant"), "zh-TW");
	});
	it("other languages are not shipped", () => {
		assert.equal(languageOfTag("fr-FR"), null);
		assert.equal(languageOfTag(""), null);
	});
});

describe("preferences", () => {
	it("the first shipped language in the list wins; English when none", () => {
		assert.equal(languageOfPreferences(["fr", "zh-TW", "en"]), "zh-TW");
		assert.equal(languageOfPreferences(["fr", "de"]), "en");
		assert.equal(languageOfPreferences([]), "en");
	});
	it("Accept-Language orders by quality and drops q=0", () => {
		assert.deepEqual(parseAcceptLanguage("en;q=0.5, zh-TW, fr;q=0"), ["zh-TW", "en"]);
		assert.deepEqual(parseAcceptLanguage(null), []);
	});
	it("an explicit setting ignores the platform", () => {
		assert.equal(resolveLanguage("zh-CN", ["en"]), "zh-CN");
		assert.equal(resolveLanguage("system", ["zh-HK"]), "zh-TW");
	});
});

describe("general.language in the settings record", () => {
	it("factory default is system", () => {
		assert.equal(resolveSettings(null).general.language, "system");
	});
	it("the sanitizer keeps a known setting and drops an unknown one", () => {
		assert.equal(sanitizeUserSettings({ version: 1, general: { language: "zh-TW" } })?.general?.language, "zh-TW");
		assert.equal(sanitizeUserSettings({ version: 1, general: { language: "fr" } })?.general?.language, undefined);
	});
	it("the PUT parser is strict", () => {
		assert.deepEqual(parseGeneralSettingsBody({ language: "en", autoUpdate: false }), {
			ok: true,
			settings: { language: "en", autoUpdate: false },
		});
		const bad = parseGeneralSettingsBody({ language: "fr" });
		assert.equal(bad.ok, false);
	});
});

describe("I18nProvider", () => {
	const row = <LanguageRow value="system" onChange={() => {}} />;
	it("without a provider the reference English renders", () => {
		const html = renderToStaticMarkup(row);
		assert.ok(html.includes("Language"));
		assert.ok(html.includes("Follow system"));
	});
	it("renders in the resolved language; the language names never translate", () => {
		const cn = renderToStaticMarkup(<I18nProvider setting="zh-CN" language="zh-CN">{row}</I18nProvider>);
		assert.ok(cn.includes("跟随系统"));
		const tw = renderToStaticMarkup(<I18nProvider setting="system" language="zh-TW">{row}</I18nProvider>);
		assert.ok(tw.includes("跟隨系統"));
		for (const html of [cn, tw]) {
			assert.ok(html.includes("English") && html.includes("简体中文") && html.includes("繁體中文"));
		}
	});
});
