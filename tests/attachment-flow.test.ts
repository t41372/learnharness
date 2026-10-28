import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { createPracticeAgent } from "../src/agent/teacher-agent.ts";
import { piModels } from "../src/agent/models.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { stores } from "../src/server/stores.ts";
import { runningTurn } from "../src/server/turn-runs.ts";

const originalKey = process.env.OPENROUTER_API_KEY;
process.env.OPENROUTER_API_KEY ??= "fixture-key-presence-only";
const chats: string[] = [];
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2XkAAAAASUVORK5CYII=",
	"base64",
);
const image = stores.attachmentStore.put("proof.png", png);
after(() => {
	for (const id of chats) stores.chatStore.deleteChat(id);
	fs.rmSync(path.dirname(stores.attachmentStore.filePath(image.id)), { recursive: true, force: true });
	if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
});

function chatWithModel(imageInput: boolean) {
	const model = piModels()
		.getModels("openrouter")
		.find((m) => m.input.includes("image") === imageInput)!;
	assert.ok(model);
	const chat = stores.chatStore.createChat("Attachment flow fixture", "practice");
	chats.push(chat.id);
	stores.chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: model.id } });
	return chat;
}

function request(chatId: string) {
	return new Request("http://test/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chatId, input: { type: "text", text: "", attachments: [image] } }),
	});
}

test("an attachment-only send reaches the conversation model as a native image and persists only its reference", async () => {
	const chat = chatWithModel(true);
	let sawImage = false;
	const faux = createFauxCore({});
	faux.setResponses([
		(context) => {
			sawImage = context.messages.some(
				(m) =>
					Array.isArray(m.content) &&
					m.content.some((c) => c.type === "image" && c.data === png.toString("base64")),
			);
			return fauxAssistantMessage([fauxText("Image received.")]);
		},
	]);
	const response = await handleChatRequest(request(chat.id), (opts) =>
		createPracticeAgent(
			{ chatId: chat.id, chatStore: stores.chatStore },
			{
				...opts,
				engine: {
					model: { ...faux.getModel(), input: ["text", "image"] },
					streamFn: faux.streamSimple,
				},
			},
		),
	);
	assert.equal(response.status, 200, await response.text());
	const turn = runningTurn(chat.id);
	if (turn) await new Response(turn.subscribe()).text();
	assert.equal(sawImage, true);
	const record = stores.chatStore.getChat(chat.id)!;
	assert.deepEqual(record.messages.find((m) => m.role === "user")?.attachments, [image]);
	assert.equal(JSON.stringify(record).includes(png.toString("base64")), false);
});

test("a text-only model refuses an image before any answer or chat history is persisted", async () => {
	const chat = chatWithModel(false);
	const response = await handleChatRequest(request(chat.id));
	assert.equal(response.status, 422);
	assert.equal((await response.json()).code, "image_input_not_supported");
	assert.deepEqual(stores.chatStore.getChat(chat.id)!.messages, []);
});
