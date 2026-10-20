"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import {
  ArchiveIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  EllipsisIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import {
  type MouseEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Attention } from "../model/attention";
import { RenameInput } from "./rename-input";

export type SidebarChat = Pick<
  Conversation,
  "createdAt" | "id" | "lastMessageAt" | "pinned" | "title" | "updatedAt"
> & {
  /** The caller's read marker; absent in older fixtures, read as "read". */
  readonly myState?: Pick<Conversation["myState"], "lastReadAt">;
  /** The soonest schedule posting here (173a), for "Next run". */
  readonly schedule?: Pick<
    NonNullable<Conversation["schedule"]>,
    "nextRunNominalAt"
  > | null;
};

/** How a click with modifiers picks rows for bulk actions (178). */
export type RowPick = "range" | "toggle";

export interface ChatRowProps {
  readonly active: boolean;
  /** Why it needs the user, if it does: a status dot at the row's end. */
  readonly attention?: Attention | null;
  readonly chat: SidebarChat;
  /** When a schedule targeting this chat runs next (Dots, 172). */
  readonly nextRunAt?: string | null;
  readonly onArchive: (chat: SidebarChat) => void;
  /** ⌘/Ctrl- or ⇧-click; absent where rows can't be picked. */
  readonly onPick?: (chat: SidebarChat, pick: RowPick) => void;
  readonly onRename: (id: ConversationId, title: string) => void;
  readonly onSelect: (id: ConversationId) => void;
  readonly onTogglePin: (id: ConversationId, pinned: boolean) => void;
  /** Mark read (`false`) or unread (`true`); absent hides the menu item. */
  readonly onToggleUnread?: (chat: SidebarChat, unread: boolean) => void;
  /** Picked for a bulk action. */
  readonly selected?: boolean;
  /** Some row is picked: a plain click picks too, rather than opening. */
  readonly selecting?: boolean;
}

function PickBox({ selected }: { readonly selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border border-sidebar-border [&_svg]:size-3",
        selected &&
          "border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground"
      )}
    >
      {selected ? <CheckIcon /> : null}
    </span>
  );
}

// The trailing status (unread dot, schedule clock) gives way to the ⋯ where
// a mouse can hover; on touch there's no hover, so it stays, and a long
// press opens the actions instead of a ⋯ drawn over it (181).
const indicatorClass =
  "transition-opacity duration-(--motion-fast) pointer-fine:group-focus-within/row:opacity-0 pointer-fine:group-hover/row:opacity-0 group-data-menu-open/row:opacity-0";

/** How long a touch rests on a row before its actions open (iOS's beat). */
const LONG_PRESS_MS = 500;
/** A finger that drifts further than this is scrolling, not pressing. */
const LONG_PRESS_SLOP_PX = 10;

/**
 * A long press on touch, for the row's actions. iOS Safari fires no
 * `contextmenu` on a long press, so it's timed here; the click that follows
 * the release is swallowed (`consume`).
 */
const useLongPress = (onLongPress: () => void) => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ readonly x: number; readonly y: number } | null>(
    null
  );
  const fired = useRef(false);
  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        return;
      }
      cancel();
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [cancel, onLongPress]
  );
  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (
        // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref the timer and the pointer handlers write; Biome reads only its initial value.
        origin.current &&
        Math.hypot(
          event.clientX - origin.current.x,
          event.clientY - origin.current.y
        ) > LONG_PRESS_SLOP_PX
      ) {
        cancel();
      }
    },
    [cancel]
  );
  /** Whether a long press just fired; reading it resets it. */
  const consume = useCallback((): boolean => {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: a ref the timer and the pointer handlers write; Biome reads only its initial value.
    if (fired.current) {
      fired.current = false;
      return true;
    }
    return false;
  }, []);
  return {
    consume,
    handlers: {
      onPointerCancel: cancel,
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
    },
  };
};

/** A clock on rows a schedule targets; the time is in its tooltip. */
function NextRunMark({ at }: { readonly at: string | null }) {
  const { i18n, t } = useLingui();
  if (at === null) {
    return null;
  }
  const when = i18n.date(new Date(at), {
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
  });
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-muted-foreground text-xs [&_svg]:size-3",
        indicatorClass
      )}
      title={t`Next run: ${when}`}
    >
      <ClockIcon aria-hidden />
      <span className="sr-only">{t`Next run: ${when}`}</span>
    </span>
  );
}

function StatusMark({
  attention,
}: {
  readonly attention: Attention | null | undefined;
}): ReactNode {
  const { t } = useLingui();
  if (!attention) {
    return null;
  }
  const label = (() => {
    switch (attention) {
      case "awaiting_approval":
        return t`Waiting for your approval`;
      case "failed":
        return t`The last run failed`;
      case "running":
        return t`Working`;
      case "unread":
        return t`Unread`;
      default:
        return attention satisfies never;
    }
  })();
  return (
    <span
      className={cn(
        "pointer-events-none flex size-4 shrink-0 items-center justify-center",
        indicatorClass
      )}
      data-attention={attention}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          attention === "unread" && "bg-unread",
          attention === "running" &&
            "animate-pulse bg-muted-foreground motion-reduce:animate-none",
          attention === "awaiting_approval" &&
            "bg-background ring-2 ring-primary",
          attention === "failed" && "bg-destructive"
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ChatGPT's rhythm (071, 181): 32px rows (40px on touch, with a 44px hit
// area), regular weight (unread is the dot, not a bold title), an 8% active
// fill in both themes, and titles that fade out at the end rather than
// stopping at an ellipsis a button's width early. The ⋯ sits over the fade,
// which widens while it shows (hover, focus, its menu open). Touch has no ⋯:
// a long press opens the menu, and the status keeps the row's end.
const titleFade = cn(
  "ltr:mask-r-from-[calc(100%-1.5rem)] rtl:mask-l-from-[calc(100%-1.5rem)]",
  "ltr:group-hover/row:mask-r-from-[calc(100%-3rem)] ltr:group-hover/row:mask-r-to-[calc(100%-1.75rem)] rtl:group-hover/row:mask-l-from-[calc(100%-3rem)] rtl:group-hover/row:mask-l-to-[calc(100%-1.75rem)]",
  "ltr:group-focus-within/row:mask-r-from-[calc(100%-3rem)] ltr:group-focus-within/row:mask-r-to-[calc(100%-1.75rem)] rtl:group-focus-within/row:mask-l-from-[calc(100%-3rem)] rtl:group-focus-within/row:mask-l-to-[calc(100%-1.75rem)]",
  "ltr:group-data-menu-open/row:mask-r-from-[calc(100%-3rem)] ltr:group-data-menu-open/row:mask-r-to-[calc(100%-1.75rem)] rtl:group-data-menu-open/row:mask-l-from-[calc(100%-3rem)] rtl:group-data-menu-open/row:mask-l-to-[calc(100%-1.75rem)]"
);

/**
 * A chat in the sidebar; hover or focus shows its actions (rename, pin,
 * archive), and so does a long press or a right-click.
 */
export const ChatRow = memo(function ChatRowInner({
  active,
  attention,
  chat,
  nextRunAt,
  onArchive,
  onPick,
  onRename,
  onSelect,
  onTogglePin,
  onToggleUnread,
  selected = false,
  selecting = false,
}: ChatRowProps) {
  const { t } = useLingui();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The full title as a tooltip, only when the fade hides some of it.
  const [truncated, setTruncated] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  // Rename waits for its menu to finish closing: the menu hands focus back
  // as it goes, and an input focused before that would lose it at once.
  const renameAfterClose = useRef(false);
  const title = chat.title ?? t`New chat`;

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const longPress = useLongPress(openMenu);
  const { consume: consumeLongPress } = longPress;
  const openMenuHere = useCallback((event: MouseEvent) => {
    event.preventDefault();
    setMenuOpen(true);
  }, []);

  const select = useCallback(
    (event: MouseEvent) => {
      if (consumeLongPress()) {
        event.preventDefault();
      } else if (onPick && (event.shiftKey || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onPick(chat, event.shiftKey ? "range" : "toggle");
      } else if (onPick && selecting) {
        onPick(chat, "toggle");
      } else {
        onSelect(chat.id);
      }
    },
    [chat, consumeLongPress, onPick, onSelect, selecting]
  );
  const unread = attention === "unread";
  const toggleUnread = useCallback(
    () => onToggleUnread?.(chat, !unread),
    [chat, onToggleUnread, unread]
  );

  const measure = useCallback(() => {
    const element = titleRef.current;
    setTruncated(
      element !== null && element.scrollWidth > element.clientWidth + 1
    );
  }, []);
  const startRename = useCallback(() => {
    renameAfterClose.current = true;
  }, []);
  const onMenuOpenChangeComplete = useCallback((open: boolean) => {
    if (!open && renameAfterClose.current) {
      renameAfterClose.current = false;
      setRenaming(true);
    }
  }, []);
  // Focus goes to the rename input, not back to a trigger it replaces.
  const menuFinalFocus = useCallback(() => !renameAfterClose.current, []);
  const finishRename = useCallback(
    (next: string | null) => {
      setRenaming(false);
      if (next !== null) {
        onRename(chat.id, next);
      }
    },
    [chat.id, onRename]
  );
  const togglePin = useCallback(
    () => onTogglePin(chat.id, !chat.pinned),
    [chat.id, chat.pinned, onTogglePin]
  );
  const archive = useCallback(() => onArchive(chat), [chat, onArchive]);

  if (renaming) {
    return (
      <li className="flex h-8 pointer-coarse:h-10 items-center px-0.5">
        <RenameInput initial={chat.title ?? ""} onDone={finishRename} />
      </li>
    );
  }

  return (
    <li
      // Off-screen rows skip layout and paint (177); the intrinsic size
      // keeps the scrollbar honest until they're measured. That clips the
      // row to its box, so on a phone the row pads itself to the 40px the
      // button's hit area reaches.
      className="group/row relative pointer-coarse:py-0.5 [contain-intrinsic-block-size:auto_2rem] [content-visibility:auto] pointer-coarse:[contain-intrinsic-block-size:auto_2.5rem]"
      data-menu-open={menuOpen ? "" : undefined}
      data-selected={selected ? "" : undefined}
    >
      <button
        aria-current={active ? "page" : undefined}
        aria-pressed={selecting ? selected : undefined}
        className={cn(
          "relative flex h-8 pointer-coarse:h-9 w-full min-w-0 select-none items-center gap-2 rounded-lg px-2 text-start text-sm outline-none transition-colors duration-(--motion-fast) [-webkit-touch-callout:none] hover:bg-sidebar-foreground/5 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          // 36px drawn, as dense as ChatGPT's phone list; 40px to the finger.
          "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-0.5",
          active && "bg-sidebar-foreground/8 hover:bg-sidebar-foreground/8",
          selected && "bg-sidebar-primary/10 hover:bg-sidebar-primary/15"
        )}
        data-chat-id={chat.id}
        onClick={select}
        onContextMenu={openMenuHere}
        onFocus={measure}
        onPointerEnter={measure}
        title={truncated ? title : undefined}
        type="button"
        {...longPress.handlers}
      >
        {selecting ? <PickBox selected={selected} /> : null}
        <span
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap",
            titleFade
          )}
          ref={titleRef}
        >
          {title}
        </span>
        <NextRunMark at={nextRunAt ?? null} />
        <StatusMark attention={attention} />
      </button>
      <DropdownMenu
        onOpenChange={setMenuOpen}
        onOpenChangeComplete={onMenuOpenChangeComplete}
        open={menuOpen}
      >
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Actions for ${title}`}
              className="pointer-coarse:pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 focus-visible:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:group-hover/row:opacity-100 aria-expanded:opacity-100"
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-44"
          finalFocus={menuFinalFocus}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={startRename}>
              <PencilIcon aria-hidden />
              <Trans>Rename</Trans>
            </DropdownMenuItem>
            {onToggleUnread && chat.lastMessageAt !== null ? (
              <DropdownMenuItem onClick={toggleUnread}>
                <CircleIcon aria-hidden />
                {unread ? (
                  <Trans>Mark as read</Trans>
                ) : (
                  <Trans>Mark as unread</Trans>
                )}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={togglePin}>
              {chat.pinned ? (
                <>
                  <PinOffIcon aria-hidden />
                  <Trans>Unpin</Trans>
                </>
              ) : (
                <>
                  <PinIcon aria-hidden />
                  <Trans>Pin</Trans>
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={archive}>
              <ArchiveIcon aria-hidden />
              <Trans>Archive</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
});
