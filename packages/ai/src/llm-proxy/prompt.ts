import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import type { validationIssueSchema } from "@workspace/contract/errors";
import type { DeciderState } from "@workspace/contract/schemas/decider";
import type { LlmPromptMessage } from "@workspace/contract/schemas/llm";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// Checks on a proxied prompt beyond the contract's (which keeps content opaque
// so it doesn't pin an AI SDK version):
// - each message has the shape its role needs, so a provider adapter never
//   meets a malformed part;
// - files arrive as bytes (base64) or inline text, never as a URL or a
//   provider file reference. A URL would have the server (or the provider,
//   on the server's key) fetch whatever the caller names (SSRF), and a
//   reference would reach files uploaded under the instance's keys by
//   someone else.

export type ValidationIssue = z.infer<typeof validationIssueSchema>;
type Path = ValidationIssue["path"];

const partSchema = z.looseObject({ type: z.string().min(1) });
const messageSchema = z.discriminatedUnion("role", [
  z.looseObject({ content: z.string(), role: z.literal("system") }),
  z.looseObject({ content: z.array(partSchema), role: z.literal("user") }),
  z.looseObject({ content: z.array(partSchema), role: z.literal("assistant") }),
  z.looseObject({ content: z.array(partSchema), role: z.literal("tool") }),
]);

const FILE_PARTS = new Set(["file", "reasoning-file"]);
/** Anything that starts like a URI (`https:`, `file:`, `data:`, `s3:`). */
const URI = /^[a-z][a-z0-9+.-]*:/i;

const fileDataIssue = (
  data: unknown,
  path: Path
): ValidationIssue | undefined => {
  if (typeof data === "string") {
    return URI.test(data)
      ? { message: "send file data as base64, not a URL", path }
      : undefined;
  }
  if (data && typeof data === "object") {
    const { data: bytes, type: kind } = data as {
      data?: unknown;
      type?: unknown;
    };
    if (kind === "text") {
      return;
    }
    if (kind === "data") {
      return fileDataIssue(bytes, [...path, "data"]);
    }
    return {
      message: `file data of type "${String(kind)}" isn't accepted; send bytes`,
      path,
    };
  }
};

/** Every file part anywhere in the prompt, tool results included. */
const fileIssues = (value: unknown, path: Path): ValidationIssue[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => fileIssues(item, [...path, index]));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const { type } = record;
  const own: ValidationIssue[] = [];
  if (typeof type === "string" && FILE_PARTS.has(type)) {
    const issue = fileDataIssue(record.data, [...path, "data"]);
    if (issue) {
      own.push(issue);
    }
  } else if (typeof type === "string" && type.endsWith("-url")) {
    // Older wire shapes (`image-url`, `file-url`) name a URL outright.
    own.push({ message: `"${type}" parts aren't accepted; send bytes`, path });
  }
  return [
    ...own,
    ...Object.entries(record).flatMap(([key, child]) =>
      key === "providerOptions" ? [] : fileIssues(child, [...path, key])
    ),
  ];
};

export const checkPrompt = (
  prompt: readonly LlmPromptMessage[]
): Result<LanguageModelV4Prompt, readonly ValidationIssue[]> => {
  const shaped = z.array(messageSchema).safeParse(prompt);
  if (!shaped.success) {
    return err(
      shaped.error.issues.map((issue) => ({
        message: issue.message,
        path: [
          "prompt",
          ...issue.path.map((key) =>
            typeof key === "symbol" ? String(key) : key
          ),
        ],
      }))
    );
  }
  const issues = fileIssues(prompt, ["prompt"]);
  // Shapes are checked above; the parts' own fields are the provider's to read.
  return issues.length > 0
    ? err(issues)
    : ok(prompt as unknown as LanguageModelV4Prompt);
};

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : (Array.isArray(content) ? content : [])
        .filter(
          (part): part is { text: string; type: "text" } =>
            part?.type === "text"
        )
        .map((part) => part.text)
        .join("\n");

const HISTORY = 10;
const MAX_TEXT = 20_000;

/** What the Decider sees of a proxied prompt when routing `auto`. */
export const stateFromPrompt = (
  prompt: readonly LlmPromptMessage[]
): DeciderState => {
  const turns = prompt
    .filter(
      (message) => message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({
      role: message.role as "assistant" | "user",
      text: textOf(message.content).slice(0, MAX_TEXT),
    }));
  const lastUser = turns.map((turn) => turn.role).lastIndexOf("user");
  return {
    facts: {},
    history: turns.slice(
      Math.max(0, lastUser - HISTORY),
      Math.max(0, lastUser)
    ),
    input: lastUser >= 0 ? (turns[lastUser]?.text ?? "") : "",
  };
};
