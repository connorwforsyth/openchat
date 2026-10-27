import type { TerminalRunStatus } from "@workspace/ai/ports/run-executor";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type { FileId, MessageId } from "@workspace/contract/schemas/common";
import { createConversation } from "@workspace/db/queries/conversations";
import { getMessage, insertMessage } from "@workspace/db/queries/messages";
import { createRun, getRun } from "@workspace/db/queries/runs";
import { message } from "@workspace/db/schema/chat";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { ok } from "@workspace/shared/result";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createPostgresStreamChannel } from "../stream/postgres-stream-channel";
import { createInProcessExecutor } from "./executor";
import { runStartFromRow } from "./state";

// A steer with a file the model reads, where reading the file goes through
// the database (uploads are rows): the read happens before the steer is
// taken, outside the take's transaction. Inside it, on PGlite, the read
// waits on the transaction's own lock and the database hangs.

let testDb: TestDb | null = null;
afterEach(async () => {
  await testDb?.close();
  testDb = null;
});

const PNG = new Uint8Array([137, 80, 78, 71]);

describe("a steer with a file the model reads", () => {
  it("is taken, with its file read outside the take", async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    const owner = await seedUser(db);
    const org = await seedOrg(db, owner.id, { isPersonal: true });
    const context = { id: org.id, type: "personal" } as const;
    const chat = await createConversation(db, { context, ownerId: owner.id });

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let called: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      called = resolve;
    });
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? toolCallStream("wait", {}) : textStream("Seen it.")
        );
      },
    });
    const reads: FileId[] = [];
    const channel = createPostgresStreamChannel({ db });
    const executor = createInProcessExecutor({
      attachments: () => ({
        accepts: (mediaType) => mediaType.startsWith("image/"),
        // Through the outer handle, as the uploads reader does.
        read: async (_userId, wanted) => {
          await db.select({ id: message.id }).from(message).limit(1);
          reads.push(wanted);
          return PNG;
        },
      }),
      chatModes: false,
      db,
      resolveTurn: () =>
        Promise.resolve(
          ok({
            agent: null,
            model,
            paidBy: null,
            resolvedModel: "test:model",
            tools: {
              wait: tool({
                execute: async () => {
                  called();
                  await gate;
                  return "waited";
                },
                inputSchema: z.object({}),
              }),
            },
          })
        ),
      writer: {
        append: (runId, payload) => channel.append(runId, payload),
        close: (runId, status: TerminalRunStatus) =>
          channel.close(runId, status),
      },
    });

    const question = expectOk(
      await insertMessage(db, {
        authorId: owner.id,
        conversationId: chat.id,
        parentId: null,
        parts: [{ text: "Look into it.", type: "text" }],
        role: "user",
      })
    );
    const running = (
      await createRun(db, {
        context,
        conversationId: chat.id,
        createdBy: owner.id,
        target: { model: "test:model", type: "model" },
        userMessageId: question.id,
      })
    ).run;
    expectOk(await executor.start(runStartFromRow(running)));
    await waiting;
    const answer = expectOk(await getRun(db, running.id))
      .assistantMessageId as MessageId;

    const fileId = newId("file") as FileId;
    const asked = expectOk(
      await insertMessage(db, {
        authorId: owner.id,
        conversationId: chat.id,
        parentId: answer,
        parts: [
          {
            filename: "chart.png",
            mediaType: "image/png",
            source: { fileId, kind: "file" },
            type: "file",
          },
          { text: "Use this chart.", type: "text" },
        ],
        role: "user",
      })
    );
    const steer = (
      await createRun(db, {
        afterRunId: running.id,
        context,
        conversationId: chat.id,
        createdBy: owner.id,
        options: { delivery: "steer", sandbox: "auto", webSearch: "auto" },
        target: { model: "test:model", type: "model" },
        userMessageId: asked.id,
      })
    ).run;

    release();
    await executor.idle();

    expect(reads).toEqual([fileId]);
    expect(expectOk(await getRun(db, steer.id)).status).toBe("cancelled");
    const done = expectOk(await getRun(db, running.id));
    expect(done.status).toBe("succeeded");
    expect(
      expectOk(await getMessage(db, done.assistantMessageId as MessageId))
        .parentId
    ).toBe(asked.id);
    const prompt = model.doStreamCalls[1]?.prompt ?? [];
    expect(
      prompt.some(
        (each) =>
          each.role === "user" &&
          each.content.some((part) => part.type === "file")
      )
    ).toBe(true);
  });
});
