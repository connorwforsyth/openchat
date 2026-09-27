import { parseConfig } from "@workspace/config/parse";
import type { AppConfig } from "@workspace/config/schema";
import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { sandboxProvidersFromConfig } from "./providers";

const config = (text: string): AppConfig => {
  const result = parseConfig(text, {});
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

describe("sandboxProvidersFromConfig", () => {
  it("gives just-bash alone on an empty config", async () => {
    const providers = sandboxProvidersFromConfig(config(""));
    expect([...providers.keys()]).toEqual(["just-bash"]);
    expect(await providers.get("just-bash")?.isolation()).toEqual({
      ok: true,
      value: "simulated",
    });
  });

  it("offers nothing when sandboxes are off", () => {
    expect(
      sandboxProvidersFromConfig(config("sandbox: { default: none }")).size
    ).toBe(0);
    expect(
      sandboxProvidersFromConfig(config("features: { sandboxes: false }")).size
    ).toBe(0);
  });

  it("adds docker with its limits, and degrades without a token", async () => {
    const providers = sandboxProvidersFromConfig(
      config(
        "sandbox: { default: docker, docker: { runnerUrl: 'http://runner.test:7070', limits: { cpu: 2 } } }"
      ),
      { fetch: () => Promise.reject(new Error("never called")) }
    );
    const docker = providers.get("docker");
    expect(docker?.limits).toEqual({
      cpu: 2,
      diskMb: 10_240,
      memoryMb: 2048,
      network: true,
    });
    expect(await docker?.isolation()).toEqual({
      error: {
        message: "the sandbox runner token is not configured",
        type: "unavailable",
      },
      ok: false,
    });
  });

  it("lists configured remote providers as unavailable for now", async () => {
    const providers = sandboxProvidersFromConfig(
      config("sandbox: { microsandbox: { url: 'http://msb.test' } }")
    );
    const created = await providers
      .get("microsandbox")
      ?.factory.attach(fixtureId("sandbox", 1));
    expect(created).toMatchObject({
      error: { type: "unavailable" },
      ok: false,
    });
  });
});
