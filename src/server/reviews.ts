import { getGraph } from "../core/graph.ts";
import { resolveTargetId } from "../core/chains.ts";
import { newGraphContextMessage } from "../core/native-messages.ts";
import { reviewConclusionOf, reviewContextOf } from "../core/review-session.ts";
import {
	enrollReview,
	observeKnowledge,
	rateReview,
	retrievability,
	reviewOutcomes,
} from "../core/reviews.ts";
import type { ChatStore, GraphStore } from "../core/ports.ts";
import type { ReviewRating, ReviewSource, ReviewStore } from "../core/review-types.ts";
import type { ChatSettings } from "../core/contracts/chat.ts";
import { stores, effectiveSettings } from "./stores.ts";

export class ReviewError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
	}
}

export function createReviewService(deps: {
	reviewStore: ReviewStore;
	graphStore: GraphStore;
	chatStore: ChatStore;
	model: () => ChatSettings | null;
	now?: () => Date;
}) {
	const now = () => deps.now?.() ?? new Date();
	const graph = () => getGraph(deps.graphStore);
	const state = () => observeKnowledge(deps.reviewStore, graph().nodes, now());
	const cardOf = (nodeId: string) => {
		const saved = state();
		const card = saved.cards[nodeId];
		if (!card || !graph().nodes.some((n) => n.id === nodeId))
			throw new ReviewError("Review item not found", 404);
		return { saved, card };
	};
	return {
		list() {
			const saved = state(),
				time = now();
			const names = new Map(graph().nodes.map((n) => [n.id, n.name]));
			return Object.values(saved.cards)
				.filter((c) => names.has(c.nodeId))
				.map((card) => ({
					...card,
					name: names.get(card.nodeId)!,
					due: Date.parse(card.memory.due) <= time.getTime(),
					retrievability: retrievability(card, time),
				}))
				.sort((a, b) => a.memory.due.localeCompare(b.memory.due) || a.nodeId.localeCompare(b.nodeId));
		},
		enroll(propositions: unknown, source: ReviewSource, reason: string) {
			if (
				!Array.isArray(propositions) ||
				propositions.length === 0 ||
				propositions.length > 100 ||
				propositions.some((p) => typeof p !== "string")
			) {
				throw new ReviewError("Choose between 1 and 100 knowledge propositions");
			}
			const nodes = graph().nodes;
			const ids = propositions.map((p) => resolveTargetId(p, nodes));
			if (ids.some((id) => id === null))
				throw new ReviewError("An unknown proposition cannot be enrolled");
			const saved = state();
			for (const id of new Set(ids as string[])) enrollReview(saved, id, source, reason, now());
			deps.reviewStore.write(saved);
			return `${new Set(ids).size} proposition(s) are enrolled for review. Existing schedules were preserved.`;
		},
		start(nodeId: string) {
			const { saved, card } = cardOf(nodeId);
			if (card.activeChatId && deps.chatStore.getChat(card.activeChatId))
				return { chatId: card.activeChatId };
			if (Date.parse(card.memory.due) > now().getTime())
				throw new ReviewError("This item is not due yet", 409);
			const model = deps.model();
			if (!model) throw new ReviewError("Configure a conversation model before starting a review", 503);
			const node = graph().nodes.find((n) => n.id === nodeId)!;
			const chat = deps.chatStore.createChat(node.name, "practice");
			deps.chatStore.saveSettings(chat.id, model);
			const marker = newGraphContextMessage([node], []);
			marker.details = { ...(marker.details as object), review: { nodeId, revision: card.revision } };
			marker.content += `\n\n[Spaced review] Exercise only proposition ${nodeId}. Pose one fresh retrieval problem using the practice tools. After concluding, stop and let the learner self-rate with the four review buttons. The learner's rating, not your assessment, determines the next interval.`;
			deps.chatStore.saveMessages(chat.id, [marker]);
			card.activeChatId = chat.id;
			deps.reviewStore.write(saved);
			return { chatId: chat.id };
		},
		status(chatId: string) {
			const chat = deps.chatStore.getChat(chatId);
			const context = chat && reviewContextOf(chat.messages);
			if (!context) throw new ReviewError("Review session not found", 404);
			const { card } = cardOf(context.nodeId);
			return {
				nodeId: context.nodeId,
				revision: context.revision,
				rated: card.history.some((h) => h.chatId === chatId),
				concludeCallId: reviewConclusionOf(chat!.messages, context.nodeId),
				outcomes: reviewOutcomes(card, now()),
			};
		},
		rate(chatId: string, concludeCallId: unknown, value: unknown) {
			if (![1, 2, 3, 4].includes(value as number) || typeof concludeCallId !== "string")
				throw new ReviewError("Choose a valid review rating");
			const chat = deps.chatStore.getChat(chatId);
			const context = chat && reviewContextOf(chat.messages);
			if (!context) throw new ReviewError("Review session not found", 404);
			const { saved, card } = cardOf(context.nodeId);
			const prior = card.history.find((h) => h.chatId === chatId);
			if (prior) {
				if (prior.rating !== value || prior.concludeCallId !== concludeCallId)
					throw new ReviewError("This review has already been rated", 409);
				return card;
			}
			if (card.revision !== context.revision || card.activeChatId !== chatId)
				throw new ReviewError("The review schedule changed; refresh before rating", 409);
			if (reviewConclusionOf(chat!.messages, context.nodeId) !== concludeCallId)
				throw new ReviewError("Finish the review problem before rating", 409);
			const time = now(),
				rating = value as ReviewRating;
			const after = rateReview(card, rating, time);
			card.history.push({
				id: `${chatId}:${context.revision}`,
				chatId,
				concludeCallId,
				rating,
				reviewedAt: time.toISOString(),
				before: card.memory,
				after,
			});
			card.memory = after;
			card.revision++;
			delete card.activeChatId;
			deps.reviewStore.write(saved);
			return card;
		},
	};
}

export const reviews = createReviewService({ ...stores, model: () => effectiveSettings().models.strong });

export async function reviewResponse(action: () => unknown | Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await action());
	} catch (error) {
		if (error instanceof ReviewError)
			return Response.json({ error: error.message }, { status: error.status });
		console.error("[reviews]", error);
		return Response.json({ error: "Could not save or load reviews" }, { status: 500 });
	}
}
