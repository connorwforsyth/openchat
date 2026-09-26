"use client";

import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { ReactNode } from "react";

import { codeThemeNames } from "./theme/code-theme";
import { registerCodeThemes } from "./theme/register";

// The pool resolves its themes when it starts, so they must be registered
// before the provider first renders.
registerCodeThemes();

// Languages the workers load up front; others load on first use.
const preloadedLanguages = [
  "bash",
  "css",
  "json",
  "markdown",
  "python",
  "tsx",
  "typescript",
];

// The package's own worker entry, as the diffs skill does it. A local file
// that only imports it doesn't work: the package marks the worker as free of
// side effects, so bundlers drop a bare import of it. The worker is classic,
// not `type: "module"`: bundlers emit it as a bundled script, and Turbopack's
// worker bootstrap loads its chunks with `importScripts`.
const createWorker = () =>
  new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url));

const poolOptions = {
  // Highlighting is bursty (a diff arrives, then nothing); two workers keep
  // the main thread free without holding many Shiki instances in memory.
  poolSize: 2,
  workerFactory: createWorker,
};

const highlighterOptions = {
  langs: preloadedLanguages,
  theme: codeThemeNames,
};

/**
 * Highlights code views off the main thread through a shared worker pool, as
 * the diffs skill recommends. Optional: without it, views highlight on the
 * main thread. SSR-safe; the pool only starts in the browser.
 */
export function CodeUiProvider({ children }: { readonly children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      highlighterOptions={highlighterOptions}
      poolOptions={poolOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
