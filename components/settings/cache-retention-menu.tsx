"use client";

import type { CacheRetention } from "@earendil-works/pi-ai";
import { i18n, useT, type TFunction } from "@/components/i18n";

/** The options in menu order; copy lives in the settings namespace's
 *  cacheRetention.options.<id> (i18n wave). */
const OPTIONS = [
	{ value: undefined, id: "default" },
	{ value: "none", id: "none" },
	{ value: "short", id: "short" },
	{ value: "long", id: "long" },
] as const;

/** The collapsed trigger's text. English by default (the pure-helper rule);
 *  the agent section passes its own `t`. */
export function cacheRetentionLabel(value: CacheRetention | undefined, t: TFunction<"settings"> = i18n.getFixedT("en", "settings")): string {
	const id = OPTIONS.find((option) => option.value === value)!.id;
	return t("cacheRetention.label", { value: t(`cacheRetention.options.${id}.compact`) });
}

export function CacheRetentionMenu({ value, onPick }: {
	value: CacheRetention | undefined;
	onPick: (value: CacheRetention | undefined) => void;
}) {
	const { t } = useT("settings");
	return <>
		<div className="border-b border-border px-2 pb-2">
			<p className="text-card-foreground">{t("cacheRetention.title")}</p>
			<p className="mt-1 text-muted-foreground">{t("cacheRetention.intro")}</p>
		</div>
		{OPTIONS.map((option) => <button
			key={option.value ?? "default"}
			type="button"
			data-testid={`cache-retention-option-${option.value ?? "default"}`}
			aria-pressed={value === option.value}
			onClick={() => onPick(option.value)}
			className={`rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted ${value === option.value ? "bg-muted/60" : ""}`}
		>
			<span className="flex justify-between gap-2 text-card-foreground"><span>{t(`cacheRetention.options.${option.id}.label`)}</span>{value === option.value && <span aria-hidden>✓</span>}</span>
			<span className="mt-1 block text-muted-foreground">{t(`cacheRetention.options.${option.id}.description`)}</span>
		</button>)}
	</>;
}
