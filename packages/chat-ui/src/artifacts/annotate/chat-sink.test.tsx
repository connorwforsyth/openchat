import { renderHook } from "@testing-library/react";
import type { AnnotationsData } from "@workspace/ai/messages/annotations";
import { describe, expect, it, vi } from "vitest";

import { annotationsMessage, useChatAnnotateSink } from "./chat-sink";

const data = {
  artifactId: "0192a000-0000-7000-8000-000000000021",
  kind: "site",
  notes: [
    {
      mark: { shape: "point", x: 0.5, y: 0.5 },
      note: "Bigger.",
      target: null,
      version: 1,
      versionId: "0192a000-0000-7000-8000-000000000022",
    },
  ],
  title: "Home",
} as unknown as AnnotationsData;

const ports = () => ({
  sendBusy: vi.fn(() => Promise.resolve()),
  sendMessage: vi.fn(() => Promise.resolve()),
  stopReading: vi.fn(() => Promise.resolve()),
});

describe("useChatAnnotateSink", () => {
  it("gives a viewer, or a chat not made yet, no way to send notes", () => {
    const viewer = renderHook(() =>
      useChatAnnotateSink({
        busy: false,
        conversation: { myPermission: "viewer" },
        waiting: false,
        ...ports(),
      })
    );
    expect(viewer.result.current).toBeNull();
    const none = renderHook(() =>
      useChatAnnotateSink({
        busy: false,
        conversation: undefined,
        waiting: false,
        ...ports(),
      })
    );
    expect(none.result.current).toBeNull();
  });

  it("starts the next turn, or steers the answer being written", async () => {
    const idle = ports();
    const { result, rerender } = renderHook(
      ({ busy }) =>
        useChatAnnotateSink({
          busy,
          conversation: { myPermission: "editor" },
          waiting: false,
          ...idle,
        }),
      { initialProps: { busy: false } }
    );
    expect(result.current?.mode).toBe("send");
    await result.current?.send(data);
    expect(idle.sendMessage).toHaveBeenCalledWith(annotationsMessage(data));

    rerender({ busy: true });
    expect(result.current?.mode).toBe("steer");
    await result.current?.send(data);
    expect(idle.sendBusy).toHaveBeenCalledWith(
      expect.stringContaining("<artifact-annotations>"),
      data,
      "steer"
    );
  });

  it("stops following an answer that waits on approval first", async () => {
    const waiting = ports();
    const { result } = renderHook(() =>
      useChatAnnotateSink({
        busy: false,
        conversation: { myPermission: "owner" },
        waiting: true,
        ...waiting,
      })
    );
    await result.current?.send(data);
    expect(waiting.stopReading).toHaveBeenCalled();
    expect(waiting.sendMessage).toHaveBeenCalled();
  });
});
