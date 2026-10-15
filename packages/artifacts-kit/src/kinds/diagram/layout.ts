import dagre from "@dagrejs/dagre";

import type { Diagram, DiagramNode } from "./schema";

// Where every node of a diagram goes (165): the layered layout of dagre
// (MIT; elkjs is EPL, which PLAN.md Q12 rules out), except for nodes a
// person dragged, which stay where they put them. Node sizes are estimated
// from their labels, so the layout needs no DOM: the server, a test and the
// editor all get the same picture from the same graph.

export interface DiagramBox {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface LaidOutNode extends DiagramBox {
  readonly id: string;
}

export interface LaidOutGroup extends DiagramBox {
  readonly name: string;
}

export interface DiagramLayout {
  readonly groups: readonly LaidOutGroup[];
  readonly height: number;
  readonly nodes: readonly LaidOutNode[];
  readonly width: number;
}

const CHAR_WIDTH = 7.5;
const PADDING_X = 32;
const MIN_WIDTH = 96;
const MAX_WIDTH = 240;
const LINE_HEIGHT = 20;
const BASE_HEIGHT = 44;
const GROUP_PADDING = 24;

/** A node's box, from its label and shape. Pure. */
export const nodeSize = (
  node: Pick<DiagramNode, "label" | "shape">
): { readonly height: number; readonly width: number } => {
  const textWidth = node.label.length * CHAR_WIDTH + PADDING_X;
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, textWidth));
  const lines = Math.ceil(textWidth / MAX_WIDTH);
  const height = BASE_HEIGHT + (lines - 1) * LINE_HEIGHT;
  switch (node.shape) {
    // A diamond's text sits in its middle half; a circle's in its square.
    case "diamond":
      return { height: height * 1.6, width: width * 1.4 };
    case "circle": {
      const side = Math.max(width, height);
      return { height: side, width: side };
    }
    case "rect":
    case "rounded":
    case "stadium":
      return { height, width };
    default:
      return node.shape satisfies never;
  }
};

const round = (value: number): number => Math.round(value);

/**
 * The diagram laid out: every node's top-left corner and size, each
 * group's box around its nodes, and the whole picture's size. The same
 * graph always lays out the same. Pure.
 */
export const layoutDiagram = (diagram: Diagram): DiagramLayout => {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    marginx: 16,
    marginy: 16,
    nodesep: 40,
    rankdir: diagram.direction,
    ranksep: 56,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  const sizes = new Map(
    diagram.nodes.map((node) => [node.id, nodeSize(node)] as const)
  );
  for (const node of diagram.nodes) {
    graph.setNode(node.id, { ...sizes.get(node.id) });
  }
  for (const [index, edge] of diagram.edges.entries()) {
    if (sizes.has(edge.from) && sizes.has(edge.to)) {
      graph.setEdge(edge.from, edge.to, {}, String(index));
    }
  }
  dagre.layout(graph);
  const nodes = diagram.nodes.map((node): LaidOutNode => {
    const size = sizes.get(node.id) ?? {
      height: BASE_HEIGHT,
      width: MIN_WIDTH,
    };
    const dragged = diagram.positions?.[node.id];
    if (dragged) {
      return { id: node.id, ...size, x: round(dragged.x), y: round(dragged.y) };
    }
    // dagre gives the centre.
    const centre = graph.node(node.id) as { x: number; y: number };
    return {
      id: node.id,
      ...size,
      x: round(centre.x - size.width / 2),
      y: round(centre.y - size.height / 2),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const groupNames = [
    ...new Set(
      diagram.nodes.flatMap((node) => (node.group ? [node.group] : []))
    ),
  ];
  const groups = groupNames.map((name): LaidOutGroup => {
    const members = diagram.nodes
      .filter((node) => node.group === name)
      .flatMap((node) => {
        const box = byId.get(node.id);
        return box ? [box] : [];
      });
    const x = Math.min(...members.map((box) => box.x)) - GROUP_PADDING;
    const y = Math.min(...members.map((box) => box.y)) - GROUP_PADDING;
    const right = Math.max(...members.map((box) => box.x + box.width));
    const bottom = Math.max(...members.map((box) => box.y + box.height));
    return {
      height: bottom + GROUP_PADDING - y,
      name,
      width: right + GROUP_PADDING - x,
      x,
      y,
    };
  });
  const boxes: readonly DiagramBox[] = [...nodes, ...groups];
  return {
    groups,
    height: Math.max(0, ...boxes.map((box) => box.y + box.height)),
    nodes,
    width: Math.max(0, ...boxes.map((box) => box.x + box.width)),
  };
};
