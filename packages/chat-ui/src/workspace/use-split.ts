"use client";

import { useCallback, useState } from "react";

import {
  clampListWidth,
  clampSplit,
  LIST_WIDTH_DEFAULT,
  LIST_WIDTH_STORAGE_KEY,
  parseListWidth,
  parseSplit,
  SPLIT_DEFAULT,
  SPLIT_STORAGE_KEY,
} from "./model/split";
import { readStored, writeStored } from "./stored";

// Where the divider between the preview and the files sits (097), and how
// wide the file list is beside the open file (night 2), kept like the
// sidebar's width (071): in `localStorage`, written once on release (or a
// key press, or a reset), read when the panel mounts. The panel only mounts
// on the client, after the shell has read whether it's open, so the first
// frame already has the saved position. A drag moves `live` every frame.

const useStoredSize = (
  storageKey: string,
  parse: (raw: string | null) => number,
  clamp: (value: number) => number,
  fallback: number
) => {
  const [saved, setSaved] = useState(() =>
    typeof window === "undefined" ? null : parse(readStored(storageKey))
  );
  const [live, setLive] = useState<number | null>(null);

  const save = useCallback(
    (value: number) => {
      const next = clamp(value);
      setSaved(next);
      setLive(null);
      writeStored(storageKey, String(next));
    },
    [clamp, storageKey]
  );

  return { save, setLive, value: live ?? saved ?? fallback };
};

const clampShare = (fraction: number) => clampSplit(fraction);

export const useSplit = (storageKey = SPLIT_STORAGE_KEY) => {
  const { save, setLive, value } = useStoredSize(
    storageKey,
    parseSplit,
    clampShare,
    SPLIT_DEFAULT
  );
  return { fraction: value, save, setLive };
};

const clampWidth = (width: number) => clampListWidth(width);

/** The file list's width, in px; the handle keeps it inside the room there is. */
export const useListWidth = () =>
  useStoredSize(
    LIST_WIDTH_STORAGE_KEY,
    parseListWidth,
    clampWidth,
    LIST_WIDTH_DEFAULT
  );
