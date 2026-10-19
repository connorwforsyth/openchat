"use client";

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BotIcon,
  ChevronsUpDownIcon,
  ClockIcon,
  LibraryIcon,
  NewChatIcon,
  RotateCcwIcon,
  SearchIcon,
  ShapesIcon,
  XIcon,
} from "@workspace/icons";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { useToastManager } from "@workspace/ui/components/toast";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  type AttentionItem,
  isUnread,
  needsAttention,
  nextNeedingAttention,
  type RunSignal,
  unreadMarker,
} from "../model/attention";
import {
  buildSidebarList,
  type ListSectionKey,
  SIDEBAR_PAGE_SIZE,
  type SidebarList,
  type SidebarSort,
  sidebarSortSchema,
  visibleOrder,
} from "../model/sidebar-list";
import { usePlatform } from "../shell/platform";
import { useUndoToast } from "../shell/use-undo-toast";
import { isTypingEvent } from "../shortcuts/registry";
import { ShortcutHint } from "../shortcuts/shortcut-hint";
import { AccountMenu, type AccountMenuProps } from "./account-menu";
import { ChatRow, type RowPick, type SidebarChat } from "./chat-row";
import { emptySelection, selectionReducer } from "./selection";

export interface ChatSidebarProps {
  readonly account: AccountMenuProps;
  readonly activeId: ConversationId | null;
  /** The archive view's chats; `undefined` until the view first opens. */
  readonly archivedChats?: readonly SidebarChat[];
  readonly archivedLoading?: boolean;
  /** Where the Artifacts page lives (124); a plain link. */
  readonly artifactsHref?: string;
  /** The org or brand at the top of the sidebar. */
  readonly brand?: ReactNode;
  readonly chats: readonly SidebarChat[];
  /**
   * The owner's Dot (172): ⌘. opens its chat, and its chat stays out of the
   * list below, since it's pinned at the top in `top`.
   */
  readonly dot?: { readonly conversationId: ConversationId };
  /** The Dot's face, small: the collapsed rail's Dot button (179). */
  readonly dotFace?: ReactNode;
  /**
   * The Dots section (172): replaces the plain `dotsHref` link when the app
   * lists the owner's Dots itself.
   */
  readonly dots?: ReactNode;
  /** Where the Dots page lives (172); a plain link. */
  readonly dotsHref?: string;
  /** Where the library lives (ticket 017); a plain link. */
  readonly libraryHref?: string;
  /** When each schedule-targeted chat runs next (172). */
  readonly nextRuns?: ReadonlyMap<ConversationId, string>;
  /** The clock for date groups; defaults to now. */
  readonly now?: Date;
  /** Optimistic: hide it now; the undo toast calls `onRestore`. */
  readonly onArchive: (id: ConversationId) => void;
  /** The archive view opened or closed, so the host fetches its chats. */
  readonly onArchivedViewChange?: (open: boolean) => void;
  /** Bulk archive (178); without it rows can't be picked. */
  readonly onArchiveMany?: (
    ids: readonly ConversationId[]
  ) => Promise<{ readonly failed: number }>;
  readonly onNewChat: () => void;
  /** Opens the ⌘K palette (ticket 024). */
  readonly onOpenPalette?: () => void;
  readonly onRename: (id: ConversationId, title: string) => void;
  readonly onRestore: (id: ConversationId) => void;
  readonly onSelect: (id: ConversationId) => void;
  /** Moves the caller's read marker (176); without it there's no unread. */
  readonly onSetLastRead?: (id: ConversationId, lastReadAt: string) => void;
  readonly onTogglePin: (id: ConversationId, pinned: boolean) => void;
  /** Where the scheduled tasks live (173a, 183); a plain link. */
  readonly schedulesHref?: string;
  /** Runs in flight or waiting, by chat, for "Needs attention" (176). */
  readonly signals?: ReadonlyMap<ConversationId, RunSignal>;
  /** The sidebar toggle, at the end of the brand row (113). */
  readonly toggle?: ReactNode;
  /** Above the actions: the owner's primary Dot (172). */
  readonly top?: ReactNode;
}

// Same rhythm as the chat rows (071): 36px, 44px on touch.
export const navRowClass =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-foreground/5 focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0";

const headingClass =
  "px-2 pt-5 pb-1.5 font-medium text-muted-foreground text-xs";

const noSignals: ReadonlyMap<ConversationId, RunSignal> = new Map();
const noRuns: ReadonlyMap<ConversationId, string> = new Map();

/** After this many archives from one group, offer to archive the rest. */
const SUGGEST_AFTER = 3;
const SUGGEST_TIMEOUT_MS = 10_000;

const SORT_KEY = "sidebar.sort";

/** The saved sort (localStorage), read after mount so SSR matches. */
const useSavedSort = (): [SidebarSort, (sort: SidebarSort) => void] => {
  const [sort, setSort] = useState<SidebarSort>("updated");
  useEffect(() => {
    try {
      const saved = sidebarSortSchema.safeParse(
        window.localStorage.getItem(SORT_KEY)
      );
      if (saved.success) {
        setSort(saved.data);
      }
    } catch {
      // Storage can be off (private mode); the default stands.
    }
  }, []);
  const choose = useCallback((next: SidebarSort) => {
    setSort(next);
    try {
      window.localStorage.setItem(SORT_KEY, next);
    } catch {
      // As above: it just won't be remembered.
    }
  }, []);
  return [sort, choose];
};

const useGroupLabel = () => {
  const { t } = useLingui();
  return useCallback(
    (key: ListSectionKey | "pinned" | "attention"): string => {
      switch (key) {
        case "attention":
          return t`Needs attention`;
        case "pinned":
          return t`Pinned`;
        case "today":
          return t`Today`;
        case "yesterday":
          return t`Yesterday`;
        case "previous7Days":
          return t`Previous 7 days`;
        case "older":
          return t`Older`;
        case "all":
          return t`Chats`;
        default:
          return key satisfies never;
      }
    },
    [t]
  );
};

/**
 * Fades the list's top and bottom edges while there's more to scroll that
 * way (177): a mask, so nothing but opacity changes, set on the element
 * directly so scrolling never re-renders the list.
 */
const useScrollFades = () => {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const update = useCallback(() => {
    const element = ref.current;
    element?.toggleAttribute("data-fade-top", element.scrollTop > 1);
    element?.toggleAttribute(
      "data-fade-bottom",
      element.scrollTop + element.clientHeight < element.scrollHeight - 1
    );
  }, []);
  useEffect(() => {
    update();
    // The scroller resizes with the window, its content with the rows.
    const observer = new ResizeObserver(update);
    for (const element of [ref.current, content.current]) {
      if (element) {
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [update]);
  return { content, ref, update };
};

function SortMenu({
  onSort,
  sort,
}: {
  readonly onSort: (sort: SidebarSort) => void;
  readonly sort: SidebarSort;
}) {
  const { t } = useLingui();
  const choose = useCallback(
    (value: unknown) => {
      const parsed = sidebarSortSchema.safeParse(value);
      if (parsed.success) {
        onSort(parsed.data);
      }
    },
    [onSort]
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Sort chats`}
            size="icon-xs"
            title={t`Sort chats`}
            variant="ghost"
          />
        }
      >
        <ChevronsUpDownIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <Trans>Sort by</Trans>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup onValueChange={choose} value={sort}>
            <DropdownMenuRadioItem value="updated">
              <Trans>Last updated</Trans>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="created">
              <Trans>Created</Trans>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArchivedRow({
  chat,
  onRestore,
}: {
  readonly chat: SidebarChat;
  readonly onRestore: (id: ConversationId) => void;
}) {
  const { t } = useLingui();
  const title = chat.title ?? t`New chat`;
  const restore = useCallback(() => onRestore(chat.id), [chat.id, onRestore]);
  return (
    <li className="flex h-9 pointer-coarse:h-11 items-center gap-2 rounded-lg ps-2 pe-1 text-sm hover:bg-sidebar-foreground/5">
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <Button
        aria-label={t`Unarchive ${title}`}
        onClick={restore}
        size="icon-xs"
        title={t`Unarchive`}
        variant="ghost"
      >
        <RotateCcwIcon aria-hidden />
      </Button>
    </li>
  );
}

function ArchiveView({
  chats,
  loading,
  onBack,
  onRestore,
}: {
  readonly chats: readonly SidebarChat[] | undefined;
  readonly loading: boolean;
  readonly onBack: () => void;
  readonly onRestore: (id: ConversationId) => void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [restored, setRestored] = useState<ReadonlySet<ConversationId>>(
    new Set()
  );
  const search = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
    []
  );
  const restore = useCallback(
    (id: ConversationId) => {
      setRestored((ids) => new Set([...ids, id]));
      onRestore(id);
    },
    [onRestore]
  );
  const needle = query.trim().toLocaleLowerCase();
  const shown = (chats ?? []).filter(
    (chat) =>
      !restored.has(chat.id) &&
      (needle === "" ||
        (chat.title ?? t`New chat`).toLocaleLowerCase().includes(needle))
  );
  return (
    <section aria-labelledby="archived-heading" className="flex flex-col">
      <div className="flex items-center gap-1 pt-3 pb-2">
        <Button
          aria-label={t`Back to chats`}
          onClick={onBack}
          size="icon-xs"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        <h3 className="font-medium text-sm" id="archived-heading">
          <Trans>Archived</Trans>
        </h3>
      </div>
      <Input
        aria-label={t`Search archived chats`}
        className="mb-2 h-8"
        onChange={search}
        placeholder={t`Search archived chats`}
        value={query}
      />
      {loading ? (
        <p className="px-2 pt-2 text-muted-foreground text-sm">
          <Trans>Loading archived chats…</Trans>
        </p>
      ) : null}
      {!loading && shown.length === 0 ? (
        <p className="px-2 pt-2 text-muted-foreground text-sm">
          {needle === "" ? (
            <Trans>No archived chats.</Trans>
          ) : (
            <Trans>No matches.</Trans>
          )}
        </p>
      ) : null}
      <ul className="flex flex-col gap-px">
        {shown.map((chat) => (
          <ArchivedRow chat={chat} key={chat.id} onRestore={restore} />
        ))}
      </ul>
    </section>
  );
}

const WINDOW_CONTROLS_ROW =
  "select-none ps-20 [-webkit-app-region:drag] [app-region:drag] [&_:is(a,button,[role=button])]:[-webkit-app-region:no-drag] [&_:is(a,button,[role=button])]:[app-region:no-drag]";

const isModZ = (event: globalThis.KeyboardEvent, isApple: boolean) =>
  event.key.toLowerCase() === "z" &&
  !event.shiftKey &&
  !event.altKey &&
  (isApple ? event.metaKey : event.ctrlKey);

interface ArchiveFlowInput {
  readonly list: SidebarList<SidebarChat>;
  readonly onArchive: (id: ConversationId) => void;
  readonly onArchiveMany: ChatSidebarProps["onArchiveMany"];
  readonly onRestore: (id: ConversationId) => void;
}

/**
 * Archive with an undo toast and ⌘Z (177); bulk archive with a partial-failure
 * toast; and after a few archives from one date group, an offer to archive
 * the rest of it (178).
 */
const useArchiveFlow = ({
  list,
  onArchive,
  onArchiveMany,
  onRestore,
}: ArchiveFlowInput) => {
  const { t } = useLingui();
  const { isApple } = usePlatform();
  const showUndo = useUndoToast();
  const toasts = useToastManager();
  const groupLabel = useGroupLabel();
  const lastUndo = useRef<{
    readonly id: string;
    readonly run: () => void;
  } | null>(null);
  const archivedFrom = useRef(new Map<ListSectionKey, number>());

  const archiveMany = useCallback(
    async (ids: readonly ConversationId[]) => {
      if (!onArchiveMany) {
        return;
      }
      const { failed } = await onArchiveMany(ids);
      const done = ids.length - failed;
      toasts.add(
        failed > 0
          ? {
              priority: "high",
              title: t`Archived ${done}; ${failed} failed`,
              type: "error",
            }
          : {
              priority: "low",
              title: t`${plural(done, { one: "Archived # chat", other: "Archived # chats" })}`,
            }
      );
    },
    [onArchiveMany, t, toasts]
  );

  const suggestRest = useCallback(
    (key: ListSectionKey, archivedId: ConversationId) => {
      const seen = (archivedFrom.current.get(key) ?? 0) + 1;
      archivedFrom.current.set(key, seen);
      const rest = (list.sections.find((each) => each.key === key)?.items ?? [])
        .filter((item) => item.id !== archivedId)
        .map((item) => item.id);
      if (seen < SUGGEST_AFTER || rest.length === 0) {
        return;
      }
      archivedFrom.current.set(key, 0);
      const group = groupLabel(key);
      const remaining = rest.length;
      toasts.add({
        actionProps: {
          children: t`Archive ${remaining}`,
          onClick: () => archiveMany(rest),
        },
        priority: "low",
        timeout: SUGGEST_TIMEOUT_MS,
        title: t`Archive the remaining ${remaining} in ${group}?`,
      });
    },
    [archiveMany, groupLabel, list, t, toasts]
  );

  const archive = useCallback(
    (chat: SidebarChat) => {
      const key = list.sections.find((each) =>
        each.items.some((item) => item.id === chat.id)
      )?.key;
      onArchive(chat.id);
      const title = chat.title ?? t`New chat`;
      const run = () => onRestore(chat.id);
      const toastId = showUndo({ onUndo: run, title: t`Archived “${title}”` });
      lastUndo.current = { id: toastId, run };
      if (key && onArchiveMany) {
        suggestRest(key, chat.id);
      }
    },
    [list, onArchive, onArchiveMany, onRestore, showUndo, suggestRest, t]
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const undo = lastUndo.current;
      // biome-ignore lint/suspicious/noUnnecessaryConditions: archive() sets the ref; the inference can't see it
      if (!undo || isTypingEvent(event) || !isModZ(event, isApple)) {
        return;
      }
      event.preventDefault();
      lastUndo.current = null;
      undo.run();
      toasts.close(undo.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isApple, toasts]);

  return { archive, archiveMany };
};

interface KeysInput {
  readonly active: SidebarChat | undefined;
  readonly activeId: ConversationId | null;
  readonly archive: (chat: SidebarChat) => void;
  readonly attention: readonly AttentionItem<SidebarChat>[];
  readonly onSelect: (id: ConversationId) => void;
  readonly onSetLastRead: ChatSidebarProps["onSetLastRead"];
  readonly onTogglePin: (id: ConversationId, pinned: boolean) => void;
  readonly order: readonly SidebarChat[];
  readonly toggleUnread: (chat: SidebarChat, unread: boolean) => void;
}

/** The sidebar's keyboard set (176, 177), after ChatGPT's command registry. */
const useSidebarKeys = ({
  active,
  activeId,
  archive,
  attention,
  onSelect,
  onSetLastRead,
  onTogglePin,
  order,
  toggleUnread,
}: KeysInput) => {
  useShortcut("chat.archive", () => active && archive(active), {
    enabled: active !== undefined,
  });
  useShortcut(
    "chat.pin",
    () => active && onTogglePin(active.id, !active.pinned),
    { enabled: active !== undefined }
  );
  useShortcut(
    "chat.markUnread",
    () => active && toggleUnread(active, !isUnread(active)),
    { enabled: active !== undefined && onSetLastRead !== undefined }
  );
  const step = (by: 1 | -1) => {
    const at = order.findIndex((chat) => chat.id === activeId);
    const next =
      at === -1
        ? order.at(by === 1 ? 0 : -1)
        : order[(at + by + order.length) % order.length];
    if (next) {
      onSelect(next.id);
    }
  };
  useShortcut("sidebar.next", () => step(1));
  useShortcut("sidebar.prev", () => step(-1));
  useShortcut("attention.next", () => {
    const next = nextNeedingAttention(attention, activeId);
    if (next) {
      onSelect(next);
    }
  });
  useShortcut(
    "unread.clear",
    () => {
      for (const item of attention) {
        if (item.attention === "unread" && item.chat.lastMessageAt) {
          onSetLastRead?.(item.chat.id, item.chat.lastMessageAt);
        }
      }
    },
    { enabled: onSetLastRead !== undefined }
  );
};

function SelectionBar({
  count,
  onArchive,
  onClear,
}: {
  readonly count: number;
  readonly onArchive: () => void;
  readonly onClear: () => void;
}) {
  const { t } = useLingui();
  // Escape lets go of the selection, wherever focus is.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClear]);
  return (
    <div
      aria-live="polite"
      className="mx-2 mt-2 flex items-center gap-1 rounded-lg bg-sidebar-foreground/5 py-1 ps-2 pe-1 text-sm"
      data-slot="chat-sidebar-selection"
    >
      <span className="flex-1 font-medium">
        <Trans>{count} selected</Trans>
      </span>
      <Button onClick={onArchive} size="xs" variant="ghost">
        <ArchiveIcon aria-hidden />
        <Trans>Archive</Trans>
      </Button>
      <Button
        aria-label={t`Clear selection`}
        onClick={onClear}
        size="icon-xs"
        variant="ghost"
      >
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

function ListTools({
  onOpenArchive,
  onSort,
  sort,
}: {
  readonly onOpenArchive?: () => void;
  readonly onSort: (sort: SidebarSort) => void;
  readonly sort: SidebarSort;
}) {
  const { t } = useLingui();
  return (
    <div className="flex items-center gap-0.5 pt-4">
      <SortMenu onSort={onSort} sort={sort} />
      {onOpenArchive ? (
        <Button
          aria-label={t`Archived chats`}
          onClick={onOpenArchive}
          size="icon-xs"
          title={t`Archived chats`}
          variant="ghost"
        >
          <ArchiveIcon aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function Paging({
  hasMore,
  limit,
  onLimit,
}: {
  readonly hasMore: boolean;
  readonly limit: number;
  readonly onLimit: (limit: number) => void;
}) {
  const more = useCallback(
    () => onLimit(limit + SIDEBAR_PAGE_SIZE),
    [limit, onLimit]
  );
  const less = useCallback(() => onLimit(SIDEBAR_PAGE_SIZE), [onLimit]);
  const expanded = limit > SIDEBAR_PAGE_SIZE;
  if (!(hasMore || expanded)) {
    return null;
  }
  return (
    <div className="flex gap-1 px-1 pt-2">
      {hasMore ? (
        <Button
          className="text-muted-foreground"
          onClick={more}
          size="sm"
          variant="ghost"
        >
          <Trans>Show more</Trans>
        </Button>
      ) : null}
      {expanded ? (
        <Button
          className="text-muted-foreground"
          onClick={less}
          size="sm"
          variant="ghost"
        >
          <Trans>Show less</Trans>
        </Button>
      ) : null}
    </div>
  );
}

function PrimaryNav({
  artifactsHref,
  dots,
  dotsHref,
  libraryHref,
  onNewChat,
  onOpenPalette,
  schedulesHref,
}: Pick<
  ChatSidebarProps,
  | "artifactsHref"
  | "dots"
  | "dotsHref"
  | "libraryHref"
  | "onNewChat"
  | "onOpenPalette"
  | "schedulesHref"
>) {
  const { t } = useLingui();
  const dotsLink = dotsHref ? (
    <a className={navRowClass} href={dotsHref}>
      <BotIcon aria-hidden />
      <span className="flex-1">
        <Trans>Dots</Trans>
      </span>
    </a>
  ) : null;
  return (
    <nav aria-label={t`Primary`} className="flex flex-col gap-0.5 px-2">
      <button className={navRowClass} onClick={onNewChat} type="button">
        <NewChatIcon aria-hidden />
        <span className="flex-1">
          <Trans>New chat</Trans>
        </span>
        <ShortcutHint id="chat.new" />
      </button>
      {onOpenPalette ? (
        <button className={navRowClass} onClick={onOpenPalette} type="button">
          <SearchIcon aria-hidden />
          <span className="flex-1">
            <Trans>Search</Trans>
          </span>
          <ShortcutHint id="palette.open" />
        </button>
      ) : null}
      {artifactsHref ? (
        <a className={navRowClass} href={artifactsHref}>
          <ShapesIcon aria-hidden />
          <span className="flex-1">
            <Trans>Artifacts</Trans>
          </span>
        </a>
      ) : null}
      {dots ?? dotsLink}
      {schedulesHref ? (
        <a className={navRowClass} href={schedulesHref}>
          <ClockIcon aria-hidden />
          <span className="flex-1">
            <Trans>Scheduled</Trans>
          </span>
        </a>
      ) : null}
      {libraryHref ? (
        <a className={navRowClass} href={libraryHref}>
          <LibraryIcon aria-hidden />
          <span className="flex-1">
            <Trans>Library</Trans>
          </span>
        </a>
      ) : null}
    </nav>
  );
}

/**
 * The Classic sidebar (009, 176–178): your Dot, the actions, what needs your
 * attention, pinned chats, then the rest by date with a sort menu and "Show
 * more" paging; bulk select, an archive view and the account footer.
 */
export function ChatSidebar({
  account,
  activeId,
  archivedChats,
  archivedLoading = false,
  brand,
  chats,
  dot,
  dotFace: _dotFace,
  nextRuns = noRuns,
  now,
  onArchive,
  onArchiveMany,
  onArchivedViewChange,
  onRename,
  onRestore,
  onSelect,
  onSetLastRead,
  onTogglePin,
  signals = noSignals,
  toggle,
  top,
  ...nav
}: ChatSidebarProps) {
  const { platform } = usePlatform();
  const groupLabel = useGroupLabel();
  const [sort, setSort] = useSavedSort();
  const [limit, setLimit] = useState(SIDEBAR_PAGE_SIZE);
  const [view, setView] = useState<"archived" | "chats">("chats");
  const [selection, dispatch] = useReducer(selectionReducer, emptySelection);

  const dotId = dot?.conversationId ?? null;
  // Your Dot is pinned at the top; it isn't a recent chat as well.
  const recents = useMemo(
    () => (dotId ? chats.filter((chat) => chat.id !== dotId) : chats),
    [chats, dotId]
  );
  const list = useMemo(
    () => buildSidebarList(recents, { limit, now: now ?? new Date(), sort }),
    [limit, now, recents, sort]
  );
  const order = useMemo(() => visibleOrder(list), [list]);
  const tracksAttention = onSetLastRead !== undefined || signals.size > 0;
  const attention = useMemo(
    () => (tracksAttention ? needsAttention(recents, signals) : []),
    [recents, signals, tracksAttention]
  );
  const attentionById = useMemo(
    () => new Map(attention.map((item) => [item.chat.id, item.attention])),
    [attention]
  );
  const active = useMemo(
    () => chats.find((chat) => chat.id === activeId),
    [activeId, chats]
  );

  useEffect(() => {
    dispatch({ keep: new Set(chats.map((chat) => chat.id)), type: "prune" });
  }, [chats]);

  const { archive, archiveMany } = useArchiveFlow({
    list,
    onArchive,
    onArchiveMany,
    onRestore,
  });

  const toggleUnread = useCallback(
    (chat: SidebarChat, unread: boolean) => {
      const marker = unread ? unreadMarker(chat) : chat.lastMessageAt;
      if (marker && onSetLastRead) {
        onSetLastRead(chat.id, marker);
      }
    },
    [onSetLastRead]
  );

  useSidebarKeys({
    active,
    activeId,
    archive,
    attention,
    onSelect,
    onSetLastRead,
    onTogglePin,
    order,
    toggleUnread,
  });

  const pick = useCallback(
    (chat: SidebarChat, how: RowPick) =>
      dispatch(
        how === "range"
          ? { id: chat.id, order: order.map((each) => each.id), type: "range" }
          : { id: chat.id, type: "toggle" }
      ),
    [order]
  );
  const clearSelection = useCallback(() => dispatch({ type: "clear" }), []);
  const selecting = selection.ids.size > 0;
  const archiveSelected = useCallback(async () => {
    const ids = [...selection.ids];
    dispatch({ type: "clear" });
    await archiveMany(ids);
  }, [archiveMany, selection.ids]);

  const switchView = useCallback(
    (open: boolean) => {
      setView(open ? "archived" : "chats");
      onArchivedViewChange?.(open);
    },
    [onArchivedViewChange]
  );
  const openArchive = useCallback(() => switchView(true), [switchView]);
  const closeArchive = useCallback(() => switchView(false), [switchView]);

  const fades = useScrollFades();

  const row = (chat: SidebarChat, pickable: boolean) => (
    <ChatRow
      active={chat.id === activeId}
      attention={attentionById.get(chat.id) ?? null}
      chat={chat}
      key={chat.id}
      nextRunAt={
        nextRuns.get(chat.id) ?? chat.schedule?.nextRunNominalAt ?? null
      }
      onArchive={archive}
      onPick={onArchiveMany && pickable ? pick : undefined}
      onRename={onRename}
      onSelect={onSelect}
      onTogglePin={onTogglePin}
      onToggleUnread={onSetLastRead ? toggleUnread : undefined}
      selected={pickable && selection.ids.has(chat.id)}
      selecting={selecting && pickable}
    />
  );

  const group = (
    key: ListSectionKey | "pinned" | "attention",
    items: readonly SidebarChat[],
    {
      pickable = true,
      trailing,
    }: { pickable?: boolean; trailing?: ReactNode } = {}
  ) => (
    <section aria-labelledby={`chat-group-${key}`} key={key}>
      <div className="flex items-center pe-1">
        <h3 className={cn(headingClass, "flex-1")} id={`chat-group-${key}`}>
          {groupLabel(key)}
        </h3>
        {trailing}
      </div>
      <ul className="flex flex-col gap-px">
        {items.map((chat) => row(chat, pickable))}
      </ul>
    </section>
  );

  const tools = (
    <ListTools
      onOpenArchive={onArchivedViewChange ? openArchive : undefined}
      onSort={setSort}
      sort={sort}
    />
  );

  const chatsView =
    recents.length === 0 ? (
      <>
        <div className="flex justify-end">{tools}</div>
        <p className="px-2 pt-6 text-muted-foreground text-sm">
          <Trans>No chats yet. Start one and it shows up here.</Trans>
        </p>
      </>
    ) : (
      <>
        {attention.length > 0
          ? group(
              "attention",
              attention.map((item) => item.chat),
              { pickable: false }
            )
          : null}
        {list.pinned.length > 0 ? group("pinned", list.pinned) : null}
        {list.sections.length === 0 ? (
          <div className="flex justify-end">{tools}</div>
        ) : null}
        {list.sections.map((each, index) =>
          group(each.key, each.items, {
            trailing: index === 0 ? tools : null,
          })
        )}
        <Paging hasMore={list.hasMore} limit={limit} onLimit={setLimit} />
      </>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 ps-3 pe-2",
          // In the desktop app on macOS the traffic lights sit here (117):
          // leave them room, and let the row drag the window like the header.
          platform === "mac" && WINDOW_CONTROLS_ROW
        )}
        data-slot="chat-sidebar-top"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">{brand}</div>
        {toggle}
      </div>

      {top ? (
        <div className="px-2 pb-1" data-slot="chat-sidebar-dot">
          {top}
        </div>
      ) : null}
      <PrimaryNav {...nav} />

      {selecting ? (
        <SelectionBar
          count={selection.ids.size}
          onArchive={archiveSelected}
          onClear={clearSelection}
        />
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-2 pb-2",
          "data-fade-top:mask-t-from-[calc(100%-1.5rem)] data-fade-bottom:mask-b-from-[calc(100%-1.5rem)]"
        )}
        data-slot="chat-sidebar-list"
        onScroll={fades.update}
        ref={fades.ref}
      >
        <div ref={fades.content}>
          {view === "archived" ? (
            <ArchiveView
              chats={archivedChats}
              loading={archivedLoading}
              onBack={closeArchive}
              onRestore={onRestore}
            />
          ) : (
            chatsView
          )}
        </div>
      </div>

      <div className="shrink-0 border-sidebar-border border-t p-2">
        <AccountMenu {...account} />
      </div>
    </div>
  );
}
