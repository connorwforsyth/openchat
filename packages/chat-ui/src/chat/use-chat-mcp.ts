"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient, QueryUtils } from "@workspace/client/api";
import type { ComposerMcp } from "@workspace/composer/props";
import type {
  ConversationId,
  LibraryItemId,
} from "@workspace/contract/schemas/common";
import { useCallback, useMemo, useRef, useState } from "react";

import { addPending, type PendingChange, withPending } from "./pending-mcp";

// A chat's MCP servers for the composer (188). In a chat, every switch is
// saved for that chat at once and the list refetched: the server's merge
// is the only one. In a new chat there's nothing to save to yet, so the
// changes wait (`pending-mcp.ts`) and `flush` saves them once the first
// send has made the chat, before its message goes. Per-tool switches live
// in settings, not here.

export const useChatMcp = ({
  api,
  client,
  conversationId,
  term,
}: {
  readonly api: QueryUtils;
  readonly client: ApiClient;
  readonly conversationId: ConversationId | null;
  /** What this instance calls MCP servers (191). */
  readonly term: ComposerMcp["term"];
}): {
  readonly composer: ComposerMcp | undefined;
  readonly flush: (id: ConversationId) => Promise<void>;
} => {
  const queryClient = useQueryClient();
  const input = conversationId ? { conversationId } : {};
  const list = useQuery(api.connectors.list.queryOptions({ input }));
  const [pending, setPending] = useState<readonly PendingChange[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: api.connectors.key() }),
    [api, queryClient]
  );
  const { mutate: setEnabled } = useMutation(
    api.connectors.setEnabled.mutationOptions({ onSettled: refresh })
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
          addPending(current, { enabled, id, kind: "server" })
        );
      }
    },
    [conversationId, setEnabled]
  );
  const onReset = useCallback(() => {
    if (conversationId) {
      reset({ conversationId });
    } else {
      setPending([]);
    }
  }, [conversationId, reset]);

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
        await (change.kind === "server"
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

  const composer = useMemo(
    (): ComposerMcp | undefined =>
      shown && shown.connectors.length > 0
        ? {
            customized: shown.customized,
            onReset,
            onToggle,
            servers: shown.connectors,
            term,
          }
        : undefined,
    [onReset, onToggle, shown, term]
  );
  return { composer, flush };
};
