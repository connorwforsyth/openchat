import { err, ok, type Result } from "@workspace/shared/result";

import { columnLetters, parseAddress } from "./schema";

// Formulas (166): Excel's grammar, the part a spreadsheet artifact uses.
// Numbers, "text" (with "" for a quote), TRUE and FALSE, references (A1,
// $A$1, Sheet2!B3, 'My sheet'!C4), ranges (A1:B3), function calls, unary
// - and +, a trailing %, and the operators ^ * / + - & = <> < > <= >=. It
// parses to a tree, pure, and remembers where each reference was written so
// a formula can be copied to other cells with its relative references moved.

export interface CellRef {
  readonly col: number;
  readonly colAbsolute: boolean;
  readonly row: number;
  readonly rowAbsolute: boolean;
  /** The sheet it names; left out, the formula's own. */
  readonly sheet?: string;
}

export type BinaryOperator =
  | "-"
  | "*"
  | "/"
  | "&"
  | "^"
  | "+"
  | "<"
  | "<="
  | "<>"
  | "="
  | ">"
  | ">=";

export type FormulaNode =
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "string"; readonly value: string }
  | { readonly ref: CellRef; readonly type: "ref" }
  | { readonly end: CellRef; readonly start: CellRef; readonly type: "range" }
  | {
      readonly args: readonly FormulaNode[];
      readonly name: string;
      readonly type: "call";
    }
  | {
      readonly op: "-" | "%" | "+";
      readonly operand: FormulaNode;
      readonly type: "unary";
    }
  | {
      readonly left: FormulaNode;
      readonly op: BinaryOperator;
      readonly right: FormulaNode;
      readonly type: "binary";
    };

/** A reference as written: where in the source, and what it says. */
export interface RefSpan {
  readonly end: number;
  readonly ref: CellRef;
  readonly start: number;
}

export interface ParsedFormula {
  readonly node: FormulaNode;
  readonly refs: readonly RefSpan[];
}

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_][\w.]*/;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(!])/;
const QUOTED_SHEET = /^'((?:[^']|'')+)'!/;
const BARE_SHEET = /^([A-Za-z_][\w.]*)!/;
const WHOLE_LINE = /^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}(?![\w(])|^\$?\d+:\$?\d+/;
const SPACE = /\s/;
const COMPARISONS = ["<=", ">=", "<>", "=", "<", ">"] as const;

const SYNTAX_ERROR = "FormulaSyntaxError";

/**
 * A recursive-descent parser over the source. Internally it throws a
 * syntax error to unwind from deep in an expression; `parseFormula` catches
 * it and returns it as a value, so nothing escapes.
 */
const parser = (source: string) => {
  let at = 0;
  const refs: RefSpan[] = [];

  const fail = (message: string): never => {
    const error = new Error(message);
    error.name = SYNTAX_ERROR;
    throw error;
  };
  const skip = () => {
    while (at < source.length && SPACE.test(source.charAt(at))) {
      at += 1;
    }
  };
  const rest = () => source.slice(at);
  const peek = (text: string) => {
    skip();
    return source.startsWith(text, at);
  };
  const take = (text: string) => {
    if (peek(text)) {
      at += text.length;
      return true;
    }
    return false;
  };

  const cellRef = (sheet: string | undefined): CellRef | null => {
    const match = CELL.exec(rest());
    if (!match) {
      return null;
    }
    const [whole, colDollar, letters = "", rowDollar, digits = ""] = match;
    const address = parseAddress(`${letters}${digits}`);
    if (!address) {
      return null;
    }
    at += whole.length;
    return {
      col: address.col,
      colAbsolute: colDollar === "$",
      row: address.row,
      rowAbsolute: rowDollar === "$",
      ...(sheet === undefined ? {} : { sheet }),
    };
  };

  /** A reference or range, sheet-qualified or not; `null` when there isn't one here. */
  const reference = (): FormulaNode | null => {
    skip();
    const begin = at;
    let sheet: string | undefined;
    const quoted = QUOTED_SHEET.exec(rest());
    const bare = quoted ? null : BARE_SHEET.exec(rest());
    if (quoted) {
      sheet = (quoted[1] ?? "").replaceAll("''", "'");
      at += quoted[0].length;
    } else if (bare) {
      [, sheet] = bare;
      at += bare[0].length;
    }
    if (WHOLE_LINE.test(rest())) {
      fail(
        "whole-column and whole-row ranges (A:A, 1:1) aren't supported: give the rows, as in A1:A100"
      );
    }
    const start = cellRef(sheet);
    if (!start) {
      if (sheet !== undefined) {
        fail(`"${source.slice(begin, at)}" isn't followed by a cell like A1`);
      }
      at = begin;
      return null;
    }
    refs.push({ end: at, ref: start, start: begin });
    if (source.charAt(at) === ":") {
      const colon = at;
      at += 1;
      const end = cellRef(sheet);
      if (!end) {
        fail(`the range at "${source.slice(begin, colon + 1)}" has no end`);
      }
      const last = end as CellRef;
      refs.push({ end: at, ref: last, start: colon + 1 });
      return { end: last, start, type: "range" };
    }
    return { ref: start, type: "ref" };
  };

  const call = (name: string): FormulaNode => {
    const args: FormulaNode[] = [];
    if (!take(")")) {
      do {
        // An empty argument (`IF(A1,,2)`) is Excel's blank: read it as "".
        if (peek(",") || peek(")")) {
          args.push({ type: "string", value: "" });
        } else {
          args.push(expression());
        }
      } while (take(","));
      if (!take(")")) {
        fail(`${name}( is missing its closing )`);
      }
    }
    return { args, name: name.toUpperCase(), type: "call" };
  };

  /** A "text" literal, `""` standing for one quote. */
  const textLiteral = (): FormulaNode => {
    let value = "";
    at += 1;
    while (at < source.length) {
      const next = source.charAt(at);
      if (next === '"' && source.charAt(at + 1) === '"') {
        value += '"';
        at += 2;
      } else if (next === '"') {
        at += 1;
        return { type: "string", value };
      } else {
        value += next;
        at += 1;
      }
    }
    return fail("a text value is missing its closing quote");
  };

  /** A function call, or TRUE or FALSE; `null` when there's no name here. */
  const named = (): FormulaNode | null => {
    const name = NAME.exec(rest());
    if (!name) {
      return null;
    }
    at += name[0].length;
    if (take("(")) {
      return call(name[0]);
    }
    const upper = name[0].toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") {
      return { type: "boolean", value: upper === "TRUE" };
    }
    return fail(
      `"${name[0]}" isn't a cell, a function call or TRUE/FALSE (named ranges aren't supported; put text in quotes)`
    );
  };

  const primary = (): FormulaNode => {
    skip();
    const char = source.charAt(at);
    if (char === "") {
      return fail("the formula ends too soon");
    }
    if (take("(")) {
      const inner = expression();
      if (!take(")")) {
        fail("a ( is missing its closing )");
      }
      return inner;
    }
    if (char === '"') {
      return textLiteral();
    }
    const number = NUMBER.exec(rest());
    if (number) {
      at += number[0].length;
      return { type: "number", value: Number(number[0]) };
    }
    const ref = reference();
    if (ref) {
      return ref;
    }
    return named() ?? fail(`unexpected "${char}"`);
  };

  const postfix = (): FormulaNode => {
    let node = primary();
    while (take("%")) {
      node = { op: "%", operand: node, type: "unary" };
    }
    return node;
  };

  const unary = (): FormulaNode => {
    if (take("-")) {
      return { op: "-", operand: unary(), type: "unary" };
    }
    if (take("+")) {
      return { op: "+", operand: unary(), type: "unary" };
    }
    return postfix();
  };

  const power = (): FormulaNode => {
    let left = unary();
    while (take("^")) {
      left = { left, op: "^", right: unary(), type: "binary" };
    }
    return left;
  };

  const product = (): FormulaNode => {
    let left = power();
    for (;;) {
      if (take("*")) {
        left = { left, op: "*", right: power(), type: "binary" };
      } else if (take("/")) {
        left = { left, op: "/", right: power(), type: "binary" };
      } else {
        return left;
      }
    }
  };

  const sum = (): FormulaNode => {
    let left = product();
    for (;;) {
      if (take("+")) {
        left = { left, op: "+", right: product(), type: "binary" };
      } else if (take("-")) {
        left = { left, op: "-", right: product(), type: "binary" };
      } else {
        return left;
      }
    }
  };

  const concat = (): FormulaNode => {
    let left = sum();
    while (take("&")) {
      left = { left, op: "&", right: sum(), type: "binary" };
    }
    return left;
  };

  function expression(): FormulaNode {
    let left = concat();
    for (;;) {
      const op = COMPARISONS.find((each) => take(each));
      if (!op) {
        return left;
      }
      left = { left, op, right: concat(), type: "binary" };
    }
  }

  return {
    parse: (): ParsedFormula => {
      const node = expression();
      skip();
      if (at < source.length) {
        fail(`unexpected "${source.slice(at, at + 10)}"`);
      }
      return { node, refs };
    },
  };
};

const LEADING_EQUALS = /^\s*=/;

/** Parses a formula (with or without its leading `=`). Pure. */
export const parseFormula = (
  formula: string
): Result<ParsedFormula, string> => {
  const source = formula.replace(LEADING_EQUALS, "");
  if (source.trim() === "") {
    return err("the formula is empty");
  }
  try {
    return ok(parser(source).parse());
  } catch (error) {
    if (error instanceof Error && error.name === SYNTAX_ERROR) {
      return err(error.message);
    }
    throw error;
  }
};

/** A node's operands, in order. */
const childrenOf = (node: FormulaNode): readonly FormulaNode[] => {
  switch (node.type) {
    case "call":
      return node.args;
    case "unary":
      return [node.operand];
    case "binary":
      return [node.left, node.right];
    case "boolean":
    case "number":
    case "string":
    case "ref":
    case "range":
      return [];
    default:
      return node satisfies never;
  }
};

/** Every node of a formula's tree, depth first. */
const nodesOf = (node: FormulaNode): readonly FormulaNode[] => [
  node,
  ...childrenOf(node).flatMap(nodesOf),
];

/** Every function a formula calls, upper-cased, once each. */
export const functionsOf = (node: FormulaNode): readonly string[] => [
  ...new Set(
    nodesOf(node).flatMap((each) => (each.type === "call" ? [each.name] : []))
  ),
];

/** A cell or range a formula reads: a cell is a range of one. */
export interface Reference {
  readonly end: CellRef;
  readonly start: CellRef;
}

/** Every cell and range a formula reads, in order. */
export const referencesOf = (node: FormulaNode): readonly Reference[] =>
  nodesOf(node).flatMap((each): Reference[] => {
    if (each.type === "ref") {
      return [{ end: each.ref, start: each.ref }];
    }
    return each.type === "range" ? [{ end: each.end, start: each.start }] : [];
  });

const PLAIN_SHEET = /^[A-Za-z_][\w.]*$/;

const quoteSheet = (sheet: string): string =>
  PLAIN_SHEET.test(sheet) && !CELL.test(sheet)
    ? sheet
    : `'${sheet.replaceAll("'", "''")}'`;

/** A reference as a formula writes it. */
export const printRef = (ref: CellRef): string =>
  `${ref.sheet === undefined ? "" : `${quoteSheet(ref.sheet)}!`}${ref.colAbsolute ? "$" : ""}${columnLetters(ref.col)}${ref.rowAbsolute ? "$" : ""}${ref.row + 1}`;

/**
 * The formula as it reads when copied `cols` across and `rows` down: its
 * relative references move, `$` ones stay. A reference moved off the grid
 * is an error, as Excel's #REF! is. Pure.
 */
export const shiftFormula = (
  formula: string,
  cols: number,
  rows: number
): Result<string, string> => {
  const source = formula.replace(LEADING_EQUALS, "");
  const parsed = parseFormula(source);
  if (!parsed.ok) {
    return parsed;
  }
  let out = "";
  let from = 0;
  for (const span of parsed.value.refs) {
    const { ref } = span;
    const moved: CellRef = {
      ...ref,
      col: ref.colAbsolute ? ref.col : ref.col + cols,
      row: ref.rowAbsolute ? ref.row : ref.row + rows,
    };
    if (moved.col < 0 || moved.row < 0) {
      return err(
        `copying "=${source}" moves ${printRef(ref)} off the sheet; use $ to keep it fixed`
      );
    }
    const sheetText = source.slice(span.start, span.end);
    // A range's end carries the sheet only once, before its start.
    const printed = printRef(moved);
    const keepsSheet = sheetText.includes("!");
    out += source.slice(from, span.start);
    out += keepsSheet ? printed : printed.slice(printed.indexOf("!") + 1);
    from = span.end;
  }
  return ok(out + source.slice(from));
};

/**
 * The formula with its references to sheet `from` naming `to` instead, for
 * a renamed sheet. A formula that doesn't parse is left as it is. Pure.
 */
export const renameSheetIn = (
  formula: string,
  from: string,
  to: string
): string => {
  const source = formula.replace(LEADING_EQUALS, "");
  const parsed = parseFormula(source);
  if (!parsed.ok) {
    return formula;
  }
  const wanted = from.trim().toLowerCase();
  let out = "";
  let last = 0;
  for (const span of parsed.value.refs) {
    const written = source.slice(span.start, span.end);
    if (
      span.ref.sheet?.trim().toLowerCase() === wanted &&
      written.includes("!")
    ) {
      out += source.slice(last, span.start);
      out += printRef({ ...span.ref, sheet: to });
      last = span.end;
    }
  }
  return out + source.slice(last);
};
