import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { sandbox as sandboxFixture } from "@workspace/contract/fixtures";
import type { SandboxRecord } from "@workspace/contract/schemas/sandbox";
import { err, ok } from "@workspace/shared/result";
import { type ReactElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { chatArtifacts } from "../fixtures";
import type { WorkspaceSelection } from "../model/workspace";
import { RightPanel } from "../shell/right-panel";
import type {
  WorkspaceClient,
  WorkspaceFilesSource,
  WorkspaceWriteError,
} from "./model/client";
import { SAVE_IDLE_MS, SLOW_SAVE_MS } from "./model/editor";
import { SPLIT_STORAGE_KEY } from "./model/split";
import { WorkspacePanel, type WorkspacePanelProps } from "./workspace-panel";

// The Workspace panel (060) over a fake `WorkspaceClient`: the list and
// what selecting shows, the editor saving with the version it read and the
// conflict when the agent got there first, the empty, new-chat, off and
// failed states, reloading as the agent's tools settle, and the preview.

const TURNED_OFF = /turned off/;
/** Anything the editor's save status could say. */
const SAVE_WORDS = /^(Saved|Unsaved|Saving…)$/;
const V1 = "a".repeat(64);
const V2 = "b".repeat(64);
const V3 = "c".repeat(64);

const ready: SandboxRecord = {
  ...sandboxFixture,
  previews: [],
  status: { state: "ready" },
};

interface FakeFile {
  content: string;
  etag: string;
}

/** An in-memory workspace; every method is a spy. */
const fakeClient = (initial: Record<string, FakeFile> = {}) => {
  const files = new Map(Object.entries(initial));
  const writes: {
    content: string;
    ifMatch: string | null | undefined;
    keepalive: boolean | undefined;
    path: string;
  }[] = [];
  let nextEtag = V2;
  const client = {
    deleteFile: vi.fn((path: string) => {
      files.delete(path);
      return Promise.resolve(ok(undefined));
    }),
    importFile: vi.fn((file: File) =>
      Promise.resolve(ok({ etag: V1, path: `/work/${file.name}`, size: 1 }))
    ),
    listFiles: vi.fn(() =>
      Promise.resolve(
        ok(
          [...files.keys()].map((path) => ({
            modifiedAt: null,
            path,
            size: 1,
            type: "file" as const,
          }))
        )
      )
    ),
    readFile: vi.fn((_id: string, path: string) => {
      const file = files.get(path);
      return Promise.resolve(
        file
          ? ok({
              content: file.content,
              encoding: "utf8" as const,
              etag: file.etag,
              size: file.content.length,
            })
          : err(`${path}: no such file`)
      );
    }),
    reset: vi.fn(() => Promise.resolve(ok(ready))),
    writeFile: vi.fn(
      ({
        content,
        ifMatch,
        keepalive,
        path,
      }: {
        content: string;
        ifMatch?: string | null;
        keepalive?: boolean;
        path: string;
      }) => {
        writes.push({ content, ifMatch, keepalive, path });
        const current = files.get(path);
        if (ifMatch === null && current) {
          return Promise.resolve(
            err<WorkspaceWriteError>({ kind: "already_exists" })
          );
        }
        if (ifMatch && current?.etag !== ifMatch) {
          return Promise.resolve(
            err<WorkspaceWriteError>({ kind: "version_mismatch" })
          );
        }
        const etag = nextEtag;
        nextEtag = V3;
        files.set(path, { content, etag });
        return Promise.resolve(ok({ etag, path, size: content.length }));
      }
    ),
  } satisfies WorkspaceClient;
  /** The agent changing a file behind the editor's back. */
  const agentWrites = (path: string, content: string, etag: string) =>
    files.set(path, { content, etag });
  return { agentWrites, client, files, writes };
};

const props = (
  overrides: Partial<WorkspacePanelProps> = {}
): WorkspacePanelProps => ({
  artifacts: { artifacts: [], versions: [] },
  files: { kind: "off" },
  onSelect: vi.fn(),
  revision: 0,
  selection: null,
  ...overrides,
});

const chatFiles = (
  client: WorkspaceClient,
  sandbox: SandboxRecord | null = ready,
  onChanged = vi.fn()
): WorkspaceFilesSource => ({ client, kind: "chat", onChanged, sandbox });

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

/** Renders with Lingui, rerenders included. */
const renderWithI18n = (ui: ReactElement) =>
  render(ui, {
    wrapper: ({ children }) => (
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    ),
  });

/** A click the DOM way: Base UI's modal backdrop sits over portalled popups for Playwright's hit test. */
const press = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
};

const panel = () => within(screen.getByRole("region", { name: "Workspace" }));

/** The editor's text, typed into as a person would. */
const editable = async (): Promise<HTMLElement> => {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    const host = document.querySelector('[data-slot="code-editor"]');
    const roots = [...(host?.querySelectorAll("*") ?? [])]
      .map((element) => element.shadowRoot)
      .filter((root): root is ShadowRoot => root !== null);
    found =
      roots
        .map((root) =>
          root.querySelector<HTMLElement>('[contenteditable="true"]')
        )
        .find((element) => element !== null) ?? null;
    expect(found).not.toBeNull();
  });
  if (!found) {
    throw new Error("no editor");
  }
  return found;
};

/** A file tree row by path (the tree renders in a shadow root); re-queried on each call. */
const treeItem = async (name: string): Promise<() => HTMLElement> => {
  const find = () => {
    const roots = [...document.querySelectorAll("*")]
      .map((element) => element.shadowRoot)
      .filter((root): root is ShadowRoot => root !== null);
    for (const root of roots) {
      const item = root.querySelector<HTMLElement>(
        `[role="treeitem"][data-item-path="${name}"]`
      );
      if (item) {
        return item;
      }
    }
    return null;
  };
  await waitFor(() => expect(find()).not.toBeNull());
  return () => {
    const item = find();
    if (!item) {
      throw new Error(`no tree item ${name}`);
    }
    return item;
  };
};

beforeAll(async () => {
  // The editor and tree chunks, warmed under hookTimeout (ticket 037).
  await Promise.all([
    import("@workspace/code-ui/code-editor"),
    import("@workspace/code-ui/file-tree"),
  ]);
});

afterEach(cleanup);

describe("the list and the main area", () => {
  it("lists the files and the artifacts under the browser, and selects them", async () => {
    const { client } = fakeClient({
      "/work/notes.txt": { content: "# Notes\n", etag: V1 },
    });
    const onSelect = vi.fn();
    renderWithI18n(
      <WorkspacePanel
        {...props({
          artifacts: { artifacts: chatArtifacts, versions: undefined },
          files: chatFiles(client, {
            ...ready,
            previews: [{ port: 5173, url: "https://preview.example.test/" }],
          }),
          onSelect,
        })}
      />
    );
    const workspace = panel();
    // The browser is its own half, on top (097): the list has no Preview.
    expect(workspace.getByRole("region", { name: "Browser" })).toBeTruthy();
    expect(workspace.queryByRole("button", { name: "Preview" })).toBeNull();
    const [first] = chatArtifacts;
    if (!first) {
      throw new Error("fixture artifacts");
    }
    await userEvent.click(workspace.getByRole("button", { name: first.title }));
    expect(onSelect).toHaveBeenLastCalledWith({
      artifactId: first.id,
      kind: "artifact",
    });
    // The tree lists what the workspace holds.
    await waitFor(() => expect(client.listFiles).toHaveBeenCalled());
    expect(workspace.queryByText("No files yet")).toBeNull();
    // Nothing selected: the main area asks for a pick.
    expect(workspace.getByText("Select a file to open it.")).toBeTruthy();
  });

  it("shows no terminal, port box or status badge", async () => {
    const { client } = fakeClient();
    renderWithI18n(<WorkspacePanel {...props({ files: chatFiles(client) })} />);
    const workspace = panel();
    expect(workspace.queryByText("Terminal")).toBeNull();
    expect(workspace.queryByRole("textbox", { name: "Port" })).toBeNull();
    expect(workspace.queryByText("gVisor")).toBeNull();
    expect(
      workspace.queryByRole("button", { name: "Create sandbox" })
    ).toBeNull();
    await waitFor(() => expect(client.listFiles).toHaveBeenCalled());
  });

  it("follows the open file in the tree, so a file can be opened again after an artifact", async () => {
    const { client } = fakeClient({
      "/work/notes.txt": { content: "# Notes\n", etag: V1 },
    });
    const onSelect = vi.fn();
    const base = props({
      artifacts: { artifacts: chatArtifacts, versions: undefined },
      files: chatFiles(client),
      onSelect,
    });
    const view = renderWithI18n(
      <WorkspacePanel
        {...base}
        selection={{ kind: "file", path: "notes.txt" }}
      />
    );
    const row = await treeItem("notes.txt");
    await waitFor(() =>
      expect(row().getAttribute("aria-selected")).toBe("true")
    );

    // An artifact takes the main area: the tree lets go of the file…
    view.rerender(
      <WorkspacePanel {...base} selection={{ kind: "artifact" }} />
    );
    await waitFor(() =>
      expect(row().getAttribute("aria-selected")).not.toBe("true")
    );
    // …so clicking it selects it anew.
    onSelect.mockClear();
    // The DOM way: Playwright's hit test doesn't reach the row here.
    await press(row());
    expect(onSelect).toHaveBeenLastCalledWith({
      kind: "file",
      path: "notes.txt",
    });
  });

  it("shows the selected artifact", () => {
    const [, second] = chatArtifacts;
    if (!second) {
      throw new Error("fixture artifacts");
    }
    renderWithI18n(
      <WorkspacePanel
        {...props({
          artifacts: { artifacts: chatArtifacts, versions: undefined },
          selection: { artifactId: second.id, kind: "artifact" },
        })}
      />
    );
    expect(
      panel()
        .getByRole("button", { name: second.title })
        .getAttribute("aria-current")
    ).toBe("true");
    expect(panel().getByText("Loading artifact")).toBeTruthy();
  });
});

describe("the editor", () => {
  const notes: WorkspaceSelection = { kind: "file", path: "notes.txt" };

  it("saves after a pause with the version it read, then with the new one", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "hi\n", etag: V1 },
    });
    const onChanged = vi.fn();
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(fake.client, ready, onChanged),
          selection: notes,
        })}
      />
    );
    const editor = await editable();
    // An untouched file says nothing about saving.
    expect(panel().queryByText(SAVE_WORDS)).toBeNull();
    await userEvent.click(editor);
    await userEvent.keyboard("A");
    expect(panel().getByText("Unsaved")).toBeTruthy();
    await waitFor(() => expect(fake.writes).toHaveLength(1), {
      timeout: SAVE_IDLE_MS + 4000,
    });
    expect(fake.writes[0]).toMatchObject({
      ifMatch: V1,
      keepalive: true,
      path: "/work/notes.txt",
    });
    expect(fake.writes[0]?.content).toContain("A");
    // A save that lands is not news: the status just goes quiet.
    await waitFor(() => expect(panel().queryByText(SAVE_WORDS)).toBeNull());
    expect(onChanged).toHaveBeenCalled();

    // ⌘S saves at once, over the version the last save made.
    await userEvent.click(editor);
    await userEvent.keyboard("B");
    await userEvent.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(fake.writes).toHaveLength(2));
    expect(fake.writes[1]?.ifMatch).toBe(V2);
  });

  it("saves a pending edit at once when the page is hidden or left", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "hi\n", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({ files: chatFiles(fake.client), selection: notes })}
      />
    );
    const editor = await editable();
    await userEvent.click(editor);
    await userEvent.keyboard("A");
    // A reload or close: no waiting for the pause, and sent to outlive the page.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ ifMatch: V1, keepalive: true });
    expect(fake.writes[0]?.content).toContain("A");
    // The save it started counts: a second event doesn't send it again.
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(fake.writes).toHaveLength(1);
    await waitFor(() => expect(panel().queryByText("Unsaved")).toBeNull());

    // Another tab or app: the page is hidden, and may never come back.
    await userEvent.click(editor);
    await userEvent.keyboard("B");
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      visibility.mockRestore();
    }
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[1]).toMatchObject({ ifMatch: V2, keepalive: true });
    // Nothing pending: hiding it again sends nothing.
    await waitFor(() => expect(panel().queryByText("Unsaved")).toBeNull());
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(fake.writes).toHaveLength(2);
  });

  it("says Saving… only for a slow save, and asks before leaving edits it can't send", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "hi\n", etag: V1 },
    });
    let land: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    let sending: () => void = () => undefined;
    const sent = new Promise<void>((resolve) => {
      sending = resolve;
    });
    fake.client.writeFile.mockImplementationOnce(async ({ content, path }) => {
      sending();
      await held;
      return ok({ etag: V2, path, size: content.length });
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({ files: chatFiles(fake.client), selection: notes })}
      />
    );
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const editor = await editable();
    await userEvent.click(editor);
    // The idle and slow-save clocks are the subject here, so the test owns
    // them; on real timers a busy runner decides what "quick" means.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await userEvent.keyboard("A");
      // Pending, but the flush on leaving will send it.
      expect(leave()).toBe(false);
      await userEvent.keyboard("{Control>}s{/Control}");
      await sent;
      await act(() => vi.advanceTimersByTimeAsync(SLOW_SAVE_MS - 1));
      // Quick so far: still just "Unsaved".
      expect(panel().getByText("Unsaved")).toBeTruthy();
      expect(leave()).toBe(false);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(panel().getByText("Saving…")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }

    // Typed during the save: it can't go before the save says which
    // version it made, so leaving now would lose it.
    await userEvent.keyboard("B");
    expect(leave()).toBe(true);
    await act(async () => {
      land();
      await Promise.resolve();
    });
    await waitFor(() => expect(panel().queryByText("Saving…")).toBeNull());
    expect(leave()).toBe(false);
  });

  it("says when the agent changed the file first: Reload or Overwrite", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "hi\n", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({ files: chatFiles(fake.client), selection: notes })}
      />
    );
    const editor = await editable();
    fake.agentWrites("/work/notes.txt", "the agent's\n", V3);
    await userEvent.click(editor);
    await userEvent.keyboard("A");
    await userEvent.keyboard("{Control>}s{/Control}");
    const alert = await panel().findByText("Changed by the agent");
    expect(alert).toBeTruthy();
    expect(fake.writes[0]?.ifMatch).toBe(V1);

    // Overwrite saves without a version; the agent's text is replaced.
    await userEvent.click(panel().getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(fake.writes).toHaveLength(2));
    expect(fake.writes[1]?.ifMatch).toBeUndefined();
    await waitFor(() =>
      expect(panel().queryByText("Changed by the agent")).toBeNull()
    );
  });

  it("reloads to the agent's version on Reload", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "hi\n", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({ files: chatFiles(fake.client), selection: notes })}
      />
    );
    const editor = await editable();
    fake.agentWrites("/work/notes.txt", "the agent's\n", V3);
    await userEvent.click(editor);
    await userEvent.keyboard("A");
    await userEvent.keyboard("{Control>}s{/Control}");
    await userEvent.click(
      await panel().findByRole("button", { name: "Reload" })
    );
    await waitFor(() =>
      expect(panel().queryByText("Changed by the agent")).toBeNull()
    );
    expect(fake.client.readFile).toHaveBeenCalledTimes(2);
    expect(fake.writes).toHaveLength(1);
  });

  it("deletes the open file after asking", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "hi\n", etag: V1 },
    });
    const onSelect = vi.fn();
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(fake.client),
          onSelect,
          selection: notes,
        })}
      />
    );
    await editable();
    await userEvent.click(
      panel().getByRole("button", { name: "Delete notes.txt" })
    );
    await press(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(fake.client.deleteFile).toHaveBeenCalledWith("/work/notes.txt")
    );
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("states", () => {
  it("empty: says how to add files, and New file creates one", async () => {
    const fake = fakeClient();
    const onSelect = vi.fn();
    const onChanged = vi.fn();
    // No workspace yet: the first write creates it.
    renderWithI18n(
      <WorkspacePanel
        {...props({ files: chatFiles(fake.client, null, onChanged), onSelect })}
      />
    );
    const workspace = panel();
    expect(
      workspace.getByText(
        "No files yet. Ask for one, drop a file here, or type /new-file"
      )
    ).toBeTruthy();
    const [newFile] = workspace.getAllByRole("button", { name: "New file" });
    if (!newFile) {
      throw new Error("no New file button");
    }
    await userEvent.click(newFile);
    const dialog = within(
      await screen.findByRole("dialog", { name: "New file" })
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        dialog.getByRole("textbox", { name: "Name" })
      )
    );
    await userEvent.keyboard("a.md{Enter}");
    await waitFor(() =>
      expect(onSelect).toHaveBeenLastCalledWith({ kind: "file", path: "a.md" })
    );
    expect(fake.writes[0]).toEqual({
      content: "",
      ifMatch: null,
      path: "/work/a.md",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("empty: a name that's taken is refused in the dialog", async () => {
    const fake = fakeClient({ "/work/a.md": { content: "", etag: V1 } });
    renderWithI18n(
      <WorkspacePanel {...props({ files: chatFiles(fake.client) })} />
    );
    const [newFile] = panel().getAllByRole("button", { name: "New file" });
    if (!newFile) {
      throw new Error("no New file button");
    }
    await userEvent.click(newFile);
    const dialog = within(
      await screen.findByRole("dialog", { name: "New file" })
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        dialog.getByRole("textbox", { name: "Name" })
      )
    );
    await userEvent.keyboard("a.md{Enter}");
    expect(
      await dialog.findByText("A file with that name already exists.")
    ).toBeTruthy();
  });

  it("new chat: the normal empty state, with nothing to write to yet", () => {
    renderWithI18n(
      <WorkspacePanel {...props({ files: { kind: "new-chat" } })} />
    );
    const workspace = panel();
    expect(
      workspace.getByText(
        "No files yet. Files you and the agent create will appear here."
      )
    ).toBeTruthy();
    expect(workspace.queryByText(TURNED_OFF)).toBeNull();
    for (const button of workspace.getAllByRole("button", {
      name: "New file",
    })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("off: says sandboxes are off on this server", () => {
    renderWithI18n(<WorkspacePanel {...props({ files: { kind: "off" } })} />);
    expect(
      panel().getByText("Sandboxes are turned off on this server.")
    ).toBeTruthy();
  });

  it("failed: an inline Retry, and Reset behind the … menu and a confirmation", async () => {
    const fake = fakeClient();
    const onChanged = vi.fn();
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(
            fake.client,
            { ...ready, status: { message: "runner down", state: "failed" } },
            onChanged
          ),
        })}
      />
    );
    const alert = within(panel().getByRole("alert"));
    expect(alert.getByText("The workspace didn't start")).toBeTruthy();
    expect(alert.getByText("runner down")).toBeTruthy();
    await userEvent.click(alert.getByRole("button", { name: "Retry" }));
    expect(onChanged).toHaveBeenCalled();

    await userEvent.click(
      panel().getByRole("button", { name: "Workspace actions" })
    );
    await press(
      await screen.findByRole("menuitem", { name: "Reset workspace…" })
    );
    expect(fake.client.reset).not.toHaveBeenCalled();
    await press(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(fake.client.reset).toHaveBeenCalledWith(ready.id)
    );
  });
});

describe("reloading as the agent works", () => {
  it("relists and reloads a clean file when the revision moves", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "v1\n", etag: V1 },
    });
    const onChanged = vi.fn();
    const base = props({
      files: chatFiles(fake.client, ready, onChanged),
      selection: { kind: "file", path: "notes.txt" },
    });
    const { rerender } = renderWithI18n(<WorkspacePanel {...base} />);
    await editable();
    const lists = fake.client.listFiles.mock.calls.length;
    fake.agentWrites("/work/notes.txt", "v2 from the agent\n", V3);

    rerender(<WorkspacePanel {...base} revision={1} />);
    await waitFor(() =>
      expect(fake.client.listFiles.mock.calls.length).toBeGreaterThan(lists)
    );
    await waitFor(() => expect(fake.client.readFile).toHaveBeenCalledTimes(2));
    // The workspace record may have changed too (a preview, a restart).
    expect(onChanged).toHaveBeenCalled();
  });

  it("leaves a file with unsaved edits alone", async () => {
    const fake = fakeClient({
      "/work/notes.txt": { content: "v1\n", etag: V1 },
    });
    const base = props({
      files: chatFiles(fake.client),
      selection: { kind: "file", path: "notes.txt" },
    });
    const { rerender } = renderWithI18n(<WorkspacePanel {...base} />);
    const editor = await editable();
    await userEvent.click(editor);
    await userEvent.keyboard("mine ");
    rerender(<WorkspacePanel {...base} revision={1} />);
    // The tree still relists; the file keeps the person's text.
    await waitFor(() => expect(fake.client.listFiles).toHaveBeenCalledTimes(2));
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 200)));
    expect(fake.client.readFile).toHaveBeenCalledTimes(1);
  });
});

describe("the preview", () => {
  const withPreview = (probe: (url: string) => Promise<boolean>) =>
    props({
      files: chatFiles(fakeClient().client, {
        ...ready,
        previews: [{ port: 5173, url: "https://preview.example.test/" }],
      }),
      probePreview: probe,
      selection: { kind: "preview" },
    });

  it("says nothing is running yet, and Retry checks again", async () => {
    const probe = vi.fn(() => Promise.resolve(false));
    renderWithI18n(<WorkspacePanel {...withPreview(probe)} />);
    expect(
      await panel().findByText(
        "Nothing is running on port 5173 yet. Ask the agent to start the app."
      )
    ).toBeTruthy();
    probe.mockResolvedValue(true);
    await userEvent.click(panel().getByRole("button", { name: "Retry" }));
    expect(await panel().findByTitle("Preview of port 5173")).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("the built-in browser (066)", () => {
  const served: SandboxRecord = {
    ...ready,
    previews: [{ port: 5173, url: "https://preview.example.test/" }],
  };
  const address = () =>
    panel().getByRole<HTMLInputElement>("textbox", { name: "Address" });
  const frameSrc = () =>
    panel().getByTitle("Preview of port 5173").getAttribute("src");
  const goTo = async (typed: string) => {
    await userEvent.clear(address());
    await userEvent.type(address(), `${typed}{Enter}`);
  };

  const more = () =>
    panel().getByRole("button", { name: "More browser actions" });

  it("drives a served page: the address bar, back, forward, reload, a new tab and a phone's width", async () => {
    const probe = vi.fn(() => Promise.resolve(true));
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(fakeClient().client, served),
          probePreview: probe,
          selection: { kind: "preview" },
        })}
      />
    );
    const frame = await panel().findByTitle("Preview of port 5173");
    expect(frame.getAttribute("src")).toBe("https://preview.example.test/");
    // D24: the page never shares the app's origin.
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(address().value).toBe("/");
    const back = panel().getByRole("button", { name: "Back" });
    const forward = panel().getByRole("button", { name: "Forward" });
    expect(back).toHaveProperty("disabled", true);

    await goTo("about?tab=2");
    await waitFor(() =>
      expect(frameSrc()).toBe("https://preview.example.test/about?tab=2")
    );
    expect(address().value).toBe("/about?tab=2");
    // The quieter actions are in the toolbar's "…" menu (070).
    await press(more());
    expect(
      (
        await screen.findByRole("menuitem", { name: "Open in a new tab" })
      ).getAttribute("href")
    ).toBe("https://preview.example.test/about?tab=2");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await userEvent.click(back);
    await waitFor(() =>
      expect(frameSrc()).toBe("https://preview.example.test/")
    );
    expect(address().value).toBe("/");
    await userEvent.click(forward);
    await waitFor(() =>
      expect(frameSrc()).toBe("https://preview.example.test/about?tab=2")
    );

    // Somewhere else isn't this preview: refused, the page stays.
    await goTo("https://elsewhere.test/");
    expect(address().getAttribute("aria-invalid")).toBe("true");
    expect(frameSrc()).toBe("https://preview.example.test/about?tab=2");

    const checks = probe.mock.calls.length;
    await userEvent.click(panel().getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(checks + 1));

    const width = () =>
      document.querySelector("[data-width]")?.getAttribute("data-width");
    expect(width()).toBe("desktop");
    await press(more());
    await press(
      await screen.findByRole("menuitemcheckbox", { name: "Mobile width" })
    );
    await waitFor(() => expect(width()).toBe("mobile"));
  });

  it("renders a page itself when nothing can serve it, labelled, with its CSS inlined and links followed", async () => {
    const { client } = fakeClient({
      "/work/about.html": { content: "<h1>About</h1>", etag: V1 },
      "/work/index.html": {
        content:
          '<link rel="stylesheet" href="style.css"><h1>Home</h1><a href="about.html">About</a>',
        etag: V1,
      },
      "/work/style.css": { content: "h1 { color: red }", etag: V1 },
    });
    const base = props({
      files: chatFiles(client, { ...served, provider: "just-bash" }),
      selection: { kind: "preview" },
    });
    const view = renderWithI18n(<WorkspacePanel {...base} />);
    // The browser shows as soon as there's a page.
    expect(
      await panel().findByRole("region", { name: "Browser" })
    ).toBeTruthy();
    const frame = await panel().findByTitle<HTMLIFrameElement>(
      "Static render of index.html"
    );
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("h1 { color: red }");
    expect(srcdoc).toContain("<h1>Home</h1>");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(panel().getByText("Static render")).toBeTruthy();
    await press(more());
    await screen.findByRole("menuitemcheckbox", { name: "Mobile width" });
    expect(
      screen.queryByRole("menuitem", { name: "Open in a new tab" })
    ).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    // A link clicked in the page asks the panel for the page it points to.
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { href: "about.html", type: "workspace-preview-link" },
          source: frame.contentWindow,
        })
      )
    );
    expect(
      await panel().findByTitle("Static render of about.html")
    ).toBeTruthy();
    expect(address().value).toBe("/about.html");

    // The chat asks for a page (an `.html` write, `openPreview`).
    view.rerender(
      <WorkspacePanel
        {...base}
        previewRequest={{ id: 1, page: { path: "/", port: null } }}
      />
    );
    expect(
      await panel().findByTitle("Static render of index.html")
    ).toBeTruthy();
    expect(address().value).toBe("/");
  });

  it("says when a page isn't in the workspace", async () => {
    const { client } = fakeClient({
      "/work/index.html": { content: "<p>home</p>", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(client),
          previewRequest: { id: 1, page: { path: "/gone.html", port: null } },
          selection: { kind: "preview" },
        })}
      />
    );
    expect(
      await panel().findByText("There's no gone.html in the workspace.")
    ).toBeTruthy();
  });
});

describe("rendered files (066)", () => {
  const showAs = (mode: "Preview" | "Code") =>
    within(panel().getByRole("group", { name: "Show as" })).getByRole(
      "button",
      { name: mode }
    );

  it("opens an .html file in the browser at its path, and its code below (097)", async () => {
    const { client } = fakeClient({
      "/work/site/page.html": { content: "<h1>Page</h1>", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(client),
          selection: { kind: "file", path: "site/page.html" },
        })}
      />
    );
    const frame = await panel().findByTitle("Static render of site/page.html");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Page</h1>");
    expect(
      panel().getByRole<HTMLInputElement>("textbox", { name: "Address" }).value
    ).toBe("/site/page.html");

    // Both at once, so no Preview/Code switch.
    expect(await editable()).toBeTruthy();
    expect(panel().getByTitle("Static render of site/page.html")).toBeTruthy();
    expect(panel().queryByRole("group", { name: "Show as" })).toBeNull();
  });

  it("renders Markdown as prose, with a Code toggle to the editor", async () => {
    const { client } = fakeClient({
      "/work/README.md": {
        content: "# Read me\n\nSome *words*.\n",
        etag: V1,
      },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(client),
          selection: { kind: "file", path: "README.md" },
        })}
      />
    );
    expect(
      await panel().findByRole("heading", { name: "Read me" })
    ).toBeTruthy();
    await userEvent.click(showAs("Code"));
    expect(await editable()).toBeTruthy();
    expect(panel().queryByRole("heading", { name: "Read me" })).toBeNull();
  });

  it("opens a new, empty Markdown file as code", async () => {
    const { client } = fakeClient({
      "/work/todo.md": { content: "", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({
          files: chatFiles(client),
          selection: { kind: "file", path: "todo.md" },
        })}
      />
    );
    expect(await editable()).toBeTruthy();
    expect(showAs("Code").getAttribute("aria-pressed")).toBe("true");
  });
});

/** The panel with its selection held, as `ChatScreen` holds it. */
function Selecting({
  initial = null,
  ...rest
}: Omit<WorkspacePanelProps, "onSelect" | "selection"> & {
  readonly initial?: WorkspaceSelection | null;
}) {
  const [selection, setSelection] = useState<WorkspaceSelection | null>(
    initial
  );
  return (
    <WorkspacePanel {...rest} onSelect={setSelection} selection={selection} />
  );
}

/** The focused element, inside shadow roots too (the editor, the tree). */
const focused = () => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
};

describe("the file search (070)", () => {
  const files = {
    "/work/notes.txt": { content: "notes\n", etag: V1 },
    "/work/src/app.ts": { content: "export const app = 1;\n", etag: V1 },
    "/work/src/util.ts": { content: "export const util = 2;\n", etag: V1 },
  };
  const search = () =>
    panel().getByRole<HTMLInputElement>("combobox", { name: "Search files" });
  const options = () =>
    within(panel().getByRole("listbox", { name: "Files found" })).getAllByRole(
      "option"
    );
  /** The path in the main area's header. */
  const shown = () =>
    document
      .querySelector('[data-slot="workspace-header"] span[title]')
      ?.getAttribute("title");

  it("searches by name from '/', previews with ↓/↑ and opens with Enter, into the editor", async () => {
    const { client } = fakeClient(files);
    renderWithI18n(<Selecting {...props({ files: chatFiles(client) })} />);
    await treeItem("notes.txt");

    // "/" from anywhere in the panel that isn't a field.
    panel().getByRole("button", { name: "New file" }).focus();
    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(search());

    await userEvent.keyboard("ts");
    expect(panel().getByText("2 found")).toBeTruthy();
    expect(options().map((option) => option.textContent)).toEqual([
      "app.tssrc/",
      "util.tssrc/",
    ]);
    // The results replace the tree.
    expect(panel().queryByRole("tree")).toBeNull();

    // ↓ previews the first, ↓ the next, and wraps; focus stays in the field.
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(shown()).toBe("src/app.ts"));
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(shown()).toBe("src/util.ts"));
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(search().getAttribute("aria-activedescendant")).toBe(
      options()[1]?.id
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(search());

    // Enter opens it and moves focus into its editor.
    await userEvent.keyboard("{Enter}");
    const editor = await editable();
    await waitFor(() => expect(focused()).toBe(editor));
    expect(shown()).toBe("src/app.ts");
  });

  it("says when nothing matches, and Escape clears back to the tree", async () => {
    const { client } = fakeClient(files);
    renderWithI18n(<Selecting {...props({ files: chatFiles(client) })} />);
    const row = await treeItem("notes.txt");
    await userEvent.click(search());
    await userEvent.keyboard("zzz");
    expect(panel().getByText("Nothing found")).toBeTruthy();
    expect(options).toThrow();

    await userEvent.keyboard("{Escape}");
    expect(search().value).toBe("");
    await waitFor(() =>
      expect(focused()?.getAttribute("role")).toBe("treeitem")
    );
    expect(row()).toBeTruthy();
  });

  it("leads each result with its name, keeps the name's distinguishing end and marks the query (075)", async () => {
    const long = (n: number) =>
      `/work/src/components/very-long-component-file-name-number-${n}.tsx`;
    const { client } = fakeClient({
      ...files,
      [long(1)]: { content: "1\n", etag: V1 },
      [long(7)]: { content: "7\n", etag: V1 },
    });
    renderWithI18n(<Selecting {...props({ files: chatFiles(client) })} />);
    await treeItem("notes.txt");
    await userEvent.click(search());
    await userEvent.keyboard("comp 7");

    const [row] = options();
    expect(options()).toHaveLength(1);
    // The name's line: a head that gives way, then the tail that stays.
    const [name, folder] = Array.from(row?.children ?? []);
    const [head, tail] = Array.from(name?.children ?? []);
    expect(head?.textContent).toBe("very-long-component-file-name-");
    expect(tail?.textContent).toBe("number-7.tsx");
    // The folder, quieter, on the line under it.
    expect(folder?.textContent).toBe("src/components/");
    expect(folder?.className).toContain("text-muted-foreground");
    // Every hit is marked, in the name and in the folder.
    expect(
      Array.from(row?.querySelectorAll("mark") ?? []).map(
        (mark) => mark.textContent
      )
    ).toEqual(["comp", "7", "comp"]);
  });
});

describe("a narrow panel (070)", () => {
  it("shows the list or the file, with a way back to the list", async () => {
    const { client } = fakeClient({
      "/work/notes.txt": { content: "notes\n", etag: V1 },
    });
    renderWithI18n(
      <div style={{ height: 700, width: 340 }}>
        <Selecting
          {...props({ files: chatFiles(client) })}
          initial={{ kind: "file", path: "notes.txt" }}
        />
      </div>
    );
    // The file, full width; the list is out of the way.
    expect(await editable()).toBeTruthy();
    const nav = () =>
      panel().queryByRole("navigation", { name: "Workspace contents" });
    await waitFor(() => expect(nav()).toBeNull());

    const back = () =>
      panel().queryByRole("button", { name: "Back to the list" });
    await userEvent.click(back() as HTMLElement);
    expect(nav()).not.toBeNull();
    // The file is out of the way now (kept, so it keeps its edits).
    expect(back()).toBeNull();

    // The same file opens again from the tree.
    const row = await treeItem("notes.txt");
    await press(row());
    await waitFor(() => expect(nav()).toBeNull());
    expect(back()).not.toBeNull();
  });

  it("keeps the Preview toolbar to one row at 340px: the rest is in its menu", async () => {
    const { client } = fakeClient({
      "/work/site/page.html": { content: "<h1>Page</h1>", etag: V1 },
    });
    renderWithI18n(
      <div style={{ height: 700, width: 340 }}>
        <RightPanel onClose={vi.fn()}>
          <Selecting
            {...props({ files: chatFiles(client) })}
            initial={{ kind: "file", path: "site/page.html" }}
          />
        </RightPanel>
      </div>
    );
    await panel().findByTitle("Static render of site/page.html");
    // (The widths themselves are checked with the real styles, in
    // e2e/tests/workspace-ui.spec.ts, and in model/toolbar.test.ts.)
    // Back, the switch and Close stay; Forward and Reload are in the menu.
    expect(panel().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(panel().getByRole("group", { name: "Show as" })).toBeTruthy();
    expect(panel().getByRole("button", { name: "Close panel" })).toBeTruthy();
    expect(panel().queryByRole("button", { name: "Reload" })).toBeNull();
    expect(panel().queryByRole("button", { name: "Forward" })).toBeNull();
    await press(panel().getByRole("button", { name: "More browser actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "Reload" })
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Forward" })).toBeTruthy();
  });
});

describe("the browser over the files (097)", () => {
  const served: SandboxRecord = {
    ...ready,
    previews: [{ port: 5173, url: "https://preview.example.test/" }],
  };
  const files = {
    "/work/index.html": { content: "<h1>Home</h1>", etag: V1 },
    "/work/notes.txt": { content: "notes\n", etag: V1 },
  };
  const browser = () => panel().queryByRole("region", { name: "Browser" });
  const nav = () =>
    panel().queryByRole("navigation", { name: "Workspace contents" });
  const divider = () =>
    panel().getByRole("separator", { name: "Resize the browser" });
  /** Visible, as `hidden` leaves it in the DOM but off screen. */
  const shown = (element: HTMLElement | null) =>
    element !== null && element.closest("[hidden]") === null;

  afterEach(() => window.localStorage.removeItem(SPLIT_STORAGE_KEY));

  it("shows only the files while there's nothing to preview", async () => {
    const { client } = fakeClient({
      "/work/notes.txt": { content: "notes\n", etag: V1 },
    });
    renderWithI18n(
      <RightPanel onClose={vi.fn()}>
        <Selecting {...props({ files: chatFiles(client) })} />
      </RightPanel>
    );
    await treeItem("notes.txt");
    expect(browser()).toBeNull();
    expect(panel().queryByRole("separator")).toBeNull();
    expect(
      panel().queryByRole("button", { name: "Maximise the files" })
    ).toBeNull();
    expect(
      panel().getAllByRole("button", { name: "Close panel" })
    ).toHaveLength(1);
  });

  it("stacks the browser over the files, with one Close, at the top", async () => {
    const { client } = fakeClient(files);
    renderWithI18n(
      <div style={{ height: 800, width: 900 }}>
        <RightPanel onClose={vi.fn()}>
          <Selecting
            {...props({
              files: chatFiles(client, served),
              probePreview: () => Promise.resolve(true),
            })}
            initial={{ kind: "file", path: "notes.txt" }}
          />
        </RightPanel>
      </div>
    );
    expect(await editable()).toBeTruthy();
    const top = browser();
    expect(shown(top)).toBe(true);
    const toolbar = panel().getByRole("toolbar", { name: "Browser" });
    // Above the list and the open file.
    const below = document.querySelector('[data-slot="workspace-files"]');
    expect(
      toolbar.getBoundingClientRect().bottom <=
        (below?.getBoundingClientRect().top ?? 0)
    ).toBe(true);
    const closes = panel().getAllByRole("button", { name: "Close panel" });
    expect(closes).toHaveLength(1);
    expect(toolbar.contains(closes[0] ?? null)).toBe(true);
    expect(divider().getAttribute("aria-valuenow")).toBe("50");
  });

  it("moves the divider by key, saves it, and double-click puts it back", async () => {
    const { client } = fakeClient(files);
    const view = renderWithI18n(
      <div style={{ height: 800, width: 900 }}>
        <Selecting {...props({ files: chatFiles(client) })} />
      </div>
    );
    await treeItem("notes.txt");
    const handle = divider();
    const top = () => browser()?.getBoundingClientRect().height ?? 0;
    const before = top();
    handle.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(top()).toBeGreaterThan(before + 20));
    const saved = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY));
    expect(saved).toBeGreaterThan(0.5);
    expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(50);

    // A panel opened later starts where it was left.
    view.unmount();
    renderWithI18n(
      <div style={{ height: 800, width: 900 }}>
        <Selecting {...props({ files: chatFiles(client) })} />
      </div>
    );
    await treeItem("notes.txt");
    expect(divider().getAttribute("aria-valuenow")).toBe(
      String(Math.round(saved * 100))
    );

    // The DOM way: Playwright's hit test doesn't reach the 8px strip here.
    act(() => {
      divider().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    await waitFor(() =>
      expect(divider().getAttribute("aria-valuenow")).toBe("50")
    );
    expect(window.localStorage.getItem(SPLIT_STORAGE_KEY)).toBe("0.5");
  });

  it("maximises either half, and a pick brings back the half it shows in", async () => {
    const { client } = fakeClient(files);
    renderWithI18n(
      <div style={{ height: 800, width: 900 }}>
        <Selecting {...props({ files: chatFiles(client) })} />
      </div>
    );
    const row = await treeItem("notes.txt");
    const maxBrowser = panel().getByRole("button", {
      name: "Maximise the browser",
    });
    await userEvent.click(maxBrowser);
    expect(maxBrowser.getAttribute("aria-pressed")).toBe("true");
    expect(shown(nav())).toBe(false);
    expect(panel().queryByRole("separator")).toBeNull();
    await userEvent.click(maxBrowser);
    expect(shown(nav())).toBe(true);

    await userEvent.click(
      panel().getByRole("button", { name: "Maximise the files" })
    );
    expect(shown(browser())).toBe(false);
    // The way to the browser while it's out of view.
    expect(panel().getByRole("button", { name: "Preview" })).toBeTruthy();
    await userEvent.click(
      panel().getByRole("button", { name: "Maximise the files" })
    );
    expect(shown(browser())).toBe(true);

    // Maximised, the browser gives way to a file someone opens.
    await userEvent.click(maxBrowser);
    expect(shown(nav())).toBe(false);
    await press(row());
    await waitFor(() => expect(shown(nav())).toBe(true));
    expect(await editable()).toBeTruthy();
  });

  // 137: the header's Browser and Files.
  it("gives the browser the whole panel for Browser, and Files brings the files back", async () => {
    const { client } = fakeClient(files);
    const base = props({ files: chatFiles(client) });
    const view = renderWithI18n(
      <div style={{ height: 800, width: 900 }}>
        <Selecting {...base} />
      </div>
    );
    await treeItem("notes.txt");
    expect(shown(browser())).toBe(true);
    expect(shown(nav())).toBe(true);
    view.rerender(
      <div style={{ height: 800, width: 900 }}>
        <Selecting
          {...base}
          halfRequest={{ half: "browser", id: 1 }}
          section="browser"
        />
      </div>
    );
    await waitFor(() => expect(shown(nav())).toBe(false));
    expect(shown(browser())).toBe(true);
    expect(
      panel()
        .getByRole("button", { name: "Maximise the browser" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    view.rerender(
      <div style={{ height: 800, width: 900 }}>
        <Selecting
          {...base}
          halfRequest={{ half: "files", id: 2 }}
          section="files"
        />
      </div>
    );
    await waitFor(() => expect(shown(nav())).toBe(true));
    expect(shown(browser())).toBe(true);
  });

  it("shows the browser's empty state on Browser before there's a preview", async () => {
    const { client } = fakeClient({
      "/work/notes.txt": { content: "notes\n", etag: V1 },
    });
    renderWithI18n(
      <div style={{ height: 800, width: 900 }}>
        <Selecting
          {...props({ files: chatFiles(client) })}
          halfRequest={{ half: "browser", id: 1 }}
          section="browser"
        />
      </div>
    );
    expect(await panel().findByText("Nothing running yet")).toBeTruthy();
    expect(shown(browser())).toBe(true);
    expect(shown(nav())).toBe(false);
  });

  it("keeps the open file below when the chat shows the Preview", async () => {
    const { client } = fakeClient(files);
    const base = props({ files: chatFiles(client) });
    const view = renderWithI18n(
      <WorkspacePanel
        {...base}
        selection={{ kind: "file", path: "notes.txt" }}
      />
    );
    expect(await editable()).toBeTruthy();
    view.rerender(<WorkspacePanel {...base} selection={{ kind: "preview" }} />);
    expect(await editable()).toBeTruthy();
    expect(
      document
        .querySelector('[data-slot="workspace-header"] span[title]')
        ?.getAttribute("title")
    ).toBe("notes.txt");
  });

  it("takes turns on a narrow panel: the browser, the list, then the browser again", async () => {
    const { client } = fakeClient(files);
    renderWithI18n(
      <div style={{ height: 700, width: 360 }}>
        <RightPanel onClose={vi.fn()}>
          <Selecting
            {...props({ files: chatFiles(client) })}
            initial={{ kind: "preview" }}
          />
        </RightPanel>
      </div>
    );
    await panel().findByTitle("Static render of index.html");
    await waitFor(() => expect(shown(nav())).toBe(false));
    expect(shown(browser())).toBe(true);
    expect(panel().queryByRole("separator")).toBeNull();
    expect(
      panel().queryByRole("button", { name: "Maximise the browser" })
    ).toBeNull();

    await userEvent.click(
      panel().getByRole("button", { name: "Back to the list" })
    );
    expect(shown(nav())).toBe(true);
    expect(shown(browser())).toBe(false);
    await userEvent.click(panel().getByRole("button", { name: "Preview" }));
    expect(shown(browser())).toBe(true);
    expect(shown(nav())).toBe(false);
  });

  it("keeps the list after Files when the chat's default Preview arrives late", async () => {
    const { client } = fakeClient(files);
    const base = props({ files: chatFiles(client) });
    const narrow = (selection: WorkspaceSelection | null) => (
      <div style={{ height: 700, width: 360 }}>
        <RightPanel onClose={vi.fn()}>
          <WorkspacePanel
            {...base}
            halfRequest={{ half: "files", id: 1 }}
            section="files"
            selection={selection}
          />
        </RightPanel>
      </div>
    );
    const view = renderWithI18n(narrow(null));
    await treeItem("index.html");
    await waitFor(() => expect(shown(nav())).toBe(true));
    // The chat's file listing lands after the press, so its default (the
    // Preview) shows up as a new selection.
    view.rerender(narrow({ kind: "preview" }));
    await panel().findByTitle("Static render of index.html");
    expect(shown(nav())).toBe(true);
    expect(shown(browser())).toBe(false);
  });

  it("switches an HTML file between its page and its code when taking turns", async () => {
    const { client } = fakeClient(files);
    renderWithI18n(
      <div style={{ height: 700, width: 360 }}>
        <Selecting
          {...props({ files: chatFiles(client) })}
          initial={{ kind: "file", path: "index.html" }}
        />
      </div>
    );
    await panel().findByTitle("Static render of index.html");
    const showAs = (mode: "Preview" | "Code") =>
      within(panel().getByRole("group", { name: "Show as" })).getByRole(
        "button",
        { name: mode }
      );
    await userEvent.click(showAs("Code"));
    const editor = await editable();
    await waitFor(() => expect(shown(editor)).toBe(true));
    expect(shown(browser())).toBe(false);
    await userEvent.click(showAs("Preview"));
    await waitFor(() => expect(shown(browser())).toBe(true));
  });
});
