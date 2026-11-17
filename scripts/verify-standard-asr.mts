/**
 * The live check for local dictation (Standard ASR): the environment's
 * status, a dictation session through the same server code the routes use,
 * then a real-time stream of a 16 kHz mono 16-bit WAV through the bridge —
 * printing every event and the transcript. Uses the configured data dir
 * (LH_DATA_DIR) and the dictation model selected there.
 *
 *   npx tsx scripts/verify-standard-asr.mts path/to/speech.wav
 *
 * macOS: `say -o s.aiff "…" && afconvert -f WAVE -d LEI16@16000 -c 1 s.aiff s.wav`.
 */

import fs from "node:fs";
import { dictationSession, standardAsrOverview } from "../src/server/dictation.ts";
import { stopRecognizer } from "../src/server/standard-asr/recognizer.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: npx tsx scripts/verify-standard-asr.mts <16 kHz mono WAV>");
const wav = fs.readFileSync(file);
const pcm = wav.subarray(wav.indexOf(Buffer.from("data")) + 8);
const t0 = Date.now();
const ms = () => `${String(Date.now() - t0).padStart(6)} ms`;

const status = await standardAsrOverview();
console.log(ms(), "installed:", status.installed, "· uv:", status.uv, "· models:", status.inventory?.models.length ?? 0, "· core:", status.inventory?.core?.commit?.slice(0, 8) ?? "—");
console.log(ms(), "selected files:", status.selectedStatus?.report?.readiness ?? status.selectedStatus?.error ?? "no model selected");
const session = await dictationSession();
if (!("url" in session)) {
	console.error("no local session:", JSON.stringify(session));
	process.exit(1);
}
console.log(ms(), "session:", session.model, session.url);

await new Promise<void>((resolve) => {
	const ws = new WebSocket(session.url);
	ws.onopen = () => ws.send(JSON.stringify({ type: "start", token: session.token, model: session.model, options: { language: session.language }, terms: [] }));
	ws.onmessage = async (ev) => {
		const msg = JSON.parse(String(ev.data));
		if (msg.type === "event") console.log(ms(), msg.event.type, msg.event.segment_id ?? "", JSON.stringify(msg.event.text ?? ""));
		else console.log(ms(), msg.type, JSON.stringify(msg.text ?? msg.message ?? msg.mode ?? ""));
		if (msg.type === "ready") {
			for (let i = 0; i < pcm.length; i += 3200) {
				ws.send(pcm.subarray(i, i + 3200));
				await new Promise((r) => setTimeout(r, 100)); // 100 ms of 16 kHz PCM — real time
			}
			ws.send(JSON.stringify({ type: "end" }));
		}
	};
	ws.onclose = (ev) => {
		console.log(ms(), "closed", ev.code);
		resolve();
	};
});
stopRecognizer();
