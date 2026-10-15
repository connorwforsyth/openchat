import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { runAgent } from "../../agent/run-agent";
import { readAll, textStream, toolCallStream } from "../../testing/mock-models";
import { aiBuiltinTools } from "./index";
import {
  type ArtifactGuidePorts,
  loadArtifactGuide,
  loadArtifactGuideModelText,
  loadArtifactGuideTool,
} from "./load-artifact-guide";
import { toAiSdkTool } from "./to-ai-sdk";

const ports: ArtifactGuidePorts = {
  guides: [
    { guide: "Write documents like this.", kind: "document" },
    { guide: "Build sites from site-ui.", kind: "site" },
  ],
};

describe("loadArtifactGuide", () => {
  it("returns the kind's guide, ignoring case", () => {
    expect(loadArtifactGuide(ports, { type: "Site" })).toEqual({
      guide: "Build sites from site-ui.",
      status: "loaded",
      type: "site",
    });
  });

  it("lists the guides there are for a kind it doesn't have", () => {
    const missing = loadArtifactGuide(ports, { type: "slides" });
    expect(missing).toEqual({
      available: ["document", "site"],
      status: "not_found",
    });
    expect(loadArtifactGuideModelText(missing)).toBe(
      "No guide for that type. Guides: document, site."
    );
  });
});

describe("the load_artifact_guide tool", () => {
  it("runs without asking, and is registered", () => {
    expect(loadArtifactGuideTool).toMatchObject({
      approval: "auto",
      capability: "artifacts",
      name: "load_artifact_guide",
    });
    expect(aiBuiltinTools.get("load_artifact_guide")).toBe(
      loadArtifactGuideTool
    );
  });

  it("hands a model the guide it asks for, as text", async () => {
    let step = 0;
    const prompts: unknown[] = [];
    const run = await runAgent({
      generateMessageId: () => "a1",
      messages: [
        {
          id: "u1",
          parts: [{ text: "Make me a landing page.", type: "text" }],
          role: "user",
        },
      ],
      model: new MockLanguageModelV4({
        doStream: ({ prompt }) => {
          step += 1;
          prompts.push(prompt);
          return Promise.resolve(
            step === 1
              ? toolCallStream("load_artifact_guide", { type: "site" })
              : textStream("Loaded it.")
          );
        },
      }),
      tools: {
        load_artifact_guide: toAiSdkTool(loadArtifactGuideTool, { ports }),
      },
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    await readAll(run.value.stream);
    expect(step).toBe(2);
    expect(JSON.stringify(prompts[1])).toContain(
      '<artifact-guide type=\\"site\\">\\nBuild sites from site-ui.\\n</artifact-guide>'
    );
  });
});
