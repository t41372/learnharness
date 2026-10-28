/**
 * Every interface string, bundled (i18n wave, 2026-10-25). One JSON file
 * per namespace per language under locales/<lang>/<ns>.json — English is
 * the reference: the Chinese files carry exactly its keys (pinned by
 * tests/i18n-locales.test.ts), and the key TYPES derive from it
 * (./i18next.d.ts), so a mistyped key fails tsc.
 *
 * Namespaces follow the shell's areas so each area's copy lives in one
 * file: common (shared words, shortcut labels), shell (navigation, home,
 * setup, docks), chat (the session surface), graph (graph, chains, plan),
 * settings (the settings dialog), artifacts (cards, markdown, dictation).
 */

import enArtifacts from "@/locales/en/artifacts.json";
import enChat from "@/locales/en/chat.json";
import enCommon from "@/locales/en/common.json";
import enGraph from "@/locales/en/graph.json";
import enSettings from "@/locales/en/settings.json";
import enShell from "@/locales/en/shell.json";
import zhCNArtifacts from "@/locales/zh-CN/artifacts.json";
import zhCNChat from "@/locales/zh-CN/chat.json";
import zhCNCommon from "@/locales/zh-CN/common.json";
import zhCNGraph from "@/locales/zh-CN/graph.json";
import zhCNSettings from "@/locales/zh-CN/settings.json";
import zhCNShell from "@/locales/zh-CN/shell.json";
import zhTWArtifacts from "@/locales/zh-TW/artifacts.json";
import zhTWChat from "@/locales/zh-TW/chat.json";
import zhTWCommon from "@/locales/zh-TW/common.json";
import zhTWGraph from "@/locales/zh-TW/graph.json";
import zhTWSettings from "@/locales/zh-TW/settings.json";
import zhTWShell from "@/locales/zh-TW/shell.json";
import type { Language } from "@/src/core";

export const NAMESPACES = ["common", "shell", "chat", "graph", "settings", "artifacts"] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** The reference (English) resources — the source of the key types. */
export const EN_RESOURCES = {
	common: enCommon,
	shell: enShell,
	chat: enChat,
	graph: enGraph,
	settings: enSettings,
	artifacts: enArtifacts,
};

export const RESOURCES: Record<Language, Record<Namespace, object>> = {
	en: EN_RESOURCES,
	"zh-CN": {
		common: zhCNCommon,
		shell: zhCNShell,
		chat: zhCNChat,
		graph: zhCNGraph,
		settings: zhCNSettings,
		artifacts: zhCNArtifacts,
	},
	"zh-TW": {
		common: zhTWCommon,
		shell: zhTWShell,
		chat: zhTWChat,
		graph: zhTWGraph,
		settings: zhTWSettings,
		artifacts: zhTWArtifacts,
	},
};
