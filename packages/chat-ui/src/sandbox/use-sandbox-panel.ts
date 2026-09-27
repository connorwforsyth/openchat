"use client";

import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { useCallback, useRef, useState } from "react";

import type { OpenFile } from "./files";
import type { SandboxPanelClient } from "./model/client";
import {
  appendCommand,
  appendError,
  appendExit,
  appendOutput,
  emptyLog,
  type TerminalLog,
} from "./model/log";
import { toSandboxPath, toTreePaths } from "./model/tree";

// The panel's state over a `SandboxPanelClient`: the record, the terminal
// log, the file listing and the open file, and the preview. Every client
// call is a Result, so failures land in the UI as messages.

const BASE64_BYTES_PER_CHAR = 3 / 4;

export const useSandboxPanel = (
  client: SandboxPanelClient,
  initial: SandboxRecord | null
) => {
  const [sandbox, setSandbox] = useState(initial);
  const [log, setLog] = useState<TerminalLog>(emptyLog);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [listing, setListing] = useState(false);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [preview, setPreview] = useState(initial?.previews.at(-1) ?? null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Drops answers for a file that's no longer the one selected.
  const opening = useRef<string | null>(null);

  const id = sandbox?.id;

  const refresh = useCallback(async () => {
    if (!id) {
      return;
    }
    setListing(true);
    const listed = await client.listFiles(id);
    setListing(false);
    if (listed.ok) {
      setPaths(toTreePaths(listed.value));
    } else {
      setError(listed.error);
    }
  }, [client, id]);

  const run = useCallback(
    async (command: string) => {
      if (!id) {
        return;
      }
      setRunning(true);
      setLog((current) => appendCommand(current, command));
      const streamed = { stderr: false, stdout: false };
      const result = await client.exec(id, command, (chunk) => {
        streamed[chunk.stream] = true;
        setLog((current) => appendOutput(current, chunk.stream, chunk.data));
      });
      setLog((current) =>
        result.ok
          ? appendExit(current, result.value, streamed)
          : appendError(current, result.error)
      );
      setRunning(false);
      // Commands change files; keep the tree honest.
      await refresh();
    },
    [client, id, refresh]
  );

  const select = useCallback(
    async (treePath: string) => {
      if (!id) {
        return;
      }
      opening.current = treePath;
      setOpen({ kind: "loading", path: treePath });
      const read = await client.readFile(id, toSandboxPath(treePath));
      if (opening.current !== treePath) {
        return;
      }
      if (!read.ok) {
        setOpen({ kind: "error", message: read.error, path: treePath });
      } else if (read.value.encoding === "utf8") {
        setOpen({ content: read.value.content, kind: "text", path: treePath });
      } else {
        setOpen({
          kind: "binary",
          path: treePath,
          size: Math.floor(read.value.content.length * BASE64_BYTES_PER_CHAR),
        });
      }
    },
    [client, id]
  );

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    const created = await client.create();
    setBusy(false);
    if (created.ok) {
      setSandbox(created.value);
    } else {
      setError(created.error);
    }
  }, [client]);

  const reset = useCallback(async () => {
    if (!id) {
      return;
    }
    setBusy(true);
    setError(null);
    const fresh = await client.reset(id);
    setBusy(false);
    if (fresh.ok) {
      setSandbox(fresh.value);
      setLog(emptyLog);
      setPaths([]);
      setOpen(null);
      setPreview(null);
    } else {
      setError(fresh.error);
    }
  }, [client, id]);

  const expose = useCallback(
    async (port: number) => {
      if (!id) {
        return;
      }
      setPreviewError(null);
      const exposed = await client.exposePort(id, port);
      if (exposed.ok) {
        setPreview(exposed.value);
      } else {
        setPreviewError(exposed.error);
      }
    },
    [client, id]
  );

  return {
    busy,
    create,
    error,
    expose,
    listing,
    log,
    open,
    paths,
    preview,
    previewError,
    refresh,
    reset,
    run,
    running,
    sandbox,
    select,
  };
};
