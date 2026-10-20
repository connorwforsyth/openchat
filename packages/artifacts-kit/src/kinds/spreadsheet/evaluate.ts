import { z } from "zod";

import {
  type BinaryOperator,
  type CellRef,
  type FormulaNode,
  functionsOf,
  type ParsedFormula,
  parseFormula,
  printRef,
  type Reference,
  referencesOf,
} from "./formula";
import {
  ERROR_AWARE_FUNCTIONS,
  FORMULA_FUNCTIONS,
  isSupportedFunction,
  OWN_FUNCTIONS,
} from "./functions";
import {
  isFormulaCell,
  parseAddress,
  SPREADSHEET_LIMITS,
  type Spreadsheet,
  toAddress,
} from "./schema";

// The evaluator (166), pure: every formula parsed once, a dependency graph
// between formula cells, a topological order (so a long chain of formulas
// computes without deep recursion), and the cells left over on a cycle.
// Each formula is computed after the cells it reads, by walking its tree,
// with the functions from `functions.ts`. `analyzeSpreadsheet` is the same
// pass, reporting what a check refuses instead of computing.

export const CELL_ERRORS = [
  "#CYCLE!",
  "#DIV/0!",
  "#N/A",
  "#NAME?",
  "#NUM!",
  "#REF!",
  "#VALUE!",
] as const;

export const cellErrorSchema = z.object({ error: z.enum(CELL_ERRORS) });
export type CellError = z.infer<typeof cellErrorSchema>;

/** A cell's computed value: `null` for an empty one. */
export const computedValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
  cellErrorSchema,
]);
export type ComputedValue = z.infer<typeof computedValueSchema>;

export const isCellError = (value: unknown): value is CellError =>
  typeof value === "object" && value !== null && "error" in value;

const failed = (error: CellError["error"]): CellError => ({ error });

/** A sheet's computed values, by address; empty cells are left out. */
export interface EvaluatedSheet {
  readonly name: string;
  readonly values: Readonly<Record<string, ComputedValue>>;
}

export interface Evaluated {
  readonly sheets: readonly EvaluatedSheet[];
}

interface Range {
  readonly kind: "range";
  readonly values: readonly (readonly ComputedValue[])[];
}
type Value = ComputedValue | Range;

const isRange = (value: Value): value is Range =>
  typeof value === "object" && value !== null && "kind" in value;

/** A formula cell, by sheet index and address: `0!B2`. */
const keyOf = (sheet: number, address: string) => `${sheet}!${address}`;

interface Node {
  readonly address: string;
  readonly deps: readonly string[];
  readonly key: string;
  readonly parsed: ParsedFormula | null;
  readonly problems: readonly string[];
  readonly sheet: number;
}

interface Graph {
  /** Formula cells on a cycle (or between two), by key. */
  readonly cycle: ReadonlySet<string>;
  readonly nodes: ReadonlyMap<string, Node>;
  /** Formula cells, each after every formula cell it reads. */
  readonly order: readonly string[];
  readonly sheetIndex: ReadonlyMap<string, number>;
}

const label = (spreadsheet: Spreadsheet, sheet: number, address: string) =>
  spreadsheet.sheets.length > 1
    ? `${spreadsheet.sheets[sheet]?.name ?? ""}!${address}`
    : address;

const refSheet = (
  graph: Pick<Graph, "sheetIndex">,
  own: number,
  ref: CellRef
): number | undefined =>
  ref.sheet === undefined
    ? own
    : graph.sheetIndex.get(ref.sheet.trim().toLowerCase());

const withinGrid = (ref: CellRef) =>
  ref.col < SPREADSHEET_LIMITS.columns && ref.row < SPREADSHEET_LIMITS.rows;

const LAST_COLUMN = toAddress(SPREADSHEET_LIMITS.columns - 1, 0).slice(0, -1);

/** A reference's rows and columns, either corner first. */
const boundsOf = ({ end, start }: Reference) => ({
  bottom: Math.max(start.row, end.row),
  left: Math.min(start.col, end.col),
  right: Math.max(start.col, end.col),
  top: Math.min(start.row, end.row),
});

/**
 * The formula cells one reference reads, by key, or why it can't be read:
 * a sheet that doesn't exist, a cell past the grid, a range past the cap.
 */
const areaReads = (
  sheetIndex: ReadonlyMap<string, number>,
  formulaCells: readonly (readonly FormulaCell[])[],
  sheet: number,
  area: Reference
): readonly string[] | string => {
  const { end, start } = area;
  const target = refSheet({ sheetIndex }, sheet, start);
  if (target === undefined) {
    return `${printRef(start)} refers to a sheet "${start.sheet ?? ""}" that doesn't exist`;
  }
  if (!(withinGrid(start) && withinGrid(end))) {
    return `${printRef(withinGrid(start) ? end : start)} is outside the sheet (columns A to ${LAST_COLUMN}, rows 1 to ${SPREADSHEET_LIMITS.rows})`;
  }
  const { bottom, left, right, top } = boundsOf(area);
  if ((right - left + 1) * (bottom - top + 1) > SPREADSHEET_LIMITS.rangeCells) {
    return `the range ${printRef(start)}:${printRef(end)} covers more than ${SPREADSHEET_LIMITS.rangeCells} cells`;
  }
  return (formulaCells[target] ?? [])
    .filter(
      (cell) =>
        cell.col >= left &&
        cell.col <= right &&
        cell.row >= top &&
        cell.row <= bottom
    )
    .map((cell) => keyOf(target, cell.address));
};

interface FormulaCell {
  readonly address: string;
  readonly col: number;
  readonly formula: string;
  readonly row: number;
}

/** The problems with one formula's references and functions, and what it reads. */
const nodeOf = (
  spreadsheet: Spreadsheet,
  sheetIndex: ReadonlyMap<string, number>,
  formulaCells: readonly (readonly FormulaCell[])[],
  sheet: number,
  address: string,
  formula: string
): Node => {
  const key = keyOf(sheet, address);
  const at = label(spreadsheet, sheet, address);
  const parsed = parseFormula(formula);
  if (!parsed.ok) {
    return {
      address,
      deps: [],
      key,
      parsed: null,
      problems: [
        `${at}: the formula "=${formula}" doesn't parse: ${parsed.error}`,
      ],
      sheet,
    };
  }
  const problems: string[] = [];
  const unknown = functionsOf(parsed.value.node).filter(
    (name) => !isSupportedFunction(name)
  );
  for (const name of unknown) {
    problems.push(
      `${at}: ${name} isn't a supported function. Use one the spreadsheet guide lists`
    );
  }
  const deps = new Set<string>();
  for (const area of referencesOf(parsed.value.node)) {
    const read = areaReads(sheetIndex, formulaCells, sheet, area);
    if (typeof read === "string") {
      problems.push(`${at}: ${read}`);
    } else {
      for (const dep of read) {
        deps.add(dep);
      }
    }
  }
  return {
    address,
    deps: [...deps],
    key,
    parsed: parsed.value,
    problems,
    sheet,
  };
};

/**
 * Kahn's algorithm: each formula cell once every formula it reads is done.
 * What's left is on a cycle or reads one; the readers, which only inherit
 * the error, are trimmed so the cycle can be named on its own.
 */
const orderOf = (
  nodes: ReadonlyMap<string, Node>
): Pick<Graph, "cycle" | "order"> => {
  const waiting = new Map<string, number>();
  const readers = new Map<string, string[]>();
  for (const node of nodes.values()) {
    waiting.set(node.key, node.deps.length);
    for (const dep of node.deps) {
      readers.set(dep, [...(readers.get(dep) ?? []), node.key]);
    }
  }
  const ready = [...nodes.keys()].filter((key) => waiting.get(key) === 0);
  const order: string[] = [];
  for (let key = ready.pop(); key !== undefined; key = ready.pop()) {
    order.push(key);
    for (const reader of readers.get(key) ?? []) {
      const left = (waiting.get(reader) ?? 0) - 1;
      waiting.set(reader, left);
      if (left === 0) {
        ready.push(reader);
      }
    }
  }
  const done = new Set(order);
  const cycle = new Set([...nodes.keys()].filter((key) => !done.has(key)));
  const isRead = (key: string) =>
    (readers.get(key) ?? []).some((reader) => cycle.has(reader));
  for (
    let unread = [...cycle].filter((key) => !isRead(key));
    unread.length > 0;
    unread = [...cycle].filter((key) => !isRead(key))
  ) {
    for (const key of unread) {
      cycle.delete(key);
    }
  }
  return { cycle, order };
};

/** Parses every formula and orders them by what they read. Pure. */
const buildGraph = (spreadsheet: Spreadsheet): Graph => {
  const sheetIndex = new Map(
    spreadsheet.sheets.map((sheet, index) => [sheet.name.toLowerCase(), index])
  );
  const formulaCells = spreadsheet.sheets.map((sheet) =>
    Object.entries(sheet.cells).flatMap(([address, cell]) => {
      const at = parseAddress(address);
      return at && isFormulaCell(cell)
        ? [{ address, ...at, formula: cell.f }]
        : [];
    })
  );
  const nodes = new Map<string, Node>();
  for (const [sheet, cells] of formulaCells.entries()) {
    for (const cell of cells) {
      const node = nodeOf(
        spreadsheet,
        sheetIndex,
        formulaCells,
        sheet,
        cell.address,
        cell.formula
      );
      nodes.set(node.key, node);
    }
  }
  const { cycle, order } = orderOf(nodes);
  return { cycle, nodes, order, sheetIndex };
};

const ERROR_NAMES: ReadonlySet<string> = new Set(CELL_ERRORS);

/** formulajs's errors are `Error`s whose message is Excel's code. */
const fromForeign = (value: unknown): ComputedValue => {
  if (value instanceof Error) {
    return failed(
      ERROR_NAMES.has(value.message)
        ? (value.message as CellError["error"])
        : "#VALUE!"
    );
  }
  if (Array.isArray(value)) {
    return fromForeign(value.flat(Number.POSITIVE_INFINITY)[0] ?? null);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : failed("#NUM!");
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return 0;
  }
  return failed("#VALUE!");
};

const toForeign = (value: ComputedValue): unknown =>
  isCellError(value) ? new Error(value.error) : value;

const NUMERIC = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

const toNumber = (value: ComputedValue): number | CellError => {
  if (isCellError(value)) {
    return value;
  }
  if (value === null) {
    return 0;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    return value;
  }
  return NUMERIC.test(value) ? Number(value) : failed("#VALUE!");
};

/** A number as a cell shows it without a format: no floating-point noise. */
export const numberText = (value: number): string =>
  String(Number(value.toPrecision(15)));

const toText = (value: ComputedValue): string | CellError => {
  if (isCellError(value)) {
    return value;
  }
  if (value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return typeof value === "number" ? numberText(value) : value;
};

const toBoolean = (value: ComputedValue): boolean | CellError => {
  if (isCellError(value)) {
    return value;
  }
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") {
      return upper === "TRUE";
    }
    return failed("#VALUE!");
  }
  return Boolean(value);
};

/** Excel's order across types: numbers, then text, then logicals. */
const typeRank = (value: number | string | boolean | null) => {
  if (typeof value === "string") {
    return 1;
  }
  return typeof value === "boolean" ? 2 : 0;
};

const blankLike = (other: ComputedValue): number | string | boolean => {
  if (typeof other === "string") {
    return "";
  }
  return typeof other === "boolean" ? false : 0;
};

const compare = (
  op: BinaryOperator,
  left: ComputedValue,
  right: ComputedValue
): ComputedValue => {
  if (isCellError(left)) {
    return left;
  }
  if (isCellError(right)) {
    return right;
  }
  // An empty cell compares as the other side's empty: "", FALSE or 0.
  const a = left ?? blankLike(right);
  const b = right ?? blankLike(a);
  let order = typeRank(a) - typeRank(b);
  if (order === 0) {
    if (typeof a === "string" && typeof b === "string") {
      order = a.toLowerCase().localeCompare(b.toLowerCase());
    } else {
      order = Number(a) - Number(b);
    }
  }
  switch (op) {
    case "=":
      return order === 0;
    case "<>":
      return order !== 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    default:
      return failed("#VALUE!");
  }
};

const arithmetic = (
  op: "-" | "*" | "/" | "^" | "+",
  left: ComputedValue,
  right: ComputedValue
): ComputedValue => {
  const a = toNumber(left);
  if (isCellError(a)) {
    return a;
  }
  const b = toNumber(right);
  if (isCellError(b)) {
    return b;
  }
  let result: number;
  switch (op) {
    case "+":
      result = a + b;
      break;
    case "-":
      result = a - b;
      break;
    case "*":
      result = a * b;
      break;
    case "/":
      if (b === 0) {
        return failed("#DIV/0!");
      }
      result = a / b;
      break;
    case "^":
      result = a ** b;
      break;
    default:
      return op satisfies never;
  }
  return Number.isFinite(result) ? result : failed("#NUM!");
};

const scalar = (value: Value): ComputedValue =>
  isRange(value) ? failed("#VALUE!") : value;

const unaryOp = (
  op: "-" | "%" | "+",
  operand: ComputedValue
): ComputedValue => {
  const number = toNumber(operand);
  if (isCellError(number)) {
    return number;
  }
  if (op === "%") {
    return number / 100;
  }
  return op === "-" ? -number : number;
};

const binaryOp = (
  op: BinaryOperator,
  left: ComputedValue,
  right: ComputedValue
): ComputedValue => {
  switch (op) {
    case "&": {
      const a = toText(left);
      if (isCellError(a)) {
        return a;
      }
      const b = toText(right);
      return isCellError(b) ? b : a + b;
    }
    case "+":
    case "-":
    case "*":
    case "/":
    case "^":
      return arithmetic(op, left, right);
    default:
      return compare(op, left, right);
  }
};

/**
 * IF, IFERROR, IFNA, ISERROR and ISNA: `at` computes an argument only
 * when it's asked for, so the branch not taken isn't computed.
 */
const ownCall = (
  name: string,
  count: number,
  at: (index: number) => ComputedValue
): ComputedValue => {
  switch (name) {
    case "IF": {
      if (count < 2 || count > 3) {
        return failed("#VALUE!");
      }
      const condition = toBoolean(at(0));
      if (isCellError(condition)) {
        return condition;
      }
      return condition ? at(1) : at(2);
    }
    case "IFERROR":
    case "IFNA": {
      if (count !== 2) {
        return failed("#VALUE!");
      }
      const value = at(0);
      const caught =
        isCellError(value) && (name === "IFERROR" || value.error === "#N/A");
      return caught ? at(1) : value;
    }
    case "ISERROR":
    case "ISNA": {
      if (count !== 1) {
        return failed("#VALUE!");
      }
      const value = at(0);
      return (
        isCellError(value) && (name === "ISERROR" || value.error === "#N/A")
      );
    }
    default:
      return failed("#NAME?");
  }
};

/** A formulajs function, its errors and results translated both ways. */
const foreignCall = (name: string, values: readonly Value[]): ComputedValue => {
  const fn = FORMULA_FUNCTIONS[name];
  if (!fn) {
    return failed("#NAME?");
  }
  if (!ERROR_AWARE_FUNCTIONS.has(name)) {
    const error = values.find(
      (value): value is CellError => !isRange(value) && isCellError(value)
    );
    if (error) {
      return error;
    }
  }
  const foreign = values.map((value) =>
    isRange(value)
      ? value.values.map((line) => line.map(toForeign))
      : toForeign(value)
  );
  try {
    return fromForeign(fn(...foreign));
  } catch {
    return failed("#VALUE!");
  }
};

/** Computes every formula of `spreadsheet`. Pure. */
export const evaluateSpreadsheet = (spreadsheet: Spreadsheet): Evaluated => {
  const graph = buildGraph(spreadsheet);
  const computed = new Map<string, ComputedValue>();

  const cellValue = (
    sheet: number,
    col: number,
    row: number
  ): ComputedValue => {
    const address = toAddress(col, row);
    const cell = spreadsheet.sheets[sheet]?.cells[address];
    if (!cell) {
      return null;
    }
    if (!isFormulaCell(cell)) {
      return cell.v;
    }
    // Not computed yet means it's on (or reads) a cycle.
    return computed.get(keyOf(sheet, address)) ?? failed("#CYCLE!");
  };

  const rangeOf = (
    sheet: number,
    { end, start }: { readonly end: CellRef; readonly start: CellRef }
  ): Value => {
    const target = refSheet(graph, sheet, start);
    const left = Math.min(start.col, end.col);
    const right = Math.max(start.col, end.col);
    const top = Math.min(start.row, end.row);
    const bottom = Math.max(start.row, end.row);
    if (
      target === undefined ||
      right >= SPREADSHEET_LIMITS.columns ||
      bottom >= SPREADSHEET_LIMITS.rows ||
      (right - left + 1) * (bottom - top + 1) > SPREADSHEET_LIMITS.rangeCells
    ) {
      return failed("#REF!");
    }
    if (start === end) {
      return cellValue(target, start.col, start.row);
    }
    const values: ComputedValue[][] = [];
    for (let row = top; row <= bottom; row += 1) {
      const line: ComputedValue[] = [];
      for (let col = left; col <= right; col += 1) {
        line.push(cellValue(target, col, row));
      }
      values.push(line);
    }
    return { kind: "range", values };
  };

  const evaluate = (node: FormulaNode, sheet: number): Value => {
    switch (node.type) {
      case "number":
      case "string":
      case "boolean":
        return node.value;
      case "ref":
        return rangeOf(sheet, { end: node.ref, start: node.ref });
      case "range":
        return rangeOf(sheet, node);
      case "unary":
        return unaryOp(node.op, scalar(evaluate(node.operand, sheet)));
      case "binary":
        return binaryOp(
          node.op,
          scalar(evaluate(node.left, sheet)),
          scalar(evaluate(node.right, sheet))
        );
      case "call": {
        const at = (index: number): ComputedValue => {
          const arg = node.args[index];
          return arg ? scalar(evaluate(arg, sheet)) : false;
        };
        return OWN_FUNCTIONS.has(node.name)
          ? ownCall(node.name, node.args.length, at)
          : foreignCall(
              node.name,
              node.args.map((arg) => evaluate(arg, sheet))
            );
      }
      default:
        return node satisfies never;
    }
  };

  for (const key of graph.order) {
    const node = graph.nodes.get(key);
    if (node) {
      const value = node.parsed
        ? scalar(evaluate(node.parsed.node, node.sheet))
        : failed("#NAME?");
      // A function that isn't supported makes the whole cell #NAME?.
      computed.set(
        key,
        node.problems.length > 0 && !isCellError(value)
          ? failed("#NAME?")
          : value
      );
    }
  }

  return {
    sheets: spreadsheet.sheets.map((each, sheet) => ({
      name: each.name,
      values: Object.fromEntries(
        Object.entries(each.cells).map(([address, cell]) => [
          address,
          isFormulaCell(cell)
            ? (computed.get(keyOf(sheet, address)) ?? failed("#CYCLE!"))
            : cell.v,
        ])
      ),
    })),
  };
};

/**
 * What the checks refuse in a spreadsheet's formulas: ones that don't
 * parse, call a function outside the subset, refer outside the sheets or
 * past the caps, or reach themselves through other cells. Pure.
 */
export const analyzeSpreadsheet = (
  spreadsheet: Spreadsheet
): readonly string[] => {
  const graph = buildGraph(spreadsheet);
  const problems = [...graph.nodes.values()].flatMap((node) => node.problems);
  if (graph.cycle.size > 0) {
    const cells = [...graph.cycle]
      .slice(0, 10)
      .map((key) => {
        const node = graph.nodes.get(key);
        return node ? label(spreadsheet, node.sheet, node.address) : key;
      })
      .join(", ");
    problems.push(
      `these formulas refer to themselves, through each other: ${cells}${graph.cycle.size > 10 ? ", …" : ""}. Break the cycle`
    );
  }
  return problems;
};
