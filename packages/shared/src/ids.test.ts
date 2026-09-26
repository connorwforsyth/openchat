import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import { type Id, idSchema, idTimestamp, newId } from "./ids";

const UUID_SHAPE = /^[0-9a-f-]{36}$/;

describe("ids", () => {
  const conversationId = idSchema("conversation");

  it("mints UUIDv7 ids that the schema accepts", () => {
    const id = newId("conversation");
    expect(conversationId.parse(id)).toBe(id);
    expect(id).toMatch(UUID_SHAPE);
    expect(id[14]).toBe("7");
  });

  it("mints ids that sort by creation order", () => {
    const ids = Array.from({ length: 200 }, () => newId("message"));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects strings that are not UUIDs", () => {
    expect(conversationId.safeParse("conv_123").success).toBe(false);
    expect(conversationId.safeParse("").success).toBe(false);
    expect(conversationId.safeParse(42).success).toBe(false);
  });

  it("brands the inferred type by kind", () => {
    expectTypeOf<z.infer<typeof conversationId>>().toEqualTypeOf<
      Id<"conversation">
    >();
    expectTypeOf<Id<"conversation">>().not.toEqualTypeOf<Id<"message">>();
  });

  it("reads the timestamp back out of a UUIDv7", () => {
    const before = Date.now();
    const id = newId("run");
    const after = Date.now();
    const time = idTimestamp(id)?.getTime() ?? 0;
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });

  it("returns undefined for other UUID versions", () => {
    expect(idTimestamp("123e4567-e89b-42d3-a456-426614174000")).toBeUndefined();
    expect(idTimestamp("nope")).toBeUndefined();
  });
});
