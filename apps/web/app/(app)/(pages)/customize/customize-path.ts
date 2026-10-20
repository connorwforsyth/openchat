import { idForSlug, type Terms } from "@workspace/config/terms";
import {
  type LibraryItemId,
  libraryItemIdSchema,
} from "@workspace/contract/schemas/common";

import type { CustomizeKind } from "@/lib/routes";

// What a `/customize/...` address shows (193). The MCP segment is whatever
// `terms.mcp.slug` says, so a fork that calls them "Plugins" lives at
// `/customize/plugins`; skills are `/customize/skills`. Pure.

const KINDS: readonly CustomizeKind[] = ["mcp", "skills"];

export type CustomizeView =
  /** A catalog: every server, or every skill, you can use. */
  | { readonly kind: CustomizeKind; readonly view: "catalog" }
  /** One server's or skill's page. */
  | {
      readonly id: LibraryItemId;
      readonly kind: CustomizeKind;
      readonly view: "item";
    }
  /** A server's controls ("Manage"). */
  | {
      readonly id: LibraryItemId;
      readonly kind: "mcp";
      readonly view: "manage";
    }
  | { readonly view: "not-found" };

const notFound: CustomizeView = { view: "not-found" };

export const customizeViewFromPath = (
  segments: readonly string[],
  terms: Terms
): CustomizeView => {
  const [first, second, third, ...rest] = segments;
  if (first === undefined) {
    // `/customize` opens on the servers, as ChatGPT's opens on Plugins.
    return { kind: "mcp", view: "catalog" };
  }
  const found = idForSlug(terms, KINDS, first);
  if (!found || rest.length > 0) {
    return notFound;
  }
  const kind = found.id;
  if (second === undefined) {
    return { kind, view: "catalog" };
  }
  const id = libraryItemIdSchema.safeParse(second);
  if (!id.success) {
    return notFound;
  }
  if (third === undefined) {
    return { id: id.data, kind, view: "item" };
  }
  return third === "manage" && kind === "mcp"
    ? { id: id.data, kind, view: "manage" }
    : notFound;
};

/** Which catalog a view belongs to, for the panel's nav. */
export const customizeKindOf = (view: CustomizeView): CustomizeKind | null =>
  view.view === "not-found" ? null : view.kind;
