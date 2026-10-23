import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createApiClient } from "@workspace/client/api";
import type { ConversationEventsOptions } from "@workspace/client/conversation-events";
import { fixtureId } from "@workspace/contract/fixtures";
import { TYPING_TTL_MS } from "@workspace/contract/schemas/conversations";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLiveConversation } from "./use-live-conversation";

const subscription = vi.hoisted(
  (): { current: ConversationEventsOptions | null } => ({ current: null })
);
vi.mock("@workspace/client/conversation-events", () => ({
  followConversationEvents: (
    _id: string,
    options: ConversationEventsOptions
  ) => {
    subscription.current = options;
    return Promise.resolve();
  },
}));

const client = createApiClient({
  fetch: () => Promise.reject(new Error("unexpected request")),
});
const ada = { email: null, id: fixtureId("user", 1), image: null, name: "Ada" };
const props = {
  client,
  conversationId: fixtureId("conversation", 1),
  meId: fixtureId("user", 2),
  onCatchUp: vi.fn(),
  onRun: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  subscription.current = null;
});

describe("live conversation callbacks", () => {
  it("expires typing when the wall clock moves back before its timer fires", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let expire: (() => void) | undefined;
    const setTimer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, delay, ...args) => {
        if (
          expire === undefined &&
          delay === TYPING_TTL_MS &&
          typeof callback === "function"
        ) {
          expire = () => callback(...args);
          return setTimer(() => undefined, 60_000);
        }
        return setTimer(callback, delay, ...args);
      }
    );
    const { result } = renderHook(() => useLiveConversation(props));
    await act(() => {
      subscription.current?.onEvent({ type: "typing", user: ada });
      return Promise.resolve();
    });
    expect(result.current.typing).toEqual([ada]);
    expect(expire).toBeDefined();
    now -= 1000;
    await act(() => {
      expire?.();
      return Promise.resolve();
    });
    expect(result.current.typing).toEqual([]);
  });

  it("keeps committed callbacks when a later render suspends", () => {
    const committed = vi.fn();
    const uncommitted = vi.fn();
    const pending = new Promise<never>(() => undefined);
    function Probe({
      suspend,
      onRun,
    }: {
      readonly suspend: boolean;
      readonly onRun: typeof committed;
    }) {
      useLiveConversation({ ...props, onRun });
      if (suspend) {
        throw pending;
      }
      return null;
    }
    const view = render(
      <Suspense fallback={null}>
        <Probe onRun={committed} suspend={false} />
      </Suspense>
    );
    view.rerender(
      <Suspense fallback={null}>
        <Probe onRun={uncommitted} suspend />
      </Suspense>
    );
    act(() =>
      subscription.current?.onEvent({
        runId: fixtureId("run", 1),
        status: "running",
        type: "run",
      })
    );
    expect(committed).toHaveBeenCalledTimes(1);
    expect(uncommitted).not.toHaveBeenCalled();
  });
});
