"use client";

import { useCallback, useState } from "react";

import {
  clampSplit,
  parseSplit,
  SPLIT_DEFAULT,
  SPLIT_STORAGE_KEY,
} from "./model/split";
import { readStored, writeStored } from "./stored";

// Where the divider between the browser and the files sits (097), kept like
// the sidebar's width (071): in `localStorage`, written once on release (or a
// key press, or a reset), read when the panel mounts. The panel only mounts
// on the client, after the shell has read whether it's open, so the first
// frame already has the saved position. A drag moves `live` every frame.

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
