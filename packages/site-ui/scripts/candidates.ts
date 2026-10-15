import { readdir, readFile, writeFile } from "node:fs/promises";

import {
  candidatesOf,
  kitSources,
  ownSources,
  renderCandidates,
} from "./candidates-core";

// Writes `src/candidates.generated.ts`: every word in site-ui's source and
// in the `@workspace/ui` files it imports, which a site's Tailwind build
// adds to the page's own words when a site has TSX pages (163). A page's
// classes come from the blocks, which the site's files don't contain, so
// the build can't find them by scanning the site. `candidates.test.ts`
// fails when this is out of date.
// Run: `bun run candidates` in packages/site-ui.

const packages = new URL("../../", import.meta.url);

const own = ownSources(await readdir(new URL("site-ui/src/", packages))).map(
  (name) => `site-ui/src/${name}`
);
const read = (path: string) => readFile(new URL(path, packages), "utf8");
const ownTexts = await Promise.all(own.map(read));
const kit = kitSources(ownTexts);
const sources = [...own, ...kit];

await writeFile(
  new URL("site-ui/src/candidates.generated.ts", packages),
  renderCandidates(
    sources,
    candidatesOf([...ownTexts, ...(await Promise.all(kit.map(read)))])
  )
);
