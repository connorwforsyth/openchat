import type { ModelMessage } from "ai";

// Tools that answer with pictures (a Dot's `computer`, 172) send one per
// call, and a run of fifty clicks would carry fifty screenshots into every
// later step until the conversation no longer fits the model. Only the
// latest few matter for what's on screen now, so older images in tool
// results are swapped for a line saying one was there. Pure; the stored
// messages keep every picture.

/** How many of the latest tool-result images a step sees. */
export const RECENT_TOOL_IMAGES = 3;

export const OMITTED_IMAGE_TEXT = "(an earlier screenshot, omitted)";

type ToolMessage = Extract<ModelMessage, { role: "tool" }>;
type ToolPart = ToolMessage["content"][number];

const isImage = (part: { type: string; mediaType?: string }): boolean =>
  part.type === "file" && (part.mediaType ?? "").startsWith("image");

/** The messages with all but the newest `keep` tool-result images replaced. */
export const keepRecentToolImages = (
  messages: readonly ModelMessage[],
  keep: number = RECENT_TOOL_IMAGES
): ModelMessage[] => {
  let seen = 0;
  const pruneOutput = (part: ToolPart): ToolPart => {
    if (part.type !== "tool-result" || part.output.type !== "content") {
      return part;
    }
    const value = [...part.output.value]
      .reverse()
      .map((item) => {
        if (!isImage(item)) {
          return item;
        }
        seen += 1;
        return seen > keep
          ? { text: OMITTED_IMAGE_TEXT, type: "text" as const }
          : item;
      })
      .reverse();
    return { ...part, output: { ...part.output, value } };
  };
  return [...messages]
    .reverse()
    .map((message) =>
      message.role === "tool"
        ? {
            ...message,
            content: [...message.content].reverse().map(pruneOutput).reverse(),
          }
        : message
    )
    .reverse();
};
