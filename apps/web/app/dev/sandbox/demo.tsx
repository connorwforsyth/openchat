"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceSelection } from "@workspace/chat-ui/model/workspace";
import { LazyWorkspacePanel } from "@workspace/chat-ui/workspace/lazy-workspace-panel";
import type {
  WorkspaceClient,
  WorkspaceFileRead,
} from "@workspace/chat-ui/workspace/model/client";
import type { SandboxId } from "@workspace/contract/schemas/common";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { createJustBashSandbox } from "@workspace/sandbox/just-bash/provider";
import type { Sandbox, SandboxError } from "@workspace/sandbox/ports/sandbox";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useEffect, useMemo, useState } from "react";

// The Workspace panel over a real just-bash sandbox in the browser standing
// in for the API: the tree, the editor (saves with etags, conflicts and
// all), new files, drops, deletes and reset. "Edit as the agent" changes
// README.md behind the editor's back, as a tool call would. The seeded files
// are sample content, not UI copy, so they stay out of the Lingui catalog.

const seed = {
  entries: [
    {
      content: btoa(
        "# Demo workspace\n\nEdit this file: it saves as you type. Try `/new-file` in a chat, or drop a file on the panel.\n"
      ),
      mode: 0o644,
      mtime: 0,
      path: "/work/README.md",
      type: "file" as const,
    },
    { mode: 0o755, path: "/work/src", type: "directory" as const },
    {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a bash parameter expansion, not a template.
      content: btoa('#!/usr/bin/env bash\necho "Hello, ${1:-world}!"\n'),
      mode: 0o755,
      mtime: 0,
      path: "/work/src/greet.sh",
      type: "file" as const,
    },
  ],
  version: 1 as const,
};

const limits = { cpu: 1, diskMb: 64, memoryMb: 256, network: false };

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

const etagOf = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;

/** A preview the demo pretends the agent recorded; nothing listens there. */
const DEMO_PREVIEW = { port: 5173, url: "https://preview.example.test/" };

/** A `WorkspaceClient` over a just-bash sandbox that lives in this tab. */
export const createDemoWorkspace = (
  describe: (error: SandboxError) => string
) => {
  let sandbox: Sandbox | null = null;
  const conversationId = newId("conversation");
  const id: SandboxId = newId("sandbox");

  const record = (): SandboxRecord => {
    const now = new Date().toISOString();
    return {
      conversationId,
      createdAt: now,
      id,
      isolation: "simulated",
      limits,
      previews: [DEMO_PREVIEW],
      provider: "just-bash",
      snapshotRef: null,
      status: { state: "ready" },
      updatedAt: now,
    };
  };

  const start = async () => {
    sandbox = await createJustBashSandbox({ id, initial: seed, limits });
    return sandbox;
  };
  const ready = async () => sandbox ?? (await start());

  const client: WorkspaceClient = {
    deleteFile: async (path) => {
      const box = await ready();
      const ran = await box.exec(`rm -- ${quote(path)}`);
      return ran.ok ? ok(undefined) : err(describe(ran.error));
    },
    importFile: async (file) => {
      const box = await ready();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const path = `/work/${file.name}`;
      const written = await box.writeFile(path, bytes);
      return written.ok
        ? ok({ etag: await etagOf(bytes), path, size: bytes.byteLength })
        : err(describe(written.error));
    },
    listFiles: async () => {
      const box = await ready();
      const listed = await box.listFiles(".", { recursive: true });
      return listed.ok ? listed : err(describe(listed.error));
    },
    readFile: async (_id, path) => {
      const box = await ready();
      const bytes = await box.readFile(path);
      if (!bytes.ok) {
        return err(describe(bytes.error));
      }
      const base = {
        etag: await etagOf(bytes.value),
        size: bytes.value.length,
      };
      try {
        const content = utf8.decode(bytes.value);
        return ok<WorkspaceFileRead>({ ...base, content, encoding: "utf8" });
      } catch {
        return ok<WorkspaceFileRead>({
          ...base,
          content: toBase64(bytes.value),
          encoding: "base64",
        });
      }
    },
    reset: async () => {
      await sandbox?.destroy();
      await start();
      return ok(record());
    },
    writeFile: async ({ content, ifMatch, path }) => {
      const box = await ready();
      const current = await box.readFile(path);
      if (ifMatch === null && current.ok) {
        return err({ kind: "already_exists" as const });
      }
      if (
        ifMatch &&
        !(current.ok && (await etagOf(current.value)) === ifMatch)
      ) {
        return err({ kind: "version_mismatch" as const });
      }
      const written = await box.writeFile(path, content);
      if (!written.ok) {
        return err({
          kind: "failed" as const,
          message: describe(written.error),
        });
      }
      const bytes = new TextEncoder().encode(content);
      return ok({ etag: await etagOf(bytes), path, size: bytes.byteLength });
    },
  };

  /** What an agent's `edit` would do: append a line to README.md. */
  const editAsAgent = async () => {
    const box = await ready();
    const current = await box.readFile("/work/README.md");
    const text = current.ok ? new TextDecoder().decode(current.value) : "";
    await box.writeFile(
      "/work/README.md",
      `${text}\nA line the agent added at ${new Date().toLocaleTimeString()}.\n`
    );
  };

  return { client, editAsAgent, record };
};

export function SandboxDemo() {
  const { t } = useLingui();
  const demo = useMemo(
    () =>
      createDemoWorkspace((error) => {
        switch (error.type) {
          case "not_found":
            return t`${error.path}: no such file or directory`;
          case "invalid_path":
            return t`${error.path} is outside the workspace`;
          case "destroyed":
            return t`The workspace was reset.`;
          case "unsupported":
            return t`This workspace can't do that.`;
          case "limit_exceeded":
            return t`The workspace hit a limit.`;
          case "unavailable":
            return t`The workspace is unavailable.`;
          default:
            return error satisfies never;
        }
      }),
    [t]
  );
  // Plays `sandbox.get`: the record the panel reads, refetched on change.
  const [record, setRecord] = useState<SandboxRecord | null>(null);
  useEffect(() => setRecord(demo.record()), [demo]);
  const onChanged = useCallback(() => setRecord(demo.record()), [demo]);
  const [selection, setSelection] = useState<WorkspaceSelection | null>({
    kind: "file",
    path: "README.md",
  });
  const [revision, setRevision] = useState(0);
  const onEditAsAgent = useCallback(() => {
    demo
      .editAsAgent()
      .then(() => setRevision((count) => count + 1))
      .catch(() => undefined);
  }, [demo]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button onClick={onEditAsAgent} size="sm" variant="outline">
          <Trans>Edit README.md as the agent</Trans>
        </Button>
      </div>
      <div className="h-[36rem] overflow-hidden rounded-lg border">
        <LazyWorkspacePanel
          artifacts={{ artifacts: [], versions: [] }}
          files={{
            client: demo.client,
            kind: "chat",
            onChanged,
            sandbox: record,
          }}
          onSelect={setSelection}
          revision={revision}
          selection={selection}
        />
      </div>
    </div>
  );
}
