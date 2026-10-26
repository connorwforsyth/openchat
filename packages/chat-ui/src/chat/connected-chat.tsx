"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  skipToken,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CHIPS_DATA,
  chipsOf,
  replaceChips,
} from "@workspace/ai/messages/chips";
import { SKILLS_DATA } from "@workspace/ai/messages/skills";
import { toUIMessages } from "@workspace/ai/messages/to-ui";
import { WORKSPACE_FILE_DATA } from "@workspace/ai/messages/workspace-file";
import {
  type ApiClient,
  createQueryUtils,
  type QueryUtils,
} from "@workspace/client/api";
import { type RunCreated, userParts } from "@workspace/client/run-transport";
import { useRunChat } from "@workspace/client/use-run-chat";
import { contextOptionsFromMe } from "@workspace/composer/options";
import { NEW_CHAT_DRAFT_KEY } from "@workspace/composer/ports/draft-store";
import {
  browserStorage,
  createStorageDraftStore,
} from "@workspace/composer/ports/draft-store.storage";
import { promptHistory } from "@workspace/composer/prompt-history";
import type {
  ComposerChatMode,
  ComposerProps,
} from "@workspace/composer/props";
import type {
  AgentOption,
  ArtifactOption,
  AttachmentLimits,
  ComposerAttachment,
  ComposerStatus,
  ComposerValue,
  MentionToken,
  PickedSkillOption,
  PromptOption,
  SkillOption,
} from "@workspace/composer/schemas";
import type { ModelVariant } from "@workspace/composer/variants";
import { defaultTerms, type Terms } from "@workspace/config/terms";
import type {
  ArtifactId,
  ArtifactVersionId,
  ConversationId,
  FileId,
  MessageId,
  RunId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type {
  ApprovalDecision,
  MessagePart,
} from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Me, PublicConfig } from "@workspace/contract/schemas/meta";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type {
  ChatMode,
  PendingApproval,
  Run,
  RunOptions,
  RunTarget,
} from "@workspace/contract/schemas/runs";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { SquareIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import type { FileUIPart, UIMessage } from "ai";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useOfferedKinds } from "../artifacts/use-offered-kinds";
import type { ConversationActions } from "../conversation/actions";
import {
  type DecisionState,
  type RunActivity,
  RunActivityProvider,
} from "../conversation/approval-state";
import { ShowModesContext } from "../conversation/mode-note";
import { PlanStatusProvider } from "../conversation/plan-card";
import { staleEdits } from "../model/approval";
import {
  artifactKindLabels,
  starterKinds,
  starterLabels,
} from "../model/artifact-kinds";
import type { RunSignal } from "../model/attention";
import { newestLeafUnder, type TreeNode } from "../model/branch";
import {
  type FirstSend,
  firstSendBusy,
  firstSendFailed,
  firstSendNext,
  firstSendQueued,
  firstSendStarted,
} from "../model/first-send";
import { type LiveMapping, mergeLive } from "../model/live-messages";
import type { MemoryUpdate } from "../model/parts";
import {
  approvedPlanIds,
  type PlanRef,
  planApprovalMessage,
  planApprovalParts,
} from "../model/plan";
import {
  answerPhases,
  runToFollow,
  stoppableRun,
  unseenApprovals,
  unsettledCalls,
  waitingCalls,
  waitingForPerson,
} from "../model/run-activity";
import { skillRevision } from "../model/skill-authoring";
import {
  type WorkspaceSelection,
  workspacePath,
  workspaceRevision,
} from "../model/workspace";
import type { Platform } from "../shell/platform";
import type { ShellLayoutState } from "../shell/use-shell-layout";
import type { Theme } from "../sidebar/account-menu";
import type { ChatSidebarProps } from "../sidebar/chat-sidebar";
import {
  useMarkReadWhileOpen,
  useSidebarData,
} from "../sidebar/use-sidebar-data";
import { createRunReplyPorts, createVoiceReplies } from "../voice/reply";
import { VoiceBridgeContext } from "../voice/voice-bridge";
import type { VoiceBridge } from "../voice/voice-engine";
import type {
  WorkspaceClient,
  WorkspaceFilesSource,
} from "../workspace/model/client";
import { toTreePaths } from "../workspace/model/tree";
import { ChatScreen } from "./chat-screen";
import { PresentPeople, TypingNote } from "./live-presence";
import { useBranchFeedback } from "./use-branch-feedback";
import { useChatQueries, useConversationUpdate } from "./use-chat-data";
import { useChatMcp } from "./use-chat-mcp";
import { useChatMode } from "./use-chat-mode";
import { useLiveConversation } from "./use-live-conversation";

// The chat screen over the API (D11): TanStack Query for everything stored,
// `useRunChat` for the turn that's streaming. Ticket 025 mounts this in the
// app (inside a QueryClientProvider); the screen stays presentational.

export interface ConnectedChatProps {
  /** Agents the caller can use, for the composer's picker (`target` and `onTargetChange`). */
  readonly agents?: readonly AgentOption[];
  /** Where the Artifacts page lives (124). */
  readonly artifactsHref?: string;
  /**
   * The artifact runtime's origin (`ARTIFACTS_ORIGIN`, D24), normalised with
   * `runtimeOriginFrom`. Omitted or `null`, previews fall back to `srcdoc`.
   */
  readonly artifactsRuntimeOrigin?: string | null;
  /** A bar above the messages (a Dot's schedule, 172). */
  readonly banner?: ReactNode;
  readonly brand?: ReactNode;
  /**
   * Offer the composer's Chat / Code switch (not in a Dot's chat, which is
   * outside it). It shows only while the instance has `features.chatModes` on.
   */
  readonly chatModes?: boolean;
  readonly client: ApiClient;
  /** Placeholder for the composer ("Message Pip" in a Dot's chat, 172). */
  readonly composerPlaceholder?: string;
  /** A live view above the Workspace panel (a Dot's computer, 172). */
  readonly computer?: ReactNode;
  readonly config: PublicConfig;
  /** `null` opens a new, not-yet-created chat. */
  readonly conversationId: ConversationId | null;
  /** Where the Dots page lives (172), for the sidebar. */
  readonly dotsHref?: string;
  /**
   * The context a new chat starts in. Pass it with `onDraftContextChange` when
   * something outside the screen (the ⌘K palette) can change it too.
   */
  readonly draftContext?: ChatContext;
  /** More of the header's end, before the call button: the chat's schedule (183). */
  readonly headerExtra?: ReactNode;
  /** A new chat sends this once, as soon as it mounts ("Ask AI" in ⌘K). */
  readonly initialPrompt?: string | null;
  /** The shell's layout, when the app owns it (see `ChatScreenProps.layout`). */
  readonly layout?: ShellLayoutState;
  /** Where the library lives (ticket 017). */
  readonly libraryHref?: string;
  readonly me: Me;
  /** The picker's models (`meta.models`); the picker shows with `target` and `onTargetChange`. */
  readonly models?: readonly ModelOption[];
  readonly onDraftContextChange?: (context: ChatContext) => void;
  /** Route to a chat (or `null` for a new one); the app owns the URL. */
  readonly onNavigate: (conversationId: ConversationId | null) => void;
  /** "New organisation" in the account menu. */
  readonly onNewOrg?: () => void;
  /** Shown to the instance admin and to org owners and admins. */
  readonly onOpenAdmin?: () => void;
  readonly onOpenPalette?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onSignOut: () => void;
  readonly onTargetChange?: (target: RunTarget) => void;
  readonly onThemeChange: (theme: Theme) => void;
  readonly platform?: Platform;
  /** Prompt templates the caller can use, for the composer's menu. */
  readonly prompts?: readonly PromptOption[];
  /**
   * The Workspace panel's port over the API, for this chat; `null` for a
   * chat that doesn't exist yet or when sandboxes are off (`config.features`
   * tells the two apart).
   */
  readonly sandboxClient: WorkspaceClient | null;
  /**
   * What goes out with a message, when it differs from what the picker
   * shows: `null` while the chat's own target is still loading, so the
   * server answers with the chat's default rather than a guess (111).
   * Omitted, `target` goes out.
   */
  readonly sendTarget?: RunTarget | null;
  /** The sidebar's Dot slots (172): `top` and `dots` of `ChatSidebarProps`. */
  readonly sidebarDots?: Pick<
    ChatSidebarProps,
    | "dot"
    | "dotFace"
    | "dots"
    | "nextRuns"
    | "schedulesHref"
    | "signals"
    | "top"
  >;
  /** Each chat's space by name (187): `spaces` of `ChatSidebarProps`. */
  readonly sidebarSpaces?: ChatSidebarProps["spaces"];
  /** Skills the caller can use (127), for the composer's + menu and `/`. */
  readonly skills?: readonly SkillOption[];
  /** What answers: a model or an agent. Omitted, the server's default does. */
  readonly target?: RunTarget | null;
  /** What this instance calls its features (191); the defaults when left out. */
  readonly terms?: Terms;
  readonly theme: Theme;
  /**
   * A voice call on this chat (172): rendered in the header with the chat
   * as a `VoiceBridge`, so what's said is sent and answered like typing.
   * Only for a chat that exists.
   */
  readonly voice?: (bridge: VoiceBridge) => ReactNode;
}

/**
 * The chat as a voice call sees it (172): a turn is sent like typing, and
 * its reply is followed by run, not guessed from what's on screen.
 */
const useVoiceBridge = (
  client: Pick<ApiClient, "messages" | "runs">,
  send: (text: string) => Promise<RunId | null>
): VoiceBridge =>
  useMemo(
    () => ({
      replies: createVoiceReplies(createRunReplyPorts({ client, send })),
    }),
    [client, send]
  );

const voiceSlot = (
  voice: ConnectedChatProps["voice"],
  conversationId: ConversationId | null,
  bridge: VoiceBridge
): ReactNode => (voice && conversationId ? voice(bridge) : null);

/** Extra header content, if any, sits before the voice slot. */
const headerEndOf = (extra: ReactNode, voiceNode: ReactNode): ReactNode =>
  extra ? (
    <>
      {extra}
      {voiceNode}
    </>
  ) : (
    voiceNode
  );

/** The bridge for call buttons outside the header; none before the chat exists. */
const bridgeOf = (
  conversationId: ConversationId | null,
  bridge: VoiceBridge
): VoiceBridge | null => (conversationId ? bridge : null);

const fileUrl = (fileId: FileId): string => `/api/files/${fileId}/content`;
/** A generated image's bytes (138), served by its artifact version. */
const artifactImageUrl = (
  artifactId: ArtifactId,
  versionId: ArtifactVersionId
): string => `/api/artifacts/${artifactId}/versions/${versionId}/image`;

const ignore = () => undefined;

const MAX_ATTACHMENTS = 10;
const BYTES_PER_MB = 1024 * 1024;

/** What the composer may attach: nothing when uploads are off (D18 `features`). */
const attachmentLimitsFor = (config: PublicConfig): AttachmentLimits =>
  config.features.fileUploads === false
    ? { maxFiles: 0 }
    : {
        maxFileSize: Math.floor(config.limits.uploadMaxMb * BYTES_PER_MB),
        maxFiles: MAX_ATTACHMENTS,
      };

interface Uploaded {
  readonly fileId: FileId;
  readonly part: FileUIPart;
}

/**
 * Uploads a turn's attachments through the files API, as the file parts the
 * run transport turns back into stored file references.
 */
const uploadAttachments = (
  client: ApiClient,
  conversationId: ConversationId,
  attachments: readonly ComposerAttachment[]
): Promise<Uploaded[]> =>
  Promise.all(
    attachments.map(async ({ file }) => {
      const uploaded = await client.files.upload({
        conversationId,
        file,
        purpose: "attachment",
      });
      return {
        fileId: uploaded.id,
        part: {
          filename: uploaded.name,
          mediaType: uploaded.mediaType,
          type: "file" as const,
          url: fileUrl(uploaded.id),
        },
      };
    })
  );

/**
 * Copies uploaded attachments into the chat's workspace (D7), so the agent
 * and the Files panel have them too; resolves to their workspace paths. One
 * at a time, so names that collide get distinct free names. An import that
 * fails leaves the attachment as it is: the message still goes.
 */
const importToWorkspace = async (
  client: ApiClient,
  conversationId: ConversationId,
  uploaded: readonly Uploaded[]
): Promise<string[]> => {
  const paths: string[] = [];
  for (const { fileId } of uploaded) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose.
      const imported = await client.sandbox.importFile({
        conversationId,
        fileId,
      });
      paths.push(workspacePath(imported.path));
    } catch {
      // Not imported (no workspace here, a cap): the upload still counts.
    }
  }
  return paths;
};

/** What a turn sends besides its text. */
interface Outgoing {
  /** The message's chips (`@agent`, `@Slides`), sent as a `data-chips` part. */
  readonly chips?: readonly MentionToken[];
  readonly files: FileUIPart[];
  /** Skills picked for the message (127), sent as a `data-skills` part. */
  readonly skills?: readonly PickedSkillOption[];
  /** Workspace files the message mentions, sent as `data-workspace-file` parts (056). */
  readonly workspaceFiles: readonly string[];
}

const NOTHING_ELSE: Outgoing = { files: [], workspaceFiles: [] };

/**
 * The message `useChat` sends: its attachments, its text, then a
 * `data-workspace-file` part per mentioned workspace file, which the server
 * reads into the turn when it starts, and a `data-skills` part with the
 * skills picked for it (127), which the run transport sends as
 * `input.skills` and the chat shows until the stored message replaces it,
 * and a `data-chips` part saying where the text's chips are, which the
 * server acts on and the sent message draws. Pure.
 */
export const outgoingMessage = (
  text: string,
  { chips = [], files, skills = [], workspaceFiles }: Outgoing
) =>
  workspaceFiles.length === 0 && skills.length === 0 && chips.length === 0
    ? { files, text }
    : {
        parts: [
          ...files,
          { text, type: "text" as const },
          ...[...new Set(workspaceFiles)].map((path) => ({
            data: { path },
            type: `data-${WORKSPACE_FILE_DATA}` as const,
          })),
          ...(skills.length > 0
            ? [
                {
                  data: {
                    skills: skills.map(({ id, name, versionId }) => ({
                      id,
                      name,
                      ...(versionId ? { versionId } : {}),
                    })),
                  },
                  type: `data-${SKILLS_DATA}` as const,
                },
              ]
            : []),
          ...(chips.length > 0
            ? [
                {
                  data: { chips: [...chips] },
                  type: `data-${CHIPS_DATA}` as const,
                },
              ]
            : []),
        ],
      };

/**
 * What an edited message sends besides its text: the chips it was written
 * with that are still in it, so an `@agent` still answers and a skill
 * still loads. The edit form is plain text. Pure.
 */
export const editedOutgoing = (
  text: string,
  parts: readonly MessagePart[]
): Outgoing => {
  const chips = replaceChips(text, chipsOf(parts));
  return {
    chips,
    files: [],
    skills: chips.flatMap((chip) =>
      chip.kind === "skill"
        ? [
            {
              id: chip.id,
              name: chip.label,
              ...(chip.versionId ? { versionId: chip.versionId } : {}),
            },
          ]
        : []
    ),
    workspaceFiles: chips.flatMap((chip) =>
      chip.kind === "file" ? [chip.path] : []
    ),
  };
};

/** Mentioned workspace files, in text order. Pure. */
const mentionedFiles = (value: ComposerValue): string[] =>
  value.mentions.flatMap((mention) =>
    mention.kind === "file" ? [mention.path] : []
  );

/** Whether this turn searches the web: switched on, on an instance that can. */
const webSearchOn = (config: PublicConfig, on: boolean): boolean =>
  on && config.features.webSearch === true;

/**
 * The turn's switches for the run's `options`: web search, the thinking
 * level and fast tier (105), and plan mode (106). Left out when all are at
 * their defaults, so the Decider and the provider choose. Pure.
 */
export const turnOptions = (
  webSearch: boolean,
  variant: ModelVariant,
  plan = false
): RunOptions | undefined =>
  webSearch || variant.reasoning || variant.fast || plan
    ? {
        sandbox: "auto",
        webSearch: webSearch ? "on" : "auto",
        ...(variant.reasoning ? { reasoning: variant.reasoning } : {}),
        ...(variant.fast ? { fast: true } : {}),
        ...(plan ? { mode: "plan" as const } : {}),
      }
    : undefined;

/** A run's stored parts from a sent message: the usual ones, and a plan approval (106). */
const sentParts = (message: UIMessage) => [
  ...userParts(message),
  ...planApprovalParts(message),
];

/**
 * Plan mode's switch (106), with a ref the run's fields read when a message
 * goes, so approving a plan can turn it off for that very message.
 */
const usePlanSwitch = () => {
  const [on, setOn] = useState(false);
  const ref = useRef(false);
  const set = useCallback((next: boolean) => {
    ref.current = next;
    setOn(next);
  }, []);
  return { on, ref, set };
};

/** The composer's web search switch, offered only where the instance has it (D18 `features`). */
const webSearchSwitch = (
  config: PublicConfig,
  on: boolean,
  onChange: (on: boolean) => void
): Pick<ComposerProps, "onWebSearchChange" | "webSearch"> =>
  config.features.webSearch === true
    ? { onWebSearchChange: onChange, webSearch: on }
    : {};

/** Whether the chat shows Chat / Code: offered here and on in the instance. Pure. */
const showsModes = (
  config: PublicConfig,
  offered: boolean | undefined
): boolean => offered === true && config.chatModes === true;

/**
 * The Chat / Code switch, and the menu held to the mode, where the chat is
 * inside the switch and the instance has sandboxes. Pure.
 */
const chatModeSwitch = (
  config: PublicConfig,
  shown: boolean,
  chatMode: ComposerChatMode
): Pick<ComposerProps, "chatMode" | "mode"> =>
  shown && config.features.sandboxes ? { chatMode, mode: chatMode.mode } : {};

/** What message rows read from the screen: run activity, and whether modes show. */
function RowContexts({
  activity,
  children,
  showModes,
}: {
  readonly activity: RunActivity;
  readonly children: ReactNode;
  readonly showModes: boolean;
}) {
  return (
    <RunActivityProvider value={activity}>
      <ShowModesContext.Provider value={showModes}>
        {children}
      </ShowModesContext.Provider>
    </RunActivityProvider>
  );
}

/** Paths the composer offers: files only, relative to the workspace. Pure. */
const filePaths = (
  entries: Parameters<typeof toTreePaths>[0] | undefined
): readonly string[] =>
  entries ? toTreePaths(entries).filter((path) => !path.endsWith("/")) : [];

/** Whether the workspace's files can be listed right now. */
const listable = (sandbox: SandboxRecord | null): sandbox is SandboxRecord =>
  sandbox?.status.state === "ready" || sandbox?.status.state === "stopped";

/** Whether attachments can go into a workspace on this instance. */
const canImport = (config: PublicConfig): boolean =>
  config.features.sandboxes === true && config.sandbox.default !== null;

/**
 * Whether `/preview` can do anything: a workspace serves previews unless it
 * runs on just-bash. An existing one says which provider it's on (Docker
 * falls back to just-bash when it's down, 056); a new one will use the
 * instance's default.
 */
const canPreviewOn = (
  config: PublicConfig,
  sandbox: SandboxRecord | null
): boolean => {
  const provider = sandbox?.provider ?? config.sandbox.default;
  return provider !== null && provider !== "just-bash";
};

/**
 * The turn being written: `useChat` over runs, seeded with the stored branch
 * (so edits and regenerations know their parent), and the branch as the
 * view shows it, stored path plus live tail.
 */
const useLiveTurn = ({
  client,
  context,
  conversationId,
  me,
  onFinish,
  onRunCreated,
  plan,
  stored,
  storedAt,
  target,
  variant,
  webSearch,
}: {
  readonly client: ApiClient;
  readonly context: ChatContext;
  readonly conversationId: ConversationId | null;
  readonly me: Me;
  readonly onFinish: () => void;
  readonly onRunCreated: (run: RunCreated) => void;
  /** Plan mode, read as each message goes (106). */
  readonly plan: { readonly current: boolean };
  readonly stored: readonly Message[];
  /** When the stored branch was last fetched (`dataUpdatedAt`). */
  readonly storedAt: number;
  readonly target: RunTarget | null;
  /** The chosen model's thinking level and fast tier (105). */
  readonly variant: ModelVariant;
  /** Switched on in the composer's + menu: search the web this turn. */
  readonly webSearch: boolean;
}) => {
  const initialMessages = useMemo(
    () => toUIMessages(stored, { fileUrl }),
    [stored]
  );
  const fieldsRef = useRef({ context, target, variant, webSearch });
  useEffect(() => {
    fieldsRef.current = { context, target, variant, webSearch };
  });
  const chat = useRunChat({
    client,
    conversationId: conversationId ?? "new",
    initialMessages,
    onFinish,
    onRunCreated,
    runFields: () => {
      const fields = fieldsRef.current;
      const options = turnOptions(
        fields.webSearch,
        fields.variant,
        plan.current
      );
      return {
        context: fields.context,
        // Web search off means "let the Decider choose" (`auto`).
        ...(options ? { options } : {}),
        ...(fields.target ? { target: fields.target } : {}),
      };
    },
    toParts: sentParts,
  });
  const { messages: live, setMessages, status } = chat;
  const busy = status === "submitted" || status === "streaming";
  const settling = useSettling({ busy, conversationId, storedAt });

  // Back on the stored branch whenever nothing streams and the branch has
  // caught up: after a switch, a refetch, or the refetch after a turn.
  useEffect(() => {
    if (!(busy || settling)) {
      setMessages(initialMessages);
    }
  }, [busy, initialMessages, setMessages, settling]);

  const last = live.at(-1);
  const lastAnswer = last?.role === "assistant" ? (last.id as MessageId) : null;
  const streamingMessageId = busy ? lastAnswer : null;
  // Until then the finished answer stays as streamed.
  const liveMessageId = busy || settling ? lastAnswer : null;
  const cache = useRef(new WeakMap<UIMessage, LiveMapping>());
  const messages = useMemo(
    () =>
      conversationId
        ? mergeLive(
            stored,
            live,
            {
              authorId: me.user.id,
              conversationId,
              now: new Date().toISOString(),
            },
            cache.current,
            liveMessageId
          )
        : stored,
    [conversationId, live, liveMessageId, me.user.id, stored]
  );

  return { chat, messages, streamingMessageId };
};

/** A new chat's context: the caller's when it passes one, else the screen's own. */
const useDraftContext = (
  controlled: ChatContext | undefined,
  onChange: ((context: ChatContext) => void) | undefined
) => {
  const [own, setOwn] = useState<ChatContext>({ type: "personal" });
  const set = useCallback(
    (next: ChatContext) => {
      setOwn(next);
      onChange?.(next);
    },
    [onChange]
  );
  return [controlled ?? own, set] as const;
};

/**
 * "Ask AI" opens a new chat that sends its prompt straight away, once per
 * visit to the new chat.
 */
const useAskOnce = (
  prompt: string | null | undefined,
  conversationId: ConversationId | null,
  submit: (value: ComposerValue) => void
) => {
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId !== null) {
      asked.current = null;
      return;
    }
    if (prompt && asked.current !== prompt) {
      asked.current = prompt;
      submit({
        attachments: [],
        mentions: [],
        skills: [],
        templateId: null,
        text: prompt,
      });
    }
  }, [conversationId, prompt, submit]);
};

/** Why a send failed, as far as the person can act on it. Pure. */
export type RunFailure =
  | { readonly type: "allowance_spent" }
  | { readonly type: "budget_exceeded" }
  | { readonly type: "failed" };

/**
 * Reads the oRPC error `runs.create` threw. A spent allowance (192) or
 * budget (D24) is the person's to resolve, not a retry, so it says so.
 */
export const runFailure = (error: unknown): RunFailure => {
  const code =
    typeof error === "object" && error !== null
      ? (error as { readonly code?: unknown }).code
      : undefined;
  switch (code) {
    case "ALLOWANCE_SPENT":
      return { type: "allowance_spent" };
    case "BUDGET_EXCEEDED":
      return { type: "budget_exceeded" };
    default:
      return { type: "failed" };
  }
};

function RunError({
  error,
  modeFailed,
  onRetryMode,
  modeBlocked,
  onStop,
  uploadFailed,
  waiting,
}: {
  /** The send's error, if it failed. */
  readonly error: Error | undefined;
  readonly modeFailed: boolean;
  readonly modeBlocked: boolean;
  readonly onRetryMode: () => void;
  /** Stops the waiting answer (the composer offers Send while it waits). */
  readonly onStop: () => void;
  readonly uploadFailed: boolean;
  /** The answer waits for the person's decision on a change above. */
  readonly waiting: boolean;
}) {
  const { t } = useLingui();
  if (modeFailed || modeBlocked) {
    return (
      <div
        className="flex items-center justify-between gap-2 text-destructive text-sm"
        role="alert"
      >
        <p>
          {modeFailed ? (
            <Trans>
              The mode couldn't be saved. Choose the mode again to retry.
            </Trans>
          ) : (
            <Trans>
              The message is waiting. Retry to send it in the selected mode.
            </Trans>
          )}
        </p>
        {modeBlocked ? (
          <Button
            disabled={modeFailed}
            onClick={onRetryMode}
            size="sm"
            variant="outline"
          >
            <Trans>Retry</Trans>
          </Button>
        ) : null}
      </div>
    );
  }
  const failed = error !== undefined;
  const failureText = (failure: RunFailure): string => {
    switch (failure.type) {
      case "allowance_spent":
        return t`You have no tokens left this month in the space that limits this chat. Ask an owner there for an allowance in its Token allowance settings.`;
      case "budget_exceeded":
        return t`The budget for this period is spent. Try again once it resets.`;
      case "failed":
        return t`The answer failed. Try again, or regenerate it.`;
      default:
        return failure satisfies never;
    }
  };
  if (waiting && !(uploadFailed || failed)) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-muted-foreground text-sm"
        role="status"
      >
        <span>
          <Trans>
            Waiting for your approval above. Send a new message to skip the
            pending change instead.
          </Trans>
        </span>
        <Button onClick={onStop} size="sm" variant="outline">
          <SquareIcon aria-hidden data-icon="inline-start" />
          <Trans>Stop</Trans>
        </Button>
      </div>
    );
  }
  if (!(uploadFailed || failed)) {
    return null;
  }
  return (
    <p className="text-destructive text-sm" role="alert">
      {uploadFailed
        ? t`The message couldn't be sent: an attachment didn't upload. Try again.`
        : failureText(runFailure(error))}
    </p>
  );
}

/** Tool calls on screen that wait for a decision. Pure. */
const pendingCallIds = (messages: readonly Message[]): string =>
  waitingCalls(messages).join(" ");

/**
 * A reply that pauses for approval does so mid-stream, and the stream
 * doesn't carry the run's pending approvals: the proposed edits a reviewer
 * decides hunk by hunk (D16) are on the run. So a call waiting on screen
 * that the fetched run doesn't list yet fetches it again (040's e2e: the
 * card offered only approve/reject until a reload).
 */
const useApprovalsInSync = ({
  approvals,
  messages,
  onMissing,
  unseen,
}: {
  readonly approvals: readonly PendingApproval[] | undefined;
  readonly messages: readonly Message[];
  readonly onMissing: () => void;
  /**
   * Calls the waiting run asks about that the screen doesn't show (072,
   * audit F2): a restored or stale copy of the answer, refetched the same
   * way, the other way round.
   */
  readonly unseen: boolean;
}) => {
  const pending = pendingCallIds(messages);
  const known = new Set(approvals?.map((approval) => approval.toolCallId));
  const missing =
    unseen ||
    (pending !== "" && pending.split(" ").some((id) => !known.has(id)));
  // The call can reach the screen a moment before the run records the pause,
  // so a fetch that still finds it running tries again, a few times.
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (!missing || attempts >= APPROVAL_SYNC_ATTEMPTS) {
      return;
    }
    const timer = setTimeout(
      () => {
        onMissing();
        setAttempts((count) => count + 1);
      },
      attempts === 0 ? 0 : APPROVAL_SYNC_RETRY_MS
    );
    return () => clearTimeout(timer);
  }, [attempts, missing, onMissing]);
  useEffect(() => {
    if (!missing) {
      setAttempts(0);
    }
  }, [missing]);
};

const APPROVAL_SYNC_ATTEMPTS = 10;
const APPROVAL_SYNC_RETRY_MS = 500;

/**
 * The run waiting on `toolCallId`'s approval. An approval can be decided
 * before the page has seen its run pause (the call reaches the screen
 * first), so this asks the server, a few times, rather than drop the
 * decision.
 */
const awaitingRunFor = async (
  client: ApiClient,
  conversationId: ConversationId,
  toolCallId: string,
  attempts = APPROVAL_SYNC_ATTEMPTS
): Promise<string | null> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      // biome-ignore lint/performance/noAwaitInLoops: polling, one at a time on purpose.
      await new Promise((resolve) =>
        setTimeout(resolve, APPROVAL_SYNC_RETRY_MS)
      );
    }
    const runs = await client.runs
      .list({ active: true, conversationId, limit: 5 })
      .catch(() => null);
    const run = runs?.items.find(
      (each) =>
        each.state.status === "awaiting_approval" &&
        each.state.approvals.some(
          (approval) => approval.toolCallId === toolCallId
        )
    );
    if (run) {
      return run.id;
    }
  }
  return null;
};

/**
 * Whether a turn just finished and the stored branch hasn't been fetched
 * since. The run stores its answer before the stream ends, but the branch
 * on screen is the one fetched when the turn started (040's e2e: showing it
 * flashed "This answer stopped early" at the end of every reply). So the
 * streamed answer stays until the refetch the finish triggers lands.
 */
const useSettling = ({
  busy,
  conversationId,
  storedAt,
}: {
  readonly busy: boolean;
  readonly conversationId: ConversationId | null;
  readonly storedAt: number;
}): boolean => {
  const [seen, setSeen] = useState({ busy, conversationId });
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  // Derived during render (React's "adjusting state on a prop change"), so
  // the render where the turn ends already knows it's settling.
  if (seen.busy !== busy || seen.conversationId !== conversationId) {
    setSeen({ busy, conversationId });
    setFinishedAt(
      seen.busy && !busy && seen.conversationId === conversationId
        ? storedAt
        : null
    );
  }
  return finishedAt !== null && storedAt <= finishedAt;
};

/**
 * Follows a reply this page didn't start: one still being written when the
 * chat opened (the tab was closed or reloaded mid-reply, PLAN.md §11 M1
 * step 3), or one another participant started while it's open (D25). Each
 * run is checked once, when the branch on screen has its question: a run
 * this page started itself is already being followed (the chat isn't idle),
 * and following before the question shows would put the answer under the
 * wrong message.
 */
export const useFollowRunningReply = ({
  createdRunId,
  conversationId,
  messages,
  resumeStream,
  running,
  status,
}: {
  readonly createdRunId: { readonly current: RunId | null };
  readonly conversationId: ConversationId | null;
  readonly messages: readonly Message[];
  readonly resumeStream: () => Promise<void>;
  readonly running: Run | null | undefined;
  readonly status: "submitted" | "streaming" | "ready" | "error";
}) => {
  const idle = status === "ready" || status === "error";
  const checked = useRef<string | null>(null);
  const asked =
    running && messages.some((message) => message.id === running.userMessageId);
  useEffect(() => {
    if (!(conversationId && running)) {
      return;
    }
    const key = `${conversationId}:${running.id}`;
    if (checked.current === key || (idle && !asked)) {
      return;
    }
    if (running.id === createdRunId.current) {
      checked.current = key;
      return;
    }
    if (!idle) {
      return;
    }
    checked.current = key;
    resumeStream().catch(ignore);
  }, [asked, conversationId, createdRunId, idle, resumeStream, running]);
};

/** A message waiting for its new chat's address (134). */
interface Queued {
  readonly outgoing: Outgoing;
  readonly text: string;
}

/**
 * A new chat is created on first send; the send happens once it's routed
 * to. Until then the composer is busy (`busy`), and a message sent anyway
 * joins the same chat after the first rather than making another (134).
 */
export const useFirstSend = ({
  api,
  beforeFirstSend,
  beforeSend,
  client,
  context,
  conversationId,
  importFiles,
  mode,
  onNavigate,
  onWorkspaceChanged,
  send,
  sendInTurn,
  target,
}: {
  readonly api: QueryUtils;
  /**
   * Runs once the new chat exists, before its message goes: the chat's
   * connector choices made before it existed are saved here (188).
   */
  readonly beforeFirstSend?: (id: ConversationId) => Promise<void>;
  readonly beforeSend: () => Promise<boolean>;
  readonly client: ApiClient;
  readonly context: ChatContext;
  readonly conversationId: ConversationId | null;
  /** Attachments are copied into the chat's workspace too. */
  readonly importFiles: boolean;
  /** Chat or Code, for the new chat. */
  readonly mode: () => ChatMode;
  readonly onNavigate: (id: ConversationId) => void;
  /** The workspace changed (attachments were imported). */
  readonly onWorkspaceChanged: () => void;
  readonly send: (text: string, outgoing: Outgoing) => void;
  /** Sends, and settles once the turn's answer has ended. */
  readonly sendInTurn: (text: string, outgoing: Outgoing) => Promise<void>;
  /** Stored as the new chat's default, so reopening it continues with the same agent or model. */
  readonly target: RunTarget | null;
}) => {
  const [first, setFirst] = useState<FirstSend<Queued> | null>(null);
  const [sending, setSending] = useState(false);
  const [blocked, setBlocked] = useState<
    readonly {
      readonly conversationId: ConversationId | null;
      readonly value: ComposerValue;
    }[]
  >([]);
  const activeConversation = useRef(conversationId);
  useLayoutEffect(() => {
    activeConversation.current = conversationId;
    setBlocked([]);
  }, [conversationId]);
  // One chat per first send, however many messages race to it.
  const creation = useRef<Promise<ConversationId> | null>(null);
  // Messages get ready in the order they were sent, whatever they upload.
  const order = useRef<Promise<unknown>>(Promise.resolve());
  const navigatedTo = useRef<ConversationId | null>(null);
  useEffect(() => {
    // At a chat's address its creation is over; a later new chat makes its own.
    if (conversationId !== null) {
      creation.current = null;
    }
  }, [conversationId]);

  useEffect(() => {
    const next = firstSendNext(first, { conversationId, sending });
    if (!next) {
      return;
    }
    setFirst(next.rest);
    setSending(true);
    // The next waits for this one's answer, as a person would.
    sendInTurn(next.item.text, next.item.outgoing)
      .catch(ignore)
      .finally(() => setSending(false));
  }, [conversationId, first, sendInTurn, sending]);

  const { mutateAsync: create } = useMutation(
    api.conversations.create.mutationOptions()
  );
  const prepare = useCallback(
    async (id: ConversationId, value: ComposerValue): Promise<Outgoing> => {
      // Files belong to a conversation, so a new chat exists before they
      // upload; the message goes once they have.
      const uploaded = await uploadAttachments(client, id, value.attachments);
      // Imported before sending, so the turn can read them when it starts.
      const imported =
        importFiles && uploaded.length > 0
          ? await importToWorkspace(client, id, uploaded)
          : [];
      if (imported.length > 0) {
        onWorkspaceChanged();
      }
      return {
        chips: value.mentions,
        files: uploaded.map((each) => each.part),
        skills: value.skills,
        workspaceFiles: [...mentionedFiles(value), ...imported],
      };
    },
    [client, importFiles, onWorkspaceChanged]
  );

  const submit = useCallback(
    async (value: ComposerValue) => {
      const modeSaved = await beforeSend();
      if (!modeSaved) {
        if (activeConversation.current === conversationId) {
          setBlocked((current) => [...current, { conversationId, value }]);
        }
        return;
      }
      if (conversationId) {
        send(value.text, await prepare(conversationId, value));
        return;
      }
      setFirst(firstSendStarted);
      const made =
        creation.current ??
        create({
          context,
          defaultTarget: target ?? undefined,
          mode: mode(),
        }).then((created) => created.id);
      creation.current = made;
      const ready = order.current.then(async () => {
        const id = await made;
        await beforeFirstSend?.(id);
        return { id, outgoing: await prepare(id, value) };
      });
      order.current = ready.catch(ignore);
      try {
        const { id, outgoing } = await ready;
        setFirst((current) =>
          firstSendQueued(current, id, { outgoing, text: value.text })
        );
        if (navigatedTo.current !== id) {
          navigatedTo.current = id;
          onNavigate(id);
        }
      } catch (error) {
        if (creation.current === made) {
          // Not made, or made: either way the next try starts afresh.
          creation.current = null;
        }
        setFirst(firstSendFailed);
        throw error;
      }
    },
    [
      beforeFirstSend,
      beforeSend,
      context,
      conversationId,
      create,
      mode,
      onNavigate,
      prepare,
      send,
      target,
    ]
  );
  const replaying = useRef<boolean>(false);
  const retryBlocked = useCallback(async () => {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: another invocation can enter while this replay awaits I/O.
    if (replaying.current) {
      return;
    }
    replaying.current = true;
    try {
      setBlocked((current) =>
        current.filter((item) => item.conversationId !== conversationId)
      );
      for (const { value } of blocked.filter(
        (item) => item.conversationId === conversationId
      )) {
        // biome-ignore lint/performance/noAwaitInLoops: retain the order in which messages were submitted.
        await submit(value);
      }
    } finally {
      replaying.current = false;
    }
  }, [blocked, conversationId, submit]);
  return {
    blocked: blocked.some((item) => item.conversationId === conversationId),
    busy: firstSendBusy(first, conversationId),
    retryBlocked,
    submit,
  };
};

const TITLE_WAIT_MS = 30_000;

/**
 * Live titles (044). The title job runs once a chat's first turn has ended,
 * after its stream has closed, so a turn that ends in an untitled chat
 * watches the chat for a short while: `watching` makes the chat's query
 * poll until the title is there (`useChatQueries`).
 */
const useTitleWatch = (conversationId: ConversationId | null) => {
  const [watch, setWatch] = useState<{
    readonly id: ConversationId;
    readonly until: number;
  } | null>(null);
  const watching = watch !== null && watch.id === conversationId;
  const until = watching ? watch.until : null;
  useEffect(() => {
    if (until === null) {
      return;
    }
    const timer = setTimeout(
      () => setWatch(null),
      Math.max(0, until - Date.now())
    );
    return () => clearTimeout(timer);
  }, [until]);
  const start = useCallback(() => {
    if (conversationId) {
      setWatch({ id: conversationId, until: Date.now() + TITLE_WAIT_MS });
    }
  }, [conversationId]);
  return { start, watching };
};

/** A chat's title as fetched, copied into the cached chat lists (the sidebar). */
const useTitleInLists = (
  api: QueryUtils,
  conversationId: ConversationId | null,
  title: string | null | undefined
) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!(conversationId && title)) {
      return;
    }
    queryClient.setQueriesData<ConversationPage>(
      { queryKey: api.conversations.list.key() },
      (page) =>
        page?.items.some(
          (item) => item.id === conversationId && item.title !== title
        )
          ? {
              ...page,
              items: page.items.map((item) =>
                item.id === conversationId ? { ...item, title } : item
              ),
            }
          : page
    );
  }, [api, conversationId, queryClient, title]);
};

interface ConversationPage {
  readonly items: readonly Conversation[];
  readonly nextCursor: string | null;
}

/**
 * The agent's workspace tools moved the revision (060): its files, and maybe
 * the workspace itself, changed mid-reply. Refetch without cancelling a
 * fetch already on its way: the open panel asks for the same one.
 */
const useWorkspaceInSync = (api: QueryUtils, messages: readonly Message[]) => {
  const queryClient = useQueryClient();
  const revision = workspaceRevision(messages);
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) {
      return;
    }
    seen.current = revision;
    queryClient
      .invalidateQueries(
        { queryKey: api.sandbox.key() },
        { cancelRefetch: false }
      )
      .catch(ignore);
  }, [api, queryClient, revision]);
};

/**
 * A skill tool settled (128): the library changed under the chat, so the
 * composer's skills (and any open Library list) refetch. A skill published
 * here is in the + menu and `/` straight away.
 */
const useLibraryInSync = (api: QueryUtils, messages: readonly Message[]) => {
  const queryClient = useQueryClient();
  const revision = skillRevision(messages);
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) {
      return;
    }
    seen.current = revision;
    queryClient
      .invalidateQueries({ queryKey: api.library.key() })
      .catch(ignore);
  }, [api, queryClient, revision]);
};

/** Whether an API error is the server saying the request conflicts with the run's state. */
const isConflict = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === "CONFLICT";

/**
 * Sends one decision to the run waiting on its call. The listed run can be
 * missing (a call reaches the screen before the list has caught up with the
 * pause, 066) or stale (it has moved on), so the server is asked which run
 * waits on the call before a failure counts. A `conflict` is the server
 * refusing: the call was decided otherwise, or the run ended.
 */
const submitDecision = async (
  client: ApiClient,
  {
    conversationId,
    decision,
    runs,
    toolCallId,
  }: {
    readonly conversationId: ConversationId | null;
    readonly decision: ApprovalDecision;
    readonly runs: readonly Run[] | undefined;
    readonly toolCallId: string;
  }
): Promise<"sent" | "conflict" | "failed"> => {
  const post = (id: string) =>
    client.runs
      .submitApprovals({
        decisions: [{ decision, toolCallId }],
        runId: id as RunId,
      })
      .then(
        () => "sent" as const,
        (error: unknown) =>
          isConflict(error) ? ("conflict" as const) : ("failed" as const)
      );
  const ask = (attempts?: number) =>
    conversationId
      ? awaitingRunFor(client, conversationId, toolCallId, attempts)
      : Promise.resolve(null);
  const listed = runs?.find(
    (run) =>
      run.state.status === "awaiting_approval" &&
      run.state.approvals.some((each) => each.toolCallId === toolCallId)
  )?.id;
  const runId = listed ?? (await ask());
  if (!runId) {
    return "failed";
  }
  const first = await post(runId);
  if (first !== "conflict") {
    return first;
  }
  const waiting = await ask(1);
  return waiting && waiting !== runId ? post(waiting) : first;
};

/**
 * Decisions this page sends, by call (072, audit F3 and F7). The state
 * lives here, not in the card, so a card that remounts (a replayed stream,
 * the stored copy replacing the live one) keeps it, and it lasts only
 * until the server's copy of the call shows it decided: that, not this, is
 * what hides the card. A failed decision says why and can be sent again.
 */
const useDecisions = ({
  client,
  conversationId,
  onSent,
  runs,
  unsettled,
}: {
  readonly client: ApiClient;
  readonly conversationId: ConversationId | null;
  /** After the server took a decision: refetch, and follow the run on. */
  readonly onSent: () => void;
  /** Calls on screen not yet decided or answered (`unsettledCalls`). */
  readonly unsettled: readonly string[];
  readonly runs: readonly Run[] | undefined;
}) => {
  const [states, setStates] = useState<ReadonlyMap<string, DecisionState>>(
    () => new Map()
  );
  const sent = useRef(new Map<string, ApprovalDecision>());
  const latest = useRef({ conversationId, onSent, runs });
  useEffect(() => {
    latest.current = { conversationId, onSent, runs };
  });
  const setState = useCallback(
    (toolCallId: string, state: DecisionState | null) =>
      setStates((current) => {
        const next = new Map(current);
        if (state) {
          next.set(toolCallId, state);
        } else {
          next.delete(toolCallId);
        }
        return next;
      }),
    []
  );

  const send = useCallback(
    async (toolCallId: string, decision: ApprovalDecision) => {
      sent.current.set(toolCallId, decision);
      setState(toolCallId, { status: "sending" });
      const outcome = await submitDecision(client, {
        conversationId: latest.current.conversationId,
        decision,
        runs: latest.current.runs,
        toolCallId,
      });
      if (outcome !== "sent") {
        setState(toolCallId, { reason: outcome, status: "failed" });
      }
      latest.current.onSent();
    },
    [client, setState]
  );

  const decide = useCallback(
    (toolCallId: string, decision: ApprovalDecision) => {
      send(toolCallId, decision).catch(() =>
        setState(toolCallId, { reason: "failed", status: "failed" })
      );
    },
    [send, setState]
  );
  const retry = useCallback(
    (toolCallId: string) => {
      const decision = sent.current.get(toolCallId);
      if (decision) {
        decide(toolCallId, decision);
      }
    },
    [decide]
  );

  // Once the screen shows a call decided or answered (or no longer shows
  // it), its decision is the server's to show; this page's note about it
  // goes.
  const open = unsettled.join(" ");
  useEffect(() => {
    const still = new Set(open.split(" "));
    setStates((current) => {
      const stale = [...current.keys()].filter((id) => !still.has(id));
      if (stale.length === 0) {
        return current;
      }
      const next = new Map(current);
      for (const id of stale) {
        next.delete(id);
        sent.current.delete(id);
      }
      return next;
    });
  }, [open]);

  return { decide, retry, states };
};

/** Whether an API error says the thing isn't there. */
const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === "NOT_FOUND";

/**
 * Pending changes whose file changed since they were proposed (072, audit
 * F12): each proposed file's current etag, read through the same query the
 * Files panel reads it with, so a save there re-checks the card at once.
 */
const useStaleCalls = (
  api: QueryUtils,
  sandboxId: SandboxId | null,
  approvals: readonly PendingApproval[] | undefined
): ReadonlySet<string> => {
  const paths = [
    ...new Set(
      (approvals ?? []).flatMap((approval) =>
        (approval.edits ?? []).map((edit) => edit.path)
      )
    ),
  ];
  const reads = useQueries({
    queries: paths.map((path) =>
      api.sandbox.readFile.queryOptions({
        input: sandboxId ? { id: sandboxId, path } : skipToken,
        retry: false,
        select: (file) => file.etag,
      })
    ),
  });
  const etags = new Map(
    paths.flatMap((path, index): [string, string | null][] => {
      const read = reads[index];
      if (read?.data !== undefined) {
        return [[path, read.data]];
      }
      return read?.error && isNotFound(read.error) ? [[path, null]] : [];
    })
  );
  const stale = (approvals ?? []).flatMap((approval) =>
    staleEdits(approval.edits ?? [], etags).length > 0
      ? [approval.toolCallId]
      : []
  );
  const key = stale.join(" ");
  return useMemo(() => new Set(key ? key.split(" ") : []), [key]);
};

/**
 * The conversation's runs as the chat drives them (072): which run a page
 * opened mid-answer follows (a waiting one too, audit F10), the decisions
 * this page sends, whether only a decision is awaited, and Stop.
 */
const useRunControls = ({
  api,
  chat,
  checking,
  client,
  conversationId,
  createdRunId,
  messages,
  refresh,
  sandboxId,
}: {
  readonly api: QueryUtils;
  readonly chat: ReturnType<typeof useRunChat>;
  /** The branch on screen is a restored copy not yet checked (136). */
  readonly checking: boolean;
  readonly client: ApiClient;
  readonly conversationId: ConversationId | null;
  /** The run this page started last, for Stop before the runs list has it. */
  readonly createdRunId: { readonly current: RunId | null };
  readonly messages: readonly Message[];
  readonly refresh: () => void;
  /** The chat's workspace, to check pending changes against its files. */
  readonly sandboxId: SandboxId | null;
}) => {
  const { resumeStream: resume, stop: stopReading } = chat;
  // Following a run ends however it ends, and the stored branch is read
  // again then: at the stream's end (as `onFinish` does), and at once when
  // the run had ended before the page asked for it (136: another tab
  // stopped it while this one was still looking for its stream, so there
  // was no stream to follow and nothing else would clear the card).
  const resumeStream = useCallback(
    () => resume().catch(ignore).finally(refresh),
    [refresh, resume]
  );
  // The same query `useChatQueries` makes; read whole for the run states.
  const activeRuns = useQuery(
    api.runs.list.queryOptions({
      input: conversationId
        ? { active: true, conversationId, limit: 5 }
        : skipToken,
    })
  ).data?.items;
  const runningRunId = runToFollow(activeRuns);
  useFollowRunningReply({
    conversationId,
    createdRunId,
    messages,
    resumeStream,
    running:
      typeof runningRunId === "string"
        ? activeRuns?.find((run) => run.id === runningRunId)
        : runningRunId,
    status: chat.status,
  });
  const following = chat.status === "submitted" || chat.status === "streaming";
  const followingRef = useRef(following);
  followingRef.current = following;
  const pending = useMemo(() => waitingCalls(messages), [messages]);
  const decisions = useDecisions({
    client,
    conversationId,
    onSent: useCallback(() => {
      refresh();
      // A page following the run's stream sees the answer carry on there,
      // from where it is (the server announces the decision on it). One
      // that isn't picks the run up again; the SDK rebuilds a resumed
      // answer from an empty message, so that one replays from the start.
      if (!followingRef.current) {
        resumeStream().catch(ignore);
      }
    }, [refresh, resumeStream]),
    runs: activeRuns,
    unsettled: useMemo(() => unsettledCalls(messages), [messages]),
  });
  const sending = useMemo(
    () =>
      new Set(
        [...decisions.states].flatMap(([id, state]) =>
          state.status === "sending" ? [id] : []
        )
      ),
    [decisions.states]
  );
  const waiting = waitingForPerson({ pending, sending });

  // Stop stops the run on the server (072, audit F4), not just this page's
  // reading of it: a waiting answer's cards resolve as not run, a running
  // command is killed, and the stream says so to every page before it
  // ends. Only when that fails does this page stop reading on its own.
  const activeRunsRef = useRef(activeRuns);
  activeRunsRef.current = activeRuns;
  const stop = useCallback(async () => {
    const runId =
      stoppableRun(activeRunsRef.current)?.id ?? createdRunId.current;
    const cancelled = runId
      ? await client.runs.cancel({ id: runId }).then(
          () => true,
          () => false
        )
      : false;
    if (!cancelled) {
      await stopReading().catch(ignore);
    }
    refresh();
  }, [client, createdRunId, refresh, stopReading]);
  const waitingRun = stoppableRun(activeRuns);
  const stale = useStaleCalls(
    api,
    sandboxId,
    waitingRun?.state.status === "awaiting_approval"
      ? waitingRun.state.approvals
      : undefined
  );
  const activity = useMemo(
    (): RunActivity => ({
      answers: answerPhases(activeRuns),
      checking,
      decisions: decisions.states,
      onRetry: decisions.retry,
      stale,
    }),
    [activeRuns, checking, decisions.retry, decisions.states, stale]
  );
  return {
    activity,
    // While only a decision is awaited the composer sends: a new message
    // skips the pending change (the note under the answer says so, and has
    // Stop).
    composerStatus: waiting ? ("ready" as const) : chat.status,
    decisions,
    stop,
    /** Calls the waiting run asks about that the screen lacks (audit F2). */
    unseen: !following && unseenApprovals(activeRuns, messages).length > 0,
    waiting,
  };
};

/**
 * Whether the stored branch on screen is a copy from before the chat was
 * shown (restored from the persisted cache, D28, or cached from an earlier
 * visit) that the refetch on showing it hasn't replaced yet (136). It can
 * be minutes behind: a card on it may be decided already, and deciding it
 * again only waits for a run that has moved on. Fresh data, or a refetch
 * that has failed since, counts as checked. Pure.
 */
export const restoredUnchecked = (
  query: {
    readonly data: unknown;
    readonly dataUpdatedAt: number;
    readonly errorUpdatedAt: number;
    readonly isStale: boolean;
  },
  shownAt: number
): boolean =>
  query.data !== undefined &&
  query.isStale &&
  query.dataUpdatedAt < shownAt &&
  query.errorUpdatedAt < shownAt;

/** When this chat was shown: on mount, and again when it changes. */
const useShownAt = (conversationId: ConversationId | null): number => {
  const [shown, setShown] = useState(() => ({
    at: Date.now(),
    id: conversationId,
  }));
  if (shown.id !== conversationId) {
    setShown({ at: Date.now(), id: conversationId });
  }
  return shown.at;
};

/**
 * A new chat's first message is on its way (134): the composer is busy, as
 * once its run starts, so another message waits in it. Nothing runs yet for
 * Stop to stop.
 */
const whileFirstSend = (
  busy: boolean,
  status: ComposerStatus,
  stop: () => void
): {
  readonly onStop: (() => void) | undefined;
  readonly status: ComposerStatus;
} =>
  busy ? { onStop: undefined, status: "submitted" } : { onStop: stop, status };

/** What a message carries: `sendTarget` when the host gave one (111), else the shown target. */
const targetToSend = (
  sendTarget: RunTarget | null | undefined,
  target: RunTarget | null
): RunTarget | null => (sendTarget === undefined ? target : sendTarget);

/**
 * Each chat keeps its unsent draft (147), per person on a shared browser, and
 * ArrowUp recalls the prompts on the branch in view.
 */
const useComposerDrafts = (
  userId: string,
  conversationId: ConversationId | null,
  messages: readonly Message[]
): Pick<ComposerProps, "draft" | "history"> => {
  const store = useMemo(
    () => createStorageDraftStore(browserStorage, userId),
    [userId]
  );
  const history = useMemo(() => promptHistory(messages), [messages]);
  return {
    draft: { key: conversationId ?? NEW_CHAT_DRAFT_KEY, store },
    history,
  };
};

export function ConnectedChat({
  agents,
  artifactsRuntimeOrigin = null,
  brand,
  client,
  artifactsHref,
  banner,
  chatModes,
  composerPlaceholder,
  computer,
  dotsHref,
  config,
  conversationId,
  draftContext: draftContextProp,
  initialPrompt,
  layout,
  libraryHref,
  me,
  models,
  onDraftContextChange,
  onNavigate,
  onNewOrg,
  onOpenAdmin,
  onOpenPalette,
  onOpenSettings,
  onSignOut,
  onTargetChange,
  onThemeChange,
  platform,
  sandboxClient,
  sendTarget,
  sidebarDots,
  sidebarSpaces,
  skills,
  prompts,
  target = null,
  terms = defaultTerms,
  theme,
  voice,
  headerExtra,
}: ConnectedChatProps) {
  const outgoingTarget = targetToSend(sendTarget, target);
  const { i18n, t } = useLingui();
  const api = useMemo(() => createQueryUtils(client), [client]);
  // "Make something new"'s kinds (161), in the menu as `@Slides` and kin:
  // only those the instance offers.
  const offeredKinds = useOfferedKinds(api);
  const showModes = showsModes(config, chatModes);
  const artifactOptions = useMemo(
    (): readonly ArtifactOption[] =>
      starterKinds(offeredKinds).map((kind) => ({
        kind,
        label: i18n._(starterLabels[kind] ?? artifactKindLabels[kind]),
      })),
    [i18n, offeredKinds]
  );
  const queryClient = useQueryClient();
  const [leafId, setLeafId] = useState<MessageId | undefined>();
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [draftContext, setDraftContext] = useDraftContext(
    draftContextProp,
    onDraftContextChange
  );
  const [uploadFailed, setUploadFailed] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const plan = usePlanSwitch();
  // A plan open in the panel's editor, and plans set aside (106).
  const [editingPlan, setEditingPlan] = useState<PlanRef | null>(null);
  const [discardedPlans, setDiscardedPlans] = useState<
    ReadonlySet<PlanRef["artifactId"]>
  >(() => new Set());
  // The chosen model's thinking level and fast tier (105); the composer
  // remembers them per model and sets them as the model changes.
  const [variant, setVariant] = useState<ModelVariant>({});
  const titleWatch = useTitleWatch(conversationId);
  const shownAt = useShownAt(conversationId);

  const data = useChatQueries(api, {
    artifactId:
      selection?.kind === "artifact" ? (selection.artifactId ?? null) : null,
    conversationId,
    leafId,
    sandboxes: config.features.sandboxes,
    watchTitle: titleWatch.watching,
  });
  const storedTitle = data.conversation.data?.title;
  useTitleInLists(api, conversationId, storedTitle);
  const titleRef = useRef(storedTitle);
  titleRef.current = storedTitle;
  const stored = data.path.data?.messages ?? NO_MESSAGES;
  const feedback = useBranchFeedback(api, stored);
  const update = useConversationUpdate(api);
  const { mutateAsync: saveMode } = useMutation(
    api.conversations.update.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: api.conversations.key() }),
      onSuccess: (saved) => {
        queryClient.setQueryData(
          api.conversations.get.queryKey({ input: { id: saved.id } }),
          saved
        );
      },
    })
  );
  const chatMode = useChatMode(
    conversationId,
    data.conversation.data?.mode,
    saveMode,
    data.conversation.dataUpdatedAt
  );

  // Another chat starts from its own active leaf and artifacts.
  const [shownId, setShownId] = useState(conversationId);
  if (shownId !== conversationId) {
    setShownId(conversationId);
    setLeafId(undefined);
    setSelection(null);
    setEditingPlan(null);
    feedback.reset();
  }

  const refresh = useCallback(() => {
    for (const key of [
      api.messages.key(),
      api.runs.key(),
      api.conversations.key(),
      api.artifacts.key(),
      // The agent may have created a sandbox or exposed a preview this turn.
      api.sandbox.key(),
    ]) {
      queryClient.invalidateQueries({ queryKey: key }).catch(ignore);
    }
  }, [api, queryClient]);

  // Every change the Workspace panel makes goes back through `sandbox.get`,
  // so the panel and everything else read one record (060). A folder saved
  // as a site (125) is a new artifact, so the chat's artifacts refetch too.
  const onWorkspaceChanged = useCallback(() => {
    for (const key of [api.sandbox.key(), api.artifacts.key()]) {
      queryClient.invalidateQueries({ queryKey: key }).catch(ignore);
    }
  }, [api, queryClient]);
  const sandboxRecord = data.sandbox.data ?? null;
  const workspaceFiles = useMemo((): WorkspaceFilesSource => {
    if (!config.features.sandboxes) {
      return { kind: "off" };
    }
    if (!(conversationId && sandboxClient)) {
      return { kind: "new-chat" };
    }
    return {
      client: sandboxClient,
      kind: "chat",
      onChanged: onWorkspaceChanged,
      sandbox: sandboxRecord,
    };
  }, [
    config.features.sandboxes,
    conversationId,
    onWorkspaceChanged,
    sandboxClient,
    sandboxRecord,
  ]);

  // The composer's `@` and `/open` list the workspace's files. The panel
  // lists them for itself when it's open; this listing is for the composer,
  // refreshed by everything that refetches `sandbox.get`.
  const listing = useQuery(
    api.sandbox.listFiles.queryOptions({
      input:
        conversationId && listable(sandboxRecord)
          ? { id: sandboxRecord.id, path: ".", recursive: true }
          : skipToken,
    })
  );
  const workspacePaths = useMemo(() => filePaths(listing.data), [listing.data]);

  const context = data.conversation.data?.context ?? draftContext;
  const { start: watchTitle } = titleWatch;
  const onFinish = useCallback(() => {
    refresh();
    if (titleRef.current === null) {
      watchTitle();
    }
  }, [refresh, watchTitle]);
  // The run this page started last, for Stop before the runs list has it.
  const createdRunId = useRef<RunId | null>(null);
  // A voice turn waits here for the run its send started.
  const runWaiters = useRef<((runId: RunId | null) => void)[]>([]);
  const onRunCreated = useCallback((run: RunCreated) => {
    createdRunId.current = run.runId;
    runWaiters.current.shift()?.(run.runId);
  }, []);
  const { chat, messages, streamingMessageId } = useLiveTurn({
    client,
    context,
    conversationId,
    me,
    onFinish,
    onRunCreated,
    plan: plan.ref,
    stored,
    storedAt: data.path.dataUpdatedAt,
    target: outgoingTarget,
    variant,
    webSearch: webSearchOn(config, webSearch),
  });
  const { regenerate, sendMessage, setMessages } = chat;
  const { activity, composerStatus, decisions, stop, unseen, waiting } =
    useRunControls({
      api,
      chat,
      checking: restoredUnchecked(data.path, shownAt),
      client,
      conversationId,
      createdRunId,
      messages,
      refresh,
      sandboxId: data.sandbox.data?.id ?? null,
    });
  const live = useLiveConversation({
    client,
    conversationId,
    meId: me.user.id,
    onCatchUp: refresh,
    onRun: useCallback(
      (event: { readonly runId: RunId }) => {
        if (event.runId !== createdRunId.current) {
          refresh();
        }
      },
      [refresh]
    ),
  });
  const { stop: stopReading } = chat;
  const sendInTurn = useCallback(
    (text: string, outgoing: Outgoing = NOTHING_ELSE) =>
      sendMessage(outgoingMessage(text, outgoing)),
    [sendMessage]
  );
  const send = useCallback(
    (text: string, outgoing: Outgoing = NOTHING_ELSE) => {
      sendInTurn(text, outgoing).catch(ignore);
    },
    [sendInTurn]
  );
  // Approving a plan (106): a normal run (plan mode off for it, and after)
  // whose message carries the approval, and the edited plan if it changed.
  const approvePlan = useCallback(
    (approved: PlanRef, content?: string) => {
      plan.set(false);
      setEditingPlan(null);
      if (waiting) {
        stopReading().catch(ignore);
      }
      sendMessage(
        planApprovalMessage(
          t`Go ahead with the plan: ${approved.title}`,
          approved,
          content
        )
      ).catch(ignore);
    },
    [plan, sendMessage, stopReading, t, waiting]
  );
  const chatMcp = useChatMcp({
    api,
    client,
    conversationId,
    term: terms.mcp,
  });
  const firstSend = useFirstSend({
    api,
    beforeFirstSend: chatMcp.flush,
    beforeSend: chatMode.flush,
    client,
    context: draftContext,
    conversationId,
    importFiles: canImport(config),
    mode: chatMode.current,
    onNavigate,
    onWorkspaceChanged,
    send,
    sendInTurn,
    target: outgoingTarget,
  });
  const { submit, retryBlocked } = firstSend;
  const onRetryMode = useCallback(() => {
    retryBlocked().catch(() => setUploadFailed(true));
  }, [retryBlocked]);
  const { onStop, status: shownStatus } = whileFirstSend(
    firstSend.busy,
    composerStatus,
    stop
  );
  const sendForVoice = useCallback(
    (text: string) =>
      new Promise<RunId | null>((resolve) => {
        runWaiters.current.push(resolve);
        // Settles once the stream ends; by then the run was reported, and a
        // send that failed before creating one answers `null`.
        sendInTurn(text)
          .catch(ignore)
          .finally(() => {
            runWaiters.current = runWaiters.current.filter(
              (waiter) => waiter !== resolve
            );
            resolve(null);
          });
      }),
    [sendInTurn]
  );
  const voiceBridge = useVoiceBridge(client, sendForVoice);

  const { mutateAsync: revertMemory } = useMutation(
    api.memory.revert.mutationOptions()
  );
  const { mutateAsync: replaceMemory } = useMutation(
    api.memory.update.mutationOptions()
  );
  const { mutate: rememberLeaf } = useMutation(
    api.conversations.updateMyState.mutationOptions()
  );
  const { mutate: changeContext } = useMutation(
    api.conversations.setContext.mutationOptions({ onSettled: refresh })
  );

  const nodes: readonly TreeNode[] = data.tree.data?.nodes ?? stored;
  const { decide } = decisions;
  const actions = useMemo(
    (): ConversationActions => ({
      artifactImageUrl,
      fileUrl,
      ...(libraryHref
        ? { libraryItemHref: (id) => `${libraryHref}/${id}` }
        : {}),
      onApprovePlan: (approved) => approvePlan(approved),
      onClearFeedback: feedback.clear,
      onDecide: decide,
      onDiscardPlan: (discarded) => {
        setDiscardedPlans((before) =>
          new Set(before).add(discarded.artifactId)
        );
        setEditingPlan((editing) =>
          editing?.artifactId === discarded.artifactId ? null : editing
        );
      },
      onEdit: (message, text) => {
        // An edit answers the same parent: send it from that point.
        const at = stored.findIndex((item) => item.id === message.id);
        setMessages(toUIMessages(stored.slice(0, at), { fileUrl }));
        send(text, editedOutgoing(text, message.parts));
      },
      onEditPlan: (editing) => {
        setEditingPlan(editing);
        setSelection({ artifactId: editing.artifactId, kind: "artifact" });
      },
      onFeedback: feedback.set,
      onRegenerate: (message) => {
        const at = stored.findIndex((item) => item.id === message.id);
        setMessages(toUIMessages(stored.slice(0, at + 1), { fileUrl }));
        regenerate({ messageId: message.id }).catch(ignore);
      },
      onSelectBranch: (messageId) => {
        const leaf = newestLeafUnder(nodes, messageId);
        setLeafId(leaf);
        if (conversationId) {
          rememberLeaf({ activeLeafId: leaf, conversationId });
        }
      },
      onUndoMemory: async (memory: MemoryUpdate) => {
        // D20, ticket 022: back to the previous version, or clear a first
        // write (based on the version it made).
        await (memory.previousVersionId
          ? revertMemory({ versionId: memory.previousVersionId })
          : replaceMemory({ baseVersionId: memory.versionId, content: "" }));
      },
    }),
    [
      approvePlan,
      conversationId,
      decide,
      feedback.clear,
      feedback.set,
      libraryHref,
      nodes,
      regenerate,
      rememberLeaf,
      replaceMemory,
      revertMemory,
      send,
      setMessages,
      stored,
    ]
  );

  const contextOptions = useMemo(
    () => contextOptionsFromMe(me, config.policies.chatContexts),
    [config.policies.chatContexts, me]
  );
  const onContextChange = useCallback(
    (next: ChatContext) => {
      if (conversationId) {
        changeContext({ context: next, id: conversationId });
      } else {
        setDraftContext(next);
      }
    },
    [changeContext, conversationId, setDraftContext]
  );
  const onRename = useCallback(
    (title: string) => {
      if (conversationId) {
        update({ id: conversationId, title });
      }
    },
    [conversationId, update]
  );
  const copyLink = useCallback(async () => {
    await navigator.clipboard?.writeText(window.location.href);
  }, []);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  const onSubmit = useCallback(
    (value: ComposerValue) => {
      setUploadFailed(false);
      // A message sent while a change waits moves on without it: the
      // server stops that answer, so this page stops following it first.
      if (waitingRef.current) {
        stopReading().catch(ignore);
      }
      submit(value).catch(() => setUploadFailed(true));
    },
    [stopReading, submit]
  );

  useAskOnce(initialPrompt, conversationId, onSubmit);
  const composerDrafts = useComposerDrafts(
    me.user.id,
    conversationId,
    messages
  );
  const attachmentLimits = useMemo(() => attachmentLimitsFor(config), [config]);
  const newChat = useCallback(() => onNavigate(null), [onNavigate]);
  const sidebarActions = useMemo(
    () => ({
      onArchive: (id: ConversationId) => update({ archived: true, id }),
      onRename: (id: ConversationId, title: string) => update({ id, title }),
      onRestore: (id: ConversationId) => update({ archived: false, id }),
      onTogglePin: (id: ConversationId, pinned: boolean) =>
        update({ id, pinned }),
    }),
    [update]
  );

  const approvals =
    data.activeRun?.state.status === "awaiting_approval"
      ? data.activeRun.state.approvals
      : undefined;
  useApprovalsInSync({
    approvals,
    messages,
    onMissing: refresh,
    unseen,
  });
  useWorkspaceInSync(api, messages);
  useLibraryInSync(api, messages);
  const current = data.conversation.data;
  const sidebarData = useSidebarData(api);
  useMarkReadWhileOpen(current, sidebarData.onSetLastRead);
  // The open chat's own run feeds "Needs attention" too (176): the list
  // doesn't carry run state, but this screen knows it.
  const activeStatus = data.activeRun?.state.status;
  const dotSignals = sidebarDots?.signals;
  const signals = useMemo(() => {
    const merged = new Map<ConversationId, RunSignal>(dotSignals ?? []);
    if (conversationId && activeStatus === "awaiting_approval") {
      merged.set(conversationId, "awaiting_approval");
    } else if (
      conversationId &&
      (activeStatus === "running" || activeStatus === "queued")
    ) {
      merged.set(conversationId, "running");
    }
    return merged;
  }, [activeStatus, conversationId, dotSignals]);
  const planStatus = useMemo(
    () => ({
      approved: approvedPlanIds(messages),
      busy: shownStatus === "submitted" || shownStatus === "streaming",
      discarded: discardedPlans,
    }),
    [shownStatus, discardedPlans, messages]
  );
  const planEditing = useMemo(
    () =>
      editingPlan
        ? {
            artifactId: editingPlan.artifactId,
            busy: shownStatus === "submitted" || shownStatus === "streaming",
            onApprove: (content: string | undefined) =>
              approvePlan(editingPlan, content),
            onCancel: () => setEditingPlan(null),
          }
        : null,
    [approvePlan, shownStatus, editingPlan]
  );

  return (
    <RowContexts activity={activity} showModes={showModes}>
      <PlanStatusProvider value={planStatus}>
        <VoiceBridgeContext.Provider
          value={bridgeOf(conversationId, voiceBridge)}
        >
          <ChatScreen
            actions={actions}
            banner={banner}
            brand={brand}
            composer={{
              agents,
              artifacts: artifactOptions,
              attachmentLimits,
              ...chatModeSwitch(config, showModes, chatMode),
              mcp: chatMcp.composer,
              ...composerDrafts,
              models,
              onPlanChange: plan.set,
              onStop,
              onSubmit,
              onTargetChange,
              onVariantChange: setVariant,
              placeholder: composerPlaceholder,
              // "Recently used" in the picker is each person's own (099).
              recentsKey: me.user.id,
              ...webSearchSwitch(config, webSearch, setWebSearch),
              plan: plan.on,
              prompts,
              skills,
              status: shownStatus,
              target: target ?? undefined,
              variant,
            }}
            composerNote={
              <TypingNote people={live.typing} shared={live.others} />
            }
            computer={computer}
            conversation={{
              context,
              contextLocked: current?.contextLocked ?? false,
              contextOptions,
              id: conversationId,
              onContextChange,
              onCopyLink: copyLink,
              onRename: conversationId ? onRename : undefined,
              participants: data.participants.data ?? [],
              title: current?.title ?? null,
            }}
            feedback={feedback.byMessage}
            headerEnd={headerEndOf(
              <>
                <PresentPeople people={live.others} />
                {headerExtra}
              </>,
              voiceSlot(voice, conversationId, voiceBridge)
            )}
            layout={layout}
            messages={messages}
            onComposerInput={live.onTyping}
            onNewChat={newChat}
            onOpenPalette={onOpenPalette}
            pendingApprovals={approvals}
            platform={platform}
            runError={
              <RunError
                error={chat.error}
                modeBlocked={firstSend.blocked}
                modeFailed={chatMode.failed}
                onRetryMode={onRetryMode}
                onStop={stop}
                uploadFailed={uploadFailed}
                waiting={waiting}
              />
            }
            siblings={data.path.data?.siblings ?? []}
            sidebar={{
              ...sidebarActions,
              account: {
                onNewOrg,
                onOpenAdmin,
                onOpenSettings,
                onSignOut,
                onThemeChange,
                theme,
                user: me.user,
              },
              activeId: conversationId,
              artifactsHref,
              chats: data.chats.data?.items ?? [],
              dotsHref,
              ...sidebarDots,
              ...sidebarData,
              libraryHref,
              onSelect: onNavigate,
              signals,
              spaces: sidebarSpaces,
            }}
            streamingMessageId={streamingMessageId}
            workspace={{
              artifacts: {
                api,
                artifacts: data.artifacts.data ?? [],
                editing: planEditing,
                error: data.versions.isError
                  ? t`Couldn't load this artifact.`
                  : null,
                runtimeOrigin: artifactsRuntimeOrigin,
                versions: data.versions.data,
              },
              canPreview: canPreviewOn(config, sandboxRecord),
              files: workspaceFiles,
              onSelect: setSelection,
              paths: workspacePaths,
              selection,
            }}
          />
        </VoiceBridgeContext.Provider>
      </PlanStatusProvider>
    </RowContexts>
  );
}

const NO_MESSAGES: readonly Message[] = [];
