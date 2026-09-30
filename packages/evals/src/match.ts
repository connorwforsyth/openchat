// Matching for assertions. Pure.

/**
 * What a tool call's arguments (or any value) must look like: a predicate,
 * a regular expression for a string, or a value whose object keys must all
 * match (extra keys on the actual value are fine, so a matcher names only
 * what the case is about). Arrays match element by element, same length.
 */
export type Matcher =
  | RegExp
  | ((actual: unknown) => boolean)
  | string
  | number
  | boolean
  | null
  | readonly Matcher[]
  | { readonly [key: string]: Matcher };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const matches = (actual: unknown, matcher: Matcher): boolean => {
  if (typeof matcher === "function") {
    return matcher(actual);
  }
  if (matcher instanceof RegExp) {
    return typeof actual === "string" && matcher.test(actual);
  }
  if (Array.isArray(matcher)) {
    return (
      Array.isArray(actual) &&
      actual.length === matcher.length &&
      matcher.every((each, index) => matches(actual[index], each))
    );
  }
  if (isRecord(matcher)) {
    return (
      isRecord(actual) &&
      Object.entries(matcher).every(([key, each]) =>
        matches(actual[key], each as Matcher)
      )
    );
  }
  return Object.is(actual, matcher);
};

/** Structural equality over JSON-like values (what the API returns). */
export const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((each, index) => deepEqual(each, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && deepEqual(left[key], right[key]))
    );
  }
  return false;
};

const MAX_SHOWN = 400;

/** A value as the report shows it: JSON, cut to a readable length. */
export const show = (value: unknown): string => {
  let text: string;
  if (typeof value === "string") {
    text = JSON.stringify(value);
  } else if (value instanceof RegExp || typeof value === "function") {
    text = String(value);
  } else {
    text =
      JSON.stringify(value, (_key, each: unknown) =>
        each instanceof RegExp || typeof each === "function"
          ? String(each)
          : each
      ) ?? String(value);
  }
  return text.length > MAX_SHOWN
    ? `${text.slice(0, MAX_SHOWN)}… (${text.length} characters)`
    : text;
};
