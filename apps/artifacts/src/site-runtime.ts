import { SITE_PREVIEW_CHANNEL } from "@workspace/artifacts-kit/kinds/site/build";
import type { SITE_TSX_MODULES } from "@workspace/artifacts-kit/kinds/site/tsx";
import { err, ok, type Result } from "@workspace/shared/result";
// biome-ignore lint/performance/noNamespaceImport: a page's `require("@workspace/site-ui")` gets the whole module.
import * as siteUi from "@workspace/site-ui";
// biome-ignore lint/performance/noNamespaceImport: as above, for `react`.
import * as React from "react";
import { type ComponentType, createElement } from "react";
// biome-ignore lint/performance/noNamespaceImport: as above, for the JSX runtime the compiled page requires.
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";

import { messageOf } from "./errors";

// The site runtime (163): the module a TSX page's `.html` shell imports
// (`tsxShell` in `@workspace/artifacts-kit/kinds/site/build`). Bundled on
// its own as `site-runtime-<hash>.js`, served from the runtime's origin,
// which the site CSP's `'self'` allows. The shell hands it the compiled
// page as a function; it resolves the page's imports from the table below
// (never the network), and mounts the default export in the browser. A page
// is never rendered on the server: it's model code.

/** A compiled page: a CommonJS module body, as a function. */
export type SitePageModule = (
  require: (specifier: string) => unknown,
  module: { exports: Record<string, unknown> },
  exports: Record<string, unknown>
) => void;

/** What a page's `require` resolves to: `SITE_TSX_MODULES`, and nothing else. */
export const SITE_RUNTIME_MODULES: Readonly<
  Record<(typeof SITE_TSX_MODULES)[number], unknown>
> = {
  "@workspace/site-ui": siteUi,
  react: React,
  "react/jsx-runtime": jsxRuntime,
};

/** The page's component: its module run against the table, its default export. */
export const pageComponent = (
  run: SitePageModule,
  modules: Readonly<Record<string, unknown>> = SITE_RUNTIME_MODULES
): Result<ComponentType, string> => {
  const require = (specifier: string): unknown => {
    if (Object.hasOwn(modules, specifier)) {
      return modules[specifier];
    }
    throw new Error(
      `A page can't import "${specifier}". It may import ${Object.keys(modules).join(", ")}.`
    );
  };
  const module: { exports: Record<string, unknown> } = { exports: {} };
  try {
    run(require, module, module.exports);
  } catch (error) {
    return err(messageOf(error));
  }
  const page = module.exports.default;
  return typeof page === "function"
    ? ok(page as ComponentType)
    : err("The page has no default export: export the page's component.");
};

/** Tells the preview (if this is one) that the page failed, and why. */
const report = (page: string, error: unknown) => {
  const message = messageOf(error);
  console.error(`${page}: ${message}`);
  // In a preview the parent is the runtime's site page; published, it's
  // this window, which ignores it.
  window.parent.postMessage(
    { channel: SITE_PREVIEW_CHANNEL, message, page, type: "error" },
    "*"
  );
};

/** Mounts the page into `#root`, reporting what goes wrong. */
export const mountPage = (
  run: SitePageModule,
  { page }: { readonly page: string }
): void => {
  const container = document.getElementById("root");
  const component = pageComponent(run);
  if (!(container && component.ok)) {
    report(page, component.ok ? "The page has no #root." : component.error);
    return;
  }
  const onError = (error: unknown) => report(page, error);
  createRoot(container, {
    onCaughtError: onError,
    onRecoverableError: onError,
    onUncaughtError: onError,
  }).render(createElement(component.value));
};
