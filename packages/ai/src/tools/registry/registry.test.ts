import type { FileId } from "@workspace/contract/schemas/common";
import type { FileSearchHit } from "@workspace/contract/schemas/files";
import { newId } from "@workspace/shared/ids";
import { asSchema, dynamicTool, jsonSchema, type Tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  cosineSimilarity,
  createHashEmbedder,
  hashEmbedding,
} from "../../ports/embedder.memory";
import { type ChunkQuery, createFileSearchTool } from "../../rag/file-search";
import { clientToolDefinition, mcpToolDefinition } from "./adapt";
import { defineTool, type ToolContext } from "./define";
import { fileSearch } from "./file-search";
import { aiBuiltinTools, createToolRegistry } from "./index";
import { toAiSdkTool } from "./to-ai-sdk";

const call = (tool: Tool, input: unknown, signal?: AbortSignal) =>
  tool.execute?.(input, {
    abortSignal: signal,
    context: {},
    messages: [],
    toolCallId: "call_1",
  });

const shout = defineTool({
  description: "Says it louder.",
  execute: (
    { text },
    ctx: ToolContext<{ readonly ports: { readonly suffix: string } }>
  ) => ({
    aborted: ctx.signal?.aborted ?? null,
    call: ctx.toolCallId,
    text: `${text.toUpperCase()}${ctx.ports.suffix}`,
  }),
  input: z.object({ text: z.string() }),
  modelText: (output) => `It said ${output.text}`,
  name: "shout",
});

describe("defineTool", () => {
  it("is a built-in that runs without asking unless it says otherwise", () => {
    expect(shout).toMatchObject({
      approval: "auto",
      name: "shout",
      source: "builtin",
    });
  });
});

describe("toAiSdkTool", () => {
  it("binds the run's context and passes each call's id and abort signal", async () => {
    const tool = toAiSdkTool(shout, { ports: { suffix: "!" } });
    const abort = new AbortController();
    abort.abort();
    expect(tool.description).toBe("Says it louder.");
    expect(asSchema(tool.inputSchema).jsonSchema).toMatchObject({
      properties: { text: { type: "string" } },
      required: ["text"],
    });
    expect(await call(tool, { text: "hi" }, abort.signal)).toEqual({
      aborted: true,
      call: "call_1",
      text: "HI!",
    });
    expect(await call(tool, { text: "hi" })).toMatchObject({ aborted: null });
  });

  it("gives the model the definition's text for a result", () => {
    const tool = toAiSdkTool(shout, { ports: { suffix: "!" } });
    expect(
      tool.toModelOutput?.({
        input: { text: "hi" },
        output: { aborted: null, call: "call_1", text: "HI!" },
        toolCallId: "call_1",
      })
    ).toEqual({ type: "text", value: "It said HI!" });
  });

  it("leaves a client tool without execute, so the run stops at its call", () => {
    const definition = clientToolDefinition({
      description: "Pick a folder.",
      inputSchema: { properties: {}, type: "object" },
      name: "pick_folder",
    });
    const tool = toAiSdkTool(definition);
    expect(definition).toMatchObject({ approval: "auto", source: "client" });
    expect(Object.keys(tool).sort()).toEqual(["description", "inputSchema"]);
    expect(asSchema(tool.inputSchema).jsonSchema).toEqual({
      properties: {},
      type: "object",
    });
  });

  it("hands an MCP tool back exactly as its source built it", () => {
    const mcp = dynamicTool({
      description: "Echoes the text back.",
      execute: (input) => Promise.resolve(input),
      inputSchema: jsonSchema({ properties: {}, type: "object" }),
    });
    const definition = mcpToolDefinition("open__echo", mcp);
    expect(definition).toMatchObject({
      approval: "ask",
      description: "Echoes the text back.",
      name: "open__echo",
      source: "mcp",
    });
    expect(toAiSdkTool(definition)).toBe(mcp);
  });
});

describe("createToolRegistry", () => {
  it("finds definitions by name and lists their defaults", () => {
    const quiet = defineTool({
      approval: "ask",
      capability: "sandbox",
      description: "Says nothing.",
      execute: () => null,
      input: z.object({}),
      name: "quiet",
    });
    const registry = createToolRegistry([shout, quiet]);
    expect(registry.names).toEqual(["shout", "quiet"]);
    expect(registry.get("quiet")).toBe(quiet);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.approvals).toEqual({ quiet: "ask", shout: "auto" });
    expect(registry.withCapability("sandbox")).toEqual(["quiet"]);
  });

  it("refuses two tools with one name", () => {
    expect(() => createToolRegistry([shout, shout])).toThrow("shout");
  });
});

describe("the built-ins written in this package", () => {
  it("are registered under the names runs offer them by, with today's defaults", () => {
    expect(aiBuiltinTools.approvals).toEqual({
      create_artifact: "ask",
      file_search: "auto",
      load_skill: "auto",
      update_artifact: "ask",
      update_memory: "auto",
      web_search: "auto",
    });
    for (const definition of aiBuiltinTools.definitions) {
      expect(definition.source).toBe("builtin");
      expect(definition.description).toBeTruthy();
    }
  });
});

// `rag/file-search.ts` still has the old `createFileSearchTool` as it was
// (that module is outside what 080 owns). Until it goes, the definition
// must say and do exactly what it does.
describe("file_search and the factory it replaces", () => {
  const embedder = createHashEmbedder({ dimensions: 64 });
  const mine = newId("file") as FileId;
  const corpus = [
    { page: 3, text: "Kumquats ripen in the winter months." },
    { page: null, text: "Invoices are due within thirty days." },
  ].map((chunk) => ({
    ...chunk,
    chunkId: newId("fileChunk"),
    embedding: hashEmbedding(chunk.text, 64),
    fileId: mine,
    filename: "fruit.pdf",
  }));
  const searchChunks = (query: ChunkQuery): Promise<FileSearchHit[]> =>
    Promise.resolve(
      corpus
        .map(({ embedding, ...chunk }) => ({
          ...chunk,
          score: Math.max(0, cosineSimilarity(embedding, query.embedding)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit)
    );
  const both = (searchable: readonly FileId[]) => {
    const deps = {
      embedder,
      searchableFileIds: () => Promise.resolve(searchable),
      searchChunks,
    };
    return {
      defined: toAiSdkTool(fileSearch, { ports: deps }),
      old: createFileSearchTool(deps),
    };
  };

  it("describes itself and its schemas the same way", () => {
    const { defined, old } = both([mine]);
    expect(defined.description).toBe(old.description);
    expect(asSchema(defined.inputSchema).jsonSchema).toEqual(
      asSchema(old.inputSchema).jsonSchema
    );
    expect(defined.outputSchema).toBe(old.outputSchema);
    expect(Object.keys(defined).sort()).toEqual(Object.keys(old).sort());
  });

  it("returns the same results, citations and model text", async () => {
    for (const searchable of [[mine], []]) {
      const { defined, old } = both(searchable);
      const input = { limit: 2, query: "when do kumquats ripen" };
      // biome-ignore lint/performance/noAwaitInLoops: two cases, compared one at a time.
      const [ours, theirs] = await Promise.all([
        call(defined, input),
        call(old, input),
      ]);
      expect(ours).toEqual(theirs);
      const asModelReads = (tool: Tool) =>
        tool.toModelOutput?.({ input, output: ours, toolCallId: "call_1" });
      expect(asModelReads(defined)).toEqual(asModelReads(old));
    }
  });
});
