import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import type { StreamEvent } from "./stream-channel";
import { createMemoryStreamChannel } from "./stream-channel.memory";

const runId = fixtureId("run", 1);

const collect = async (events: AsyncIterable<StreamEvent>) => {
  const seen: StreamEvent[] = [];
  for await (const event of events) {
    seen.push(event);
  }
  return seen;
};

const subscribe = async (
  channel: ReturnType<typeof createMemoryStreamChannel>,
  options?: Parameters<
    ReturnType<typeof createMemoryStreamChannel>["subscribe"]
  >[1]
) => {
  const result = await channel.subscribe(runId, options);
  if (!result.ok) {
    throw new Error("subscribe failed");
  }
  return result.value;
};

describe("memory StreamChannel", () => {
  it("numbers chunks from 1 and replays a finished stream", async () => {
    const channel = createMemoryStreamChannel();
    expect(await channel.append(runId, "a")).toEqual({ ok: true, value: 1 });
    expect(await channel.append(runId, "b")).toEqual({ ok: true, value: 2 });
    await channel.close(runId, "succeeded");
    expect(await collect(await subscribe(channel))).toEqual([
      { payload: "a", seq: 1, type: "chunk" },
      { payload: "b", seq: 2, type: "chunk" },
      { status: "succeeded", type: "end" },
    ]);
  });

  it("resumes after a cursor without gaps or repeats", async () => {
    const channel = createMemoryStreamChannel();
    await channel.append(runId, "a");
    await channel.append(runId, "b");
    await channel.append(runId, "c");
    await channel.close(runId, "succeeded");
    const events = await collect(await subscribe(channel, { cursor: 2 }));
    expect(events).toEqual([
      { payload: "c", seq: 3, type: "chunk" },
      { status: "succeeded", type: "end" },
    ]);
  });

  it("delivers live chunks to several subscribers, including early ones", async () => {
    const channel = createMemoryStreamChannel();
    const first = collect(await subscribe(channel));
    await channel.append(runId, "a");
    const second = collect(await subscribe(channel, { cursor: 0 }));
    await channel.append(runId, "b");
    await channel.close(runId, "cancelled");
    const expected = [
      { payload: "a", seq: 1, type: "chunk" },
      { payload: "b", seq: 2, type: "chunk" },
      { status: "cancelled", type: "end" },
    ];
    expect(await first).toEqual(expected);
    expect(await second).toEqual(expected);
  });

  it("refuses appends after close and keeps the first status", async () => {
    const channel = createMemoryStreamChannel();
    await channel.close(runId, "failed");
    await channel.close(runId, "succeeded");
    expect(await channel.append(runId, "late")).toEqual({
      error: { runId, type: "closed" },
      ok: false,
    });
    expect(await collect(await subscribe(channel))).toEqual([
      { status: "failed", type: "end" },
    ]);
  });

  it("stops when the subscriber aborts", async () => {
    const channel = createMemoryStreamChannel();
    const controller = new AbortController();
    const events = collect(
      await subscribe(channel, { signal: controller.signal })
    );
    await channel.append(runId, "a");
    await Promise.resolve();
    controller.abort();
    expect(await events).toEqual([{ payload: "a", seq: 1, type: "chunk" }]);
  });

  it("yields only the end after pruning", async () => {
    const channel = createMemoryStreamChannel();
    await channel.append(runId, "a");
    await channel.prune(runId);
    // Pruning an open stream is a no-op.
    await channel.close(runId, "succeeded");
    expect(await collect(await subscribe(channel))).toHaveLength(2);
    await channel.prune(runId);
    expect(await collect(await subscribe(channel))).toEqual([
      { status: "succeeded", type: "end" },
    ]);
  });
});
