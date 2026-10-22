// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/editing/edit-ops.ts. MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
// biome-ignore lint/performance/noNamespaceImport: Babel's node predicates read as `t.isX`, the library's own convention.
import * as t from "@babel/types";
import type { VisualEditOp } from "../visual-edits";
import { findJsxAncestors, parseSource, walkAll, walkJsx } from "./babel-walk";
import { textDiff } from "./text-diff";

export type EditOp = VisualEditOp;

export type ApplyEditResult =
  | { ok: true; source: string }
  | { ok: false; status: number; error: string };

export interface Splice {
  from: number;
  text: string;
  to: number;
}

export function jsString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
}

export function spliceRange(node: t.Node, text: string): Splice {
  return { from: node.start ?? 0, text, to: node.end ?? 0 };
}

const QUOTABLE_ATTR = /^[^"\\<>&{}\n\r]*$/;
const LEADING_INDENT = /^[ \t]+/;
const JSX_TEXT_UNSAFE = /[{}<>]/;
const EDGE_SPACE = /^\s|\s$/;
const SPACE = /\s/;
const CAPITALIZED = /^[A-Z]/;
const PROP_PATH = /^([^.]+)(?:\.(\d+))?$/;

// Splices are applied back-to-front so earlier offsets stay valid, then the
// result is re-parsed — a rewrite that cannot be parsed is rejected whole.
export function applySplices(
  source: string,
  splices: Splice[]
): ApplyEditResult {
  const ordered = [...splices].sort((a, b) => b.from - a.from);
  let next = source;
  for (const sp of ordered) {
    next = next.slice(0, sp.from) + sp.text + next.slice(sp.to);
  }
  if (!parseSource(next)) {
    return {
      error: "edit would produce invalid source",
      ok: false,
      status: 422,
    };
  }
  return { ok: true, source: next };
}

// Emit a JSX attribute value: `"foo"` when the value is round-trip-safe
// inside double quotes; otherwise wrap in `{...}` so escapes work.
export function formatJsxAttrValue(value: string): string {
  if (QUOTABLE_ATTR.test(value)) {
    return `"${value}"`;
  }
  return `{${jsString(value)}}`;
}

function jsxAttrName(attr: t.JSXAttribute): string | null {
  return t.isJSXIdentifier(attr.name) ? attr.name.name : null;
}

export function findJsxAttr(
  opening: t.JSXOpeningElement,
  name: string
): t.JSXAttribute | null {
  for (const attr of opening.attributes) {
    if (t.isJSXAttribute(attr) && jsxAttrName(attr) === name) {
      return attr;
    }
  }
  return null;
}

function findJsxByStart(
  ast: t.Node,
  line: number,
  column: number
): t.JSXElement | null {
  let hit: t.JSXElement | null = null;
  walkJsx(ast, (n) => {
    if (!(t.isJSXElement(n) && n.loc)) {
      return;
    }
    const s = n.loc.start;
    if (s.line === line && s.column === column) {
      hit = n;
      return "stop";
    }
  });
  return hit;
}

function findInnermostJsxElement(
  ast: t.Node,
  line: number,
  column: number
): t.JSXElement | null {
  // Prefer exact `loc.start` match (what `data-slide-loc` sends) so
  // we don't accidentally hit an outer JSX whose range happens to
  // enclose the click point.
  const exact = findJsxByStart(ast, line, column);
  if (exact) {
    return exact;
  }

  // Fallback for fiber-walked clicks whose column may not align with
  // the opening `<`.
  for (const n of findJsxAncestors(ast, line, column)) {
    if (t.isJSXElement(n)) {
      return n;
    }
  }
  return null;
}

function findUniqueElementByText(
  ast: t.Node,
  prevText: string
): t.JSXElement | null {
  const hits: Array<{ node: t.JSXElement; size: number }> = [];
  walkJsx(ast, (n) => {
    if (!t.isJSXElement(n)) {
      return;
    }
    if (textRangeContent(collectTextRangeParts(n)) !== prevText) {
      return;
    }
    hits.push({ node: n, size: (n.end ?? 0) - (n.start ?? 0) });
  });
  if (hits.length === 0) {
    return null;
  }
  hits.sort((a, b) => a.size - b.size);
  const [best] = hits;
  if (!best) {
    return null;
  }
  const bestStart = best.node.start ?? 0;
  const bestEnd = best.node.end ?? 0;
  const hasSiblingMatch = hits
    .slice(1)
    .some(
      ({ node }) => (node.start ?? 0) > bestStart || (node.end ?? 0) < bestEnd
    );
  return hasSiblingMatch ? null : best.node;
}

function fallbackTextForOps(ops: readonly EditOp[]): string | null {
  for (const op of ops) {
    if (
      (op.kind === "set-style" ||
        op.kind === "set-text" ||
        op.kind === "set-text-range-style") &&
      op.prevText !== undefined
    ) {
      return op.prevText;
    }
  }
  return null;
}

function hasOnlyTextOps(ops: readonly EditOp[]): boolean {
  return ops.length > 0 && ops.every((op) => op.kind === "set-text");
}

function elementTextMatches(element: t.JSXElement, prevText: string): boolean {
  return textRangeContent(collectTextRangeParts(element)) === prevText;
}

export function findElementForEdit(
  ast: t.File,
  line: number,
  column: number,
  ops: readonly EditOp[]
): t.JSXElement | null {
  const element = findInnermostJsxElement(ast, line, column);
  const prevText = fallbackTextForOps(ops);
  if (prevText === null) {
    return element;
  }
  if (
    hasOnlyTextOps(ops) &&
    element &&
    (elementTextMatches(element, prevText) ||
      elementTextCandidateMatches(ast, element, prevText))
  ) {
    return element;
  }
  return findUniqueElementByText(ast, prevText) ?? element;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
function buildStyleSplice(
  source: string,
  element: t.JSXElement,
  ops: Array<{ key: string; value: string | null }>
): Splice | { error: string } | null {
  const opening = element.openingElement;
  const existing = findJsxAttr(opening, "style");
  type StyleEntry =
    | { kind: "prop"; key: string; keyText: string; valueText: string }
    | { kind: "raw"; text: string };
  const entries: StyleEntry[] = [];
  let hasRawEntry = false;

  if (existing) {
    const { value } = existing;
    if (!(value && t.isJSXExpressionContainer(value))) {
      return { error: "style attribute has unsupported form" };
    }
    const expr = value.expression;
    if (t.isObjectExpression(expr)) {
      for (const prop of expr.properties) {
        if (t.isObjectProperty(prop) && !prop.computed) {
          let keyName: string | null = null;
          if (t.isIdentifier(prop.key)) {
            keyName = prop.key.name;
          } else if (t.isStringLiteral(prop.key)) {
            keyName = prop.key.value;
          }
          if (!keyName) {
            return { error: "style has unsupported key" };
          }
          const v = prop.value;
          if (
            typeof prop.key.start !== "number" ||
            typeof prop.key.end !== "number" ||
            typeof v.start !== "number" ||
            typeof v.end !== "number"
          ) {
            return { error: "style value missing source range" };
          }
          entries.push({
            key: keyName,
            keyText: source.slice(prop.key.start, prop.key.end),
            kind: "prop",
            valueText: source.slice(v.start, v.end),
          });
        } else {
          if (typeof prop.start !== "number" || typeof prop.end !== "number") {
            return { error: "style value missing source range" };
          }
          entries.push({
            kind: "raw",
            text: source.slice(prop.start, prop.end),
          });
          hasRawEntry = true;
        }
      }
    } else {
      if (typeof expr.start !== "number" || typeof expr.end !== "number") {
        return { error: "style value missing source range" };
      }
      entries.push({
        kind: "raw",
        text: `...(${source.slice(expr.start, expr.end)})`,
      });
      hasRawEntry = true;
    }
  }

  for (const op of ops) {
    const matching = entries.filter(
      (entry): entry is Extract<StyleEntry, { kind: "prop" }> =>
        entry.kind === "prop" && entry.key === op.key
    );
    const lastMatching = matching.at(-1);
    if (op.value === null) {
      for (const entry of matching) {
        entries.splice(entries.indexOf(entry), 1);
      }
      if (hasRawEntry) {
        entries.push({
          key: op.key,
          keyText: op.key,
          kind: "prop",
          valueText: "undefined",
        });
      }
    } else if (lastMatching) {
      lastMatching.valueText = jsString(op.value);
    } else {
      entries.push({
        key: op.key,
        keyText: op.key,
        kind: "prop",
        valueText: jsString(op.value),
      });
    }
  }

  if (entries.length === 0) {
    if (!existing) {
      return null;
    }
    let from = existing.start ?? 0;
    if (from > 0 && source[from - 1] === " ") {
      from -= 1;
    }
    return { from, text: "", to: existing.end ?? 0 };
  }

  const propsText = entries
    .map((entry) =>
      entry.kind === "prop"
        ? `${entry.keyText}: ${entry.valueText}`
        : entry.text
    )
    .join(", ");
  const newAttr = `style={{ ${propsText} }}`;

  if (existing) {
    const lastAttr = opening.attributes.at(-1);
    if (lastAttr && lastAttr !== existing && typeof lastAttr.end === "number") {
      const attrsAfterStyle = source
        .slice(existing.end ?? 0, lastAttr.end)
        .replace(LEADING_INDENT, "");
      return {
        from: existing.start ?? 0,
        text: `${attrsAfterStyle} ${newAttr}`,
        to: lastAttr.end,
      };
    }
    return { from: existing.start ?? 0, text: newAttr, to: existing.end ?? 0 };
  }
  const lastAttr = opening.attributes.at(-1);
  const at = lastAttr?.end ?? opening.name.end ?? 0;
  return { from: at, text: ` ${newAttr}`, to: at };
}

function formatJsxText(value: string): string {
  // JSXText can't hold `{}<>` and collapses leading/trailing whitespace,
  // so wrap the value in an expression container when it would lose info.
  if (JSX_TEXT_UNSAFE.test(value) || EDGE_SPACE.test(value) || value === "") {
    return `{${jsString(value)}}`;
  }
  return value;
}

interface TextCandidate {
  // Normalized current text the candidate represents — what an
  // unambiguous DOM `textContent` would render here. Used to match
  // against the client-supplied `prevText` when there's more than one.
  current: string;
  splice: (value: string) => Splice;
}

type JsxParent = t.JSXElement | t.JSXFragment;
interface TextRangeLeaf {
  current: string;
  node: t.JSXText | t.JSXExpressionContainer;
  offsets: Array<number | null>;
  parent: JsxParent;
  raw: string;
  text: (value: string) => string;
}
interface TextRangeBreak {
  current: "\n";
  node: t.JSXElement;
}
type TextRangePart = TextRangeLeaf | TextRangeBreak;

function meaningfulChildren(parent: JsxParent): t.Node[] {
  return parent.children.filter((c) => {
    if (t.isJSXText(c)) {
      return c.value.trim() !== "";
    }
    return true;
  });
}

function isOnlyMeaningfulChild(parent: JsxParent, child: t.Node): boolean {
  const meaningful = meaningfulChildren(parent);
  return meaningful.length === 1 && meaningful[0] === child;
}

// Wrap-style splice: rewrite the whole children span of `parent`. Used
// when the candidate is the parent's only meaningful child, so old
// surrounding whitespace nodes don't leak into the new value.
function wrapSplice(parent: JsxParent, text: string): Splice {
  const [first] = parent.children;
  const last = parent.children.at(-1);
  return { from: first?.start ?? 0, text, to: last?.end ?? 0 };
}

function splitLinesWithOffsets(
  value: string
): Array<{ text: string; start: number }> {
  const lines: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== "\n" && ch !== "\r") {
      continue;
    }
    lines.push({ start, text: value.slice(start, i) });
    if (ch === "\r" && value[i + 1] === "\n") {
      i += 1;
    }
    start = i + 1;
  }
  lines.push({ start, text: value.slice(start) });
  return lines;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
function cleanJsxTextWithOffsets(value: string): {
  text: string;
  offsets: Array<number | null>;
} {
  const lines = splitLinesWithOffsets(value);
  let lastNonEmptyLine = 0;
  for (const [i, line] of lines.entries()) {
    if (line.text.trim()) {
      lastNonEmptyLine = i;
    }
  }

  let text = "";
  const offsets: Array<number | null> = [];
  for (const [i, line] of lines.entries()) {
    const chars = Array.from(line.text, (ch, j) => ({
      ch: ch === "\t" ? " " : ch,
      offset: line.start + j,
    }));
    let from = 0;
    let to = chars.length;
    if (i !== 0) {
      while (from < to && chars[from]?.ch === " ") {
        from += 1;
      }
    }
    if (i !== lines.length - 1) {
      while (to > from && chars[to - 1]?.ch === " ") {
        to -= 1;
      }
    }
    if (from >= to) {
      continue;
    }
    for (const item of chars.slice(from, to)) {
      text += item.ch;
      offsets.push(item.offset);
    }
    if (i !== lastNonEmptyLine) {
      text += " ";
      offsets.push(null);
    }
  }
  return { offsets, text };
}

function isJsxBrElement(node: t.Node): node is t.JSXElement {
  if (!t.isJSXElement(node)) {
    return false;
  }
  const { name } = node.openingElement;
  return t.isJSXIdentifier(name) && name.name.toLowerCase() === "br";
}

function collectTextCandidates(element: JsxParent, out: TextCandidate[]): void {
  const meaningful = meaningfulChildren(element);
  const isSole = meaningful.length === 1;
  for (const child of meaningful) {
    if (t.isJSXText(child)) {
      const current = child.value.trim();
      if (!current) {
        continue;
      }
      out.push({
        current,
        splice: (v) =>
          isSole
            ? wrapSplice(element, formatJsxText(v))
            : {
                from: child.start ?? 0,
                text: formatJsxText(v),
                to: child.end ?? 0,
              },
      });
    } else if (t.isJSXExpressionContainer(child)) {
      const expr = child.expression;
      if (t.isStringLiteral(expr) || t.isNumericLiteral(expr)) {
        const current = String(expr.value);
        out.push({
          current,
          splice: (v) =>
            isSole
              ? wrapSplice(element, `{${jsString(v)}}`)
              : {
                  from: child.start ?? 0,
                  text: `{${jsString(v)}}`,
                  to: child.end ?? 0,
                },
        });
      }
    } else if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      collectTextCandidates(child, out);
    }
  }
}

function collectTextRangeParts(element: JsxParent): TextRangePart[] {
  const parts: TextRangePart[] = [];
  collectTextRangePartsRaw(element, parts);
  return normalizeTextRangeParts(parts);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
function collectTextRangePartsRaw(
  element: JsxParent,
  out: TextRangePart[]
): void {
  for (const child of element.children) {
    if (t.isJSXText(child)) {
      const { text: current, offsets } = cleanJsxTextWithOffsets(child.value);
      if (current) {
        out.push({
          current,
          node: child,
          offsets,
          parent: element,
          raw: child.value,
          text: formatJsxText,
        });
      }
    } else if (t.isJSXExpressionContainer(child)) {
      const { expression } = child;
      if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
        const raw = String(expression.value);
        const current = raw;
        if (current) {
          out.push({
            current,
            node: child,
            offsets: Array.from({ length: current.length }, (_, i) => i),
            parent: element,
            raw,
            text: (value) => `{${jsString(value)}}`,
          });
        }
      }
    } else if (isJsxBrElement(child)) {
      out.push({ current: "\n", node: child });
    } else if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      collectTextRangePartsRaw(child, out);
    }
  }
}

function normalizeTextRangeParts(parts: TextRangePart[]): TextRangePart[] {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
  return parts.flatMap((part, index): TextRangePart[] => {
    if (!("raw" in part)) {
      return [part];
    }
    let start = 0;
    let end = part.current.length;
    if (parts[index - 1]?.current === "\n") {
      while (start < end && SPACE.test(part.current[start] ?? "")) {
        start += 1;
      }
    }
    if (parts[index + 1]?.current === "\n") {
      while (end > start && SPACE.test(part.current[end - 1] ?? "")) {
        end -= 1;
      }
    }
    if (start === 0 && end === part.current.length) {
      return [part];
    }
    if (start >= end) {
      return [];
    }
    return [
      {
        ...part,
        current: part.current.slice(start, end),
        offsets: part.offsets.slice(start, end),
      },
    ];
  });
}

function resetValueForRangeStyle(key: string): string | null {
  if (key === "fontWeight") {
    return "400";
  }
  if (key === "fontStyle") {
    return "normal";
  }
  return null;
}

function styleSpanForText(
  text: string,
  key: string,
  value: string | null
): string {
  const styleValue = value ?? resetValueForRangeStyle(key);
  if (styleValue === null) {
    return formatJsxText(text);
  }
  return `<span style={{ ${key}: ${jsString(styleValue)} }}>${formatJsxText(text)}</span>`;
}

function textRangeContent(parts: TextRangePart[]): string {
  return parts.map((part) => part.current).join("");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, "");
}

function textMatchesExpected(current: string, expected: string): boolean {
  return current === expected || compactText(current) === compactText(expected);
}

function formatRichText(value: string, formatText = formatJsxText): string {
  return value
    .split("\n")
    .map((part) => formatText(part))
    .join("<br />");
}

function formatOptionalText(
  value: string,
  formatText: (v: string) => string
): string {
  return value ? formatText(value) : "";
}

function textLeafSplice(part: TextRangeLeaf, value: string): Splice {
  const rawRange = textLeafRawRange(part, 0, part.current.length);
  if (!rawRange) {
    return spliceRange(part.node, part.text(value));
  }
  const { rawStart, rawEnd } = rawRange;
  return {
    from: part.node.start ?? 0,
    text: `${part.raw.slice(0, rawStart)}${formatRichText(value, part.text)}${part.raw.slice(rawEnd)}`,
    to: part.node.end ?? 0,
  };
}

function textLeafRawRange(
  part: TextRangeLeaf,
  start: number,
  end: number
): { rawStart: number; rawEnd: number } | null {
  if (start >= end) {
    return null;
  }
  let first: number | null = null;
  let last: number | null = null;
  for (let i = start; i < end; i += 1) {
    const offset = part.offsets[i];
    if (offset === undefined) {
      return null;
    }
    if (offset === null) {
      continue;
    }
    first ??= offset;
    last = offset;
  }
  if (first === null || last === null) {
    return null;
  }
  return { rawEnd: last + 1, rawStart: first };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
function buildTextRangeReplaceSplices(
  parts: TextRangePart[],
  start: number,
  end: number,
  value: string
): Splice[] | { error: string } {
  const splices: Splice[] = [];
  let offset = 0;
  let inserted = false;

  for (const part of parts) {
    const partStart = offset;
    const partEnd = partStart + part.current.length;
    offset = partEnd;

    const overlaps = start < partEnd && end > partStart;
    const insertsHere =
      start === end && !inserted && start >= partStart && start <= partEnd;
    if (!(overlaps || insertsHere)) {
      continue;
    }

    if ("raw" in part) {
      const localStart = Math.max(start, partStart) - partStart;
      const localEnd = overlaps
        ? Math.min(end, partEnd) - partStart
        : localStart;
      const nextText = `${part.current.slice(0, localStart)}${inserted ? "" : value}${part.current.slice(localEnd)}`;
      splices.push(textLeafSplice(part, nextText));
    } else if (overlaps) {
      splices.push(
        spliceRange(part.node, inserted ? "" : formatRichText(value))
      );
    } else if (insertsHere) {
      const at =
        start === partStart ? (part.node.start ?? 0) : (part.node.end ?? 0);
      splices.push({ from: at, text: formatRichText(value), to: at });
    }

    inserted = true;
  }

  if (!inserted && start === end && start === offset) {
    const last = parts.at(-1);
    if (!last) {
      return { error: "element has no editable text" };
    }
    if ("raw" in last) {
      splices.push(textLeafSplice(last, `${last.current}${value}`));
    } else {
      splices.push({
        from: last.node.end ?? 0,
        text: formatRichText(value),
        to: last.node.end ?? 0,
      });
    }
  }

  return splices;
}

function buildTextContentSplices(
  element: t.JSXElement,
  value: string,
  prevText: string
): Splice[] | { error: string } {
  const parts = collectTextRangeParts(element);
  const current = textRangeContent(parts);
  if (!textMatchesExpected(current, prevText)) {
    return { error: "no text candidate matches the current value" };
  }
  const diff = textDiff(current, value);
  if (diff.start === diff.end && diff.value === "") {
    return [];
  }
  return buildTextRangeReplaceSplices(parts, diff.start, diff.end, diff.value);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
function buildTextRangeStyleSplices(
  ast: t.File,
  source: string,
  element: t.JSXElement,
  start: number,
  end: number,
  op: { key: string; value: string | null },
  prevText?: string
): Splice[] | { error: string } | null {
  if (
    !(Number.isInteger(start) && Number.isInteger(end)) ||
    start < 0 ||
    end <= start
  ) {
    return { error: "invalid text range" };
  }

  const parts = collectTextRangeParts(element);
  const renderedText = textRangeContent(parts);
  const current = prevText ?? renderedText;
  if (!current) {
    return { error: "element has no editable text" };
  }
  if (end > current.length) {
    return { error: "text range is out of bounds" };
  }
  if (prevText !== undefined && renderedText !== prevText) {
    if (elementTextCandidateMatches(ast, element, prevText)) {
      const result = buildStyleSplice(source, element, [op]);
      if (result && "error" in result) {
        return result;
      }
      return result ? [result] : [];
    }
    return { error: "no text candidate matches the current value" };
  }

  const splices: Splice[] = [];
  let leafStart = 0;
  for (const leaf of parts) {
    const leafEnd = leafStart + leaf.current.length;
    if (!("raw" in leaf)) {
      leafStart = leafEnd;
      continue;
    }
    const selectedStart = Math.max(start, leafStart);
    const selectedEnd = Math.min(end, leafEnd);
    if (selectedStart >= selectedEnd) {
      leafStart = leafEnd;
      continue;
    }

    if (
      selectedStart === leafStart &&
      selectedEnd === leafEnd &&
      t.isJSXElement(leaf.parent) &&
      leaf.parent !== element &&
      isOnlyMeaningfulChild(leaf.parent, leaf.node)
    ) {
      const result = buildStyleSplice(source, leaf.parent, [op]);
      if (result && "error" in result) {
        return result;
      }
      if (result) {
        splices.push(result);
      }
      leafStart = leafEnd;
      continue;
    }

    const localStart = selectedStart - leafStart;
    const localEnd = selectedEnd - leafStart;
    const rawRange = textLeafRawRange(leaf, localStart, localEnd);
    if (!rawRange) {
      return { error: "text range source mismatch" };
    }
    const { raw } = leaf;
    const { rawStart, rawEnd } = rawRange;
    const before = raw.slice(0, rawStart);
    const selected = leaf.current.slice(localStart, localEnd);
    const after = raw.slice(rawEnd);
    const beforeText = t.isJSXText(leaf.node)
      ? before
      : formatOptionalText(before, leaf.text);
    const afterText = t.isJSXText(leaf.node)
      ? after
      : formatOptionalText(after, leaf.text);
    splices.push(
      spliceRange(
        leaf.node,
        `${beforeText}${styleSpanForText(selected, op.key, op.value)}${afterText}`
      )
    );
    leafStart = leafEnd;
  }

  return splices.length > 0 ? splices : null;
}

// `<Wrap>{children}</Wrap>` and `<h2>{title}</h2>` — sole child is a
// JSXExpressionContainer wrapping a bare Identifier. Returns the identifier
// name; callers branch on `'children'` vs. a generic prop passthrough.
function propPassthroughName(element: t.JSXElement): string | null {
  const meaningful = meaningfulChildren(element);
  if (meaningful.length !== 1) {
    return null;
  }
  const [child] = meaningful;
  if (!t.isJSXExpressionContainer(child)) {
    return null;
  }
  return t.isIdentifier(child.expression) ? child.expression.name : null;
}

interface EnclosingComponent {
  fn: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
  name: string;
}

// Smallest top-level capitalized function whose body covers `target`.
function findEnclosingComponent(
  ast: t.File,
  target: t.Node
): EnclosingComponent | null {
  let best: EnclosingComponent | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  const targetStart = target.start ?? 0;
  const targetEnd = target.end ?? 0;
  const consider = (name: string, fn: EnclosingComponent["fn"]) => {
    if (!CAPITALIZED.test(name)) {
      return;
    }
    const fnStart = fn.start ?? 0;
    const fnEnd = fn.end ?? 0;
    if (fnStart > targetStart || fnEnd < targetEnd) {
      return;
    }
    const size = fnEnd - fnStart;
    if (size < bestSize) {
      best = { fn, name };
      bestSize = size;
    }
  };
  const visitDecl = (decl: t.Statement) => {
    if (t.isFunctionDeclaration(decl) && decl.id) {
      consider(decl.id.name, decl);
    } else if (t.isVariableDeclaration(decl)) {
      for (const d of decl.declarations) {
        if (!(t.isVariableDeclarator(d) && t.isIdentifier(d.id) && d.init)) {
          continue;
        }
        if (
          t.isArrowFunctionExpression(d.init) ||
          t.isFunctionExpression(d.init)
        ) {
          consider(d.id.name, d.init);
        }
      }
    }
  };
  for (const decl of ast.program.body) {
    visitDecl(decl);
    if (
      t.isExportNamedDeclaration(decl) ||
      t.isExportDefaultDeclaration(decl)
    ) {
      const inner = decl.declaration;
      if (inner && (t.isStatement(inner) || t.isFunctionDeclaration(inner))) {
        visitDecl(inner as t.Statement);
      }
    }
  }
  return best;
}

function componentDestructuresProp(
  fn: EnclosingComponent["fn"],
  propName: string
): boolean {
  if (fn.params.length === 0) {
    return false;
  }
  let first: t.Node | undefined = fn.params[0];
  // Handle `({ title }: Props = defaults)` — strip the default-value wrapper.
  if (t.isAssignmentPattern(first)) {
    first = first.left;
  }
  if (!t.isObjectPattern(first)) {
    return false;
  }
  for (const prop of first.properties) {
    if (!t.isObjectProperty(prop)) {
      continue;
    }
    if (t.isIdentifier(prop.key) && prop.key.name === propName) {
      return true;
    }
    if (t.isStringLiteral(prop.key) && prop.key.value === propName) {
      return true;
    }
  }
  return false;
}

function collectCallSiteCandidates(
  ast: t.Node,
  componentName: string
): TextCandidate[] {
  const out: TextCandidate[] = [];
  walkJsx(ast, (n) => {
    if (!t.isJSXElement(n)) {
      return;
    }
    const elName = n.openingElement.name;
    if (t.isJSXIdentifier(elName) && elName.name === componentName) {
      collectTextCandidates(n, out);
    }
  });
  return out;
}

function collectPropCallSiteCandidates(
  ast: t.Node,
  componentName: string,
  propName: string
): TextCandidate[] {
  const out: TextCandidate[] = [];
  walkJsx(ast, (n) => {
    if (!t.isJSXElement(n)) {
      return;
    }
    const elName = n.openingElement.name;
    if (!t.isJSXIdentifier(elName) || elName.name !== componentName) {
      return;
    }
    const attr = findJsxAttr(n.openingElement, propName);
    if (!attr?.value) {
      return; // shorthand-true: not editable text.
    }
    const v = attr.value;
    if (t.isStringLiteral(v)) {
      out.push({
        current: v.value,
        splice: (s) => spliceRange(v, formatJsxAttrValue(s)),
      });
    } else if (t.isJSXExpressionContainer(v)) {
      const expr = v.expression;
      if (t.isStringLiteral(expr) || t.isNumericLiteral(expr)) {
        out.push({
          current: String(expr.value),
          splice: (s) => spliceRange(v, formatJsxAttrValue(s)),
        });
      }
    }
  });
  return out;
}

// Smallest enclosing `arr.map((p) => …)` callback (or `.flatMap`) that
// covers `target`. Returns the callback fn plus the array argument node.
function findEnclosingMapCallback(
  ast: t.Node,
  target: t.Node
): {
  fn: t.ArrowFunctionExpression | t.FunctionExpression;
  arrayArg: t.Expression;
} | null {
  interface Best {
    arrayArg: t.Expression;
    fn: t.ArrowFunctionExpression | t.FunctionExpression;
    size: number;
  }
  let best: Best | null = null;
  const targetStart = target.start ?? 0;
  const targetEnd = target.end ?? 0;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
  walkAll(ast, (node) => {
    if (!t.isCallExpression(node)) {
      return;
    }
    const { callee } = node;
    if (!t.isMemberExpression(callee) || callee.computed) {
      return;
    }
    if (!t.isIdentifier(callee.property)) {
      return;
    }
    if (callee.property.name !== "map" && callee.property.name !== "flatMap") {
      return;
    }
    const [fn] = node.arguments;
    if (
      !(fn && (t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn)))
    ) {
      return;
    }
    const fnStart = fn.start ?? 0;
    const fnEnd = fn.end ?? 0;
    if (fnStart > targetStart || fnEnd < targetEnd) {
      return;
    }
    if (!t.isExpression(callee.object)) {
      return;
    }
    const size = fnEnd - fnStart;
    if (!best || size < best.size) {
      best = { arrayArg: callee.object, fn, size };
    }
  });
  if (!best) {
    return null;
  }
  const found: Best = best;
  return { arrayArg: found.arrayArg, fn: found.fn };
}

type ArrayElement = t.Expression | t.SpreadElement;

// `[ {...}, {...} ]` literal, either inline or via a `const x = [ ... ]`
// declaration the receiver resolves to. Returns the ArrayExpression's
// element list, or null if we can't resolve to a literal.
function resolveArrayLiteralElements(
  ast: t.Node,
  expr: t.Expression
): ArrayElement[] | null {
  const dropHoles = (arr: t.ArrayExpression): ArrayElement[] =>
    arr.elements.filter((e): e is ArrayElement => e !== null);
  if (t.isArrayExpression(expr)) {
    return dropHoles(expr);
  }
  if (!t.isIdentifier(expr)) {
    return null;
  }
  const { name } = expr;
  const useStart = expr.start ?? 0;
  let init: t.ArrayExpression | null = null;
  walkAll(ast, (node) => {
    if (!t.isVariableDeclarator(node)) {
      return;
    }
    if (!t.isIdentifier(node.id) || node.id.name !== name) {
      return;
    }
    const { init: declared } = node;
    if (!(declared && t.isArrayExpression(declared))) {
      return;
    }
    // Must be declared before the use site; pick the most local match.
    if ((declared.start ?? 0) > useStart) {
      return;
    }
    init = declared;
  });
  return init ? dropHoles(init) : null;
}

function findObjectProperty(
  obj: t.Node,
  name: string
): t.ObjectProperty | null {
  if (!t.isObjectExpression(obj)) {
    return null;
  }
  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) {
      continue;
    }
    if (t.isIdentifier(prop.key) && prop.key.name === name) {
      return prop;
    }
    if (t.isStringLiteral(prop.key) && prop.key.value === name) {
      return prop;
    }
  }
  return null;
}

// Decode `{p.field}` (MemberExpression) or `{field}` (Identifier
// destructured from the callback param) into a single field name.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
function decodeMapPassthrough(
  element: t.JSXElement,
  callbackParam: t.Node | undefined
): string | null {
  const meaningful = meaningfulChildren(element);
  if (meaningful.length !== 1) {
    return null;
  }
  const [child] = meaningful;
  if (!t.isJSXExpressionContainer(child)) {
    return null;
  }
  const expr = child.expression;

  if (t.isMemberExpression(expr)) {
    if (expr.computed) {
      return null;
    }
    if (!(t.isIdentifier(expr.object) && t.isIdentifier(expr.property))) {
      return null;
    }
    if (!(callbackParam && t.isIdentifier(callbackParam))) {
      return null;
    }
    if (callbackParam.name !== expr.object.name) {
      return null;
    }
    return expr.property.name;
  }

  if (t.isIdentifier(expr)) {
    const fieldName = expr.name;
    // Param is `{ field, ... }` destructuring — the identifier names the
    // destructured property. Skip alias/rename forms (`{ field: alias }`).
    if (!(callbackParam && t.isObjectPattern(callbackParam))) {
      return null;
    }
    for (const prop of callbackParam.properties) {
      if (!t.isObjectProperty(prop) || prop.computed) {
        continue;
      }
      if (!t.isIdentifier(prop.key) || prop.key.name !== fieldName) {
        continue;
      }
      // Shorthand `{ field }` → value is also an Identifier with same name.
      // Aliased `{ field: other }` → value is a different identifier; skip.
      return t.isIdentifier(prop.value) && prop.value.name === fieldName
        ? fieldName
        : null;
    }
  }

  return null;
}

function collectArrayMapCandidates(
  ast: t.Node,
  element: t.JSXElement
): TextCandidate[] {
  const ctx = findEnclosingMapCallback(ast, element);
  if (!ctx) {
    return [];
  }
  const fieldName = decodeMapPassthrough(element, ctx.fn.params[0]);
  if (!fieldName) {
    return [];
  }
  const elements = resolveArrayLiteralElements(ast, ctx.arrayArg);
  if (!elements) {
    return [];
  }
  const out: TextCandidate[] = [];
  for (const obj of elements) {
    const prop = findObjectProperty(obj, fieldName);
    if (!prop) {
      continue;
    }
    const v = prop.value;
    if (t.isStringLiteral(v)) {
      out.push({
        current: v.value,
        splice: (s) => spliceRange(v, jsString(s)),
      });
    } else if (t.isNumericLiteral(v)) {
      out.push({
        current: String(v.value),
        splice: (s) => spliceRange(v, jsString(s)),
      });
    }
  }
  return out;
}

function collectElementTextCandidates(
  ast: t.File,
  element: t.JSXElement
): TextCandidate[] {
  const candidates: TextCandidate[] = [];
  collectTextCandidates(element, candidates);
  if (candidates.length === 0) {
    const passthrough = propPassthroughName(element);
    const enclosing = passthrough ? findEnclosingComponent(ast, element) : null;
    if (passthrough === "children" && enclosing) {
      candidates.push(...collectCallSiteCandidates(ast, enclosing.name));
    } else if (
      passthrough &&
      enclosing &&
      componentDestructuresProp(enclosing.fn, passthrough)
    ) {
      candidates.push(
        ...collectPropCallSiteCandidates(ast, enclosing.name, passthrough)
      );
    }
  }
  if (candidates.length === 0) {
    candidates.push(...collectArrayMapCandidates(ast, element));
  }
  return candidates;
}

function elementTextCandidateMatches(
  ast: t.File,
  element: t.JSXElement,
  prevText: string
): boolean {
  const norm = prevText.trim();
  return collectElementTextCandidates(ast, element).some(
    (candidate) => candidate.current === norm
  );
}

function buildTextSplice(
  ast: t.File,
  element: t.JSXElement,
  value: string,
  prevText?: string
): Splice | { error: string } {
  const candidates = collectElementTextCandidates(ast, element);
  const [only, ...others] = candidates;
  if (!only) {
    return { error: "element has no editable text" };
  }
  if (others.length === 0) {
    return only.splice(value);
  }
  if (prevText === undefined) {
    return { error: "element has multiple text candidates; missing prevText" };
  }
  // Trim: JSX collapses surrounding whitespace at render time, so the
  // DOM `prevText` won't have leading/trailing space the source might.
  const norm = prevText.trim();
  const [match, ...alsoMatching] = candidates.filter((c) => c.current === norm);
  if (!match) {
    return { error: "no text candidate matches the current value" };
  }
  if (alsoMatching.length > 0) {
    return {
      error:
        "multiple text candidates share the same value; cannot disambiguate",
    };
  }
  return match.splice(value);
}

type PropOp = Extract<EditOp, { kind: "set-prop" }>;

// `title="…"`, `title={"…"}` and `` title={`…`} `` all hold a plain string.
function stringLiteralValue(node: t.Node | null | undefined): string | null {
  if (t.isStringLiteral(node)) {
    return node.value;
  }
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

interface PropTarget {
  readonly current: string;
  readonly format: (value: string) => string;
  readonly node: t.Node;
}

// The literal a `set-prop` rewrites: the attribute's value, or one element
// of its array literal.
function findPropTarget(
  attr: t.JSXAttribute,
  name: string,
  index: number | null
): PropTarget | { error: string } {
  const { value } = attr;
  const expression = t.isJSXExpressionContainer(value)
    ? value.expression
    : null;
  if (index === null) {
    const current = t.isStringLiteral(value)
      ? value.value
      : stringLiteralValue(expression);
    return value && current !== null
      ? { current, format: formatJsxAttrValue, node: value }
      : { error: `prop "${name}" isn't a string literal` };
  }
  if (!t.isArrayExpression(expression)) {
    return { error: `prop "${name}" isn't an array literal` };
  }
  // A spread before the element shifts every runtime index after it.
  if (
    expression.elements.slice(0, index).some((each) => t.isSpreadElement(each))
  ) {
    return {
      error: `prop "${name}" spreads another array before element ${index}`,
    };
  }
  const item = expression.elements[index];
  if (!item) {
    return { error: `prop "${name}" has no element ${index}` };
  }
  const current = stringLiteralValue(item);
  return current === null
    ? { error: `prop "${name}.${index}" isn't a string literal` }
    : { current, format: jsString, node: item };
}

// Not in open-slide: slide-ui layouts take their text as string props
// (`<Bullets items={["a", "b"]} />`), which have no JSX text to edit.
function buildPropSplice(
  element: t.JSXElement,
  op: PropOp
): Splice | { error: string } {
  const [, name, digits] = PROP_PATH.exec(op.prop) ?? [];
  if (!name) {
    return { error: `invalid prop "${op.prop}"` };
  }
  const index = digits === undefined ? null : Number(digits);
  const opening = element.openingElement;
  const attr = findJsxAttr(opening, name);
  if (!attr) {
    if (index !== null) {
      return {
        error: `prop "${name}" is missing, so it has no element ${index}`,
      };
    }
    const at = opening.attributes.at(-1)?.end ?? opening.name.end ?? 0;
    return {
      from: at,
      text: ` ${name}=${formatJsxAttrValue(op.value)}`,
      to: at,
    };
  }
  const target = findPropTarget(attr, name, index);
  if ("error" in target) {
    return target;
  }
  if (op.prevText !== undefined && target.current !== op.prevText) {
    return { error: "no text candidate matches the current value" };
  }
  return spliceRange(target.node, target.format(op.value));
}

const splicesOverlap = (a: Splice, b: Splice): boolean =>
  a.from < b.to && b.from < a.to;

function buildPropSplices(
  element: t.JSXElement,
  ops: readonly EditOp[],
  others: readonly Splice[]
): Splice[] | { error: string } {
  const seen = new Set<string>();
  const out: Splice[] = [];
  for (const op of ops) {
    if (op.kind !== "set-prop") {
      continue;
    }
    if (seen.has(op.prop)) {
      return { error: `prop "${op.prop}" is set twice in one edit` };
    }
    seen.add(op.prop);
    const result = buildPropSplice(element, op);
    if ("error" in result) {
      return result;
    }
    if ([...others, ...out].some((other) => splicesOverlap(other, result))) {
      return { error: `prop "${op.prop}" overlaps another edit` };
    }
    out.push(result);
  }
  return out;
}

export function applyEdit(
  source: string,
  line: number,
  column: number,
  ops: readonly EditOp[]
): ApplyEditResult {
  const plan = planEdit(source, line, column, ops);
  if (!plan.ok) {
    return plan;
  }
  return plan.splices.length
    ? applySplices(source, plan.splices)
    : { ok: true, source };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ported from open-slide; kept faithful for future syncs.
export function planEdit(
  source: string,
  line: number,
  column: number,
  ops: readonly EditOp[],
  exactLocation = false
):
  | { ok: true; splices: Splice[] }
  | { ok: false; status: number; error: string } {
  if (ops.length === 0) {
    return { ok: true, splices: [] };
  }

  const ast = parseSource(source);
  if (!ast) {
    return { error: "could not parse source", ok: false, status: 422 };
  }
  const element = exactLocation
    ? findJsxByStart(ast, line, column)
    : findElementForEdit(ast, line, column, ops);
  if (!element) {
    return { error: "no JSX element at location", ok: false, status: 422 };
  }

  const splices: Splice[] = [];

  const styleOps = ops.flatMap((op) =>
    op.kind === "set-style" ? [{ key: op.key, value: op.value }] : []
  );
  if (styleOps.length > 0) {
    const result = buildStyleSplice(source, element, styleOps);
    if (result && "error" in result) {
      return { error: result.error, ok: false, status: 422 };
    }
    if (result) {
      splices.push(result);
    }
  }

  for (const op of ops) {
    if (op.kind !== "set-text-range-style") {
      continue;
    }
    const result = buildTextRangeStyleSplices(
      ast,
      source,
      element,
      op.start,
      op.end,
      { key: op.key, value: op.value },
      op.prevText
    );
    if (result && "error" in result) {
      return { error: result.error, ok: false, status: 422 };
    }
    if (result) {
      splices.push(...result);
    }
  }

  for (const op of ops) {
    if (op.kind !== "set-text") {
      continue;
    }
    if (
      op.prevText !== undefined &&
      (op.value.includes("\n") || op.prevText.includes("\n"))
    ) {
      const richResult = buildTextContentSplices(
        element,
        op.value,
        op.prevText
      );
      if (!("error" in richResult)) {
        splices.push(...richResult);
        continue;
      }
    }
    const result = buildTextSplice(ast, element, op.value, op.prevText);
    if ("error" in result) {
      if (op.prevText === undefined) {
        return { error: result.error, ok: false, status: 422 };
      }
      const richResult = buildTextContentSplices(
        element,
        op.value,
        op.prevText
      );
      if ("error" in richResult) {
        return { error: result.error, ok: false, status: 422 };
      }
      splices.push(...richResult);
    } else {
      splices.push(result);
    }
  }

  const propSplices = buildPropSplices(element, ops, splices);
  if ("error" in propSplices) {
    return { error: propSplices.error, ok: false, status: 422 };
  }
  splices.push(...propSplices);

  return { ok: true, splices };
}
