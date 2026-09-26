import type { JsonValue } from "@workspace/contract/schemas/common";
import type {
  MessagePart,
  ToolOutput,
} from "@workspace/contract/schemas/message-parts";
import { toolNameSchema } from "@workspace/contract/schemas/message-parts";
import {
  type ModelRef,
  modelRefSchema,
} from "@workspace/contract/schemas/models";
import { z } from "zod";

import {
  IMPORTED_CONTENT,
  IMPORTED_FILE,
  type ImportedFileData,
  type ImportSource,
  TITLE_MAX,
} from "./schema";

// Part builders shared by the importers, so every format maps the same way.

export const textPart = (text: string): MessagePart => ({ text, type: "text" });

export const reasoningPart = (text: string): MessagePart => ({
  text,
  type: "reasoning",
});

const TOOL_NAME_INVALID = /[^a-zA-Z0-9_.:-]/g;

/** A tool name our schema accepts: invalid characters become `_`. */
export const toolName = (name: string | null | undefined): string => {
  const cleaned = (name ?? "").replace(TOOL_NAME_INVALID, "_").slice(0, 128);
  return toolNameSchema.safeParse(cleaned).success ? cleaned : "tool";
};

/** A tool call id within the schema's bounds, or `fallback`. */
export const toolCallId = (
  id: string | null | undefined,
  fallback: string
): string => {
  const value = id && id.length <= 256 ? id : fallback;
  return value.slice(0, 256) || "call";
};

/**
 * A call the old service ran (ChatGPT's code interpreter, Claude's
 * artifacts). Imported history is settled, so there's no approval to ask.
 */
export const toolCallPart = (input: {
  readonly id: string;
  readonly input: JsonValue;
  readonly name: string;
  readonly providerExecuted?: boolean;
}): MessagePart => ({
  approval: { state: "not-required" },
  input: input.input,
  ...(input.providerExecuted ? { providerExecuted: true } : {}),
  toolCallId: input.id,
  toolName: input.name,
  type: "tool-call",
});

export const toolResultPart = (input: {
  readonly id: string;
  readonly name: string;
  readonly output: ToolOutput;
}): MessagePart => ({
  output: input.output,
  toolCallId: input.id,
  toolName: input.name,
  type: "tool-result",
});

const jsonSchema = z.json();

/**
 * `value` as JSON. Parsed export JSON always is; this narrows the type (and
 * drops anything that isn't, like `undefined` inside a spread object).
 */
export const asJson = (value: unknown): JsonValue => {
  const parsed = jsonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** Tool arguments stored as a JSON string become the object; anything else stays a string. */
export const parseArguments = (value: unknown): JsonValue => {
  if (typeof value !== "string") {
    return asJson(value ?? {});
  }
  try {
    return asJson(JSON.parse(value));
  } catch {
    return value;
  }
};

export const importedFilePart = (data: ImportedFileData): MessagePart => ({
  data: Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as JsonValue,
  name: IMPORTED_FILE,
  type: "data",
});

export const importedContentPart = (
  origin: ImportSource,
  kind: string,
  content: unknown
): MessagePart => ({
  data: { content: asJson(content), kind: kind.slice(0, 128), origin },
  name: IMPORTED_CONTENT,
  type: "data",
});

const PROVIDER_INVALID = /[^a-z0-9_-]/g;

/**
 * `provider:model` from what the export names, or `null` when it can't be
 * spelled as a ref. The provider is the source's (`openai` for ChatGPT); it
 * records who answered and needn't be one configured here.
 */
export const modelRef = (
  provider: string,
  model: string | null | undefined
): ModelRef | null => {
  if (!model) {
    return null;
  }
  const cleanProvider = provider.toLowerCase().replace(PROVIDER_INVALID, "-");
  const parsed = modelRefSchema.safeParse(`${cleanProvider}:${model.trim()}`);
  return parsed.success ? parsed.data : null;
};

/** A title within the contract's limit; blank is `null` (the title job names it). */
export const cleanTitle = (title: string | null | undefined): string | null => {
  const trimmed = title?.trim();
  return trimmed ? trimmed.slice(0, TITLE_MAX) : null;
};

/** A non-negative integer, or `undefined`. */
export const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;

/** A non-empty string, or `undefined`. */
export const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** A media type (`image/png`) if it looks like one, else `undefined`. */
export const mediaType = (value: unknown): string | undefined =>
  typeof value === "string" && value.includes("/") && value.length <= 255
    ? value
    : undefined;
