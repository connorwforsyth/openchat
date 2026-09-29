import { err, ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import type { WorkspaceRead } from "./sandbox";
import {
  INLINE_MAX_BYTES,
  resolveWorkspaceFiles,
  workspaceContext,
} from "./workspace-context";

// `@file` mentions as the model sees them: small text files inline, the rest
// as notes that point at `read`. The workspace is a map of files.

const encoder = new TextEncoder();
const PREAMBLE = /^The user's latest message mentions/;

const workspace =
  (files: Record<string, Uint8Array | string>): WorkspaceRead =>
  (path) => {
    const file = files[path];
    if (file === undefined) {
      return Promise.resolve(err({ type: "not_found" }));
    }
    return Promise.resolve(
      ok(typeof file === "string" ? encoder.encode(file) : file)
    );
  };

describe("resolveWorkspaceFiles", () => {
  it("inlines a small text file as it is now", async () => {
    const [block] = await resolveWorkspaceFiles(
      [{ path: "src/app.ts" }],
      workspace({ "src/app.ts": "export const answer = 42;" })
    );
    expect(block).toBe(
      '<workspace-file path="src/app.ts">\nexport const answer = 42;\n</workspace-file>'
    );
  });

  it("inlines up to 32 KB, and points the model at `read` past that", async () => {
    const [fits, tooBig] = await resolveWorkspaceFiles(
      [{ path: "fits.txt" }, { path: "big.txt" }],
      workspace({
        "big.txt": "x".repeat(INLINE_MAX_BYTES + 1),
        "fits.txt": "y".repeat(INLINE_MAX_BYTES),
      })
    );
    expect(fits).toContain("y".repeat(INLINE_MAX_BYTES));
    expect(tooBig).toBe(
      `<workspace-file path="big.txt" omitted="true">The file is ${INLINE_MAX_BYTES + 1} bytes, too large to include here. Use the read tool to read it, a range of lines at a time.</workspace-file>`
    );
  });

  it("stops inlining once a message's files add up past the budget", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        `f${i}.txt`,
        "z".repeat(INLINE_MAX_BYTES),
      ])
    );
    const blocks = await resolveWorkspaceFiles(
      Object.keys(files).map((path) => ({ path })),
      workspace(files)
    );
    expect(blocks.map((block) => block.includes('omitted="true"'))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(blocks[4]).toContain("Use the read tool");
  });

  it("notes missing, binary and unreadable files instead of failing", async () => {
    const blocks = await resolveWorkspaceFiles(
      [{ path: "gone.txt" }, { path: "logo.png" }, { path: 'odd"name' }],
      (path) => {
        if (path === "logo.png") {
          return Promise.resolve(ok(new Uint8Array([0x89, 0x50, 0xff, 0xfe])));
        }
        return Promise.resolve(
          path === "gone.txt"
            ? err({ type: "not_found" as const })
            : err({ message: "host down", type: "unavailable" as const })
        );
      }
    );
    expect(blocks).toEqual([
      '<workspace-file path="gone.txt" omitted="true">No such file in the workspace.</workspace-file>',
      '<workspace-file path="logo.png" omitted="true">The file isn\'t UTF-8 text, so it isn\'t shown. Inspect it with bash if you need to.</workspace-file>',
      '<workspace-file path="odd&quot;name" omitted="true">The workspace couldn\'t be read: host down</workspace-file>',
    ]);
  });

  it("says so when the turn has no workspace", async () => {
    expect(await resolveWorkspaceFiles([{ path: "a.txt" }], undefined)).toEqual(
      [
        '<workspace-file path="a.txt" omitted="true">The workspace is off for this message.</workspace-file>',
      ]
    );
  });
});

describe("workspaceContext", () => {
  it("is nothing without mentions, and a preamble plus the files with them", async () => {
    expect(await workspaceContext([], workspace({}))).toBeUndefined();
    const context = await workspaceContext(
      [{ path: "a.txt" }],
      workspace({ "a.txt": "hello" })
    );
    expect(context).toMatch(PREAMBLE);
    expect(context).toContain(
      '<workspace-file path="a.txt">\nhello\n</workspace-file>'
    );
  });
});
