import { DEFAULT_SITE_ORIGINS } from "@workspace/config/sites";
import { describe, expect, it } from "vitest";
import { DESIGN_GUIDES } from "./design/generated";
import { siteKind } from "./kind";
import { SITE_STACKS } from "./stacks";

describe("the Site kind", () => {
  it("tells the model its rules, the instance's origins and its stack's design guide", () => {
    const { instructions } = siteKind();
    expect(instructions.startsWith("## Sites\n")).toBe(true);
    expect(instructions).toContain('type "site"');
    expect(instructions).toContain(DEFAULT_SITE_ORIGINS.join(", "));
    expect(instructions).toContain('{"stack": "html-tailwind", "files"');
    expect(instructions.endsWith(DESIGN_GUIDES["html-tailwind"])).toBe(true);
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
      stack: "html-tailwind",
    });
  });

  it("defines both stacks, with react-ui not available yet", () => {
    expect(SITE_STACKS["html-tailwind"].available).toBe(true);
    expect(SITE_STACKS["react-ui"].available).toBe(false);
    expect(SITE_STACKS["react-ui"].libraries).toContain("react");
    expect(SITE_STACKS["html-tailwind"].themeColors).toContain(
      "muted-foreground"
    );
  });
});
