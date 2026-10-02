import { codeThemeNames } from "@workspace/code-ui/theme/code-theme";
import { err, type Result } from "@workspace/shared/result";
import type { MessageResponse } from "@workspace/ui/components/ai-elements/message";
import type { ComponentProps } from "react";

// Syntax highlighting for fenced code in model output (ticket 143), as a
// Streamdown code plugin: Streamdown keeps its code block (header, copy and
// download) and asks the plugin for tokens. This module is small and loads
// with the markdown; Shiki loads on the first fence, from `code-highlighter`.
//
// Streamdown calls `highlight` with the whole block on every streamed chunk.
// Each block in progress keeps the grammar state at its last completed line,
// so a chunk tokenises only the lines it finished plus the open one. Blocks
// that stop growing land in an LRU, so reopening a chat doesn't re-tokenise.

type PluginConfig = NonNullable<
  ComponentProps<typeof MessageResponse>["plugins"]
>;
export type CodeHighlighterPlugin = NonNullable<PluginConfig["code"]>;
type HighlightOptions = Parameters<CodeHighlighterPlugin["highlight"]>[0];
export type HighlightResult = NonNullable<
  ReturnType<CodeHighlighterPlugin["highlight"]>
>;
type Token = HighlightResult["tokens"][number][number];
type Row = readonly Token[];

export interface Tokenized<State> {
  readonly bg?: string;
  readonly fg?: string;
  readonly rows: readonly Row[];
  /** The grammar state after the last line; none for plain text. */
  readonly state: State | undefined;
}

export interface HighlightError {
  readonly cause: unknown;
  readonly kind: "load-failed" | "tokenize-failed";
}

/** One language's tokeniser (the port Shiki sits behind). */
export interface Tokenizer<State> {
  readonly tokenize: (
    code: string,
    state: State | undefined
  ) => Result<Tokenized<State>, HighlightError>;
}

export interface CodeHighlighterDeps<State> {
  /**
   * The tokeniser for a fence's language, falling back to plain text for one
   * it doesn't know. Called once per language; the promise is cached.
   */
  readonly loadTokenizer: (
    language: string
  ) => Promise<Result<Tokenizer<State>, HighlightError>>;
  /** The theme names, light then dark, Streamdown is told about. */
  readonly themes: readonly [string, string];
  /** Hands the main thread back between slices of a long block. */
  readonly yieldToMain?: () => Promise<void>;
}

/** Marks a coloured block, so the raw one can stay hidden until then. */
export const CODE_READY_ATTRIBUTE = "data-code-ready";

// Lines tokenised in one go: a fence up to this size highlights in the same
// frame; a longer one goes in slices with yields between them.
const SLICE_LINES = 400;
// Blocks being streamed at once (a reply rarely has more than a few open).
const MAX_STREAMS = 8;
// Finished blocks kept, by count and by characters of code.
const MAX_FINISHED = 300;
const MAX_FINISHED_CHARS = 2_000_000;

const LINE_BREAKS = /\r\n?/g;

interface Cursor<State> {
  readonly prefix: string;
  readonly rows: readonly Row[];
  readonly state: State | undefined;
}

interface Done<State> {
  /** Where the block got to; none after a full pass, which can't resume. */
  readonly cursor?: Cursor<State>;
  readonly done: true;
  readonly result: HighlightResult;
}

type Step<State> =
  | Done<State>
  | { readonly cursor: Cursor<State>; readonly done: false };

interface Stream<State> {
  readonly key: string;
  readonly last: { readonly code: string; readonly result: HighlightResult };
  /** Completed lines (up to and including the last newline). */
  readonly prefix: string;
  readonly rows: readonly Row[];
  readonly state: State | undefined;
}

const defaultYield = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const normaliseLanguage = (language: string): string =>
  language.trim().toLowerCase() || "text";

const countLines = (text: string, from: number, to: number): number => {
  let lines = 0;
  for (let index = text.indexOf("\n", from); index !== -1 && index < to; ) {
    lines += 1;
    index = text.indexOf("\n", index + 1);
  }
  return lines;
};

const plainRows = (code: string): readonly Row[] =>
  code.split("\n").map((line) => [{ content: line, offset: 0 }]);

/** Puts the ready marker on the first token Streamdown will render. */
const withMarker = (
  rows: readonly Row[],
  colours: { readonly bg?: string; readonly fg?: string }
): HighlightResult => {
  const first = rows.findIndex(
    (row) => row.length > 1 || (row.length === 1 && row[0]?.content !== "")
  );
  const tokens = rows.map((row, index) =>
    index === first
      ? row.map((token, at) =>
          at === 0
            ? {
                ...token,
                htmlAttrs: { ...token.htmlAttrs, [CODE_READY_ATTRIBUTE]: "" },
              }
            : token
        )
      : [...row]
  );
  return { bg: colours.bg, fg: colours.fg, tokens };
};

/** What a block shows when Shiki can't load: its text, uncoloured. */
export const plainResult = (code: string): HighlightResult =>
  withMarker(plainRows(code.replace(LINE_BREAKS, "\n")), {});

/**
 * Builds the Streamdown code plugin over a tokeniser port. Pure apart from its
 * caches; `code-highlighter` supplies Shiki in the app, tests a fake.
 */
export function createCodeHighlighter<State>({
  loadTokenizer,
  themes,
  yieldToMain = defaultYield,
}: CodeHighlighterDeps<State>): CodeHighlighterPlugin {
  const loading = new Map<
    string,
    Promise<Result<Tokenizer<State>, HighlightError>>
  >();
  const loaded = new Map<string, Result<Tokenizer<State>, HighlightError>>();
  // Most recent first; replaced, never edited, as blocks grow.
  let streams: readonly Stream<State>[] = [];
  // Insertion-ordered, so the first key is the least recently used.
  const finished = new Map<string, HighlightResult>();
  let finishedChars = 0;
  // Highlights that had to wait run one at a time, in call order, so a late
  // result never overwrites a newer one Streamdown already showed.
  let queue: Promise<void> = Promise.resolve();
  let queued = 0;

  const tokenizerFor = (
    language: string
  ): Promise<Result<Tokenizer<State>, HighlightError>> => {
    let pending = loading.get(language);
    if (!pending) {
      pending = loadTokenizer(language).then((result) => {
        loaded.set(language, result);
        return result;
      });
      loading.set(language, pending);
    }
    return pending;
  };

  const remember = (key: string, result: HighlightResult) => {
    if (finished.delete(key)) {
      finishedChars -= key.length;
    }
    finished.set(key, result);
    finishedChars += key.length;
    while (
      finished.size > 1 &&
      (finished.size > MAX_FINISHED || finishedChars > MAX_FINISHED_CHARS)
    ) {
      const oldest = finished.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      // The key ends with the code, so its length bounds the code's.
      finishedChars -= oldest.length;
      finished.delete(oldest);
    }
  };

  const recall = (key: string): HighlightResult | undefined => {
    const hit = finished.get(key);
    if (hit) {
      finished.delete(key);
      finished.set(key, hit);
    }
    return hit;
  };

  /** Keeps a block's stream, retiring the oldest into the finished cache. */
  const keep = (stream: Stream<State>, replacing?: Stream<State>) => {
    const rest = streams.filter((other) => other !== replacing);
    const next = [stream, ...rest];
    for (const retired of next.slice(MAX_STREAMS)) {
      const key = `${retired.key}\u0000${retired.last.code}`;
      remember(key, retired.last.result);
    }
    streams = next.slice(0, MAX_STREAMS);
  };

  /**
   * The stream this code continues: same language, and its completed lines
   * start the code (the longest such, so the least is re-tokenised). Another
   * block with the same opening lines is as good: the grammar state after
   * identical text is identical.
   */
  const continued = (key: string, code: string) => {
    let best: Stream<State> | undefined;
    for (const stream of streams) {
      if (
        stream.key === key &&
        code.startsWith(stream.prefix) &&
        stream.prefix.length >= (best?.prefix.length ?? 0)
      ) {
        best = stream;
      }
    }
    return best;
  };

  /**
   * One step over `code` from `cursor`: up to `SLICE_LINES` more completed
   * lines, or, once they're all done, the open last line and the result.
   */
  const step = (
    tokenizer: Tokenizer<State>,
    code: string,
    cursor: Cursor<State>
  ): Step<State> => {
    const end = code.lastIndexOf("\n") + 1;
    if (end > cursor.prefix.length) {
      let stop = cursor.prefix.length;
      for (let lines = 0; lines < SLICE_LINES && stop < end; lines += 1) {
        stop = code.indexOf("\n", stop) + 1;
      }
      // Without the newline that ends the slice: Shiki would tokenise an
      // extra empty line and carry its state into the next one.
      const slice = tokenizer.tokenize(
        code.slice(cursor.prefix.length, stop - 1),
        cursor.state
      );
      if (!slice.ok || slice.value.state === undefined) {
        // No grammar state to resume from (plain text, or a failure): one
        // full pass, which for plain text is just splitting lines.
        const whole = tokenizer.tokenize(code, undefined);
        return {
          done: true,
          result: whole.ok
            ? withMarker(whole.value.rows, whole.value)
            : plainResult(code),
        };
      }
      return {
        cursor: {
          prefix: code.slice(0, stop),
          rows: [...cursor.rows, ...slice.value.rows],
          state: slice.value.state,
        },
        done: false,
      };
    }
    const tail = tokenizer.tokenize(code.slice(end), cursor.state);
    return {
      cursor,
      done: true,
      result: tail.ok
        ? withMarker([...cursor.rows, ...tail.value.rows], tail.value)
        : plainResult(code),
    };
  };

  const start = (key: string, code: string) => {
    const from = continued(key, code);
    const cursor: Cursor<State> = from
      ? { prefix: from.prefix, rows: from.rows, state: from.state }
      : { prefix: "", rows: [], state: undefined };
    return { cursor, from };
  };

  const finish = (
    key: string,
    code: string,
    done: Done<State>,
    from: Stream<State> | undefined
  ): HighlightResult => {
    if (done.cursor) {
      const { prefix, rows, state } = done.cursor;
      // A block that grew replaces its stream; one that merely shares opening
      // lines with another block gets its own.
      const grew = from && code.startsWith(from.last.code) ? from : undefined;
      keep(
        { key, last: { code, result: done.result }, prefix, rows, state },
        grew
      );
    }
    return done.result;
  };

  const runSync = (
    tokenizer: Tokenizer<State>,
    key: string,
    code: string
  ): HighlightResult => {
    const { cursor, from } = start(key, code);
    let next = step(tokenizer, code, cursor);
    while (!next.done) {
      next = step(tokenizer, code, next.cursor);
    }
    return finish(key, code, next, from);
  };

  /** As `runSync`, handing the main thread back between slices. */
  const runSliced = async (
    tokenizer: Tokenizer<State>,
    key: string,
    code: string
  ): Promise<HighlightResult> => {
    const { cursor, from } = start(key, code);
    let next = step(tokenizer, code, cursor);
    while (!next.done) {
      // biome-ignore lint/performance/noAwaitInLoops: the slices must run one after another; the await is the point, handing the main thread back between them.
      await yieldToMain();
      next = step(tokenizer, code, next.cursor);
    }
    return finish(key, code, next, from);
  };

  return {
    getSupportedLanguages: () => [],
    getThemes: () => [themes[0], themes[1]],
    highlight(options: HighlightOptions, callback) {
      const language = normaliseLanguage(options.language);
      const code = options.code.replace(LINE_BREAKS, "\n");
      const key = `${themes[0]}\u0000${language}`;
      const exact =
        recall(`${key}\u0000${code}`) ??
        streams.find(
          (stream) => stream.key === key && stream.last.code === code
        )?.last.result;
      if (exact) {
        return exact;
      }

      const ready = loaded.get(language);
      if (queued === 0 && ready) {
        if (!ready.ok) {
          return plainResult(code);
        }
        const from = continued(key, code);
        const work = countLines(code, from?.prefix.length ?? 0, code.length);
        if (work <= SLICE_LINES) {
          return runSync(ready.value, key, code);
        }
      }

      queued += 1;
      queue = queue.then(async () => {
        const tokenizer = await tokenizerFor(language);
        const result = tokenizer.ok
          ? await runSliced(tokenizer.value, key, code)
          : plainResult(code);
        queued -= 1;
        callback?.(result);
      });
      // The tokeniser port returns its failures as values; anything thrown
      // here is a bug, and must not wedge every later block behind it.
      queue = queue.catch(() => {
        queued = 0;
      });
      return null;
    },
    name: "shiki",
    // Every fence goes through the plugin; an unknown language renders as
    // plain text rather than skipping it, so it isn't left hidden.
    supportsLanguage: () => true,
    type: "code-highlighter",
  };
}

/**
 * The app's plugin: one per page, so every message shares the caches. Its
 * object identity is stable, which MessageResponse's memo relies on.
 */
export const codePlugin: CodeHighlighterPlugin = createCodeHighlighter({
  loadTokenizer: (language) =>
    import("./code-highlighter").then(
      (module) => module.loadTokenizer(language),
      (cause: unknown) => err({ cause, kind: "load-failed" as const })
    ),
  themes: [codeThemeNames.light, codeThemeNames.dark],
});
