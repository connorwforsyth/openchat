import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

describe("runner env", () => {
  it("boots on an empty environment with safe defaults", () => {
    const env = envSchema.parse({});
    expect(env).toMatchObject({
      DOCKER_HOST: "tcp://docker-socket-proxy:2375",
      RUNNER_EGRESS_PROXY_PORT: 3128,
      SANDBOX_RUNTIME: "auto",
      SANDBOX_USER: "1000:1000",
    });
    expect(env.SANDBOX_RUNNER_TOKEN).toBeUndefined();
  });

  it("treats compose's empty strings as unset", () => {
    const env = envSchema.parse({
      RUNNER_CONTAINER: "",
      SANDBOX_RUNNER_TOKEN: "",
    });
    expect(env.SANDBOX_RUNNER_TOKEN).toBeUndefined();
    expect(env.RUNNER_CONTAINER).toBeUndefined();
  });

  it("never runs sandboxes as root", () => {
    expect(envSchema.safeParse({ SANDBOX_USER: "0:0" }).success).toBe(false);
  });
});
