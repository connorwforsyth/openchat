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

const speed: (readonly [string, number])[] = [];
const queue = [...language];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      // biome-ignore lint/performance/noAwaitInLoops: each worker fetches in turn; CONCURRENCY workers is the limit
      const reply = await json(
        `${CATALOG_SOURCES.speed}/${id}/endpoints`
      ).catch(() => null);
      const endpoints = gatewayEndpointsSchema.safeParse(reply);
      const tokensPerSecond = endpoints.success
        ? throughputOf(id, endpoints.data)
        : undefined;
      if (tokensPerSecond !== undefined) {
        speed.push([id, tokensPerSecond]);
      }
    }
  })
);

const catalog = generatedCatalogSchema.parse(
  buildCatalog(prices, speed, new Date().toISOString())
);
const target = fileURLToPath(
  new URL("../src/catalog/generated.ts", import.meta.url)
);
await writeFile(target, renderCatalog(catalog));
spawnSync("bunx", ["biome", "format", "--write", target], { stdio: "ignore" });

const counts = Object.entries(catalog.prices).map(
  ([source, models]) => `${source} ${Object.keys(models).length}`
);
console.log(
  `Wrote ${target}: prices for ${counts.join(", ")}; speed for ${speed.length} of ${language.length} Gateway language models`
);
