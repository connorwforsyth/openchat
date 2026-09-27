// biome-ignore-all lint/performance/noJsxPropsBind: a throwaway prototype (ticket 009); inline handlers keep each variant readable and it is deleted once a direction is picked.
"use client";

// Variant 3 — Focus. Axis: minimal chrome. No persistent sidebar: a floating
// pill carries the title, branches and context; navigation lives in a
// slide-over you summon (⌘K), and share + sandbox sit in one overflow menu.
import {
  CheckIcon,
  EllipsisIcon,
  MenuIcon,
  NewChatIcon,
  SearchIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

import {
  type Chat,
  contextById,
  currentUser,
  dateGroups,
  type LibraryItem,
  library,
} from "./data";
import {
  AccountMenuBody,
  ArchivedNotice,
  Avatar,
  BranchSwitcher,
  ChatActionsMenuBody,
  Composer,
  ContextChipLabel,
  ContextMenuBody,
  Conversation,
  Highlight,
  IconTip,
  InviteDialog,
  isTypingTarget,
  Kbd,
  libraryIcon,
  NewChatIntro,
  RenameInput,
  SandboxDot,
  SandboxMenuBody,
  ShareMenuBody,
  type Shell,
  sandboxText,
  searchChats,
  useKeydown,
  useOverlay,
  useShell,
} from "./shared";

type Tab = "chats" | "library";

type Result =
  | { kind: "chat"; chat: Chat; snippet?: string }
  | { kind: "library"; item: LibraryItem };

const FocusRow = ({
  chat,
  shell,
  onOpen,
  query,
  highlighted,
}: {
  chat: Chat;
  shell: Shell;
  onOpen: () => void;
  query: string;
  highlighted: boolean;
}) => {
  const [renaming, setRenaming] = useState(false);
  const active = chat.id === shell.activeChat?.id;
  if (renaming) {
    return (
      <li className="px-1 py-0.5">
        <RenameInput
          initial={chat.title}
          onDone={(value) => {
            if (value !== null) {
              shell.rename(chat.id, value);
            }
            setRenaming(false);
          }}
        />
      </li>
    );
  }
  return (
    <li className="group/row relative">
      <button
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 pe-8 text-left text-sm outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          active && "font-medium",
          highlighted && "bg-muted"
        )}
        onClick={onOpen}
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            active ? "bg-foreground" : "bg-transparent"
          )}
        />
        <span className="truncate">
          <Highlight query={query} text={chat.title} />
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${chat.title}`}
              className="absolute end-1 top-1 opacity-0 pointer-coarse:opacity-100 transition-opacity duration-100 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44">
          <ChatActionsMenuBody
            chat={chat}
            onRename={() => setRenaming(true)}
            shell={shell}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};

/**
 * The slide-over. It enters from the start edge with transform only (250 ms,
 * drawer ease-out) and leaves in 150 ms; under reduced motion it fades instead.
 * It stays mounted so the exit can play, and is inert while closed.
 */
const SlideOver = ({
  shell,
  open,
  onClose,
}: {
  shell: Shell;
  open: boolean;
  onClose: () => void;
}) => {
  const [tab, setTab] = useState<Tab>("chats");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useOverlay(open, onClose);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Focus on the next frame, once `inert` has come off.
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  const searching = query.trim() !== "";
  const results: Result[] = searching
    ? [
        ...searchChats(shell.chats, query).map(
          ({ chat, snippet }): Result => ({ chat, kind: "chat", snippet })
        ),
        ...library
          .filter((item) =>
            `${item.name} ${item.description}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())
          )
          .map((item): Result => ({ item, kind: "library" })),
      ]
    : [];
  const selected = Math.min(cursor, Math.max(0, results.length - 1));

  const openResult = (result: Result) => {
    if (result.kind === "chat") {
      shell.selectChat(result.chat.id);
    } else {
      shell.newChat(result.item);
    }
    onClose();
  };

  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-background/50 transition-opacity",
          open
            ? "opacity-100 duration-250 ease-out"
            : "pointer-events-none opacity-0 duration-150 ease-out"
        )}
        onPointerDown={onClose}
      />
      <div
        aria-hidden={!open}
        aria-label="Chats and library"
        aria-modal="true"
        className={cn(
          "fixed inset-y-2 start-2 z-50 flex w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 transition-[transform,opacity] will-change-transform",
          open
            ? "translate-x-0 duration-250 ease-[cubic-bezier(0.32,0.72,0,1)]"
            : "-translate-x-[calc(100%+1rem)] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] rtl:translate-x-[calc(100%+1rem)]",
          "motion-reduce:translate-x-0 rtl:motion-reduce:translate-x-0",
          !open && "motion-reduce:opacity-0"
        )}
        inert={!open}
        role="dialog"
      >
        <div className="flex flex-col gap-2 p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-2 size-4 text-muted-foreground" />
            <Input
              aria-label="Jump to a chat, agent or prompt"
              className="ps-8"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCursor(Math.min(selected + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCursor(Math.max(selected - 1, 0));
                } else if (event.key === "Enter") {
                  const hit = results[selected];
                  if (hit) {
                    openResult(hit);
                  }
                }
              }}
              placeholder="Jump to…"
              ref={inputRef}
              value={query}
            />
          </div>
          {searching ? null : (
            <div
              aria-label="Show"
              className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5"
              role="tablist"
            >
              {(["chats", "library"] as const).map((id) => (
                <button
                  aria-selected={tab === id}
                  className={cn(
                    "h-7 rounded-md text-xs capitalize outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring",
                    tab === id
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  key={id}
                  onClick={() => setTab(id)}
                  role="tab"
                  type="button"
                >
                  {id}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {searching ? (
            <ul aria-label="Results" className="flex flex-col gap-px">
              {results.map((result, index) =>
                result.kind === "chat" ? (
                  <FocusRow
                    chat={result.chat}
                    highlighted={index === selected}
                    key={result.chat.id}
                    onOpen={() => openResult(result)}
                    query={query}
                    shell={shell}
                  />
                ) : (
                  <li key={result.item.id}>
                    <LibraryButton
                      highlighted={index === selected}
                      item={result.item}
                      onOpen={() => openResult(result)}
                      query={query}
                    />
                  </li>
                )
              )}
              {results.length === 0 ? (
                <li className="px-2 py-8 text-center text-muted-foreground text-sm">
                  Nothing matches “{query}”.
                </li>
              ) : null}
            </ul>
          ) : null}

          {!searching && tab === "chats"
            ? dateGroups.map((group) => {
                const chats = shell.chats.filter(
                  (chat) => chat.group === group
                );
                if (chats.length === 0) {
                  return null;
                }
                return (
                  <section aria-label={group} key={group}>
                    <h3 className="px-2 pt-3 pb-1 font-medium text-muted-foreground text-xs">
                      {group}
                    </h3>
                    <ul className="flex flex-col gap-px">
                      {chats.map((chat) => (
                        <FocusRow
                          chat={chat}
                          highlighted={false}
                          key={chat.id}
                          onOpen={() => {
                            shell.selectChat(chat.id);
                            onClose();
                          }}
                          query=""
                          shell={shell}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })
            : null}

          {!searching && tab === "library" ? (
            <ul className="flex flex-col gap-px pt-1">
              {library.map((item) => (
                <li key={item.id}>
                  <LibraryButton
                    highlighted={false}
                    item={item}
                    onOpen={() => {
                      shell.newChat(item);
                      onClose();
                    }}
                    query=""
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-border border-t p-2">
          <ArchivedNotice shell={shell} />
          <Button
            className="justify-start"
            onClick={() => {
              shell.newChat();
              onClose();
            }}
            variant="ghost"
          >
            <NewChatIcon data-icon="inline-start" />
            New chat
            <Kbd className="ms-auto">⇧⌘O</Kbd>
          </Button>
        </div>
      </div>
    </>
  );
};

const LibraryButton = ({
  item,
  onOpen,
  query,
  highlighted,
}: {
  item: LibraryItem;
  onOpen: () => void;
  query: string;
  highlighted: boolean;
}) => {
  const Glyph = libraryIcon(item.kind);
  return (
    <button
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        highlighted && "bg-muted"
      )}
      onClick={onOpen}
      type="button"
    >
      <Glyph className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">
          <Highlight query={query} text={item.name} />
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {item.kind} · {item.owner}
        </span>
      </span>
    </button>
  );
};

const PillHeader = ({ shell }: { shell: Shell }) => {
  const [renaming, setRenaming] = useState(false);
  const chat = shell.activeChat;
  return (
    <div className="pointer-events-auto flex h-10 min-w-0 max-w-[min(40rem,calc(100vw-8rem))] items-center gap-1 rounded-full border border-border bg-background/85 px-1.5 shadow-sm backdrop-blur-md">
      {chat && renaming ? (
        <RenameInput
          className="h-7 w-60 rounded-full"
          initial={chat.title}
          onDone={(value) => {
            if (value !== null) {
              shell.rename(chat.id, value);
            }
            setRenaming(false);
          }}
        />
      ) : (
        <button
          className="min-w-0 truncate rounded-full px-2.5 py-1 font-medium text-sm outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
          disabled={!chat}
          onClick={() => setRenaming(true)}
          title={chat ? "Rename" : undefined}
          type="button"
        >
          {chat?.title ?? "New chat"}
        </button>
      )}
      {shell.branchCount > 1 ? (
        <>
          <Separator className="h-4 self-center" orientation="vertical" />
          <BranchSwitcher shell={shell} />
        </>
      ) : null}
      <Separator className="h-4 self-center" orientation="vertical" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Chat context: ${shell.context.path}${shell.contextLocked ? ", locked" : ""}`}
              className="rounded-full text-muted-foreground"
              size="sm"
              variant="ghost"
            />
          }
        >
          <ContextChipLabel shell={shell} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-64">
          <ContextMenuBody shell={shell} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const Overflow = ({ shell }: { shell: Shell }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          aria-label="More: share, sandbox and account"
          className="pointer-events-auto relative rounded-full bg-background/85 backdrop-blur-md"
          size="icon"
          variant="outline"
        />
      }
    >
      {shell.copied ? <CheckIcon /> : <EllipsisIcon />}
      {shell.sandboxStatus === "idle" ? null : (
        <span className="absolute end-0.5 top-0.5">
          <SandboxDot status={shell.sandboxStatus} />
        </span>
      )}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      <ShareMenuBody shell={shell} />
      <DropdownMenuSeparator />
      <SandboxMenuBody shell={shell} />
      <DropdownMenuSeparator />
      <AccountMenuBody />
    </DropdownMenuContent>
  </DropdownMenu>
);

export const FocusShell = () => {
  const shell = useShell();
  const [navOpen, setNavOpen] = useState(false);

  useKeydown((event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "k") {
      event.preventDefault();
      setNavOpen((open) => !open);
    } else if (
      mod &&
      event.shiftKey &&
      key === "o" &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      shell.newChat();
      setNavOpen(false);
    }
  });

  const context = contextById(shell.contextId);

  return (
    <div className="relative h-full">
      <div
        className="relative flex h-full flex-col"
        inert={navOpen || shell.inviteOpen}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-start gap-2 bg-linear-to-b from-background via-background/80 to-transparent p-3 pb-6">
          <div className="flex items-center gap-2">
            <IconTip
              aria-expanded={navOpen}
              className="pointer-events-auto rounded-full bg-background/85 backdrop-blur-md"
              label="Chats and library"
              onClick={() => setNavOpen(true)}
              shortcut="⌘K"
              size="icon"
              variant="outline"
            >
              <MenuIcon />
            </IconTip>
            <span className="hidden items-center gap-1 text-muted-foreground text-xs md:flex">
              <Kbd>⌘K</Kbd> to jump
            </span>
          </div>
          <PillHeader shell={shell} />
          <div className="flex items-center justify-end gap-2">
            <span className="pointer-events-auto hidden items-center lg:flex [&>*+*]:-ms-1.5">
              {shell.contextLocked
                ? shell.participants
                    .slice(0, 3)
                    .map((person) => (
                      <Avatar initials={person.initials} key={person.name} />
                    ))
                : null}
            </span>
            <Overflow shell={shell} />
          </div>
        </div>

        <main className="flex min-h-0 flex-1 flex-col">
          <Conversation
            contentClassName="max-w-2xl gap-8 px-6 pt-20"
            empty={
              <NewChatIntro
                className="pt-16"
                shell={shell}
                title={`Good afternoon, ${currentUser.name.split(" ")[0]}`}
              />
            }
            shell={shell}
          />
        </main>
        <div className="mx-auto w-full max-w-2xl px-6 pb-5">
          <Composer
            autoFocus={!shell.activeChat}
            footerNote={false}
            key={shell.activeChat?.id ?? "new"}
            shell={shell}
          />
          <p className="pt-1.5 text-center text-muted-foreground text-xs">
            {context.path} · <SandboxDot status={shell.sandboxStatus} />{" "}
            {sandboxText(shell.sandboxStatus)}
          </p>
        </div>
      </div>

      <SlideOver
        onClose={() => setNavOpen(false)}
        open={navOpen}
        shell={shell}
      />
      <InviteDialog shell={shell} />
    </div>
  );
};
