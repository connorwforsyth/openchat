"use client";

import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ConversationId } from "@workspace/contract/schemas/common";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ClockIcon,
  EllipsisIcon,
  LibraryIcon,
  NewChatIcon,
  RotateCcwIcon,
  SearchIcon,
  ShapesIcon,
  XIcon,
} from "@workspace/icons";
import { ShortcutKbd } from "@workspace/shortcuts/react/shortcut-kbd";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
   * The old Dots section (172). Unused since 181: there's one Dot, and its
   * row is `top`. Kept so hosts can drop it in their own time.
   */
  readonly dots?: ReactNode;
  /** Where the Dots page lives: the rail's "Make your Dot" when there's none. */
  readonly dotsHref?: string;
  /** Where the library lives (ticket 017); a plain link. */
  readonly libraryHref?: string;
  /** When each schedule-targeted chat runs next (172). */
  readonly nextRuns?: ReadonlyMap<ConversationId, string>;
  /** Unused since the list lost its date headings (181). */
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
  /**
   * The icon rail is beside it on wide screens (181): Library, Artifacts,
   * Scheduled and the account menu live there, so the panel hides its own from `md` up
   * (they stay in the narrow-screen sheet, which has no rail).
   */
  readonly railed?: boolean;
  /** Where schedules live; a page row beside Library and Artifacts (181). */
  readonly scheduledHref?: string;
  /** Runs in flight or waiting, by chat, for "Needs attention" (176). */
  readonly signals?: ReadonlyMap<ConversationId, RunSignal>;
  /** The sidebar toggle, at the end of the brand row (113). */
  readonly toggle?: ReactNode;
  /** Under the actions: the owner's Dot row (172, 181). */
  readonly top?: ReactNode;
}

// ChatGPT's sidebar rhythm (181): 32px rows (44px on touch), 8px inline
// padding, the 10px row radius (`rounded-lg`), 14px text, 16px icons, a 5%
// foreground wash on hover and 8% for the open page.
export const navRowClass =
  "flex h-7.5 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-start text-sm outline-none transition-colors duration-(--motion-fast) hover:bg-sidebar-foreground/5 focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:h-10 [&_svg]:size-4 [&_svg]:shrink-0";

/** A section header: quiet, sentence case, and a button that folds it. */
const headingClass =
  "group/heading flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg px-2 text-start text-muted-foreground text-sm outline-none transition-colors duration-(--motion-fast) hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

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

type SectionKey = "chats" | "pinned" | "priority";

const useSectionLabel = () => {
  const { t } = useLingui();
  return useCallback(
    (key: SectionKey): string => {
      switch (key) {
        case "priority":
          return t`Priority`;
        case "pinned":
          return t`Pinned`;
        case "chats":
          return t`Chats`;
        default:
          return key satisfies never;
      }
    },
    [t]
  );
};

/**
 * Is a menu or dialog open over `inside`? Escape belongs to it then. One that
 * holds `inside` (the sidebar's own sheet on a phone) doesn't count.
 */
const popupOpen = (inside: Element | null): boolean =>
  [
    ...document.querySelectorAll(
      '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]'
    ),
  ].some((popup) => !(inside && popup.contains(inside)));

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
    <li className="flex h-9 pointer-coarse:h-10 items-center gap-2 rounded-lg ps-2 pe-1 text-sm hover:bg-sidebar-foreground/5">
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

interface UndoEntry {
  readonly id: string;
  readonly run: () => void;
}

/**
 * Archive with an undo toast and ⌘Z (177); bulk archive with a partial-failure
 * toast; and after a few archives from the Chats list, an offer to archive
 * the rest of it (178). ⌘Z only undoes while its toast is up, and an undone
 * archive doesn't count towards the offer.
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
  const lastUndo = useRef<UndoEntry | null>(null);
  const archivedFromList = useRef(0);

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
              title: t`${plural(done, { one: "Archived # chat", other: "Archived # chats" })}; ${plural(failed, { one: "# failed", other: "# failed" })}`,
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
    (archivedId: ConversationId) => {
      archivedFromList.current += 1;
      const rest = list.items
        .filter((item) => item.id !== archivedId)
        .map((item) => item.id);
      if (archivedFromList.current < SUGGEST_AFTER || rest.length === 0) {
        return;
      }
      archivedFromList.current = 0;
      const remaining = rest.length;
      toasts.add({
        actionProps: {
          children: t`${plural(remaining, { one: "Archive # chat", other: "Archive # chats" })}`,
          onClick: () => archiveMany(rest),
        },
        priority: "low",
        timeout: SUGGEST_TIMEOUT_MS,
        title: t`${plural(remaining, { one: "Archive the remaining # chat?", other: "Archive the remaining # chats?" })}`,
      });
    },
    [archiveMany, list, t, toasts]
  );

  const archive = useCallback(
    (chat: SidebarChat) => {
      const fromList = list.items.some((item) => item.id === chat.id);
      onArchive(chat.id);
      const title = chat.title ?? t`New chat`;
      const run = () => {
        if (fromList && archivedFromList.current > 0) {
          archivedFromList.current -= 1;
        }
        onRestore(chat.id);
      };
      let entry: UndoEntry | null = null;
      const toastId = showUndo({
        // Once the toast is gone, so is ⌘Z's claim on it.
        onClose: () => {
          if (lastUndo.current === entry) {
            lastUndo.current = null;
          }
        },
        onUndo: run,
        title: t`Archived “${title}”`,
      });
      entry = { id: toastId, run };
      lastUndo.current = entry;
      if (fromList && onArchiveMany) {
        suggestRest(chat.id);
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
  readonly dotId: ConversationId | null;
  readonly markAllRead: () => void;
  readonly onSelect: (id: ConversationId) => void;
  readonly onSetLastRead: ChatSidebarProps["onSetLastRead"];
  readonly onTogglePin: (id: ConversationId, pinned: boolean) => void;
  readonly order: readonly SidebarChat[];
  readonly toggleFilter: () => void;
  readonly toggleUnread: (chat: SidebarChat, unread: boolean) => void;
}

/** The sidebar's keyboard set (176, 177), after ChatGPT's command registry. */
const useSidebarKeys = ({
  active,
  activeId,
  archive,
  attention,
  dotId,
  markAllRead,
  onSelect,
  onSetLastRead,
  onTogglePin,
  order,
  toggleFilter,
  toggleUnread,
}: KeysInput) => {
  useShortcut("dot.open", () => dotId && onSelect(dotId), {
    enabled: dotId !== null,
  });
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
  useShortcut("unread.clear", markAllRead, {
    enabled: onSetLastRead !== undefined,
  });
  useShortcut("attention.filter", toggleFilter);
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
  const bar = useRef<HTMLDivElement>(null);
  // Escape lets go of the selection, wherever focus is, unless a menu or
  // dialog is open: that Escape closes it, and the selection stays.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !popupOpen(bar.current)
      ) {
        onClear();
      }
    };
    // Capture: a closing menu is still in the DOM when this runs.
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClear]);
  return (
    <div
      aria-live="polite"
      className="mx-2 mt-2 flex items-center gap-1 rounded-lg bg-sidebar-foreground/5 py-1 ps-2 pe-1 text-sm"
      data-slot="chat-sidebar-selection"
      ref={bar}
    >
      <span className="flex-1 font-medium">
        <Plural one="# selected" other="# selected" value={count} />
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
    <div className="flex items-center gap-0.5">
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

function PriorityTools({
  filtered,
  onMarkAllRead,
  onToggleFilter,
  unread,
}: {
  readonly filtered: boolean;
  readonly onMarkAllRead?: () => void;
  readonly onToggleFilter: () => void;
  readonly unread: number;
}) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`Priority options`}
            className="opacity-0 pointer-coarse:opacity-100 focus-visible:opacity-100 group-focus-within/section:opacity-100 group-hover/section:opacity-100 aria-expanded:opacity-100"
            size="icon-xs"
            title={t`Priority options`}
            variant="ghost"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {onMarkAllRead ? (
            <DropdownMenuItem disabled={unread === 0} onClick={onMarkAllRead}>
              <CheckIcon aria-hidden />
              <Trans>Mark all as read</Trans>
              <ShortcutKbd className="ms-auto" id="unread.clear" />
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuCheckboxItem
            checked={filtered}
            onCheckedChange={onToggleFilter}
          >
            <Trans>Show only Priority</Trans>
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const pageRow = cn(navRowClass, "text-muted-foreground");
  return (
    <div className="flex flex-col gap-px pt-px">
      {hasMore ? (
        <button className={pageRow} onClick={more} type="button">
          <Trans>Show more</Trans>
        </button>
      ) : null}
      {expanded ? (
        <button className={pageRow} onClick={less} type="button">
          <Trans>Show less</Trans>
        </button>
      ) : null}
    </div>
  );
}

/** The account menu; on wide screens with a rail, it's on the rail instead. */
function AccountFooter({
  account,
  railed,
}: Pick<ChatSidebarProps, "account" | "railed">) {
  return (
    <div className={cn("shrink-0 p-2", railed && "md:hidden")}>
      <AccountMenu {...account} />
    </div>
  );
}

function PrimaryNav({
  artifactsHref,
  libraryHref,
  onNewChat,
  onOpenPalette,
  railed,
  scheduledHref,
}: Pick<
  ChatSidebarProps,
  | "artifactsHref"
  | "libraryHref"
  | "onNewChat"
  | "onOpenPalette"
  | "railed"
  | "scheduledHref"
>) {
  const { t } = useLingui();
  const pageRow = cn(navRowClass, railed && "md:hidden");
  return (
    <nav aria-label={t`Primary`} className="flex flex-col gap-px px-2">
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
            <Trans>Search chats</Trans>
          </span>
          <ShortcutHint id="palette.open" />
        </button>
      ) : null}
      {libraryHref ? (
        <a className={pageRow} href={libraryHref}>
          <LibraryIcon aria-hidden />
          <span className="flex-1">
            <Trans>Library</Trans>
          </span>
        </a>
      ) : null}
      {artifactsHref ? (
        <a className={pageRow} href={artifactsHref}>
          <ShapesIcon aria-hidden />
          <span className="flex-1">
            <Trans>Artifacts</Trans>
          </span>
        </a>
      ) : null}
      {scheduledHref ? (
        <a className={pageRow} href={scheduledHref}>
          <ClockIcon aria-hidden />
          <span className="flex-1">
            <Trans>Scheduled</Trans>
          </span>
        </a>
      ) : null}
    </nav>
  );
}

function Section({
  children,
  collapsed,
  id,
  label,
  onToggle,
  trailing,
}: {
  readonly children: ReactNode;
  readonly collapsed: boolean;
  readonly id: SectionKey;
  readonly label: string;
  readonly onToggle: (id: SectionKey) => void;
  readonly trailing?: ReactNode;
}) {
  const toggle = useCallback(() => onToggle(id), [id, onToggle]);
  return (
    <section
      aria-labelledby={`chat-group-${id}`}
      className="group/section pt-3 first:pt-1"
      data-section={id}
    >
      <div className="flex items-center gap-0.5 pe-1">
        <h3 className="flex min-w-0 flex-1" id={`chat-group-${id}`}>
          <button
            aria-expanded={!collapsed}
            className={headingClass}
            onClick={toggle}
            type="button"
          >
            <span className="truncate">{label}</span>
            {/* ChatGPT's quiet fold control: it shows on hover or when folded. */}
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 opacity-0 transition-opacity duration-(--motion-fast) group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100",
                collapsed && "-rotate-90 opacity-100"
              )}
            />
          </button>
        </h3>
        {trailing}
      </div>
      <div hidden={collapsed}>{children}</div>
    </section>
  );
}

/**
 * The Classic sidebar (009, 176–178, 181), laid out like ChatGPT's: the
 * actions and pages, your Dot, then Priority (chats running, waiting or
 * unread), Pinned, and one flat Chats list with a sort menu and "Show more"
 * paging; bulk select, an archive view and the account footer.
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
  dots: _dots,
  dotsHref: _dotsHref,
  nextRuns = noRuns,
  now: _now,
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
  const sectionLabel = useSectionLabel();
  const [sort, setSort] = useSavedSort();
  const [limit, setLimit] = useState(SIDEBAR_PAGE_SIZE);
  const [view, setView] = useState<"archived" | "chats">("chats");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(
    new Set()
  );
  const [selection, dispatch] = useReducer(selectionReducer, emptySelection);

  const dotId = dot?.conversationId ?? null;
  // Your Dot has its own row above; it isn't a recent chat as well.
  const recents = useMemo(
    () => (dotId ? chats.filter((chat) => chat.id !== dotId) : chats),
    [chats, dotId]
  );
  const tracksAttention = onSetLastRead !== undefined || signals.size > 0;
  const attention = useMemo(
    () => (tracksAttention ? needsAttention(recents, signals) : []),
    [recents, signals, tracksAttention]
  );
  const attentionById = useMemo(
    () => new Map(attention.map((item) => [item.chat.id, item.attention])),
    [attention]
  );
  const priority = useMemo(
    () => attention.map((item) => item.chat),
    [attention]
  );
  const unreadCount = useMemo(
    () => attention.filter((item) => item.attention === "unread").length,
    [attention]
  );
  // A chat in Priority isn't in Chats too (ChatGPT's rule). Pinned keeps its
  // own: a pin is the user's say-so.
  const prioritized = useMemo(
    () => new Set(priority.map((chat) => chat.id)),
    [priority]
  );
  const list = useMemo(
    () => buildSidebarList(recents, { exclude: prioritized, limit, sort }),
    [limit, prioritized, recents, sort]
  );
  const order = useMemo(
    () =>
      priorityOnly
        ? priority
        : visibleOrder(list, collapsed.has("priority") ? [] : priority),
    [collapsed, list, priority, priorityOnly]
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
  const markAllRead = useCallback(() => {
    for (const item of attention) {
      if (item.attention === "unread" && item.chat.lastMessageAt) {
        onSetLastRead?.(item.chat.id, item.chat.lastMessageAt);
      }
    }
  }, [attention, onSetLastRead]);
  const toggleFilter = useCallback(() => setPriorityOnly((only) => !only), []);
  const toggleSection = useCallback(
    (key: SectionKey) =>
      setCollapsed((keys) =>
        keys.has(key)
          ? new Set([...keys].filter((each) => each !== key))
          : new Set([...keys, key])
      ),
    []
  );

  useSidebarKeys({
    active,
    activeId,
    archive,
    attention,
    dotId,
    markAllRead,
    onSelect,
    onSetLastRead,
    onTogglePin,
    order,
    toggleFilter,
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
      nextRunAt={nextRuns.get(chat.id) ?? null}
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

  const rows = (items: readonly SidebarChat[], pickable = true) => (
    <ul className="flex flex-col gap-px">
      {items.map((chat) => row(chat, pickable))}
    </ul>
  );

  const tools = (
    <ListTools
      onOpenArchive={onArchivedViewChange ? openArchive : undefined}
      onSort={setSort}
      sort={sort}
    />
  );

  const prioritySection =
    priority.length > 0 || priorityOnly ? (
      <Section
        collapsed={collapsed.has("priority") && !priorityOnly}
        id="priority"
        label={sectionLabel("priority")}
        onToggle={toggleSection}
        trailing={
          <PriorityTools
            filtered={priorityOnly}
            onMarkAllRead={onSetLastRead ? markAllRead : undefined}
            onToggleFilter={toggleFilter}
            unread={unreadCount}
          />
        }
      >
        {priority.length > 0 ? (
          rows(priority, false)
        ) : (
          <p className="px-2 py-1.5 text-muted-foreground text-sm">
            <Trans>Nothing needs attention</Trans>
          </p>
        )}
      </Section>
    ) : null;

  const chatsView =
    recents.length === 0 ? (
      <>
        <div className="flex justify-end pt-1">{tools}</div>
        <p className="px-2 pt-6 text-muted-foreground text-sm">
          <Trans>No chats yet. Start one and it shows up here.</Trans>
        </p>
      </>
    ) : (
      <>
        {prioritySection}
        {!priorityOnly && list.pinned.length > 0 ? (
          <Section
            collapsed={collapsed.has("pinned")}
            id="pinned"
            label={sectionLabel("pinned")}
            onToggle={toggleSection}
          >
            {rows(list.pinned)}
          </Section>
        ) : null}
        {priorityOnly ? null : (
          <Section
            collapsed={collapsed.has("chats")}
            id="chats"
            label={sectionLabel("chats")}
            onToggle={toggleSection}
            trailing={tools}
          >
            {rows(list.items)}
            <Paging hasMore={list.hasMore} limit={limit} onLimit={setLimit} />
          </Section>
        )}
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

      <PrimaryNav {...nav} />
      {top ? (
        <div className="px-2 pt-px" data-slot="chat-sidebar-dot">
          {top}
        </div>
      ) : null}

      {selecting ? (
        <SelectionBar
          count={selection.ids.size}
          onArchive={archiveSelected}
          onClear={clearSelection}
        />
      ) : null}

      <div
        className={cn(
          "mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2",
          "data-fade-top:mask-t-from-[calc(100%-1rem)] data-fade-bottom:mask-b-from-[calc(100%-2.5rem)]"
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

      <AccountFooter account={account} railed={nav.railed} />
    </div>
  );
}
