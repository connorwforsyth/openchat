"use client";

import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";
import { useEffect, useState } from "react";

import { codeThemeNames, preferredHighlighter } from "./code-theme";

const themes = [codeThemeNames.light, codeThemeNames.dark];

const isReady = (lang: SupportedLanguages) =>
  getHighlighterIfLoaded({ lang, theme: codeThemeNames }) !== undefined;

/**
 * Whether the page's highlighter has our themes and `lang`, loading them if
 * not. A view mounts its @pierre/diffs element only once this is true.
 *
 * @pierre/diffs takes a `<pre>` already in its element as server-rendered
 * and doesn't draw over it. A view whose first draw waits on the highlighter
 * leaves an empty `<pre>`; if React detaches and reattaches the element
 * meanwhile (a sibling suspending, or StrictMode), the new instance finds it,
 * and the first instance's late result is dropped, so the view stays blank.
 * With the highlighter ready, the first draw is synchronous.
 */
export function useHighlighterReady(lang: SupportedLanguages): boolean {
  const [loaded, setLoaded] = useState<SupportedLanguages | null>(null);
  const ready = loaded === lang || isReady(lang);
  useEffect(() => {
    if (ready) {
      return;
    }
    let current = true;
    const settle = () => {
      if (current) {
        setLoaded(lang);
      }
    };
    // A language Shiki can't load still gets a view: the element falls
    // back to plain text on its own.
    getSharedHighlighter({ langs: [lang], preferredHighlighter, themes }).then(
      settle,
      settle
    );
    return () => {
      current = false;
    };
  }, [lang, ready]);
  return ready;
}
