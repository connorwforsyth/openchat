"use client";

import { useEffect, useState } from "react";

// D27: nothing competes with the composer. Surfaces that aren't needed to
// type (the ⌘K palette, the `?` dialog) load once the composer says it's
// ready, or once the browser is idle on pages without one.

/**
 * The composer's `performance.mark`. It's exported by the editor module,
 * which is exactly what this must not import, so it's spelled out here.
 */
export const COMPOSER_READY_MARK = "composer:ready";

/** Pages without a composer never mark; don't wait for ever. */
const IDLE_FALLBACK_MS = 1500;

const composerReady = (): boolean =>
  typeof performance !== "undefined" &&
  performance.getEntriesByName(COMPOSER_READY_MARK, "mark").length > 0;

/** `true` once the page has booted: the composer is ready, or a while has passed and the browser is idle. */
export const useAfterBoot = (): boolean => {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (booted) {
      return;
    }
    if (composerReady()) {
      setBooted(true);
      return;
    }
    const done = () => setBooted(true);
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        if (list.getEntriesByName(COMPOSER_READY_MARK).length > 0) {
          done();
        }
      });
      observer.observe({ type: "mark" });
    } catch {
      // No observer support: the idle fallback still gets there.
    }
    // Past the fallback, still wait for a quiet moment rather than landing
    // in the middle of hydration work.
    const timer = setTimeout(() => {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(done);
      } else {
        done();
      }
    }, IDLE_FALLBACK_MS);
    return () => {
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [booted]);
  return booted;
};
