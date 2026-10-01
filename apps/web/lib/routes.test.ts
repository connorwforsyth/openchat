import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { routes, safeNext } from "./routes";

describe("safeNext", () => {
  it("keeps a path on this origin, with its query", () => {
    expect(safeNext("/c/abc?x=1")).toBe("/c/abc?x=1");
    expect(safeNext("/settings/keys")).toBe("/settings/keys");
  });

  it("refuses anything that would leave the origin", () => {
    for (const value of [
      "https://evil.test/",
      "//evil.test/path",
      "/\\evil.test",
      "javascript:alert(1)",
      "c/abc",
      "/ spaced",
    ]) {
      expect(safeNext(value)).toBe(routes.home);
    }
  });

  it("never goes back to sign-in or sign-up", () => {
    expect(safeNext("/sign-in")).toBe(routes.home);
    expect(safeNext("/sign-up?invite=x")).toBe(routes.home);
  });

  it("defaults to home", () => {
    expect(safeNext(null)).toBe(routes.home);
    expect(safeNext(undefined)).toBe(routes.home);
    expect(safeNext("")).toBe(routes.home);
  });
});

describe("routes", () => {
  it("builds the addresses the shell and palette link to", () => {
    const chat = fixtureId("conversation", 1);
    const message = fixtureId("message", 2);
    expect(routes.chat(chat)).toBe(`/c/${chat}`);
    expect(routes.chat(chat, message)).toBe(`/c/${chat}#${message}`);
    expect(routes.askAi("hi there")).toBe("/?prompt=hi+there");
    expect(routes.signInThen("/c/1?a=b")).toBe(
      "/sign-in?next=%2Fc%2F1%3Fa%3Db"
    );
    expect(routes.signUpForInvite("tok")).toBe("/sign-up?invite=tok");
    expect(routes.libraryNew("agent")).toBe("/library/new/agent");
    const artifact = fixtureId("artifact", 3);
    expect(routes.artifact(artifact)).toBe(`/artifacts/${artifact}`);
  });
});
