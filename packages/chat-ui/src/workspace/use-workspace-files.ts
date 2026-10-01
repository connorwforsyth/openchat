"use client";

import { useLingui } from "@lingui/react/macro";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import { err } from "@workspace/shared/result";
import { useCallback, useEffect, useRef, useState } from "react";

import { workspacePath } from "../model/workspace";
import type { SandboxPreview } from "./model/browser";
import type { WorkspaceClient, WorkspaceFilesSource } from "./model/client";
import type { OpenFile } from "./model/editor";
import type { ReadStaticFile } from "./model/static-page";
import { toSandboxPath } from "./model/tree";
import { useOpenFile } from "./use-open-file";
import { useWorkspaceTree } from "./use-workspace-tree";

// Everything the panel shows and does with the chat's files, over the
// `WorkspaceClient` port and the `sandbox.get` record it's given. Every
// action ends by asking the host to refetch that record (`onChanged`), so
// the header, the panel and the chat never disagree about the workspace.

export type FilesStatus =
  /** Sandboxes are off on this instance. */
  | { readonly kind: "off" }
  /** The chat doesn't exist yet; its first message creates it. */
  | { readonly kind: "new-chat" }
  | { readonly kind: "starting" }
  | { readonly kind: "failed"; readonly message: string }
  /** Usable, including before its first use creates it. */
  | { readonly kind: "ready" };

export interface FilesActions {
  /** Creates an empty file; resolves to an error message or `null`. */
  readonly create: (path: string) => Promise<string | null>;
  readonly deleteOpen: () => void;
  readonly edit: (text: string) => void;
  readonly importFiles: (files: readonly File[]) => void;
  readonly overwrite: () => void;
  readonly refresh: () => void;
  readonly reload: () => void;
  /** Empties the workspace; `undefined` when there's none yet. */
  readonly reset: (() => void) | undefined;
  readonly save: () => void;
  /**
   * "Save as site" (125): resolves to what fails the site checks, or `null`
   * once saved; `undefined` where the host can't save artifacts.
   */
  readonly saveAsSite:
    | ((path: string, title: string) => Promise<readonly string[] | null>)
    | undefined;
}

export interface FilesView {
  readonly actions: FilesActions | null;
  /** The last import or delete that failed. */
  readonly notice: string | null;
  readonly open: OpenFile | null;
  /** `null` until listed. */
  readonly paths: readonly string[] | null;
  /** Ports the agent (or the static-files server, 067) exposed. */
  readonly previews: readonly SandboxPreview[];
  /** `null` before the workspace exists. */
  readonly provider: SandboxProvider | null;
  /** Reads a file by its workspace path, for the browser's static renders. */
  readonly readFile: ReadStaticFile | null;
  readonly status: FilesStatus;
}

const NO_PREVIEWS: readonly SandboxPreview[] = [];

export const staticFiles = (kind: "off" | "new-chat"): FilesView => ({
  actions: null,
  notice: null,
  open: null,
  paths: [],
  previews: [],
  provider: null,
  readFile: null,
  status: { kind },
});

export interface UseWorkspaceFilesOptions {
  readonly files: Extract<WorkspaceFilesSource, { kind: "chat" }>;
  /** Selects a file (a workspace path) or nothing. */
  readonly onSelectFile: (path: string | null) => void;
  readonly revision: number;
  /** The file the main area shows, if any. */
  readonly selectedPath: string | null;
}

const importAll = async (
  client: WorkspaceClient,
  files: readonly File[]
): Promise<{
  readonly failed: string | null;
  readonly last: string | null;
}> => {
  let last: string | null = null;
  let failed: string | null = null;
  for (const file of files) {
    // One at a time, so names that collide get distinct free names.
    // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose.
    const imported = await client.importFile(file);
    if (imported.ok) {
      last = workspacePath(imported.value.path);
    } else {
      failed = imported.error;
    }
  }
  return { failed, last };
};

export const useWorkspaceFiles = ({
  files,
  onSelectFile,
  revision,
  selectedPath,
}: UseWorkspaceFilesOptions): FilesView => {
  const { t } = useLingui();
  const { client, onChanged, sandbox } = files;
  const tree = useWorkspaceTree(client, sandbox, revision);
  const opened = useOpenFile({
    client,
    onChanged,
    path: selectedPath,
    revision,
    sandboxId: sandbox?.id ?? null,
  });
  const [notice, setNotice] = useState<string | null>(null);

  // The agent's tools moved the revision: the record may have changed too
  // (created, a preview recorded). The tree and the open file reload
  // themselves.
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current !== revision) {
      seen.current = revision;
      onChanged();
    }
  }, [onChanged, revision]);

  const { refresh } = tree;
  const changed = useCallback(() => {
    refresh();
    onChanged();
  }, [onChanged, refresh]);

  const alreadyExists = t`A file with that name already exists.`;
  const create = useCallback(
    async (path: string) => {
      const written = await client.writeFile({
        content: "",
        ifMatch: null,
        path: toSandboxPath(path),
      });
      if (!written.ok) {
        return written.error.kind === "failed"
          ? written.error.message
          : alreadyExists;
      }
      changed();
      onSelectFile(path);
      return null;
    },
    [alreadyExists, changed, client, onSelectFile]
  );

  const deleteOpen = useCallback(async () => {
    if (!selectedPath) {
      return;
    }
    const deleted = await client.deleteFile(toSandboxPath(selectedPath));
    if (deleted.ok) {
      setNotice(null);
      onSelectFile(null);
    } else {
      setNotice(deleted.error);
    }
    changed();
  }, [changed, client, onSelectFile, selectedPath]);

  const importFiles = useCallback(
    async (dropped: readonly File[]) => {
      if (dropped.length === 0) {
        return;
      }
      setNotice(null);
      const { failed, last } = await importAll(client, dropped);
      setNotice(failed);
      changed();
      if (last) {
        onSelectFile(last);
      }
    },
    [changed, client, onSelectFile]
  );

  const id = sandbox?.id;
  const readFile = useCallback<ReadStaticFile>(
    (path) =>
      id
        ? client.readFile(id, toSandboxPath(path))
        : Promise.resolve(err(path)),
    [client, id]
  );
  const reset = useCallback(async () => {
    if (!id) {
      return;
    }
    const fresh = await client.reset(id);
    setNotice(fresh.ok ? null : fresh.error);
    onSelectFile(null);
    changed();
  }, [changed, client, id, onSelectFile]);

  const saveSite = client.saveAsSite;
  const saveAsSite = useCallback(
    async (path: string, title: string) => {
      if (!saveSite) {
        return null;
      }
      const saved = await saveSite({ path, title });
      if (saved.ok) {
        changed();
        return null;
      }
      return saved.error;
    },
    [changed, saveSite]
  );

  const status = ((): FilesStatus => {
    switch (sandbox?.status.state) {
      case "provisioning":
        return { kind: "starting" };
      case "failed":
        return { kind: "failed", message: sandbox.status.message };
      default:
        return { kind: "ready" };
    }
  })();

  const swallow = (promise: Promise<unknown>) => {
    promise.catch(() => undefined);
  };

  return {
    actions: {
      create,
      deleteOpen: () => swallow(deleteOpen()),
      edit: opened.edit,
      importFiles: (dropped) => swallow(importFiles(dropped)),
      overwrite: opened.overwrite,
      refresh: changed,
      reload: opened.reload,
      reset: id ? () => swallow(reset()) : undefined,
      save: opened.save,
      saveAsSite: saveSite ? saveAsSite : undefined,
    },
    notice: notice ?? tree.error,
    open: opened.file,
    paths: tree.paths,
    previews: sandbox?.previews ?? NO_PREVIEWS,
    provider: sandbox?.provider ?? null,
    readFile: id ? readFile : null,
    status,
  };
};
