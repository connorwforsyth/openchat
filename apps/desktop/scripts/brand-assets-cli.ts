import { readBrand } from "./brand";
import { writeBrandAssets } from "./brand-assets";
import { packageOptionsFromEnv } from "./builder-config";

// `bun run brand`, before every build and dev run: writes .brand/ (icons and
// build.json) from the brand in app.config.yaml and the packaging switches.
// A broken brand block or switch fails the build.

const brand = readBrand(process.env);
const options = packageOptionsFromEnv(process.env);
if (!(brand.ok && options.ok)) {
  for (const problem of [
    ...(brand.ok ? [] : brand.error),
    ...(options.ok ? [] : options.error),
  ]) {
    console.error(`brand: ${problem}`);
  }
  process.exit(1);
}
const written = writeBrandAssets(brand.value, options.value, (message) =>
  console.warn(`brand: ${message}`)
);
const from = brand.value.source ?? "defaults (no app.config.yaml)";
console.log(
  `brand: "${written.build.name}" from ${from}; icons from ${written.from}${written.placeholder ? " (placeholder)" : ""}`
);
