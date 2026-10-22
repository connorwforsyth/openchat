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
import { SIDEBAR_LIST_INPUT } from "@workspace/chat-ui/chat/use-chat-data";
import { VoiceCallButton } from "@workspace/chat-ui/voice/voice-call";
import type { VoiceBridge } from "@workspace/chat-ui/voice/voice-engine";
import {
  AUTO_TARGET,
  contextKey,
  contextOptionsFromMe,
} from "@workspace/composer/options";
import type { ContextOption, SkillOption } from "@workspace/composer/schemas";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/app/(app)/_shared/api";
import { canAdmin, useAppFrame } from "@/app/(app)/_shared/app-frame";
import { Brand } from "@/app/(app)/_shared/brand";
import { useShellPlatform } from "@/app/(app)/_shared/desktop";
import { createApiSandboxClient } from "@/app/(app)/_shared/sandbox-client";
import { useSidebarDots } from "@/app/(app)/_shared/sidebar-dots";
import {
  SpaceSwitcher,
  useSidebarSpaces,
} from "@/app/(app)/_shared/spaces/space-switcher";
import { useTerms } from "@/app/(app)/_shared/terms";
import { useAfterBoot } from "@/app/(app)/_shared/use-after-boot";
import { DotComputer } from "@/app/(app)/(pages)/dots/dot-computer";
import {
  DotHome,
  useDotForConversation,
} from "@/app/(app)/(pages)/dots/dot-home";
import { ChatSchedule } from "@/app/(app)/(pages)/schedules/chat-schedule";
import { routeParams, routes } from "@/lib/routes";

import { messageTarget, shownTarget } from "./message-target";
import {
  AGENT_TABS,
  contextForOwner,
  type UsableAgents,
  usableAgents,
} from "./usable-agents";
import { usableSkills } from "./usable-skills";

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

const NO_SKILLS: readonly SkillOption[] = [];

/**
 * Skills for the composer's + menu and `/` (127): published skills from the
 * three library tabs, like agents. Fetched once the composer is up (D27).
 */
const useSkillsForPicker = (enabled: boolean): readonly SkillOption[] => {
  const { query } = useApi();
  return useQueries({
    combine: combineSkillLists,
    queries: AGENT_TABS.map((tab) =>
      query.library.list.queryOptions({
        enabled,
        input: { kind: "skill", limit: AGENT_LIST_LIMIT, tab },
      })
    ),
  });
};

/** One list per tab, in `AGENT_TABS` order, into the composer's skills. */
const combineSkillLists = (
  lists: readonly {
    readonly data?: { readonly items: readonly LibraryItem[] };
  }[]
): readonly SkillOption[] =>
  lists.some((list) => list.data)
    ? usableSkills(
        AGENT_TABS.map((source, index) => ({
          items: lists[index]?.data?.items ?? [],
          source,
        }))
      )
    : NO_SKILLS;

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
 *
 * `pickedHere` is the last pick in the open chat (132). It wins over the
 * chat's details, which can arrive after it still naming the old model: the
 * chat loading when it was picked, or a refetch that started before the
 * update (after a turn, or the previous pick's).
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
  const [picked, setPicked] = useState<{
    readonly id: ConversationId;
    readonly target: RunTarget;
  } | null>(null);
  const pickedHere =
    picked && picked.id === conversationId ? picked.target : undefined;
  const changeTarget = useCallback(
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
      setPicked({ id: conversationId, target: next });
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
  return { changeTarget, pickedHere };
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
  const terms = useTerms();
  const platform = useShellPlatform();
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
  const contextOptions = useMemo(
    () => contextOptionsFromMe(me, config.policies.chatContexts),
    [config.policies.chatContexts, me]
  );
  const booted = useAfterBoot();
  const chatDefault = conversation.data?.defaultTarget;
  // Before the target, whose pick needs the agents' owners: a pick of an
  // agent here also set `chat.target`.
  const { agents, owners } = useAgentsForPicker(
    booted ||
      (chatDefault ?? chat.target ?? settings.data?.defaultTarget)?.type ===
        "agent"
  );
  const skills = useSkillsForPicker(booted);
  const changeContext = useContextChange(conversationId ?? null);
  const { changeTarget, pickedHere } = useTargetChange({
    contextOptions,
    conversation: conversation.data,
    conversationId: conversationId ?? null,
    onContextChange: changeContext,
    owners,
  });

  // A pick made in the open chat first (132); then the chat's own agent or
  // model (044); a new chat goes on with the last pick, then the user's
  // default.
  const target = shownTarget({
    chatDefault,
    chosen: chat.target,
    fallback: fallbackTarget,
    pickedHere,
    userDefault: settings.data?.defaultTarget,
  });
  // What a message carries: never a guess made while things load (111).
  const sendTarget = messageTarget({
    chatDefault,
    chatLoading: Boolean(conversationId) && !conversation.data,
    chosen: chat.target,
    fallback: models.data ? fallbackTarget : null,
    pickedHere,
    userDefault: settings.data?.defaultTarget,
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
  const { openSettings: openSettingsView } = frame;
  const openSettings = useCallback(
    () => openSettingsView(),
    [openSettingsView]
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

  const dot = useDotForConversation(conversationId ?? null);
  const dotName = dot?.name;
  const sidebarDots = useSidebarDots(conversationId ?? null);
  const chats = useQuery(
    query.conversations.list.queryOptions({ input: SIDEBAR_LIST_INPUT })
  );
  const sidebarSpaces = useSidebarSpaces(chats.data?.items);
  // A Dot's chat has its Call in the Dot's bar (with its face); the header's
  // stays for every other chat.
  const isDot = Boolean(dot);
  const renderVoice = useCallback(
    (bridge: VoiceBridge) =>
      conversationId && !isDot ? <VoiceCallButton bridge={bridge} /> : null,
    [conversationId, isDot]
  );
  // The Dot bar's "Computer" opens the side panel, where its live view is
  // pinned above the files; again closes it.
  const { setPanel } = layout;
  const panelOpen = layout.layout.panel !== null;
  const toggleComputer = useCallback(
    () => setPanel(panelOpen ? null : "files"),
    [panelOpen, setPanel]
  );

  if (conversationId === undefined) {
    // Not an id: the page renders the 404.
    return null;
  }
  return (
    <ConnectedChat
      agents={agents}
      artifactsHref={routes.artifacts}
      artifactsRuntimeOrigin={artifactsRuntimeOrigin}
      banner={
        <DotHome
          conversationId={conversationId}
          onOpenComputer={
            config.features.sandboxes ? toggleComputer : undefined
          }
        />
      }
      brand={<SpaceSwitcher fallback={<Brand config={config} />} />}
      client={client}
      composerPlaceholder={dotName ? t`Message ${dotName}` : undefined}
      computer={<DotComputer conversationId={conversationId} />}
      config={config}
      conversationId={conversationId}
      dotsHref={routes.dots}
      draftContext={chat.draftContext}
      headerExtra={
        isDot ? <ChatSchedule schedule={conversation.data?.schedule} /> : null
      }
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
      platform={platform}
      sandboxClient={sandboxClient}
      sendTarget={sendTarget}
      sidebarDots={sidebarDots}
      sidebarSpaces={sidebarSpaces}
      skills={skills}
      target={target}
      terms={terms}
      theme={frame.theme}
      voice={renderVoice}
    />
  );
}
