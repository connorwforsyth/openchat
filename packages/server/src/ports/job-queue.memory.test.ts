import { err, ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import { createMemoryJobQueue } from "./job-queue.memory";

// A type alias, not an interface: `JobMap` needs the implicit index
// signature that only aliases get.
// biome-ignore lint/style/useConsistentTypeDefinitions: see above.
type Jobs = {
  "file.ingest": { fileId: string };
  "title.generate": { conversationId: string };
};

const manualClock = () => {
  let time = new Date("2026-09-26T09:00:00.000Z").getTime();
  return {
    advance: (seconds: number) => {
      time += seconds * 1000;
    },
    now: () => new Date(time),
  };
};

describe("memory JobQueue", () => {
  it("runs due jobs through their handler and stores the output", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    const seen: string[] = [];
    await queue.work("title.generate", (job) => {
      seen.push(job.data.conversationId);
      return Promise.resolve(ok({ title: "Plans" }));
    });
    const enqueued = await queue.enqueue("title.generate", {
      conversationId: "c1",
    });
    const id = enqueued.ok ? enqueued.value : null;
    expect(await queue.drain()).toBe(1);
    expect(seen).toEqual(["c1"]);
    const stored = id ? await queue.getJob(id) : null;
    expect(stored?.ok && stored.value).toMatchObject({
      output: { title: "Plans" },
      state: "completed",
    });
  });

  it("leaves jobs without a worker waiting", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    await queue.enqueue("file.ingest", { fileId: "f1" });
    expect(await queue.drain()).toBe(0);
    expect(queue.jobs()[0]?.state).toBe("created");
  });

  it("retries failures up to retryLimit with backoff, then fails", async () => {
    const clock = manualClock();
    const queue = createMemoryJobQueue<Jobs>({ now: clock.now });
    let attempts = 0;
    await queue.work("file.ingest", () => {
      attempts += 1;
      return Promise.resolve(err("parser crashed"));
    });
    await queue.enqueue(
      "file.ingest",
      { fileId: "f1" },
      {
        retryBackoff: true,
        retryDelaySeconds: 10,
        retryLimit: 2,
      }
    );
    await queue.drain();
    expect(queue.jobs()[0]).toMatchObject({ retryCount: 1, state: "retry" });
    clock.advance(10);
    await queue.drain();
    expect(queue.jobs()[0]).toMatchObject({ retryCount: 2, state: "retry" });
    clock.advance(19);
    expect(await queue.drain()).toBe(0); // backoff doubled to 20s
    clock.advance(1);
    await queue.drain();
    expect(attempts).toBe(3);
    expect(queue.jobs()[0]).toMatchObject({
      output: "parser crashed",
      state: "failed",
    });
  });

  it("treats a throwing handler as a failed attempt", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    await queue.work("file.ingest", () => {
      throw new Error("bug");
    });
    await queue.enqueue("file.ingest", { fileId: "f1" }, { retryLimit: 0 });
    await queue.drain();
    expect(queue.jobs()[0]).toMatchObject({ output: "bug", state: "failed" });
  });

  it("delays jobs with startAfterSeconds", async () => {
    const clock = manualClock();
    const queue = createMemoryJobQueue<Jobs>({ now: clock.now });
    await queue.work("title.generate", () => Promise.resolve(ok(undefined)));
    await queue.enqueue(
      "title.generate",
      { conversationId: "c1" },
      { startAfterSeconds: 30 }
    );
    expect(await queue.drain()).toBe(0);
    clock.advance(30);
    expect(await queue.drain()).toBe(1);
  });

  it("suppresses duplicates by singletonKey while one is pending", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    const first = await queue.enqueue(
      "file.ingest",
      { fileId: "f1" },
      { singletonKey: "f1" }
    );
    const second = await queue.enqueue(
      "file.ingest",
      { fileId: "f1" },
      { singletonKey: "f1" }
    );
    expect(first.ok && first.value).toBeTruthy();
    expect(second).toEqual({ ok: true, value: null });
    await queue.work("file.ingest", () => Promise.resolve(ok(undefined)));
    await queue.drain();
    const third = await queue.enqueue(
      "file.ingest",
      { fileId: "f1" },
      { singletonKey: "f1" }
    );
    expect(third.ok && third.value).toBeTruthy();
  });

  it("runs higher priority first", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    const order: string[] = [];
    await queue.work("file.ingest", (job) => {
      order.push(job.data.fileId);
      return Promise.resolve(ok(undefined));
    });
    await queue.enqueue("file.ingest", { fileId: "low" });
    await queue.enqueue("file.ingest", { fileId: "high" }, { priority: 10 });
    await queue.drain();
    expect(order).toEqual(["high", "low"]);
  });

  it("cancels waiting jobs", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    const enqueued = await queue.enqueue("file.ingest", { fileId: "f1" });
    if (!(enqueued.ok && enqueued.value)) {
      throw new Error("not enqueued");
    }
    await queue.cancel(enqueued.value);
    await queue.work("file.ingest", () => Promise.resolve(ok(undefined)));
    expect(await queue.drain()).toBe(0);
    expect(queue.jobs()[0]?.state).toBe("cancelled");
  });

  it("validates, stores, fires and removes cron schedules", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    expect(
      (
        await queue.schedule("title.generate", "every day", {
          conversationId: "c",
        })
      ).ok
    ).toBe(false);
    await queue.schedule(
      "title.generate",
      "0 3 * * *",
      { conversationId: "c" },
      { tz: "UTC" }
    );
    expect(queue.schedules().get("title.generate")?.cron).toBe("0 3 * * *");
    expect(await queue.fireSchedule("title.generate")).toBeTruthy();
    await queue.unschedule("title.generate");
    expect(await queue.fireSchedule("title.generate")).toBeNull();
  });

  it("stops working after stop()", async () => {
    const queue = createMemoryJobQueue<Jobs>();
    await queue.work("file.ingest", () => Promise.resolve(ok(undefined)));
    await queue.enqueue("file.ingest", { fileId: "f1" });
    await queue.stop();
    expect(await queue.drain()).toBe(0);
  });
});
