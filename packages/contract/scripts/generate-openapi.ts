// Writes `openapi.json` from the contract. The file is committed, so a
// contract PR shows its wire-level diff and non-TypeScript clients (Swift,
// Scalar, the docs site) can read it without running any code. A test fails
// when the committed file is stale; run `bun run openapi:generate` to fix it.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { generateOpenApi, serializeOpenApi } from "../src/openapi";

const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(target, serializeOpenApi(await generateOpenApi()));
// Biome formats JSON too; format here so `bun run check` stays clean. The
// staleness test compares parsed JSON, so layout never matters to it.
// The spec passed biome's default 1 MiB file cap with schedules (173a).
execFileSync(
  "bunx",
  ["biome", "format", "--write", "--files-max-size=8388608", target],
  {
    stdio: "ignore",
  }
);
console.log(`wrote ${target}`);
