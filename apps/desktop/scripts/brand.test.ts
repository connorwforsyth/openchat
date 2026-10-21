import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type BrandSource,
  configCandidates,
  iconCandidates,
  identityOf,
  isUrlLike,
  readBrand,
  repoRoot,
  slugOf,
} from "./brand";

const webConfig = join(repoRoot, "apps", "web", "app.config.yaml");
const rootConfig = join(repoRoot, "app.config.yaml");

const files =
  (contents: Record<string, string>) =>
  (path: string): string | undefined =>
    contents[path];

describe("configCandidates", () => {
  it("looks in apps/web, then the repo root", () => {
    expect(configCandidates({})).toEqual([webConfig, rootConfig]);
  });

  it("takes CONFIG_PATH alone, relative to apps/web", () => {
    expect(configCandidates({ CONFIG_PATH: "../../brand.yaml" })).toEqual([
      join(repoRoot, "brand.yaml"),
    ]);
  });
});

describe("readBrand", () => {
  it("uses the defaults with no config file", () => {
    const result = readBrand({}, files({}));
    expect(result).toEqual({
      ok: true,
      value: {
        brand: {
          appId: null,
          favicon: null,
          iconBackground: "black",
          logo: null,
          logoDark: null,
          name: "Chat",
          urlScheme: null,
        },
        configDir: null,
        source: null,
      },
    });
  });

  it("reads only the brand block, so the rest needn't be valid", () => {
    const result = readBrand(
      {},
      files({
        [rootConfig]: [
          "brand:",
          "  name: Acme Chat",
          "  appId: com.acme.chat",
          "  urlScheme: acme",
          "  logo: ./brand/logo.svg",
          "providers: { nonsense: true }",
        ].join("\n"),
      })
    );
    expect(result.ok && result.value).toMatchObject({
      brand: {
        appId: "com.acme.chat",
        logo: "./brand/logo.svg",
        name: "Acme Chat",
        urlScheme: "acme",
      },
      configDir: repoRoot,
      source: "app.config.yaml",
    });
  });

  it("prefers apps/web's file over the root's", () => {
    const result = readBrand(
      {},
      files({
        [rootConfig]: "brand: { name: Root }",
        [webConfig]: "brand: { name: Web }",
      })
    );
    expect(result.ok && result.value.brand.name).toBe("Web");
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: the config's ${ENV} syntax
  it("interpolates ${ENV} references", () => {
    const result = readBrand(
      { BRAND_NAME: "From Env" },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the config's ${ENV} syntax
      files({ [webConfig]: "brand: { name: '${BRAND_NAME}' }" })
    );
    expect(result.ok && result.value.brand.name).toBe("From Env");
  });

  it("reports an invalid brand with its path", () => {
    const result = readBrand(
      {},
      files({ [webConfig]: "brand: { appId: Not DNS }" })
    );
    expect(result).toEqual({
      error: [expect.stringContaining("brand.appId: reverse-DNS")],
      ok: false,
    });
  });

  it("reports broken YAML", () => {
    const result = readBrand({}, files({ [webConfig]: "brand: [" }));
    expect(result.ok).toBe(false);
  });

  it("fails when CONFIG_PATH points nowhere", () => {
    const result = readBrand({ CONFIG_PATH: "missing.yaml" }, files({}));
    expect(result).toEqual({
      error: [expect.stringContaining("doesn't exist")],
      ok: false,
    });
  });
});

describe("slugOf", () => {
  it.each([
    ["Acme Chat", "acme-chat"],
    ["  Ünïcödé  Ëxtra!! ", "unicode-extra"],
    ["R2-D2", "r2-d2"],
    ["！！", ""],
  ])("%s → %s", (name, slug) => {
    expect(slugOf(name)).toBe(slug);
  });
});

describe("identityOf", () => {
  const brand = {
    appId: null,
    favicon: null,
    iconBackground: "black",
    logo: null,
    logoDark: null,
    name: "Acme Chat",
    urlScheme: null,
  };

  it("falls back to a local app ID and no URL scheme", () => {
    expect(identityOf(brand)).toEqual({
      appId: "local.acme-chat.desktop",
      executableName: "acme-chat",
      name: "Acme Chat",
      urlScheme: null,
    });
  });

  it("keeps the brand's own app ID and scheme", () => {
    expect(
      identityOf({ ...brand, appId: "com.acme.chat", urlScheme: "acme" })
    ).toMatchObject({ appId: "com.acme.chat", urlScheme: "acme" });
  });

  it("still has a slug when the name has no letters", () => {
    expect(identityOf({ ...brand, name: "！！" }).appId).toBe(
      "local.chat.desktop"
    );
  });
});

describe("iconCandidates", () => {
  const source = (
    logo: string | null,
    favicon: string | null
  ): BrandSource => ({
    brand: {
      appId: null,
      favicon,
      iconBackground: "black",
      logo,
      logoDark: null,
      name: "X",
      urlScheme: null,
    },
    configDir: "/srv/config",
    source: "app.config.yaml",
  });

  it("tries the logo, then the favicon, relative to the config file", () => {
    expect(iconCandidates(source("./brand/logo.svg", "fav.png"))).toEqual([
      "/srv/config/brand/logo.svg",
      "/srv/config/fav.png",
    ]);
  });

  it("passes URLs through for the shell to skip", () => {
    expect(
      iconCandidates(source("https://cdn.example/logo.svg", null))
    ).toEqual(["https://cdn.example/logo.svg"]);
  });

  it("is empty with neither", () => {
    expect(iconCandidates(source(null, null))).toEqual([]);
  });
});

describe("isUrlLike", () => {
  it("tells a URL from a Windows path", () => {
    expect(isUrlLike("https://x")).toBe(true);
    expect(isUrlLike("data:image/png;base64,AA")).toBe(true);
    expect(isUrlLike("C:\\brand\\logo.svg")).toBe(false);
    expect(isUrlLike("./logo.svg")).toBe(false);
  });
});
