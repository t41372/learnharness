import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";

const input = Type.Object({
	propositions: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		maxItems: 100,
		description: "Knowledge-map proposition ids or exact names to add to spaced review.",
	}),
	reason: Type.String({
		minLength: 1,
		description: "Why these propositions deserve future retrieval practice; visible to the learner.",
	}),
});

export function reviewTools(
	add: (propositions: string[], reason: string) => string,
): Record<string, AgentTool<any>> {
	return {
		add_to_review: {
			name: "add_to_review",
			label: "add_to_review",
			description:
				"Add existing knowledge-map propositions to the learner's spaced-review queue when they would benefit from future retrieval. Explain why. Already enrolled propositions keep their schedules. New knowledge is enrolled automatically. Only the learner's own four-level rating updates memory scheduling.",
			parameters: input,
			execute: serverExecute("add_to_review", input, async ({ propositions, reason }) =>
				add(propositions, reason),
			),
		},
	};
}
