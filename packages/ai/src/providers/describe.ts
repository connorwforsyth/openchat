import {
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";

// What the picker says about a model beyond its name (096): a one-line
// description and who makes it. Pure.

/** A description's longest length, ellipsis included. */
export const DESCRIPTION_MAX = 120;

const LINE_BREAK = /\r?\n|\r/;
const WHITESPACE = /\s+/g;
// A cut this close to the limit backs off to the last word boundary.
const WORD_BACKOFF = 24;

/**
 * `text` as one short line: its first non-blank line, whitespace collapsed,
 * cut at a word to `max` characters with an ellipsis. `undefined` when
 * nothing's left.
 */
export const oneLine = (
  text: string | null | undefined,
  max = DESCRIPTION_MAX
): string | undefined => {
  const line = (text ?? "")
    .split(LINE_BREAK)
    .map((part) => part.replace(WHITESPACE, " ").trim())
    .find((part) => part !== "");
  if (line === undefined) {
    return;
  }
  if (line.length <= max) {
    return line;
  }
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const kept = space >= max - 1 - WORD_BACKOFF ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}…`;
};

const VENDOR = /^([a-z][a-z0-9_-]{0,63})\/./i;

/**
 * Who makes the model a ref names. A ref through an aggregator names the
 * vendor after the colon (`gateway:anthropic/claude-haiku-4.5` is
 * `anthropic`); otherwise it's the configured provider's key.
 */
export const vendorOf = (ref: ModelRef): string | undefined => {
  const parsed = parseModelRef(ref);
  if (!parsed) {
    return;
  }
  const vendor = VENDOR.exec(parsed.modelId)?.[1];
  return vendor === undefined ? parsed.provider : vendor.toLowerCase();
};
