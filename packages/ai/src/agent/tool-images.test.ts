import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { keepRecentToolImages, OMITTED_IMAGE_TEXT } from "./tool-images";

const shot = (id: string): ModelMessage => ({
  content: [
    {
      output: {
        type: "content",
        value: [
          { text: `${id}: done`, type: "text" },
          {
            data: { data: id, type: "data" },
            mediaType: "image/jpeg",
            type: "file",
          },
        ],
      },
      toolCallId: id,
      toolName: "computer",
      type: "tool-result",
    },
  ],
  role: "tool",
});

const images = (messages: readonly ModelMessage[]) =>
  messages.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) =>
          part.type === "tool-result" && part.output.type === "content"
            ? part.output.value.map((item) =>
                item.type === "text" ? item.text : "image"
              )
            : []
        )
      : []
  );

describe("keepRecentToolImages", () => {
  it("keeps the newest images and says where the others were", () => {
    const messages = ["a", "b", "c", "d"].map(shot);
    expect(images(keepRecentToolImages(messages, 2))).toEqual([
      "a: done",
      OMITTED_IMAGE_TEXT,
      "b: done",
      OMITTED_IMAGE_TEXT,
      "c: done",
      "image",
      "d: done",
      "image",
    ]);
  });

  it("leaves other messages and a short history alone", () => {
    const user: ModelMessage = { content: "hi", role: "user" };
    const messages = [user, shot("a")];
    expect(keepRecentToolImages(messages)).toEqual(messages);
  });
});
