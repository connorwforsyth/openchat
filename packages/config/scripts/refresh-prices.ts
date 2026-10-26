import { writeFile } from "node:fs/promises";

import {
  MODELS_DEV_URL,
  modelsDevSchema,
  priceSnapshotSchema,
  snapshotFromModelsDev,
} from "../src/models-dev";

// Rewrites `src/models-dev.snapshot.json` from models.dev. The only place
// prices come from the network; the app reads the committed snapshot.
// Run: `bun run prices:refresh` in packages/config, then review the diff.

const response = await fetch(MODELS_DEV_URL);
if (!response.ok) {
  throw new Error(`${MODELS_DEV_URL}: HTTP ${response.status}`);
}
const snapshot = priceSnapshotSchema.parse(
  snapshotFromModelsDev(
    modelsDevSchema.parse(await response.json()),
    new Date().toISOString()
  )
);
const target = new URL("../src/models-dev.snapshot.json", import.meta.url);
await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`);
const counts = Object.entries(snapshot.prices).map(
  ([source, models]) => `${source} ${Object.keys(models).length}`
);
console.log(`Wrote ${target.pathname}: ${counts.join(", ")}`);
