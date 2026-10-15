import { DEFAULT_SITE_ORIGINS } from "@workspace/config/sites";
import { describe, expect, it } from "vitest";
import { DESIGN_GUIDES } from "./design/generated";
import { siteKind } from "./kind";

describe("the Site kind", () => {
  it("tells the model its rules, the instance's origins and both design guides, site-ui first", () => {
    const { instructions } = siteKind();
    expect(instructions.startsWith("## Sites\n")).toBe(true);
    expect(instructions).toContain('type "site"');
    expect(instructions).toContain(DEFAULT_SITE_ORIGINS.join(", "));
    expect(instructions).toContain('{"files": {"index.tsx"');
    expect(instructions).not.toContain('"stack"');
    expect(
      instructions.endsWith(
        `${DESIGN_GUIDES["site-ui"]}\n\n${DESIGN_GUIDES["html-tailwind"]}`
      )
    ).toBe(true);
    expect(siteKind({ allowedOrigins: [] }).instructions).toContain(
      "may load only from the site's own files"
    );
  });

  it("is published, rendered by the runtime's site renderer, and replaced whole", () => {
    const kind = siteKind();
    expect(kind.capabilities.share).toBe(true);
    expect(kind.render).toEqual({ panel: "source", runtime: "site" });
    const next = kind.operations.replace?.input.parse({
      content: '{"files": {"index.html": "<p>"}}',
    });
    expect(kind.operations.replace?.apply(null, next)).toEqual({
      files: { "index.html": "<p>" },
    });
  });

  it("still reads a site saved with a stack (125), and ignores it", () => {
    const kind = siteKind();
    const old = '{"stack": "html-tailwind", "files": {"index.html": "<p>"}}';
    expect(kind.content.parse(old)).toEqual({
      files: { "index.html": "<p>" },
      stack: "html-tailwind",
    });
    expect(
      kind.content.parse(
        '{"stack": "react-ui", "files": {"index.html": "<p>"}}'
      ).stack
    ).toBe("react-ui");
  });
});
