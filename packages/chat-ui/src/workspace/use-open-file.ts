"use client";

import { useLingui } from "@lingui/react/macro";
import type { SandboxId } from "@workspace/contract/schemas/common";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type { WorkspaceClient } from "./model/client";
import {
  hasUnsavedEdits,
  type OpenFile,
  openFileReducer,
  SAVE_IDLE_MS,
  shouldSave,
} from "./model/editor";
import { toSandboxPath } from "./model/tree";

// The I/O around `openFileReducer`: read the selected file, save edits after
// SAVE_IDLE_MS without typing (or on ⌘S) with the version it was read at, and
// reload it when the agent may have changed it, unless it has unsaved edits.

export interface UseOpenFileOptions {
  readonly client: WorkspaceClient;
  /** The workspace changed: refetch what's cached about it. */
  readonly onChanged: () => void;
  /** The selected file, relative to the workspace; `null` for none. */
  readonly path: string | null;
  /** Moves when the agent may have changed files (`workspaceRevision`). */
  readonly revision: number;
  readonly sandboxId: SandboxId | null;
}

export const useOpenFile = ({
  client,
  onChanged,
  path,
  revision,
  sandboxId,
}: UseOpenFileOptions) => {
  const { t } = useLingui();
  const [file, dispatch] = useReducer(openFileReducer, null);
  // Timers, handlers and cleanups read the latest of these without making
  // the effects that use them run again.
  const latest = useRef<OpenFile | null>(file);
  const saveFailed = t`Couldn't save this file.`;
  const io = useRef({ client, onChanged, saveFailed });
  useEffect(() => {
    latest.current = file;
    io.current = { client, onChanged, saveFailed };
  });

  const load = useCallback(
    async (target: string) => {
      if (!sandboxId) {
        return;
      }
      dispatch({ path: target, type: "load" });
      const read = await client.readFile(sandboxId, toSandboxPath(target));
      dispatch(
        read.ok
          ? { path: target, read: read.value, type: "loaded" }
          : { message: read.error, path: target, type: "failed" }
      );
    },
    [client, sandboxId]
  );

  const write = useCallback(
    async (current: OpenFile | null, force: boolean) => {
      if (current?.kind !== "text" || current.readOnly) {
        return;
      }
      const { client: port, onChanged: changed } = io.current;
      const sent = current.draft;
      dispatch({ sent, type: "saving" });
      const written = await port.writeFile({
        content: sent,
        // Overwrite on purpose, after a conflict; otherwise only over the
        // version the editor started from.
        ...(force ? {} : { ifMatch: current.etag }),
        path: toSandboxPath(current.path),
      });
      if (written.ok) {
        dispatch({ etag: written.value.etag, type: "saved" });
        changed();
      } else if (written.error.kind === "version_mismatch") {
        dispatch({ type: "conflict" });
      } else {
        dispatch({
          message:
            written.error.kind === "failed"
              ? written.error.message
              : io.current.saveFailed,
          type: "save-failed",
        });
      }
    },
    []
  );

  // Another file (or none) was selected: save what's pending on the one
  // being left, then open the new one.
  useEffect(() => {
    if (path) {
      load(path).catch(() => undefined);
    }
    return () => {
      if (shouldSave(latest.current)) {
        write(latest.current, false).catch(() => undefined);
      }
    };
  }, [load, path, write]);

  // The agent may have changed files: pick up the new text, unless the
  // person has edits of their own (their save will conflict instead).
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current === revision) {
      return;
    }
    seenRevision.current = revision;
    const { current } = latest;
    if (current && !hasUnsavedEdits(current)) {
      load(current.path).catch(() => undefined);
    }
  }, [load, revision]);

  // Save once typing stops.
  useEffect(() => {
    if (!shouldSave(file)) {
      return;
    }
    const timer = window.setTimeout(() => {
      write(latest.current, false).catch(() => undefined);
    }, SAVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [file, write]);

  const edit = useCallback(
    (text: string) => dispatch({ text, type: "edited" }),
    []
  );
  const save = useCallback(() => {
    if (shouldSave(latest.current)) {
      write(latest.current, false).catch(() => undefined);
    }
  }, [write]);
  const overwrite = useCallback(() => {
    write(latest.current, true).catch(() => undefined);
  }, [write]);
  const reload = useCallback(() => {
    const { current } = latest;
    if (current) {
      // Replacing the text is the point: forget the conflicting edits.
      dispatch({ path: current.path, type: "load" });
      load(current.path).catch(() => undefined);
    }
  }, [load]);

  return { edit, file: path ? file : null, overwrite, reload, save };
};
