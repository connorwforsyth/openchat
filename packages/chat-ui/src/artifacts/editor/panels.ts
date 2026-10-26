"use client";

import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

import { readStored, writeStored } from "../../workspace/stored";

// Which of the editor's panels are shown, shared by every kind's editor and
// remembered across reloads. One record for every editor: hiding the
// inspector in the slides editor hides it in the next editor that has one.
// Tabs and editors on the page stay in step through the store below.

export const editorPanelSchema = z.enum(["rail", "inspector", "notes"]);
export type EditorPanel = z.infer<typeof editorPanelSchema>;

export const editorPanelsSchema = z.object({
  inspector: z.boolean().catch(true),
  notes: z.boolean().catch(true),
  rail: z.boolean().catch(true),
});
export type EditorPanels = z.infer<typeof editorPanelsSchema>;

export const EDITOR_PANELS_STORAGE_KEY = "artifact-editor:panels";

export const defaultEditorPanels: EditorPanels = {
  inspector: true,
  notes: true,
  rail: true,
};

/** What's stored, read leniently: anything unreadable shows the panel. */
export const parseEditorPanels = (raw: string | null): EditorPanels => {
  if (raw === null) {
    return defaultEditorPanels;
  }
  try {
    const parsed = editorPanelsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultEditorPanels;
  } catch {
    return defaultEditorPanels;
  }
};

export const toggleEditorPanel = (
  panels: EditorPanels,
  panel: EditorPanel
): EditorPanels => ({ ...panels, [panel]: !panels[panel] });

const listeners = new Set<() => void>();
// Read from storage when the first editor mounts, then kept here: a page
// with storage off still toggles, and another tab's change arrives as a
// `storage` event.
let current: EditorPanels | null = null;

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

const snapshot = (): EditorPanels => {
  current ??= parseEditorPanels(readStored(EDITOR_PANELS_STORAGE_KEY));
  return current;
};

const serverSnapshot = (): EditorPanels => defaultEditorPanels;

const onStorage = (event: StorageEvent) => {
  if (event.key === EDITOR_PANELS_STORAGE_KEY || event.key === null) {
    current = parseEditorPanels(event.key === null ? null : event.newValue);
    notify();
  }
};

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      // Unwatched, it could miss another tab's change: read it afresh.
      current = null;
    }
  };
};

const store = (next: EditorPanels) => {
  current = next;
  writeStored(EDITOR_PANELS_STORAGE_KEY, JSON.stringify(next));
  notify();
};

/** The panels shown, and a toggle that remembers the change. */
export const useEditorPanels = () => {
  const panels = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const toggle = useCallback(
    (panel: EditorPanel) => store(toggleEditorPanel(snapshot(), panel)),
    []
  );
  return { panels, toggle };
};
