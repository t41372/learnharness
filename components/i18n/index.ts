/**
 * The shell's i18n surface (i18n wave, 2026-10-25) — components import from
 * here, never from i18next directly, so the instance is always initialized
 * before the first t() (render tests included).
 *
 *   const { t } = useT("shell");          // keys typed from locales/en
 *   t("sidebar.newSession")               // this namespace
 *   t("common:shortcuts.find")            // another namespace
 *
 * Non-component helpers that produce copy take a `t` argument from their
 * caller's hook instead of reaching for the instance — the instance is the
 * English fallback, not the running language.
 */

import { useTranslation } from "react-i18next";

export { i18n } from "./i18n.ts";
export { I18nProvider, useLanguage } from "./provider.tsx";
export { NAMESPACES, type Namespace } from "./resources.ts";
export type { TFunction } from "i18next";

export const useT = useTranslation;
