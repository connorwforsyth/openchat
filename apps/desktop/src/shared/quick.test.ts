import { describe, expect, it } from "vitest";

import { decideQuickNavigation, mainUrlFor, quickUrl } from "./quick";

const instance = "https://chat.example.com";

describe("decideQuickNavigation", () => {
  it.each([
    ["https://chat.example.com/quick", "allow"],
    ["https://chat.example.com/quick?x=1", "allow"],
    // The rest of the instance belongs in the main window.
    ["https://chat.example.com/", "main"],
    ["https://chat.example.com/c/1", "main"],
    ["https://chat.example.com/quick/more", "main"],
    ["https://chat.example.com/sign-in?next=%2Fquick", "main"],
    // Other origins and schemes as in the main window.
    ["https://example.org/quick", "external"],
    ["mailto:someone@example.com", "external"],
    ["file:///etc/hosts", "deny"],
    ["javascript:alert(1)", "deny"],
  ])("%s → %s", (target, decision) => {
    expect(decideQuickNavigation(target, instance)).toBe(decision);
  });

  it("keeps nothing before an instance is chosen", () => {
    expect(decideQuickNavigation(`${instance}/quick`, null)).toBe("external");
  });
});

describe("mainUrlFor", () => {
  it("drops a way back to /quick from sign-in", () => {
    expect(mainUrlFor(`${instance}/sign-in?next=%2Fquick`)).toBe(
      `${instance}/sign-in`
    );
  });

  it("keeps every other address as it is", () => {
    expect(mainUrlFor(`${instance}/c/1`)).toBe(`${instance}/c/1`);
    expect(mainUrlFor(`${instance}/sign-in?next=%2Fc%2F1`)).toBe(
      `${instance}/sign-in?next=%2Fc%2F1`
    );
  });
});

describe("quickUrl", () => {
  it("is /quick on the instance", () => {
    expect(quickUrl(instance)).toBe(`${instance}/quick`);
    expect(quickUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/quick"
    );
  });
});
