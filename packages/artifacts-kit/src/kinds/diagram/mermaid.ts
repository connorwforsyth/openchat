import type { Diagram, DiagramNode, DiagramShape } from "./schema";

// A diagram as Mermaid flowchart text (165), for pasting into anything that
// draws Mermaid. Labels are quoted, with Mermaid's entity codes for the
// characters a quoted label can't hold; groups become subgraphs. Pure.

const BRACKETS: Readonly<Record<DiagramShape, readonly [string, string]>> = {
  circle: ["((", "))"],
  diamond: ["{", "}"],
  rect: ["[", "]"],
  rounded: ["(", ")"],
  stadium: ["([", "])"],
};

const NEWLINES = /\r?\n/g;

/** Text safe inside a Mermaid `"…"` label. */
export const mermaidLabel = (text: string): string =>
  text
    .replace(NEWLINES, " ")
    .replaceAll("#", "#35;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    // ci-guard-ignore tokens: Mermaid's entity code for "|", not a colour.
    .replaceAll("|", "#124;");

const nodeLine = (node: DiagramNode): string => {
  const [open, close] = BRACKETS[node.shape];
  return `${node.id}${open}"${mermaidLabel(node.label)}"${close}`;
};

/** The diagram as a Mermaid `flowchart`. Positions don't carry over. */
export const diagramToMermaid = (diagram: Diagram): string => {
  const ungrouped = diagram.nodes.filter((node) => node.group === undefined);
  const groups = [
    ...new Set(
      diagram.nodes.flatMap((node) => (node.group ? [node.group] : []))
    ),
  ];
  const lines = [
    `flowchart ${diagram.direction}`,
    ...ungrouped.map((node) => `  ${nodeLine(node)}`),
    ...groups.flatMap((group, index) => [
      `  subgraph group${index}["${mermaidLabel(group)}"]`,
      ...diagram.nodes
        .filter((node) => node.group === group)
        .map((node) => `    ${nodeLine(node)}`),
      "  end",
    ]),
    ...diagram.edges.map((edge) =>
      edge.label
        ? `  ${edge.from} -->|"${mermaidLabel(edge.label)}"| ${edge.to}`
        : `  ${edge.from} --> ${edge.to}`
    ),
  ];
  return `${lines.join("\n")}\n`;
};
