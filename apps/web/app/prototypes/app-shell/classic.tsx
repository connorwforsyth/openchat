// biome-ignore-all lint/performance/noJsxPropsBind: a throwaway prototype (ticket 009); inline handlers keep each variant readable and it is deleted once a direction is picked.
"use client";

// Variant 1 — Classic. Axis: a familiar, persistent sidebar (ChatGPT /
// Claude.ai). Everything is one click away and nothing needs learning.
import {
  CheckIcon,
  EllipsisIcon,
  LayersIcon,
  NewChatIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  XIcon,
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
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

import {
  type Chat,
  currentUser,
  dateGroups,
  type LibraryItem,
  library,
  org,
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
  MenuShortcut,
  NewChatIntro,
  RenameInput,
  SandboxDot,
  SandboxMenuBody,
  ShareMenuBody,
  type Shell,
  sandboxText,
  searchChats,
  useKeydown,
  useShell,
} from "./shared";

type View = "chat" | "library";

const rowClass =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

const ChatRow = ({
  chat,
  shell,
  active,
  query = "",
  onOpen,
}: {
  chat: Chat;
  shell: Shell;
  active: boolean;
  query?: string;
  onOpen: () => void;
}) => {
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <li className="px-0.5 py-0.5">
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
          rowClass,
          "pe-8",
          active && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
        onClick={onOpen}
        type="button"
      >
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
        <DropdownMenuContent align="start" className="w-44">
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

const GroupLabel = ({ children }: { children: string }) => (
  <h3 className="px-2 pt-4 pb-1 font-medium text-muted-foreground text-xs">
    {children}
  </h3>
);

const Sidebar = ({
  shell,
  view,
  setView,
  searching,
  setSearching,
}: {
  shell: Shell;
  view: View;
  setView: (view: View) => void;
  searching: boolean;
  setSearching: (value: boolean) => void;
}) => {
  const [query, setQuery] = useState("");
  const open = (id: string) => {
    shell.selectChat(id);
    setView("chat");
  };
  const pinned = shell.chats.filter((chat) => chat.pinned);
  const results = searching ? searchChats(shell.chats, query) : [];

  return (
    <aside
      aria-label="Chats"
      className="flex w-64 shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-12 items-center gap-2 px-3">
        <span className="flex size-6 items-center justify-center rounded-md bg-sidebar-primary font-semibold text-sidebar-primary-foreground text-xs">
          N
        </span>
        <span className="truncate font-medium text-sm">{org.name}</span>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
        <button
          className={rowClass}
          onClick={() => {
            shell.newChat();
            setView("chat");
            setSearching(false);
          }}
          type="button"
        >
          <NewChatIcon className="size-4" />
          <span className="flex-1">New chat</span>
          <Kbd>⇧⌘O</Kbd>
        </button>
        <button
          aria-pressed={searching}
          className={cn(rowClass, searching && "bg-sidebar-accent")}
          onClick={() => setSearching(!searching)}
          type="button"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1">Search chats</span>
          <Kbd>⌘K</Kbd>
        </button>
        <button
          aria-current={view === "library" ? "page" : undefined}
          className={cn(rowClass, view === "library" && "bg-sidebar-accent")}
          onClick={() => {
            setView("library");
            setSearching(false);
          }}
          type="button"
        >
          <LayersIcon className="size-4" />
          <span className="flex-1">Library</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {library.length}
          </span>
        </button>
      </nav>

      {searching ? (
        <div className="relative mx-2 mt-3">
          <Input
            aria-label="Search chats"
            autoFocus
            className="h-8 bg-background pe-8"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearching(false);
                setQuery("");
              }
              const [first] = results;
              if (event.key === "Enter" && first) {
                open(first.chat.id);
                setSearching(false);
                setQuery("");
              }
            }}
            placeholder="Search titles and messages"
            value={query}
          />
          <Button
            aria-label="Close search"
            className="absolute end-1 top-1"
            onClick={() => {
              setSearching(false);
              setQuery("");
            }}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
      ) : null}

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {searching ? (
          <>
            <GroupLabel>
              {query.trim() === ""
                ? "All chats"
                : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </GroupLabel>
            <ul className="flex flex-col gap-px">
              {results.map(({ chat }) => (
                <ChatRow
                  active={chat.id === shell.activeChat?.id && view === "chat"}
                  chat={chat}
                  key={chat.id}
                  onOpen={() => open(chat.id)}
                  query={query}
                  shell={shell}
                />
              ))}
            </ul>
            {results.length === 0 ? (
              <p className="px-2 py-6 text-center text-muted-foreground text-sm">
                No chats match “{query}”.
              </p>
            ) : null}
          </>
        ) : (
          <>
            {pinned.length > 0 ? (
              <section aria-label="Pinned">
                <GroupLabel>Pinned</GroupLabel>
                <ul className="flex flex-col gap-px">
                  {pinned.map((chat) => (
                    <ChatRow
                      active={
                        chat.id === shell.activeChat?.id && view === "chat"
                      }
                      chat={chat}
                      key={chat.id}
                      onOpen={() => open(chat.id)}
                      shell={shell}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {dateGroups.map((group) => {
              const chats = shell.chats.filter(
                (chat) => chat.group === group && !chat.pinned
              );
              if (chats.length === 0) {
                return null;
              }
              return (
                <section aria-label={group} key={group}>
                  <GroupLabel>{group}</GroupLabel>
                  <ul className="flex flex-col gap-px">
                    {chats.map((chat) => (
                      <ChatRow
                        active={
                          chat.id === shell.activeChat?.id && view === "chat"
                        }
                        chat={chat}
                        key={chat.id}
                        onOpen={() => open(chat.id)}
                        shell={shell}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-sidebar-border border-t p-2">
        <ArchivedNotice shell={shell} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className={cn(rowClass, "h-11 aria-expanded:bg-sidebar-accent")}
                type="button"
              />
            }
          >
            <Avatar className="size-7 ring-0" initials={currentUser.initials} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-sm">
                {currentUser.name}
              </span>
              <span className="truncate text-muted-foreground text-xs">
                {currentUser.plan}
              </span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" side="top">
            <AccountMenuBody
              extra={
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <SettingsIcon />
                      Settings
                      <MenuShortcut>⌘,</MenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
};

const LibraryPage = ({ onStart }: { onStart: (item: LibraryItem) => void }) => (
  <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-medium text-xl">Library</h1>
        <p className="text-muted-foreground text-sm">
          Agents, prompts and skills you and your teams have published.
        </p>
      </div>
      {(["agent", "prompt", "skill"] as const).map((kind) => (
        <section className="flex flex-col gap-2" key={kind}>
          <h2 className="font-medium text-muted-foreground text-xs capitalize">
            {kind}s
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {library
              .filter((item) => item.kind === kind)
              .map((item) => {
                const Glyph = libraryIcon(item.kind);
                return (
                  <li key={item.id}>
                    <button
                      className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left outline-none transition-[background-color,transform] duration-100 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
                      onClick={() => onStart(item)}
                      type="button"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Glyph className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium text-sm">{item.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {item.description}
                        </span>
                        <span className="pt-1 text-muted-foreground text-xs">
                          {item.owner}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  </div>
);

const Header = ({
  shell,
  view,
  sidebarOpen,
  toggleSidebar,
}: {
  shell: Shell;
  view: View;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}) => {
  const [renaming, setRenaming] = useState(false);
  const chat = shell.activeChat;
  let title = <span className="truncate font-medium text-sm">New chat</span>;
  if (view === "library") {
    title = <span className="truncate font-medium text-sm">Library</span>;
  } else if (chat && renaming) {
    title = (
      <RenameInput
        className="w-72"
        initial={chat.title}
        onDone={(value) => {
          if (value !== null) {
            shell.rename(chat.id, value);
          }
          setRenaming(false);
        }}
      />
    );
  } else if (chat) {
    title = (
      <button
        className="truncate rounded-md px-1.5 py-0.5 font-medium text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setRenaming(true)}
        title="Rename"
        type="button"
      >
        {chat.title}
      </button>
    );
  }

  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 px-2">
      <div className="flex items-center gap-1">
        <IconTip
          aria-expanded={sidebarOpen}
          label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          onClick={toggleSidebar}
          shortcut="⌘B"
        >
          <PanelLeftIcon />
        </IconTip>
        {sidebarOpen ? null : (
          <IconTip
            label="New chat"
            onClick={() => shell.newChat()}
            shortcut="⇧⌘O"
          >
            <NewChatIcon />
          </IconTip>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-center gap-1">
        {title}
        {view === "chat" ? <BranchSwitcher shell={shell} /> : null}
      </div>

      <div className="flex items-center justify-end gap-1">
        {view === "chat" ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={`Chat context: ${shell.context.path}${shell.contextLocked ? ", locked" : ""}`}
                    className="rounded-full"
                    size="sm"
                    variant="outline"
                  />
                }
              >
                <ContextChipLabel shell={shell} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <ContextMenuBody shell={shell} />
              </DropdownMenuContent>
            </DropdownMenu>

            {shell.contextLocked ? (
              <span className="hidden items-center md:flex [&>*+*]:-ms-1.5">
                {shell.participants.slice(0, 3).map((person) => (
                  <Avatar initials={person.initials} key={person.name} />
                ))}
              </span>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="sm" variant="ghost" />}
              >
                {shell.copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <ShareIcon data-icon="inline-start" />
                )}
                {shell.copied ? "Link copied" : "Share"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <ShareMenuBody shell={shell} />
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`Sandbox: ${sandboxText(shell.sandboxStatus)}`}
                className="rounded-full font-mono text-muted-foreground text-xs"
                size="sm"
                variant="ghost"
              />
            }
          >
            <SandboxDot status={shell.sandboxStatus} />
            <span className="hidden lg:inline">
              {sandboxText(shell.sandboxStatus)}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <SandboxMenuBody shell={shell} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export const ClassicShell = () => {
  const shell = useShell();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<View>("chat");
  const [searching, setSearching] = useState(false);

  useKeydown((event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "b" && !event.shiftKey) {
      event.preventDefault();
      setSidebarOpen((open) => !open);
    } else if (key === "k") {
      event.preventDefault();
      setSidebarOpen(true);
      setSearching(true);
    } else if (key === "o" && event.shiftKey && !isTypingTarget(event.target)) {
      event.preventDefault();
      shell.newChat();
      setView("chat");
    }
  });

  return (
    <div className="flex h-full">
      {sidebarOpen ? (
        <Sidebar
          searching={searching}
          setSearching={setSearching}
          setView={setView}
          shell={shell}
          view={view}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col" inert={shell.inviteOpen}>
        <Header
          shell={shell}
          sidebarOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen((open) => !open)}
          view={view}
        />
        {view === "library" ? (
          <LibraryPage
            onStart={(item) => {
              shell.newChat(item);
              setView("chat");
            }}
          />
        ) : (
          <>
            <main className="flex min-h-0 flex-1 flex-col">
              <Conversation
                empty={<NewChatIntro shell={shell} />}
                shell={shell}
              />
            </main>
            <div className="mx-auto w-full max-w-3xl px-4 pb-4">
              <Composer
                autoFocus={!shell.activeChat}
                key={shell.activeChat?.id ?? "new"}
                shell={shell}
              />
            </div>
          </>
        )}
      </div>
      <InviteDialog shell={shell} />
    </div>
  );
};
