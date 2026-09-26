import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { iconNames } from "../src/names";
import type { IconPlatform } from "../src/set-ids";
import { parseIconSet, renderSelection, resolveSelection } from "./registry";
import { availableNames, setFile, srcDir } from "./sets";

// Build-time set selection (D19): writes `src/selected.ts` and
// `src/selected.native.ts`, which re-export each name from exactly one set
// file. Bundlers only ever see the chosen set (plus lucide for its gaps), so
// the others are never in the bundle. `ICON_SET` stands in for
// `app.config.yaml`'s `icons.set` until packages/config lands.

const parsed = parseIconSet(process.env.ICON_SET);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const setId = parsed.value;

const outputs: Record<IconPlatform, string> = {
  native: "selected.native.ts",
  web: "selected.ts",
};

for (const platform of ["web", "native"] as const) {
  const file = setFile(setId, platform);
  const selection = resolveSelection(
    iconNames,
    availableNames(file) ?? new Set()
  );
  const source = renderSelection({ platform, selection, setFile: file, setId });
  const target = join(srcDir, outputs[platform]);
  // Leave an unchanged file alone so watchers don't rebuild for nothing.
  if (!existsSync(target) || readFileSync(target, "utf8") !== source) {
    writeFileSync(target, source);
  }
  const drawn = file ? selection.fromSet.length : 0;
  console.log(
    `icons (${platform}): ${setId}, ${drawn}/${iconNames.length} from the set`
  );
}
