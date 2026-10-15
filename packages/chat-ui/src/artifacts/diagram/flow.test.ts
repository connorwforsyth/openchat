import { checkArtifact } from "@workspace/artifacts-kit/define";
import { diagramKind } from "@workspace/artifacts-kit/kinds/diagram/kind";
import {
  type Diagram,
  serializeDiagram,
} from "@workspace/artifacts-kit/kinds/diagram/schema";
import { describe, expect, it } from "vitest";
import { diagramFileName } from "./export";
import {
  addNode,
  connectNodes,
  deleteParts,
  diagramToFlow,
  edgeId,
  GROUP_PREFIX,
  handleSides,
  moveNodes,
  relabelNode,
} from "./flow";

// The canvas's model (165): what it draws, and each edit a person makes as
// a new diagram that still passes the kind's checks.

const FLOW: Diagram = {
  direction: "LR",
  edges: [
    { from: "a", to: "b" },
    { from: "b", label: "yes", to: "c" },
  ],
  nodes: [
    { id: "a", label: "Start", shape: "stadium" },
    { group: "Team", id: "b", label: "Review", shape: "diamond" },
    { group: "Team", id: "c", label: "Ship", shape: "rect" },
  ],
};

const problemsOf = (diagram: Diagram) =>
  checkArtifact(diagramKind, serializeDiagram(diagram));

describe("the diagram canvas's model", () => {
  it("draws groups behind their nodes and names edges by place", () => {
    const { edges, nodes } = diagramToFlow(FLOW);
    expect(nodes.map((node) => node.id)).toEqual([
      `${GROUP_PREFIX}Team`,
      "a",
      "b",
      "c",
    ]);
    expect(nodes[0]).toMatchObject({ draggable: false, type: "group" });
    expect(edges).toEqual([
      { id: edgeId(0), source: "a", target: "b" },
      { id: edgeId(1), label: "yes", source: "b", target: "c" },
    ]);
  });

  it("puts handles along the flow", () => {
    expect(handleSides("LR")).toEqual({ source: "right", target: "left" });
    expect(handleSides("TB")).toEqual({ source: "bottom", target: "top" });
  });

  it("keeps a dropped node where it was dropped, rounded", () => {
    const moved = moveNodes(FLOW, [
      { id: "a", position: { x: 10.4, y: 99.6 } },
      { id: `${GROUP_PREFIX}Team`, position: { x: 0, y: 0 } },
    ]);
    expect(moved.positions).toEqual({ a: { x: 10, y: 100 } });
    const drawn = diagramToFlow(moved).nodes.find((node) => node.id === "a");
    expect(drawn?.position).toEqual({ x: 10, y: 100 });
    expect(problemsOf(moved)).toEqual([]);
    expect(moveNodes(FLOW, [])).toBe(FLOW);
  });

  it("renames, connects, deletes and adds", () => {
    expect(relabelNode(FLOW, "a", "  Begin ").nodes[0]?.label).toBe("Begin");
    expect(relabelNode(FLOW, "a", "   ")).toBe(FLOW);
    expect(connectNodes(FLOW, "c", "a").edges).toHaveLength(3);
    expect(connectNodes(FLOW, "a", "b")).toBe(FLOW);
    const cut = deleteParts(FLOW, ["b"], []);
    expect(cut.nodes.map((node) => node.id)).toEqual(["a", "c"]);
    expect(cut.edges).toEqual([]);
    expect(deleteParts(FLOW, [], [edgeId(0)]).edges).toEqual([
      { from: "b", label: "yes", to: "c" },
    ]);
    const added = addNode(FLOW, "New step", "c");
    expect(added.id).toBe("n4");
    expect(added.diagram.edges.at(-1)).toEqual({ from: "c", to: "n4" });
    expect(problemsOf(cut)).toEqual([]);
    expect(problemsOf(added.diagram)).toEqual([]);
  });

  it("names exports after the artifact", () => {
    expect(diagramFileName("Release flow", "png")).toBe("Release-flow.png");
    expect(diagramFileName("Release flow", "mmd")).toBe("Release-flow.mmd");
  });
});
