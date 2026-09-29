import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { contextOptionsFromMe } from "@workspace/composer/options";
import { fixtureId, me, teamPlatform } from "@workspace/contract/fixtures";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { err, ok } from "@workspace/shared/result";
import { createRef } from "react";
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
import { SHELL_LAYOUT_STORAGE_KEY } from "../shell/use-shell-layout";
import { modKey, renderWithI18n } from "../testing/render";
import type { WorkspaceClient } from "../workspace/model/client";

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
  it("has at most four controls besides the title and branch switcher", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    // Collapsing the sidebar adds New chat: the busiest the header gets.
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
    const expected = ["Toggle sidebar", "New chat", "Share", "Workspace"];
    expect(controls).toEqual(
      expected.map((name) => header().getByRole("button", { name }))
    );
    // No sandbox pill, no separate Artifacts button.
    expect(header().queryByRole("button", { name: SANDBOX_PILL })).toBeNull();
    expect(
      header().queryByRole("button", { name: "Artifacts panel" })
    ).toBeNull();
  });

  it("toggles the workspace panel with one pressed button", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    const toggle = header().getByRole("button", { name: "Workspace" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(toggle);
    expect(
      await screen.findByRole("complementary", { name: "Side panel" })
    ).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(toggle);
    expect(
      screen.queryByRole("complementary", { name: "Side panel" })
    ).toBeNull();
  });
});

describe("chat context", () => {
  it("shows in the Share menu once locked, not in the composer", async () => {
    renderWithI18n(<ChatScreen {...props()} />);
    await editorReady();
    expect(
      composerFrame().queryByRole("button", { name: ANY_CONTEXT_CHIP })
    ).toBeNull();

    await userEvent.click(header().getByRole("button", { name: "Share" }));
    const group = await screen.findByRole("group", { name: "Chat context" });
    expect(group.textContent).toContain("Platform");
    // A fact about the chat now, not a choice.
    expect(within(group).queryByRole("button")).toBeNull();
    expect(within(group).queryByRole("menuitemradio")).toBeNull();
  });

  it("is chosen in the composer before the first message", async () => {
    const screenProps = newChat();
    renderWithI18n(<ChatScreen {...screenProps} />);
    expect(screen.getByText("What can I help with?")).toBeTruthy();
    await editorReady();
    await userEvent.click(
      composerFrame().getByRole("button", { name: "Chat context: Platform" })
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Personal" })
    );
    expect(screenProps.conversation.onContextChange).toHaveBeenCalledWith({
      type: "personal",
    });
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

describe("sidebar", () => {
  it("groups chats by date and archives with an undo", async () => {
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
    for (const heading of [
      "Pinned",
      "Today",
      "Yesterday",
      "Previous 7 days",
      "Older",
    ]) {
      expect(sidebar.getByRole("heading", { name: heading })).toBeTruthy();
    }

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
    await page.viewport(1280, 800);
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
    // Share and the Workspace toggle move into the overflow menu.
    expect(header().queryByRole("button", { name: "Share" })).toBeNull();
    expect(header().queryByRole("button", { name: "Workspace" })).toBeNull();
    await userEvent.click(
      header().getByRole("button", { name: "More actions" })
    );
    // The locked context comes along.
    expect(
      (await screen.findByRole("group", { name: "Chat context" })).textContent
    ).toContain("Platform");
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Workspace" })
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

    await page.viewport(1280, 800);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Side panel" })).toBeNull()
    );
    expect(
      screen.getByRole("complementary", { name: "Side panel" })
    ).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Chats" })).toBeTruthy();
  });
});
