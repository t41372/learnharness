"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { resolveLanguage, type Language, type LanguageSetting } from "@/src/core";
import { i18n } from "./i18n.ts";

/**
 * THE LANGUAGE PROVIDER (i18n wave, 2026-10-25): mounted once in the root
 * layout with the language the SERVER resolved (the settings record's
 * general.language; "system" via the request's Accept-Language), so the
 * first frame is already in the right language — no English flash, no
 * hydration mismatch.
 *
 * It renders under its own clone of the i18next instance (see ./i18n.ts):
 * switching language re-renders every useT consumer through the clone's
 * languageChanged event. The settings row calls `setSetting`; the record
 * write itself stays the settings dialog's job.
 */

interface LanguageState {
	/** The language the interface renders in. */
	language: Language;
	/** The stored choice ("system" or a language). */
	setting: LanguageSetting;
	/** Apply a new choice to the running interface (the caller persists it). */
	setSetting: (setting: LanguageSetting) => void;
}

const LanguageContext = createContext<LanguageState>({
	language: "en",
	setting: "system",
	setSetting: () => {},
});

/** The platform's preference list, browser side. */
function platformPreferences(): readonly string[] {
	if (typeof navigator === "undefined") return [];
	return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function I18nProvider({
	setting: initialSetting,
	language: initialLanguage,
	children,
}: {
	setting: LanguageSetting;
	language: Language;
	children: React.ReactNode;
}) {
	const [instance] = useState(() => i18n.cloneInstance({ lng: initialLanguage }));
	const [state, setState] = useState({ setting: initialSetting, language: initialLanguage });

	const apply = useCallback(
		(setting: LanguageSetting) => {
			const language = resolveLanguage(setting, platformPreferences());
			setState({ setting, language });
			if (instance.language !== language) void instance.changeLanguage(language);
			document.documentElement.lang = language;
			// The desktop shell localizes its native menus from this (absent
			// in the browser).
			window.lh?.setLanguage?.(language);
		},
		[instance],
	);

	// Mount: tell the desktop shell the language, and let "system" re-resolve
	// from navigator.languages (it normally agrees with the server's
	// Accept-Language reading; when it doesn't, the client's is the truth).
	useEffect(() => {
		apply(initialSetting);
	}, [apply, initialSetting]);

	const value = useMemo(() => ({ ...state, setSetting: apply }), [state, apply]);
	return (
		<I18nextProvider i18n={instance}>
			<LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
		</I18nextProvider>
	);
}

/** The running language + the stored choice. Without a provider (render
 *  tests): English, "system". */
export function useLanguage(): LanguageState {
	return useContext(LanguageContext);
}
