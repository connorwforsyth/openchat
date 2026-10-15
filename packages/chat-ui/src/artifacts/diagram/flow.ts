import { layoutDiagram } from "@workspace/artifacts-kit/kinds/diagram/layout";
import {
  addNodes,
  connect,
  removeParts,
  updateNode,
} from "@workspace/artifacts-kit/kinds/diagram/operations";
import type {
  Diagram,
  DiagramDirection,
  DiagramPoint,
  DiagramShape,
} from "@workspace/artifacts-kit/kinds/diagram/schema";

// The diagram canvas's model (165), pure: a diagram as React Flow's nodes
// and edges (laid out by the kit, groups as boxes behind their nodes), and
// a person's edits as new diagrams, through the same operations the model
// uses, so a person's version passes the same checks.

export interface ShapeNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly shape: DiagramShape;
}

export interface GroupNodeData extends Record<string, unknown> {
  readonly label: string;
}

export interface FlowNode<TType extends string, TData> {
  readonly data: TData;
  readonly deletable?: boolean;
  readonly draggable?: boolean;
  readonly height: number;
  readonly id: string;
  readonly position: DiagramPoint;
  readonly selectable?: boolean;
  readonly type: TType;
  readonly width: number;
  readonly zIndex?: number;
}

export type DiagramFlowNode =
  | FlowNode<"group", GroupNodeData>
  | FlowNode<"shape", ShapeNodeData>;

export interface DiagramFlowEdge {
  readonly id: string;
  readonly label?: string;
  readonly source: string;
  readonly target: string;
}

/** A group's box has an id no node can have (ids are `[A-Za-z0-9_-]`). */
export const GROUP_PREFIX = "group:";

/** Edges are named by their place in the diagram's list. */
export const edgeId = (index: number): string => `edge:${index}`;

/** The diagram as the canvas draws it, laid out. Pure. */
export const diagramToFlow = (
  diagram: Diagram
): {
  readonly edges: readonly DiagramFlowEdge[];
  readonly nodes: readonly DiagramFlowNode[];
} => {
  const layout = layoutDiagram(diagram);
  const boxes = new Map(layout.nodes.map((box) => [box.id, box] as const));
  const groups = layout.groups.map(
    (group): DiagramFlowNode => ({
      data: { label: group.name },
      deletable: false,
      draggable: false,
      height: group.height,
      id: `${GROUP_PREFIX}${group.name}`,
      position: { x: group.x, y: group.y },
      selectable: false,
      type: "group",
      width: group.width,
      zIndex: -1,
    })
  );
  const nodes = diagram.nodes.map((node): DiagramFlowNode => {
    const box = boxes.get(node.id);
    return {
      data: { label: node.label, shape: node.shape },
      height: box?.height ?? 0,
      id: node.id,
      position: { x: box?.x ?? 0, y: box?.y ?? 0 },
      type: "shape",
      width: box?.width ?? 0,
    };
  });
  const edges = diagram.edges.map(
    (edge, index): DiagramFlowEdge => ({
      id: edgeId(index),
      ...(edge.label ? { label: edge.label } : {}),
      source: edge.from,
      target: edge.to,
    })
  );
  return { edges, nodes: [...groups, ...nodes] };
};

/** Where handles sit for a direction: edges leave and arrive along it. */
export const handleSides = (
  direction: DiagramDirection
): { readonly source: Side; readonly target: Side } => {
  switch (direction) {
    case "TB":
      return { source: "bottom", target: "top" };
    case "BT":
      return { source: "top", target: "bottom" };
    case "LR":
      return { source: "right", target: "left" };
    case "RL":
      return { source: "left", target: "right" };
    default:
      return direction satisfies never;
  }
};
export type Side = "bottom" | "left" | "right" | "top";

/** Nodes put where a person dropped them. Pure. */
export const moveNodes = (
  diagram: Diagram,
  moved: readonly { readonly id: string; readonly position: DiagramPoint }[]
): Diagram => {
  const ids = new Set(diagram.nodes.map((node) => node.id));
  const placed = moved.filter((each) => ids.has(each.id));
  if (placed.length === 0) {
    return diagram;
  }
  return {
    ...diagram,
    positions: {
      ...diagram.positions,
      ...Object.fromEntries(
        placed.map((each) => [
          each.id,
          { x: Math.round(each.position.x), y: Math.round(each.position.y) },
        ])
      ),
    },
  };
};

/** A node's new label; the same diagram when it's blank or unchanged. Pure. */
export const relabelNode = (
  diagram: Diagram,
  id: string,
  label: string
): Diagram => {
  const trimmed = label.trim().slice(0, 200);
  const node = diagram.nodes.find((each) => each.id === id);
  if (!node || trimmed === "" || trimmed === node.label) {
    return diagram;
  }
  return updateNode.apply(diagram, { id, label: trimmed });
};

/** An edge between two nodes, unless there's one already. Pure. */
export const connectNodes = (
  diagram: Diagram,
  from: string,
  to: string
): Diagram => {
  const ids = new Set(diagram.nodes.map((node) => node.id));
  const exists = diagram.edges.some(
    (edge) => edge.from === from && edge.to === to
  );
  return exists || !ids.has(from) || !ids.has(to)
    ? diagram
    : connect.apply(diagram, { edges: [{ from, to }] });
};

/** Nodes by id and edges by their canvas id, gone. Pure. */
export const deleteParts = (
  diagram: Diagram,
  nodeIds: readonly string[],
  edgeIds: readonly string[]
): Diagram => {
  const ids = nodeIds.filter((id) => !id.startsWith(GROUP_PREFIX));
  const cut = new Set(edgeIds);
  const edges = diagram.edges.filter((_, index) => !cut.has(edgeId(index)));
  if (ids.length === 0 && edges.length === diagram.edges.length) {
    return diagram;
  }
  return removeParts.apply({ ...diagram, edges }, { ids });
};

/** A fresh node id: `n1`, `n2`, … the first one free. */
const freeId = (diagram: Diagram): string => {
  const taken = new Set(diagram.nodes.map((node) => node.id));
  let next = diagram.nodes.length + 1;
  while (taken.has(`n${next}`)) {
    next += 1;
  }
  return `n${next}`;
};

/** A new node, joined to `after` when given. Pure. */
export const addNode = (
  diagram: Diagram,
  label: string,
  after?: string
): { readonly diagram: Diagram; readonly id: string } => {
  const id = freeId(diagram);
  const joins =
    after && diagram.nodes.some((node) => node.id === after)
      ? [{ from: after, to: id }]
      : [];
  return {
    diagram: addNodes.apply(diagram, {
      edges: joins,
      nodes: [{ id, label, shape: "rect" }],
    }),
    id,
  };
};
