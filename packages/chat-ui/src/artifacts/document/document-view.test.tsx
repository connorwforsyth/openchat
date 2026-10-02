import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { markdownToDocument } from "@workspace/artifacts-kit/kinds/document/markdown";
import { serializeDocument } from "@workspace/artifacts-kit/kinds/document/schema";
import { fixtureId } from "@workspace/contract/fixtures";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import type { ReactNode } from "react";
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
