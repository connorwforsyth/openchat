import type { UIMessage, UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "./api";
import { isRunStreamError, readRunStream, splitSse } from "./run-stream";
import {
  createRunTransport,
  pickedSkills,
  turnFor,
  userParts,
} from "./run-transport";
import { reconcileId } from "./use-run-chat";

// The client half of resumable runs, against a scripted server: no network.

const RUN_ID = "01a0de5f-bf67-7628-9db6-f0c96ff5586c";
const encoder = new TextEncoder();

const event = (id: number, chunk: UIMessageChunk) =>
  `id: ${id}\ndata: ${JSON.stringify(chunk)}\n\n`;

const chunks: UIMessageChunk[] = [
  { messageId: "a1", type: "start" },
  { id: "t1", type: "text-start" },
  { delta: "one ", id: "t1", type: "text-delta" },
  { delta: "two", id: "t1", type: "text-delta" },
  { id: "t1", type: "text-end" },
  { type: "finish" },
];

/** The server's stream from a cursor; `dropAfter` cuts the connection mid-way. */
const serve = (cursor: number, dropAfter?: number) =>
  new ReadableStream<Uint8Array>({
    start: (sink) => {
      const rest = chunks
        .map((chunk, index) => ({ chunk, seq: index + 1 }))
        .filter(({ seq }) => seq > cursor);
      const sent = dropAfter === undefined ? rest : rest.slice(0, dropAfter);
      sink.enqueue(encoder.encode(": keep-alive\n\n"));
      for (const { chunk, seq } of sent) {
        sink.enqueue(encoder.encode(event(seq, chunk)));
      }
      if (dropAfter === undefined) {
        sink.enqueue(encoder.encode("data: [DONE]\n\n"));
        sink.close();
      } else {
        // Later, as a real drop would be: erroring now would discard the queue.
        setTimeout(
          () => sink.error(new TypeError("network connection lost")),
          10
        );
      }
    },
  });

const readAll = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of stream as unknown as AsyncIterable<T>) {
    out.push(item);
  }
  return out;
};

const cursorOf = (url: string) =>
  Number(new URL(url, "http://x").searchParams.get("cursor"));

describe("splitSse", () => {
  it("keeps an unfinished event for the next read and skips comments", () => {
    const { events, rest } = splitSse(
      ': ping\n\nid: 1\ndata: {"a":1}\n\nid: 2\ndata: {"b"'
    );
    expect(events).toEqual([{ data: '{"a":1}', id: 1 }]);
    expect(rest).toBe('id: 2\ndata: {"b"');
  });
});

describe("readRunStream", () => {
  it("reconnects from the last cursor and delivers every chunk once", async () => {
    const urls: string[] = [];
    const fetch = vi.fn((url: string) => {
      urls.push(url);
      // The first connection drops after two chunks.
      const body =
        urls.length === 1 ? serve(cursorOf(url), 2) : serve(cursorOf(url));
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const received = await readAll(
      readRunStream(`/api/runs/${RUN_ID}/stream`, {
        fetch: fetch as unknown as typeof globalThis.fetch,
        retryDelayMs: () => 0,
      })
    );
    expect(received).toEqual(chunks);
    expect(urls.map(cursorOf)).toEqual([0, 2]);
  });

  it("stops on a 4xx instead of retrying", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 404 }))
    );
    const failed = await readAll(
      readRunStream("/api/runs/x/stream", {
        fetch: fetch as unknown as typeof globalThis.fetch,
      })
    ).catch((error: unknown) => error);
    expect(isRunStreamError(failed) && failed.status).toBe(404);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("gives up after too many failed reconnects in a row", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("offline")));
    const failed = await readAll(
      readRunStream("/api/runs/x/stream", {
        fetch: fetch as unknown as typeof globalThis.fetch,
        maxRetries: 2,
        retryDelayMs: () => 0,
      })
    ).catch((error: unknown) => error);
    expect(isRunStreamError(failed) && failed.status).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

const user = (id: string, text: string): UIMessage => ({
  id,
  parts: [{ text, type: "text" }],
  role: "user",
});
const assistant = (id: string): UIMessage => ({
  id,
  parts: [{ text: "ok", type: "text" }],
  role: "assistant",
});

describe("turnFor", () => {
  it("sends a new message under the one before it", () => {
    expect(
      turnFor(
        "submit-message",
        [user("u1", "hi"), assistant("a1"), user("tmp", "more")],
        undefined
      )
    ).toEqual({
      parentId: "a1",
      parts: [{ text: "more", type: "text" }],
      type: "message",
    });
    expect(
      turnFor("submit-message", [user("tmp", "first")], undefined)
    ).toMatchObject({
      parentId: null,
    });
  });

  it("sends the skills picked for a message, once each, without the part (127)", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const message = {
      id: "tmp",
      parts: [
        { text: "use it", type: "text" as const },
        {
          data: {
            skills: [
              { id, name: "Haiku" },
              { id, name: "Haiku" },
            ],
          },
          type: "data-skills" as const,
        },
        { data: { skills: "nope" }, type: "data-skills" as const },
      ],
      role: "user" as const,
    };
    expect(pickedSkills(message)).toEqual([{ id }]);
    expect(turnFor("submit-message", [message], undefined)).toEqual({
      parentId: null,
      parts: [{ text: "use it", type: "text" }],
      skills: [{ id }],
      type: "message",
    });
  });

  it("regenerates the question behind an answer", () => {
    expect(
      turnFor("regenerate-message", [user("u1", "hi"), assistant("a1")], "a1")
    ).toEqual({ type: "regenerate", userMessageId: "u1" });
  });

  it("keeps uploaded and absolute files, drops the rest", () => {
    expect(
      userParts({
        id: "m",
        parts: [
          {
            mediaType: "image/png",
            type: "file",
            url: `/api/files/${RUN_ID}/content`,
          },
          {
            mediaType: "image/png",
            type: "file",
            url: "https://example.test/a.png",
          },
          { mediaType: "image/png", type: "file", url: "blob:local" },
        ],
        role: "user",
      })
    ).toEqual([
      {
        mediaType: "image/png",
        source: { fileId: RUN_ID, kind: "file" },
        type: "file",
      },
      {
        mediaType: "image/png",
        source: { kind: "url", url: "https://example.test/a.png" },
        type: "file",
      },
    ]);
  });

  it("keeps @file mentions of workspace files, drops other data", () => {
    expect(
      userParts({
        id: "m",
        parts: [
          { text: "look at @src/app.ts", type: "text" },
          { data: { path: "src/app.ts" }, type: "data-workspace-file" },
          { data: { nope: true }, type: "data-workspace-file" },
          { data: { path: "x" }, type: "data-something-else" },
        ],
        role: "user",
      })
    ).toEqual([
      { text: "look at @src/app.ts", type: "text" },
      { data: { path: "src/app.ts" }, name: "workspace-file", type: "data" },
    ]);
  });

  it("keeps the message's chips, so the server acts on them and history draws them", () => {
    const chips = [
      {
        artifact: "presentation",
        end: 7,
        kind: "artifact",
        label: "Slides",
        start: 0,
      },
    ];
    expect(
      userParts({
        id: "m",
        parts: [
          { text: "@Slides on otters", type: "text" },
          { data: { chips }, type: "data-chips" },
          { data: { chips: [{ kind: "nope" }] }, type: "data-chips" },
        ],
        role: "user",
      })
    ).toEqual([
      { text: "@Slides on otters", type: "text" },
      { data: { chips }, name: "chips", type: "data" },
    ]);
  });

  it("keeps notes pinned on an artifact, so history draws them as a card", () => {
    const notes = {
      artifactId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      kind: "site",
      notes: [
        {
          mark: { shape: "point", x: 0.5, y: 0.5 },
          note: "Bigger",
          target: null,
          version: 1,
          versionId: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
        },
      ],
      title: "Home",
    };
    expect(
      userParts({
        id: "m",
        parts: [
          { text: "<artifact-annotations>…", type: "text" },
          { data: notes, type: "data-annotations" },
          { data: { ...notes, notes: [] }, type: "data-annotations" },
        ],
        role: "user",
      })
    ).toEqual([
      { text: "<artifact-annotations>…", type: "text" },
      { data: notes, name: "annotations", type: "data" },
    ]);
  });
});

describe("createRunTransport", () => {
  it("creates a run, reports the stored id, then streams it", async () => {
    const create = vi.fn(() =>
      Promise.resolve({
        conversationId: "c1",
        runId: RUN_ID,
        status: "running",
        streamUrl: `/api/runs/${RUN_ID}/stream`,
        userMessageId: "u-server",
      })
    );
    const created = vi.fn();
    const transport = createRunTransport({
      client: { runs: { create } } as unknown as Pick<ApiClient, "runs">,
      fetch: ((url: string) =>
        Promise.resolve(
          new Response(serve(cursorOf(url)))
        )) as unknown as typeof fetch,
      onRunCreated: created,
      runFields: () => ({ target: { model: "fast", type: "model" } }),
    });
    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: "c1",
      messageId: undefined,
      messages: [user("u-client", "hello")],
      trigger: "submit-message",
    });
    expect(create).toHaveBeenCalledWith(
      {
        conversationId: "c1",
        input: {
          parentId: null,
          parts: [{ text: "hello", type: "text" }],
          type: "message",
        },
        target: { model: "fast", type: "model" },
      },
      { signal: undefined }
    );
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: "u-client",
        userMessageId: "u-server",
      })
    );
    expect(await readAll(stream)).toEqual(chunks);
  });
});

describe("reconnectToStream", () => {
  const NEXT_ID = "01a0de5f-bf67-7628-9db6-f0c96ff5586d";
  const queuedRun = { id: NEXT_ID, state: { status: "queued" } };
  const runningRun = { id: RUN_ID, state: { status: "running" } };

  const transportWith = (items: readonly unknown[]) => {
    const urls: string[] = [];
    const transport = createRunTransport({
      client: {
        runs: {
          create: () =>
            Promise.resolve({
              conversationId: "c1",
              runId: RUN_ID,
              status: "running",
              streamUrl: `/api/runs/${RUN_ID}/stream`,
              userMessageId: "u1",
            }),
          list: () => Promise.resolve({ items, nextCursor: null }),
        },
      } as unknown as Pick<ApiClient, "runs">,
      fetch: ((url: string) => {
        urls.push(url.split("?")[0] ?? url);
        return Promise.resolve(new Response(serve(cursorOf(url))));
      }) as unknown as typeof fetch,
    });
    return { transport, urls };
  };

  it("follows the answer being written, not a turn queued behind it", async () => {
    // Newest first, as the list comes.
    const { transport, urls } = transportWith([queuedRun, runningRun]);
    const stream = await transport.reconnectToStream({ chatId: "c1" });
    await readAll(stream as ReadableStream<UIMessageChunk>);
    expect(urls).toEqual([`/api/runs/${RUN_ID}/stream`]);
  });

  it("follows the turn queued next once the answer it read has ended", async () => {
    const { transport, urls } = transportWith([queuedRun]);
    await readAll(
      await transport.sendMessages({
        abortSignal: undefined,
        chatId: "c1",
        messageId: undefined,
        messages: [user("u-client", "hello")],
        trigger: "submit-message",
      })
    );
    const stream = await transport.reconnectToStream({ chatId: "c1" });
    await readAll(stream as ReadableStream<UIMessageChunk>);
    expect(urls.at(-1)).toBe(`/api/runs/${NEXT_ID}/stream`);
  });
});

describe("reconcileId", () => {
  it("swaps the optimistic id for the stored one", () => {
    expect(
      reconcileId([user("tmp", "hi")], "tmp", "u1").map((message) => message.id)
    ).toEqual(["u1"]);
  });
});
