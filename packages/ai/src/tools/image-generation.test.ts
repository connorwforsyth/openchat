import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import {
  mockImageModel,
  TINY_PNG_BASE64,
  tinyPng,
} from "../testing/mock-image-model";
import type { ArtifactStore, NewArtifactContent } from "./artifact-content";
import {
  drawWith,
  generateImageModelText,
  type ImageDrawer,
  type ImagePorts,
  type ImageWorkspace,
  imageSlug,
  imageTitle,
  runGenerateImage,
} from "./image-generation";
import { generateImageTool } from "./registry/generate-image";
import { toAiSdkTool } from "./registry/to-ai-sdk";

const memoryStore = () => {
  const saved: NewArtifactContent[] = [];
  const store: ArtifactStore = {
    list: () => Promise.resolve([]),
    read: () => Promise.resolve(null),
    save: (input) => {
      saved.push(input);
      return Promise.resolve(
        ok({
          artifactId: newId("artifact"),
          kind: input.kind,
          title: input.title,
          version: 1,
          versionId: newId("artifactVersion"),
        })
      );
    },
  };
  return { saved, store };
};

const memoryWorkspace = (initial: Record<string, Uint8Array> = {}) => {
  const files = new Map(Object.entries(initial));
  const workspace: ImageWorkspace = {
    readFile: (path) => {
      const bytes = files.get(path);
      return Promise.resolve(bytes ? ok(bytes) : err({ type: "not_found" }));
    },
    writeFile: (path, bytes) => {
      files.set(path, bytes);
      return Promise.resolve(ok(undefined));
    },
  };
  return { files, workspace };
};

const drawerFor = (model = mockImageModel()): ImageDrawer => ({
  displayName: "Pixel",
  draw: drawWith(model.model),
  target: "mock:pixel",
});

describe("imageSlug and imageTitle", () => {
  it("names a file after the prompt's first words", () => {
    expect(imageSlug("A lighthouse at dusk, oil painting, warm light")).toBe(
      "a-lighthouse-at-dusk-oil-painting"
    );
    expect(imageSlug("Café Ünïcode!")).toBe("cafe-unicode");
    expect(imageSlug("🎨🎨")).toBe("image");
  });

  it("titles an image after its prompt, numbered when there are several", () => {
    expect(imageTitle('A "red" fox', 0, 1)).toBe("A 'red' fox");
    expect(imageTitle("A fox", 1, 3)).toBe("A fox (2)");
    expect(imageTitle("x".repeat(200), 0, 1)).toHaveLength(80);
  });
});

describe("runGenerateImage", () => {
  it("draws, writes each image into the workspace and saves each as an artifact", async () => {
    const model = mockImageModel();
    const { saved, store } = memoryStore();
    const { files, workspace } = memoryWorkspace();
    const charges: unknown[] = [];
    const output = await runGenerateImage(
      {
        artifacts: store,
        drawer: drawerFor(model),
        record: (charge) => {
          charges.push(charge);
          return Promise.resolve();
        },
        workspace,
      },
      { aspectRatio: "16:9", count: 2, prompt: "A harbour at dawn" }
    );
    expect(output).toMatchObject({
      images: [
        { mediaType: "image/png", path: "images/a-harbour-at-dawn-1.png" },
        { mediaType: "image/png", path: "images/a-harbour-at-dawn-2.png" },
      ],
      model: "Pixel",
      source: null,
      status: "generated",
    });
    expect(model.calls[0]).toMatchObject({ aspectRatio: "16:9", n: 2 });
    expect([...files.keys()]).toEqual([
      "images/a-harbour-at-dawn-1.png",
      "images/a-harbour-at-dawn-2.png",
    ]);
    expect(saved.map((entry) => [entry.kind, entry.title])).toEqual([
      ["image", "A harbour at dawn (1)"],
      ["image", "A harbour at dawn (2)"],
    ]);
    expect(saved[0]?.content).toBe(`data:image/png;base64,${TINY_PNG_BASE64}`);
    expect(builtinArtifactKinds.check("image", saved[0]?.content)).toEqual([]);
    expect(charges).toEqual([
      {
        count: 2,
        model: "mock:pixel",
        usage: { inputTokens: 10, outputTokens: 100 },
      },
    ]);
  });

  it("never overwrites an earlier picture", async () => {
    const { workspace } = memoryWorkspace({
      "images/fox-1.png": tinyPng(),
      "images/fox-2.png": tinyPng(),
    });
    const output = await runGenerateImage(
      { artifacts: memoryStore().store, drawer: drawerFor(), workspace },
      { prompt: "Fox" }
    );
    expect(output).toMatchObject({ images: [{ path: "images/fox-3.png" }] });
  });

  it("edits the workspace image `source` names", async () => {
    const model = mockImageModel();
    const { workspace } = memoryWorkspace({ "images/fox-1.png": tinyPng() });
    const output = await runGenerateImage(
      { artifacts: memoryStore().store, drawer: drawerFor(model), workspace },
      { prompt: "Make it blue", source: "images/fox-1.png" }
    );
    expect(output).toMatchObject({
      source: "images/fox-1.png",
      status: "generated",
    });
    expect(model.calls[0]?.files).toHaveLength(1);
    expect(model.calls[0]?.prompt).toBe("Make it blue");
  });

  it("says so when the source isn't there, drawing nothing", async () => {
    const model = mockImageModel();
    const output = await runGenerateImage(
      {
        artifacts: memoryStore().store,
        drawer: drawerFor(model),
        workspace: memoryWorkspace().workspace,
      },
      { prompt: "Bluer", source: "images/nope.png" }
    );
    expect(output).toEqual({ path: "images/nope.png", status: "not_found" });
    expect(model.calls).toEqual([]);
  });

  it("draws nothing over budget, or without an image model", async () => {
    const model = mockImageModel();
    const ports: ImagePorts = {
      artifacts: memoryStore().store,
      drawer: drawerFor(model),
      withinBudget: () => Promise.resolve(false),
    };
    expect(await runGenerateImage(ports, { prompt: "A fox" })).toEqual({
      status: "over_budget",
    });
    expect(
      await runGenerateImage(
        { ...ports, drawer: null, withinBudget: undefined },
        { prompt: "A fox" }
      )
    ).toMatchObject({ status: "unavailable" });
    expect(model.calls).toEqual([]);
  });

  it("keeps images as artifacts only when the workspace is off", async () => {
    const { saved, store } = memoryStore();
    const output = await runGenerateImage(
      { artifacts: store, drawer: drawerFor() },
      { prompt: "A fox" }
    );
    expect(output).toMatchObject({
      images: [{ path: null }],
      status: "generated",
    });
    expect(saved).toHaveLength(1);
  });

  it("turns a provider failure into a result the model reads", async () => {
    const failing = mockImageModel({ fail: new Error("quota exceeded") });
    const output = await runGenerateImage(
      { artifacts: memoryStore().store, drawer: drawerFor(failing) },
      { prompt: "A fox" }
    );
    expect(output).toEqual({
      message: "the image model failed (quota exceeded).",
      status: "unavailable",
    });
  });
});

describe("generate_image", () => {
  it("asks first by default and needs the images capability", () => {
    expect(generateImageTool).toMatchObject({
      approval: "ask",
      capability: "images",
      name: "generate_image",
    });
  });

  it("caps a call at four images", () => {
    const parse = (count: number) =>
      generateImageTool.input.safeParse({ count, prompt: "x" }).success;
    expect(parse(4)).toBe(true);
    expect(parse(5)).toBe(false);
    expect(parse(0)).toBe(false);
  });

  it("tells the model where the images went, not what they show", async () => {
    const tool = toAiSdkTool(generateImageTool, {
      ports: {
        artifacts: memoryStore().store,
        drawer: drawerFor(),
        workspace: memoryWorkspace().workspace,
      },
    });
    const output = await tool.execute?.(
      { prompt: "A fox" },
      { context: {}, messages: [], toolCallId: "call-1" }
    );
    expect(
      generateImageModelText(
        output as Parameters<typeof generateImageModelText>[0]
      )
    ).toBe(
      "Made 1 image with Pixel. Saved in the workspace as images/a-fox-1.png, and as artifacts. The user sees them in the reply; you can't see them, so don't describe them. To change one, call generate_image again with its path as `source`."
    );
  });
});
