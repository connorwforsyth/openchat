// biome-ignore-all lint/performance/noJsxPropsBind: a throwaway prototype (ticket 009); inline handlers keep each variant readable and it is deleted once a direction is picked.
"use client";

// Shared state and building blocks for the three app-shell variants. The
// variants differ in layout, density and interaction model; the chat, the
// context rules (D17) and the sandbox are the same product underneath.
import {
  AgentIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ContextIcon,
  CopyIcon,
  EyeOffIcon,
  FileTextIcon,
  LockIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  NewChatIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ShareIcon,
  SparklesIcon,
  SquareIcon,
  StarIcon,
  SunIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
  XIcon,
} from "@workspace/icons";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@workspace/ui/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@workspace/ui/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@workspace/ui/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTheme } from "next-themes";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type Chat,
  type ChatMessage,
  type ContextId,
  CURRENT_CHAT_ID,
  contextById,
  contexts,
  currentUser,
  initialChats,
  initialParticipants,
  type LibraryItem,
  models,
  org,
  type Participant,
  sandbox,
} from "./data";

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export type SandboxStatus = "idle" | "running" | "starting" | "stopped";

const RUN_MS = 1400;
const COPIED_MS = 1600;
const UNDO_MS = 5000;
const TITLE_LENGTH = 48;
const NAME_SEPARATORS = /[._-]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ownerToContext = (owner: string): ContextId => {
  if (owner.endsWith("Platform")) {
    return "platform";
  }
  if (owner === "Engineering") {
    return "engineering";
  }
  return "personal";
};

const makeTitle = (text: string): string => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > TITLE_LENGTH
    ? `${line.slice(0, TITLE_LENGTH).trimEnd()}…`
    : line;
};

const prototypeReply = (contextPath: string) =>
  `No model is connected in this prototype, so this is a placeholder reply. In the app the answer streams here, paid for by **${contextPath}** keys.`;

export function useShell() {
  const [chats, setChats] = useState<Chat[]>(() => [...initialChats]);
  const [activeId, setActiveId] = useState<string | null>(CURRENT_CHAT_ID);
  const [draftContext, setDraftContext] = useState<ContextId>("personal");
  const [draftAgent, setDraftAgent] = useState<LibraryItem | null>(null);
  const [branch, setBranch] = useState(1);
  const [archived, setArchived] = useState<Chat | null>(null);
  // People invited in this session join whichever chat they were invited to
  // and the sample chat's existing participants; good enough for a prototype.
  const [invited, setInvited] = useState<Participant[]>([]);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>("idle");
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const id of timers.current) {
        window.clearTimeout(id);
      }
    },
    []
  );

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const visibleChats = useMemo(
    () => chats.filter((chat) => chat.id !== archived?.id),
    [chats, archived]
  );
  const activeChat = chats.find((chat) => chat.id === activeId) ?? null;
  const contextId = activeChat ? activeChat.context : draftContext;
  const context = contextById(contextId);
  // D17: the context is changeable until the first message, then fixed.
  const contextLocked = activeChat !== null;
  const participants: Participant[] = [
    ...(activeChat?.id === CURRENT_CHAT_ID
      ? initialParticipants
      : initialParticipants.slice(0, 1)),
    ...invited,
  ];
  const branchCount =
    [...(activeChat?.messages ?? [])]
      .reverse()
      .find((message) => message.branches)?.branches?.length ?? 0;

  const selectChat = useCallback((id: string) => {
    setActiveId(id);
    setBranch(id === CURRENT_CHAT_ID ? 1 : 0);
  }, []);

  const newChat = useCallback((agent?: LibraryItem) => {
    setActiveId(null);
    setDraftAgent(agent ?? null);
    setDraftContext(agent ? ownerToContext(agent.owner) : "personal");
  }, []);

  const setContext = useCallback(
    (id: ContextId) => {
      if (!contextLocked) {
        setDraftContext(id);
      }
    },
    [contextLocked]
  );

  const runSandbox = useCallback(() => {
    setSandboxStatus("running");
    later(() => setSandboxStatus("idle"), RUN_MS);
  }, [later]);

  const restartSandbox = useCallback(() => {
    setSandboxStatus("starting");
    later(() => setSandboxStatus("idle"), RUN_MS);
  }, [later]);

  const stopSandbox = useCallback(() => setSandboxStatus("stopped"), []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") {
        return;
      }
      const stamp = Date.now().toString(36);
      const user: ChatMessage = {
        id: `u-${stamp}`,
        role: "user",
        text: trimmed,
      };
      const reply: ChatMessage = {
        id: `a-${stamp}`,
        role: "assistant",
        text: prototypeReply(context.path),
      };
      if (activeChat) {
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === activeChat.id
              ? { ...chat, messages: [...chat.messages, user, reply] }
              : chat
          )
        );
      } else {
        const chat: Chat = {
          agent: draftAgent?.name,
          context: draftContext,
          group: "Today",
          id: `c-${stamp}`,
          messages: [user, reply],
          title: makeTitle(trimmed),
          updated: "now",
        };
        setChats((prev) => [chat, ...prev]);
        setActiveId(chat.id);
        setBranch(0);
      }
      runSandbox();
    },
    [activeChat, context.path, draftAgent, draftContext, runSandbox]
  );

  const rename = useCallback((id: string, title: string) => {
    const next = title.trim();
    if (next === "") {
      return;
    }
    setChats((prev) =>
      prev.map((chat) => (chat.id === id ? { ...chat, title: next } : chat))
    );
  }, []);

  const togglePin = useCallback((id: string) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === id ? { ...chat, pinned: !chat.pinned } : chat
      )
    );
  }, []);

  const archive = useCallback(
    (id: string) => {
      const chat = chats.find((item) => item.id === id);
      if (!chat) {
        return;
      }
      // Committing the previous archive makes room for this one's undo.
      if (archived) {
        setChats((prev) => prev.filter((item) => item.id !== archived.id));
      }
      setArchived(chat);
      if (id === activeId) {
        setActiveId(null);
        setDraftAgent(null);
        setDraftContext("personal");
      }
      later(
        () =>
          setArchived((current) => {
            if (current?.id === id) {
              setChats((prev) => prev.filter((item) => item.id !== id));
              return null;
            }
            return current;
          }),
        UNDO_MS
      );
    },
    [activeId, archived, chats, later]
  );

  const undoArchive = useCallback(() => setArchived(null), []);

  const copyLink = useCallback(() => {
    // Clipboard access can be denied; the feedback is what the prototype shows.
    navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
    setCopied(true);
    later(() => setCopied(false), COPIED_MS);
  }, [later]);

  const invite = useCallback((email: string) => {
    const name = email.split("@")[0] ?? email;
    const initials = name
      .split(NAME_SEPARATORS)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2);
    setInvited((prev) => [
      ...prev,
      { initials: initials || "?", name: email, role: "editor" },
    ]);
  }, []);

  return {
    activeChat,
    archive,
    archived,
    branch,
    branchCount,
    chats: visibleChats,
    context,
    contextId,
    contextLocked,
    copied,
    copyLink,
    draftAgent,
    invite,
    inviteOpen,
    newChat,
    participants,
    rename,
    restartSandbox,
    sandboxStatus,
    selectChat,
    send,
    setBranch,
    setContext,
    setInviteOpen,
    stopSandbox,
    togglePin,
    undoArchive,
  };
}

export type Shell = ReturnType<typeof useShell>;

export const nextBranch = (shell: Shell, delta: number) => {
  if (shell.branchCount < 2) {
    return;
  }
  shell.setBranch(
    (shell.branch + delta + shell.branchCount) % shell.branchCount
  );
};

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                   */
/* -------------------------------------------------------------------------- */

export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

/** A window keydown listener that always sees the latest handler. */
export function useKeydown(handler: (event: KeyboardEvent) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => ref.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Restores focus to whatever opened an overlay, and closes it on Escape. */
export function useOverlay(open: boolean, onClose: () => void) {
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      return;
    }
    returnTo.current?.focus();
    returnTo.current = null;
  }, [open]);
  useKeydown((event) => {
    if (open && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

export const Kbd = ({ className, ...props }: ComponentProps<"kbd">) => (
  <kbd
    className={cn(
      "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground leading-none",
      className
    )}
    data-slot="kbd"
    {...props}
  />
);

export const Avatar = ({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-flex size-6 shrink-0 select-none items-center justify-center rounded-full bg-secondary font-medium text-[10px] text-secondary-foreground ring-2 ring-background",
      className
    )}
  >
    {initials}
  </span>
);

/** Icon button with a tooltip that can carry a shortcut. */
export const IconTip = ({
  label,
  shortcut,
  side = "bottom",
  children,
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button aria-label={label} size="icon-sm" variant="ghost" {...props} />
      }
    >
      {children}
    </TooltipTrigger>
    <TooltipContent side={side}>
      {label}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </TooltipContent>
  </Tooltip>
);

export const Highlight = ({ text, query }: { text: string; query: string }) => {
  const q = query.trim();
  if (q === "") {
    return <>{text}</>;
  }
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-accent px-0.5 text-accent-foreground">
        {text.slice(index, index + q.length)}
      </mark>
      {text.slice(index + q.length)}
    </>
  );
};

export const searchChats = (chats: readonly Chat[], query: string) => {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return chats.map((chat) => ({ chat, snippet: chat.messages[0]?.text }));
  }
  return chats.flatMap((chat) => {
    if (chat.title.toLowerCase().includes(q)) {
      return [{ chat, snippet: chat.messages[0]?.text }];
    }
    const hit = chat.messages.find((message) =>
      message.text.toLowerCase().includes(q)
    );
    if (!hit) {
      return [];
    }
    const at = hit.text.toLowerCase().indexOf(q);
    const start = Math.max(0, at - 32);
    const snippet = `${start > 0 ? "…" : ""}${hit.text.slice(start, at + 80)}`;
    return [{ chat, snippet }];
  });
};

export const libraryIcon = (kind: LibraryItem["kind"]) => {
  if (kind === "agent") {
    return AgentIcon;
  }
  if (kind === "skill") {
    return SparklesIcon;
  }
  return FileTextIcon;
};

/* -------------------------------------------------------------------------- */
/* Menus                                                                      */
/* -------------------------------------------------------------------------- */

/** Chat context (D17): Personal or a team, fixed after the first message. */
export const ContextMenuBody = ({ shell }: { shell: Shell }) => (
  <>
    <DropdownMenuGroup>
      <DropdownMenuLabel>Chat context</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(value) => shell.setContext(value as ContextId)}
        value={shell.contextId}
      >
        {contexts.map((option) => (
          <DropdownMenuRadioItem
            closeOnClick
            disabled={shell.contextLocked && option.id !== shell.contextId}
            key={option.id}
            value={option.id}
          >
            <span
              className={cn(
                "flex items-center gap-1.5",
                option.depth > 0 && "ps-4"
              )}
            >
              {option.id === "personal" ? <UserIcon /> : <ContextIcon />}
              {option.label}
              {option.id === "engineering" ? (
                <span className="text-muted-foreground text-xs">
                  {org.name}
                </span>
              ) : null}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <p className="max-w-60 px-1.5 py-1 text-muted-foreground text-xs leading-relaxed">
      {shell.contextLocked
        ? "Fixed after the first message. Keys, budget and audit follow this context."
        : "Decides whose keys pay and where usage rolls up. Locks when you send."}
    </p>
    {shell.contextLocked ? (
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => shell.newChat()}>
          <NewChatIcon />
          New chat in another context
        </DropdownMenuItem>
      </DropdownMenuGroup>
    ) : null}
  </>
);

export const ContextChipLabel = ({ shell }: { shell: Shell }) => (
  <>
    {shell.contextId === "personal" ? (
      <UserIcon data-icon="inline-start" />
    ) : (
      <ContextIcon data-icon="inline-start" />
    )}
    {shell.context.label}
    {shell.contextLocked ? (
      <LockIcon
        aria-label="Locked"
        className="text-muted-foreground"
        data-icon="inline-end"
      />
    ) : null}
  </>
);

export const ThemeMenuGroup = () => {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(value) => setTheme(String(value))}
        value={theme ?? "system"}
      >
        <DropdownMenuRadioItem closeOnClick={false} value="light">
          <SunIcon />
          Light
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem closeOnClick={false} value="dark">
          <MoonIcon />
          Dark
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem closeOnClick={false} value="system">
          <MonitorIcon />
          System
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
};

export const AccountMenuBody = ({ extra }: { extra?: ReactNode }) => (
  <>
    <DropdownMenuGroup>
      <DropdownMenuLabel className="flex flex-col gap-0.5">
        <span className="text-foreground">{currentUser.name}</span>
        <span className="font-normal">{currentUser.email}</span>
      </DropdownMenuLabel>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    {extra}
    <ThemeMenuGroup />
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      <DropdownMenuItem>
        <LogOutIcon />
        Log out
      </DropdownMenuItem>
    </DropdownMenuGroup>
  </>
);

export const ShareMenuBody = ({ shell }: { shell: Shell }) => (
  <>
    <DropdownMenuGroup>
      <DropdownMenuLabel>
        {shell.contextLocked ? "People in this chat" : "Not shared yet"}
      </DropdownMenuLabel>
      {shell.contextLocked
        ? shell.participants.map((person) => (
            <div
              className="flex items-center gap-2 px-1.5 py-1 text-sm"
              key={person.name}
            >
              <Avatar className="ring-0" initials={person.initials} />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              <span className="text-muted-foreground text-xs capitalize">
                {person.role}
              </span>
            </div>
          ))
        : null}
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      <DropdownMenuItem
        disabled={!shell.contextLocked}
        onClick={() => shell.setInviteOpen(true)}
      >
        <PlusIcon />
        Invite people…
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!shell.contextLocked}
        onClick={shell.copyLink}
      >
        <CopyIcon />
        Copy link
      </DropdownMenuItem>
    </DropdownMenuGroup>
  </>
);

const statusLabel: Record<SandboxStatus, string> = {
  idle: "idle",
  running: "running",
  starting: "starting",
  stopped: "stopped",
};

export const SandboxDot = ({ status }: { status: SandboxStatus }) => (
  <span
    aria-hidden="true"
    className={cn(
      "relative inline-flex size-2 shrink-0 rounded-full",
      status === "stopped" && "border border-muted-foreground",
      status === "idle" && "bg-muted-foreground",
      (status === "running" || status === "starting") &&
        "bg-primary motion-safe:animate-pulse"
    )}
  />
);

export const sandboxText = (status: SandboxStatus) =>
  `${sandbox.runtime} · ${statusLabel[status]}`;

export const SandboxMenuBody = ({
  shell,
  onOpenPanel,
}: {
  shell: Shell;
  onOpenPanel?: () => void;
}) => (
  <>
    <DropdownMenuGroup>
      <DropdownMenuLabel className="flex items-center gap-2">
        <SandboxDot status={shell.sandboxStatus} />
        Sandbox · {sandboxText(shell.sandboxStatus)}
      </DropdownMenuLabel>
      <div className="flex flex-col gap-0.5 px-1.5 pb-1 text-muted-foreground text-xs">
        <span>4 files · last command 2 min ago</span>
        <span>Resets after 30 min idle</span>
      </div>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      {onOpenPanel ? (
        <DropdownMenuItem onClick={onOpenPanel}>
          <MonitorIcon />
          Open sandbox panel
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={shell.restartSandbox}>
        <RefreshCwIcon />
        Restart
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={shell.sandboxStatus === "stopped"}
        onClick={shell.stopSandbox}
        variant="destructive"
      >
        <SquareIcon />
        Stop
      </DropdownMenuItem>
    </DropdownMenuGroup>
  </>
);

export const ChatActionsMenuBody = ({
  shell,
  chat,
  onRename,
}: {
  shell: Shell;
  chat: Chat;
  onRename: () => void;
}) => (
  <DropdownMenuGroup>
    <DropdownMenuItem onClick={onRename}>
      <PencilIcon />
      Rename
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => shell.togglePin(chat.id)}>
      <StarIcon />
      {chat.pinned ? "Unpin" : "Pin"}
    </DropdownMenuItem>
    <DropdownMenuItem
      onClick={() => shell.archive(chat.id)}
      variant="destructive"
    >
      <EyeOffIcon />
      Archive
    </DropdownMenuItem>
  </DropdownMenuGroup>
);

export const MenuShortcut = DropdownMenuShortcut;

/* -------------------------------------------------------------------------- */
/* Rename input                                                               */
/* -------------------------------------------------------------------------- */

export const RenameInput = ({
  initial,
  onDone,
  className,
}: {
  initial: string;
  onDone: (value: string | null) => void;
  className?: string;
}) => {
  const [value, setValue] = useState(initial);
  return (
    <Input
      aria-label="Chat title"
      autoFocus
      className={cn("h-7 px-2 text-sm", className)}
      onBlur={() => onDone(value)}
      onChange={(event) => setValue(event.currentTarget.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onDone(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone(null);
        }
      }}
      value={value}
    />
  );
};

/* -------------------------------------------------------------------------- */
/* Branch switcher                                                            */
/* -------------------------------------------------------------------------- */

export const BranchSwitcher = ({
  shell,
  className,
  size = "icon-xs",
}: {
  shell: Shell;
  className?: string;
  size?: "icon-xs" | "icon-sm";
}) => {
  if (shell.branchCount < 2) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons, not form fields.
    <div
      aria-label="Answer branches"
      className={cn("flex items-center", className)}
      role="group"
    >
      <Button
        aria-label="Previous branch"
        onClick={() => nextBranch(shell, -1)}
        size={size}
        variant="ghost"
      >
        <ChevronLeftIcon />
      </Button>
      <span
        aria-live="polite"
        className="min-w-8 text-center text-muted-foreground text-xs tabular-nums"
      >
        {shell.branch + 1}/{shell.branchCount}
      </span>
      <Button
        aria-label="Next branch"
        onClick={() => nextBranch(shell, 1)}
        size={size}
        variant="ghost"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Conversation                                                               */
/* -------------------------------------------------------------------------- */

const AssistantTurn = ({
  message,
  shell,
}: {
  message: ChatMessage;
  shell: Shell;
}) => {
  const text = message.branches
    ? (message.branches[shell.branch] ?? message.text)
    : message.text;
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {message.reasoning ? (
          <Reasoning defaultOpen={false} duration={6}>
            <ReasoningTrigger />
            <ReasoningContent>{message.reasoning}</ReasoningContent>
          </Reasoning>
        ) : null}
        {message.tool ? (
          <Tool>
            <ToolHeader
              state="output-available"
              title={message.tool.name}
              type="tool-sandbox_exec"
            />
            <ToolContent>
              <ToolInput input={message.tool.input} />
              <ToolOutput errorText={undefined} output={message.tool.output} />
            </ToolContent>
          </Tool>
        ) : null}
        <MessageResponse key={message.branches ? shell.branch : message.id}>
          {text}
        </MessageResponse>
      </MessageContent>
      <MessageToolbar className="-ms-1.5 justify-start gap-2">
        {message.branches ? <BranchSwitcher shell={shell} /> : null}
        <MessageActions>
          <MessageAction
            label={copied ? "Copied" : "Copy"}
            onClick={() => {
              navigator.clipboard?.writeText(text).catch(() => undefined);
              setCopied(true);
              window.setTimeout(() => setCopied(false), COPIED_MS);
            }}
            size="icon-xs"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </MessageAction>
          <MessageAction
            aria-pressed={vote === "up"}
            label="Good answer"
            onClick={() => setVote(vote === "up" ? null : "up")}
            size="icon-xs"
          >
            <ThumbsUpIcon className={cn(vote === "up" && "fill-current")} />
          </MessageAction>
          <MessageAction
            aria-pressed={vote === "down"}
            label="Bad answer"
            onClick={() => setVote(vote === "down" ? null : "down")}
            size="icon-xs"
          >
            <ThumbsDownIcon className={cn(vote === "down" && "fill-current")} />
          </MessageAction>
        </MessageActions>
      </MessageToolbar>
    </Message>
  );
};

export const Conversation = ({
  shell,
  className,
  contentClassName,
  empty,
}: {
  shell: Shell;
  className?: string;
  contentClassName?: string;
  empty: ReactNode;
}) => {
  const chat = shell.activeChat;
  if (!chat) {
    return <>{empty}</>;
  }
  return (
    <MessageScrollerProvider autoScroll key={chat.id}>
      <MessageScroller className={className}>
        <MessageScrollerViewport aria-label={chat.title}>
          <MessageScrollerContent
            className={cn(
              "mx-auto w-full max-w-3xl px-4 pt-6 pb-10",
              contentClassName
            )}
          >
            {chat.messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                {message.role === "user" ? (
                  <Message from="user">
                    <MessageContent>{message.text}</MessageContent>
                  </Message>
                ) : (
                  <AssistantTurn message={message} shell={shell} />
                )}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
};

/** What a new chat shows before the first message: the context is still open. */
export const NewChatIntro = ({
  shell,
  className,
  title = "What are we working on?",
}: {
  shell: Shell;
  className?: string;
  title?: string;
}) => {
  const AgentGlyph = shell.draftAgent
    ? libraryIcon(shell.draftAgent.kind)
    : null;
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center",
        className
      )}
    >
      {shell.draftAgent && AgentGlyph ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted-foreground text-xs">
          <AgentGlyph className="size-3.5" />
          {shell.draftAgent.name}
        </span>
      ) : null}
      <h2 className="text-balance font-medium text-2xl tracking-tight">
        {shell.draftAgent?.description ?? title}
      </h2>
      <p className="max-w-md text-pretty text-muted-foreground text-sm">
        This chat will use{" "}
        <strong className="font-medium text-foreground">
          {shell.context.path}
        </strong>{" "}
        keys and budget. You can change the context until you send the first
        message.
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

export const Composer = ({
  shell,
  className,
  autoFocus,
  footerNote = true,
}: {
  shell: Shell;
  className?: string;
  autoFocus?: boolean;
  footerNote?: boolean;
}) => {
  const [model, setModel] = useState<string>(models[0].value);
  const onSubmit = useCallback(
    (message: PromptInputMessage) => shell.send(message.text),
    [shell]
  );
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <PromptInput multiple onSubmit={onSubmit}>
        <PromptInputHeader>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Message"
            autoFocus={autoFocus}
            className="min-h-12"
            placeholder={
              shell.draftAgent && !shell.activeChat
                ? `Message ${shell.draftAgent.name}…`
                : "Ask anything"
            }
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <PromptInputSelect
              items={models}
              onValueChange={(value) => setModel(String(value))}
              value={model}
            >
              <PromptInputSelectTrigger aria-label="Model">
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {models.map((item) => (
                  <PromptInputSelectItem key={item.value} value={item.value}>
                    {item.label}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </PromptInputTools>
          <PromptInputSubmit status="ready" />
        </PromptInputFooter>
      </PromptInput>
      {footerNote ? (
        <p className="px-2 text-center text-muted-foreground text-xs">
          {shell.contextLocked ? (
            <LockIcon className="me-1 inline size-3 align-[-2px]" />
          ) : null}
          {shell.context.path} keys · usage rolls up to{" "}
          {shell.contextId === "personal" ? "you" : shell.context.label}
        </p>
      ) : null}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Overlays                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Invite people. Appears instantly and fades out over 150 ms (D28); it stays
 * mounted so the exit can play, and is inert while closed.
 */
export const InviteDialog = ({ shell }: { shell: Shell }) => {
  const open = shell.inviteOpen;
  const close = useCallback(() => shell.setInviteOpen(false), [shell]);
  const [email, setEmail] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useOverlay(open, close);
  useEffect(() => {
    if (open) {
      setEmail("");
      inputRef.current?.focus();
    }
  }, [open]);
  const valid = EMAIL.test(email);
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-background/60 px-4 pt-[18vh] backdrop-blur-[2px] transition-opacity duration-150 ease-out",
        open ? "opacity-100 duration-0" : "pointer-events-none opacity-0"
      )}
      inert={!open}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        aria-labelledby="invite-title"
        aria-modal="true"
        className="flex w-full max-w-sm flex-col gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        role="dialog"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm" id="invite-title">
            Invite people to this chat
          </h2>
          <Button
            aria-label="Close"
            onClick={close}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) {
              shell.invite(email);
              close();
            }
          }}
        >
          <Input
            aria-label="Email address"
            onChange={(event) => setEmail(event.currentTarget.value)}
            placeholder="name@northwind.dev"
            ref={inputRef}
            type="email"
            value={email}
          />
          <Button disabled={!valid} type="submit">
            <ShareIcon data-icon="inline-start" />
            Invite
          </Button>
        </form>
        <p className="text-muted-foreground text-xs">
          They join as editors. Usage stays on {shell.context.path}.
        </p>
      </div>
    </div>
  );
};

export const ArchivedNotice = ({
  shell,
  className,
}: {
  shell: Shell;
  className?: string;
}) =>
  shell.archived ? (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-background text-xs shadow-md",
        className
      )}
      role="status"
    >
      <span className="min-w-0 flex-1 truncate">
        Archived “{shell.archived.title}”
      </span>
      <button
        className="rounded-sm px-1 font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-background"
        onClick={shell.undoArchive}
        type="button"
      >
        Undo
      </button>
    </div>
  ) : null;
