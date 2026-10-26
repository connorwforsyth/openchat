// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/vite/loc-tags-plugin.ts (`injectLocTags` only). MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
import type { JSXIdentifier, JSXOpeningElement } from "@babel/types";
import { tryParse, walkJsx } from "./babel-walk";

// Unlike open-slide's `data-slide-loc="<line>:<col>"` on host elements, this
// stamps `data-src="<file>:<line>:<col>"` (D16) on capitalized components
// too: slide-ui layouts carry their text as props, so the layout element is
// the edit target. It runs in the browser, so it keeps to @babel/parser
// (see ./babel-walk).

const LOC_ATTR = "data-src";
const QUOTABLE = /^[^"\\<>&{}\n\r]*$/;

function isTaggableJsxName(
  name: JSXOpeningElement["name"]
): name is JSXIdentifier {
  return name.type === "JSXIdentifier" && name.name !== "Fragment";
}

function alreadyTagged(opening: JSXOpeningElement): boolean {
  return opening.attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === LOC_ATTR
  );
}

const attrValue = (text: string): string =>
  QUOTABLE.test(text) ? `"${text}"` : `{${JSON.stringify(text)}}`;

export function injectLocTags(code: string, fileName: string): string | null {
  const ast = tryParse(code);
  if (!ast) {
    return null;
  }

  const insertions: { offset: number; text: string }[] = [];
  walkJsx(ast, (node) => {
    if (!(node.type === "JSXElement" && node.loc)) {
      return;
    }
    const opening = node.openingElement;
    const { name } = opening;
    if (!isTaggableJsxName(name) || alreadyTagged(opening)) {
      return;
    }
    const loc = `${fileName}:${node.loc.start.line}:${node.loc.start.column}`;
    insertions.push({
      offset: name.end ?? 0,
      text: ` ${LOC_ATTR}=${attrValue(loc)}`,
    });
  });

  if (insertions.length === 0) {
    return null;
  }
  insertions.sort((a, b) => b.offset - a.offset);
  let next = code;
  for (const ins of insertions) {
    next = next.slice(0, ins.offset) + ins.text + next.slice(ins.offset);
  }
  return next;
}

/**
 * Stamps each JSX element with `data-src="<fileName>:<line>:<column>"`, the
 * location a visual edit takes. Fragments, member-expression tags and
 * elements already carrying `data-src` are left alone. Source that doesn't
 * parse comes back unchanged. The runtime imports this alone, without the
 * edit engine.
 */
export const stampSourceLocations = (
  source: string,
  fileName: string
): string => injectLocTags(source, fileName) ?? source;
