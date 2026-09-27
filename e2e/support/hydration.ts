import { expect, type Locator } from "@playwright/test";

// Server-rendered forms are on screen before React owns them. Submitted
// then, the browser does a plain GET of the form instead of the app's
// request, so specs wait until React has hydrated the control they're about
// to use (it tags hydrated DOM nodes with `__reactProps$…`). A person rarely
// beats hydration; a test on a busy machine does.
export const hydrated = async (control: Locator): Promise<Locator> => {
  await expect
    .poll(
      () =>
        control.evaluate((node) =>
          Object.keys(node).some((key) => key.startsWith("__reactProps$"))
        ),
      { message: "the control is hydrated" }
    )
    .toBe(true);
  return control;
};

/** Clicks `control` once React has hydrated it. */
export const clickHydrated = async (control: Locator): Promise<void> => {
  await (await hydrated(control)).click();
};
