import { describe, expect, it } from "vitest";

import {
  appOriginsFrom,
  contentSecurityPolicy,
  contentTypeFor,
  DEV_APP_ORIGINS,
  responseHeaders,
} from "./headers";

const REMOTE_SOURCE = /https?:|\*/;

const directives = (policy: string) =>
  new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values.join(" ")];
    })
  );

describe("appOriginsFrom", () => {
  it("falls back to local development when unset or empty", () => {
    expect(appOriginsFrom(undefined)).toEqual(DEV_APP_ORIGINS);
    expect(appOriginsFrom(" , ")).toEqual(DEV_APP_ORIGINS);
  });

  it("keeps valid origins and drops the rest", () => {
    expect(
      appOriginsFrom(
        "https://chat.example.com, not a url, ftp://x.test, https://b.test/path"
      )
    ).toEqual(["https://chat.example.com", "https://b.test"]);
  });
});

describe("contentSecurityPolicy", () => {
  const policy = directives(contentSecurityPolicy(["https://chat.example"]));

  it("allows no network: nothing to connect to, submit to or load from elsewhere", () => {
    expect(policy.get("default-src")).toBe("'none'");
    expect(policy.get("connect-src")).toBe("'none'");
    expect(policy.get("form-action")).toBe("'none'");
    for (const name of ["script-src", "style-src", "img-src", "font-src"]) {
      expect(policy.get(name)).not.toMatch(REMOTE_SOURCE);
    }
  });

  it("is only embeddable by the app, and always sandboxed", () => {
    expect(policy.get("frame-ancestors")).toBe("https://chat.example");
    expect(policy.get("sandbox")).toBe("allow-scripts");
  });
});

describe("responseHeaders", () => {
  it("lets the opaque-origin frame load its module chunks", () => {
    const headers = responseHeaders("/dist/public/index-abc.js", []);
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Content-Type"]).toBe("text/javascript; charset=utf-8");
    expect(headers["Cache-Control"]).toContain("immutable");
  });

  it("revalidates the page itself and never sends a referrer", () => {
    const headers = responseHeaders("/dist/public/index.html", []);
    expect(headers["Cache-Control"]).toBe("no-cache");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("serves unknown files as opaque bytes", () => {
    expect(contentTypeFor("/x/file.exe")).toBe("application/octet-stream");
  });
});
