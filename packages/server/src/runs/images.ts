import type { ChatKeys } from "@workspace/ai/keys/resolve";
import type { RunStart } from "@workspace/ai/ports/run-executor";
import type { DiscoveringRegistry } from "@workspace/ai/providers/registry";
import {
  drawWith,
  type ImagePorts,
  type ImageWorkspace,
} from "@workspace/ai/tools/image-generation";
import {
  GENERATE_IMAGE_TOOL,
  generateImageTool,
} from "@workspace/ai/tools/registry/generate-image";
import { toAiSdkTool } from "@workspace/ai/tools/registry/to-ai-sdk";
import { imageCost } from "@workspace/config/prices";
import type { AppConfig } from "@workspace/config/schema";
import { parseModelRef } from "@workspace/contract/schemas/models";
import type { Db } from "@workspace/db/client";
import type { StoredContext } from "@workspace/db/queries/conversations";
import { personalOrgOf } from "@workspace/db/queries/teams";
import { recordTransaction } from "@workspace/db/queries/usage";
import { err } from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus } from "ai";

import { dbArtifactStore } from "../api/artifacts-context";
import { budgetCheck, chargedBy } from "./chat-context";
import type { TurnSandbox } from "./sandbox";

// `generate_image` in a turn (138): the tool is offered only when the
// instance has an image model this chat's keys can pay for (D17). Its
// pictures go into the chat's workspace and its artifacts, what it costs is
// recorded like any model call (so budgets see it), and the same spend
// check a run gets (a spent hard budget, a used-up space allowance) stops
// it before anything is drawn. It asks first unless
// `models.image.approval` is `auto`.

/** What the shell gives a turn for images: the built registry's image half. */
export type ImageModels = Pick<
  DiscoveringRegistry,
  "imageModel" | "imageModels"
>;

export interface ImageTurnDeps {
  readonly config: Pick<AppConfig, "models">;
  readonly db: Db;
  readonly models: ImageModels;
  readonly now?: () => Date;
}

/** The run's chat context as usage rows store it; `null` when it's gone. */
const storedContextOf = async (
  db: Db,
  run: RunStart
): Promise<StoredContext | null> => {
  const { context } = run;
  switch (context.type) {
    case "personal": {
      const orgId = await personalOrgOf(db, run.createdBy);
      return orgId ? { id: orgId, type: "personal" } : null;
    }
    case "team":
    case "org":
      return context;
    default:
      return context satisfies never;
  }
};

/** The workspace as the tool reaches it. */
const workspaceOf = (sandbox: TurnSandbox): ImageWorkspace => ({
  readFile: async (path) => {
    const read = await sandbox.readFile(path);
    return read.ok
      ? read
      : err(
          read.error.type === "not_found"
            ? { type: "not_found" as const }
            : { message: read.error.message, type: "unavailable" as const }
        );
  },
  writeFile: sandbox.writeFile,
});

/**
 * `generate_image` for one plain-chat turn, bound to the first image model
 * this context can use; nothing when there's none.
 */
export const chatImageTools = async (
  deps: ImageTurnDeps,
  run: RunStart,
  keys: ChatKeys,
  sandbox: TurnSandbox | null
): Promise<{
  readonly toolApproval: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools: Readonly<Record<string, Tool>>;
}> => {
  const none = { toolApproval: {}, tools: {} };
  const choices = await deps.models.imageModels(keys).catch(() => []);
  const choice = choices.find((candidate) => candidate.available);
  const provider = choice ? parseModelRef(choice.target)?.provider : undefined;
  if (!(choice && provider)) {
    return none;
  }
  const model = deps.models.imageModel(choice.target, keys[provider]);
  if (!model.ok) {
    return none;
  }
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const charged = async () => {
    const context = await storedContextOf(db, run);
    const by = context ? await chargedBy(db, run.createdBy, context) : null;
    return context && by ? { by, context } : null;
  };
  const ports: ImagePorts = {
    artifacts: dbArtifactStore(db, run),
    drawer: {
      displayName: choice.displayName,
      draw: drawWith(model.value),
      target: choice.target,
    },
    record: async ({ count, model: ref, usage }) => {
      const who = await charged();
      if (!who) {
        return;
      }
      await recordTransaction(
        db,
        {
          context: who.context,
          costMicros: imageCost(deps.config.models.prices, ref, count, usage)
            .costMicros,
          kind: "tool",
          model: ref,
          orgId: who.by.orgId,
          paidBy: keys[provider]?.source ?? { type: "instance" },
          runId: run.runId,
          usage,
          userId: run.createdBy,
        },
        now()
      );
    },
    withinBudget: async () => {
      const context = await storedContextOf(db, run);
      if (!context) {
        return true;
      }
      const check = budgetCheck(db, now);
      return (await check({ userId: run.createdBy }, context)).ok;
    },
    ...(sandbox ? { workspace: workspaceOf(sandbox) } : {}),
  };
  return {
    toolApproval: {
      [GENERATE_IMAGE_TOOL]:
        deps.config.models.image.approval === "auto"
          ? "not-applicable"
          : "user-approval",
    },
    tools: { [GENERATE_IMAGE_TOOL]: toAiSdkTool(generateImageTool, { ports }) },
  };
};
