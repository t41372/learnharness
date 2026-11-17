/**
 * The one-off migration from the retired attachment store to upstream's
 * native inline images (scripts/migrate-attachments-to-inline-images.mjs):
 * dry run changes nothing, apply converts all three record kinds into the
 * shapes upstream's own constructors write, a second apply is a no-op, and
 * the result loads through the real chat store and projectView.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { migrateAttachments, USAGE } from "../scripts/migrate-attachments-to-inline-images.mjs";
import { processImage } from "../src/agent/image-processing/index.ts";
import { quoteFilePath } from "../src/core/file-paths.ts";
import { nativeAnswerContent, nativeInlineImageContent, newThinkingMessage } from "../src/core/native-messages.ts";
import { compactAnswerForModel, type QuestionAnswerData } from "../src/core/question-core.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-migrate-attachments-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const script = path.resolve(import.meta.dirname, "../scripts/migrate-attachments-to-inline-images.mjs");

const imageId = `att_${"a".repeat(32)}`, pdfId = `att_${"b".repeat(32)}`;
const imageRef = { id: imageId, name: "board.png", mimeType: "image/png", size: 0, kind: "image" };
const pdfRef = { id: pdfId, name: "notes.pdf", mimeType: "application/pdf", size: 8, kind: "pdf" };
const compact = JSON.stringify({ kind: "explain", text: "My answer" });

function fixture(name: string) {
	const data = path.join(root, name);
	const png = createCanvas(6, 4).toBuffer("image/png");
	for (const [ref, file, bytes] of [[imageRef, "content.png", png], [pdfRef, "content.pdf", Buffer.from("%PDF-1.7")]] as const) {
		fs.mkdirSync(path.join(data, "attachments", ref.id), { recursive: true });
		fs.writeFileSync(path.join(data, "attachments", ref.id, file), bytes);
		fs.writeFileSync(path.join(data, "attachments", ref.id, "metadata.json"), JSON.stringify({ ...ref, size: bytes.length }));
	}
	fs.mkdirSync(path.join(data, "chats"), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const old = {
		id: "chat_old", title: "Old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1,
		messages: [
			{ id: "u1", role: "user", content: "Look at these", attachments: [imageRef, pdfRef], timestamp: 1 },
			{ id: "a1", role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "toolUse", usage, timestamp: 2,
				content: [{ type: "toolCall", id: "call_1", name: "explain", arguments: { question: "Explain", correctAnswer: "x" } }] },
			{ id: "r1", role: "toolResult", toolCallId: "call_1", toolName: "explain", isError: false, timestamp: 3, attachments: [imageRef],
				content: [{ type: "text", text: compact }], details: { kind: "explain", text: "My answer", attachments: [imageRef] } },
			{ id: "p1", role: "custom", customType: "practice-thinking", display: true, timestamp: 4, attachments: [imageRef],
				content: "Your thinking:\nWorking", details: { problemCallId: "problem_1", text: "Working", attachments: [imageRef] } },
			// Non-image refs on a choice answer (pre-rename `note`) and on thinking.
			{ id: "a2", role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "toolUse", usage, timestamp: 5,
				content: [{ type: "toolCall", id: "call_2", name: "quiz", arguments: { question: "Pick", options: [{ label: "A" }], correctAnswer: "A", explanation: "x" } }] },
			{ id: "r2", role: "toolResult", toolCallId: "call_2", toolName: "quiz", isError: false, timestamp: 6, attachments: [pdfRef],
				content: [{ type: "text", text: "{}" }], details: { kind: "quiz", answers: [{ index: 0, label: "A" }], note: "Because", attachments: [pdfRef] } },
			{ id: "p2", role: "custom", customType: "practice-thinking", display: true, timestamp: 7, attachments: [pdfRef],
				content: "Your thinking:\nSee file", details: { problemCallId: "problem_1", text: "See file", attachments: [pdfRef] } },
		],
	};
	const plain = { id: "chat_plain", title: "Plain", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", messages: [{ id: "u", role: "user", content: "hi", timestamp: 1 }] };
	for (const record of [old, plain]) fs.writeFileSync(path.join(data, "chats", `${record.id}.json`), JSON.stringify(record, null, "\t"));
	const read = (id: string) => fs.readFileSync(path.join(data, "chats", `${id}.json`), "utf8");
	return { data, png, old, read };
}

test("dry run reports and changes nothing; apply requires an existing backup", async () => {
	const f = fixture("dry");
	const before = [f.read("chat_old"), f.read("chat_plain")];
	const lines: string[] = [];
	const summaries = await migrateAttachments({ data: f.data, log: (line: string) => lines.push(line) });
	assert.deepEqual([f.read("chat_old"), f.read("chat_plain")], before);
	assert.equal(summaries.length, 1);
	assert.match(lines[0]!, /^chat_old: would convert 1 user\/steer, 2 answer, 2 thinking \(3 images, 3 file paths\)$/);
	await assert.rejects(migrateAttachments({ data: f.data, apply: true, log() {} }), /--backup/);
	await assert.rejects(migrateAttachments({ data: f.data, apply: true, backup: path.join(root, "missing"), log() {} }), /--backup/);
	const cli = execFileSync(process.execPath, ["--import", "tsx", script, "--data", f.data], { encoding: "utf8" });
	assert.match(cli, /chat_old: would convert/);
	assert.match(USAGE, /--data <dir>.*--apply --backup/);
});

test("apply converts all three record kinds to upstream's shapes; a second apply is a no-op", async () => {
	const f = fixture("apply");
	const backup = fs.mkdtempSync(path.join(root, "backup-"));
	const originalOld = f.read("chat_old"), originalPlain = f.read("chat_plain");
	const plainStat = fs.statSync(path.join(f.data, "chats", "chat_plain.json")).mtimeMs;
	await migrateAttachments({ data: f.data, apply: true, backup, log() {} });
	assert.equal(fs.readFileSync(path.join(backup, "chats", "chat_old.json"), "utf8"), originalOld);
	assert.equal(fs.existsSync(path.join(backup, "chats", "chat_plain.json")), false);
	assert.equal(f.read("chat_plain"), originalPlain);
	assert.equal(fs.statSync(path.join(f.data, "chats", "chat_plain.json")).mtimeMs, plainStat, "records without old refs are never written");
	assert.ok(fs.existsSync(path.join(f.data, "attachments", pdfId, "content.pdf")), "the attachment files stay in place");

	const processed = await processImage(f.png, "image/png");
	assert.ok(processed.ok);
	const image = { type: "image" as const, data: processed.data, mimeType: processed.mimeType };
	const pdfPath = quoteFilePath(path.join(f.data, "attachments", pdfId, "content.pdf"));
	const [user, , answer, thinking, , choice, fileThinking] = JSON.parse(f.read("chat_old")).messages;
	const expectedThinking = newThinkingMessage("problem_1", "Working", [image]);
	assert.deepEqual(user, { id: "u1", role: "user", content: nativeInlineImageContent(`Look at these ${pdfPath}`, [image]), timestamp: 1 });
	assert.deepEqual(answer, { id: "r1", role: "toolResult", toolCallId: "call_1", toolName: "explain", isError: false, timestamp: 3,
		content: nativeAnswerContent(compact, { answer: [image] }), details: { kind: "explain", text: "My answer", images: { answer: [image] } } });
	assert.deepEqual(answer.content.slice(1, 2), [{ type: "text", text: "Answer images:" }]);
	assert.deepEqual(thinking, { id: "p1", role: "custom", customType: "practice-thinking", display: true, timestamp: 4, content: expectedThinking.content, details: expectedThinking.details });
	// A file on a choice answer joins its thinking; the model text is rebuilt.
	const choiceDetails = { kind: "quiz", answers: [{ index: 0, label: "A" }], note: "Because", thinking: `Because ${pdfPath}` };
	assert.deepEqual(choice, { id: "r2", role: "toolResult", toolCallId: "call_2", toolName: "quiz", isError: false, timestamp: 6,
		content: nativeAnswerContent(JSON.stringify(compactAnswerForModel(choiceDetails as QuestionAnswerData)), undefined), details: choiceDetails });
	assert.match((choice.content[0] as { text: string }).text, /"thinking":"Because `/);
	const expectedFileThinking = newThinkingMessage("problem_1", `See file ${pdfPath}`);
	assert.deepEqual(fileThinking, { id: "p2", role: "custom", customType: "practice-thinking", display: true, timestamp: 7, content: expectedFileThinking.content, details: expectedFileThinking.details });

	const converted = f.read("chat_old");
	const again = await migrateAttachments({ data: f.data, apply: true, backup, log() {} });
	assert.deepEqual(again, []);
	assert.equal(f.read("chat_old"), converted);

	// The real chat store (its data root is fixed at import) and the view.
	const probe = `
		const { chatStore } = await import(${JSON.stringify(path.resolve(import.meta.dirname, "../src/store/chats.ts"))});
		const { projectView } = await import(${JSON.stringify(path.resolve(import.meta.dirname, "../src/core/view.ts"))});
		const record = chatStore.getChat("chat_old");
		const view = projectView(record.messages);
		const user = view.find(m => m.id === "u1");
		const answer = view.flatMap(m => m.parts).find(p => p.toolCallId === "call_1");
		const thinking = view.flatMap(m => m.parts).find(p => p.id === "pt_p1");
		console.log(JSON.stringify({ userImages: user.parts.filter(p => p.type === "image").length, answerImages: answer.output.images.answer.length, answerState: answer.state, thinkingImages: thinking.data.images.length }));`;
	const loaded = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], { encoding: "utf8", env: { ...process.env, LH_DATA_DIR: f.data } }));
	assert.deepEqual(loaded, { userImages: 1, answerImages: 1, answerState: "output-available", thinkingImages: 1 });
});

test("a record whose bytes are missing is left untouched and reported", async () => {
	const f = fixture("missing");
	fs.rmSync(path.join(f.data, "attachments", pdfId), { recursive: true });
	const backup = fs.mkdtempSync(path.join(root, "backup-"));
	const [summary] = await migrateAttachments({ data: f.data, apply: true, backup, log() {} });
	assert.deepEqual([summary!.user, summary!.answer, summary!.thinking], [0, 1, 1]);
	assert.deepEqual(summary!.skipped.map((line: string) => line.split(":")[0]), ["u1", "r2", "p2"]);
	assert.match(summary!.skipped[0]!, /^u1: missing att_b+$/);
	const [user] = JSON.parse(f.read("chat_old")).messages;
	assert.deepEqual(user, f.old.messages[0]);
});
