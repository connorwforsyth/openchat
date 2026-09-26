import type { I18n } from "@lingui/core";
import { setI18n } from "@lingui/react/server";

import { createI18n } from "../catalog";
import type { SupportedLocale } from "../locales";

// One instance per locale for the life of the server process: instances are
// read-only after setup, so requests can share them safely.
const instances = new Map<SupportedLocale, I18n>();

function instanceFor(locale: SupportedLocale): I18n {
  const existing = instances.get(locale);
  if (existing) {
    return existing;
  }
  const created = createI18n(locale);
  instances.set(locale, created);
  return created;
}

/**
 * Makes `locale` the active Lingui instance for this server render so RSC
 * macros (`<Trans>`, `useLingui`) resolve. Call it in every layout and page
 * that renders strings: App Router renders them independently.
 */
export function initLingui(locale: SupportedLocale): I18n {
  const i18n = instanceFor(locale);
  setI18n(i18n);
  return i18n;
}
