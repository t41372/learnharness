/**
 * The cards, markdown blocks and dictation in Chinese (i18n wave,
 * 2026-10-25): under the provider the shells render in the resolved
 * language, while agent-written content (a brief, a source title) stays
 * as written. Without a provider the reference English renders — the
 * render tests' baseline.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n/index.ts";
import type { Language } from "../src/core/language.ts";
import type { JobRecord } from "../src/core/contracts.ts";
import { JobsContext } from "../components/jobs-context.ts";
import { DispatchCard } from "../components/artifacts/dispatch-card.tsx";
import { SubagentSteerCard } from "../components/artifacts/steer-card.tsx";
import { DictationBar, type Dictation, type DictationError } from "../components/dictation.tsx";

function inLanguage(language: Language, node: React.ReactNode): string {
	return renderToStaticMarkup(
		<I18nProvider setting={language} language={language}>
			{node}
		</I18nProvider>,
	);
}

const job = (over: Partial<JobRecord>): JobRecord => ({
	id: "j1",
	kind: "research",
	chatId: "c1",
	toolCallId: "t1",
	status: "running",
	activity: "",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...over,
});

const dispatch = (jobs: JobRecord[]) => (
	<JobsContext.Provider value={jobs}>
		<DispatchCard toolCallId="t1" kind="research" />
	</JobsContext.Provider>
);

const researchSteer = {
	id: "m1",
	role: "user",
	parts: [
		{
			type: "data-subagent-artifact",
			data: {
				kind: "research",
				result: {
					brief: "Plato founded the Academy.",
					sources: [
						{ title: "Britannica", url: "https://britannica.com/plato" },
						{ title: "IEP", url: "https://iep.utm.edu/plato/" },
					],
				},
			},
		},
	],
};

const dictation = (error: DictationError | null): Dictation => ({
	phase: "idle",
	error,
	levelRef: { current: 0 },
	active: false,
	toggle: () => {},
	stop: () => {},
	finish: async () => {},
	cancel: () => {},
	clearError: () => {},
});

describe("artifacts in Chinese", () => {
	it("the dispatch card: kind label, pending line, settled status", () => {
		const cn = inLanguage("zh-CN", dispatch([]));
		assert.ok(cn.includes("研究 Agent"));
		assert.ok(cn.includes("已派发…"));
		const tw = inLanguage("zh-TW", dispatch([]));
		assert.ok(tw.includes("已派出…"));
		assert.ok(inLanguage("zh-TW", dispatch([job({ status: "done" })])).includes("已送達"));
		assert.ok(renderToStaticMarkup(dispatch([])).includes("Dispatched…"), "English without a provider");
	});

	it("the research steer badge translates its shell; the brief and sources stay as written", () => {
		const cn = inLanguage("zh-CN", <SubagentSteerCard message={researchSteer as never} />);
		assert.ok(cn.includes("已完成"));
		assert.ok(cn.includes("2 个来源"));
		assert.ok(cn.includes("查看摘要"));
		assert.ok(cn.includes("研究摘要"), "the brief card's label");
		assert.ok(cn.includes("Plato founded the Academy."), "agent-written brief untouched");
		assert.ok(cn.includes("Britannica"), "source titles untouched");
		const tw = inLanguage("zh-TW", <SubagentSteerCard message={researchSteer as never} />);
		assert.ok(tw.includes("2 個來源"));
		assert.ok(tw.includes("檢視摘要"));
	});

	it("the idle dictation button, and its failure lines", () => {
		assert.ok(inLanguage("zh-CN", <DictationBar dictation={dictation(null)} />).includes("开始语音输入"));
		assert.ok(inLanguage("zh-TW", <DictationBar dictation={dictation(null)} />).includes("語音輸入"));
		const keyless = inLanguage("zh-CN", <DictationBar dictation={dictation({ kind: "keyless" })} />);
		assert.ok(keyless.includes("语音输入需要 Deepgram 密钥"));
		const lost = inLanguage("zh-TW", <DictationBar dictation={dictation({ kind: "connectionLost", code: 1006 })} />);
		assert.ok(lost.includes("Deepgram 連線中斷（1006）"));
		// Text the browser wrote is shown as given.
		const raw = inLanguage("zh-CN", <DictationBar dictation={dictation({ kind: "message", text: "Requested device not found" })} />);
		assert.ok(raw.includes("Requested device not found"));
		// English without a provider: the pinned keyless line.
		const en = renderToStaticMarkup(<DictationBar dictation={dictation({ kind: "keyless" })} />);
		assert.ok(en.includes("Dictation needs a Deepgram key"));
		assert.ok(en.includes("Dictation failed: Dictation needs a Deepgram key"));
	});
});
