/**
 * DICTATION'S SERVER SIDE (local dictation, 2026-10-25): which engine a
 * Dictate press runs, and what the renderer connects to.
 *
 *   Deepgram       mint a short-lived token (the key stays server-side;
 *                  audio flows renderer → Deepgram directly).
 *   Standard ASR   start/reuse the resident recognizer and hand out its
 *                  loopback URL + this launch's token (audio flows
 *                  renderer → the bridge, never through this server).
 *
 * GET /api/stt/session asks dictationSession(); the engine follows the
 * settings record's dictation section, read fresh per call.
 */

import type { DictationSession } from "../core/standard-asr.ts";
import { keyValue } from "./keys.ts";
import { effectiveSettings, stores } from "./stores.ts";
import {
	downloadModel,
	installEngine,
	installRecommended,
	installedModels,
	isInstalled,
	modelStatus,
	standardAsrStatus,
	uninstallEngine,
	type AsrHooks,
} from "./standard-asr/environment.ts";
import { recognizerSession, recognizerState, stopRecognizer, warmRecognizer } from "./standard-asr/recognizer.ts";

export { AsrBusyError } from "./standard-asr/environment.ts";

/** A refused session: the HTTP status, a machine code, the human line. */
export interface DictationRefusal {
	status: number;
	code: "deepgram_keyless" | "deepgram_failed" | "asr_not_installed" | "asr_no_model" | "asr_unavailable";
	message: string;
}

/**
 * Mint a Deepgram token. The key needs ≥ Member permission in the Deepgram
 * console to call /auth/grant (their token-based auth FAQ) — plain
 * read/transcribe keys return FORBIDDEN here. TTL 300s: a run can outlast
 * the 30s default, and the token is only checked at the WebSocket
 * handshake, so long dictation sessions survive the TTL fine.
 */
export async function mintDeepgramToken(): Promise<{ token: string } | DictationRefusal> {
	const key = keyValue("DEEPGRAM_API_KEY");
	if (!key) {
		return { status: 503, code: "deepgram_keyless", message: "No DEEPGRAM_API_KEY — add it to auth.json (desktop) or .env.local (dev)." };
	}
	try {
		const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
			method: "POST",
			headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ttl_seconds: 300 }),
		});
		if (!res.ok) {
			const detail = await res.text();
			return { status: 502, code: "deepgram_failed", message: `Deepgram token grant failed (${res.status}): ${detail.slice(0, 200)}` };
		}
		const data = (await res.json()) as { access_token?: string };
		if (!data.access_token) return { status: 502, code: "deepgram_failed", message: "Deepgram grant returned no token" };
		return { token: data.access_token };
	} catch {
		return { status: 502, code: "deepgram_failed", message: "Deepgram unreachable" };
	}
}

/** The selected engine's connection for one dictation run. */
export async function dictationSession(): Promise<DictationSession | DictationRefusal> {
	const { dictation } = effectiveSettings();
	if (dictation.engine === "deepgram") {
		const minted = await mintDeepgramToken();
		return "token" in minted ? { engine: "deepgram", token: minted.token } : minted;
	}
	if (!isInstalled()) {
		return { status: 503, code: "asr_not_installed", message: "Local dictation isn't installed" };
	}
	const model = dictation.model;
	if (!model || !(await installedModels()).includes(model)) {
		return { status: 503, code: "asr_no_model", message: "Choose a local dictation model" };
	}
	try {
		const { url, token } = await recognizerSession(model);
		return { engine: "standard-asr", url, token, model, language: dictation.language };
	} catch (error) {
		return { status: 503, code: "asr_unavailable", message: error instanceof Error ? error.message : "The local recognizer didn't start" };
	}
}

/** Make a model the dictation model — and Standard ASR the engine. */
function selectModel(model: string): void {
	const record = stores.settingsStore.readSettings() ?? { version: 1 };
	stores.settingsStore.writeSettings({ ...record, dictation: { ...record.dictation, engine: "standard-asr", model } });
}

const hooks: AsrHooks = { stopRecognizer, select: selectModel, warm: warmRecognizer };

/** GET /api/stt/standard-asr. */
export function standardAsrOverview() {
	return standardAsrStatus(effectiveSettings().dictation.model, recognizerState());
}

/** GET /api/stt/standard-asr/model — one model's files, read fresh. */
export function standardAsrModelStatus(key: string) {
	return modelStatus(key, true);
}

/** POST /api/stt/standard-asr: the long steps run in the background (the
 *  page polls the status); the claim is synchronous, so a second step while
 *  one runs is refused with AsrBusyError (409). */
export type StandardAsrCommand =
	| { op: "install" }
	| { op: "installEngine"; requirement: string }
	| { op: "uninstallEngine"; name: string }
	| { op: "download"; model: string }
	| { op: "warm"; model: string };

export function standardAsrCommand(command: StandardAsrCommand): Promise<void> {
	switch (command.op) {
		case "install":
			return installRecommended(hooks);
		case "installEngine":
			return installEngine(command.requirement, hooks);
		case "uninstallEngine":
			return uninstallEngine(command.name, hooks);
		case "download":
			return downloadModel(command.model, hooks);
		case "warm":
			warmRecognizer(command.model);
			return Promise.resolve();
	}
}

/** Parse a POST body into a command (null = 400). Requirements are what
 *  uv accepts — a name, a URL, a path — at most one line, bounded. */
export function parseStandardAsrCommand(body: unknown): StandardAsrCommand | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	const b = body as Record<string, unknown>;
	const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max && !/[\r\n]/.test(v) ? v.trim() : null);
	switch (b.op) {
		case "install":
			return { op: "install" };
		case "installEngine": {
			const requirement = text(b.requirement, 1000);
			return requirement && !requirement.startsWith("-") ? { op: "installEngine", requirement } : null;
		}
		case "uninstallEngine": {
			const name = text(b.name, 200);
			return name && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? { op: "uninstallEngine", name } : null;
		}
		case "download":
		case "warm": {
			const model = text(b.model, 200);
			return model && /^[a-z0-9][a-z0-9._-]*\/\S*$/.test(model) ? { op: b.op, model } : null;
		}
		default:
			return null;
	}
}
