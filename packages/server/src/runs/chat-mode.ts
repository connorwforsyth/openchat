import type { ChatMode } from "@workspace/contract/schemas/runs";
import type { ToolApprovalStatus, ToolSet } from "ai";

import type { Turn } from "./turn";

// Chat and Code modes. A Chat run keeps artifacts and the workspace's file
// tools (read, write, edit) and loses everything that executes in the
// sandbox. The executor applies `chatModeTurn` on every pass, after every
// wrapper has added its tools, so no resolver can hand a Chat run a shell.
// A run outside the switch (a Dot's chat, or any chat while
// `features.chatModes` is off) has no `chatMode` and keeps all.

/** Sandbox tools that run code: a shell, and the dev-server preview it starts. */
export const CODE_TOOLS = ["bash", "preview"] as const;

/** What the model reads when it calls a tool Chat mode left out. */
export const chatModeUnavailable = (name: string): string =>
  `\`${name}\` runs code, and this chat is in Chat mode. Do what you can with files and artifacts, and tell the user to switch the composer to Code mode to run it.`;

type ModedTurn = Pick<Turn, "toolApproval" | "tools" | "unavailableTools">;

/** A turn as `mode` allows it. Pure; `code` and no mode leave it as it was. */
export const chatModeTurn = <T extends ModedTurn>(
  turn: T,
  mode: ChatMode | undefined
): T => {
  if (mode !== "chat" || !turn.tools) {
    return turn;
  }
  const tools: ToolSet = {};
  const toolApproval: Record<string, ToolApprovalStatus> = {};
  const unavailableTools: Record<string, string> = {
    ...turn.unavailableTools,
  };
  for (const [name, each] of Object.entries(turn.tools)) {
    if ((CODE_TOOLS as readonly string[]).includes(name)) {
      unavailableTools[name] = chatModeUnavailable(name);
      continue;
    }
    tools[name] = each;
    const approval = turn.toolApproval?.[name];
    if (approval) {
      toolApproval[name] = approval;
    }
  }
  return {
    ...turn,
    toolApproval,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    unavailableTools,
  };
};
