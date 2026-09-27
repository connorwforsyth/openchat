import { slugSchema } from "@workspace/contract/schemas/tenancy";

// An org's short name (`slug`, unique per instance) suggested from the name
// someone types, so creating an org asks for one thing. Pure.

const MAX = 48;
const MARKS = /\p{M}+/gu;
const NOT_SLUG = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

/** "Acme Labs, Inc." → "acme-labs-inc"; `""` when nothing usable is left. */
export const slugFrom = (name: string): string => {
  const slug = name
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(NOT_SLUG, "-")
    .replace(EDGE_DASHES, "")
    .slice(0, MAX)
    .replace(EDGE_DASHES, "");
  return slugSchema.safeParse(slug).success ? slug : "";
};
