"use client";

import { ChevronRight } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useT } from "@/components/i18n";
import { QUESTION_TOOLS } from "@/src/core";
import type { ArtifactPartProps } from "@/src/core";

/**
 * The LIVE tool-input card (owner, streaming round 2026-10-01): what a
 * tool call looks like while the agent WRITES it. A tool part sits in
 * `input-streaming` for its whole execution (the bridge defers
 * input-available to tool_execution_end), so this card IS the working
 * state — spinner + shimmered activity label in the header (the retired
 * transcript bottom line's text, same recipe as the thinking row), and
 * the streaming input itself watchable on expand. The moment the call
 * settles, the part re-renders through the artifact registry and the
 * quiet settled card replaces this one.
 *
 * The one working-state grammar everywhere (owner): Braille spinner +
 * Shimmer(duration 1) — the thinking row, this card, the sidebar row.
 */
/** The activity label per running tool — the interface-language twin of
 *  src/core/pending.ts toolActivityLabel (ACTIVITY_LABELS): same tools, same
 *  English, keep the two in sync. Question tools never get a live card
 *  (they stream into the dock), but keep their label for parity. */
const ACTIVITY_KEY = {
	read: "liveToolCard.activity.read",
	ls: "liveToolCard.activity.ls",
	find: "liveToolCard.activity.find",
	grep: "liveToolCard.activity.grep",
	research: "liveToolCard.activity.research",
	demo: "liveToolCard.activity.demo",
	visual: "liveToolCard.activity.visual",
	pdf: "liveToolCard.activity.pdf",
	plan_init: "liveToolCard.activity.planInit",
	probe_done: "liveToolCard.activity.probeDone",
} as const;

function activityKey(tool: string) {
	if ((QUESTION_TOOLS as readonly string[]).includes(tool)) return "liveToolCard.activity.question" as const;
	return Object.hasOwn(ACTIVITY_KEY, tool)
		? ACTIVITY_KEY[tool as keyof typeof ACTIVITY_KEY]
		: ("liveToolCard.activity.working" as const);
}

interface StreamingToolPart {
	type: string;
	state: string;
	toolCallId: string;
	input?: unknown;
}

export function LiveToolCard({ part }: ArtifactPartProps) {
	const { t } = useT("artifacts");
	const p = part as StreamingToolPart;
	const tool = p.type.replace(/^tool-/, "");
	const activity = t(activityKey(tool));
	const inp = (p.input ?? {}) as Record<string, unknown>;
	// The headline argument (ToolCallCard's rule, shown as given): path for
	// read/ls, pattern for find/grep, session for list_propositions.
	let arg = "";
	if (typeof inp.path === "string" && inp.path) arg = inp.path;
	else if (typeof inp.pattern === "string" && inp.pattern) arg = inp.pattern;
	else if (typeof inp.session === "string" && inp.session) arg = inp.session;

	const hasInput = p.input != null && Object.keys(inp).length > 0;

	return (
		<details
			data-testid="live-tool-card"
			data-tool={tool}
			className="group my-1 w-full max-w-2xl select-none"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
				<BrailleSpinner label={t("liveToolCard.live", { activity })} />
				<Shimmer duration={1} className="text-xs">
					{activity}
				</Shimmer>
				{arg && <span className="truncate">{arg}</span>}
				<ChevronRight className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			</summary>
			<div className="mt-2 rounded-xl border bg-card p-3 text-xs">
				<div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">{t("liveToolCard.input")}</div>
				<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
					{hasInput ? JSON.stringify(p.input, null, 2) : "…"}
				</pre>
			</div>
		</details>
	);
}
