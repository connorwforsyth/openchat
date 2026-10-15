import { z } from "zod";

import { defineOperation } from "../../define";
import { diagramFromModel } from "./model-text";
import {
  type Diagram,
  type DiagramEdge,
  diagramEdgeSchema,
  diagramGroupSchema,
  diagramLabelSchema,
  diagramNodeIdSchema,
  diagramNodeSchema,
  diagramShapeSchema,
  EMPTY_DIAGRAM,
} from "./schema";

// How the model edits a diagram without sending all of it (165): add nodes
// (and the edges that hang them on), connect nodes, change one, remove
// nodes or edges, or replace the graph and keep the layout a person gave
// it. Each is pure; `problems` says why one can't apply (an id that isn't
// there) before `apply` runs. The result still passes the kind's checks.

const idsOf = (diagram: Diagram): ReadonlySet<string> =>
  new Set(diagram.nodes.map((node) => node.id));

const listIds = (diagram: Diagram): string =>
  diagram.nodes.length > 0
    ? `Its node ids: ${[...idsOf(diagram)].join(", ")}`
    : "It has no nodes yet";

const unknownIds = (
  diagram: Diagram,
  ids: readonly string[]
): readonly string[] => {
  const known = idsOf(diagram);
  const missing = [...new Set(ids.filter((id) => !known.has(id)))];
  return missing.length > 0
    ? [
        `there's no node ${missing.map((id) => `"${id}"`).join(", ")}. ${listIds(diagram)}`,
      ]
    : [];
};

const endsOf = (edges: readonly DiagramEdge[]): readonly string[] =>
  edges.flatMap((edge) => [edge.from, edge.to]);

/** Positions kept only for nodes still in `nodes`. */
const keptPositions = (
  positions: Diagram["positions"],
  nodes: Diagram["nodes"]
): Pick<Diagram, "positions"> => {
  if (!positions) {
    return {};
  }
  const ids = new Set(nodes.map((node) => node.id));
  const kept = Object.fromEntries(
    Object.entries(positions).filter(([id]) => ids.has(id))
  );
  return Object.keys(kept).length > 0 ? { positions: kept } : {};
};

const edgesInput = z
  .array(diagramEdgeSchema)
  .max(400)
  .describe("Edges, each {from, to, label?} by node id.");

/** New nodes, and edges that may name them. */
export const addNodes = defineOperation({
  apply: (
    current: Diagram | null,
    input: {
      readonly edges?: readonly DiagramEdge[];
      readonly nodes: Diagram["nodes"];
    }
  ): Diagram => {
    const diagram = current ?? EMPTY_DIAGRAM;
    return {
      ...diagram,
      edges: [...diagram.edges, ...(input.edges ?? [])],
      nodes: [...diagram.nodes, ...input.nodes],
    };
  },
  description:
    "Add nodes ({id, label, shape?, group?}), and edges that connect them.",
  input: z.object({
    edges: edgesInput.optional(),
    nodes: z.array(diagramNodeSchema).min(1).max(200),
  }),
  problems: (current, input) => {
    const diagram = current ?? EMPTY_DIAGRAM;
    const known = idsOf(diagram);
    const taken = input.nodes
      .map((node) => node.id)
      .filter((id, index, all) => known.has(id) || all.indexOf(id) !== index);
    const after: Diagram = {
      ...diagram,
      nodes: [...diagram.nodes, ...input.nodes],
    };
    return [
      ...[...new Set(taken)].map(
        (id) =>
          `the node id "${id}" is taken: use update_node to change it, or another id`
      ),
      ...unknownIds(after, endsOf(input.edges ?? [])),
    ];
  },
});

/** Edges between nodes that are there. */
export const connect = defineOperation({
  apply: (
    current: Diagram | null,
    input: { readonly edges: readonly DiagramEdge[] }
  ): Diagram => {
    const diagram = current ?? EMPTY_DIAGRAM;
    return { ...diagram, edges: [...diagram.edges, ...input.edges] };
  },
  description: "Add edges between existing nodes.",
  input: z.object({ edges: edgesInput.min(1) }),
  problems: (current, input) =>
    unknownIds(current ?? EMPTY_DIAGRAM, endsOf(input.edges)),
});

/** One node's label, shape or group. */
export const updateNode = defineOperation({
  apply: (
    current: Diagram | null,
    input: {
      readonly group?: string;
      readonly id: string;
      readonly label?: string;
      readonly shape?: Diagram["nodes"][number]["shape"];
    }
  ): Diagram => {
    const diagram = current ?? EMPTY_DIAGRAM;
    const { id, ...changes } = input;
    const fields = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined)
    );
    return {
      ...diagram,
      nodes: diagram.nodes.map((node) =>
        node.id === id ? { ...node, ...fields } : node
      ),
    };
  },
  description: "Change one node's label, shape or group, by its id.",
  input: z.object({
    group: diagramGroupSchema.optional(),
    id: diagramNodeIdSchema,
    label: diagramLabelSchema.optional(),
    shape: diagramShapeSchema.optional(),
  }),
  problems: (current, input) => [
    ...unknownIds(current ?? EMPTY_DIAGRAM, [input.id]),
    ...(input.label === undefined &&
    input.shape === undefined &&
    input.group === undefined
      ? ["update_node needs a label, shape or group to change"]
      : []),
  ],
});

const edgeRefSchema = diagramEdgeSchema.pick({ from: true, to: true });

/** Nodes (with their edges), or edges between two nodes. */
export const removeParts = defineOperation({
  apply: (
    current: Diagram | null,
    input: {
      readonly edges?: readonly {
        readonly from: string;
        readonly to: string;
      }[];
      readonly ids?: readonly string[];
    }
  ): Diagram => {
    const diagram = current ?? EMPTY_DIAGRAM;
    const gone = new Set(input.ids ?? []);
    const cut = input.edges ?? [];
    const nodes = diagram.nodes.filter((node) => !gone.has(node.id));
    const edges = diagram.edges.filter(
      (edge) =>
        !(
          gone.has(edge.from) ||
          gone.has(edge.to) ||
          cut.some((each) => each.from === edge.from && each.to === edge.to)
        )
    );
    const { positions: _positions, ...rest } = diagram;
    return {
      ...rest,
      edges,
      nodes,
      ...keptPositions(diagram.positions, nodes),
    };
  },
  description:
    "Remove nodes by id (and every edge touching them), and edges by {from, to}.",
  input: z.object({
    edges: z.array(edgeRefSchema).max(400).optional(),
    ids: z.array(diagramNodeIdSchema).max(200).optional(),
  }),
  problems: (current, input) => {
    const diagram = current ?? EMPTY_DIAGRAM;
    const missingEdges = (input.edges ?? []).filter(
      (each) =>
        !diagram.edges.some(
          (edge) => edge.from === each.from && edge.to === each.to
        )
    );
    return [
      ...((input.ids ?? []).length === 0 && (input.edges ?? []).length === 0
        ? ["remove needs ids (nodes) or edges to remove"]
        : []),
      ...unknownIds(diagram, input.ids ?? []),
      ...missingEdges.map(
        (edge) => `there's no edge ${edge.from} -> ${edge.to}`
      ),
    ];
  },
});

/**
 * The whole graph again, from the model's JSON. Nodes it keeps (by id)
 * stay where a person put them.
 */
export const replaceDiagram = defineOperation({
  apply: (current: Diagram | null, input: { readonly content: string }) => {
    const next = diagramFromModel(input.content);
    const { positions: _positions, ...rest } = next;
    return {
      ...rest,
      ...keptPositions(current?.positions, next.nodes),
    };
  },
  description:
    "Replace the whole graph with this JSON ({direction, nodes, edges}); nodes that keep their id keep their place.",
  input: z.object({ content: z.string().min(1).max(200_000) }),
});

/** The structured edits the model may make, by the name it calls them. */
export const DIAGRAM_EDITS = {
  add_nodes: addNodes,
  connect,
  remove: removeParts,
  replace: replaceDiagram,
  update_node: updateNode,
} as const;

export type DiagramEditName = keyof typeof DIAGRAM_EDITS;
