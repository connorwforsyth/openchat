import { act, cleanup, renderHook } from "@testing-library/react";
import { fixtureId, sandbox } from "@workspace/contract/fixtures";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { ok } from "@workspace/shared/result";
import { afterEach, describe, expect, it } from "vitest";

import type { SandboxPanelClient } from "./model/client";
import { useSandboxPanel } from "./use-sandbox-panel";

const unused = () => {
  throw new Error("not called in these tests");
};

const clientCreating = (created: SandboxRecord): SandboxPanelClient => ({
  create: () => Promise.resolve(ok(created)),
  exec: unused,
  exposePort: unused,
  listFiles: unused,
  readFile: unused,
  reset: unused,
});

const withoutPreviews: SandboxRecord = { ...sandbox, previews: [] };

afterEach(cleanup);

describe("useSandboxPanel", () => {
  // A panel restored open on reload mounts before the chat's sandbox query
  // answers (ticket 046: it said "no sandbox yet" for a chat that had one).
  it("adopts the chat's sandbox when it arrives after mounting", () => {
    const { result, rerender } = renderHook(
      ({ initial }) => useSandboxPanel(clientCreating(sandbox), initial),
      { initialProps: { initial: null as SandboxRecord | null } }
    );
    expect(result.current.sandbox).toBeNull();

    rerender({ initial: sandbox });
    expect(result.current.sandbox).toEqual(sandbox);
    expect(result.current.preview).toEqual(sandbox.previews[0]);
  });

  it("picks up a preview the agent exposed on the same sandbox", () => {
    const { result, rerender } = renderHook(
      ({ initial }) => useSandboxPanel(clientCreating(sandbox), initial),
      { initialProps: { initial: withoutPreviews } }
    );
    expect(result.current.preview).toBeNull();

    rerender({ initial: sandbox });
    expect(result.current.preview).toEqual(sandbox.previews[0]);
  });

  it("keeps a sandbox it created over a different one arriving later", async () => {
    const other: SandboxRecord = { ...sandbox, id: fixtureId("sandbox", 2) };
    const { result, rerender } = renderHook(
      ({ initial }) => useSandboxPanel(clientCreating(sandbox), initial),
      { initialProps: { initial: null as SandboxRecord | null } }
    );
    await act(() => result.current.create());
    expect(result.current.sandbox).toEqual(sandbox);

    rerender({ initial: other });
    expect(result.current.sandbox?.id).toBe(sandbox.id);
  });
});
