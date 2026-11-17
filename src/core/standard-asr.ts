/**
 * LOCAL DICTATION through Standard ASR (2026-10-25): the shapes the server
 * and the shell share, and the transcript reducer.
 *
 * Standard ASR (github.com/standard-voice/standard_asr) is an open interface
 * between apps and speech-recognition engines: any engine installed as a
 * plugin in the app's speech environment can be selected, with no engine
 * code in the app. The server owns the environment and a resident bridge
 * (src/server/standard-asr); the renderer streams microphone PCM to the
 * bridge over a loopback WebSocket, the same shape as the Deepgram path.
 *
 * Browser-safe: pure logic + types only.
 */

/** A long-running step of the speech environment (one at a time). */
export type AsrStep = "environment" | "packages" | "model" | "removing";

/** Standard ASR's artifact progress (ArtifactProgress, JSON form). */
export interface AsrProgress {
	phase: string;
	artifact_id?: string | null;
	completed_units?: number | null;
	total_units?: number | null;
	unit?: string | null;
}

/** One installed distribution that provides engines. */
export interface AsrPackage {
	name: string;
	version: string;
	/** Where it was installed from (a Git URL, a folder) — null for PyPI. */
	source: string | null;
	commit: string | null;
	/** The engine ids its entry points declare. */
	engines: string[];
}

/** One installed model, read from its engine class (no instantiation). */
export interface AsrModel {
	/** The Standard ASR model key, "engine/model". */
	key: string;
	engine: string;
	name: string;
	package: string | null;
	description: string | null;
	/** Selectable languages (BCP-47 plus "auto"); empty = no language axis. */
	languages: string[];
	/** The PCM rate the bridge records at for this model. */
	sampleRate: number | null;
	/** How dictation runs: PCM streaming, or the whole recording at the end. */
	mode: "streaming" | "batch" | null;
	/** Live words while speaking (streaming with partials). */
	partials: boolean;
	/** Guidance it accepts — the session vocabulary goes in as a prompt or hints. */
	prompt: boolean;
	phraseHints: boolean;
	/** Why its declaration couldn't be read (a broken plugin), else null. */
	error: string | null;
}

export interface AsrInventory {
	core: AsrPackage | null;
	plugins: AsrPackage[];
	models: AsrModel[];
	python: string;
	diagnostics: string[];
}

export interface AsrArtifactAction {
	kind: string;
	message: string;
	url?: string | null;
}

export interface AsrArtifactRequirement {
	artifact_id: string;
	label: string;
	state: string;
	required_for_inference: boolean;
	can_acquire_now: boolean;
	size_bytes?: number | null;
	expected_size_bytes?: number | null;
	acquisition_blocker?: { kind: string; message?: string | null } | string | null;
	required_actions: AsrArtifactAction[];
	location?: string | null;
}

/** Standard ASR's ArtifactReport for the model's dictation mode. */
export interface AsrArtifactReport {
	mode: string;
	applicable: boolean;
	readiness: "ready" | "unavailable" | "unknown" | "not_applicable" | string;
	requirements: AsrArtifactRequirement[];
}

export interface AsrModelStatus {
	key: string;
	report: AsrArtifactReport | null;
	/** The engine couldn't be constructed or inspected. */
	error: string | null;
}

/** The resident recognizer's state. */
export type AsrRecognizerState = "stopped" | "starting" | "warming" | "ready" | "error";

/** GET /api/stt/standard-asr. */
export interface StandardAsrStatus {
	/** uv was found (bundled with the desktop app, or on PATH). */
	uv: boolean;
	/** The environment exists with the core installed. */
	installed: boolean;
	step: AsrStep | null;
	/** What the step works on (a model key, a requirement, a package). */
	task: string | null;
	progress: AsrProgress | null;
	/** The last step's failure, until the next step starts. */
	error: string | null;
	/** The one-click install's engine for this platform. */
	recommended: { label: string; runtime: string; model: string; package: string };
	inventory: AsrInventory | null;
	/** The selected model's file status (null when none is selected). */
	selectedStatus: AsrModelStatus | null;
	recognizer: AsrRecognizerState;
}

/** GET /api/stt/session — what one dictation run connects to. */
export type DictationSession =
	| { engine: "deepgram"; token: string }
	| { engine: "standard-asr"; url: string; token: string; model: string; language: string };

// ─── The transcript reducer (Standard ASR streaming §5.2) ─────────────────

/** One session's live segments in reading order. */
export interface AsrTranscript {
	order: string[];
	texts: Record<string, string>;
}

export const EMPTY_ASR_TRANSCRIPT: AsrTranscript = { order: [], texts: {} };

/** The event fields the reducer reads (TranscriptionEvent, JSON form). */
export interface AsrEvent {
	type: string;
	segment_id?: string | null;
	text?: string | null;
	old_ids?: string[] | null;
	new_ids?: string[] | null;
}

/**
 * Fold one event in: a partial/final replaces its segment's text (its
 * first mention claims a reading position); a supersede retires old_ids
 * and splices new_ids into the first retired position. Every other event
 * leaves the transcript as it is. Pure — returns a new transcript.
 */
export function reduceAsrEvent(state: AsrTranscript, event: AsrEvent): AsrTranscript {
	if ((event.type === "partial" || event.type === "final") && event.segment_id) {
		const id = event.segment_id;
		return {
			order: state.order.includes(id) ? state.order : [...state.order, id],
			texts: { ...state.texts, [id]: event.text ?? "" },
		};
	}
	if (event.type === "supersede" && event.old_ids?.length) {
		const old = new Set(event.old_ids);
		const at = state.order.findIndex((id) => old.has(id));
		const kept = state.order.filter((id) => !old.has(id));
		const position = at === -1 ? kept.length : state.order.slice(0, at).filter((id) => !old.has(id)).length;
		const texts = { ...state.texts };
		for (const id of old) delete texts[id];
		const order = [...kept.slice(0, position), ...(event.new_ids ?? []), ...kept.slice(position)];
		return { order, texts };
	}
	return state;
}

/** The display text: segment texts concatenated in reading order with NO
 *  separator — each segment carries its own joining spaces and punctuation
 *  (spec TR.1; Chinese segments carry none). */
export function asrTranscriptText(state: AsrTranscript): string {
	return state.order.map((id) => state.texts[id] ?? "").join("");
}

/** A byte count for the model-files line ("712 MB"). */
export function formatBytes(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	const units = ["kB", "MB", "GB", "TB"];
	let value = bytes / 1000;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit++;
	}
	return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
