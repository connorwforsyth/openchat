// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests exercise `${ENV}` interpolation in YAML text.
import { describe, expect, it } from "vitest";

import { loadConfig } from "./load";

const files = (entries: Record<string, string>) => (path: string) =>
  Promise.resolve(entries[path]);

describe("loadConfig", () => {
  it("uses defaults when there is no file and no CONFIG_PATH", async () => {
    const result = await loadConfig({
      cwd: "/app",
      env: {},
      readText: files({}),
    });
    expect(result.ok && result.value.source).toBeNull();
    expect(result.ok && result.value.config.brand.name).toBe("Chat");
  });

  it("reads app.config.yaml from the working directory", async () => {
    const result = await loadConfig({
      cwd: "/app",
      env: {},
      readText: files({ "/app/app.config.yaml": "brand: { name: Acme }" }),
    });
    expect(result.ok && result.value).toMatchObject({
      config: { brand: { name: "Acme" } },
      source: "/app/app.config.yaml",
    });
  });

  it("follows CONFIG_PATH, relative to the working directory", async () => {
    const result = await loadConfig({
      cwd: "/app",
      env: { CONFIG_PATH: "config/prod.yaml" },
      readText: files({
        "/app/config/prod.yaml": "limits: { uploadMaxMb: 5 }",
      }),
    });
    expect(result.ok && result.value.config.limits.uploadMaxMb).toBe(5);
  });

  it("fails when CONFIG_PATH points at nothing", async () => {
    const result = await loadConfig({
      cwd: "/app",
      env: { CONFIG_PATH: "/etc/missing.yaml" },
      readText: files({}),
    });
    expect(!result.ok && result.error[0]?.message).toContain(
      "/etc/missing.yaml"
    );
  });

  it("passes the env through for interpolation", async () => {
    const result = await loadConfig({
      cwd: "/app",
      env: { OPENAI_API_KEY: "test-key" },
      readText: files({
        "/app/app.config.yaml":
          'providers: { openai: { apiKey: "${OPENAI_API_KEY}" } }',
      }),
    });
    expect(result.ok && result.value.config.providers.openai?.apiKey).toBe(
      "test-key"
    );
  });

  it("reads the real file system by default", async () => {
    const result = await loadConfig({ cwd: "/definitely/not/here", env: {} });
    expect(result.ok && result.value.source).toBeNull();
  });
});
