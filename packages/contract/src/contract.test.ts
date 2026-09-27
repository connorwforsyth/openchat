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
      "GET /share/{token}",
    ]);
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
