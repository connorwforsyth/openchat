import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  type Diagram,
  serializeDiagram,
} from "@workspace/artifacts-kit/kinds/diagram/schema";
import { fixtureId } from "@workspace/contract/fixtures";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../../testing/render";
import { DiagramView, type DiagramViewProps } from "./diagram-view";

// The diagram canvas (165): the model's graph drawn and laid out, a
// person's edit saved as a version after a pause, and read only for a
// viewer and for an older version. The tests run without the app's
// stylesheet, so pointer events on the canvas are dispatched to the node
// itself rather than aimed at where it would be drawn.

afterEach(cleanup);

const conversationId = fixtureId("conversation", 1);
const messageId = fixtureId("message", 1);

const flow: Artifact = {
  conversationId,
  createdAt: "2026-10-16T09:00:00.000Z",
  id: fixtureId("artifact", 1),
  kind: "diagram",
  latestVersionId: fixtureId("artifactVersion", 2),
  messageId,
  ownerId: fixtureId("user", 1),
  title: "Release flow",
  updatedAt: "2026-10-16T09:05:00.000Z",
};

const GRAPH: Diagram = {
  direction: "TB",
  edges: [{ from: "build", label: "green", to: "ship" }],
  nodes: [
    { id: "build", label: "Build", shape: "rounded" },
    { id: "ship", label: "Ship it", shape: "diamond" },
  ],
};

const version = (number: number, diagram: Diagram): ArtifactVersion => ({
  artifactId: flow.id,
  content: serializeDiagram(diagram),
  conversationId,
  createdAt: `2026-10-16T09:0${number}:00.000Z`,
  editedBy: null,
  id: fixtureId("artifactVersion", number),
  language: null,
  messageId,
  number,
});

const versions = [
  version(1, { ...GRAPH, edges: [], nodes: GRAPH.nodes.slice(0, 1) }),
  version(2, GRAPH),
];

const header = (content: ReactNode) => (
  <div data-testid="header">{content}</div>
);

const renderView = (props: Partial<DiagramViewProps> = {}) => {
  const onSave = vi.fn<DiagramViewProps["onSave"]>((input) =>
    Promise.resolve({
      ...version(3, GRAPH),
      content: input.content,
      editedBy: fixtureId("user", 1),
    })
  );
  const onSelect = vi.fn();
  renderWithI18n(
    <div style={{ display: "flex", flexDirection: "column", height: 600 }}>
      <DiagramView
        access="owner"
        artifact={flow}
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

const nodeOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-diagram-node="${id}"]`);

const savedDiagram = (onSave: ReturnType<typeof renderView>["onSave"]) =>
  JSON.parse(onSave.mock.calls.at(-1)?.[0].content ?? "{}") as Diagram;

describe("DiagramView", () => {
  it("draws the latest graph, laid out, with its shapes and edge labels", async () => {
    renderView();
    await waitFor(() => expect(nodeOf("ship")).not.toBeNull());
    expect(screen.getByText("Build")).toBeTruthy();
    expect(nodeOf("ship")?.dataset.shape).toBe("diamond");
    expect(screen.getByText("green")).toBeTruthy();
    expect(
      document
        .querySelector("[data-save-state]")
        ?.getAttribute("data-save-state")
    ).toBe("saved");
    // Laid out top to bottom: the second node sits under the first.
    const build = nodeOf("build")?.getBoundingClientRect();
    const ship = nodeOf("ship")?.getBoundingClientRect();
    expect((build?.top ?? 0) < (ship?.top ?? 0)).toBe(true);
  });

  it("saves a renamed node as a version on top of the latest", async () => {
    const { onSave } = renderView();
    await waitFor(() => expect(nodeOf("build")).not.toBeNull());
    fireEvent.doubleClick(screen.getByText("Build"));
    const input = await screen.findByRole("textbox", { name: "Node label" });
    await userEvent.fill(input, "Compile");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 5000 });
    expect(onSave.mock.calls[0]?.[0].baseVersionId).toBe(versions[1]?.id);
    expect(savedDiagram(onSave).nodes[0]?.label).toBe("Compile");
  });

  it("adds a node, and deletes the selected one from the keyboard", async () => {
    const { onSave } = renderView();
    await waitFor(() => expect(nodeOf("ship")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add node" }));
    await waitFor(() => expect(nodeOf("n3")).not.toBeNull());
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 5000 });
    expect(savedDiagram(onSave).nodes.map((node) => node.id)).toEqual([
      "build",
      "ship",
      "n3",
    ]);

    fireEvent.click(screen.getByText("Ship it"));
    await userEvent.keyboard("{Delete}");
    await waitFor(() => expect(nodeOf("ship")).toBeNull());
    await waitFor(
      () =>
        expect(savedDiagram(onSave).nodes.map((node) => node.id)).toEqual([
          "build",
          "n3",
        ]),
      { timeout: 5000 }
    );
    expect(savedDiagram(onSave).edges).toEqual([]);
  });

  it("is read only for a viewer", async () => {
    const { onSave } = renderView({ access: "viewer" });
    await waitFor(() => expect(nodeOf("build")).not.toBeNull());
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add node" })).toBeNull();
    fireEvent.doubleClick(screen.getByText("Build"));
    expect(screen.queryByRole("textbox", { name: "Node label" })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens an older version read only, with Restore", async () => {
    const { onSave, onSelect } = renderView({ versionId: versions[0]?.id });
    await waitFor(() => expect(nodeOf("build")).not.toBeNull());
    expect(nodeOf("ship")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0].content).toBe(versions[0]?.content);
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
  });

  it("offers SVG, PNG and Mermaid exports", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      await screen.findByRole("menuitem", { name: "SVG image (.svg)" })
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "PNG image (.png)" })
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Mermaid (.mmd)" })
    ).toBeTruthy();
  });
});
