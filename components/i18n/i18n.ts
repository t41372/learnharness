import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { NAMESPACES, RESOURCES } from "./resources.ts";

/**
 * The app-wide i18next instance (i18n wave, 2026-10-25). Initialized
 * SYNCHRONOUSLY at module load with every bundled resource — no backend,
 * no lazy loading — so the first render (server or client) already has
 * its strings.
 *
 * It stays in English: the I18nProvider (./provider.tsx) renders under a
 * per-provider CLONE in the resolved language, so concurrent server renders
 * never share a language through this singleton. Surfaces rendered without
 * a provider — the render tests' renderToStaticMarkup — fall back to this
 * instance, which is why every test sees the English reference copy.
 */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
	resources: RESOURCES,
	lng: "en",
	fallbackLng: "en",
	ns: NAMESPACES,
	defaultNS: "common",
	initAsync: false,
	returnNull: false,
	// React escapes on render; double-escaping would show entities.
	interpolation: { escapeValue: false },
	react: { useSuspense: false },
});
