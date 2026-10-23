import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { markdownToDocument } from "@workspace/artifacts-kit/kinds/document/markdown";
import { serializeDocument } from "@workspace/artifacts-kit/kinds/document/schema";
import { fixtureId } from "@workspace/contract/fixtures";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../../testing/render";
import { DocumentView, type DocumentViewProps } from "./document-view";
import { documentMarkdownFile, exportFileName } from "./export";

// The Document editor (126): the model's document as rich text, a person's
// edit saved as a version after a pause, read only for a viewer and for an
// older version.

afterEach(cleanup);

const conversationId = fixtureId("conversation", 1);
const messageId = fixtureId("message", 1);

const brief: Artifact = {
  conversationId,
  createdAt: "2026-10-02T09:00:00.000Z",
  id: fixtureId("artifact", 1),
  kind: "document",
  latestVersionId: fixtureId("artifactVersion", 2),
  messageId,
  ownerId: fixtureId("user", 1),
  title: "Trip brief",
  updatedAt: "2026-10-02T09:05:00.000Z",
};

const version = (number: number, markdown: string): ArtifactVersion => ({
  artifactId: brief.id,
  content: serializeDocument(markdownToDocument(markdown)),
  conversationId,
  createdAt: `2026-10-02T09:0${number}:00.000Z`,
  editedBy: null,
  id: fixtureId("artifactVersion", number),
  language: null,
  messageId,
  number,
});

const versions = [
  version(1, "## Plan\n\nWalk."),
  version(2, "## Plan\n\nWalk the harbour.\n\n- [ ] Boots"),
];

const header = (content: ReactNode) => (
  <div data-testid="header">{content}</div>
);

const renderView = (props: Partial<DocumentViewProps> = {}) => {
  const onSave = vi.fn<DocumentViewProps["onSave"]>((input) =>
    Promise.resolve({
      ...version(3, "x"),
      content: input.content,
      editedBy: fixtureId("user", 1),
    })
  );
  const onSelect = vi.fn();
  renderWithI18n(
    <div style={{ display: "flex", flexDirection: "column", height: 600 }}>
      <DocumentView
        access="owner"
        artifact={brief}
        authorName="Ada"
        header={header}
        onSave={onSave}
        onSelect={onSelect}
        versions={versions}
        {...props}
      />
    </div>
  );
  return { onSave, onSelect };
};

const HEADING_1 = /^Heading 1/;

const editor = () => screen.findByRole("textbox", { name: "Document" });

describe("DocumentView", () => {
  it("shows the latest version as rich text, with the title, chips and toolbar", async () => {
    renderView();
    const text = await editor();
    expect(within(text).getByRole("heading", { name: "Plan" })).toBeTruthy();
    expect(within(text).getByRole("checkbox")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Trip brief" })
    ).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(
      within(screen.getByTestId("header")).getByText("v2 of 2")
    ).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("saves a person's edit as a new version on top of the latest, after a pause", async () => {
    const { onSave } = renderView();
    const text = await editor();
    await userEvent.click(within(text).getByText("Walk the harbour."));
    await userEvent.keyboard("{End} and the lighthouse");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    const [input] = onSave.mock.calls[0] ?? [];
    expect(input?.baseVersionId).toBe(versions[1]?.id);
    expect(input?.content).toContain("Walk the harbour. and the lighthouse");
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  it("saves what's waiting when it closes before the pause", async () => {
    const { onSave } = renderView();
    const text = await editor();
    await userEvent.click(within(text).getByText("Walk the harbour."));
    await userEvent.keyboard("{End} Bye");
    expect(onSave).not.toHaveBeenCalled();
    cleanup();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0].content).toContain("harbour. Bye");
  });

  it("is read only, without a toolbar, for a viewer", async () => {
    const { onSave } = renderView({ access: "viewer" });
    const text = await editor();
    expect(text.getAttribute("contenteditable")).toBe("false");
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows an older version read only, with Restore", async () => {
    const { onSave, onSelect } = renderView({ versionId: versions[0]?.id });
    const text = await editor();
    expect(text.getAttribute("contenteditable")).toBe("false");
    expect(within(text).getByText("Walk.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        baseVersionId: versions[1]?.id,
        content: versions[0]?.content,
      })
    );
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
  });

  it("says when another version landed first, and keeps the edits", async () => {
    const { onSave } = renderView();
    onSave.mockRejectedValueOnce(
      Object.assign(new Error("conflict"), { code: "CONFLICT" })
    );
    const text = await editor();
    await userEvent.click(within(text).getByText("Walk the harbour."));
    await userEvent.keyboard("{End}!");
    expect(
      await screen.findByText("Changed elsewhere", {}, { timeout: 3000 })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep mine" })).toBeTruthy();
    expect(within(text).getByText("Walk the harbour.!")).toBeTruthy();
  });
});

describe("the / block menu", () => {
  const packing = {
    id: fixtureId("artifact", 2),
    kind: "document" as const,
    title: "Packing list",
  };
  const linkTargets = [
    { id: brief.id, kind: brief.kind, title: brief.title },
    packing,
  ];

  /** A new empty line under the last paragraph, with the caret on it. */
  const newLine = async () => {
    const text = await editor();
    await userEvent.click(within(text).getByText("Walk the harbour."));
    await userEvent.keyboard("{End}{Enter}");
    return text;
  };

  it("opens a listbox of blocks when `/` starts a line", async () => {
    renderView();
    await newLine();
    await userEvent.keyboard("/");
    const menu = await screen.findByRole("listbox", { name: "Insert block" });
    expect(within(menu).getByRole("option", { name: HEADING_1 })).toBeTruthy();
    expect(
      within(menu).queryByRole("option", { name: "Link to artifact" })
    ).toBeNull();
  });

  it("turns the line into a heading with `/head` and Enter", async () => {
    renderView();
    const text = await newLine();
    await userEvent.keyboard("/head");
    await screen.findByRole("listbox", { name: "Insert block" });
    await userEvent.keyboard("{Enter}Gear");
    expect(
      await within(text).findByRole("heading", { level: 1, name: "Gear" })
    ).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(text.textContent).not.toContain("/head");
  });

  it("links to another artifact through `/link`", async () => {
    renderView({ linkTargets });
    const text = await newLine();
    await userEvent.keyboard("/link");
    await screen.findByRole("listbox", { name: "Insert block" });
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("listbox", {
      name: "Link to artifact",
    });
    expect(
      within(menu).getByRole("option", { name: "Packing list" })
    ).toBeTruthy();
    expect(
      within(menu).queryByRole("option", { name: "Trip brief" })
    ).toBeNull();
    await userEvent.keyboard("{Enter}");
    const link = await within(text).findByRole("link", {
      name: "Packing list",
    });
    expect(link.getAttribute("href")).toBe(`/artifacts/${packing.id}`);
    expect(text.textContent).not.toContain("/link");
  });

  it("searches `/link` by a title of several words", async () => {
    const notes = {
      ...packing,
      id: fixtureId("artifact", 3),
      title: "Packing notes",
    };
    renderView({ linkTargets: [...linkTargets, notes] });
    const text = await newLine();
    await userEvent.keyboard("/link");
    await screen.findByRole("listbox", { name: "Insert block" });
    await userEvent.keyboard("{Enter}packing l");
    const menu = await screen.findByRole("listbox", {
      name: "Link to artifact",
    });
    await waitFor(() =>
      expect(
        within(menu).queryByRole("option", { name: "Packing notes" })
      ).toBeNull()
    );
    await userEvent.keyboard("{Enter}");
    const link = await within(text).findByRole("link", {
      name: "Packing list",
    });
    expect(link.getAttribute("href")).toBe(`/artifacts/${packing.id}`);
  });

  it("stays shut inside a code block", async () => {
    renderView({ versions: [version(1, "Intro\n\n```\nlet x = 1\n```")] });
    const text = await editor();
    await userEvent.click(within(text).getByText("let x = 1"));
    await userEvent.keyboard("{End} /");
    await waitFor(() => expect(text.textContent).toContain("let x = 1 /"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the image dialog when another version replaces the document", async () => {
    let replace: (next: readonly ArtifactVersion[]) => void = () => undefined;
    const onSave = vi.fn<DocumentViewProps["onSave"]>((input) =>
      Promise.resolve({ ...version(3, "x"), content: input.content })
    );
    function Scenario() {
      const [current, setCurrent] =
        useState<readonly ArtifactVersion[]>(versions);
      replace = (next) => {
        setCurrent(next);
      };
      return (
        <DocumentView
          access="owner"
          artifact={brief}
          header={header}
          onSave={onSave}
          onSelect={vi.fn()}
          versions={current}
        />
      );
    }
    renderWithI18n(<Scenario />);
    const text = await newLine();
    await userEvent.keyboard("/image");
    await screen.findByRole("listbox", { name: "Insert block" });
    await userEvent.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Insert image" })
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy(), {
      timeout: 3000,
    });
    const saved = onSave.mock.calls.length;
    act(() => replace([...versions, version(4, "A replacement document.")]));
    await waitFor(() =>
      expect(text.textContent).toBe("A replacement document.")
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSave).toHaveBeenCalledTimes(saved);
    expect(text.querySelector("img")).toBeNull();
  });

  it("inserts an image by its address, refusing an unsafe one", async () => {
    renderView();
    const text = await newLine();
    await userEvent.keyboard("/image");
    await screen.findByRole("listbox", { name: "Insert block" });
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Insert image" });
    const address = within(dialog).getByLabelText("Image address");
    // Submitted from the keyboard: tests load no CSS, so Base UI's
    // full-page inert layer sits over the unstyled dialog's buttons.
    await userEvent.type(address, "javascript:alert(1){Enter}");
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(text.querySelector("img")).toBeNull();
    await userEvent.fill(address, "https://example.com/harbour.png");
    await userEvent.keyboard("{Tab}The harbour{Enter}");
    const image = await within(text).findByRole("img", { name: "The harbour" });
    expect(image.getAttribute("src")).toBe("https://example.com/harbour.png");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(text.textContent).not.toContain("/image");
  });
});

describe("exports", () => {
  it("names files from the title and puts the title on top of the Markdown", () => {
    expect(exportFileName("Trip brief", "docx")).toBe("Trip-brief.docx");
    const document = markdownToDocument("## Plan\n\nWalk.");
    expect(documentMarkdownFile(document, "Trip brief")).toBe(
      "# Trip brief\n\n## Plan\n\nWalk.\n"
    );
    const titled = markdownToDocument("# Trip brief\n\nWalk.");
    expect(documentMarkdownFile(titled, "Trip brief")).toBe(
      "# Trip brief\n\nWalk.\n"
    );
  });
});
