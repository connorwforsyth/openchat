import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createApp } from "./app";

// The committed document is the one Redocly lints (`packages/contract`
// `lint:openapi`), so serving the same thing is what makes the running app's
// `/api/openapi.json` lint-clean (PLAN.md §11 "Contract", ticket 046).
const committed: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../contract/openapi.json", import.meta.url)),
    "utf8"
  )
);

describe("GET /api/openapi.json", () => {
  it("serves the contract's document without a session or a database", async () => {
    const app = createApp({
      resolveSession: () => Promise.resolve(null),
      services: null,
    });
    const answer = await app.request("/api/openapi.json");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("application/json");
    // Round-trip through JSON so `undefined` fields drop out, as in the file.
    expect(await answer.json()).toEqual(committed);
  });
});
