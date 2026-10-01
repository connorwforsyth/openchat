import type { I18n } from "@lingui/core";
import { createI18n } from "@workspace/i18n/catalog";
import { sourceLocale, supportedLocales } from "@workspace/i18n/locales";
import { negotiateLocale } from "@workspace/i18n/negotiate";

/** Lingui for main's own strings (the menu), in the system's language. */
export const i18nForSystem = (preferredLanguages: readonly string[]): I18n =>
  createI18n(
    negotiateLocale(
      preferredLanguages.join(","),
      supportedLocales,
      sourceLocale
    )
  );
