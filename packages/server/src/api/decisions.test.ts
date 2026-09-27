import { call } from "@orpc/server";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { logDecision } from "@workspace/db/queries/decisions";
import { createTestDb, seedUser, type TestDb } from "@workspace/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDecisionsRouter } from "./decisions";

// The Decider's log is for instance admins only.

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});

afterAll(() => t.close());

const as = (userId: UserId | null) => ({
  context: {
    request: new Request("http://x"),
    session: userId ? { userId } : null,
  },
});

describe("decisions.list", () => {
  it("pages the log for instance admins and refuses everyone else", async () => {
    const { decisions } = createDecisionsRouter({ db });
    const admin = await seedUser(db, { role: "admin" });
    const user = await seedUser(db, { role: "user" });
    const logged = await Promise.all(
      (["retrieval-gate", "auto-route"] as const).map((purpose) =>
        logDecision(db, {
          adapter: "rules",
          answer: null,
          latencyMs: 1,
          purpose,
          question: { id: "q", prompt: "Search?", type: "boolean" },
          userId: user.id,
        })
      )
    );

    await expect(call(decisions.list, {}, as(null))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(call(decisions.list, {}, as(user.id))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const first = await call(decisions.list, { limit: 1 }, as(admin.id));
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const gates = await call(
      decisions.list,
      { purpose: "retrieval-gate" },
      as(admin.id)
    );
    expect(gates.items.map((entry) => entry.id)).toContain(logged[0]?.id);
    expect(
      gates.items.every((entry) => entry.purpose === "retrieval-gate")
    ).toBe(true);
    await expect(
      call(decisions.list, { cursor: "nope" }, as(admin.id))
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
