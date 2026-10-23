import { readFileSync } from "node:fs";

import {
  type ToolImageFit,
  toolImageFit,
  withToolImages,
} from "@workspace/ai/providers/tool-images";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import { fixtureId } from "@workspace/contract/fixtures";
import { stepCountIs, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { createJustBashSandbox } from "../just-bash/provider";
import { imageMediaTypeOf, MAX_IMAGE_BYTES } from "./defs/read";
import { createSandboxTools } from "./tools";

type LanguageModelV4Prompt =
  MockLanguageModelV4["doStreamCalls"][number]["prompt"];

const png = new Uint8Array(
  readFileSync(new URL("./__fixtures__/red-square.png", import.meta.url))
);
const base64 = Buffer.from(png).toString("base64");

/** Asks the model to read `path`, and returns what it was sent next and what was stored. */
const readThrough = async (fit: ToolImageFit, path = "red-square.png") => {
  const sandbox = await createJustBashSandbox({ id: fixtureId("sandbox", 1) });
  await sandbox.writeFile(path, png);
  const mock = new MockLanguageModelV4({
    doStream: [toolCallStream("read", { path }), textStream("A red square.")],
  });
  const result = streamText({
    model: withToolImages(mock, fit),
    prompt: `What's in ${path}?`,
    stopWhen: stepCountIs(2),
    tools: createSandboxTools({ sandbox }),
  });
  const steps = await result.steps;
  const [, answered] = mock.doStreamCalls;
  if (!answered) {
    throw new Error("the model wasn't called after the read");
  }
  return {
    // The middleware runs inside the wrapper, so the mock sees its prompt.
    prompt: answered.prompt,
    stored: steps[0]?.toolResults[0]?.output,
  };
};

const filesIn = (prompt: LanguageModelV4Prompt) =>
  prompt.flatMap((message) =>
    message.role === "system"
      ? []
      : message.content.flatMap((part) => {
          if (part.type === "file") {
            return [{ part, role: message.role }];
          }
          if (part.type === "tool-result" && part.output.type === "content") {
            return part.output.value.flatMap((item) =>
              item.type === "file" ? [{ part: item, role: "tool" }] : []
            );
          }
          return [];
        })
  );

const toolText = (prompt: LanguageModelV4Prompt): string =>
  prompt
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .map((part) =>
      part.type === "tool-result" && part.output.type === "text"
        ? part.output.value
        : ""
    )
    .join("\n");

describe("read on an image", () => {
  it("stores a small result, never the bytes", async () => {
    const { stored } = await readThrough({ type: "inline" });
    expect(stored).toEqual({
      mediaType: "image/png",
      path: "red-square.png",
      size: png.byteLength,
      status: "image",
    });
    expect(JSON.stringify(stored)).not.toContain(base64);
  });

  it("shows a vision model the image in the tool result", async () => {
    const { prompt } = await readThrough(
      toolImageFit("anthropic", ["tools", "vision"])
    );
    expect(filesIn(prompt)).toEqual([
      {
        part: {
          data: { data: base64, type: "data" },
          mediaType: "image/png",
          type: "file",
        },
        role: "tool",
      },
    ]);
  });

  it("moves the image to a user message for an OpenAI-compatible vision model", async () => {
    const { prompt } = await readThrough(
      toolImageFit("openai-compatible", ["tools", "vision"])
    );
    expect(filesIn(prompt)).toEqual([
      {
        part: {
          data: { data: base64, type: "data" },
          mediaType: "image/png",
          type: "file",
        },
        role: "user",
      },
    ]);
    expect(prompt.at(-1)?.role).toBe("user");
    expect(toolText(prompt)).toContain("red-square.png is an image");
  });

  it("tells a model that can't see what to suggest instead", async () => {
    const { prompt } = await readThrough(
      toolImageFit("openai-compatible", ["tools"], ["ollama:qwen2.5vl:3b"])
    );
    expect(filesIn(prompt)).toEqual([]);
    expect(JSON.stringify(prompt)).not.toContain(base64);
    expect(toolText(prompt)).toContain("this model can't see images");
    expect(toolText(prompt)).toContain("such as ollama:qwen2.5vl:3b");
  });

  it("refuses an image over the cap", async () => {
    const sandbox = await createJustBashSandbox({
      id: fixtureId("sandbox", 1),
    });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png.subarray(0, 8));
    await sandbox.writeFile("big.png", big);
    const read = createSandboxTools({ sandbox }).read.execute;
    expect(
      await read?.(
        { path: "big.png" },
        { context: undefined, messages: [], toolCallId: "c" }
      )
    ).toEqual({
      message: "big.png is a 5.0 MB image; read shows images up to 5.0 MB.",
      status: "error",
    });
  });
});

describe("imageMediaTypeOf", () => {
  const ascii = (text: string) => new TextEncoder().encode(text);
  it.each([
    ["png", png, "image/png"],
    ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["gif", ascii("GIF89a"), "image/gif"],
    ["webp", ascii("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
    ["text", ascii("PNG is a format"), null],
    ["empty", new Uint8Array(), null],
  ])("knows %s by its magic number", (_, bytes, expected) => {
    expect(imageMediaTypeOf(bytes)).toBe(expected);
  });
});
