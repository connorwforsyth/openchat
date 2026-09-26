import { describe, expect, it } from "vitest";

import {
  all,
  err,
  flatMap,
  fromPromise,
  isErr,
  isOk,
  map,
  mapErr,
  match,
  ok,
  type Result,
  tryCatch,
  unwrapOr,
} from "./result";

const parsePositive = (value: number): Result<number, "negative"> =>
  value < 0 ? err("negative") : ok(value);

describe("Result", () => {
  it("constructs and narrows ok and err", () => {
    const good = ok(1);
    const bad = err("boom");
    expect(good).toEqual({ ok: true, value: 1 });
    expect(bad).toEqual({ error: "boom", ok: false });
    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);
  });

  it("maps values and errors independently", () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(map(err("e") as Result<number, string>, (n) => n * 2)).toEqual(
      err("e")
    );
    expect(mapErr(err("e"), (e) => e.toUpperCase())).toEqual(err("E"));
    expect(mapErr(ok(1) as Result<number, string>, () => "x")).toEqual(ok(1));
  });

  it("chains with flatMap, stopping at the first error", () => {
    expect(flatMap(ok(3), parsePositive)).toEqual(ok(3));
    expect(flatMap(ok(-1), parsePositive)).toEqual(err("negative"));
    expect(
      flatMap(err("earlier") as Result<number, string>, parsePositive)
    ).toEqual(err("earlier"));
  });

  it("matches both branches", () => {
    const render = (result: Result<number, string>) =>
      match(result, { err: (e) => `err:${e}`, ok: (v) => `ok:${v}` });
    expect(render(ok(1))).toBe("ok:1");
    expect(render(err("x"))).toBe("err:x");
  });

  it("unwraps with a fallback", () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err("x") as Result<number, string>, 0)).toBe(0);
  });

  it("collects results, returning the first error", () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err("a"), err("b")])).toEqual(err("a"));
    expect(all([])).toEqual(ok([]));
  });

  it("turns throws into errors with tryCatch", () => {
    expect(
      tryCatch(
        () => JSON.parse("[1]"),
        () => "bad"
      )
    ).toEqual(ok([1]));
    expect(
      tryCatch(
        () => JSON.parse("{"),
        () => "bad"
      )
    ).toEqual(err("bad"));
  });

  it("turns rejections into errors with fromPromise", async () => {
    expect(await fromPromise(Promise.resolve(1), () => "bad")).toEqual(ok(1));
    expect(
      await fromPromise(Promise.reject(new Error("x")), (cause) =>
        cause instanceof Error ? cause.message : "unknown"
      )
    ).toEqual(err("x"));
    // A thunk that throws synchronously is caught too.
    expect(
      await fromPromise(
        () => {
          throw new Error("sync");
        },
        () => "caught"
      )
    ).toEqual(err("caught"));
  });
});
