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
      "/work/notes.md": { content: "# Notes\n", etag: V1 },
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
    await userEvent.click(
      workspace.getByRole("button", { name: "Preview · :5173" })
    );
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
  const notes: WorkspaceSelection = { kind: "file", path: "notes.md" };

  it("saves after a pause with the version it read, then with the new one", async () => {
    const fake = fakeClient({
      "/work/notes.md": { content: "hi\n", etag: V1 },
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
      path: "/work/notes.md",
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
      "/work/notes.md": { content: "hi\n", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({ files: chatFiles(fake.client), selection: notes })}
      />
    );
    const editor = await editable();
    fake.agentWrites("/work/notes.md", "the agent's\n", V3);
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
      "/work/notes.md": { content: "hi\n", etag: V1 },
    });
    renderWithI18n(
      <WorkspacePanel
        {...props({ files: chatFiles(fake.client), selection: notes })}
      />
    );
    const editor = await editable();
    fake.agentWrites("/work/notes.md", "the agent's\n", V3);
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
      "/work/notes.md": { content: "hi\n", etag: V1 },
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
      panel().getByRole("button", { name: "Delete notes.md" })
    );
    await press(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(fake.client.deleteFile).toHaveBeenCalledWith("/work/notes.md")
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
      "/work/notes.md": { content: "v1\n", etag: V1 },
    });
    const onChanged = vi.fn();
    const base = props({
      files: chatFiles(fake.client, ready, onChanged),
      selection: { kind: "file", path: "notes.md" },
    });
    const { rerender } = renderWithI18n(<WorkspacePanel {...base} />);
    await editable();
    const lists = fake.client.listFiles.mock.calls.length;
    fake.agentWrites("/work/notes.md", "v2 from the agent\n", V3);

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
      "/work/notes.md": { content: "v1\n", etag: V1 },
    });
    const base = props({
      files: chatFiles(fake.client),
      selection: { kind: "file", path: "notes.md" },
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
