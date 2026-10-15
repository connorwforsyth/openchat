import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { evalite } from "evalite";
import { z } from "zod";

import { runAgent } from "../src/agent/run-agent";
import { kindPrompts } from "../src/prompts/artifact-guides";
import {
  readAll,
  textStream,
  toolCallStream,
} from "../src/testing/mock-models";
import { loadArtifactGuideTool } from "../src/tools/registry/load-artifact-guide";
import { toAiSdkTool } from "../src/tools/registry/to-ai-sdk";
import { passes } from "./core/scorers";

// Dev eval (D21, ticket 160): with guides on demand, the system prompt only
// points at the Site guide; a model that loads it first has the instance's
// rules in front of it by the time it creates the site. Scripted, so it
// needs no network and no keys.

interface GuidedSite {
  /** What `create_artifact` was called with, in order. */
  readonly created: readonly { readonly type: string }[];
  /** Whether the Site guide was in the prompt the create call came from. */
  readonly guideBeforeCreate: boolean;
  /** Whether the system prompt carried the whole Site guide. */
  readonly guideInSystem: boolean;
}

const SITE = JSON.stringify({
  files: {
    "index.tsx":
      'import { Hero, Page } from "@workspace/site-ui";\nexport default function Home() { return <Page><Hero title="Hi" /></Page>; }',
  },
});

const guidedSite = async (): Promise<GuidedSite> => {
  const site = builtinArtifactKinds.get("site");
  const guide = site?.instructions ?? "";
  const system = kindPrompts(builtinArtifactKinds.instructionFiles(), true)
    .map(({ text }) => text)
    .join("\n\n");
  const created: { type: string }[] = [];
  let step = 0;
  const model = new MockLanguageModelV4({
    doStream: () => {
      step += 1;
      if (step === 1) {
        return Promise.resolve(
          toolCallStream("load_artifact_guide", { type: "site" })
        );
      }
      if (step === 2) {
        return Promise.resolve(
          toolCallStream("create_artifact", {
            content: SITE,
            title: "Hello",
            type: "site",
          })
        );
      }
      return Promise.resolve(textStream("Made it."));
    },
  });
  const run = await runAgent({
    instructions: system,
    messages: [
      {
        id: "u1",
        parts: [{ text: "Make me a landing page.", type: "text" }],
        role: "user",
      },
    ],
    model,
    tools: {
      create_artifact: tool({
        description: "Save an artifact.",
        execute: (input) => {
          created.push({ type: input.type });
          return "Saved.";
        },
        inputSchema: z.object({
          content: z.string(),
          title: z.string(),
          type: z.string(),
        }),
      }),
      load_artifact_guide: toAiSdkTool(loadArtifactGuideTool, {
        ports: { guides: [{ guide, kind: "site" }] },
      }),
    },
  });
  if (!run.ok) {
    throw new Error(run.error.message);
  }
  await readAll(run.value.stream);
  const createPrompt = JSON.stringify(model.doStreamCalls[1]?.prompt ?? []);
  const marker = guide.split("\n")[0] ?? "";
  return {
    created,
    guideBeforeCreate: marker !== "" && createPrompt.includes(marker),
    guideInSystem: system.includes(marker),
  };
};

evalite<string, GuidedSite>("A site is made after its guide is loaded", {
  data: [{ input: "site" }],
  scorers: [
    passes("the system prompt only points at the guide", (output) =>
      output.guideInSystem ? "the whole guide was in the system prompt" : true
    ),
    passes("the guide reached the model before it created", (output) =>
      output.guideBeforeCreate ? true : "the create call never saw the guide"
    ),
    passes("created one site", (output) =>
      output.created.length === 1 && output.created[0]?.type === "site"
        ? true
        : `created ${JSON.stringify(output.created)}`
    ),
  ],
  task: guidedSite,
});
