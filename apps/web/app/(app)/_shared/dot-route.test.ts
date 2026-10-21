import { fixtureId } from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "@/lib/routes";

import { dotRoute } from "./dot-route";

const conversationId = fixtureId("conversation", 7);

const later = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const route = (
  listDots: () => Promise<readonly { conversationId: typeof conversationId }[]>,
  location = () => "/c/a"
) => dotRoute({ listDots, location, waitMs: 2000 });

afterEach(() => {
  vi.useRealTimers();
});

describe("dotRoute", () => {
  it("waits for a cold Dot list and opens the Dot", async () => {
    vi.useFakeTimers();
    const picked = route(() => later(800, [{ conversationId }]));
    await vi.advanceTimersByTimeAsync(800);
    expect(await picked).toBe(routes.chat(conversationId));
  });

  it("goes to /dots without a Dot", async () => {
    expect(await route(() => Promise.resolve([]))).toBe(routes.dots);
  });

  it("settles for /dots when the list is slow or fails", async () => {
    vi.useFakeTimers();
    const slow = route(() => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await slow).toBe(routes.dots);
    expect(await route(() => Promise.reject(new Error("offline")))).toBe(
      routes.dots
    );
  });

  it("stays put when the user moved on while it waited", async () => {
    vi.useFakeTimers();
    let here = "/c/a";
    const picked = route(
      () => later(500, [{ conversationId }]),
      () => here
    );
    here = "/library";
    await vi.advanceTimersByTimeAsync(500);
    expect(await picked).toBeNull();
  });
});
