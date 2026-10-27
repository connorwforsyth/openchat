"use client";

import { useCallback, useState } from "react";

import { readStored, writeStored } from "./stored";

// Whether the files viewer under the preview is open or folded to its row.
// Remembered per browser profile, like the divider (097); read when the
// panel mounts and written on each toggle.

export const FILES_DOCK_STORAGE_KEY = "chat-ui:files-dock";

export const useFilesDock = () => {
  const [open, setOpen] = useState(
    () =>
      typeof window === "undefined" ||
      readStored(FILES_DOCK_STORAGE_KEY) !== "closed"
  );
  const set = useCallback((next: boolean) => {
    setOpen(next);
    writeStored(FILES_DOCK_STORAGE_KEY, next ? "open" : "closed");
  }, []);
  const toggle = useCallback(() => set(!open), [open, set]);
  return { open, set, toggle };
};
