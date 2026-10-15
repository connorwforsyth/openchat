import { describe, expect, it } from "vitest";

import { builtinArtifactKinds } from "../../builtin";
import {
  applyArtifactOperation,
  checkArtifact,
  modelViewOf,
  storedFromModel,
} from "../../define";
import { diagramKind } from "./kind";
import { layoutDiagram, nodeSize } from "./layout";
import { diagramToMermaid } from "./mermaid";
import { diagramFromModel } from "./model-text";
import {
  DIAGRAM_MAX_EDGES,
  DIAGRAM_MAX_NODES,
  type Diagram,
  serializeDiagram,
} from "./schema";

const FLOW: Diagram = {
  direction: "LR",
  edges: [
    { from: "start", to: "ok" },
    { from: "ok", label: "yes", to: "done" },
  ],
  nodes: [
    { id: "start", label: "Start", shape: "stadium" },
    { id: "ok", label: "Approved?", shape: "diamond" },
    { group: "Finish", id: "done", label: "Ship it", shape: "rect" },
  ],
};

const stored = serializeDiagram(FLOW);

const edit = (name: string, input: unknown, from: string | null = stored) =>
  applyArtifactOperation(diagramKind, from, name, input);

const editedDiagram = (name: string, input: unknown, from?: string | null) => {
  const result = edit(name, input, from);
  if (!result.ok) {
    throw new Error(result.error.join("; "));
  }
  return JSON.parse(result.value) as Diagram;
};

describe("the diagram kind", () => {
  it("is registered, offered as a starter and drawn by the canvas", () => {
    expect(builtinArtifactKinds.get("diagram")).toBe(diagramKind);
    expect(diagramKind.starter).toEqual({});
    expect(diagramKind.editor).toBe("canvas");
    expect(diagramKind.render).toEqual({ panel: "diagram", runtime: null });
    expect(diagramKind.export.map((each) => each.extension)).toEqual([
      "svg",
      "png",
      "mmd",
    ]);
  });

  it("stores what the model writes as JSON, with defaults filled in", () => {
    const text = storedFromModel(
      diagramKind,
      '{"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"from":"a","to":"b"}]}'
    );
    expect(JSON.parse(text)).toEqual({
      direction: "TB",
      edges: [{ from: "a", to: "b" }],
      nodes: [
        { id: "a", label: "A", shape: "rect" },
        { id: "b", label: "B", shape: "rect" },
      ],
    });
    expect(checkArtifact(diagramKind, text)).toEqual([]);
  });

  it("reads a fenced or slightly wrong graph forgivingly", () => {
    expect(
      diagramFromModel(
        '```json\n{"direction":"sideways","nodes":[{"id":"a","label":"A","shape":"hexagon"},{"label":"no id"}]}\n```'
      )
    ).toEqual({
      direction: "TB",
      edges: [],
      nodes: [{ id: "a", label: "A", shape: "rect" }],
    });
  });

  it("refuses text that isn't a graph, with an example of one", () => {
    const [problem] = checkArtifact(
      diagramKind,
      storedFromModel(diagramKind, "flowchart LR\n  a --> b")
    );
    expect(problem).toContain("a diagram needs at least one node");
    expect(checkArtifact(diagramKind, "not json")).toEqual([
      "content isn't a diagram's JSON",
    ]);
  });

  it("checks ids are unique, edges land on nodes, and the caps", () => {
    const bad: Diagram = {
      ...FLOW,
      edges: [...FLOW.edges, { from: "ok", to: "ghost" }],
      nodes: [...FLOW.nodes, { id: "ok", label: "Again", shape: "rect" }],
    };
    expect(checkArtifact(diagramKind, serializeDiagram(bad))).toEqual([
      'the node id "ok" is used more than once',
      'the edge ok -> ghost names "ghost", which isn\'t a node',
    ]);
    const many: Diagram = {
      direction: "TB",
      edges: Array.from({ length: DIAGRAM_MAX_EDGES + 1 }, () => ({
        from: "n0",
        to: "n1",
      })),
      nodes: Array.from({ length: DIAGRAM_MAX_NODES + 1 }, (_, index) => ({
        id: `n${index}`,
        label: `N${index}`,
        shape: "rect" as const,
      })),
    };
    expect(checkArtifact(diagramKind, serializeDiagram(many))).toEqual([
      `a diagram has at most ${DIAGRAM_MAX_NODES} nodes; this one has ${DIAGRAM_MAX_NODES + 1}`,
      `a diagram has at most ${DIAGRAM_MAX_EDGES} edges; this one has ${DIAGRAM_MAX_EDGES + 1}`,
    ]);
  });

  it("shows the model the graph compactly, without positions", () => {
    const moved = serializeDiagram({
      ...FLOW,
      positions: { start: { x: 10, y: 20 } },
    });
    const view = modelViewOf(diagramKind, moved);
    expect(view).toBe(
      [
        '{"direction":"LR","nodes":[',
        '{"id":"start","label":"Start","shape":"stadium"},',
        '{"id":"ok","label":"Approved?","shape":"diamond"},',
        '{"group":"Finish","id":"done","label":"Ship it"}',
        '],"edges":[',
        '{"from":"start","to":"ok"},',
        '{"from":"ok","label":"yes","to":"done"}',
        "]}",
      ].join("\n")
    );
    // What it reads, it can write back.
    expect(diagramFromModel(view)).toEqual(FLOW);
  });
});

describe("diagram edits", () => {
  it("add nodes and the edges that hang them on", () => {
    const next = editedDiagram("add_nodes", {
      edges: [{ from: "done", to: "party" }],
      nodes: [{ id: "party", label: "Celebrate" }],
    });
    expect(next.nodes.at(-1)).toEqual({
      id: "party",
      label: "Celebrate",
      shape: "rect",
    });
    expect(next.edges.at(-1)).toEqual({ from: "done", to: "party" });
  });

  it("refuse a taken id or an edge to nowhere", () => {
    expect(
      edit("add_nodes", {
        edges: [{ from: "start", to: "nowhere" }],
        nodes: [{ id: "ok", label: "Dup" }],
      })
    ).toEqual({
      error: [
        'the node id "ok" is taken: use update_node to change it, or another id',
        'there\'s no node "nowhere". Its node ids: start, ok, done',
      ],
      ok: false,
    });
    expect(edit("connect", { edges: [{ from: "x", to: "ok" }] })).toEqual({
      error: ['there\'s no node "x". Its node ids: start, ok, done'],
      ok: false,
    });
  });

  it("connect, update and remove", () => {
    expect(
      editedDiagram("connect", { edges: [{ from: "done", to: "start" }] }).edges
    ).toHaveLength(3);
    expect(
      editedDiagram("update_node", { id: "ok", label: "Fine?" }).nodes[1]
    ).toEqual({ id: "ok", label: "Fine?", shape: "diamond" });
    expect(edit("update_node", { id: "ok" })).toEqual({
      error: ["update_node needs a label, shape or group to change"],
      ok: false,
    });
    const moved = serializeDiagram({
      ...FLOW,
      positions: { done: { x: 1, y: 2 }, ok: { x: 3, y: 4 } },
    });
    const removed = editedDiagram("remove", { ids: ["ok"] }, moved);
    expect(removed.nodes.map((node) => node.id)).toEqual(["start", "done"]);
    expect(removed.edges).toEqual([]);
    expect(removed.positions).toEqual({ done: { x: 1, y: 2 } });
    expect(
      editedDiagram("remove", { edges: [{ from: "start", to: "ok" }] }).edges
    ).toEqual([{ from: "ok", label: "yes", to: "done" }]);
    expect(edit("remove", {})).toEqual({
      error: ["remove needs ids (nodes) or edges to remove"],
      ok: false,
    });
  });

  it("replace the graph and keep the places of the nodes it keeps", () => {
    const moved = serializeDiagram({
      ...FLOW,
      positions: { done: { x: 1, y: 2 }, start: { x: 5, y: 6 } },
    });
    const next = editedDiagram(
      "replace",
      {
        content:
          '{"nodes":[{"id":"start","label":"Begin"},{"id":"end","label":"End"}],"edges":[{"from":"start","to":"end"}]}',
      },
      moved
    );
    expect(next.positions).toEqual({ start: { x: 5, y: 6 } });
    expect(next.nodes.map((node) => node.label)).toEqual(["Begin", "End"]);
  });
});

describe("diagram layout", () => {
  it("is the same for the same graph", () => {
    expect(layoutDiagram(FLOW)).toEqual(layoutDiagram(FLOW));
  });

  it("flows the way the diagram says, and keeps dragged nodes put", () => {
    const across = layoutDiagram(FLOW);
    const [start, ok, done] = across.nodes;
    expect(start && ok && done).toBeTruthy();
    expect((start?.x ?? 0) < (ok?.x ?? 0)).toBe(true);
    expect((ok?.x ?? 0) < (done?.x ?? 0)).toBe(true);
    const down = layoutDiagram({ ...FLOW, direction: "TB" });
    expect((down.nodes[0]?.y ?? 0) < (down.nodes[2]?.y ?? 0)).toBe(true);
    const moved = layoutDiagram({
      ...FLOW,
      positions: { ok: { x: 900, y: 700 } },
    });
    expect(moved.nodes[1]).toMatchObject({ x: 900, y: 700 });
    expect(moved.width).toBeGreaterThan(900);
  });

  it("boxes each group around its nodes", () => {
    const { groups, nodes } = layoutDiagram(FLOW);
    const [, , done] = nodes;
    const [group] = groups;
    expect(group?.name).toBe("Finish");
    expect((group?.x ?? 0) < (done?.x ?? 0)).toBe(true);
    expect(
      (group?.x ?? 0) + (group?.width ?? 0) >
        (done?.x ?? 0) + (done?.width ?? 0)
    ).toBe(true);
  });

  it("sizes nodes by their label and shape", () => {
    expect(nodeSize({ label: "A", shape: "rect" }).width).toBe(96);
    const circle = nodeSize({ label: "A", shape: "circle" });
    expect(circle.width).toBe(circle.height);
    expect(nodeSize({ label: "x".repeat(200), shape: "rect" }).width).toBe(240);
  });
});

describe("diagram as Mermaid", () => {
  it("is a flowchart with shapes, groups and edge labels", () => {
    expect(
      diagramToMermaid({
        ...FLOW,
        nodes: [
          ...FLOW.nodes,
          { id: "q", label: 'Say "hi" <now>', shape: "circle" },
        ],
      })
    ).toBe(
      [
        "flowchart LR",
        '  start(["Start"])',
        '  ok{"Approved?"}',
        '  q(("Say #quot;hi#quot; #lt;now#gt;"))',
        '  subgraph group0["Finish"]',
        '    done["Ship it"]',
        "  end",
        "  start --> ok",
        '  ok -->|"yes"| done',
        "",
      ].join("\n")
    );
  });
});
