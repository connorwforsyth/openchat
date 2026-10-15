import {
  ABS,
  AND,
  AVERAGE,
  AVERAGEIF,
  AVERAGEIFS,
  CEILING,
  CHOOSE,
  COLUMNS,
  CONCAT,
  CONCATENATE,
  COUNT,
  COUNTA,
  COUNTBLANK,
  COUNTIF,
  COUNTIFS,
  EXACT,
  EXP,
  FIND,
  FLOOR,
  FV,
  HLOOKUP,
  IFS,
  INDEX,
  INT,
  IRR,
  ISBLANK,
  ISLOGICAL,
  ISNUMBER,
  ISTEXT,
  LARGE,
  LEFT,
  LEN,
  LN,
  LOG,
  LOG10,
  LOOKUP,
  LOWER,
  MATCH,
  MAX,
  MAXIFS,
  MEDIAN,
  MID,
  MIN,
  MINIFS,
  MOD,
  MODE,
  NOT,
  NPER,
  NPV,
  OR,
  PI,
  PMT,
  POWER,
  PRODUCT,
  PROPER,
  PV,
  RANK,
  RATE,
  REPLACE,
  REPT,
  RIGHT,
  ROUND,
  ROUNDDOWN,
  ROUNDUP,
  ROWS,
  SEARCH,
  SIGN,
  SMALL,
  SQRT,
  STDEV,
  STDEVP,
  SUBSTITUTE,
  SUM,
  SUMIF,
  SUMIFS,
  SUMPRODUCT,
  SWITCH,
  TEXTJOIN,
  TRIM,
  TRUNC,
  UPPER,
  VALUE,
  VAR,
  VARP,
  VLOOKUP,
  XOR,
} from "@formulajs/formulajs";

// The functions a spreadsheet's formulas may call (166), by name: a subset
// of `@formulajs/formulajs` (MIT), which implements them as Excel does.
// Deterministic ones only: no RAND, NOW or TODAY, so a version always
// computes the same values wherever it's opened. Dates aren't in it yet
// (formulajs returns JavaScript dates in the local time zone). IF, IFERROR
// and IFNA are the evaluator's own, so the branch not taken isn't computed,
// as are ISERROR and ISNA, which look at the evaluator's errors.

type FormulaFunction = (...args: unknown[]) => unknown;

/** The functions formulajs computes for us, in the guide's groups. */
const GROUPS = {
  logic: { AND, CHOOSE, IFS, NOT, OR, SWITCH, XOR },
  lookup: { COLUMNS, HLOOKUP, INDEX, LOOKUP, MATCH, ROWS, VLOOKUP },
  math: {
    ABS,
    CEILING,
    EXP,
    FLOOR,
    INT,
    LN,
    LOG,
    LOG10,
    MOD,
    PI,
    POWER,
    PRODUCT,
    ROUND,
    ROUNDDOWN,
    ROUNDUP,
    SIGN,
    SQRT,
    SUM,
    SUMIF,
    SUMIFS,
    SUMPRODUCT,
    TRUNC,
  },
  money: { FV, IRR, NPER, NPV, PMT, PV, RATE },
  statistics: {
    AVERAGE,
    AVERAGEIF,
    AVERAGEIFS,
    COUNT,
    COUNTA,
    COUNTBLANK,
    COUNTIF,
    COUNTIFS,
    LARGE,
    MAX,
    MAXIFS,
    MEDIAN,
    MIN,
    MINIFS,
    MODE,
    RANK,
    SMALL,
    STDEV,
    STDEVP,
    VAR,
    VARP,
  },
  tests: { ISBLANK, ISLOGICAL, ISNUMBER, ISTEXT },
  text: {
    CONCAT,
    CONCATENATE,
    EXACT,
    FIND,
    LEFT,
    LEN,
    LOWER,
    MID,
    PROPER,
    REPLACE,
    REPT,
    RIGHT,
    SEARCH,
    SUBSTITUTE,
    TEXTJOIN,
    TRIM,
    UPPER,
    VALUE,
  },
} as const;

/** Functions the evaluator implements itself, by the group the guide lists them in. */
const OWN_GROUPS: Readonly<
  Partial<Record<keyof typeof GROUPS, readonly string[]>>
> = {
  logic: ["IF", "IFERROR", "IFNA"],
  tests: ["ISERROR", "ISNA"],
};

/** What the guide lists, in its groups. */
export const SPREADSHEET_FUNCTION_GROUPS: Readonly<
  Record<string, readonly string[]>
> = Object.fromEntries(
  Object.entries(GROUPS).map(([group, functions]) => [
    group,
    [
      ...(OWN_GROUPS[group as keyof typeof GROUPS] ?? []),
      ...Object.keys(functions),
    ],
  ])
);

/** Every function the guide lists. */
export const SPREADSHEET_FUNCTIONS: readonly string[] = Object.values(
  SPREADSHEET_FUNCTION_GROUPS
).flat();

/** Functions the evaluator implements itself. */
export const OWN_FUNCTIONS: ReadonlySet<string> = new Set(
  Object.values(OWN_GROUPS).flat()
);

/** Every function formulajs computes for us, by name. */
export const FORMULA_FUNCTIONS: Readonly<Record<string, FormulaFunction>> =
  Object.assign({}, ...Object.values(GROUPS));

/** Whether a formula may call `name` (upper-case). */
export const isSupportedFunction = (name: string): boolean =>
  Object.hasOwn(FORMULA_FUNCTIONS, name) || OWN_FUNCTIONS.has(name);

/** Functions that look at an error rather than pass it on. */
export const ERROR_AWARE_FUNCTIONS: ReadonlySet<string> = new Set([
  "COUNT",
  "COUNTA",
  "COUNTBLANK",
  "ISBLANK",
  "ISLOGICAL",
  "ISNUMBER",
  "ISTEXT",
]);
