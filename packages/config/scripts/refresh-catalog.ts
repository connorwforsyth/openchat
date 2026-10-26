import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  buildCatalog,
  gatewayEndpointsSchema,
  gatewayModelsSchema,
  modelsDevSchema,
  pricesFromModelsDev,
  renderCatalog,
  throughputOf,
} from "../src/catalog/refresh";
import { CATALOG_SOURCES, generatedCatalogSchema } from "../src/catalog/schema";

// Rewrites `src/catalog/generated.ts`: list prices from models.dev and each
// Gateway language model's recent output speed. Both are public and keyless.
// This is the only code that fetches them; the app reads the committed file.
// Run: `bun run catalog:refresh` in packages/config, then review the diff.
// A model whose endpoints fail or can't be read would lose its speed, so the
// refresh stops and names them; `--allow-partial` writes it anyway. Batch
// variants (`…-batch`) have no endpoints page, so their 404 is expected.

const CONCURRENCY = 8;

const json = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
};

const prices = pricesFromModelsDev(
  modelsDevSchema.parse(await json(CATALOG_SOURCES.prices))
);

const language = gatewayModelsSchema
  .parse(await json(CATALOG_SOURCES.speed))
  .data.filter((model) => model.type === "language")
  .map((model) => model.id);

const allowPartial = process.argv.includes("--allow-partial");
const speed: (readonly [string, number])[] = [];
const failed: string[] = [];
const queue = [...language];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      // biome-ignore lint/performance/noAwaitInLoops: each worker fetches in turn; CONCURRENCY workers is the limit
      const reply = await fetch(`${CATALOG_SOURCES.speed}/${id}/endpoints`)
        .then((response) => {
          if (response.status === 404 && id.endsWith("-batch")) {
            return null;
          }
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .catch((cause: unknown) => {
          failed.push(`${id} (${String(cause)})`);
          return null;
        });
      if (reply === null) {
        continue;
      }
      const endpoints = gatewayEndpointsSchema.safeParse(reply);
      if (!endpoints.success) {
        failed.push(`${id} (unexpected endpoints shape)`);
        continue;
      }
      const tokensPerSecond = throughputOf(id, endpoints.data);
      if (tokensPerSecond !== undefined) {
        speed.push([id, tokensPerSecond]);
      }
    }
  })
);

if (failed.length > 0) {
  console.error(
    `No speed for ${failed.length} model(s) whose endpoints failed:\n${failed.map((each) => `  ${each}`).join("\n")}`
  );
  if (!allowPartial) {
    console.error("Nothing written. Rerun, or pass --allow-partial.");
    process.exit(1);
  }
}

const catalog = generatedCatalogSchema.parse(
  buildCatalog(prices, speed, new Date().toISOString())
);
const target = fileURLToPath(
  new URL("../src/catalog/generated.ts", import.meta.url)
);
await writeFile(target, renderCatalog(catalog));
const biome = spawnSync("bunx", ["biome", "check", "--write", target], {
  stdio: "inherit",
});
if (biome.status !== 0) {
  console.error(
    `biome check --write failed on ${target}; fix it before committing.`
  );
  process.exit(biome.status ?? 1);
}

const counts = Object.entries(catalog.prices).map(
  ([source, models]) => `${source} ${Object.keys(models).length}`
);
console.log(
  `Wrote ${target}: prices for ${counts.join(", ")}; speed for ${speed.length} of ${language.length} Gateway language models`
);
