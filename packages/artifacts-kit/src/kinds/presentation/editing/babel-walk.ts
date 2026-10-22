// Ported from open-slide (https://github.com/open-slide/open-slide), commit 1f18ab5,
// packages/core/src/editing/babel-walk.ts. MIT, Copyright (c) 2026 Yiwei Ho; see LICENSE.open-slide.
import { parse as babelParse } from "@babel/parser";
import type { File, JSXElement, JSXFragment, Node } from "@babel/types";

// Local predicates rather than @babel/types' runtime: the artifacts runtime
// stamps slides in the browser, where that module's top-level
// `process.env` read throws and its size isn't wanted.
const isJSXElement = (n: Node | null | undefined): n is JSXElement =>
  n?.type === "JSXElement";
const isJSXFragment = (n: Node | null | undefined): n is JSXFragment =>
  n?.type === "JSXFragment";

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "type",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

// biome-ignore lint/suspicious/noConfusingVoidType: callers return void or 'stop' to short-circuit traversal.
type Visitor = (node: Node) => void | "stop";

function walk(
  ast: unknown,
  visit: Visitor,
  accept: (n: Node) => boolean
): void {
  let stopped = false;
  const recurse = (node: unknown): void => {
    if (stopped || !node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const c of node) {
        recurse(c);
      }
      return;
    }
    const n = node as Node;
    if (typeof n.type !== "string") {
      return;
    }
    if (accept(n) && visit(n) === "stop") {
      stopped = true;
      return;
    }
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) {
        continue;
      }
      recurse((n as unknown as Record<string, unknown>)[key]);
    }
  };
  recurse(ast);
}

const isJsx = (n: Node) => isJSXElement(n) || isJSXFragment(n);
const acceptAll = () => true;

export function walkJsx(ast: unknown, visit: Visitor): void {
  walk(ast, visit, isJsx);
}

export function walkAll(ast: unknown, visit: Visitor): void {
  walk(ast, visit, acceptAll);
}

/** Parse with error recovery; recoverable syntax errors are kept in `errors`. */
export function tryParse(source: string): File | null {
  try {
    return babelParse(source, {
      errorRecovery: true,
      plugins: ["typescript", "jsx"],
      sourceType: "module",
    });
  } catch {
    return null;
  }
}

/** `tryParse`, but a source with any recovered error is rejected outright. */
export function parseSource(source: string): File | null {
  const ast = tryParse(source) as (File & { errors?: unknown[] }) | null;
  if (!ast) {
    return null;
  }
  return ast.errors && ast.errors.length > 0 ? null : ast;
}

export type JsxContainer = JSXElement | JSXFragment;

/** JSX nodes enclosing (line, column), innermost first. */
export function findJsxAncestors(
  ast: Node,
  line: number,
  column: number
): JsxContainer[] {
  const hits: { node: JsxContainer; size: number }[] = [];
  walkJsx(ast, (n) => {
    if (!(n.loc && (isJSXElement(n) || isJSXFragment(n)))) {
      return;
    }
    const s = n.loc.start;
    const e = n.loc.end;
    const afterStart = line > s.line || (line === s.line && column >= s.column);
    const beforeEnd = line < e.line || (line === e.line && column < e.column);
    if (afterStart && beforeEnd) {
      hits.push({ node: n, size: (n.end ?? 0) - (n.start ?? 0) });
    }
  });
  hits.sort((a, b) => a.size - b.size);
  return hits.map((h) => h.node);
}
