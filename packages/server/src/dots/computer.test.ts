import type { RunStart } from "@workspace/ai/ports/run-executor";
import { fixtureId } from "@workspace/contract/fixtures";
import { ok } from "@workspace/shared/result";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Turn, TurnResolver } from "../runs/turn";
import {
  COMPUTER_INSTRUCTIONS,
  COMPUTER_TOOL,
  computerTurn,
  type DotComputers,
  withDotComputer,
} from "./computer";
import { dotTurn } from "./turn";

// A Dot's computer in its turns (172): added to every turn in a Dot's
// conversation, never asking, and left alone by the unattended policy.

const fakeTool = (name: string) =>
  tool({
    description: name,
    execute: () => Promise.resolve(name),
    inputSchema: z.object({}),
  });

const baseTurn: Turn = {
  agent: null,
  instructions: "Be brief.",
  model: new MockLanguageModelV4(),
  paidBy: null,
  resolvedModel: "mock/model" as Turn["resolvedModel"],
  toolApproval: { [COMPUTER_TOOL]: "user-approval", bash: "user-approval" },
  tools: { bash: fakeTool("bash") },
};

const computers: DotComputers = {
  setControl: () => Promise.reject(new Error("unused")),
  tools: () => ({ [COMPUTER_TOOL]: fakeTool(COMPUTER_TOOL) }),
  view: () => Promise.reject(new Error("unused")),
};

const run = {
  conversationId: fixtureId("conversation", 1),
  runId: fixtureId("run", 1),
} as RunStart;

const resolver: TurnResolver = () => Promise.resolve(ok(baseTurn));

describe("computerTurn", () => {
  it("adds the tool and its instructions, never asking", () => {
    const turn = computerTurn(baseTurn, computers.tools(run.conversationId));
    expect(Object.keys(turn.tools ?? {}).sort()).toEqual(["bash", "computer"]);
    expect(turn.toolApproval).toEqual({ bash: "user-approval" });
    expect(turn.instructions).toBe(`Be brief.\n\n${COMPUTER_INSTRUCTIONS}`);
  });

  it("survives the unattended policy, which still withholds what asks", () => {
    const turn = dotTurn(
      computerTurn(baseTurn, computers.tools(run.conversationId)),
      { autoApproveTools: [], instructions: "", name: "Scout" }
    );
    expect(Object.keys(turn.tools ?? {})).toEqual(["computer"]);
    expect(turn.unavailableTools).toHaveProperty("bash");
  });
});

describe("withDotComputer", () => {
  it("gives a Dot's conversation its computer", async () => {
    const resolve = withDotComputer(resolver, computers, () =>
      Promise.resolve(true)
    );
    const turn = await resolve(run, { state: {} as never });
    expect(turn.ok && Object.keys(turn.value.tools ?? {})).toContain(
      COMPUTER_TOOL
    );
  });

  it("leaves other chats alone, and every chat when there are no computers", async () => {
    const notDot = withDotComputer(resolver, computers, () =>
      Promise.resolve(false)
    );
    const none = withDotComputer(resolver, undefined, () =>
      Promise.resolve(true)
    );
    for (const resolve of [notDot, none]) {
      // biome-ignore lint/performance/noAwaitInLoops: two cases, in order.
      const turn = await resolve(run, { state: {} as never });
      expect(turn).toEqual(ok(baseTurn));
    }
  });
});
