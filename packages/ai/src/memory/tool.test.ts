import { newId } from "@workspace/shared/ids";
import { err } from "@workspace/shared/result";
import type { UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { runAgent } from "../agent/run-agent";
import { readAll, textStream, toolCallStream } from "../testing/mock-models";
import { UPDATE_MEMORY_TOOL } from "./prompt";
import type { MemoryStore } from "./store";
import { createMemoryStore } from "./store.memory";
import { createUpdateMemoryTool, updateMemory } from "./tool";
import { withMemory } from "./turn";

const userId = newId("user");
const origin = {
  conversationId: newId("conversation"),
  messageId: newId("message"),
  runId: newId("run"),
};

const remember = {
  patches: [{ op: "append" as const, text: "- Prefers pnpm" }],
  summary: "Prefers pnpm",
};

describe("updateMemory", () => {
  it("applies patches as a new version and says what undo goes back to", async () => {
    const store = createMemoryStore();
    const first = await updateMemory(
      { maxChars: 1000, origin, store, userId },
      remember
    );
    expect(first).toMatchObject({
      number: 1,
      previousVersionId: null,
      status: "applied",
      summary: "Prefers pnpm",
    });
    const second = await updateMemory(
      { maxChars: 1000, origin, store, userId },
      {
        patches: [{ find: "pnpm", op: "replace", replace: "bun" }],
        summary: "Prefers bun",
      }
    );
    expect(second).toMatchObject({ number: 2, status: "applied" });
    expect(second.status === "applied" && second.previousVersionId).toBe(
      first.status === "applied" ? first.versionId : "unreachable"
    );
    expect((await store.read(userId)).content).toBe("- Prefers bun\n");
    expect(store.versions(userId).map((v) => v.source)).toEqual([
      { ...origin, type: "agent" },
      { ...origin, type: "agent" },
    ]);
  });

  it("rejects a patch that doesn't match, without writing", async () => {
    const store = createMemoryStore();
    const result = await updateMemory(
      { maxChars: 1000, origin, store, userId },
      { patches: [{ find: "yarn", op: "delete" }], summary: "Forget yarn" }
    );
    expect(result).toMatchObject({ reason: "not_found", status: "rejected" });
    expect(store.versions(userId)).toEqual([]);
  });

  it("won't grow the file past the cap, but lets it shrink", async () => {
    const store = createMemoryStore();
    await store.write({
      baseVersionId: null,
      content: `${"a".repeat(15)}${"b".repeat(15)}`,
      source: { type: "user" },
      userId,
    });
    const deps = { maxChars: 20, origin, store, userId };
    expect(await updateMemory(deps, remember)).toMatchObject({
      reason: "too_large",
      status: "rejected",
    });
    expect(
      await updateMemory(deps, {
        patches: [{ find: "b".repeat(15), op: "delete" }],
        summary: "Trimmed",
      })
    ).toMatchObject({ status: "applied" });
  });

  it("retries on a fresh read when another edit lands first", async () => {
    const inner = createMemoryStore();
    let raced = false;
    const store: MemoryStore = {
      read: inner.read,
      write: async (input) => {
        if (!raced) {
          raced = true;
          await inner.write({
            baseVersionId: null,
            content: "- Lives in Lisbon\n",
            source: { type: "user" },
            userId,
          });
          return err({ type: "version_mismatch" });
        }
        return inner.write(input);
      },
    };
    const result = await updateMemory(
      { maxChars: 1000, origin, store, userId },
      remember
    );
    expect(result).toMatchObject({ number: 2, status: "applied" });
    expect((await inner.read(userId)).content).toBe(
      "- Lives in Lisbon\n- Prefers pnpm\n"
    );
  });

  it("gives up after repeated conflicts", async () => {
    const store: MemoryStore = {
      read: () =>
        Promise.resolve({ content: "", mode: "auto", versionId: null }),
      write: () => Promise.resolve(err({ type: "version_mismatch" })),
    };
    expect(
      await updateMemory({ maxChars: 1000, origin, store, userId }, remember)
    ).toMatchObject({ reason: "busy", status: "rejected" });
  });
});

const user = (text: string): UIMessage => ({
  id: "u1",
  parts: [{ text, type: "text" }],
  role: "user",
});

describe("update_memory through runAgent", () => {
  const turnWith = async (mode: "auto" | "propose") => {
    const store = createMemoryStore();
    store.setMode(userId, mode);
    const snapshot = await store.read(userId);
    const turn = withMemory(
      { instructions: "Be brief." },
      {
        maxChars: 1000,
        snapshot,
        tool: createUpdateMemoryTool({ maxChars: 1000, origin, store, userId }),
      }
    );
    const model = new MockLanguageModelV4({
      doStream: [
        toolCallStream(UPDATE_MEMORY_TOOL, remember),
        textStream("I'll remember that you prefer pnpm."),
      ],
    });
    const run = await runAgent({
      instructions: turn.instructions,
      messages: [user("remember I prefer pnpm")],
      model,
      toolApproval: turn.toolApproval,
      tools: turn.tools,
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    await readAll(run.value.stream);
    return { model, outcome: await run.value.outcome, store };
  };

  it("auto mode: applies the edit and the model hears it worked", async () => {
    const { model, outcome, store } = await turnWith("auto");
    expect(outcome.status).toBe("succeeded");
    expect((await store.read(userId)).content).toBe("- Prefers pnpm\n");
    expect(model.doStreamCalls[0]?.prompt[0]).toMatchObject({
      content: expect.stringContaining("Be brief.\n\n## Memory"),
      role: "system",
    });
    expect(outcome.message.parts).toContainEqual(
      expect.objectContaining({
        output: expect.objectContaining({
          status: "applied",
          summary: "Prefers pnpm",
        }),
        state: "output-available",
        type: `tool-${UPDATE_MEMORY_TOOL}`,
      })
    );
  });

  it("propose mode: stops for the user's approval without writing", async () => {
    const { outcome, store } = await turnWith("propose");
    expect(outcome).toMatchObject({
      approvals: [{ input: remember, toolName: UPDATE_MEMORY_TOOL }],
      status: "awaiting_approval",
    });
    expect(store.versions(userId)).toEqual([]);
  });
});
