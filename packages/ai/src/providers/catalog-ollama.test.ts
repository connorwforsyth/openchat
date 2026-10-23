import { providerConfigSchema } from "@workspace/config/schema";
import { delay, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { fetchCatalog } from "./catalog";

const ROOT = "http://ollama.test";
const config = providerConfigSchema.parse({
  baseURL: `${ROOT}/v1`,
  headers: { "x-team": "test-team" },
  type: "openai-compatible",
});
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const list = (names: readonly string[]) =>
  http.get(`${ROOT}/api/tags`, () =>
    HttpResponse.json({ models: names.map((name) => ({ name })) })
  );

const traits = async () => {
  const result = await fetchCatalog("ollama", config, undefined);
  if (!result.ok) {
    throw new Error(`catalog failed: ${result.error.type}`);
  }
  return result.value.map((model) => model.traits);
};

describe("Ollama model metadata", () => {
  it("reads modern per-model capabilities from show, with old-style tags", async () => {
    server.use(
      list(["custom-vision:latest", "custom-text:latest"]),
      http.post(`${ROOT}/api/show`, async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({
          capabilities: JSON.stringify(body).includes("custom-vision")
            ? ["completion", "vision"]
            : ["completion", "tools"],
        });
      })
    );
    expect(await traits()).toEqual([{ vision: true }, { vision: false }]);
  });

  it("reads a v0.6 vision projector without guessing about the text model", async () => {
    server.use(
      list(["renamed:latest", "llama3.2:latest"]),
      http.post(`${ROOT}/api/show`, async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(
          JSON.stringify(body).includes("renamed")
            ? {
                model_info: { "general.architecture": "llama" },
                projector_info: { "clip.has_vision_encoder": true },
              }
            : { model_info: { "general.architecture": "llama" } }
        );
      })
    );
    expect(await traits()).toEqual([{ vision: true }, undefined]);
  });

  it.each([
    {},
    { capabilities: "vision" },
    { projector_info: { "clip.has_vision_encoder": "true" } },
    { projector_info: { "clip.has_vision_encoder": false } },
  ])("keeps incomplete or malformed metadata unknown (%j)", async (body) => {
    server.use(
      list(["llava-vision:latest"]),
      http.post(`${ROOT}/api/show`, () => HttpResponse.json(body))
    );
    expect(await traits()).toEqual([undefined]);
  });

  it("keeps failed metadata unknown and retains the catalog", async () => {
    server.use(
      list(["vision:latest", "text:latest"]),
      http.post(`${ROOT}/api/show`, () =>
        HttpResponse.json({ error: "not available" }, { status: 500 })
      )
    );
    expect(await traits()).toEqual([undefined, undefined]);
  });

  it("ignores unsupported capability fields on tags", async () => {
    server.use(
      http.get(`${ROOT}/api/tags`, () =>
        HttpResponse.json({
          models: [{ capabilities: ["vision"], name: "text:latest" }],
        })
      ),
      http.post(`${ROOT}/api/show`, () =>
        HttpResponse.json({ capabilities: ["completion"] })
      )
    );
    expect(await traits()).toEqual([{ vision: false }]);
  });

  it("scopes show to the same credential base URL and headers as tags", async () => {
    const seen: string[] = [];
    const credentialRoot = "http://credential-ollama.test";
    server.use(
      http.get(`${credentialRoot}/api/tags`, ({ request }) => {
        seen.push(request.headers.get("authorization") ?? "");
        return HttpResponse.json({ models: [{ name: "custom:latest" }] });
      }),
      http.post(`${credentialRoot}/api/show`, async ({ request }) => {
        seen.push(request.headers.get("authorization") ?? "");
        expect(request.headers.get("x-team")).toBe("test-team");
        expect(request.headers.get("content-type")).toBe("application/json");
        expect(await request.json()).toEqual({ model: "custom:latest" });
        return HttpResponse.json({ capabilities: ["vision"] });
      })
    );
    const result = await fetchCatalog("ollama", config, {
      apiKey: "test-key-not-real",
      baseURL: `${credentialRoot}/v1`,
      provider: "ollama",
      source: { type: "instance" },
    });
    expect(result.ok && result.value[0]?.traits).toEqual({ vision: true });
    expect(seen).toEqual([
      "Bearer test-key-not-real",
      "Bearer test-key-not-real",
    ]);
  });

  it("shares the catalog timeout with show requests", async () => {
    let aborted = false;
    server.use(
      list(["custom:latest"]),
      http.post(`${ROOT}/api/show`, async ({ request }) => {
        request.signal.addEventListener("abort", () => {
          aborted = true;
        });
        await delay(200);
        return HttpResponse.json({ capabilities: ["vision"] });
      })
    );
    const result = await fetchCatalog("ollama", config, undefined, {
      timeoutMs: 80,
    });
    expect(result.ok && result.value[0]?.traits).toBeUndefined();
    expect(aborted).toBe(true);
  });

  it("cancels show with the caller's signal", async () => {
    const controller = new AbortController();
    server.use(
      list(["custom:latest"]),
      http.post(`${ROOT}/api/show`, () => {
        controller.abort();
        return HttpResponse.json({ capabilities: ["vision"] });
      })
    );
    const result = await fetchCatalog("ollama", config, undefined, {
      signal: controller.signal,
    });
    expect(result.ok && result.value[0]?.traits).toBeUndefined();
    expect(controller.signal.aborted).toBe(true);
  });
});
