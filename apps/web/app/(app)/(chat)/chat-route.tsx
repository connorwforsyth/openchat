"use client";

import { useLingui } from "@lingui/react/macro";
import {
  skipToken,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ConnectedChat } from "@workspace/chat-ui/chat/connected-chat";
import {
  AUTO_TARGET,
  contextKey,
  contextOptionsFromMe,
} from "@workspace/composer/options";
import type { ContextOption } from "@workspace/composer/schemas";
import {
  type ConversationId,
  conversationIdSchema,
  type LibraryItemId,
  libraryItemIdSchema,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { LibraryItem } from "@workspace/contract/schemas/library";
import {
  AUTO_MODEL,
  type ModelOption,
} from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import type { PaletteContext } from "@workspace/palette/context-actions";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useApi } from "@/app/(app)/_shared/api";
import { canAdmin, useAppFrame } from "@/app/(app)/_shared/app-frame";
import { Brand } from "@/app/(app)/_shared/brand";
import { createApiSandboxClient } from "@/app/(app)/_shared/sandbox-client";
import { useAfterBoot } from "@/app/(app)/_shared/use-after-boot";
import { routeParams, routes } from "@/lib/routes";

import {
  AGENT_TABS,
  contextForOwner,
  type UsableAgents,
  usableAgents,
} from "./usable-agents";

// The chat screen over the API (015's `ConnectedChat`), wired to the app:
// the router owns the address, the frame owns the layout, the palette and
// the model and context choices the palette can change too.

const NO_MODELS: readonly ModelOption[] = [];

/**
 * The target before anyone picks one: `auto` where this instance offers it
 * (`models.auto`, off by default), else the first model the chat can use.
 * Defaulting to `auto` where it's off fails every first message (040's e2e).
 */
const defaultTargetFor = (models: readonly ModelOption[]): RunTarget => {
  if (
    models.length === 0 ||
    models.some((model) => model.selector === AUTO_MODEL && model.available)
  ) {
    return AUTO_TARGET;
  }
  const first = models.find((model) => model.available);
  return first ? { model: first.selector, type: "model" } : AUTO_TARGET;
};

const modelsInput = (context: ChatContext) =>
  context.type === "personal"
    ? { contextType: "personal" as const }
    : { contextId: context.id, contextType: context.type };

/** `/c/[id]`'s id; `null` for a new chat, `undefined` for one that isn't an id. */
const useConversationId = (): ConversationId | null | undefined => {
  const params = useParams<{ id?: string }>();
  if (params.id === undefined) {
    return null;
  }
  const parsed = conversationIdSchema.safeParse(params.id);
  return parsed.success ? parsed.data : undefined;
};

/** Offers the palette this chat's model, context and workspace (D14). */
const usePaletteContext = ({
  context,
  contextOptions,
  locked,
  models,
  onContextChange,
  onTargetChange,
  target,
}: {
  readonly context: ChatContext;
  readonly contextOptions: readonly ContextOption[];
  readonly locked: boolean;
  readonly models: readonly ModelOption[];
  readonly onContextChange: (context: ChatContext) => void;
  readonly onTargetChange: (target: RunTarget) => void;
  readonly target: RunTarget;
}) => {
  const { t } = useLingui();
  const { chat, layout } = useAppFrame();
  const { setPaletteContext } = chat;
  const { setPanel } = layout;
  const workspaceOpen = layout.layout.panel !== null;

  const paletteContext = useMemo(
    (): PaletteContext => ({
      chatContext: {
        current: contextKey(context),
        locked,
        onSelect: (key) => {
          const option = contextOptions.find(
            (each) => contextKey(each.context) === key
          );
          if (option) {
            onContextChange(option.context);
          }
        },
        options: contextOptions.map((option) => ({
          id: contextKey(option.context),
          label: option.name ?? t`Personal`,
        })),
      },
      model: {
        current: target.type === "model" ? target.model : null,
        onSelect: (selector) =>
          onTargetChange({ model: selector, type: "model" }),
        options: models.map((model) => ({
          disabled: !model.available,
          id: model.selector,
          label: model.label,
        })),
      },
      workspace: {
        available: true,
        onToggle: () => setPanel(workspaceOpen ? null : "files"),
        open: workspaceOpen,
      },
    }),
    [
      context,
      contextOptions,
      locked,
      models,
      onContextChange,
      onTargetChange,
      setPanel,
      t,
      target,
      workspaceOpen,
    ]
  );

  useEffect(() => {
    setPaletteContext(paletteContext);
  }, [paletteContext, setPaletteContext]);
  useEffect(() => () => setPaletteContext(undefined), [setPaletteContext]);
};

const NO_AGENTS: UsableAgents = { agents: [], owners: new Map() };
const AGENT_LIST_LIMIT = 100;

/**
 * Agents for the composer's picker (044): published agents from the three
 * library tabs. Fetched once the composer is up (D27), or straight away when
 * the chat already talks to an agent, whose name the picker shows.
 */
const useAgentsForPicker = (enabled: boolean): UsableAgents => {
  const { query } = useApi();
  return useQueries({
    combine: combineAgentLists,
    queries: AGENT_TABS.map((tab) =>
      query.library.list.queryOptions({
        enabled,
        input: { kind: "agent", limit: AGENT_LIST_LIMIT, tab },
      })
    ),
  });
};

/** One list per tab, in `AGENT_TABS` order, into the picker's agents. */
const combineAgentLists = (
  lists: readonly {
    readonly data?: { readonly items: readonly LibraryItem[] };
  }[]
): UsableAgents =>
  lists.some((list) => list.data)
    ? usableAgents(
        AGENT_TABS.map((source, index) => ({
          items: lists[index]?.data?.items ?? [],
          source,
        }))
      )
    : NO_AGENTS;

/** `/?agent=<id>` ("Use in chat" in the library) starts the new chat with that agent. */
const useAgentParam = (
  conversationId: ConversationId | null | undefined
): LibraryItemId | null => {
  const searchParams = useSearchParams();
  if (conversationId !== null) {
    return null;
  }
  const parsed = libraryItemIdSchema.safeParse(
    searchParams.get(routeParams.agent)
  );
  return parsed.success ? parsed.data : null;
};

/**
 * Picking what answers (044). In a new chat it's the draft's choice; in an
 * existing one it becomes the chat's default, so the chat continues with it
 * after a reload. An agent from a team or org library also moves a chat that
 * hasn't started yet into that team or org (D17).
 */
const useTargetChange = ({
  contextOptions,
  conversation,
  conversationId,
  onContextChange,
  owners,
}: {
  readonly contextOptions: readonly ContextOption[];
  readonly conversation: Conversation | undefined;
  readonly conversationId: ConversationId | null;
  readonly onContextChange: (context: ChatContext) => void;
  readonly owners: UsableAgents["owners"];
}) => {
  const queryClient = useQueryClient();
  const { query } = useApi();
  const { chat } = useAppFrame();
  const { setTarget } = chat;
  const { mutate: update } = useMutation(
    query.conversations.update.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: query.conversations.key() }),
    })
  );
  const locked = conversation?.contextLocked ?? false;
  return useCallback(
    (next: RunTarget) => {
      setTarget(next);
      const suggested =
        next.type === "agent" && !locked
          ? contextForOwner(owners.get(next.id), contextOptions)
          : null;
      if (suggested) {
        onContextChange(suggested);
      }
      if (!conversationId) {
        return;
      }
      queryClient.setQueryData<Conversation>(
        query.conversations.get.queryKey({ input: { id: conversationId } }),
        (current) => (current ? { ...current, defaultTarget: next } : current)
      );
      update({ defaultTarget: next, id: conversationId });
    },
    [
      contextOptions,
      conversationId,
      locked,
      onContextChange,
      owners,
      query,
      queryClient,
      setTarget,
      update,
    ]
  );
};

/** Changing the chat context: the draft's, or (until it locks) the chat's. */
const useContextChange = (conversationId: ConversationId | null) => {
  const queryClient = useQueryClient();
  const { query } = useApi();
  const { chat } = useAppFrame();
  const { setDraftContext } = chat;
  const { mutate: setContext } = useMutation(
    query.conversations.setContext.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: query.conversations.key() }),
    })
  );
  return useCallback(
    (next: ChatContext) => {
      if (conversationId) {
        setContext({ context: next, id: conversationId });
      } else {
        setDraftContext(next);
      }
    },
    [conversationId, setContext, setDraftContext]
  );
};

export function ChatRoute({
  artifactsRuntimeOrigin,
}: {
  /** From `ARTIFACTS_ORIGIN` on the server; `null` previews in `srcdoc`. */
  readonly artifactsRuntimeOrigin: string | null;
}) {
  const { t } = useLingui();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = useConversationId();
  const { client, query } = useApi();
  const frame = useAppFrame();
  const { chat, config, layout, me } = frame;

  const conversation = useQuery(
    query.conversations.get.queryOptions({
      input: conversationId ? { id: conversationId } : skipToken,
    })
  );
  const context = conversation.data?.context ?? chat.draftContext;
  const settings = useQuery(query.me.settings.queryOptions());
  const models = useQuery(
    query.meta.models.queryOptions({ input: modelsInput(context) })
  );
  // Memoised: the target feeds the palette context, which must stay stable.
  const fallbackTarget = useMemo(
    () => defaultTargetFor(models.data ?? NO_MODELS),
    [models.data]
  );
  // An open chat continues with its own agent or model (044); a new one
  // with the last pick, then the user's default.
  const target: RunTarget =
    conversation.data?.defaultTarget ??
    chat.target ??
    settings.data?.defaultTarget ??
    fallbackTarget;

  const contextOptions = useMemo(
    () => contextOptionsFromMe(me, config.policies.chatContexts),
    [config.policies.chatContexts, me]
  );
  const booted = useAfterBoot();
  const { agents, owners } = useAgentsForPicker(
    booted || target.type === "agent"
  );
  const changeContext = useContextChange(conversationId ?? null);
  const changeTarget = useTargetChange({
    contextOptions,
    conversation: conversation.data,
    conversationId: conversationId ?? null,
    onContextChange: changeContext,
    owners,
  });

  // "Use in chat": the library links here with the agent to start with.
  const agentParam = useAgentParam(conversationId);
  const agentOwner = agentParam ? owners.get(agentParam) : undefined;
  const appliedAgent = useRef<string | null>(null);
  useEffect(() => {
    // Once for the agent, and once more when its owner (who may move the
    // draft's context) arrives with the agent list; never over a later pick.
    const key = agentParam && `${agentParam}:${agentOwner ? "owner" : ""}`;
    if (key && appliedAgent.current !== key) {
      appliedAgent.current = key;
      changeTarget({ id: agentParam, type: "agent" });
    }
  }, [agentParam, agentOwner, changeTarget]);

  usePaletteContext({
    context,
    contextOptions,
    locked: conversation.data?.contextLocked ?? false,
    models: models.data ?? NO_MODELS,
    onContextChange: changeContext,
    onTargetChange: changeTarget,
    target,
  });

  const navigate = useCallback(
    (id: ConversationId | null) =>
      router.push(id ? routes.chat(id) : routes.home),
    [router]
  );
  const openAdmin = useCallback(() => router.push(routes.admin), [router]);
  const openSettings = useCallback(
    () => router.push(routes.settings()),
    [router]
  );
  const sandboxClient = useMemo(
    () =>
      conversationId && config.features.sandboxes
        ? createApiSandboxClient(client, conversationId, {
            disabled: t`The workspace isn't available on this server right now.`,
            failed: t`The workspace didn't respond. Try again.`,
          })
        : null,
    [client, config.features.sandboxes, conversationId, t]
  );

  if (conversationId === undefined) {
    // Not an id: the page renders the 404.
    return null;
  }
  return (
    <ConnectedChat
      agents={agents}
      artifactsRuntimeOrigin={artifactsRuntimeOrigin}
      brand={<Brand config={config} />}
      client={client}
      config={config}
      conversationId={conversationId}
      draftContext={chat.draftContext}
      initialPrompt={
        conversationId ? null : searchParams.get(routeParams.askAi)
      }
      layout={layout}
      libraryHref={routes.library}
      me={me}
      models={models.data ?? NO_MODELS}
      onDraftContextChange={chat.setDraftContext}
      onNavigate={navigate}
      onNewOrg={frame.openNewOrg}
      onOpenAdmin={canAdmin(me) ? openAdmin : undefined}
      onOpenPalette={frame.openPalette}
      onOpenSettings={openSettings}
      onSignOut={frame.signOut}
      onTargetChange={changeTarget}
      onThemeChange={frame.setTheme}
      sandboxClient={sandboxClient}
      target={target}
      theme={frame.theme}
    />
  );
}
