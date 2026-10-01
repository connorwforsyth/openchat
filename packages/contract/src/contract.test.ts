import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type AnyContractProcedure, isContractProcedure } from "@orpc/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { contract } from "./contract";
import {
  baseErrors,
  budgetError,
  conflictError,
  encryptionError,
  errorCodeSchema,
  featureError,
  llmProxyErrors,
  providerError,
  readinessError,
} from "./errors";
import { generateOpenApi, serializeOpenApi } from "./openapi";

const procedures = Object.entries(contract).flatMap(([group, router]) =>
  Object.entries(router as Record<string, unknown>)
    .filter((entry): entry is [string, AnyContractProcedure] =>
      isContractProcedure(entry[1])
    )
    .map(([name, procedure]) => ({
      id: `${group}.${name}`,
      procedure: procedure["~orpc"],
    }))
);

const PATH_PARAM = /\{(\w+)\}/g;
const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE)$/;

describe("contract", () => {
  it("has procedures in every group", () => {
    for (const router of Object.values(contract)) {
      expect(Object.values(router).some(isContractProcedure)).toBe(true);
    }
    expect(procedures.length).toBeGreaterThan(90);
  });

  it.each(procedures)(
    "$id has a method, path, summary and tag",
    ({ procedure }) => {
      const { route } = procedure;
      expect(route.method).toMatch(HTTP_METHOD);
      expect(route.path?.startsWith("/")).toBe(true);
      expect(route.summary).toBeTruthy();
      expect(route.tags?.length).toBe(1);
    }
  );

  it("never maps two procedures to the same method and path", () => {
    const routes = procedures.map(
      ({ procedure }) => `${procedure.route.method} ${procedure.route.path}`
    );
    expect(new Set(routes).size).toBe(routes.length);
  });

  it.each(procedures)(
    "$id declares every path parameter in its input",
    ({ procedure }) => {
      const params = [...(procedure.route.path ?? "").matchAll(PATH_PARAM)].map(
        (match) => match[1]
      );
      const input = procedure.inputSchema;
      const keys = input instanceof z.ZodObject ? Object.keys(input.shape) : [];
      expect(keys).toEqual(expect.arrayContaining(params));
    }
  );

  it.each(procedures)(
    "$id can fail as unauthenticated or not found",
    ({ procedure }) => {
      expect(Object.keys(procedure.errorMap)).toEqual(
        expect.arrayContaining(["NOT_FOUND", "RATE_LIMITED"])
      );
    }
  );

  it("lists every error code the maps define", () => {
    const defined = Object.keys({
      ...baseErrors,
      ...budgetError,
      ...conflictError,
      ...encryptionError,
      ...featureError,
      ...providerError,
      ...readinessError,
    });
    expect([...errorCodeSchema.options].sort()).toEqual(
      ["BAD_REQUEST", ...defined].sort()
    );
    const used = new Set(
      procedures.flatMap(({ procedure }) => Object.keys(procedure.errorMap))
    );
    expect([...used].sort()).toEqual(defined.sort());
  });
});

describe("workspace file routes (055)", () => {
  const route = (name: keyof typeof contract.sandbox) => {
    const { errorMap, route: r } = contract.sandbox[name]["~orpc"];
    return {
      errors: Object.keys(errorMap).sort(),
      method: r.method,
      path: r.path,
    };
  };

  it("writes, imports and deletes by conversation, so the workspace can start on first use", () => {
    expect(route("writeFile")).toMatchObject({
      method: "POST",
      path: "/conversations/{conversationId}/sandbox/files",
    });
    expect(route("importFile")).toMatchObject({
      method: "POST",
      path: "/conversations/{conversationId}/sandbox/imports",
    });
    expect(route("deleteFile")).toMatchObject({
      method: "DELETE",
      path: "/conversations/{conversationId}/sandbox/files",
    });
    // Reading the workspace never creates it.
    expect(route("get").method).toBe("GET");
  });

  it("can say the feature is off, and conflicts where a version or path can", () => {
    expect(route("writeFile").errors).toEqual(
      expect.arrayContaining(["CONFLICT", "FEATURE_DISABLED"])
    );
    expect(route("deleteFile").errors).toEqual(
      expect.arrayContaining(["CONFLICT", "FEATURE_DISABLED"])
    );
    // A taken path gets a free name, so an import never conflicts.
    expect(route("importFile").errors).toContain("FEATURE_DISABLED");
    expect(route("importFile").errors).not.toContain("CONFLICT");
  });

  it("returns an etag with every read", () => {
    const output = contract.sandbox.readFile["~orpc"].outputSchema;
    const read = {
      content: "hi",
      encoding: "utf8",
      path: "a.txt",
      size: 2,
    };
    expect(output?.["~standard"].validate(read)).toHaveProperty("issues");
    expect(
      output?.["~standard"].validate({ ...read, etag: "a".repeat(64) })
    ).not.toHaveProperty("issues");
  });
});

describe("openapi.json", () => {
  const committedPath = fileURLToPath(
    new URL("../openapi.json", import.meta.url)
  );

  it("is up to date with the contract (run `bun run openapi:generate`)", async () => {
    const committed: unknown = JSON.parse(readFileSync(committedPath, "utf8"));
    // Round-trip through JSON so `undefined` fields drop out, as in the file.
    const generated: unknown = JSON.parse(
      serializeOpenApi(await generateOpenApi())
    );
    expect(committed).toEqual(generated);
  });

  it("documents the run stream as server-sent events", async () => {
    const document = await generateOpenApi();
    const stream = document.paths?.["/runs/{id}/stream"]?.get;
    expect(stream?.operationId).toBe("runs.stream");
    expect(Object.keys(stream?.responses?.["200"] ?? {})).toContain("content");
    expect(JSON.stringify(stream?.responses)).toContain("text/event-stream");
  });

  it("documents the model proxy as JSON or server-sent events", async () => {
    const document = await generateOpenApi();
    const proxy = document.paths?.["/llm"]?.post;
    expect(proxy?.operationId).toBe("llm.proxy");
    const ok = proxy?.responses?.["200"];
    const types = ok && "content" in ok ? Object.keys(ok.content ?? {}) : [];
    expect(types.sort()).toEqual(["application/json", "text/event-stream"]);
    for (const [code, { status }] of Object.entries(llmProxyErrors)) {
      expect(JSON.stringify(proxy?.responses?.[String(status)])).toContain(
        `#/components/schemas/${code}Error`
      );
    }
  });

  it("marks only public procedures as needing no session", async () => {
    const document = await generateOpenApi();
    const open = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
      Object.entries(item ?? {})
        .filter(
          ([, operation]) =>
            typeof operation === "object" &&
            operation !== null &&
            "security" in operation &&
            Array.isArray(operation.security) &&
            operation.security.length === 0
        )
        .map(([method]) => `${method.toUpperCase()} ${path}`)
    );
    expect(open.sort()).toEqual([
      "GET /config",
      "GET /health",
      "GET /published/{token}",
      "GET /share/{token}",
    ]);
  });

  it("documents the workspace file routes", async () => {
    const paths = (await generateOpenApi()).paths ?? {};
    expect(
      paths["/conversations/{conversationId}/sandbox/files"]?.post?.operationId
    ).toBe("sandbox.writeFile");
    expect(
      paths["/conversations/{conversationId}/sandbox/files"]?.delete
        ?.operationId
    ).toBe("sandbox.deleteFile");
    expect(
      paths["/conversations/{conversationId}/sandbox/imports"]?.post
        ?.operationId
    ).toBe("sandbox.importFile");
    expect(
      JSON.stringify(paths["/sandboxes/{id}/file"]?.get?.responses?.["200"])
    ).toContain('"etag"');
  });

  it("names shared shapes as components", async () => {
    const schemas = (await generateOpenApi()).components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        "Message",
        "MessagePart",
        "Run",
        "ResourceGrant",
        "NOT_FOUNDError",
        "UndefinedError",
      ])
    );
  });
});

describe("model options (096)", () => {
  const output = contract.meta.models["~orpc"].outputSchema;
  const option = {
    available: true,
    capabilities: ["tools"],
    contextWindow: null,
    label: "fast",
    selector: "fast",
    target: "anthropic:claude-haiku-4-5",
  };

  it("keeps a description and provider through the response schema", async () => {
    const described = {
      ...option,
      description: "Quick everyday answers",
      provider: "anthropic",
    };
    expect(await output?.["~standard"].validate([described])).toEqual({
      value: [described],
    });
  });

  it("still accepts options without them, as older servers send", async () => {
    expect(await output?.["~standard"].validate([option])).toEqual({
      value: [option],
    });
    expect(
      await output?.["~standard"].validate([
        { ...option, provider: "Not An Id" },
      ])
    ).toHaveProperty("issues");
  });
});

describe("model options (099)", () => {
  const output = contract.meta.models["~orpc"].outputSchema;
  const option = {
    available: true,
    capabilities: ["tools", "vision", "reasoning"],
    contextWindow: 200_000,
    description: "Quick everyday answers",
    label: "fast",
    provider: "anthropic",
    selector: "fast",
    target: "anthropic:claude-haiku-4-5",
  };

  it("keeps the preview card's fields through the response schema", async () => {
    const full = {
      ...option,
      cost: { input: 1_000_000, output: 5_000_000, tier: 2 },
      displayName: "Claude Haiku 4.5",
      ratings: { intelligence: 3, speed: 5 },
    };
    expect(await output?.["~standard"].validate([full])).toEqual({
      value: [full],
    });
  });

  it("still accepts the 096 shape without them", async () => {
    expect(await output?.["~standard"].validate([option])).toEqual({
      value: [option],
    });
  });

  it("refuses a tier off the 1–5 scale", async () => {
    expect(
      await output?.["~standard"].validate([{ ...option, cost: { tier: 0 } }])
    ).toHaveProperty("issues");
    expect(
      await output?.["~standard"].validate([
        { ...option, ratings: { speed: 6 } },
      ])
    ).toHaveProperty("issues");
  });
});

describe("link preview routes (101)", () => {
  it("are signed-in GETs that can say the feature is off", () => {
    for (const name of ["get", "image"] as const) {
      const { errorMap, route } = contract.linkPreviews[name]["~orpc"];
      expect(route.method).toBe("GET");
      expect(Object.keys(errorMap)).toEqual(
        expect.arrayContaining(["FEATURE_DISABLED", "UNAUTHORIZED"])
      );
    }
    expect(contract.linkPreviews.get["~orpc"].route.path).toBe("/link-preview");
    expect(contract.linkPreviews.image["~orpc"].route.path).toBe(
      "/link-preview/image"
    );
  });

  it("documents the image route as raster images only, with inert headers", async () => {
    const image = (await generateOpenApi()).paths?.["/link-preview/image"]?.get
      ?.responses?.["200"];
    const content = image && "content" in image ? image.content : {};
    expect(Object.keys(content ?? {})).not.toContain("image/svg+xml");
    expect(Object.keys(content ?? {})).toContain("image/png");
    expect(JSON.stringify(image)).toContain("x-content-type-options");
  });
});
