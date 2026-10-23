import { parseConfig } from "@workspace/config/parse";
import type { AppConfig } from "@workspace/config/schema";
import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { sandboxProvidersFromConfig } from "./providers";
import { runnerUnavailableText } from "./runner/unavailable";
import { installHostAsyncHook } from "./testing/host-async-hook";

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

  it("runs just-bash without its defense-in-depth layer under next dev, and says so (076)", async () => {
    const logged: string[] = [];
    const log = (message: string) => logged.push(message);
    sandboxProvidersFromConfig(config(""), {
      env: { NODE_ENV: "production" },
      log,
    });
    expect(logged).toEqual([]);

    const providers = sandboxProvidersFromConfig(config(""), {
      env: { NODE_ENV: "development" },
      log,
    });
    expect(logged).toEqual([expect.stringContaining("defense-in-depth")]);
    const created = await providers.get("just-bash")?.factory.create({
      conversationId: fixtureId("conversation", 1),
      id: fixtureId("sandbox", 1),
      limits: { cpu: 1, diskMb: 64, memoryMb: 256, network: false },
    });
    if (!created?.ok) {
      throw new Error("no just-bash sandbox");
    }
    // React's development renderer hooks every promise and timer; nothing a
    // command does may throw inside those hooks.
    using hook = installHostAsyncHook();
    const ran = await created.value.exec("sleep 0.01; echo hi");
    expect(ran).toMatchObject({ ok: true, value: { stdout: "hi\n" } });
    expect(hook.thrown).toEqual([]);
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
        message: runnerUnavailableText("not_configured"),
        type: "unavailable",
      },
      ok: false,
    });
  });

  it("gives docker sandboxes network unless egress is none", () => {
    const network = (egress: string) =>
      sandboxProvidersFromConfig(
        config(
          `sandbox: { docker: { runnerUrl: 'http://runner.test:7070' }, egress: { mode: ${egress} } }`
        )
      ).get("docker")?.limits.network;
    expect(network("open")).toBe(true);
    expect(network("allowlist")).toBe(true);
    expect(network("none")).toBe(false);
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
