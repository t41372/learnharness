"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import { DICTATION_LANGUAGES, type DictationLanguage } from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { Hint } from "@/components/ui/hint";
import { SettingsMenuTrigger, SettingsRow } from "@/components/settings/controls";
import { SearchMenuList } from "@/components/settings/search-menu-list";
import { useDictationActive } from "@/components/dictation-state";
import { useDictationLanguage } from "@/components/dictation-preference";

type LanguagePreference = ReturnType<typeof useDictationLanguage>;

export function DictationLanguageSetting() {
	const { t } = useT("settings");
	const preference = useDictationLanguage();
	const active = useDictationActive();
	return <SettingsRow label={t("deepgramLanguage.label")} testid="row-dictation-language" dimmed={active}>
		<DictationLanguagePicker preference={preference} disabled={active} />
	</SettingsRow>;
}

function DictationLanguagePicker({ preference, disabled }: {
	preference: LanguagePreference;
	disabled: boolean;
}) {
	const { t, i18n } = useT("settings");
	const names = new Intl.DisplayNames([i18n.language], { type: "language" });
	const itemLabel = (item: (typeof DICTATION_LANGUAGES)[number]) => item.code === "multi" ? t("deepgramLanguage.multilingual") : i18n.language === "en" ? item.label : names.of(item.code) ?? item.label;
	const { language, saving, error, load, save } = preference;
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const selected = DICTATION_LANGUAGES.find((item) => item.code === language);
	const label = selected ? itemLabel(selected) : "—";
	const interactions = useInteractionLayers();

	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const popup = interactions.getTopLayer();
			if (popup?.kind !== "popup" || popup.anchorRef?.current !== triggerRef.current || !interactions.isElementEligible(popup.rootRef.current)) return;
			const target = event.target as Element;
			if (target instanceof Element && target.closest('[data-testid="dictation-language-menu"]')) return;
			if (!triggerRef.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, interactions]);
	const pick = async (code: DictationLanguage) => {
		if (disabled || saving || language === undefined) return;
		if (await save(code)) {
			setOpen(false);
			if (interactions.isElementEligible(triggerRef.current) || interactions.isPopupOrigin(triggerRef.current)) triggerRef.current?.focus();
		}
	};

	return <>
		<Hint label={error ?? t("deepgramLanguage.hint", { language: label })} side="top">
			<SettingsMenuTrigger
				ref={triggerRef}
				value={label}
				data-testid="dictation-language"
				aria-label={t("deepgramLanguage.hint", { language: label })}
				aria-expanded={open && !disabled}
				disabled={disabled || saving}
				onClick={() => {
					setOpen((value) => !value);
					if (language === undefined) void load().catch(() => {});
				}}
				className="min-w-20 max-w-[65%]"
			/>
		</Hint>
		{open && !disabled && <MenuShell
			anchorRef={triggerRef}
			testid="dictation-language-menu"
			onClose={(reason) => { setOpen(false); if (reason === "escape") triggerRef.current?.focus(); return "closed"; }}
			preferredSide="down"
			menuClass="flex w-72 max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
		>
			<div onKeyDown={(event) => {
				if (event.key === "Enter") {
					// Empty search results must not submit the composer, but a
					// focused option button still needs Enter's native click.
					if (event.target instanceof HTMLInputElement) event.preventDefault();
					event.stopPropagation();
				}
			}}>
				{error && <div role="alert" className="mb-1.5 text-destructive">{error}</div>}
				<SearchMenuList
					items={DICTATION_LANGUAGES}
					itemKey={(item) => item.code}
					searchTerms={(item) => [item.code, item.label, itemLabel(item)]}
					isSelected={(item) => item.code === language}
					onPick={(item) => { void pick(item.code); }}
					disabled={saving || language === undefined}
					searchTestid="dictation-language-search"
					listTestid="dictation-language-list"
					optionTestid={(item) => `dictation-language-${item.code}`}
					ariaLabel={t("deepgramLanguage.search")}
					placeholder={t("deepgramLanguage.placeholder")}
					empty={t("deepgramLanguage.empty")}
					renderItem={(item) => <span className="text-card-foreground">{itemLabel(item)}</span>}
				/>
			</div>
		</MenuShell>}
	</>;
}
