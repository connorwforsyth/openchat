"use client";

import { type Messages, setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { type ReactNode, useState } from "react";

import type { SupportedLocale } from "../locales";

/**
 * Client half of the Lingui setup. An `I18n` instance isn't serialisable, so
 * the server layout passes the locale and its compiled messages instead and
 * the client builds its own instance once.
 */
export function LinguiClientProvider({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: SupportedLocale;
  messages: Messages;
}) {
  const [i18n] = useState(() =>
    setupI18n({ locale, messages: { [locale]: messages } })
  );
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
