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
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { chatArtifacts } from "../fixtures";
import type { WorkspaceSelection } from "../model/workspace";
import type {
  WorkspaceClient,
  WorkspaceFilesSource,
  WorkspaceWriteError,
} from "./model/client";
import { SAVE_IDLE_MS } from "./model/editor";
import { WorkspacePanel, type WorkspacePanelProps } from "./workspace-panel";

// The Workspace panel (060) over a fake `WorkspaceClient`: the list and
// what selecting shows, the editor saving with the version it read and the
// conflict when the agent got there first, the empty, new-chat, off and
// failed states, reloading as the agent's tools settle, and the preview.

const TURNED_OFF = /turned off/;
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
        path,
      }: {
        content: string;
        ifMatch?: string | null;
        path: string;
      }) => {
        writes.push({ content, ifMatch, path });
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
  it("lists the preview, the files and the artifacts, and selects them", async () => {
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
    await userEvent.click(workspace.getByRole("button", { name: "Preview" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "preview" });
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
    await userEvent.click(editor);
    await userEvent.keyboard("A");
    await waitFor(() => expect(fake.writes).toHaveLength(1), {
      timeout: SAVE_IDLE_MS + 4000,
    });
    expect(fake.writes[0]).toMatchObject({
      ifMatch: V1,
      path: "/work/notes.txt",
    });
    expect(fake.writes[0]?.content).toContain("A");
    await waitFor(() => expect(panel().getByText("Saved")).toBeTruthy());
    expect(onChanged).toHaveBeenCalled();

    // ⌘S saves at once, over the version the last save made.
    await userEvent.click(editor);
    await userEvent.keyboard("B");
    await userEvent.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(fake.writes).toHaveLength(2));
    expect(fake.writes[1]?.ifMatch).toBe(V2);
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
    expect(
      panel()
        .getByRole("link", { name: "Open in a new tab" })
        .getAttribute("href")
    ).toBe("https://preview.example.test/about?tab=2");

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
    await userEvent.click(
      panel().getByRole("button", { name: "Mobile width" })
    );
    expect(width()).toBe("mobile");
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
    // The list offers the Preview as soon as there's a page.
    expect(
      await panel().findByRole("button", { name: "Preview" })
    ).toBeTruthy();
    const frame = await panel().findByTitle<HTMLIFrameElement>(
      "Static render of index.html"
    );
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("h1 { color: red }");
    expect(srcdoc).toContain("<h1>Home</h1>");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(panel().getByText("Static render")).toBeTruthy();
    expect(
      panel().queryByRole("link", { name: "Open in a new tab" })
    ).toBeNull();

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

  it("opens an .html file in the browser at its path, with a Code toggle", async () => {
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

    await userEvent.click(showAs("Code"));
    expect(await editable()).toBeTruthy();
    expect(panel().queryByTitle("Static render of site/page.html")).toBeNull();
    await userEvent.click(showAs("Preview"));
    expect(
      await panel().findByTitle("Static render of site/page.html")
    ).toBeTruthy();
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
