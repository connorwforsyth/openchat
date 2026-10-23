import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ApiClient } from "@workspace/client/api";
import { fixtureId } from "@workspace/contract/fixtures";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { createRunTestChat, draftTestTarget } from "./run-test-chat";

// The app's test chat (033): it answers with the agent's stored draft, so a
// message saves pending edits first, and the scratch conversation is
// created pinned to the draft (which is what makes it a test chat).

afterEach(() => {
  cleanup();
});

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const draft = {
  itemId: fixtureId("libraryItem", 1),
  versionId: fixtureId("libraryVersion", 1),
};

const definition: AgentDefinition = {
  approvals: { default: "auto", tools: {} },
  conversationStarters: ["Ahoy?"],
  instructions: "Answer like a pirate.",
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "test:agent",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
};

const fakeClient = () => {
  const order: string[] = [];
  const create = vi.fn(() => {
    order.push("create");
    return Promise.resolve({ id: fixtureId("conversation", 1) });
  });
  // The run itself isn't under test; refusing it keeps the stream offline.
  const runsCreate = vi.fn(() => Promise.reject(new Error("offline")));
  const client = {
    conversations: { create, delete: vi.fn(() => Promise.resolve()) },
    runs: { create: runsCreate, list: vi.fn() },
  } as unknown as Pick<ApiClient, "conversations" | "runs">;
  return { client, create, order, runsCreate };
};

const refuseToSave = () => Promise.resolve(false);

describe("run test chat", () => {
  it("targets the draft by its version id", () => {
    expect(draftTestTarget(draft)).toEqual({
      id: draft.itemId,
      type: "agent",
      versionId: draft.versionId,
    });
  });

  it("asks for the agent to be created first", async () => {
    const TestChat = createRunTestChat(fakeClient().client);
    render(
      <I18nProvider i18n={i18n}>
        <TestChat definition={definition} dirty={false} draft={null} />
      </I18nProvider>
    );
    expect(
      await screen.findByText("Create the agent to try it in a test chat.")
    ).toBeTruthy();
  });

  it("offers to save a new agent so it can be tested", async () => {
    const onCreate = vi.fn();
    const TestChat = createRunTestChat(fakeClient().client);
    render(
      <I18nProvider i18n={i18n}>
        <TestChat
          definition={definition}
          dirty
          draft={null}
          onCreate={onCreate}
        />
      </I18nProvider>
    );
    const chat = await screen.findByRole("region", { name: "Test chat" });
    await userEvent.click(
      within(chat).getByRole("button", { name: "Save draft and test" })
    );
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("saves edits, then opens a test chat pinned to the draft", async () => {
    const { client, create, order, runsCreate } = fakeClient();
    const beforeSend = vi.fn(() => {
      order.push("save");
      return Promise.resolve(true);
    });
    const TestChat = createRunTestChat(client);
    render(
      <I18nProvider i18n={i18n}>
        <TestChat
          beforeSend={beforeSend}
          definition={definition}
          dirty
          draft={draft}
        />
      </I18nProvider>
    );
    expect(await screen.findByText("Testing draft")).toBeTruthy();
    expect(
      screen.getByText(
        "Sending a message saves your changes to the draft first."
      )
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Ahoy?" }));
    await waitFor(() => expect(runsCreate).toHaveBeenCalled());
    expect(order).toEqual(["save", "create"]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ defaultTarget: draftTestTarget(draft) })
    );
    expect(runsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ target: draftTestTarget(draft) }),
      expect.anything()
    );
  });

  it("doesn't send when the edits couldn't be saved", async () => {
    const { client, create } = fakeClient();
    const TestChat = createRunTestChat(client);
    render(
      <I18nProvider i18n={i18n}>
        <TestChat
          beforeSend={refuseToSave}
          definition={definition}
          dirty
          draft={draft}
        />
      </I18nProvider>
    );
    await userEvent.click(await screen.findByRole("button", { name: "Ahoy?" }));
    expect(
      await screen.findByText(
        "Your changes couldn't be saved, so the message wasn't sent."
      )
    ).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });
});
