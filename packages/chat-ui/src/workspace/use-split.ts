"use client";

import { useCallback, useState } from "react";

import {
  clampSplit,
  parseSplit,
  SPLIT_DEFAULT,
  SPLIT_STORAGE_KEY,
} from "./model/split";

// Where the divider between the browser and the files sits (097), kept like
// the sidebar's width (071): in `localStorage`, written once on release (or a
// key press, or a reset), read when the panel mounts. The panel only mounts
// on the client, after the shell has read whether it's open, so the first
// frame already has the saved position. A drag moves `live` every frame.

const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be off (private mode, a policy): the default it is.
    return null;
  }
};

const writeStored = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not saved; the divider still moves for as long as the page is open.
  }
};

export const useSplit = (storageKey = SPLIT_STORAGE_KEY) => {
  const [saved, setSaved] = useState(() =>
    typeof window === "undefined" ? null : parseSplit(readStored(storageKey))
  );
  const [live, setLive] = useState<number | null>(null);

  const save = useCallback(
    (fraction: number) => {
      const next = clampSplit(fraction);
      setSaved(next);
      setLive(null);
      writeStored(storageKey, String(next));
    },
    [storageKey]
  );

  return { fraction: live ?? saved ?? SPLIT_DEFAULT, save, setLive };
};
