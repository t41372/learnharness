/**
 * The shell namespace in Chinese (i18n wave, 2026-10-25): the sidebar row,
 * the minimal home's summary, the delete dialog, and the background-agents
 * strip render in the provider's language — zh-CN and zh-TW with their own
 * vocabulary (会话 / 對話) — while server codes and the runner's refusal
 * lines map to translated copy at render. Without a provider every surface
 * stays English (the reference the other render suites pin).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, i18n } from "../components/i18n/index.ts";
import { SessionRow, timeAgo } from "../components/sidebar.tsx";
import { KnowledgeSummary } from "../components/minimal-home.tsx";
import { DeleteSessionBody } from "../components/delete-session-dialog.tsx";
import { ActivitySection, type ActivityFeed } from "../components/activity-dock.tsx";
import type { Language } from "../src/core/index.ts";
import type { ChatListItem } from "../src/core/index.ts";

function inLanguage(language: Language, node: React.ReactElement): string {
	return renderToStaticMarkup(
		<I18nProvider setting={language} language={language}>
			{node}
		</I18nProvider>,
	);
}

const chat = {
	id: "c1",
	title: "Wave mechanics",
	kind: "practice",
	updatedAt: new Date().toISOString(),
	pendingQuestion: true,
	busy: false,
	compacting: false,
} as unknown as ChatListItem;

const summary = (
	<KnowledgeSummary propositions={12} chains={1} teachSessions={3} practiceSessions={0} importedNotes={4} />
);

const deleteBody = (failureCode: string, error: string) => (
	<DeleteSessionBody
		chat={{ id: "c1", title: "Orbital mechanics" }}
		traces={false}
		busy={false}
		failure={{ code: failureCode, error }}
		onTraces={() => {}}
		onClose={() => {}}
		onRun={() => {}}
	/>
);

const refusedFeed: ActivityFeed = {
	jobs: [
		{
			id: "j1",
			kind: "research",
			chatId: "c1",
			toolCallId: "t1",
			status: "error",
			activity: "failed",
			error: "No model configured — set up your models first (missing: vision)",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			title: "Limits lesson",
			contextLimit: null,
		},
	],
	extractions: [{ id: "cx", chatId: "cx", title: "Old lesson", phase: "merging", startedAt: Date.now() }],
};

describe("shell in Simplified Chinese (zh-CN)", () => {
	it("the session row: meta line and the practice badge", () => {
		const html = inLanguage("zh-CN", <SessionRow chat={chat} active={false} onOpen={() => {}} />);
		assert.ok(html.includes("等待输入 · 刚刚"), html);
		assert.ok(html.includes('aria-label="练习会话"'));
		assert.ok(html.includes("Wave mechanics"), "the learner's title never translates");
	});

	it("the minimal home's summary — counts with Chinese measure words", () => {
		const html = inLanguage("zh-CN", summary);
		for (const line of ["12 个命题", "1 条推理链", "3 个教学会话", "0 个练习会话", "4 篇导入的笔记"]) {
			assert.ok(html.includes(line), line);
		}
	});

	it("the delete dialog: copy, and a server code mapped to its translated line", () => {
		const html = inLanguage(
			"zh-CN",
			deleteBody("jobs_running", "Background jobs are still running in this session — try again when they finish"),
		);
		assert.ok(html.includes("删除会话？"));
		assert.ok(html.includes("同时移除它在图谱中的痕迹"));
		assert.ok(html.includes("该会话中仍有后台任务在运行"));
		assert.ok(!html.includes("Background jobs are still running"), "the known code renders translated");
		assert.match(html, /data-testid="delete-confirm"[^>]*>删除</);
	});

	it("an unknown server code shows the server's line as received", () => {
		const html = inLanguage("zh-CN", deleteBody("bad_mode", "mode must be preserve-graph or delete-nodes"));
		assert.ok(html.includes("mode must be preserve-graph or delete-nodes"));
	});

	it("the background-agents strip: header, the refusal line, the extraction phase", () => {
		const html = inLanguage("zh-CN", <ActivitySection feed={refusedFeed} />);
		assert.ok(html.includes("后台Agent"));
		assert.ok(html.includes("需要设置模型"), "toBlobs' English refusal line maps at render");
		assert.ok(!html.includes("needs model setup"));
		assert.ok(html.includes("提取——合并中"));
	});

	it("timeAgo takes the caller's t", () => {
		const t = i18n.getFixedT("zh-CN", "shell");
		const now = new Date("2026-01-02T12:00:00.000Z");
		assert.equal(timeAgo("2026-01-02T11:55:00.000Z", now, t), "5分钟前");
		assert.equal(timeAgo("2025-06-02T12:00:00.000Z", now, t), "2025-06-02", "the ISO date is locale-neutral");
	});
});

describe("shell in Traditional Chinese (zh-TW)", () => {
	it("the session row uses Taiwan vocabulary (對話, not 会话)", () => {
		const html = inLanguage("zh-TW", <SessionRow chat={chat} active={false} onOpen={() => {}} />);
		assert.ok(html.includes("等待輸入 · 剛剛"), html);
		assert.ok(html.includes('aria-label="練習對話"'));
	});

	it("the minimal home's summary", () => {
		const html = inLanguage("zh-TW", summary);
		for (const line of ["12 個命題", "1 條推理鏈", "3 個教學對話", "4 篇匯入的筆記"]) {
			assert.ok(html.includes(line), line);
		}
	});

	it("the delete dialog", () => {
		const html = inLanguage("zh-TW", deleteBody("network", "Delete failed — network error. Try again."));
		assert.ok(html.includes("刪除對話？"));
		assert.ok(html.includes("刪除失敗：網路錯誤。請重試。"));
		assert.match(html, /data-testid="delete-cancel"[^>]*>取消</);
	});

	it("the background-agents strip", () => {
		const html = inLanguage("zh-TW", <ActivitySection feed={refusedFeed} />);
		assert.ok(html.includes("背景Agent"));
		assert.ok(html.includes("需要設定模型"));
		assert.ok(html.includes("擷取——合併中"));
	});
});

describe("shell without a provider", () => {
	it("stays English — the reference copy", () => {
		const html = renderToStaticMarkup(summary);
		assert.ok(html.includes("12 propositions") && html.includes("1 chain<"));
		const row = renderToStaticMarkup(<SessionRow chat={chat} active={false} onOpen={() => {}} />);
		assert.ok(row.includes("Waiting for input · just now"));
	});
});
