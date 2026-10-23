import type {
  LanguageModelV4,
  LanguageModelV4FilePart,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";
import type { ProviderType } from "@workspace/config/schema";
import { wrapLanguageModel } from "ai";

import type { ModelCapability } from "./capabilities";

// Images a tool hands the model (`read` on a picture, a screenshot) as each
// model can take them. A native API takes an image inside a tool result.
// OpenAI's chat format, which every `openai-compatible` server speaks
// (Ollama, vLLM, a gateway), only takes text there, and the AI SDK writes
// the image out as base64 text; so for a model that sees, the image moves
// to a user message right after the results. A model that can't see gets a
// note it can pass on instead of the picture.

/** How tool-result images reach one model. */
export type ToolImageFit =
  | { readonly type: "inline" }
  | { readonly type: "follow-up" }
  | {
      /** Models (`provider:model`) that can see, to name in the note. */
      readonly suggestions: readonly string[];
      readonly type: "note";
    };

/** The fit for a model of `providerType` with `capabilities`. Pure. */
export const toolImageFit = (
  providerType: ProviderType,
  capabilities: readonly ModelCapability[],
  suggestions: readonly string[] = []
): ToolImageFit => {
  if (!capabilities.includes("vision")) {
    return { suggestions, type: "note" };
  }
  return providerType === "openai-compatible"
    ? { type: "follow-up" }
    : { type: "inline" };
};

/** What a model that can't see is told in place of an image. */
const noImageNote = (suggestions: readonly string[]): string => {
  const such =
    suggestions.length > 0 ? `, such as ${suggestions.join(" or ")}` : "";
  return `[An image was returned here, but this model can't see images. If the user wants it looked at, tell them to switch to a model that can${such}.]`;
};

type ContentOutput = Extract<
  LanguageModelV4ToolResultOutput,
  { type: "content" }
>;
type ContentItem = ContentOutput["value"][number];
type ImageItem = Extract<ContentItem, { type: "file" }>;

const isImage = (item: ContentItem): item is ImageItem =>
  item.type === "file" && item.mediaType.startsWith("image");

/** Text-only content as plain text, which every provider takes. */
const settled = (
  items: readonly ContentItem[]
): LanguageModelV4ToolResultOutput =>
  items.every((item) => item.type === "text")
    ? {
        type: "text",
        value: items
          .map((item) => (item.type === "text" ? item.text : ""))
          .join("\n"),
      }
    : { type: "content", value: [...items] };

type ToolMessage = Extract<LanguageModelV4Message, { role: "tool" }>;

interface Fitted<Part = LanguageModelV4ToolResultPart> {
  readonly images: readonly LanguageModelV4FilePart[];
  readonly part: Part;
}

const fitResult = (
  part: LanguageModelV4ToolResultPart,
  fit: Exclude<ToolImageFit, { type: "inline" }>
): Fitted => {
  const { output } = part;
  if (output.type !== "content" || !output.value.some(isImage)) {
    return { images: [], part };
  }
  if (fit.type === "note") {
    const note = noImageNote(fit.suggestions);
    return {
      images: [],
      part: {
        ...part,
        output: settled(
          output.value.map((item) =>
            isImage(item) ? { text: note, type: "text" } : item
          )
        ),
      },
    };
  }
  const images = output.value.filter(isImage);
  return {
    images: images.map(({ data, filename, mediaType }) => ({
      data,
      mediaType,
      type: "file",
      ...(filename === undefined ? {} : { filename }),
    })),
    part: {
      ...part,
      output: settled([
        ...output.value.filter((item) => !isImage(item)),
        { text: "(The image follows in the next message.)", type: "text" },
      ]),
    },
  };
};

const fitMessage = (
  message: LanguageModelV4Message,
  fit: Exclude<ToolImageFit, { type: "inline" }>
): LanguageModelV4Message[] => {
  if (message.role !== "tool") {
    return [message];
  }
  const fitted = message.content.map(
    (part): Fitted<ToolMessage["content"][number]> =>
      part.type === "tool-result" ? fitResult(part, fit) : { images: [], part }
  );
  const content = fitted.map(({ part }) => part);
  const images = fitted.flatMap(({ images: found }) => found);
  const fittedMessage = { ...message, content };
  return images.length === 0
    ? [fittedMessage]
    : [
        fittedMessage,
        {
          content: [
            {
              text: "The image returned by the tool call above:",
              type: "text",
            },
            ...images,
          ],
          role: "user",
        },
      ];
};

/** `prompt` with every tool-result image fitted to the model. Pure. */
const fitToolImages = (
  prompt: LanguageModelV4Prompt,
  fit: ToolImageFit
): LanguageModelV4Prompt =>
  fit.type === "inline"
    ? prompt
    : prompt.flatMap((message) => fitMessage(message, fit));

/** `model` with tool-result images fitted on every call; itself when they need nothing. */
export const withToolImages = (
  model: LanguageModelV4,
  fit: ToolImageFit
): LanguageModelV4 =>
  fit.type === "inline"
    ? model
    : wrapLanguageModel({
        middleware: {
          transformParams: ({ params }) =>
            Promise.resolve({
              ...params,
              prompt: fitToolImages(params.prompt, fit),
            }),
        },
        model,
      });
