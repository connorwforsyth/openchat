"use client";

import { useSyncExternalStore } from "react";

/** Below Tailwind's `md`: the sidebar and the right panel become sheets. */
export const NARROW_SCREEN_QUERY = "(width < 48rem)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(NARROW_SCREEN_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const getSnapshot = () => window.matchMedia(NARROW_SCREEN_QUERY).matches;

// The server can't know the width, so it renders the wide layout; CSS
// (`max-md:hidden`) keeps that from flashing on a phone before hydration.
const getServerSnapshot = () => false;

/** Whether the screen is narrower than `md`, following resizes and rotation. */
export const useNarrowScreen = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
