import { describe, expect, it } from "vitest";

import { TEST_ALLOW_ORIGINS_ENV, testAllowOrigins } from "./test-allowlist";

describe("testAllowOrigins (test only)", () => {
  it("is empty unless the variable is set", () => {
    expect(testAllowOrigins({}).size).toBe(0);
  });

  it("takes exact loopback http origins with a port, and nothing else", () => {
    const warnings: string[] = [];
    const origins = testAllowOrigins(
      {
        [TEST_ALLOW_ORIGINS_ENV]: [
          "http://127.0.0.1:4599",
          "http://[::1]:4600/",
          "http://localhost:4601",
          "http://127.0.0.1",
          "https://127.0.0.1:4602",
          "http://10.0.0.5:80",
          "http://169.254.169.254:80",
          "http://example.test:8080",
          "http://127.0.0.1:4603/path",
          "*",
        ].join(","),
        NODE_ENV: "test",
      },
      (message) => warnings.push(message)
    );
    expect([...origins].sort()).toEqual([
      "http://127.0.0.1:4599",
      "http://[::1]:4600",
      "http://localhost:4601",
    ]);
    expect(warnings.filter((w) => w.includes("ignoring"))).toHaveLength(7);
  });

  it("is ignored in production, unless the instance itself serves on loopback", () => {
    const set = { [TEST_ALLOW_ORIGINS_ENV]: "http://127.0.0.1:4599" };
    expect(testAllowOrigins({ ...set, NODE_ENV: "production" }).size).toBe(0);
    expect(
      testAllowOrigins({
        ...set,
        BETTER_AUTH_URL: "https://chat.example.com",
        NODE_ENV: "production",
      }).size
    ).toBe(0);
    // The e2e harness: a production build serving http://localhost:<port>.
    expect(
      testAllowOrigins({
        ...set,
        BETTER_AUTH_URL: "http://localhost:3208",
        NODE_ENV: "production",
      }).size
    ).toBe(1);
  });
});
