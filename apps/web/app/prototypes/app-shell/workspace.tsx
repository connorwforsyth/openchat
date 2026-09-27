// biome-ignore-all lint/performance/noJsxPropsBind: a throwaway prototype (ticket 009); inline handlers keep each variant readable and it is deleted once a direction is picked.
"use client";

// Variant 2 — Workspace. Axis: dense, multi-panel and keyboard-first (Linear,
// an IDE). An icon rail switches the list panel; the right panel keeps the
// sandbox and artifacts beside the chat instead of behind a menu.
import {
  BranchIcon,
  CheckIcon,
  ChevronRightIcon,
  ContextIcon,
  EllipsisIcon,
  FileIcon,
  LayersIcon,
  LockIcon,
  MessageSquareIcon,
  MonitorIcon,
  NewChatIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  SquareIcon,
  StarIcon,
  UserIcon,
  XIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useRef, useState } from "react";

import {
  artifacts,
  type Chat,
  type ContextId,
  contextById,
  currentUser,
  library,
  sandbox,
} from "./data";
import {
  AccountMenuBody,
  ArchivedNotice,
  Avatar,
  ChatActionsMenuBody,
  Composer,
  ContextMenuBody,
  Conversation,
  Highlight,
  InviteDialog,
  isTypingTarget,
  Kbd,
  libraryIcon,
  NewChatIntro,
  nextBranch,
  RenameInput,
  SandboxDot,
  ShareMenuBody,
  type Shell,
  sandboxText,
  searchChats,
  ThemeMenuGroup,
  useKeydown,
  useShell,
} from "./shared";

type Section = "chats" | "library" | "search";
type Panel = "sandbox" | "artifacts" | null;
type Filter = "all" | "pinned" | ContextId;

const filters: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pinned", label: "Pinned" },
  { id: "personal", label: "Personal" },
  { id: "engineering", label: "Engineering" },
  { id: "platform", label: "Platform" },
];

const matchesFilter = (chat: Chat, filter: Filter) => {
  if (filter === "all") {
    return true;
  }
  if (filter === "pinned") {
    return Boolean(chat.pinned);
  }
  // Access flows down the team tree (D17): Engineering includes Platform.
  if (filter === "engineering") {
    return chat.context === "engineering" || chat.context === "platform";
  }
  return chat.context === filter;
};

const shortcuts: readonly [string, string][] = [
  ["N", "New chat"],
  ["/", "Search"],
  ["H", "Chats"],
  ["L", "Library"],
  ["J / K", "Next / previous chat"],
  ["[ / ]", "Previous / next branch"],
  ["S", "Sandbox panel"],
  ["A", "Artifacts panel"],
  ["⌘B", "Toggle list"],
];

/* -------------------------------------------------------------------------- */
/* Rail                                                                       */
/* -------------------------------------------------------------------------- */

const RailButton = ({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "text-muted-foreground",
            active && "bg-sidebar-accent text-sidebar-accent-foreground"
          )}
          onClick={onClick}
          size="icon"
          variant="ghost"
        />
      }
    >
      {children}
    </TooltipTrigger>
    <TooltipContent side="right">
      {label}
      <Kbd>{shortcut}</Kbd>
    </TooltipContent>
  </Tooltip>
);

const Rail = ({
  section,
  listOpen,
  onSection,
}: {
  section: Section;
  listOpen: boolean;
  onSection: (section: Section) => void;
}) => (
  <nav
    aria-label="Workspace"
    className="flex w-12 shrink-0 flex-col items-center gap-1 border-sidebar-border border-r bg-sidebar py-2"
  >
    <span className="mb-2 flex size-7 items-center justify-center rounded-md bg-sidebar-primary font-semibold text-sidebar-primary-foreground text-xs">
      N
    </span>
    <RailButton
      active={listOpen && section === "chats"}
      label="Chats"
      onClick={() => onSection("chats")}
      shortcut="H"
    >
      <MessageSquareIcon />
    </RailButton>
    <RailButton
      active={listOpen && section === "library"}
      label="Library"
      onClick={() => onSection("library")}
      shortcut="L"
    >
      <LayersIcon />
    </RailButton>
    <RailButton
      active={listOpen && section === "search"}
      label="Search"
      onClick={() => onSection("search")}
      shortcut="/"
    >
      <SearchIcon />
    </RailButton>
    <div className="flex-1" />
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Settings"
            className="text-muted-foreground"
            size="icon"
            variant="ghost"
          />
        }
      >
        <SettingsIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" side="right">
        <ThemeMenuGroup />
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Keyboard shortcuts</DropdownMenuLabel>
          {shortcuts.map(([keys, label]) => (
            <div
              className="flex items-center justify-between gap-4 px-1.5 py-1 text-sm"
              key={label}
            >
              {label}
              <DropdownMenuShortcut>{keys}</DropdownMenuShortcut>
            </div>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={`Account: ${currentUser.name}`}
            className="mt-1 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            type="button"
          />
        }
      >
        <Avatar className="size-7 ring-0" initials={currentUser.initials} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" side="right">
        <AccountMenuBody />
      </DropdownMenuContent>
    </DropdownMenu>
  </nav>
);

/* -------------------------------------------------------------------------- */
/* List panel                                                                 */
/* -------------------------------------------------------------------------- */

const ChatListRow = ({
  chat,
  shell,
  query = "",
  snippet,
  highlighted = false,
}: {
  chat: Chat;
  shell: Shell;
  query?: string;
  snippet?: string;
  highlighted?: boolean;
}) => {
  const [renaming, setRenaming] = useState(false);
  const active = chat.id === shell.activeChat?.id;
  if (renaming) {
    return (
      <li className="px-1 py-1">
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
          "flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 pe-8 text-left outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-accent text-accent-foreground",
          highlighted && "ring-1 ring-ring"
        )}
        onClick={() => shell.selectChat(chat.id)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {chat.pinned ? (
            <StarIcon className="size-3 shrink-0 fill-current text-muted-foreground" />
          ) : null}
          <span className="truncate text-[13px]">
            <Highlight query={query} text={chat.title} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">
            {snippet ? (
              <Highlight query={query} text={snippet} />
            ) : (
              contextById(chat.context).path
            )}
          </span>
          <span className="ms-auto shrink-0 tabular-nums">{chat.updated}</span>
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

const ChatsList = ({ shell }: { shell: Shell }) => {
  const [filter, setFilter] = useState<Filter>("all");
  const chats = shell.chats.filter((chat) => matchesFilter(chat, filter));
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a filter bar of toggle buttons, not a form. */}
      <div
        aria-label="Filter chats"
        className="flex flex-wrap gap-1 px-2 pb-2"
        role="group"
      >
        {filters.map((item) => (
          <Button
            aria-pressed={filter === item.id}
            className={cn(
              "h-6 rounded-full px-2 text-[11px]",
              filter === item.id && "bg-secondary text-secondary-foreground"
            )}
            key={item.id}
            onClick={() => setFilter(item.id)}
            size="xs"
            variant={filter === item.id ? "secondary" : "ghost"}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pb-2">
        {chats.map((chat) => (
          <ChatListRow chat={chat} key={chat.id} shell={shell} />
        ))}
        {chats.length === 0 ? (
          <li className="px-2 py-6 text-center text-muted-foreground text-xs">
            Nothing here yet.
          </li>
        ) : null}
      </ul>
    </>
  );
};

const LibraryList = ({ shell }: { shell: Shell }) => (
  <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
    {(["agent", "prompt", "skill"] as const).map((kind) => (
      <section className="pb-2" key={kind}>
        <h3 className="px-2 pt-2 pb-1 font-medium text-[11px] text-muted-foreground capitalize">
          {kind}s
        </h3>
        <ul className="flex flex-col gap-px">
          {library
            .filter((item) => item.kind === kind)
            .map((item) => {
              const Glyph = libraryIcon(item.kind);
              return (
                <li key={item.id}>
                  <button
                    className="group/lib flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => shell.newChat(item)}
                    type="button"
                  >
                    <Glyph className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px]">{item.name}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {item.owner}
                      </span>
                    </span>
                    <Kbd className="opacity-0 transition-opacity duration-100 group-hover/lib:opacity-100 group-focus-visible/lib:opacity-100">
                      ↵
                    </Kbd>
                  </button>
                </li>
              );
            })}
        </ul>
      </section>
    ))}
  </div>
);

const SearchList = ({ shell }: { shell: Shell }) => {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const results = searchChats(shell.chats, query);
  const selected = Math.min(cursor, Math.max(0, results.length - 1));
  return (
    <>
      <div className="px-2 pb-2">
        <Input
          aria-label="Search chats"
          autoFocus
          className="h-7 text-[13px]"
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
                shell.selectChat(hit.chat.id);
              }
            } else if (event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          placeholder="Search titles and messages…"
          value={query}
        />
        <p className="px-0.5 pt-1.5 text-[11px] text-muted-foreground">
          {results.length} {results.length === 1 ? "chat" : "chats"} ·{" "}
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>↵</Kbd> open
        </p>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pb-2">
        {results.map(({ chat, snippet }, index) => (
          <ChatListRow
            chat={chat}
            highlighted={index === selected && query !== ""}
            key={chat.id}
            query={query}
            shell={shell}
            snippet={snippet}
          />
        ))}
      </ul>
    </>
  );
};

const sectionTitle: Record<Section, string> = {
  chats: "Chats",
  library: "Library",
  search: "Search",
};

const ListPanel = ({ shell, section }: { shell: Shell; section: Section }) => (
  <aside
    aria-label={sectionTitle[section]}
    className="flex w-64 shrink-0 flex-col border-border border-r bg-background"
  >
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-3">
      <h2 className="font-medium text-[13px]">{sectionTitle[section]}</h2>
      <Button onClick={() => shell.newChat()} size="xs" variant="ghost">
        <NewChatIcon data-icon="inline-start" />
        New
        <Kbd className="ms-0.5">N</Kbd>
      </Button>
    </div>
    {section === "chats" ? <ChatsList shell={shell} /> : null}
    {section === "library" ? <LibraryList shell={shell} /> : null}
    {section === "search" ? <SearchList shell={shell} /> : null}
    <div className="flex flex-col gap-2 border-border border-t p-2">
      <ArchivedNotice shell={shell} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          <Kbd>J</Kbd> <Kbd>K</Kbd> move
        </span>
        <span>
          <Kbd>/</Kbd> search
        </span>
        <span>
          <Kbd>⌘B</Kbd> hide
        </span>
      </p>
    </div>
  </aside>
);

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

const Crumb = () => (
  <ChevronRightIcon
    aria-hidden="true"
    className="size-3.5 shrink-0 text-muted-foreground/60"
  />
);

const Toolbar = ({
  shell,
  listOpen,
  toggleList,
  panel,
  togglePanel,
}: {
  shell: Shell;
  listOpen: boolean;
  toggleList: () => void;
  panel: Panel;
  togglePanel: (panel: Exclude<Panel, null>) => void;
}) => {
  const [renaming, setRenaming] = useState(false);
  const chat = shell.activeChat;
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-expanded={listOpen}
              aria-label="Toggle list panel"
              onClick={toggleList}
              size="icon-xs"
              variant="ghost"
            />
          }
        >
          <PanelLeftIcon />
        </TooltipTrigger>
        <TooltipContent>
          Toggle list <Kbd>⌘B</Kbd>
        </TooltipContent>
      </Tooltip>

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-0.5 text-[13px]"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`Chat context: ${shell.context.path}${shell.contextLocked ? ", locked" : ""}`}
                className="text-muted-foreground"
                size="xs"
                variant="ghost"
              />
            }
          >
            {shell.contextId === "personal" ? (
              <UserIcon data-icon="inline-start" />
            ) : (
              <ContextIcon data-icon="inline-start" />
            )}
            {shell.context.path}
            {shell.contextLocked ? <LockIcon data-icon="inline-end" /> : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <ContextMenuBody shell={shell} />
          </DropdownMenuContent>
        </DropdownMenu>
        <Crumb />
        {chat && renaming ? (
          <RenameInput
            className="h-6 w-64 text-[13px]"
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
            className="min-w-0 max-w-[36ch] truncate rounded-md px-1.5 py-0.5 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
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
            <Crumb />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    className="text-muted-foreground"
                    size="xs"
                    variant="ghost"
                  />
                }
              >
                <BranchIcon data-icon="inline-start" />
                Branch {shell.branch + 1} of {shell.branchCount}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Last answer</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    onValueChange={(value) => shell.setBranch(Number(value))}
                    value={shell.branch}
                  >
                    {["Stay on Postgres", "Move to Meilisearch", "Hybrid"]
                      .slice(0, shell.branchCount)
                      .map((label, index) => (
                        <DropdownMenuRadioItem
                          closeOnClick
                          key={label}
                          value={index}
                        >
                          {index + 1}. {label}
                        </DropdownMenuRadioItem>
                      ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <p className="px-1.5 py-1 text-muted-foreground text-xs">
                  <Kbd>[</Kbd> <Kbd>]</Kbd> to step through branches
                </p>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </nav>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label={`Sandbox: ${sandboxText(shell.sandboxStatus)}`}
          aria-pressed={panel === "sandbox"}
          className={cn(
            "font-mono text-muted-foreground",
            panel === "sandbox" && "bg-muted text-foreground"
          )}
          onClick={() => togglePanel("sandbox")}
          size="xs"
          variant="ghost"
        >
          <SandboxDot status={shell.sandboxStatus} />
          <span className="hidden 2xl:inline">
            {sandboxText(shell.sandboxStatus)}
          </span>
          <Kbd>S</Kbd>
        </Button>
        <Button
          aria-label={`Artifacts (${artifacts.length})`}
          aria-pressed={panel === "artifacts"}
          className={cn(
            "text-muted-foreground",
            panel === "artifacts" && "bg-muted text-foreground"
          )}
          onClick={() => togglePanel("artifacts")}
          size="xs"
          variant="ghost"
        >
          <FileIcon data-icon="inline-start" />
          <span className="hidden 2xl:inline">Artifacts</span>
          <span className="tabular-nums">{artifacts.length}</span>
          <Kbd>A</Kbd>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={shell.copied ? "Link copied" : "Share"}
                className="text-muted-foreground"
                size="xs"
                variant="ghost"
              />
            }
          >
            {shell.copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <ShareIcon data-icon="inline-start" />
            )}
            <span className="hidden 2xl:inline">
              {shell.copied ? "Copied" : "Share"}
            </span>
            {shell.contextLocked ? (
              <span className="ms-0.5 tabular-nums">
                {shell.participants.length}
              </span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <ShareMenuBody shell={shell} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

/* -------------------------------------------------------------------------- */
/* Right panel                                                                */
/* -------------------------------------------------------------------------- */

const SandboxPanel = ({ shell }: { shell: Shell }) => (
  <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <div className="flex items-center gap-2">
      <SandboxDot status={shell.sandboxStatus} />
      <span className="whitespace-nowrap font-mono text-xs">
        {sandboxText(shell.sandboxStatus)}
      </span>
      <div className="ms-auto flex gap-0.5">
        <Button onClick={shell.restartSandbox} size="xs" variant="ghost">
          <RefreshCwIcon data-icon="inline-start" />
          Restart
        </Button>
        <Button
          disabled={shell.sandboxStatus === "stopped"}
          onClick={shell.stopSandbox}
          size="xs"
          variant="ghost"
        >
          <SquareIcon data-icon="inline-start" />
          Stop
        </Button>
      </div>
    </div>
    <div
      aria-label="Sandbox log"
      className="flex flex-col gap-0.5 overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed"
      role="log"
    >
      {sandbox.log.map((line, index) => (
        <span
          className={cn(
            "whitespace-pre",
            line.kind === "out" && "text-muted-foreground"
          )}
          // The log is static sample data; its order never changes.
          // biome-ignore lint/suspicious/noArrayIndexKey: static, append-only log lines.
          key={index}
        >
          {line.kind === "cmd" ? `$ ${line.text}` : line.text}
        </span>
      ))}
      {shell.sandboxStatus === "running" ? (
        <span className="text-muted-foreground">▍ running…</span>
      ) : null}
      {shell.sandboxStatus === "starting" ? (
        <span className="text-muted-foreground">▍ starting just-bash…</span>
      ) : null}
      {shell.sandboxStatus === "stopped" ? (
        <span className="text-muted-foreground">■ sandbox stopped</span>
      ) : null}
    </div>
    <div className="flex flex-col gap-1">
      <h3 className="font-medium text-[11px] text-muted-foreground">
        Files · /workspace
      </h3>
      <ul className="flex flex-col">
        {sandbox.files.map((file) => (
          <li
            className="flex items-center gap-2 rounded-md px-1.5 py-1 font-mono text-[11px] hover:bg-muted"
            key={file.name}
          >
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="text-muted-foreground">{file.size}</span>
          </li>
        ))}
      </ul>
    </div>
  </div>
);

const ArtifactsPanel = () => {
  const [selected, setSelected] = useState(artifacts[0]?.id);
  const artifact = artifacts.find((item) => item.id === selected);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <ul className="flex flex-col gap-px">
        {artifacts.map((item) => (
          <li key={item.id}>
            <button
              aria-current={item.id === selected ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                item.id === selected && "bg-accent text-accent-foreground"
              )}
              onClick={() => setSelected(item.id)}
              type="button"
            >
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                {item.name}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {item.kind}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {artifact ? (
        <pre className="overflow-x-auto rounded-md border border-border p-2.5 font-mono text-[11px] leading-relaxed">
          {artifact.preview}
        </pre>
      ) : null}
    </div>
  );
};

const RightPanel = ({
  shell,
  panel,
  setPanel,
}: {
  shell: Shell;
  panel: Exclude<Panel, null>;
  setPanel: (panel: Panel) => void;
}) => {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const order = ["sandbox", "artifacts"] as const;
  return (
    <aside
      aria-label="Side panel"
      className="flex w-72 shrink-0 flex-col border-border border-l bg-background"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-2">
        <div aria-label="Panel" className="flex gap-0.5" role="tablist">
          {order.map((id, index) => (
            <Button
              aria-selected={panel === id}
              className={cn(
                "capitalize",
                panel === id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              )}
              key={id}
              onClick={() => setPanel(id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  event.stopPropagation();
                  const next = order[(index + 1) % order.length] ?? id;
                  setPanel(next);
                  tabs.current[(index + 1) % order.length]?.focus();
                }
              }}
              ref={(el) => {
                tabs.current[index] = el;
              }}
              role="tab"
              size="xs"
              tabIndex={panel === id ? 0 : -1}
              variant="ghost"
            >
              {id === "sandbox" ? (
                <MonitorIcon data-icon="inline-start" />
              ) : (
                <FileIcon data-icon="inline-start" />
              )}
              {id}
            </Button>
          ))}
        </div>
        <Button
          aria-label="Close panel"
          className="ms-auto"
          onClick={() => setPanel(null)}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {panel === "sandbox" ? (
          <SandboxPanel shell={shell} />
        ) : (
          <ArtifactsPanel />
        )}
      </div>
    </aside>
  );
};

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export const WorkspaceShell = () => {
  const shell = useShell();
  const [section, setSection] = useState<Section>("chats");
  const [listOpen, setListOpen] = useState(true);
  const [panel, setPanel] = useState<Panel>("sandbox");

  const openSection = (next: Section) => {
    if (listOpen && section === next) {
      setListOpen(false);
      return;
    }
    setSection(next);
    setListOpen(true);
  };

  const togglePanel = (next: Exclude<Panel, null>) =>
    setPanel((current) => (current === next ? null : next));

  const stepChat = (delta: number) => {
    const ids = shell.chats.map((chat) => chat.id);
    const at = shell.activeChat ? ids.indexOf(shell.activeChat.id) : -1;
    const next = ids[Math.min(Math.max(at + delta, 0), ids.length - 1)];
    if (next) {
      shell.selectChat(next);
    }
  };

  useKeydown((event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      setListOpen((open) => !open);
      return;
    }
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.defaultPrevented ||
      isTypingTarget(event.target) ||
      shell.inviteOpen
    ) {
      return;
    }
    const actions: Record<string, () => void> = {
      "[": () => nextBranch(shell, -1),
      "]": () => nextBranch(shell, 1),
      "/": () => {
        setSection("search");
        setListOpen(true);
      },
      a: () => togglePanel("artifacts"),
      h: () => openSection("chats"),
      j: () => stepChat(1),
      k: () => stepChat(-1),
      l: () => openSection("library"),
      n: () => shell.newChat(),
      s: () => togglePanel("sandbox"),
    };
    const action = actions[event.key.toLowerCase()];
    if (action) {
      event.preventDefault();
      action();
    }
  });

  return (
    <div className="flex h-full text-sm">
      <div className="flex min-w-0 flex-1" inert={shell.inviteOpen}>
        <Rail listOpen={listOpen} onSection={openSection} section={section} />
        {listOpen ? <ListPanel section={section} shell={shell} /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <Toolbar
            listOpen={listOpen}
            panel={panel}
            shell={shell}
            toggleList={() => setListOpen((open) => !open)}
            togglePanel={togglePanel}
          />
          <main className="flex min-h-0 flex-1 flex-col">
            <Conversation
              contentClassName="gap-5 px-6 pt-5"
              empty={<NewChatIntro shell={shell} title="New chat" />}
              shell={shell}
            />
          </main>
          <div className="mx-auto w-full max-w-3xl px-6 pb-3">
            <Composer
              autoFocus={!shell.activeChat}
              key={shell.activeChat?.id ?? "new"}
              shell={shell}
            />
          </div>
        </div>
        {panel ? (
          <RightPanel panel={panel} setPanel={setPanel} shell={shell} />
        ) : null}
      </div>
      <InviteDialog shell={shell} />
    </div>
  );
};
