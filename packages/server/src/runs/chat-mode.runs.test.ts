import type { LanguageModelV4StreamResult } from "@ai-sdk/provider";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Message } from "@workspace/contract/schemas/messages";
import type {
  ChatMode,
  CreateRunOutput,
  Run,
  RunOptions,
} from "@workspace/contract/schemas/runs";
import { getMessage } from "@workspace/db/queries/messages";
import { type Tool, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createHarness, type Harness } from "../testing/harness";
import { chatModeUnavailable } from "./chat-mode";

// Chat and Code modes through real runs: a Chat run is never offered a tool
// that runs code, and a call to one comes back as a tool error; the run
// records the conversation's mode (never the client's), and so do its
// messages; switching applies from the next message.

let h: Harness | undefined;
afterEach(() => h?.close());

const json = async <T>(response: Response, status = 200): Promise<T> => {
  if (response.status !== status) {
    throw new Error(
      `expected ${status}, got ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
};

const newChat = async (
  harness: Harness,
  body: { readonly mode?: ChatMode } = {}
): Promise<Conversation> =>
  json<Conversation>(
    await harness.request("/api/conversations", { json: body, method: "POST" }),
    201
  );

const setMode = (harness: Harness, id: ConversationId, mode: ChatMode) =>
  harness.request(`/api/conversations/${id}`, {
    json: { mode },
    method: "PATCH",
  });

const send = async (
  harness: Harness,
  conversationId: ConversationId,
  options?: Partial<RunOptions>
): Promise<Run> => {
  const created = await json<CreateRunOutput>(
    await harness.request("/api/runs", {
      json: {
        conversationId,
        input: {
          parentId: null,
          parts: [{ text: "Make a Vite app", type: "text" }],
          type: "message",
        },
        ...(options ? { options } : {}),
        target: { model: "test:chat", type: "model" },
      },
      method: "POST",
    }),
    202
  );
  await harness.services.executor.idle();
  return json<Run>(await harness.request(`/api/runs/${created.runId}`));
};

const spyTool = () => {
  const execute = vi.fn(async () => ({ status: "ran" }));
  return {
    execute,
    tool: tool({
      description: "test",
      execute,
      inputSchema: z.looseObject({}),
    }) as Tool,
  };
};

/** A model that plays `steps` in order, then answers "done". */
const scripted = (steps: readonly (() => LanguageModelV4StreamResult)[]) => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const step = steps[calls];
      calls += 1;
      return Promise.resolve(step ? step() : textStream("done"));
    },
  });
};

const offered = (model: MockLanguageModelV4, call = 0): string[] =>
  (model.doStreamCalls[call]?.tools ?? []).map((each) => each.name).sort();

/** The next turn offers every sandbox tool and an artifact tool. */
const offerSandbox = (harness: Harness, model: MockLanguageModelV4) => {
  const spies = {
    bash: spyTool(),
    create_artifact: spyTool(),
    edit: spyTool(),
    preview: spyTool(),
    read: spyTool(),
    write: spyTool(),
  };
  harness.nextTurn({
    model,
    toolApproval: Object.fromEntries(
      Object.keys(spies).map((name) => [name, "not-applicable" as const])
    ),
    tools: Object.fromEntries(
      Object.entries(spies).map(([name, spy]) => [name, spy.tool])
    ),
  });
  return spies;
};

const modesOf = async (harness: Harness, run: Run) => {
  const user = await getMessage(harness.db, run.userMessageId);
  const answer = await getMessage(
    harness.db,
    run.assistantMessageId as MessageId
  );
  return [
    user.ok ? user.value.mode : undefined,
    answer.ok ? answer.value.mode : undefined,
  ];
};

describe("Chat and Code modes", () => {
  it("start a new chat in Chat, which runs no code and says why", async () => {
    h = await createHarness();
    const chat = await newChat(h);
    expect(chat.mode).toBe("chat");
    const model = scripted([
      () => toolCallStream("bash", { command: "npm create vite@latest" }, "b1"),
    ]);
    const spies = offerSandbox(h, model);

    const run = await send(h, chat.id);

    expect(run.state.status).toBe("succeeded");
    expect(run.options?.chatMode).toBe("chat");
    for (let call = 0; call < model.doStreamCalls.length; call += 1) {
      const names = offered(model, call);
      expect(names).toEqual(
        expect.arrayContaining(["create_artifact", "edit", "read", "write"])
      );
      expect(names).not.toContain("bash");
      expect(names).not.toContain("preview");
    }
    expect(spies.bash.execute).not.toHaveBeenCalled();
    const answer = await getMessage(h.db, run.assistantMessageId as MessageId);
    const result = (answer.ok ? answer.value.parts : []).find(
      (part) => part.type === "tool-result" && part.toolCallId === "b1"
    );
    expect(JSON.stringify(result)).toContain(
      JSON.stringify(chatModeUnavailable("bash")).slice(1, -1)
    );
    expect(await modesOf(h, run)).toEqual(["chat", "chat"]);
  });

  it("give a Code chat the sandbox", async () => {
    h = await createHarness();
    const chat = await newChat(h, { mode: "code" });
    const model = scripted([
      () => toolCallStream("bash", { command: "npm install" }, "b1"),
    ]);
    const spies = offerSandbox(h, model);

    const run = await send(h, chat.id);

    expect(offered(model)).toEqual(
      expect.arrayContaining(["bash", "edit", "preview", "read", "write"])
    );
    expect(spies.bash.execute).toHaveBeenCalledOnce();
    expect(run.options?.chatMode).toBe("code");
    expect(await modesOf(h, run)).toEqual(["code", "code"]);
  });

  it("take the conversation's mode, not the client's, from the next message", async () => {
    h = await createHarness();
    const chat = await newChat(h);
    offerSandbox(h, scripted([]));
    const first = await send(h, chat.id, { chatMode: "code" });
    expect(first.options?.chatMode).toBe("chat");

    const switched = await json<Conversation>(
      await setMode(h, chat.id, "code")
    );
    expect(switched.mode).toBe("code");
    const model = scripted([]);
    offerSandbox(h, model);
    const second = await send(h, chat.id);
    expect(second.options?.chatMode).toBe("code");
    expect(offered(model)).toContain("bash");

    // The first answer still shows the mode it ran in.
    const firstAnswer = await json<Message>(
      await h.request(`/api/messages/${first.assistantMessageId}`)
    );
    expect(firstAnswer.mode).toBe("chat");
  });
});
