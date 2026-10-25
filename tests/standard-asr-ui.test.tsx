import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { DictationSection } from "../components/settings/dictation-section.tsx";
import type { AsrModel, AsrModelStatus, DictationSettings, StandardAsrStatus } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	React, window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement | undefined;

const models: AsrModel[] = ["small", "large", "tiny"].map((name) => ({
	key: `speech/${name}`, engine: "speech", name, package: "speech-plugin", description: null,
	languages: [], sampleRate: 16000, mode: "batch", partials: false, prompt: false, phraseHints: false, error: null,
}));

function files(key: string, ready = false): AsrModelStatus {
	return { key, error: null, report: {
		mode: "batch", applicable: true, readiness: ready ? "ready" : "unavailable",
		requirements: [{ artifact_id: "weights", label: "Weights", state: ready ? "ready" : "missing",
			required_for_inference: true, can_acquire_now: !ready, required_actions: [] }],
	} };
}

function fixture(installed = true) {
	let settings: DictationSettings = { engine: "standard-asr" };
	const commands: Array<{ op: string; model?: string }> = [];
	const reports = new Map<string, AsrModelStatus>();
	const status: StandardAsrStatus = {
		uv: true, installed, step: null, task: null, progress: null, error: null, inventory: null,
		selectedStatus: null, recognizer: "stopped",
		recommended: { package: "speech-plugin", model: "speech/small", label: "Small", runtime: "CPU" },
	};
	let nextRead: Promise<AsrModelStatus> | undefined;
	let commandError: string | null = null;
	const overview = (): StandardAsrStatus => ({
		...status,
		inventory: status.installed ? {
			core: { name: "standard-asr", version: "0.2", source: null, commit: null, engines: [] },
			plugins: [{ name: "speech-plugin", version: "1", source: null, commit: null, engines: ["speech"] }],
			models, python: "3.12", diagnostics: [],
		} : null,
		selectedStatus: settings.model ? reports.get(settings.model) ?? files(settings.model) : null,
	});
	globalThis.fetch = async (url, init) => {
		if (url === "/api/keys") return Response.json({ keys: [], providers: [] });
		if (String(url).startsWith("/api/stt/standard-asr/model?")) {
			const key = new URL(String(url), "http://localhost").searchParams.get("key")!;
			const held = nextRead;
			nextRead = undefined;
			return Response.json(held ? await held : reports.get(key) ?? files(key));
		}
		assert.equal(url, "/api/stt/standard-asr");
		if (init?.method === "POST") {
			const command = JSON.parse(String(init.body)) as { op: string; model?: string };
			commands.push(command);
			if (commandError) throw new Error(commandError);
			if (command.op === "install") status.installed = true;
			if (command.op === "download") status.step = "model";
			return Response.json({ ok: true }, { status: 202 });
		}
		return Response.json(overview());
	};
	function render() {
		root!.render(<DictationSection dictation={settings} onChange={(next) => { settings = next; render(); }} />);
	}
	return {
		status, reports, commands, overview,
		get settings() { return settings; },
		holdRead: (read: Promise<AsrModelStatus>) => { nextRead = read; },
		failCommand: (message: string | null) => { commandError = message; },
		mount: async () => {
			host = document.createElement("div");
			document.body.append(host);
			root = createRoot(host);
			await act(async () => render());
		},
	};
}

function element(id: string): HTMLElement {
	const found = host?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
	assert(found, `missing ${id}`);
	return found;
}

async function selectModel(key: string) {
	await act(async () => {
		const select = element("standard-asr-model");
		Object.defineProperty(select, "value", { configurable: true, writable: true, value: key });
		select.dispatchEvent(new window.Event("change", { bubbles: true }));
	});
}

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	globalThis.fetch = originalFetch;
});

test("first visit offers recommended and custom plugins; installation waits for an explicit model choice", async () => {
	const f = fixture(false);
	await f.mount();
	element("standard-asr-requirement");
	element("standard-asr-install-engine");
	await act(async () => element("standard-asr-install-button").click());
	element("standard-asr-model");
	assert.equal(f.settings.model, undefined);
	assert.deepEqual(f.commands, [{ op: "install" }]);
});

test("switching models reads the selected files and ignores a late response for the previous model", async () => {
	const f = fixture();
	await f.mount();
	await selectModel("speech/small");
	element("standard-asr-download");
	let resolve!: (status: AsrModelStatus) => void;
	f.holdRead(new Promise((done) => { resolve = done; }));
	await selectModel("speech/large");
	assert.match(element("standard-asr-files-row").textContent ?? "", /Checking files/);
	const late = files("speech/large", true);
	await selectModel("speech/tiny");
	await act(async () => resolve(late));
	element("standard-asr-download");
	assert.equal(f.commands.length, 0, "missing or stale files never trigger warm-up");
});

test("explicit download polls through completion and warms the ready selected model", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const f = fixture();
	await f.mount();
	await selectModel("speech/large");
	await act(async () => element("standard-asr-download").click());
	assert.deepEqual(f.commands, [{ op: "download", model: "speech/large" }]);
	assert.equal((element("standard-asr-download") as HTMLButtonElement).disabled, true);
	f.reports.set("speech/large", files("speech/large", true));
	f.status.step = null;
	await act(async () => t.mock.timers.tick(1000));
	assert.match(element("standard-asr-files-row").textContent ?? "", /Files ready/);
	assert.deepEqual(f.commands.at(-1), { op: "warm", model: "speech/large" });
	assert(!host?.querySelector('[data-testid="standard-asr-download"]'));
});

test("a failed download request shows its error and leaves the selected model available for retry", async () => {
	const f = fixture();
	await f.mount();
	await selectModel("speech/large");
	f.failCommand("Connection lost");
	await act(async () => element("standard-asr-download").click());
	assert.equal(element("standard-asr-error").textContent, "Connection lost");
	assert.equal((element("standard-asr-download") as HTMLButtonElement).disabled, false);
	f.failCommand(null);
	await act(async () => element("standard-asr-download").click());
	assert.equal(f.commands.filter((command) => command.op === "download").length, 2);
	assert(!host?.querySelector('[data-testid="standard-asr-error"]'));
});
