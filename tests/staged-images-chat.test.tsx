/**
 * Staged images ride the right upstream channel from the production Chat:
 * composer text and steer, a text-mode answer, question thinking, reading
 * thinking and practice thinking. The POST body is the assertion; staged
 * images clear on acceptance only and survive a refusal.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import test from "node:test";
import { Chat } from "../components/chat.tsx";
import { stagedImageKey, stagedImages, type StagedImageSurface } from "../components/staged-images.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { mountPluginChrome } from "./helpers/plugin-chrome.tsx";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const image = (name: string) => new File([PNG], name, { type: "image/png" });
const expected = { type: "image", mimeType: "image/png", data: Buffer.from(PNG).toString("base64") };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (id: string, content: unknown[], stopReason = "toolUse"): LhMessage => ({ id, role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: 1, stopReason, usage, content } as LhMessage);
const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

type Post = { url: string; input: Record<string, unknown> };
type Session = { document: Document; posts: Post[]; click(element: Element): Promise<void>; submit(field: string): Promise<void>; settle(): Promise<void> };
async function session({ chatId, messages, kind, inFlight = false, refuse = false, initialPrompt }: { chatId: string; messages: LhMessage[]; kind?: "practice"; inFlight?: boolean; refuse?: boolean; initialPrompt?: string }, run: (f: Session) => Promise<void>) {
	const posts: Post[] = [];
	const savedObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
	Object.assign(globalThis, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
	let fixture: Awaited<ReturnType<typeof mountPluginChrome>> | undefined;
	try {
		fixture = await mountPluginChrome({ activate() {} }, <Chat chatId={chatId} title="Images" initialMessages={messages} kind={kind} initiallyInFlight={inFlight} initialPrompt={initialPrompt} />, {
			pathname: `/chat/${chatId}`,
			prepareDom(dom) {
				const prototype = dom.window.HTMLElement.prototype;
				const saved = [[dom.window, "location"], [dom.window, "localStorage"], [globalThis, "sessionStorage"], [prototype, "getAnimations"], [prototype, "offsetWidth"]]
					.map(([object, key]) => ({ object: object as object, key: key as string, descriptor: Object.getOwnPropertyDescriptor(object, key as string) }));
				const values = new Map<string, string>();
				Object.defineProperty(dom.window, "location", { configurable: true, value: new URL(`http://fixture/chat/${chatId}`) });
				Object.defineProperty(dom.window, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
				const session = new Map<string, string>();
				Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) } });
				Object.defineProperty(prototype, "getAnimations", { configurable: true, value: () => [] });
				Object.defineProperty(prototype, "offsetWidth", { configurable: true, get() { return this.clientWidth; } });
				return () => { for (const { object, key, descriptor } of saved) { if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key); } };
			},
			fetch: async (input, init) => {
				const url = String(input);
				if (init?.method === "POST" && (url === "/api/chat" || url.endsWith("/steer"))) {
					posts.push({ url, input: (JSON.parse(String(init.body)) as { input: Record<string, unknown> }).input });
					return refuse ? new Response("The selected model does not support images. Your input has been kept.", { status: 400 }) : Response.json({ accepted: true });
				}
				if (url === "/api/models") return Response.json({ providers: [{ id: "fixture", keyPresent: true }], models: [], slots: {} });
				if (url === "/api/settings") return Response.json({});
				if (url === `/api/chats/${chatId}`) return Response.json({ id: chatId, messages });
				if (url === `/api/chats/${chatId}/side-chats`) return Response.json({ threads: [] });
				if (url.startsWith("/api/jobs")) return Response.json({ jobs: [], turnInFlight: inFlight });
				// A running turn's stream stays open so the composer steers.
				if (url.includes("/stream")) return inFlight ? new Response(new ReadableStream({ start() {} })) : new Response("data: [DONE]\n\n");
				return Response.json({});
			},
		});
		const mounted = fixture;
		const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await wait(5); }); };
		await settle();
		// linkedom has no implicit submission: dispatch the form's submit.
		const submit = async (field: string) => {
			const form = mounted.document.querySelector(field)!.closest("form")!;
			await act(async () => { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
			await settle();
		};
		await run({ document: mounted.document, posts, click: element => mounted.click(element as HTMLElement), submit, settle });
	} finally {
		await fixture?.close();
		if (savedObserver) Object.defineProperty(globalThis, "ResizeObserver", savedObserver); else Reflect.deleteProperty(globalThis, "ResizeObserver");
	}
}

/** Paste into the field that owns the draft: proves the dock and chat.tsx agree on its key. */
async function stage(f: Session, chatId: string, surface: StagedImageSurface, target = "") {
	const key = stagedImageKey(chatId, surface, target);
	const field = f.document.querySelector(`[data-staged-image-key=${JSON.stringify(key)}]`);
	assert.ok(field, `a field owns ${key}`);
	const file = image(`${surface}.png`);
	const clipboardData = { getData: () => "", files: [file], items: [{ kind: "file", type: file.type, getAsFile: () => file }] };
	await act(async () => { field.dispatchEvent(Object.assign(new window.Event("paste", { bubbles: true, cancelable: true }), { clipboardData })); });
	await f.settle();
	assert.equal(stagedImages.get(key).images.length, 1);
	return key;
}

const explain = (id: string) => [assistant("m1", [{ type: "text", text: "Lesson." }, { type: "toolCall", id, name: "explain", arguments: { question: "Explain it", correctAnswer: "Fixture" } }])];
const quiz = (id: string) => [assistant("m1", [{ type: "text", text: "Lesson." }, { type: "toolCall", id, name: "quiz", arguments: { type: "predict", question: "Choose", options: [{ label: "One", value: "one" }, { label: "Two", value: "two" }], correctAnswer: "one", explanation: "Fixture" } }])];

for (const refuse of [false, true]) test(`composer text carries its images; ${refuse ? "a refusal keeps them" : "acceptance clears them"}`, async () => {
	const chatId = `img-text-${refuse}`;
	await session({ chatId, messages: [assistant("m1", [{ type: "text", text: "Hello." }], "stop")], refuse }, async f => {
		const key = await stage(f, chatId, "composer");
		const send = f.document.querySelector<HTMLButtonElement>('[data-testid="composer"] button[aria-label="Send"]')!;
		assert.equal(send.disabled, false, "images alone make the composer sendable");
		await f.submit('[data-testid="composer"]');
		assert.equal(f.posts.length, 1);
		assert.deepEqual(f.posts[0]!.input, { type: "text", text: "", images: [expected] });
		assert.equal(stagedImages.get(key).images.length, refuse ? 1 : 0);
	});
});

test("a composer send while a turn runs steers with the images", async () => {
	const chatId = "img-steer";
	await session({ chatId, messages: [assistant("m1", [{ type: "text", text: "Hello." }], "stop")], inFlight: true }, async f => {
		const key = await stage(f, chatId, "composer");
		await f.submit('[data-testid="composer"]');
		assert.equal(f.posts.length, 1);
		assert.match(f.posts[0]!.url, /\/steer$/);
		assert.deepEqual(f.posts[0]!.input.images, [expected]);
		assert.equal(stagedImages.get(key).images.length, 0);
	});
});

test("a text-mode answer carries answer images; acceptance clears them", async () => {
	const chatId = "img-answer";
	await session({ chatId, messages: explain("call_a") }, async f => {
		const key = await stage(f, chatId, "answer", "call_a");
		const submit = f.document.querySelector<HTMLButtonElement>('[data-testid="answer-field"] button[type="submit"]')!;
		assert.equal(submit.disabled, false, "answer images alone make a text answer");
		await f.submit('[data-testid="answer-field"]');
		const answer = f.posts[0]!.input.answer as { images?: unknown };
		assert.deepEqual(answer.images, { answer: [expected] });
		assert.equal(stagedImages.get(key).images.length, 0);
	});
});

test("a select-mode answer carries thinking images and still needs a selection", async () => {
	const chatId = "img-thinking";
	await session({ chatId, messages: quiz("call_q") }, async f => {
		const key = await stage(f, chatId, "thinking", "call_q");
		const submit = () => f.document.querySelector<HTMLButtonElement>('[data-testid="thinking-field"] button[type="submit"]')!;
		assert.equal(submit().disabled, true);
		await f.click(f.document.querySelector('[data-kbdrow="0"]')!);
		assert.equal(submit().disabled, false);
		await f.submit('[data-testid="thinking-field"]');
		assert.deepEqual((f.posts[0]!.input.answer as { images?: unknown }).images, { thinking: [expected] });
		assert.equal(stagedImages.get(key).images.length, 0);
	});
});

test("practice thinking carries its images", async () => {
	const chatId = "img-practice";
	const messages = [
		assistant("m1", [{ type: "toolCall", id: "problem_1", name: "problem", arguments: { statement: "Solve it" } }]),
		{ id: "r1", role: "toolResult", toolCallId: "problem_1", toolName: "problem", content: [{ type: "text", text: "posed" }], isError: false, timestamp: 2 } as LhMessage,
		assistant("m2", [{ type: "text", text: "Go." }], "stop"),
	];
	await session({ chatId, messages, kind: "practice" }, async f => {
		const key = await stage(f, chatId, "practiceThinking", "problem_1");
		const send = f.document.querySelector<HTMLButtonElement>('[data-testid="practice-send"]')!;
		assert.equal(send.disabled, false, "images alone make a practice submission");
		await f.click(send); await f.settle();
		assert.deepEqual(f.posts[0]!.input, { type: "thinking", problemCallId: "problem_1", occurrence: f.posts[0]!.input.occurrence, text: "", images: [expected] });
		assert.equal(stagedImages.get(key).images.length, 0);
	});
});

test("a teach-phase check carries reading-thinking images beside its answer images", async () => {
	const chatId = "img-reading";
	const messages = [
		assistant("m0", [{ type: "toolCall", id: "probe_done_1", name: "probe_done", arguments: {} }]),
		{ id: "r0", role: "toolResult", toolCallId: "probe_done_1", toolName: "probe_done", content: [{ type: "text", text: "{\"ok\":true}" }], details: { ok: true }, isError: false, timestamp: 2 } as LhMessage,
		assistant("m1", [{ type: "text", text: "Teaching." }, { type: "toolCall", id: "call_r", name: "explain", arguments: { type: "check", nodeId: "n1", question: "Explain it", correctAnswer: "Fixture" } }]),
	];
	await session({ chatId, messages }, async f => {
		assert.ok(f.document.querySelector('[data-testid="reading-thinking-field"] [data-staged-image-key]'), "the reading field stages its own images");
		const reading = await stage(f, chatId, "readingThinking", "call_r");
		const answer = await stage(f, chatId, "answer", "call_r");
		await f.submit('[data-testid="answer-field"]');
		assert.deepEqual((f.posts[0]!.input.answer as { images?: unknown }).images, { answer: [expected], readingThinking: [expected] });
		assert.equal(stagedImages.get(reading).images.length + stagedImages.get(answer).images.length, 0);
	});
});

test("the opening prompt carries the images handed over from Home", async () => {
	const chatId = "img-opening";
	const key = stagedImageKey(chatId, "composer");
	await stagedImages.add(key, [image("opening.png")]);
	await session({ chatId, messages: [], initialPrompt: "Teach me" }, async f => {
		assert.equal(f.posts.length, 1);
		assert.deepEqual(f.posts[0]!.input, { type: "text", text: "Teach me", images: [expected] });
		assert.equal(stagedImages.get(key).images.length, 0);
	});
});
