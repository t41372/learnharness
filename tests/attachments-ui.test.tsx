import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { Composer } from "../components/composer.tsx";
import { PracticeDock } from "../components/practice-dock.tsx";
import { QuestionDock } from "../components/question-dock.tsx";
import { useAttachmentDraft } from "../components/attachments.tsx";
import { I18nProvider } from "../components/i18n/index.ts";
import type { Attachment, QuestionAnswerData } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	React,
	window: dom.window,
	document: dom.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
const ref: Attachment = {
	id: "att_" + "a".repeat(32),
	name: "answer.py",
	size: 12,
	mimeType: "text/plain",
	kind: "text",
};

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	globalThis.fetch = originalFetch;
});

async function mount(node: React.ReactNode) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(node));
}

async function paste(selector: string) {
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: { items: [{ kind: "file", getAsFile: () => new File(["print(42)"], "answer.py") }] },
	});
	await act(async () => host!.querySelector(selector)!.dispatchEvent(event));
	return event;
}

function stubUploads(response = 201) {
	let count = 0;
	globalThis.fetch = async (url, init) => {
		assert.equal(url, "/api/attachments");
		assert.equal(init?.method, "POST");
		assert.equal(((init!.body as FormData).get("file") as File).name, "answer.py");
		count++;
		return Response.json({ attachment: ref }, { status: response });
	};
	return () => count;
}

test("pasting files keeps native text paste available, waits for upload, and enables an attachment-only send", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	globalThis.fetch = async () => {
		await gate;
		return Response.json({ attachment: ref }, { status: 201 });
	};
	const sends: Attachment[][] = [];
	function Form() {
		const draft = useAttachmentDraft();
		return (
			<Composer
				busy={false}
				value=""
				onChange={() => {}}
				onStop={() => {}}
				canSend={false}
				attachmentDraft={draft}
				onSend={() => sends.push(draft.current())}
			/>
		);
	}
	await mount(<Form />);
	const event = await paste("textarea");
	assert.equal(event.defaultPrevented, false, "mixed clipboard text retains native paste behavior");
	assert.ok(host!.querySelector('[aria-label="Send"]')!.hasAttribute("disabled"));
	await act(async () => release());
	assert.equal(host!.querySelector('[aria-label="Send"]')!.hasAttribute("disabled"), false);
	await act(async () =>
		host!
			.querySelector("form")!
			.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })),
	);
	assert.deepEqual(sends, [[ref]]);
});

test("failed uploads stay visible, retry, and can be removed without discarding the text draft", async () => {
	let fail = true,
		calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return Response.json({ attachment: ref }, { status: fail ? 415 : 201 });
	};
	function Form() {
		const draft = useAttachmentDraft();
		return (
			<Composer
				busy={false}
				value="Keep this draft"
				onChange={() => {}}
				onStop={() => {}}
				canSend
				attachmentDraft={draft}
				onSend={() => {}}
			/>
		);
	}
	await mount(<Form />);
	await paste("textarea");
	assert.match(host!.textContent!, /Upload failed/);
	assert.ok(host!.querySelector('[aria-label="Send"]')!.hasAttribute("disabled"));
	fail = false;
	await act(async () =>
		Array.from(host!.querySelectorAll("button"))
			.find((b) => b.textContent === "Try again")!
			.click(),
	);
	assert.equal(calls, 2);
	await act(async () => (host!.querySelector('[aria-label="Remove answer.py"]') as HTMLElement).click());
	assert.equal(host!.querySelector('[data-testid="attachment-draft"]'), null);
	assert.equal((host!.querySelector("textarea") as HTMLTextAreaElement).value, "Keep this draft");
});

test("file picker and drag-and-drop use the same upload path", async () => {
	const count = stubUploads();
	await mount(
		<Composer
			busy={false}
			value=""
			onChange={() => {}}
			onSend={() => {}}
			onStop={() => {}}
			canSend={false}
		/>,
	);
	const picker = host!.querySelector('input[type="file"]')!;
	Object.defineProperty(picker, "files", {
		value: [new File(["print(42)"], "answer.py")],
		configurable: true,
	});
	await act(async () => picker.dispatchEvent(new window.Event("change", { bubbles: true })));
	assert.equal(count(), 1);
	const drop = new window.Event("drop", { bubbles: true, cancelable: true });
	Object.defineProperty(drop, "dataTransfer", {
		value: { files: [new File(["print(42)"], "answer.py")], types: ["Files"] },
	});
	await act(async () => host!.querySelector("textarea")!.dispatchEvent(drop));
	assert.equal(drop.defaultPrevented, true);
	assert.equal(count(), 2);
});

test("Practice accepts attached work without accompanying text", async () => {
	stubUploads();
	let submitted: Attachment[] | undefined;
	await mount(
		<PracticeDock
			problemCallId="p"
			input={{ statement: "Show your work" }}
			expanded
			onExpand={() => {}}
			onSubmit={(_text, files) => {
				submitted = files;
			}}
		/>,
	);
	await paste("textarea");
	await act(async () => (host!.querySelector('[data-testid="practice-send"]') as HTMLElement).click());
	assert.deepEqual(submitted, [ref]);
});

test("free-recall answers include attachments and the picker follows Traditional Chinese", async () => {
	stubUploads();
	let answer: QuestionAnswerData | undefined;
	await mount(
		<I18nProvider setting="zh-TW" language="zh-TW">
			<QuestionDock
				toolName="recall"
				toolCallId="q"
				input={{ question: "Show a proof", correctAnswer: "A proof" }}
				expanded
				onExpand={() => {}}
				onSubmit={(value) => {
					answer = value;
				}}
			/>
		</I18nProvider>,
	);
	assert.ok(host!.querySelector('[aria-label="加入附件"]'));
	await paste("textarea");
	await act(async () =>
		host!
			.querySelector("form")!
			.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })),
	);
	assert.deepEqual(answer?.attachments, [ref]);
});
