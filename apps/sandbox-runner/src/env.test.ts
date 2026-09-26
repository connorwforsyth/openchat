import { describe, expect, it } from "vitest";

import { egressPolicy, envSchema } from "./env";

describe("runner env", () => {
  it("boots on an empty environment with safe defaults", () => {
    const env = envSchema.parse({});
    expect(env).toMatchObject({
      DOCKER_HOST: "tcp://docker-socket-proxy:2375",
      SANDBOX_EGRESS: "none",
      SANDBOX_RUNTIME: "auto",
      SANDBOX_USER: "1000:1000",
    });
    expect(env.SANDBOX_RUNNER_TOKEN).toBeUndefined();
    expect(egressPolicy(env)).toEqual({ mode: "none" });
  });

  it("treats compose's empty strings as unset", () => {
    const env = envSchema.parse({
      SANDBOX_EGRESS_PROXY: "",
      SANDBOX_RUNNER_TOKEN: "",
    });
    expect(env.SANDBOX_RUNNER_TOKEN).toBeUndefined();
    expect(env.SANDBOX_EGRESS_PROXY).toBeUndefined();
  });

  it("never runs sandboxes as root", () => {
    expect(envSchema.safeParse({ SANDBOX_USER: "0:0" }).success).toBe(false);
  });

  it("needs a proxy before allowlisted egress lets anything out", () => {
    expect(
      egressPolicy(envSchema.parse({ SANDBOX_EGRESS: "allowlist" }))
    ).toEqual({
      mode: "none",
    });
    expect(
      egressPolicy(
        envSchema.parse({
          SANDBOX_EGRESS: "allowlist",
          SANDBOX_EGRESS_PROXY: "http://egress:3128",
        })
      )
    ).toEqual({ mode: "allowlist", proxyUrl: "http://egress:3128" });
  });
});
