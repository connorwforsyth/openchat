// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests exercise `${ENV}` interpolation in YAML text.
import { publicConfigSchema } from "@workspace/contract/schemas/meta";
import { describe, expect, it } from "vitest";

import { parseConfig } from "./parse";
import { availableSandboxProviders, toPublicConfig } from "./public";
import type { AppConfig } from "./schema";
import { socialCredentials } from "./social";

const config = (text: string, env: Record<string, string> = {}): AppConfig => {
  const result = parseConfig(text, env);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

describe("toPublicConfig", () => {
  it("matches the contract's public config schema", () => {
    expect(
      publicConfigSchema.safeParse(toPublicConfig(config(""))).success
    ).toBe(true);
  });

  it("lists sign-in providers without their secrets", () => {
    const text = [
      "auth:",
      "  oidc: [{ id: corp, name: Corp SSO, issuer: https://sso.example.test, clientId: cid, clientSecret: '${S}' }]",
      "  social: { github: { clientId: gid, clientSecret: '${S}' } }",
    ].join("\n");
    const result = toPublicConfig(config(text, { S: "test-secret" }));
    expect(result.auth.providers).toEqual([
      { id: "corp", name: "Corp SSO" },
      { id: "github", name: "GitHub" },
    ]);
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  it("never exposes internal URLs", () => {
    const text =
      "sandbox: { default: docker, docker: { runnerUrl: http://sandbox-runner:7070 } }";
    expect(JSON.stringify(toPublicConfig(config(text)))).not.toContain(
      "sandbox-runner"
    );
  });
});

describe("availableSandboxProviders", () => {
  it("offers just-bash by default", () => {
    expect(availableSandboxProviders(config(""))).toEqual(["just-bash"]);
  });

  it("adds providers that are configured, and only those", () => {
    const text = [
      "sandbox:",
      "  docker: { runnerUrl: http://runner:7070 }",
      "  e2b: { apiKey: '${E2B_API_KEY}' }",
    ].join("\n");
    expect(availableSandboxProviders(config(text))).toEqual([
      "just-bash",
      "docker",
    ]);
    expect(
      availableSandboxProviders(config(text, { E2B_API_KEY: "test" }))
    ).toEqual(["just-bash", "docker", "e2b"]);
  });

  it("offers nothing when sandboxes are off", () => {
    expect(
      availableSandboxProviders(config("features: { sandboxes: false }"))
    ).toEqual([]);
    expect(
      toPublicConfig(config("sandbox: { default: none }")).sandbox
    ).toEqual({
      default: null,
      providers: [],
    });
  });
});

describe("social sign-in providers (owner question 17)", () => {
  const referenced = [
    "auth:",
    "  social:",
    "    github: { clientId: '${GITHUB_CLIENT_ID}', clientSecret: '${GITHUB_CLIENT_SECRET}' }",
  ].join("\n");

  it("treats a provider whose env vars are unset as off, not invalid", () => {
    const parsed = parseConfig(referenced, {});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.auth.social.github).toBeUndefined();
      expect(toPublicConfig(parsed.value).auth.providers).toEqual([]);
    }
  });

  it("treats half a pair as off", () => {
    const parsed = parseConfig(referenced, { GITHUB_CLIENT_ID: "gid" });
    expect(parsed.ok && parsed.value.auth.social.github).toBeUndefined();
  });

  it("still rejects a misspelt key", () => {
    expect(
      parseConfig("auth: { social: { github: { clientID: x } } }", {}).ok
    ).toBe(false);
  });

  it("lists providers configured only through the environment", () => {
    const env = {
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "test-secret",
    };
    const result = toPublicConfig(config(""), env);
    expect(result.auth.providers).toEqual([{ id: "google", name: "Google" }]);
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(
      toPublicConfig(config(""), { GOOGLE_CLIENT_ID: "google-id" }).auth
        .providers
    ).toEqual([]);
  });

  it("prefers config credentials and keeps button order", () => {
    const env = {
      GITHUB_CLIENT_ID: "gid",
      GITHUB_CLIENT_SECRET: "test-secret",
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "test-secret",
    };
    const parsed = config(referenced, env);
    expect(socialCredentials(parsed, {}, "github")).toEqual({
      clientId: "gid",
      clientSecret: "test-secret",
    });
    expect(toPublicConfig(parsed, env).auth.providers.map((p) => p.id)).toEqual(
      ["github", "google"]
    );
  });
});
