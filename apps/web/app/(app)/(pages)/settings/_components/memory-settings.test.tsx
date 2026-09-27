import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import type {
  MemoryDocument,
  MemoryVersion,
} from "@workspace/contract/schemas/memory";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import {
  apiError,
  fakeApi,
  renderWithApi,
} from "@/app/(app)/_shared/test-harness";
import { MemorySettings } from "./memory-settings";

const PAST_CAP = /isn't included in chats/;

afterEach(() => {
  cleanup();
});

const v1 = fixtureId("memoryVersion", 1);
const v2 = fixtureId("memoryVersion", 2);

const document = (extra: Partial<MemoryDocument> = {}): MemoryDocument => ({
  content: "- Prefers pnpm",
  maxChars: 40,
  mode: "auto",
  updatedAt: fixtureTime(1),
  versionId: v2,
  ...extra,
});

const versions: MemoryVersion[] = [
  {
    content: "- Prefers pnpm",
    createdAt: fixtureTime(2),
    id: v2,
    number: 2,
    source: {
      conversationId: fixtureId("conversation", 1),
      messageId: fixtureId("message", 1),
      runId: fixtureId("run", 1),
      type: "agent",
    },
  },
  {
    content: "",
    createdAt: fixtureTime(1),
    id: v1,
    number: 1,
    source: { type: "user" },
  },
];

describe("MemorySettings", () => {
  it("saves an edit against the version it started from", async () => {
    const api = fakeApi({
      "GET /memory": () => document(),
      "GET /memory/versions": () => ({ items: versions, nextCursor: null }),
      "PUT /memory": ({ body }) =>
        document({ content: (body as { content: string }).content }),
    });
    renderWithApi(<MemorySettings />, api);
    const editor = await screen.findByRole("textbox", { name: "Memory" });
    await userEvent.fill(editor, "- Prefers pnpm\n- Uses vim");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route === "PUT /memory")?.body
      ).toEqual({
        baseVersionId: v2,
        content: "- Prefers pnpm\n- Uses vim",
      })
    );
  });

  it("warns past the size cap", async () => {
    const api = fakeApi({
      "GET /memory": () => document(),
      "GET /memory/versions": () => ({ items: [], nextCursor: null }),
    });
    renderWithApi(<MemorySettings />, api);
    const editor = await screen.findByRole("textbox", { name: "Memory" });
    await userEvent.fill(editor, "x".repeat(41));
    expect(screen.getByText(PAST_CAP)).toBeTruthy();
  });

  it("explains a conflict instead of overwriting", async () => {
    const api = fakeApi({
      "GET /memory": () => document(),
      "GET /memory/versions": () => ({ items: versions, nextCursor: null }),
      "PUT /memory": () =>
        apiError("CONFLICT", 409, { reason: "version_mismatch" }),
    });
    renderWithApi(<MemorySettings />, api);
    await userEvent.fill(
      await screen.findByRole("textbox", { name: "Memory" }),
      "mine"
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("button", { name: "Load latest" })
    ).toBeTruthy();
  });

  it("restores an earlier version", async () => {
    const api = fakeApi({
      "GET /memory": () => document(),
      "GET /memory/versions": () => ({ items: versions, nextCursor: null }),
      "POST /memory/revert": () => document({ content: "", versionId: v1 }),
    });
    renderWithApi(<MemorySettings />, api);
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore version 1" })
    );
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route === "POST /memory/revert")?.body
      ).toEqual({ versionId: v1 })
    );
    expect(
      screen.getByText("Updated in a chat", { exact: false })
    ).toBeTruthy();
  });

  it("says when memory is switched off", async () => {
    const api = fakeApi({
      "GET /memory": () =>
        apiError("FEATURE_DISABLED", 403, { feature: "memory" }),
    });
    renderWithApi(<MemorySettings />, api);
    expect(
      await screen.findByText("This feature is switched off on this server.")
    ).toBeTruthy();
  });
});
