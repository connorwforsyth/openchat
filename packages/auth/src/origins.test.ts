import { describe, expect, it } from "vitest";

import { appOriginOf } from "./env";
import { loopbackAliases, originSchema, trustedOriginsFor } from "./origins";

describe("trustedOriginsFor (054)", () => {
  it("trusts a loopback app origin under every loopback name", () => {
    expect(trustedOriginsFor({ appUrl: "http://localhost:3000" })).toEqual({
      invalid: [],
      origins: [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
      ],
    });
    // From any of them, with the same scheme and port.
    expect(
      trustedOriginsFor({ appUrl: "https://127.0.0.1:8443/" }).origins
    ).toEqual([
      "https://localhost:8443",
      "https://127.0.0.1:8443",
      "https://[::1]:8443",
    ]);
    expect(trustedOriginsFor({ appUrl: "http://[::1]" }).origins).toEqual([
      "http://localhost",
      "http://127.0.0.1",
      "http://[::1]",
    ]);
  });

  it("keeps any other app origin exact", () => {
    expect(
      trustedOriginsFor({ appUrl: "https://chat.example.com/base/" }).origins
    ).toEqual(["https://chat.example.com"]);
    // Only the three loopback names; lookalikes are ordinary hosts.
    for (const appUrl of [
      "http://localhost.example.com:3000",
      "http://app.localhost:3000",
      "http://127.0.0.2:3000",
      "http://192.168.1.20:3000",
    ]) {
      expect(trustedOriginsFor({ appUrl }).origins).toEqual([
        new URL(appUrl).origin,
      ]);
    }
  });

  it("adds exact extra origins and reports the rest", () => {
    expect(
      trustedOriginsFor({
        appUrl: "https://chat.example.com",
        extra:
          " https://Chat.Example.org:443/, http://192.168.1.20:3000 https://*.example.com,https://x.example.com/path, chat.example.net,,ftp://files.example.com, https://u:p@example.com",
      })
    ).toEqual({
      invalid: [
        "https://*.example.com",
        "https://x.example.com/path",
        "chat.example.net",
        "ftp://files.example.com",
        "https://u:p@example.com",
      ],
      origins: [
        "https://chat.example.com",
        "https://chat.example.org",
        "http://192.168.1.20:3000",
      ],
    });
  });

  it("doesn't expand a loopback extra, and drops duplicates", () => {
    expect(
      trustedOriginsFor({
        appUrl: "http://localhost:3000",
        extra: "http://127.0.0.1:3000, http://localhost:4000",
      }).origins
    ).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://localhost:4000",
    ]);
  });

  it("is empty with nothing configured", () => {
    expect(trustedOriginsFor({})).toEqual({ invalid: [], origins: [] });
    expect(trustedOriginsFor({ appUrl: "not a url" })).toEqual({
      invalid: [],
      origins: [],
    });
  });
});

describe("originSchema", () => {
  it("normalises to what Better Auth compares against", () => {
    expect(originSchema.parse("  HTTPS://Chat.Example.com:443/ ")).toBe(
      "https://chat.example.com"
    );
    expect(originSchema.parse("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("refuses anything that isn't a bare http(s) origin", () => {
    for (const value of [
      "",
      "*",
      "https://*.example.com",
      "https://example.com/app",
      "https://example.com?x=1",
      "https://example.com#top",
      "javascript:alert(1)",
      "myapp://callback",
    ]) {
      expect(originSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("loopbackAliases and appOriginOf", () => {
  it("leaves a non-loopback origin alone", () => {
    expect(loopbackAliases("https://chat.example.com")).toEqual([
      "https://chat.example.com",
    ]);
  });

  it("reads the origin out of BETTER_AUTH_URL", () => {
    expect(appOriginOf(" https://chat.example.com/base ")).toBe(
      "https://chat.example.com"
    );
    expect(appOriginOf(undefined)).toBeUndefined();
    expect(appOriginOf("chat.example.com")).toBeUndefined();
    expect(appOriginOf("file:///etc/passwd")).toBeUndefined();
  });
});
