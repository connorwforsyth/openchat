import { SLIDE_SIZE } from "@workspace/artifacts-kit/kinds/presentation/content";
import { ruleBody } from "@workspace/artifacts-kit/kinds/site/theme";
import type { RuntimeTheme } from "@workspace/chat-ui/artifacts/runtime-protocol";

// The stylesheet a deck is drawn with (164): the instance's theme tokens,
// light or dark as the app is, taken out of `@workspace/ui`'s globals.css
// (the only place the theme lives), and the deck's own frame. `@workspace/
// slide-ui` styles itself on these variables. Pure, so it's tested with the
// file read from disk.

/**
 * The deck's stylesheet for `theme`. Overview: every slide down the page,
 * scaled to its width. Presenting: one slide, fitted to the window.
 * Nothing animates (D28): presenting is driven by the keyboard.
 */
export const slideDeckCss = (
  globalsCss: string,
  theme: RuntimeTheme,
  /** The instance's own values for decks (`brand/…/theme.css`), over the app's. */
  brand = ""
): string => {
  const tokens = ruleBody(globalsCss, theme === "dark" ? ".dark" : ":root");
  return [
    `:root {${tokens ?? ""}}`,
    ...(brand ? [`:root {${brand}}`] : []),
    `.deck {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  color-scheme: ${theme};
}
.deck-slide {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 0 0 1px var(--border);
  aspect-ratio: ${SLIDE_SIZE.width} / ${SLIDE_SIZE.height};
}
.deck-canvas {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  width: ${SLIDE_SIZE.width}px;
  height: ${SLIDE_SIZE.height}px;
  transform-origin: 0 0;
}
.deck-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  overflow: auto;
  background: var(--muted);
  color: var(--destructive);
  font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
}
.deck-error pre {
  margin: 0;
  white-space: pre-wrap;
  color: var(--muted-foreground);
  font: 12px/1.4 ui-monospace, monospace;
}
.deck[data-presenting] {
  position: fixed;
  inset: 0;
  padding: 0;
  align-items: center;
  justify-content: center;
  background: var(--background);
}
.deck[data-presenting] .deck-slide { display: none; border-radius: 0; box-shadow: none; }
.deck[data-presenting] .deck-slide[data-current] { display: block; flex: none; }
[data-step-hidden] { visibility: hidden; }
.deck-capture {
  position: fixed;
  inset-block-start: 0;
  inset-inline-start: -40000px;
  width: ${SLIDE_SIZE.width}px;
}`,
  ].join("\n");
};
