// The instance's theme for decks (164), bundled as text by bun: the one file
// the theme lives in (`@workspace/ui/globals.css`). Kept apart, as
// `./site-assets` is, so the modules that use it can be tested with the
// file read from disk instead.

import themeCss from "@workspace/ui/globals.css" with { type: "text" };

export const SLIDE_ASSETS = { themeCss } as const;
