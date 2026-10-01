import { describe, expect, it } from "vitest";

import { parseInstanceUrl } from "./instance-url";

describe("parseInstanceUrl", () => {
  it.each([
    ["https://chat.example.com", "https://chat.example.com"],
    ["chat.example.com", "https://chat.example.com"],
    ["  https://chat.example.com/c/123?x=1#y  ", "https://chat.example.com"],
    ["https://chat.example.com:8443/", "https://chat.example.com:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3100/sign-in", "http://127.0.0.1:3100"],
    ["http://[::1]:3000", "http://[::1]:3000"],
    ["http://e2e.localhost:3000", "http://e2e.localhost:3000"],
  ])("accepts %s as %s", (input, origin) => {
    expect(parseInstanceUrl(input)).toEqual({ ok: true, value: origin });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["http://chat.example.com", "insecure"],
    ["http://localhost.example.com", "insecure"],
    ["http://127.0.0.1.example.com", "insecure"],
    ["file:///etc/passwd", "unsupported-protocol"],
    ["javascript:alert(1)", "unsupported-protocol"],
    ["ftp://chat.example.com", "unsupported-protocol"],
    ["https://user:pass@chat.example.com", "invalid"],
    ["https://exa mple.com", "invalid"],
  ])("refuses %j (%s)", (input, error) => {
    expect(parseInstanceUrl(input)).toEqual({ error, ok: false });
  });
});
