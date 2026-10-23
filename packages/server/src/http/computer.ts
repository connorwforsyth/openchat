import type { RunExecutor } from "@workspace/ai/ports/run-executor";
import { conversationIdSchema } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { getDotByConversation } from "@workspace/db/queries/dots";
import type { Hono } from "hono";
import { z } from "zod";

import type { SessionResolver } from "../context";
import { type DotComputers, powerCycleComputer } from "../dots/computer";
import {
  computerHolderSchema,
  computerPowerActionSchema,
} from "../dots/computer-view";
import { problem } from "./problem";

// The live view of a Dot's computer (172): where to watch it, and who drives
// it. Plain routes rather than procedures, so the frozen contract (§3) is
// untouched; the shapes are `computerViewSchema`. Only the Dot's owner may
// watch or take over. Starting the view starts the desktop if it's stopped,
// as opening the Files panel starts a workspace. Restart and reset stop
// the Dot's runs first. Runner failures carry a reason for recovery guidance.

export interface ComputerRouteDeps {
  readonly computers: DotComputers | undefined;
  readonly db: Db;
  readonly executor: Pick<RunExecutor, "cancel">;
  readonly resolveSession: SessionResolver;
}

export const computerPath = (conversationId: string) =>
  `/api/computer/${conversationId}`;

const controlBodySchema = z.object({ holder: computerHolderSchema });

/** The runner's reason a failure carries, if any; the client parses it. */
const reasonSchema = z.object({ reason: z.string() });

export const mountComputerRoutes = (
  app: Hono,
  { computers, db, executor, resolveSession }: ComputerRouteDeps
) => {
  /** The owner's Dot conversation, or the response to send instead. */
  const authorize = async (request: Request, param: string | undefined) => {
    const session = await resolveSession(request);
    if (!session) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    const id = conversationIdSchema.safeParse(param);
    const dot = id.success ? await getDotByConversation(db, id.data) : null;
    if (!(id.success && dot && dot.ownerId === session.userId)) {
      return problem(404, "NOT_FOUND", "Not found.");
    }
    if (!computers) {
      return problem(
        403,
        "FEATURE_DISABLED",
        "Computers need the sandbox runner (sandbox.docker in app.config.yaml).",
        { reason: "not_configured" }
      );
    }
    return { computers, conversationId: id.data, userId: session.userId };
  };

  const answer = (
    result: Awaited<ReturnType<DotComputers["view"]>>
  ): Response =>
    result.ok
      ? Response.json(result.value, {
          headers: { "cache-control": "no-store" },
        })
      : problem(
          503,
          "UNAVAILABLE",
          "The computer isn't available right now.",
          reasonSchema.safeParse(result.error).data ?? {}
        );

  app.get("/api/computer/:conversationId", async (c) => {
    const found = await authorize(c.req.raw, c.req.param("conversationId"));
    if (found instanceof Response) {
      return found;
    }
    return answer(await found.computers.view(found.conversationId));
  });

  app.post("/api/computer/:conversationId/control", async (c) => {
    const found = await authorize(c.req.raw, c.req.param("conversationId"));
    if (found instanceof Response) {
      return found;
    }
    const body = controlBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return problem(400, "BAD_REQUEST", "Say who should have control.");
    }
    return answer(
      await found.computers.setControl(found.conversationId, body.data.holder)
    );
  });

  for (const action of computerPowerActionSchema.options) {
    app.post(`/api/computer/:conversationId/${action}`, async (c) => {
      const found = await authorize(c.req.raw, c.req.param("conversationId"));
      if (found instanceof Response) {
        return found;
      }
      return answer(
        await powerCycleComputer(
          { computers: found.computers, db, executor },
          found.conversationId,
          action,
          found.userId
        )
      );
    });
  }
};
