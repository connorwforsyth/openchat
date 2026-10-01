import type { Locator, Page } from "@playwright/test";

// Quick AI's page (118, 135), shared by the web spec and the desktop smoke
// test: what a person can see of it.

/** The page's root: the strip, and the reply once there is one. */
export const quickRoot = (page: Page): Locator =>
  page.locator('[data-slot="quick"]');

/** The reply's footer bar, which shows only while there's a reply. */
export const quickFooter = (page: Page): Locator =>
  page.locator('[data-slot="quick-footer"]');

/**
 * Everything on the page that could show a scrollbar: the page itself, and
 * every element that scrolls on either axis, unless its scrollbar is hidden
 * (`scrollbar-width: none`). Not just what overflows now, so a longer reply
 * or input can't bring one up later. (Headless Chromium never paints
 * scrollbars, so a screenshot alone can't show this.)
 */
export const scrollbarsThatCouldShow = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const hidden = (element: Element) =>
      getComputedStyle(element).scrollbarWidth === "none";
    const scrolls = (value: string) => value === "auto" || value === "scroll";
    const found: string[] = [];
    if (!hidden(document.documentElement)) {
      found.push("page");
    }
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(element);
      if (
        (scrolls(style.overflowX) || scrolls(style.overflowY)) &&
        !hidden(element)
      ) {
        found.push(
          element.dataset.slot ??
            element.getAttribute("role") ??
            element.tagName
        );
      }
    }
    return found;
  });

/** Whether the page's root and body let what's behind the window through. */
export const seeThrough = (page: Page): Promise<boolean> =>
  page.evaluate(() =>
    [document.documentElement, document.body].every(
      (element) =>
        getComputedStyle(element).backgroundColor === "rgba(0, 0, 0, 0)"
    )
  );

/** The page's buttons, by name: the strip has Send alone. */
export const buttonNames = (scope: Locator): Promise<string[]> =>
  scope
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map(
        (button) =>
          button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""
      )
    );

/** Types lines into the composer, Shift+Enter after each, without sending. */
export const typeLines = async (input: Locator, lines: readonly string[]) => {
  for (const line of lines) {
    // biome-ignore lint/performance/noAwaitInLoops: keys go in order.
    await input.pressSequentially(line);
    await input.press("Shift+Enter");
  }
};

/**
 * `count` numbered lines (`${prefix} 1`, `${prefix} 2`, …), a blank line
 * after each, so a markdown reply echoing them keeps them as paragraphs.
 */
export const numberedLines = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => [
    `${prefix} ${index + 1}`,
    "",
  ]).flat();
