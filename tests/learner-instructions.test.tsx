/**
 * The learner's instructions (agent-instructions wave, 2026-10-25): the
 * block's shape, the engine seam that carries it into EVERY model call
 * (conversation agents and sub-agents alike), its settings round trip,
 * and the Settings → Agent editor.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxText,
	getCurrentSystemPrompt,
	normalizeContext,
	type Message,
} from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import {
	LEARNER_INSTRUCTIONS_HEADER,
	LEARNER_INSTRUCTIONS_SECTION,
	appendLearnerInstructions,
	learnerInstructionsBlock,
	withLearnerInstructions,
	withLearnerSection,
} from "../src/agent/learner-instructions.ts";
import { composeInstructions, createPracticeAgent, createProberAgent, createTeacherAgent, type AgentBuildOptions } from "../src/agent/teacher-agent.ts";
import { runSubagent } from "../src/agent/subagents/pi-run.ts";
import { LEARNER_INSTRUCTIONS_MAX_CHARS, sanitizeUserSettings } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { parseAgentSettingsBody } from "../src/server/settings-body.ts";
import { composeLearnerInstructions, INSTRUCTIONS_HINT, InstructionsEditor } from "../components/settings/agent-section.tsx";

const TEXT = "Always reply in Traditional Chinese.";

/** A faux engine that records the system prompt of every request. */
function recordingEngine(replies = 1) {
	const faux = createFauxCore({});
	faux.setResponses(Array.from({ length: replies }, () => fauxAssistantMessage([fauxText("ok")])));
	const prompts: string[] = [];
	const messages: Message[][] = [];
	const engine: PiEngine = {
		model: faux.getModel(),
		streamFn: (model, context, options) => {
			prompts.push(getCurrentSystemPrompt(context.messages));
			messages.push(context.messages);
			return faux.streamSimple(model, context, options);
		},
	};
	return { engine, prompts, messages };
}

describe("the block", () => {
	it("is absent for blank text", () => {
		assert.equal(learnerInstructionsBlock(undefined), null);
		assert.equal(learnerInstructionsBlock("  \n "), null);
		assert.equal(appendLearnerInstructions("Base.", ""), "Base.");
	});

	it("opens with the fragment separator, then the framing, then the trimmed text", () => {
		assert.equal(learnerInstructionsBlock(`  ${TEXT}\n`), `---\n\n${LEARNER_INSTRUCTIONS_HEADER}\n\n${TEXT}`);
		assert.equal(appendLearnerInstructions("Base.", TEXT), `Base.\n\n---\n\n${LEARNER_INSTRUCTIONS_HEADER}\n\n${TEXT}`);
		assert.ok(LEARNER_INSTRUCTIONS_HEADER.startsWith("# The learner's instructions\n\n"));
	});

	it("rides the leading system message as a named section, keeping its prompt and tools", () => {
		const context = normalizeContext({
			systemPrompt: "Base.",
			messages: [{ role: "user", content: "hi", timestamp: 1 }],
			tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } as never }],
		});
		const block = learnerInstructionsBlock(TEXT)!;
		const next = withLearnerSection(context, block);
		const head = next.messages[0];
		assert.equal(head?.role, "system");
		if (head?.role !== "system") return;
		assert.equal(head.content, "Base.");
		assert.equal(head.sections?.[LEARNER_INSTRUCTIONS_SECTION], block);
		assert.equal(head.toolsAdded?.[0]?.name, "t");
		assert.equal(next.messages.length, context.messages.length, "no message added");
		assert.equal(getCurrentSystemPrompt(next.messages), appendLearnerInstructions("Base.", TEXT));
		assert.equal(getCurrentSystemPrompt(context.messages), "Base.", "the input transcript is not mutated");
	});

	it("creates the leading system message when the request has none", () => {
		const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] });
		const next = withLearnerSection(context, learnerInstructionsBlock(TEXT)!);
		assert.equal(next.messages.length, 2);
		assert.equal(getCurrentSystemPrompt(next.messages), learnerInstructionsBlock(TEXT));
	});

	it("leaves the engine untouched when there is nothing to append", () => {
		const { engine } = recordingEngine();
		assert.equal(withLearnerInstructions(engine, ""), engine);
		assert.equal(withLearnerInstructions(engine, undefined), engine);
	});
});

describe("every agent reads it through its engine", () => {
	const factories: Array<[string, "prober" | "teacher" | "practice", (opts: AgentBuildOptions) => { prompt(text: string): Promise<void> }]> = [
		["prober", "prober", (opts) => createProberAgent({ chatId: "c", searchAvailable: () => false } as never, opts)],
		["teacher", "teacher", (opts) => createTeacherAgent(undefined, opts)],
		["practice", "practice", (opts) => createPracticeAgent({} as never, opts)],
	];
	for (const [name, kind, factory] of factories) {
		it(`${name}: the composed prompt, then the learner's block`, async () => {
			const { engine, prompts } = recordingEngine();
			await factory({ engine: withLearnerInstructions(engine, TEXT), tools: {} }).prompt("hello");
			assert.equal(prompts.length, 1);
			assert.equal(prompts[0], appendLearnerInstructions(composeInstructions(kind), TEXT));
		});
	}

	it("a sub-agent run (the researcher/demo/visual seam)", async () => {
		const { engine, prompts } = recordingEngine();
		await runSubagent([], { role: "researcher", prompt: "find it", engine: withLearnerInstructions(engine, TEXT), systemPrompt: "You research.", maxTurns: 1 });
		assert.equal(prompts[0], appendLearnerInstructions("You research.", TEXT));
	});

	it("without instructions the prompt is byte-identical to before", async () => {
		const { engine, prompts } = recordingEngine();
		await createTeacherAgent(undefined, { engine: withLearnerInstructions(engine, "   "), tools: {} }).prompt("hello");
		assert.equal(prompts[0], composeInstructions("teacher"));
	});
});

describe("agent.instructions in the settings record", () => {
	it("resolves trimmed, empty when absent", () => {
		assert.equal(resolveSettings(null).agent.instructions, "");
		assert.equal(resolveSettings({ version: 1, agent: { instructions: `  ${TEXT}\n` } }).agent.instructions, TEXT);
	});

	it("the sanitizer clamps an over-long disk value and drops a non-string", () => {
		const long = "x".repeat(LEARNER_INSTRUCTIONS_MAX_CHARS + 10);
		assert.equal(sanitizeUserSettings({ version: 1, agent: { instructions: long } })?.agent?.instructions?.length, LEARNER_INSTRUCTIONS_MAX_CHARS);
		assert.equal(sanitizeUserSettings({ version: 1, agent: { instructions: 42 } })?.agent?.instructions, undefined);
	});

	it("the PUT parser is strict, and blank stores nothing", () => {
		assert.deepEqual(parseAgentSettingsBody({ instructions: TEXT }), { ok: true, settings: { instructions: TEXT } });
		assert.deepEqual(parseAgentSettingsBody({ instructions: "  " }), { ok: true, settings: {} });
		assert.equal(parseAgentSettingsBody({ instructions: 1 }).ok, false);
		assert.equal(parseAgentSettingsBody({ instructions: "x".repeat(LEARNER_INSTRUCTIONS_MAX_CHARS + 1) }).ok, false);
	});
});

describe("Settings → Agent → Your instructions", () => {
	it("compose carries the rest of the section and clears on blank", () => {
		const agent = { tools: { research: false }, instructions: "old" };
		assert.deepEqual(composeLearnerInstructions(agent, TEXT), { tools: { research: false }, instructions: TEXT });
		assert.deepEqual(composeLearnerInstructions(agent, "  "), { tools: { research: false } });
	});

	it("renders the stored text, the hint, the counter, and an inert Save", () => {
		const html = renderToStaticMarkup(<InstructionsEditor value={TEXT} onSave={() => {}} />);
		assert.ok(html.includes(TEXT));
		assert.ok(html.includes(INSTRUCTIONS_HINT.replace(/'/g, "&#x27;")));
		assert.ok(html.replace(/<!-- -->/g, "").includes(`${TEXT.length} / ${LEARNER_INSTRUCTIONS_MAX_CHARS}`));
		assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="instructions-save"/);
	});
});
