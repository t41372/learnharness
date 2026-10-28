import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createReviewStore } from "../src/store/reviews.ts";
import { observeKnowledge, rateReview } from "../src/core/reviews.ts";
import { createReviewService } from "../src/server/reviews.ts";
import { reviewContextOf } from "../src/core/review-session.ts";
import type { ChatStore, GraphStore } from "../src/core/ports.ts";
import type { ChatRecord, GraphNode } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "lh-reviews-test-"));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
let serial = 0;
const clock = new Date("2026-10-26T10:00:00Z");
const node = (id: string): GraphNode => ({
	id,
	name: id,
	statement: `${id} is true.`,
	aliases: [],
	createdAt: clock.toISOString(),
	provenance: [],
});

function fixture() {
	const store = createReviewStore(path.join(folder, `${serial++}.json`));
	const nodes = [node("old")];
	const chats = new Map<string, ChatRecord>();
	const chatStore = {
		createChat(title: string, kind: "practice") {
			const chat: ChatRecord = {
				id: `chat_${serial++}`,
				title,
				kind,
				messages: [],
				createdAt: clock.toISOString(),
				updatedAt: clock.toISOString(),
			};
			chats.set(chat.id, chat);
			return structuredClone(chat);
		},
		getChat: (id: string) => structuredClone(chats.get(id) ?? null),
		saveMessages(id: string, messages: LhMessage[]) {
			chats.get(id)!.messages = structuredClone(messages);
		},
		saveSettings(id: string, settings: ChatRecord["settings"]) {
			chats.get(id)!.settings = settings;
		},
	} as ChatStore;
	const graphStore = { readNodes: () => nodes, readChains: () => [] } as unknown as GraphStore;
	const deps = {
		reviewStore: store,
		chatStore,
		graphStore,
		model: () => ({ model: { provider: "test", id: "model" } }),
		now: () => clock,
	};
	return { store, nodes, chats, deps, service: createReviewService(deps) };
}

function conclude(chat: ChatRecord, target: string, fail = false) {
	for (const [name, id, args] of [
		["problem", "p", { statement: "Recall", target: [target], mode: "recall", modelSolution: "Answer" }],
		["conclude", "c", { outcome: "solved" }],
	] as const) {
		chat.messages.push({
			...fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" }),
			id: `a_${id}`,
		} as LhMessage);
		chat.messages.push({
			id: `r_${id}`,
			role: "toolResult",
			toolCallId: id,
			toolName: name,
			content: [{ type: "text", text: "ok" }],
			isError: fail && name === "conclude",
			timestamp: 1,
		});
	}
}

describe("spaced review", () => {
	it("baselines existing knowledge, automatically enrolls new nodes, and preserves re-encounter schedules", () => {
		const f = fixture();
		assert.deepEqual(f.service.list(), []);
		f.nodes.push(node("new"));
		const [card] = f.service.list();
		assert.equal(card?.source, "automatic");
		assert.equal(card?.due, true);
		assert.deepEqual(
			observeKnowledge(f.store, [...f.nodes, node("new")], new Date("2027-01-01")).cards.new,
			f.store.read()!.cards.new,
		);
		assert.equal(f.service.list().length, 1);
	});
	it("manual and agent enrollment validate all targets before writing and never reset memory", () => {
		const f = fixture();
		assert.throws(() => f.service.enroll(["old", "missing"], "agent", "Reason"));
		assert.deepEqual(f.service.list(), []);
		f.service.enroll(["old"], "agent", "A prerequisite worth retrieving");
		const first = f.store.read()!.cards.old!;
		f.service.enroll(["old"], "manual", "Manual");
		assert.deepEqual(f.store.read()!.cards.old, first);
	});
	it("resumes the same unfinished session and requires a concluded matching problem before rating", () => {
		const f = fixture();
		f.service.enroll(["old"], "manual", "");
		const { chatId } = f.service.start("old");
		assert.deepEqual(f.service.start("old"), { chatId });
		assert.equal(reviewContextOf(f.chats.get(chatId)!.messages)?.nodeId, "old");
		assert.throws(() => f.service.rate(chatId, "c", 3), /Finish/);
		conclude(f.chats.get(chatId)!, "other");
		assert.throws(() => f.service.rate(chatId, "c", 3), /Finish/);
	});
	it("persists FSRS history and applies one self-rating exactly once across restarts", () => {
		const f = fixture();
		f.service.enroll(["old"], "manual", "");
		const { chatId } = f.service.start("old");
		conclude(f.chats.get(chatId)!, "old");
		const before = f.service.list()[0]!;
		assert.ok(
			Date.parse(rateReview(before, 1, clock).due) < Date.parse(rateReview(before, 4, clock).due),
		);
		const first = f.service.rate(chatId, "c", 3);
		assert.equal(first.memory.reps, 1);
		assert.ok(Date.parse(first.memory.due) > clock.getTime());
		assert.equal(first.history.length, 1);
		assert.equal(first.activeChatId, undefined);
		const restarted = createReviewService(f.deps);
		assert.deepEqual(restarted.rate(chatId, "c", 3), first);
		assert.throws(() => restarted.rate(chatId, "c", 4), /already/);
		assert.equal(restarted.status(chatId).rated, true);
		assert.throws(() => restarted.start("old"), /not due/);
	});
	it("rejects failed conclusions and invalid ratings without changing the schedule", () => {
		const f = fixture();
		f.service.enroll(["old"], "manual", "");
		const { chatId } = f.service.start("old");
		conclude(f.chats.get(chatId)!, "old", true);
		assert.throws(() => f.service.rate(chatId, "c", 3), /Finish/);
		assert.throws(() => f.service.rate(chatId, "c", 0), /valid/);
		assert.equal(f.store.read()!.cards.old!.revision, 0);
	});
	it("hides deleted graph nodes and refuses to overwrite damaged or future-version state", () => {
		const f = fixture();
		f.service.enroll(["old"], "manual", "");
		f.nodes.length = 0;
		assert.deepEqual(f.service.list(), []);
		const file = path.join(folder, "future.json");
		fs.writeFileSync(file, JSON.stringify({ version: 2, cards: {}, knownNodeIds: [] }));
		assert.throws(() => createReviewStore(file).read(), /Unsupported/);
		assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 2);
	});
});
