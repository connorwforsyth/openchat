import {
  defaultTerms,
  resolveTerms,
  termsSchema,
} from "@workspace/config/terms";
import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { routes } from "@/lib/routes";

import { customizeViewFromPath } from "./customize-path";

const id = fixtureId("libraryItem", 1);
const plugins = resolveTerms(
  termsSchema.parse({ mcp: { label: "Plugins", slug: "plugins" } })
);
const segments = (path: string) => path.split("/").filter(Boolean).slice(1);

describe("customizeViewFromPath (193)", () => {
  it("opens on the servers' catalog", () => {
    expect(customizeViewFromPath([], defaultTerms)).toEqual({
      kind: "mcp",
      view: "catalog",
    });
  });

  it("reads the routes it builds, under the configured slug", () => {
    for (const terms of [defaultTerms, plugins]) {
      expect(
        customizeViewFromPath(
          segments(routes.customizeKind(terms, "skills")),
          terms
        )
      ).toEqual({ kind: "skills", view: "catalog" });
      expect(
        customizeViewFromPath(
          segments(routes.customizeItem(terms, "mcp", id)),
          terms
        )
      ).toEqual({ id, kind: "mcp", view: "item" });
      expect(
        customizeViewFromPath(
          segments(routes.customizeManage(terms, id)),
          terms
        )
      ).toEqual({ id, kind: "mcp", view: "manage" });
    }
    expect(routes.customizeKind(plugins, "mcp")).toBe("/customize/plugins");
  });

  it("is a 404 for anything else", () => {
    for (const path of [
      ["nope"],
      ["mcp", "not-an-id"],
      ["skills", id, "manage"],
      ["mcp", id, "manage", "more"],
    ]) {
      expect(customizeViewFromPath(path, defaultTerms)).toEqual({
        view: "not-found",
      });
    }
  });
});
