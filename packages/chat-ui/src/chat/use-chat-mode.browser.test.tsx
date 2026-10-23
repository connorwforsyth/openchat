import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createApiClient, createQueryUtils } from "@workspace/client/api";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { type ReactNode, startTransition } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useFirstSend } from "./connected-chat";
import { useChatMode } from "./use-chat-mode";

const id = "0190a000-0000-7000-8000-00000000000a" as ConversationId;
afterEach(cleanup);
const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
it("waits for a same-tick choice and follows later server changes", async () => {
  const saved = deferred();
  const save = vi.fn(() => saved.promise);
  const { result, rerender } = renderHook(
    ({ stored }: { stored: "chat" | "code" }) => useChatMode(id, stored, save),
    { initialProps: { stored: "chat" } }
  );
  const send = vi.fn();
  let sending: Promise<void> = Promise.resolve();
  act(() => {
    result.current.onChange("code");
    sending = result.current.flush().then((ok) => {
      if (ok) {
        send();
      }
    });
  });
  expect(send).not.toHaveBeenCalled();
  expect(result.current.mode).toBe("code");
  rerender({ stored: "code" });
  await act(async () => {
    saved.resolve();
    await sending;
  });
  expect(send).toHaveBeenCalledOnce();
  rerender({ stored: "chat" });
  expect(result.current.mode).toBe("chat");
});
it("serializes choices so saves cannot land out of order or clear a newer choice", async () => {
  const first = deferred();
  const second = deferred();
  const save = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useChatMode(id, "code", save));
  await act(async () => {
    result.current.onChange("code");
    result.current.onChange("chat");
    await Promise.resolve();
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve();
    await first.promise;
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(result.current.mode).toBe("chat");
  await act(async () => {
    second.resolve();
    await result.current.flush();
  });
  expect(result.current.mode).toBe("chat");
});
it("shows failure, reverts the choice, blocks sending and allows retry", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const { result } = renderHook(() => useChatMode(id, "chat", save));
  await act(async () => {
    result.current.onChange("code");
    expect(await result.current.flush()).toBe(false);
  });
  expect(result.current.failed).toBe(true);
  expect(result.current.mode).toBe("chat");
  await act(async () => {
    result.current.onChange("code");
    expect(await result.current.flush()).toBe(true);
  });
  expect(result.current.failed).toBe(false);
});
it("reads a new chat choice immediately and carries it until the created chat loads", () => {
  const save = vi.fn();
  const { result, rerender } = renderHook(
    ({
      conversationId,
      stored,
    }: {
      conversationId: ConversationId | null;
      stored: "chat" | "code" | undefined;
    }) => useChatMode(conversationId, stored, save),
    {
      initialProps: { conversationId: null, stored: undefined } as {
        conversationId: ConversationId | null;
        stored: "chat" | "code" | undefined;
      },
    }
  );
  act(() => {
    result.current.onChange("code");
    expect(result.current.current()).toBe("code");
  });
  rerender({ conversationId: id, stored: undefined });
  expect(result.current.mode).toBe("code");
  rerender({ conversationId: id, stored: "code" });
  expect(result.current.mode).toBe("code");
  expect(save).not.toHaveBeenCalled();
});

it("holds an existing chat submit behind its same-tick mode save", async () => {
  const saved = deferred();
  const client = createApiClient({ fetch: vi.fn() });
  const queryClient = new QueryClient();
  const send = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => {
      const mode = useChatMode(id, "chat", () => saved.promise);
      const first = useFirstSend({
        api: createQueryUtils(client),
        beforeSend: mode.flush,
        client,
        context: { type: "personal" },
        conversationId: id,
        importFiles: false,
        mode: mode.current,
        onNavigate: vi.fn(),
        onWorkspaceChanged: vi.fn(),
        send,
        sendInTurn: vi.fn(),
        target: null,
      });
      return { first, mode };
    },
    { wrapper }
  );
  let submitting: Promise<void> = Promise.resolve();
  act(() => {
    result.current.mode.onChange("code");
    submitting = result.current.first.submit({
      attachments: [],
      mentions: [],
      skills: [],
      templateId: null,
      text: "build it",
    });
  });
  expect(send).not.toHaveBeenCalled();
  await act(async () => {
    saved.resolve();
    await submitting;
  });
  expect(send).toHaveBeenCalledOnce();
  queryClient.clear();
});

it.each([false, true])(
  "preserves blocked content and isolates navigation (%s)",
  async (navigate) => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const file = new File(["original contents"], "notes.txt", {
      type: "text/plain",
    });
    const uploadedId = "0190a000-0000-7000-8000-00000000000f";
    const upload = vi.fn(async () => {
      await Promise.resolve();
      return Response.json({
        id: uploadedId,
        mediaType: file.type,
        name: file.name,
      });
    });
    const client = createApiClient({ fetch: upload });
    const queryClient = new QueryClient();
    const send = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ conversationId }) => {
        const mode = useChatMode(conversationId, "chat", save);
        const first = useFirstSend({
          api: createQueryUtils(client),
          beforeSend: mode.flush,
          client,
          context: { type: "personal" },
          conversationId,
          importFiles: false,
          mode: mode.current,
          onNavigate: vi.fn(),
          onWorkspaceChanged: vi.fn(),
          send,
          sendInTurn: vi.fn(),
          target: null,
        });
        return { first, mode };
      },
      { initialProps: { conversationId: id }, wrapper }
    );
    let submitting: Promise<void> = Promise.resolve();
    act(() => {
      result.current.mode.onChange("code");
      submitting = result.current.first.submit({
        attachments: [{ file, id: "original-file" }],
        mentions: [],
        skills: [],
        templateId: null,
        text: "build it",
      });
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      await submitting;
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.first.blocked).toBe(true);
    if (navigate) {
      rerender({
        conversationId:
          "0190a000-0000-7000-8000-00000000000b" as ConversationId,
      });
      await act(async () => {
        await result.current.first.retryBlocked();
      });
      expect(send).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      expect(result.current.first.blocked).toBe(false);
      queryClient.clear();
      return;
    }
    await act(async () => {
      result.current.mode.onChange("code");
      await Promise.all([
        result.current.first.retryBlocked(),
        result.current.first.retryBlocked(),
      ]);
    });
    expect(send).toHaveBeenCalledWith("build it", {
      chips: [],
      files: [
        {
          filename: "notes.txt",
          mediaType: "text/plain",
          type: "file",
          url: `/api/files/${uploadedId}/content`,
        },
      ],
      skills: [],
      workspaceFiles: [],
    });
    expect(send).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(result.current.first.blocked).toBe(false);
    queryClient.clear();
  }
);

it("retains a saved choice while its stored query is delayed", async () => {
  const { result, rerender } = renderHook(
    ({ stored }: { stored: "chat" | "code" }) =>
      useChatMode(id, stored, async () => {
        await Promise.resolve();
      }),
    { initialProps: { stored: "chat" } }
  );
  await act(async () => {
    result.current.onChange("code");
    await result.current.flush();
  });
  expect(result.current.mode).toBe("code");
  expect(result.current.current()).toBe("code");
  rerender({ stored: "code" });
  rerender({ stored: "chat" });
  expect(result.current.mode).toBe("chat");
});

it("reads the committed mode when a newer render suspends", async () => {
  const suspended = deferred();
  const save = vi.fn();
  const { result, rerender } = renderHook(
    ({ stored, suspend }: { stored: "chat" | "code"; suspend: boolean }) => {
      const mode = useChatMode(id, stored, save);
      if (suspend) {
        throw suspended.promise;
      }
      return mode;
    },
    { initialProps: { stored: "chat", suspend: false } }
  );
  act(() => {
    startTransition(() => rerender({ stored: "code", suspend: true }));
  });
  expect(result.current.current()).toBe("chat");
  expect(await result.current.flush()).toBe(true);
  rerender({ stored: "chat", suspend: false });
  suspended.resolve();
});

it("yields a settled choice to a newer server snapshot even when another editor already switched back", async () => {
  const { result, rerender } = renderHook(
    ({ revision }) =>
      useChatMode(
        id,
        "chat",
        async () => {
          await Promise.resolve();
        },
        revision
      ),
    { initialProps: { revision: 1 } }
  );
  await act(async () => {
    result.current.onChange("code");
    await result.current.flush();
  });
  expect(result.current.mode).toBe("code");
  rerender({ revision: 2 });
  expect(result.current.mode).toBe("chat");
  expect(result.current.current()).toBe("chat");
});

it("keeps a pending send bound to its own chat when another chat saves later", async () => {
  const first = deferred();
  const save = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error("offline"));
  const { result, rerender } = renderHook(
    ({ conversationId }) => useChatMode(conversationId, "chat", save),
    { initialProps: { conversationId: id } }
  );
  let original: Promise<boolean> = Promise.resolve(false);
  act(() => {
    result.current.onChange("code");
    original = result.current.flush();
  });
  rerender({
    conversationId: "0190a000-0000-7000-8000-00000000000b" as ConversationId,
  });
  act(() => {
    result.current.onChange("code");
  });
  await act(async () => {
    first.resolve();
    expect(await original).toBe(true);
    expect(await result.current.flush()).toBe(false);
  });
});

it("waits for its own save after leaving, changing another chat and returning", async () => {
  const first = deferred();
  const second = deferred();
  const save = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result, rerender } = renderHook(
    ({ conversationId }) => useChatMode(conversationId, "chat", save),
    { initialProps: { conversationId: id } }
  );
  act(() => result.current.onChange("code"));
  rerender({
    conversationId: "0190a000-0000-7000-8000-00000000000b" as ConversationId,
  });
  act(() => result.current.onChange("code"));
  rerender({ conversationId: id });
  const send = vi.fn();
  let sending: Promise<void> = Promise.resolve();
  await act(async () => {
    sending = result.current.flush().then((saved) => {
      if (saved) {
        send();
      }
    });
    await Promise.resolve();
  });
  expect(send).not.toHaveBeenCalled();
  await act(async () => {
    first.resolve();
    await sending;
  });
  expect(send).toHaveBeenCalledOnce();
  await act(async () => {
    second.resolve();
    await second.promise;
  });
});

it("shows a save failure on returning to its chat and permits a new save", async () => {
  const first = deferred();
  const save = vi
    .fn()
    .mockImplementationOnce(async () => {
      await first.promise;
      throw new Error("offline");
    })
    .mockResolvedValue(undefined);
  const { result, rerender } = renderHook(
    ({ conversationId }) => useChatMode(conversationId, "chat", save),
    { initialProps: { conversationId: id } }
  );
  act(() => result.current.onChange("code"));
  rerender({
    conversationId: "0190a000-0000-7000-8000-00000000000b" as ConversationId,
  });
  await act(async () => {
    result.current.onChange("code");
    first.resolve();
    await result.current.flush();
  });
  expect(result.current.failed).toBe(false);
  rerender({ conversationId: id });
  expect(result.current.failed).toBe(true);
  expect(await result.current.flush()).toBe(false);
  await act(async () => {
    result.current.onChange("code");
    expect(await result.current.flush()).toBe(true);
  });
  expect(result.current.failed).toBe(false);
});
