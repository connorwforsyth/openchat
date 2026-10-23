import { cleanup, renderHook } from "@testing-library/react";
import { runAwaitingApproval } from "@workspace/contract/fixtures";
import type { RunId } from "@workspace/contract/schemas/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { treeMessages } from "../fixtures";
import { useFollowRunningReply } from "./connected-chat";

afterEach(cleanup);

const [question] = treeMessages;
if (!question) {
  throw new Error("missing question fixture");
}
const running = {
  ...runAwaitingApproval,
  userMessageId: question.id,
};
const { conversationId } = running;

describe("following a running reply", () => {
  it("follows a foreign run once idle and its question arrives", () => {
    const resumeStream = vi.fn(() => Promise.resolve());
    const createdRunId: { current: RunId | null } = { current: null };
    const { rerender } = renderHook<
      ReturnType<typeof useFollowRunningReply>,
      Parameters<typeof useFollowRunningReply>[0]
    >(useFollowRunningReply, {
      initialProps: {
        conversationId,
        createdRunId,
        messages: [],
        resumeStream,
        running,
        status: "streaming",
      },
    });
    expect(resumeStream).not.toHaveBeenCalled();
    rerender({
      conversationId,
      createdRunId,
      messages: [],
      resumeStream,
      running,
      status: "ready",
    });
    expect(resumeStream).not.toHaveBeenCalled();
    rerender({
      conversationId,
      createdRunId,
      messages: treeMessages,
      resumeStream,
      running,
      status: "ready",
    });
    expect(resumeStream).toHaveBeenCalledTimes(1);
    rerender({
      conversationId,
      createdRunId,
      messages: [...treeMessages],
      resumeStream,
      running,
      status: "ready",
    });
    expect(resumeStream).toHaveBeenCalledTimes(1);
  });

  it.each(["ready", "error"] as const)(
    "does not resume an owned run first seen as %s",
    (status) => {
      const resumeStream = vi.fn(() => Promise.resolve());
      renderHook(() =>
        useFollowRunningReply({
          conversationId,
          createdRunId: { current: running.id },
          messages: treeMessages,
          resumeStream,
          running,
          status,
        })
      );
      expect(resumeStream).not.toHaveBeenCalled();
    }
  );

  it.each(["ready", "error"] as const)(
    "does not resume a page-owned run after its stream becomes %s",
    (status) => {
      const resumeStream = vi.fn(() => Promise.resolve());
      const createdRunId = { current: running.id };
      const { rerender } = renderHook<
        ReturnType<typeof useFollowRunningReply>,
        Parameters<typeof useFollowRunningReply>[0]
      >(useFollowRunningReply, {
        initialProps: {
          conversationId,
          createdRunId,
          messages: treeMessages,
          resumeStream,
          running,
          status: "streaming",
        },
      });
      rerender({
        conversationId,
        createdRunId,
        messages: treeMessages,
        resumeStream,
        running,
        status,
      });
      expect(resumeStream).not.toHaveBeenCalled();
    }
  );
});
