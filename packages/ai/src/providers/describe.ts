import {
  type ModelCost,
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";

import type { ModelCapability } from "./capabilities";
import type { CatalogTraits } from "./catalog";

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
/** Aggregators' other names for one vendor, so they share a group (`meta-llama` is OpenRouter's `meta`). */
const SAME_VENDOR: Readonly<Record<string, string>> = { "meta-llama": "meta" };

export const vendorOf = (ref: ModelRef): string | undefined => {
  const parsed = parseModelRef(ref);
  if (!parsed) {
    return;
  }
  const vendor = VENDOR.exec(parsed.modelId)?.[1]?.toLowerCase();
  return vendor === undefined
    ? parsed.provider
    : (SAME_VENDOR[vendor] ?? vendor);
};

// ---- The preview card's facts (099). Pure; unknown stays absent. ----

const SEPARATORS = /[-_\s]+/;
const NUMBER = /^\d+$/;
const DATE = /^(?:\d{8}|\d{4}-\d{2}-\d{2})$/;
const SIZE = /^\d+(?:\.\d+)?[bkmt]$/i;
const SHORT_VERSION = /^[a-z]\d+$/i;
const OPENAI_SERIES = /^o\d+$/;
const CATALOG_VENDOR = /^[^:]{1,40}:\s+(?=\S)/;

// Words whose capitals don't follow from the id. Cosmetic only.
const WORDS: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  glm: "GLM",
  gpt: "GPT",
  oss: "OSS",
  qwq: "QwQ",
};

const word = (token: string): string => {
  const known = WORDS[token.toLowerCase()];
  if (known !== undefined) {
    return known;
  }
  if (OPENAI_SERIES.test(token)) {
    return token;
  }
  if (SIZE.test(token) || SHORT_VERSION.test(token)) {
    return token.toUpperCase();
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
};

/** Tokens with a trailing date dropped and runs of numbers joined: `4 5` is `4.5`. */
const tidyTokens = (tokens: readonly string[]): string[] => {
  const kept = [...tokens];
  // `-2024-08-06`, `-20250514` and `-latest` pick a snapshot; the name doesn't.
  const last3 = kept.slice(-3).join("-");
  if (kept.length > 3 && DATE.test(last3)) {
    kept.splice(-3);
  } else if (
    kept.length > 1 &&
    (DATE.test(kept.at(-1) ?? "") || kept.at(-1) === "latest")
  ) {
    kept.pop();
  }
  const joined: string[] = [];
  for (const token of kept) {
    const previous = joined.at(-1);
    if (
      previous !== undefined &&
      NUMBER.test(token) &&
      NUMBER.test(previous.split(".").at(-1) ?? "") &&
      token.length <= 2
    ) {
      joined[joined.length - 1] = `${previous}.${token}`;
    } else {
      joined.push(token);
    }
  }
  return joined;
};

/**
 * A model id as people would write it: the vendor prefix and a snapshot
 * date dropped, words capitalised, version numbers joined (`anthropic/
 * claude-opus-4-5` is "Claude Opus 4.5", `gpt-4o-mini` is "GPT-4o Mini",
 * `llama3.2:3b` is "Llama3.2 3B"). For ids a catalog gives no name for.
 */
export const tidyModelName = (modelId: string): string => {
  const bare = modelId.slice(modelId.lastIndexOf("/") + 1);
  const [name = bare, tag] = bare.split(":");
  const words = tidyTokens(name.split(SEPARATORS).filter(Boolean)).map(word);
  const named: string[] = [];
  for (const part of words) {
    // GPT takes its version with a hyphen: GPT-4o, GPT-5.
    if (named.at(-1) === "GPT") {
      named[named.length - 1] = `GPT-${part}`;
    } else {
      named.push(part);
    }
  }
  const suffix =
    tag === undefined || tag === "latest"
      ? []
      : tag.split(SEPARATORS).filter(Boolean).map(word);
  return [...named, ...suffix].join(" ") || modelId;
};

/**
 * The name the picker shows: the catalog's, without the "Vendor: " that
 * OpenRouter puts in front, else tidied from the id.
 */
export const displayNameOf = (
  modelId: string,
  catalogName: string | null | undefined
): string => {
  const named = catalogName?.replace(CATALOG_VENDOR, "").trim();
  return named || tidyModelName(modelId);
};

// Upper bounds, in USD per million tokens, of a blended price (three input
// tokens to one output) for tiers 1–4; anything dearer is 5. Roughly: small
// open models, Haiku-class, Sonnet-class, Opus-class, the most expensive.
const TIER_BOUNDS = [0.5, 2.5, 8, 20] as const;
const MICRO = 1_000_000;

/**
 * A cost for the card from what a catalog charges (micro-USD per million
 * tokens), or `undefined` when it names no price.
 */
export const costOf = (
  pricing: { readonly input?: number; readonly output?: number } | undefined
): ModelCost | undefined => {
  const { input, output } = pricing ?? {};
  let blended: number | undefined;
  if (input !== undefined && output !== undefined) {
    blended = (input * 3 + output) / 4;
  } else {
    blended = input ?? output;
  }
  if (blended === undefined) {
    return;
  }
  const usd = blended / MICRO;
  const below = TIER_BOUNDS.findIndex((bound) => usd <= bound);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    tier: below === -1 ? 5 : below + 1,
  };
};

/**
 * The provider's capabilities, corrected by what the catalog says of this
 * model: a "no" removes one, and reasoning (which no provider type implies)
 * is added on a "yes". Vision and files are only ever removed: whether an
 * image reaches the model as a file part is the provider config's call
 * (`options.capabilities`), and the card shouldn't promise otherwise. The
 * exception is a catalog the model server keeps itself (`fromServer`: Ollama's
 * tags), whose "yes" to vision is the server's own word.
 */
export const capabilitiesWith = (
  provider: readonly ModelCapability[],
  traits: CatalogTraits | undefined,
  { fromServer = false }: { readonly fromServer?: boolean } = {}
): ModelCapability[] => {
  if (fromServer && traits?.vision === true && !provider.includes("vision")) {
    return capabilitiesWith([...provider, "vision"], traits);
  }
  const kept = provider.filter(
    (capability) =>
      !(
        (capability === "tools" ||
          capability === "vision" ||
          capability === "files" ||
          capability === "reasoning") &&
        traits?.[capability] === false
      )
  );
  const reasoned: ModelCapability[] =
    traits?.reasoning === true && !kept.includes("reasoning")
      ? [...kept, "reasoning"]
      : kept;
  // A model the catalog says draws images itself (138); nothing else says so.
  return traits?.imageOutput === true && !reasoned.includes("image-output")
    ? [...reasoned, "image-output"]
    : reasoned;
};
