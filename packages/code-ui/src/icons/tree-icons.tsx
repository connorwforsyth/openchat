"use client";

import type { FileTreeIconConfig } from "@pierre/trees";
import {
  ChevronDownIcon,
  EllipsisIcon,
  FileIcon,
  FileTextIcon,
  type Icon,
  ImageIcon,
  LockIcon,
} from "@workspace/icons";
import { useLayoutEffect, useRef } from "react";

import { spriteSheet, svgToSymbol } from "./sprite";

// The tree's glyphs, drawn by whichever set `@workspace/icons` resolved at
// build time (D19). The tree keeps its built-in status dot; everything else
// is remapped onto these symbols.
const glyphs: readonly (readonly [id: string, glyph: Icon])[] = [
  ["ws-tree-chevron", ChevronDownIcon],
  ["ws-tree-ellipsis", EllipsisIcon],
  ["ws-tree-file", FileIcon],
  ["ws-tree-file-text", FileTextIcon],
  ["ws-tree-image", ImageIcon],
  ["ws-tree-lock", LockIcon],
];

const textExtensions = ["md", "mdx", "txt", "rst"];
const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "avif", "ico"];

/** Icon rules for @pierre/trees; `spriteSheet` is filled in once rendered. */
export const treeIconRules = {
  byFileExtension: Object.fromEntries([
    ...textExtensions.map((ext) => [ext, "ws-tree-file-text"]),
    ...imageExtensions.map((ext) => [ext, "ws-tree-image"]),
  ]),
  remap: {
    "file-tree-icon-chevron": "ws-tree-chevron",
    "file-tree-icon-ellipsis": "ws-tree-ellipsis",
    "file-tree-icon-file": "ws-tree-file",
    "file-tree-icon-lock": "ws-tree-lock",
  },
  set: "none",
} as const satisfies FileTreeIconConfig;

/**
 * Renders the glyphs through React, hidden, and hands their markup to
 * `onSprite` as a sprite sheet. Rendering them (rather than importing SVG
 * files) is what makes the sprite follow the active icon set.
 */
export function TreeIconSprite({
  onSprite,
}: {
  readonly onSprite: (sprite: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const svgs = host.current?.querySelectorAll("svg") ?? [];
    const symbols = [...svgs].flatMap((svg, index) => {
      const id = glyphs[index]?.[0];
      if (id === undefined) {
        return [];
      }
      const symbol = svgToSymbol(svg.outerHTML, id);
      return symbol.ok ? [symbol.value] : [];
    });
    onSprite(spriteSheet(symbols));
  }, [onSprite]);

  return (
    <div hidden ref={host}>
      {glyphs.map(([id, Glyph]) => (
        <Glyph aria-hidden key={id} />
      ))}
    </div>
  );
}
