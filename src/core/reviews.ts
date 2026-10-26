import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import type { GraphNode } from "./contracts/graph.ts";
import type {
	MemoryCard,
	ReviewCard,
	ReviewRating,
	ReviewSource,
	ReviewState,
	ReviewStore,
} from "./review-types.ts";

/** Keep the scheduler off the browser barrel; clients receive computed outcomes. */
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });

function serialize(card: Card): MemoryCard {
	return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() };
}

export function enrollReview(
	state: ReviewState,
	nodeId: string,
	source: ReviewSource,
	reason: string,
	now: Date,
): ReviewCard {
	return (state.cards[nodeId] ??= {
		nodeId,
		source,
		reason,
		createdAt: now.toISOString(),
		revision: 0,
		memory: serialize(createEmptyCard(now)),
		history: [],
	});
}

/** Called before extraction begins and after graph writes. Re-encounters never reset a card. */
export function observeKnowledge(
	store: ReviewStore,
	nodes: readonly Pick<GraphNode, "id">[],
	now = new Date(),
): ReviewState {
	const saved = store.read();
	const state: ReviewState = saved ?? { version: 1, knownNodeIds: nodes.map((n) => n.id), cards: {} };
	const known = new Set(state.knownNodeIds);
	let changed = saved === null;
	for (const node of nodes) {
		if (known.has(node.id)) continue;
		known.add(node.id);
		state.knownNodeIds.push(node.id);
		enrollReview(state, node.id, "automatic", "Newly learned knowledge", now);
		changed = true;
	}
	if (changed) store.write(state);
	return state;
}

export function rateReview(card: ReviewCard, rating: ReviewRating, now: Date): MemoryCard {
	return serialize(scheduler.next(card.memory, now, rating as Grade).card);
}

export function reviewOutcomes(card: ReviewCard, now: Date): Record<ReviewRating, string> {
	return Object.fromEntries(
		([1, 2, 3, 4] as const).map((r) => [r, rateReview(card, r, now).due]),
	) as Record<ReviewRating, string>;
}

export function retrievability(card: ReviewCard, now: Date): number | null {
	return card.memory.last_review ? scheduler.get_retrievability(card.memory, now, false) : null;
}
