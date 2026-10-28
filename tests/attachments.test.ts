import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createAttachmentStore } from "../src/store/attachments.ts";
import {
	attachmentContent,
	resolveAttachments,
	serveAttachment,
	uploadAttachment,
} from "../src/server/attachments.ts";
import { MAX_ATTACHMENT_BYTES, parseAttachments } from "../src/core/attachments.ts";
import { inputAppends, parseChatInput, parseUserSteerInput } from "../src/core/input-events.ts";
import {
	newAnswerResult,
	newThinkingMessage,
	newUserMessage,
	toLlmMessages,
	type LhMessage,
} from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import { estimateTokens } from "../src/core/compaction.ts";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "lh-attachment-test-"));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const store = createAttachmentStore(folder);
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2XkAAAAASUVORK5CYII=",
	"base64",
);
const image = store.put("screen.png", png);
const text = store.put("notes.ts", Buffer.from("export const answer = 42;"));

function request(files: File[]): Request {
	const form = new FormData();
	for (const file of files) form.append("file", file);
	return new Request("http://test/api/attachments", { method: "POST", body: form });
}

describe("attachment storage and transport", () => {
	it("preserves immutable bytes and canonical metadata across store reloads, without path traversal", () => {
		const reloaded = createAttachmentStore(folder);
		assert.deepEqual(reloaded.get(image.id), image);
		assert.deepEqual(Buffer.from(reloaded.read(image.id)), png);
		assert.equal(store.put("../../name.txt", Buffer.from("hello")).name, "name.txt");
		assert.throws(() => store.get("../../secret"), /Invalid/);
		assert.deepEqual(resolveAttachments([{ ...image, name: "forged.pdf", kind: "pdf" }], store), [image]);
	});
	it("uploads one file, serves its bytes, and downloads with safe names and MIME headers", async () => {
		const response = await uploadAttachment(
			request([new File([png], "screenshot.png", { type: "application/octet-stream" })]),
			store,
		);
		assert.equal(response.status, 201);
		const { attachment } = await response.json();
		assert.equal(attachment.kind, "image");
		const raw = serveAttachment(attachment.id, true, store);
		assert.equal(raw.status, 200);
		assert.equal(raw.headers.get("content-type"), "image/png");
		assert.match(raw.headers.get("content-disposition")!, /^attachment;/);
		assert.equal(raw.headers.get("x-content-type-options"), "nosniff");
		assert.deepEqual(Buffer.from(await raw.arrayBuffer()), png);
		assert.equal(serveAttachment("att_" + "0".repeat(32), false, store).status, 404);
	});
	it("rejects oversized uploads, unsupported binary formats, malformed multipart, and duplicate references", async () => {
		assert.equal(
			(await uploadAttachment(request([new File(["x"], "x.txt"), new File(["y"], "y.txt")]), store))
				.status,
			400,
		);
		assert.equal(
			(
				await uploadAttachment(
					request([new File([new Uint8Array([0, 255, 0])], "image.png", { type: "image/png" })]),
					store,
				)
			).status,
			415,
		);
		assert.equal(
			(
				await uploadAttachment(
					new Request("http://test", {
						method: "POST",
						body: "x",
						headers: { "content-length": String(MAX_ATTACHMENT_BYTES + 1024 * 1024 + 1) },
					}),
					store,
				)
			).status,
			413,
		);
		assert.throws(() => store.put("big.txt", new Uint8Array(MAX_ATTACHMENT_BYTES + 1)), /20 MB/);
		assert.throws(() => store.put("binary.txt", new Uint8Array([0, 1])), /UTF-8/);
		assert.throws(() => parseAttachments([image, image]), /duplicate/);
		assert.throws(() => parseAttachments(Array(11).fill(image)), /at most 10/);
	});
	it("keeps PDFs available to the existing PDF reader and text/code files to the read tool", () => {
		const pdf = store.put(
			"paper.pdf",
			fs.readFileSync(new URL("./fixtures/sample-3page.pdf", import.meta.url)),
		);
		assert.equal(pdf.kind, "pdf");
		assert.match(
			attachmentContent([pdf], store)[0]!.type === "text"
				? (attachmentContent([pdf], store)[0] as { text: string }).text
				: "",
			/Use the pdf tool/,
		);
		assert.match((attachmentContent([text], store)[0] as { text: string }).text, /Use the read tool/);
		assert.equal(fs.readFileSync(store.filePath(text.id), "utf8"), "export const answer = 42;");
	});
});

describe("attachments in the native conversation record", () => {
	it("accepts attachment-only messages, practice answers, and mid-turn steers while refusing empty input", () => {
		const input = parseChatInput({ type: "text", text: "", attachments: [image] });
		const [message] = inputAppends({ messages: [] }, input);
		assert.deepEqual(message!.attachments, [image]);
		assert.throws(() => parseChatInput({ type: "text", text: "" }), /non-empty/);
		assert.equal(
			parseChatInput({ type: "thinking", problemCallId: "p", text: "", attachments: [image] }).type,
			"thinking",
		);
		assert.deepEqual(
			parseUserSteerInput({ type: "steer", id: "steer_x", text: "", attachments: [image] }).attachments,
			[image],
		);
	});
	it("hydrates chat, question-answer, and practice images only for the model, preserving references for history", () => {
		const answer = newAnswerResult("q", "explain", {
			kind: "explain",
			questionText: "Explain",
			text: "",
			answeredAt: "now",
			attachments: [image],
		});
		const messages = [
			newUserMessage("Look", [image, text]),
			answer,
			newThinkingMessage("p", "My work", [image]),
		];
		const wire = toLlmMessages(messages, (refs) => attachmentContent(refs, store));
		for (const m of wire) {
			assert.equal("attachments" in m, false);
			assert.ok(Array.isArray(m.content));
			assert.ok(m.content.some((c) => c.type === "image" && c.data === png.toString("base64")));
		}
		assert.ok(
			!JSON.stringify(messages).includes(png.toString("base64")),
			"the durable record contains no image bytes",
		);
		assert.deepEqual(projectView(messages)[0]!.parts.find((p) => p.type === "data-attachments")!.data, [
			image,
			text,
		]);
		assert.deepEqual((messages[2] as { details: { attachments: unknown } }).details.attachments, [image]);
	});
	it("counts referenced images in context estimates and never loads images discarded by compaction", () => {
		const referenced = newUserMessage("", [image]);
		const hydrated = toLlmMessages([referenced], (refs) => attachmentContent(refs, store));
		assert.equal(
			estimateTokens(toLlmMessages([referenced]) as LhMessage[]),
			estimateTokens(hydrated as LhMessage[]),
		);
		const kept = newUserMessage("Kept");
		const compacted: LhMessage = {
			id: "cut",
			role: "custom",
			customType: "compaction",
			content: "Summary",
			display: true,
			timestamp: 1,
			details: { firstKeptMessageId: kept.id, summary: "Summary" },
		};
		let reads = 0;
		toLlmMessages([referenced, kept, compacted], (refs) => {
			reads += refs.length;
			return attachmentContent(refs, store);
		});
		assert.equal(reads, 0);
	});
});
