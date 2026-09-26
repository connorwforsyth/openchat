import { iconNames } from "../src/names";
import { iconSetIds } from "../src/set-ids";
import { findGaps, formatGapReport } from "./registry";
import { availableNames, setFile } from "./sets";

// Lists, per set and platform, the names that fall back to lucide. A report,
// not a gate: gaps are allowed, they just shouldn't be a surprise.

const report = findGaps(
  iconNames,
  iconSetIds.flatMap((setId) =>
    (["web", "native"] as const).map((platform) => ({
      available: availableNames(setFile(setId, platform)),
      platform,
      setId,
    }))
  )
);

console.log(formatGapReport(report, iconNames.length));
