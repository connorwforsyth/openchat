import { decisionLogEntrySchema } from "@workspace/contract/schemas/decider";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDb, expectOk, seedUser, type TestDb } from "../testing";
import { listDecisions, logDecision, toDecisionLogEntry } from "./decisions";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

describe("decision log", () => {
  test("logs answers and failures, lists newest first with filters", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const answered = await logDecision(db, {
      adapter: "rules",
      answer: {
        id: "needsSearch",
        probability: 0.9,
        type: "boolean",
        value: true,
      },
      latencyMs: 3.4,
      purpose: "retrieval-gate",
      question: {
        id: "needsSearch",
        prompt: "Does this need search?",
        type: "boolean",
      },
      userId: user.id,
    });
    const failed = await logDecision(db, {
      adapter: "llm-fallback",
      answer: null,
      error: "timeout",
      latencyMs: 2000,
      purpose: "auto-route",
      question: {
        id: "route",
        options: [{ id: "fast" }, { id: "strong" }],
        prompt: "Which model?",
        type: "choice",
      },
    });
    expect(answered.latencyMs).toBe(3);

    const all = expectOk(await listDecisions(db, { limit: 1 }));
    expect(all.items.map((d) => d.id)).toEqual([failed.id]);
    const next = expectOk(
      await listDecisions(db, { cursor: all.nextCursor ?? undefined, limit: 1 })
    );
    expect(next.items.map((d) => d.id)).toEqual([answered.id]);

    const gates = expectOk(
      await listDecisions(db, { limit: 10, purpose: "retrieval-gate" })
    );
    expect(gates.items.map((d) => d.id)).toEqual([answered.id]);

    const entry = toDecisionLogEntry(failed);
    expect(decisionLogEntrySchema.parse(entry)).toEqual(entry);
    expect(await listDecisions(db, { cursor: "zzz", limit: 1 })).toMatchObject({
      error: { type: "invalid_cursor" },
    });
  });
});
