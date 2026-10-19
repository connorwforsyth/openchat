"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SIDEBAR_LIST_INPUT } from "../chat/use-chat-data";
import type { ChatSidebarProps } from "./chat-sidebar";

// The sidebar's data beyond the chat list (176–178): read markers, bulk
// archive and the archive view. Optimistic on the cached list first, rolled
// back by a refetch if the server says no (D28). Both hosts (the chat screen
// and the other pages) spread the result into `ChatSidebar`.

interface ConversationPage {
  readonly items: Conversation[];
  readonly nextCursor: string | null;
}

const ARCHIVED_LIST_INPUT = { archived: true, limit: 100 } as const;

export type SidebarDataProps = Pick<
  ChatSidebarProps,
  | "archivedChats"
  | "archivedLoading"
  | "onArchiveMany"
  | "onArchivedViewChange"
  | "onSetLastRead"
>;

export const useSidebarData = (api: QueryUtils): SidebarDataProps => {
  const queryClient = useQueryClient();
  const listKey = api.conversations.list.queryKey({
    input: SIDEBAR_LIST_INPUT,
  });
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archived = useQuery({
    ...api.conversations.list.queryOptions({ input: ARCHIVED_LIST_INPUT }),
    enabled: archivedOpen,
  });

  const patchList = useCallback(
    (patch: (items: Conversation[]) => Conversation[]) =>
      queryClient.setQueryData<ConversationPage>(listKey, (page) =>
        page ? { ...page, items: patch(page.items) } : page
      ),
    [listKey, queryClient]
  );
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: api.conversations.key() }),
    [api, queryClient]
  );

  const { mutate: setState } = useMutation(
    api.conversations.updateMyState.mutationOptions({ onError: refresh })
  );
  const onSetLastRead = useCallback(
    (id: ConversationId, lastReadAt: string) => {
      patchList((items) =>
        items.map((item) =>
          item.id === id
            ? { ...item, myState: { ...item.myState, lastReadAt } }
            : item
        )
      );
      setState({ conversationId: id, lastReadAt });
    },
    [patchList, setState]
  );

  const { mutateAsync: update } = useMutation(
    api.conversations.update.mutationOptions()
  );
  const onArchiveMany = useCallback(
    async (ids: readonly ConversationId[]) => {
      const leaving = new Set(ids);
      await queryClient.cancelQueries({ queryKey: listKey });
      patchList((items) => items.filter((item) => !leaving.has(item.id)));
      const results = await Promise.allSettled(
        ids.map((id) => update({ archived: true, id }))
      );
      await refresh();
      return {
        failed: results.filter((result) => result.status === "rejected").length,
      };
    },
    [listKey, patchList, queryClient, refresh, update]
  );

  return useMemo(
    () => ({
      archivedChats: archivedOpen ? archived.data?.items : undefined,
      archivedLoading: archivedOpen && archived.isPending,
      onArchivedViewChange: setArchivedOpen,
      onArchiveMany,
      onSetLastRead,
    }),
    [
      archived.data,
      archived.isPending,
      archivedOpen,
      onArchiveMany,
      onSetLastRead,
    ]
  );
};

/**
 * Marks the open chat read up to its last message, whenever a new one lands
 * while it's open. Keyed on the message time, not the marker, so "Mark as
 * unread" on the open chat sticks until something new arrives.
 */
export const useMarkReadWhileOpen = (
  chat: Pick<Conversation, "id" | "lastMessageAt" | "myState"> | undefined,
  setLastRead: ((id: ConversationId, at: string) => void) | undefined
): void => {
  const marked = useRef<string | null>(null);
  const id = chat?.id;
  const lastMessageAt = chat?.lastMessageAt ?? null;
  const lastReadAt = chat?.myState.lastReadAt ?? null;
  useEffect(() => {
    if (!(id && lastMessageAt && setLastRead)) {
      return;
    }
    const key = `${id}@${lastMessageAt}`;
    if (marked.current === key) {
      return;
    }
    marked.current = key;
    if (lastReadAt === null || lastReadAt < lastMessageAt) {
      setLastRead(id, lastMessageAt);
    }
  }, [id, lastMessageAt, lastReadAt, setLastRead]);
};
