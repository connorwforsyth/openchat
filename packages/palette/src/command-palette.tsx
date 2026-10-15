"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import {
  AgentIcon,
  FileTextIcon,
  MessageSquareIcon,
  SettingsIcon,
  ShapesIcon,
  SparklesIcon,
  WrenchIcon,
} from "@workspace/icons";
import { ShortcutKbd } from "@workspace/shortcuts/react/shortcut-kbd";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@workspace/ui/components/command";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ChatResult } from "./chats";
import { buildContextActions, type PaletteContext } from "./context-actions";
import {
  type CachedChat,
  type PaletteAction,
  type PaletteArtifact,
  type PaletteLibraryItem,
  paletteAction,
} from "./items";
import { rankEntries } from "./rank";
import { type SearchChats, usePaletteSearch } from "./use-palette-search";

// The ⌘K palette (D14, D28). It owns no data: the app hands it actions,
// a reader over its conversation cache, the library it already has, and
// callbacks. It binds `palette.open` itself, so mounting it once is enough.
// It opens without animation: it's summoned hundreds of times a day.

export interface CommandPaletteProps {
  /** App actions (new chat, toggle sidebar, …), most important first. */
  readonly actions?: readonly PaletteAction[];
  /** Artifacts to find by title (171); listed only while searching. */
  readonly artifacts?: readonly PaletteArtifact[];
  /** Reads cached conversations; searched on every keystroke. */
  readonly cachedChats: () => readonly CachedChat[];
  readonly context?: PaletteContext;
  readonly library?: readonly PaletteLibraryItem[];
  readonly onAskAi: (prompt: string) => void;
  readonly onNewChatWithAgent?: (item: PaletteLibraryItem) => void;
  readonly onOpenArtifact?: (artifact: PaletteArtifact) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenLibraryItem: (item: PaletteLibraryItem) => void;
  readonly onSelectChat: (
    id: ConversationId,
    messageId: MessageId | null
  ) => void;
  readonly open: boolean;
  /** Full-text search on the server; without it the palette stays local. */
  readonly searchChats?: SearchChats;
  /** Settings pages, found by name only (never listed on an empty query). */
  readonly settings?: readonly PaletteAction[];
}

const LIMIT = { actions: 8, artifacts: 6, library: 6, settings: 5 } as const;

// cmdk's own keys for moving the selection (its `vimBindings` add ⌃N/⌃P/⌃J/⌃K).
const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "End", "Home"]);
const VIM_KEYS = new Set(["j", "k", "n", "p"]);
const movesSelection = (event: KeyboardEvent): boolean =>
  NAVIGATION_KEYS.has(event.key) || (event.ctrlKey && VIM_KEYS.has(event.key));

interface Selection {
  /** Set once the person moves the selection themselves (keys or pointer). */
  readonly moved: boolean;
  readonly value: string;
}

const UNMOVED: Selection = { moved: false, value: "" };

const KindIcon = ({ kind }: { readonly kind: PaletteLibraryItem["kind"] }) => {
  switch (kind) {
    case "agent":
      return <AgentIcon />;
    case "prompt":
      return <FileTextIcon />;
    case "skill":
      return <WrenchIcon />;
    default:
      return kind satisfies never;
  }
};

/** A server snippet with its match spans marked; offsets are UTF-16, like JS strings. */
export const Highlighted = ({
  highlights,
  text,
}: {
  readonly highlights: readonly {
    readonly end: number;
    readonly start: number;
  }[];
  readonly text: string;
}) => {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { end, start } of [...highlights].sort(
    (a, b) => a.start - b.start
  )) {
    if (start < at || end > text.length || end <= start) {
      continue;
    }
    parts.push(text.slice(at, start));
    parts.push(
      <mark className="bg-transparent font-medium text-foreground" key={start}>
        {text.slice(start, end)}
      </mark>
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
};

const ChatRow = ({ chat }: { readonly chat: ChatResult }) => {
  const { t } = useLingui();
  return (
    <>
      <MessageSquareIcon />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{chat.title ?? t`Untitled chat`}</span>
        {chat.snippet ? (
          <span className="truncate text-muted-foreground text-xs">
            <Highlighted
              highlights={chat.snippet.highlights}
              text={chat.snippet.snippet}
            />
          </span>
        ) : null}
      </span>
    </>
  );
};

interface ItemProps {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  /** Closes the palette; runs before `perform`. */
  readonly onDone: () => void;
  readonly perform: () => void;
  readonly value: string;
}

// Close first, then act: an action that moves focus (the composer) or opens
// another dialog must not fight the palette's focus restore.
const PaletteItem = ({
  children,
  disabled,
  onDone,
  perform,
  value,
}: ItemProps) => {
  const handleSelect = useCallback(() => {
    onDone();
    perform();
  }, [onDone, perform]);
  return (
    <CommandItem disabled={disabled} onSelect={handleSelect} value={value}>
      {children}
    </CommandItem>
  );
};

const ChatItem = ({
  chat,
  onDone,
  onSelectChat,
}: {
  readonly chat: ChatResult;
  readonly onDone: () => void;
  readonly onSelectChat: CommandPaletteProps["onSelectChat"];
}) => {
  const perform = useCallback(
    () => onSelectChat(chat.id, chat.messageId),
    [chat.id, chat.messageId, onSelectChat]
  );
  return (
    <PaletteItem onDone={onDone} perform={perform} value={`chat:${chat.id}`}>
      <ChatRow chat={chat} />
    </PaletteItem>
  );
};

const LibraryItem = ({
  item,
  onDone,
  onOpen,
}: {
  readonly item: PaletteLibraryItem;
  readonly onDone: () => void;
  readonly onOpen: (item: PaletteLibraryItem) => void;
}) => {
  const perform = useCallback(() => onOpen(item), [item, onOpen]);
  return (
    <PaletteItem onDone={onDone} perform={perform} value={`library:${item.id}`}>
      <KindIcon kind={item.kind} />
      <span className="truncate">{item.name}</span>
    </PaletteItem>
  );
};

const ArtifactItem = ({
  artifact,
  onDone,
  onOpen,
}: {
  readonly artifact: PaletteArtifact;
  readonly onDone: () => void;
  readonly onOpen: (artifact: PaletteArtifact) => void;
}) => {
  const perform = useCallback(() => onOpen(artifact), [artifact, onOpen]);
  return (
    <PaletteItem
      onDone={onDone}
      perform={perform}
      value={`artifact:${artifact.id}`}
    >
      <ShapesIcon />
      <span className="truncate">{artifact.title}</span>
    </PaletteItem>
  );
};

const AskItem = ({
  onAskAi,
  onDone,
  prompt,
}: {
  readonly onAskAi: (prompt: string) => void;
  readonly onDone: () => void;
  readonly prompt: string;
}) => {
  const perform = useCallback(() => onAskAi(prompt), [onAskAi, prompt]);
  return (
    <PaletteItem onDone={onDone} perform={perform} value="ask-ai">
      <SparklesIcon />
      <span className="truncate">
        <Trans>Ask AI: “{prompt}”</Trans>
      </span>
    </PaletteItem>
  );
};

export const CommandPalette = ({
  actions = [],
  artifacts = [],
  cachedChats,
  context,
  library = [],
  onAskAi,
  onNewChatWithAgent,
  onOpenArtifact,
  onOpenChange,
  onSelectChat,
  onOpenLibraryItem,
  open,
  searchChats,
  settings = [],
}: CommandPaletteProps) => {
  const { i18n, t } = useLingui();
  const [query, setQueryState] = useState("");
  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const [selection, setSelection] = useState<Selection>(UNMOVED);
  // True while cmdk handles a key or pointer move of the person's: only then
  // is its value change theirs. Its own picks (first item on mount or on a
  // new search) are ignored: the selection rule below decides those.
  const personMoving = useRef(false);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setSelection(UNMOVED);
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!next) {
        setQuery("");
      }
      onOpenChange(next);
    },
    [onOpenChange, setQuery]
  );
  useShortcut("palette.open", () => setOpen(!open));

  const { chats, showSearching } = usePaletteSearch({
    cachedChats: open ? cachedChats : () => [],
    query: open ? query : "",
    searchChats,
  });

  const allActions = useMemo(() => {
    const contextActions = context ? buildContextActions(i18n, context) : [];
    const agentActions =
      onNewChatWithAgent && searching
        ? library
            .filter((item) => item.kind === "agent")
            .map((item) => {
              const { name } = item;
              return paletteAction(
                {
                  id: `new-chat-with:${item.id}`,
                  keywords: [t`agent`],
                  section: "actions",
                  title: t`New chat with ${name}`,
                },
                () => onNewChatWithAgent(item)
              );
            })
        : [];
    return [...actions, ...contextActions, ...agentActions];
  }, [actions, context, i18n, library, onNewChatWithAgent, searching, t]);

  const rankedActions = rankEntries(trimmed, allActions, LIMIT.actions);
  const rankedLibrary = searching
    ? rankEntries(
        trimmed,
        library.map((item) => ({
          item,
          subtitle: item.description,
          title: item.name,
        })),
        LIMIT.library
      )
    : [];
  const rankedArtifacts =
    searching && onOpenArtifact
      ? rankEntries(
          trimmed,
          artifacts.map((artifact) => ({
            artifact,
            subtitle: null,
            title: artifact.title,
          })),
          LIMIT.artifacts
        )
      : [];
  const rankedSettings = searching
    ? rankEntries(trimmed, settings, LIMIT.settings)
    : [];

  const close = useCallback(() => setOpen(false), [setOpen]);

  // The selection rule (ticket 100): the first item is selected whenever the
  // query changes or results arrive, until the person moves the selection;
  // from then on it stays where they put it (while that item is listed).
  // So Enter opens the top result even when a chat lands above "Ask AI".
  const values = [
    ...rankedActions
      .filter((action) => !action.disabled)
      .map((action) => action.id),
    ...chats.map((chat) => `chat:${chat.id}`),
    ...rankedArtifacts.map(({ artifact }) => `artifact:${artifact.id}`),
    ...rankedLibrary.map(({ item }) => `library:${item.id}`),
    ...rankedSettings.map((entry) => entry.id),
    ...(searching ? ["ask-ai"] : []),
  ];
  const selected =
    selection.moved && values.includes(selection.value)
      ? selection.value
      : (values[0] ?? "");

  const markPersonMoving = useCallback(() => {
    personMoving.current = true;
    // cmdk changes the value synchronously inside this same event.
    queueMicrotask(() => {
      personMoving.current = false;
    });
  }, []);
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent) => {
      if (movesSelection(event)) {
        markPersonMoving();
      }
    },
    [markPersonMoving]
  );
  const onValueChange = useCallback((value: string) => {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: set by the capture handlers above, in the same event, before cmdk calls this.
    if (personMoving.current) {
      setSelection({ moved: true, value });
    }
  }, []);

  return (
    <CommandDialog
      className="data-closed:animate-none data-open:animate-none"
      description={t`Search chats, agents and settings, or run an action`}
      onOpenChange={setOpen}
      open={open}
      title={t`Command palette`}
    >
      <Command
        loop
        onKeyDownCapture={onKeyDownCapture}
        onPointerMoveCapture={markPersonMoving}
        onValueChange={onValueChange}
        shouldFilter={false}
        value={selected}
      >
        <div className="relative">
          <CommandInput
            onValueChange={setQuery}
            placeholder={t`Search or type a command…`}
            value={query}
          />
          {/* Quiet and late: a spinner in the input row once a search has
              run ~300ms, never a row in the list (ticket 100). */}
          {showSearching ? (
            <div className="pointer-events-none absolute inset-y-0 end-3 flex items-center pt-1 text-muted-foreground">
              <Spinner aria-label={t`Searching messages…`} />
            </div>
          ) : null}
        </div>
        <CommandList>
          <CommandEmpty>
            <Trans>Nothing found.</Trans>
          </CommandEmpty>
          {rankedActions.length > 0 ? (
            <CommandGroup heading={t`Actions`}>
              {rankedActions.map((action) => (
                <PaletteItem
                  disabled={action.disabled}
                  key={action.id}
                  onDone={close}
                  perform={action.perform}
                  value={action.id}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {action.title}
                  </span>
                  {action.shortcutId ? (
                    <CommandShortcut>
                      <ShortcutKbd id={action.shortcutId} />
                    </CommandShortcut>
                  ) : null}
                </PaletteItem>
              ))}
            </CommandGroup>
          ) : null}
          {chats.length > 0 ? (
            <CommandGroup heading={searching ? t`Chats` : t`Recent chats`}>
              {chats.map((chat) => (
                <ChatItem
                  chat={chat}
                  key={chat.id}
                  onDone={close}
                  onSelectChat={onSelectChat}
                />
              ))}
            </CommandGroup>
          ) : null}
          {onOpenArtifact && rankedArtifacts.length > 0 ? (
            <CommandGroup heading={t`Artifacts`}>
              {rankedArtifacts.map(({ artifact }) => (
                <ArtifactItem
                  artifact={artifact}
                  key={artifact.id}
                  onDone={close}
                  onOpen={onOpenArtifact}
                />
              ))}
            </CommandGroup>
          ) : null}
          {rankedLibrary.length > 0 ? (
            <CommandGroup heading={t`Library`}>
              {rankedLibrary.map(({ item }) => (
                <LibraryItem
                  item={item}
                  key={item.id}
                  onDone={close}
                  onOpen={onOpenLibraryItem}
                />
              ))}
            </CommandGroup>
          ) : null}
          {rankedSettings.length > 0 ? (
            <CommandGroup heading={t`Settings`}>
              {rankedSettings.map((entry) => (
                <PaletteItem
                  key={entry.id}
                  onDone={close}
                  perform={entry.perform}
                  value={entry.id}
                >
                  <SettingsIcon />
                  <span className="truncate">{entry.title}</span>
                </PaletteItem>
              ))}
            </CommandGroup>
          ) : null}
          {searching ? (
            <CommandGroup heading={t`Ask AI`}>
              <AskItem onAskAi={onAskAi} onDone={close} prompt={trimmed} />
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};
