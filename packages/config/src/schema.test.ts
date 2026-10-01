import { describe, expect, it } from "vitest";

// Cross-package relative import on purpose: packages/icons doesn't export its
// set ids, and the config enum has to stay equal to them.
import { iconSetIds } from "../../icons/src/set-ids";
import { toPublicConfig } from "./public";
import { appConfigSchema } from "./schema";

describe("appConfigSchema", () => {
  it("offers exactly the icon sets packages/icons knows", () => {
    const set = appConfigSchema.shape.icons.unwrap().shape.set.unwrap();
    expect([...set.options]).toEqual([...iconSetIds]);
  });

  it("defaults to Geist and accepts the bundled fonts", () => {
    expect(appConfigSchema.parse({}).fonts).toEqual({
      mono: "geist-mono",
      sans: "geist",
    });
    expect(appConfigSchema.parse({ fonts: { sans: "inter" } }).fonts).toEqual({
      mono: "geist-mono",
      sans: "inter",
    });
    expect(
      appConfigSchema.safeParse({ fonts: { sans: "comic-sans" } }).success
    ).toBe(false);
  });

  it("round-trips its own output", () => {
    const parsed = appConfigSchema.parse({});
    expect(appConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(
      parsed
    );
  });

  it("accepts s3 storage and rejects an unknown driver", () => {
    expect(
      appConfigSchema.parse({ storage: { bucket: "files", driver: "s3" } })
        .storage
    ).toMatchObject({ driver: "s3", forcePathStyle: false, region: "auto" });
    expect(
      appConfigSchema.safeParse({ storage: { driver: "ftp" } }).success
    ).toBe(false);
  });

  it("keeps local files under ./.data unless told otherwise", () => {
    expect(
      appConfigSchema.parse({ storage: { driver: "local" } }).storage
    ).toEqual({ driver: "local", path: "./.data/files" });
    expect(
      appConfigSchema.parse({
        storage: { driver: "local", path: "/srv/files" },
      }).storage
    ).toEqual({ driver: "local", path: "/srv/files" });
  });

  it("records span content only when asked", () => {
    expect(
      appConfigSchema.parse({ observability: { recordContent: true } })
        .observability.recordContent
    ).toBe(true);
    expect(
      appConfigSchema.safeParse({ observability: { recordContent: "yes" } })
        .success
    ).toBe(false);
  });

  it("caps the agent loop at 20 steps unless told otherwise", () => {
    expect(appConfigSchema.parse({}).limits.agentMaxSteps).toBe(20);
    expect(
      appConfigSchema.parse({ limits: { agentMaxSteps: 50 } }).limits
        .agentMaxSteps
    ).toBe(50);
    expect(
      appConfigSchema.safeParse({ limits: { agentMaxSteps: 0 } }).success
    ).toBe(false);
  });

  it("orders the risk thresholds", () => {
    expect(
      appConfigSchema.safeParse({
        decider: { thresholds: { riskAsk: 0.9, riskBlock: 0.5 } },
      }).success
    ).toBe(false);
  });

  describe("artifacts.kinds.site (125)", () => {
    const site = (input: unknown) =>
      appConfigSchema.safeParse({ artifacts: { kinds: { site: input } } });

    it("offers sites on html-tailwind, loading from Google Fonts, cdnjs and jsDelivr", () => {
      expect(appConfigSchema.parse({}).artifacts.kinds.site).toEqual({
        allowedOrigins: [
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
        ],
        enabled: true,
        stack: "html-tailwind",
      });
    });

    it("takes an admin's own list, wildcards included, without duplicates", () => {
      const parsed = site({
        allowedOrigins: [
          "https://cdn.example.com",
          "https://*.fonts.example",
          "https://cdn.example.com",
          "https://cdn.example.com:8443",
        ],
      });
      expect(
        parsed.success && parsed.data.artifacts.kinds.site.allowedOrigins
      ).toEqual([
        "https://cdn.example.com",
        "https://*.fonts.example",
        "https://cdn.example.com:8443",
      ]);
      expect(site({ allowedOrigins: [] }).success).toBe(true);
    });

    it("refuses entries that aren't https origins, so nothing else reaches the CSP", () => {
      for (const entry of [
        "http://cdn.example.com",
        "https://cdn.example.com/js",
        "https://cdn.example.com; script-src *",
        "*",
        "https://*",
        "cdn.example.com",
        "'unsafe-eval'",
      ]) {
        expect(site({ allowedOrigins: [entry] }).success, entry).toBe(false);
      }
    });

    it("refuses the react-ui stack until it's built, and unknown keys", () => {
      expect(site({ stack: "react-ui" }).success).toBe(false);
      expect(site({ stack: "vue" }).success).toBe(false);
      expect(site({ origins: [] }).success).toBe(false);
    });

    it("tells clients the origins, and none while sites are off", () => {
      const on = appConfigSchema.parse({});
      expect(toPublicConfig(on).artifacts.siteOrigins).toEqual(
        on.artifacts.kinds.site.allowedOrigins
      );
      const off = appConfigSchema.parse({
        artifacts: { kinds: { site: { enabled: false } } },
      });
      expect(toPublicConfig(off).artifacts.siteOrigins).toEqual([]);
    });
  });
});
