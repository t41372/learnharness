"use client";

import { cloneElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";
import { Loader2Icon, MicIcon } from "lucide-react";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import {
	asrTranscriptText,
	EMPTY_ASR_TRANSCRIPT,
	reduceAsrEvent,
	type AsrEvent,
	type AsrTranscript,
	type DictationSession,
} from "@/src/core";
import { useT, type TFunction } from "@/components/i18n";

/**
 * Voice dictation — the cloud engine (STT wave 1, 2026-09-17).
 *
 * Architecture (docs/research/stt.md): the renderer captures mic audio in
 * an AudioWorklet (public/worklets/pcm-capture.js → linear16 16kHz mono),
 * opens the Deepgram streaming WebSocket DIRECTLY (audio never loops
 * through our server) with a short-lived token minted by /api/stt/token
 * (the real key stays server-side), and streams frames while it listens.
 * Finals append into the PRIMARY INPUT (see below).
 *
 * Ported patterns from the owner's pi `dictate` extension (his words:
 * "very well tuned") — see ~/.pi/agent/extensions/dictate:
 *   - generation counter: every start/stop increments it; all async
 *     handlers no-op when stale, so a dying session's socket can never
 *     tear down the current one.
 *   - meter: latest-RMS-never-resets — the level ref keeps the last
 *     observed value, so a tick with no fresh audio re-renders the last
 *     level instead of dropping to silence (60ms tick samples the ref).
 *   - dB mapping floor −50 / ceiling −10: the sweet spot for showing
 *     conversational speech as mid-height bars without pegging.
 *   - stop: mic dies FIRST (no more audio enqueues), then CloseStream,
 *     then a 3s safety net in case Deepgram never closes the socket.
 *   - interim_results=false, endpointing=300: his live-tuned params — no
 *     partial hypotheses, finals commit ~300ms after a pause (owner
 *     round 1: live words are distracting and shift the meter; the
 *     meter's width is FIXED while recording).
 *
 * Owner round 2 (2026-09-17, second live test):
 *   - DEFERRED transcript: finals accumulate in a buffer during the run
 *     and flush into the primary input ONCE, when the dictation ends
 *     (click-again/Esc → Deepgram flushes its last finals → socket close
 *     → one joined append). Nothing textual renders while recording —
 *     only the meter. Live output may return as a toggleable setting at
 *     the settings milestone; deferred is the only behavior for now.
 *   - ADAPTIVE meter: the strip's cell count derives from its measured
 *     width (4px pitch, 8–48 cells, ResizeObserver) so narrow rows (the
 *     draft view's tighter column) show fewer bars instead of
 *     overflowing under their neighbors.
 *
 * Owner round 1 (2026-09-17, first live mic test):
 *   - ONE primary transcription input at all times: the pending
 *     quiz/ask question's field while one waits (text mode → the answer
 *     field, select modes → "Your thinking"), else the page's composer.
 *     Implemented as a module-level registry the question form claims on
 *     mount — see useDictationTarget below.
 *   - Click → meter IMMEDIATELY (optimistic): the meter strip renders
 *     from the click, connection + TCC happen behind it. The token mint
 *     and the mic acquisition run CONCURRENTLY (Promise.all) to shrink
 *     the real gap.
 *
 * Meter rendering lives in <DictationBar> (own 60ms timer over the level
 * ref) so the 16-renders/sec never touch the page component — only the
 * tiny bar strip repaints.
 *
 * Start-latency mitigation wave (owner, 2026-09-27 — A+B+C+D, the
 * optimistic meter stays): the old start path serialized [token ∥ mic] →
 * NEW AudioContext → addModule fetch → WSS handshake, and DROPPED every
 * frame that arrived before the socket was OPEN — the first seconds of
 * speech never reached Deepgram. Now:
 *   - QUEUE-DON'T-DROP (A): frames arriving before OPEN buffer (capped,
 *     oldest dropped) and flush in order on open — captured speech is
 *     never lost, wherever in setup it lands.
 *   - PARALLEL HANDSHAKE (B, mic-gated): the handshake starts the moment
 *     the capture graph is live, not after it. Mic-gated, NOT token-gated:
 *     an OS TCC prompt can outlive Deepgram's 10s idle timeout.
 *   - PERSISTENT GRAPH (C): one app-lifetime AudioContext + a memoized
 *     worklet module — per-run contexts paid context creation AND a
 *     worklet-module fetch on every start (through the dev server in dev).
 *   - WARM TOKEN (D): pre-minted at page mount and refreshed after every
 *     run (TTL 3min); the click no longer waits on the remote mint. A
 *     stale-token handshake failure self-heals via the reconnect-once
 *     path, which always mints FRESH.
 *   - The honest floor stays: getUserMedia can't be pre-warmed (the mic
 *     indicator would stay lit) — hence the owner's optimistic meter.
 *
 * Local engine (2026-10-25): Settings → Dictation can switch the engine to
 * STANDARD ASR — any engine plugin installed in the app's speech
 * environment, recognizing on this device. The run is the same machine
 * (optimistic meter, queue-don't-drop, warm session, generation guard,
 * one reconnect), only the socket differs: GET /api/stt/session hands back
 * the resident bridge's loopback URL + launch token instead of a Deepgram
 * token (src/server/dictation.ts), the socket opens with a start frame
 * (token, model, language, the session's vocabulary as guidance), audio
 * flows once the bridge answers "ready", and an end frame flushes it. Its
 * events reduce into the live transcript (core/standard-asr.ts) — and,
 * unlike Deepgram's deferred finals, the LIVE words show while recording,
 * faded at the end of the target field (owner, 2026-10-25: DictationField
 * below); the final text still lands once, when the run ends.
 */

/*
 * Deepgram streaming params (the owner's live-tuned dictate config): nova-3,
 * endpointing=300, no interims. Silence streams too (the worklet never
 * pauses), so the socket never idles — no KeepAlive needed.
 */
const DG_URL =
	"wss://api.deepgram.com/v1/listen" +
	"?model=nova-3" +
	"&encoding=linear16" +
	"&sample_rate=16000" +
	"&channels=1" +
	"&smart_format=true" +
	"&punctuate=true" +
	"&endpointing=300";

/** Meter tuning — the owner's tested values, see the file header. */
const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;
export const METER_TICK_MS = 60;
/** Rolling history: 48 cells × 60ms ≈ 2.9s of recent loudness. */
export const METER_CELLS = 48;

/** The Deepgram key's id in the keys store (the env-var name — the Keys
 *  section's openRow state and the PUT /api/keys/:id seam). */
export const DEEPGRAM_KEY_ID = "DEEPGRAM_API_KEY";

/** The client-authored KEYLESS line (zero-keys wave, owner 2026-09-25):
 * the token route's raw 503 message is dev-speak ("add it to auth.json
 * (desktop) or .env.local (dev)") — the surface says the short truth
 * instead. Exported for pins; the start path recognizes it as the
 * `keyless` error, whose errored idle button's click deep-links Settings
 * → Keys → the Deepgram row. */
export const DICTATION_KEYLESS = "Dictation needs a Deepgram key";

/** The local engine's not-ready line (local dictation, 2026-10-25): no
 *  speech environment yet, or no model chosen. Its click deep-links to
 *  Settings → Dictation, like the keyless line. */
export const DICTATION_LOCAL_UNSET = "Set up local dictation";

/** A terminal failure (i18n wave, 2026-10-25): an id per client-authored
 *  line — the bar renders it in the interface language — and `message`
 *  for text the browser, the session route or the local bridge wrote,
 *  shown as given. `engine` names which engine's socket failed. */
export type DictationError =
	| { kind: "keyless" }
	| { kind: "localUnset" }
	| { kind: "micDenied" }
	| { kind: "micUnavailable" }
	| { kind: "tokenUnavailable" }
	| { kind: "reconnectFailed"; engine: "deepgram" | "local" }
	| { kind: "connectionLost"; engine: "deepgram" | "local"; code: number }
	| { kind: "message"; text: string };

/** The line the bar shows for a failure. */
function dictationErrorText(error: DictationError, t: TFunction<"artifacts">): string {
	switch (error.kind) {
		case "reconnectFailed":
			return error.engine === "local" ? t("dictation.error.localReconnectFailed") : t("dictation.error.reconnectFailed");
		case "connectionLost":
			return error.engine === "local"
				? t("dictation.error.localConnectionLost", { code: error.code })
				: t("dictation.error.connectionLost", { code: error.code });
		case "message":
			return error.text;
		default:
			return t(`dictation.error.${error.kind}`);
	}
}

/** Mint a fresh run session — the selected engine's connection (the route
 *  holds every secret server-side). Module-level: the start path's warm
 *  cache and the reconnect path both bottom out here. The not-configured
 *  refusals carry a machine code and become the short client-authored
 *  lines (zero-keys wave, owner 2026-09-25): the raw messages are
 *  dev-speak. */
async function mintFreshSession(): Promise<DictationSession> {
	const res = await fetch("/api/stt/session");
	const data = (await res.json()) as DictationSession | { code?: string; message?: string };
	if (!res.ok || !("engine" in data)) {
		const refusal = data as { code?: string; message?: string };
		if (refusal.code === "deepgram_keyless") throw new Error(DICTATION_KEYLESS);
		if (refusal.code === "asr_not_installed" || refusal.code === "asr_no_model") throw new Error(DICTATION_LOCAL_UNSET);
		throw new Error(refusal.message ?? `session route ${res.status}`);
	}
	return data;
}

/** Warm-token cache (mitigation D, owner 2026-09-27): the click path takes
 *  the cached promise instead of a remote mint. TTL keeps a cached token
 *  from going stale (self-heal anyway: a rejected handshake rides the
 *  reconnect-once path with a FRESH mint); a failed mint resets the cache
 *  so the next call re-mints — the honest error path stays honest.
 *  refresh() re-mints in the background (page mount, run end); its
 *  failures are silently tolerated (a keyless pre-mint just doesn't warm). */
export const WARM_TOKEN_TTL_MS = 3 * 60_000;

export type WarmMinter<T = string> = { mint: () => Promise<T>; refresh: () => void };

export function createWarmMinter<T>(
	mint: () => Promise<T>,
	now: () => number = Date.now,
	ttlMs: number = WARM_TOKEN_TTL_MS,
): WarmMinter<T> {
	let warm: { p: Promise<T>; at: number } | null = null;
	const m: WarmMinter<T> = {
		mint: () => {
			if (!warm || now() - warm.at > ttlMs) {
				const p = mint().catch((e: unknown) => {
					warm = null; // failed mint: next call re-mints
					throw e;
				});
				warm = { p, at: now() };
			}
			return warm.p;
		},
		refresh: () => {
			warm = null;
			m.mint().catch(() => {}); // background best-effort
		},
	};
	return m;
}

const warmTokens = createWarmMinter(mintFreshSession);

/* Persistent capture graph (mitigation C, owner 2026-09-27): one
 * app-lifetime AudioContext + a module-load memo. Created under the
 * click gesture (autoplay policy) and NEVER closed — per-run nodes
 * (source, worklet) disconnect at teardown instead. */
let sharedCtx: AudioContext | null = null;
let workletModule: Promise<void> | null = null;

function ensureAudioGraph(): { ctx: AudioContext; module: Promise<void> } {
	if (!sharedCtx) sharedCtx = new AudioContext({ sampleRate: 16000 });
	if (!workletModule) {
		workletModule = sharedCtx.audioWorklet.addModule("/worklets/pcm-capture.js").catch((e: unknown) => {
			workletModule = null; // failed load: retry next run
			throw e;
		});
	}
	return { ctx: sharedCtx, module: workletModule };
}

/** RMS (0..1) → normalized 0..1 across the audible dB window. */
export function rmsToMeter(rms: number): number {
	if (rms <= 0) return 0;
	const db = 20 * Math.log10(rms);
	const t = (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB);
	return Math.max(0, Math.min(1, t));
}

/**
 * The primary-input registry: at most ONE non-composer input can claim the
 * dictation target while mounted — the pending question's answer/thinking
 * field (question-dock.tsx). The page's `append` (the composer) is the
 * fallback when nobody claims. Module-level by design: the claimant is a
 * sibling subtree far from the hook's owner, and there is exactly one
 * window, one pending question, one target at a time.
 */
let questionTarget: ((text: string) => void) | null = null;

/* Is a dictation run live on this page? The Esc chain (keyboard wave A,
 * components/keyboard-shortcuts.tsx) needs a SYNCHRONOUS answer — the
 * stop handler can't report back through a CustomEvent. Set at start(),
 * cleared in cleanup() (every terminal path runs through cleanup). */
let dictationActiveFlag = false;

export function isDictationActive(): boolean {
	return dictationActiveFlag;
}

/* The finisher registry: submit paths FAR from the hook's owner (the
 * pending question's dock) need finish() without a prop bridge. Same
 * module-level pattern as questionTarget — one window, one instance,
 * one finisher. Empty registry (no hook mounted) → resolve immediately. */
let dictationFinisher: (() => Promise<void>) | null = null;

/** Finish any live dictation run before continuing (see Dictation.finish). */
export function finishDictation(): Promise<void> {
	return dictationFinisher ? dictationFinisher() : Promise.resolve();
}

/** Join a dictated final onto the current text (shared separator rule). */
export function joinDictation(current: string, final: string): string {
	return current ? current.replace(/\s+$/, "") + " " + final : final;
}

/* THE LIVE PREVIEW (local engine, owner 2026-10-25): the words the local
 * recognizer has heard so far in this run, shown faded at the end of the
 * field the run will flush into. A module-level store (useSyncExternalStore)
 * so only the target field re-renders per partial — never the page. The
 * target is resolved at each update, exactly as the flush resolves it:
 * the claiming question field, else the page's composer. */
type DictationPreview = { text: string; target: "question" | "page" };
const NO_PREVIEW: DictationPreview = { text: "", target: "page" };
let preview: DictationPreview = NO_PREVIEW;
const previewListeners = new Set<() => void>();

function setPreview(text: string) {
	const next = text ? { text, target: questionTarget ? ("question" as const) : ("page" as const) } : NO_PREVIEW;
	if (next.text === preview.text && next.target === preview.target) return;
	preview = next;
	for (const listener of previewListeners) listener();
}

function subscribePreview(listener: () => void) {
	previewListeners.add(listener);
	return () => {
		previewListeners.delete(listener);
	};
}

/** The live words for a field: the composer passes "page"; a question
 *  field passes "question" with its claim, so only the claimant shows them. */
export function useDictationPreview(target: "question" | "page", claimed = true): string {
	const current = useSyncExternalStore(subscribePreview, () => preview, () => NO_PREVIEW);
	return claimed && current.target === target ? current.text : "";
}

/* THE SESSION VOCABULARY (local engine): words the recognizer should
 * expect — the session title, the plan's step names, the question on
 * screen. Surfaces register them while mounted; a run sends the union as
 * guidance (the bridge turns it into the engine's prompt or phrase hints,
 * within its declared limits — or drops it for an engine with neither). */
const termSources = new Set<readonly string[]>();

/** Register terms while mounted. Pass a memoized array. */
export function useDictationTerms(terms: readonly string[]) {
	useEffect(() => {
		termSources.add(terms);
		return () => {
			termSources.delete(terms);
		};
	}, [terms]);
}

/** The registered vocabulary: trimmed, de-duplicated, bounded. Pure over
 *  its input — exported for tests. */
export function collectDictationTerms(sources: Iterable<readonly string[]> = termSources): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const source of sources) {
		for (const raw of source) {
			const term = raw.replace(/\s+/g, " ").trim();
			if (!term || term.length > 80 || seen.has(term.toLowerCase())) continue;
			seen.add(term.toLowerCase());
			out.push(term);
			if (out.length >= 60) return out;
		}
	}
	return out;
}

/**
 * Claim the dictation target while mounted (and `claimed` is true). The
 * unmount guard is identity-based so dev-mode double-invoked effects
 * can't clear another claimant.
 */
export function useDictationTarget(append: (text: string) => void, claimed: boolean) {
	useEffect(() => {
		if (!claimed) return;
		questionTarget = append;
		return () => {
			if (questionTarget === append) questionTarget = null;
		};
	}, [append, claimed]);
}

export type DictationPhase = "idle" | "connecting" | "recording" | "stopping";

export type Dictation = {
	phase: DictationPhase;
	/** Terminal-state explanation, shown inside the wide button (cleared on the next start). */
	error: DictationError | null;
	/** Latest observed RMS, 0..1 — sampled by the meter's own tick, never reset. */
	levelRef: { current: number };
	/** Not idle — from the click until the stop completes (the optimistic window). */
	active: boolean;
	/** End + KEEP the transcript: flush the deferred buffer into the primary
	 *  input (the Stop pill and ⌘D). */
	toggle: () => void;
	stop: () => void;
	/** FINISH, THEN CONTINUE (owner, 2026-10-01 "nothing gets lost" round):
	 *  if a run is live, stop it and resolve only when the run has fully
	 *  ended — Deepgram's last finals have landed in the target field. A
	 *  submit path awaits this before building its payload, so a learner
	 *  who forgets to stop dictation before Enter never loses the spoken
	 *  reasoning. Idle → resolves immediately (the common no-run submit
	 *  pays nothing). Every terminal path runs cleanup(), and cleanup()
	 *  resolves the waiters — cancel (Esc) resolves them too, by its
	 *  discard semantics. */
	finish: () => Promise<void>;
	/** End + DISCARD the transcript: no flush, immediate teardown. The Esc
	 *  semantics (owner, 2026-09-17 round 3): Esc is a cancel, not a stop —
	 *  before, it flushed exactly like the toggle did. */
	cancel: () => void;
	/** Clear the terminal error without starting a run (zero-keys wave):
	 * the keyless click leaves for Settings and the surface must come
	 * back clean. */
	clearError: () => void;
};

/**
 * One dictation instance per composer-bearing page. `append` is the
 * composer fallback; the mounted question form's claim wins while a
 * question waits.
 */
export function useDictation({ append }: { append: (text: string) => void }): Dictation {
	const [phase, setPhase] = useState<DictationPhase>("idle");
	const [error, setError] = useState<DictationError | null>(null);
	/** Latest RMS from the worklet — the meter samples this (dictate pattern). */
	const levelRef = useRef(0);
	/** The page's fallback append — kept fresh per render so a mid-recording
	 *  retarget (composer↔question) is honored on the very next final. */
	const appendRef = useRef(append);
	appendRef.current = append;

	// Live machinery (non-render values). The MediaStream tracks stop and
	// the per-run nodes disconnect on teardown; the socket is recreated per
	// run; the AudioContext is app-lifetime (mitigation C).
	const wsRef = useRef<WebSocket | null>(null);
	/** The run's engine connection — Deepgram's token or the local bridge. */
	const sessionRef = useRef<DictationSession | null>(null);
	/** The socket takes audio: Deepgram once OPEN, the local bridge once it
	 *  answered "ready" (its session is open and its model warm). */
	const acceptingRef = useRef(false);
	const streamRef = useRef<MediaStream | null>(null);
	/** Per-run graph nodes — the CONTEXT outlives runs (mitigation C). */
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const workletRef = useRef<AudioWorkletNode | null>(null);
	/** Frames captured before the socket accepts audio (mitigation A):
	 *  flushed in order once it does; capped at 256 frames (≈32s) with the
	 *  oldest dropped; cleared at teardown so a dead run's audio can't leak
	 *  into the next. */
	const pendingRef = useRef<ArrayBuffer[]>([]);
	const genRef = useRef(0); // stale-handler guard (dictate pattern)
	const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectsRef = useRef(0);
	/** The deferred transcript (owner round 2): finals land here during the
	 *  run and flush into the primary input once, at teardown. */
	const bufferRef = useRef<string[]>([]);
	/** The local engine's live segments (this connection's) — the preview
	 *  and, should the bridge never send its transcript, the fallback text. */
	const transcriptRef = useRef<AsrTranscript>(EMPTY_ASR_TRANSCRIPT);
	/** Resolvers waiting for the run to fully end (finish(), owner
	 *  2026-10-01): released by cleanup() — every terminal path runs it. */
	const waitersRef = useRef<Array<() => void>>([]);

	/** Flush the buffered transcript into the primary input — question claim
	 *  first, composer fallback. Called exactly once per run, at cleanup; the
	 *  buffer clears itself so double-cleanup is a no-op. */
	const flush = useCallback(() => {
		if (bufferRef.current.length === 0) return;
		const text = bufferRef.current.join(" ");
		bufferRef.current = [];
		(questionTarget ?? appendRef.current)(text);
	}, []);

	/** The local connection's words so far move into the run's buffer (a
	 *  connection ends: its transcript, or what it showed). */
	const commitLocal = useCallback((text: string | null) => {
		const words = (text ?? asrTranscriptText(transcriptRef.current)).trim();
		if (words) bufferRef.current.push(words);
		transcriptRef.current = EMPTY_ASR_TRANSCRIPT;
	}, []);

	/** Full teardown of one run's machinery. Idempotent; generation-guarded by callers. */
	const cleanup = useCallback(() => {
		genRef.current++;
		dictationActiveFlag = false;
		setPreview(""); // the live words give way to the flushed text
		flush(); // the deferred transcript appears when the run ends (owner round 2)
		if (safetyRef.current) {
			clearTimeout(safetyRef.current);
			safetyRef.current = null;
		}
		pendingRef.current = [];
		acceptingRef.current = false;
		transcriptRef.current = EMPTY_ASR_TRANSCRIPT;
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;
		// The AudioContext is app-lifetime (mitigation C) — nodes die, it stays.
		const ws = wsRef.current;
		wsRef.current = null;
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
			try {
				ws.close();
			} catch {}
		}
		setPhase("idle");
		// The finish() waiters ride until NOW — post-flush, post-teardown:
		// a submit path resuming after `await finishDictation()` reads the
		// target field with the dictated tail already in it.
		for (const w of waitersRef.current.splice(0)) w();
		// Pre-mint for the next run (mitigation D) — best-effort; a keyless
		// page just doesn't warm.
		warmTokens.refresh();
	}, [flush]);

	/** Everything captured while the socket couldn't take audio goes out now,
	 *  in order — both engines accept faster-than-realtime sends. */
	const startSending = useCallback((ws: WebSocket) => {
		acceptingRef.current = true;
		for (const frame of pendingRef.current) ws.send(frame);
		pendingRef.current = [];
		setPhase("recording");
	}, []);

	/** Open the run's socket and wire its messages. `gen` guards staleness. */
	const openSocket = useCallback(
		(gen: number, session: DictationSession) => {
			sessionRef.current = session;
			acceptingRef.current = false;
			const ws =
				session.engine === "deepgram"
					? // Minted JWTs authenticate via the "bearer" subprotocol —
						// ["token", jwt] is rejected at the handshake (verified live;
						// "token" is for raw API keys only, as in the owner's pi
						// dictate extension).
						new WebSocket(DG_URL, ["bearer", session.token])
					: new WebSocket(session.url);
			ws.binaryType = "arraybuffer";
			wsRef.current = ws;
			/** The local bridge's own failure line, if it sent one. */
			let localError: string | null = null;
			/** The local bridge's final text, if it sent it. */
			let localTranscript: string | null = null;

			ws.addEventListener("open", () => {
				if (gen !== genRef.current) return;
				if (session.engine === "deepgram") {
					startSending(ws);
					return;
				}
				// The local bridge admits the connection on its start frame:
				// the launch token, the model, the language, and the session's
				// vocabulary (turned into the engine's guidance there).
				ws.send(
					JSON.stringify({
						type: "start",
						token: session.token,
						model: session.model,
						options: { language: session.language },
						terms: collectDictationTerms(),
					}),
				);
			});
			ws.addEventListener("message", (ev) => {
				if (gen !== genRef.current || typeof ev.data !== "string") return;
				let msg: any;
				try {
					msg = JSON.parse(ev.data);
				} catch {
					return;
				}
				if (session.engine === "deepgram") {
					if (msg.type === "Results") {
						const text: string | undefined = msg.channel?.alternatives?.[0]?.transcript;
						// Only finals stream (interim_results=false). DEFERRED (owner
						// round 2): they buffer here and reach the input once, at
						// teardown — the meter is the only live feedback.
						if (msg.is_final && text) bufferRef.current.push(text);
					}
					return;
				}
				if (msg.type === "ready") startSending(ws);
				else if (msg.type === "event" && msg.event) {
					transcriptRef.current = reduceAsrEvent(transcriptRef.current, msg.event as AsrEvent);
					// The live words: everything committed so far this run, then
					// this connection's segments (owner, 2026-10-25).
					setPreview([...bufferRef.current, asrTranscriptText(transcriptRef.current).trim()].filter(Boolean).join(" "));
				} else if (msg.type === "transcript") localTranscript = typeof msg.text === "string" ? msg.text : "";
				else if (msg.type === "error") localError = typeof msg.message === "string" ? msg.message : "Local dictation failed";
			});
			ws.addEventListener("close", (ev) => {
				if (gen !== genRef.current) return;
				if (session.engine === "standard-asr") {
					commitLocal(localTranscript);
					if (localError === null && ev.code === 1000) {
						cleanup();
						return;
					}
				} else if (ev.code === 1000) {
					// Our own CloseStream landing: finalize now — the stop path's
					// safety net stays as the no-close backstop only.
					cleanup();
					return;
				}
				// Abnormal close mid-run: ONE reconnect with a fresh session (the
				// research pass: resume is our job, no SDK to lean on). A stopping
				// run doesn't reconnect — there is nothing left to send.
				if (reconnectsRef.current < 1 && streamRef.current) {
					reconnectsRef.current++;
					mintFreshSession() // always FRESH — a stale warm session is the likely culprit
						.then((s) => {
							if (gen === genRef.current) openSocket(gen, s);
						})
						.catch(() => {
							if (gen === genRef.current) {
								setError(localError !== null ? { kind: "message", text: localError } : { kind: "reconnectFailed", engine: session.engine === "deepgram" ? "deepgram" : "local" });
								cleanup();
							}
						});
				} else {
					setError(localError !== null ? { kind: "message", text: localError } : { kind: "connectionLost", engine: session.engine === "deepgram" ? "deepgram" : "local", code: ev.code });
					cleanup();
				}
			});
		},
		[cleanup, commitLocal, startSending],
	);

	const start = useCallback(async () => {
		dictationActiveFlag = true;
		setError(null);
		setPhase("connecting");
		reconnectsRef.current = 0;
		bufferRef.current = []; // fresh run, fresh buffer (round 2)
		pendingRef.current = []; // fresh run, fresh queue (mitigation A)
		transcriptRef.current = EMPTY_ASR_TRANSCRIPT;
		const gen = ++genRef.current;

		// Mitigation D: the warm session (pre-minted at mount / after the last
		// run) resolves ~instantly; a cold/keyless mint surfaces below. The
		// mic is the long pole (macOS HAL + APM init) and gates everything —
		// the session runs concurrently with it. 127.0.0.1 is a secure
		// context, so getUserMedia works without TLS; macOS TCC prompts on
		// first use.
		const sessionPromise = warmTokens.mint();
		sessionPromise.catch(() => {}); // surfaced below; no unhandled rejection
		const micPromise = navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
		let stream: MediaStream;
		try {
			stream = await micPromise;
			if (gen !== genRef.current) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			streamRef.current = stream;

			// Mitigation C: app-lifetime context + memoized worklet module —
			// per-run costs (context creation, module fetch) are gone.
			const { ctx, module } = ensureAudioGraph();
			await module;
			if (ctx.state === "suspended") await ctx.resume();
			if (gen !== genRef.current) return;

			const worklet = new AudioWorkletNode(ctx, "pcm-capture");
			workletRef.current = worklet;
			worklet.port.onmessage = (e) => {
				const msg = e.data as { type: string; rms?: number; buffer?: ArrayBuffer };
				if (msg.type === "level") {
					levelRef.current = msg.rms ?? 0; // never reset to zero (dictate pattern)
				} else if (msg.type === "audio") {
					const ws = wsRef.current;
					if (ws && ws.readyState === WebSocket.OPEN && acceptingRef.current) ws.send(msg.buffer!);
					// Mitigation A: not accepting yet (handshake, the bridge's
					// warm-up, or a reconnect gap) — queue, capped; the socket
					// flushes in order once it takes audio.
					else {
						pendingRef.current.push(msg.buffer!);
						if (pendingRef.current.length > 256) pendingRef.current.shift();
					}
				}
			};
			const source = ctx.createMediaStreamSource(stream);
			sourceRef.current = source;
			source.connect(worklet);
			// Pull the graph with silence out (the worklet writes no output) —
			// an unconnected worklet node is never clocked.
			worklet.connect(ctx.destination);
		} catch (e) {
			if (gen !== genRef.current) return;
			setError(
				e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
					? { kind: "micDenied" }
					: e instanceof Error
						? { kind: "message", text: e.message }
						: { kind: "micUnavailable" },
			);
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;
		let session: DictationSession;
		try {
			session = await sessionPromise;
		} catch (e) {
			if (gen !== genRef.current) return;
			setError(
				!(e instanceof Error)
					? { kind: "tokenUnavailable" }
					: e.message === DICTATION_KEYLESS
						? { kind: "keyless" }
						: e.message === DICTATION_LOCAL_UNSET
							? { kind: "localUnset" }
							: { kind: "message", text: e.message },
			);
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;
		// Mitigation B: the handshake fires the moment the graph is live,
		// overlapping any remaining token wait — mic-gated, never before it.
		openSocket(gen, session);
	}, [openSocket, cleanup]);

	const stop = useCallback(() => {
		const gen = genRef.current;
		if (phase !== "recording" && phase !== "connecting") return;
		setPhase("stopping");

		// Mic dies FIRST — no more audio enqueues (dictate pattern). The
		// per-run nodes die with it; the AudioContext stays (mitigation C).
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;

		const ws = wsRef.current;
		const local = sessionRef.current?.engine === "standard-asr";
		if (ws && ws.readyState === WebSocket.OPEN && (acceptingRef.current || !local)) {
			try {
				// Deepgram: CloseStream flushes the last finals. The local
				// bridge: the end frame ends the audio, and its final decode
				// sends the transcript before it closes.
				ws.send(JSON.stringify({ type: local ? "end" : "CloseStream" }));
			} catch {
				cleanup();
				return;
			}
			// If the engine never closes, the safety net ends the run anyway
			// (dictate pattern) — longer for a local final decode.
			safetyRef.current = setTimeout(() => {
				if (gen === genRef.current) {
					if (local) commitLocal(null);
					cleanup();
				}
			}, local ? 15_000 : 3000);
		} else {
			cleanup();
		}
	}, [phase, cleanup, commitLocal]);

	const cancel = useCallback(() => {
		if (phase === "idle") return;
		// Discard first, teardown second — cleanup() flushes, and the now-empty
		// buffer makes that flush a no-op. Also kills a "stopping" run: the
		// flush already underway is abandoned (its timer is cleared inside).
		bufferRef.current = [];
		cleanup();
	}, [phase, cleanup]);

	const finish = useCallback((): Promise<void> => {
		return new Promise((resolve) => {
			if (phase === "idle") {
				resolve();
				return;
			}
			waitersRef.current.push(resolve);
			// "stopping" is already ending — the waiter just rides to cleanup.
			if (phase === "recording" || phase === "connecting") stop();
		});
	}, [phase, stop]);

	// Publish finish() for the sibling subtrees (the pending question's
	// dock) — registered for as long as this page owns the hook.
	useEffect(() => {
		dictationFinisher = finish;
		return () => {
			if (dictationFinisher === finish) dictationFinisher = null;
		};
	}, [finish]);

	const toggle = useCallback(() => {
		if (phase === "idle") void start();
		else if (phase === "recording" || phase === "connecting") stop();
		// "stopping" presses are ignored — the flush is in flight.
	}, [phase, start, stop]);

	// Shortcut seams (keyboard wave A): ⌘D toggles from anywhere on the
	// page; the Esc chain lands here as a CANCEL (owner, round 3). Each
	// page owns ONE hook instance, and only the mounted page's listener is
	// attached.
	useEffect(() => {
		// Pre-mint at mount (mitigation D) — silent if keyless. For the local
		// engine this also starts the bridge and loads the model, so the
		// first press doesn't wait on the model.
		warmTokens.refresh();
	}, []);
	useEffect(() => {
		window.addEventListener("lh:kbd-toggle-dictation", toggle);
		return () => window.removeEventListener("lh:kbd-toggle-dictation", toggle);
	}, [toggle]);
	useEffect(() => {
		window.addEventListener("lh:kbd-cancel-dictation", cancel);
		return () => window.removeEventListener("lh:kbd-cancel-dictation", cancel);
	}, [cancel]);

	return {
		phase,
		error,
		levelRef,
		active: phase !== "idle",
		toggle,
		stop,
		finish,
		cancel,
		clearError: () => setError(null),
	};
}

/**
 * The stats-bar dictation slot (owner placement, round 1): the row's middle
 * is one strip that is always the full free width —
 *
 *   idle      a wide, quiet "Dictate" button (mic + label, grayed out — the
 *             whole middle is the affordance, per the owner).
 *   active    optimistic from the CLICK: red stop pill + the fixed-width
 *             meter (no interim text ever shifts it). Spinner while
 *             Deepgram flushes the last final.
 *   error     the wide button again, label swapped for the failure reason
 *             (full text in the tooltip), cleared on the next click.
 */
export function DictationBar({ dictation }: { dictation: Dictation }) {
	const { phase, error, levelRef, toggle, active, clearError } = dictation;
	const { open: openSettings } = useSettingsDialog();
	const { t } = useT("artifacts");
	const errorText = error ? dictationErrorText(error, t) : null;
	/** The keyless click (zero-keys wave, owner dictation trio): the errored
	 *  idle button deep-links Settings → Keys → the Deepgram row and clears
	 *  the error — the surface is clean when the user returns. Any other
	 *  error keeps the old behavior (click = retry, which clears). */
	const keyless = error?.kind === "keyless";
	/** The local engine's not-set-up line deep-links the same way — to the
	 *  Dictation section, where the engine is installed and chosen. */
	const localUnset = error?.kind === "localUnset";
	const [levels, setLevels] = useState<number[]>(() => new Array(METER_CELLS).fill(0));
	const recording = phase === "recording" || phase === "stopping";
	/** Adaptive cell count (owner round 2): derived from the meter's
	 *  measured width — narrow rows show fewer bars instead of
	 *  overflowing under neighbors. */
	const [cellCount, setCellCount] = useState(METER_CELLS);
	const meterRef = useRef<HTMLDivElement | null>(null);

	// The meter's own heartbeat — 60ms samples of the level ref into a
	// rolling ring. Only THIS strip re-renders; the page never does.
	useEffect(() => {
		if (!active) return;
		setLevels(new Array(METER_CELLS).fill(0));
		const id = setInterval(() => {
			setLevels((ring) => {
				const next = ring.slice(1);
				next.push(rmsToMeter(levelRef.current));
				return next;
			});
		}, METER_TICK_MS);
		return () => clearInterval(id);
	}, [active, levelRef]);

	// Fit the cell count to the available width (4px pitch per cell:
	// 2px bar + 2px gap, clamped 8..48). The meter div's width is set by
	// the row's free space — cells carry no minimum width — so measuring
	// it once per activation + on resize keeps the strip honest in the
	// draft/home rows where the slider leaves little middle.
	useEffect(() => {
		if (!active) return;
		const el = meterRef.current;
		if (!el) return;
		const fit = () => {
			const w = el.clientWidth;
			setCellCount(Math.max(8, Math.min(METER_CELLS, Math.floor(w / 4))));
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [active]);

	if (!active) {
		return (
			<Hint
				// Errored: the button span truncates the line — the tooltip is its
				// full reveal (the keyless line KEEPS "Deepgram" — owner overrule:
				// it's the Keys row label, the truth the user needs). Otherwise the
				// quiet label + the live ⌘D binding.
				label={errorText ?? t("dictation.dictate")}
				action={errorText ? undefined : "toggle-dictation"}
				side="top"
			>
				<button
					type="button"
					onClick={() => {
						if (keyless || localUnset) {
							clearError();
							// The Deepgram key lives in Settings → Dictation now
							// (local dictation, 2026-10-25), beside the engine choice.
							openSettings("dictation", keyless ? DEEPGRAM_KEY_ID : undefined);
						} else {
							toggle();
						}
					}}
					aria-label={errorText ? t("dictation.failedAria", { reason: errorText }) : t("dictation.start")}
					data-testid="dictation-toggle"
				// Same blurring as the floating chrome (owner, fix wave round 3),
			// but lower opacity — the mic stays quieter than the model pills.
			className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border/50 bg-card/50 text-xs text-muted-foreground/70 shadow-lg backdrop-blur transition-colors hover:border-border hover:text-muted-foreground"
			>
					<MicIcon className="size-3.5" />
					<span className="max-w-full truncate">{errorText ?? t("dictation.dictate")}</span>
				</button>
			</Hint>
		);
	}

	return (
		<div className="flex w-full min-w-0 items-center gap-2" data-testid="dictation-bar">
			<Hint
				// The owner flagged this copy good ("Stop dictation (Esc)") —
				// kept verbatim; only the machinery moved to the styled tooltip.
				label={t("dictation.stopHint")}
				side="top"
			>
				<button
					type="button"
					onClick={toggle}
					disabled={phase === "stopping"}
					aria-label={t("dictation.stop")}
				data-testid="dictation-toggle"
				className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-destructive/10 px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
			>
				{phase === "stopping" ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : (
					<MicIcon className="size-3.5" />
				)}
					{t("dictation.stopButton")}
				</button>
			</Hint>
			<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
			{/* Fixed width while recording — nothing ever appends text beside it
			    (no interims, owner round 1). Cells carry no minimum width; the
			    COUNT adapts to the measured row space (owner round 2). */}
			<div ref={meterRef} className="flex h-4 min-w-0 flex-1 items-center gap-[2px]" data-testid="dictation-meter">
				{levels.slice(-cellCount).map((v, i) => (
					<span
						key={i}
						className="min-w-0 flex-1 rounded-full bg-foreground/40"
						style={{ height: `${2 + Math.round(v * 14)}px` }}
					/>
				))}
			</div>
		</div>
	);
}

/**
 * A dictation target's textarea with the LIVE words (local engine, owner
 * 2026-10-25): while a run's preview is non-empty, a mirror of the field's
 * text sits in normal flow — the typed text invisible, the heard words
 * faded after it — and the SAME textarea element lays out absolutely over
 * it, so the field grows with the preview and keeps its focus and caret.
 * `layout` carries the textarea's text-box classes (padding, line height,
 * max height) so the mirror wraps exactly as the textarea does. With no
 * preview the wrapper is inert: the textarea lays out as it always has.
 */
export function DictationField({
	value,
	preview,
	layout,
	className,
	children,
}: {
	value: string;
	preview: string;
	layout: string;
	className?: string;
	children: React.ReactElement<{ className?: string }>;
}) {
	const live = preview !== "";
	return (
		<div className={cn("relative", className)} data-testid={live ? "dictation-field-live" : undefined}>
			{live && (
				<div aria-hidden className={cn(layout, "pointer-events-none overflow-hidden whitespace-pre-wrap break-words")}>
					<span className="invisible">{value}</span>
					<span className="text-muted-foreground/60">
						{value && !/\s$/.test(value) ? " " : ""}
						{preview}
					</span>
				</div>
			)}
			{cloneElement(children, {
				className: cn(children.props.className, live && "absolute inset-0 h-full max-h-none min-h-0"),
			})}
		</div>
	);
}

