import { z } from "zod";

import {
  type Diagram,
  diagramDirectionSchema,
  diagramEdgeLabelSchema,
  diagramEdgeSchema,
  diagramGroupSchema,
  diagramNodeSchema,
  diagramSchema,
  diagramShapeSchema,
  EMPTY_DIAGRAM,
} from "./schema";

// How a diagram crosses to and from the model (165). The model writes the
// graph as JSON with no coordinates; it reads it back the same way, one
// node or edge to a line, without the positions a person dragged to and
// without fields left at their defaults, so a large graph stays short.

const FENCED = /^\s*```[\w-]*\s*\n([\s\S]*?)\n?```\s*$/;

// Forgiving where a model's slip has an obvious meaning (an unknown shape
// is a box); a node without an id or label can't be guessed, so it's left
// out, and the checks then say which edge named it.
const lenientNodeSchema = z.object({
  group: diagramGroupSchema.optional().catch(undefined),
  id: diagramNodeSchema.shape.id,
  label: z.coerce.string().pipe(diagramNodeSchema.shape.label),
  shape: diagramShapeSchema.catch("rect"),
});

const lenientEdgeSchema = z.object({
  from: diagramEdgeSchema.shape.from,
  label: diagramEdgeLabelSchema.optional().catch(undefined),
  to: diagramEdgeSchema.shape.to,
});

const each = <T>(schema: z.ZodType<T>, value: unknown): T[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = schema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined)
  ) as T;

const parseJson = (text: string): unknown => {
  const body = FENCED.exec(text)?.[1] ?? text;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/**
 * The model's text as a diagram: its JSON, read strictly when it fits and
 * forgivingly when it nearly does. Text that isn't JSON at all is an empty
 * diagram, which the checks refuse with an example of what to write. Pure.
 */
export const diagramFromModel = (text: string): Diagram => {
  const value = parseJson(text);
  const strict = diagramSchema.safeParse(value);
  if (strict.success) {
    return strict.data;
  }
  if (typeof value !== "object" || value === null) {
    return EMPTY_DIAGRAM;
  }
  const raw = value as Readonly<Record<string, unknown>>;
  return {
    direction: diagramDirectionSchema.catch("TB").parse(raw.direction),
    edges: each(lenientEdgeSchema, raw.edges).map(withoutUndefined),
    nodes: each(lenientNodeSchema, raw.nodes).map(withoutUndefined),
  };
};

/** A node as the model reads it: the default shape left out. */
const compactNode = (node: Diagram["nodes"][number]) =>
  withoutUndefined({
    group: node.group,
    id: node.id,
    label: node.label,
    shape: node.shape === "rect" ? undefined : node.shape,
  });

/**
 * What the model reads of a diagram: the same JSON it writes, a line per
 * node and edge, without positions. Pure.
 */
export const diagramToModel = (diagram: Diagram): string => {
  const lines = (items: readonly unknown[]) =>
    items.map((item) => JSON.stringify(item)).join(",\n");
  return [
    `{"direction":${JSON.stringify(diagram.direction)},"nodes":[`,
    lines(diagram.nodes.map(compactNode)),
    '],"edges":[',
    lines(diagram.edges.map(withoutUndefined)),
    "]}",
  ]
    .filter((line) => line !== "")
    .join("\n");
};
