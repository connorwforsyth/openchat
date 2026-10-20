import { describe, expect, it } from "vitest";

import { parseConfig } from "./parse";
import { defaultTerms, idForSlug, resolveTerms, slugFor } from "./terms";

const terms = (text: string) => {
  const result = parseConfig(text, {});
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value.terms;
};

describe("terms (191)", () => {
  it("defaults to MCP servers at /settings/mcp when the block is absent", () => {
    expect(resolveTerms(terms(""))).toEqual({
      mcp: { label: "MCP servers", singular: "MCP server", slug: "mcp" },
    });
    expect(defaultTerms.mcp.label).toBe("MCP servers");
  });

  it("takes a fork's own words and slug, keeping defaults for the rest", () => {
    expect(
      resolveTerms(terms("terms: { mcp: { label: Plugins, slug: plugins } }"))
        .mcp
    ).toEqual({ label: "Plugins", singular: "MCP server", slug: "plugins" });
  });

  it("uses a locale's words, exact tag first, then the base language", () => {
    const config = terms(`
terms:
  mcp:
    label: Plugins
    singular: Plugin
    locales:
      de: { label: Erweiterungen, singular: Erweiterung }
      pt-BR: { label: Extensões }
`);
    expect(resolveTerms(config, "de-AT").mcp.label).toBe("Erweiterungen");
    expect(resolveTerms(config, "pt-BR").mcp).toEqual({
      label: "Extensões",
      singular: "Plugin",
      slug: "mcp",
    });
    expect(resolveTerms(config, "fr").mcp.label).toBe("Plugins");
  });

  it("rejects a slug that isn't a URL segment, and unknown keys", () => {
    expect(parseConfig("terms: { mcp: { slug: My Plugins } }", {}).ok).toBe(
      false
    );
    expect(parseConfig("terms: { mcp: { lable: x } }", {}).ok).toBe(false);
  });
});

describe("slugs", () => {
  const plugins = resolveTerms(
    terms("terms: { mcp: { label: Plugins, slug: plugins } }")
  );
  const ids = ["keys", "mcp"] as const;

  it("maps an id to its segment; ids without a term route as themselves", () => {
    expect(slugFor(plugins, "mcp")).toBe("plugins");
    expect(slugFor(plugins, "keys")).toBe("keys");
  });

  it("resolves the configured slug, and asks to redirect old ones", () => {
    expect(idForSlug(plugins, ids, "plugins")).toEqual({
      canonical: true,
      id: "mcp",
    });
    expect(idForSlug(plugins, ids, "mcp")).toEqual({
      canonical: false,
      id: "mcp",
    });
    expect(idForSlug(plugins, ids, "connectors")).toEqual({
      canonical: false,
      id: "mcp",
    });
    expect(idForSlug(defaultTerms, ids, "mcp")).toEqual({
      canonical: true,
      id: "mcp",
    });
    expect(idForSlug(plugins, ids, "keys")).toEqual({
      canonical: true,
      id: "keys",
    });
    expect(idForSlug(plugins, ids, "nope")).toBeNull();
  });
});
