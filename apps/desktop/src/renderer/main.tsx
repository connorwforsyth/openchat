import { I18nProvider } from "@lingui/react";
import { createI18n } from "@workspace/i18n/catalog";
import { sourceLocale, supportedLocales } from "@workspace/i18n/locales";
import { negotiateLocale } from "@workspace/i18n/negotiate";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SetupScreen } from "./setup-screen";
import "./styles.css";

// The first-run screen: the only page the shell renders itself. Everything
// after it is the instance's own web app.

const i18n = createI18n(
  negotiateLocale(navigator.languages.join(","), supportedLocales, sourceLocale)
);

// Follow the system theme; the shared theme switches on a `dark` class.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  document.documentElement.classList.toggle("dark", dark.matches);
};
applyTheme();
dark.addEventListener("change", applyTheme);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <SetupScreen bridge={window.desktopSetup} />
      </I18nProvider>
    </StrictMode>
  );
}
