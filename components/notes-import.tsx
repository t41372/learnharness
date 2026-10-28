"use client";

import { useRef, useState } from "react";
import { i18n, useT, type TFunction } from "@/components/i18n";
import {
	AUTH_PROVIDER_KEYS,
	MODELS_NOT_CONFIGURED_CODE,
	PROVIDER_KEY_MISSING_CODE,
	modelsNotConfigured,
	providerKeyMissing,
} from "@/src/core";

// Transport-only types: never import the server's extraction/agent module here.
export interface NotesImportResult {
	requestIndex: number;
	filePath: string;
	ok: boolean;
	outcome: "completed" | "failed" | "partial" | "aborted" | "busy";
	stats?: { nodes: number; chains?: number; droppedChains?: number };
	error?: string;
	code?: string;
	missing?: string[];
	provider?: string;
	slots?: string[];
}

/** The English copy for callers without the hook's `t` (tests, the
 * reference) — the running language arrives from useNotesImport. */
const EN = i18n.getFixedT("en", "graph");

/** Validate the entire response before applying any row: a malformed index
 * must never attribute another file's success to this file (same names included). */
export function parseNotesImportResults(body: unknown, files: readonly File[], t: TFunction<"graph"> = EN): NotesImportResult[] {
	const invalid = () => new Error(t("notesImport.invalidResponse"));
	if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results) || body.results.length !== files.length) throw invalid();
	const seen = new Set<number>();
	for (const raw of body.results) {
		if (!raw || typeof raw !== "object") throw invalid();
		const r = raw as NotesImportResult;
		if (!Number.isInteger(r.requestIndex) || r.requestIndex < 0 || r.requestIndex >= files.length || seen.has(r.requestIndex) || r.filePath !== files[r.requestIndex]!.name) throw invalid();
		seen.add(r.requestIndex);
		if (!["completed", "failed", "partial", "aborted", "busy"].includes(r.outcome) || typeof r.ok !== "boolean" || r.ok !== (r.outcome === "completed")) throw invalid();
		if (r.stats !== undefined && (!r.stats || typeof r.stats !== "object" || !Number.isFinite(r.stats.nodes) || r.stats.nodes < 0 || (r.stats.chains !== undefined && (!Number.isFinite(r.stats.chains) || r.stats.chains < 0)))) throw invalid();
		if (r.ok && !r.stats) throw invalid();
		if (!r.ok && typeof r.error !== "string") throw invalid();
		for (const field of ["error", "code", "provider"] as const) if (r[field] !== undefined && typeof r[field] !== "string") throw invalid();
		for (const field of ["missing", "slots"] as const) if (r[field] !== undefined && (!Array.isArray(r[field]) || !r[field]!.every((v) => typeof v === "string"))) throw invalid();
	}
	return body.results as NotesImportResult[];
}

export async function postNotesImport(files: readonly File[], t: TFunction<"graph"> = EN): Promise<NotesImportResult[]> {
	const form = new FormData();
	for (const file of files) form.append("files", file);
	const response = await fetch("/api/graph/import", { method: "POST", body: form });
	let body: unknown;
	try { body = await response.json(); }
	catch { throw new Error(t("notesImport.invalidResponse")); }
	if (!response.ok) {
		const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
		throw new Error(detail === null
			? t("notesImport.requestFailed", { status: response.status })
			: t("notesImport.requestFailedDetail", { status: response.status, detail }));
	}
	return parseNotesImportResults(body, files, t);
}

/** A refusal's human line in the interface language: the two config
 * refusals carry a machine code AND their envelope's exact English line
 * (src/core/settings.ts) — matched on both, so any other text (a
 * reworded server line, free-form failures) still renders as received. */
function failureLine(r: NotesImportResult, t: TFunction<"graph">): string | undefined {
	if (r.code === MODELS_NOT_CONFIGURED_CODE && r.error === modelsNotConfigured([]).error) {
		return t("notesImport.modelsNotConfigured");
	}
	if (r.code === PROVIDER_KEY_MISSING_CODE && r.provider && r.error === providerKeyMissing(r.provider, []).error) {
		const provider = AUTH_PROVIDER_KEYS.find((p) => p.id === r.provider)?.label ?? r.provider;
		return t("notesImport.providerKeyMissing", { provider });
	}
	return r.error;
}

/** Only error text survives a request; selected Files stay request-local. */
export function useNotesImport(callbacks: { onStart?: () => void; onFinish?: () => void } = {}) {
	const { t } = useT("graph");
	const [errors, setErrors] = useState<string[]>([]);
	const [importing, setImporting] = useState(false);
	const pending = useRef(false);
	const submit = async (files: File[]) => {
		if (pending.current || files.length === 0) return;
		pending.current = true;
		setImporting(true);
		setErrors([]);
		try {
			callbacks.onStart?.();
			const results = await postNotesImport(files, t);
			setErrors(results
				.filter((result) => !result.ok)
				.sort((a, b) => a.requestIndex - b.requestIndex)
				.map((r) => `${r.filePath}: ${failureLine(r, t)}${r.code ? `\n${r.code}${r.provider ? ` — ${r.provider}` : ""}${r.missing?.length ? ` — ${r.missing.join(", ")}` : ""}${r.slots?.length ? ` — ${r.slots.join(", ")}` : ""}` : ""}`));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrors(files.map((file) => `${file.name}: ${message}`));
		} finally {
			pending.current = false;
			setImporting(false);
			callbacks.onFinish?.();
		}
	};
	return {
		errors, importing,
		onImportFiles: (files: FileList | null) => { if (files) void submit(Array.from(files)); },
	};
}

export function NotesImportErrors({ errors }: { errors: readonly string[] }) {
	return <>{errors.map((error, i) => (
		<p key={i} role="alert" className="max-w-full whitespace-pre-wrap break-words text-xs text-red-400">{error}</p>
	))}</>;
}
