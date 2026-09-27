import { textStream } from "@workspace/ai/testing/mock-models";
import type { AppConfig } from "@workspace/config/schema";
import type {
  ConversationId,
  FileId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Message } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import { createFile } from "@workspace/db/queries/files";
import { createTestDb, seedUser, type TestDb } from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "../ports/storage.memory";
import { createHarness, type Harness } from "../testing/harness";
import {
  attachmentNote,
  attachmentsFor,
  attachmentsForModel,
  type ModelAttachments,
  uploadReader,
} from "./attachments";

const userId = newId("user") as UserId;
const pdfId = newId("file") as FileId;
const PDF = new TextEncoder().encode("%PDF-1.4 tiny");

const message = (parts: Message["parts"]): Message => ({
  agent: null,
  authorId: userId,
  conversationId: newId("conversation") as ConversationId,
  createdAt: new Date(0).toISOString(),
  id: newId("message") as MessageId,
  model: null,
  parentId: null,
  parts,
  partsVersion: 1,
  role: "user",
  runId: null,
  status: "complete",
  usage: null,
});

const pdfPart = {
  filename: "report.pdf",
  mediaType: "application/pdf",
  source: { fileId: pdfId, kind: "file" as const },
  type: "file" as const,
};
const question = { text: "What does it say?", type: "text" as const };

const reads =
  (bytes: Uint8Array | null): ModelAttachments["read"] =>
  () =>
    Promise.resolve(bytes);

describe("attachmentsForModel", () => {
  it("turns a file the model can't read into a note after the text", async () => {
    const [prepared] = await attachmentsForModel(
      [message([pdfPart, question])],
      userId,
      { accepts: () => false, read: reads(PDF) }
    );
    expect(prepared?.parts).toEqual([
      question,
      { text: attachmentNote(pdfPart), type: "text" },
    ]);
    expect(attachmentNote(pdfPart)).toContain("report.pdf");
    expect(attachmentNote(pdfPart)).toContain("file_search");
  });

  it("inlines the bytes of a file the model reads", async () => {
    const [prepared] = await attachmentsForModel(
      [message([pdfPart, question])],
      userId,
      { accepts: (type) => type === "application/pdf", read: reads(PDF) }
    );
    expect(prepared?.parts[0]).toEqual({
      ...pdfPart,
      source: {
        kind: "url",
        url: `data:application/pdf;base64,${Buffer.from(PDF).toString("base64")}`,
      },
    });
    expect(prepared?.parts[1]).toEqual(question);
  });

  it("falls back to a note when the bytes can't be had", async () => {
    for (const read of [
      reads(null),
      () => Promise.reject(new Error("storage down")),
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: two cases, in order.
      const [prepared] = await attachmentsForModel(
        [message([pdfPart])],
        userId,
        { accepts: () => true, read }
      );
      expect(prepared?.parts).toEqual([
        { text: attachmentNote(pdfPart), type: "text" },
      ]);
    }
  });

  it("keeps a remote URL the model reads, and notes one it can't fetch", async () => {
    const remote = {
      mediaType: "image/png",
      source: { kind: "url" as const, url: "https://example.com/a.png" },
      type: "file" as const,
    };
    const local = {
      ...remote,
      source: { kind: "url" as const, url: "/api/files/x/content" },
    };
    const [prepared] = await attachmentsForModel(
      [message([remote, local])],
      userId,
      { accepts: () => true, read: reads(null) }
    );
    expect(prepared?.parts).toEqual([
      remote,
      { text: attachmentNote(local), type: "text" },
    ]);
  });

  it("leaves messages without attachments alone", async () => {
    const plain = message([question]);
    const [prepared] = await attachmentsForModel([plain], userId, {
      accepts: () => true,
      read: reads(PDF),
    });
    expect(prepared).toBe(plain);
  });
});

describe("attachmentsFor", () => {
  const providers: AppConfig["providers"] = {
    anthropic: { headers: {}, models: [], options: {}, type: "anthropic" },
    local: {
      baseURL: "http://localhost:11434/v1",
      headers: {},
      models: [],
      options: {},
      type: "openai-compatible",
    },
  };

  it("goes by the model's provider", () => {
    expect(
      attachmentsFor(providers, "anthropic:claude", undefined).accepts(
        "application/pdf"
      )
    ).toBe(true);
    expect(
      attachmentsFor(providers, "local:llama", undefined).accepts(
        "application/pdf"
      )
    ).toBe(false);
    expect(
      attachmentsFor(providers, "gone:model", undefined).accepts("image/png")
    ).toBe(false);
  });
});

describe("uploadReader", () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it("reads an upload for its owner and nobody else", async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    const owner = await seedUser(db);
    const stranger = await seedUser(db);
    const storage = createMemoryStorage();
    await storage.put("files/report", PDF, { contentType: "application/pdf" });
    const row = await createFile(db, {
      mediaType: "application/pdf",
      name: "report.pdf",
      ownerId: owner.id,
      purpose: "attachment",
      size: PDF.byteLength,
      storageDriver: "local",
      storageKey: "files/report",
    });
    const read = uploadReader(db, storage);
    expect(await read(owner.id, row.id as FileId)).toEqual(PDF);
    expect(await read(stranger.id, row.id as FileId)).toBeNull();
  });
});

describe("a turn with a PDF the model can't read", () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it("answers, with the attachment as a note instead of failing (040's fixme)", async () => {
    h = await createHarness();
    const harness = h;
    let prompt = "";
    harness.nextTurn({
      model: new MockLanguageModelV4({
        doStream: async (options) => {
          prompt = JSON.stringify(options.prompt);
          return await Promise.resolve(textStream("Read it"));
        },
      }),
    });
    const chat = (await (
      await harness.request("/api/conversations", { json: {}, method: "POST" })
    ).json()) as Conversation;
    const created = (await (
      await harness.request("/api/runs", {
        json: {
          conversationId: chat.id,
          input: {
            parentId: null,
            parts: [pdfPart, question],
            type: "message",
          },
          target: { model: "test:model", type: "model" },
        },
        method: "POST",
      })
    ).json()) as CreateRunOutput;
    await harness.services.executor.idle();
    const run = (await (
      await harness.request(`/api/runs/${created.runId}`)
    ).json()) as Run;
    expect(run.state.status).toBe("succeeded");
    expect(prompt).toContain("report.pdf");
    expect(prompt).toContain("file_search");
    expect(prompt).not.toContain("/api/files/");
  });
});
