import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { contextOptionsFromMe } from "@workspace/composer/options";
import type { ComposerValue } from "@workspace/composer/schemas";
import {
  fixtureId,
  me,
  sandbox as sandboxFixture,
  teamPlatform,
} from "@workspace/contract/fixtures";
import type { Message } from "@workspace/contract/schemas/messages";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { err, ok } from "@workspace/shared/result";
import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import { createRef, useCallback, useMemo, useState } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  chatArtifacts,
  initialLeafId,
  participants,
  sidebarChats,
  treeMessages,
} from "../fixtures";
import { localBranchPath } from "../model/branch";
import { SidebarLayoutProvider } from "../shell/sidebar-layout";
import { SHELL_LAYOUT_STORAGE_KEY } from "../shell/use-shell-layout";
import { modKey, renderWithI18n } from "../testing/render";
import type {
  WorkspaceClient,
  WorkspaceFilesSource,
} from "../workspace/model/client";

import {
  ChatScreen,
  type ChatScreenProps,
  type WorkspaceHandle,
} from "./chat-screen";

// Reasoning renders synchronously (ticket 037), so no chunk lands mid-test and
// shifts the conversation.
vi.mock("../conversation/lazy", () => import("../testing/sync-lazy"));

const TURNED_OFF = /turned off/;
const path = localBranchPath(treeMessages, initialLeafId);
if (!path) {
  throw new Error("fixture branch path");
}
const now = new Date(Date.UTC(2026, 8, 27, 12));
const chats = sidebarChats(now);
const contextOptions = contextOptionsFromMe(me, ["personal", "team", "org"]);
const platformContext: ChatContext = { id: teamPlatform.id, type: "team" };

const props = (overrides: Partial<ChatScreenProps> = {}): ChatScreenProps => ({
  actions: { onSelectBranch: vi.fn() },
  composer: { onSubmit: vi.fn() },
  conversation: {
    context: platformContext,
    contextLocked: true,
    contextOptions,
    id: path.conversationId,
    participants,
    title: "Postgres full-text search vs Meilisearch",
  },
  messages: path.messages,
  onNewChat: vi.fn(),
  siblings: path.siblings,
  sidebar: {
    account: {
      onSignOut: vi.fn(),
      onThemeChange: vi.fn(),
      theme: "system",
      user: { email: "ada@example.test", image: null, name: "Ada" },
    },
    activeId: path.conversationId,
    chats,
    now,
    onArchive: vi.fn(),
    onRename: vi.fn(),
    onRestore: vi.fn(),
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
  },
  workspace: {
    artifacts: { artifacts: chatArtifacts, versions: [] },
    files: { kind: "off" },
    onSelect: vi.fn(),
    selection: null,
  },
  ...overrides,
});

// The chunks the screen loads on demand (the editor, the artifacts panel,
// KaTeX) arrive here, under hookTimeout, so a test waits on React and not on
// a busy runner serving modules (ticket 037).
beforeAll(async () => {
  await Promise.all([
    import("@workspace/composer/components/composer"),
    import("../workspace/workspace-panel"),
    import("../conversation/math-plugin"),
  ]);
});

beforeEach(() => {
  window.localStorage.removeItem(SHELL_LAYOUT_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
});

const SANDBOX_PILL = /^Sandbox/;
const ANY_CONTEXT_CHIP = /^Chat context/;
const NOT_BLANK = /\S/;

const header = () => {
  const element = document.querySelector<HTMLElement>(
    '[data-slot="app-header"]'
  );
  if (!element) {
    throw new Error("no header");
  }
  return within(element);
};

describe("header branch switcher", () => {
  it("shows the latest fork and steps it with the buttons and [ ]", async () => {
    const onSelectBranch = vi.fn();
    renderWithI18n(<ChatScreen {...props({ actions: { onSelectBranch } })} />);
    // The edited message (2 of 2) is the deepest fork on this branch.
    expect(header().getByText("2/2")).toBeTruthy();

    await userEvent.click(
      header().getByRole("button", { name: "Previous branch" })
    );
    expect(onSelectBranch).toHaveBeenLastCalledWith(fixtureId("message", 109));

    onSelectBranch.mockClear();
    // `[[` is a literal "[" in user-event's key syntax.
    await userEvent.keyboard("[[");
    expect(onSelectBranch).toHaveBeenCalledWith(fixtureId("message", 109));
    // Already the last branch: `]` has nowhere to go.
    onSelectBranch.mockClear();
    await userEvent.keyboard("]]");
    expect(onSelectBranch).not.toHaveBeenCalled();
  });
});

/** The live editor, once it has replaced the server-rendered shell. */
const editorReady = () =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>(
      '[contenteditable="true"]'
    );
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });

const composerFrame = () => {
  const element = document.querySelector<HTMLElement>('[data-slot="composer"]');
  if (!element) {
    throw new Error("no composer");
  }
  return within(element);
};

const newChat = (overrides: Partial<ChatScreenProps> = {}) => {
  const base = props();
  return props({
    conversation: {
      ...base.conversation,
      contextLocked: false,
      id: null,
      onContextChange: vi.fn(),
      participants: [],
      title: null,
    },
    messages: [],
    siblings: [],
    ...overrides,
  });
};

describe("header (D14)", () => {
  it("has at most three controls besides the title, context and branch switcher", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    // Collapsing the sidebar brings its toggle here: the busiest the header
    // gets. There's no New chat button in either state (113).
    const mod = modKey();
    await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
    const controls = header()
      .getAllByRole("button")
      .filter(
        (button) =>
          !(
            button.closest('[role="group"]') ||
            button.getAttribute("aria-label")?.startsWith("Rename chat")
          )
      );
    // The sidebar toggle is in the rail on a wide screen (181).
    const expected = ["Share", "Files", "Browser"];
    expect(controls).toEqual(
      expected.map((name) => header().getByRole("button", { name }))
    );
    // No sandbox pill, no separate Artifacts button.
    expect(header().queryByRole("button", { name: SANDBOX_PILL })).toBeNull();
    expect(
      header().queryByRole("button", { name: "Artifacts panel" })
    ).toBeNull();
  });

  it("keeps the sidebar toggle first in the rail, open or collapsed (181)", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    const rail = () => screen.getByRole("navigation", { name: "Sidebar rail" });
    const sidebar = within(
      screen.getByRole("complementary", { name: "Chats" })
    );
    const toggle = within(rail()).getByRole("button", {
      name: "Toggle sidebar",
    });
    expect(rail().querySelector("a, button")).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      sidebar.queryByRole("button", { name: "Toggle sidebar" })
    ).toBeNull();
    expect(
      header().queryByRole("button", { name: "Toggle sidebar" })
    ).toBeNull();
    expect(header().queryByRole("button", { name: "New chat" })).toBeNull();
    const before = toggle.getBoundingClientRect();

    await userEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    const collapsed = within(rail()).getByRole("button", {
      name: "Toggle sidebar",
    });
    expect(collapsed.getAttribute("aria-expanded")).toBe("false");
    const after = collapsed.getBoundingClientRect();
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(
      header().queryByRole("button", { name: "Toggle sidebar" })
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Toggle sidebar" })
    ).toHaveLength(1);
    await userEvent.click(collapsed);
    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
  });

  it("classic: no rail, the toggle in the sidebar's top row, then the header when collapsed (181)", async () => {
    renderWithI18n(
      <SidebarLayoutProvider value="classic">
        <ChatScreen {...props()} />
      </SidebarLayoutProvider>
    );
    expect(
      screen.queryByRole("navigation", { name: "Sidebar rail" })
    ).toBeNull();
    const sidebar = within(
      screen.getByRole("complementary", { name: "Chats" })
    );
    const toggle = sidebar.getByRole("button", { name: "Toggle sidebar" });
    expect(
      header().queryByRole("button", { name: "Toggle sidebar" })
    ).toBeNull();

    await userEvent.click(toggle);
    // Collapsed classic is the pre-rail shell: no sidebar, toggle in the header.
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    const inHeader = header().getByRole("button", { name: "Toggle sidebar" });
    expect(inHeader.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getAllByRole("button", { name: "Toggle sidebar" })
    ).toHaveLength(1);
    await userEvent.click(inHeader);
    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
  });

  // 137: Files and Browser in place of one Workspace toggle.
  it("opens the panel on its files or its browser, switches, and closes on a second press", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    const files = header().getByRole("button", { name: "Files" });
    const browser = header().getByRole("button", { name: "Browser" });
    const pressed = () => [
      files.getAttribute("aria-pressed"),
      browser.getAttribute("aria-pressed"),
    ];
    const sidePanel = () =>
      screen.queryByRole("complementary", { name: "Side panel" });
    expect(pressed()).toEqual(["false", "false"]);

    await userEvent.click(files);
    expect(
      await screen.findByRole("complementary", { name: "Side panel" })
    ).toBeTruthy();
    expect(pressed()).toEqual(["true", "false"]);

    // The Browser switches to the browser: its empty state, with nothing
    // running yet.
    await userEvent.click(browser);
    expect(pressed()).toEqual(["false", "true"]);
    const panel = within(
      await screen.findByRole("region", { name: "Workspace" })
    );
    expect(await panel.findByText("Nothing running yet")).toBeTruthy();
    expect(panel.getByRole("toolbar", { name: "Browser" }).hidden).toBe(false);

    await userEvent.click(browser);
    expect(sidePanel()).toBeNull();
    expect(pressed()).toEqual(["false", "false"]);

    // The Browser opens it too, and Files switches back.
    await userEvent.click(browser);
    expect(await screen.findByText("Nothing running yet")).toBeTruthy();
    await userEvent.click(files);
    expect(pressed()).toEqual(["true", "false"]);
    await waitFor(() =>
      expect(screen.queryByText("Nothing running yet")).toBeNull()
    );
    await userEvent.click(files);
    expect(sidePanel()).toBeNull();
  });

  it("keeps S on the files and A on the artifacts", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    const files = header().getByRole("button", { name: "Files" });
    await userEvent.keyboard("s");
    expect(
      await screen.findByRole("complementary", { name: "Side panel" })
    ).toBeTruthy();
    expect(files.getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("s");
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Side panel" })
      ).toBeNull()
    );
    // Artifacts are in the files' half, so Files shows as pressed.
    await userEvent.keyboard("a");
    expect(
      await screen.findByRole("complementary", { name: "Side panel" })
    ).toBeTruthy();
    expect(files.getAttribute("aria-pressed")).toBe("true");
  });
});

const chatContext = () =>
  document.querySelector<HTMLElement>(
    '[data-slot="app-header"] [data-slot="chat-context"]'
  );

describe("chat context (113)", () => {
  it("shows by the title as text once locked, and nowhere else", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await editorReady();
    expect(
      composerFrame().queryByRole("button", { name: ANY_CONTEXT_CHIP })
    ).toBeNull();
    // A fact about the chat now, not a choice.
    expect(chatContext()?.textContent).toContain("Platform");
    expect(chatContext()?.tagName).not.toBe("BUTTON");
    expect(
      header().queryByRole("button", { name: ANY_CONTEXT_CHIP })
    ).toBeNull();

    await userEvent.click(header().getByRole("button", { name: "Share" }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("group", { name: "Chat context" })).toBeNull();
  });

  it("is chosen in the header before the first message", async () => {
    const screenProps = newChat();
    renderWithI18n(<ChatScreen {...screenProps} />);
    expect(screen.getByText("What can I help with?")).toBeTruthy();
    await editorReady();
    expect(
      composerFrame().queryByRole("button", { name: ANY_CONTEXT_CHIP })
    ).toBeNull();
    await userEvent.click(
      header().getByRole("button", { name: "Chat context: Platform" })
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Personal" })
    );
    expect(screenProps.conversation.onContextChange).toHaveBeenCalledWith({
      type: "personal",
    });
  });

  it("isn't shown to someone with only Personal", async () => {
    const base = newChat();
    renderWithI18n(
      <ChatScreen
        {...newChat({
          conversation: {
            ...base.conversation,
            context: { type: "personal" },
            contextOptions: [{ context: { type: "personal" } }],
          },
        })}
      />
    );
    await editorReady();
    expect(chatContext()).toBeNull();
    expect(screen.queryByRole("button", { name: ANY_CONTEXT_CHIP })).toBeNull();
  });
});

describe("empty state", () => {
  it("sends a suggestion as the first message", async () => {
    const onSubmit = vi.fn();
    renderWithI18n(<ChatScreen {...newChat({ composer: { onSubmit } })} />);
    const suggestions = within(
      screen.getByRole("list", { name: "Suggestions" })
    ).getAllByRole("button");
    expect(suggestions).toHaveLength(4);
    await userEvent.click(suggestions[0] as HTMLElement);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [], mentions: [] })
    );
    expect(onSubmit.mock.lastCall?.[0].text).toMatch(NOT_BLANK);
  });

  it("offers no suggestions while the composer is disabled", () => {
    renderWithI18n(
      <ChatScreen
        {...newChat({ composer: { disabled: true, onSubmit: vi.fn() } })}
      />
    );
    expect(screen.getByText("What can I help with?")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Suggestions" })).toBeNull();
  });
});

const dock = () => {
  const element = document.querySelector<HTMLElement>(
    '[data-slot="composer-dock"]'
  );
  if (!element) {
    throw new Error("no composer dock");
  }
  return element;
};

// 098: centred on a new chat, at the bottom from the first send on.
describe("composer placement", () => {
  it("is centred on a new chat, with the greeting and suggestions", () => {
    renderWithI18n(<ChatScreen {...newChat()} />);
    expect(dock().dataset.placement).toBe("center");
    expect(within(dock()).getByText("What can I help with?")).toBeTruthy();
    expect(
      within(dock()).getByRole("list", { name: "Suggestions" })
    ).toBeTruthy();
  });

  it("is at the bottom of a chat that has started, before its messages load", () => {
    const base = newChat();
    renderWithI18n(
      <ChatScreen
        {...base}
        conversation={{ ...base.conversation, id: path.conversationId }}
      />
    );
    expect(dock().dataset.placement).toBe("bottom");
    expect(screen.queryByText("What can I help with?")).toBeNull();
  });

  it("moves down on the first send, keeping focus, and back for a new chat", async () => {
    const onSubmit = vi.fn();
    const base = newChat({ composer: { onSubmit } });
    const chatId = path.conversationId;
    let routed = false;
    function Host() {
      const [id, setId] = useState<typeof chatId | null>(null);
      routed = id !== null;
      const composer = useMemo(
        () => ({
          onSubmit: (value: ComposerValue) => {
            onSubmit(value);
            // The host creates the chat and routes to it a moment later.
            setTimeout(() => setId(chatId), 50);
          },
        }),
        []
      );
      const startNewChat = useCallback(() => setId(null), []);
      return (
        <ChatScreen
          {...base}
          composer={composer}
          conversation={{ ...base.conversation, id }}
          onNewChat={startNewChat}
        />
      );
    }
    renderWithI18n(<Host />);
    const editor = await editorReady();
    await userEvent.click(editor);
    await userEvent.keyboard("Hello");
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // At once, before the chat has its address.
    expect(dock().dataset.placement).toBe("bottom");
    expect(dock().contains(document.activeElement)).toBe(true);
    await waitFor(() => expect(routed).toBe(true));
    expect(dock().dataset.placement).toBe("bottom");
    expect(dock().contains(document.activeElement)).toBe(true);

    const [startNew] = screen.getAllByRole("button", { name: "New chat" });
    await userEvent.click(startNew as HTMLElement);
    expect(dock().dataset.placement).toBe("center");
  });
});

describe("shortcuts", () => {
  it("run from the page but not while typing", async () => {
    const onNewChat = vi.fn();
    renderWithI18n(<ChatScreen {...props({ onNewChat })} />);

    await userEvent.keyboard("n");
    expect(onNewChat).toHaveBeenCalledTimes(1);

    // Wait for the editor to replace the shell, so the click lands on it.
    const editor = await editorReady();
    await userEvent.click(editor);
    await userEvent.keyboard("n");
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("don't run while typing in an editor inside a shadow root (the panel's)", async () => {
    const onNewChat = vi.fn();
    renderWithI18n(<ChatScreen {...props({ onNewChat })} />);
    const host = document.createElement("div");
    document.body.append(host);
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    host.attachShadow({ mode: "open" }).append(editor);
    try {
      editor.focus();
      await userEvent.keyboard("n");
      expect(onNewChat).not.toHaveBeenCalled();
    } finally {
      host.remove();
    }
  });

  it("/ focuses the composer; ⌘B (Ctrl+B) toggles the sidebar even while typing", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await userEvent.keyboard("/");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Message")
    );

    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
    const mod = modKey();
    await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    // The layout is remembered.
    expect(
      JSON.parse(window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY) ?? "{}")
    ).toMatchObject({ sidebarOpen: false });
  });

  it("A toggles the artifacts panel and J/K move between chats", async () => {
    const onSelect = vi.fn();
    const base = props();
    renderWithI18n(
      <ChatScreen {...props({ sidebar: { ...base.sidebar, onSelect } })} />
    );
    // A opens the Workspace panel on the chat's artifacts (060).
    await userEvent.keyboard("a");
    const workspace = within(
      await screen.findByRole("region", { name: "Workspace" })
    );
    expect(
      (
        await workspace.findByRole("button", { name: chatArtifacts[0]?.title })
      ).getAttribute("aria-current")
    ).toBe("true");
    await userEvent.keyboard("a");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Workspace" })).toBeNull()
    );

    // The open chat is first in "Today" after the pinned one.
    await userEvent.keyboard("j");
    expect(onSelect).toHaveBeenLastCalledWith(chats[2]?.id);
    await userEvent.keyboard("k");
    expect(onSelect).toHaveBeenLastCalledWith(chats[1]?.id);
  });

  it("one ⌘K (Ctrl+K) opens the app's palette and leaves it open", async () => {
    // The app mounts the palette beside the screen, and the palette binds
    // ⌘K to toggle itself, as `CommandPalette` does.
    const Host = () => {
      const [open, setOpen] = useState(false);
      useShortcut("palette.open", () => setOpen(!open));
      return (
        <>
          <ChatScreen {...props({ onOpenPalette: () => setOpen(true) })} />
          {open ? <output>Palette open</output> : null}
        </>
      );
    };
    renderWithI18n(<Host />);
    const mod = modKey();
    const paletteOpen = () => screen.queryByText("Palette open");

    await userEvent.keyboard(`{${mod}>}k{/${mod}}`);
    await new Promise(requestAnimationFrame);
    expect(paletteOpen()).toBeTruthy();

    await userEvent.keyboard(`{${mod}>}k{/${mod}}`);
    await new Promise(requestAnimationFrame);
    expect(paletteOpen()).toBeNull();
  });

  it("? opens the shortcut list", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    expect(within(dialog).getByText("Toggle sidebar")).toBeTruthy();
  });
});

describe("the Workspace panel (060)", () => {
  it("reopens a stored Artifacts tab as the panel on its artifacts", async () => {
    window.localStorage.setItem(
      SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({ panel: "artifacts" })
    );
    renderWithI18n(<ChatScreen {...props()} />);
    const workspace = within(
      await screen.findByRole("region", { name: "Workspace" })
    );
    expect(
      (
        await workspace.findByRole("button", { name: chatArtifacts[0]?.title })
      ).getAttribute("aria-current")
    ).toBe("true");
  });

  it("S opens the files; a new chat gets the normal empty state", async () => {
    const base = props();
    renderWithI18n(
      <ChatScreen
        {...props({
          conversation: { ...base.conversation, id: null },
          workspace: { ...base.workspace, files: { kind: "new-chat" } },
        })}
      />
    );
    await userEvent.keyboard("s");
    const workspace = within(
      await screen.findByRole("region", { name: "Workspace" })
    );
    expect(
      workspace.getByText(
        "No files yet. Files you and the agent create will appear here."
      )
    ).toBeTruthy();
    expect(workspace.queryByText(TURNED_OFF)).toBeNull();
  });

  it("opens a file from outside the panel, with a workspace path", async () => {
    const onSelect = vi.fn();
    const handle = createRef<WorkspaceHandle>();
    const base = props();
    renderWithI18n(
      <ChatScreen
        {...props({ workspace: { ...base.workspace, onSelect } })}
        workspaceHandle={handle}
      />
    );
    act(() => handle.current?.openFile("/work/notes.md"));
    expect(onSelect).toHaveBeenCalledWith({ kind: "file", path: "notes.md" });
    expect(
      await screen.findByRole("region", { name: "Workspace" })
    ).toBeTruthy();
  });
});

const NEW_FILE = /New file/;
const PREVIEW = /^Preview/;
const OPEN_FILE = /Open file/;

describe("composer file commands (062)", () => {
  /** A workspace client whose writes all succeed; only writes are exercised. */
  const writingClient = () => {
    const fail = () => Promise.resolve(err("unused"));
    return {
      deleteFile: vi.fn(fail),
      importFile: vi.fn(fail),
      listFiles: vi.fn(() => Promise.resolve(ok([]))),
      readFile: vi.fn(fail),
      reset: vi.fn(fail),
      writeFile: vi.fn(({ path: written }: { path: string }) =>
        Promise.resolve(ok({ etag: "a".repeat(64), path: written, size: 0 }))
      ),
    } satisfies WorkspaceClient;
  };

  const inChat = (
    overrides: Partial<ChatScreenProps["workspace"]> = {},
    composer: Partial<ChatScreenProps["composer"]> = {}
  ) => {
    const base = props();
    const client = writingClient();
    const onChanged = vi.fn();
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    renderWithI18n(
      <ChatScreen
        {...props({
          composer: { onSubmit, ...composer },
          workspace: {
            ...base.workspace,
            files: { client, kind: "chat", onChanged, sandbox: null },
            onSelect,
            ...overrides,
          },
        })}
      />
    );
    return { client, onChanged, onSelect, onSubmit };
  };

  it("/new-file asks for a name, creates the file empty and opens it", async () => {
    const { client, onChanged, onSelect } = inChat();
    await userEvent.click(await editorReady());
    await userEvent.keyboard("/new");
    await screen.findByRole("option", { name: NEW_FILE });
    await userEvent.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", { name: "New file" });
    await userEvent.type(
      within(dialog).getByLabelText("Name"),
      "notes.md{Enter}"
    );
    await waitFor(() =>
      expect(client.writeFile).toHaveBeenCalledWith({
        content: "",
        ifMatch: null,
        path: "/work/notes.md",
      })
    );
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({ kind: "file", path: "notes.md" })
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("/open lists the workspace's files, leaving out names with spaces", async () => {
    const { onSelect } = inChat({ paths: ["src/app.ts", "my notes.md"] });
    await userEvent.click(await editorReady());
    await userEvent.keyboard("/open");
    await screen.findByRole("option", { name: OPEN_FILE });
    await userEvent.keyboard("{Enter}");
    const files = await screen.findByRole("listbox", { name: "Files" });
    expect(within(files).getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith({ kind: "file", path: "src/app.ts" });
  });

  it("/preview asks the agent for one when nothing is recorded", async () => {
    const { onSubmit } = inChat({ canPreview: true });
    await userEvent.click(await editorReady());
    await userEvent.keyboard("/prev");
    await userEvent.click(await screen.findByRole("option", { name: PREVIEW }));
    expect(onSubmit).toHaveBeenCalledWith({
      attachments: [],
      mentions: [],
      skills: [],
      templateId: null,
      text: "Start the app and open a preview",
    });
  });

  it("has no /preview on a workspace that can't serve one, and no commands before the chat exists", async () => {
    inChat({ canPreview: false });
    await userEvent.click(await editorReady());
    await userEvent.keyboard("/");
    await screen.findByRole("option", { name: NEW_FILE });
    expect(screen.queryByRole("option", { name: PREVIEW })).toBeNull();
    cleanup();

    renderWithI18n(
      <ChatScreen
        {...newChat({
          workspace: { ...props().workspace, files: { kind: "new-chat" } },
        })}
      />
    );
    await userEvent.click(await editorReady());
    await userEvent.keyboard("/new");
    // Nothing to list: no prompts here, and no commands yet.
    await expect
      .poll(() => screen.queryByRole("option", { name: NEW_FILE }))
      .toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("the Preview opens by itself (066)", () => {
  const answer = path.messages
    .filter((each) => each.role === "assistant")
    .at(-1);
  if (!answer) {
    throw new Error("fixture answer");
  }
  const HASH = "a".repeat(64);
  const call: Message["parts"][number] = {
    approval: { state: "not-required" },
    input: { content: "<h1>Hi</h1>", path: "index.html" },
    toolCallId: "call_page",
    toolName: "write",
    type: "tool-call",
  };
  const landed: Message["parts"][number] = {
    output: {
      status: "success",
      value: {
        applied: ["h1"],
        edit: {
          hunks: [{ hunkId: "h1" }],
          patch: `--- index.html\tsha256:${HASH}\n+++ index.html\n@@ -0,0 +1 @@\n+<h1>Hi</h1>\n`,
          path: "index.html",
        },
        rejected: [],
        status: "changed",
      },
    },
    toolCallId: "call_page",
    toolName: "write",
    type: "tool-result",
  };
  /** The branch with the last answer's parts replaced. */
  const withAnswer = (parts: Message["parts"]): Message[] => [
    ...path.messages.filter((each) => each.id !== answer.id),
    { ...answer, parts },
  ];

  const pageClient = (): WorkspaceClient => {
    const fail = () => Promise.resolve(err("unused"));
    return {
      deleteFile: vi.fn(fail),
      importFile: vi.fn(fail),
      listFiles: vi.fn(() =>
        Promise.resolve(
          ok([
            {
              modifiedAt: null,
              path: "/work/index.html",
              size: 11,
              type: "file" as const,
            },
          ])
        )
      ),
      readFile: vi.fn(() =>
        Promise.resolve(
          ok({
            content: "<h1>Hi</h1>",
            encoding: "utf8" as const,
            etag: HASH,
            size: 11,
          })
        )
      ),
      reset: vi.fn(fail),
      writeFile: vi.fn(() =>
        Promise.resolve(err({ kind: "failed" as const, message: "unused" }))
      ),
    };
  };

  const screenProps = (
    messages: readonly Message[],
    onSelect = vi.fn(),
    files: WorkspaceFilesSource = {
      client: pageClient(),
      kind: "chat",
      onChanged: vi.fn(),
      sandbox: { ...sandboxFixture, previews: [], provider: "just-bash" },
    }
  ): ChatScreenProps => {
    const base = props();
    return props({
      messages,
      workspace: {
        ...base.workspace,
        files,
        onSelect,
        paths: ["index.html"],
      },
    });
  };

  /** The screen with a branch the test can move on, as a stream would. */
  const live = (first: readonly Message[], onSelect = vi.fn()) => {
    const files: WorkspaceFilesSource = {
      client: pageClient(),
      kind: "chat",
      onChanged: vi.fn(),
      sandbox: { ...sandboxFixture, previews: [], provider: "just-bash" },
    };
    let setMessages: (next: readonly Message[]) => void = () => undefined;
    function Live() {
      const [messages, set] = useState(first);
      setMessages = set;
      return <ChatScreen {...screenProps(messages, onSelect, files)} />;
    }
    renderWithI18n(<Live />);
    return {
      stream: (next: readonly Message[]) => act(() => setMessages(next)),
    };
  };

  const workspaceRegion = () =>
    screen.queryByRole("region", { name: "Workspace" });

  it("when the agent writes a page, on that page", async () => {
    const onSelect = vi.fn();
    const { stream } = live(withAnswer([call]), onSelect);
    expect(workspaceRegion()).toBeNull();
    stream(withAnswer([call, landed]));
    expect(onSelect).toHaveBeenCalledWith({ kind: "preview" });
    const workspace = within(
      await screen.findByRole("region", { name: "Workspace" })
    );
    expect(
      await workspace.findByTitle("Static render of index.html")
    ).toBeTruthy();
  });

  it("not for a chat opened with pages in its history", async () => {
    renderWithI18n(<ChatScreen {...screenProps(withAnswer([call, landed]))} />);
    // The card is there; the panel stays shut.
    expect(
      await screen.findByRole("region", { name: "Created index.html" })
    ).toBeTruthy();
    expect(workspaceRegion()).toBeNull();
  });

  it("not when the person closed the panel during the run", async () => {
    const { stream } = live(withAnswer([call]));
    const toggle = header().getByRole("button", { name: "Files" });
    await userEvent.click(toggle);
    expect(
      await screen.findByRole("region", { name: "Workspace" })
    ).toBeTruthy();
    await userEvent.click(toggle);
    expect(workspaceRegion()).toBeNull();
    stream(withAnswer([call, landed]));
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 50)));
    expect(workspaceRegion()).toBeNull();
  });

  it("a page's card leads with Preview, which shows it in the panel", async () => {
    const onSelect = vi.fn();
    renderWithI18n(
      <ChatScreen {...screenProps(withAnswer([call, landed]), onSelect)} />
    );
    const card = within(
      await screen.findByRole("region", { name: "Created index.html" })
    );
    const [preview, open] = card.getAllByRole("button");
    expect(preview?.getAttribute("aria-label")).toBe("Preview index.html");
    expect(open?.getAttribute("aria-label")).toBe("Open index.html");
    await userEvent.click(
      card.getByRole("button", { name: "Preview index.html" })
    );
    expect(onSelect).toHaveBeenCalledWith({ kind: "preview" });
    const workspace = within(
      await screen.findByRole("region", { name: "Workspace" })
    );
    expect(
      await workspace.findByTitle("Static render of index.html")
    ).toBeTruthy();
  });

  it("openPreview(path) shows that page", async () => {
    const handle = createRef<WorkspaceHandle>();
    renderWithI18n(
      <ChatScreen {...screenProps(path.messages)} workspaceHandle={handle} />
    );
    act(() => handle.current?.openPreview("/work/index.html"));
    const workspace = within(
      await screen.findByRole("region", { name: "Workspace" })
    );
    expect(
      await workspace.findByTitle("Static render of index.html")
    ).toBeTruthy();
    expect(
      workspace.getByRole<HTMLInputElement>("textbox", { name: "Address" })
        .value
    ).toBe("/index.html");
  });
});

describe("sidebar", () => {
  it("lists chats flat under Pinned and Chats, and archives with an undo", async () => {
    const onArchive = vi.fn();
    const onRestore = vi.fn();
    const base = props();
    renderWithI18n(
      <ChatScreen
        {...props({ sidebar: { ...base.sidebar, onArchive, onRestore } })}
      />
    );
    const sidebar = within(
      screen.getByRole("complementary", { name: "Chats" })
    );
    for (const heading of ["Pinned", "Chats"]) {
      expect(sidebar.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(sidebar.queryByRole("heading", { name: "Today" })).toBeNull();

    const title = chats[2]?.title ?? "";
    await userEvent.click(
      sidebar.getByRole("button", { name: `Actions for ${title}` })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Archive" })
    );
    expect(onArchive).toHaveBeenCalledWith(chats[2]?.id);

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onRestore).toHaveBeenCalledWith(chats[2]?.id);
  });
});

describe("narrow screens", () => {
  beforeEach(async () => {
    await page.viewport(375, 812);
  });
  afterEach(async () => {
    await page.viewport(1336, 800);
  });

  const sheet = (name: string) => screen.findByRole("dialog", { name });

  it("opens the sidebar as a sheet that traps focus and closes on Esc", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    // No sidebar beside the chat; the toggle opens it over the chat instead.
    expect(screen.queryByRole("complementary", { name: "Chats" })).toBeNull();
    const toggle = header().getByRole("button", { name: "Toggle sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(toggle);
    const chatsSheet = await sheet("Chats");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(chatsSheet.contains(document.activeElement)).toBe(true)
    );
    // Tabbing cycles inside the sheet rather than escaping to the page.
    for (let step = 0; step < 12; step += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each Tab depends on where the last one left focus.
      await userEvent.tab();
      expect(chatsSheet.contains(document.activeElement)).toBe(true);
    }

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull()
    );
    // The wide layout's remembered sidebar is left alone.
    expect(window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY)).not.toContain(
      '"sidebarOpen":false'
    );
  });

  it("closes the sidebar sheet once a chat is picked", async () => {
    const onSelect = vi.fn();
    const base = props();
    renderWithI18n(
      <ChatScreen {...props({ sidebar: { ...base.sidebar, onSelect } })} />
    );
    const mod = modKey();
    await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
    const chatsSheet = within(await sheet("Chats"));
    const title = chats[2]?.title ?? "";
    // The keyboard picks it: the page has no stylesheet in tests, so the
    // row sits below the fold of a scroll-locked page.
    chatsSheet.getByRole("button", { name: title }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(chats[2]?.id);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull()
    );
  });

  it("shows the side panel as a bottom sheet, opened from the overflow menu", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    // Share, Files and Browser move into the overflow menu.
    expect(header().queryByRole("button", { name: "Share" })).toBeNull();
    expect(header().queryByRole("button", { name: "Files" })).toBeNull();
    expect(header().queryByRole("button", { name: "Browser" })).toBeNull();
    await userEvent.click(
      header().getByRole("button", { name: "More actions" })
    );
    // The context stays by the title, not in the menu (113).
    expect(chatContext()?.textContent).toContain("Platform");
    expect(screen.queryByRole("group", { name: "Chat context" })).toBeNull();
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Browser" })
    ).toBeTruthy();
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Files" })
    );
    const panelSheet = within(await sheet("Side panel"));
    // One Workspace panel, and no terminal anywhere in it (060).
    expect(
      await panelSheet.findByRole("region", { name: "Workspace" })
    ).toBeTruthy();
    expect(panelSheet.queryByText("Terminal")).toBeNull();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull()
    );
    expect(
      JSON.parse(window.localStorage.getItem(SHELL_LAYOUT_STORAGE_KEY) ?? "{}")
    ).toMatchObject({ panel: null });
  });

  it("goes back to the side-by-side layout when the screen widens", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await userEvent.keyboard("a");
    expect(await sheet("Side panel")).toBeTruthy();

    await page.viewport(1336, 800);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull()
    );
    expect(
      screen.getByRole("complementary", { name: "Side panel" })
    ).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
  });
});
