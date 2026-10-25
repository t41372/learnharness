/**
 * THE RESIDENT RECOGNIZER (local dictation, 2026-10-25): one long-lived
 * `bridge.py serve` per server process, started on the first dictation
 * session (or warm request) and kept alive, so the selected model loads
 * ONCE — the first warm-up costs seconds (MLX prepares the model), every
 * later dictation is ready at once.
 *
 * It listens on 127.0.0.1 at a free port and admits a WebSocket only with
 * this launch's random token; the renderer gets both from GET
 * /api/stt/session (the Deepgram token flow's shape). The child's stdin is
 * our control channel and its lifetime tie: when this process exits, the
 * pipe closes and the bridge exits with it. Package changes stop it
 * (stopRecognizer) — the next session starts a fresh one that discovers
 * the new entry points.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { SPEECH_DIR } from "../../../config.ts";
import type { AsrRecognizerState } from "../../core/standard-asr.ts";
import { BRIDGE_SCRIPT, pythonEnv, venvPython } from "./environment.ts";

interface Recognizer {
	child: ChildProcess;
	token: string;
	/** Resolves with the port once the bridge listens. */
	ready: Promise<number>;
	state: AsrRecognizerState;
	/** The models warmed (or warming) in this bridge. */
	warmed: Set<string>;
	error: string | null;
}

function holder(): { current: Recognizer | null } {
	const g = globalThis as typeof globalThis & { __lhRecognizer?: { current: Recognizer | null } };
	g.__lhRecognizer ??= { current: null };
	return g.__lhRecognizer;
}

/** Start the bridge (or return the live one). */
function ensure(): Recognizer {
	const h = holder();
	if (h.current && h.current.child.exitCode === null && !h.current.child.killed) return h.current;
	const token = randomBytes(32).toString("hex");
	const child = spawn(venvPython(), ["-I", BRIDGE_SCRIPT, "serve"], {
		cwd: SPEECH_DIR,
		env: { ...pythonEnv(false), LH_ASR_TOKEN: token },
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	const recognizer: Recognizer = { child, token, ready: Promise.resolve(0), state: "starting", warmed: new Set(), error: null };
	let stderr = "";
	recognizer.ready = new Promise<number>((resolve, reject) => {
		let pending = "";
		child.stdout!.setEncoding("utf-8");
		child.stdout!.on("data", (chunk: string) => {
			pending += chunk;
			let nl: number;
			while ((nl = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, nl);
				pending = pending.slice(nl + 1);
				let message: { kind?: string; value?: Record<string, unknown> };
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				if (message.kind === "listening" && typeof message.value?.port === "number") {
					recognizer.state = "ready";
					resolve(message.value.port);
				} else if (message.kind === "warm") {
					const ok = message.value?.ok === true;
					recognizer.state = ok ? "ready" : "error";
					recognizer.error = ok ? null : String(message.value?.error ?? "Warm-up failed");
					if (!ok && typeof message.value?.model === "string") recognizer.warmed.delete(message.value.model);
				}
			}
		});
		child.stderr!.setEncoding("utf-8");
		child.stderr!.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-8000);
		});
		child.on("error", (error) => {
			recognizer.state = "error";
			recognizer.error = error.message;
			reject(error);
		});
		child.on("exit", (code) => {
			if (recognizer.state !== "stopped") {
				recognizer.state = "error";
				recognizer.error = stderr.trim().split("\n").slice(-3).join("\n") || `The recognizer exited (${code})`;
			}
			reject(new Error(recognizer.error ?? "The recognizer exited"));
			if (h.current === recognizer) h.current = null;
		});
	});
	recognizer.ready.catch(() => {}); // surfaced to whoever awaits it
	h.current = recognizer;
	return recognizer;
}

/** Load a model in the bridge ahead of the first dictation. */
export function warmRecognizer(model: string): void {
	const recognizer = ensure();
	if (recognizer.warmed.has(model)) return;
	recognizer.warmed.add(model);
	void recognizer.ready.then(() => {
		recognizer.state = "warming";
		recognizer.child.stdin?.write(JSON.stringify({ cmd: "warm", model }) + "\n");
	}, () => {});
}

/** Where one dictation run connects: the bridge's port and token. Starts
 *  the bridge and warms the model when needed. */
export async function recognizerSession(model: string): Promise<{ url: string; token: string }> {
	const recognizer = ensure();
	warmRecognizer(model);
	const port = await recognizer.ready;
	return { url: `ws://127.0.0.1:${port}`, token: recognizer.token };
}

/** Stop the bridge (package changes, model removals). */
export function stopRecognizer(): void {
	const h = holder();
	const recognizer = h.current;
	if (!recognizer) return;
	recognizer.state = "stopped";
	h.current = null;
	recognizer.child.stdin?.end();
	recognizer.child.kill();
}

export function recognizerState(): AsrRecognizerState {
	return holder().current?.state ?? "stopped";
}
