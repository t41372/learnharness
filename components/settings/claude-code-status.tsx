"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLAUDE_CODE_MINIMUM_VERSION, type ClaudeCodeStatus, type UserSettings } from "@/src/core";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
import { i18n, Trans, useT, type TFunction } from "@/components/i18n";
import { Toggle } from "./controls";

/** English by default (the i18n wave's pure-helper rule); the row passes its own `t`. */
export function claudeCodeStatusLabel(status: ClaudeCodeStatus | null, t: TFunction<"settings"> = i18n.getFixedT("en", "settings")): string {
	switch (status?.state) {
		case "not-found": return t("claudeCode.status.notFound");
		case "meets-minimum": return t("claudeCode.status.meetsMinimum", { version: status.version });
		case "update-required": return t("claudeCode.status.updateRequired", { version: status.version });
		default: return t("claudeCode.status.unchecked");
	}
}

export function ClaudeCodeInstallationStatus() {
	const { t } = useT("settings");
	const [enabled, setEnabled] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	// Which call failed; the copy is chosen at render (i18n wave).
	const [error, setError] = useState<"load" | "save" | null>(null);
	const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const request = useRef<AbortController | null>(null);
	const settingsRead = useRef<AbortController | null>(null);
	const settingsWrite = useRef<AbortController | null>(null);

	const read = useCallback(async () => {
		settingsRead.current?.abort();
		const controller = new AbortController();
		settingsRead.current = controller;
		setLoaded(false);
		try {
			const response = await fetch("/api/settings", { cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error("settings unavailable");
			const body = await response.json() as { settings: UserSettings | null };
			if (!controller.signal.aborted) {
				setEnabled(body.settings?.claudeCode?.enabled === true);
				setLoaded(true);
				setError(null);
			}
		} catch {
			if (!controller.signal.aborted) setError("load");
		}
	}, []);
	useEffect(() => {
		void read();
		return () => { settingsRead.current?.abort(); settingsWrite.current?.abort(); };
	}, [read]);
	useSettingsSaved((section) => { if (section === "claudeCode") void read(); });

	const save = async (next: boolean) => {
		const controller = new AbortController();
		settingsWrite.current = controller;
		settingsRead.current?.abort();
		setSaving(true);
		setError(null);
		try {
			const response = await fetch("/api/settings/claudeCode", { method: "PUT", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: next }), signal: controller.signal });
			if (!response.ok) throw new Error("settings write failed");
			const body = await response.json() as { settings: UserSettings };
			if (typeof body.settings?.claudeCode?.enabled !== "boolean") throw new Error("invalid settings response");
			if (!controller.signal.aborted) {
				setEnabled(body.settings.claudeCode.enabled);
				notifySettingsSaved("claudeCode");
			}
		} catch {
			if (!controller.signal.aborted) setError("save");
		} finally {
			if (!controller.signal.aborted) setSaving(false);
		}
	};

	const refresh = useCallback(async () => {
		if (!enabled) return;
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setBusy(true);
		try {
			const response = await fetch("/api/claude-code", { cache: "no-store", signal: controller.signal, headers: { "x-learnharness-claude-code": "1" } });
			if (!response.ok) throw new Error("status unavailable");
			const value = await response.json() as ClaudeCodeStatus;
			if (!["not-found", "meets-minimum", "update-required", "version-unchecked"].includes(value.state)
				|| value.minimumVersion !== CLAUDE_CODE_MINIMUM_VERSION
				|| (value.version !== null && (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)))) throw new Error("invalid status");
			if (!controller.signal.aborted) setStatus(value);
		} catch {
			if (!controller.signal.aborted) setStatus(null);
		} finally {
			if (!controller.signal.aborted) setBusy(false);
		}
	}, [enabled]);
	useEffect(() => {
		if (enabled) void refresh();
		else { request.current?.abort(); setStatus(null); setBusy(false); }
		return () => request.current?.abort();
	}, [enabled, refresh]);

	return <div className="space-y-2" data-testid="claude-code-installation">
		<div className="flex items-center gap-3">
			<span className="font-prose text-(length:--lh-prose-size) text-foreground">Claude Code</span>
			<Toggle label="Claude Code" checked={enabled} disabled={!loaded || saving} onChange={(next) => void save(next)} />
		</div>
		{error && <p role="alert" className="text-xs text-error">{t(error === "load" ? "claudeCode.loadFailed" : "claudeCode.saveFailed")}</p>}
		{enabled && <>
			<div className="flex flex-wrap items-center gap-3">
				<span role="status" className="text-xs text-muted-foreground">{busy ? t("claudeCode.checking") : claudeCodeStatusLabel(status, t)}</span>
				<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" disabled={busy} onClick={() => void refresh()} data-testid="claude-code-check-again">{t("claudeCode.checkAgain")}</Button>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground"><Trans t={t} i18nKey="claudeCode.setupIntro" components={{ strong: <strong className="font-medium" /> }} /></p>
			<p className="text-xs leading-relaxed text-muted-foreground">{t("claudeCode.scope", { version: CLAUDE_CODE_MINIMUM_VERSION })} <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{t("claudeCode.setupLink")}</a></p>
			<p className="text-xs leading-relaxed text-muted-foreground">{t("claudeCode.verifyClaims")}</p>
		</>}
	</div>;
}
