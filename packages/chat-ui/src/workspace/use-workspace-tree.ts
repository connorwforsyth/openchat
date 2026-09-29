"use client";

import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceClient } from "./model/client";
import { toTreePaths } from "./model/tree";

// The workspace's file listing for the tree. The workspace itself is never
// copied here: it's the `sandbox.get` record the panel is given, and the
// listing reloads when that record changes (created, restarted, reset) and
// when the agent's tool results move `revision`.

export interface WorkspaceTree {
  readonly error: string | null;
  readonly loading: boolean;
  /** `null` until the first listing answers. */
  readonly paths: readonly string[] | null;
  readonly refresh: () => void;
}

/** A workspace whose files can be listed right now. */
const listable = (sandbox: SandboxRecord | null): sandbox is SandboxRecord =>
  sandbox?.status.state === "ready" || sandbox?.status.state === "stopped";

export const useWorkspaceTree = (
  client: WorkspaceClient,
  sandbox: SandboxRecord | null,
  revision: number
): WorkspaceTree => {
  const [paths, setPaths] = useState<readonly string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the newest listing lands.
  const request = useRef(0);
  const id = listable(sandbox) ? sandbox.id : null;
  // A reset or a restart keeps the id but changes the record.
  const version = sandbox ? `${sandbox.status.state}:${sandbox.updatedAt}` : "";

  const refresh = useCallback(async () => {
    const mine = request.current + 1;
    request.current = mine;
    if (!id) {
      setPaths([]);
      setError(null);
      return;
    }
    setLoading(true);
    const listed = await client.listFiles(id);
    if (request.current !== mine) {
      return;
    }
    setLoading(false);
    if (listed.ok) {
      setPaths(toTreePaths(listed.value));
      setError(null);
    } else {
      setError(listed.error);
    }
  }, [client, id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` and `revision` are the reasons to list again, not inputs to it.
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh, revision, version]);

  const reload = useCallback(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  return { error, loading, paths, refresh: reload };
};
