import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { AgentOption } from "@workspace/composer/schemas";
import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { ModelOption } from "@workspace/contract/schemas/models";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import { ConversationView } from "./conversation-view";
import { namedModel } from "./switch-marker";

vi.mock("./lazy", () => import("../testing/sync-lazy"));

const helper = fixtureId("libraryItem", 1);

const models: readonly ModelOption[] = [
  {
    available: true,
    capabilities: [],
    contextWindow: null,
    displayName: "Claude Opus 5",
    label: "anthropic:claude-opus-5",
    provider: "anthropic",
    selector: "anthropic:claude-opus-5",
    target: "anthropic:claude-opus-5",
  },
  {
    available: true,
    capabilities: [],
    contextWindow: null,
    displayName: "GPT-5",
    label: "fast",
    provider: "openai",
    selector: "fast",
    target: "openai:gpt-5",
  },
];

const agents: readonly AgentOption[] = [
  {
    description: "Helps with releases",
    icon: null,
    id: helper,
    name: "Release helper",
  },
];

let n = 0;
const message = (
  role: Message["role"],
  parentId: MessageId | null,
  who: { agent?: typeof helper; model?: string } = {}
): Message => {
  n += 1;
  return {
    agent: who.agent
      ? { id: who.agent, versionId: fixtureId("libraryVersion", 1) }
      : null,
    authorId: null,
    conversationId: fixtureId("conversation", 1),
    createdAt: fixtureTime(n),
    id: fixtureId("message", 500 + n),
    model:
      role === "assistant" ? (who.model ?? "anthropic:claude-opus-5") : null,
    parentId,
    parts: [{ text: `${role} ${n}`, type: "text" }],
    partsVersion: 1,
    role,
    runId: null,
    status: "complete",
    usage: null,
  };
};

const render = (messages: readonly Message[]) =>
  renderWithI18n(<View messages={messages} />);

function View({ messages }: { readonly messages: readonly Message[] }) {
  return (
    <div style={{ height: 800 }}>
      <ConversationView
        actions={{}}
        agents={agents}
        conversationKey="c"
        messages={messages}
        models={models}
        siblings={[]}
      />
    </div>
  );
}

const markers = () => screen.queryAllByRole("separator");

afterEach(() => {
  cleanup();
});

describe("switch markers", () => {
  it("shows one marker, before the answer whose model changed", () => {
    const u1 = message("user", null);
    const a1 = message("assistant", u1.id);
    const u2 = message("user", a1.id);
    const a2 = message("assistant", u2.id, { model: "openai:gpt-5" });
    const u3 = message("user", a2.id);
    const a3 = message("assistant", u3.id, { model: "openai:gpt-5" });
    render([u1, a1, u2, a2, u3, a3]);

    const [marker, ...rest] = markers();
    expect(rest).toHaveLength(0);
    expect(marker?.getAttribute("aria-label")).toBe("Switched to GPT-5");
    expect(marker?.textContent).toBe("GPT-5");
    // It leads the answer it introduces, outside the message itself.
    const item = marker?.closest('[data-slot="message-scroller-item"]');
    expect(item?.firstElementChild).toBe(marker);
    expect(item?.getAttribute("data-message-id")).toBe(a2.id);
    expect(item?.querySelector(".is-assistant")).toBeTruthy();
    expect(marker?.closest(".is-assistant, .is-user")).toBeNull();
    // Selecting the conversation to copy it leaves the marker out (the
    // e2e test checks the computed style; no Tailwind here).
    expect(marker?.classList.contains("select-none")).toBe(true);
  });

  it("names the agent, with the new model muted after it", () => {
    const u1 = message("user", null);
    const a1 = message("assistant", u1.id);
    const u2 = message("user", a1.id);
    const a2 = message("assistant", u2.id, {
      agent: helper,
      model: "openai:gpt-5",
    });
    render([u1, a1, u2, a2]);
    const marker = screen.getByRole("separator", {
      name: "Switched to Release helper with GPT-5",
    });
    expect(within(marker).getByText("Release helper")).toBeTruthy();
    expect(within(marker).getByText("GPT-5")).toBeTruthy();
  });

  it("says an agent that's gone was removed", () => {
    const u1 = message("user", null);
    const a1 = message("assistant", u1.id);
    const u2 = message("user", a1.id);
    const a2 = message("assistant", u2.id, {
      agent: fixtureId("libraryItem", 99),
    });
    render([u1, a1, u2, a2]);
    expect(
      screen.getByRole("separator", { name: "Switched to Removed agent" })
    ).toBeTruthy();
  });

  it("follows the branch being shown", async () => {
    const u1 = message("user", null);
    const a1 = message("assistant", u1.id);
    const u2 = message("user", a1.id);
    // Two answers to the same question: the second regenerated on GPT-5.
    const same = message("assistant", u2.id);
    const switched = message("assistant", u2.id, { model: "openai:gpt-5" });
    const answers = [same, switched];

    function Branches() {
      const [shown, setShown] = useState<MessageId>(same.id);
      const answer = answers.find((each) => each.id === shown) ?? same;
      return (
        <div style={{ height: 800 }}>
          <ConversationView
            actions={{ onSelectBranch: setShown }}
            agents={agents}
            conversationKey="c"
            messages={[u1, a1, u2, answer]}
            models={models}
            siblings={[
              {
                index: answers.indexOf(answer),
                messageId: answer.id,
                siblingIds: answers.map((each) => each.id),
              },
            ]}
          />
        </div>
      );
    }
    renderWithI18n(<Branches />);
    expect(markers()).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Next branch" }));
    expect(
      await screen.findByRole("separator", { name: "Switched to GPT-5" })
    ).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Previous branch" })
    );
    await waitFor(() => expect(markers()).toHaveLength(0));
  });
});

describe("namedModel", () => {
  it("uses the model list's display name, through an alias too", () => {
    expect(namedModel("anthropic:claude-opus-5", models)).toEqual({
      name: "Claude Opus 5",
      vendor: "anthropic",
    });
    expect(namedModel("openai:gpt-5", models)).toEqual({
      name: "GPT-5",
      vendor: "openai",
    });
  });

  it("tidies a ref the list doesn't offer", () => {
    expect(
      namedModel("gateway:anthropic/claude-haiku-4-5-20251001", models)
    ).toEqual({ name: "Claude Haiku 4.5", vendor: "anthropic" });
  });
});
