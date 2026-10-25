"use client";
/**
 * The Dictation section (local dictation, 2026-10-25): which engine the
 * Dictate button runs, and everything each engine needs.
 *
 *   Engine        Deepgram (cloud, a key) | Standard ASR (on this device).
 *   Deepgram      its key row — moved here from Providers, beside the
 *                 choice it serves (the keys store is unchanged).
 *   Standard ASR  the speech environment: one-click install of the
 *                 platform's recommended engine (Qwen3-ASR 0.6B on MLX on
 *                 Apple Silicon, Whisper small on faster-whisper elsewhere);
 *                 any other engine plugin by PyPI name, Git URL or folder;
 *                 the installed models with what each can do and whether
 *                 its files are here; the model and language dictation
 *                 uses.
 *
 * Long steps (install, download, remove) run on the server; the section
 * polls GET /api/stt/standard-asr while one runs. Writes go through the
 * dialog's one writer (the `dictation` settings section, replace-PUT).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import {
	formatBytes,
	type AsrModel,
	type AsrModelStatus,
	type AsrProgress,
	type DictationEngine,
	type DictationSettings,
	type StandardAsrStatus,
} from "@/src/core";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow, ThinSelect } from "./controls.tsx";
import { KeysSection } from "./keys-section.tsx";

const ENGINES: Array<{ id: DictationEngine; label: string }> = [
	{ id: "deepgram", label: "Deepgram" },
	{ id: "standard-asr", label: "On this device" },
];

/** The engine row's hint per engine (exported for the copy pin). */
export const ENGINE_HINTS: Record<DictationEngine, string> = {
	deepgram: "Cloud recognition with your Deepgram key",
	"standard-asr": "Standard ASR — recognition runs on your computer",
};

const STEP_LABELS: Record<NonNullable<StandardAsrStatus["step"]>, string> = {
	environment: "Preparing the speech environment…",
	packages: "Installing packages…",
	model: "Downloading model files…",
	removing: "Removing…",
};

/** One progress line: a percent or a byte count when the engine reports
 *  them, the phase otherwise — never a made-up 0%. Pure — exported for
 *  tests. */
export function progressLine(progress: AsrProgress | null): string | null {
	if (!progress) return null;
	const { completed_units: done, total_units: total, unit, phase } = progress;
	if (typeof done === "number" && typeof total === "number" && total > 0) {
		const pct = Math.min(100, Math.round((done / total) * 100));
		return unit === "bytes" ? `${pct}% · ${formatBytes(done)} of ${formatBytes(total)}` : `${pct}%`;
	}
	if (typeof done === "number" && unit === "bytes") return formatBytes(done);
	return phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : null;
}

/** What a model can do, in one line. Pure — exported for tests. */
export function modelCapabilities(model: AsrModel): string {
	const parts: string[] = [];
	if (model.mode === "streaming") parts.push(model.partials ? "Streaming, live words" : "Streaming");
	else if (model.mode === "batch") parts.push("Whole recording");
	else parts.push("Can't record");
	if (model.prompt || model.phraseHints) parts.push("uses session vocabulary");
	const languages = model.languages.filter((l) => l !== "auto");
	if (languages.length) parts.push(languages.length === 1 ? languages[0]! : `${languages.length} languages`);
	if (model.sampleRate) parts.push(`${model.sampleRate / 1000} kHz`);
	return parts.join(" · ");
}

/** The selected model's files, in one line. Pure — exported for tests. */
export function filesLine(status: AsrModelStatus | null): { text: string; downloadable: boolean } {
	if (!status) return { text: "Checking files…", downloadable: false };
	if (status.error) return { text: status.error, downloadable: false };
	const report = status.report;
	if (!report || !report.applicable || report.readiness === "not_applicable") return { text: "No files to download", downloadable: false };
	const required = report.requirements.filter((r) => r.required_for_inference);
	const size = required.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);
	if (report.readiness === "ready") return { text: size ? `Files ready · ${formatBytes(size)}` : "Files ready", downloadable: false };
	const expected = required.reduce((sum, r) => sum + (r.expected_size_bytes ?? 0), 0);
	const action = required.flatMap((r) => r.required_actions)[0];
	if (action) return { text: action.message, downloadable: false };
	const downloadable = required.some((r) => r.state !== "ready" && r.can_acquire_now);
	return { text: expected ? `Not downloaded · ${formatBytes(expected)}` : "Not downloaded", downloadable };
}

async function command(body: object): Promise<string | null> {
	try {
		const res = await fetch("/api/stt/standard-asr", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (res.ok) return null;
		const detail = (await res.json().catch(() => ({}))) as { error?: string };
		return detail.error ?? `status ${res.status}`;
	} catch (error) {
		return error instanceof Error ? error.message : "The speech environment is unreachable";
	}
}

export function DictationSection({
	dictation,
	onChange,
	initialRow,
}: {
	dictation: DictationSettings | undefined;
	onChange: (next: DictationSettings) => void;
	/** A keys row to unfold on arrival (the Deepgram key deep link). */
	initialRow?: string;
}) {
	const engine = dictation?.engine ?? "deepgram";
	const [status, setStatus] = useState<StandardAsrStatus | null>(null);
	const [modelStatus, setModelStatus] = useState<AsrModelStatus | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [requirement, setRequirement] = useState("");
	const [removing, setRemoving] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const readGeneration = useRef(0);

	const read = useCallback(async () => {
		const generation = ++readGeneration.current;
		try {
			const res = await fetch("/api/stt/standard-asr");
			if (!res.ok) throw new Error(`status ${res.status}`);
			const body = (await res.json()) as StandardAsrStatus;
			if (generation === readGeneration.current) setStatus(body);
		} catch (error) {
			if (generation === readGeneration.current) setActionError(error instanceof Error ? error.message : String(error));
		}
	}, []);
	useEffect(() => {
		void read();
		return () => { readGeneration.current++; };
	}, [read]);
	// Wait for each read before scheduling the next: inspecting a plugin can
	// take longer than the polling interval, especially on its first import.
	const running = status?.step != null;
	useEffect(() => {
		if (!running) return;
		let cancelled = false;
		let timer = setTimeout(poll, 1000);
		async function poll() {
			await read();
			if (!cancelled) timer = setTimeout(poll, 1000);
		}
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [running, read]);

	const run = async (body: object) => {
		setSubmitting(true);
		setActionError(null);
		const error = await command(body);
		if (error) setActionError(error);
		await read();
		setSubmitting(false);
		return error === null;
	};

	const busy = running || submitting;
	const models = status?.inventory?.models ?? [];
	const selected = models.find((m) => m.key === dictation?.model) ?? null;
	const modelKey = selected?.key;
	// The per-model endpoint bypasses the overview cache. Inspect again
	// after each operation, including a failed or partial download. A late
	// response can never replace the newly selected model's files.
	useEffect(() => {
		if (!modelKey || busy) return;
		let cancelled = false;
		const controller = new AbortController();
		void fetch(`/api/stt/standard-asr/model?key=${encodeURIComponent(modelKey)}`, { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error(`status ${res.status}`);
				return (await res.json()) as AsrModelStatus;
			})
			.then((body) => { if (!cancelled) setModelStatus(body); })
			.catch((error: unknown) => {
				if (!cancelled) setModelStatus({ key: modelKey, report: null, error: error instanceof Error ? error.message : String(error) });
			});
		return () => { cancelled = true; controller.abort(); };
	}, [modelKey, busy]);
	const selectedStatus = modelStatus?.key === modelKey ? modelStatus : null;
	const files = filesLine(selectedStatus);
	const languages = (selected?.languages ?? []).filter((l) => l !== "auto");
	const readiness = selectedStatus?.report?.readiness;
	const readyModel = engine === "standard-asr" && !busy && (readiness === "ready" || readiness === "not_applicable") ? selected?.key : null;
	useEffect(() => {
		if (readyModel) void command({ op: "warm", model: readyModel });
	}, [readyModel]);
	const installCustom = async () => {
		if (await run({ op: "installEngine", requirement: requirement.trim() })) setRequirement("");
	};

	return (
		<>
			<SettingsGroup label="Engine" testid="group-dictation-engine">
				<SettingsRow label="Recognition" hint={ENGINE_HINTS[engine]} testid="dictation-engine-row">
					<div role="radiogroup" aria-label="Dictation engine" className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
						{ENGINES.map((option) => {
							const active = option.id === engine;
							return (
								<button
									key={option.id}
									type="button"
									role="radio"
									aria-checked={active}
									data-testid={`dictation-engine-${option.id}`}
									onClick={() => !active && onChange({ ...dictation, engine: option.id })}
									className={cn(
										"h-8 rounded-md px-3 text-sm font-medium transition-colors",
										active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
									)}
								>
									{option.label}
								</button>
							);
						})}
					</div>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="Deepgram" testid="group-dictation">
				<KeysSection scope="dictation" initialRow={initialRow} />
			</SettingsGroup>

			<SettingsGroup label="On this device" testid="group-standard-asr">
				{(actionError ?? status?.error) && (
					<p role="alert" className="whitespace-pre-wrap break-words rounded-sm border border-red-500/40 px-3 py-2 font-mono text-[11px] text-red-500" data-testid="standard-asr-error">
						{actionError ?? status?.error}
					</p>
				)}
				{status === null ? (
					actionError ? (
						<button type="button" onClick={() => { setActionError(null); void read(); }} className="self-start text-xs hover:underline">Retry</button>
					) : <p className="text-xs text-muted-foreground/70">Checking the speech environment…</p>
				) : (
					<div className="flex flex-col gap-3" data-testid="standard-asr">
						{status.step && (
							<p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="standard-asr-step">
								<Loader2Icon className="size-3.5 animate-spin" />
								<span>{STEP_LABELS[status.step]}</span>
								{progressLine(status.progress) && <span className="tabular-nums">{progressLine(status.progress)}</span>}
							</p>
						)}
						{!status.inventory?.plugins.some((plugin) => plugin.name === status.recommended.package) && (
							<div className="flex flex-col gap-2" data-testid="standard-asr-install">
								<p className="text-xs text-muted-foreground/80">
									Install the recommended engine plugin or specify your own below. Then choose a model and download its files.
								</p>
								{status.uv ? (
									<button
										type="button"
										disabled={busy}
										onClick={() => void run({ op: "install" })}
										data-testid="standard-asr-install-button"
										className="self-start rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
									>
										Install {status.recommended.package} ({status.recommended.runtime})
									</button>
								) : (
									<p className="text-xs text-muted-foreground" data-testid="standard-asr-no-uv">
										Local dictation needs uv, which the desktop app includes. In a browser session, install uv
										first (docs.astral.sh/uv).
									</p>
								)}
							</div>
						)}

						<div className="flex flex-col gap-1" data-testid="standard-asr-engines">
							<p className="text-xs uppercase tracking-widest text-muted-foreground/70">Engine plugins</p>
							{(status.inventory?.plugins ?? []).map((plugin) => (
								<div key={plugin.name} className="flex items-center justify-between gap-3 py-0.5" data-testid={`standard-asr-plugin-${plugin.name}`}>
									<span className="min-w-0 truncate font-ui text-xs">
										{plugin.name} <span className="text-muted-foreground/70">{plugin.version}</span>
										{plugin.commit && <span className="text-muted-foreground/50"> · {plugin.commit.slice(0, 7)}</span>}
									</span>
									{removing === plugin.name ? (
										<span className="flex shrink-0 items-center gap-2 text-xs">
											<button
												type="button"
												onClick={() => {
													setRemoving(null);
													void run({ op: "uninstallEngine", name: plugin.name });
												}}
												className="text-red-500 underline-offset-2 hover:underline"
											>
												Remove
											</button>
											<button type="button" onClick={() => setRemoving(null)} className="text-muted-foreground/70 underline-offset-2 hover:underline">
												Cancel
											</button>
										</span>
									) : (
										<button
											type="button"
											disabled={busy}
											onClick={() => setRemoving(plugin.name)}
											className="shrink-0 text-xs text-muted-foreground/70 underline-offset-2 hover:text-red-500 hover:underline disabled:opacity-40"
										>
											Remove…
										</button>
									)}
								</div>
							))}
							<div className="mt-1 flex items-center gap-2">
								<input
									type="text"
									value={requirement}
									onChange={(e) => setRequirement(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && requirement.trim() && !busy && status.uv) {
											void installCustom();
										}
									}}
									placeholder="PyPI name, Git URL or folder"
									aria-label="Engine to install"
									data-testid="standard-asr-requirement"
									className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
								/>
								<button
									type="button"
									disabled={!requirement.trim() || busy || !status.uv}
									onClick={() => {
										void installCustom();
									}}
									data-testid="standard-asr-install-engine"
									className="shrink-0 text-xs text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground/40 disabled:no-underline"
								>
									Install
								</button>
							</div>
							<p className="text-xs text-muted-foreground/60">
								Any Standard ASR engine plugin works — its models appear below.
							</p>
						</div>

						{status.installed && (
							<>
								<SettingsRow label="Model" hint={selected ? modelCapabilities(selected) : "Choose the model dictation uses"} testid="standard-asr-model-row">
									<ThinSelect
										value={selected?.key ?? ""}
										ariaLabel="Dictation model"
										testid="standard-asr-model"
										disabled={busy}
										onChange={(key) => {
											onChange({ ...dictation, model: key, language: undefined });
										}}
									>
										{!selected && <option value="">Choose…</option>}
										{models.map((m) => (
											<option key={m.key} value={m.key} disabled={m.mode === null || m.error !== null}>
												{m.key}
											</option>
										))}
									</ThinSelect>
								</SettingsRow>
								{selected && (
									<SettingsRow label="Files" hint={files.text} testid="standard-asr-files-row">
										{files.downloadable ? (
											<button
												type="button"
												disabled={busy}
												onClick={() => void run({ op: "download", model: selected.key })}
												data-testid="standard-asr-download"
												className="text-xs text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground/40 disabled:no-underline"
											>
												Download
											</button>
										) : (
											<span />
										)}
									</SettingsRow>
								)}
								{selected && languages.length > 0 && (
									<SettingsRow label="Language" hint="Auto detects the language you speak" testid="standard-asr-language-row">
										<ThinSelect
											value={dictation?.language && languages.includes(dictation.language) ? dictation.language : "auto"}
											ariaLabel="Dictation language"
											testid="standard-asr-language"
											onChange={(language) => onChange({ ...dictation, language })}
										>
											{selected.languages.includes("auto") && <option value="auto">Auto</option>}
											{languages.map((l) => (
												<option key={l} value={l}>
													{l}
												</option>
											))}
										</ThinSelect>
									</SettingsRow>
								)}

							</>
						)}
					</div>
				)}
			</SettingsGroup>
		</>
	);
}
