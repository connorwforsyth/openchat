import { describe, expect, it } from "vitest";

import {
  CLIENT_ADDRESS_HEADER,
  clientAddressFrom,
  parseTrustedProxies,
  withClientAddress,
} from "./client-address";

const none = parseTrustedProxies(undefined).proxies;
const proxies = (value: string) => parseTrustedProxies(value).proxies;

describe("parseTrustedProxies", () => {
  it("takes addresses and CIDR ranges, separated by commas or spaces", () => {
    const parsed = parseTrustedProxies(
      "10.0.0.0/8, 127.0.0.1 ::1\n172.16.0.0/12"
    );
    expect(parsed.invalid).toEqual([]);
    expect(parsed.proxies.size).toBe(4);
  });

  it("reports what isn't an address or a range, and ignores it", () => {
    const parsed = parseTrustedProxies(
      "10.0.0.0/33,proxy.internal,::1/129,1.2.3.4/x"
    );
    expect(parsed.invalid).toEqual([
      "10.0.0.0/33",
      "proxy.internal",
      "::1/129",
      "1.2.3.4/x",
    ]);
    expect(parsed.proxies.size).toBe(0);
  });

  it("is empty when unset or blank", () => {
    expect(parseTrustedProxies("  ").proxies.size).toBe(0);
  });
});

describe("clientAddressFrom", () => {
  it("without trusted proxies, believes only the last hop", () => {
    expect(clientAddressFrom("203.0.113.9", none)).toBe("203.0.113.9");
    // A client can start the list; the nearest hop's entry wins.
    expect(clientAddressFrom("198.51.100.1, 203.0.113.9", none)).toBe(
      "203.0.113.9"
    );
  });

  it("skips trusted proxies from the right", () => {
    const trusted = proxies("10.0.0.0/8");
    expect(
      clientAddressFrom(
        "198.51.100.1, 203.0.113.9, 10.0.0.2, 10.1.2.3",
        trusted
      )
    ).toBe("203.0.113.9");
  });

  it("never believes an entry left of an untrusted hop", () => {
    const trusted = proxies("10.0.0.0/8");
    expect(clientAddressFrom("10.0.0.5, 203.0.113.9", trusted)).toBe(
      "203.0.113.9"
    );
  });

  it("gives the leftmost when every hop is trusted", () => {
    expect(clientAddressFrom("127.0.0.1", proxies("127.0.0.1,::1"))).toBe(
      "127.0.0.1"
    );
    expect(clientAddressFrom("::1", proxies("127.0.0.1,::1"))).toBe("::1");
  });

  it("normalises IPv4-mapped IPv6, ports and brackets", () => {
    expect(clientAddressFrom("::ffff:203.0.113.9", none)).toBe("203.0.113.9");
    expect(clientAddressFrom("203.0.113.9:4431", none)).toBe("203.0.113.9");
    expect(clientAddressFrom("[2001:db8::1]:443", none)).toBe("2001:db8::1");
    expect(
      clientAddressFrom("203.0.113.9, ::ffff:10.0.0.1", proxies("10.0.0.0/8"))
    ).toBe("203.0.113.9");
  });

  it("is null for a missing header or garbage where it matters", () => {
    expect(clientAddressFrom(null, none)).toBeNull();
    expect(clientAddressFrom("", none)).toBeNull();
    expect(clientAddressFrom("unknown", none)).toBeNull();
    expect(
      clientAddressFrom("unknown, 10.0.0.1", proxies("10.0.0.0/8"))
    ).toBeNull();
  });
});

describe("withClientAddress", () => {
  it("replaces a forged resolved-address header and keeps the body", async () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      body: JSON.stringify({ email: "a@example.com" }),
      headers: {
        "content-type": "application/json",
        [CLIENT_ADDRESS_HEADER]: "1.1.1.1",
        "x-forwarded-for": "198.51.100.1, 203.0.113.9",
      },
      method: "POST",
    });
    const stamped = withClientAddress(request, none);
    expect(stamped.headers.get(CLIENT_ADDRESS_HEADER)).toBe("203.0.113.9");
    expect(await stamped.json()).toEqual({ email: "a@example.com" });
  });

  it("drops a forged header when nothing resolves", () => {
    const stamped = withClientAddress(
      new Request("http://localhost/", {
        headers: { [CLIENT_ADDRESS_HEADER]: "1.1.1.1" },
      }),
      none
    );
    expect(stamped.headers.has(CLIENT_ADDRESS_HEADER)).toBe(false);
  });
});
