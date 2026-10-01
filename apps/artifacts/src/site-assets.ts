// The stylesheets a site is built from (125), bundled as text by bun (the
// page and the server are both bun bundles): Tailwind itself, and the
// instance's theme, which lives in one file (`@workspace/ui/globals.css`).
// Kept apart so the modules that use them can be tested with the files
// read from disk instead.

import themeCss from "@workspace/ui/globals.css" with { type: "text" };
import tailwindCss from "tailwindcss/index.css" with { type: "text" };

export const SITE_ASSETS = { tailwindCss, themeCss } as const;
