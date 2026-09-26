import { newId } from "@workspace/shared/ids";
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { UPDATE_MEMORY_TOOL } from "./prompt";
import { isPrivateChat, withMemory } from "./turn";

const MEMORY_AFTER_BASE =
  /^You are a helper\.\n\n## Memory[\s\S]*- Prefers pnpm/;

const owner = newId("user");
const other = newId("user");

describe("isPrivateChat", () => {
  const mine = {
    ownerId: owner,
    participantIds: [owner],
    requesterId: owner,
    visibility: "private" as const,
  };

  it("is true only for the owner's own unshared chat", () => {
    expect(isPrivateChat(mine)).toBe(true);
    expect(isPrivateChat({ ...mine, visibility: "shared" })).toBe(false);
    expect(isPrivateChat({ ...mine, visibility: "public-link" })).toBe(false);
    expect(isPrivateChat({ ...mine, participantIds: [owner, other] })).toBe(
      false
    );
    expect(isPrivateChat({ ...mine, requesterId: other })).toBe(false);
  });
});

describe("withMemory", () => {
  const memoryTool = tool({
    execute: () => "ours",
    inputSchema: z.object({}),
  });
  const snapshot = {
    content: "- Prefers pnpm",
    mode: "auto" as const,
    versionId: null,
  };

  it("adds the memory section and tool, keeping the turn's own", () => {
    const theirs = tool({ execute: () => "theirs", inputSchema: z.object({}) });
    const turn = withMemory(
      {
        instructions: "You are a helper.",
        resolvedModel: "test:model",
        toolApproval: { search: "user-approval" as const },
        tools: { search: theirs, [UPDATE_MEMORY_TOOL]: theirs },
      },
      { maxChars: 100, snapshot, tool: memoryTool }
    );
    expect(turn.resolvedModel).toBe("test:model");
    expect(turn.instructions).toMatch(MEMORY_AFTER_BASE);
    expect(turn.tools).toEqual({
      search: theirs,
      [UPDATE_MEMORY_TOOL]: memoryTool,
    });
    expect(turn.toolApproval).toEqual({
      search: "user-approval",
      [UPDATE_MEMORY_TOOL]: "not-applicable",
    });
  });

  it("asks the user first in propose mode", () => {
    const turn = withMemory(
      {},
      {
        maxChars: 100,
        snapshot: { ...snapshot, mode: "propose" },
        tool: memoryTool,
      }
    );
    expect(turn.toolApproval).toEqual({
      [UPDATE_MEMORY_TOOL]: "user-approval",
    });
  });
});
