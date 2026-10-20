import { type ComputedValue, isCellError, numberText } from "./evaluate";

// Number formats (166): the common part of Excel's, for showing a cell.
// `0`, `0.00`, `#,##0`, `#,##0.00`, a trailing `%`, and literal text either
// side (`$#,##0.00`, `0.0 "kg"`). Anything else shows the plain number; the
// format still goes to Excel as written, which knows the rest. Pure.

const NUMBER_PART = /([#0,]*0)(?:\.(0+))?/;

/** A value as its cell shows it, in `locale`. */
export const formatValue = (
  value: ComputedValue,
  fmt: string | undefined,
  locale = "en"
): string => {
  if (value === null) {
    return "";
  }
  if (isCellError(value)) {
    return value.error;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "string") {
    return value;
  }
  const match = fmt === undefined ? null : NUMBER_PART.exec(fmt);
  if (!(fmt && match)) {
    return numberText(value);
  }
  const before = fmt.slice(0, match.index).replaceAll('"', "");
  const after = fmt.slice(match.index + match[0].length).replaceAll('"', "");
  const percent = after.includes("%");
  const decimals = match[2]?.length ?? 0;
  const text = new Intl.NumberFormat(locale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
    useGrouping: (match[1] ?? "").includes(","),
  }).format(Math.abs(percent ? value * 100 : value));
  return `${value < 0 ? "-" : ""}${before}${text}${after}`;
};
