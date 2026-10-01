import { describe, expect, it } from "vitest";

import { decideNavigation, decidePermission } from "./navigation";

const instance = "https://chat.example.com";

describe("decideNavigation", () => {
  it.each([
    ["https://chat.example.com/c/1", "allow"],
    ["https://chat.example.com/sign-in?next=%2F", "allow"],
    // Another origin, even a sibling (the artifacts origin), is the browser's.
    ["https://artifacts.chat.example.com/x", "external"],
    ["http://chat.example.com/", "external"],
    ["https://chat.example.com:444/", "external"],
    ["https://accounts.example.org/oauth", "external"],
    ["mailto:someone@example.com", "external"],
    ["file:///etc/passwd", "deny"],
    ["javascript:alert(1)", "deny"],
    ["custom-scheme://open", "deny"],
    ["not a url", "deny"],
  ])("%s → %s", (target, decision) => {
    expect(decideNavigation(target, instance)).toBe(decision);
  });

  it("allows nothing in-window before an instance is chosen", () => {
    expect(decideNavigation("https://chat.example.com/", null)).toBe(
      "external"
    );
  });
});

describe("decidePermission", () => {
  it("grants clipboard writes and fullscreen to the instance only", () => {
    expect(
      decidePermission("clipboard-sanitized-write", `${instance}/c/1`, instance)
    ).toBe(true);
    expect(decidePermission("fullscreen", instance, instance)).toBe(true);
    expect(
      decidePermission(
        "clipboard-sanitized-write",
        "https://evil.example",
        instance
      )
    ).toBe(false);
  });

  it.each([
    "media",
    "geolocation",
    "notifications",
    "clipboard-read",
    "openExternal",
    "midi",
    "hid",
  ])("denies %s, even to the instance", (permission) => {
    expect(decidePermission(permission, instance, instance)).toBe(false);
  });
});
