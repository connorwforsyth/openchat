import { describe, expect, it } from "vitest";

import { appConfigSchema } from "./schema";

const currencyOf = (usage: unknown) =>
  appConfigSchema.safeParse({ usage }).data?.usage.currency;

describe("usage.currency", () => {
  it("is US dollars by default", () => {
    expect(appConfigSchema.parse({}).usage.currency).toEqual({
      code: "USD",
      perUsd: 1,
    });
  });

  it("takes a code and a fixed rate per US dollar", () => {
    expect(currencyOf({ currency: { code: "AUD", perUsd: 1.52 } })).toEqual({
      code: "AUD",
      perUsd: 1.52,
    });
  });

  it("rejects a bad code, a non-positive rate and USD at another rate", () => {
    expect(
      currencyOf({ currency: { code: "aud", perUsd: 1.5 } })
    ).toBeUndefined();
    expect(
      currencyOf({ currency: { code: "AUD", perUsd: 0 } })
    ).toBeUndefined();
    expect(
      currencyOf({ currency: { code: "USD", perUsd: 2 } })
    ).toBeUndefined();
  });
});
