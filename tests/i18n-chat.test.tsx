/**
 * The session surface in Chinese (i18n wave, 2026-10-25): the composer,
 * an answered quiz card, the abort confirm, and the phase seam render in
 * the provider's language — zh-CN and zh-TW each in their own vocabulary
 * — while learner text stays verbatim. Without a provider every other
 * render test pins the English reference. Also: the session model codes
 * its own failure lines (the banner translates by code) and leaves the
 * English message the state value.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n/index.ts";
import { Composer } from "../components/composer.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { AbortTurnBody } from "../components/abort-turn-dialog.tsx";
import { PhaseDivider } from "../components/phase-divider.tsx";
import { SessionModel } from "../components/session-core.ts";
import { buildAnswer, normalizeOptions, resolveCorrect, type QuestionData } from "../src/core/question-core.ts";
import type { Language } from "../src/core/language.ts";

function inLanguage(language: Language, node: React.ReactElement): string {
	return renderToStaticMarkup(
		<I18nProvider setting={language} language={language}>
			{node}
		</I18nProvider>,
	);
}

const composer = (
	<Composer busy={false} value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} canSend={true} />
);

function quizQD(): QuestionData {
	const options = normalizeOptions([{ label: "Venus" }, { label: "Mercury" }]);
	return {
		id: "q1",
		kind: "quiz",
		question: "Which planet is closest to the sun?",
		mode: "single-select",
		options,
		correctIndices: resolveCorrect("Mercury", options).indices,
		explanation: "Mercury is the innermost planet.",
		createdAt: new Date().toISOString(),
	};
}

describe("the session surface in Chinese", () => {
	it("composer: placeholder and send label follow the language", () => {
		const cn = inLanguage("zh-CN", composer);
		assert.ok(cn.includes("提问、回答，或引导这节课的方向…"));
		assert.ok(cn.includes('aria-label="发送"'));
		const tw = inLanguage("zh-TW", composer);
		assert.ok(tw.includes("提問、回答，或引導這堂課的方向…"));
		assert.ok(tw.includes('aria-label="傳送"'), "Taiwan vocabulary, not a character conversion");
		assert.ok(!cn.includes("Ask, answer") && !tw.includes("Ask, answer"));
	});

	it("answered quiz card: verdict chip, quote marks, and the learner's own words", () => {
		const answer = buildAnswer(quizQD(), { values: ["Mercury"], thinking: "It is the first one." });
		const cn = inLanguage("zh-CN", <AnsweredCard answer={answer} />);
		assert.ok(cn.includes("测验") && cn.includes("正确") && cn.includes("你的思路"));
		assert.ok(cn.includes("解析"), "the tucked explanation toggle");
		assert.ok(cn.includes("Which planet is closest to the sun?"), "model text is never translated");
		const tw = inLanguage("zh-TW", <AnsweredCard answer={answer} />);
		assert.ok(tw.includes("測驗") && tw.includes("正確"));
		const typed = { ...buildAnswer(quizQD(), { other: "Pluto" }), kind: "ask" as const };
		assert.ok(inLanguage("zh-TW", <AnsweredCard answer={typed} />).includes("「Pluto」"), "zh-TW quotes with 「」");
	});

	it("a skipped card keeps the question as data — markup-looking text is never parsed", () => {
		const answer = { ...buildAnswer(quizQD(), { dontKnow: true }), questionText: "Is a <1>b</1> < c?", dismissed: true };
		const cn = inLanguage("zh-CN", <AnsweredCard answer={answer} />);
		assert.ok(cn.includes('<span class="font-medium">Is a &lt;1&gt;b&lt;/1&gt; &lt; c?</span>——已跳过'));
		assert.ok(renderToStaticMarkup(<AnsweredCard answer={answer} />).includes("</span> — skipped"));
	});

	it("abort confirm: the busy dismissal is one full sentence", () => {
		const cn = inLanguage("zh-CN", <AbortTurnBody mode="question" busy onClose={() => {}} onConfirm={() => {}} />);
		assert.ok(cn.includes("跳过这个问题？"));
		assert.ok(cn.includes("跳过后，老师会直接往下讲。正在进行的回复也会停止。"));
		assert.ok(cn.includes("取消"));
		const tw = inLanguage("zh-TW", <AbortTurnBody mode="problem" onClose={() => {}} onConfirm={() => {}} />);
		assert.ok(tw.includes("捨棄這道題？") && tw.includes("捨棄"));
	});

	it("the plan seam counts nodes in Chinese (one plural form)", () => {
		assert.ok(inLanguage("zh-CN", <PhaseDivider phase="plan" nodeCount={1} />).includes("计划 · 1 个节点"));
		assert.ok(inLanguage("zh-TW", <PhaseDivider phase="plan" nodeCount={4} />).includes("計畫 · 4 個節點"));
		assert.ok(renderToStaticMarkup(<PhaseDivider phase="plan" nodeCount={1} />).includes("Plan · 1 node<"));
	});
});

describe("the session model codes its own failure lines", () => {
	const fetchOf = (status: number) => (async () => new Response("", { status })) as typeof globalThis.fetch;

	it("a 409 keeps the English message and carries the turnRunning code", async () => {
		const m = new SessionModel({ chatId: "c", initialMessages: [], fetch: fetchOf(409), waitMaxMs: 0 });
		await m.send({ type: "text", text: "q" });
		assert.deepEqual(m.getState().error, {
			message: "A turn is already running — try again in a moment.",
			code: "turnRunning",
		});
	});

	it("an empty-bodied failure names its status; server text stays uncoded", async () => {
		const m = new SessionModel({ chatId: "c", initialMessages: [], fetch: fetchOf(500), waitMaxMs: 0 });
		await m.send({ type: "text", text: "q" });
		assert.deepEqual(m.getState().error, { message: "The send failed (500).", code: "sendFailed", status: 500 });
		const raw = new SessionModel({
			chatId: "c",
			initialMessages: [],
			fetch: (async () => new Response("bad input", { status: 400 })) as typeof globalThis.fetch,
		});
		await raw.send({ type: "text", text: "q" });
		assert.deepEqual(raw.getState().error, { message: "bad input" });
	});
});
