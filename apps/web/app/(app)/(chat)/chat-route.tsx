"use client";

import { useLingui } from "@lingui/react/macro";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ConnectedChat } from "@workspace/chat-ui/chat/connected-chat";
import {
  AUTO_TARGET,
  contextKey,
  contextOptionsFromMe,
} from "@workspace/composer/options";
import {
  type ConversationId,
  conversationIdSchema,
} from "@workspace/contract/schemas/common";
import {
  AUTO_MODEL,
  type ModelOption,
} from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import type { PaletteContext } from "@workspace/palette/context-actions";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { useAppFrame } from "@/app/(app)/_shared/app-frame";
import { Brand } from "@/app/(app)/_shared/brand";
import { createApiSandboxClient } from "@/app/(app)/_shared/sandbox-client";
import { routeParams, routes } from "@/lib/routes";

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

/** Offers the palette this chat's model, context and sandbox (D14). */
const usePaletteContext = ({
  context,
  conversationId,
  locked,
  models,
  target,
}: {
  readonly context: ChatContext;
  readonly conversationId: ConversationId | null;
  readonly locked: boolean;
  readonly models: readonly ModelOption[];
  readonly target: RunTarget;
}) => {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { query } = useApi();
  const { chat, config, layout, me } = useAppFrame();
  const { setDraftContext, setPaletteContext, setTarget } = chat;
  const { mutate: setContext } = useMutation(
    query.conversations.setContext.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: query.conversations.key() }),
    })
  );
  const contextOptions = useMemo(
    () => contextOptionsFromMe(me, config.policies.chatContexts),
    [config.policies.chatContexts, me]
  );
  const { togglePanel } = layout;
  const sandboxOpen = layout.layout.panel === "sandbox";

  const paletteContext = useMemo(
    (): PaletteContext => ({
      chatContext: {
        current: contextKey(context),
        locked,
        onSelect: (key) => {
          const option = contextOptions.find(
            (each) => contextKey(each.context) === key
          );
          if (!option) {
            return;
          }
          if (conversationId) {
            setContext({ context: option.context, id: conversationId });
          } else {
            setDraftContext(option.context);
          }
        },
        options: contextOptions.map((option) => ({
          id: contextKey(option.context),
          label: option.name ?? t`Personal`,
        })),
      },
      model: {
        current: target.type === "model" ? target.model : null,
        onSelect: (selector) => setTarget({ model: selector, type: "model" }),
        options: models.map((model) => ({
          disabled: !model.available,
          id: model.selector,
          label: model.label,
        })),
      },
      sandbox: {
        available:
          config.features.sandboxes === true && conversationId !== null,
        onToggle: () => togglePanel("sandbox"),
        open: sandboxOpen,
      },
    }),
    [
      config.features.sandboxes,
      context,
      contextOptions,
      conversationId,
      locked,
      models,
      sandboxOpen,
      setContext,
      setDraftContext,
      setTarget,
      t,
      target,
      togglePanel,
    ]
  );

  useEffect(() => {
    setPaletteContext(paletteContext);
  }, [paletteContext, setPaletteContext]);
  useEffect(() => () => setPaletteContext(undefined), [setPaletteContext]);
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
  const target: RunTarget =
    chat.target ?? settings.data?.defaultTarget ?? fallbackTarget;

  usePaletteContext({
    context,
    conversationId: conversationId ?? null,
    locked: conversation.data?.contextLocked ?? false,
    models: models.data ?? NO_MODELS,
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
            disabled: t`Sandboxes aren't available on this server right now.`,
            failed: t`The sandbox didn't respond. Try again.`,
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
      onOpenAdmin={openAdmin}
      onOpenPalette={frame.openPalette}
      onOpenSettings={openSettings}
      onSignOut={frame.signOut}
      onTargetChange={chat.setTarget}
      onThemeChange={frame.setTheme}
      sandboxClient={sandboxClient}
      target={target}
      theme={frame.theme}
    />
  );
}
