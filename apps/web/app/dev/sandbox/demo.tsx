"use client";

import { useLingui } from "@lingui/react/macro";
import { LazySandboxPanel } from "@workspace/chat-ui/sandbox/lazy-sandbox-panel";
import type { SandboxPanelClient } from "@workspace/chat-ui/sandbox/model/client";
import type { SandboxId } from "@workspace/contract/schemas/common";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { createJustBashSandbox } from "@workspace/sandbox/just-bash/provider";
import type { Sandbox, SandboxError } from "@workspace/sandbox/ports/sandbox";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { useMemo } from "react";

// The panel with a real just-bash sandbox in the browser standing in for the
// API. The seeded files are sample content, not UI copy, so they stay out of
// the Lingui catalog.

const seed = {
  entries: [
    {
      content: btoa(
        "# Demo workspace\n\nTry `ls -R`, `cat src/greet.sh` or `bash src/greet.sh Ada`.\n"
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

const createDemoClient = (
  describe: (error: SandboxError) => string
): SandboxPanelClient => {
  let sandbox: Sandbox | null = null;
  const conversationId = newId("conversation");

  const record = (id: SandboxId): SandboxRecord => {
    const now = new Date().toISOString();
    return {
      conversationId,
      createdAt: now,
      id,
      isolation: "simulated",
      limits,
      previews: [],
      provider: "just-bash",
      snapshotRef: null,
      status: { state: "ready" },
      updatedAt: now,
    };
  };

  const start = async () => {
    const id = newId("sandbox");
    sandbox = await createJustBashSandbox({ id, initial: seed, limits });
    return ok(record(id));
  };

  const current = () =>
    sandbox ? ok(sandbox) : err(describe({ type: "destroyed" }));

  return {
    create: start,
    exec: async (_id, command, onOutput) => {
      const box = current();
      if (!box.ok) {
        return box;
      }
      const result = await box.value.exec(command, { onOutput });
      return result.ok ? result : err(describe(result.error));
    },
    exposePort: async (_id, port) => {
      const box = current();
      if (!box.ok) {
        return box;
      }
      const exposed = await box.value.exposePort(port);
      return exposed.ok ? exposed : err(describe(exposed.error));
    },
    listFiles: async () => {
      const box = current();
      if (!box.ok) {
        return box;
      }
      const listed = await box.value.listFiles(".", { recursive: true });
      return listed.ok ? listed : err(describe(listed.error));
    },
    readFile: async (_id, path) => {
      const box = current();
      if (!box.ok) {
        return box;
      }
      const read = await box.value.readFile(path);
      if (!read.ok) {
        return err(describe(read.error));
      }
      try {
        return ok({
          content: utf8.decode(read.value),
          encoding: "utf8" as const,
        });
      } catch {
        return ok({
          content: toBase64(read.value),
          encoding: "base64" as const,
        });
      }
    },
    reset: async () => {
      await sandbox?.destroy();
      return start();
    },
  };
};

export function SandboxDemo() {
  const { t } = useLingui();
  const client = useMemo(
    () =>
      createDemoClient((error) => {
        switch (error.type) {
          case "not_found":
            return t`${error.path}: no such file or directory`;
          case "invalid_path":
            return t`${error.path} is outside the sandbox`;
          case "destroyed":
            return t`The sandbox was destroyed. Create a new one.`;
          case "unsupported":
            return t`This sandbox can't do that.`;
          case "limit_exceeded":
            return t`The sandbox hit a limit.`;
          case "unavailable":
            return t`The sandbox is unavailable.`;
          default:
            return error satisfies never;
        }
      }),
    [t]
  );

  return (
    <div className="h-[36rem] overflow-hidden rounded-lg border">
      <LazySandboxPanel client={client} initial={null} />
    </div>
  );
}
