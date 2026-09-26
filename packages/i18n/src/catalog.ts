import { type I18n, type Messages, setupI18n } from "@lingui/core";

import { messages as en } from "../locales/en/messages";
import { type SupportedLocale, sourceLocale } from "./locales";

// Compiled catalogs (`i18n:compile`). Imported eagerly while `en` is the only
// locale; switch to per-locale dynamic imports once catalogs add real weight.
const catalogs: Record<SupportedLocale, Messages> = { en };

export function getMessages(locale: SupportedLocale): Messages {
  return catalogs[locale] ?? catalogs[sourceLocale];
}

/** A fresh, activated Lingui instance for one locale. */
export function createI18n(locale: SupportedLocale): I18n {
  return setupI18n({
    locale,
    messages: { [locale]: getMessages(locale) },
  });
}
