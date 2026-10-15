import { sizeLimit } from "../../checks";
import type { ArtifactCheck } from "../../define";
import {
  DIAGRAM_MAX_CHARS,
  DIAGRAM_MAX_EDGES,
  DIAGRAM_MAX_NODES,
  type Diagram,
  serializeDiagram,
} from "./schema";

// A diagram's rules beyond its shape (165): something to draw, ids that
// name one node each, edges between nodes that exist, and a size a person
// can still read. A person's edit passes the same checks as the model's.

const duplicates = (ids: readonly string[]): readonly string[] => [
  ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
];

export const hasNodes: ArtifactCheck<Diagram> = {
  name: "nodes",
  run: (diagram) =>
    diagram.nodes.length > 0
      ? []
      : [
          'a diagram needs at least one node: write JSON like {"direction":"LR","nodes":[{"id":"a","label":"Start"}],"edges":[]}',
        ],
};

export const uniqueIds: ArtifactCheck<Diagram> = {
  name: "unique-ids",
  run: (diagram) =>
    duplicates(diagram.nodes.map((node) => node.id)).map(
      (id) => `the node id "${id}" is used more than once`
    ),
};

export const noDanglingEdges: ArtifactCheck<Diagram> = {
  name: "edges",
  run: (diagram) => {
    const ids = new Set(diagram.nodes.map((node) => node.id));
    return diagram.edges.flatMap((edge) =>
      [edge.from, edge.to]
        .filter((end) => !ids.has(end))
        .map(
          (end) =>
            `the edge ${edge.from} -> ${edge.to} names "${end}", which isn't a node`
        )
    );
  },
};

export const sizeCaps: ArtifactCheck<Diagram> = {
  name: "caps",
  run: (diagram) => [
    ...(diagram.nodes.length > DIAGRAM_MAX_NODES
      ? [
          `a diagram has at most ${DIAGRAM_MAX_NODES} nodes; this one has ${diagram.nodes.length}`,
        ]
      : []),
    ...(diagram.edges.length > DIAGRAM_MAX_EDGES
      ? [
          `a diagram has at most ${DIAGRAM_MAX_EDGES} edges; this one has ${diagram.edges.length}`,
        ]
      : []),
  ],
};

export const DIAGRAM_CHECKS: readonly ArtifactCheck<Diagram>[] = [
  hasNodes,
  uniqueIds,
  noDanglingEdges,
  sizeCaps,
  sizeLimit({ chars: DIAGRAM_MAX_CHARS, of: serializeDiagram }),
];
