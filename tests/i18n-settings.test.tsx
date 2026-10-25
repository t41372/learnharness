/**
 * The settings dialog in Chinese (i18n wave, 2026-10-25): under the
 * I18nProvider the dialog frame, the sections and the shortcut rows
 * render the settings namespace's zh-CN / zh-TW copy — the glossary's
 * mainland/Taiwan split visible in one assertion each — while the
 * testids stay the English-derived ones (a translated Toggle label must
 * not slug its testid to nothing). Without a provider the English
 * reference renders (render-settings.test.tsx pins that side).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n/index.ts";
import { AgentSection } from "../components/settings/agent-section.tsx";
import { GraphSection } from "../components/settings/appearance-section.tsx";
import { KeyboardSection } from "../components/settings/keyboard-section.tsx";
import { keyStatusLine } from "../components/settings/keys-section.tsx";
import { SettingsDialogBody } from "../components/settings/settings-dialog.tsx";
import type { Language } from "../src/core/index.ts";

function render(language: Language, node: React.ReactNode): string {
	return renderToStaticMarkup(<I18nProvider setting={language} language={language}>{node}</I18nProvider>);
}

const agent = <AgentSection agent={undefined} models={undefined} graph={undefined} compaction={undefined} onSectionChange={() => {}} onModelsChange={() => {}} onCompactionChange={() => {}} />;

describe("the settings dialog in Chinese", () => {
	it("zh-CN: the frame, the nav and the loading line use mainland vocabulary", () => {
		const html = render("zh-CN", <SettingsDialogBody onClose={() => {}} />);
		assert.ok(html.includes(">设置</h2>"), "the header");
		assert.ok(html.includes('aria-label="关闭设置"'));
		assert.ok(html.includes(">服务商</button>"), "Providers → 服务商");
		assert.ok(html.includes(">快捷键</button>"));
		assert.ok(html.includes("设置加载中…"));
		assert.ok(!html.includes("Loading settings"), "no English left in the frame");
	});

	it("zh-TW: the same frame in Taiwan vocabulary", () => {
		const html = render("zh-TW", <SettingsDialogBody onClose={() => {}} />);
		assert.ok(html.includes(">設定</h2>"));
		assert.ok(html.includes(">供應商</button>"), "Providers → 供應商");
		assert.ok(html.includes(">快速鍵</button>"));
		assert.ok(html.includes("設定載入中…"));
	});

	it("the agent section: slot labels, rosters and tool names translate; testids stay English", () => {
		const cn = render("zh-CN", agent);
		assert.ok(cn.includes(">主力<") && cn.includes(">经济<") && cn.includes(">视觉<"), "the slot labels");
		assert.ok(cn.includes("会话使用的主要模型"));
		assert.ok(cn.includes("工具 · 研究"), "the tool row names the tool in Chinese");
		assert.ok(cn.includes('data-testid="toggle-tool-research"'), "the toggle testid survives the translated label");
		assert.ok(cn.includes('data-testid="toggle-graph-tools"'));
		assert.ok(cn.includes("提示词片段加载中…"));
		const tw = render("zh-TW", agent);
		assert.ok(tw.includes(">經濟<") && tw.includes(">視覺<"));
		assert.ok(tw.includes("工具 · 示範"), "demo → 示範 in Taiwan");
	});

	it("the graph section keeps its toggle testids under a Chinese label", () => {
		const html = render("zh-TW", <GraphSection graph={undefined} onSectionChange={() => {}} />);
		assert.ok(html.includes(">擷取<"), "Extraction → 擷取");
		assert.ok(html.includes('data-testid="toggle-extraction-enabled"'));
		assert.ok(html.includes('data-testid="toggle-graph-rendering-enabled"'));
		assert.ok(html.includes(">4096 token</"), "the budget hint interpolates");
	});

	it("the keyboard section shows the common shortcut labels", () => {
		const cn = render("zh-CN", <KeyboardSection />);
		assert.ok(cn.includes("打开设置"), "common:shortcuts.open-settings");
		assert.ok(cn.includes(">全局<"), "the scope group");
		assert.ok(cn.includes("全部恢复默认"));
		const tw = render("zh-TW", <KeyboardSection />);
		assert.ok(tw.includes("開啟設定"));
		assert.ok(tw.includes("固定——屬於此畫面"), "displayOnly rows carry the translated hint");
	});

	it("keyStatusLine: English by default, the caller's language when given its t", async () => {
		const unset = { id: "X", info: null, present: false, masked: null, source: "none", shadowedByEnv: false } as const;
		assert.equal(keyStatusLine(unset), "not set");
		const { i18n } = await import("../components/i18n/index.ts");
		assert.equal(keyStatusLine(unset, i18n.getFixedT("zh-TW", "settings")), "未設定");
		const env = { ...unset, present: true, masked: "…ab12 (64 chars)", source: "env" } as const;
		assert.equal(keyStatusLine(env, i18n.getFixedT("zh-CN", "settings")), "…ab12 · 64 · 环境变量");
	});
});
