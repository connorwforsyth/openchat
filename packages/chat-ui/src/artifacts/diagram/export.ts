import { diagramToMermaid } from "@workspace/artifacts-kit/kinds/diagram/mermaid";
import type { Diagram } from "@workspace/artifacts-kit/kinds/diagram/schema";

import { artifactFileName } from "../../model/artifacts";
import { downloadFile } from "../document/export";

// A diagram out of the app (165), all in the browser: the canvas drawn to
// an SVG or PNG file (`html-to-image`, MIT, loaded only when someone
// exports), and the graph as Mermaid flowchart text for anything that
// draws Mermaid.

const SVG_END = /\.svg$/;

/** The export's file name, from the artifact's title. */
export const diagramFileName = (title: string, extension: string): string =>
  artifactFileName(title, "diagram", null).replace(SVG_END, `.${extension}`);

export const exportMermaid = (diagram: Diagram, title: string): void =>
  downloadFile(
    new Blob([diagramToMermaid(diagram)], {
      type: "text/plain;charset=utf-8",
    }),
    diagramFileName(title, "mmd")
  );

/** What part of the canvas to draw, in its own coordinates. */
export interface DiagramPicture {
  /** The canvas's background, as the page computes it (the theme's token). */
  readonly background: string;
  readonly height: number;
  /** The CSS transform that puts the diagram's bounds at the picture's origin. */
  readonly transform: string;
  /** React Flow's viewport element: the nodes, edges and their styles. */
  readonly viewport: HTMLElement;
  readonly width: number;
}

const pictureOptions = (picture: DiagramPicture) => ({
  backgroundColor: picture.background,
  // The controls and handles are for editing, not for the picture.
  filter: (node: Node) =>
    !(
      node instanceof HTMLElement &&
      (node.classList.contains("react-flow__handle") ||
        node.dataset.exportIgnore === "true")
    ),
  height: picture.height,
  pixelRatio: 2,
  style: {
    height: `${picture.height}px`,
    transform: picture.transform,
    width: `${picture.width}px`,
  },
  width: picture.width,
});

const dataUrlBlob = async (url: string): Promise<Blob> =>
  (await fetch(url)).blob();

/** The canvas as a file: `svg` (vector) or `png` (twice the pixels). */
export const exportPicture = async (
  picture: DiagramPicture,
  title: string,
  format: "png" | "svg"
): Promise<void> => {
  const { toPng, toSvg } = await import("html-to-image");
  const draw = format === "png" ? toPng : toSvg;
  const url = await draw(picture.viewport, pictureOptions(picture));
  downloadFile(await dataUrlBlob(url), diagramFileName(title, format));
};
