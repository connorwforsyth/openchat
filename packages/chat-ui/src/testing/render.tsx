import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";

// Component tests render with the source-locale catalog: macros compile to
// ids whose fallback is the English source, so no messages need loading.
const i18n = setupI18n({ locale: "en", messages: { en: {} } });

export const renderWithI18n = (ui: ReactElement): RenderResult =>
  render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

const APPLE = /Mac|iPhone|iPad/;

/** The modifier `mod` shortcuts use on the machine running the tests. */
export const modKey = (): "Meta" | "Control" =>
  APPLE.test(navigator.platform) ? "Meta" : "Control";
