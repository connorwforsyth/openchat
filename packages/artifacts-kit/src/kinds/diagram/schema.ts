import { z } from "zod";

// A diagram (165): a graph the model writes as data and the app draws. The
// model names nodes and edges and never coordinates; layout is the kit's
// (`layout.ts`), and the only coordinates stored are where a person dragged
// a node (`positions`).

/** Most nodes and edges a diagram may have: past this it stops being read. */
export const DIAGRAM_MAX_NODES = 200;
export const DIAGRAM_MAX_EDGES = 400;
/** Longest stored diagram, as JSON. */
export const DIAGRAM_MAX_CHARS = 200_000;

const NODE_ID = /^[A-Za-z0-9_-]+$/;

/** Which way the graph flows: top to bottom, left to right, or back. */
export const diagramDirectionSchema = z.enum(["TB", "LR", "BT", "RL"]);
export type DiagramDirection = z.infer<typeof diagramDirectionSchema>;

/** How a node is drawn; each is one Mermaid's flowchart can say too. */
export const diagramShapeSchema = z.enum([
  "rect",
  "rounded",
  "stadium",
  "diamond",
  "circle",
]);
export type DiagramShape = z.infer<typeof diagramShapeSchema>;

export const diagramNodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(NODE_ID, "is letters, digits, _ and - only")
  .describe("A short id, unique in the diagram: letters, digits, _ and -.");

export const diagramLabelSchema = z.string().trim().min(1).max(200);
export const diagramGroupSchema = z.string().trim().min(1).max(64);
export const diagramEdgeLabelSchema = z.string().trim().min(1).max(100);

export const diagramNodeSchema = z.object({
  /** Nodes with the same group are drawn inside one box. */
  group: diagramGroupSchema.optional(),
  id: diagramNodeIdSchema,
  label: diagramLabelSchema,
  shape: diagramShapeSchema.default("rect"),
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

export const diagramEdgeSchema = z.object({
  from: diagramNodeIdSchema,
  label: diagramEdgeLabelSchema.optional(),
  to: diagramNodeIdSchema,
});
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

export const diagramPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type DiagramPoint = z.infer<typeof diagramPointSchema>;

export const diagramSchema = z.object({
  direction: diagramDirectionSchema.default("TB"),
  edges: z.array(diagramEdgeSchema).default([]),
  nodes: z.array(diagramNodeSchema),
  /** Where a person put nodes, by id: the node's top-left corner. */
  positions: z.record(z.string(), diagramPointSchema).optional(),
});
export type Diagram = z.infer<typeof diagramSchema>;

/**
 * A version's stored text, read as a diagram: JSON, then the shape. Bad
 * JSON is one issue, not a stack.
 */
export const diagramContentSchema = z
  .string()
  .transform((text, context): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      context.addIssue({ code: "custom", message: "isn't a diagram's JSON" });
      return z.NEVER;
    }
  })
  .pipe(diagramSchema);

/** A diagram as a version stores it. */
export const serializeDiagram = (diagram: Diagram): string =>
  JSON.stringify(diagram);

export const EMPTY_DIAGRAM: Diagram = {
  direction: "TB",
  edges: [],
  nodes: [],
};
