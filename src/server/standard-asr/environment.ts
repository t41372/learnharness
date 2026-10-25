/**
 * THE SPEECH ENVIRONMENT (local dictation, 2026-10-25): the app-owned uv
 * venv that holds Standard ASR and the engine plugins the learner installs,
 * under config.SPEECH_DIR.
 *
 *   venv/          the Python environment (uv venv, Python PYTHON_VERSION)
 *   python/        uv's managed interpreter, kept with the app's data
 *   models/        model files (STANDARD_ASR_MODEL_DIR — engines that honor
 *                  it download here; deleting it frees the disk)
 *   sources.json   {package: requirement} for every engine installed, so
 *                  each install resolves all of them together
 *   overrides.txt  the pinned core, forced over every plugin's own
 *                  `standard-asr @ …@main` dependency
 *
 * Every Python call goes through bridge.py in a fresh interpreter (newly
 * installed entry points are visible at once); recognition itself runs in
 * the resident bridge (./recognizer.ts). One long step at a time — the
 * state lives on globalThis (the module-instance idiom: Next dev compiles
 * routes as separate module instances in one process).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PATHS, SPEECH_DIR } from "../../../config.ts";
import type {
	AsrInventory,
	AsrModelStatus,
	AsrProgress,
	AsrStep,
	StandardAsrStatus,
} from "../../core/standard-asr.ts";
import { BRIDGE_REQUIREMENTS, CORE_REQUIREMENT, PYTHON_VERSION, recommendedEngine } from "./pins.ts";

export const BRIDGE_SCRIPT = path.join(PATHS.root, "src", "server", "standard-asr", "bridge.py");

const venvDir = () => path.join(SPEECH_DIR, "venv");
const modelsDir = () => path.join(SPEECH_DIR, "models");
const sourcesFile = () => path.join(SPEECH_DIR, "sources.json");

/** The venv's interpreter. */
export function venvPython(): string {
	return process.platform === "win32" ? path.join(venvDir(), "Scripts", "python.exe") : path.join(venvDir(), "bin", "python");
}

/** uv: the desktop app's bundled binary (LH_UV_PATH, set by electron/
 *  main.cjs), else the first one on PATH or in the usual install dirs. */
export function findUv(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
	const exe = process.platform === "win32" ? "uv.exe" : "uv";
	const candidates = [
		env.LH_UV_PATH,
		...(env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, exe)),
		path.join("/opt/homebrew/bin", exe),
		path.join("/usr/local/bin", exe),
		path.join(os.homedir(), ".local", "bin", exe),
		path.join(os.homedir(), ".cargo", "bin", exe),
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			if (fs.statSync(candidate).isFile()) return candidate;
		} catch {
			/* not here */
		}
	}
	return null;
}

/** The environment every Python call runs with. Recognition never
 *  downloads (a missing model fails honestly); management may. */
export function pythonEnv(allowDownload: boolean): NodeJS.ProcessEnv {
	return {
		...process.env,
		STANDARD_ASR_MODEL_DIR: modelsDir(),
		STANDARD_ASR_ALLOW_DOWNLOAD: allowDownload ? "1" : "0",
		HF_HUB_DISABLE_PROGRESS_BARS: "1",
		UV_PYTHON_INSTALL_DIR: path.join(SPEECH_DIR, "python"),
	};
}

// ─── Process plumbing ──────────────────────────────────────────────────────

interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

function run(
	file: string,
	args: string[],
	opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; onLine?: (line: string) => void } = {},
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		let stdout = "";
		let stderr = "";
		let pending = "";
		child.stdout.setEncoding("utf-8");
		child.stderr.setEncoding("utf-8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			if (!opts.onLine) return;
			pending += chunk;
			let nl: number;
			while ((nl = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, nl);
				pending = pending.slice(nl + 1);
				if (line.trim()) opts.onLine(line);
			}
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-64_000);
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(opts.input ?? "");
	});
}

/** A failed command's readable reason: its stderr (never argv — a Git URL
 *  can carry credentials), credentials in URLs masked, the tail kept. */
export function commandError(result: Pick<RunResult, "stdout" | "stderr">, fallback: string): string {
	const text = (result.stderr.trim() || result.stdout.trim() || fallback).replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@");
	return text.length > 2000 ? `…${text.slice(-2000)}` : text;
}

/** One bridge management call: the request in, NDJSON out. Progress lines
 *  stream to `onProgress`; the result (or the error) resolves at the end. */
async function bridge<T>(command: string, request: object, onProgress?: (p: AsrProgress) => void): Promise<T> {
	const settled: { result?: { ok: true; value: T } | { ok: false; message: string } } = {};
	const out = await run(venvPython(), ["-I", BRIDGE_SCRIPT, command], {
		cwd: SPEECH_DIR,
		env: pythonEnv(command === "acquire"),
		input: JSON.stringify(request) + "\n",
		onLine: (line) => {
			let message: { kind?: string; value?: unknown };
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (message.kind === "progress") onProgress?.(message.value as AsrProgress);
			else if (message.kind === "result") settled.result = { ok: true, value: message.value as T };
			else if (message.kind === "error") settled.result = { ok: false, message: String((message.value as { message?: unknown })?.message ?? "Standard ASR failed") };
		},
	});
	if (settled.result?.ok) return settled.result.value;
	throw new Error(settled.result ? settled.result.message : commandError(out, `bridge ${command} exited with ${out.code}`));
}

// ─── State (one step at a time) ────────────────────────────────────────────

interface AsrState {
	step: AsrStep | null;
	task: string | null;
	progress: AsrProgress | null;
	error: string | null;
	inventory: AsrInventory | null;
	statuses: Map<string, AsrModelStatus>;
}

function state(): AsrState {
	const g = globalThis as typeof globalThis & { __lhStandardAsr?: AsrState };
	g.__lhStandardAsr ??= { step: null, task: null, progress: null, error: null, inventory: null, statuses: new Map() };
	return g.__lhStandardAsr;
}

/** A step is already running — the route answers 409. */
export class AsrBusyError extends Error {
	constructor() {
		super("Another speech step is running");
		this.name = "AsrBusyError";
	}
}

/** Run one long step: claims the slot synchronously (a second request is
 *  refused, never queued), records progress, and keeps the failure as the
 *  status error. Fire-and-forget at the routes; awaited in tests. */
async function step(name: AsrStep, task: string | null, body: () => Promise<void>): Promise<void> {
	const s = state();
	if (s.step) throw new AsrBusyError();
	s.step = name;
	s.task = task;
	s.progress = null;
	s.error = null;
	try {
		await body();
	} catch (error) {
		s.error = error instanceof Error ? error.message : String(error);
	} finally {
		s.step = null;
		s.task = null;
		s.progress = null;
	}
}

/** Claim-and-run for callers that chain several steps (the one-click
 *  install): the same slot discipline, the step name updated in place. */
function setStep(name: AsrStep, task: string | null) {
	const s = state();
	s.step = name;
	s.task = task;
	s.progress = null;
}

// ─── Package management ────────────────────────────────────────────────────

export function isInstalled(): boolean {
	return fs.existsSync(venvPython());
}

function readSources(): Record<string, string> {
	try {
		const raw = JSON.parse(fs.readFileSync(sourcesFile(), "utf-8")) as unknown;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
		}
	} catch {
		/* none yet */
	}
	return {};
}

function writeSources(sources: Record<string, string>) {
	fs.mkdirSync(SPEECH_DIR, { recursive: true });
	fs.writeFileSync(sourcesFile(), JSON.stringify(sources, null, "\t") + "\n");
}

function requireUv(): string {
	const uv = findUv();
	if (!uv) throw new Error("uv was not found. Install uv (https://docs.astral.sh/uv/) or use the desktop app, which includes it.");
	return uv;
}

async function ensureVenv(): Promise<void> {
	if (isInstalled()) return;
	const uv = requireUv();
	fs.mkdirSync(SPEECH_DIR, { recursive: true });
	const out = await run(uv, ["venv", "--python", PYTHON_VERSION, "venv"], { cwd: SPEECH_DIR, env: pythonEnv(true) });
	if (out.code !== 0) throw new Error(commandError(out, "Creating the speech environment failed"));
}

/** The pip install argv for a set of plugin requirements (pure — pinned
 *  in tests). The core and the bridge's own packages always ride along,
 *  and the overrides file forces the pinned core over every plugin's own
 *  core dependency. Relative paths: uv splits an overrides path at a
 *  space, and the app's data directory has one on macOS. */
export function pipInstallArgs(python: string, requirements: string[]): string[] {
	return ["pip", "install", "--python", python, "--overrides", "overrides.txt", CORE_REQUIREMENT, ...BRIDGE_REQUIREMENTS, ...requirements];
}

async function pipInstall(requirements: string[]): Promise<void> {
	const uv = requireUv();
	fs.writeFileSync(path.join(SPEECH_DIR, "overrides.txt"), CORE_REQUIREMENT + "\n");
	const out = await run(uv, pipInstallArgs(venvPython(), requirements), { cwd: SPEECH_DIR, env: pythonEnv(true) });
	if (out.code !== 0) throw new Error(commandError(out, "Installing the speech packages failed"));
}

/** Re-read what's installed (a fresh interpreter sees new entry points). */
export async function refreshInventory(): Promise<AsrInventory | null> {
	const s = state();
	s.statuses.clear();
	s.inventory = isInstalled() ? await bridge<AsrInventory>("inventory", {}) : null;
	return s.inventory;
}

async function inventory(): Promise<AsrInventory | null> {
	const s = state();
	if (!s.inventory && isInstalled()) {
		try {
			await refreshInventory();
		} catch (error) {
			s.error ??= error instanceof Error ? error.message : String(error);
		}
	}
	return s.inventory;
}

/** The installed models, read through the cached inventory. */
export async function installedModels(): Promise<string[]> {
	return ((await inventory())?.models ?? []).map((m) => m.key);
}

/** One model's file status (cached until a download or package change). */
export async function modelStatus(key: string, fresh = false): Promise<AsrModelStatus> {
	const s = state();
	const cached = s.statuses.get(key);
	if (cached && !fresh) return cached;
	let status: AsrModelStatus;
	try {
		status = await bridge<AsrModelStatus>("status", { model: key });
	} catch (error) {
		status = { key, report: null, error: error instanceof Error ? error.message : String(error) };
	}
	s.statuses.set(key, status);
	return status;
}

/** Hooks the routes wire in: the recognizer must stop while packages
 *  change (new entry points, Windows file locks) and the selection is a
 *  settings write — both live outside this module. */
export interface AsrHooks {
	stopRecognizer: () => void;
	select: (model: string) => void;
	warm: (model: string) => void;
}

/** One click: environment, the core + the platform's recommended engine,
 *  select its model, download its files, warm it. */
export function installRecommended(hooks: AsrHooks): Promise<void> {
	const pick = recommendedEngine();
	return step("environment", null, async () => {
		hooks.stopRecognizer();
		await ensureVenv();
		setStep("packages", pick.requirement);
		const sources = { ...readSources(), [pick.package]: pick.requirement };
		await pipInstall(Object.values(sources));
		writeSources(sources);
		await refreshInventory();
		hooks.select(pick.model);
		setStep("model", pick.model);
		await acquireInto(pick.model);
		hooks.warm(pick.model);
	});
}

/** Install any engine plugin: a PyPI name, a Git URL, or a local folder. */
export function installEngine(requirement: string, hooks: AsrHooks): Promise<void> {
	return step("packages", requirement, async () => {
		hooks.stopRecognizer();
		await ensureVenv();
		const before = new Set((state().inventory?.plugins ?? []).map((p) => p.name));
		const sources = readSources();
		await pipInstall([...Object.values(sources), requirement]);
		const after = await refreshInventory();
		const added = (after?.plugins ?? []).map((p) => p.name).filter((name) => !before.has(name) && !sources[name]);
		for (const name of added.length ? added : [requirement]) sources[name] = requirement;
		writeSources(sources);
	});
}

export function uninstallEngine(name: string, hooks: AsrHooks): Promise<void> {
	return step("removing", name, async () => {
		hooks.stopRecognizer();
		const uv = requireUv();
		const out = await run(uv, ["pip", "uninstall", "--python", venvPython(), name], { cwd: SPEECH_DIR, env: pythonEnv(false) });
		if (out.code !== 0) throw new Error(commandError(out, `Removing ${name} failed`));
		const sources = readSources();
		delete sources[name];
		writeSources(sources);
		await refreshInventory();
	});
}

async function acquireInto(key: string): Promise<void> {
	const s = state();
	await bridge("acquire", { model: key }, (progress) => {
		s.progress = progress;
	});
	s.statuses.delete(key);
	await modelStatus(key, true);
}

/** Download a model's files (the dictation mode's artifacts). */
export function downloadModel(key: string, hooks: Pick<AsrHooks, "warm">): Promise<void> {
	return step("model", key, async () => {
		await acquireInto(key);
		hooks.warm(key);
	});
}

/** Everything the Dictation settings page shows. */
export async function standardAsrStatus(selected: string | null, recognizer: StandardAsrStatus["recognizer"]): Promise<StandardAsrStatus> {
	const s = state();
	const inv = await inventory();
	const pick = recommendedEngine();
	const selectedStatus = selected && inv?.models.some((m) => m.key === selected) ? await modelStatus(selected) : null;
	return {
		uv: findUv() !== null,
		installed: isInstalled() && inv?.core != null,
		step: s.step,
		task: s.task,
		progress: s.progress,
		error: s.error,
		recommended: { label: pick.label, runtime: pick.runtime, model: pick.model, package: pick.package },
		inventory: inv,
		selectedStatus,
		recognizer,
	};
}
