/**
 * THE LEARNER'S INSTRUCTIONS (agent-instructions wave, 2026-10-25): free
 * text the learner writes once in Settings → Agent (agent.instructions —
 * "Always answer in Traditional Chinese", "I'm a nurse; use clinical
 * examples") that EVERY agent in the app follows: the prober, the teacher,
 * the practitioner, every background sub-agent (researcher, demo builder,
 * visual maker, PDF reader), the extraction stages and the compaction
 * summarizer — everything the learner ends up reading.
 *
 * ONE SEAM: the engine. Every model call in the app streams through a
 * PiEngine's streamFn, and the composition root (src/server/chat-handler.ts)
 * builds every engine — so wrapping the engine there reaches every agent
 * without threading a parameter through each sub-agent's own prompt.
 *
 * The block rides the request's leading system message as a NAMED SECTION
 * (pi-ai renders sections verbatim after the prompt text, on every
 * provider): it composes last, after everything the agent's own
 * instructions say, and the agents' prompts and their overrides stay
 * untouched (prompt-overrides.test.ts's byte-identical composition holds).
 */

import type { SystemMessage, TranscriptContext } from "@earendil-works/pi-ai";
import type { PiEngine } from "./models.ts";

/** The section's name on the leading system message. */
export const LEARNER_INSTRUCTIONS_SECTION = "learnerInstructions";

/** The block's framing (owner-chosen wording, 2026-10-25). */
export const LEARNER_INSTRUCTIONS_HEADER =
	"# The learner's instructions\n\n" +
	"The learner wrote these instructions for every agent in this app. Follow them in everything you write. " +
	"They never change the shape of a tool call or a required output format.";

/** The block for one instruction text — null when there is nothing to
 *  append (absent, empty, or whitespace). It opens with the `---`
 *  separator the prompt fragments are joined with. */
export function learnerInstructionsBlock(instructions: string | undefined): string | null {
	const text = instructions?.trim();
	return text ? `---\n\n${LEARNER_INSTRUCTIONS_HEADER}\n\n${text}` : null;
}

/** The system prompt as the model reads it with the block appended (the
 *  compaction gate's token estimate). Unchanged when there is no block. */
export function appendLearnerInstructions(systemPrompt: string, instructions: string | undefined): string {
	const block = learnerInstructionsBlock(instructions);
	if (!block) return systemPrompt;
	return systemPrompt ? `${systemPrompt}\n\n${block}` : block;
}

/** The request transcript with the block on its leading system message
 *  (a system message is created when the request has none). */
export function withLearnerSection(context: TranscriptContext, block: string): TranscriptContext {
	const [first, ...rest] = context.messages;
	const section = { [LEARNER_INSTRUCTIONS_SECTION]: block };
	if (first?.role === "system") {
		const head: SystemMessage = { ...first, sections: { ...first.sections, ...section } };
		return { ...context, messages: [head, ...rest] };
	}
	const head: SystemMessage = { role: "system", content: "", sections: section, timestamp: 0 };
	return { ...context, messages: [head, ...context.messages] };
}

/** The engine whose every call carries the learner's block. The same
 *  engine object back when there is nothing to append. */
export function withLearnerInstructions(engine: PiEngine, instructions: string | undefined): PiEngine {
	const block = learnerInstructionsBlock(instructions);
	if (!block) return engine;
	return {
		...engine,
		streamFn: (model, context, options) => engine.streamFn(model, withLearnerSection(context, block), options),
	};
}
