import type { LhMessage } from "./native-messages.ts";
import { activeProblemOf, problemInputForConclude } from "./native-messages.ts";
import type { ReviewContext } from "./review-types.ts";

export function reviewContextOf(messages: readonly LhMessage[]): ReviewContext | null {
	for (const message of messages) {
		if (message.role !== "custom" || message.customType !== "graph-context") continue;
		const context = (message.details as { review?: ReviewContext } | null)?.review;
		if (context && typeof context.nodeId === "string" && Number.isInteger(context.revision))
			return context;
	}
	return null;
}

/** A rating requires a successfully concluded, target-bearing problem, never a live attempt. */
export function reviewConclusionOf(messages: readonly LhMessage[], nodeId: string): string | null {
	if (activeProblemOf(messages)) return null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const result = messages[i]!;
		if (result.role !== "toolResult" || result.toolName !== "conclude" || result.isError) continue;
		const input = problemInputForConclude(messages, result.toolCallId);
		return Array.isArray(input?.target) && input.target.includes(nodeId) ? result.toolCallId : null;
	}
	return null;
}
