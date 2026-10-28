/**
 * Local dictation through Standard ASR (2026-10-25) — the deterministic
 * parts: the transcript reducer, the dictation settings section, the
 * environment's command shapes and uv discovery, the route's command
 * parser, the session vocabulary, the Dictation page's lines, and the
 * live-preview field. The Python side runs only in the opt-in live check
 * (docs/development.md, "Local dictation").
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_ASR_TRANSCRIPT, asrTranscriptText, formatBytes, reduceAsrEvent, type AsrEvent, type AsrModel } from "../src/core/standard-asr.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { parseDictationSettingsBody } from "../src/server/settings-body.ts";
import { commandError, findUv, pipInstallArgs } from "../src/server/standard-asr/environment.ts";
import { CORE_REQUIREMENT, recommendedEngine, STANDARD_ASR_COMMIT } from "../src/server/standard-asr/pins.ts";
import { parseStandardAsrCommand } from "../src/server/dictation.ts";
import { collectDictationTerms, DictationField } from "../components/dictation.tsx";
import { filesLine, modelCapabilities, progressLine } from "../components/settings/dictation-section.tsx";

const fold = (events: AsrEvent[]) => events.reduce(reduceAsrEvent, EMPTY_ASR_TRANSCRIPT);

describe("the transcript reducer (streaming §5.2)", () => {
	it("partials replace their segment; finals settle it; first mention claims the position", () => {
		const t = fold([
			{ type: "partial", segment_id: "a", text: "Hello" },
			{ type: "partial", segment_id: "a", text: "Hello wor" },
			{ type: "final", segment_id: "a", text: "Hello world." },
			{ type: "partial", segment_id: "b", text: " Next" },
		]);
		assert.deepEqual(t.order, ["a", "b"]);
		assert.equal(asrTranscriptText(t), "Hello world. Next");
	});

	it("segments join with no separator — each carries its own spaces (TR.1), Chinese none", () => {
		const t = fold([
			{ type: "final", segment_id: "1", text: "今天" },
			{ type: "final", segment_id: "2", text: "天气很好。" },
		]);
		assert.equal(asrTranscriptText(t), "今天天气很好。");
	});

	it("a supersede retires old segments and splices the new ones into their place", () => {
		const t = fold([
			{ type: "final", segment_id: "a", text: "One." },
			{ type: "final", segment_id: "b", text: " too" },
			{ type: "final", segment_id: "c", text: " three." },
			{ type: "final", segment_id: "z", text: " End." },
			{ type: "supersede", old_ids: ["b", "c"], new_ids: ["d"] },
			{ type: "final", segment_id: "d", text: " Two, three." },
		]);
		assert.deepEqual(t.order, ["a", "d", "z"]);
		assert.equal(asrTranscriptText(t), "One. Two, three. End.");
	});

	it("other events leave it unchanged", () => {
		const t = fold([{ type: "final", segment_id: "a", text: "x" }]);
		assert.equal(reduceAsrEvent(t, { type: "progress" }), t);
		assert.equal(reduceAsrEvent(t, { type: "done" }), t);
	});

	it("formats byte counts", () => {
		assert.equal(formatBytes(512), "512 B");
		assert.equal(formatBytes(712_778_752), "713 MB");
		assert.equal(formatBytes(3_400_000_000), "3.4 GB");
	});
});

describe("the dictation settings section", () => {
	it("resolves to Deepgram, no model, and the upstream English default", () => {
		assert.deepEqual(resolveSettings(null).dictation, { engine: "deepgram", model: null, language: "en" });
		assert.deepEqual(
			resolveSettings({ version: 1, dictation: { engine: "standard-asr", model: "mlx-audio/qwen3-asr-0.6b", language: "zh" } }).dictation,
			{ engine: "standard-asr", model: "mlx-audio/qwen3-asr-0.6b", language: "zh" },
		);
	});

	it("the sanitizer drops bad fields and keeps good ones", () => {
		assert.deepEqual(sanitizeUserSettings({ version: 1, dictation: { engine: "siri", model: "no-slash", language: "zh-Hant" } })?.dictation, { language: "zh-Hant" });
	});

	it("the PUT parser is strict", () => {
		assert.deepEqual(parseDictationSettingsBody({ engine: "standard-asr", model: "faster-whisper/small" }), {
			ok: true,
			settings: { engine: "standard-asr", model: "faster-whisper/small" },
		});
		assert.equal(parseDictationSettingsBody({ engine: "siri" }).ok, false);
		assert.equal(parseDictationSettingsBody({ model: "has space/x y" }).ok, false);
		assert.equal(parseDictationSettingsBody({ language: "not a tag" }).ok, false);
	});
});

describe("the speech environment", () => {
	it("every install carries the pinned core, the bridge's packages, and the overrides file", () => {
		const args = pipInstallArgs("/venv/bin/python", ["std-x @ git+https://example.com/x.git@abc"]);
		assert.deepEqual(args.slice(0, 6), ["pip", "install", "--python", "/venv/bin/python", "--overrides", "overrides.txt"]);
		assert.ok(args.includes(CORE_REQUIREMENT));
		assert.ok(args.includes("websockets==15.0.1"));
		assert.equal(args.at(-1), "std-x @ git+https://example.com/x.git@abc");
		assert.ok(CORE_REQUIREMENT.endsWith(`@${STANDARD_ASR_COMMIT}`), "the core is pinned to a commit");
		assert.match(STANDARD_ASR_COMMIT, /^[0-9a-f]{40}$/);
	});

	it("the recommended engine follows the platform, pinned", () => {
		assert.equal(recommendedEngine("darwin", "arm64").model, "mlx-audio/qwen3-asr-0.6b");
		assert.equal(recommendedEngine("darwin", "x64").model, "faster-whisper/small");
		assert.equal(recommendedEngine("win32", "x64").model, "faster-whisper/small");
		for (const pick of [recommendedEngine("darwin", "arm64"), recommendedEngine("linux", "x64")]) {
			assert.match(pick.requirement, /@[0-9a-f]{40}$/, pick.package);
		}
	});

	it("uv: the desktop's bundled binary wins, then PATH; none = null", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-uv-"));
		const bundled = path.join(dir, "bundled-uv");
		const onPath = path.join(dir, process.platform === "win32" ? "uv.exe" : "uv");
		fs.writeFileSync(bundled, "");
		fs.writeFileSync(onPath, "");
		assert.equal(findUv({ LH_UV_PATH: bundled, PATH: dir }), bundled);
		assert.equal(findUv({ PATH: dir }), onPath);
		fs.rmSync(dir, { recursive: true });
	});

	it("a failed command's reason masks URL credentials and keeps the tail", () => {
		const text = commandError({ stdout: "", stderr: "fetch https://user:secret@github.com/x.git failed" }, "fallback");
		assert.equal(text, "fetch https://***@github.com/x.git failed");
		assert.equal(commandError({ stdout: "", stderr: "" }, "fallback"), "fallback");
		assert.ok(commandError({ stdout: "", stderr: "x".repeat(5000) }, "f").length <= 2001);
	});

	it("the route's command parser admits only well-formed commands", () => {
		assert.deepEqual(parseStandardAsrCommand({ op: "install" }), { op: "install" });
		assert.deepEqual(parseStandardAsrCommand({ op: "installEngine", requirement: " std-faster-whisper " }), { op: "installEngine", requirement: "std-faster-whisper" });
		assert.equal(parseStandardAsrCommand({ op: "installEngine", requirement: "--index-url=https://evil" }), null, "no uv flags through the box");
		assert.equal(parseStandardAsrCommand({ op: "installEngine", requirement: "a\nb" }), null);
		assert.equal(parseStandardAsrCommand({ op: "uninstallEngine", name: "std x" }), null);
		assert.deepEqual(parseStandardAsrCommand({ op: "download", model: "mlx-audio/whisper-tiny" }), { op: "download", model: "mlx-audio/whisper-tiny" });
		assert.equal(parseStandardAsrCommand({ op: "download", model: "nope" }), null);
		assert.equal(parseStandardAsrCommand({ op: "rm -rf" }), null);
	});
});

describe("the session vocabulary", () => {
	it("trims, de-duplicates case-insensitively, drops long terms, and caps the count", () => {
		const terms = collectDictationTerms([["  Partial  derivatives ", "chain rule"], ["Chain Rule", "x".repeat(81), ""]]);
		assert.deepEqual(terms, ["Partial derivatives", "chain rule"]);
		assert.equal(collectDictationTerms([Array.from({ length: 100 }, (_, i) => `t${i}`)]).length, 60);
	});
});

describe("the Dictation page's lines", () => {
	const model: AsrModel = {
		key: "mlx-audio/qwen3-asr-0.6b",
		engine: "mlx-audio",
		name: "qwen3-asr-0.6b",
		package: "std-mlx-audio",
		description: null,
		languages: ["auto", "zh", "en"],
		sampleRate: 16000,
		mode: "streaming",
		partials: true,
		prompt: true,
		phraseHints: false,
		error: null,
	};

	it("capabilities", () => {
		assert.equal(modelCapabilities(model), "Streaming, live words · uses session vocabulary · 2 languages · 16 kHz");
		assert.equal(modelCapabilities({ ...model, mode: "batch", partials: false, prompt: false, languages: ["en"] }), "Whole recording · en · 16 kHz");
	});

	it("progress shows real numbers only — never a made-up 0%", () => {
		assert.equal(progressLine(null), null);
		assert.equal(progressLine({ phase: "transferring" }), "Transferring");
		assert.equal(progressLine({ phase: "transferring", completed_units: 50, total_units: 200, unit: "bytes" }), "25% · 50 B of 200 B");
	});

	it("files", () => {
		const requirement = { artifact_id: "s", label: "s", required_for_inference: true, required_actions: [], size_bytes: 712_778_752 };
		assert.deepEqual(filesLine({ key: model.key, error: null, report: { mode: "streaming", applicable: true, readiness: "ready", requirements: [{ ...requirement, state: "ready", can_acquire_now: false }] } }), { text: "Files ready · 713 MB", downloadable: false });
		assert.deepEqual(filesLine({ key: model.key, error: null, report: { mode: "streaming", applicable: true, readiness: "unavailable", requirements: [{ ...requirement, size_bytes: null, state: "missing", can_acquire_now: true }] } }), { text: "Not downloaded", downloadable: true });
		assert.equal(filesLine({ key: model.key, error: "broken plugin", report: null }).text, "broken plugin");
	});
});

describe("the live-preview field", () => {
	const textarea = <textarea value="I think" readOnly className="field-sizing-content px-2 py-2" />;
	it("without a preview the textarea lays out as before", () => {
		const html = renderToStaticMarkup(<DictationField value="I think" preview="" layout="px-2 py-2">{textarea}</DictationField>);
		assert.ok(html.includes('class="field-sizing-content px-2 py-2"'));
		assert.ok(!html.includes("dictation-field-live"));
	});
	it("with one, the faded live words follow the text and the textarea overlays the mirror", () => {
		const html = renderToStaticMarkup(<DictationField value="I think" preview="it is energy" layout="px-2 py-2">{textarea}</DictationField>);
		assert.ok(html.includes('data-testid="dictation-field-live"'));
		assert.match(html, /<span class="invisible">I think<\/span><span class="text-muted-foreground\/60"> (<!-- -->)?it is energy<\/span>/);
		assert.match(html, /<textarea[^>]*class="field-sizing-content px-2 py-2 absolute inset-0/);
	});
});
