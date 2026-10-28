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
import { DictationLanguageSetting } from "@/components/dictation-language";
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
import { i18n, Trans, useLanguage, useT, type TFunction } from "@/components/i18n";
import { SettingsGroup, SettingsRow, ThinSelect } from "./controls.tsx";
import { KeysSection } from "./keys-section.tsx";

const ENGINES: readonly DictationEngine[] = ["deepgram", "standard-asr"];

/** English for the pure helpers' tests and default callers. */
const EN = () => i18n.getFixedT("en", "settings");

/** The artifact phases Standard ASR names (ArtifactProgressPhase). */
const PHASES = new Set(["resolving", "transferring", "extracting", "converting", "verifying", "finalizing"]);

/** A language tag with its name in the interface language ("中文 (zh)"). */
function languageLabel(tag: string, language: string): string {
	try {
		const name = new Intl.DisplayNames([language], { type: "language" }).of(tag);
		return name && name !== tag ? `${name} (${tag})` : tag;
	} catch {
		return tag;
	}
}

/** One progress line: a percent or a byte count when the engine reports
 *  them, the phase otherwise — never a made-up 0%. Pure — exported for
 *  tests. */
export function progressLine(progress: AsrProgress | null, t: TFunction<"settings"> = EN()): string | null {
	if (!progress) return null;
	const { completed_units: done, total_units: total, unit, phase } = progress;
	if (typeof done === "number" && typeof total === "number" && total > 0) {
		const pct = Math.min(100, Math.round((done / total) * 100));
		return unit === "bytes" ? t("dictation.progress.bytes", { pct, done: formatBytes(done), total: formatBytes(total) }) : `${pct}%`;
	}
	if (typeof done === "number" && unit === "bytes") return formatBytes(done);
	if (!phase) return null;
	return PHASES.has(phase) ? t(`dictation.phase.${phase as "resolving"}`) : phase.charAt(0).toUpperCase() + phase.slice(1);
}

/** What a model can do, in one line. Pure — exported for tests. */
export function modelCapabilities(model: AsrModel, t: TFunction<"settings"> = EN()): string {
	const parts: string[] = [];
	if (model.mode === "streaming") parts.push(model.partials ? t("dictation.capability.streamingLive") : t("dictation.capability.streaming"));
	else if (model.mode === "batch") parts.push(t("dictation.capability.batch"));
	else parts.push(t("dictation.capability.none"));
	if (model.prompt || model.phraseHints) parts.push(t("dictation.capability.vocabulary"));
	const languages = model.languages.filter((l) => l !== "auto");
	if (languages.length) parts.push(languages.length === 1 ? languages[0]! : t("dictation.capability.languages", { count: languages.length }));
	if (model.sampleRate) parts.push(`${model.sampleRate / 1000} kHz`);
	return parts.join(" · ");
}

/** The selected model's files, in one line. Pure — exported for tests. */
export function filesLine(status: AsrModelStatus | null, t: TFunction<"settings"> = EN()): { text: string; downloadable: boolean } {
	if (!status) return { text: t("dictation.files.checking"), downloadable: false };
	if (status.error) return { text: status.error, downloadable: false };
	const report = status.report;
	if (!report || !report.applicable || report.readiness === "not_applicable") return { text: t("dictation.files.none"), downloadable: false };
	const required = report.requirements.filter((r) => r.required_for_inference);
	const size = required.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);
	if (report.readiness === "ready") {
		return { text: size ? t("dictation.files.readySize", { size: formatBytes(size) }) : t("dictation.files.ready"), downloadable: false };
	}
	const expected = required.reduce((sum, r) => sum + (r.expected_size_bytes ?? 0), 0);
	const action = required.flatMap((r) => r.required_actions)[0];
	if (action) return { text: action.message, downloadable: false };
	const downloadable = required.some((r) => r.state !== "ready" && r.can_acquire_now);
	return { text: expected ? t("dictation.files.missingSize", { size: formatBytes(expected) }) : t("dictation.files.missing"), downloadable };
}

async function command(body: object, t: TFunction<"settings">): Promise<string | null> {
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
		return error instanceof Error ? error.message : t("dictation.unreachable");
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
	const { t } = useT("settings");
	const { language: uiLanguage } = useLanguage();
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
		const error = await command(body, t);
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
	const files = filesLine(selectedStatus, t);
	const languages = (selected?.languages ?? []).filter((l) => l !== "auto");
	const readiness = selectedStatus?.report?.readiness;
	const readyModel = engine === "standard-asr" && !busy && (readiness === "ready" || readiness === "not_applicable") ? selected?.key : null;
	useEffect(() => {
		if (readyModel) void command({ op: "warm", model: readyModel }, t);
	}, [readyModel, t]);
	const installCustom = async () => {
		if (await run({ op: "installEngine", requirement: requirement.trim() })) setRequirement("");
	};

	return (
		<>
			<SettingsGroup label={t("dictation.engine.group")} testid="group-dictation-engine">
				<SettingsRow label={t("dictation.engine.label")} hint={t(engine === "deepgram" ? "dictation.engine.hintDeepgram" : "dictation.engine.hintLocal")} testid="dictation-engine-row">
					<div role="radiogroup" aria-label={t("dictation.engine.aria")} className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
						{ENGINES.map((option) => {
							const active = option === engine;
							return (
								<button
									key={option}
									type="button"
									role="radio"
									aria-checked={active}
									data-testid={`dictation-engine-${option}`}
									onClick={() => !active && onChange({ ...dictation, engine: option })}
									className={cn(
										"h-8 rounded-md px-3 text-sm font-medium transition-colors",
										active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
									)}
								>
									{option === "deepgram" ? "Deepgram" : t("dictation.engine.local")}
								</button>
							);
						})}
					</div>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="Deepgram" testid="group-dictation">
				<KeysSection scope="dictation" initialRow={initialRow} />
				{engine === "deepgram" && <>
					<DictationLanguageSetting />
					<p data-testid="dictation-setup-hint" className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
						<Trans ns="settings" i18nKey="deepgramLanguage.setupHint" components={{ key: <a href="https://console.deepgram.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground" /> }} />
					</p>
				</>}
			</SettingsGroup>

			<SettingsGroup label={t("dictation.engine.local")} testid="group-standard-asr">
				{(actionError ?? status?.error) && (
					<p role="alert" className="whitespace-pre-wrap break-words rounded-sm border border-red-500/40 px-3 py-2 font-mono text-[11px] text-red-500" data-testid="standard-asr-error">
						{actionError ?? status?.error}
					</p>
				)}
				{status === null ? (
					actionError ? (
						<button type="button" onClick={() => { setActionError(null); void read(); }} className="self-start text-xs hover:underline">{t("dictation.retry")}</button>
					) : <p className="text-xs text-muted-foreground/70">{t("dictation.checking")}</p>
				) : (
					<div className="flex flex-col gap-3" data-testid="standard-asr">
						{status.step && (
							<p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="standard-asr-step">
								<Loader2Icon className="size-3.5 animate-spin" />
								<span>{t(`dictation.step.${status.step}`)}</span>
								{progressLine(status.progress, t) && <span className="tabular-nums">{progressLine(status.progress, t)}</span>}
							</p>
						)}
						{!status.inventory?.plugins.some((plugin) => plugin.name === status.recommended.package) && (
							<div className="flex flex-col gap-2" data-testid="standard-asr-install">
								<p className="text-xs text-muted-foreground/80">
									{t("dictation.install.intro")}
								</p>
								{status.uv ? (
									<button
										type="button"
										disabled={busy}
										onClick={() => void run({ op: "install" })}
										data-testid="standard-asr-install-button"
										className="self-start rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
									>
										{t("dictation.install.button", { label: status.recommended.package, runtime: status.recommended.runtime })}
									</button>
								) : (
									<p className="text-xs text-muted-foreground" data-testid="standard-asr-no-uv">
										{t("dictation.install.noUv")}
									</p>
								)}
							</div>
						)}

						<div className="flex flex-col gap-1" data-testid="standard-asr-engines">
							<p className="text-xs uppercase tracking-widest text-muted-foreground/70">{t("dictation.engines.label")}</p>
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
												{t("dictation.engines.remove")}
											</button>
											<button type="button" onClick={() => setRemoving(null)} className="text-muted-foreground/70 underline-offset-2 hover:underline">
												{t("dictation.engines.cancel")}
											</button>
										</span>
									) : (
										<button
											type="button"
											disabled={busy}
											onClick={() => setRemoving(plugin.name)}
											className="shrink-0 text-xs text-muted-foreground/70 underline-offset-2 hover:text-red-500 hover:underline disabled:opacity-40"
										>
											{t("dictation.engines.removeAsk")}
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
									placeholder={t("dictation.engines.placeholder")}
									aria-label={t("dictation.engines.aria")}
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
									{t("dictation.engines.install")}
								</button>
							</div>
							<p className="text-xs text-muted-foreground/60">
								{t("dictation.engines.footnote")}
							</p>
						</div>

						{status.installed && (
							<>
								<SettingsRow label={t("dictation.model.label")} hint={selected ? modelCapabilities(selected, t) : t("dictation.model.hint")} testid="standard-asr-model-row">
									<ThinSelect
										value={selected?.key ?? ""}
										ariaLabel={t("dictation.model.aria")}
										testid="standard-asr-model"
										disabled={busy}
										onChange={(key) => {
											onChange({ ...dictation, engine: "standard-asr", model: key, language: undefined });
										}}
									>
										{!selected && <option value="">{t("dictation.model.choose")}</option>}
										{models.map((m) => (
											<option key={m.key} value={m.key} disabled={m.mode === null || m.error !== null}>
												{m.key}
											</option>
										))}
									</ThinSelect>
								</SettingsRow>
								{selected && (
									<SettingsRow label={t("dictation.files.label")} hint={files.text} testid="standard-asr-files-row">
										{files.downloadable ? (
											<button
												type="button"
												disabled={busy}
												onClick={() => void run({ op: "download", model: selected.key })}
												data-testid="standard-asr-download"
												className="text-xs text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground/40 disabled:no-underline"
											>
												{t("dictation.files.download")}
											</button>
										) : (
											<span />
										)}
									</SettingsRow>
								)}
								{selected && languages.length > 0 && (
									<SettingsRow label={t("dictation.language.label")} hint={t("dictation.language.hint")} testid="standard-asr-language-row">
										<ThinSelect
											value={dictation?.language && languages.includes(dictation.language) ? dictation.language : "auto"}
											ariaLabel={t("dictation.language.aria")}
											testid="standard-asr-language"
											onChange={(language) => onChange({ ...dictation, language })}
										>
											{selected.languages.includes("auto") && <option value="auto">{t("dictation.language.auto")}</option>}
											{languages.map((l) => (
												<option key={l} value={l}>
													{languageLabel(l, uiLanguage)}
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
