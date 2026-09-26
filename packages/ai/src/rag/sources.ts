import { sourcePartSchema } from "@workspace/contract/schemas/message-parts";
import { z } from "zod";

// Retrieval tools (`file_search`, `web_search`) return their citations as
// our `source` message parts alongside the results. An AI SDK tool can't
// write parts into the stream itself, so the run executor (ticket 014)
// lifts them out of the tool result with `toolSources` and stores them on
// the assistant message, where the UI renders them as citations.

export type SourcePart = z.infer<typeof sourcePartSchema>;

const withSourcesSchema = z.object({ sources: z.array(sourcePartSchema) });

/** The `source` parts in a retrieval tool's output; `[]` for any other output. */
export const toolSources = (output: unknown): SourcePart[] => {
  const parsed = withSourcesSchema.safeParse(output);
  return parsed.success ? parsed.data.sources : [];
};

/** A source id that's unique within the message: the call id plus the result's rank. */
export const sourceId = (toolCallId: string, rank: number): string =>
  `${toolCallId}-${rank}`.slice(0, 128);
