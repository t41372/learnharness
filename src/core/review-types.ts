/** Learner memory belongs to the review system, independently of graph facts. */
export type ReviewRating = 1 | 2 | 3 | 4;
export type ReviewSource = "automatic" | "manual" | "agent";

export interface MemoryCard {
	due: string;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	reps: number;
	lapses: number;
	state: number;
	last_review?: string;
}

export interface ReviewEntry {
	id: string;
	chatId: string;
	concludeCallId: string;
	rating: ReviewRating;
	reviewedAt: string;
	before: MemoryCard;
	after: MemoryCard;
}

export interface ReviewCard {
	nodeId: string;
	createdAt: string;
	source: ReviewSource;
	reason: string;
	revision: number;
	memory: MemoryCard;
	history: ReviewEntry[];
	activeChatId?: string;
}

export interface ReviewState {
	version: 1;
	/** The first observation is a baseline: existing knowledge stays opt-in. */
	knownNodeIds: string[];
	cards: Record<string, ReviewCard>;
}

export interface ReviewStore {
	read(): ReviewState | null;
	write(state: ReviewState): void;
}

export interface ReviewContext {
	nodeId: string;
	revision: number;
}

export interface ReviewItem extends ReviewCard {
	name: string;
	due: boolean;
	retrievability: number | null;
}
