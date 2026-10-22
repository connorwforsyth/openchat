// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests exercise `${ENV}` interpolation in YAML text.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatConfigErrors, interpolateEnv, parseConfig } from "./parse";

const example = readFileSync(
  fileURLToPath(new URL("../../../app.config.example.yaml", import.meta.url)),
  "utf8"
);

const expectOk = (text: string, env: Record<string, string> = {}) => {
  const result = parseConfig(text, env);
  if (!result.ok) {
    throw new Error(formatConfigErrors(result.error));
  }
  return result.value;
};

const expectErrors = (text: string, env: Record<string, string> = {}) => {
  const result = parseConfig(text, env);
  if (result.ok) {
    throw new Error("expected config errors");
  }
  return result.error;
};

describe("parseConfig defaults", () => {
  it("boots on an empty file with every default", () => {
    const config = expectOk("");
    expect(config.version).toBe(1);
    expect(config.auth.signup).toBe("invite");
    expect(config.brand.name).toBe("Chat");
    expect(config.providers).toEqual({
      ollama: {
        baseURL: "http://localhost:11434/v1",
        // Discovery is opt-in (095): the default Ollama lists nothing extra.
        discover: false,
        discoverTtlSeconds: 3600,
        exclude: [],
        headers: {},
        include: [],
        models: [],
        options: {},
        type: "openai-compatible",
      },
    });
    expect(config.policies.chatContext).toEqual(["personal", "team", "org"]);
    expect(config.policies.instanceKeys).toEqual({
      org: false,
      personal: true,
      team: false,
    });
    expect(config.sandbox.default).toBe("just-bash");
    expect(config.search.backend).toBe("none");
    expect(config.storage).toEqual({ driver: "local", path: "./.data/files" });
    expect(config.embeddings.model).toBeNull();
    expect(config.features.publicLinks).toBe(false);
    expect(config.features.importers).toBe(true);
    expect(config.features.linkPreviews).toBe(true);
    expect(config.observability.otlp).toBeNull();
    expect(config.observability.recordContent).toBe(false);
    expect(config.policies.persistClientCache).toBe("allowed");
  });

  it("turns link previews off, and refuses unknown feature flags (101)", () => {
    const config = expectOk("features: { linkPreviews: false }");
    expect(config.features.linkPreviews).toBe(false);
    expect(config.features.webSearch).toBe(true);
    expect(parseConfig("features: { linkPreview: false }", {}).ok).toBe(false);
  });

  it("treats a comment-only file as empty", () => {
    expect(expectOk("# nothing yet\n")).toEqual(expectOk(""));
  });

  it("fills defaults inside a partly written section", () => {
    const config = expectOk(
      "limits: { uploadMaxMb: 5 }\nfeatures: { publicLinks: true }"
    );
    expect(config.limits.uploadMaxMb).toBe(5);
    expect(config.limits.requestsPerMinute).toBe(60);
    expect(config.features).toMatchObject({
      importers: true,
      publicLinks: true,
    });
  });

  it("infers a native provider's type from its key", () => {
    const config = expectOk("providers:\n  anthropic: { apiKey: test-key }");
    expect(config.providers.anthropic?.type).toBe("anthropic");
    // Configuring providers replaces the Ollama default rather than merging.
    expect(config.providers.ollama).toBeUndefined();
  });

  it("parses the example file with an empty env", () => {
    const config = expectOk(example);
    expect(config.brand.name.length).toBeGreaterThan(0);
    expect(config.providers.anthropic?.apiKey).toBeUndefined();
    expect(config.providers.ollama?.baseURL).toBe("http://localhost:11434/v1");
    expect(config.search.searxng?.url).toBe("http://localhost:8080");
    expect(config.models.auto.enabled).toBe(true);
  });
});

describe("env interpolation", () => {
  it("substitutes whole values and embedded references", () => {
    const config = expectOk(
      'providers:\n  gw: { type: openai-compatible, baseURL: "https://${GW_HOST}/v1", apiKey: "${GW_KEY}" }',
      { GW_HOST: "gw.example.test", GW_KEY: "test-key" }
    );
    expect(config.providers.gw).toMatchObject({
      apiKey: "test-key",
      baseURL: "https://gw.example.test/v1",
    });
  });

  it("drops a whole-value reference to an unset or empty variable", () => {
    const config = expectOk(
      'providers:\n  openai: { apiKey: "${OPENAI_API_KEY}" }',
      {
        OPENAI_API_KEY: "",
      }
    );
    expect(config.providers.openai).toMatchObject({ type: "openai" });
    expect(config.providers.openai?.apiKey).toBeUndefined();
  });

  it("uses `:-` fallbacks", () => {
    const config = expectOk(
      'search: { backend: searxng, searxng: { url: "${SEARXNG_URL:-http://searxng:8080}" } }'
    );
    expect(config.search.searxng?.url).toBe("http://searxng:8080");
  });

  it("reports an unset variable inside a longer string, with its path", () => {
    const errors = expectErrors(
      'providers:\n  gw: { type: openai-compatible, baseURL: "https://${GW_HOST}/v1" }'
    );
    expect(errors).toContainEqual({
      message: expect.stringContaining("GW_HOST is not set"),
      path: ["providers", "gw", "baseURL"],
    });
  });

  it("keeps `$${` as a literal and never re-reads substituted values", () => {
    expect(interpolateEnv("pa$${X}ss", {}).value).toBe("pa${X}ss");
    expect(interpolateEnv("${A}", { A: "${B}", B: "nope" }).value).toBe("${B}");
  });

  it("walks arrays and nested objects", () => {
    expect(
      interpolateEnv({ list: ["${A}", { b: "${B:-x}" }], n: 1 }, { A: "a" })
        .value
    ).toEqual({ list: ["a", { b: "x" }], n: 1 });
  });
});

describe("readable errors", () => {
  it("reports YAML syntax errors with a line", () => {
    const [error] = expectErrors("brand:\n  name: [unclosed\n");
    expect(error?.message.startsWith("YAML: ")).toBe(true);
    expect(error?.line).toBeGreaterThan(0);
  });

  it("rejects a config that isn't a mapping", () => {
    expect(expectErrors("- just\n- a list\n")[0]?.message).toContain("mapping");
  });

  it("names every problem by path, not just the first", () => {
    const errors = expectErrors(
      [
        "version: 2",
        "auth: { signup: sometimes }",
        "limits: { uploadMaxMb: -1 }",
        "brand: { nmae: typo }",
      ].join("\n")
    );
    const paths = errors.map((error) => error.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining([
        "version",
        "auth.signup",
        "limits.uploadMaxMb",
        "brand",
      ])
    );
    expect(errors.find((e) => e.path.join(".") === "brand")?.message).toContain(
      "nmae"
    );
  });

  it("requires a type and baseURL for custom providers", () => {
    const errors = expectErrors(
      "providers:\n  mygw: { apiKey: test-key }\n  other: { type: openai-compatible }"
    );
    expect(errors.map((e) => e.path.join("."))).toEqual([
      "providers.mygw.type",
      "providers.other.baseURL",
    ]);
  });

  it("reserves the `auto` alias", () => {
    const errors = expectErrors(
      "providers: { anthropic: {} }\nmodels: { aliases: { auto: anthropic:claude-haiku-4-5 } }"
    );
    expect(errors).toEqual([
      {
        message: expect.stringContaining("reserved"),
        path: ["models", "aliases", "auto"],
      },
    ]);
  });

  it("checks model references against providers and aliases", () => {
    const errors = expectErrors(
      [
        "providers: { anthropic: {} }",
        "models:",
        "  aliases: { fast: openai:gpt-5-mini }",
        "  default: speedy",
        "  auto: { enabled: true, cheap: fast, strong: anthropic:claude-opus-5-5 }",
        "decider: { model: mistral:small }",
        "embeddings: { model: anthropic:embed }",
      ].join("\n")
    );
    const byPath = Object.fromEntries(
      errors.map((e) => [e.path.join("."), e.message])
    );
    expect(Object.keys(byPath).sort()).toEqual([
      "decider.model",
      "models.aliases.fast",
      "models.default",
    ]);
    expect(byPath["models.aliases.fast"]).toContain('provider "openai"');
    expect(byPath["models.default"]).toContain('"speedy"');
    expect(byPath["decider.model"]).toContain('provider "mistral"');
  });

  it("needs both ends of auto routing", () => {
    const errors = expectErrors(
      "models: { auto: { enabled: true, cheap: auto } }"
    );
    expect(errors).toEqual([
      {
        message: expect.stringContaining("itself"),
        path: ["models", "auto", "cheap"],
      },
      {
        message: expect.stringContaining("cheap"),
        path: ["models", "auto", "strong"],
      },
    ]);
  });

  it("requires the block for a chosen backend or sandbox provider", () => {
    const errors = expectErrors(
      "search: { backend: brave }\nsandbox: { default: docker }"
    );
    expect(errors.map((e) => e.path.join("."))).toEqual(
      expect.arrayContaining(["search.brave", "sandbox.docker"])
    );
  });

  it("enforces signup mode requirements", () => {
    const errors = expectErrors("auth: { signup: domain }");
    expect(errors[0]).toMatchObject({ path: ["auth", "domains"] });
  });

  it("never echoes a secret value in a message", () => {
    const errors = expectErrors(
      'providers:\n  openai: { apiKey: "${KEY}", baseURL: not-a-url }\nunknownSection: { token: "${KEY}" }',
      { KEY: "sk-test-secret-value" }
    );
    expect(formatConfigErrors(errors)).not.toContain("sk-test-secret-value");
  });

  it("formats one line per problem", () => {
    expect(
      formatConfigErrors([
        { message: "Invalid URL", path: ["providers", "openai", "baseURL"] },
        { line: 3, message: "YAML: bad", path: [] },
      ])
    ).toBe(
      "app.config.yaml  providers.openai.baseURL: Invalid URL\napp.config.yaml:3  (root): YAML: bad"
    );
  });
});

describe("sandbox egress", () => {
  it("is open by default, with the package registries listed for allowlist", () => {
    const { egress } = expectOk("").sandbox;
    expect(egress.mode).toBe("open");
    expect(egress.allow).toEqual(
      expect.arrayContaining([
        "registry.npmjs.org",
        "pypi.org",
        "files.pythonhosted.org",
        "github.com",
      ])
    );
  });

  it("reads the mode and the host list from the file", () => {
    const { egress } = expectOk(
      "sandbox:\n  egress:\n    mode: allowlist\n    allow: [registry.npmjs.org, '*.example.com']"
    ).sandbox;
    expect(egress).toEqual({
      allow: ["registry.npmjs.org", "*.example.com"],
      mode: "allowlist",
    });
  });

  it("lets SANDBOX_EGRESS override the file's mode and keeps its list", () => {
    const { egress } = expectOk(
      "sandbox:\n  egress: { mode: open, allow: [pypi.org] }",
      { SANDBOX_EGRESS: "none" }
    ).sandbox;
    expect(egress).toEqual({ allow: ["pypi.org"], mode: "none" });
  });

  it("ignores an empty SANDBOX_EGRESS", () => {
    expect(
      expectOk("sandbox: { egress: { mode: allowlist } }", {
        SANDBOX_EGRESS: "",
      }).sandbox.egress.mode
    ).toBe("allowlist");
  });

  it("rejects an unknown mode, from the file or the variable", () => {
    expect(
      expectErrors("sandbox: { egress: { mode: some } }")[0]?.path
    ).toEqual(["sandbox", "egress", "mode"]);
    expect(expectErrors("", { SANDBOX_EGRESS: "everywhere" })[0]?.path).toEqual(
      ["sandbox", "egress", "mode"]
    );
  });

  it("rejects hosts with a scheme, a port or capitals", () => {
    const errors = expectErrors(
      "sandbox:\n  egress:\n    allow: ['https://pypi.org', 'pypi.org:443', 'PyPI.org', '*']"
    );
    expect(errors.map((error) => error.path.join("."))).toEqual([
      "sandbox.egress.allow.0",
      "sandbox.egress.allow.1",
      "sandbox.egress.allow.2",
      "sandbox.egress.allow.3",
    ]);
  });

  it("no longer accepts sandbox.docker.network; egress replaces it", () => {
    expect(
      expectErrors(
        "sandbox:\n  docker: { runnerUrl: 'http://runner:7070', network: false }"
      )[0]?.path
    ).toEqual(["sandbox", "docker"]);
  });
});
