import { DEFAULT_SITE_ORIGINS } from "@workspace/config/sites";
import { describe, expect, it } from "vitest";
import { siteContentSecurityPolicy } from "./csp";

import { originAllowed, originOf } from "./origins";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values];
    })
  );

describe("a site's CSP", () => {
  it("allows its own files, inline code and the allowed origins, and nothing else", () => {
    const policy = directives(
      siteContentSecurityPolicy({
        allowedOrigins: DEFAULT_SITE_ORIGINS,
        frameAncestors: [],
        mode: "published",
      })
    );
    expect(policy["default-src"]).toEqual(["'none'"]);
    for (const name of ["script-src", "style-src"]) {
      expect(policy[name]).toEqual([
        "'self'",
        "'unsafe-inline'",
        ...DEFAULT_SITE_ORIGINS,
      ]);
    }
    expect(policy["font-src"]).toEqual([
      "'self'",
      "data:",
      ...DEFAULT_SITE_ORIGINS,
    ]);
    expect(policy["img-src"]).toEqual([
      "'self'",
      "data:",
      "blob:",
      ...DEFAULT_SITE_ORIGINS,
    ]);
    expect(policy["connect-src"]).toEqual(["'none'"]);
    expect(policy["frame-src"]).toEqual(["'none'"]);
    expect(policy["form-action"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy.sandbox).toEqual([
      "allow-scripts",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
    ]);
    // `unsafe-eval` is never on: Tailwind is compiled before the page loads.
    expect(Object.values(policy).flat()).not.toContain("'unsafe-eval'");
  });

  it("lets a preview draw pages in a srcdoc frame, inside the app only", () => {
    const policy = directives(
      siteContentSecurityPolicy({
        allowedOrigins: [],
        frameAncestors: ["https://chat.example", "http://localhost:*"],
        mode: "preview",
      })
    );
    expect(policy["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy["frame-src"]).toEqual(["'self'"]);
    expect(policy["frame-ancestors"]).toEqual([
      "https://chat.example",
      "http://localhost:*",
    ]);
    expect(policy.sandbox).toEqual(["allow-scripts"]);
  });

  it("drops entries that aren't https origins, so config can't add a directive", () => {
    const policy = siteContentSecurityPolicy({
      allowedOrigins: [
        "https://ok.example",
        "https://ok.example",
        "http://plain.example",
        "https://x.example; script-src *",
        "*",
        "https://path.example/js",
        "'unsafe-eval'",
      ],
      frameAncestors: ["https://app.example; sandbox"],
      mode: "published",
    });
    expect(directives(policy)["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://ok.example",
    ]);
    expect(directives(policy)["frame-ancestors"]).toEqual(["'none'"]);
    expect(
      policy.split("; ").filter((d) => d.startsWith("script-src"))
    ).toHaveLength(1);
  });
});

describe("site origins", () => {
  it("resolve references as a browser on an https page would", () => {
    expect(originOf("https://fonts.googleapis.com/css2?family=Inter")).toBe(
      "https://fonts.googleapis.com"
    );
    expect(originOf("//cdn.jsdelivr.net/npm/x")).toBe(
      "https://cdn.jsdelivr.net"
    );
    expect(originOf("data:image/svg+xml,<svg/>")).toBeNull();
    expect(originOf("about.html")).toBeNull();
  });

  it("match exact hosts, ports and wildcard subdomains over https only", () => {
    const allowed = [
      "https://cdn.example.com",
      "https://*.fonts.example",
      "https://p.example:8443",
    ];
    expect(originAllowed("https://cdn.example.com", allowed)).toBe(true);
    expect(originAllowed("http://cdn.example.com", allowed)).toBe(false);
    expect(originAllowed("https://evil-cdn.example.com", allowed)).toBe(false);
    expect(originAllowed("https://cdn.example.com.evil.io", allowed)).toBe(
      false
    );
    expect(originAllowed("https://a.fonts.example", allowed)).toBe(true);
    expect(originAllowed("https://fonts.example", allowed)).toBe(false);
    expect(originAllowed("https://p.example:8443", allowed)).toBe(true);
    expect(originAllowed("https://p.example", allowed)).toBe(false);
  });
});
