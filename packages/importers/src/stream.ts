import { IMPORT_LIMITS } from "./schema";

// Splits a JSON document into its top-level values without parsing the whole
// thing: each element of a root array, or the root object itself. A ChatGPT
// `conversations.json` can run to hundreds of MB, and `JSON.parse` on that
// holds the text and every object at once; here only one conversation's text
// is held and parsed at a time. The scanner tracks strings, escapes and
// nesting only; each value is still parsed by `JSON.parse`.

export type TopLevelItem =
  /** One value: an element of the root array, or the root object. */
  | {
      readonly index: number;
      readonly root: "array" | "object";
      readonly type: "value";
      readonly value: unknown;
    }
  /** A value that was skipped; the scan carries on with the next. */
  | {
      readonly index: number;
      readonly reason: "invalid_json" | "too_large";
      readonly type: "skipped";
    }
  /** The document can't be split any further: the scan stops here. */
  | {
      readonly detail: string;
      readonly index: number;
      readonly type: "fatal";
    };

export interface SplitOptions {
  /** Longest value kept, in UTF-16 code units; longer ones are skipped as `too_large`. */
  readonly maxValueChars?: number;
}

interface ScanState {
  depth: number;
  escape: boolean;
  index: number;
  inString: boolean;
  readonly maxValueChars: number;
  oversized: boolean;
  phase: "start" | "between" | "value" | "end";
  pieces: string[];
  primitive: boolean;
  root: "array" | "object";
  size: number;
}

const isSpace = (char: string): boolean =>
  char === " " ||
  char === "\n" ||
  char === "\r" ||
  char === "\t" ||
  char === "﻿";

const append = (state: ScanState, piece: string): void => {
  state.size += piece.length;
  if (state.size > state.maxValueChars) {
    // Keep counting, stop keeping: the value is skipped when it ends.
    state.oversized = true;
    state.pieces = [];
  } else if (piece) {
    state.pieces.push(piece);
  }
};

/** Ends the current value; `closed` when the character that ended it also closed the array. */
const finishValue = (state: ScanState, closed: boolean): TopLevelItem => {
  const { index, oversized, root } = state;
  state.phase = root === "object" || closed ? "end" : "between";
  const text = state.pieces.join("");
  state.pieces = [];
  state.size = 0;
  state.oversized = false;
  state.index += 1;
  if (oversized) {
    return { index, reason: "too_large", type: "skipped" };
  }
  try {
    return { index, root, type: "value", value: JSON.parse(text) };
  } catch {
    return { index, reason: "invalid_json", type: "skipped" };
  }
};

const startValue = (state: ScanState, char: string): void => {
  state.phase = "value";
  state.depth = 0;
  state.inString = false;
  state.escape = false;
  state.primitive = !(char === "{" || char === "[" || char === '"');
};

/** A character inside a string: tracks escapes; `true` when the string closes. */
const stepInString = (state: ScanState, char: string): boolean => {
  if (state.escape) {
    state.escape = false;
  } else if (char === "\\") {
    state.escape = true;
  } else if (char === '"') {
    state.inString = false;
    return true;
  }
  return false;
};

/** Whether `char` ends the current value: `"at"` includes it, `"before"` doesn't. */
const step = (state: ScanState, char: string): "at" | "before" | null => {
  if (state.inString) {
    return stepInString(state, char) && state.depth === 0 ? "at" : null;
  }
  if (state.primitive) {
    return char === "," || char === "]" || isSpace(char) ? "before" : null;
  }
  if (char === '"') {
    state.inString = true;
  } else if (char === "{" || char === "[") {
    state.depth += 1;
  } else if (char === "}" || char === "]") {
    state.depth -= 1;
    return state.depth === 0 ? "at" : null;
  }
  return null;
};

type Outside = "skip" | "begin" | { readonly fatal: string };

/** A character between values: skip it, begin a value with it, or give up. */
const outside = (state: ScanState, char: string): Outside => {
  if (isSpace(char)) {
    return "skip";
  }
  switch (state.phase) {
    case "start":
      if (char === "[") {
        state.phase = "between";
        return "skip";
      }
      if (char === "{") {
        state.root = "object";
        return "begin";
      }
      return { fatal: "not a JSON array or object" };
    case "between":
      if (char === ",") {
        return "skip";
      }
      if (char === "]") {
        state.phase = "end";
        return "skip";
      }
      return "begin";
    default:
      return { fatal: "content after the end" };
  }
};

function* feed(state: ScanState, text: string): Generator<TopLevelItem> {
  let start = state.phase === "value" ? 0 : -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (state.phase !== "value") {
      const action = outside(state, char);
      if (action === "skip") {
        continue;
      }
      if (action !== "begin") {
        yield { detail: action.fatal, index: state.index, type: "fatal" };
        return;
      }
      startValue(state, char);
      start = i;
    }
    const ends = step(state, char);
    if (ends !== null) {
      append(state, text.slice(start, ends === "at" ? i + 1 : i));
      // A number or literal ends at the `]` that closes the array.
      const closed = ends === "before" && char === "]";
      yield finishValue(state, closed);
      start = -1;
    }
  }
  if (state.phase === "value") {
    append(state, text.slice(Math.max(start, 0)));
  }
}

/** Chunks as text; bytes are decoded as UTF-8, split characters and all. */
async function* texts(
  source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  for await (const chunk of source) {
    yield typeof chunk === "string"
      ? chunk
      : decoder.decode(chunk, { stream: true });
  }
  yield decoder.decode();
}

/** The top-level values of a JSON document read in chunks. */
export async function* splitTopLevel(
  source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
  options: SplitOptions = {}
): AsyncGenerator<TopLevelItem> {
  const state: ScanState = {
    depth: 0,
    escape: false,
    index: 0,
    inString: false,
    maxValueChars: options.maxValueChars ?? IMPORT_LIMITS.maxConversationChars,
    oversized: false,
    phase: "start",
    pieces: [],
    primitive: false,
    root: "array",
    size: 0,
  };
  for await (const text of texts(source)) {
    for (const item of feed(state, text)) {
      yield item;
      if (item.type === "fatal") {
        return;
      }
    }
  }
  if (state.phase !== "end") {
    yield {
      detail: state.phase === "start" ? "empty document" : "ends mid-value",
      index: state.index,
      type: "fatal",
    };
  }
}
