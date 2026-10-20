"use client";

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ApiClient, QueryUtils } from "@workspace/client/api";
import type { ComposerConnectors } from "@workspace/composer/props";
import type {
  ConversationId,
  LibraryItemId,
} from "@workspace/contract/schemas/common";
import type { ConnectorToolList } from "@workspace/contract/schemas/library";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  addPending,
  type PendingChange,
  toolsWithPending,
  withPending,
} from "./pending-connectors";

// A chat's connectors for the composer (188). In a chat, every switch is
// saved for that chat at once and the list refetched: the server's merge
// is the only one. In a new chat there's nothing to save to yet, so the
// changes wait (`pending-connectors.ts`) and `flush` saves them once the
// first send has made the chat, before its message goes.

const NO_TOOLS: Readonly<Partial<Record<LibraryItemId, ConnectorToolList>>> =
  {};

export const useChatConnectors = ({
  api,
  client,
  conversationId,
}: {
  readonly api: QueryUtils;
  readonly client: ApiClient;
  readonly conversationId: ConversationId | null;
}): {
  readonly composer: ComposerConnectors | undefined;
  readonly flush: (id: ConversationId) => Promise<void>;
} => {
  const queryClient = useQueryClient();
  const input = conversationId ? { conversationId } : {};
  const list = useQuery(api.connectors.list.queryOptions({ input }));
  const [wanted, setWanted] = useState<readonly LibraryItemId[]>([]);
  const [pending, setPending] = useState<readonly PendingChange[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const toolData = useQueries({
    combine: (results) => results.map((result) => result.data),
    queries: wanted.map((id) =>
      api.connectors.tools.queryOptions({
        input: conversationId ? { conversationId, id } : { id },
        // The server caches tools per connection; a minute here is plenty.
        staleTime: 60_000,
      })
    ),
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: api.connectors.key() }),
    [api, queryClient]
  );
  const { mutate: setEnabled } = useMutation(
    api.connectors.setEnabled.mutationOptions({ onSettled: refresh })
  );
  const { mutate: setToolEnabled } = useMutation(
    api.connectors.setToolEnabled.mutationOptions({ onSettled: refresh })
  );
  const { mutate: reset } = useMutation(
    api.connectors.resetConversation.mutationOptions({ onSettled: refresh })
  );

  const onToggle = useCallback(
    (id: LibraryItemId, enabled: boolean) => {
      if (conversationId) {
        setEnabled({ conversationId, enabled, id });
      } else {
        setPending((current) =>
          addPending(current, { enabled, id, kind: "connector" })
        );
      }
    },
    [conversationId, setEnabled]
  );
  const onToggleTool = useCallback(
    (id: LibraryItemId, tool: string, enabled: boolean) => {
      if (conversationId) {
        setToolEnabled({ conversationId, enabled, id, tool });
      } else {
        setPending((current) =>
          addPending(current, { enabled, id, kind: "tool", tool })
        );
      }
    },
    [conversationId, setToolEnabled]
  );
  const onReset = useCallback(() => {
    if (conversationId) {
      reset({ conversationId });
    } else {
      setPending([]);
    }
  }, [conversationId, reset]);
  const onWantTools = useCallback(
    (id: LibraryItemId) =>
      setWanted((current) =>
        current.includes(id) ? current : [...current, id]
      ),
    []
  );

  const flush = useCallback(
    async (id: ConversationId) => {
      const changes = pendingRef.current;
      if (changes.length === 0) {
        return;
      }
      setPending([]);
      // In order: a later change to the same switch wins.
      for (const change of changes) {
        // biome-ignore lint/performance/noAwaitInLoops: each change lands before the next, as made.
        await (change.kind === "connector"
          ? client.connectors.setEnabled({
              conversationId: id,
              enabled: change.enabled,
              id: change.id,
            })
          : client.connectors.setToolEnabled({
              conversationId: id,
              enabled: change.enabled,
              id: change.id,
              tool: change.tool,
            }));
      }
    },
    [client]
  );

  const shown = useMemo(
    () => (list.data ? withPending(list.data, pending) : undefined),
    [list.data, pending]
  );
  const tools = useMemo(() => {
    if (wanted.length === 0) {
      return NO_TOOLS;
    }
    const byId: Partial<Record<LibraryItemId, ConnectorToolList>> = {};
    wanted.forEach((id, index) => {
      const data = toolData[index];
      if (data) {
        byId[id] = conversationId
          ? data
          : toolsWithPending(
              shown?.connectors.find((each) => each.id === id),
              data
            );
      }
    });
    return byId;
  }, [conversationId, shown, toolData, wanted]);

  const composer = useMemo(
    (): ComposerConnectors | undefined =>
      shown && shown.connectors.length > 0
        ? {
            connectors: shown.connectors,
            customized: shown.customized,
            onReset,
            onToggle,
            onToggleTool,
            onWantTools,
            tools,
          }
        : undefined,
    [onReset, onToggle, onToggleTool, onWantTools, shown, tools]
  );
  return { composer, flush };
};
